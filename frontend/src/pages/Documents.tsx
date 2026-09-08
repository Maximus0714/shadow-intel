import { useState } from "react";
import { Link } from "react-router-dom";
import { analyzeDocumentText, loadConfig } from "../lib/api";

interface Analysis {
  doc_id: string;
  summary: string;
  classification?: Record<string, unknown>;
  triples?: Record<string, unknown>[];
  entities?: { text: string; type: string }[];
  warnings?: string[];
}

const SAMPLE =
  "FIR No. 102/2024 was registered at Andheri Police Station on the complaint of Ravi Sharma. " +
  "The complainant stated that on 12 March 2024, accused Mohan Yadav met Ravi Sharma near Gateway of India, Mumbai " +
  "and demanded Rs. 50,000 on behalf of Sharma Enterprises. The accused was later spotted with Anil Verma in Andheri.";

export default function Documents() {
  const [cfg] = useState(loadConfig);
  const [text, setText] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const analyze = async () => {
    if (!text.trim()) {
      setError("Paste report text or load the sample first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await analyzeDocumentText(cfg, text.trim());
      setResult(r as Analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Document Intel</h1>
      <p className="sub">
        Summarise a report, classify it, extract relationships and named
        entities. Entity mentions link back into search and the graph.
      </p>
      <div className="card">
        <h2>Source text</h2>
        <label className="field">
          <span>Report text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste an FIR, summary or statement…"
          />
        </label>
        <p style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setText(SAMPLE)}>
            Load sample FIR
          </button>
          <button className="btn primary" onClick={analyze} disabled={busy}>
            {busy ? "Analyzing…" : "Analyze"}
          </button>
        </p>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>
      {result && (
        <>
          <div className="card">
            <h2>Summary</h2>
            <p>{result.summary || "No summary returned."}</p>
            {result.classification && Object.keys(result.classification).length > 0 && (
              <details className="ev">
                <summary>Classification</summary>
                <pre>{JSON.stringify(result.classification, null, 2)}</pre>
              </details>
            )}
          </div>
          <div className="grid2">
            <div className="card">
              <h2>Entities ({result.entities?.length ?? 0})</h2>
              {result.entities?.length ? (
                <p>
                  {result.entities.map((e, i) => (
                    <span
                      key={i}
                      className="chip"
                      title={`${e.text} (${e.type})`}
                    >
                      {e.text} · {e.type}
                    </span>
                  ))}
                </p>
              ) : (
                <div className="empty">No entities extracted.</div>
              )}
            </div>
            <div className="card">
              <h2>Relationships ({result.triples?.length ?? 0})</h2>
              {result.triples?.length ? (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Relation</th>
                      <th>Object</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.triples.slice(0, 20).map((t, i) => (
                      <tr key={i}>
                        <td className="mono">{String(t.subject ?? t.src ?? "")}</td>
                        <td className="mono">{String(t.relation ?? t.rel ?? "")}</td>
                        <td className="mono">{String(t.object ?? t.dst ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">No relationships extracted.</div>
              )}
            </div>
          </div>
          {!!result.warnings?.length && (
            <div className="card">
              <h2>Warnings</h2>
              <ul style={{ paddingLeft: 18 }}>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
