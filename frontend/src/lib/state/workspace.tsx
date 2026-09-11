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
import { useAuth } from "../auth";

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
    pattern_type: "Cross-group financial activity",
    severity_score: 0.59,
    entities_involved: ["P01", "P05"],
    plain_language_explanation:
      "A financial link connects two graph communities and has at least three recorded interactions. Communities are structural estimates, so confirm operational context.",
    source_dataset: "Fictional demonstration",
    evidence: {
      relationship: "FINANCIAL_TRANSFER",
      from: "P01",
      to: "P05",
      frequency: 5,
      source_group: 0,
      target_group: 1,
      note: "Fictional demonstration. The flag is a review lead, not a conclusion.",
    },
  },
  {
    pattern_type: "Cross-group communication",
    severity_score: 0.5,
    entities_involved: ["P02", "P07"],
    plain_language_explanation:
      "A communication link connects two graph communities and has three recorded interactions. Review dates and source records before interpreting coordination.",
    source_dataset: "Fictional demonstration",
    evidence: { relationship: "CALLED", frequency: 3 },
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
  mode: "demo" | "local";
  setMode: (mode: "demo" | "local") => void;
  cfg: ApiConfig;
  dataset: LocalDataset | null;
  ready: boolean;
  importData: (records: CleanedEdge[], name: string, retainId?: string, sourceText?: string) => Promise<void>;
  revision: number;
  refresh: () => void;
  watched: string[];
  toggleWatch: (id: string) => void;
  notice: string;
  notify: (text: string) => void;
  history: InvestigationHistory[];
  reopenInvestigation: (item: InvestigationHistory) => Promise<void>;
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
  const engine = "backend" as const;
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
  const historyKey = user ? `xt-investigations:${user.id}` : "xt-investigations:guest";
  const [history, setHistory] = useState<InvestigationHistory[]>(() => read(historyKey, []));
  useEffect(() => setHistory(read(historyKey, [])), [historyKey]);
  const scope = mode === "demo" ? "demo" : dataset?.id || "local";
  useEffect(() => {
    let active = true;
    readDataset()
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
  }, []);
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
  const importData = async (records: CleanedEdge[], name: string, retainId?: string, sourceText?: string) => {
    const result = await analyzeOnServer(records, name, sourceText);
    if (retainId && retainId === dataset?.id) result.id = retainId;
    let saved = true;
    try {
      await saveDataset(result);
    } catch {
      saved = false;
    }
    setDataset(result);
    const item: InvestigationHistory = { id: result.id, name: result.name, created: result.created, engine, nodes: result.graph.total_nodes, edges: result.graph.total_edges, dataset: result };
    setHistory((prev) => { const next = [item, ...prev.filter((entry) => entry.id !== item.id)].slice(0, 25); try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch {} return next; });
    setMode("local");
    setRevision((n) => n + 1);
    notify(
      saved
        ? "Your investigation is ready and saved in this browser."
        : "Analysis ready for this session. Storage is full or unavailable; download a report before closing.",
    );
  };
  const reopenInvestigation = async (item: InvestigationHistory) => { await saveDataset(item.dataset); setDataset(item.dataset); setMode("local"); setRevision((n) => n + 1); notify(`Reopened ${item.name}.`); };
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
