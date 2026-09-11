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
    rows = [{"src": a, "dst": b, "rel": "FINANCIAL_TRANSFER",
             "date": f"2026-09-0{i + 1}", "amount": "100", "currency": "INR"}
            for i, (a, b) in enumerate([("A", "B"), ("B", "C"), ("C", "A"), ("A", "C"), ("C", "B"), ("B", "A")])]
    flags = snapshot(rows)["alerts"]
    assert len([f for f in flags if f["pattern_type"] == "Time-linked transfer cycle"]) == 2


def test_alerts_do_not_pair_unrelated_relationship_types_as_reciprocal():
    flags = snapshot([
        {"src": "A", "dst": "B", "rel": "CALLED", "frequency": 4},
        {"src": "B", "dst": "A", "rel": "FINANCIAL_TRANSFER", "frequency": 4},
    ])["alerts"]
    assert not any(flag["pattern_type"] in {"Two-way communication", "Two-way fund movement"}
                   for flag in flags)


def test_incident_patterns_require_concrete_supporting_signals():
    rows = [
        {"src": "A", "dst": "Phone-1", "rel": "HAS_PHONE"},
        {"src": "B", "dst": "Phone-1", "rel": "HAS_PHONE"},
        {"src": "C", "dst": "D", "rel": "THREATENED", "evidence": "C threatened D."},
        {"src": "E", "dst": "Address-1", "rel": "REGISTERED_AT"},
        {"src": "F", "dst": "Address-1", "rel": "REGISTERED_AT"},
        {"src": "A", "dst": "C", "rel": "CALLED", "frequency": 1},
        {"src": "B", "dst": "D", "rel": "CALLED", "frequency": 1},
        {"src": "A", "dst": "D", "rel": "CALLED", "frequency": 9},
    ]
    flags = snapshot(rows)["alerts"]
    types = {flag["pattern_type"] for flag in flags}
    assert {"Shared phone", "Reported threat", "High-volume contact"} <= types
    assert "Address concentration" not in types
    high_volume = next(flag for flag in flags if flag["pattern_type"] == "High-volume contact")
    assert high_volume["evidence"]["case_median"] == 1
    assert high_volume["evidence"]["review_threshold"] == 6


def test_repeated_similar_payments_require_amount_currency_and_time_window():
    supported = [{"src": "A", "dst": "B", "rel": "FINANCIAL_TRANSFER",
                  "amount": str(amount), "currency": "INR", "date": f"2026-09-{day:02d}"}
                 for amount, day in [(1000, 1), (1050, 4), (990, 9)]]
    assert any(flag["pattern_type"] == "Repeated similar-value payments"
               for flag in snapshot(supported)["alerts"])
    outside_window = [{**row, "date": date} for row, date in zip(
        supported, ["2026-01-01", "2026-03-01", "2026-05-01"])]
    assert not any(flag["pattern_type"] == "Repeated similar-value payments"
                   for flag in snapshot(outside_window)["alerts"])
