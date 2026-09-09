"""
Graph store: Neo4j backend + NetworkX-only fallback for local testing.

Schema (Cypher):
  (:Person {id, label, source})
  (:Vehicle {id, plate})   (:Location {id, name})
  (Person)-[:CALLED {frequency, timestamps}]->(Person)
  (Person)-[:FINANCIAL_TRANSFER {amount, date}]->(Person)
  (Person)-[:CO_LOCATED {event, timestamp}]->(Person)
  (Person)-[:ASSOCIATE_OF]->(Person)
    (CAVIAR CONTACTED / Enron EMAILED edges load as ASSOCIATE_OF with the
    same aggregation semantics: weight/frequency + timestamp list +
    provenance in `kind`.)
  (Person)-[:OWNS_VEHICLE]->(Vehicle)
  (Person)-[:REGISTERED_AT]->(Location)

Bulk load from Prompt-1 outputs:
  nodes:  out_caviar/nodes_person.csv, out/nodes_person.csv,
          out_enron/nodes_person.csv  (also accepts enron-style nodes_person)
  edges:  out_caviar/edges_contacted.csv  (CONTACTED: weight, phase_number)
          out_enron/edges_emailed_agg.csv (EMAILED: frequency, timestamps)
          + generic loader for CALLED/FINANCIAL_TRANSFER/CO_LOCATED/
            ASSOCIATE_OF/OWNS_VEHICLE/REGISTERED_AT rows (your real CDR/
            financial/co-occurrence files) — see load_relationships().
Repeated interactions between the same pair+type are deduplicated into one
edge with aggregated frequency + merged timestamp list.

Usage:
  # local testing, no database:
  from backend.graph_store import GraphStore
  g = GraphStore(fallback=True)
  g.load_prompt1_outputs(caviar_dir="out_caviar", max_edges_per_file=5000)
  print(g.get_ego_network("caviar:1", depth=1))

  # against Neo4j:
  g = GraphStore(uri="bolt://localhost:7687", user="neo4j", password="pass")
  g.load_prompt1_outputs(caviar_dir="out_caviar", enron_dir="out_enron")
"""
import csv
import glob
import os
from collections import defaultdict

NODE_FILES = ["nodes_person.csv"]
EDGE_KIND_MAP = {  # source :TYPE -> canonical relationship
    "CONTACTED": "ASSOCIATE_OF",
    "EMAILED": "ASSOCIATE_OF",
    "CALLED": "CALLED",
    "FINANCIAL_TRANSFER": "FINANCIAL_TRANSFER",
    "CO_LOCATED": "CO_LOCATED",
    "ASSOCIATE_OF": "ASSOCIATE_OF",
    "FAMILY_OF": "FAMILY_OF",
    "OWNS_VEHICLE": "OWNS_VEHICLE",
    "REGISTERED_AT": "REGISTERED_AT",
}

SCHEMA_CYPHER = """
CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (l:Location) REQUIRE l.id IS UNIQUE;
"""


def _split_ts(raw):
    if not raw:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(t).strip() for t in raw if str(t).strip()]
    return [t.strip() for t in str(raw).split(";") if t.strip()]


