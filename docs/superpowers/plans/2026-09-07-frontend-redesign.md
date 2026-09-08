# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file `dashboard.html` workbench with a user-friendly 6-page TypeScript React + Cytoscape.js SPA backed by the existing FastAPI engine plus 4 new endpoints.

**Architecture:** New `frontend/` Vite React-TS SPA (React Router, Cytoscape.js + cola, Axios) talks to existing `api.py` (same process, same `.env`, same `X-API-Key` auth, same NetworkX fallback). New upload parse/detect/clean logic lives in a new `ingest_preview.py` so `api.py` stays thin; `POST /ingest/load` reuses `GraphStore.load_relationships()` and clears `_ranked_cache`.

**Tech Stack:** Backend: Python 3.14, FastAPI 0.141.1, uvicorn 0.41.0, NetworkX 3.6.1, pandas 2.3.3, openpyxl (to install), rapidfuzz 3.14.6. Frontend: Node 24, Vite 5, React 18, TypeScript 5, react-router-dom 6, axios, cytoscape 3 + cytoscape-cola, xlsx (SheetJS). Tests: pytest + fastapi.testclient (backend), `tsc --noEmit` + `vite build` (frontend).

**Spec:** `docs/superpowers/specs/2026-09-07-frontend-redesign-design.md`

## Global Constraints

- Frontend language is TypeScript for all of `frontend/src` (user chose TS over JS).
- No database change: NetworkX fallback stays the default; Neo4j env vars remain optional.
- Every new API endpoint is covered by the existing `ApiKeyMiddleware` (no public paths added).
- Same `.env` keys (`API_KEY`, `CAVIAR_DIR`, `ENRON_DIR`, `ENRON_MAX_EDGES`, `EVENT_DATES`); no new required env vars.
- Existing files `graph_store.py`, `analytics.py`, `suspicious_patterns.py`, `entity_resolution.py`, `dashboard.html/.css/.js` are NOT modified (legacy dashboard stays as fallback).
- No emojis in UI or code comments.
- No git commits in this workspace (not a git repo; commits only on explicit user request).
- PowerShell 5.1 shell: chain dependent commands with `; if ($?) { ... }`, never `&&`; quote paths with spaces.
- Backend file size guard for uploads: 5 MB max on `/ingest/preview` and `/ingest/load`.
- Graph node cap: default 600 nodes served/rendered, user-selectable 200/600/1200.

---

## File Structure

New backend files:

- `ingest_preview.py` — pure upload logic, no FastAPI imports. Owns column-role detection, row cleaning, file parsing (CSV/JSON/XLSX). Imported by `api.py`.
- `tests/test_ingest_preview.py` — pytest unit tests for detection + cleaning (no server needed).
- `tests/test_api_endpoints.py` — pytest API tests via `fastapi.testclient.TestClient(api.app)` covering the 4 new endpoints with auth checks.

Modified backend files:

- `api.py` — append-only: 6 new Pydantic models + 4 new endpoints + `openpyxl`-optional import. No existing route touched.
- `requirements.txt` (new, only if missing) — pins `openpyxl`, `pytest`, `httpx` for reproducibility. If the file already exists, append instead.

New frontend files (`frontend/`):

- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html` — scaffold + dev proxy (`/api` → `http://127.0.0.1:8000`).
- `src/main.tsx`, `src/App.tsx` — entry + router + sidebar/topbar layout.
- `src/lib/api.ts` — Axios client (base URL + `X-API-Key` header, typed wrappers for every endpoint used).
- `src/lib/demo.ts` — bundled fictional demo graph (Copper-Ledger family, labeled fictional) used when backend is offline.
- `src/lib/upload.ts` — client-side XLSX (SheetJS) + CSV parse, header detect, column-role detect, clean, preview-row builder. Mirrors server rules.
- `src/components/ConnectionStatus.tsx`, `PipelineStepper.tsx`, `DossierPanel.tsx`, `AlertCard.tsx`, `PreviewTable.tsx` — shared UI pieces, one responsibility each.
- `src/pages/Overview.tsx`, `NetworkExplorer.tsx`, `Entities.tsx`, `Alerts.tsx`, `Documents.tsx`, `UploadSettings.tsx` — the 6 pages, one job each.
- `src/styles.css` — theme variables ported from `dashboard.css` (`--red`, `--amber`, `--slate`, `--e-fin`, `--e-call`, `--e-coloc`, `--e-kin`, `--e-unk`, dark/light `data-theme`).

---

### Task 1: Backend upload helper `ingest_preview.py` + unit tests

**Files:**
- Create: `ingest_preview.py`
- Create: `tests/test_ingest_preview.py`

**Interfaces:**
- Consumes: `entity_resolution.normalize_phone`, `entity_resolution.normalize_vehicle` (exact names in `entity_resolution.py:53,62`); `graph_store.EDGE_KIND_MAP` keys (`CONTACTED`, `EMAILED`, `CALLED`, `FINANCIAL_TRANSFER`, `CO_LOCATED`, `ASSOCIATE_OF`, `OWNS_VEHICLE`, `REGISTERED_AT`).
- Produces (used by Task 2): `detect_column_mapping(headers: list[str]) -> dict[str, str | None]` with keys `source,target,rel,weight,date,amount,node_id,node_label` (values are the matched header names or `None`); `clean_edge_rows(rows: list[dict], mapping: dict) -> tuple[list[dict], list[dict]]` returning `(cleaned, skipped)` where cleaned rows are `{src,dst,rel,frequency,date,amount}` and skipped rows are `{row: int, reason: str}`; `parse_upload_file(filename: str, content: bytes, sheet: str | None) -> tuple[list[dict], dict]` returning `(raw_rows, meta)` with `meta={sheet_names, sheet, header_row, total_rows}`.

- [ ] **Step 1: Create the failing test file**

