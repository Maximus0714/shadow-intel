import type { FullGraphNode } from "./api";
export type EntitySort = "name" | "role" | "community" | "influence";
const roles: Record<string,number> = {member:0,bridge:1,leader:2};
const text = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;

/** Influence is calculated as a 0-1 graph score and shown as a percentage. */
export function formatInfluence(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(Math.max(0, value) * 100).toFixed(1)}%`;
}

/** Missing values stay last in either direction; ID makes ties reproducible. */
export function orderEntities(nodes: FullGraphNode[], field: EntitySort, direction: "asc" | "desc") {
  const value = (n:FullGraphNode) => field === "role" ? roles[n.role || ""]
    : field === "community" ? n.community_id : field === "influence" ? n.influence_score : n.name.toLowerCase();
  return [...nodes].sort((a,b)=>{
    const av = value(a), bv = value(b);
    if(av == null && bv != null)return 1;
    if(bv == null && av != null)return -1;
    const comparison = av == null || bv == null ? 0 : typeof av === "number" && typeof bv === "number" ? av-bv : text(String(av),String(bv));
    return comparison * (direction === "asc" ? 1 : -1) || text(a.id,b.id);
  });
}
