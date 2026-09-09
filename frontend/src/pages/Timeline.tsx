import { CalendarDots, ArrowUpRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Empty, PageHeader } from "../components/UI";
import { demoGraph } from "../lib/data/demo";
import { readable, useWorkspace } from "../lib/state/workspace";

export default function Timeline() {
  const { mode, dataset } = useWorkspace();
  const records = mode === "demo" ? demoGraph.edges : dataset?.records || [];
  const dated = records.flatMap((record) => record.date && Number.isFinite(Date.parse(record.date)) ? [{ ...record, date: record.date }] : []).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return <><PageHeader title="Follow events through time." description="Review dated relationships in sequence and compare bursts with known case events." eyebrow="EVENT TIMELINE" />{dated.length ? <div className="timeline-list">{dated.map((record, index) => <article className="timeline-row" key={`${record.src}-${record.dst}-${record.date}-${index}`}><div className="timeline-marker"><CalendarDots size={18} /></div><time>{new Date(record.date).toLocaleString()}</time><div><h2>{readable(record.rel)}</h2><p><Link to={`/entities/${encodeURIComponent(record.src)}`}>{record.src}</Link><ArrowUpRight size={13} /><Link to={`/entities/${encodeURIComponent(record.dst)}`}>{record.dst}</Link></p>{record.amount && <small>Amount: {record.amount}</small>}</div><span className="tag">{record.frequency} record{record.frequency === 1 ? "" : "s"}</span></article>)}</div> : <Empty title="No dated activity" body="Include a date or timestamp column in uploaded relationships to build an event timeline." action={<Link className="btn primary" to="/upload">Upload dated evidence</Link>} />}</>;
}
