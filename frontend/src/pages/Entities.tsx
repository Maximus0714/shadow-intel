import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DossierPanel from "../components/DossierPanel";
import {
  getKeyPlayers,
  loadConfig,
  searchEntities,
  type FullGraphNode,
  type KeyPlayer,
} from "../lib/api";

interface Hit {
  id: string;
  label: string;
  name: string;
  score: number;
  match_type: string;
}

export default function Entities() {
  const { id } = useParams();
  const [cfg] = useState(loadConfig);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [players, setPlayers] = useState<KeyPlayer[] | null>(null);
  const [playersErr, setPlayersErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getKeyPlayers(cfg, 40)
      .then((r) => {
        if (!cancelled) setPlayers(r.players);
      })
      .catch((e: unknown) => {
        if (!cancelled) setPlayersErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.baseUrl, cfg.key]);

  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      setSearchErr(null);
      return;
    }
    const t = setTimeout(() => {
      searchEntities(cfg, q.trim())
        .then((r) => {
          setHits(r.results);
          setSearchErr(null);
        })
        .catch((e: unknown) => {
          setSearchErr(e instanceof Error ? e.message : String(e));
          setHits([]);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [q, cfg.baseUrl, cfg.key]);

  const detailNode: FullGraphNode | null = id
    ? { id, label: "Person", name: id }
    : null;

  return (
    <>
      <h1>Entities &amp; Search</h1>
      <p className="sub">
        Find people, phones, vehicles and locations by name, ID fragment, phone
        or plate. Open a dossier or jump straight into the graph.
      </p>
      <div className="card">
        <h2>Search</h2>
        <label className="field">
          <span>Name, phone, plate or case ID</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. yadav, 98765, MH12…"
            aria-label="Entity search"
          />
        </label>
        {searchErr && <div className="error">{searchErr}</div>}
        {q.trim() !== "" && hits && (
          hits.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Match</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.id}>
                    <td>{h.name}</td>
                    <td className="mono">{h.id}</td>
                    <td>
                      <span className="tag member">{h.match_type.toUpperCase()}</span>{" "}
                      <span className="mono">{h.score}</span>
                    </td>
                    <td>
                      <Link className="btn" to={`/network?focus=${encodeURIComponent(h.id)}`}>
                        Graph
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No matches — try a surname, phone fragment, or plate.</div>
          )
        )}
      </div>
      {detailNode && (
        <DossierPanel node={detailNode} onClose={() => {}} onFocus={() => {}} />
      )}
      <div className="card">
        <h2>Ranked key players</h2>
        {playersErr && (
          <div className="error">
            {playersErr} — is the backend running?{" "}
            <Link to="/upload">Check connection</Link>
          </div>
        )}
        {!players && !playersErr && <div className="skeleton">Loading ranking…</div>}
        {players && (
          players.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Crew</th>
                  <th>Influence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={p.person_id}>
                    <td className="mono">{i + 1}</td>
                    <td>
                      <Link to={`/entities/${encodeURIComponent(p.person_id)}`}>{p.name}</Link>
                    </td>
                    <td>
                      <span className={`tag ${p.role}`}>{p.role.toUpperCase()}</span>
                    </td>
                    <td className="mono">{p.community_id}</td>
                    <td>
                      <span className="mono">{p.influence_score.toFixed(3)}</span>
                      <div className="bar">
                        <i style={{ width: `${Math.round(Math.min(1, Math.max(0, p.influence_score)) * 100)}%` }} />
                      </div>
                    </td>
                    <td>
                      <Link className="btn" to={`/network?focus=${encodeURIComponent(p.person_id)}`}>
                        Graph
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No entities ranked yet.</div>
          )
        )}
      </div>
    </>
  );
}
