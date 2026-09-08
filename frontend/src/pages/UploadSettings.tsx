import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  UploadSimple,
  FileCsv,
  CheckCircle,
  ArrowRight,
  ArrowsClockwise,
  Database,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  parseFile,
  detectMapping,
  cleanRows,
  type SheetInfo,
} from "../lib/upload";
import { postIngest } from "../lib/api";
import { useWorkspace } from "../lib/workspace";
import { PageHeader, Empty } from "../components/UI";
import PreviewTable from "../components/PreviewTable";
export default function UploadSettings() {
  const { cfg, mode, refresh, notify } = useWorkspace();
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
  const send = async (endpoint: "preview" | "load") => {
    if (!file || !info) return;
    setBusy(true);
    setError("");
    try {
      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const converted = file.name.toLowerCase().endsWith(".xls")
        ? new File(
            [
              [
                info.columns,
                ...info.rows.map((r) => info.columns.map((c) => r[c] || "")),
              ]
                .map((r) => r.map(quote).join(","))
                .join("\n"),
            ],
            "converted.csv",
            { type: "text/csv" },
          )
        : file;
      const r = (await postIngest(
        cfg,
        endpoint,
        converted,
        info.sheet || undefined,
        mapping,
      )) as { rows_cleaned?: number; node_count?: number; edge_count?: number };
      if (endpoint === "preview")
        setMessage(
          `Server validated ${r.rows_cleaned} rows, ${r.node_count} entities and ${r.edge_count} relationships.`,
        );
      else {
        refresh();
        notify("Evidence imported. Your network is ready to explore.");
        navigate("/network");
      }
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
        description="Bring in your records. We’ll help you turn them into connections."
        eyebrow="UPLOAD & SETTINGS"
      />
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
              {mode === "demo" ? (
                <div className="inline-notice">
                  <Database size={20} />
                  <span>
                    Your preview is ready. Connect your backend to import these
                    records.
                  </span>
                  <Link className="btn" to="/settings">
                    Connect backend <ArrowRight size={15} />
                  </Link>
                </div>
              ) : (
                <div className="inline-actions">
                  <button
                    className="btn primary"
                    disabled={!reviewed || busy}
                    onClick={() => send("load")}
                  >
                    {busy ? "Processing…" : "Build network"}
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => send("preview")}
                  >
                    <ArrowsClockwise size={17} />
                    Validate on server
                  </button>
                </div>
              )}
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
