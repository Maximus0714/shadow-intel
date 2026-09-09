import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  UploadSimple,
  FileCsv,
  CheckCircle,
  ArrowRight,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  parseFile,
  detectMapping,
  cleanRows,
  type SheetInfo,
} from "../lib/data/upload";
import { useWorkspace } from "../lib/state/workspace";
import { PageHeader, Empty } from "../components/UI";
import PreviewTable from "../components/PreviewTable";
import AnalysisLocation from "../components/AnalysisLocation";
import { ANALYSIS_VERSION } from "../lib/analysis/local";
export default function UploadSettings() {
  const { importData, dataset, setMode, engine } = useWorkspace();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<SheetInfo | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [drag, setDrag] = useState(false);
  const version = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const cleaned = useMemo(
    () => (info ? cleanRows(info.rows, mapping) : { cleaned: [], skipped: [] }),
    [info, mapping],
  );
  const parse = async (f: File, sheet?: string) => {
    const ticket = ++version.current;
    setFile(f);
    setInfo(null);
    setMapping({});
    setError("");
    setMessage("");
    setReviewed(false);
    setParsing(true);
    try {
      const result = await parseFile(f, sheet);
      if (ticket !== version.current) return;
      setInfo(result);
      setMapping(detectMapping(result.columns));
      if (!result.rows.length)
        setError(
          "This file has no data rows. Choose a populated worksheet or another file.",
        );
    } catch (e) {
      if (ticket === version.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === version.current) setParsing(false);
    }
  };
  const send = async () => {
    if (!file || !info || !reviewed) return;
    setBusy(true);
    setError("");
    try {
      await importData(cleaned.cleaned, file.name);
      navigate("/overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Every investigation starts somewhere."
        description="Upload your records, choose where to analyze them, and explore a detailed investigation."
        eyebrow="YOUR EVIDENCE"
      />
      <AnalysisLocation disabled={busy} />
      {dataset && (
        <div className="inline-notice">
          <span>Saved investigation: {dataset.name}</span>
          <button
            className="btn"
            onClick={() => {
              setMode("local");
              navigate("/overview");
            }}
          >
            Resume investigation
          </button>
          <button className="btn" disabled={busy} onClick={async()=>{
            setBusy(true);setError("");
            try { await importData(dataset.records,dataset.name,dataset.id);navigate("/overview"); }
            catch(e){setError(e instanceof Error?e.message:String(e));}
            finally{setBusy(false);}
          }}>{busy ? "Reanalyzing…" : "Reanalyze saved evidence"}</button>
          <span>{dataset.analysis_version === ANALYSIS_VERSION ? `Analysis ${ANALYSIS_VERSION}` : "Older calculations: reanalyze to apply matching results. Your notes and watchlist are retained."}</span>
        </div>
      )}
      <section className="panel data-guide">
        <h2>What can X-Tracer process?</h2>
        <p>
          Use <strong>CSV, XLSX, XLS or JSON</strong> with one relationship per
          row. Maximum{" "}
          <strong>5 MB, 10,000 relationships and 2,000 entities</strong>.
          Results are saved in this browser. Connected backend sends your reviewed records to the server; On this device keeps processing local.
        </p>
        <div className="data-guide-grid">
          <div>
            <h3>Communication & connections</h3>
            <p>
              Caller → receiver, sender → recipient, or person → associate.
              Include frequency to compare repeated interactions.
            </p>
          </div>
          <div>
            <h3>Transfers, vehicles & locations</h3>
            <p>
              Sender → recipient with an amount, person → vehicle, or person →
              address. Dates and amounts appear in the entity’s source records.
            </p>
          </div>
          <div>
            <h3>Required columns</h3>
            <p>
              <strong>Source and target</strong>: consistent names or IDs at
              both ends. Optional: relationship, frequency, date (YYYY-MM-DD),
              amount (plain number). Missing type defaults to ASSOCIATE_OF.
            </p>
          </div>
          <div>
            <h3>Reports & case notes</h3>
            <p>
              For pasted English text or .txt files, use{" "}
              <Link to="/documents">Document Intel</Link>. Local rules extract
              explicit connections and identifiers, plus a summary. PDF scans,
              images, audio, chat archives and inboxes are not parsed.
            </p>
          </div>
        </div>
        <details>
          <summary>Supported relationship types and example format</summary>
          <p>
            CALLED, EMAILED, CONTACTED, ASSOCIATE_OF, FINANCIAL_TRANSFER,
            FAMILY_OF, CO_LOCATED, OWNS_VEHICLE, REGISTERED_AT. Unknown types
            are skipped with a reason. Use the same currency across financial
            records; no currency conversion is performed.
          </p>
          <pre className="data-example">
            {
              "src,dst,rel,frequency,date,amount\nAsha Rao,Kabir Shah,CALLED,4,2026-09-01,\nAsha Rao,Meera Sen,FINANCIAL_TRANSFER,1,2026-09-02,12000\nKabir Shah,MH12AB1234,OWNS_VEHICLE,1,,\nMeera Sen,Pune,REGISTERED_AT,1,,"
            }
          </pre>
          <p>
            JSON: an object with an <code>edges</code> array containing{" "}
            <code>src</code>, <code>dst</code> and optional <code>rel</code>,{" "}
            <code>frequency</code>, <code>date</code>, <code>amount</code>.
            Node-only lists and adjacency matrices need conversion to
            relationship rows.
          </p>
        </details>
        <p className="helper">
          You’ll get a searchable graph, entity dossiers and source records,
          influence rankings, communities, path tracing, explainable flags, a
          watchlist and downloadable reports. Flags describe review-worthy
          patterns, not guilt; some datasets produce no flags.
        </p>
      </section>
      <div className="import-steps">
        <span className="active">
          <b>1</b>Choose a file
        </span>
        <span className={info ? "active" : ""}>
          <b>2</b>Map & review
        </span>
        <span className={reviewed ? "active" : ""}>
          <b>3</b>Build your graph
        </span>
      </div>
      <section
        className={`upload-dropzone ${drag ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !parsing) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f && !busy && !parsing) parse(f);
        }}
      >
        <div className="upload-orbit">
          <UploadSimple size={35} weight="thin" />
        </div>
        <h2>
          {parsing
            ? "Reading your file…"
            : file
              ? file.name
              : "Bring your evidence into focus."}
        </h2>
        <p>Drop a file here, or choose one from your device.</p>
        <button
          className="btn primary"
          disabled={busy || parsing}
          onClick={() => input.current?.click()}
        >
          {file ? "Choose another file" : "Choose file"}
          <ArrowRight size={17} />
        </button>
        <input
          ref={input}
          className="sr-only"
          type="file"
          aria-label="Choose evidence file"
          accept=".csv,.xlsx,.xls,.json"
          disabled={busy || parsing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) parse(f);
          }}
        />
        <div className="file-types">
          <span>CSV</span>
          <span>XLSX / XLS</span>
          <span>JSON</span>
          <small>Up to 5 MB</small>
        </div>
      </section>
      {error && (
        <div className="inline-notice warning" role="alert">
          <WarningCircle size={20} />
          {error}
        </div>
      )}
      {info && (
        <section className="panel mapping-panel">
          <div className="panel-header">
            <div>
              <h2>Make sure the columns match.</h2>
              <p className="muted">
                Review the detected roles. Source and target identify the
                connected entities.
              </p>
            </div>
            <span className="tag">{info.rows.length} source rows</span>
          </div>
          {info.sheetNames.length > 1 && (
            <label className="field">
              <span>Worksheet</span>
              <select
                disabled={busy || parsing}
                value={info.sheet}
                onChange={(e) => file && parse(file, e.target.value)}
              >
                {info.sheetNames.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
          <div className="mapping-grid">
            {[
              { id: "source", name: "Source entity", required: true },
              { id: "target", name: "Target entity", required: true },
              { id: "rel", name: "Relationship type" },
              { id: "weight", name: "Frequency / weight" },
              { id: "date", name: "Date / timestamp" },
              { id: "amount", name: "Amount" },
            ].map((role) => (
              <label className="field" key={role.id}>
                <span>
                  {role.name}
                  {role.required && " *"}
                </span>
                <select
                  aria-label={role.name + (role.required ? " *" : "")}
                  value={mapping[role.id] || ""}
                  disabled={busy}
                  onChange={(e) => {
                    setMapping({
                      ...mapping,
                      [role.id]: e.target.value || null,
                    });
                    setReviewed(false);
                    setMessage("");
                  }}
                >
                  <option value="">
                    {role.required ? "Select a column" : "Not included"}
                  </option>
                  {info.columns.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {cleaned.cleaned.length ? (
            <>
              <div className="preview-summary">
                <CheckCircle size={22} />
                <span>
                  <strong>{cleaned.cleaned.length} usable relationships</strong>
                  <small>
                    {cleaned.skipped.length} skipped rows. Repeated
                    non-financial relationships are combined.
                  </small>
                </span>
              </div>
              <div className="table-scroll">
                <PreviewTable
                  columns={info.columns}
                  rows={cleaned.cleaned}
                  skipped={cleaned.skipped}
                />
              </div>
              <label className="checkbox-label review-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I’ve reviewed the mapping and cleaned records.
              </label>
              {dataset && (
                <p className="helper">
                  Building a new investigation replaces the currently saved
                  dataset, {dataset.name}. Download its report first if you need
                  to keep it.
                </p>
              )}
              <button
                className="btn primary"
                disabled={!reviewed || busy || parsing}
                onClick={send}
              >
                {busy ? (engine === "backend" ? "Analyzing on server…" : "Analyzing locally…") : "Build network"}{" "}
                <ArrowRight size={17} />
              </button>
            </>
          ) : (
            <Empty
              title="Choose source and target columns"
              body="Each relationship needs an entity at both ends. Check the mapping above."
            />
          )}
          {message && (
            <div className="inline-notice success" role="status">
              {message}
            </div>
          )}
        </section>
      )}
      <div className="import-help">
        <FileCsv size={28} weight="thin" />
        <div>
          <h3>A good starting point</h3>
          <p>
            Use a row per relationship, with source and target columns.
            Optionally include type, frequency, date and amount.{" "}
            <button
              className="text-link"
              onClick={() => {
                const a = document.createElement("a");
                a.href =
                  "data:text/csv;charset=utf-8,src%2Cdst%2Crel%2Cfrequency%0Aexample-a%2Cexample-b%2CCALLED%2C1%0A";
                a.download = "relationship-template.csv";
                a.click();
              }}
            >
              Download CSV template <ArrowRight size={14} />
            </button>
          </p>
        </div>
      </div>
    </>
  );
}
