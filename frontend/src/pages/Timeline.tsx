import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDots, ArrowRight } from "@phosphor-icons/react";
import { PageHeader, Empty, ErrorState, Loading } from "../components/UI";
import { postWorkspace } from "../lib/data/server";
import { useWorkspace } from "../lib/state/workspace";
import { demoGraph } from "../lib/data/demo";
import type { CleanedEdge } from "../lib/data/upload";

type TimelineEvent = CleanedEdge & {record:number;timestamp:string;precision:string;time_basis:string;date_issue:string;source_page:string};
type TimelineResult = {
  events:TimelineEvent[];undated:TimelineEvent[];
  overlaps:{date:string;time_basis:string;shared_entity:string;event_count:number;entities:string[];relationship_types:string[];records:number[]}[];
  dated_count:number;undated_count:number;method:string;
};
const readable = (value:string) => value.replace(/_/g," ").toLowerCase();
// Display the source/normalized clock exactly. Date-only values must never turn
// into local-midnight events or shift a day with the viewer's timezone.
const dateLabel = (value:string) => value.replace("T"," · ").replace("+00:00"," UTC");
export default function Timeline() {
  const {mode,dataset,revision} = useWorkspace();
  const [data,setData]=useState<TimelineResult|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const [query,setQuery]=useState("");
  const [relationship,setRelationship]=useState("all");
  const [view,setView]=useState<"dated"|"undated">("dated");
  const [page,setPage]=useState(0);
  const name=(id:string)=>mode==="demo"?demoGraph.nodes.find(n=>n.id===id)?.name||id:id;
  useEffect(()=>{
    let active=true;
    setLoading(true);setError("");setData(null);setPage(0);setQuery("");setRelationship("all");
    const evidence=mode==="demo"?{name:"Fictional demonstration",records:demoGraph.edges}:dataset?{name:dataset.name,records:dataset.records}:null;
    if(!evidence){setError("Upload evidence to build a timeline.");setLoading(false);return;}
    postWorkspace<TimelineResult>("timeline",evidence).then(result=>{if(active)setData(result);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"Timeline unavailable.");})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[mode,dataset?.id,dataset?.created,revision,retry]);
  useEffect(()=>setPage(0),[query,relationship,view]);
  const relationTypes=useMemo(()=>[...new Set([...(data?.events||[]),...(data?.undated||[])].map(event=>event.rel))].sort(),[data]);
  const filtered=(view==="dated"?data?.events:data?.undated)?.filter(event=>(relationship==="all"||event.rel===relationship)&&
    `${name(event.src)} ${name(event.dst)} ${event.src} ${event.dst} ${readable(event.rel)} ${event.evidence||""} ${event.date}`.toLowerCase().includes(query.trim().toLowerCase()))||[];
  return <>
    <PageHeader eyebrow="INVESTIGATION TIMELINE" title="See what happened, and when."
      description="Source dates, recorded actions and the evidence behind each event." />
    {loading?<Loading label="Building timeline"/>:error?<ErrorState message={error} retry={()=>setRetry(v=>v+1)}/>:data&&<>
      <div className="timeline-metrics">
        <div className="panel"><span>Dated records</span><strong>{data.dated_count}</strong></div>
        <div className="panel"><span>Shared-entity day clusters</span><strong>{data.overlaps.length}</strong></div>
        <div className="panel"><span>Dates needing review</span><strong>{data.undated_count}</strong></div>
      </div>
      <section className="panel timeline-controls">
        <label className="field"><span>Search timeline</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Entity, date, source wording…"/></label>
        <label className="field"><span>Relationship</span><select value={relationship} onChange={event=>setRelationship(event.target.value)}><option value="all">All relationships</option>{relationTypes.map(rel=><option value={rel} key={rel}>{readable(rel)}</option>)}</select></label>
      </section>
      <div className="segmented" aria-label="Timeline records">
        <button className={view==="dated"?"active":""} onClick={()=>setView("dated")}>Dated ({data.dated_count})</button>
        <button className={view==="undated"?"active":""} onClick={()=>setView("undated")}>Missing or unclear dates ({data.undated_count})</button>
      </div>
      {mode==="demo"&&<p className="helper">This demo graph has no supplied dates. Its source records are available under “Missing or unclear dates”.</p>}
      <div className="timeline-layout">
        <section className="timeline-stream" aria-label="Chronological evidence">
          {filtered.length?filtered.slice(page*50,(page+1)*50).map(event=><article className="panel timeline-event" key={event.record}>
            <div className="timeline-rail"><span>{event.record}</span></div>
            <div className="timeline-event-body"><div className="timeline-event-head">
              <time dateTime={event.timestamp||undefined}><CalendarDots size={16}/>{event.timestamp?dateLabel(event.timestamp):event.date||"Date not supplied"}</time><span className="tag">Record {event.record}</span></div>
              <p className="helper">{event.timestamp?(event.precision==="day"?"Date only · time not supplied":event.time_basis):event.date_issue}</p>
              <h2><Link to={`/entities/${encodeURIComponent(event.src)}`}>{name(event.src)}</Link><ArrowRight size={17}/><Link to={`/entities/${encodeURIComponent(event.dst)}`}>{name(event.dst)}</Link></h2>
              <p className="timeline-relation">{readable(event.rel)} · recorded frequency {event.frequency}{event.amount&&` · ${event.currency||"Currency unspecified"} ${event.amount}`}</p>
              <blockquote>{event.evidence||"Structured source record; no narrative excerpt supplied."}</blockquote>
              <small>{event.source_page&&`PDF page ${event.source_page} · `}Source rows: {event.source_rows?.join(", ")||"not supplied"}</small>
            </div>
          </article>):<Empty title="No matching evidence in this view" body="Try the other date tab, clear the filters, or provide dates in YYYY-MM-DD format."/>}
          {filtered.length>50&&<div className="source-footer"><button className="btn" disabled={page===0} onClick={()=>setPage(v=>v-1)}>Previous</button><span>Page {page+1} of {Math.ceil(filtered.length/50)}</span><button className="btn" disabled={(page+1)*50>=filtered.length} onClick={()=>setPage(v=>v+1)}>Next</button></div>}
        </section>
        <aside className="timeline-aside">
          <section className="panel"><span className="overline">WHOLE CASE · SAME-DAY REVIEW</span><h2>Shared entities across records</h2><p className="helper">Each cluster shares an entity and a date. It does not establish simultaneous activity or a meeting.</p>{data.overlaps.length?data.overlaps.slice(0,20).map(overlap=><div className="timeline-overlap" key={`${overlap.date}-${overlap.time_basis}-${overlap.shared_entity}`}><strong>{name(overlap.shared_entity)}</strong><span>{overlap.date} · {overlap.time_basis}</span><small>{overlap.event_count} records · {overlap.relationship_types.map(readable).join(" · ")}</small><small>Source records: {overlap.records.join(", ")}</small></div>):<p className="muted">No shared-entity day clusters found.</p>}{data.overlaps.length>20&&<p className="helper">Showing the first 20 of {data.overlaps.length} clusters.</p>}</section>
          <details className="panel"><summary>How dates are interpreted</summary><p>{data.method}</p><p>Ambiguous dates such as 03/08/2026 remain unresolved. Use YYYY-MM-DD to confirm the date.</p></details>
        </aside>
      </div>
    </>}
  </>;
}
