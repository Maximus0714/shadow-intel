# X-Tracer

**From evidence to intelligence.** An AI-assisted criminal-network investigation workspace built for Smart India Hackathon (SIH) 2026, Problem Statement SIH26189.

Upload fragmented evidence (CSV/XLSX reports, call records, FIR text), clean and preview it, explore the resulting knowledge graph, review explainable anomaly flags, and analyze documents — one focused page per job.

## Project map

- **`frontend/src/pages/`** — one React route per investigation screen.
- **`frontend/src/components/`** — shared visual building blocks and graph components.
- **`frontend/src/lib/data/`** — upload parsing, demo data and browser-facing data adapter.
- **`frontend/src/lib/analysis/`** — local graph algorithms, document rules and the Web Worker.
- **`frontend/src/lib/state/`** — workspace context and browser persistence.
- **`backend/`** — FastAPI service; `workspace.py` is the isolated browser API, with graph analytics in `analytics.py`.
- **`scripts/`** — one-off dataset ingestion and NLP evaluation commands.
- **`out_caviar/`** — the small committed fallback graph used by legacy API smoke tests.
- **`supabase/migrations/`** — account history, audit, sharing, profiles, roles and RLS.
- **`docs/`** — design references, plans and project history.

## Run the website

### Docker (recommended for a fresh clone)

Install Docker Desktop, copy `.env.example` to `.env`, add the Supabase URL and
publishable key, then run this from the repository root:

```sh
docker compose up --build
```

Open `http://localhost:4179`. Nginx serves the website and forwards
`/api/workspace/*` to the Python service on Docker's internal network.
The backend port is not published. Signed-in browser requests use the Supabase
session; no user-entered API key is needed. Stop with
`docker compose down`. Set `WEB_PORT` to change the published port.

For a clean rebuild after changing dependencies or Docker files:

```sh
docker compose build --no-cache
docker compose up
```

The older shared-graph and admin endpoints still require `API_KEY`; Nginx does
not expose them. Never put this key in frontend variables. Deployment notes,
request limits and hosting requirements are in [docs/deployment.md](docs/deployment.md).

### Local development

Run the backend from the repository root in one terminal:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8019 --reload
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 4179
```

Open `http://localhost:4179`. Vite proxies `/api` to `http://127.0.0.1:8019`.
Override `API_PROXY_TARGET` for a backend on another port. On Windows activate
the environment with `.venv\\Scripts\\Activate.ps1`. Docker needs no host Python or Node.
Production build: `npm run build`; local preview: `npm run preview`.

Choose **Add your data** to upload evidence, or **Explore demo** for the fictional sample. CSV, XLSX, XLS, JSON, JSONL and EML records are supported, up to 5 MB, 10,000 cleaned relationships and 2,000 entities. Map source and target columns; relationship, frequency, date and amount are optional. Common call, message, email, account and phone export headers are detected automatically. PDF, images, audio, encrypted archives and node-only JSON require conversion first. Document Intel accepts pasted text or TXT files and extracts candidate people, phones, accounts, vehicles, organizations, locations, dates, amounts, events and explicit relationships.

**Connected backend** is the default: reviewed records are sent to the isolated workspace endpoint. The endpoint runs the same versioned JavaScript analysis module as the browser, so it returns identical rankings, communities, flags, dossiers and reports for the same cleaned evidence. Each request owns its graph; uploads are never merged with another investigation or the original API's shared dataset. The app rejects a response from a mismatched analysis version.

**On this device** runs that exact same versioned module inside a Web Worker and does not send evidence to Python. Both modes use deterministic weighted Louvain communities, exact inverse-frequency shortest-path betweenness, weighted PageRank and the same rules for flags and document extraction. Methods appear in the overview. Graph paths are capped at 10 results and 50,000 search expansions.

Google authentication is supplied by Supabase. The active result is saved in account-scoped IndexedDB, while the migration in `supabase/migrations/` enables cross-device investigation history, audit events, role profiles and expiring read-only share links with Row Level Security. If Supabase storage is unavailable, analysis still works and history remains in that browser. Notes, watchlists and alert-review decisions remain account- and dataset-scoped in local storage. Reports can be downloaded as Markdown or JSON.

The workspace includes graph exploration, entity dossiers and filtering, communities, event timelines, explainable pattern flags, investigator confirmation/dismissal, document intelligence, entity-resolution candidates, case history, account activity and read-only collaboration. Pattern flags cover circular and rapid transfer chains, reciprocal contact, cross-community links, shared locations, connection hubs, unusual frequency and dated activity bursts. They are leads for review, not automated conclusions.

## Optional standalone Python API

The original key-protected routes remain available for direct scripts/integrations. The website uses the new stateless workspace routes instead of the shared graph.

```sh
pip install -r requirements.txt
cp .env.example .env
# Set API_KEY in .env for direct API clients.
python -m uvicorn backend.api:app --port 8000
```

Interactive API docs: `http://127.0.0.1:8000/docs`. Backend authentication remains in place for those clients.

## Data note

Large/generated artifacts are **not** committed (`emails.csv`, `out_enron/`, `out/`, logs, `node_modules/`, `dist/`). Run ingestion tools as `python -m scripts.caviar_ingest`, `python -m scripts.enron_ingest`, or `python -m scripts.ingest` from the root. Committed samples remain available for research and backend smoke tests. The old standalone dashboard was removed; Git history retains it.

## Testing

```powershell
python -m pytest tests/ -v          # backend: upload helpers + API endpoints
python -m backend.analytics --top 5 # analytics smoke test
node scripts/document_eval.mjs      # extraction P/R/F1 regression evaluation
Set-Location frontend
npm test                          # CSV parsing, mapping, evidence, demo traversal
npm run build                     # TypeScript + optimized production build
```

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/workspace/analyze` | isolated uploaded-data analysis, no shared graph writes |
| POST | `/workspace/documents` | bounded English rules and extractive summary |
| POST | `/workspace/resolve` | entity matching, confidence and review queue |
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

The browser parses and previews uploads before the selected analysis method runs. Dates, amounts and source-row references are retained. Unsupported relationships are flagged during cleaning. Document results use explicit rules, keyword-based review priority and extractive summaries, with their limitations shown in the interface.

Earlier documents in `docs/` describe the previous server-connected implementation and remain as project history.

Browser regressions: `cd frontend && npx playwright install chromium && npm run test:e2e`. Activate the Python environment first or set `PLAYWRIGHT_PYTHON` to its executable. `PLAYWRIGHT_CHROME_PATH` can select installed Chrome. Tests start their own backend on 18000 and production preview on 4180, including real server round trips and offline-mode checks.

Run `supabase/migrations/202609090001_investigations.sql` once in the Supabase SQL Editor before testing cloud history and sharing. For production set `SUPABASE_REQUIRE_AUTH=true`; local/offline analysis remains available through the signed-in workspace.
