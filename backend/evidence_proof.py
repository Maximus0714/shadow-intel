"""Salted evidence commitments on an internal Ethereum development chain."""
import hashlib
import json
import os
import re
import secrets
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import URLError
from fastapi import HTTPException
from pydantic import BaseModel, Field

VERSION = "x-tracer-evidence-v1"
PREFIX = VERSION.encode().hex()
chain_lock = threading.Lock()


class Receipt(BaseModel):
    version: str = Field(pattern=r"^x-tracer-evidence-v1$")
    salt: str = Field(pattern=r"^[0-9a-f]{64}$")
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    transaction_hash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    block_hash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    block_number: int = Field(ge=0)
    chain_id: int = Field(ge=1)


def fingerprint(evidence, salt):
    # List order and source text are significant; object key order is not.
    payload = {"version": VERSION, "salt": salt, "evidence": evidence}
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def rpc(method, params):
    url = os.getenv("EVIDENCE_RPC_URL", "")
    if not url:
        raise HTTPException(503, "Evidence blockchain is not configured. Start the Docker chain service.")
    request = Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                      headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=8) as response:
            result = json.load(response)
        if result.get("error") or "result" not in result:
            raise ValueError("RPC error")
        return result["result"]
    except (URLError, OSError, ValueError):
        raise HTTPException(503, "Evidence blockchain is unavailable. Check the chain container and retry.")


def chain_id():
    value = int(rpc("eth_chainId", []), 16)
    if value != 1337:
        raise HTTPException(503, "This demo supports only local chain 1337. Public-chain signing is not configured.")
    return value


def anchor(evidence):
    chain = chain_id()
    salt = secrets.token_hex(32)
    digest = fingerprint(evidence, salt)
    accounts = rpc("eth_accounts", [])
    if not accounts:
        raise HTTPException(503, "Local blockchain has no development signer.")
    # Only a domain marker and salted hash leave the API. No evidence or identity on chain.
    with chain_lock:
        tx_hash = rpc("eth_sendTransaction", [{"from": accounts[0], "to": accounts[0],
                       "value": "0x0", "gas": "0x186a0", "data": "0x" + PREFIX + digest}])
    for _ in range(40):
        mined = rpc("eth_getTransactionReceipt", [tx_hash])
        if mined:
            if int(mined["status"], 16) != 1:
                raise HTTPException(503, "Evidence transaction failed. No successful proof was created.")
            return Receipt(version=VERSION, salt=salt, digest=digest, transaction_hash=tx_hash,
                           block_hash=mined["blockHash"], block_number=int(mined["blockNumber"], 16), chain_id=chain).model_dump()
        time.sleep(0.15)
    raise HTTPException(504, "Evidence transaction is still pending; retry once the local chain is healthy.")


def verify(evidence, receipt):
    current = fingerprint(evidence, receipt.salt)
    chain = chain_id()
    tx = rpc("eth_getTransactionByHash", [receipt.transaction_hash])
    mined = rpc("eth_getTransactionReceipt", [receipt.transaction_hash])
    if not tx or not mined:
        return {"status": "unavailable", "digest": current, "message": "Transaction not found on this chain. It may have been reset; integrity cannot be confirmed."}
    block = rpc("eth_getBlockByNumber", [hex(receipt.block_number), False])
    valid = (chain == receipt.chain_id and current == receipt.digest
             and tx.get("input", "").lower() == "0x" + PREFIX + current
             and int(mined.get("status", "0x0"), 16) == 1
             and mined.get("blockHash") == receipt.block_hash
             and tx.get("blockHash") == receipt.block_hash
             and int(mined["blockNumber"], 16) == receipt.block_number
             and bool(block) and block["hash"] == receipt.block_hash
             and receipt.transaction_hash.lower() in [h.lower() for h in block["transactions"]])
    return {"status": "verified" if valid else "mismatch", "digest": current,
            "message": "Evidence matches its mined blockchain fingerprint." if valid else "Evidence or receipt differs from the blockchain record. Do not treat this copy as verified."}


def _anchored_digest(transaction):
    value = str((transaction or {}).get("input", "")).lower()
    expected = "0x" + PREFIX
    digest = value[len(expected):] if value.startswith(expected) else ""
    return digest if re.fullmatch(r"[0-9a-f]{64}", digest) else ""


def lookup(key):
    """Find an X-Tracer anchor by transaction hash or evidence digest.

    The chain contains only a fingerprint, so this deliberately returns receipt
    metadata and never attempts to reconstruct private case evidence.
    """
    value = str(key or "").strip().lower()
    chain = chain_id()
    transaction = None
    if re.fullmatch(r"0x[0-9a-f]{64}", value):
        transaction = rpc("eth_getTransactionByHash", [value])
    elif re.fullmatch(r"[0-9a-f]{64}", value):
        latest = int(rpc("eth_blockNumber", []), 16)
        # A bounded reverse scan is suitable for the local prototype and avoids
        # making an unbounded RPC request when a malformed or unknown key is used.
        for number in range(latest, max(-1, latest - 500), -1):
            block = rpc("eth_getBlockByNumber", [hex(number), True])
            for candidate in (block or {}).get("transactions", []):
                if isinstance(candidate, dict) and _anchored_digest(candidate) == value:
                    transaction = candidate
                    break
            if transaction:
                break
    else:
        raise HTTPException(422, "Enter a 64-character evidence fingerprint or a 0x-prefixed transaction hash.")
    digest = _anchored_digest(transaction)
    if not transaction or not digest:
        return {"status": "not_found", "message": "No X-Tracer evidence seal matches this key on the current blockchain."}
    tx_hash = transaction.get("hash") or value
    mined = rpc("eth_getTransactionReceipt", [tx_hash])
    if not mined:
        return {"status": "unavailable", "message": "The matching transaction exists but has not produced a receipt."}
    block_number = int(mined["blockNumber"], 16)
    block = rpc("eth_getBlockByNumber", [hex(block_number), False])
    valid = (int(mined.get("status", "0x0"), 16) == 1 and block
             and block.get("hash") == mined.get("blockHash")
             and str(tx_hash).lower() in [str(item).lower() for item in block.get("transactions", [])])
    if not valid:
        return {"status": "unavailable", "message": "A matching transaction was found, but its mined receipt could not be validated."}
    return {"status": "found", "message": "Evidence seal found on the blockchain.",
            "digest": digest, "transaction_hash": tx_hash,
            "block_hash": mined["blockHash"], "block_number": block_number,
            "chain_id": chain}
