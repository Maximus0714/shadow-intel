import type { FullGraph } from "./api";

// Bundled fictional demo graph (Copper-Ledger family). Used whenever the
// backend is unreachable so every page stays usable offline. Clearly labeled
// DEMO wherever rendered.
export const demoGraph: FullGraph = {
  nodes: [
    { id: "P01", label: "Person", name: "Mohan Yadav", role: "leader", influence_score: 0.92, community_id: 0 },
    { id: "P02", label: "Person", name: "Ravi Sharma", role: "bridge", influence_score: 0.71, community_id: 0 },
    { id: "P03", label: "Person", name: "Anil Verma", role: "bridge", influence_score: 0.68, community_id: 0 },
    { id: "P05", label: "Person", name: "Farhan Qureshi", role: "leader", influence_score: 0.83, community_id: 1 },
    { id: "P07", label: "Person", name: "Sana Sheikh", role: "bridge", influence_score: 0.62, community_id: 1 },
    { id: "P09", label: "Person", name: "Prakash Rao", role: "member", influence_score: 0.28, community_id: 2 },
    { id: "V1", label: "Vehicle", name: "MH12AB1234", role: "member", influence_score: 0.2, community_id: 0 },
    { id: "L1", label: "Location", name: "Andheri", role: "member", influence_score: 0.1, community_id: 0 },
  ],
  edges: [
    { id: "P01>P02", src: "P01", dst: "P02", rel: "CALLED", frequency: 4 },
    { id: "P01>P05", src: "P01", dst: "P05", rel: "FINANCIAL_TRANSFER", frequency: 5 },
    { id: "P03>P07", src: "P03", dst: "P07", rel: "CALLED", frequency: 4 },
    { id: "P05>P07", src: "P05", dst: "P07", rel: "FINANCIAL_TRANSFER", frequency: 4 },
    { id: "P05>P09", src: "P05", dst: "P09", rel: "ASSOCIATE_OF", frequency: 2 },
    { id: "P07>P02", src: "P07", dst: "P02", rel: "CALLED", frequency: 3 },
    { id: "P09>P03", src: "P09", dst: "P03", rel: "CALLED", frequency: 2 },
    { id: "P01>V1", src: "P01", dst: "V1", rel: "OWNS_VEHICLE", frequency: 1 },
    { id: "P01>L1", src: "P01", dst: "L1", rel: "REGISTERED_AT", frequency: 1 },
  ],
  truncated: false,
  total_nodes: 8,
  total_edges: 9,
};
