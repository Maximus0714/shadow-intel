"""
Entity resolution: cluster raw mentions into canonical entities.

Input : list of mentions, each a dict:
    {"mention_id": "m1", "type": "PERSON", "text": "Rahul Sharma",
     "doc_id": "doc1", "source": "own_dataset",          # source optional
     "attrs": {"phone": "+91 98765 43210"}}              # attrs optional;
        # PERSON mentions may carry linked attributes (phone/vehicle) —
        # same-doc links from the NER stage. Shared attrs boost merges,
        # conflicting attrs penalise them.

Matching:
  PERSON          fuzzy (rapidfuzz token_set_ratio) + initial-aware bonus
  PHONE_NUMBER    normalized exact  (strip +91/91/0/1, spaces, dashes)
  VEHICLE_NUMBER  normalized exact  (uppercase, strip spaces/dashes)
  others          normalized exact, fallback fuzzy

Blocking: (type, first_token) + (type, last_token) keys per mention
  (PERSON emits both so "Rahul Sharma"~"R. Sharma" via surname and
  "Rahul Sharma"~"Rahul S." via first name meet); phones/vehicles block on
  normalized form. Only pairs sharing a block are scored. Shared-attribute
  edges are ALSO scored even across blocks (attribute index bypass).

Scoring (0..1): base similarity + shared-attr bonus (+0.30), capped 0.99;
  conflicting phone attrs apply -0.25 penalty.
  score >= auto_threshold   -> auto-merge (union-find)
  score >= review_threshold -> human-review queue (NOT merged)
  else                      -> no merge

Output: {"clusters": [...], "mapping": {mention_id: canonical_id},
         "review_queue": [...], "stats": {...}}

Usage:
  from backend.entity_resolution import resolve, mentions_from_ner
  result = resolve(mentions)
"""
import re
from collections import defaultdict
from rapidfuzz import fuzz

AUTO_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.60
SHARED_ATTR_BONUS = 0.30
CONFLICT_PENALTY = 0.25
CAP = 0.99

PREFIX = {"PERSON": "PER", "PHONE_NUMBER": "PHN", "VEHICLE_NUMBER": "VEH",
          "LOCATION": "LOC", "ORGANIZATION": "ORG", "DATE": "DAT",
          "MONEY_AMOUNT": "MON"}


# ------------------------------------------------------------ normalizers ---
def normalize_phone(text):
    d = re.sub(r"\D", "", text or "")
    if len(d) == 12 and d.startswith("91"):
        d = d[2:]
    elif len(d) == 11 and d[0] in ("0", "1"):
        d = d[1:]
    return d


def normalize_vehicle(text):
    return re.sub(r"[\s\-]", "", (text or "").upper())


def normalize_name(text):
    t = re.sub(r"[.\-_,]", " ", (text or "").lower())
    return re.sub(r"\s+", " ", t).strip()


def norm_attrs(attrs):
    """Normalize a mention's attrs dict for comparison."""
    out = {}
    for k, v in (attrs or {}).items():
        if v is None:
            continue
        k = k.lower()
        if k in ("phone", "phone_number"):
            out["phone"] = normalize_phone(str(v))
        elif k in ("vehicle", "vehicle_number"):
            out["vehicle"] = normalize_vehicle(str(v))
        else:
            out[k] = str(v).strip().lower()
    return {k: v for k, v in out.items() if v}


def mention_norm_key(m):
    t = m["type"]
    if t == "PHONE_NUMBER":
        return normalize_phone(m["text"])
    if t == "VEHICLE_NUMBER":
        return normalize_vehicle(m["text"])
    if t == "PERSON":
        return normalize_name(m["text"])
    return (m["text"] or "").strip().lower()