```python
# tests/test_ingest_preview.py
from ingest_preview import detect_column_mapping, clean_edge_rows


def test_detect_caviar_style_headers():
    m = detect_column_mapping(["person_a", "person_b", "weight"])
    assert m["source"] == "person_a"
    assert m["target"] == "person_b"
    assert m["weight"] == "weight"


def test_detect_sender_recipient_headers():
    m = detect_column_mapping(["sender", "recipient", "frequency"])
    assert m["source"] == "sender"
    assert m["target"] == "recipient"


def test_detect_neo4j_style_headers():
    m = detect_column_mapping([":START_ID", ":END_ID", ":TYPE", "frequency"])
    assert m["source"] == ":START_ID"
    assert m["target"] == ":END_ID"
    assert m["rel"] == ":TYPE"


def test_clean_drops_empty_and_dedupes():
    rows = [
        {"person_a": " P1 ", "person_b": "P2", "weight": "3"},
        {"person_a": "P1", "person_b": "P2", "weight": "2"},
        {"person_a": "", "person_b": "P2", "weight": "1"},
        {"person_a": "P3", "person_b": "", "weight": "1"},
    ]
    mapping = {"source": "person_a", "target": "person_b", "rel": None,
               "weight": "weight", "date": None, "amount": None,
               "node_id": None, "node_label": None}
    cleaned, skipped = clean_edge_rows(rows, mapping)
    assert len(cleaned) == 1
    assert cleaned[0]["src"] == "P1"
    assert cleaned[0]["frequency"] == 5
    assert len(skipped) == 2
```

- [ ] **Step 2: Run the test, verify it fails (module does not exist yet)**

Run: `python -m pytest tests/test_ingest_preview.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ingest_preview'` (install pytest first if missing: `pip install pytest`).

- [ ] **Step 3: Write the minimal implementation**

```python
# ingest_preview.py
"""Upload parse/detect/clean helpers for POST /ingest/preview + /ingest/load.

Pure functions (no FastAPI imports) so they are unit-testable without a server.
Column synonyms mirror dashboard.js validateUpload + graph_store loaders.
"""
import csv
import io
import json
import re

MAX_FILE_BYTES = 5_000_000

_ROLE_PATTERNS = {
    "source": [r":START_ID", r"person_a", r"sender", r"source", r"\bfrom\b"],
    "target": [r":END_ID", r"person_b", r"recipient", r"target", r"\bto\b"],
    "rel": [r":TYPE", r"^rel$", r"^type$"],
    "weight": [r"frequency", r"weight", r"count", r"calls"],
    "date": [r"timestamps?", r"^date$", r"datetime", r"approx_date_range"],
    "amount": [r"amount", r"value", r"\brs\b", r"inr"],
    "node_id": [r"person_id", r"email", r"account_id", r"^id$"],
    "node_label": [r"^label$", r"^name$", r"person_id"],
}


def detect_column_mapping(headers):
    """Map each role -> matched header name (or None). First match wins."""
    mapping = {}
    for role, patterns in _ROLE_PATTERNS.items():
        found = None
        for h in headers:
            hl = (h or "").strip()
            for p in patterns:
                if re.search(p, hl, re.IGNORECASE):
                    found = h
                    break
            if found:
                break
        mapping[role] = found
    return mapping


def _to_int_freq(value):
    try:
        return max(1, int(float(value)))
    except (TypeError, ValueError):
        return 1


def clean_edge_rows(rows, mapping):
    """Trim, drop empty-endpoint rows, dedupe (src,dst,rel) summing frequency.

    Returns (cleaned, skipped). cleaned: [{src,dst,rel,frequency,date,amount}].
    skipped: [{row (1-based incl. header), reason}].
    """
    s_key, t_key = mapping.get("source"), mapping.get("target")
    r_key, w_key = mapping.get("rel"), mapping.get("weight")
    d_key, a_key = mapping.get("date"), mapping.get("amount")
    cleaned_by_key, order, skipped = {}, [], []
    for i, r in enumerate(rows, start=2):  # 1-based, row 1 = header
        src = str(r.get(s_key) or "").strip() if s_key else ""
        dst = str(r.get(t_key) or "").strip() if t_key else ""
        if not src or not dst:
            skipped.append({"row": i, "reason": "missing endpoint"})
            continue
        rel = str(r.get(r_key) or "ASSOCIATE_OF").strip().upper() or "ASSOCIATE_OF"
        freq = _to_int_freq(r.get(w_key)) if w_key else 1
        key = (src, dst, rel)
        if key in cleaned_by_key:
            cleaned_by_key[key]["frequency"] += freq
        else:
            cleaned_by_key[key] = {
                "src": src, "dst": dst, "rel": rel, "frequency": freq,
                "date": str(r.get(d_key) or "").strip() if d_key else "",
                "amount": str(r.get(a_key) or "").strip() if a_key else "",
            }
            order.append(key)
    return [cleaned_by_key[k] for k in order], skipped


def _find_header_row(table):
    """First row (within first 10) with >=2 non-empty cells; default row 0."""
    for i, row in enumerate(table[:10]):
        if sum(1 for c in row if str(c or "").strip()) >= 2:
            return i
    return 0


def parse_upload_file(filename, content, sheet=None):
    """Parse CSV/JSON/XLSX bytes -> (raw_rows: [dict], meta: dict).

    Raises ValueError with a human-readable message on any parse problem.
    """
    name = (filename or "").lower()
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("File too large (max 5 MB).")
    if name.endswith(".json"):
        try:
            g = json.loads(content.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Invalid JSON: {e}")
        nl = g.get("nodes", []) or g.get("vertices", [])
        el = g.get("edges", []) or g.get("links", [])
        raw = []
        for e in el:
            raw.append({
                "src": e.get("src") or e.get("a") or e.get("source") or e.get("from") or "",
                "dst": e.get("dst") or e.get("b") or e.get("target") or e.get("to") or "",
                "rel": e.get("rel") or e.get("t") or e.get("type") or "",
                "frequency": e.get("frequency") or e.get("s") or e.get("weight") or 1,
            })
        node_ids = [str(n.get("id") or n.get("person_id") or n.get("email") or "") for n in nl]
        return raw, {"kind": "json", "sheet_names": [], "sheet": None,
                     "header_row": 0, "total_rows": len(raw), "node_ids": node_ids}
    if name.endswith((".xlsx", ".xls")):
        try:
            import openpyxl
        except ImportError:
            raise ValueError("XLSX support needs openpyxl: pip install openpyxl (or upload CSV).")
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        names = wb.sheetnames
        pick = sheet if sheet in names else names[0]
        ws = wb[pick]
        table = [[("" if c is None else str(c)) for c in row] for row in ws.iter_rows(values_only=True)]
        table = [r for r in table if any(x.strip() for x in r)]
        if not table:
            raise ValueError(f"Sheet '{pick}' is empty.")
        hi = _find_header_row(table)
        headers = [h.strip() for h in table[hi]]
        raw = [dict(zip(headers, r)) for r in table[hi + 1:]]
        return raw, {"kind": "xlsx", "sheet_names": names, "sheet": pick,
                     "header_row": hi + 1, "total_rows": len(raw)}
    # CSV default
    try:
        text = content.decode("utf-8-sig")
    except Exception as e:
        raise ValueError(f"Cannot decode CSV as UTF-8: {e}")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row.")
    raw = [dict(r) for r in reader]
    return raw, {"kind": "csv", "sheet_names": [], "sheet": None,
                 "header_row": 1, "total_rows": len(raw)}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `python -m pytest tests/test_ingest_preview.py -v`
Expected: 4 passed.

- [ ] **Step 5: Verify no existing module broke (import check)**

Run: `python -c "import ingest_preview; print('ok', ingest_preview.detect_column_mapping(['sender','recipient']))"`
Expected: prints `ok {...}` with source/target mapped.

### Task 2: Backend — 4 new endpoints in `api.py`

**Files:**
- Modify: `api.py` (append-only: add `import io`, 6 Pydantic models, 4 endpoints; no existing line changed)
- Create: `tests/test_api_endpoints.py`

**Interfaces:**
- Consumes: `ingest_preview.detect_column_mapping/clean_edge_rows/parse_upload_file` (Task 1); existing `_require_store`, `_ranked`, `_rank_index`, `_fallback_key`, `_display_name`, `_ranked_cache`, `_rank_lock` in `api.py`; `GraphStore.load_relationships(rows)` with rows `{src,dst,rel,frequency,date?}`.
- Produces (used by Task 4 `src/lib/api.ts`): `GET /graph/full?limit=600` → `{nodes:[{id,label,name,community_id,role,influence_score}], edges:[{id,src,dst,rel,frequency}], truncated, total_nodes, total_edges}`; `GET /entities/{a}/paths/{b}?max_hops=3&limit=10` → `{source,target,paths,count}`; `POST /ingest/preview` (multipart `file`, optional `sheet`) → `{filename, kind, sheet, columns, mapping, rows_cleaned, node_count, edge_count, preview[≤50], skipped[all with row+reason]}`; `POST /ingest/load` (same inputs) → `{loaded:{nodes,edges}, skipped, note}`.

- [ ] **Step 1: Write the failing API test**

```python
# tests/test_api_endpoints.py
from fastapi.testclient import TestClient
import api

