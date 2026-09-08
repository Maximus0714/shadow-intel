# Frontend Redesign — Multi-Page React + Cytoscape.js + FastAPI — Design Spec

Date: 2026-09-07
Status: Proposed (awaiting user review)
Source video: Shadow Intel — From Evidence to Intelligence | SIH26189 (HexHack, `qXS75gvT8_A`)
Video transcript + description pulled via yt-dlp (subtitles `shadowintel.en.vtt`, description block).
Current codebase: `C:\Users\viyom\OneDrive\Desktop\SIH` — `api.py` (FastAPI, X-API-Key auth, NetworkX fallback), `graph_store.py`, `analytics.py`, `suspicious_patterns.py`, single-file `dashboard.html/.css/.js` (mock/live/upload crammed into one workbench).

## 1. Problem

The current `dashboard.html` puts everything on one screen: mode switcher (mock/live/upload), case list, saved searches, watchlist, graph toolbar + SVG graph, key-entity ranking, flagged patterns, source-document viewer, dossier drawer, settings + upload dialogs. Users report it is confusing and hard to use.

Goal: redesign into a user-friendly, multi-page web app that keeps the existing Python/FastAPI intelligence engine, adopts the Shadow Intel "graph idea" from the video, uses Cytoscape.js + React + FastAPI, looks good, and makes upload smart (XLSX + CSV, auto-detect dataset shape, clean it, preview the graph).

## 2. Graph idea pulled from the video (evidence)

Transcript key lines (condensed):

- "Every investigation begins with fragmented information, reports, call records, transactions, locations, documents, and digital traces. But the real challenge is connecting these pieces into meaningful intelligence."
- "The workflow begins with intelligence ingestion, where reports, PDFs, CSVs, images, and other sources can be brought into the system. The platform processes this information, extracts entities and relationships, records provenance, and builds a structured intelligence layer."
- "At the heart of Shadow Intel is the network explorer, a live knowledge graph where investigators can visualize people, phone numbers, organizations, locations, documents, and their connections."
- "Instead of examining each record in isolation, investigators can explore how entities are connected and even identify paths between two selected entities."
- "The entity intelligence module then provides a focused dossier for important entities, showing their influence, centrality, connections, risk indicators, linked evidence, and relationship history."
- "Anomaly and risk analysis, combining rule-based signals, machine learning anomaly detection, and graph-based features… explainable… which evidence supports the signal."
- "The investigation timeline brings calls, transfers, locations, and other observations into a chronological view."
- "The AI investigation assistant provides evidence-backed answers… without replacing human judgment."
- "The evidence and reports module maintains the evidence repository, links evidence to entities and cases, records provenance and SHA-256 integrity information, and supports structured report generation."

Description block confirms stack: React/Next.js + Python + FastAPI + PostgreSQL + Neo4j + AI/NLP, human-in-the-loop, role-based workflow.

What we adopt (graph idea, scoped to this repo — no Postgres/MinIO/blockchain):

1. Multi-type knowledge-graph nodes: person, phone, organization, location, document (mapped from existing `Person`/`Vehicle`/`Location` labels + document entities from `doc_intel`/`nlp_pipeline`).
2. Typed edges: directed money movement vs undirected contact/co-location/kin, with strength/frequency + timestamps/evidence.
3. Network Explorer as the heart: full-graph view + ego-focus toggle, pan/zoom, layouts, click-node → dossier.
4. Path-between-two-entities highlight (already have single shortest path; extend to multi-path list).
5. Entity dossier: influence, centrality breakdown, connections, risk indicators (alerts touching the entity), linked evidence, relationship history (timeline/neighbours).
6. Explainable alerts: pattern type + plain-language explanation + evidence + severity, never an unexplained "guilt" score.
7. Evidence → intelligence pipeline made visible: Ingest → Clean → Graph → Alerts → Report stepper on Overview.
8. Human-in-the-loop: AI/NLP outputs shown with warnings + provenance, analyst confirms.

What we explicitly do NOT build (out of scope): Next.js SSR, PostgreSQL, MinIO, Hyperledger, auth roles, AI chat assistant, SHA-256 evidence vault, PDF report generation. Those stay future work.

## 3. Architecture

