"""
Criminal-network investigation API.

Exposes the graph (graph_store.GraphStore) + analytics (analytics.py,
suspicious_patterns.py) + document intel (doc_intel.py, nlp_pipeline.py)
as REST endpoints for a React frontend.

Run:
    uvicorn backend.api:app --reload --port 8000
    # or
    python -m backend.api

Auth: every request (except /, /health, /docs, /redoc, /openapi.json)
must carry the API key as:
    X-API-Key: <key>   (recommended)
    Authorization: Bearer <key>
    ?api_key=<key>     (convenience for visualisation iframes)

Config via environment:
    API_KEY=...                 (default "dev-key-change-me", do NOT ship that)
    FRONTEND_ORIGINS=http://localhost:3000,http://localhost:5173
    NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD   (unset = NetworkX fallback)
    CAVIAR_DIR=out_caviar  ENRON_DIR=out_enron
    ENRON_MAX_EDGES=5000    (Enron *_agg file is ~100MB; cap rows per file)
    EVENT_DATES=1994-04-03  (comma-separated, used by /analytics/alerts)
    SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (optional)
"""
import csv
import io
import json
import os
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

# Load .env next to this file (local dev convenience) so API_KEY etc.
# work without manual `$env:` setup. Real env vars still take precedence.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:  # dotenv optional — plain env vars still work
    pass

# Enron's aggregated edges file has a giant `timestamps` column that blows
# past Python's default csv field limit -> raise it before graph_store loads.
csv.field_size_limit(sys.maxsize)

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# ------------------------------------------------------------------ config ---
API_KEY = os.getenv("API_KEY", "dev-key-change-me")
FRONTEND_ORIGINS = [o.strip() for o in
                    os.getenv("FRONTEND_ORIGINS",
                              "http://localhost:3000,http://localhost:5173,"
                              "http://127.0.0.1:3000,http://127.0.0.1:5173")
                    .split(",") if o.strip()]
NEO4J_URI = os.getenv("NEO4J_URI") or None
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
CAVIAR_DIR = os.getenv("CAVIAR_DIR", "out_caviar")
ENRON_DIR = os.getenv("ENRON_DIR", "out_enron")
ENRON_MAX_EDGES = int(os.getenv("ENRON_MAX_EDGES", "5000"))
EVENT_DATES = [d.strip() for d in os.getenv("EVENT_DATES", "").split(",")
               if d.strip()]
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_REQUIRE_AUTH = os.getenv("SUPABASE_REQUIRE_AUTH", "false").lower() in ("1", "true", "yes")
PUBLIC_PATHS = {"/", "/health", "/docs", "/redoc", "/openapi.json",
                "/openapi.yaml", "/workspace/analyze", "/workspace/documents", "/workspace/resolve"}

if API_KEY == "dev-key-change-me":
    print("WARNING: running with default API_KEY — set API_KEY env var.",
          file=sys.stderr)

# ------------------------------------------------------------------ models ---
class EntityDetail(BaseModel):
    id: str
    label: str = "Person"
    name: str = ""
    source: str = ""
    degree: int = 0
    in_degree: int = 0
    out_degree: int = 0
    community_id: Optional[int] = None
    role: Optional[str] = None
    influence_score: Optional[float] = None
    properties: Dict[str, Any] = {}
    neighbours_sample: List[str] = []


class NetworkNode(BaseModel):
    id: str
    label: str = "Person"
    name: str = ""
    community_id: Optional[int] = None
    role: Optional[str] = None
    influence_score: Optional[float] = None


class NetworkEdge(BaseModel):
    src: str
    dst: str
    rel: str = "ASSOCIATE_OF"
    frequency: int = 1
    extra: Dict[str, Any] = {}


class EgoNetwork(BaseModel):
    center: str
    depth: int
    nodes: List[NetworkNode]
    edges: List[NetworkEdge]


class PathResponse(BaseModel):
    source: str
    target: str
    path: List[str]
    length: int


class KeyPlayer(BaseModel):
    person_id: str
    name: str
    influence_score: float
    community_id: int
    role: str
    centrality_breakdown: Dict[str, Any]


class KeyPlayersResponse(BaseModel):
    players: List[KeyPlayer]
    total: int


