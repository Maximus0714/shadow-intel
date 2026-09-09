"""Independent mathematical oracles, not just two consumers of identical code."""
import random
import networkx as nx
import pytest
from backend.workspace import Evidence, build_snapshot


def snapshot(edges):
    return build_snapshot(Evidence(name="fixture.csv", records=edges))


@pytest.mark.parametrize("seed", range(6))
def test_exact_metrics_match_networkx(seed):
    rng = random.Random(seed)
    graph = nx.Graph()
    graph.add_nodes_from(f"P{i:02}" for i in range(24))
    rows = [{"src": i, "dst": i, "rel": "CALLED"} for i in graph]
    people = list(graph)
    for i, a in enumerate(people):
        for b in people[i + 1:]:
            if rng.random() < .13:
                weight = rng.choice([1, 2, 3, 5, 10, 100])
                # Common scale preserves inverse-frequency distances exactly,
                # avoiding the oracle's floating-point shortest-path tie issue.
                graph.add_edge(a, b, weight=weight, distance=300 // weight)
                rows.append({"src": a, "dst": b, "rel": "CALLED", "frequency": weight})
    result = snapshot(rows)
    degree = nx.degree_centrality(graph)
    between = nx.betweenness_centrality(graph, weight="distance")
    rank = nx.pagerank(graph, weight="weight", alpha=.85, tol=1e-14, max_iter=1000)
    for player in result["players"]:
        i = player["person_id"]
        values = player["centrality_breakdown"]
        assert values["degree"] == pytest.approx(degree[i], abs=1e-9)
        assert values["betweenness"] == pytest.approx(between[i], abs=1e-9)
        assert values["pagerank"] == pytest.approx(rank[i], abs=1e-9)
        assert player["influence_score"] == pytest.approx(.3 * degree[i] + .4 * between[i] + .3 * rank[i], abs=1e-9)


def test_weighted_diamond_ties_and_assets():
    rows = [{"src": a, "dst": b, "rel": "CALLED"} for a, b in [("A", "B"), ("A", "C"), ("B", "D"), ("C", "D")]]
    base = snapshot(rows)
    extended = snapshot(rows + [{"src": "A", "dst": "Car", "rel": "OWNS_VEHICLE"}, {"src": "B", "dst": "Place", "rel": "REGISTERED_AT"}])
    assert extended["players"] == base["players"]
    assert all(p["centrality_breakdown"]["betweenness"] == pytest.approx(1 / 6) for p in base["players"])
    assert next(n for n in extended["graph"]["nodes"] if n["id"] == "Car")["influence_score"] is None


def test_louvain_partition_modularity_and_input_order_invariance():
    rows = [{"src": a, "dst": b, "rel": "CALLED", "frequency": 10}
            for a, b in [("A", "B"), ("B", "C"), ("A", "C"), ("D", "E"), ("E", "F"), ("D", "F")]]
    rows.append({"src": "C", "dst": "D", "rel": "CALLED"})
    first, reversed_result = snapshot(rows), snapshot(list(reversed(rows)))
    for key in ["players", "communities", "graph", "details", "alerts", "notes", "records", "analysis_version"]:
        assert first[key] == reversed_result[key]
    partition = [{m["person_id"] for m in c["members"]} for c in first["communities"]]
    assert partition == [{"A", "B", "C"}, {"D", "E", "F"}]
    graph = nx.Graph()
    for r in rows:
        graph.add_edge(r["src"], r["dst"], weight=r.get("frequency", 1))
    assert nx.community.modularity(graph, partition, weight="weight") > .48


def test_opposite_direction_cycles_are_not_collapsed():
    rows = [{"src": a, "dst": b, "rel": "FINANCIAL_TRANSFER"}
            for a, b in [("A", "B"), ("B", "C"), ("C", "A"), ("A", "C"), ("C", "B"), ("B", "A")]]
    flags = snapshot(rows)["alerts"]
    assert len([f for f in flags if f["pattern_type"] == "Circular transfer links"]) == 2


def test_timeline_and_temporal_patterns_are_explainable():
    rows = [
        {"src": "A", "dst": "B", "rel": "FINANCIAL_TRANSFER", "date": "2026-09-01", "frequency": 3},
        {"src": "B", "dst": "C", "rel": "FINANCIAL_TRANSFER", "date": "2026-09-02"},
        {"src": "A", "dst": "D", "rel": "CALLED", "date": "2026-09-01", "frequency": 3},
    ]
    result = snapshot(rows)
    assert [event["date"][:10] for event in result["timeline"]] == ["2026-09-01", "2026-09-01", "2026-09-02"]
    kinds = {flag["pattern_type"] for flag in result["alerts"]}
    assert "Activity burst" in kinds
    assert "Rapid transfer chain" in kinds
