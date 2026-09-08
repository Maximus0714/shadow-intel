import { useEffect, useState } from "react";
import { getHealth, getStats, type ApiConfig } from "../lib/api";

export default function ConnectionStatus({ cfg }: { cfg: ApiConfig }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "live"; nodes: number; edges: number; backend?: string }
    | { kind: "offline" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await getHealth(cfg);
        const s = await getStats(cfg);
        if (!cancelled)
          setState({ kind: "live", nodes: s.nodes, edges: s.edges, backend: h.backend });
      } catch {
        if (!cancelled) setState({ kind: "offline" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg.baseUrl, cfg.key]);

  if (state.kind === "loading") return <span className="skeleton">Checking backend…</span>;
  if (state.kind === "live")
    return (
      <span className="pill live">
        LIVE · {state.nodes} nodes / {state.edges} edges
        {state.backend ? ` · ${state.backend}` : ""}
      </span>
    );
  return <span className="pill off">OFFLINE — demo mode</span>;
}
