import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  MagnifyingGlass,
  BookmarkSimple,
  ArrowUpRight,
  UsersThree,
} from "@phosphor-icons/react";
import {
  getGraphFull,
  getKeyPlayers,
  searchEntities,
  type FullGraphNode,
} from "../lib/data/api";
import { demoGraph } from "../lib/data/demo";
import { samplePlayers, useData, useWorkspace } from "../lib/state/workspace";
import { PageHeader, Loading, ErrorState, Empty } from "../components/UI";
import EntityDossier from "../components/EntityDossier";
import { orderEntities, type EntitySort } from "../lib/data/entityOrder";
export default function Entities() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { mode, cfg, watched, toggleWatch } = useWorkspace();
  const [query, setQuery] = useState(params.get("q") || "");
  const [type, setType] = useState("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [role, setRole] = useState("all");
  const [community, setCommunity] = useState("all");
  const [sort, setSort] = useState<EntitySort>("influence");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [hits, setHits] = useState<FullGraphNode[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);
  const state = useData(
    "entities",
    async (c) => {
      const [g, p] = await Promise.all([
        getGraphFull(c, 2000),
        getKeyPlayers(c, 2000),
      ]);
      return { nodes: g.nodes, players: p.players, truncated: g.truncated };
    },
    { nodes: demoGraph.nodes, players: samplePlayers, truncated: false },
  );
  useEffect(() => {
    setQuery(params.get("q") || "");
  }, [params.get("q")]);
  useEffect(() => {
    let active = true;
    setPage(1);
    setSearchError("");
    setHits(null);
    if (mode === "demo" || !query.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(
      () =>
        searchEntities(cfg, query.trim())
          .then((r) => {
            if (active)
              setHits(
                r.results.map((n) => ({ ...n, label: n.label || "Person" })),
              );
          })
          .catch((e) => {
            if (active) setSearchError(e.message);
          })
          .finally(() => {
            if (active) setSearching(false);
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, mode, cfg]);
  const ranked = new Map(state.data?.players.map(p=>[p.person_id,p]));
  const allNodes = (hits || state.data?.nodes || []).map(n=>{
    const p = ranked.get(n.id);
    return {...n,role:p?.role??n.role,community_id:p?.community_id??n.community_id,influence_score:p?.influence_score??n.influence_score};
  });
  const nodes = orderEntities(allNodes.filter(
    (n) =>
      (mode === "local" && query.trim() && hits
        ? true
        : !query.trim() ||
          `${n.name} ${n.id}`.toLowerCase().includes(query.toLowerCase())) &&
      (type === "all" || n.label === type) &&
      (role === "all" || (n.role || "unranked") === role) &&
      (community === "all" || (n.community_id == null ? "ungrouped" : String(n.community_id)) === community) &&
      (!savedOnly || watched.includes(n.id)),
  ), sort, direction);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(nodes.length / 15)));
  const selected = id
    ? state.data?.nodes.find((n) => n.id === id) || {
        id,
        name: id,
        label: "Person",
      }
    : null;
  return (
    <>
      <PageHeader
        title="People. Places. Connections."
        description="Find an entity, understand its role, and keep the important ones close."
        eyebrow="ENTITIES & SEARCH"
      >
        <span className="count-label">
          {state.data?.nodes.length || 0} entities indexed
        </span>
      </PageHeader>
      <div className="panel entity-browser">
        <div className="entity-controls">
          <div className="search-field">
            <MagnifyingGlass size={19} />
            <input
              aria-label="Search entities"
              placeholder="Search a name, ID, phone or plate…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Entity type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All entity types</option>
            {[...new Set(state.data?.nodes.map((n) => n.label))].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <button
            className={`btn ${savedOnly ? "active-control" : ""}`}
            onClick={() => {
              setSavedOnly(!savedOnly);
              setPage(1);
            }}
          >
            <BookmarkSimple weight={savedOnly ? "fill" : "regular"} size={17} />
            Watchlist
          </button>
        </div>
        <div className="entity-controls">
          <label className="field"><span>Role</span><select aria-label="Filter by role" value={role} onChange={e=>{setRole(e.target.value);setPage(1);}}>
            <option value="all">All roles</option><option value="leader">Leader</option><option value="bridge">Bridge</option><option value="member">Member</option><option value="unranked">Unranked</option>
          </select></label>
          <label className="field"><span>Community</span><select aria-label="Filter by community" value={community} onChange={e=>{setCommunity(e.target.value);setPage(1);}}>
            <option value="all">All communities</option>
            {[...new Set(state.data?.nodes.map(n=>ranked.get(n.id)?.community_id??n.community_id).filter((c):c is number=>c!=null))].sort((a,b)=>a-b).map(c=><option key={c} value={c}>Group {c+1}</option>)}
            <option value="ungrouped">Not grouped</option>
          </select></label>
          <label className="field"><span>Order by</span><select aria-label="Order entities by" value={sort} onChange={e=>{setSort(e.target.value as EntitySort);setPage(1);}}>
            <option value="influence">Influence</option><option value="role">Role</option><option value="community">Community</option><option value="name">Name</option>
          </select></label>
          <label className="field"><span>Direction</span><select aria-label="Sort direction" value={direction} onChange={e=>{setDirection(e.target.value as "asc"|"desc");setPage(1);}}>
            <option value="asc">Ascending</option><option value="desc">Descending</option>
          </select></label>
          <button className="btn" onClick={()=>{setRole("all");setCommunity("all");setType("all");setSavedOnly(false);setQuery("");setSort("influence");setDirection("desc");setPage(1);}}>Reset filters</button>
        </div>
        <p className="helper">Role order: member → bridge → leader. Unranked values stay last. Ordering applies to all matching results before pagination.</p>
        {state.loading || searching ? (
          <Loading />
        ) : state.error || searchError ? (
          <ErrorState
            message={state.error || searchError}
            retry={state.retry}
          />
        ) : nodes.length ? (
          <>
            <div className="table-scroll">
              <table className="data entity-table">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Community</th>
                    <th>Influence</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.slice((currentPage - 1) * 15, currentPage * 15).map((n) => {
                    const p = state.data?.players.find(
                      (p) => p.person_id === n.id,
                    );
                    return (
                      <tr key={n.id}>
                        <td>
                          <Link
                            className="table-entity"
                            to={`/entities/${encodeURIComponent(n.id)}`}
                          >
                            <span className="entity-avatar">
                              {n.name
                                .split(" ")
                                .map((v) => v[0])
                                .slice(0, 2)
                                .join("")}
                            </span>
                            <span>
                              <strong>{n.name}</strong>
                              <small>{n.id}</small>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className="tag">{n.label}</span>
                        </td>
                        <td className="capitalize">
                          {p?.role || n.role || "Unranked"}
                        </td>
                        <td>
                          {n.community_id != null
                            ? `Group ${n.community_id + 1}`
                            : "Not grouped"}
                        </td>
                        <td className="mono">
                          {(p?.influence_score ?? n.influence_score)?.toFixed(
                            4,
                          ) || "N/A"}
                        </td>
                        <td>
                          <div className="inline-actions">
                            <button
                              className="icon-button"
                              aria-label={`${watched.includes(n.id) ? "Remove" : "Save"} ${n.name} ${watched.includes(n.id) ? "from" : "to"} watchlist`}
                              onClick={() => toggleWatch(n.id)}
                            >
                              <BookmarkSimple
                                weight={
                                  watched.includes(n.id) ? "fill" : "regular"
                                }
                                size={19}
                              />
                            </button>
                            <Link
                              className="icon-button"
                              aria-label={`View ${n.name} in graph`}
                              to={`/network?focus=${encodeURIComponent(n.id)}`}
                            >
                              <ArrowUpRight size={19} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                {nodes.length} matching entities
                {state.data?.truncated ? " in the loaded graph" : ""}
              </span>
              <div>
                <button
                  className="btn small"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>
                  {currentPage} / {Math.ceil(nodes.length / 15)}
                </span>
                <button
                  className="btn small"
                  disabled={currentPage * 15 >= nodes.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            title={
              savedOnly ? "Your watchlist is empty" : "No matching entities"
            }
            body={
              savedOnly
                ? "Save an entity using the bookmark button to keep it here."
                : "Try a broader name, clear a filter, or import more evidence."
            }
          />
        )}
      </div>
      {selected && (
        <div className="dossier-detail">
          <EntityDossier
            node={selected}
            onClose={() => navigate("/entities")}
            onFocus={(next) =>
              navigate(`/entities/${encodeURIComponent(next)}`)
            }
          />
        </div>
      )}
      <p className="helper">
        <UsersThree size={16} />
        Influence measures position within the network. It is not a measure of
        guilt or risk.
      </p>
    </>
  );
}