class GraphStore:
    def __init__(self, uri=None, user=None, password=None, fallback=False):
        self.fallback = fallback or not uri
        self.driver = None
        if not self.fallback:
            from neo4j import GraphDatabase
            self.driver = GraphDatabase.driver(uri, auth=(user, password))
        else:
            import networkx as nx
            self.nx = nx
            self.G = nx.MultiDiGraph()

    # ------------------------------------------------------------- schema ---
    def ensure_schema(self):
        if self.fallback:
            return
        with self.driver.session() as s:
            for stmt in [x for x in SCHEMA_CYPHER.split(";") if x.strip()]:
                s.run(stmt)

    # ------------------------------------------------------- loading ------
    @staticmethod
    def _iter_csv(path, limit=None):
        with open(path, newline="", encoding="utf-8") as f:
            for i, row in enumerate(csv.DictReader(f)):
                if limit is not None and i >= limit:
                    break
                yield row

    def load_nodes_file(self, path, limit=None):
        """nodes_person.csv (caviar/out/enron flavours). Returns count."""
        n = 0
        for row in self._iter_csv(path, limit):
            pid = row.get("person_id:ID") or row.get("person_id") \
                or row.get("email") or row.get("account_id:ID")
            if not pid:
                continue
            props = {"id": pid,
                     "label": row.get("person_id", pid),
                     "source": row.get("source", "")}
            if row.get("mailbox_owner"):
                props["mailbox_owner"] = row["mailbox_owner"]
            if row.get("raw_id"):
                props["raw_id"] = row["raw_id"]
            self._merge_node("Person", props)
            n += 1
        return n

    def _merge_node(self, label, props):
        if self.fallback:
            key = (label, props["id"])
            node_props = dict(props)
            node_props.pop("label", None)  # avoid kwarg collision
            if self.G.has_node(key):
                self.G.nodes[key].update(node_props)
            else:
                self.G.add_node(key, node_label=label, **node_props)
            return
        with self.driver.session() as s:
            s.run(f"MERGE (n:{label} {{id: $id}}) SET n += $props",
                  id=props["id"], props=props)

    def clear_all(self):
        """Wipe the whole store (Neo4j: DETACH DELETE; fallback: new graph)."""
        if self.fallback:
            self.G = self.nx.MultiDiGraph()
            return
        with self.driver.session() as s:
            s.run("MATCH (n) DETACH DELETE n")

    def load_edges_file(self, path, limit=None):
        """Any Prompt-1 edges file; aggregates repeats into one edge.

        Handles both header styles: Neo4j-style (:START_ID/:END_ID/:TYPE)
        and plain (person_a/person_b/weight, sender/recipient/frequency).
        """
        agg = defaultdict(lambda: {"freq": 0, "ts": [], "extra": {}})
        for row in self._iter_csv(path, limit):
            raw_kind = (row.get(":TYPE") or row.get("rel") or "").upper()
            if raw_kind:
                kind = EDGE_KIND_MAP.get(raw_kind)
            elif "person_a" in row:
                kind = "ASSOCIATE_OF"  # caviar_edges.csv: weight+phase
            elif "sender" in row:
                kind = "ASSOCIATE_OF"  # enron_edges.csv: sender/recipient
            else:
                continue
            if not kind:
                continue
            src = row.get(":START_ID") or row.get("person_a") \
                or row.get("sender")
            dst = row.get(":END_ID") or row.get("person_b") \
                or row.get("recipient")
            if not src or not dst:
                continue
            if "person_a" in row:  # caviar id prefixing
                src, dst = f"caviar:{src}", f"caviar:{dst}"
            if "sender" in row:  # enron id prefixing
                src, dst = f"email:{src}", f"email:{dst}"
            if not src or not dst:
                continue
            # frequency: explicit freq / weight / 1 per row
            f = row.get("frequency") or row.get("weight") or "1"
            try:
                freq = int(float(f))
            except ValueError:
                freq = 1
            ts = _split_ts(row.get("timestamps"))
            if not ts and row.get("phase_number"):
                ts = [f"phase:{row['phase_number']}"]
            if not ts and row.get("datetime"):
                ts = [row["datetime"]]
            key = (src, dst, kind)
            agg[key]["freq"] += freq
            agg[key]["ts"].extend(ts)
            for col in ("phase_number", "approx_date_range", "amount",
                        "date", "event", "timestamp", "kind",
                        "message_id", "subject", "file"):
                if row.get(col):
                    agg[key]["extra"].setdefault(col, row[col])
            agg[key]["extra"]["kind"] = row.get(":TYPE", kind)
        for (src, dst, kind), a in agg.items():
            self._merge_edge(src, dst, kind, a["freq"],
                             sorted(set(a["ts"])), a["extra"])
        return len(agg)

    def load_relationships(self, rows):
        """Generic loader for real CDR/financial/co-occurrence dicts.

        rows: {"src","dst","rel","frequency"|"amount"|"date"|"event"|
               "timestamp"|"timestamps"|[extra props]}. Same aggregation as
        files, except FINANCIAL_TRANSFER rows also append
        {"amount","date"} to a `transactions` list on the edge so
        split-structuring analysis keeps every individual payment.
        """
        agg = defaultdict(lambda: {"freq": 0, "ts": [], "extra": {},
                                   "txs": []})
        for r in rows:
            kind = EDGE_KIND_MAP.get((r.get("rel") or "").upper())
            if not kind or not r.get("src") or not r.get("dst"):
                continue
            key = (r["src"], r["dst"], kind)
            agg[key]["freq"] += int(r.get("frequency", 1))
            agg[key]["ts"].extend(_split_ts(r.get("timestamps")) or
                                  ([r["timestamp"]] if r.get("timestamp")
                                   else []))
            if kind == "FINANCIAL_TRANSFER" and r.get("amount") is not None:
                agg[key]["txs"].append({"amount": r["amount"],
                                        "date": r.get("date", "")})
                if r.get("date"):
                    agg[key]["ts"].append(r["date"])
            for k, v in r.items():
                if k not in ("src", "dst", "rel", "frequency", "timestamps",
                             "timestamp") and v is not None:
                    agg[key]["extra"].setdefault(k, v)
        for (src, dst, kind), a in agg.items():
            extra = dict(a["extra"])
            if a["txs"]:
                extra["transactions"] = a["txs"]
            self._merge_edge(src, dst, kind, a["freq"],
                             sorted(set(a["ts"])), extra)
        return len(agg)

    def _node_label(self, node_id, rel):
        if rel == "OWNS_VEHICLE":
            return "Vehicle"
        if rel == "REGISTERED_AT":
            return "Location"
        return "Person"

    def _merge_edge(self, src, dst, kind, freq, timestamps, extra):
        if self.fallback:
            skey = ("Person", src)
            dkey = (self._node_label(dst, kind), dst)
            for k in (skey, dkey):
                if not self.G.has_node(k):
                    self.G.add_node(k, node_label=k[0], id=k[1])
            # dedupe: single edge per (src,dst,kind), aggregate
            txs = list(extra.pop("transactions", []))
            existing = self.G.get_edge_data(skey, dkey, default={})
            for d in existing.values():
                if d.get("rel") == kind:
                    d["frequency"] = d.get("frequency", 0) + freq
                    d["timestamps"] = sorted(set(d.get("timestamps", []))
                                             | set(timestamps))
                    if txs:
                        d.setdefault("transactions", []).extend(txs)
                    d.update({k: v for k, v in extra.items()
                              if k not in d})
                    return
            props = {"rel": kind, "frequency": freq,
                     "timestamps": timestamps}
            if txs:
                props["transactions"] = txs
            props.update(extra)
            self.G.add_edge(skey, dkey, **props)
            return
        label_s = "Person"
        label_d = self._node_label(dst, kind)
        with self.driver.session() as s:  # APOC-free aggregation
            rec = s.run(f"""MERGE (a:{label_s} {{id: $src}})
                            MERGE (b:{label_d} {{id: $dst}})
                            WITH a, b
                            OPTIONAL MATCH (a)-[e:{kind}]->(b)
                            RETURN e.frequency AS f,
                                   e.timestamps AS ts,
                                   e.transactions AS txs""",
                        src=src, dst=dst).single()
            txs = list(extra.pop("transactions", []))
            if rec and rec["f"] is not None:
                merged_ts = sorted(set(rec["ts"] or []) | set(timestamps))
                props = dict(extra)
                props["frequency"] = rec["f"] + freq
                props["timestamps"] = merged_ts
                if txs:
                    props["transactions"] = list(rec["txs"] or []) + txs
                s.run(f"""MATCH (a:{label_s} {{id:$src}})-[e:{kind}]->(b:{label_d} {{id:$dst}})
                          SET e += $props""", src=src, dst=dst, props=props)
            else:
                props = dict(extra)
                props["frequency"] = freq
                props["timestamps"] = timestamps
                if txs:
                    props["transactions"] = txs
                s.run(f"""MATCH (a:{label_s} {{id:$src}}),
                                (b:{label_d} {{id:$dst}})
                          CREATE (a)-[e:{kind}]->(b) SET e = $props""",
                      src=src, dst=dst, props=props)

    # Default load sets: pass explicit dirs to avoid double-loading the
    # same network from two outputs (out/edges_contacted.csv duplicates
    # out_caviar/edges_contacted.csv).
    DEFAULT_LOAD = {
        "caviar": {"dirs": ["out_caviar"],
                   "node_files": ["nodes_person.csv"],
                   "edge_files": ["edges_contacted.csv"]},
        "enron": {"dirs": ["out_enron"],
                  "node_files": ["nodes_person.csv"],
                  "edge_files": ["edges_emailed_agg.csv"]},
    }

    def load_prompt1_outputs(self, caviar_dir=None, out_dir=None,
                             enron_dir=None, max_edges_per_file=None,
                             preset=None):
        """Bulk-load Prompt-1 CSVs. Returns stats dict.

        preset="caviar"|"enron" loads the deduped default file set.
        Or pass explicit dirs (out_dir defaults to None = skip, so the
        old double-load can't happen silently).
        """
        if preset in self.DEFAULT_LOAD:
            cfg = self.DEFAULT_LOAD[preset]
            stats = {"nodes": 0, "edges": 0, "files": []}
            for d in cfg["dirs"]:
                if not os.path.isdir(d):
                    continue
                for nf in cfg["node_files"]:
                    p = os.path.join(d, nf)
                    if os.path.exists(p):
                        c = self.load_nodes_file(p)
                        stats["nodes"] += c
                        stats["files"].append((p, f"{c} nodes"))
                for ef in cfg["edge_files"]:
                    p = os.path.join(d, ef)
                    if os.path.exists(p):
                        c = self.load_edges_file(p,
                                                 limit=max_edges_per_file)
                        stats["edges"] += c
                        stats["files"].append((p, f"{c} edges"))
            return stats
        stats = {"nodes": 0, "edges": 0, "files": []}
        for d in [caviar_dir, out_dir, enron_dir]:
            if not d or not os.path.isdir(d):
                continue
            for nf in NODE_FILES:
                p = os.path.join(d, nf)
                if os.path.exists(p):
                    c = self.load_nodes_file(p)
                    stats["nodes"] += c
                    stats["files"].append((p, f"{c} nodes"))
            for p in sorted(glob.glob(os.path.join(d, "edges_*.csv"))
                            + glob.glob(os.path.join(d, "*_edges.csv"))
                            + glob.glob(os.path.join(d, "caviar_edges.csv"))
                            + glob.glob(os.path.join(d, "enron_edges.csv"))):
                c = self.load_edges_file(p, limit=max_edges_per_file)
                stats["edges"] += c
                stats["files"].append((p, f"{c} edges"))
        return stats

    # ------------------------------------------------------------- queries --
    def _fmt_node(self, label, nid, props=None):
        d = {"id": nid, "label": label}
        if props:
            d.update(props)
        return d

    def get_ego_network(self, person_id, depth=1):
        """Nodes/edges within `depth` hops (undirected) of person_id."""
        if self.fallback:
            start = ("Person", person_id)
            if not self.G.has_node(start):
                return {"nodes": [], "edges": []}
            seen, frontier = {start}, {start}
            for _ in range(depth):
                nxt = set()
                for n in frontier:
                    nxt.update(self.G.successors(n))
                    nxt.update(self.G.predecessors(n))
                nxt -= seen
                seen.update(nxt)
                frontier = nxt
            H = self.G.subgraph(seen)
            return {
                "nodes": [self._fmt_node(l, i, {k: v for k, v in d.items()
                                                if k != "node_label"})
                          for (l, i), d in H.nodes(data=True)],
                "edges": [{"src": s[1], "dst": t[1], **d}
                          for s, t, d in H.edges(data=True)]}
        with self.driver.session() as s:  # variable-length BFS, no APOC
            depth = max(0, min(int(depth), 5))
            hop = "MATCH (p:Person {id:$pid}), (q:Person)-[*0.." + \
                str(depth) + "]-(p)"
            recs = s.run(hop + """
                            WITH collect(DISTINCT q) AS qs
                            UNWIND qs AS n
                            OPTIONAL MATCH (n)-[e]-(m)
                              WHERE m IN qs
                            RETURN collect(DISTINCT n) AS nodes,
                                   collect(DISTINCT e) AS rels""",
                         pid=person_id)
            rec = recs.single()
            if not rec:
                return {"nodes": [], "edges": []}
            return {
                "nodes": [{"id": n["id"], "label": list(n.labels)[0],
                           **{k: v for k, v in n.items()}}
                          for n in (rec["nodes"] or []) if n],
                "edges": [{"src": e.start_node["id"],
                           "dst": e.end_node["id"], "rel": e.type,
                           **dict(e.items())}
                          for e in (rec["rels"] or []) if e]}

    def get_shortest_path(self, a, b):
        if self.fallback:
            U = self.G.to_undirected(as_view=True)
            s, t = ("Person", a), ("Person", b)
            try:
                path = self.nx.shortest_path(U, s, t)
            except (self.nx.NetworkXNoPath, self.nx.NodeNotFound):
                return None
            return [n[1] for n in path]
        with self.driver.session() as s:
            rec = s.run("""MATCH (a:Person {id:$a}), (b:Person {id:$b}),
                             p=shortestPath((a)-[*]-(b))
                           RETURN [n IN nodes(p) | n.id] AS path""",
                        a=a, b=b).single()
            return rec["path"] if rec and rec["path"] else None

    def get_all_paths_within_hops(self, a, b, max_hops=3, limit=25):
        if self.fallback:
            U = self.G.to_undirected(as_view=True)
            s, t = ("Person", a), ("Person", b)
            try:
                paths = list(self.nx.all_simple_paths(U, s, t,
                                                      cutoff=max_hops))[:limit * 4]
            except self.nx.NodeNotFound:
                return []
            # dedupe: parallel edges (CALLED vs ASSOCIATE_OF) yield the
            # same node sequence multiple times on a MultiGraph
            seen, out = set(), []
            for p in paths:
                key = tuple(n[1] for n in p)
                if key not in seen:
                    seen.add(key)
                    out.append(list(key))
                if len(out) >= limit:
                    break
            return out
        with self.driver.session() as s:
            hops = max(1, min(int(max_hops), 5))
            q = "MATCH (a:Person {id:$a}), (b:Person {id:$b}), " \
                "p=(a)-[*1.." + str(hops) + "]-(b) " \
                "RETURN [n IN nodes(p) | n.id] AS path LIMIT " + \
                str(max(1, int(limit)))
            seen, out = set(), []
            for r in s.run(q, a=a, b=b):  # dedupe parallel-rel duplicates
                key = tuple(r["path"])
                if key not in seen:
                    seen.add(key)
                    out.append(list(key))
            return out

    def close(self):
        if self.driver:
            self.driver.close()


