/** Deterministic weighted graph metrics, shared by browser and server. */
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const rounded = value => Number(value.toFixed(10));

class Heap {
  values = [];
  push(value) {
    const a = this.values;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] < value[0] || (a[p][0] === value[0] && a[p][1] <= value[1])) break;
      a[i] = a[p]; i = p;
    }
    a[i] = value;
  }
  pop() {
    const a = this.values, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (2 * i + 1 < a.length) {
        let c = 2 * i + 1;
        if (c + 1 < a.length && (a[c + 1][0] < a[c][0] || (a[c + 1][0] === a[c][0] && a[c + 1][1] < a[c][1]))) c++;
        if (last[0] < a[c][0] || (last[0] === a[c][0] && last[1] <= a[c][1])) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return first;
  }
}

export function metrics(adj) {
  const n = adj.length;
  if (!n) return { degree: [], pagerank: [], betweenness: [], groups: [], iterations: 0 };
  const degree = adj.map(a => n > 1 ? a.size / (n - 1) : 0);
  const strength = adj.map(a => [...a.values()].reduce((a, b) => a + b, 0));
  let pagerank = Array(n).fill(1 / n), iterations = 0;
  for (; iterations < 1000; iterations++) {
    const dangling = pagerank.reduce((sum, p, i) => sum + (strength[i] ? 0 : p), 0);
    const next = Array(n).fill((0.15 + 0.85 * dangling) / n);
    adj.forEach((neighbors, i) => neighbors.forEach((w, j) => { next[j] += 0.85 * pagerank[i] * w / strength[i]; }));
    const error = next.reduce((sum, p, i) => sum + Math.abs(p - pagerank[i]), 0);
    pagerank = next;
    if (error < 1e-12) { iterations++; break; }
  }
  if (iterations >= 1000) throw new Error("PageRank did not converge. Reduce the dataset or inspect extreme frequencies.");
  // Weighted Brandes for ALL source people. Stronger ties have shorter distance.
  const betweenness = Array(n).fill(0);
  for (let source = 0; source < n; source++) {
    const distances = Array(n).fill(Infinity), paths = Array(n).fill(0);
    const parents = Array.from({length: n}, () => []), dependency = Array(n).fill(0);
    const visited = Array(n).fill(false), stack = [], heap = new Heap();
    distances[source] = 0; paths[source] = 1; heap.push([0, source]);
    while (heap.values.length) {
      const [distance, v] = heap.pop();
      if (visited[v]) continue;
      visited[v] = true; stack.push(v);
      for (const [w, weight] of adj[v]) {
        if (visited[w]) continue;
        const next = distance + 1 / weight;
        const tolerance = 1e-12 * Math.max(1, next);
        if (next < distances[w] - tolerance) {
          distances[w] = next; paths[w] = paths[v]; parents[w] = [v]; heap.push([next, w]);
        } else if (Math.abs(next - distances[w]) <= tolerance) {
          paths[w] += paths[v]; parents[w].push(v);
        }
      }
    }
    while (stack.length) {
      const w = stack.pop();
      for (const v of parents[w]) dependency[v] += paths[v] / paths[w] * (1 + dependency[w]);
      if (w !== source) betweenness[w] += dependency[w];
    }
  }
  if (n > 2) for (let i = 0; i < n; i++) betweenness[i] /= (n - 1) * (n - 2);
  return { degree, pagerank, betweenness, groups: louvain(adj), iterations };
}

/** Multilevel Louvain: positive modularity moves, deterministic ties and aggregation. */
function louvain(original) {
  let adj = original, members = original.map((_, i) => [i]);
  for (let level = 0; level < original.length; level++) {
    const degree = adj.map(a => [...a.values()].reduce((s, w) => s + w, 0));
    const m2 = degree.reduce((a, b) => a + b, 0);
    const labels = adj.map((_, i) => i), totals = [...degree];
    let converged = !m2;
    for (let pass = 0; m2 && pass < 1000; pass++) {
      let changed = false;
      for (let i = 0; i < adj.length; i++) {
        const current = labels[i], weights = new Map();
        for (const [j, weight] of adj[i]) if (i !== j) weights.set(labels[j], (weights.get(labels[j]) || 0) + weight);
        totals[current] -= degree[i];
        const score = c => (weights.get(c) || 0) - degree[i] * totals[c] / m2;
        let best = current, bestScore = score(current);
        for (const c of [...weights.keys()].sort((a, b) => a - b)) {
          const value = score(c);
          if (value > bestScore + 1e-12 * m2) { best = c; bestScore = value; }
        }
        labels[i] = best; totals[best] += degree[i];
        if (best !== current) changed = true;
      }
      if (!changed) { converged = true; break; }
    }
    if (!converged) throw new Error("Community optimization did not converge.");
    const grouped = new Map();
    labels.forEach((c, i) => grouped.set(c, [...(grouped.get(c) || []), ...members[i]]));
    const entries = [...grouped.entries()].sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]));
    const remap = new Map(entries.map(([c], i) => [c, i]));
    const nextMembers = entries.map(([, ms]) => ms.sort((a, b) => a - b));
    if (nextMembers.length === adj.length || !m2) {
      const result = [];
      nextMembers.forEach((ms, c) => ms.forEach(i => { result[i] = c; }));
      return result;
    }
    const next = nextMembers.map(() => new Map());
    adj.forEach((neighbors, i) => neighbors.forEach((w, j) => {
      const a = remap.get(labels[i]), b = remap.get(labels[j]);
      next[a].set(b, (next[a].get(b) || 0) + w);
    }));
    adj = next; members = nextMembers;
  }
  throw new Error("Community optimization exceeded its level limit.");
}
