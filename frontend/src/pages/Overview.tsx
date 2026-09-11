import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Graph,
  UsersThree,
  ShieldWarning,
  SquaresFour,
  UploadSimple,
} from "@phosphor-icons/react";
import { getStats, getKeyPlayers, getAlerts, getCommunities } from "../lib/data/api";
import {
  useWorkspace,
  useData,
  samplePlayers,
  sampleAlerts,
  sampleCommunities,
} from "../lib/state/workspace";
import { demoGraph } from "../lib/data/demo";
import { ANALYSIS_VERSION } from "../lib/analysis/local";
import { formatInfluence } from "../lib/data/entityOrder";
import {
  PageHeader,
  Reveal,
  Loading,
  ErrorState,
  Empty,
} from "../components/UI";
export default function Overview() {
  const { mode, dataset, setMode } = useWorkspace();
  const state = useData(
    "overview",
    async (c) => {
      const [stats, players, alerts, communities] = await Promise.all([
        getStats(c),
        getKeyPlayers(c, 5),
        getAlerts(c),
        getCommunities(c),
      ]);
      return {
        stats,
        players: players.players,
        alerts: alerts.flags,
        communities: communities.communities,
      };
    },
    {
      stats: { nodes: demoGraph.total_nodes, edges: demoGraph.total_edges },
      players: samplePlayers.slice(0, 5),
      alerts: sampleAlerts,
      communities: sampleCommunities,
    },
  );
  const { data } = state;
  return (
    <>
      <PageHeader
        title="Investigation overview"
        description={
          mode === "demo"
            ? "Explore the tools using fictional investigation data."
            : "Review your evidence, connections and signals."
        }
      >
        <Link className="btn primary" to="/upload">
          <UploadSimple size={18} />
          Upload evidence
        </Link>
      </PageHeader>
      {mode === 'demo' && dataset && <div className="inline-notice"><span>Your dataset, {dataset.name}, is saved on this device.</span><button className="btn" onClick={()=>setMode('local')}>Resume my data</button></div>}
      {mode !== "demo" && dataset?.analysis_version !== ANALYSIS_VERSION && <div className="inline-notice"><span>This saved result uses older calculations. Reanalyze it to get consistent on-device and backend results.</span><Link className="btn" to="/upload">Update analysis</Link></div>}
      {mode === 'local' && dataset && <details className="panel data-guide"><summary>Analysis methods & data coverage</summary>{dataset.notes.map(note=><p key={note}>{note}</p>)}<p>Dataset: {dataset.name}. Imported {new Date(dataset.created).toLocaleString()}. Dates and amounts are preserved in entity dossiers and the JSON report.</p></details>}
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.retry} />
      ) : (
        data && (
          <>
            <div className="metric-grid">
              {[
                {
                  label: "Entities",
                  value: data.stats.nodes,
                  icon: UsersThree,
                  to: "/entities",
                  sub: "People, places & assets",
                },
                {
                  label: "Connections",
                  value: data.stats.edges,
                  icon: Graph,
                  to: "/network",
                  sub: "Relationships to explore",
                },
                {
                  label: "Patterns flagged",
                  value: data.alerts.length,
                  icon: ShieldWarning,
                  to: "/alerts",
                  sub: "Leads for human review",
                },
                {
                  label: "Communities",
                  value: data.communities.length,
                  icon: SquaresFour,
                  to: "/communities",
                  sub: "Connected groups",
                },
              ].map((m, i) => (
                <Reveal key={m.label} delay={i * 0.04}>
                  <Link to={m.to} className="metric-card">
                    <div>
                      <span>{m.label}</span>
                      <m.icon size={19} />
                    </div>
                    <strong>{m.value.toLocaleString()}</strong>
                    <small>
                      {m.sub}
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                </Reveal>
              ))}
            </div>
            <div className="overview-columns">
              <section className="panel">
                <div className="panel-header">
                  <h2>Entities to explore</h2>
                  <Link className="text-link" to="/entities">
                    View all <ArrowUpRight size={15} />
                  </Link>
                </div>
                {data.players.length ? (
                  data.players.slice(0, 5).map((p) => (
                    <Link
                      className="entity-row"
                      key={p.person_id}
                      to={`/entities/${encodeURIComponent(p.person_id)}`}
                    >
                      <span className="entity-avatar">
                        {p.name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.role}
                        </small>
                      </span>
                      <span className="row-score">
                        {formatInfluence(p.influence_score)}
                        <small>influence</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </Link>
                  ))
                ) : (
                  <Empty body="Import relationships to start ranking entities." />
                )}
              </section>
              <section className="panel">
                <div className="panel-header">
                  <h2>Patterns worth reviewing</h2>
                  <Link className="text-link" to="/alerts">
                    View all <ArrowUpRight size={15} />
                  </Link>
                </div>
                {data.alerts.slice(0, 3).map((a, i) => (
                  <Link className="alert-preview" key={i} to="/alerts">
                    <span
                      className={`severity-label ${a.severity_score >= 0.7 ? "high" : "medium"}`}
                    >
                      {a.severity_score >= 0.7 ? "High" : "Review"}
                    </span>
                    <h3>{a.pattern_type.replace(/_/g, " ")}</h3>
                    <p>{a.plain_language_explanation}</p>
                  </Link>
                ))}
                {!data.alerts.length && (
                  <Empty
                    title="No patterns flagged"
                    body="New alerts will appear here when the data supports them."
                  />
                )}
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
