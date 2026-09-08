"""
Suspicious-pattern detection: rule heuristics + Isolation Forest outliers.

Reads edges + Person nodes from a GraphStore (live Neo4j or NetworkX
fallback). Every flag:
  {entities_involved, pattern_type, evidence, severity_score (0..1),
   plain_language_explanation, source_dataset}

Configurable constants (top of file — update if regulation changes):
  PMLA_CASH_THRESHOLD = 10_00_000      # Rs 10 lakh, PMLA cash reporting
  STRUCTURING_LOW     = 9_00_000       # "just under" band lower bound
  STRUCTURING_WINDOW_DAYS = 7
  SPIKE_RATIO / SPIKE_WINDOW_DAYS      # call-spike rule
  NEWCOMER_*                           # clean-record + high centrality rule

Financial checks (structuring, split-structuring, circular transfers) run
only when the source actually has FINANCIAL_TRANSFER edges — Enron/Caviar
have none, so those checks skip gracefully (reported in `skipped`).

Usage:
  from graph_store import GraphStore
  from suspicious_patterns import detect_all
  g = GraphStore(uri="bolt://localhost:7687", user="neo4j",
                 password="SIH-Hackathon-2026")
  flags, skipped = detect_all(g, event_dates=["1994-04-03"],
                              criminal_records={"caviar:1", "caviar:3"})
"""
from collections import defaultdict
from datetime import datetime, timedelta

# ------------------------------------------------- configurable constants ---
PMLA_CASH_THRESHOLD = 10_00_000   # Rs 10 lakh — PMLA cash reporting limit
STRUCTURING_LOW = 9_00_000        # "just under" band: 9L .. 9,99,999
STRUCTURING_WINDOW_DAYS = 7       # split-structuring aggregation window
SPIKE_RATIO = 3.0                 # spike = >=3x baseline daily rate
SPIKE_WINDOW_DAYS = 7             # days around an event date to examine
NEWCOMER_MIN_PAGERANK = 0.02      # clean-record + pagerank above this
NEWCOMER_MIN_BETWEEN = 0.05       # ... or betweenness above this
CYCLE_MIN_LEN = 3
IFOREST_CONTAMINATION = 0.05


# ------------------------------------------------------------------ utils ---
def _parse_date(s):
    if not s:
        return None
    s = str(s).strip()
    if s.startswith("phase:"):  # caviar phase anchors aren't real dates
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S",
                "%d %b %Y", "%d %B %Y", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:len(fmt) + 6] if "%T" not in fmt
                                     else s, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def _flag(entities, ptype, evidence, severity, explanation, source):
    return {"entities_involved": sorted(entities), "pattern_type": ptype,
            "evidence": evidence, "severity_score": round(severity, 3),
            "plain_language_explanation": explanation,
            "source_dataset": source}


def _read_edges(store):
    """(src_id, dst_id, rel_type, props, source) for Person-Person edges."""
    out = []
    if getattr(store, "fallback", False):
        for (ls, s), (ld, d), e in store.G.edges(data=True):
            if ls != "Person" or ld != "Person":
                continue
            src = e.get("source_dataset") or e.get("extra", {}).get("source")
            out.append((s, d, e.get("rel", ""), dict(e), src or "unknown"))
        return out
    with store.driver.session() as sess:
        recs = sess.run("""MATCH (a:Person)-[e]->(b:Person)
                           RETURN a.id AS s, b.id AS d, type(e) AS t,
                                  properties(e) AS p""")
        for r in recs:
            p = dict(r["p"])
            out.append((r["s"], r["d"], r["t"], p,
                        p.get("source_dataset", "unknown")))
    return out


def _read_person_ids(store):
    if getattr(store, "fallback", False):
        return [pid for (l, pid) in store.G.nodes if l == "Person"]
    with store.driver.session() as sess:
        return [r["id"] for r in sess.run("MATCH (p:Person) RETURN p.id AS id")]


# ------------------------------------------------------------ rule checks ---
CALL_TYPES = {"CALLED", "ASSOCIATE_OF"}


def check_call_spikes(edges, event_dates, source):
    """Call frequency spike within +-SPIKE_WINDOW_DAYS of an event date."""
    flags = []
    events = [d for d in (_parse_date(e) for e in event_dates) if d]
    if not events:
        return flags
    for s, d, t, p, _ in edges:
        if t not in CALL_TYPES:
            continue
        days = sorted({x for x in
                       (_parse_date(v) for v in p.get("timestamps", []))
                       if x})
        if len(days) < 2:
            continue
        base = len(days) / max(1, (days[-1] - days[0]).days + 1)
        for ev in events:
            near = [x for x in days
                    if abs((x - ev).days) <= SPIKE_WINDOW_DAYS]
            rate = len(near) / (2 * SPIKE_WINDOW_DAYS + 1)
            if base > 0 and rate / base >= SPIKE_RATIO and near:
                flags.append(_flag(
                    [s, d], "CALL_SPIKE",
                    {"event_date": str(ev), "calls_near_event": len(near),
                     "baseline_per_day": round(base, 3),
                     "window_rate": round(rate, 3),
                     "ratio": round(rate / base, 2)},
                    min(0.95, 0.4 + 0.1 * (rate / base)),
                    f"{s} and {d} contacted each other {len(near)} times "
                    f"within {SPIKE_WINDOW_DAYS} days of {ev} — "
                    f"{rate / base:.1f}x their usual rate. Bursts of calls "
                    f"around an event date often mean coordination or "
                    f"aftermath discussion.",
                    source))
                break
    return flags