# ---------------------------------------------------------------- blocking ---
def block_keys(m):
    """One mention -> set of block keys. Pairs sharing any key get scored."""
    t, nk = m["type"], mention_norm_key(m)
    if t in ("PHONE_NUMBER", "VEHICLE_NUMBER"):
        return {(t, nk)} if nk else set()
    toks = nk.split()
    if not toks:
        return set()
    keys = {(t, toks[0])}
    if len(toks) > 1:
        keys.add((t, toks[-1]))
    return keys


# ------------------------------------------------------------------ scoring ---
def base_sim(a, b):
    """Base 0..1 similarity for two mentions of the same type."""
    t = a["type"]
    if t in ("PHONE_NUMBER", "VEHICLE_NUMBER", "DATE", "MONEY_AMOUNT"):
        return 1.0 if mention_norm_key(a) == mention_norm_key(b) \
            and mention_norm_key(a) else 0.0
    na, nb = normalize_name(a["text"]), normalize_name(b["text"])
    if na == nb and na:
        return 1.0
    s = fuzz.token_set_ratio(na, nb) / 100.0
    # initial-aware bonus: "r sharma" vs "rahul sharma"
    ta, tb = na.split(), nb.split()
    if ta and tb and ta[-1] == tb[-1] and len(ta[-1]) > 1:
        fa, fb = ta[0], tb[0]
        if (len(fa) == 1 and fb.startswith(fa)) or \
           (len(fb) == 1 and fa.startswith(fb)):
            s = min(1.0, s + 0.12)
    return s


def pair_score(a, b):
    """(score, explanation dict). Cross-type pairs never merge."""
    if a["type"] != b["type"]:
        return 0.0, {"reason": "different types"}
    s = base_sim(a, b)
    exp = {"base": round(s, 3)}
    aa, bb = norm_attrs(a.get("attrs")), norm_attrs(b.get("attrs"))
    shared = [k for k in aa if k in bb and aa[k] == bb[k]]
    conflict = [k for k in aa if k in bb and aa[k] != bb[k] and k == "phone"]
    if shared:
        s = min(CAP, s + SHARED_ATTR_BONUS)
        exp["shared_attrs"] = shared
        exp["bonus"] = SHARED_ATTR_BONUS
    if conflict:
        s = max(0.0, s - CONFLICT_PENALTY)
        exp["conflicting_attrs"] = conflict
        exp["penalty"] = CONFLICT_PENALTY
    exp["final"] = round(s, 3)
    return s, exp


# -------------------------------------------------------------- union-find ---
class _UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


