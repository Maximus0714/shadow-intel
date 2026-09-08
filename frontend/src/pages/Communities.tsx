import { useState } from "react";
import { Link } from "react-router-dom";
import {
  UsersThree,
  ArrowUpRight,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { getCommunities } from "../lib/api";
import { sampleCommunities, useData } from "../lib/workspace";
import {
  PageHeader,
  Loading,
  ErrorState,
  Empty,
  Reveal,
} from "../components/UI";
export default function Communities() {
  const [q, setQ] = useState("");
  const state = useData("communities", getCommunities, {
    communities: sampleCommunities,
    total: sampleCommunities.length,
  });
  const shown =
    state.data?.communities.filter(
      (c) =>
        !q ||
        c.members.some((m) =>
          `${m.name} ${m.person_id}`.toLowerCase().includes(q.toLowerCase()),
        ),
    ) || [];
  return (
    <>
      <PageHeader
        title="Understand the groups within."
        description="Explore clusters of connected entities and the people who bring them together."
        eyebrow="COMMUNITIES"
      />
      <div className="search-field standalone">
        <MagnifyingGlass size={19} />
        <input
          aria-label="Find a community by member"
          placeholder="Find a community by member name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.retry} />
      ) : shown.length ? (
        <div className="community-grid">
          {shown.map((c, i) => (
            <Reveal
              className="panel community-card"
              key={c.community_id}
              delay={i * 0.04}
            >
              <div className="community-top">
                <span className="community-symbol">
                  <UsersThree size={30} weight="thin" />
                </span>
                <span className="tag">{c.size} members</span>
              </div>
              <h2>Group {c.community_id + 1}</h2>
              <p className="muted">
                {c.members.find((m) => m.person_id === c.leader)?.name ||
                  "No ranked leader"}
                {c.leader ? " has the highest influence in this group." : "."}
              </p>
              <div className="community-members">
                {c.members.slice(0, 5).map((m) => (
                  <Link
                    key={m.person_id}
                    to={`/entities/${encodeURIComponent(m.person_id)}`}
                  >
                    <span className="entity-avatar small">
                      {m.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      {m.name}
                      <small>{m.role}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </Link>
                ))}
              </div>
              {c.members.length > 5 && (
                <details>
                  <summary>View {c.members.length - 5} more members</summary>
                  {c.members.slice(5).map((m) => (
                    <Link
                      className="chip"
                      key={m.person_id}
                      to={`/entities/${encodeURIComponent(m.person_id)}`}
                    >
                      {m.name}
                    </Link>
                  ))}
                </details>
              )}
              <Link
                className="btn"
                to={`/network?focus=${encodeURIComponent(c.leader || c.members[0]?.person_id || "")}`}
              >
                Explore connections <ArrowUpRight size={17} />
              </Link>
            </Reveal>
          ))}
        </div>
      ) : (
        <Empty
          title="No communities found"
          body="Try another member or load a dataset with connected entities."
        />
      )}
      <p className="helper">
        Communities are structural clusters in the graph. Shared membership does
        not imply shared intent.
      </p>
    </>
  );
}
