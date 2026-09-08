import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PlugsConnected,
  CheckCircle,
  ArrowRight,
  Eye,
  EyeSlash,
  ArrowClockwise,
  Desktop,
  ShieldCheck,
} from "@phosphor-icons/react";
import { getStats, reloadGraph } from "../lib/api";
import { useWorkspace } from "../lib/workspace";
import { PageHeader } from "../components/UI";
export default function Settings() {
  const ws = useWorkspace();
  const [cfg, setCfg] = useState(ws.cfg);
  const [remember, setRemember] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [valid, setValid] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const test = async (save = false) => {
    setBusy(true);
    setMessage("");
    setValid(false);
    try {
      const url = new URL(cfg.baseUrl);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Use an HTTP or HTTPS backend address.");
      const clean = {
        baseUrl: cfg.baseUrl.trim().replace(/\/$/, ""),
        key: cfg.key.trim(),
      };
      const stats = await getStats(clean);
      setValid(true);
      setMessage(
        `Authenticated successfully. ${stats.nodes} entities and ${stats.edges} connections available.`,
      );
      if (save) ws.connect(clean, remember);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Make this workspace yours."
        description="Connect a data source, choose your working mode, and manage the local session."
        eyebrow="SETTINGS"
      />
      <div className="settings-grid">
        <section className="panel connection-panel">
          <div className="panel-icon">
            <PlugsConnected size={30} weight="thin" />
          </div>
          <h2>Connect your backend</h2>
          <p className="muted">
            Your workspace connects directly to your Shadow Intel API.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              test(true);
            }}
          >
            <label className="field">
              <span>Backend URL</span>
              <input
                type="url"
                aria-label="Backend URL"
                aria-describedby="backend-url-help"
                required
                value={cfg.baseUrl}
                onChange={(e) => {
                  setCfg({ ...cfg, baseUrl: e.target.value });
                  setValid(false);
                }}
                placeholder="http://127.0.0.1:8000"
              />
              <small id="backend-url-help">
                Use the address where your FastAPI service is running.
              </small>
            </label>
            <label className="field">
              <span>API key</span>
              <div className="password-field">
                <input
                  required
                  type={visible ? "text" : "password"}
                  aria-label="API key"
                  value={cfg.key}
                  onChange={(e) => {
                    setCfg({ ...cfg, key: e.target.value });
                    setValid(false);
                  }}
                  autoComplete="off"
                  placeholder="Enter your API key"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? "Hide API key" : "Show API key"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeSlash /> : <Eye />}
                </button>
              </div>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember credentials on this device
            </label>
            <div className="inline-actions">
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? "Connecting…" : "Connect workspace"}
                <ArrowRight size={17} />
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => test()}
              >
                Test connection
              </button>
            </div>
            {message && (
              <div
                className={`inline-notice ${valid ? "success" : "warning"}`}
                role="status"
              >
                {valid && <CheckCircle size={18} />} {message}
              </div>
            )}
          </form>
        </section>
        <div className="settings-side">
          <section className="panel">
            <Desktop size={27} weight="thin" />
            <h2>Choose your workspace</h2>
            <p className="muted">
              Demo and live data remain separate. Switch whenever you need.
            </p>
            <div className="mode-options">
              <button
                className={ws.mode === "demo" ? "selected" : ""}
                onClick={() => ws.setMode("demo")}
              >
                <strong>Explore demo</strong>
                <span>Fictional data. All the tools to get started.</span>
                {ws.mode === "demo" && <CheckCircle size={19} />}
              </button>
              <button
                className={ws.mode === "live" ? "selected" : ""}
                onClick={() => ws.setMode("live")}
              >
                <strong>Live investigation</strong>
                <span>Your configured backend and evidence.</span>
                {ws.mode === "live" && <CheckCircle size={19} />}
              </button>
            </div>
          </section>
          <section className="panel">
            <ShieldCheck size={25} weight="thin" />
            <h2>Your data, your context.</h2>
            <p className="muted">
              Watchlists and notes are saved in this browser. Credentials stay
              in this session unless you choose to remember them.
            </p>
            <Link className="text-link" to="/reports">
              Review saved work <ArrowRight size={16} />
            </Link>
          </section>
        </div>
      </div>
      <section className="panel maintenance">
        <div>
          <h2>Reload source datasets</h2>
          <p className="muted">
            Rebuild the backend graph from configured files. In-memory uploads
            will be replaced.
          </p>
        </div>
        {!confirmReload ? (
          <button
            className="btn"
            disabled={ws.mode === "demo"}
            onClick={() => setConfirmReload(true)}
          >
            <ArrowClockwise size={17} />
            Reload datasets
          </button>
        ) : (
          <div className="inline-actions">
            <button className="btn" onClick={() => setConfirmReload(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await reloadGraph(ws.cfg);
                  ws.refresh();
                  ws.notify("Source datasets reloaded.");
                  setConfirmReload(false);
                } catch (e) {
                  ws.notify(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm reload
            </button>
          </div>
        )}
      </section>
    </>
  );
}
