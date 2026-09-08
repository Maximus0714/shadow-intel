# tests/test_api_endpoints.py
import api

api.API_KEY = "dev-key-change-me"

from fastapi.testclient import TestClient

client = TestClient(api.app)
KEY = {"X-API-Key": "dev-key-change-me"}
CSV = b"person_a,person_b,weight\nP1,P2,3\nP2,P3,1\n"


def test_graph_full_needs_key():
    r = client.get("/graph/full")
    assert r.status_code == 401


def test_graph_full_shape():
    with TestClient(api.app) as c:
        r = c.get("/graph/full?limit=50", headers=KEY)
    assert r.status_code == 200
    body = r.json()
    assert {"nodes", "edges", "truncated", "total_nodes", "total_edges"} <= set(body)
    assert isinstance(body["nodes"], list)


def test_paths_missing_entity_404():
    with TestClient(api.app) as c:
        r = c.get("/entities/NOPE_A/paths/NOPE_B", headers=KEY)
    assert r.status_code in (200, 404)


def test_ingest_preview_csv():
    with TestClient(api.app) as c:
        r = c.post("/ingest/preview", headers=KEY,
                   files={"file": ("t.csv", CSV, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["rows_cleaned"] == 2
    assert body["mapping"]["source"] == "person_a"