class CommunityMember(BaseModel):
    person_id: str
    name: str
    role: str
    influence_score: float


class Community(BaseModel):
    community_id: int
    size: int
    leader: Optional[str] = None
    members: List[CommunityMember]


class CommunitiesResponse(BaseModel):
    communities: List[Community]
    total: int


class Alert(BaseModel):
    entities_involved: List[str]
    pattern_type: str
    evidence: Dict[str, Any] = {}
    severity_score: float
    plain_language_explanation: str = ""
    source_dataset: str = ""


class AlertsResponse(BaseModel):
    flags: List[Alert]
    skipped: Dict[str, Any] = {}
    total: int


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="name / phone / plate")
    limit: int = Field(10, ge=1, le=100)
    threshold: float = Field(60.0, ge=0, le=100,
                             description="min fuzzy score 0..100")
    entity_type: Optional[str] = Field(
        None, description="filter: Person | Vehicle | Location")


class SearchResult(BaseModel):
    id: str
    label: str
    name: str
    score: float
    match_type: str = "fuzzy"


class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
    total: int


class DocAnalyzeResponse(BaseModel):
    doc_id: str
    summary: str = ""
    classification: Dict[str, Any] = {}
    triples: List[Dict[str, Any]] = []
    entities: List[Dict[str, Any]] = []
    warnings: List[str] = []


# -------------------------------------------------------------- auth (API key) ---
class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/workspace/") and SUPABASE_REQUIRE_AUTH:
            auth = request.headers.get("authorization", "")
            if not auth.lower().startswith("bearer ") or not SUPABASE_URL or not SUPABASE_ANON_KEY:
                return JSONResponse({"detail": "Sign in to use backend analysis."}, status_code=401)
            try:
                import httpx
                async with httpx.AsyncClient(timeout=8) as client:
                    response = await client.get(f"{SUPABASE_URL}/auth/v1/user", headers={"Authorization": auth, "apikey": SUPABASE_ANON_KEY})
                if response.status_code != 200:
                    return JSONResponse({"detail": "Your session is invalid or expired."}, status_code=401)
                request.state.user = response.json()
            except Exception:
                return JSONResponse({"detail": "Authentication service is unavailable."}, status_code=503)
            return await call_next(request)
        if request.url.path in PUBLIC_PATHS or \
                request.url.path.startswith("/docs"):
            return await call_next(request)
        supplied = (request.headers.get("x-api-key")
                    or request.query_params.get("api_key"))
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            supplied = supplied or auth[7:].strip()
        if not supplied or supplied != API_KEY:
            return JSONResponse({"detail": "Invalid or missing API key."},
                                status_code=401)
        return await call_next(request)


# ------------------------------------------------------------ app + lifespan ---
store = None          # GraphStore, set in lifespan
_ranked_cache: Optional[list] = None
_rank_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    from .graph_store import GraphStore
    if NEO4J_URI:
        store = GraphStore(uri=NEO4J_URI, user=NEO4J_USER,
                           password=NEO4J_PASSWORD)
        store.ensure_schema()
        print(f"connected to Neo4j at {NEO4J_URI}", file=sys.stderr)
    else:
        store = GraphStore(fallback=True)
    # Load the deduped canonical files explicitly: nodes from both sets,
    # caviar edges_contacted + enron edges_emailed_agg only. (Loading by
    # directory glob would also pick up caviar_edges.csv / enron_edges.csv,
    # which duplicate the same networks and double all frequencies.)
    stats = {"nodes": 0, "edges": 0, "files": []}
    jobs = [(os.path.join(CAVIAR_DIR, "nodes_person.csv"), "nodes", None),
            (os.path.join(ENRON_DIR, "nodes_person.csv"), "nodes", None),
            (os.path.join(CAVIAR_DIR, "edges_contacted.csv"), "edges", None),
            (os.path.join(ENRON_DIR, "edges_emailed_agg.csv"), "edges",
             ENRON_MAX_EDGES or None)]
    for path, kind, limit in jobs:
        if not os.path.exists(path):
            continue
        try:
            c = (store.load_nodes_file(path) if kind == "nodes"
                 else store.load_edges_file(path, limit=limit))
        except Exception as e:
            print(f"load failed for {path}: {e}", file=sys.stderr)
            continue
        stats[kind] += c
        stats["files"].append((path, f"{c} {kind}"))
    print(f"graph loaded: {stats}", file=sys.stderr)
    yield
    try:
        store.close()
    except Exception:
        pass


