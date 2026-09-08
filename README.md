# X-Tracer

**From evidence to intelligence.** An AI-assisted criminal-network investigation workspace built for Smart India Hackathon (SIH) 2026, Problem Statement SIH26189.

Upload fragmented evidence (CSV/XLSX reports, call records, FIR text), clean and preview it, explore the resulting knowledge graph, review explainable anomaly flags, and analyze documents — one focused page per job.

## What lives here

- **Backend (FastAPI, `api.py`)** — graph store + analytics + document intel exposed as REST endpoints. NetworkX fallback by default; optional Neo4j via env vars.
- **Legacy dashboard** — `dashboard.html` + `dashboard.css` + `dashboard.js`: the original single-file SVG workbench (kept as fallback).
- **New web app (`frontend/`)** — Vite + React + TypeScript + Cytoscape.js, a public landing page plus Overview, Network Explorer, Entities & Search, Communities, Alerts & Patterns, Document Intel, Reports & Watchlist, Upload & Settings, and connection Settings.
- **Pipelines** — `ingest.py`, `caviar_ingest.py`, `enron_ingest.py`, `nlp_pipeline.py`, `doc_intel.py`, `entity_resolution.py`, `analytics.py`, `suspicious_patterns.py`.
- **Sample data** — `CAVIAR/` (input phases), `out_caviar/`, `out_bench/` (small working outputs), `gold_sample.json`, `out_analytics_ranked.json`.
- **Docs** — `docs/` (design spec + implementation plan).

## Prerequisites

- Python 3.14, Node 24, `git`, GitHub CLI (`gh`) optional.

## Backend setup

```powershell
pip install -r requirements.txt
Copy-Item .env.example .env   # then set a real API_KEY inside .env
python -m uvicorn api:app --port 8000
```

Health check: `http://127.0.0.1:8000/health`. Interactive docs: `http://127.0.0.1:8000/docs`.

Default dataset: Caviar (`out_caviar/`) + Enron (`out_enron/`, capped by `ENRON_MAX_EDGES`). The API key goes in the `X-API-Key` header (or `Authorization: Bearer`, or `?api_key=`).

## Frontend setup

```powershell
Set-Location frontend
npm install
npm run dev    # http://localhost:5173 (proxies API calls to :8000)
```

Production build: `npm run build` (outputs `frontend/dist/`, git-ignored).

Open `/` for the landing page, then select **Explore demo** for a working fictional workspace. To investigate real data, go to **Settings**, enter the backend URL and `API_KEY` from `.env`, and choose **Connect workspace**. Demo and live mode stay explicit across all pages; live failures display errors rather than substitute demo data.

## Data note

Large/generated artifacts are **not** committed (`emails.csv` 1.36 GB, `out_enron/` 265 MB, `out/`, logs, `node_modules/`, `dist/`). Regenerate them with the ingest scripts (`caviar_ingest.py`, `enron_ingest.py`, `ingest.py`). Committed samples (`CAVIAR/`, `out_caviar/`, `out_bench/`) are enough to boot and explore.

## Testing

```powershell
python -m pytest tests/ -v          # backend: upload helpers + API endpoints
python analytics.py --top 5         # analytics smoke test
Set-Location frontend
npm test                          # CSV parsing, mapping, evidence, demo traversal
npm run build                     # TypeScript + optimized production build
```

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health`, `/stats` | liveness + node/edge counts |
| GET | `/graph/full?limit=600` | capped full graph for Cytoscape |
| GET | `/entities/{id}`, `/entities/{id}/network?depth=N` | dossier + ego network |
| GET | `/entities/{a}/paths/{b}` | all simple paths between two entities |
| GET | `/analytics/key-players`, `/analytics/communities`, `/analytics/alerts` | ranking, crews, explainable flags |
| POST | `/search` | fuzzy entity search |
| POST | `/documents/analyze` | NER + summarisation on text/file |
| POST | `/ingest/preview`, `/ingest/load` | smart upload: detect + clean + preview, then load |
| POST | `/admin/reload` | reload graph, clear analytics cache |

## Design and upload behavior

`design.md` is an unchanged copy of the supplied xAI design reference. The frontend applies its monochrome palette, self-hosted Geist substitute and Geist Mono, outlined pill buttons, and consistent rounded surfaces. The taste skill governs the complete landing-page and workspace overhaul. The overview now lives at `/overview`; existing investigation route slugs remain available. Dark is the initial brand theme; the existing light-mode toggle remains available.

Upload preview and load accept an optional multipart `mapping` JSON object. Its values must refer to uploaded column names. The same selected mapping is used in both operations. Amounts and dates survive ingestion, and individual financial records remain separate for pattern analysis. Unsupported relationship types return a validation error instead of silently disappearing.

CSV, XLSX and JSON are parsed by the server. The frontend converts legacy XLS worksheets to CSV before submission. The direct API rejects legacy XLS with a conversion message. Node-only JSON ingestion is not supported. NLP extraction still requires its optional models; unavailable models are reported in Document Intel.

See `docs/2026-09-08-frontend-revamp.md` for the current feature map, architecture, verification and limitations. The earlier audit remains as repair history.

Browser regressions: `cd frontend && npx playwright install chromium && npm run test:e2e`. Alternatively, set `PLAYWRIGHT_CHROME_PATH` to an installed Chrome executable. The test runner starts the production preview on port 4179 if one is not already running.

Watchlists and notes are saved locally, separately for demo and each backend. Reports download as Markdown or JSON. No cloud account is required for the demo.
