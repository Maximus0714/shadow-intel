import type {
  AlertFlag,
  EntityDetail,
  FullGraph,
  KeyPlayer,
} from "../data/api";
import type { CleanedEdge } from "../data/upload";
import type { Community } from "../state/workspace";

export interface LocalDataset {
  analysis_version?: string;
  engine?: "local" | "backend";
  id: string;
  name: string;
  created: string;
  graph: FullGraph;
  players: KeyPlayer[];
  communities: Community[];
  alerts: AlertFlag[];
  details: Record<string, EntityDetail>;
  notes: string[];
  records: CleanedEdge[];
  timeline?: { id: string; date: string; src: string; dst: string; rel: string; frequency: number; amount: string; source_rows?: number[] }[];
}

export { buildDataset, ANALYSIS_VERSION } from "../../../../shared/analysis.mjs";

export function localPaths(
  graph: FullGraph,
  start: string,
  end: string,
  hops: number,
) {
  if (
    !graph.nodes.some((n) => n.id === start) ||
    !graph.nodes.some((n) => n.id === end)
  )
    throw new Error("Choose entities in the current dataset.");
  const adj = new Map(graph.nodes.map((n) => [n.id, new Set<string>()]));
  graph.edges.forEach((e) => {
    adj.get(e.src)?.add(e.dst);
    adj.get(e.dst)?.add(e.src);
  });
  const paths: string[][] = [];
  let visits = 0;
  const walk = (path: string[]) => {
    if (++visits > 50000 || paths.length >= 10) return;
    const id = path[path.length - 1];
    if (id === end) {
      paths.push(path);
      return;
    }
    if (path.length - 1 >= hops) return;
    for (const next of adj.get(id) || [])
      if (!path.includes(next)) walk([...path, next]);
  };
  walk([start]);
  return { source: start, target: end, paths, count: paths.length };
}
