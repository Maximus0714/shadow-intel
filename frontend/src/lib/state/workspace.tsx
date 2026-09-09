import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { type ApiConfig, type KeyPlayer, type AlertFlag } from "../data/api";
import { demoGraph } from "../data/demo";
import type { LocalDataset } from "../analysis/local";
import type { CleanedEdge } from "../data/upload";
import { readDataset, saveDataset } from "./localStorage";
import { analyzeOnServer } from "../data/server";
import { supabase, useAuth } from "../auth";

export const samplePlayers: KeyPlayer[] = demoGraph.nodes
  .filter((n) => n.label === "Person")
  .map((n) => ({
    person_id: n.id,
    name: n.name,
    influence_score: n.influence_score || 0,
    community_id: n.community_id || 0,
    role: n.role || "member",
  }))
  .sort((a, b) => b.influence_score - a.influence_score);
export const sampleAlerts: AlertFlag[] = [
  {
    pattern_type: "Cross-community connection",
    severity_score: 0.76,
    entities_involved: ["P01", "P05"],
    plain_language_explanation:
      "A financial connection links two otherwise separate groups. Review the source records to understand the relationship.",
    source_dataset: "Fictional demonstration",
    evidence: {
      relationship: "FINANCIAL_TRANSFER",
      from: "P01",
      to: "P05",
      frequency: 5,
      note: "Illustrative flag, not a finding about real people.",
    },
  },
  {
    pattern_type: "Bridge entity",
    severity_score: 0.56,
    entities_involved: ["P02", "P07"],
    plain_language_explanation:
      "These entities connect multiple parts of the sample network. Their communication may help explain how the groups interact.",
    source_dataset: "Fictional demonstration",
    evidence: { relationship: "CALLED", frequency: 3 },
  },
  {
    pattern_type: "Shared location",
    severity_score: 0.28,
    entities_involved: ["P01", "L1"],
    plain_language_explanation:
      "A location record is linked to an entity of interest. Verify its date and provenance before drawing conclusions.",
    source_dataset: "Fictional demonstration",
    evidence: { relationship: "REGISTERED_AT", location: "Andheri" },
  },
];
export interface Community {
  community_id: number;
  size: number;
  leader?: string | null;
  members: {
    person_id: string;
    name: string;
    role: string;
    influence_score: number;
  }[];
}
export const sampleCommunities: Community[] = [
  ...new Set(samplePlayers.map((p) => p.community_id)),
].map((id) => {
  const members = samplePlayers.filter((p) => p.community_id === id);
  return {
    community_id: id,
    size: members.length,
    leader: members[0]?.person_id,
    members,
  };
});

