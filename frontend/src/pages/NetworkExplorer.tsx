import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowsOut,
  Plus,
  Minus,
  DownloadSimple,
  Path,
  SlidersHorizontal,
  X,
  ArrowClockwise,
  Graph as GraphIcon,
} from "@phosphor-icons/react";
import GraphCanvas, { type GraphHandle } from "../components/GraphCanvas";
import EntityDossier from "../components/EntityDossier";
import {
  getGraphFull,
  getEgo,
  getPaths,
  type FullGraph,
  type FullGraphNode,
} from "../lib/api";
import { demoGraph, demoPaths } from "../lib/demo";
import { useData, useWorkspace, readable } from "../lib/workspace";
import { PageHeader, Loading, ErrorState, Empty } from "../components/UI";
export default function NetworkExplorer() {
  const [params] = useSearchParams();
  const { mode, setMode, cfg } = useWorkspace();
  useEffect(() => {
    if (params.get("demo") === "1") setMode("demo");
  }, [params.get("demo")]);
  const [limit, setLimit] = useState(600);
  const state = useData(
    `graph:${limit}`,
    (c) => getGraphFull(c, limit),
    demoGraph,
  );
  const [layout, setLayout] = useState("cola");
  const [labels, setLabels] = useState(true);
  const [filters, setFilters] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [community, setCommunity] = useState("all");
  const [selected, setSelected] = useState<FullGraphNode | null>(null);
  const [ego, setEgo] = useState<FullGraph | null>(null);
  const [depth, setDepth] = useState(1);
  const [pathMode, setPathMode] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [hops, setHops] = useState(3);
  const [paths, setPaths] = useState<string[][]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<GraphHandle>(null);
  const task = useRef(0);
  useEffect(() => {
    task.current++;
    setEgo(null);
    setPaths([]);
    setSelected(null);
    setMessage("");
    setExcluded([]);
    setCommunity("all");
    setBusy(false);
  }, [state.data]);
  useEffect(() => {
    if (state.data) {
      const focus = params.get("focus");
      if (focus)
        setSelected(state.data.nodes.find((n) => n.id === focus) || null);
    }
  }, [state.data, params]);
  const graph = useMemo(() => {
    const base = ego || state.data;
    if (!base) return null;
    const nodes = base.nodes.filter(
      (n) => community === "all" || String(n.community_id) === community,
    );
    const ids = new Set(nodes.map((n) => n.id));
    return {
      ...base,
      nodes,
      edges: base.edges.filter(
        (e) => !excluded.includes(e.rel) && ids.has(e.src) && ids.has(e.dst),
      ),
    };
  }, [state.data, ego, excluded, community]);
  const choose = (node: FullGraphNode | null) => {
    setSelected(node);
    if (node && pathMode) {
      if (!a) setA(node.id);
      else if (!b) setB(node.id);
    }
  };
  const focus = async () => {
    if (ego) {
      setEgo(null);
      return;
    }
    if (!selected || !state.data) return;
    setBusy(true);
    const ticket = ++task.current;
    try {
      if (mode === "demo") {
        const ids = new Set([selected.id]);
        for (let i = 0; i < depth; i++) {
          const next = demoGraph.edges.filter(
            (e) => ids.has(e.src) || ids.has(e.dst),
          );
          next.forEach((e) => {
            ids.add(e.src);
            ids.add(e.dst);
          });
        }
        const nodes = demoGraph.nodes.filter((n) => ids.has(n.id));
        const edges = demoGraph.edges.filter(
          (e) => ids.has(e.src) && ids.has(e.dst),
        );
        setEgo({ ...demoGraph, nodes, edges });
      } else {
        const r = await getEgo(cfg, selected.id, depth);
        if (ticket !== task.current) return;
        setEgo({
          nodes: r.nodes,
          edges: r.edges.map((e, i) => ({ ...e, id: `ego-${i}` })),
          truncated: false,
          total_nodes: r.nodes.length,
          total_edges: r.edges.length,
        });
      }
      setPaths([]);
      setMessage("Showing the selected entity’s neighbourhood.");
    } catch (e) {
      if (ticket === task.current) setMessage(String(e));
    } finally {
      if (ticket === task.current) setBusy(false);
    }
  };
  const find = async () => {
    if (!a || !b) {
      setMessage("Choose a start and end entity.");
      return;
    }
    const ticket = ++task.current;
    setBusy(true);
    setPaths([]);
    try {
      const r =
        mode === "demo"
          ? demoPaths(a, b, hops)
          : await getPaths(cfg, a, b, hops);
      if (ticket !== task.current) return;
      setEgo(null);
      setExcluded([]);
      setCommunity("all");
      setPaths(r.paths);
      setMessage(
        r.count
          ? `${r.count} connecting path${r.count === 1 ? "" : "s"} found. Highlighted in the graph.`
          : `No path within ${hops} hops. Try increasing the limit.`,
      );
    } catch (e) {
      if (ticket === task.current)
        setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === task.current) setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Network Explorer"
        description="Connect the dots. Select an entity to see its story."
      >
        <button
          className="btn"
          onClick={() => canvas.current?.export()}
          disabled={!graph}
        >
          <DownloadSimple size={17} />
          Export PNG
        </button>
      </PageHeader>
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.retry} />
      ) : (
        graph && (
          <div className="network-workbench">
            <div className="network-toolbar">
              <label className="network-search">
                <GraphIcon size={18} />
                <select
                  aria-label="Find an entity in the graph"
                  value={selected?.id || ""}
                  onChange={(e) =>
                    choose(
                      state.data?.nodes.find((n) => n.id === e.target.value) ||
                        null,
                    )
                  }
                >
                  <option value="">Find an entity…</option>
                  {state.data?.nodes.map((n) => (
                    <option value={n.id} key={n.id}>
                      {n.name} ({n.id})
                    </option>
                  ))}
                </select>
              </label>
              <div className="toolbar-actions">
                <button
                  className={`btn ${filters ? "active-control" : ""}`}
                  onClick={() => setFilters(!filters)}
                  aria-expanded={filters}
                >
                  <SlidersHorizontal size={17} />
                  Filters {excluded.length ? `(${excluded.length})` : ""}
                </button>
                <button
                  className={`btn ${pathMode ? "active-control" : ""}`}
                  onClick={() => setPathMode(!pathMode)}
                  aria-expanded={pathMode}
                >
                  <Path size={18} />
                  Find a path
                </button>
                <select
                  aria-label="Graph layout"
                  value={layout}
                  onChange={(e) => setLayout(e.target.value)}
                >
                  <option value="concentric">Concentric layout</option>
                  <option value="cola">Force layout</option>
                  <option value="circle">Circle layout</option>
                  <option value="cose">Organic layout</option>
                </select>
              </div>
            </div>
            {filters && (
              <div className="filter-tray">
                <div>
                  <span className="field-caption">Relationships</span>
                  <div className="filter-pills">
                    {[...new Set(state.data?.edges.map((e) => e.rel))].map(
                      (rel) => (
                        <button
                          key={rel}
                          className={`filter-pill ${!excluded.includes(rel) ? "selected" : ""}`}
                          onClick={() => {
                            setExcluded((v) =>
                              v.includes(rel)
                                ? v.filter((r) => r !== rel)
                                : [...v, rel],
                            );
                            setPaths([]);
                          }}
                        >
                          {readable(rel)}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <label className="field">
                  <span>Community</span>
                  <select
                    value={community}
                    onChange={(e) => {
                      setCommunity(e.target.value);
                      setPaths([]);
                    }}
                  >
                    <option value="all">All communities</option>
                    {[
                      ...new Set(
                        state.data?.nodes
                          .map((n) => n.community_id)
                          .filter((n) => n != null),
                      ),
                    ].map((n) => (
                      <option key={n} value={String(n)}>
                        Group {Number(n) + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Node limit</span>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  >
                    {[200, 600, 1200].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={labels}
                    onChange={(e) => setLabels(e.target.checked)}
                  />
                  Show labels
                </label>
              </div>
            )}
            {pathMode && (
              <div className="path-tray">
                {[
                  { label: "From", value: a, set: setA },
                  { label: "To", value: b, set: setB },
                ].map((x) => (
                  <label className="field" key={x.label}>
                    <span>{x.label}</span>
                    <select
                      aria-label={
                        x.label === "From"
                          ? "Path start entity"
                          : "Path end entity"
                      }
                      value={x.value}
                      onChange={(e) => x.set(e.target.value)}
                    >
                      <option value="">Choose entity</option>
                      {state.data?.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="field">
                  <span>Max hops</span>
                  <select
                    value={hops}
                    onChange={(e) => setHops(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn primary"
                  disabled={busy || !a || !b}
                  onClick={find}
                >
                  {busy ? "Finding…" : "Trace path"}
                  <ArrowClockwise size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Clear paths"
                  onClick={() => {
                    setPaths([]);
                    setMessage("");
                    setA("");
                    setB("");
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            )}
            {message && (
              <div className="inline-notice" role="status">
                {message}
              </div>
            )}
            {state.data?.truncated && (
              <div className="inline-notice">
                Showing {state.data.nodes.length} of {state.data.total_nodes}{" "}
                entities. Increase the node limit to explore more.
              </div>
            )}
            <div className={`graph-layout ${selected ? "with-dossier" : ""}`}>
              <div className="graph-stage">
                {graph.nodes.length ? (
                  <GraphCanvas
                    ref={canvas}
                    graph={graph}
                    layout={layout}
                    labels={labels}
                    selected={selected?.id || null}
                    paths={paths}
                    onSelect={choose}
                  />
                ) : (
                  <Empty
                    title="No entities to display"
                    body="Adjust your filters or upload relationships to populate the graph."
                  />
                )}
                <div className="graph-summary">
                  <span>{graph.nodes.length} entities</span>
                  <span>{graph.edges.length} connections</span>
                </div>
                <div className="graph-zoom">
                  <button
                    aria-label="Zoom in"
                    onClick={() => canvas.current?.zoom(1.2)}
                  >
                    <Plus />
                  </button>
                  <button
                    aria-label="Zoom out"
                    onClick={() => canvas.current?.zoom(0.8)}
                  >
                    <Minus />
                  </button>
                  <button
                    aria-label="Fit graph to view"
                    onClick={() => canvas.current?.fit()}
                  >
                    <ArrowsOut />
                  </button>
                </div>
                <div className="graph-legend">
                  <span>
                    <i className="person" />
                    Person
                  </span>
                  <span>
                    <i className="vehicle" />
                    Vehicle
                  </span>
                  <span>
                    <i className="location" />
                    Location
                  </span>
                </div>
                {selected && (
                  <div className="ego-actions">
                    <select
                      value={depth}
                      onChange={(e) => setDepth(Number(e.target.value))}
                      aria-label="Neighbourhood depth"
                    >
                      {[1, 2, 3].map((n) => (
                        <option value={n} key={n}>
                          {n}-hop neighbourhood
                        </option>
                      ))}
                    </select>
                    <button className="btn" disabled={busy} onClick={focus}>
                      {ego ? "Show full graph" : "Focus neighbourhood"}
                    </button>
                  </div>
                )}
              </div>
              {selected && (
                <EntityDossier
                  node={selected}
                  onClose={() => setSelected(null)}
                  onFocus={(id) => {
                    const n = state.data?.nodes.find((n) => n.id === id);
                    if (n) choose(n);
                    else
                      setMessage(
                        "This entity is outside the current graph limit. Increase the cap.",
                      );
                  }}
                />
              )}
            </div>
            {paths.length > 0 && (
              <details className="path-results">
                <summary>View {paths.length} paths</summary>
                {paths.map((p, i) => (
                  <p key={i}>
                    {p
                      .map(
                        (id) =>
                          state.data?.nodes.find((n) => n.id === id)?.name ||
                          id,
                      )
                      .join(" → ")}
                  </p>
                ))}
              </details>
            )}
          </div>
        )
      )}
    </>
  );
}
