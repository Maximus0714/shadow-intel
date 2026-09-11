"""Isolated browser API; execute the same versioned math used by the Web Worker."""
import json
import os
from pathlib import Path
import subprocess
import threading

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

router = APIRouter(prefix="/workspace", tags=["Browser workspace"])
slots = threading.BoundedSemaphore(2)
intelligence_slots = threading.BoundedSemaphore(2)
RUNNER = Path(__file__).resolve().parent.parent / "shared" / "runner.mjs"


class Record(BaseModel):
    src: str
    dst: str
    rel: str = "ASSOCIATE_OF"
    frequency: int = Field(default=1, strict=True)
    date: str = ""
    amount: str = ""
    source_rows: list[int] = Field(default_factory=list, max_length=10000)
    evidence: str = Field(default="", max_length=5000)
    currency: str = Field(default="", max_length=12)
    src_type: str = Field(default="Person", max_length=30)
    dst_type: str = Field(default="Person", max_length=30)
    attributes: dict[str, str] = Field(default_factory=dict, max_length=30)


class Evidence(BaseModel):
    name: str = Field(default="Uploaded evidence", min_length=1, max_length=255)
    records: list[Record] = Field(min_length=1, max_length=10000)
    source_text: str = Field(default="", max_length=500000)


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
    result = run_shared(payload)
    if body.source_text:
        result["source_document"] = extract_narrative(body.source_text)
    return result


@router.post("/analyze")
def analyze_evidence(body: Evidence):
    return build_snapshot(body)


class ResolutionApproval(BaseModel):
    candidate_id: str = Field(min_length=16, max_length=16)
    keep: str = Field(min_length=1, max_length=255)


class ResolutionRequest(BaseModel):
    evidence: Evidence
    approvals: list[ResolutionApproval] = Field(default_factory=list, max_length=5000)


@router.post("/resolution/candidates")
def entity_resolution_candidates(body: Evidence):
    from .entity_resolution import resolution_candidates
    return resolution_candidates([record.model_dump() for record in body.records])


@router.post("/resolution/apply")
def apply_entity_resolution(body: ResolutionRequest):
    from .entity_resolution import apply_reviewed_resolution
    records = [record.model_dump() for record in body.evidence.records]
    approvals = [approval.model_dump() for approval in body.approvals]
    return apply_reviewed_resolution(records, approvals)


@router.post("/intelligence")
def intelligence(body: Evidence):
    from .intelligence import make_brief
    if not intelligence_slots.acquire(blocking=False):
        raise HTTPException(503, "AI analysis is busy. Please retry shortly.")
    try:
        return make_brief(build_snapshot(body))
    finally:
        intelligence_slots.release()


class AssistantRequest(BaseModel):
    evidence: Evidence
    question: str = Field(min_length=2, max_length=1000)


@router.post("/assistant")
def investigation_assistant(body: AssistantRequest):
    from .assistant import answer_question
    try:
        return answer_question(
            [record.model_dump() for record in body.evidence.records],
            body.question,
        )
    except ValueError as error:
        raise HTTPException(422, str(error))


@router.post("/timeline")
def investigation_timeline(body: Evidence):
    from .timeline import build_timeline
    return build_timeline([record.model_dump() for record in body.records])


from .evidence_proof import Receipt, anchor, lookup, verify


class ProofRequest(BaseModel):
    evidence: Evidence
    receipt: Receipt
    simulate_tamper: bool = False


class ProofLookupRequest(BaseModel):
    key: str = Field(min_length=1, max_length=100)


@router.post("/proof/anchor")
def anchor_evidence(body: Evidence):
    return anchor(body.model_dump())


@router.post("/proof/verify")
def verify_evidence(body: ProofRequest):
    evidence = body.evidence.model_dump()
    if body.simulate_tamper:
        evidence["records"][0]["frequency"] += 1
    return {**verify(evidence, body.receipt), "simulated": body.simulate_tamper}


@router.post("/proof/lookup")
def lookup_evidence_proof(body: ProofLookupRequest):
    return lookup(body.key)


class Document(BaseModel):
    text: str = Field(min_length=1, max_length=500000)


@router.post("/documents")
def document(body: Document):
    try:
        result = extract_narrative(body.text)
    except ValueError as error:
        raise HTTPException(422, str(error))
    return {**result, "doc_id": "narrative", "summary": body.text[:1500],
            "triples": [{"subject": r["src"], "object": r["dst"], "relation": r["rel"], "evidence": r["evidence"]} for r in result["records"]],
            "classification": {"method": "English explicit-relationship rules; original text retained"}}


