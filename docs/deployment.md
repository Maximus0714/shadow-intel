# Deployment contract

Start the application with `docker compose up --build -d` from the repository
root. Nginx publishes port 4179 (override `WEB_PORT`); FastAPI is internal.
The web service waits for backend health. Only the stateless workspace routes
and health endpoint are proxied; shared graph, admin and model endpoints remain private.

Browser → `/api/workspace/analyze` → Nginx → FastAPI → shared Node analysis module → result snapshot → account-scoped IndexedDB and Supabase history.
The frontend uses relative URLs and contains no backend hostname or server secret.
All graph exploration reads the immutable result snapshot. Browser uploads never
mutate the legacy shared graph. Supabase stores snapshots only after its migration
has been applied and Row Level Security limits records to their owner.

For an internet deployment, put the web service behind your host's HTTPS
ingress/load balancer. Keep API port 8000 private. Route both assets and `/api`
to the web container; never rewrite `/api` to the React HTML fallback. No CORS
configuration is necessary for this same-origin topology. TLS is supplied by
the hosting platform; this repository does not provision a domain/certificate.

The landing page and fictional demo are public. Workspace routes require Google
authentication through Supabase. In production, `SUPABASE_REQUIRE_AUTH=true`
makes FastAPI validate the same bearer session before analysis. Account profiles
have investigator, reviewer or admin roles; users cannot assign their own role.
Investigation data remains owner-scoped. Collaboration uses random, read-only,
seven-day share links. Do not expose the legacy admin/shared-graph API or embed
`API_KEY`/service-role credentials in JS.

## Resource and data limits

- Upload file: 5 MB; reviewed request: 6 MB, enforced by Nginx and ASGI before JSON parsing.
- At most 10,000 relationship rows, 2,000 entities, and 200-character entity IDs.
- At most two simultaneous graph analyses per Python process; excess gets 503.
- Nginx limits workspace requests to 10/minute per client IP, burst 5; excess gets 429.
- Exact inverse-frequency weighted betweenness covers every person. Financial loop checks stop at 100,000.
- At most 200 flags; document input at most 100,000 characters. Shared links expire after seven days.
- Proxy/browser timeout: 90 seconds. Errors are shown explicitly; no demo substitution.

Nginx applies its rate limit to the address it sees. Configure trusted real-IP
handling for your hosting ingress to avoid sharing a limit across all users;
do not blindly trust arbitrary forwarded-IP headers. The analysis API may run
multiple replicas; concurrency limits are per process. Supabase provides account
persistence; Neo4j is optional for the legacy shared graph.
Application code does not retain upload bodies; infrastructure logs/backups
should likewise be configured to avoid recording evidence bodies.

The current workspace cache remains tied to the exact browser origin. Signed-in
history reloads from Supabase on another device after cloud sync succeeds.

## Verification

`docker compose ps` should show both services healthy. `curl http://localhost:4179/api/health`
checks the proxy. Upload a small CSV in Connected backend mode and confirm the
overview says Backend analysis. Refresh a deep link such as `/entities` to
check SPA routing. `docker compose logs api web` shows startup/proxy errors.

Docker is not installed on the development machine used for this change, so
container execution still needs verification on a Docker host. The automated
browser suite exercises the real FastAPI service through Vite's same-origin proxy, including a byte-for-byte comparison of on-device and backend report fields. The frontend rejects a backend response whose `analysis_version` differs from its bundled shared module.
## Supabase account storage

Before enabling cloud investigation history, run
`supabase/migrations/202609090001_investigations.sql` in the Supabase SQL
Editor. It creates account-owned investigations, durable audit events, expiring
read-only shares, role profiles, indexes, and Row Level Security policies.

Set `SUPABASE_REQUIRE_AUTH=true` in production so backend workspace analysis
verifies the signed-in Supabase session. Keep it `false` only for isolated
local development and automated tests.

The publishable key is safe for the browser and is passed as a Docker build
argument. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Add the deployed site URL
and OAuth callback to Supabase Auth redirect URLs before enabling Google sign-in.

## Neo4j

The normal Compose configuration uses the in-memory fallback. To run the
bundled Neo4j service, set `NEO4J_PASSWORD`, set
`NEO4J_URI=bolt://neo4j:7687`, then run `docker compose --profile neo4j up`.
The `neo4j-data` volume retains the graph across container restarts.

## Automated verification

GitHub Actions runs Python endpoint and ingestion tests, frontend regressions,
the document extraction precision/recall/F1 fixture, TypeScript checking and the
optimized production build for every push and pull request.