app = FastAPI(title="X-Tracer Investigation API", version="1.0.0",
              lifespan=lifespan)
from .workspace import router as workspace_router
from .request_limits import WorkspaceBodyLimit
app.include_router(workspace_router)
app.add_middleware(ApiKeyMiddleware)
app.add_middleware(WorkspaceBodyLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-API-Key", "Authorization"],
)


def _require_store():
    if store is None:
        raise HTTPException(503, "Graph store not initialised yet.")
    return store


def _fallback_key(entity_id: str):
    """(label, id) tuple key for any node with this id (fallback graphs)."""
    for label in ("Person", "Vehicle", "Location"):
        key = (label, entity_id)
        if store.G.has_node(key):
            return key
    return None


def _node_props(key) -> dict:
    d = dict(store.G.nodes[key])
    d.pop("node_label", None)
    return d


def _display_name(label: str, eid: str, props: dict) -> str:
    return (props.get("label") or props.get("name") or props.get("raw_id")
            or eid)


def _ranked() -> list:
    """analytics.analyze() result, computed once and cached."""
    global _ranked_cache
    with _rank_lock:
        if _ranked_cache is None:
            from .analytics import analyze
            _ranked_cache = analyze(_require_store())
        return _ranked_cache


def _rank_index() -> dict:
    return {r["person_id"]: r for r in _ranked()}


def _entity_or_404(entity_id: str):
    s = _require_store()
    if getattr(s, "fallback", False):
        key = _fallback_key(entity_id)
        if key is None:
            raise HTTPException(404, f"Entity {entity_id!r} not found.")
        return key
    with s.driver.session() as sess:
        rec = sess.run("MATCH (n {id:$id}) RETURN labels(n) AS l, "
                       "properties(n) AS p", id=entity_id).single()
    if not rec:
        raise HTTPException(404, f"Entity {entity_id!r} not found.")
    return rec


def _ego_fallback(center_key, depth: int):
    G = store.G
    seen, frontier = {center_key}, {center_key}
    for _ in range(depth):
        nxt = set()
        for n in frontier:
            nxt.update(G.successors(n))
            nxt.update(G.predecessors(n))
        nxt -= seen
        seen.update(nxt)
        frontier = nxt
        if not frontier:
            break
    H = G.subgraph(seen)
    rank = {}
    try:
        rank = _rank_index()
    except Exception:
        pass
    nodes = []
    for (label, eid), d in H.nodes(data=True):
        props = {k: v for k, v in d.items() if k != "node_label"}
        r = rank.get(eid, {})
        nodes.append(NetworkNode(
            id=eid, label=label, name=_display_name(label, eid, props),
            community_id=r.get("community_id"), role=r.get("role"),
            influence_score=r.get("influence_score")))
    edges = []
    for (ls, s), (ld, t), d in H.edges(data=True):
        extra = {k: v for k, v in d.items()
                 if k not in ("rel", "frequency")}
        # timestamps/transactions lists may be long — truncate for the UI
        for k in ("timestamps",):
            if isinstance(extra.get(k), list) and len(extra[k]) > 10:
                extra[k] = extra[k][:10] + [f"... +{len(extra[k]) - 10} more"]
        edges.append(NetworkEdge(src=s, dst=t, rel=d.get("rel", "ASSOCIATE_OF"),
                                 frequency=int(d.get("frequency", 1) or 1),
                                 extra=extra))
    return nodes, edges


# ------------------------------------------------------------------ routes ---
@app.get("/", summary="Service info (public)")
def root():
    return {"service": "criminal-network-api", "version": "1.0.0",
            "auth": "X-API-Key header required (except / and /health)"}


@app.get("/health", summary="Liveness probe (public)")
def health():
    ok = store is not None
    return {"status": "ok" if ok else "starting",
            "backend": ("fallback" if getattr(store, "fallback", True)
                        else "neo4j") if ok else None,
            "supabase": {"configured": bool(SUPABASE_URL and
                                                (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)),
                         "auth_required": SUPABASE_REQUIRE_AUTH,
                         "url": SUPABASE_URL or None}}


