import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ConnectionStatus from "../components/ConnectionStatus";
import PipelineStepper from "../components/PipelineStepper";
import {
  getAlerts,
  getHealth,
  getKeyPlayers,
  getStats,
  loadConfig,
  type AlertFlag,
  type KeyPlayer,
} from "../lib/api";

export default function Overview() {
  const [cfg] = useState(loadConfig);
  const [stats, setStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [backend, setBackend] = useState<string | undefined>(undefined);
  const [players, setPlayers] = useState<KeyPlayer[] | null>(null);
  const [alerts, setAlerts] = useState<AlertFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, s, kp, al] = await Promise.all([
          getHealth(cfg),
          getStats(cfg),
          getKeyPlayers(cfg, 5),
          getAlerts(cfg),
        ]);
        if (cancelled) return;
        setBackend(h.backend);
        setStats(s);
        setPlayers(kp.players);
        setAlerts(al.flags.slice(0, 3));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg.baseUrl, cfg.key]);

  return (
    <>
      <h1>Overview</h1>
      <p className="sub">
        From evidence to intelligence: ingest case data, clean it, explore the
        network, review flagged patterns, and analyze documents — one step at a
        time.
      </p>

      <div className="card">
        <h2>Backend status</h2>
        <p style={{ marginBottom: 8 }}>
          <ConnectionStatus cfg={cfg} />{" "}
          <span className="pill demo">DEMO — fictional data shown offline</span>
        </p>
        {stats ? (
          <p>
            <span className="mono">
              {stats.nodes} nodes / {stats.edges} edges
            </span>
            {backend ? ` · backend: ${backend}` : ""}
          </p>
        ) : error ? (
          <div className="error">
            Backend unreachable: {error}{" "}
            <Link to="/upload">Connect in Upload &amp; Settings</Link> or keep
            exploring the demo dataset.
          </div>
        ) : (
          <div className="skeleton">Loading stats…</div>
        )}
      </div>

      <div className="card">
        <h2>Investigation pipeline</h2>
        <PipelineStepper />
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Top key players</h2>
          {players ? (
            players.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.person_id}>
                      <td>
                        <Link to={`/network?focus=${encodeURIComponent(p.person_id)}`}>
                          {p.name}
                        </Link>
                      </td>
                      <td>
                        <span className={`tag ${p.role}`}>{p.role.toUpperCase()}</span>
                      </td>
                      <td className="mono">{p.influence_score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">No key players yet — upload data first.</div>
            )
          ) : (
            <div className="skeleton">Loading key players…</div>
          )}
          <p style={{ marginTop: 8 }}>
            <Link className="btn" to="/entities">
              Open Entities &amp; Search
            </Link>
          </p>
        </div>
        <div className="card">
          <h2>Top alerts</h2>
          {alerts ? (
            alerts.length ? (
              <ul style={{ paddingLeft: 18 }}>
                {alerts.map((a, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <span
                      className={`sev ${a.severity_score >= 0.7 ? "high" : a.severity_score >= 0.4 ? "med" : "low"}`}
                    />{" "}
                    {a.plain_language_explanation.slice(0, 140)}…
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">No flagged patterns for this dataset.</div>
            )
          ) : (
            <div className="skeleton">Loading alerts…</div>
          )}
          <p style={{ marginTop: 8 }}>
            <Link className="btn" to="/alerts">
              Open Alerts &amp; Patterns
            </Link>
          </p>
        </div>
      </div>

      <p>
        <Link className="btn primary" to="/network">
          Open Network Explorer
        </Link>
      </p>
    </>
  );
}
