import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  loadConfig,
  saveConfig,
  type ApiConfig,
  type KeyPlayer,
  type AlertFlag,
} from "./api";
import { demoGraph } from "./demo";

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
  mode: "demo" | "live";
  setMode: (mode: "demo" | "live") => void;
  cfg: ApiConfig;
  connect: (cfg: ApiConfig, remember: boolean) => void;
  revision: number;
  refresh: () => void;
  watched: string[];
  toggleWatch: (id: string) => void;
  notice: string;
  notify: (text: string) => void;
}
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
  const [cfg, setCfg] = useState(loadConfig);
  const [mode, setModeState] = useState<"demo" | "live">(() => {
    const m = readMigrated<string>("xt-mode", "si-mode", "demo");
    return m === "live" ? "live" : "demo";
  });
  const [revision, setRevision] = useState(0);
  const [watchState, setWatchState] = useState<Record<string, string[]>>(() =>
    readMigrated("xt-watchlists", "si-watchlists", {}),
  );
  const [notice, notify] = useState("");
  const scope = mode === "demo" ? "demo" : cfg.baseUrl;
  const watched = Array.isArray(watchState[scope]) ? watchState[scope] : [];
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => notify(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const setMode = (m: "demo" | "live") => {
    setModeState(m);
    try {
      localStorage.setItem("xt-mode", JSON.stringify(m));
      localStorage.removeItem("si-mode");
    } catch {}
  };
  const connect = (c: ApiConfig, remember: boolean) => {
    saveConfig(c, remember);
    setCfg(c);
    setMode("live");
    setRevision((n) => n + 1);
    notify("Connection saved. Your workspace is now live.");
  };
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
        mode,
        setMode,
        cfg,
        connect,
        revision,
        refresh: () => setRevision((n) => n + 1),
        watched,
        toggleWatch,
        notice,
        notify,
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
  const [loading, setLoading] = useState(mode === "live");
  const [retryKey, retry] = useState(0);
  const scope = JSON.stringify([
    key,
    mode,
    cfg.baseUrl,
    cfg.key,
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
  }, [key, mode, cfg.baseUrl, cfg.key, revision, retryKey]);
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