@app.get("/stats", summary="Node / edge counts")
def stats():
    s = _require_store()
    if getattr(s, "fallback", False):
        from collections import Counter
        kinds = Counter(d.get("node_label", "?")
                        for _, d in s.G.nodes(data=True))
        return {"nodes": s.G.number_of_nodes(),
                "edges": s.G.number_of_edges(),
                "nodes_by_label": dict(kinds)}
    with s.driver.session() as sess:
        n = sess.run("MATCH (n) RETURN count(n) AS c").single()["c"]
        e = sess.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
    return {"nodes": n, "edges": e}


@app.get("/entities/{entity_id}", response_model=EntityDetail,
         summary="Entity details")
def get_entity(entity_id: str):
    s = _require_store()
    if getattr(s, "fallback", False):
        key = _entity_or_404(entity_id)
        label, eid = key
        props = _node_props(key)
        nbrs = sorted({n[1] for n in s.G.successors(key)} |
                      {n[1] for n in s.G.predecessors(key)})
        r = _rank_index().get(eid, {})
        return EntityDetail(
            id=eid, label=label, name=_display_name(label, eid, props),
            source=str(props.get("source", "")),
            degree=s.G.degree(key),
            in_degree=s.G.in_degree(key), out_degree=s.G.out_degree(key),
            community_id=r.get("community_id"), role=r.get("role"),
            influence_score=r.get("influence_score"),
            properties={k: v for k, v in props.items()
                        if k not in ("label", "id")},
            neighbours_sample=nbrs[:20])
    rec = _entity_or_404(entity_id)
    label = rec["l"][0] if rec["l"] else "Person"
    props = dict(rec["p"])
    with s.driver.session() as sess:
        deg = sess.run("MATCH (n {id:$id})-[r]-() RETURN count(r) AS c",
                       id=entity_id).single()["c"]
        nbrs = [r["nid"] for r in sess.run(
            "MATCH (n {id:$id})--(m) RETURN DISTINCT m.id AS nid LIMIT 20",
            id=entity_id)]
    r = _rank_index().get(entity_id, {})
    return EntityDetail(
        id=entity_id, label=label,
        name=str(props.get("label") or props.get("name") or entity_id),
        source=str(props.get("source", "")),
        degree=deg, in_degree=deg, out_degree=deg,
        community_id=r.get("community_id"), role=r.get("role"),
        influence_score=r.get("influence_score"),
        properties={k: v for k, v in props.items()
                    if k not in ("label", "id")},
        neighbours_sample=nbrs)


@app.get("/entities/{entity_id}/network", response_model=EgoNetwork,
         summary="Ego network for visualisation")
def get_network(entity_id: str, depth: int = Query(2, ge=1, le=5)):
    s = _require_store()
    if getattr(s, "fallback", False):
        center = _entity_or_404(entity_id)
        nodes, edges = _ego_fallback(center, depth)
        return EgoNetwork(center=center[1], depth=depth,
                          nodes=nodes, edges=edges)
    _entity_or_404(entity_id)  # 404 if missing
    depth = max(1, min(int(depth), 5))
    with s.driver.session() as sess:
        recs = list(sess.run(
            "MATCH (p {id:$pid}), path=(p)-[*0.." + str(depth) + "]-(q) "
            "WITH collect(DISTINCT q) AS qs "
            "UNWIND qs AS n OPTIONAL MATCH (n)-[e]-(m) WHERE m IN qs "
            "RETURN collect(DISTINCT n) AS nodes, "
            "collect(DISTINCT e) AS rels", pid=entity_id))
    rank = {}
    try:
        rank = _rank_index()
    except Exception:
        pass
    nodes, edges, seen_e = [], [], set()
    for rec in recs:
        for n in (rec["nodes"] or []):
            if n is None:
                continue
            nid = n["id"]
            r = rank.get(nid, {})
            nodes.append(NetworkNode(
                id=nid, label=list(n.labels)[0] if list(n.labels) else "?",
                name=str(dict(n.items()).get("label", nid)),
                community_id=r.get("community_id"), role=r.get("role"),
                influence_score=r.get("influence_score")))
        for e in (rec["rels"] or []):
            if e is None or e.id in seen_e:
                continue
            seen_e.add(e.id)
            props = dict(e.items())
            edges.append(NetworkEdge(
                src=e.start_node["id"], dst=e.end_node["id"], rel=e.type,
                frequency=int(props.pop("frequency", 1) or 1),
                extra=props))
        break
    return EgoNetwork(center=entity_id, depth=depth, nodes=nodes, edges=edges)