# ------------------------------------------------------------------ resolve ---
def resolve(mentions, auto_threshold=AUTO_THRESHOLD,
            review_threshold=REVIEW_THRESHOLD):
    by_id = {m["mention_id"]: m for m in mentions}
    n = len(mentions)
    total_pairs = n * (n - 1) // 2

    # blocking index
    index = defaultdict(list)
    for m in mentions:
        for k in block_keys(m):
            index[k].append(m["mention_id"])
    # attribute index bypasses blocking (shared phone etc. always compared)
    attr_index = defaultdict(list)
    for m in mentions:
        for k, v in norm_attrs(m.get("attrs")).items():
            attr_index[(m["type"], k, v)].append(m["mention_id"])

    cand = set()
    for ids in index.values():
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                cand.add(tuple(sorted((ids[i], ids[j]))))
    n_block = len(cand)
    for ids in attr_index.values():
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                cand.add(tuple(sorted((ids[i], ids[j]))))

    uf, edge_score, review_queue = _UF(), {}, []
    for i, j in sorted(cand):
        s, exp = pair_score(by_id[i], by_id[j])
        if s >= auto_threshold:
            uf.union(i, j)
            edge_score[(i, j)] = round(s, 3)
        elif s >= review_threshold:
            review_queue.append({"mention_a": i, "mention_b": j,
                                 "score": round(s, 3),
                                 "detail": exp,
                                 "a_text": by_id[i]["text"],
                                 "b_text": by_id[j]["text"]})
    review_queue.sort(key=lambda r: -r["score"])

    groups = defaultdict(list)
    for m in mentions:
        groups[uf.find(m["mention_id"])].append(m["mention_id"])
    # deterministic order: by type, then first mention id
    ordered = sorted(groups.values(),
                     key=lambda g: (by_id[g[0]]["type"], g[0]))

    clusters, mapping = [], {}
    counters = defaultdict(int)
    for g in ordered:
        t = by_id[g[0]]["type"]
        counters[t] += 1
        cid = f"{PREFIX.get(t, 'ENT')}-{counters[t]:03d}"
        members = sorted(g)
        # canonical label: longest surface form (most complete), tie: frequent
        label = max(members, key=lambda i: (len(by_id[i]["text"]),
                                            -members.index(i)))
        scores = [edge_score[tuple(sorted(p))]
                  for p in [tuple(sorted((members[i], members[j])))
                            for i in range(len(members))
                            for j in range(i + 1, len(members))]
                  if tuple(sorted(p)) in edge_score]
        conf = round(sum(scores) / len(scores), 3) if scores else 1.0
        clusters.append({"canonical_id": cid, "type": t,
                         "canonical_label": by_id[label]["text"],
                         "members": members, "confidence": conf})
        for i in members:
            mapping[i] = cid

    return {"clusters": clusters, "mapping": mapping,
            "review_queue": review_queue,
            "stats": {"mentions": n, "total_pairs": total_pairs,
                      "blocked_comparisons": n_block,
                      "attr_bypass_added": len(cand) - n_block,
                      "comparisons_scored": len(cand),
                      "pruned_by_blocking": total_pairs - len(cand),
                      "auto_merges": len(edge_score),
                      "review_flagged": len(review_queue),
                      "clusters": len(clusters)}}


def mentions_from_ner(ner_outputs):
    """Flatten CrimeNerPipeline JSONs -> mentions.

    PERSON mentions inherit same-doc normalized phones/vehicles as attrs
    (the shared-attribute resolution signal), tagged with their origin.
    """
    mentions = []
    for doc in ner_outputs:
        phones = [normalize_phone(e["text"]) for e in doc["entities"]
                  if e["type"] == "PHONE_NUMBER"]
        vehicles = [normalize_vehicle(e["text"]) for e in doc["entities"]
                    if e["type"] == "VEHICLE_NUMBER"]
        for k, e in enumerate(doc["entities"]):
            mid = f"{doc['doc_id']}#e{k}"
            attrs = {}
            if e["type"] == "PERSON":
                if phones:
                    attrs["phone"] = phones[0]
                if vehicles:
                    attrs["vehicle"] = vehicles[0]
            mentions.append({"mention_id": mid, "type": e["type"],
                             "text": e["text"], "doc_id": doc["doc_id"],
                             "source": doc.get("source", ""),
                             "attrs": attrs})
    return mentions


# ------------------------------------------------------- worked example ---
if __name__ == "__main__":
    mentions = [
        {"mention_id": "m1", "type": "PERSON", "text": "Rahul Sharma",
         "doc_id": "fir102", "source": "own_dataset",
         "attrs": {"phone": "+91 98765 43210"}},
        {"mention_id": "m2", "type": "PERSON", "text": "R. Sharma",
         "doc_id": "soc7", "source": "own_dataset",
         "attrs": {"phone": "9876543210"}},          # same number, no prefix
        {"mention_id": "m3", "type": "PERSON", "text": "Rahul Verma",
         "doc_id": "surv3", "source": "own_dataset",
         "attrs": {"phone": "+91 91234 56780"}},      # same first name, DIFF number
        {"mention_id": "m4", "type": "PHONE_NUMBER", "text": "+91 98765 43210",
         "doc_id": "fir102", "source": "own_dataset"},
        {"mention_id": "m5", "type": "PHONE_NUMBER", "text": "9876543210",
         "doc_id": "soc7", "source": "own_dataset"},
    ]
    import json
    res = resolve(mentions)
    print(json.dumps(res, indent=2, ensure_ascii=False))
