import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FileText,
  ArrowRight,
  DownloadSimple,
  Sparkle,
  UploadSimple,
  ArrowUpRight,
} from "@phosphor-icons/react";
import { analyzeDocumentText } from "../lib/data/api";
import { useWorkspace, downloadFile } from "../lib/state/workspace";
import { PageHeader, Loading, Empty } from "../components/UI";
import AnalysisLocation from "../components/AnalysisLocation";
interface Analysis {
  doc_id: string;
  summary: string;
  classification?: Record<string, unknown>;
  triples?: Record<string, unknown>[];
  entities?: { text: string; type: string }[];
  warnings?: string[];
  resolution?: { clusters: { canonical_label: string; members: string[]; confidence: number }[]; review_queue: { entity_a: string; entity_b: string; confidence: number; reason: string }[]; method: string };
}
const SAMPLE =
  "Fictional demonstration report: Mohan Yadav called Ravi Sharma four times. Mohan Yadav is associated with vehicle MH12AB1234 and the Andheri location. A financial relationship connects Mohan Yadav and Farhan Qureshi. These records are illustrative and do not describe real events.";
const sampleAnalysis: Analysis = {
  doc_id: "fictional-sample",
  summary:
    "The sample links Mohan Yadav to Ravi Sharma through calls, to Farhan Qureshi through a financial relationship, and to a vehicle and location. Each relationship needs source verification before it informs an investigation.",
  classification: {
    type: "Fictional demonstration",
    method: "Prewritten sample, not model output",
  },
  entities: [
    { text: "Mohan Yadav", type: "Person" },
    { text: "Ravi Sharma", type: "Person" },
    { text: "Farhan Qureshi", type: "Person" },
    { text: "MH12AB1234", type: "Vehicle" },
    { text: "Andheri", type: "Location" },
  ],
  triples: [
    { subject: "Mohan Yadav", relation: "CALLED", object: "Ravi Sharma" },
    {
      subject: "Mohan Yadav",
      relation: "FINANCIAL_TRANSFER",
      object: "Farhan Qureshi",
    },
    { subject: "Mohan Yadav", relation: "OWNS_VEHICLE", object: "MH12AB1234" },
    { subject: "Mohan Yadav", relation: "REGISTERED_AT", object: "Andheri" },
  ],
  warnings: [
    "This is a prewritten demonstration. Your own text is analyzed with rules in your selected location.",
  ],
};
export default function Documents() {
  const { mode, cfg, notify, engine } = useWorkspace();
  const [text, setText] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("summary");
  const [resolutionDecisions, setResolutionDecisions] = useState<Record<number, "merge" | "separate">>({});
  const analyze = async () => {
    if (!text.trim()) {
      setError("Add report text or load the example first.");
      return;
    }
    setError("");
    setResult(null);
    setResolutionDecisions({});
    setBusy(true);
    try {
      if (mode === "demo" && text === SAMPLE) {
        setResult(sampleAnalysis);
      } else
        setResult((await analyzeDocumentText(cfg, text.trim())) as Analysis);
      setTab("summary");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="There’s more in the fine print."
        description="Turn reports and statements into summaries, entities and relationships."
        eyebrow="DOCUMENT INTEL"
      >
        <button
          className="btn"
          onClick={() => {
            setText(SAMPLE);
            setResult(null);
            setError("");
          }}
          disabled={busy}
        >
          <FileText size={17} />
          Load example
        </button>
      </PageHeader>
      <AnalysisLocation disabled={busy} />
      <div className="document-layout">
        <section className="panel document-source">
          <div className="panel-header">
            <h2>Source document</h2>
            <span className="tag">Plain text</span>
          </div>
          <label className="document-file">
            <UploadSimple size={18} />
            <span>Upload a .txt report</span>
            <input
              type="file"
              accept=".txt,text/plain"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setError("");
                setResult(null);
                if (f.size > 500_000) {
                  setError("Report too large. Maximum size is 500 KB.");
                  return;
                }
                try {
                  setText(await f.text());
                } catch {
                  setError("Could not read this file. Try pasting the text.");
                }
              }}
            />
          </label>
          <label className="field">
            <span>Report or statement</span>
            <textarea
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                setResult(null);
              }}
              placeholder="Paste a report, statement, or case note here…"
              rows={15}
            />
          </label>
          <div className="source-footer">
            <span className="mono muted">
              {text.length.toLocaleString()} characters
            </span>
            <button
              className="btn primary"
              disabled={busy || !text.trim()}
              onClick={analyze}
            >
              {busy ? "Analyzing…" : "Analyze document"}
              <ArrowRight size={17} />
            </button>
          </div>
          {error && (
            <div className="inline-notice warning" role="alert">
              {error}
              <span>{engine === "backend" ? "Submitted to the backend for rule-based extraction." : "Processed on this device with local extraction rules."}</span>
            </div>
          )}
        </section>
        <section className="panel document-result">
          <div className="panel-header">
            <h2>Document intelligence</h2>
            {result && (
              <button
                className="icon-button"
                aria-label="Download analysis JSON"
                onClick={() => {
                  downloadFile(
                    "document-analysis.json",
                    JSON.stringify(result, null, 2),
                    "application/json",
                  );
                  notify("Analysis downloaded.");
                }}
              >
                <DownloadSimple size={20} />
              </button>
            )}
          </div>
          {busy ? (
            <Loading label="Analyzing document" />
          ) : result ? (
            <>
              <div className="segmented result-tabs">
                {["summary", "entities", "relationships", "identity review"].map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {tab === "summary" && (
                <div className="analysis-summary">
                  <Sparkle size={27} weight="thin" />
                  <h3>The main picture</h3>
                  <p>{result.summary || "No summary returned."}</p>
                  {result.classification && (
                    <details className="ev">
                      <summary>Classification details</summary>
                      <pre>
                        {JSON.stringify(result.classification, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
              {tab === "entities" && (
                <div className="extracted-entities">
                  {result.entities?.length ? (
                    result.entities.map((e, i) => (
                      <Link
                        to={`/entities?q=${encodeURIComponent(e.text)}`}
                        key={i}
                      >
                        <span>
                          <strong>{e.text}</strong>
                          <small>{e.type}</small>
                        </span>
                        <ArrowUpRight size={18} />
                      </Link>
                    ))
                  ) : (
                    <Empty body="No identifiers or explicit connections matched the extraction rules. Try clear English statements such as Asha Rao called Kabir Shah." />
                  )}
                </div>
              )}
              {tab === "relationships" && (
                <div className="relation-list">
                  {result.triples?.length ? (
                    result.triples.map((t, i) => (
                      <div key={i}>
                        <strong>{String(t.subject || "")}</strong>
                        <span>
                          {String(t.relation || "").replace(/_/g, " ")}{" "}
                          <ArrowRight size={14} />
                        </span>
                        <strong>{String(t.object || "")}</strong>
                      </div>
                    ))
                  ) : (
                    <Empty body="No relationships extracted from this document." />
                  )}
                </div>
              )}
              {tab === "identity review" && (
                <div className="identity-review">
                  <p className="muted">{result.resolution?.method || "Identity matching was not available for this analysis."}</p>
                  {result.resolution?.review_queue?.length ? result.resolution.review_queue.map((candidate, i) => <div className="resolution-row" key={i}><div><strong>{candidate.entity_a}</strong><span> may match </span><strong>{candidate.entity_b}</strong><small>{candidate.reason}</small></div><span className="tag">{Math.round(candidate.confidence * 100)}% confidence</span><div className="resolution-actions"><button className={`btn compact ${resolutionDecisions[i] === "merge" ? "primary" : ""}`} onClick={() => setResolutionDecisions((current) => ({ ...current, [i]: "merge" }))}>Same identity</button><button className={`btn compact ${resolutionDecisions[i] === "separate" ? "primary" : ""}`} onClick={() => setResolutionDecisions((current) => ({ ...current, [i]: "separate" }))}>Keep separate</button></div></div>) : <Empty body="No possible duplicate identities need review." />}
                </div>
              )}
              {result.warnings?.map((w, i) => (
                <div className="inline-notice" key={i}>
                  {w}
                </div>
              ))}
            </>
          ) : (
            <div className="document-empty">
              <div className="document-glyph">
                <FileText size={58} weight="thin" />
              </div>
              <h3>Read between the lines.</h3>
              <p>
                Add a document to reveal its key entities, relationships, and
                summary.
              </p>
              <span>AI-assisted extraction. Analyst-led interpretation.</span>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
