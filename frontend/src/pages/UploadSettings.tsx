import { useState } from "react";
import { Link } from "react-router-dom";
import PreviewTable from "../components/PreviewTable";
import {
  cleanRows,
  detectMapping,
  parseFile,
  type CleanedEdge,
  type SkippedRow,
} from "../lib/upload";
import {
  getHealth,
  loadConfig,
  postIngest,
  saveConfig,
} from "../lib/api";

export default function UploadSettings() {
  const [cfg, setCfg] = useState(loadConfig);
  const [remember, setRemember] = useState(true);
  const [connStatus, setConnStatus] = useState<string>("Not tested yet.");
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [cleaned, setCleaned] = useState<CleanedEdge[]>([]);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const testConn = async () => {
    setConnStatus("Testing…");
    try {
      const h = await getHealth(cfg);
      setConnStatus(`OK — backend: ${h.backend || "unknown"}, status: ${h.status}.`);
    } catch (e) {
      setConnStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const save = () => {
    saveConfig(cfg, remember);
    setConnStatus("Saved. " + connStatus);
  };

  const onFile = async (f: File | undefined) => {
    setMsg(null);
    setCleaned([]);
    setSkipped([]);
    if (!f) return;
    setFile(f);
    try {
      const info = await parseFile(f);
      setSheets(info.sheetNames);
      setSheet(info.sheet);
      setColumns(info.columns);
      setRows(info.rows);
      setMapping(detectMapping(info.columns));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const onSheet = async (name: string) => {
    if (!file) return;
    setSheet(name);
    try {
      const info = await parseFile(file, name);
      setColumns(info.columns);
      setRows(info.rows);
      setMapping(detectMapping(info.columns));
      setCleaned([]);
      setSkipped([]);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const runClean = () => {
    if (!rows.length) {
      setMsg("No rows parsed yet.");
      return;
    }
    const { cleaned: c, skipped: s } = cleanRows(rows, mapping);
    setCleaned(c);
    setSkipped(s);
    setMsg(`Cleaned: ${c.length} edges, ${s.length} skipped. Review below, then send to backend.`);
  };

  const sendToBackend = async (endpoint: "preview" | "load") => {
    if (!file) {
      setMsg("Choose a file first.");
      return;
    }
    setBusy(true);
    try {
      const r = await postIngest(cfg, endpoint, file, sheet || undefined);
      const j = r as Record<string, unknown>;
      setMsg(
        endpoint === "preview"
          ? `Server preview: ${String(j.rows_cleaned)} cleaned rows, ${String(j.node_count)} nodes, ${String(j.edge_count)} edges.`
          : `Loaded: ${JSON.stringify(j.loaded)}. ${String(j.note || "")}`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Upload &amp; Settings</h1>
      <p className="sub">
        Connect the backend, then bring your own data: CSV or XLSX is
        auto-detected, cleaned and previewed before anything is loaded.
      </p>

      <div className="card">
        <h2>Backend connection</h2>
        <label className="field">
          <span>Base URL</span>
          <input type="text" value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} />
        </label>
        <label className="field">
          <span>API key (X-API-Key)</span>
          <input type="text" value={cfg.key} onChange={(e) => setCfg({ ...cfg, key: e.target.value })} placeholder="paste X-API-Key…" autoComplete="off" />
        </label>
        <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this machine
        </label>
        <p style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={testConn}>Test connection</button>
          <button className="btn primary" onClick={save}>Save</button>
        </p>
        <p className="mono" style={{ marginTop: 8 }}>{connStatus}</p>
      </div>

      <div className="card">
        <h2>Smart upload — CSV / XLSX / JSON</h2>
        <label className="field">
          <span>Data file (.csv, .xlsx, .xls, .json)</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.json"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {sheets.length > 1 && (
          <label className="field" style={{ maxWidth: 320 }}>
            <span>Worksheet</span>
            <select value={sheet} onChange={(e) => onSheet(e.target.value)}>
              {sheets.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {columns.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, margin: "10px 0 6px" }}>Detected column mapping (override if wrong)</h3>
            <div className="grid2">
              {["source", "target", "rel", "weight", "date", "amount"].map((role) => (
                <label className="field" key={role}>
                  <span>{role}</span>
                  <select
                    value={mapping[role] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [role]: e.target.value || null })}
                  >
                    <option value="">— none —</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" onClick={runClean}>Clean &amp; preview</button>
              <button className="btn" onClick={() => sendToBackend("preview")} disabled={busy || !file}>
                Server preview
              </button>
              <button className="btn" onClick={() => sendToBackend("load")} disabled={busy || !file}>
                {busy ? "Sending…" : "Confirm & send to backend"}
              </button>
            </p>
          </>
        )}
        {msg && <p style={{ marginTop: 10 }}>{msg}</p>}
        {(cleaned.length > 0 || skipped.length > 0) && (
          <div style={{ marginTop: 10 }}>
            <PreviewTable columns={columns} rows={cleaned} skipped={skipped} />
            <p style={{ marginTop: 8 }}>
              <Link className="btn primary" to="/network">Open in Network Explorer</Link>
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Demo dataset</h2>
        <p className="sub">
          No backend? Every page falls back to a small fictional demo graph
          automatically. Use it to explore the UI offline.
        </p>
        <p>
          <Link className="btn" to="/network">Explore demo graph</Link>
        </p>
      </div>
    </>
  );
}