@app.get("/entities/{entity_id}/shortest-path/{other_id}",
         response_model=PathResponse, summary="Shortest path between entities")
def shortest_path(entity_id: str, other_id: str):
    s = _require_store()
    if getattr(s, "fallback", False):
        a, b = _fallback_key(entity_id), _fallback_key(other_id)
        if a is None:
            raise HTTPException(404, f"Entity {entity_id!r} not found.")
        if b is None:
            raise HTTPException(404, f"Entity {other_id!r} not found.")
        import networkx as nx
        try:
            seq = nx.shortest_path(s.G.to_undirected(as_view=True), a, b)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            raise HTTPException(404, f"No path between {entity_id!r} and "
                                     f"{other_id!r}.")
        ids = [n[1] for n in seq]
        return PathResponse(source=entity_id, target=other_id, path=ids,
                            length=len(ids) - 1)
    _entity_or_404(entity_id)
    _entity_or_404(other_id)
    with s.driver.session() as sess:
        rec = sess.run("MATCH (a {id:$a}), (b {id:$b}), "
                       "p=shortestPath((a)-[*]-(b)) "
                       "RETURN [n IN nodes(p) | n.id] AS path",
                       a=entity_id, b=other_id).single()
    if not rec or not rec["path"]:
        raise HTTPException(404, f"No path between {entity_id!r} and "
                                 f"{other_id!r}.")
    return PathResponse(source=entity_id, target=other_id,
                        path=list(rec["path"]), length=len(rec["path"]) - 1)


@app.get("/analytics/key-players", response_model=KeyPlayersResponse,
         summary="Ranked influencers")
def key_players(limit: int = Query(20, ge=1, le=200)):
    ranked = _ranked()
    return KeyPlayersResponse(
        players=[KeyPlayer(**r) for r in ranked[:limit]], total=len(ranked))


@app.get("/analytics/communities", response_model=CommunitiesResponse,
         summary="Detected communities with member lists")
def communities():
    from collections import defaultdict
    groups: Dict[int, list] = defaultdict(list)
    for r in _ranked():
        groups[r["community_id"]].append(r)
    out = []
    for cid in sorted(groups):
        ms = sorted(groups[cid], key=lambda r: -r["influence_score"])
        leader = next((m["person_id"] for m in ms if m["role"] == "leader"),
                      ms[0]["person_id"] if ms else None)
        out.append(Community(
            community_id=cid, size=len(ms), leader=leader,
            members=[CommunityMember(person_id=m["person_id"], name=m["name"],
                                     role=m["role"],
                                     influence_score=m["influence_score"])
                     for m in ms]))
    return CommunitiesResponse(communities=out, total=len(out))


@app.get("/analytics/alerts", response_model=AlertsResponse,
         summary="Flagged suspicious patterns")
def alerts(source_dataset: str = Query("combined"),
           event_date: Optional[List[str]] = Query(None)):
    from .suspicious_patterns import detect_all
    dates = event_date if event_date else EVENT_DATES
    try:
        central = _ranked()
    except Exception:
        central = []
    flags, skipped = detect_all(_require_store(),
                                source_dataset=source_dataset,
                                event_dates=dates or (),
                                central=central)
    return AlertsResponse(flags=[Alert(**f) for f in flags],
                          skipped=skipped, total=len(flags))


@app.post("/search", response_model=SearchResponse,
          summary="Fuzzy search entities by name / phone / vehicle")
