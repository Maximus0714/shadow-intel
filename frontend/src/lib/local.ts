import type {
  AlertFlag,
  EntityDetail,
  FullGraph,
  FullGraphNode,
  KeyPlayer,
} from "./api";
import type { CleanedEdge } from "./upload";
import type { Community } from "./workspace";

export interface LocalDataset {
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
}

export function buildDataset(
  records: CleanedEdge[],
  name: string,
): LocalDataset {
  if (!records.length) throw new Error("No usable relationships to analyze.");
  if (records.length > 10000)
    throw new Error(
      "Use at most 10,000 relationships per workspace. Split larger files into smaller investigations.",
    );
  const ids = [...new Set(records.flatMap((r) => [r.src, r.dst]))].sort();
  if (ids.length > 2000)
    throw new Error(
      "Use at most 2,000 entities per workspace. Split this file into smaller investigations.",
    );
  const adj = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const labels = new Map(ids.map((id) => [id, "Person"]));
  const warnings = new Set<string>();
  for (const r of records) {
    const label =
      r.rel === "OWNS_VEHICLE"
        ? "Vehicle"
        : r.rel === "REGISTERED_AT"
          ? "Location"
          : "Person";
    if (label !== "Person") labels.set(r.dst, label);
    if (r.src === r.dst) continue;
    adj.get(r.src)!.set(r.dst, (adj.get(r.src)!.get(r.dst) || 0) + r.frequency);
    adj.get(r.dst)!.set(r.src, (adj.get(r.dst)!.get(r.src) || 0) + r.frequency);
  }
  // Deterministic weighted label propagation; labels indicate network groups, not criminal membership.
  const groups = new Map(ids.map((id, i) => [id, i]));
  for (let iteration = 0; iteration < 30; iteration++) {
    let changed = false;
    for (const id of ids) {
      const votes = new Map<number, number>();
      for (const [neighbor, weight] of adj.get(id)!) {
        const group = groups.get(neighbor)!;
        votes.set(group, (votes.get(group) || 0) + weight);
      }
      const winner = [...votes].sort(
        (a, b) => b[1] - a[1] || a[0] - b[0],
      )[0]?.[0];
      if (winner !== undefined && winner !== groups.get(id)) {
        groups.set(id, winner);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groupIds = [...new Set(groups.values())].sort((a, b) => a - b);
  const rank = new Map(ids.map((id) => [id, 1 / ids.length]));
  const strengths = new Map(
    ids.map((id) => [
      id,
      [...adj.get(id)!.values()].reduce((a, b) => a + b, 0),
    ]),
  );
  for (let k = 0; k < 40; k++) {
    const dangling = ids.reduce(
      (s, id) => s + (strengths.get(id) ? 0 : rank.get(id)!),
      0,
    );
    const next = new Map(
      ids.map((id) => [id, (0.15 + 0.85 * dangling) / ids.length]),
    );
    for (const id of ids)
      for (const [neighbor, w] of adj.get(id)!)
        next.set(
          neighbor,
          next.get(neighbor)! + (0.85 * rank.get(id)! * w) / strengths.get(id)!,
        );
    ids.forEach((id) => rank.set(id, next.get(id)!));
  }
  // Brandes shortest-path betweenness, deterministically sampled for larger files.
  const between = new Map(ids.map((id) => [id, 0]));
  const sources = ids.filter(
    (_, i) => i % Math.max(1, Math.ceil(ids.length / 100)) === 0,
  );
  for (const source of sources) {
    const stack: string[] = [],
      queue = [source];
    const distance = new Map([[source, 0]]),
      count = new Map([[source, 1]]);
    const parents = new Map<string, string[]>();
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      stack.push(v);
      for (const w of adj.get(v)!.keys()) {
        if (!distance.has(w)) {
          distance.set(w, distance.get(v)! + 1);
          queue.push(w);
        }
        if (distance.get(w) === distance.get(v)! + 1) {
          count.set(w, (count.get(w) || 0) + count.get(v)!);
          parents.set(w, [...(parents.get(w) || []), v]);
        }
      }
    }
    const dependency = new Map<string, number>();
    for (const w of stack.reverse()) {
      for (const v of parents.get(w) || [])
        dependency.set(
          v,
          (dependency.get(v) || 0) +
            (count.get(v)! / count.get(w)!) * (1 + (dependency.get(w) || 0)),
        );
      if (w !== source)
        between.set(w, between.get(w)! + (dependency.get(w) || 0));
    }
  }
  const maxBetween = Math.max(...between.values(), 1);
  const maxRank = Math.max(...rank.values(), 1 / ids.length);
  const maxDegree = Math.max(...ids.map((id) => adj.get(id)!.size), 1);
  const nodes: FullGraphNode[] = ids.map((id) => ({
    id,
    name: id,
    label: labels.get(id)!,
    community_id: groupIds.indexOf(groups.get(id)!),
    influence_score: Number(
      (
        (0.3 * adj.get(id)!.size) / maxDegree +
        (0.4 * between.get(id)!) / maxBetween +
        (0.3 * rank.get(id)!) / maxRank
      ).toFixed(4),
    ),
    role: between.get(id)! / maxBetween >= 0.5 ? "bridge" : "member",
  }));
  const communities: Community[] = groupIds.map((_, i) => {
    const members = nodes
      .filter((n) => n.community_id === i)
      .sort((a, b) => b.influence_score! - a.influence_score!);
    if (members[0]) members[0].role = "leader";
    return {
      community_id: i,
      size: members.length,
      leader: members[0]?.id,
      members: members.map((n) => ({
        person_id: n.id,
        name: n.name,
        role: n.role!,
        influence_score: n.influence_score!,
      })),
    };
  });
  const players = nodes
    .map((n) => ({
      person_id: n.id,
      name: n.name,
      role: n.role!,
      community_id: n.community_id!,
      influence_score: n.influence_score!,
      centrality_breakdown: {
        degree: adj.get(n.id)!.size,
        weighted_connections: strengths.get(n.id),
        pagerank: rank.get(n.id),
        betweenness_relative: between.get(n.id)! / maxBetween,
      },
    }))
    .sort((a, b) => b.influence_score - a.influence_score);
  const edges = records.map((r, i) => ({ ...r, id: `record-${i}` }));
  const details = Object.create(null) as Record<string, EntityDetail>;
  for (const n of nodes) {
    const relevant = records.filter((r) => r.src === n.id || r.dst === n.id);
    details[n.id] = {
      ...n,
      source: name,
      degree: adj.get(n.id)!.size,
      in_degree: relevant.filter((r) => r.dst === n.id).length,
      out_degree: relevant.filter((r) => r.src === n.id).length,
      neighbours_sample: [...adj.get(n.id)!.keys()],
      properties: {
        analysis: players.find((p) => p.person_id === n.id)
          ?.centrality_breakdown,
        records: relevant.map((r) => ({
          from: r.src,
          to: r.dst,
          relationship: r.rel,
          frequency: r.frequency,
          date: r.date || null,
          amount: r.amount || null,
          source_rows: r.source_rows || [],
        })),
        role_note: "Network position only; does not establish intent or guilt.",
      },
    };
  }
  const alerts: AlertFlag[] = [];
  const flag = (
    type: string,
    entities: string[],
    text: string,
    evidence: Record<string, unknown>,
    severity: number,
  ) =>
    alerts.push({
      pattern_type: type,
      entities_involved: entities,
      plain_language_explanation: text,
      evidence,
      severity_score: severity,
      source_dataset: name,
    });
  const frequencies = records.map((r) => r.frequency);
  const mean = frequencies.reduce((a, b) => a + b, 0) / frequencies.length;
  const deviation = Math.sqrt(
    frequencies.reduce((a, b) => a + (b - mean) ** 2, 0) / frequencies.length,
  );
  records.forEach((r) => {
    if (r.frequency > mean + 2 * deviation && r.frequency > 1)
      flag(
        "Unusually frequent relationship",
        [r.src, r.dst],
        `${r.src} and ${r.dst} have a relationship frequency of ${r.frequency}, above the dataset average of ${mean.toFixed(1)}. Check the source records for context.`,
        { ...r, average: mean, threshold: mean + 2 * deviation },
        0.65,
      );
  });
  for (const n of nodes) {
    const neighbors = [...adj.get(n.id)!.keys()];
    if (
      between.get(n.id)! / maxBetween >= 0.5 &&
      neighbors.length >= 2 &&
      ids.length >= 3
    )
      flag(
        "Network bridge",
        [n.id],
        `${n.name} lies on many shortest connection paths in this dataset. Review its ${neighbors.length} neighboring entities to understand its network position.`,
        {
          neighbors,
          relative_betweenness: between.get(n.id)! / maxBetween,
          sampled: sources.length < ids.length,
        },
        0.45,
      );
    if (n.label === "Location" && neighbors.length >= 2)
      flag(
        "Shared location",
        [n.id, ...neighbors],
        `${neighbors.length} entities share a link to ${n.name}. A shared address alone does not demonstrate a meeting or simultaneous presence.`,
        { neighbors, location: n.name },
        0.25,
      );
  }
  const transfers = records.filter((r) => r.rel === "FINANCIAL_TRANSFER");
  const financial = new Map<string, Set<string>>();
  transfers.forEach((r) => {
    if (!financial.has(r.src)) financial.set(r.src, new Set());
    financial.get(r.src)!.add(r.dst);
  });
  const seen = new Set<string>();
  let cycleChecks = 0;
  cycleSearch: for (const [a, targets] of financial)
    for (const b of targets)
      for (const c of financial.get(b) || []) {
        if (++cycleChecks > 100000) {
          warnings.add(
            "Circular-transfer search reached its computation limit; additional loops may exist.",
          );
          break cycleSearch;
        }
        if (a !== b && b !== c && a !== c && financial.get(c)?.has(a)) {
          const key = [a, b, c].sort().join("\u0000");
          if (!seen.has(key) && seen.size < 100) {
            seen.add(key);
            flag(
              "Circular transfer links",
              [a, b, c],
              `Transfer records form a loop: ${a} → ${b} → ${c} → ${a}. This describes connectivity; verify dates and amounts before interpreting movement of funds.`,
              {
                cycle: [a, b, c, a],
                records: transfers.filter(
                  (r) =>
                    (r.src === a && r.dst === b) ||
                    (r.src === b && r.dst === c) ||
                    (r.src === c && r.dst === a),
                ),
              },
              0.7,
            );
          }
        }
      }
  warnings.add(
    "Computed locally: weighted PageRank, shortest-path betweenness and weighted label-propagation communities. Groups and role labels describe network structure only.",
  );
  if (sources.length < ids.length)
    warnings.add(
      `Betweenness estimated from ${sources.length} sampled starting entities.`,
    );
  if (!transfers.length)
    warnings.add(
      "No financial-transfer records: financial patterns were not evaluated.",
    );
  warnings.add(
    "Circular-transfer detection covers three-entity loops. Alerts are review leads; an empty list does not establish that a network is safe.",
  );
  return {
    id: crypto.randomUUID(),
    name,
    created: new Date().toISOString(),
    graph: {
      nodes,
      edges,
      truncated: false,
      total_nodes: nodes.length,
      total_edges: edges.length,
    },
    players,
    communities,
    alerts: alerts.sort((a, b) => b.severity_score - a.severity_score),
    details,
    notes: [...warnings],
    records,
  };
}

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
