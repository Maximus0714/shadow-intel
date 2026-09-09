# Python backend

- `api.py` exposes the FastAPI service.
- `workspace.py` analyzes each browser submission in isolation and returns a
  result snapshot; `request_limits.py` bounds incoming request bodies.
- `graph_store.py` owns graph persistence and graph loading.
- `analytics.py` and `suspicious_patterns.py` calculate server-side signals.
- `ingest_preview.py` parses and cleans server-side uploads.
- `doc_intel.py`, `nlp_pipeline.py`, and `entity_resolution.py` provide the
  optional document-analysis pipeline.

The website uses `/workspace/analyze` and `/workspace/documents` through the
same-origin `/api` proxy. Existing shared graph routes remain key-protected
for direct integrations. See `docs/deployment.md` at the repository root.

Run it from the repository root with:

```sh
python -m uvicorn backend.api:app --port 8000
```