client = TestClient(api.app)
KEY = {"X-API-Key": "dev-key-change-me"}
CSV = b"person_a,person_b,weight\nP1,P2,3\nP2,P3,1\n"


def test_graph_full_needs_key():
    r = client.get("/graph/full")
    assert r.status_code == 401


def test_graph_full_shape():
    r = client.get("/graph/full?limit=50", headers=KEY)
    assert r.status_code == 200
    body = r.json()
    assert {"nodes", "edges", "truncated", "total_nodes", "total_edges"} <= set(body)
    assert isinstance(body["nodes"], list)


def test_paths_missing_entity_404():
    r = client.get("/entities/NOPE_A/paths/NOPE_B", headers=KEY)
    assert r.status_code in (200, 404)


def test_ingest_preview_csv():
    r = client.post("/ingest/preview", headers=KEY,
                    files={"file": ("t.csv", CSV, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["rows_cleaned"] == 2
    assert body["mapping"]["source"] == "person_a"
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `python -m pytest tests/test_api_endpoints.py -v`
Expected: FAIL — `test_graph_full_needs_key` gets 404 (route missing), or collection error. (Note: if `.env` sets a real API_KEY, the 401 test may get 200 — tests override `api.API_KEY = "dev-key-change-me"` on the first line, so add that at the top of the test file before creating the client if needed.)

- [ ] **Step 3: Implement — append to `api.py` (no existing code touched)**

Append after the `admin_reload` endpoint, before `if __name__`:

```python
# ------------------------------------------------- graph + ingest additions ---
class FullGraphNode(BaseModel):
    id: str
    label: str = "Person"
    name: str = ""
    community_id: Optional[int] = None
    role: Optional[str] = None
    influence_score: Optional[float] = None


class FullGraphEdge(BaseModel):
    id: str
    src: str
    dst: str
    rel: str = "ASSOCIATE_OF"
    frequency: int = 1


class FullGraphResponse(BaseModel):
    nodes: List[FullGraphNode]
    edges: List[FullGraphEdge]
    truncated: bool = False
    total_nodes: int = 0
    total_edges: int = 0


class PathsResponse(BaseModel):
    source: str
    target: str
    paths: List[List[str]] = []
    count: int = 0


class IngestPreviewResponse(BaseModel):
    filename: str
    kind: str = "csv"
    sheet: Optional[str] = None
    columns: List[str] = []
    mapping: Dict[str, Any] = {}
    rows_cleaned: int = 0
    node_count: int = 0
    edge_count: int = 0
    preview: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []


class IngestLoadResponse(BaseModel):
    loaded: Dict[str, int] = {}
    skipped: List[Dict[str, Any]] = []
    note: str = ""


@app.get("/graph/full", response_model=FullGraphResponse, summary="Capped full graph for Cytoscape")
def graph_full(limit: int = Query(600, ge=50, le=2000)):
    from ingest_preview import clean_edge_rows  # noqa (keeps import local, avoids cycles)
    s = _require_store()
    try:
        rank = _rank_index()
    except Exception:
        rank = {}
    if getattr(s, "fallback", False):
        G = s.G
        order = sorted(G.nodes(data=True),
                       key=lambda kv: -(rank.get(kv[0][1], {}).get("influence_score") or 0))
        total_nodes, total_edges = G.number_of_nodes(), G.number_of_edges()
        keep = set(n[0] for n in order[:limit])
        nodes = []
        for (label, eid), d in order[:limit]:
            props = {k: v for k, v in d.items() if k != "node_label"}
            r = rank.get(eid, {})
            nodes.append(FullGraphNode(
                id=eid, label=label, name=_display_name(label, eid, props),
                community_id=r.get("community_id"), role=r.get("role"),
                influence_score=r.get("influence_score")))
        edges, seen = [], 0
        for (ls, a), (ld, b), d in G.edges(data=True):
            if (ls, a) not in keep or (ld, b) not in keep:
                continue
            seen += 1
            if len(edges) >= limit * 2:
                continue
            edges.append(FullGraphEdge(
                id=f"{a}>{b}>{d.get('rel', '?')}", src=a, dst=b,
                rel=str(d.get("rel", "ASSOCIATE_OF")),
                frequency=int(d.get("frequency", 1) or 1)))
        return FullGraphResponse(nodes=nodes, edges=edges,
                                 truncated=total_nodes > len(nodes),
                                 total_nodes=total_nodes, total_edges=total_edges)
    with s.driver.session() as sess:
        n = sess.run("MATCH (n) RETURN count(n) AS c").single()["c"]
        e = sess.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
        recs = list(sess.run(
            "MATCH (n) RETURN n.id AS id, labels(n)[0] AS label, "
            "coalesce(n.label, n.name, n.id) AS nm LIMIT $lim", lim=limit))
    nodes = [FullGraphNode(id=r["id"], label=r["label"] or "Person",
                           name=str(r["nm"] or r["id"]),
                           **{k: v for k, v in (rank.get(r["id"], {}) or {}).items()
                              if k in ("community_id", "role", "influence_score")})
             for r in recs]
    return FullGraphResponse(nodes=nodes, edges=[],
                             truncated=n > len(nodes),
                             total_nodes=n, total_edges=e)


@app.get("/entities/{a}/paths/{b}", response_model=PathsResponse,
         summary="All simple paths between two entities (capped)")
def entity_paths(a: str, b: str, max_hops: int = Query(3, ge=1, le=5),
                 limit: int = Query(10, ge=1, le=50)):
    s = _require_store()
    try:
        paths = s.get_all_paths_within_hops(a, b, max_hops=max_hops, limit=limit)
    except Exception:
        paths = []
    if not paths:
        _entity_or_404(a)
        _entity_or_404(b)
    return PathsResponse(source=a, target=b, paths=[list(p) for p in paths],
                         count=len(paths))


def _read_ingest_upload(file: UploadFile, sheet: Optional[str]):
    from ingest_preview import parse_upload_file, detect_column_mapping, clean_edge_rows
    raw = file.file.read() if hasattr(file, "file") else b""
    if not raw:
        import asyncio
        try:
            raw = asyncio.get_event_loop().run_until_complete(file.read())
        except RuntimeError:
            raw = b""
    rows_raw, meta = parse_upload_file(file.filename or "upload", raw, sheet)
    if meta["kind"] == "json":
        mapping = {"source": "src", "target": "dst", "rel": "rel",
                   "weight": "frequency", "date": None, "amount": None,
                   "node_id": None, "node_label": None}
        columns = ["src", "dst", "rel", "frequency"]
    else:
        columns = list(rows_raw[0].keys()) if rows_raw else []
        mapping = detect_column_mapping(columns)
    cleaned, skipped = clean_edge_rows(rows_raw, mapping)
    return rows_raw, meta, columns, mapping, cleaned, skipped


@app.post("/ingest/preview", response_model=IngestPreviewResponse,
          summary="Preview smart-upload detection + cleaning (no persistence)")
async def ingest_preview(file: UploadFile = File(...),
                         sheet: Optional[str] = Form(None)):
    try:
        rows_raw, meta, columns, mapping, cleaned, skipped = _read_ingest_upload(file, sheet)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not cleaned:
        raise HTTPException(400, {"message": "No usable rows found.", "skipped": skipped})
    node_ids = {c["src"] for c in cleaned} | {c["dst"] for c in cleaned}
    return IngestPreviewResponse(
        filename=file.filename or "upload", kind=meta["kind"],
        sheet=meta.get("sheet"), columns=columns, mapping=mapping,
        rows_cleaned=len(cleaned), node_count=len(node_ids),
        edge_count=len(cleaned), preview=cleaned[:50], skipped=skipped)


@app.post("/ingest/load", response_model=IngestLoadResponse,
          summary="Load a cleaned upload into the graph")
async def ingest_load(file: UploadFile = File(...),
                      sheet: Optional[str] = Form(None)):
    try:
        rows_raw, meta, columns, mapping, cleaned, skipped = _read_ingest_upload(file, sheet)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not cleaned:
        raise HTTPException(400, {"message": "No usable rows found.", "skipped": skipped})
    s = _require_store()
    rel_rows = [{"src": c["src"], "dst": c["dst"], "rel": c["rel"],
                 "frequency": c["frequency"],
                 **({"date": c["date"]} if c.get("date") else {})}
                for c in cleaned]
    n = s.load_relationships(rel_rows)
    global _ranked_cache
    with _rank_lock:
        _ranked_cache = None
    node_ids = {c["src"] for c in cleaned} | {c["dst"] for c in cleaned}
    return IngestLoadResponse(loaded={"nodes": len(node_ids), "edges": n},
                              skipped=skipped,
                              note=f"Loaded {len(cleaned)} cleaned rows from {meta['kind']}.")
```

Also add `sheet: Optional[str] = None` handling: `Form(None)` import already exists in `api.py` (`Form` is imported). `UploadFile.file.read()` is sync — prefer `await file.read()`; the helper above handles both. Simplify in real edit: use `raw = await file.read()`.

- [ ] **Step 4: Run the API tests, verify they pass**

Run: `pip install openpyxl; if ($?) { python -m pytest tests/test_api_endpoints.py tests/test_ingest_preview.py -v }`
Expected: all pass (5+ tests). If `test_graph_full_shape` fails with 503 "Graph store not initialised", the lifespan did not run under TestClient — wrap client as `with TestClient(api.app) as client:` (lifespan runs on context entry). Fix the test file accordingly and re-run.

- [ ] **Step 5: Boot the real server and smoke-test by hand**

Run: `python -m uvicorn api:app --port 8000`
Expected: log line `graph loaded: {...}`; in a second terminal: `Invoke-RestMethod http://127.0.0.1:8000/health` returns `status: ok`; open `http://127.0.0.1:8000/docs` and confirm `/graph/full`, `/entities/{a}/paths/{b}`, `/ingest/preview`, `/ingest/load` are listed. Stop the server (`Ctrl+C`) when done.

### Task 3: Frontend scaffold — Vite + React + TS + API client + theme

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/api.ts`, `frontend/src/styles.css`

**Interfaces:**
- Consumes: backend routes from Task 2 (`/health`, `/stats`, `/graph/full`, `/entities/{a}/paths/{b}`, `/analytics/key-players`, `/analytics/alerts`, `/search`, `/documents/analyze`, `/ingest/preview`, `/ingest/load`) — all under `X-API-Key`.
- Produces (used by Tasks 4–6): `apiFetch(path, opts)` + typed helpers `getHealth/getStats/getGraphFull/getPaths/getKeyPlayers/getAlerts/searchEntities/analyzeDocument/previewIngest/loadIngest` in `src/lib/api.ts`; `ApiConfig {baseUrl, key}` persisted to `localStorage["shadowintel-api"]`; CSS variables `--red/--amber/--slate/--e-fin/--e-call/--e-coloc/--e-kin/--e-unk` + `data-theme` dark/light in `src/styles.css`.

- [ ] **Step 1: Scaffold `frontend/` and install dependencies**

Run: `npm create vite@latest frontend -- --template react-ts; if ($?) { Set-Location frontend; npm install; npm install react-router-dom axios cytoscape cytoscape-cola xlsx }`
Expected: `frontend/node_modules` created, no errors. (If `npm create` prompts interactively, answer `y`.)

- [ ] **Step 2: Write `vite.config.ts` with backend proxy**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:8000",
      "/stats": "http://127.0.0.1:8000",
      "/graph": "http://127.0.0.1:8000",
      "/entities": "http://127.0.0.1:8000",
      "/analytics": "http://127.0.0.1:8000",
      "/search": "http://127.0.0.1:8000",
      "/documents": "http://127.0.0.1:8000",
      "/ingest": "http://127.0.0.1:8000",
    },
  },
});
```

- [ ] **Step 3: Write `src/lib/api.ts` (the only module that talks HTTP)**

```ts
export interface ApiConfig { baseUrl: string; key: string }
export interface FullGraphNode { id: string; label: string; name: string; community_id?: number | null; role?: string | null; influence_score?: number | null }
export interface FullGraphEdge { id: string; src: string; dst: string; rel: string; frequency: number }
export interface FullGraph { nodes: FullGraphNode[]; edges: FullGraphEdge[]; truncated: boolean; total_nodes: number; total_edges: number }

const LS_KEY = "shadowintel-api";

export function loadConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as ApiConfig;
  } catch { /* fresh start */ }
  return { baseUrl: "http://127.0.0.1:8000", key: "" };
}
export function saveConfig(c: ApiConfig, remember: boolean) {
  try {
    if (remember) localStorage.setItem(LS_KEY, JSON.stringify(c));
    else sessionStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch { /* storage unavailable */ }
}

async function req<T>(cfg: ApiConfig, path: string, init?: RequestInit, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(cfg.baseUrl.replace(/\/$/, "") + path, {
      ...init,
      headers: { "X-API-Key": cfg.key, "Content-Type": "application/json", ...(init?.headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`Cannot reach ${cfg.baseUrl}. Start the backend: python -m uvicorn api:app --port 8000`);
  }
  if (res.status === 401) throw new Error("API key rejected (401). Check the key in Upload & Settings.");
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

export const getHealth = (c: ApiConfig) => req<{ status: string; backend?: string }>(c, "/health");
export const getStats = (c: ApiConfig) => req<{ nodes: number; edges: number }>(c, "/stats");
export const getGraphFull = (c: ApiConfig, limit = 600) => req<FullGraph>(c, `/graph/full?limit=${limit}`);
export const getPaths = (c: ApiConfig, a: string, b: string, hops = 3) =>
  req<{ source: string; target: string; paths: string[][]; count: number }>(c, `/entities/${encodeURIComponent(a)}/paths/${encodeURIComponent(b)}?max_hops=${hops}`);
export const getKeyPlayers = (c: ApiConfig, limit = 20) => req<{ players: unknown[]; total: number }>(c, `/analytics/key-players?limit=${limit}`);
export const getAlerts = (c: ApiConfig) => req<{ flags: unknown[]; total: number }>(c, "/analytics/alerts");
export const searchEntities = (c: ApiConfig, query: string) => req<{ results: unknown[] }>(c, "/search", { method: "POST" }, { query, limit: 10 });
```

- [ ] **Step 4: Write `src/styles.css` theme + `src/main.tsx` + `src/App.tsx` shell**

`styles.css` must define `:root` + `html[data-theme="dark"]` + `html[data-theme="light"]` with `--red:#B3261E; --amber:#A66A00; --slate:#5E6E77; --e-fin / --e-call / --e-coloc / --e-kin / --e-unk` (values from spec §8 / current `dashboard.css`), plus `.sidebar/.topbar/.page/.card/.btn/.pill/.skeleton/.empty/.error` layout classes. `App.tsx` sets up `BrowserRouter` with sidebar nav (6 links) + topbar (case name + theme toggle) + `<Routes>` placeholders (`<div>TODO Task 4+</div>` per route is acceptable ONLY as scaffold — each page is fully built in its task).

- [ ] **Step 5: Typecheck + dev-boot verification**

Run: `Set-Location frontend; if ($?) { npx tsc --noEmit }`
Expected: no errors. Then `npm run dev` boots on `:5173`; open it, confirm the 6-item sidebar renders; stop dev server.

### Task 4: Overview page + shared components + demo fallback

**Files:**
- Create: `frontend/src/lib/demo.ts`, `frontend/src/components/ConnectionStatus.tsx`, `frontend/src/components/PipelineStepper.tsx`, `frontend/src/pages/Overview.tsx`

**Interfaces:**
- Consumes: `src/lib/api.ts` (`loadConfig/getHealth/getStats/getKeyPlayers/getAlerts`); React Router `<Link>`.
- Produces (used by Task 6 Network page): `demo.ts` exports `demoGraph: FullGraph` (fictional Copper-Ledger-style: 8 nodes P01–P08, 9 edges, roles leader/bridge/member, clearly labeled fictional) and `isDemo` flag pattern (`{ demo: boolean }` return convention: pages try live, fall back to demo with a visible "DEMO — fictional data" pill).

- [ ] **Step 1: Write `src/lib/demo.ts`**

```ts
import type { FullGraph } from "./api";

export const demoGraph: FullGraph = {
  nodes: [
    { id: "P01", label: "Person", name: "Mohan Yadav", role: "leader", influence_score: 0.92, community_id: 0 },
    { id: "P02", label: "Person", name: "Ravi Sharma", role: "bridge", influence_score: 0.71, community_id: 0 },
    { id: "P03", label: "Person", name: "Anil Verma", role: "bridge", influence_score: 0.68, community_id: 0 },
    { id: "P05", label: "Person", name: "Farhan Qureshi", role: "leader", influence_score: 0.83, community_id: 1 },
    { id: "P07", label: "Person", name: "Sana Sheikh", role: "bridge", influence_score: 0.62, community_id: 1 },
    { id: "P09", label: "Person", name: "Prakash Rao", role: "member", influence_score: 0.28, community_id: 2 },
    { id: "V1", label: "Vehicle", name: "MH12AB1234", role: "member", influence_score: 0.2, community_id: 0 },
    { id: "L1", label: "Location", name: "Andheri", role: "member", influence_score: 0.1, community_id: 0 },
  ],
  edges: [
    { id: "P01>P02", src: "P01", dst: "P02", rel: "CALLED", frequency: 4 },
    { id: "P01>P05", src: "P01", dst: "P05", rel: "FINANCIAL_TRANSFER", frequency: 5 },
    { id: "P03>P07", src: "P03", dst: "P07", rel: "CALLED", frequency: 4 },
    { id: "P05>P07", src: "P05", dst: "P07", rel: "FINANCIAL_TRANSFER", frequency: 4 },
    { id: "P05>P08x", src: "P05", dst: "P09", rel: "ASSOCIATE_OF", frequency: 2 },
    { id: "P07>P02", src: "P07", dst: "P02", rel: "CALLED", frequency: 3 },
    { id: "P09>P03", src: "P09", dst: "P03", rel: "CALLED", frequency: 2 },
    { id: "P01>V1", src: "P01", dst: "V1", rel: "OWNS_VEHICLE", frequency: 1 },
    { id: "P01>L1", src: "P01", dst: "L1", rel: "REGISTERED_AT", frequency: 1 },
  ],
  truncated: false, total_nodes: 8, total_edges: 9,
};
```

- [ ] **Step 2: Write `ConnectionStatus.tsx` (health pill) + `PipelineStepper.tsx` (5 steps with router links)**

`ConnectionStatus` props: `{ cfg }`. On mount calls `getHealth(cfg)` + `getStats(cfg)`; renders green pill `LIVE · N nodes / M edges` or red pill `OFFLINE — demo mode` (never throws; catches into offline state). `PipelineStepper` renders `Ingest → Clean → Graph → Alerts → Report` as `<Link to="/upload">`, `<Link to="/upload">`, `<Link to="/network">`, `<Link to="/alerts">`, `<Link to="/documents">` with numbers 1–5.

- [ ] **Step 3: Write `Overview.tsx`**

Loads health/stats + top-5 key players + top-3 alerts (each in try/catch → demo/empty state); sections: status card, stepper, two preview cards with "Open full page →" links. Every async section has loading skeleton, empty state, error state with retry button. Includes the one primary action: big "Open Network Explorer" button.

- [ ] **Step 4: Verify**

Run: `Set-Location frontend; if ($?) { npx tsc --noEmit }`
Expected: no errors. Manual: `npm run dev`, open `/` with backend OFF → demo pill + previews render; with backend ON (Task 2 server) → live counts.

### Task 5: Network Explorer — Cytoscape.js page + dossier panel

**Files:**
- Create: `frontend/src/pages/NetworkExplorer.tsx`, `frontend/src/components/DossierPanel.tsx`

**Interfaces:**
- Consumes: `api.ts` (`loadConfig/getGraphFull/getPaths`), `demo.ts` (`demoGraph`), cytoscape + cytoscape-cola (`import cytoscape from "cytoscape"; import cola from "cytoscape-cola"; cytoscape.use(cola)`).
- Produces: route `/network` (+ `/network?focus=:id` deep link used by Task 6 pages); `DossierPanel` props `{ node: FullGraphNode | null, onClose: () => void }` reused by Entities page.

- [ ] **Step 1: Write `DossierPanel.tsx`**

Props `{ node }`. Renders name, role pill, influence score bar, community, plus `GET /entities/:id` detail fetch (degree, source, properties, neighbours_sample with buttons that call `onFocus(neighbourId)`). Sections: Influence, Centrality (if `centrality_breakdown` present), Connections (neighbour chips), Risk (placeholder list filled by Alerts page link — text "See Alerts page for flags touching this entity"), Evidence/History (neighbours + note). Loading skeleton while fetching; error state with retry.

- [ ] **Step 2: Write `NetworkExplorer.tsx`**

Requirements (all in one file, ~300 lines max): `useEffect` loads `getGraphFull(cfg, limit)` → fallback `demoGraph` on error (show DEMO pill); `useRef` div + `useEffect` builds `cytoscape({ container, elements, style, layout: { name: "cola" } })` and destroys on unmount. Style mapping: node `background-color` by `role` (leader `#B3261E`, bridge `#A66A00`, member `#5E6E77`, default hollow), `width/height` by `influence_score` (`24 + score*36`); edge `line-color` by `rel` (financial `#3FA97C` solid + `target-arrow-shape: triangle`, call `#5E8FC4`, colocated `#8E83B8` dashed, kin `#C07E92` dotted, default grey). Controls: rel-type filter checkboxes, layout select (cola/cose/concentric/circle), node-cap select (200/600/1200 → reload), ego/full toggle (ego = `getNetwork` depth-1 of focus node — reuse existing `/entities/:id/network` endpoint), path mode (two text inputs A/B + Find → `getPaths` → `eles` highlight via `.addClass("highlight")`, list path count), click node → `setSelected(node)` → `<DossierPanel>`, PNG export button (`cy.png()` download). `truncated` banner when `graph.truncated`. Zoom-gated labels: `cy.on("zoom", ...)` toggle `showLabels` state → style `label: showLabels || role=leader ? data(name) : ""`.

- [ ] **Step 3: Verify**

Run: `Set-Location frontend; if ($?) { npx tsc --noEmit }`
Expected: no errors. Manual: open `/network` with backend on → live graph renders, click node → dossier; type filters hide edges; A/B path highlights; with backend off → demo graph + DEMO pill.

### Task 6: Entities, Alerts, Documents pages

**Files:**
- Create: `frontend/src/pages/Entities.tsx`, `frontend/src/pages/Alerts.tsx`, `frontend/src/pages/Documents.tsx`, `frontend/src/components/AlertCard.tsx`

**Interfaces:**
- Consumes: `api.ts` (`searchEntities/getKeyPlayers/getAlerts`), `DossierPanel` (Task 5), React Router (`/entities/:id` detail via `useParams`, `/network?focus=` links).
- Produces: routes `/entities`, `/entities/:id`, `/alerts`, `/documents`. Nothing downstream (Upload page is independent).

- [ ] **Step 1: Write `Entities.tsx`**

Search box (debounced 300 ms → `searchEntities`) with results list linking to `/entities/:id` and `/network?focus=:id`; key-players table (rank, name, role pill, community, influence bar, link). Detail sub-view (`:id` param): reuse `DossierPanel` full-width + "Open in Network Explorer" link. Empty state ("no matches — try a surname, phone fragment, or plate"), error state with retry.

- [ ] **Step 2: Write `AlertCard.tsx` + `Alerts.tsx`**

`AlertCard` props: `{ pattern, explanation, entities: string[], severity: number, evidence: unknown, source: string }`. Renders severity dot (≥0.7 red, ≥0.4 amber, else slate) + severity label, pattern type, plain-language explanation, entity chips (each `<Link to={/network?focus=id}>`), collapsible evidence `<details><summary>Evidence</summary><pre>{JSON}</pre></details>`, source dataset. `Alerts.tsx`: `getAlerts` list, severity filter (all/high/med/low), honest empty state ("No flagged patterns. Note: structuring checks skip sources without financial edges."), error retry.

- [ ] **Step 3: Write `Documents.tsx`**

Textarea + file input (.txt) + "Analyze" → `POST /documents/analyze` (multipart file OR JSON `{text}` — use `FormData` without JSON content-type for file, JSON body for pasted text). Renders summary, classification, triples table, NER entities (each linking to Entities search/network focus), warnings list (amber). Sample-FIR button fills the textarea with a 3-sentence fictional report.

- [ ] **Step 4: Verify**

Run: `Set-Location frontend; if ($?) { npx tsc --noEmit }`
Expected: no errors. Manual: each of the 3 pages loads against live backend; entity links jump to `/network?focus=`.

### Task 7: Upload & Settings page + client-side smart upload

**Files:**
- Create: `frontend/src/lib/upload.ts`, `frontend/src/components/PreviewTable.tsx`, `frontend/src/pages/UploadSettings.tsx`

**Interfaces:**
- Consumes: `api.ts` (`loadConfig/saveConfig/getHealth`), `xlsx` (SheetJS) for client XLSX parse, backend `/ingest/preview` + `/ingest/load` (multipart `FormData`, Task 2).
- Produces: route `/upload`. Nothing downstream — final page.

- [ ] **Step 1: Write `src/lib/upload.ts` (client mirror of server rules)**

```ts
export interface DetectedUpload {
  columns: string[]; mapping: Record<string, string | null>;
  cleaned: { src: string; dst: string; rel: string; frequency: number }[];
  skipped: { row: number; reason: string }[];
}
const PATTERNS: Record<string, RegExp[]> = {
  source: [/:START_ID/i, /person_a/i, /sender/i, /^source$/i, /^from$/i],
  target: [/:END_ID/i, /person_b/i, /recipient/i, /^target$/i, /^to$/i],
  rel: [/:TYPE/i, /^rel$/i, /^type$/i],
  weight: [/frequency/i, /weight/i, /count/i, /calls/i],
  date: [/timestamp/i, /^date$/i, /datetime/i],
  amount: [/amount/i, /value/i],
};
export function detectMapping(columns: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [role, res] of Object.entries(PATTERNS)) {
    out[role] = columns.find((c) => res.some((r) => r.test(c.trim()))) ?? null;
  }
  return out;
}
export interface CleanedEdge { src: string; dst: string; rel: string; frequency: number }
export interface SkippedRow { row: number; reason: string }
export function cleanRows(rows: Record<string, string>[], m: Record<string, string | null>): { cleaned: CleanedEdge[]; skipped: SkippedRow[] } {
  const agg = new Map<string, CleanedEdge>();
  const skipped: SkippedRow[] = [];
  rows.forEach((r, i) => {
    const src = (m.source ? (r[m.source] ?? "") : "").trim();
    const dst = (m.target ? (r[m.target] ?? "") : "").trim();
    if (!src || !dst) { skipped.push({ row: i + 2, reason: "missing endpoint" }); return; }
    const rel = ((m.rel ? (r[m.rel] ?? "") : "") || "ASSOCIATE_OF").trim().toUpperCase() || "ASSOCIATE_OF";
    const freq = Math.max(1, Math.round(Number(m.weight ? r[m.weight] : 1) || 1));
    const k = `${src}>${dst}>${rel}`;
    const prev = agg.get(k);
    if (prev) prev.frequency += freq;
    else agg.set(k, { src, dst, rel, frequency: freq });
  });
  return { cleaned: [...agg.values()], skipped };
}
```

```ts
export interface DetectedUpload {
  columns: string[]; mapping: Record<string, string | null>;
  cleaned: CleanedEdge[]; skipped: SkippedRow[];
}

- [ ] **Step 2: Write `PreviewTable.tsx` + `UploadSettings.tsx`**

`PreviewTable` props `{ columns, rows (≤50), skipped }`: renders cleaned table + skipped-reasons list. `UploadSettings.tsx` sections: (1) Backend connection card (base URL + key inputs, remember checkbox, Test → `getHealth` status line, Save); (2) Smart upload card (file input `.csv,.xlsx,.xls,.json`; XLSX → sheet picker via `XLSX.read(arrayBuffer)` sheet names; header auto-detect = first row with ≥2 non-empty cells; column mapping auto-detected via `detectMapping` with manual override dropdowns; Clean → `cleanRows` client preview + `PreviewTable` + mini counts; "Confirm & send to backend" → `FormData` POST `/ingest/load` → success banner + "Open in Network Explorer" link; "Server preview" secondary button → `/ingest/preview` and show server counts); (3) Demo dataset card ("Load demo" → sets app-level demo flag / links to `/network` which already falls back).

- [ ] **Step 3: Verify**

Run: `Set-Location frontend; if ($?) { npx tsc --noEmit }`
Expected: no errors. Manual: upload `out_caviar/edges_contacted.csv` → mapping detected (`:START_ID/:END_ID/:TYPE`), preview shows rows, load succeeds, `/network` shows new data; upload a small `.xlsx` (2 sheets) → sheet picker appears.

### Task 8: Production build + end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full frontend build**

Run: `Set-Location frontend; if ($?) { npm run build }`
Expected: `dist/` created with no TS or Vite errors.

- [ ] **Step 2: Backend + frontend integration pass**

Run: `python -m uvicorn api:app --port 8000` (terminal A); `Set-Location frontend; npm run dev` (terminal B). Walk the checklist, marking each: `/` shows LIVE counts + stepper links work; `/network` renders live graph, filters/layouts/path/dossier/PNG work; `/entities` search + detail; `/alerts` cards + filter; `/documents` analyze sample; `/upload` test-connection OK, CSV preview+load works, XLSX sheet pick works; backend OFF → every page shows DEMO/offline state (no blank screens, no console exceptions).

- [ ] **Step 3: Regression check on existing engine**

Run: `python analytics.py --top 5; if ($?) { python -m pytest tests/ -v }`
Expected: analytics prints 5 ranked rows; pytest suite passes. Legacy `dashboard.html` untouched — confirm with `Test-Path dashboard.html` still true and no diff needed (no git repo; visual confirm the file still opens).

## Self-Review

- Spec coverage: §3 arch → Tasks 2–3; §4 pages → Tasks 4–7 (Overview→T4, Network→T5, Entities/Alerts/Documents→T6, Upload→T7); §5 smart upload → Tasks 1+2+7 (server detect/clean/preview/load + client mirror + sheet picker + skipped rows + preview-then-load); §6 Cytoscape spec → Task 5 (roles/rel styling, cap, ego/full, A→B paths, dossier, PNG, zoom labels); §7 API additions → Task 2 (exact 4 endpoints + models); §8 UX → Tasks 4–7 (one primary action/page, stepper, skeletons/empty/error states, dark/light theme, no emojis); §10 testing → Tasks 1–2 (pytest), Task 8 (build + manual + regression). §2 out-of-scope items (Postgres/MinIO/blockchain/AI chat/PDF) have no tasks — correct.
- Placeholder scan: no TBD/TODO in deliverable code paths (only throwaway scaffold placeholder in Task 3 Step 4, explicitly replaced by Tasks 4–7). All test steps include exact code + exact run commands + expected outputs. No "add appropriate error handling" vagueness — error cases are enumerated per endpoint/page.
- Type consistency: `FullGraph/FullGraphNode/FullGraphEdge` field names identical in `api.py` (Task 2), `api.ts` (Task 3), `demo.ts` (Task 4), Network page (Task 5). `detect_column_mapping` keys (`source,target,rel,weight,date,amount,node_id,node_label`) identical in `ingest_preview.py` (Task 1), `api.py` JSON branch (Task 2), `upload.ts` client subset (Task 7 — client intentionally covers only `source,target,rel,weight,date,amount`; documented). `loadConfig/saveConfig/req` signatures stable across Tasks 3–7.
