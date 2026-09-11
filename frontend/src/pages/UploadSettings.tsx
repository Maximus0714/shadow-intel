import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, UploadSimple } from "@phosphor-icons/react";
import { useWorkspace } from "../lib/state/workspace";
import { postWorkspace } from "../lib/data/server";
import type { CleanedEdge, SkippedRow } from "../lib/data/upload";
import { PageHeader, Empty } from "../components/UI";
import PreviewTable from "../components/PreviewTable";
import AnalysisLocation from "../components/AnalysisLocation";

type Narrative = {records:CleanedEdge[];entities:{text:string;type:string}[];source_text:string;unresolved:{line:number;text:string;reason:string}[];warnings:string[]};
type Table = {rows:Record<string,unknown>[];columns:string[];mapping:Record<string,string|null>;sheet_names:string[];sheet:string|null};
type ResolutionCandidate = {candidate_id:string;entity_a:string;entity_b:string;entity_type:string;score:number;reasons:string[]};
type ResolutionScan = {candidates:ResolutionCandidate[];stats:{entities_scanned:number;candidates_found:number;automatic_merges:number}};
type ResolutionApplied = {records:CleanedEdge[];applied:number;aliases:{alias:string;canonical:string}[]};
const entityTypeOrder = ["Person", "Organization", "Vehicle", "Phone", "Account", "Location", "Email", "Amount", "Date"];
const roles = {source:"Source entity",target:"Target entity",rel:"Relationship type",weight:"Frequency / weight",date:"Date / timestamp",amount:"Amount",currency:"Currency"};
const example = "Asha Rao: I paid INR 12000 to Kabir Shah on 2026-09-01.\nKabir Shah drove vehicle MH12AB1234 on 2026-09-02.\nKabir Shah called Meera Sen.\nMeera Sen uses phone +91 98765 43210.\nMeera Sen has account ACCT92831.\nAsha Rao argued with Meera Sen.\nKabir Shah paid Asha Rao INR 500 on 2026-09-03.";
export default function UploadSettings() {
  const {importData,dataset,setMode} = useWorkspace();
  const navigate = useNavigate();
  const [kind,setKind] = useState<"text"|"data">("text");
  const [text,setText] = useState("");
  const [name,setName] = useState("Text investigation");
  const [file,setFile] = useState<File|null>(null);
  const [table,setTable] = useState<Table|null>(null);
  const [narrative,setNarrative] = useState<Narrative|null>(null);
  const [records,setRecords] = useState<CleanedEdge[]>([]);
  const [skipped,setSkipped] = useState<SkippedRow[]>([]);
  const [page,setPage] = useState(0);
  const [omitted,setOmitted] = useState<number[]>([]);
  const [candidates,setCandidates] = useState<ResolutionCandidate[]>([]);
  const [approved,setApproved] = useState<Record<string,string>>({});
  const [resolutionScanned,setResolutionScanned] = useState(false);
  const [reviewed,setReviewed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const ticket = useRef(0);
  const reset = () => {ticket.current++;setTable(null);setNarrative(null);setRecords([]);setSkipped([]);setOmitted([]);setCandidates([]);setApproved({});setResolutionScanned(false);setPage(0);setReviewed(false);setError("");};
  const acceptNarrative = (result:Narrative) => {setNarrative(result);setRecords(result.records);setText(result.source_text);setOmitted([]);setReviewed(false);};
  const scanResolution = async(nextRecords:CleanedEdge[], sourceText:string, evidenceName:string) => {
    if(!nextRecords.length){setCandidates([]);setResolutionScanned(true);return;}
    const result=await postWorkspace<ResolutionScan>("resolution/candidates",{records:nextRecords,name:evidenceName||"Uploaded evidence",source_text:sourceText});
    setCandidates(result.candidates);setApproved({});setResolutionScanned(true);
  };
  const upload = async(f:File, sheet="") => {
    reset();setFile(f);setName(f.name);setBusy(true);
    const id = ticket.current;
    try {
      if(f.size>20_000_000) throw new Error("File exceeds 20 MB.");
      const form = new FormData();form.append("file",f);form.append("kind",kind);form.append("sheet",sheet);
      if(kind==="text") {const r=await postWorkspace<Narrative>("file",form);if(id===ticket.current){acceptNarrative(r);await scanResolution(r.records,r.source_text,f.name);}}
      else {const r=await postWorkspace<Table>("file",form);if(id!==ticket.current)return;setTable(r);
        const preview=await postWorkspace<{cleaned:CleanedEdge[];skipped:SkippedRow[]}>("preview",{rows:r.rows,mapping:r.mapping});
        if(id===ticket.current){setRecords(preview.cleaned);setSkipped(preview.skipped);await scanResolution(preview.cleaned,"",f.name);}}
    }catch(e){if(id===ticket.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(id===ticket.current)setBusy(false);}
  };
  const extract = async() => {const source=text;const evidenceName=name;reset();setBusy(true);try{const result=await postWorkspace<Narrative>("narrative",{text:source});acceptNarrative(result);await scanResolution(result.records,result.source_text,evidenceName);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const remap = async(mapping:Table["mapping"]) => {
    if(!table)return;setTable({...table,mapping});setRecords([]);setReviewed(false);setBusy(true);setError("");
    try{const r=await postWorkspace<{cleaned:CleanedEdge[];skipped:SkippedRow[]}>("preview",{rows:table.rows,mapping});setRecords(r.cleaned);setSkipped(r.skipped);await scanResolution(r.cleaned,"",name);}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const toggleCandidate = (candidate:ResolutionCandidate, checked:boolean) => {
    setReviewed(false);
    setApproved(current=>{
      if(checked)return {...current,[candidate.candidate_id]:current[candidate.candidate_id]||([candidate.entity_a,candidate.entity_b].sort((a,b)=>b.length-a.length)[0])};
      const next={...current};delete next[candidate.candidate_id];return next;
    });
  };
  const build = async() => {setBusy(true);setError("");try{
    let finalRecords=records.filter((_,i)=>!omitted.includes(i));
    const approvals=Object.entries(approved).map(([candidate_id,keep])=>({candidate_id,keep}));
    if(approvals.length){const result=await postWorkspace<ResolutionApplied>("resolution/apply",{evidence:{records:finalRecords,name,source_text:narrative?.source_text||""},approvals});finalRecords=result.records;}
    await importData(finalRecords,name,undefined,narrative?.source_text);navigate("/overview");
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <>
    <PageHeader title="Start with the story." description="Turn transcripts, arguments, articles and records into an evidence-linked relationship graph." eyebrow="YOUR EVIDENCE"/>
    <AnalysisLocation/>
    {dataset&&<div className="inline-notice"><span>Saved investigation: {dataset.name}</span><button className="btn" onClick={()=>{setMode("local");navigate("/overview");}}>Resume investigation</button></div>}
    <div className="segmented evidence-tabs" aria-label="Evidence format">
      <button disabled={busy} className={kind==="text"?"active":""} onClick={()=>{reset();setKind("text");setFile(null);setName("Text investigation");}}><FileText size={17}/>Natural language</button>
      <button disabled={busy} className={kind==="data"?"active":""} onClick={()=>{reset();setKind("data");setFile(null);}}><UploadSimple size={17}/>Data file</button>
    </div>
    <section className="panel data-guide"><h2>What can X-Tracer process?</h2><p>English transcripts, statements, articles and text-based PDFs with explicit named connections. Track calls, messages, meetings, arguments, threats, payments, vehicle registrations, phones, accounts, employers and locations. Every extracted link keeps its source sentence.</p><p><strong>Files up to 20 MB.</strong> PDF, TXT, Markdown, SRT and VTT extraction supports up to 500,000 characters; PDFs may contain up to 300 pages. Graphs support up to 10,000 relationships and 2,000 entities. Audio and scanned image-only PDFs need transcription or OCR first. The extractor cannot reliably infer every relationship or resolve ambiguous pronouns.</p></section>
    {kind==="text"?<section className="panel narrative-input">
      <label className="field"><span>Investigation name</span><input value={name} maxLength={255} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
      <label className="field"><span>Transcript, argument, article or case note</span><textarea rows={12} maxLength={500000} value={text} disabled={busy} placeholder="Asha Rao paid INR 12000 to Kabir Shah on 2026-09-01. Kabir Shah drove vehicle MH12AB1234." onChange={e=>{reset();setText(e.target.value);}}/></label>
      <div className="source-footer"><span className="muted">{text.length.toLocaleString()} / 500,000 characters</span><button className="btn" disabled={busy} onClick={()=>{reset();setText(example);}}>Load example</button><button className="btn primary" disabled={busy||!text.trim()} onClick={extract}>{busy?"Processing…":"Extract relationships"}<ArrowRight size={17}/></button></div>
      <label className="field"><span>Or upload a document (PDF, TXT, MD, SRT, VTT)</span><input type="file" aria-label="Choose narrative evidence file" accept=".pdf,.txt,.md,.srt,.vtt,application/pdf" disabled={busy} onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);}}/></label>
    </section>:<section className="panel narrative-input"><h2>Upload relationship records</h2><p>CSV, XLSX or JSON with source and target columns. Optional dates, amounts, currency and other columns are preserved in the source records. Convert legacy XLS to XLSX first.</p><input type="file" aria-label="Choose evidence file" accept=".csv,.xlsx,.json" disabled={busy} onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);}}/>{busy&&<p role="status">Processing on the server…</p>}</section>}
    {error&&<div className="inline-notice warning" role="alert">{error}</div>}
    {table&&<section className="panel mapping-panel"><h2>Map your columns</h2>{table.sheet_names.length>1&&<label className="field"><span>Worksheet</span><select disabled={busy} value={table.sheet||""} onChange={e=>file&&void upload(file,e.target.value)}>{table.sheet_names.map(s=><option key={s}>{s}</option>)}</select></label>}<div className="mapping-grid">{Object.entries(roles).map(([key,label])=><label className="field" key={key}><span>{label}</span><select disabled={busy} value={table.mapping[key]||""} onChange={e=>void remap({...table.mapping,[key]:e.target.value||null})}><option value="">Not included</option>{table.columns.map(c=><option key={c}>{c}</option>)}</select></label>)}</div></section>}
    {(narrative||table)&&<section className="panel mapping-panel"><h2>Review the evidence</h2><p>{records.length-omitted.length} usable relationships. Review names, direction, dates and amounts before building the graph.</p>
      {narrative?<><div className="table-scroll"><table className="data"><thead><tr><th>Include</th><th>Connection</th><th>Frequency</th><th>Payment / date</th><th>Source</th></tr></thead><tbody>{records.slice(page*50,(page+1)*50).map((r,offset)=>{const i=page*50+offset;return <tr key={i}><td><input type="checkbox" aria-label={`Include relationship ${i+1}`} checked={!omitted.includes(i)} onChange={()=>{setReviewed(false);setOmitted(v=>v.includes(i)?v.filter(n=>n!==i):[...v,i]);}}/></td><td>{r.src} → {r.dst}<small className="evidence-type">{r.rel.replace(/_/g," ")}</small></td><td><strong>{r.frequency}×</strong>{r.frequency>=5&&<small className="evidence-type">Review threshold</small>}</td><td>{r.currency} {r.amount}<small className="evidence-type">{r.date||"Date not supplied"}</small></td><td>{r.evidence}</td></tr>;})}</tbody></table></div>{records.length>50&&<div className="source-footer"><button className="btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous candidates</button><span>Page {page+1} of {Math.ceil(records.length/50)}</span><button className="btn" disabled={(page+1)*50>=records.length} onClick={()=>setPage(p=>p+1)}>Next candidates</button></div>}
      <details><summary>Unlinked text and extracted identifiers ({narrative.unresolved.length} statements)</summary><p className="helper">These are grouped mentions retained from the source. They are not automatically relationships.</p><div className="entity-groups">{entityTypeOrder.map(type=>{const items=narrative.entities.filter(e=>e.type===type);return items.length?<div className="entity-group" key={type}><strong>{type}</strong><div className="entity-chips">{items.map(e=><span className="tag" key={`${e.type}:${e.text}`}>{e.text}</span>)}</div></div>:null})}</div>{narrative.unresolved.slice(0,100).map((s,i)=><p key={i}><strong>Line {s.line}:</strong> {s.text}<small className="evidence-type">{s.reason}</small></p>)}</details>{narrative.warnings.map(w=><p className="helper" key={w}>{w}</p>)}</>:<PreviewTable columns={table?.columns||[]} rows={records} skipped={skipped}/>}
      {resolutionScanned&&<div className="resolution-review"><div className="resolution-heading"><div><span className="eyebrow">IDENTITY CHECK</span><h3>Possible duplicate entities</h3></div><span className="tag">{candidates.length} candidate{candidates.length===1?"":"s"}</span></div>
        {!candidates.length?<p className="helper">No likely duplicate identities were found. Nothing was merged automatically.</p>:<><p className="helper">Approve only identities that refer to the same real person or identifier. Unchecked suggestions stay separate.</p><div className="resolution-list">{candidates.map(candidate=>{const selected=approved[candidate.candidate_id];return <article className={`resolution-candidate ${selected?"selected":""}`} key={candidate.candidate_id}><label className="resolution-choice"><input type="checkbox" checked={Boolean(selected)} onChange={event=>toggleCandidate(candidate,event.target.checked)}/><span><strong>{candidate.entity_a}</strong><span className="resolution-arrow">↔</span><strong>{candidate.entity_b}</strong><small>{candidate.entity_type} · {Math.round(candidate.score*100)}% match · {candidate.reasons.join(" · ")}</small></span></label>{selected&&<label className="field resolution-keep"><span>Keep this name</span><select value={selected} onChange={event=>{setReviewed(false);setApproved(current=>({...current,[candidate.candidate_id]:event.target.value}));}}><option value={candidate.entity_a}>{candidate.entity_a}</option><option value={candidate.entity_b}>{candidate.entity_b}</option></select></label>}</article>;})}</div></>}
      </div>}
      {!records.length?<Empty body="No supported explicit connections found. Try named statements such as Asha Rao called Kabir Shah, or upload mapped relationship rows."/>:<><label className="checkbox-label review-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I’ve reviewed the mapping and cleaned records.</label><button className="btn primary" disabled={busy||!reviewed||!name.trim()||omitted.length===records.length} onClick={build}>{busy?"Analyzing on server…":"Build network"}<ArrowRight size={17}/></button></>}
    </section>}
  </>;
}
