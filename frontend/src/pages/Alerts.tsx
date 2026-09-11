import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ShieldCheck,
  ArrowUpRight,
  CaretDown,
  WarningCircle,
} from "@phosphor-icons/react";
import { getAlerts } from "../lib/data/api";
import { sampleAlerts, useData, readable } from "../lib/state/workspace";
import { PageHeader, Loading, ErrorState, Empty } from "../components/UI";
export default function Alerts() {
  const [params] = useSearchParams();
  const entity = params.get("entity");
  const [severity, setSeverity] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const state = useData("alerts", getAlerts, {
    flags: sampleAlerts,
    total: sampleAlerts.length,
  });
  const all = state.data?.flags || [];
  const flags = all.filter(
    (a) =>
      (!entity || a.entities_involved.includes(entity)) &&
      (severity === "all" ||
        (severity === "high"
          ? a.severity_score >= 0.7
          : severity === "medium"
            ? a.severity_score >= 0.4 && a.severity_score < 0.7
            : a.severity_score < 0.4)),
  );
  return (
    <>
      <PageHeader
        title="Signals worth a closer look."
        description="Review the pattern. Examine the evidence. Make your own judgment."
        eyebrow="ALERTS & PATTERNS"
      />
      <div className="signal-summary">
        <ShieldCheck size={24} />
        <p>
          These are investigation leads, not conclusions. Every flag needs
          context and human review. Priority reflects rule strength and evidence
          completeness; it is not a probability of wrongdoing.
        </p>
      </div>
      <div className="filter-bar">
        <div className="segmented">
          {["all", "high", "medium", "low"].map((s) => (
            <button
              key={s}
              className={severity === s ? "active" : ""}
              onClick={() => setSeverity(s)}
            >
              {s === "all" ? "All signals" : readable(s)}
            </button>
          ))}
        </div>
        <span className="muted">{flags.length} signals</span>
      </div>
      {entity && (
        <div className="inline-notice">
          Showing signals for {entity}.{" "}
          <Link to="/alerts">Clear entity filter</Link>
        </div>
      )}
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.retry} />
      ) : flags.length ? (
        <div className="signals-list">
          {flags.map((a, i) => {
            const level =
              a.severity_score >= 0.7
                ? "high"
                : a.severity_score >= 0.4
                  ? "medium"
                  : "low";
            return (
              <section
                className={`signal-card ${level}`}
                key={`${a.pattern_type}-${i}`}
              >
                <div className="signal-icon">
                  <WarningCircle size={23} />
                </div>
                <div className="signal-content">
                  <div className="signal-card-top">
                    <span className={`severity-label ${level}`}>
                      {level} priority
                    </span>
                    <span className="mono">
                      {Math.round(a.severity_score * 100)}/100 review priority
                    </span>
                    <span className="source-label">
                      {a.source_dataset || "Connected dataset"}
                    </span>
                  </div>
                  <h2>{readable(a.pattern_type)}</h2>
                  <p>{a.plain_language_explanation}</p>
                  <div className="signal-entities">
                    {a.entities_involved.map((id) => (
                      <Link
                        className="chip"
                        to={`/entities/${encodeURIComponent(id)}`}
                        key={id}
                      >
                        {id}
                        <ArrowUpRight size={13} />
                      </Link>
                    ))}
                  </div>
                  <button
                    className="text-link"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    aria-expanded={expanded === i}
                  >
                    View supporting evidence <CaretDown size={16} />
                  </button>
                  {expanded === i && (
                    <EvidenceFacts evidence={a.evidence || {}} />
                  )}
                </div>
                <Link
                  className="icon-button"
                  aria-label="Explore alert connections"
                  to={`/network?focus=${encodeURIComponent(a.entities_involved[0] || "")}`}
                >
                  <ArrowUpRight size={21} />
                </Link>
              </section>
            );
          })}
        </div>
      ) : (
        <Empty
          title="No signals in this view"
          body="Adjust the filters or bring in additional evidence. Some checks require financial relationships."
        />
      )}
    </>
  );
}

function EvidenceFacts({evidence}:{evidence:Record<string,unknown>}) {
  const format=(value:unknown):string=>{
    if(Array.isArray(value))return value.map(item=>typeof item==="object"?JSON.stringify(item):String(item)).join(" · ");
    if(value&&typeof value==="object")return Object.entries(value as Record<string,unknown>).map(([key,item])=>`${readable(key)}: ${String(item)}`).join(" · ");
    if(typeof value==="number"&&!Number.isInteger(value))return value.toFixed(2);
    return String(value??"Not supplied");
  };
  return <dl className="evidence-facts">{Object.entries(evidence).map(([key,value])=><div key={key}><dt>{readable(key)}</dt><dd>{format(value)}</dd></div>)}</dl>;
}
