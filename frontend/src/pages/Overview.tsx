import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Graph,
  UsersThree,
  ShieldWarning,
  SquaresFour,
  UploadSimple,
  FileText,
  BookmarkSimple,
  ArrowRight,
} from "@phosphor-icons/react";
import { getStats, getKeyPlayers, getAlerts, getCommunities } from "../lib/api";
import {
  useWorkspace,
  useData,
  samplePlayers,
  sampleAlerts,
  sampleCommunities,
} from "../lib/workspace";
import { demoGraph } from "../lib/demo";
import {
  PageHeader,
  Reveal,
  Loading,
  ErrorState,
  Empty,
} from "../components/UI";
export default function Overview() {
  const { mode, watched } = useWorkspace();
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
        title="A clearer view of your investigation."
        description={
          mode === "demo"
            ? "Welcome to Copper Ledger. Get to know the tools with a fictional investigation."
            : "Your evidence, connections and next steps, all in one place."
        }
        eyebrow="YOUR WORKSPACE"
      >
        <Link className="btn primary" to="/upload">
          <UploadSimple size={18} />
          Upload evidence
        </Link>
      </PageHeader>
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
            <Reveal className="workspace-spotlight">
              <div>
                <span className="overline">START WITH THE CONNECTIONS</span>
                <h2>
                  See what the records
                  <br />
                  can’t show on their own.
                </h2>
                <p>
                  Move through the network. Follow an entity, trace a path, or
                  uncover a group.
                </p>
                <Link className="btn primary" to="/network">
                  Open Network Explorer <ArrowRight size={17} />
                </Link>
              </div>
              <img
                src="/images/connections.webp"
                width="1536"
                height="1024"
                alt="Interconnected silver threads"
              />
            </Reveal>
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
                          {p.person_id} · {p.role}
                        </small>
                      </span>
                      <span className="row-score">
                        {p.influence_score.toFixed(2)}
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
      <section>
        <div className="section-title">
          <h2>Keep your investigation moving.</h2>
        </div>
        <div className="quick-actions">
          {[
            {
              icon: UploadSimple,
              title: "Bring in new data",
              body: "Preview and import relationships.",
              to: "/upload",
            },
            {
              icon: FileText,
              title: "Read between the lines",
              body: "Analyze a report or statement.",
              to: "/documents",
            },
            {
              icon: BookmarkSimple,
              title: "Build your case notes",
              body: `${watched.length} saved entities in your watchlist.`,
              to: "/reports",
            },
          ].map((x) => (
            <Link className="quick-action" to={x.to} key={x.title}>
              <x.icon size={24} weight="thin" />
              <div>
                <h3>{x.title}</h3>
                <p>{x.body}</p>
              </div>
              <ArrowUpRight size={18} />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