# ------------------------------------------------------- example queries ---
if __name__ == "__main__":
    g = GraphStore(fallback=True)
    stats = g.load_prompt1_outputs(caviar_dir="out_caviar",
                                   max_edges_per_file=2000)
    print("loaded:", stats["nodes"], "nodes,", stats["edges"], "edges")

    # demo real-dataset style relationships (CDR + financial + co-location)
    g.load_relationships([
        {"src": "caviar:1", "dst": "caviar:4", "rel": "CALLED",
         "frequency": 12, "timestamps": ["1994-03-01", "1994-03-05"]},
        {"src": "caviar:1", "dst": "caviar:4", "rel": "CALLED",
         "frequency": 3, "timestamps": ["1994-03-09"]},  # aggregates -> 15
        {"src": "caviar:1", "dst": "caviar:3", "rel": "FINANCIAL_TRANSFER",
         "amount": 50000, "date": "1994-04-02"},
        {"src": "caviar:4", "dst": "caviar:3", "rel": "CO_LOCATED",
         "event": "warehouse-meet", "timestamp": "1994-04-03"},
        {"src": "caviar:3", "dst": "caviar:5", "rel": "ASSOCIATE_OF"},
        {"src": "caviar:1", "dst": "MH12AB1234", "rel": "OWNS_VEHICLE"},
        {"src": "caviar:4", "dst": "Mumbai", "rel": "REGISTERED_AT"},
    ])

    ego = g.get_ego_network("caviar:1", depth=1)
    print(f"\nego(1,depth=1): {len(ego['nodes'])} nodes, "
          f"{len(ego['edges'])} edges")
    print("shortest 1->5:", g.get_shortest_path("caviar:1", "caviar:5"))
    print("paths<=3 hops 1->5:",
          g.get_all_paths_within_hops("caviar:1", "caviar:5", max_hops=3))
    g.close()
