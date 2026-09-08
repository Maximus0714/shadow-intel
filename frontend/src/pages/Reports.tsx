import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  DownloadSimple,
  BookmarkSimple,
  ArrowUpRight,
  FileText,
  Check,
} from "@phosphor-icons/react";
import { getGraphFull, getAlerts } from "../lib/api";
import { demoGraph } from "../lib/demo";
import {
  sampleAlerts,
  useWorkspace,
  useData,
  downloadFile,
} from "../lib/workspace";
import { PageHeader, ErrorState, Empty } from "../components/UI";
export default function Reports() {
  const { mode, cfg, watched, toggleWatch, notify } = useWorkspace();
  const scope = mode === "demo" ? "demo" : cfg.baseUrl;
  const key = `xt-notes:${scope}`;
  const legacyKey = `si-notes:${scope}`;
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("Investigation summary");
  useEffect(() => {
    try {
      setNotes(
        localStorage.getItem(key) || localStorage.getItem(legacyKey) || "",
      );
    } catch {
      setNotes("");
    }
  }, [key, legacyKey]);
  const state = useData(
    "reports",
    async (c) => {
      const [graph, alerts] = await Promise.all([
        getGraphFull(c, 1200),
        getAlerts(c),
      ]);
      return { graph, alerts: alerts.flags };
    },
    { graph: demoGraph, alerts: sampleAlerts },
  );
  const save = () => {
    try {
      localStorage.setItem(key, notes);
      localStorage.removeItem(legacyKey);
      notify("Analyst notes saved on this device.");
    } catch {
      notify("Storage is unavailable. Download a report to keep your notes.");
    }
  };
  const exportReport = (format: "json" | "md") => {
    if (!state.data) return;
    const report = {
      title: title.trim() || "Investigation summary",
      generated_by: "X-Tracer",
      generated_at: new Date().toISOString(),
      data_mode: mode,
      scope: state.data.graph.truncated
        ? "Capped graph snapshot"
        : "Loaded graph",
      nodes: state.data.graph.total_nodes,
      connections: state.data.graph.total_edges,
      watchlist: watched.map(
        (id) =>
          state.data!.graph.nodes.find((n) => n.id === id) || { id, name: id },
      ),
      alerts: state.data.alerts,
      analyst_notes: notes,
      notice:
        "Investigation aid only. Signals require evidence verification and human review.",
    };
    const content =
      format === "json"
        ? JSON.stringify(report, null, 2)
        : `# ${report.title}\n\nGenerated: ${report.generated_at}\nData mode: ${mode}\n\n## Network\n${report.nodes} entities, ${report.connections} connections.\n\n## Watchlist\n${report.watchlist.map((n) => `- ${n.name} (${n.id})`).join("\n") || "No saved entities."}\n\n## Signals\n${report.alerts.map((a) => `- ${a.pattern_type}: ${a.plain_language_explanation}`).join("\n") || "No alerts."}\n\n## Analyst notes\n${notes || "No notes."}\n\n${report.notice}\n`;
    downloadFile(
      `x-tracer-report.${format}`,
      content,
      format === "json" ? "application/json" : "text/markdown",
    );
    notify("Investigation summary downloaded.");
  };
  return (
    <>
      <PageHeader
        title="Keep the important things close."
        description="Your watchlist, your reasoning, and a summary you can take with you."
        eyebrow="REPORTS & WATCHLIST"
      />
      <div className="reports-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Saved entities</h2>
            <span className="tag">{watched.length}</span>
          </div>
          {watched.length ? (
            watched.map((id) => {
              const n = state.data?.graph.nodes.find((n) => n.id === id);
              return (
                <div className="entity-row" key={id}>
                  <span className="entity-avatar">
                    <BookmarkSimple size={20} />
                  </span>
                  <Link to={`/entities/${encodeURIComponent(id)}`}>
                    <strong>{n?.name || id}</strong>
                    <small>
                      {n?.label || "Entity"} · {id}
                    </small>
                  </Link>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${id} from watchlist`}
                    onClick={() => toggleWatch(id)}
                  >
                    <BookmarkSimple weight="fill" size={20} />
                  </button>
                </div>
              );
            })
          ) : (
            <Empty
              title="Start a watchlist"
              body="Save entities from search or a dossier. They’ll stay here on this device."
              action={
                <Link className="btn" to="/entities">
                  Explore entities <ArrowUpRight size={17} />
                </Link>
              }
            />
          )}
          <p className="helper">
            Watchlists are stored in this browser, separately for demo and live
            datasets.
          </p>
        </section>
        <section className="panel report-composer">
          <div className="panel-header">
            <h2>Investigation summary</h2>
            <FileText size={23} />
          </div>
          <label className="field">
            <span>Report title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
            />
          </label>
          <label className="field">
            <span>Analyst notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you observe? What needs verification? Document the reasoning behind your next steps."
              rows={8}
            />
          </label>
          <div className="inline-actions">
            <button className="btn" onClick={save}>
              <Check size={17} />
              Save notes
            </button>
            <span className="helper">Saved locally on this device.</span>
          </div>
          <div className="report-download">
            <h3>Take your findings with you.</h3>
            <p>
              The export includes network counts, your watchlist, flags and
              analyst notes.{" "}
              {mode === "demo"
                ? "Demo exports are clearly labeled fictional."
                : ""}
            </p>
            {state.error && (
              <ErrorState message={state.error} retry={state.retry} />
            )}
            <div className="inline-actions">
              <button
                className="btn primary"
                disabled={!state.data || state.loading}
                onClick={() => exportReport("md")}
              >
                <DownloadSimple size={18} />
                Download report
              </button>
              <button
                className="btn"
                disabled={!state.data || state.loading}
                onClick={() => exportReport("json")}
              >
                Export JSON
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
