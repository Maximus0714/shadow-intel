from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from backend.api import app
from backend.workspace import slots
from backend.analytics import analyze
from backend.graph_store import GraphStore


def payload(prefix=""):
    return {"name": "test.csv", "records": [
        {"src": prefix + "A", "dst": prefix + "B", "rel": "FINANCIAL_TRANSFER", "amount": "100", "source_rows": [2]},
        {"src": prefix + "B", "dst": prefix + "C", "rel": "FINANCIAL_TRANSFER"},
        {"src": prefix + "C", "dst": prefix + "A", "rel": "FINANCIAL_TRANSFER"},
        {"src": prefix + "C", "dst": prefix + "Place", "rel": "REGISTERED_AT"},
    ]}


def test_isolated_backend_analysis_and_provenance():
    with TestClient(app) as client:
        before = client.get("/stats", headers={"X-API-Key": "dev-key-change-me"}).json()
        with ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda p: client.post("/workspace/analyze", json=payload(p)), ["one", "two"]))
        for prefix, response in zip(["one", "two"], responses):
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["engine"] == "backend"
            assert data["graph"]["total_nodes"] == 4
            assert all(n["id"].startswith(prefix) for n in data["graph"]["nodes"])
            assert len(data["players"]) == 3
            assert data["communities"]
            assert data["details"][prefix + "A"]["properties"]["records"][0]["amount"] == "100"
            assert data["details"][prefix + "A"]["properties"]["records"][0]["source_rows"] == [2]
            assert any(a["pattern_type"] == "Circular transfer links" for a in data["alerts"])
        assert client.get("/stats", headers={"X-API-Key": "dev-key-change-me"}).json() == before
        assert client.get("/graph/full").status_code == 401


def test_workspace_validation_and_capacity():
    with TestClient(app) as client:
        for records in [[], [{"src": "", "dst": "A"}], [{"src": "A", "dst": "B", "rel": "TYPO"}],
                        [{"src": "A", "dst": "B", "frequency": 0}]]:
            assert client.post("/workspace/analyze", json={"records": records}).status_code == 422
        assert client.post("/workspace/analyze", content=b" " * 25_000_001).status_code == 413
        slots.acquire()
        slots.acquire()
        try:
            assert client.post("/workspace/analyze", json=payload()).status_code == 503
        finally:
            slots.release()
            slots.release()


def test_assets_only_and_document_extraction():
    with TestClient(app) as client:
        result = client.post("/workspace/analyze", json={"records": [{"src": "A", "dst": "V", "rel": "OWNS_VEHICLE"}]} )
        assert result.status_code == 200, result.text
        assert result.json()["players"][0]["person_id"] == "A"
        result = client.post("/workspace/documents", json={"text": "Asha Rao called Kabir Shah. Vehicle MH12AB1234."})
        assert result.status_code == 200
        assert result.json()["triples"][0]["subject"] == "Asha Rao"
        assert {"text": "MH12AB1234", "type": "Vehicle"} in result.json()["entities"]


def test_relationship_aliases_are_canonicalized():
    with TestClient(app) as client:
        result = client.post("/workspace/analyze", json={
            "name": "aliases.csv",
            "records": [{"src": "A", "dst": "B", "rel": "paid", "amount": "10"}],
        })
        assert result.status_code == 200, result.text
        assert result.json()["records"][0]["rel"] == "FINANCIAL_TRANSFER"


def test_frequency_is_strength_not_path_distance():
    graph = GraphStore(fallback=True)
    graph.load_relationships([
        {"src": "A", "dst": "B", "rel": "CALLED", "frequency": 100},
        {"src": "B", "dst": "C", "rel": "CALLED", "frequency": 100},
        {"src": "A", "dst": "C", "rel": "CALLED", "frequency": 1},
    ])
    scores = {p["person_id"]: p["centrality_breakdown"]["betweenness"] for p in analyze(graph)}
    assert scores["B"] > scores["A"]