def search(req: SearchRequest):
    from rapidfuzz import fuzz, process
    try:
        from .entity_resolution import (normalize_phone, normalize_vehicle)
    except ImportError:  # light fallback if module missing
        import re
        def normalize_phone(t):
            d = re.sub(r"\D", "", t or "")
            if len(d) == 12 and d.startswith("91"):
                d = d[2:]
            elif len(d) == 11 and d[0] in ("0", "1"):
                d = d[1:]
            return d
        def normalize_vehicle(t):
            return re.sub(r"[\s\-]", "", (t or "").upper())

    s = _require_store()
    if getattr(s, "fallback", False):
        index = []
        for (label, eid), d in s.G.nodes(data=True):
            if req.entity_type and label != req.entity_type:
                continue
            index.append((label, eid,
                          _display_name(label, eid,
                                        {k: v for k, v in d.items()
                                         if k != "node_label"})))
    else:
        filt = "WHERE $t IS NULL OR $t IN labels(n)" \
            if req.entity_type else ""
        with s.driver.session() as sess:
            recs = sess.run(
                f"MATCH (n) {filt} RETURN labels(n) AS l, n.id AS id, "
                f"coalesce(n.label, n.name, n.id) AS nm",
                t=req.entity_type)
            index = [(r["l"][0] if r["l"] else "?", r["id"], str(r["nm"]))
                     for r in recs]

    q = req.query.strip()
    if not q:
        raise HTTPException(400, "Empty query.")
    results: List[SearchResult] = []

    # 1) exact id hit always wins
    for label, eid, nm in index:
        if eid == q:
            results.append(SearchResult(id=eid, label=label, name=nm,
                                        score=100.0, match_type="exact_id"))
            break

    # 2) normalized phone / vehicle exact match (cross-format, e.g. +91...)
    # Guard: normalized query must look like a real phone (>= 7 digits) or
    # plate (>= 6 chars), otherwise digit fragments inside email ids would
    # false-positive (e.g. "caviar:1" normalizes to just "1").
    nq_phone, nq_veh = normalize_phone(q), normalize_vehicle(q)
    phone_like = len(nq_phone) >= 7
    plate_like = len(nq_veh) >= 6
    for label, eid, nm in index:
        if any(r.id == eid for r in results):
            continue
        if phone_like and normalize_phone(eid) == nq_phone:
            results.append(SearchResult(id=eid, label=label, name=nm,
                                        score=100.0, match_type="phone"))
        elif plate_like and normalize_vehicle(eid) == nq_veh:
            results.append(SearchResult(id=eid, label=label, name=nm,
                                        score=100.0, match_type="vehicle"))

    # 3) fuzzy name match
    names = [nm for _, _, nm in index]
    if len(results) < req.limit and names:
        for nm, score, i in process.extract(
                q, names, scorer=fuzz.token_set_ratio, limit=req.limit * 2):
            if score < req.threshold:
                continue
            label, eid, _ = index[i]
            if any(r.id == eid for r in results):
                continue
            mtype = "substring" if q.lower() in (nm or "").lower() \
                else "fuzzy"
            results.append(SearchResult(id=eid, label=label, name=nm,
                                        score=round(float(score), 1),
                                        match_type=mtype))
            if len(results) >= req.limit:
                break
    results.sort(key=lambda r: -r.score)
    return SearchResponse(query=q, results=results[:req.limit],
                          total=len(results[:req.limit]))


@app.post("/documents/analyze", response_model=DocAnalyzeResponse,
          summary="NER + summarisation on an uploaded document")
