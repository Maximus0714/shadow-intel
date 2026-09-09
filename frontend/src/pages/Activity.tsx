import { useEffect, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { Empty, Loading, PageHeader } from "../components/UI";
import { supabase, useAuth } from "../lib/auth";
import { readable } from "../lib/state/workspace";
type Event = { id: number; action: string; detail: Record<string, unknown>; created_at: string };
export default function Activity() {
  const { user } = useAuth(); const [events, setEvents] = useState<Event[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { if (!user || !supabase) { setLoading(false); return; } supabase.from("audit_events").select("id,action,detail,created_at").order("created_at", { ascending: false }).limit(100).then(({ data }) => { setEvents((data || []) as Event[]); setLoading(false); }); }, [user?.id]);
  return <><PageHeader title="Account activity" description="A timestamped record of analysis, review, and reopening actions for your account." eyebrow="AUDIT LOG" />{loading ? <Loading /> : events.length ? <div className="timeline-list">{events.map((event) => <article className="timeline-row" key={event.id}><div className="timeline-marker"><ClockCounterClockwise size={18} /></div><time>{new Date(event.created_at).toLocaleString()}</time><div><h2>{readable(event.action)}</h2><p className="muted">{Object.entries(event.detail || {}).map(([key, value]) => `${readable(key)}: ${String(value)}`).join(" · ")}</p></div></article>)}</div> : <Empty title="No cloud activity yet" body="Apply the Supabase migration, then analyze evidence or review a signal to populate this audit log." />}</>;
}
