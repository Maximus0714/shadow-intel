import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getEntity, loadConfig, type EntityDetail, type FullGraphNode } from "../lib/api";

interface Props {
  node: FullGraphNode | null;
  onClose: () => void;
  onFocus: (id: string) => void;
}

export default function DossierPanel({ node, onClose, onFocus }: Props) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node) {
      setDetail(null);
      setErr(null);
      return;
    }
    const cfg = loadConfig();
    let cancelled = false;
    setLoading(true);
    getEntity(cfg, node.id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setErr(null);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [node?.id]);

  if (!node) return null;
  const inf = detail?.influence_score ?? node.influence_score;
  const role = detail?.role ?? node.role ?? "unknown";
  return (
    <aside className="dossier" aria-label="Entity dossier">
      <p style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong style={{ fontSize: 16 }}>{detail?.name ?? node.name}</strong>
        <button className="btn" onClick={onClose} aria-label="Close dossier">
          Close
        </button>
      </p>
      <p style={{ marginTop: 6 }}>
        <span className={`tag ${(role || "unknown").toLowerCase()}`}>
          {(role || "UNKNOWN").toUpperCase()}
        </span>{" "}
        <span className="mono">{node.id}</span>
      </p>
      {typeof inf === "number" && (
        <>
          <p className="mono" style={{ marginTop: 6 }}>
            influence {inf.toFixed(3)}
          </p>
          <div className="bar">
            <i style={{ width: `${Math.round(Math.min(1, Math.max(0, inf)) * 100)}%` }} />
          </div>
        </>
      )}
      {loading && <div className="skeleton" style={{ marginTop: 10 }}>Loading dossier…</div>}
      {err && (
        <div className="error" style={{ marginTop: 10 }}>
          {err} (showing graph fields only)
        </div>
      )}
      {detail && (
        <dl className="kv">
          <dt>Degree</dt>
          <dd className="mono">
            {detail.degree} (in {detail.in_degree} / out {detail.out_degree})
          </dd>
          <dt>Source</dt>
          <dd className="mono">{detail.source || "—"}</dd>
          <dt>Community</dt>
          <dd className="mono">{detail.community_id ?? node.community_id ?? "—"}</dd>
          {Object.entries(detail.properties || {})
            .slice(0, 6)
            .map(([k, v]) => (
              <>
                <dt key={k}>{k}</dt>
                <dd className="mono" key={k + "-v"}>
                  {String(v).slice(0, 120)}
                </dd>
              </>
            ))}
        </dl>
      )}
      <h3 style={{ fontSize: 13, margin: "10px 0 6px" }}>Connections</h3>
      {detail ? (
        detail.neighbours_sample.length ? (
          <p>
            {detail.neighbours_sample.slice(0, 12).map((n) => (
              <button key={n} className="chip" onClick={() => onFocus(n)} title={`Focus ${n}`}>
                {n}
              </button>
            ))}
          </p>
        ) : (
          <div className="empty">No linked entities returned.</div>
        )
      ) : (
        <div className="empty">Open with backend online for connections.</div>
      )}
      <p style={{ marginTop: 10 }}>
        <Link className="btn" to={`/alerts`}>
          Check alerts for this entity
        </Link>{" "}
        <Link className="btn" to={`/entities/${encodeURIComponent(node.id)}`}>
          Full entity view
        </Link>
      </p>
    </aside>
  );
}