async def analyze_document(
        file: Optional[UploadFile] = File(None),
        text: Optional[str] = Form(None),
        doc_id: Optional[str] = Form(None),
        source: str = Form("own_dataset")):
    if file is not None:
        raw = await file.read(500_001)
        if len(raw) > 500_000:
            raise HTTPException(400, "File too large (max ~500KB text).")
        content = raw.decode("utf-8", errors="ignore")
        doc_id = doc_id or file.filename or "upload"
    elif text:
        content = text
        doc_id = doc_id or "inline"
    else:
        raise HTTPException(400, "Provide either `file` or `text`.")
    if not content.strip():
        raise HTTPException(400, "Empty document.")

    warnings: List[str] = []
    summary, classification, triples, entities = "", {}, [], []

    try:
        from .doc_intel import DocIntel
        d = DocIntel(source=source if source in
                     ("own_dataset", "enron") else "own_dataset")
        try:
            summary = d.summarize(content)
        except Exception as e:
            warnings.append(f"summarizer failed: {e}")
            summary = content[:600]
        try:
            classification = d.classify(content)
        except Exception as e:
            warnings.append(f"classifier failed: {e}")
        try:
            triples = d.triples(content)
        except Exception as e:
            warnings.append(f"triple extraction unavailable ({e}); "
                            f"install en_core_web_sm for full output.")
    except Exception as e:
        warnings.append(f"doc_intel unavailable: {e}")

    try:
        from .nlp_pipeline import CrimeNerPipeline
        pipe = CrimeNerPipeline(source=source if source in
                                ("own_dataset", "enron") else "own_dataset")
        entities = pipe.extract(doc_id, content)["entities"]
    except Exception as e:
        warnings.append(f"NER unavailable ({e}); "
                        f"install en_core_web_sm for full output.")

    # strip non-JSON-safe / oversized internals before returning
    safe_triples = []
    for t in triples:
        t = dict(t)
        t.pop("src", None)
        for k, v in list(t.items()):
            if isinstance(v, str) and len(v) > 1000:
                t[k] = v[:1000] + "…"
        safe_triples.append(t)
    return DocAnalyzeResponse(doc_id=doc_id, summary=summary,
                              classification=classification,
                              triples=safe_triples, entities=entities,
                              warnings=warnings)


@app.post("/admin/reload", summary="Reload graph + clear analytics cache")
def admin_reload(max_edges: Optional[int] = None):
    s = _require_store()
    if getattr(s, "fallback", False):
        s.clear_all()
    stats = {"nodes": 0, "edges": 0, "files": []}
    jobs = [(os.path.join(CAVIAR_DIR, "nodes_person.csv"), "nodes", None),
            (os.path.join(ENRON_DIR, "nodes_person.csv"), "nodes", None),
            (os.path.join(CAVIAR_DIR, "edges_contacted.csv"), "edges", None),
            (os.path.join(ENRON_DIR, "edges_emailed_agg.csv"), "edges",
             max_edges if max_edges is not None else ENRON_MAX_EDGES or None)]
    for path, kind, limit in jobs:
        if not os.path.exists(path):
            continue
        c = (s.load_nodes_file(path) if kind == "nodes"
             else s.load_edges_file(path, limit=limit))
        stats[kind] += c
        stats["files"].append((path, f"{c} {kind}"))
    global _ranked_cache
    with _rank_lock:
        _ranked_cache = None
    return {"reloaded": stats}


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


@app.get("/graph/full", response_model=FullGraphResponse,
         summary="Capped full graph for Cytoscape")
