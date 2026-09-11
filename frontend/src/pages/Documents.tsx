import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FileText,
  ArrowRight,
  DownloadSimple,
  Sparkle,
  UploadSimple,
  ArrowUpRight,
  PlusCircle,
} from "@phosphor-icons/react";
import { analyzeDocumentText } from "../lib/data/api";
import type { CleanedEdge } from "../lib/data/upload";
import { useWorkspace, downloadFile } from "../lib/state/workspace";
import { PageHeader, Loading, Empty } from "../components/UI";
import AnalysisLocation from "../components/AnalysisLocation";
interface Analysis {
  doc_id: string;
  summary: string;
  classification?: Record<string, unknown>;
  triples?: Record<string, unknown>[];
  records?: CleanedEdge[];
  entities?: { text: string; type: string }[];
  warnings?: string[];
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
  records: [
    { src: "Mohan Yadav", dst: "Ravi Sharma", rel: "CALLED", frequency: 4, date: "", amount: "", evidence: "Mohan Yadav called Ravi Sharma four times." },
    { src: "Mohan Yadav", dst: "Farhan Qureshi", rel: "FINANCIAL_TRANSFER", frequency: 1, date: "", amount: "", evidence: "A financial relationship connects Mohan Yadav and Farhan Qureshi." },
    { src: "Mohan Yadav", dst: "MH12AB1234", rel: "OWNS_VEHICLE", frequency: 1, date: "", amount: "", evidence: "Mohan Yadav is associated with vehicle MH12AB1234." },
    { src: "Mohan Yadav", dst: "Andheri", rel: "REGISTERED_AT", frequency: 1, date: "", amount: "", evidence: "Mohan Yadav is associated with the Andheri location." },
  ],
  warnings: [
    "This is a prewritten demonstration. Your own text is analyzed with rules in your selected location.",
  ],
};
export default function Documents() {
  const { mode, cfg, dataset, importData, notify } = useWorkspace();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [documentName, setDocumentName] = useState("Pasted document");
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("summary");
  const analyze = async () => {
    if (!text.trim()) {
      setError("Add report text or load the example first.");
      return;
    }
    setError("");
    setResult(null);
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
  const addToInvestigation = async () => {
    if (!result) return;
    const extracted: CleanedEdge[] = result.records?.length
      ? result.records
      : (result.triples || []).map((triple, index) => ({
          src: String(triple.subject || ""),
          dst: String(triple.object || ""),
          rel: String(triple.relation || "ASSOCIATE_OF"),
          frequency: 1,
          date: "",
          amount: "",
          evidence: String(triple.evidence || ""),
          source_rows: [index + 1],
        }));
    const usable = extracted.filter((record) => record.src && record.dst);
    if (!usable.length) {
      setError("No extracted relationships are available to add.");
      return;
    }
    const currentRecords = mode === "local" && dataset ? dataset.records : [];
    const signature = (record: CleanedEdge) => JSON.stringify([
      record.src.trim().toLowerCase(), record.dst.trim().toLowerCase(), record.rel,
      record.date || "", record.amount || "", record.currency || "", record.evidence || "",
    ]);
    const known = new Set(currentRecords.map(signature));
    const tagged = usable.map((record, index) => ({
      ...record,
      source_rows: record.source_rows?.length ? record.source_rows : [index + 1],
      attributes: {
        ...(record.attributes || {}),
        source_file: documentName,
        imported_via: "Document Intel",
      },
    }));
    const additions = tagged.filter((record) => {
      const key = signature(record);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (!additions.length) {
      setError("This document's extracted relationships are already in the current investigation.");
      return;
    }
    const hasCurrentCase = mode === "local" && Boolean(dataset);
    const caseName = hasCurrentCase ? dataset!.name : documentName.replace(/\.[^.]+$/, "") || "Document investigation";
    const sourceText = [
      hasCurrentCase ? dataset?.source_document?.source_text : "",
      `SOURCE DOCUMENT: ${documentName}\n${text.trim()}`,
    ].filter(Boolean).join("\n\n-----\n\n");
    setError("");
    setAdding(true);
    try {
      await importData(
        [...currentRecords, ...additions],
        caseName,
        hasCurrentCase ? dataset!.id : undefined,
        sourceText,
      );
      notify(`${additions.length} relationship${additions.length === 1 ? "" : "s"} added to ${caseName}.`);
      navigate("/overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
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
            setDocumentName("Fictional demonstration report");
            setResult(null);
            setError("");
          }}
          disabled={busy || adding}
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
              disabled={busy || adding}
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
                  setDocumentName(f.name);
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
              disabled={busy || adding}
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
              <span>Submitted to the backend for extraction.</span>
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
                {["summary", "entities", "relationships"].map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="document-import-bar">
                <div>
                  <strong>{mode === "local" && dataset ? `Add to ${dataset.name}` : "Create an investigation"}</strong>
                  <span>{mode === "local" && dataset ? "Merge new links with the open case and run the analysis again." : "Use these extracted links as a new case."}</span>
                </div>
                <button className="btn primary" disabled={busy || adding || !(result.records?.length || result.triples?.length)} onClick={() => void addToInvestigation()}>
                  <PlusCircle size={18} />
                  {adding ? "Adding..." : mode === "local" && dataset ? "Add to case" : "Create case"}
                </button>
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