```
frontend/ (new Vite + React + TypeScript SPA)
  src/pages: Overview, NetworkExplorer, Entities, Alerts, Documents, UploadSettings
  src/components: Layout/Sidebar/Topbar, CytoscapeGraph, DossierPanel, AlertCard,
                  PipelineStepper, PreviewTable, ConnectionStatus
  src/lib: api.ts (Axios + X-API-Key), demo.ts (bundled fallback dataset),
           upload.ts (XLSX parse via SheetJS + CSV parse, detect, clean)
  cytoscape + cytoscape-cola (layouts), axios, xlsx, react-router-dom

api.py (existing FastAPI, extended — same process, same .env, same auth)
  keeps: /stats /entities/* /analytics/* /search /documents/analyze /admin/reload
  adds:  GET  /graph/full?limit=600
         GET  /entities/{a}/paths/{b}?max_hops=3&limit=10
         POST /ingest/preview + POST /ingest/load (smart XLSX/CSV upload with auto-detect + clean + preview).

graph_store.py / analytics.py / suspicious_patterns.py / entity_resolution.py — unchanged
except: ingest/load path reuses GraphStore.load_relationships() + clears _ranked_cache.
```

Decisions:

- TypeScript (user choice) over JavaScript for the whole `frontend/src`.
- Vite SPA with React Router (not Next.js) — no SSR needed, keeps `python -m http.server`/Vite dev proxy simple, CORS already allows :3000/:5173.
- No database change: NetworkX fallback stays default; Neo4j env vars still optional.
- Same `X-API-Key` auth on every new endpoint (middleware already covers non-public paths).
- Same `.env` (`API_KEY`, `CAVIAR_DIR`, `ENRON_DIR`, `ENRON_MAX_EDGES`, `EVENT_DATES`).
- Existing `dashboard.html/.css/.js` left untouched as legacy fallback until the new UI passes verification.

## 4. Pages — one job each (fixes "everything on one page")

| # | Route | Job | Contents |
|---|-------|-----|----------|
| 1 | `/` Overview | "Where am I?" landing | Backend status card (health + node/edge counts + backend type), pipeline stepper Ingest→Clean→Graph→Alerts→Report (each step links to its page), top-5 key players preview, top-3 alerts preview, empty/error states with next action |
| 2 | `/network` Network Explorer | Graph work | Full Cytoscape.js canvas (replaces hand-rolled SVG), relationship-type filters, layouts (cola / cose / concentric-by-influence / circle), ego-depth control + full/ego toggle, search-to-focus, two-node path finder (A→B highlight), click node → dossier side panel, node cap (default 600) with notice |
| 3 | `/entities` Entities & Search | Find people/things | Global fuzzy search (POST /search), ranked key-players table (influence bar + role + community), entity detail route `/entities/:id` (dossier full view: properties, centrality, neighbours with links, timeline where available) |
| 4 | `/alerts` Alerts & Patterns | Review risk | Explainable alert cards (severity dot + pattern type + plain-language explanation + entities involved as chips → graph/entity + evidence JSON collapsible + source dataset), severity filter, empty state ("no financial edges → structuring checks skipped") surfaced honestly |
| 5 | `/documents` Document Intel | Read evidence | Upload .txt / paste text / pick sample FIR → POST /documents/analyze → summary + classification + triples + NER entities + warnings; entity mentions link to `/entities/:id` or `/network?focus=:id` |
| 6 | `/upload` Upload & Settings | Bring data + connect | Backend connection card (base URL + API key, remember-me, test button, status), smart file upload (below), demo-dataset button (loads bundled Copper-Ledger-style demo when backend offline) |

Navigation: left sidebar with the 6 items + icons, top bar with case name, backend status pill, global search shortcut (jump to `/entities`), dark ops theme by default + light toggle. Every page has: loading skeleton, empty state, error state with retry, and a "what to do next" hint (user-friendliness requirement).

## 5. Smart upload — XLSX + CSV auto-detect, clean, preview graph

Frontend (`upload.ts`, SheetJS `xlsx` for `.xlsx/.xls`, own parser for `.csv`):

