import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AlertCard, { sevOf } from "../components/AlertCard";
import { getAlerts, loadConfig, type AlertFlag } from "../lib/api";

export default function Alerts() {
  const [cfg] = useState(loadConfig);
  const [flags, setFlags] = useState<AlertFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "high" | "med" | "low">("all");

  const fetchAll = async () => {
    setError(null);
    setFlags(null);
    try {
      const r = await getAlerts(cfg);
      setFlags(r.flags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseUrl, cfg.key]);

  const shown = (flags || []).filter((f) =>
    filter === "all" ? true : sevOf(f.severity_score) === filter
  );

  return (
    <>
      <h1>Alerts &amp; Patterns</h1>
      <p className="sub">
        Explainable flags: rule + anomaly checks with the evidence behind each
        signal. Signals are leads, not verdicts — the analyst decides.
      </p>
      <div className="card">
        <label className="field" style={{ maxWidth: 240 }}>
          <span>Severity filter</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All severities</option>
            <option value="high">High (≥ 0.70)</option>
            <option value="med">Medium (0.40 – 0.69)</option>
            <option value="low">Low (&lt; 0.40)</option>
          </select>
        </label>
        {error && (
          <div className="error">
            {error}{" "}
            <button className="btn" onClick={fetchAll}>
              Retry
            </button>{" "}
            <Link className="btn" to="/upload">
              Check connection
            </Link>
          </div>
        )}
        {!flags && !error && <div className="skeleton">Loading alerts…</div>}
        {flags && (
          flags.length === 0 ? (
            <div className="empty">
              No flagged patterns for this dataset. Note: structuring and
              circular-transfer checks skip sources without financial edges.
            </div>
          ) : shown.length === 0 ? (
            <div className="empty">No alerts at this severity level.</div>
          ) : (
            <div>
              {shown.map((f, i) => (
                <AlertCard key={`${f.pattern_type}-${i}`} flag={f} />
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}