def check_structuring(edges, source):
    """Single tx in [STRUCTURING_LOW, PMLA_CASH_THRESHOLD), or a group of
    smaller tx between the same pair summing into that band within
    STRUCTURING_WINDOW_DAYS. Skips sources with no financial edges."""
    flags, fin = [], []
    for s, d, t, p, _ in edges:
        if t != "FINANCIAL_TRANSFER":
            continue
        txs = p.get("transactions")  # per-payment list (graph_store)
        if isinstance(txs, list) and txs:
            for tx in txs:
                q = dict(p)
                q["amount"] = tx.get("amount")
                q["date"] = tx.get("date", p.get("date", ""))
                fin.append((s, d, q))
        elif p.get("amount"):
            fin.append((s, d, p))
    if not fin:
        return flags, True
    for s, d, p in fin:
        try:
            amt = float(p["amount"])
        except (TypeError, ValueError):
            continue
        if STRUCTURING_LOW <= amt < PMLA_CASH_THRESHOLD:
            flags.append(_flag(
                [s, d], "STRUCTURING_SINGLE",
                {"amount": amt, "threshold": PMLA_CASH_THRESHOLD,
                 "date": p.get("date", "")},
                0.75,
                f"A transfer of Rs {amt:,.0f} from {s} to {d} sits just "
                f"below the Rs {PMLA_CASH_THRESHOLD:,.0f} cash reporting "
                f"threshold. Amounts clustered right under a reporting "
                f"limit are the classic structuring signal — deliberately "
                f"sized to avoid triggering a report.",
                source))
    by_pair = defaultdict(list)
    for s, d, p in fin:
        dt = _parse_date(p.get("date", ""))
        try:
            amt = float(p["amount"])
        except (TypeError, ValueError):
            continue
        if dt and amt < PMLA_CASH_THRESHOLD:
            by_pair[(s, d)].append((dt, amt))
    for (s, d), txs in by_pair.items():
        txs.sort()
        for i in range(len(txs)):
            window = [a for dt, a in txs
                      if 0 <= (dt - txs[i][0]).days <= STRUCTURING_WINDOW_DAYS]
            total = sum(window)
            if len(window) >= 2 and \
                    STRUCTURING_LOW <= total < PMLA_CASH_THRESHOLD:
                flags.append(_flag(
                    [s, d], "STRUCTURING_SPLIT",
                    {"n_transactions": len(window),
                     "total": total, "threshold": PMLA_CASH_THRESHOLD,
                     "window_days": STRUCTURING_WINDOW_DAYS},
                    0.85,
                    f"{len(window)} transfers from {s} to {d} within "
                    f"{STRUCTURING_WINDOW_DAYS} days total Rs {total:,.0f} "
                    f"— just under the Rs {PMLA_CASH_THRESHOLD:,.0f} "
                    f"reporting limit. Splitting one large payment into "
                    f"smaller ones to dodge reporting is structuring.",
                    source))
                break
    return flags, False


def check_newcomer_central(central, criminal_records, source):
    """Clean-record person with high centrality in a flagged community."""
    flags = []
    for r in central:
        pid = r["person_id"]
        if pid in criminal_records:
            continue
        bd = r["centrality_breakdown"]
        if bd["pagerank"] >= NEWCOMER_MIN_PAGERANK or \
                bd["betweenness"] >= NEWCOMER_MIN_BETWEEN:
            flags.append(_flag(
                [pid], "NEWCOMER_CENTRAL",
                {"pagerank": bd["pagerank"],
                 "betweenness": bd["betweenness"],
                 "community_id": r["community_id"], "role": r["role"]},
                0.6,
                f"{pid} has no prior record but sits in a central position "
                f"(community {r['community_id']}, role {r['role']}). A "
                f"first-timer suddenly brokering traffic inside a flagged "
                f"group is worth a closer look — new recruits are often "
                f"placed where the action is.",
                source))
    return flags


