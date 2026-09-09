# Deployment contract

Start the application with `docker compose up --build -d` from the repository
root. Nginx publishes port 4179 (override `WEB_PORT`); FastAPI is internal.
The web service waits for backend health. Only the stateless workspace routes
and health endpoint are proxied; shared graph, admin and model endpoints remain private.

Browser → `/api/workspace/analyze` → Nginx → FastAPI → shared Node analysis module → result snapshot → IndexedDB.
The frontend uses relative URLs and contains no backend hostname or API key.
All subsequent graph exploration reads the result snapshot. There is no shared
server dataset mutation and no server-side persistence for browser uploads.

For an internet deployment, put the web service behind your host's HTTPS
ingress/load balancer. Keep API port 8000 private. Route both assets and `/api`
to the web container; never rewrite `/api` to the React HTML fallback. No CORS
configuration is necessary for this same-origin topology. TLS is supplied by
the hosting platform; this repository does not provision a domain/certificate.

The browser workspace is currently a public stateless analysis tool. It does
not provide account authentication, role-based access or shared case storage.
If deployment requires restricted investigator access, use an authenticated
ingress before making it available to those users. Do not expose the legacy
admin/shared-graph API by adding a catch-all proxy or embedding API_KEY in JS.

## Resource and data limits

- Upload file: 5 MB; reviewed request: 6 MB, enforced by Nginx and ASGI before JSON parsing.
- At most 10,000 relationship rows, 2,000 entities, and 200-character entity IDs.
- At most two simultaneous graph analyses per Python process; excess gets 503.
- Nginx limits workspace requests to 10/minute per client IP, burst 5; excess gets 429.
- Exact inverse-frequency weighted betweenness covers every person. Financial loop checks stop at 100,000.
- At most 200 flags; document input at most 100,000 characters.
- Proxy/browser timeout: 90 seconds. Errors are shown explicitly; no demo substitution.

Nginx applies its rate limit to the address it sees. Configure trusted real-IP
handling for your hosting ingress to avoid sharing a limit across all users;
do not blindly trust arbitrary forwarded-IP headers. The stateless API may run
multiple replicas; concurrency limits are per process. No Redis/database is required.
Application code does not retain upload bodies; infrastructure logs/backups
should likewise be configured to avoid recording evidence bodies.

Results remain browser-local and are tied to the exact origin. Moving from
localhost to a domain, changing ports, or clearing browser storage does not
migrate investigations. Export reports before such changes.

## Verification

`docker compose ps` should show both services healthy. `curl http://localhost:4179/api/health`
checks the proxy. Upload a small CSV in Connected backend mode and confirm the
overview says Backend analysis. Refresh a deep link such as `/entities` to
check SPA routing. `docker compose logs api web` shows startup/proxy errors.

Docker is not installed on the development machine used for this change, so
container execution still needs verification on a Docker host. The automated
browser suite exercises the real FastAPI service through Vite's same-origin proxy, including a byte-for-byte comparison of on-device and backend report fields. The frontend rejects a backend response whose `analysis_version` differs from its bundled shared module.