from .narrative import extract_narrative
from .ingest_preview import parse_upload_file, detect_column_mapping


@router.post("/narrative")
def narrative(body: Document):
    try:
        return extract_narrative(body.text)
    except ValueError as error:
        raise HTTPException(422, str(error))


@router.post("/file")
def evidence_file(file: UploadFile = File(...), kind: str = Form("data"), sheet: str = Form("")):
    content = file.file.read(20_000_001)
    if len(content) > 20_000_000:
        raise HTTPException(413, "File exceeds 20 MB.")
    try:
        if kind == "text":
            from .document_extract import extract_uploaded_narrative
            return extract_uploaded_narrative(file.filename or "Uploaded evidence", content)
        rows, meta = parse_upload_file(file.filename, content, sheet or None)
        if len(rows) > 10000:
            raise ValueError("Use at most 10,000 relationship rows per investigation.")
        columns = list(rows[0]) if rows else []
        return {"rows": rows, "columns": columns, "mapping": detect_column_mapping(columns), **meta}
    except (ValueError, UnicodeError) as error:
        raise HTTPException(422, str(error))


class TablePreview(BaseModel):
    rows: list[dict] = Field(max_length=10000)
    mapping: dict[str, str | None]


@router.post("/preview")
def preview_table(body: TablePreview):
    from .ingest_preview import RELATIONSHIP_ALIASES
    cleaned, skipped = [], []
    for i, row in enumerate(body.rows, 2):
        def value(role, default=""):
            v = row.get(body.mapping.get(role))
            return str(v).strip() if v is not None else default
        src, dst = value("source"), value("target")
        if not src or not dst:
            skipped.append({"row": i, "reason": "Missing source or target"})
            continue
        rel = value("rel", "ASSOCIATE_OF").upper() or "ASSOCIATE_OF"
        rel = RELATIONSHIP_ALIASES.get(rel, rel)
        if rel not in {"CALLED", "EMAILED", "CONTACTED", "ASSOCIATE_OF", "FINANCIAL_TRANSFER", "FAMILY_OF", "CO_LOCATED", "OWNS_VEHICLE", "REGISTERED_AT", "USED_VEHICLE", "HAS_PHONE", "HAS_ACCOUNT", "VISITED", "WORKS_FOR", "ARGUED_WITH", "THREATENED"}:
            skipped.append({"row": i, "reason": f"Unsupported relationship: {rel}"})
            continue
        try:
            frequency = int(value("weight", "1") or "1")
            if not 1 <= frequency <= 1000000:
                raise ValueError()
        except ValueError:
            skipped.append({"row": i, "reason": "Frequency must be an integer from 1 to 1,000,000"})
            continue
        cleaned.append({"src": src, "dst": dst, "rel": rel, "frequency": frequency,
                        "date": value("date"), "amount": value("amount"), "currency": value("currency"),
                        "source_rows": [i], "attributes": {str(k)[:100]: str(v)[:1000] for k, v in list(row.items())[:30] if v is not None}})
    return {"cleaned": cleaned, "skipped": skipped}


class GraphQuery(BaseModel):
    nodes: list[str] = Field(max_length=2000)
    edges: list[Record] = Field(max_length=10000)
    start: str
    end: str = ""
    hops: int = Field(default=3, ge=1, le=5)


@router.post("/paths")
def trace_paths(body: GraphQuery):
    adj = {node: set() for node in body.nodes}
    if body.start not in adj or body.end not in adj:
        raise HTTPException(422, "Choose endpoints visible under the current filters.")
    for edge in body.edges:
        if edge.src in adj and edge.dst in adj:
            adj[edge.src].add(edge.dst)
            adj[edge.dst].add(edge.src)
    paths, stack, visits = [], [[body.start]], 0
    while stack and len(paths) < 10 and visits < 50000:
        path = stack.pop(); visits += 1
        if path[-1] == body.end:
            paths.append(path)
        elif len(path) <= body.hops:
            stack.extend(path + [n] for n in sorted(adj[path[-1]], reverse=True) if n not in path)
    return {"paths": paths, "count": len(paths), "truncated": bool(stack), "source": body.start, "target": body.end}


@router.post("/ego")
def neighbourhood(body: GraphQuery):
    ids = {body.start}
    for _ in range(body.hops):
        ids |= {n for e in body.edges if e.src in ids or e.dst in ids for n in (e.src, e.dst)}
    return {"ids": sorted(ids)}
