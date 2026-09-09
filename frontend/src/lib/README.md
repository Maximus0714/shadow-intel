# Frontend domain code

- `data/` adapts uploaded records and bundled demonstration data into the UI's
  graph-shaped data model. `server.ts` owns HTTP requests to `/api/workspace`;
  `api.ts` queries the returned snapshot for navigation and reports.
- `analysis/` contains deterministic local graph analysis, document extraction
  rules, and the worker that keeps analysis off the main browser thread.
- `state/` owns the React workspace context and IndexedDB persistence.

Route components belong in `src/pages/`; reusable display components belong in
`src/components/`.