def check_cycles(edges, source):
    """Circular money movement across >=CYCLE_MIN_LEN accounts."""
    flags, skipped = [], True
    adj = defaultdict(set)
    for s, d, t, p, _ in edges:
        if t == "FINANCIAL_TRANSFER":
            skipped = False
            adj[s].add(d)
    if skipped:
        return flags, skipped
    found = set()
    nodes = list(adj)

    def dfs(start, cur, path, depth):
        if depth > 6:
            return
        for nxt in adj.get(cur, ()):  # noqa: B023
            if nxt == start and len(path) >= CYCLE_MIN_LEN:
                key = tuple(sorted(path))
                if key not in found:
                    found.add(key)
                    flags.append(_flag(
                        path, "CIRCULAR_TRANSFER",
                        {"cycle_length": len(path),
                         "cycle": path + [start]},
                        min(0.9, 0.5 + 0.1 * len(path)),
                        f"Money loops {' -> '.join(path + [start])} and "
                        f"returns to where it started. Circular flows "
                        f"across {len(path)} accounts are a layering "
                        f"signal — funds are moved to obscure their "
                        f"origin, not to pay anyone.",
                        source))
            elif nxt not in path:
                dfs(start, nxt, path + [nxt], depth + 1)

    for n in nodes:
        dfs(n, n, [n], 1)
    return flags, False


# --------------------------------------------------------------- ML check ---
def check_outliers(store, source):
    """Isolation Forest over per-node numeric features actually present:
    call frequency, tx volume, degree, pagerank, betweenness."""
    from sklearn.ensemble import IsolationForest
    edges = _read_edges(store)
    call_vol = defaultdict(float)
    tx_vol = defaultdict(float)
    for s, d, t, p, _ in edges:
        if t in CALL_TYPES:
            try:
                f = float(p.get("frequency", 1))
            except (TypeError, ValueError):
                f = 1.0
            call_vol[s] += f
            call_vol[d] += f * 0.5
        if t == "FINANCIAL_TRANSFER":
            try:
                a = float(p.get("amount", 0))
            except (TypeError, ValueError):
                a = 0.0
            tx_vol[s] += a
            tx_vol[d] += a
    try:
        from analytics import analyze
        central = {r["person_id"]: r["centrality_breakdown"]
                   for r in analyze(store)}
    except Exception:
        central = {}
    pids = _read_person_ids(store)
    has_tx = any(tx_vol.values())
    feats, ids = [], []
    import networkx as _nx  # noqa: F401  (ensures nx present for analyze)
    for pid in pids:
        c = central.get(pid, {})
        row = [call_vol.get(pid, 0.0),
               c.get("degree", 0.0), c.get("betweenness", 0.0),
               c.get("pagerank", 0.0)]
        if has_tx:
            row.append(tx_vol.get(pid, 0.0))
        feats.append(row)
        ids.append(pid)
    feature_names = ["call_freq", "degree", "betweenness", "pagerank"] + \
        (["tx_volume"] if has_tx else [])
    if len(feats) < 5:
        return [], feature_names
    clf = IsolationForest(contamination=IFOREST_CONTAMINATION,
                          random_state=42)
    scores = clf.fit_predict(feats)  # -1 = outlier
    s_vals = clf.decision_function(feats)
    flags = []
    for pid, row, pred, s in zip(ids, feats, scores, s_vals):
        if pred == -1:
            ev = dict(zip(feature_names, [round(v, 4) for v in row]))
            ev["anomaly_score"] = round(float(-s), 4)
            flags.append(_flag(
                [pid], "STATISTICAL_OUTLIER", ev,
                min(0.9, 0.5 + float(-s)),
                f"{pid} is a statistical outlier (Isolation Forest over "
                f"{', '.join(feature_names)}): " +
                ", ".join(f"{k}={v}" for k, v in ev.items()
                           if k != "anomaly_score") +
                ". Its overall activity profile doesn't match the rest of "
                "the network — unusual volume or position deserves review.",
                source))
    return flags, feature_names


# -------------------------------------------------------------- entrypoint ---
def detect_all(store, source_dataset="caviar", event_dates=(),
               criminal_records=frozenset(), central=None):
    """Run every check. Returns (flags, skipped_report)."""
    edges = _read_edges(store)
    flags, skipped = [], {}
    flags += check_call_spikes(edges, event_dates, source_dataset)
    f, sk = check_structuring(edges, source_dataset)
    flags += f
    skipped["structuring"] = sk
    if central is None and criminal_records:
        try:
            from analytics import analyze
            central = analyze(store)
        except Exception:
            central = []
    if central:
        flags += check_newcomer_central(central, set(criminal_records),
                                        source_dataset)
    f, sk = check_cycles(edges, source_dataset)
    flags += f
    skipped["cycles"] = sk
    f, feats = check_outliers(store, source_dataset)
    flags += f
    skipped["outlier_features"] = feats
    flags.sort(key=lambda x: -x["severity_score"])
    return flags, skipped


if __name__ == "__main__":
    import json
    from graph_store import GraphStore
    g = GraphStore(uri="bolt://localhost:7687", user="neo4j",
                   password="SIH-Hackathon-2026")
    flags, skipped = detect_all(
        g, source_dataset="caviar", event_dates=["1994-04-03"],
        criminal_records={"caviar:1", "caviar:3", "caviar:12"})
    print(f"live-graph flags={len(flags)} skipped={skipped}")
    for f in flags[:8]:
        print(json.dumps(f, indent=1)[:600])
    g.close()
