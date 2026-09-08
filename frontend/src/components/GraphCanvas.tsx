"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import cytoscape from "cytoscape";
import cola from "cytoscape-cola";
import type { FullGraph, FullGraphNode } from "../lib/api";
cytoscape.use(cola);
export interface GraphHandle {
  fit: () => void;
  zoom: (factor: number) => void;
  export: () => void;
}
interface Props {
  graph: FullGraph;
  layout: string;
  labels: boolean;
  selected: string | null;
  paths: string[][];
  onSelect: (node: FullGraphNode | null) => void;
}
const colors: Record<string, string> = {
  Person: "#c1c5cc",
  Vehicle: "#719dac",
  Location: "#b6a079",
  Organization: "#9c9ba9",
  Phone: "#8eab99",
};
const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas(
  { graph, layout, labels, selected, paths, onSelect },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const core = useRef<cytoscape.Core | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  useImperativeHandle(
    ref,
    () => ({
      fit: () => core.current?.fit(undefined, 50),
      zoom: (factor) => {
        const c = core.current;
        if (c)
          c.zoom({
            level: c.zoom() * factor,
            renderedPosition: { x: c.width() / 2, y: c.height() / 2 },
          });
      },
      export: () => {
        const c = core.current;
        if (!c) return;
        const a = document.createElement("a");
        a.href = c.png({
          full: true,
          scale: 2,
          bg: getComputedStyle(document.documentElement)
            .getPropertyValue("--well")
            .trim(),
        });
        a.download = "x-tracer-network.png";
        a.click();
      },
    }),
    [],
  );
  useEffect(() => {
    if (!container.current) return;
    const c = cytoscape({
      container: container.current,
      elements: [
        ...graph.nodes.map((n) => ({ data: { ...n } })),
        ...graph.edges.map((e) => ({
          data: { ...e, source: e.src, target: e.dst },
        })),
      ],
      minZoom: 0.15,
      maxZoom: 3,
      boxSelectionEnabled: true,
      style: [
        {
          selector: "node",
          style: {
            "background-color": (n: cytoscape.NodeSingular) =>
              colors[n.data("label")] || "#adb0b9",
            "border-width": 2,
            "border-color": "#60636a",
            width: (n: cytoscape.NodeSingular) =>
              25 + (n.data("influence_score") || 0) * 25,
            height: (n: cytoscape.NodeSingular) =>
              25 + (n.data("influence_score") || 0) * 25,
            label: labels ? "data(name)" : "",
            "font-size": 11,
            "font-family": "Geist",
            "text-valign": "bottom",
            "text-margin-y": 10,
            "text-wrap": "wrap",
            "text-max-width": "110px",
            "text-background-opacity": 0.8,
            "text-background-padding": "3px",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.2,
            "line-color": "#777b83",
            opacity: 0.42,
            "curve-style": "bezier",
            "target-arrow-shape": (e: cytoscape.EdgeSingular) =>
              e.data("rel") === "FINANCIAL_TRANSFER" ? "triangle" : "none",
            "target-arrow-color": "#a4a7ad",
          },
        },
        {
          selector: ".selected",
          style: {
            "border-width": 4,
            "border-color": "#fafaf7",
            "background-color": "#fafaf7",
          },
        },
        {
          selector: ".path",
          style: {
            "line-color": "#e2b77a",
            "target-arrow-color": "#e2b77a",
            width: 3,
            opacity: 1,
          },
        },
        { selector: ".faded", style: { opacity: 0.13 } },
      ],
      layout: { name: "preset" },
    });
    core.current = c;
    const theme = () => {
      const vars = getComputedStyle(document.documentElement);
      c.style()
        .selector("node")
        .style({
          color: vars.getPropertyValue("--text").trim(),
          "text-background-color": vars.getPropertyValue("--well").trim(),
        })
        .selector(".selected")
        .style({ "border-color": vars.getPropertyValue("--text").trim() })
        .update();
    };
    theme();
    const obs = new MutationObserver(theme);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const resize = new ResizeObserver(() => {
      c.resize();
      c.fit(undefined, 55);
    });
    resize.observe(container.current);
    c.on("tap", "node", (e) => selectRef.current(e.target.data()));
    c.on("tap", (e) => {
      if (e.target === c) selectRef.current(null);
    });
    return () => {
      obs.disconnect();
      resize.disconnect();
      c.destroy();
      core.current = null;
    };
  }, [graph]);
  useEffect(() => {
    const c = core.current;
    if (!c) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const active = c.layout({
      name: layout,
      animate: !reduce,
      animationDuration: 550,
      padding: 55,
      nodeSpacing: 35,
      maxSimulationTime: 1300,
      concentric: (n: cytoscape.NodeSingular) =>
        (n.data("influence_score") || 0) * 100,
      levelWidth: () => 35,
    } as cytoscape.LayoutOptions);
    active.run();
    return () => {
      active.stop();
    };
  }, [layout, graph]);
  useEffect(() => {
    core.current
      ?.style()
      .selector("node")
      .style("label", labels ? "data(name)" : "")
      .update();
  }, [labels, graph]);
  useEffect(() => {
    const c = core.current;
    if (!c) return;
    c.elements().removeClass("selected path faded");
    if (paths.length) {
      c.elements().addClass("faded");
      for (const path of paths) {
        path.forEach((id) =>
          c.getElementById(id).removeClass("faded").addClass("selected"),
        );
        for (let i = 1; i < path.length; i++)
          c.edges()
            .filter(
              (e) =>
                (e.source().id() === path[i - 1] &&
                  e.target().id() === path[i]) ||
                (e.target().id() === path[i - 1] &&
                  e.source().id() === path[i]),
            )
            .removeClass("faded")
            .addClass("path");
      }
    }
    if (selected) c.getElementById(selected).addClass("selected");
  }, [selected, paths, graph]);
  return (
    <div
      className="graph-canvas"
      ref={container}
      role="img"
      aria-label="Interactive entity network. Use the entity selector to open a dossier with your keyboard."
    />
  );
});
export default GraphCanvas;
