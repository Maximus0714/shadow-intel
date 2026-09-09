"""
Network analytics: centralities, Louvain communities, influence ranking.

Reads the graph from live Neo4j (via graph_store.GraphStore) or from a
GraphStore in NetworkX-fallback mode, then computes per Person node:
  degree centrality, betweenness centrality, PageRank, Louvain community,
  composite influence score, role (leader | bridge | member).

Usage:
  from backend.analytics import analyze
  from backend.graph_store import GraphStore

  g = GraphStore(fallback=True)
  g.load_prompt1_outputs(caviar_dir="out_caviar")
  ranked = analyze(g, w_degree=0.3, w_between=0.4, w_pagerank=0.3)
  # ranked: [{person_id, name, influence_score, community_id,
  #           role, centrality_breakdown}, ...] sorted by influence desc

  # live Neo4j:
  g = GraphStore(uri="bolt://localhost:7687", user="neo4j", password="...")
  ranked = analyze(g)

Plain-English explainer (for non-technical judges) is in EXPLAINER below
and printed by `python3 analytics.py --explain`.
"""
import argparse
import json

EXPLAINER = """
Betweenness centrality — "the broker test".
  Imagine every pair of people in the network wants to pass a message along
  the shortest chain of contacts. Betweenness counts how many of those
  shortest chains run THROUGH a given person. A high score means that person
  is a bottleneck or broker: remove them and distant parts of the network
  struggle to reach each other. In investigations these are often
  coordinators, couriers, or fixers — not necessarily the boss.

Louvain community detection — "finding the crews".
  The method looks for groups where members talk much more to each other
  than to outsiders, then repeatedly merges small groups when merging
  improves a score called 'modularity' (dense inside, sparse outside).
  Each resulting group is a candidate cell or crew. People with ties into
  several groups are the bridges between crews.
""".strip()


def _nx_person_graph(store):
    """Simple undirected weighted Person-only graph for analytics.

    Parallel edges (CALLED vs ASSOCIATE_OF) collapse by summing frequency;
    missing frequency counts as 1. Vehicle/Location nodes excluded.
    """
    import networkx as nx
    if getattr(store, "fallback", False):
        G = store.G
        H = nx.Graph()
        H.add_nodes_from(pid for (label, pid) in G.nodes if label == "Person")
        for (ls, s), (ld, d), e in G.edges(data=True):
            if ls != "Person" or ld != "Person":
                continue
            w = e.get("frequency", 1) or 1
            if H.has_edge(s, d):
                H[s][d]["weight"] += w
            else:
                H.add_edge(s, d, weight=w)
        return H
    # live Neo4j: pull Person-Person edges
    import networkx as nx
    H = nx.Graph()
    with store.driver.session() as sess:
        recs = sess.run("""MATCH (a:Person)-[e]->(b:Person)
                           RETURN a.id AS s, b.id AS d,
                                  coalesce(e.frequency, 1) AS w""")
        for r in recs:
            w = r["w"] or 1
            if H.has_edge(r["s"], r["d"]):
                H[r["s"]][r["d"]]["weight"] += w
            else:
                H.add_edge(r["s"], r["d"], weight=w)
    return H


def _node_names(store):
    """person_id -> display name (label/raw_id/id fallback)."""
    names = {}
    if getattr(store, "fallback", False):
        for (label, pid), d in store.G.nodes(data=True):
            if label == "Person":
                names[pid] = d.get("label") or d.get("raw_id") or pid
        return names
    with store.driver.session() as sess:
        for r in sess.run("MATCH (p:Person) RETURN p.id AS id, "
                          "p.label AS label, p.raw_id AS raw"):
            names[r["id"]] = r["label"] or r["raw"] or r["id"]
    return names


def analyze(store, w_degree=0.3, w_between=0.4, w_pagerank=0.3,
            resolution=1.0, seed=42, sample_size=None):
    """Full pipeline -> ranked JSON list. Weights need not sum to 1."""
    import networkx as nx
    from community import community_louvain
    H = _nx_person_graph(store)
    names = _node_names(store)
    if len(H) == 0:
        return []

    deg = nx.degree_centrality(H)
    # Frequency represents connection strength, not travel distance.
    for _, _, edge in H.edges(data=True):
        edge["distance"] = 1 / max(1, edge["weight"])
    btw = nx.betweenness_centrality(H, weight="distance", seed=seed,
                                   k=min(sample_size, len(H)) if sample_size else None)
    pr = nx.pagerank(H, weight="weight")
    comm = community_louvain.best_partition(H, weight="weight",
                                            resolution=resolution,
                                            random_state=seed)

    tw = w_degree + w_between + w_pagerank or 1.0
    infl = {n: (w_degree * deg.get(n, 0) + w_between * btw.get(n, 0) +
                w_pagerank * pr.get(n, 0)) / tw for n in H.nodes}

    # community -> leader = highest influence member
    members = {}
    for n, c in comm.items():
        members.setdefault(c, []).append(n)
    leader = {c: max(ms, key=lambda n: infl[n]) for c, ms in members.items()}

    # bridges: nodes with edges into 2+ communities (rank by # external ties)
    bridges = set()
    for n in H.nodes:
        outside = {comm[m] for m in H.neighbors(n)} - {comm[n]}
        if outside:
            bridges.add(n)

    ranked = []
    for n in H.nodes:
        c = comm[n]
        role = "leader" if n == leader[c] else \
               ("bridge" if n in bridges else "member")
        ranked.append({
            "person_id": n,
            "name": names.get(n, n),
            "influence_score": round(infl[n], 4),
            "community_id": int(c),
            "role": role,
            "centrality_breakdown": {
                "degree": round(deg.get(n, 0), 4),
                "betweenness": round(btw.get(n, 0), 4),
                "pagerank": round(pr.get(n, 0), 4),
                "weights": {"degree": w_degree, "betweenness": w_between,
                            "pagerank": w_pagerank},
            },
        })
    ranked.sort(key=lambda r: -r["influence_score"])
    return ranked


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--explain", action="store_true")
    ap.add_argument("--uri", default=None)
    ap.add_argument("--user", default="neo4j")
    ap.add_argument("--password", default=None)
    ap.add_argument("--caviar-dir", default="out_caviar")
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()
    if args.explain:
        print(EXPLAINER)
        raise SystemExit
    from .graph_store import GraphStore
    if args.uri:
        g = GraphStore(uri=args.uri, user=args.user,
                       password=args.password)
    else:
        g = GraphStore(fallback=True)
        g.load_prompt1_outputs(caviar_dir=args.caviar_dir)
    ranked = analyze(g)
    print(f"persons={len(ranked)} "
          f"communities={len({r['community_id'] for r in ranked})}")
    for r in ranked[:args.top]:
        print(json.dumps(r))
    g.close()
