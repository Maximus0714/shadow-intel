import copy
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend.api import app
from backend import evidence_proof as proof
from backend.intelligence import make_brief
from backend.workspace import Evidence


def evidence():
    return Evidence(name="Fictional test", records=[{"src": "Ada", "dst": "Ben", "frequency": 2}], source_text="Ada called Ben.").model_dump()


def test_fingerprint_binds_all_evidence_and_salt_but_not_key_order():
    original = evidence()
    salt = "ab" * 32
    digest = proof.fingerprint(original, salt)
    assert proof.fingerprint(dict(reversed(list(original.items()))), salt) == digest
    for field in ["name", "source_text"]:
        changed = copy.deepcopy(original)
        changed[field] += " altered"
        assert proof.fingerprint(changed, salt) != digest
    for field, value in [("frequency", 3), ("amount", "500"), ("dst", "Cara"), ("evidence", "Changed quotation")]:
        changed = copy.deepcopy(original)
        changed["records"][0][field] = value
        assert proof.fingerprint(changed, salt) != digest
    assert proof.fingerprint(original, "cd" * 32) != digest


def test_real_receipt_checks_not_just_a_matching_local_hash(monkeypatch):
    original = evidence()
    tx_hash, block_hash = "0x" + "a" * 64, "0x" + "b" * 64
    captured = {}
    def rpc(method, params):
        if method == "eth_chainId": return "0x539"
        if method == "eth_accounts": return ["0x" + "c" * 40]
        if method == "eth_sendTransaction":
            captured.update(params[0])
            return tx_hash
        if method == "eth_getTransactionReceipt": return {"status": "0x1", "blockHash": block_hash, "blockNumber": "0x1"}
        if method == "eth_getTransactionByHash": return {"input": captured["data"], "blockHash": block_hash}
        if method == "eth_getBlockByNumber": return {"hash": block_hash, "transactions": [tx_hash]}
        raise AssertionError(method)
    monkeypatch.setattr(proof, "rpc", rpc)
    receipt = proof.Receipt(**proof.anchor(original))
    assert bytes.fromhex(captured["data"][2:]) == proof.VERSION.encode() + bytes.fromhex(receipt.digest)
    found = proof.lookup(tx_hash)
    assert found["status"] == "found" and found["digest"] == receipt.digest
    assert proof.verify(original, receipt)["status"] == "verified"
    changed = copy.deepcopy(original)
    changed["records"][0]["frequency"] = 99
    assert proof.verify(changed, receipt)["status"] == "mismatch"
    receipt.block_hash = "0x" + "d" * 64
    assert proof.verify(original, receipt)["status"] == "mismatch"
    receipt.block_hash = block_hash
    captured["data"] = "0x1234"
    assert proof.verify(original, receipt)["status"] == "mismatch"
    monkeypatch.setattr(proof, "rpc", lambda method, params: "0x539" if method == "eth_chainId" else None)
    assert proof.verify(original, receipt)["status"] == "unavailable"


def test_no_chain_or_wrong_chain_fails_honestly(monkeypatch):
    monkeypatch.delenv("EVIDENCE_RPC_URL", raising=False)
    with pytest.raises(HTTPException) as exc: proof.anchor(evidence())
    assert exc.value.status_code == 503
    monkeypatch.setattr(proof, "rpc", lambda *_: "0x1")
    with pytest.raises(HTTPException): proof.anchor(evidence())


def test_model_is_reproducible_and_does_not_invent_evidence():
    people = [{"person_id": f"P{i}", "name": f"Person {i}"} for i in range(12)]
    rows = [{"src": f"P{i}", "dst": f"P{(i+1)%12}", "rel": "CALLED", "frequency": 1} for i in range(12)]
    rows += [{"src": "P0", "dst": f"P{i}", "rel": "FINANCIAL_TRANSFER", "frequency": 100, "amount": "20"} for i in range(2, 12)]
    snapshot = {"players": people, "records": rows}
    brief = make_brief(snapshot)
    assert brief == make_brief(snapshot)
    assert brief["status"] == "ready"
    assert brief["findings"][0]["entity_id"] == "P0"
    for finding in brief["findings"]:
        assert 0 <= finding["relative_percentile"] <= 100
        for item in finding["evidence"]:
            row = rows[item["record"] - 1]
            assert item["src"] == row["src"] and item["dst"] == row["dst"]
    assert make_brief({"players": people[:2], "records": rows[:1]})["status"] == "insufficient_data"
    uniform = {"players": people, "records": rows[:12]}
    assert make_brief(uniform)["findings"] == []


def test_routes_validate_and_keep_tamper_demo_temporary(monkeypatch):
    seen = []
    monkeypatch.setattr("backend.workspace.verify", lambda ev, rc: seen.append(ev) or {"status": "mismatch"})
    receipt = dict(version=proof.VERSION, salt="a" * 64, digest="b" * 64,
                   transaction_hash="0x" + "c" * 64, block_hash="0x" + "d" * 64, block_number=1, chain_id=1337)
    body = {"evidence": evidence(), "receipt": receipt, "simulate_tamper": True}
    with TestClient(app) as client:
        result = client.post("/workspace/proof/verify", json=body)
        assert result.status_code == 200, result.text
        assert result.json()["simulated"] is True
        assert seen[0]["records"][0]["frequency"] == 3
        assert body["evidence"]["records"][0]["frequency"] == 2
        body["receipt"]["transaction_hash"] = "invalid"
        assert client.post("/workspace/proof/verify", json=body).status_code == 422
        result = client.post("/workspace/intelligence", json=evidence())
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "insufficient_data"


def test_proof_lookup_route_validates_case_key(monkeypatch):
    monkeypatch.setattr("backend.workspace.lookup", lambda key: {"status": "found", "transaction_hash": key})
    with TestClient(app) as client:
        key = "0x" + "a" * 64
        response = client.post("/workspace/proof/lookup", json={"key": key})
        assert response.status_code == 200 and response.json()["transaction_hash"] == key
        assert client.post("/workspace/proof/lookup", json={"key": ""}).status_code == 422