def graph_full(limit: int = Query(600, ge=50, le=2000)):
    s = _require_store()
    try:
        rank = _rank_index()
    except Exception:
        rank = {}
    if getattr(s, "fallback", False):
        G = s.G
        order = sorted(G.nodes(data=True),
                       key=lambda kv: -(rank.get(kv[0][1], {}).get(
                           "influence_score") or 0))
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
        edges = []
        for (ls, a), (ld, b), d in G.edges(data=True):
            if (ls, a) not in keep or (ld, b) not in keep:
                continue
            if len(edges) >= limit * 2:
                continue
            edges.append(FullGraphEdge(
                id=f"{a}>{b}>{d.get('rel', '?')}", src=a, dst=b,
                rel=str(d.get("rel", "ASSOCIATE_OF")),
                frequency=int(d.get("frequency", 1) or 1)))
        return FullGraphResponse(nodes=nodes, edges=edges,
                                 truncated=total_nodes > len(nodes),
                                 total_nodes=total_nodes,
                                 total_edges=total_edges)
    with s.driver.session() as sess:
        n = sess.run("MATCH (n) RETURN count(n) AS c").single()["c"]
        e = sess.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
        recs = list(sess.run(
            "MATCH (n) RETURN n.id AS id, labels(n)[0] AS label, "
            "coalesce(n.label, n.name, n.id) AS nm LIMIT $lim", lim=limit))
    nodes = [FullGraphNode(
        id=r["id"], label=r["label"] or "Person",
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
        paths = s.get_all_paths_within_hops(a, b, max_hops=max_hops,
                                            limit=limit)
    except Exception:
        paths = []
    if not paths:
        _entity_or_404(a)
        _entity_or_404(b)
    return PathsResponse(source=a, target=b,
                         paths=[list(p) for p in paths], count=len(paths))


def _parse_ingest_upload(filename: str, raw: bytes,
                         sheet: Optional[str], mapping_json: Optional[str] = None):
    from .ingest_preview import (clean_edge_rows, detect_column_mapping,
                                parse_upload_file)
    rows_raw, meta = parse_upload_file(filename, raw, sheet)
    if meta["kind"] == "json":
        mapping = {"source": "src", "target": "dst", "rel": "rel",
                   "weight": "frequency", "date": "date", "amount": "amount",
                   "node_id": None, "node_label": None}
        columns = ["src", "dst", "rel", "frequency", "date", "amount"]
    else:
        columns = list(rows_raw[0].keys()) if rows_raw else []
        mapping = detect_column_mapping(columns)
    if mapping_json is not None:
        try:
            override = json.loads(mapping_json)
        except (TypeError, ValueError) as e:
            raise ValueError("Invalid column mapping JSON.") from e
        if not isinstance(override, dict) or any(
            role not in mapping or (column is not None and
            (not isinstance(column, str) or column not in columns))
            for role, column in override.items()
        ):
            raise ValueError("Mapping must reference columns in the uploaded file.")
        mapping.update(override)
    cleaned, skipped = clean_edge_rows(rows_raw, mapping)
    from .graph_store import EDGE_KIND_MAP
    unsupported = sorted({row["rel"] for row in cleaned if row["rel"] not in EDGE_KIND_MAP})
    if unsupported:
        raise ValueError("Unsupported relationship types: " + ", ".join(unsupported) + ". Use " + ", ".join(EDGE_KIND_MAP) + ".")
    return meta, columns, mapping, cleaned, skipped


@app.post("/ingest/preview", response_model=IngestPreviewResponse,
          summary="Preview smart-upload detection + cleaning (no persistence)")
async def ingest_preview(file: UploadFile = File(...),
                         sheet: Optional[str] = Form(None),
                         mapping: Optional[str] = Form(None)):
    raw = await file.read(5_000_001)
    try:
        meta, columns, mapping, cleaned, skipped = _parse_ingest_upload(
            file.filename or "upload", raw, sheet, mapping)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not cleaned:
        raise HTTPException(400, {"message": "No usable rows found.",
                                  "skipped": skipped})
    node_ids = {c["src"] for c in cleaned} | {c["dst"] for c in cleaned}
    return IngestPreviewResponse(
        filename=file.filename or "upload", kind=meta["kind"],
        sheet=meta.get("sheet"), columns=columns, mapping=mapping,
        rows_cleaned=len(cleaned), node_count=len(node_ids),
        edge_count=len(cleaned), preview=cleaned[:50], skipped=skipped)


@app.post("/ingest/load", response_model=IngestLoadResponse,
          summary="Load a cleaned upload into the graph")
async def ingest_load(file: UploadFile = File(...),
                      sheet: Optional[str] = Form(None),
                         mapping: Optional[str] = Form(None)):
    raw = await file.read(5_000_001)
    try:
        meta, columns, mapping, cleaned, skipped = _parse_ingest_upload(
            file.filename or "upload", raw, sheet, mapping)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not cleaned:
        raise HTTPException(400, {"message": "No usable rows found.",
                                  "skipped": skipped})
    s = _require_store()
    rel_rows = [{"src": c["src"], "dst": c["dst"], "rel": c["rel"],
                 "frequency": c["frequency"],
                 **({"date": c["date"], "timestamps": [c["date"]]} if c.get("date") else {}),
                 **({"amount": c["amount"]} if c.get("amount") else {})}
                for c in cleaned]
    n = s.load_relationships(rel_rows)
    global _ranked_cache
    with _rank_lock:
        _ranked_cache = None
    node_ids = {c["src"] for c in cleaned} | {c["dst"] for c in cleaned}
    return IngestLoadResponse(loaded={"nodes": len(node_ids), "edges": n},
                              skipped=skipped,
                              note=f"Loaded {len(cleaned)} cleaned rows "
                                   f"from {meta['kind']}.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.api:app", host="0.0.0.0",
                port=int(os.getenv("PORT", "8000")), reload=True)