1. File input accepts `.csv,.xlsx,.xls,.json` (+ optional `.txt` report — kept client-side like today).
2. XLSX: sheet picker dropdown (default first non-empty sheet); header row auto-detect (first row with ≥2 non-empty cells, scans first 10 rows).
3. Column-role detection (same synonyms as current `validateUpload` + extensions):
   - source: `person_a|sender|source|from|:START_ID`, target: `person_b|recipient|target|to|:END_ID`, rel/type: `:TYPE|rel|type`, weight: `frequency|weight|count|calls`, date/time: `date|datetime|timestamp|timestamps|approx_date_range`, amount: `amount|value|rs|inr`, id/label for node-only files: `person_id|email|account_id|id`, label/name.
   - JSON shape: `{nodes:[{id,…}], edges:[{src,dst,…}]}` (existing aliases kept).
4. Cleaning (all client-side, reported row counts):
   - trim whitespace/BOM, drop fully-empty rows, drop rows with missing endpoints (counted as skipped with reason + row number);
   - normalize phones/plates via the same rules as `entity_resolution.normalize_phone/normalize_vehicle` (ported to TS);
   - dedupe identical (src,dst,rel) pairs by summing frequency;
   - cap preview at 200 rows; full file goes to backend only after user confirms.
5. Preview: detection summary (mapped columns + confidence), cleaned edge table (first 50 rows), skipped-rows list with reasons, mini Cytoscape preview (~first 60 nodes), then [Send to backend] → `POST /ingest/load` → redirect to `/network`.
6. Demo fallback: "Load demo dataset" builds the small fictional graph locally (same content family as current `MOCK_ENTITIES`, clearly labeled fictional) so the UI is usable with no backend.

Backend:

- `POST /ingest/preview`: multipart file (csv/xlsx/xls/json, ≤5 MB). Parses server-side (openpyxl if present, else csv/json), runs the same detect+clean, returns `{columns, mapping, rows_cleaned, skipped:[{row,reason}], preview:[...], node_count, edge_count}`. No persistence.
- `POST /ingest/load`: same parse + `store.load_relationships(rows)` + clear `_ranked_cache` + return `{loaded:{nodes,edges}, skipped}`.
- Both endpoints reuse `EDGE_KIND_MAP` and aggregation semantics; errors return 400 with machine-readable `skipped` + human message (never silent data loss).

## 6. Cytoscape.js graph spec (Network Explorer)

- Library: `cytoscape` + `cytoscape-cola` (primary physics), fallback `cose`/`concentric`/`circle` switcher.
- Data mapping: `GET /graph/full?limit=` → `{nodes:[{data:{id,label,type,role,influence,community}}], edges:[{data:{id,source,target,rel,frequency}}]}` (new endpoint assembles from `_ego_fallback`-style fallback walk + `_rank_index`, capped, top-by-influence; demo mode uses bundled dataset).
- Style: node color by role (leader red / bridge amber / member slate / unknown hollow — same palette as current CSS vars), size by influence; edge color/line-style by rel (financial solid emerald + arrow, call solid blue, co-located dashed violet, kin dotted rose, unknown dotted grey); labels hidden until zoom ≥ ~1.2 except leaders/selected (parity with `gateLabels`).
- Interactions: click → dossier panel (same data as `GET /entities/:id`), hover → neighbourhood highlight, box-select, path mode (pick A, pick B → `GET /entities/{a}/paths/{b}` → highlight all paths, list with hop counts), ego-depth slider (1–3, calls existing `/entities/:id/network`), filters by rel type + community, export PNG (cytoscape built-in).
- Performance: hard cap 600 nodes default (selector 200/600/1200), virtual of labels, `prefers-reduced-motion` disables cola animation.

## 7. API additions (all under existing ApiKeyMiddleware)

- `GET /graph/full?limit=600&min_influence=0` → `{nodes, edges, truncated: bool, total_nodes, total_edges}`. Fallback: walk `store.G`, rank via `_rank_index()`, slice top-N by influence; Neo4j: `MATCH (n) … LIMIT` + rels among them. Response models: `FullGraphNode {id,label,name,community_id,role,influence_score}`, `FullGraphEdge {id,src,dst,rel,frequency}`.
- `GET /entities/{a}/paths/{b}?max_hops=3&limit=10` → `{source,target,paths:[[ids]],count}`. Wraps `store.get_all_paths_within_hops` (fallback) / equivalent Cypher (Neo4j). 404 if either endpoint missing, 200 with `paths:[]` if disconnected.
- `POST /ingest/preview` and `POST /ingest/load`: multipart `file`, optional `sheet` (xlsx). 400 on >5 MB / unparsable / zero usable rows, with `skipped` detail. Load clears `_ranked_cache` under `_rank_lock`.
- No breaking changes to existing routes; new Pydantic models appended; OpenAPI docs pick them up automatically.

