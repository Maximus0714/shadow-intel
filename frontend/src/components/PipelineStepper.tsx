import { Link } from "react-router-dom";

const STEPS = [
  { n: 1, label: "Ingest", to: "/upload", hint: "Bring CSV / XLSX / reports" },
  { n: 2, label: "Clean", to: "/upload", hint: "Auto-detect + preview" },
  { n: 3, label: "Graph", to: "/network", hint: "Explore connections" },
  { n: 4, label: "Alerts", to: "/alerts", hint: "Review flagged patterns" },
  { n: 5, label: "Report", to: "/documents", hint: "Analyze + summarize" },
];

export default function PipelineStepper() {
  return (
    <ol className="stepper" aria-label="Evidence to intelligence pipeline">
      {STEPS.map((s) => (
        <li key={s.n}>
          <Link to={s.to} title={s.hint}>
            <span className="n">{s.n}</span> {s.label}
          </Link>
        </li>
      ))}
    </ol>
  );
}
