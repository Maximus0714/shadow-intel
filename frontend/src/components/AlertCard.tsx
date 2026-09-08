import { Link } from "react-router-dom";
import type { AlertFlag } from "../lib/api";

export function sevOf(score: number): "high" | "med" | "low" {
  return score >= 0.7 ? "high" : score >= 0.4 ? "med" : "low";
}

export default function AlertCard({ flag }: { flag: AlertFlag }) {
  const sev = sevOf(flag.severity_score);
  return (
    <div className="alert-card">
      <span className={`sev ${sev}`} title={`Severity ${sev}`} />
      <div>
        <p>
          <strong>{flag.pattern_type}</strong> ·{" "}
          <span className="mono">{flag.severity_score.toFixed(2)}</span> ·{" "}
          <span className="mono">{flag.source_dataset || ""}</span>
        </p>
        <p style={{ marginTop: 4 }}>{flag.plain_language_explanation}</p>
        <p style={{ marginTop: 6 }}>
          {(flag.entities_involved || []).map((e) => (
            <Link key={e} className="chip" to={`/network?focus=${encodeURIComponent(e)}`} title={`Focus ${e}`}>
              {e}
            </Link>
          ))}
        </p>
        {flag.evidence && Object.keys(flag.evidence).length > 0 && (
          <details className="ev">
            <summary>Evidence</summary>
            <pre>{JSON.stringify(flag.evidence, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