interface Workspace {
  engine: "local" | "backend";
  setEngine: (engine: "local" | "backend") => void;
  mode: "demo" | "local";
  setMode: (mode: "demo" | "local") => void;
  cfg: ApiConfig;
  dataset: LocalDataset | null;
  ready: boolean;
  importData: (records: CleanedEdge[], name: string, retainId?: string) => Promise<void>;
  revision: number;
  refresh: () => void;
  watched: string[];
  toggleWatch: (id: string) => void;
  notice: string;
  notify: (text: string) => void;
  history: InvestigationHistory[];
  reopenInvestigation: (item: InvestigationHistory) => Promise<void>;
  deleteInvestigation: (id: string) => Promise<void>;
  cloudStatus: "local" | "syncing" | "synced" | "setup-required";
  alertDecisions: Record<string, "confirmed" | "dismissed">;
  setAlertDecision: (key: string, decision: "confirmed" | "dismissed" | "unreviewed") => void;
}
export interface InvestigationHistory { id: string; name: string; created: string; engine: "local" | "backend"; nodes: number; edges: number; dataset: LocalDataset; }
const Context = createContext<Workspace | null>(null);
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function readMigrated<T>(key: string, legacyKey: string, fallback: T): T {
  const current = read<T | null>(key, null);
  return current ?? read<T>(legacyKey, fallback);
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [dataset, setDataset] = useState<LocalDataset | null>(null);
  const [ready, setReady] = useState(false);
  const [engine, setEngineState] = useState<"local" | "backend">(() =>
    read<string>("xt-engine", "backend") === "local" ? "local" : "backend",
  );
  const setEngine = (value: "local" | "backend") => {
    setEngineState(value);
    try {
      localStorage.setItem("xt-engine", JSON.stringify(value));
    } catch {}
  };
  const cfg = useMemo(() => ({ dataset, engine }), [dataset, engine]);
  const [mode, setModeState] = useState<"demo" | "local">(() => {
    const m = readMigrated<string>("xt-mode", "si-mode", "demo");
    return m === "demo" ? "demo" : "local";
  });
  const [revision, setRevision] = useState(0);
  const [watchState, setWatchState] = useState<Record<string, string[]>>(() =>
    readMigrated("xt-watchlists", "si-watchlists", {}),
  );
  const [notice, notify] = useState("");
  const currentDatasetKey = `current:${user?.id || "guest"}`;
  const historyKey = user ? `xt-investigations:${user.id}` : "xt-investigations:guest";
  const [history, setHistory] = useState<InvestigationHistory[]>(() => read(historyKey, []));
  const [cloudStatus, setCloudStatus] = useState<"local" | "syncing" | "synced" | "setup-required">("local");
  useEffect(() => setHistory(read(historyKey, [])), [historyKey]);
  useEffect(() => {
    if (!user || !supabase) { setCloudStatus("local"); return; }
    let active = true; setCloudStatus("syncing");
    supabase.from("investigations").select("id,name,created_at,engine,node_count,edge_count,dataset").order("created_at", { ascending: false }).limit(25).then(({ data, error }) => {
      if (!active) return;
      if (error) { setCloudStatus("setup-required"); return; }
      const cloud = (data || []).map((row) => ({ id: row.id, name: row.name, created: row.created_at, engine: row.engine, nodes: row.node_count, edges: row.edge_count, dataset: row.dataset })) as InvestigationHistory[];
      setHistory((local) => { const merged = [...cloud, ...local.filter((item) => !cloud.some((saved) => saved.id === item.id))].slice(0, 25); try { localStorage.setItem(historyKey, JSON.stringify(merged)); } catch {} return merged; });
      setCloudStatus("synced");
    });
    return () => { active = false; };
  }, [user?.id, historyKey]);
  const scope = mode === "demo" ? "demo" : dataset?.id || "local";
  const decisionKey = `xt-alert-decisions:${user?.id || "guest"}:${scope}`;
  const [alertDecisions, setAlertDecisions] = useState<Record<string, "confirmed" | "dismissed">>(() => read(decisionKey, {}));
  useEffect(() => setAlertDecisions(read(decisionKey, {})), [decisionKey]);
  useEffect(() => {
    let active = true;
    setReady(false);
    readDataset(currentDatasetKey)
      .then((d) => {
        if (active) setDataset(d);
      })
      .catch(() => {
        if (active)
          notify(
            "Browser storage is unavailable. Your analysis will last for this session.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [currentDatasetKey]);
  const watched = Array.isArray(watchState[scope]) ? watchState[scope] : [];
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => notify(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const setMode = (m: "demo" | "local") => {
    setModeState(m);
    try {
      localStorage.setItem("xt-mode", JSON.stringify(m));
      localStorage.removeItem("si-mode");
    } catch {}
  };
  const importData = async (records: CleanedEdge[], name: string, retainId?: string) => {
    const result =
      engine === "backend"
        ? await analyzeOnServer(records, name)
        : await (async () => {
            const worker = new Worker(
              new URL("../analysis/analysis.worker.ts", import.meta.url),
              { type: "module" },
            );
            return await new Promise<LocalDataset>((resolve, reject) => {
              const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error("Analysis timed out. Try a smaller dataset."));
      }, 80000);
              worker.onmessage = ({ data }) => {
                clearTimeout(timeout);
                worker.terminate();
                if (data.error) reject(new Error(data.error));
                else resolve(data.dataset);
              };
              worker.onerror = () => {
                clearTimeout(timeout);
                worker.terminate();
                reject(
                  new Error("Local analysis failed. Try a smaller dataset."),
                );
              };
              worker.postMessage({ records, name });
            });
          })();
    if (retainId && retainId === dataset?.id) result.id = retainId;
    let saved = true;
    try {
      await saveDataset(result, currentDatasetKey);
    } catch {
      saved = false;
    }
    setDataset(result);
    const item: InvestigationHistory = { id: result.id, name: result.name, created: result.created, engine, nodes: result.graph.total_nodes, edges: result.graph.total_edges, dataset: result };
    setHistory((prev) => { const next = [item, ...prev.filter((entry) => entry.id !== item.id)].slice(0, 25); try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch {} return next; });
    if (user && supabase) {
      setCloudStatus("syncing");
      const { error } = await supabase.from("investigations").upsert({ id: item.id, user_id: user.id, name: item.name, created_at: item.created, engine: item.engine, node_count: item.nodes, edge_count: item.edges, dataset: item.dataset, updated_at: new Date().toISOString() });
      if (!error) void supabase.from("audit_events").insert({ user_id: user.id, investigation_id: item.id, action: "investigation_analyzed", detail: { name: item.name, engine: item.engine, nodes: item.nodes, edges: item.edges } });
      setCloudStatus(error ? "setup-required" : "synced");
    }
    setMode("local");
    setRevision((n) => n + 1);
    notify(
      saved
        ? "Your investigation is ready and saved in this browser."
        : "Analysis ready for this session. Storage is full or unavailable; download a report before closing.",
    );
  };
  const reopenInvestigation = async (item: InvestigationHistory) => { await saveDataset(item.dataset, currentDatasetKey); setDataset(item.dataset); setMode("local"); setRevision((n) => n + 1); if(user && supabase) void supabase.from("audit_events").insert({ user_id:user.id, investigation_id:item.id, action:"investigation_reopened", detail:{name:item.name} }); notify(`Reopened ${item.name}.`); };
  const deleteInvestigation = async (id: string) => { setHistory((prev) => { const next = prev.filter((item) => item.id !== id); try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch {} return next; }); if (user && supabase) { await supabase.from("audit_events").insert({ user_id: user.id, investigation_id: id, action: "investigation_deleted", detail: {} }); await supabase.from("investigations").delete().eq("id", id); } notify("Investigation removed from history."); };
  const setAlertDecision = (key: string, decision: "confirmed" | "dismissed" | "unreviewed") => setAlertDecisions((prev) => { const next = { ...prev }; if (decision === "unreviewed") delete next[key]; else next[key] = decision; try { localStorage.setItem(decisionKey, JSON.stringify(next)); } catch {} if (user && dataset && supabase) void supabase.from("audit_events").insert({ user_id: user.id, investigation_id: dataset.id, action: `alert_${decision}`, detail: { alert_key: key } }); return next; });
  const toggleWatch = (id: string) =>
    setWatchState((prev) => {
      const ids = Array.isArray(prev[scope]) ? prev[scope] : [];
      const next = {
        ...prev,
        [scope]: ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
      };
      try {
        localStorage.setItem("xt-watchlists", JSON.stringify(next));
        localStorage.removeItem("si-watchlists");
      } catch {}
      return next;
    });
  return (
    <Context.Provider
      value={{
        engine,
        setEngine,
        mode,
        setMode,
        cfg,
        dataset,
        ready,
        importData,
        revision,
        refresh: () => setRevision((n) => n + 1),
        watched,
        toggleWatch,
        notice,
        notify,
        history,
        reopenInvestigation,
        deleteInvestigation,
        cloudStatus,
        alertDecisions,
        setAlertDecision,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const c = useContext(Context);
  if (!c) throw new Error("Workspace provider missing");
  return c;
}
export function useData<T>(
  key: string,
  loader: (cfg: ApiConfig) => Promise<T>,
  sample: T,
) {
  const { mode, cfg, revision } = useWorkspace();
  const [data, setData] = useState<T | null>(mode === "demo" ? sample : null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(mode === "local");
  const [retryKey, retry] = useState(0);
  const scope = JSON.stringify([
    key,
    mode,
    cfg.dataset?.id,
    revision,
    retryKey,
  ]);
  const [resolvedScope, setResolvedScope] = useState(scope);
  useEffect(() => {
    let active = true;
    setResolvedScope(scope);
    if (mode === "demo") {
      setData(sample);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    loader(cfg)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The named resource key includes any query parameters; callers supply stable resource identities.
  }, [key, mode, cfg.dataset?.id, revision, retryKey]);
  return {
    data: resolvedScope === scope ? data : null,
    error: resolvedScope === scope ? error : "",
    loading: resolvedScope !== scope || loading,
    retry: useCallback(() => retry((n) => n + 1), []),
  };
}
export function downloadFile(
  filename: string,
  content: string,
  type = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const readable = (value: string) =>
  value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (s) => s.toUpperCase());
