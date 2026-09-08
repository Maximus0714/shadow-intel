# Frontend overhaul

This supersedes the visual-preservation scope in the earlier audit. The user explicitly requested a complete frontend overhaul and an attractive landing page.

## Product structure

| Route | Working features |
| --- | --- |
| `/` | Public landing page, original imagery, motion, platform explanation, workflow, FAQ, demo entry |
| `/overview` | Dataset counts, communities, ranked entities, signals, next actions |
| `/network` | Cytoscape graph, four layouts, relationship/community filters, node cap, labels, zoom/fit, entity selector, dossiers, 1-3 hop neighbourhoods, 1-5 hop path tracing, path list, PNG export |
| `/entities` and `/entities/:id` | Search, type filter, watchlist filter, pagination, influence/role/community, dossiers and graph handoff |
| `/communities` | Member search, cluster members, leading entity, graph handoff |
| `/alerts` | Severity and entity filters, explanations, supporting evidence, entity links |
| `/documents` | Pasted/file text, a clearly labeled sample, live NLP analysis, summary/entities/relationships tabs, warnings, JSON export |
| `/reports` | Saved entities, local analyst notes, Markdown and JSON downloads |
| `/upload` | Drag/drop or file selection, CSV/XLSX/XLS/JSON, worksheet selection, mapping overrides, cleaning/skipped-row preview, review confirmation, backend validation/import, CSV template |
| `/settings` | Authenticated connection test/save, session or remembered credentials, password visibility, demo/live mode, explicit confirmation before source-data reload |

## Architecture

- Shared workspace context owns data mode, connection configuration, notifications and per-source watchlists.
- The `useData` hook guards obsolete responses and prevents data from another mode or resource appearing under the new selection.
- Demo mode is explicit across every workspace page. Live mode surfaces backend errors instead of silently substituting fictional results.
- Generated sample document output is labeled prewritten, and arbitrary user text requires a backend. Demo flags are illustrative, not computed findings.
- Route chunks isolate graph and spreadsheet dependencies. GraphCanvas owns Cytoscape lifecycle, theme updates, resize cleanup and layout cleanup.
- Shared UI components handle headings, loading, errors, empty states, theme control, and reduced-motion-aware reveals.
- Obsolete shell status, pipeline, alert-card and dossier components were removed. TypeScript unused-local and unused-parameter checks are enabled.
- Layouts explicitly collapse at mobile widths. Mobile navigation opens as a drawer, closes on navigation/Escape, and locks background scrolling. Tables scroll within their containers.

## Design

`design.md` remains the unchanged xAI reference. The design-taste-frontend skill is the sole design workflow; no Sites skills were used. The image-generation skill supplied original raster assets.

Landing dials: DESIGN_VARIANCE 8, MOTION_INTENSITY 6, VISUAL_DENSITY 4. The page uses an asymmetric hero, mixed-size capability tiles, a workflow section, a focused principles section, FAQ, and final demo entry. Workspace layouts use denser task-specific patterns rather than marketing layout rules.

Typography: self-hosted Geist and Geist Mono. Near-black / neutral light themes, regular-weight display type, pill actions, consistent panels and inputs. Semantic graph colors identify entity types. Motion communicates entry hierarchy, section discovery, feedback and graph layout changes. Reduced motion is honored.

## Verification

- Production TypeScript/Vite build and frontend parser/graph regressions pass.
- Backend regression suite: 17 tests pass.
- All ten routes were checked in isolated Chrome. Desktop at 1440px; mobile at 390px in both themes. No page-level horizontal overflow remains in the checked views.
- Interaction checks passed: demo entry, watchlist persistence, analyst notes and Markdown download, entity dossier, ego reset, path tracing, relationship filtering, layout switching, PNG export, document sample/search handoff and alert evidence.
- Live checks against a separate temporary API passed: authenticated settings, overview, entities, communities, alerts, graph, custom mapping preview, and real import followed by graph selection of the imported entity.
- Repeatable browser tests are in `frontend/tests/e2e`, with `npm run test:e2e`: all 5 tests pass.
- Final local Lighthouse mobile run: performance 96, accessibility 100, best practices 100, SEO 100; LCP 2.6 seconds and CLS 0. Scores describe this local run and can vary by environment.
- Original raster assets were converted to optimized WebP with a smaller responsive hero variant. The hero image and primary font are preloaded. Fonts are self-hosted, favicon/description/robots metadata are supplied.

## Boundaries

The frontend exposes the implemented backend capabilities. It does not claim new model capabilities, cloud accounts, role-based access, PDF reporting, an evidence integrity vault or a chat assistant. Optional NLP models still need to be installed on the backend. Watchlists and notes are browser-local, and exports are Markdown/JSON. The graph route remains a relatively large, lazy-loaded chunk. Existing backend tests were run in the temporary Python environment described in the earlier audit. No production deployment was performed.
