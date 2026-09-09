"""Isolated browser API; execute the same versioned math used by the Web Worker."""
import json
import os
from pathlib import Path
import subprocess
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/workspace", tags=["Browser workspace"])
slots = threading.BoundedSemaphore(2)
RUNNER = Path(__file__).resolve().parent.parent / "shared" / "runner.mjs"


class Record(BaseModel):
    src: str
    dst: str
    rel: str = "ASSOCIATE_OF"
    frequency: int = Field(default=1, strict=True)
    date: str = ""
    amount: str = ""
    source_rows: list[int] = Field(default_factory=list, max_length=10000)


class Evidence(BaseModel):
    name: str = Field(default="Uploaded evidence", min_length=1, max_length=255)
    records: list[Record] = Field(min_length=1, max_length=10000)


RELATIONSHIP_ALIASES = {
    "PAID": "FINANCIAL_TRANSFER", "PAYMENT": "FINANCIAL_TRANSFER",
    "TRANSFER": "FINANCIAL_TRANSFER", "TRANSFERRED": "FINANCIAL_TRANSFER",
    "CALL": "CALLED", "CALLED_BY": "CALLED", "EMAIL": "EMAILED",
    "E-MAILED": "EMAILED", "COLOCATED": "CO_LOCATED", "CO-LOCATED": "CO_LOCATED",
    "FAMILY": "FAMILY_OF", "OWNS": "OWNS_VEHICLE",
    "KNOWS": "ASSOCIATE_OF", "LEADS": "ASSOCIATE_OF",
}


def run_shared(body):
    if not slots.acquire(blocking=False):
        raise HTTPException(503, "Analysis is busy. Please retry shortly.")
    try:
        try:
            process = subprocess.run(
                [os.getenv("NODE_BINARY", "node"), str(RUNNER)],
                input=json.dumps(body), capture_output=True, text=True, timeout=80,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Analysis timed out. Try a smaller dataset.")
        except OSError:
            raise HTTPException(503, "Shared analysis runtime is unavailable. Install Node.js 22+ or use Docker.")
        try:
            output = json.loads(process.stdout)
        except ValueError:
            raise HTTPException(503, "Shared analysis runtime failed.")
        if "error" in output:
            raise HTTPException(422, output["error"])
        if process.returncode or "result" not in output:
            raise HTTPException(503, "Shared analysis runtime failed.")
        return output["result"]
    finally:
        slots.release()


def build_snapshot(body: Evidence):
    payload = body.model_dump()
    for record in payload["records"]:
        key = str(record["rel"]).strip().upper()
        record["rel"] = RELATIONSHIP_ALIASES.get(key, key)
    return run_shared(payload)


@router.post("/analyze")
def analyze_evidence(body: Evidence):
    return build_snapshot(body)


class Document(BaseModel):
    text: str = Field(min_length=1, max_length=100000)


@router.post("/documents")
def document(body: Document):
    return run_shared({"kind": "document", "text": body.text})
