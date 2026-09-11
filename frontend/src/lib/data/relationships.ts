export interface RelationshipVisual {
  label: string;
  color: string;
  line: "solid" | "dashed" | "dotted";
}

const defaultVisual: RelationshipVisual = {
  label: "Relationship",
  color: "#8b9099",
  line: "solid",
};

export const relationshipVisuals: Record<string, RelationshipVisual> = {
  CALLED: { label: "Called", color: "#58a6b3", line: "solid" },
  EMAILED: { label: "Emailed", color: "#6f8fc7", line: "dotted" },
  CONTACTED: { label: "Contacted", color: "#7c83bd", line: "dashed" },
  FINANCIAL_TRANSFER: { label: "Financial transfer", color: "#d0a15f", line: "solid" },
  ASSOCIATE_OF: { label: "Associate of", color: "#92969e", line: "dashed" },
  FAMILY_OF: { label: "Family of", color: "#b27f98", line: "solid" },
  CO_LOCATED: { label: "Co-located", color: "#74a184", line: "dotted" },
  OWNS_VEHICLE: { label: "Owns vehicle", color: "#b77c61", line: "solid" },
  USED_VEHICLE: { label: "Used vehicle", color: "#779aaa", line: "dashed" },
  REGISTERED_AT: { label: "Registered at", color: "#a79268", line: "solid" },
  VISITED: { label: "Visited", color: "#6098b9", line: "dashed" },
  HAS_PHONE: { label: "Has phone", color: "#6d9e86", line: "solid" },
  HAS_ACCOUNT: { label: "Has account", color: "#887caf", line: "solid" },
  WORKS_FOR: { label: "Works for", color: "#8d89a7", line: "solid" },
  ARGUED_WITH: { label: "Argued with", color: "#c08055", line: "dashed" },
  THREATENED: { label: "Threatened", color: "#c65f5f", line: "solid" },
};

export function relationshipVisual(rel: string): RelationshipVisual {
  return relationshipVisuals[rel] || {
    ...defaultVisual,
    label: rel.replace(/_/g, " ").toLowerCase().replace(/^./, value => value.toUpperCase()),
  };
}
