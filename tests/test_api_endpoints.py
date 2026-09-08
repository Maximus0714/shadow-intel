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


def test_upload_override_and_invalid_mapping():
    import json
    payload = b"left,right,frequency\na,b,2\n"
    with TestClient(api.app) as c:
        r = c.post("/ingest/preview", headers=KEY,
                   data={"mapping": json.dumps({"source": "left", "target": "right"})},
                   files={"file": ("data.csv", payload, "text/csv")})
        assert r.status_code == 200, r.text
        assert r.json()["preview"][0]["src"] == "a"
        r = c.post("/ingest/preview", headers=KEY,
                   data={"mapping": '{"source":"missing"}'},
                   files={"file": ("data.csv", payload, "text/csv")})
        assert r.status_code == 400


def test_ingest_keeps_financial_evidence_and_person_node():
    from graph_store import GraphStore
    from unittest.mock import patch
    store = GraphStore(fallback=True)
    payload = b"src,dst,rel,amount,date\nP1,P2,FINANCIAL_TRANSFER,900,2026-09-08\nP1,P2,FINANCIAL_TRANSFER,900,2026-09-08\nP1,V1,OWNS_VEHICLE,,\n"
    with TestClient(api.app) as c, patch.object(api, "_require_store", return_value=store):
        r = c.post("/ingest/load", headers=KEY,
                   files={"file": ("data.csv", payload, "text/csv")})
        assert r.status_code == 200, r.text
    assert ("Person", "P1") in store.G
    assert ("Vehicle", "P1") not in store.G
    assert ("Vehicle", "V1") in store.G
    financial = [data for _, _, data in store.G.edges(data=True) if data.get("transactions")]
    assert len(financial[0]["transactions"]) == 2
    assert financial[0]["transactions"][0]["amount"] == "900"
    assert financial[0]["timestamps"] == ["2026-09-08"]


def test_unknown_relationship_is_not_silently_loaded():
    with TestClient(api.app) as c:
        r = c.post("/ingest/preview", headers=KEY,
                   files={"file": ("data.csv", b"src,dst,rel\na,b,TYPO\n", "text/csv")})
    assert r.status_code == 400
    assert "Unsupported relationship types" in r.json()["detail"]