## 8. UX / visual design (user-friendly, "look good")

- Dark ops theme default ("Shadow Intel" vibe: near-black blue-grey surfaces, thin borders, mono IDs, severity-colored dots only where meaningful), light "case file" theme toggle; respects `prefers-reduced-motion`.
- One primary action per page (Overview: "Open Network Explorer"; Network: path finder CTA; Upload: "Send to backend"), breadcrumbs + stepper so users always know where they are in Ingest→Clean→Graph→Alerts→Report.
- Plain-language explanations everywhere analytics jargon appears (reuse `analytics.EXPLAINER` strings: "broker test", "finding the crews").
- Accessibility: skip link, focus-visible rings, aria labels on graph controls, keyboard path (tab to node via search → Enter opens dossier), color never the only signal (icons + text labels on severity/role).
- No emojis in UI. No new single-page clutter: sidebar sections from the old dashboard (cases, saved searches, watchlist) are dropped or folded into Entities (watchlist → localStorage "Watched" filter).

## 9. Error handling

- Backend unreachable: ConnectionStatus pill red + page-level empty state with "check api.py :8000 + API key" instructions + demo-dataset CTA (no dead screens).
- 401: "API key rejected" with link to `/upload` settings; key stored localStorage/sessionStorage only (existing `Live` pattern carried over).
- 404 entity / no path: friendly "no path between A and B within N hops — try more hops" (not a stack trace).
- Upload: per-row skipped reasons, file-too-large guard, wrong-sheet guard, zero-usable-rows guard; backend 400 surfaces `skipped` list in UI.
- Graph overload: `truncated:true` banner ("showing top 600 by influence — narrow with filters").

## 10. Testing / verification

1. `python -m uvicorn api:app --port 8000` boots; `GET /health` ok; new endpoints appear in `/docs`.
2. `GET /graph/full`, `/entities/{a}/paths/{b}`, `/ingest/preview` (sample CSV + XLSX), `/ingest/load` manually exercised; analytics cache invalidates (key-players change after load).
3. `cd frontend && npm install && npm run build` passes (vite + `tsc --noEmit`); `npm run dev` serves on :5173 with proxy to :8000.
4. Per-page manual checklist: Overview stepper links work; Network renders demo + live, filters/layouts/path/dossier work; Entities search + detail; Alerts cards + filters; Documents analyze + entity links; Upload XLSX sheet-pick → detect → clean → preview → load → graph.
5. Existing Python checks (`analytics.py --top`, `suspicious_patterns` via `/analytics/alerts`) still pass; legacy `dashboard.html` untouched.

## 11. File plan (implementation)

- EDIT `api.py`: add 4 endpoints + models + xlsx/csv parse helpers (new file `ingest_preview.py` recommended to keep `api.py` small).
- NEW `frontend/`: `package.json` (react, react-dom, react-router-dom, axios, cytoscape, cytoscape-cola, xlsx), `vite.config.ts` (proxy `/` → :8000), `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx` (router + Layout), `src/lib/api.ts`, `src/lib/demo.ts`, `src/lib/upload.ts`, `src/pages/*.tsx` (6), `src/components/*.tsx`, `src/styles.css` (theme vars ported from `dashboard.css`).
- No changes to `graph_store.py`, `analytics.py`, `suspicious_patterns.py`, `entity_resolution.py`, `.env`.

## 12. Risks

- XLSX parsing needs `openpyxl` server-side — degrade gracefully (400 "install openpyxl or upload CSV") if missing.
- Large Enron graph → enforce `limit` + truncation UX; never render unbounded.
- Cytoscape cola physics on 600 nodes can jank — default to concentric for large graphs, cola opt-in.
