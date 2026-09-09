# X-Tracer

**From evidence to intelligence.** An AI-assisted criminal-network investigation workspace built for Smart India Hackathon (SIH) 2026, Problem Statement SIH26189.

Upload fragmented evidence (CSV/XLSX reports, call records, FIR text), clean and preview it, explore the resulting knowledge graph, review explainable anomaly flags, and analyze documents — one focused page per job.

## What lives here

- **Backend (FastAPI, `api.py`)** — graph store + analytics + document intel exposed as REST endpoints. NetworkX fallback by default; optional Neo4j via env vars.
- **Legacy dashboard** — `dashboard.html` + `dashboard.css` + `dashboard.js`: the original single-file SVG workbench (kept as fallback).
- **New web app (`frontend/`)** — Vite + React + TypeScript + Cytoscape.js, a public landing page plus Overview, Network Explorer, Entities & Search, Communities, Alerts & Patterns, Document Intel, Reports & Watchlist, Upload evidence.
- **Pipelines** — `ingest.py`, `caviar_ingest.py`, `enron_ingest.py`, `nlp_pipeline.py`, `doc_intel.py`, `entity_resolution.py`, `analytics.py`, `suspicious_patterns.py`.
- **Sample data** — `CAVIAR/` (input phases), `out_caviar/`, `out_bench/` (small working outputs), `gold_sample.json`, `out_analytics_ranked.json`.
- **Docs** — `docs/` (design spec + implementation plan).

## Run the website

### Docker (recommended for a fresh clone)

Install Docker Desktop, then run this from the repository root:

```sh
docker compose up --build
```

Open `http://localhost:4179`. The website is the `web` container and the
original FastAPI service is available at `http://localhost:8000` for its
separate API integrations. The current browser workspace does not call that
API or require an API key. Stop the stack with `docker compose down`; add
`--remove-orphans` if you have old project containers.

For a clean rebuild after changing dependencies or Docker files:

```sh
docker compose build --no-cache
docker compose up
```

The API uses a development-only default key in Compose so a cloned demo boots
without secret files. Set `API_KEY` in your shell or a local `.env` file before
starting Compose if anyone will call the API outside their own machine. Do not
commit that `.env` file.

### Local development

```sh
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). No Python server, account, or API key is needed. Production build: `npm run build`; serve it with `npm run preview`.

Choose **Open workspace** to upload your own evidence, or **Explore demo** for the fictional sample. CSV, XLSX, XLS and JSON relationship records are supported, up to 5 MB, 10,000 cleaned relationships and 2,000 entities. Map source and target columns; relationship, frequency, date and amount are optional. The upload screen explains all supported relationship types and provides examples. PDF, images, audio, raw chat archives and node-only JSON are not supported. Document Intel accepts pasted text or TXT files with limited English rule-based extraction.

Analysis runs in a browser Web Worker: degree, weighted PageRank, betweenness (sampled above 100 entities), weighted label-propagation groups, structural roles, unusual-frequency flags, shared-location links and directed three-entity financial loops. Methods and coverage limitations appear on the overview. Graph paths are bounded to 10 results and 50,000 search expansions. These are explainable graph heuristics, not trained criminal classifiers or unrestricted language-model analysis.

The current investigation is saved in IndexedDB; notes and watchlists use local storage, separately for each dataset and demo. Returning to the same browser and origin restores it. Clearing site data removes it; replacing the dataset replaces the saved investigation. Download reports to retain findings. All uploaded-data analysis stays in the browser and makes no API requests. Initial page loading still needs the local web server.

## Optional standalone Python API

The original Python backend remains available for separate scripts/integrations; the website does not use it.

```sh
pip install -r requirements.txt
cp .env.example .env
# Set API_KEY in .env for direct API clients.
python -m uvicorn api:app --port 8000
```

Interactive API docs: `http://127.0.0.1:8000/docs`. Backend authentication remains in place for those clients.

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

The browser parses and previews uploads before local analysis. Dates, amounts and source-row references are retained. Unsupported relationships are flagged during cleaning. Document results use explicit rules and extractive summaries, with their limitations shown in the interface.

Earlier documents in `docs/` describe the previous server-connected implementation and remain as project history.

Browser regressions: `cd frontend && npx playwright install chromium && npm run test:e2e`. Alternatively, set `PLAYWRIGHT_CHROME_PATH` to an installed Chrome executable. The test runner starts the production preview on port 4179 if one is not already running.

Watchlists and notes are saved locally, separately for demo and each local dataset. Reports download as Markdown or JSON. No cloud account is required.
