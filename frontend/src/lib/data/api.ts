import { localPaths } from "../analysis/local";
import { analyzeLocalText } from "../analysis/localDocuments";
import { postWorkspace } from "./server";
export interface ApiConfig {
  engine?: "local" | "backend";
  dataset: import("../analysis/local").LocalDataset | null;
}
export interface FullGraphNode {
  id: string;
  label: string;
  name: string;
  community_id?: number | null;
  role?: string | null;
  influence_score?: number | null;
}
export interface FullGraphEdge {
  id: string;
  src: string;
  dst: string;
  rel: string;
  frequency: number;
}
export interface FullGraph {
  nodes: FullGraphNode[];
  edges: FullGraphEdge[];
  truncated: boolean;
  total_nodes: number;
  total_edges: number;
}
export interface KeyPlayer {
  person_id: string;
  name: string;
  influence_score: number;
  community_id: number;
  role: string;
  centrality_breakdown?: Record<string, unknown>;
}
export interface AlertFlag {
  entities_involved: string[];
  pattern_type: string;
  evidence?: Record<string, unknown>;
  severity_score: number;
  plain_language_explanation: string;
  source_dataset?: string;
}
export interface EntityDetail {
  id: string;
  label: string;
  name: string;
  source?: string;
  degree: number;
  in_degree: number;
  out_degree: number;
  community_id?: number | null;
  role?: string | null;
  influence_score?: number | null;
  properties?: Record<string, unknown>;
  neighbours_sample: string[];
}

const dataset = (cfg: ApiConfig) => {
  if (!cfg.dataset)
    throw new Error("Upload a dataset to start your investigation.");
  return cfg.dataset;
};
export const getStats = async (c: ApiConfig) => ({
  nodes: dataset(c).graph.total_nodes,
  edges: dataset(c).graph.total_edges,
});
export const getGraphFull = async (
  c: ApiConfig,
  limit = 600,
): Promise<FullGraph> => {
  const graph = dataset(c).graph;
  const nodes = graph.nodes.slice(0, limit),
    ids = new Set(nodes.map((n) => n.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((e) => ids.has(e.src) && ids.has(e.dst)),
    truncated: nodes.length < graph.nodes.length,
  };
};
export const getPaths = async (c: ApiConfig, a: string, b: string, hops = 3) =>
  localPaths(dataset(c).graph, a, b, hops);
export const getKeyPlayers = async (c: ApiConfig, limit = 20) => ({
  players: dataset(c).players.slice(0, limit),
  total: dataset(c).players.length,
});
export const getAlerts = async (c: ApiConfig) => ({
  flags: dataset(c).alerts,
  total: dataset(c).alerts.length,
});
export const getCommunities = async (c: ApiConfig) => ({
  communities: dataset(c).communities,
  total: dataset(c).communities.length,
});
export const searchEntities = async (c: ApiConfig, query: string) => ({
  query,
  results: dataset(c)
    .graph.nodes.filter((n) =>
      (n.name + " " + n.id).toLowerCase().includes(query.toLowerCase()),
    )
    .map((n) => ({
      ...n,
      score: n.id === query ? 100 : 80,
      match_type: "text",
    })),
});
export const getEntity = async (
  c: ApiConfig,
  id: string,
): Promise<EntityDetail> => {
  const detail = dataset(c).details[id];
  if (!detail) throw new Error("Entity not found in this dataset.");
  return detail;
};
export interface EgoNetwork {
  center: string;
  depth: number;
  nodes: FullGraphNode[];
  edges: FullGraph["edges"];
}
export const getEgo = async (
  c: ApiConfig,
  id: string,
  depth = 1,
): Promise<EgoNetwork> => {
  const graph = dataset(c).graph,
    ids = new Set([id]);
  for (let k = 0; k < depth; k++) {
    const next = graph.edges.filter((e) => ids.has(e.src) || ids.has(e.dst));
    next.forEach((e) => {
      ids.add(e.src);
      ids.add(e.dst);
    });
  }
  return {
    center: id,
    depth,
    nodes: graph.nodes.filter((n) => ids.has(n.id)),
    edges: graph.edges.filter((e) => ids.has(e.src) && ids.has(e.dst)),
  };
};
export const analyzeDocumentText = async (c: ApiConfig, text: string) =>
  c.engine === "backend"
    ? postWorkspace<ReturnType<typeof analyzeLocalText>>("documents", { text })
    : analyzeLocalText(text);
