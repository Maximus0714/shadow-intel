export interface ApiConfig {
  baseUrl: string;
  key: string;
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

const LS_KEY = "xtracer-api";
const LEGACY_LS_KEY = "shadowintel-api";

export function loadConfig(): ApiConfig {
  try {
    const raw =
      localStorage.getItem(LS_KEY) ||
      sessionStorage.getItem(LS_KEY) ||
      localStorage.getItem(LEGACY_LS_KEY) ||
      sessionStorage.getItem(LEGACY_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.baseUrl === "string" &&
        typeof parsed.key === "string"
      )
        return parsed as ApiConfig;
    }
  } catch {
    /* fresh start */
  }
  return { baseUrl: "http://127.0.0.1:8000", key: "" };
}

export function saveConfig(c: ApiConfig, remember: boolean) {
  try {
    const s = JSON.stringify(c);
    if (remember) {
      localStorage.setItem(LS_KEY, s);
      sessionStorage.removeItem(LS_KEY);
    } else {
      sessionStorage.setItem(LS_KEY, s);
      localStorage.removeItem(LS_KEY);
    }
    localStorage.removeItem(LEGACY_LS_KEY);
    sessionStorage.removeItem(LEGACY_LS_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function req<T>(
  cfg: ApiConfig,
  path: string,
  init?: RequestInit,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(cfg.baseUrl.replace(/\/$/, "") + path, {
      signal: AbortSignal.timeout(30_000),
      ...init,
      headers: {
        "X-API-Key": cfg.key,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Cannot reach ${cfg.baseUrl}. Start the backend: python -m uvicorn api:app --port 8000`,
    );
  }
  if (res.status === 401)
    throw new Error(
      "API key rejected (401). Check the key in Upload & Settings.",
    );
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

export const getHealth = (c: ApiConfig) =>
  req<{ status: string; backend?: string }>(c, "/health");
export const getStats = (c: ApiConfig) =>
  req<{ nodes: number; edges: number }>(c, "/stats");
export const getGraphFull = (c: ApiConfig, limit = 600) =>
  req<FullGraph>(c, `/graph/full?limit=${limit}`);
export const getPaths = (c: ApiConfig, a: string, b: string, hops = 3) =>
  req<{ source: string; target: string; paths: string[][]; count: number }>(
    c,
    `/entities/${encodeURIComponent(a)}/paths/${encodeURIComponent(
      b,
    )}?max_hops=${hops}`,
  );
export const getKeyPlayers = (c: ApiConfig, limit = 20) =>
  req<{ players: KeyPlayer[]; total: number }>(
    c,
    `/analytics/key-players?limit=${limit}`,
  );
export const getAlerts = (c: ApiConfig) =>
  req<{ flags: AlertFlag[]; total: number }>(c, "/analytics/alerts");
export const searchEntities = (c: ApiConfig, query: string) =>
  req<{
    query: string;
    results: {
      id: string;
      label: string;
      name: string;
      score: number;
      match_type: string;
    }[];
  }>(c, "/search", { method: "POST" }, { query, limit: 10 });
export const getEntity = (c: ApiConfig, id: string) =>
  req<EntityDetail>(c, `/entities/${encodeURIComponent(id)}`);
export interface EgoNetwork {
  center: string;
  depth: number;
  nodes: {
    id: string;
    label: string;
    name: string;
    community_id?: number | null;
    role?: string | null;
    influence_score?: number | null;
  }[];
  edges: { src: string; dst: string; rel: string; frequency: number }[];
}
export const getEgo = (c: ApiConfig, id: string, depth = 1) =>
  req<EgoNetwork>(
    c,
    `/entities/${encodeURIComponent(id)}/network?depth=${depth}`,
  );

export async function analyzeDocumentText(
  cfg: ApiConfig,
  text: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/documents/analyze", {
      signal: AbortSignal.timeout(60_000),
      method: "POST",
      headers: { "X-API-Key": cfg.key },
      body: (() => {
        const f = new FormData();
        f.append("text", text);
        return f;
      })(),
    });
  } catch {
    throw new Error(`Cannot reach ${cfg.baseUrl}.`);
  }
  if (res.status === 401) throw new Error("API key rejected (401).");
  if (!res.ok) throw new Error(`HTTP ${res.status} on /documents/analyze`);
  return res.json();
}

export async function postIngest(
  cfg: ApiConfig,
  endpoint: "preview" | "load",
  file: File,
  sheet?: string,
  mapping?: Record<string, string | null>,
): Promise<unknown> {
  const f = new FormData();
  f.append("file", file);
  if (sheet) f.append("sheet", sheet);
  if (mapping) f.append("mapping", JSON.stringify(mapping));
  let res: Response;
  try {
    res = await fetch(cfg.baseUrl.replace(/\/$/, "") + `/ingest/${endpoint}`, {
      signal: AbortSignal.timeout(60_000),
      method: "POST",
      headers: { "X-API-Key": cfg.key },
      body: f,
    });
  } catch {
    throw new Error(`Cannot reach ${cfg.baseUrl}.`);
  }
  if (res.status === 401) throw new Error("API key rejected (401).");
  if (!res.ok) {
    let msg = `HTTP ${res.status} on /ingest/${endpoint}`;
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") msg = j.detail;
      else if (j?.detail?.message) msg = j.detail.message;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const getCommunities = (c: ApiConfig) =>
  req<{ communities: import("./workspace").Community[]; total: number }>(
    c,
    "/analytics/communities",
  );
export const reloadGraph = (c: ApiConfig) =>
  req<Record<string, unknown>>(c, "/admin/reload", { method: "POST" });
