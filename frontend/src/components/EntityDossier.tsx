import { Link } from "react-router-dom";
import {
  X,
  BookmarkSimple,
  ArrowUpRight,
  UsersThree,
} from "@phosphor-icons/react";
import { getEntity, type EntityDetail, type FullGraphNode } from "../lib/data/api";
import { demoGraph } from "../lib/data/demo";
import { useData, useWorkspace } from "../lib/state/workspace";
import { ErrorState, Loading } from "./UI";
export default function EntityDossier({
  node,
  onClose,
  onFocus,
}: {
  node: FullGraphNode;
  onClose: () => void;
  onFocus?: (id: string) => void;
}) {
  const { watched, toggleWatch } = useWorkspace();
  const adjacent = demoGraph.edges.filter(
    (e) => e.src === node.id || e.dst === node.id,
  );
  const sample: EntityDetail = {
    ...node,
    degree: adjacent.length,
    in_degree: adjacent.filter((e) => e.dst === node.id).length,
    out_degree: adjacent.filter((e) => e.src === node.id).length,
    source: "Fictional demo",
    neighbours_sample: [
      ...new Set(adjacent.map((e) => (e.src === node.id ? e.dst : e.src))),
    ],
  };
  const { data, error, loading, retry } = useData(
    `entity:${node.id}`,
    (c) => getEntity(c, node.id),
    sample,
  );
  return (
    <aside className="entity-dossier">
      <div className="dossier-top">
        <span className="overline">ENTITY DOSSIER</span>
        <button
          className="icon-button"
          aria-label="Close dossier"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="dossier-avatar">
        {node.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </div>
      <h2>{data?.name || node.name}</h2>
      <p className="mono muted">
        {node.id} <span> / {node.label}</span>
      </p>
      <div className="dossier-badges">
        <span className="tag">{data?.role || node.role || "Unranked"}</span>
        {data?.community_id != null && (
          <span className="tag">Group {data.community_id + 1}</span>
        )}
      </div>
      <button
        className={`btn ${watched.includes(node.id) ? "saved" : ""}`}
        onClick={() => toggleWatch(node.id)}
      >
        <BookmarkSimple
          weight={watched.includes(node.id) ? "fill" : "regular"}
          size={17}
        />
        {watched.includes(node.id) ? "Saved to watchlist" : "Save to watchlist"}
      </button>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={retry} />
      ) : (
        data && (
          <>
            <div className="dossier-metrics">
              <div>
                <strong>{data.degree}</strong>
                <small>Connections</small>
              </div>
              <div>
                <strong>{(data.influence_score || 0).toFixed(2)}</strong>
                <small>Influence</small>
              </div>
            </div>
            <p className="helper">
              Influence describes network position, not criminal responsibility.
            </p>
            <h3>Connected entities</h3>
            <div className="connection-list">
              {data.neighbours_sample.length ? (
                data.neighbours_sample.slice(0, 12).map((id) => (
                  <button
                    key={id}
                    onClick={() => onFocus?.(id)}
                    disabled={!onFocus}
                  >
                    <UsersThree size={16} />
                    <span>
                      {demoGraph.nodes.find((n) => n.id === id)?.name || id}
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                ))
              ) : (
                <p className="muted">No connections returned.</p>
              )}
            </div>
            <details className="ev">
              <summary>Properties & provenance</summary>
              <pre>
                {JSON.stringify(
                  { source: data.source, ...data.properties },
                  null,
                  2,
                )}
              </pre>
            </details>
          </>
        )
      )}
      <Link
        className="text-link"
        to={`/alerts?entity=${encodeURIComponent(node.id)}`}
      >
        Review related alerts <ArrowUpRight size={15} />
      </Link>
    </aside>
  );
}
