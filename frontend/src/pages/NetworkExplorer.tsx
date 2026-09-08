import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import cytoscape from "cytoscape";
import cola from "cytoscape-cola";
import DossierPanel from "../components/DossierPanel";
import {
  getEgo,
  getGraphFull,
  getPaths,
  loadConfig,
  type FullGraph,
  type FullGraphNode,
} from "../lib/api";
import { demoGraph } from "../lib/demo";

cytoscape.use(cola);

const ROLE_COLOR: Record<string, string> = {
  leader: "#B3261E",
  bridge: "#A66A00",
  member: "#5E6E77",
};
const REL_COLOR: Record<string, string> = {
  FINANCIAL_TRANSFER: "#3FA97C",
  CALLED: "#5E8FC4",
  ASSOCIATE_OF: "#5E8FC4",
  CO_LOCATED: "#8E83B8",
  OWNS_VEHICLE: "#C07E92",
  REGISTERED_AT: "#C07E92",
};

const ALL_RELS = ["FINANCIAL_TRANSFER", "CALLED", "ASSOCIATE_OF", "CO_LOCATED", "OWNS_VEHICLE", "REGISTERED_AT"];

export default function NetworkExplorer() {
  const [params] = useSearchParams();
  const focusParam = params.get("focus");
  const [cfg] = useState(loadConfig);
  const [graph, setGraph] = useState<FullGraph | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(600);
  const [layout, setLayout] = useState("cola");
  const [relFilter, setRelFilter] = useState<Set<string>>(new Set(ALL_RELS));
  const [labelsOn, setLabelsOn] = useState(true);
  const [selected, setSelected] = useState<FullGraphNode | null>(null);
  const [egoMode, setEgoMode] = useState(false);
  const [pathA, setPathA] = useState("");
  const [pathB, setPathB] = useState("");
  const [pathInfo, setPathInfo] = useState<string | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);

  const load = async (lim: number) => {
    setError(null);
    setGraph(null);
    try {
      const g = await getGraphFull(cfg, lim);
      setGraph(g);
      setIsDemo(false);
    } catch (e) {
      setGraph(demoGraph);
      setIsDemo(true);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const elements = useMemo(() => {
    if (!graph) return [];
    const nodes = graph.nodes.map((n) => ({ data: { ...n } }));
    const edges = graph.edges
      .filter((e) => relFilter.has(e.rel))
      .map((e) => ({ data: { id: e.id, source: e.src, target: e.dst, rel: e.rel, frequency: e.frequency } }));
    return [...nodes, ...edges];
  }, [graph, relFilter]);

  useEffect(() => {
    if (!divRef.current || !elements.length) return;
    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }
    type CyEl = { data: (k: string) => unknown };
    const num = (el: CyEl, k: string) => Number(el.data(k)) || 0;
    const str = (el: CyEl, k: string) => String(el.data(k) || "");
    const cy = cytoscape({
      container: divRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": (el: CyEl) => ROLE_COLOR[str(el, "role")] || "#22262d",
            "border-width": 2,
            "border-color": "#454e59",
            width: (el: CyEl) => 22 + Math.min(1, Math.max(0, num(el, "influence_score"))) * 34,
            height: (el: CyEl) => 22 + Math.min(1, Math.max(0, num(el, "influence_score"))) * 34,
            label: labelsOn ? "data(name)" : "",
            "font-size": 10,
            color: "#E9E6DF",
            "text-background-color": "#101216",
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
          } as unknown as cytoscape.Css.Node,
        },
        {
          selector: "edge",
          style: {
            "line-color": (el: CyEl) => REL_COLOR[str(el, "rel")] || "#7B828C",
            "target-arrow-color": (el: CyEl) => REL_COLOR[str(el, "rel")] || "#7B828C",
            width: (el: CyEl) => 1 + Math.min(5, num(el, "frequency") || 1) * 0.7,
            "line-style": (el: CyEl) => {
              const r = str(el, "rel");
              if (r === "CO_LOCATED" || r === "REGISTERED_AT") return "dashed";
              if (r === "OWNS_VEHICLE") return "dotted";
              return "solid";
            },
            "target-arrow-shape": (el: CyEl) =>
              str(el, "rel") === "FINANCIAL_TRANSFER" ? "triangle" : "none",
            "curve-style": "bezier",
            opacity: 0.85,
          } as unknown as cytoscape.Css.Edge,
        },
        {
          selector: ".highlight",
          style: { "border-color": "#fff", "border-width": 4, "line-color": "#fff", opacity: 1 } as unknown as cytoscape.Css.Node,
        },
        {
          selector: ".dim",
          style: { opacity: 0.15 } as unknown as cytoscape.Css.Node,
        },
      ],
      layout: layout === "cola" ? ({ name: "cola", maxSimulationTime: 1500 } as unknown as cytoscape.LayoutOptions) : ({ name: layout } as cytoscape.LayoutOptions),
    });
    cy.on("tap", "node", (evt) => {
      const d = evt.target.data() as FullGraphNode;
      setSelected({ id: d.id, label: d.label, name: d.name, community_id: d.community_id, role: d.role, influence_score: d.influence_score });
      cy.elements().removeClass("highlight");
      evt.target.addClass("highlight");
      evt.target.neighborhood().addClass("highlight");
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        setSelected(null);
        cy.elements().removeClass("highlight");
      }
    });
    cyRef.current = cy;
    if (focusParam) {
      const n = cy.getElementById(focusParam);
      if (n.length) {
        cy.center(n);
        cy.zoom(1.5);
        n.addClass("highlight");
        const d = n.data() as FullGraphNode;
        setSelected({ id: d.id, label: d.label, name: d.name, community_id: d.community_id, role: d.role, influence_score: d.influence_score });
      }
    }
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, layout, labelsOn]);

  const toggleRel = (r: string) => {
    setRelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const runEgo = async () => {
    const center = selected?.id || focusParam;
    if (!center) {
      setPathInfo("Select a node first, then toggle ego focus.");
      return;
    }
    try {
      const ego = await getEgo(cfg, center, 1);
      setGraph({
        nodes: ego.nodes.map((n) => ({ id: n.id, label: n.label, name: n.name, community_id: n.community_id, role: n.role, influence_score: n.influence_score })),
        edges: ego.edges.map((e, i) => ({ id: `${e.src}>${e.dst}>${i}`, src: e.src, dst: e.dst, rel: e.rel, frequency: e.frequency })),
        truncated: false,
        total_nodes: ego.nodes.length,
        total_edges: ego.edges.length,
      });
      setEgoMode(true);
      setIsDemo(false);
      setPathInfo(`1-hop ego of ${center}: ${ego.nodes.length} nodes.`);
    } catch (e) {
      setPathInfo(e instanceof Error ? e.message : String(e));
    }
  };

  const runPaths = async () => {
    if (!pathA.trim() || !pathB.trim()) {
      setPathInfo("Enter two entity IDs to find paths.");
      return;
    }
    try {
      const r = await getPaths(cfg, pathA.trim(), pathB.trim(), 3);
      const cy = cyRef.current;
      if (cy) {
        cy.elements().removeClass("highlight");
        const keep = new Set(r.paths.flat());
        if (!keep.size) {
          setPathInfo(`No path between ${pathA} and ${pathB} within 3 hops.`);
          return;
        }
        cy.elements().addClass("dim");
        keep.forEach((id) => {
          const el = cy.getElementById(id);
          el.removeClass("dim");
          el.addClass("highlight");
        });
      }
      setPathInfo(`${r.count} path(s) between ${pathA} and ${pathB} (≤3 hops).`);
    } catch (e) {
      setPathInfo(e instanceof Error ? e.message : String(e));
    }
  };

  const exportPng = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const png = cy.png({ full: true });
    const a = document.createElement("a");
    a.href = png;
    a.download = "network.png";
    a.click();
  };

  return (
    <>
      <h1>Network Explorer</h1>
      <p className="sub">
        The live knowledge graph: people, phones, organizations, locations and
        their connections. Click a node for its dossier; find paths between two
        entities.
      </p>
      <p>
        {isDemo ? <span className="pill demo">DEMO — fictional data</span> : <span className="pill live">LIVE</span>}{" "}
        {graph && (
          <span className="mono">
            {graph.nodes.length}/{graph.total_nodes} nodes · {graph.edges.length} edges
          </span>
        )}
      </p>
      {error && !graph && <div className="error">{error}</div>}
      {graph?.truncated && (
        <div className="cy-banner">
          Showing top {graph.nodes.length} by influence of {graph.total_nodes} — narrow with filters or raise the cap.
        </div>
      )}
      <div className="cy-wrap">
        <div className="cy-toolbar" role="toolbar" aria-label="Graph controls">
          <span>
            {ALL_RELS.map((r) => (
              <label key={r}>
                <input type="checkbox" checked={relFilter.has(r)} onChange={() => toggleRel(r)} /> {r}
              </label>
            ))}
          </span>
          <label>
            Layout
            <select value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="cola">cola (physics)</option>
              <option value="cose">cose</option>
              <option value="concentric">concentric</option>
              <option value="circle">circle</option>
            </select>
          </label>
          <label>
            Cap
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={200}>200</option>
              <option value={600}>600</option>
              <option value={1200}>1200</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={labelsOn} onChange={(e) => setLabelsOn(e.target.checked)} /> Labels
          </label>
          <button className="btn" onClick={runEgo}>{egoMode ? "Reload full (cap)" : "Ego 1-hop of selected"}</button>
          <button className="btn" onClick={exportPng}>Export PNG</button>
          <span>
            <input type="text" placeholder="From ID" value={pathA} onChange={(e) => setPathA(e.target.value)} aria-label="Path start entity" />
            <input type="text" placeholder="To ID" value={pathB} onChange={(e) => setPathB(e.target.value)} aria-label="Path end entity" />
            <button className="btn primary" onClick={runPaths}>Find paths</button>
          </span>
        </div>
        {pathInfo && <div className="cy-banner">{pathInfo}</div>}
        {!graph ? (
          <div className="skeleton" style={{ margin: 14 }}>Loading graph…</div>
        ) : (
          <div className="split" style={{ padding: 12 }}>
            <div ref={divRef} className="cy-canvas" role="img" aria-label="Criminal network graph" />
            <DossierPanel node={selected} onClose={() => setSelected(null)} onFocus={(id) => {
              const cy = cyRef.current;
              if (cy) {
                const n = cy.getElementById(id);
                if (n.length) {
                  const d = n.data() as FullGraphNode;
                  setSelected({ id: d.id, label: d.label, name: d.name, community_id: d.community_id, role: d.role, influence_score: d.influence_score });
                  cy.center(n);
                }
              }
            }} />
          </div>
        )}
      </div>
    </>
  );
}
