import type { LocalDataset } from "../frontend/src/lib/analysis/local";
import type { CleanedEdge } from "../frontend/src/lib/data/upload";
export const ANALYSIS_VERSION: string;
export function buildDataset(records: CleanedEdge[], name: string): LocalDataset;
