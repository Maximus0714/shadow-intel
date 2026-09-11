import { useMemo, useState } from "react";
import { ArrowRight, Fingerprint, GitDiff, CheckCircle, MagnifyingGlass } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { PageHeader, Empty } from "../components/UI";
import { useAuth } from "../lib/auth";
import { useWorkspace } from "../lib/state/workspace";
import { compareEvidence, readFingerprints, type SavedFingerprint } from "../lib/data/proofs";
import { demoGraph } from "../lib/data/demo";
import { postWorkspace } from "../lib/data/server";

interface LookupResult {status:"found"|"not_found"|"unavailable";message:string;digest?:string;transaction_hash?:string;block_hash?:string;block_number?:number;chain_id?:number;local_name?:string}

export default function Fingerprints() {
  const { user } = useAuth();
  const { mode, dataset } = useWorkspace();
  const [selected, setSelected] = useState<SavedFingerprint | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const saved = useMemo(() => user ? readFingerprints(user.id) : [], [user, refresh]);
  const current = mode === "demo" ? {name: "Fictional demonstration", records: demoGraph.edges as unknown as Record<string, unknown>[], source_text: ""} : dataset ? {name: dataset.name, records: dataset.records as unknown as Record<string, unknown>[], source_text: dataset.source_document?.source_text || ""} : null;
  const comparison = selected && current ? compareEvidence(current.records, selected.evidence.records) : null;
  const search = async () => {
    const value=query.trim();if(!value)return;
    setSearching(true);setSearchError("");setLookup(null);
    try{
      const local=saved.find(item=>item.receipt.transaction_hash.toLowerCase()===value.toLowerCase()||item.receipt.digest.toLowerCase()===value.toLowerCase()||item.name.toLowerCase()===value.toLowerCase());
      const chainKey=local?.receipt.transaction_hash||value;
      if(!/^(?:0x)?[0-9a-f]{64}$/i.test(chainKey))throw new Error("Enter a full transaction hash, evidence fingerprint, or the exact name of a saved case.");
      const result=await postWorkspace<LookupResult>("proof/lookup",{key:chainKey});
      if(local){setSelected(local);result.local_name=local.name;}
      setLookup(result);
    }catch(error){setSearchError(error instanceof Error?error.message:String(error));}
    finally{setSearching(false);}
  };
  return <>
    <PageHeader eyebrow="PROFILE · SAVED FINGERPRINTS" title="Check what changed."
      description="Compare the current investigation with an evidence copy you sealed earlier." />
    <section className="panel blockchain-search"><div><span className="overline">BLOCKCHAIN CASE LOOKUP</span><h2>Find a sealed case</h2><p>Enter its transaction hash, evidence fingerprint, or exact saved case name. The blockchain can confirm the seal; private case data opens only if its saved copy exists for this account on this device.</p></div><div className="blockchain-search-form"><label className="field"><span>Case key</span><input value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void search();}} placeholder="0x transaction hash or 64-character fingerprint" /></label><button className="btn primary" disabled={searching||!query.trim()} onClick={()=>void search()}><MagnifyingGlass size={17}/>{searching?"Searching…":"Search chain"}</button></div>{searchError&&<p role="alert" className="error-copy">{searchError}</p>}{lookup&&<div role="status" className={`proof-result ${lookup.status==="found"?"verified":"unavailable"}`}><strong>{lookup.status==="found"?"Seal found":"No usable seal found"}</strong><p>{lookup.message}{lookup.local_name?` Saved case “${lookup.local_name}” is available below.`:" The blockchain stores no private case contents."}</p>{lookup.transaction_hash&&<dl className="lookup-receipt"><dt>Case key</dt><dd>{lookup.transaction_hash}</dd><dt>Fingerprint</dt><dd>{lookup.digest}</dd><dt>Block</dt><dd>{lookup.block_number} · Chain {lookup.chain_id}</dd></dl>}</div>}</section>
    {!saved.length ? <Empty title="No saved fingerprints yet" body="Seal an investigation from AI & Evidence Proof. Each receipt will appear here for later comparison." action={<Link className="btn primary" to="/intelligence">Open AI & Evidence Proof <ArrowRight size={16} /></Link>} /> : <div className="fingerprint-layout">
      <section className="fingerprint-list" aria-label="Saved fingerprints">{saved.map(item => <button className={`panel fingerprint-card ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => {setSelected(item);setRefresh(value => value + 1);}}><span className="fingerprint-icon"><Fingerprint size={22} /></span><span className="fingerprint-copy"><strong>{item.name}</strong><small>{new Date(item.saved_at).toLocaleString()} · {item.records} records</small><code>{item.receipt.digest.slice(0, 18)}…</code></span><ArrowRight size={18} /></button>)}</section>
      {selected && current ? <section className="panel fingerprint-compare"><div className="panel-header"><div><span className="overline">COMPARING CURRENT COPY</span><h2>{selected.name}</h2></div><span className="tag"><CheckCircle size={14} /> Block {selected.receipt.block_number}</span></div><p className="helper">The receipt remains unchanged. This comparison only reads local copies and does not create a new blockchain transaction.</p><div className="compare-summary"><div><strong>{comparison!.added.length}</strong><span>Added</span></div><div><strong>{comparison!.removed.length}</strong><span>Removed</span></div><div><strong>{comparison!.changed.length}</strong><span>Frequency changes</span></div><div><strong>{comparison!.unchanged}</strong><span>Unchanged</span></div></div><ChangeList title="Added in current data" rows={comparison!.added} tone="added"/><ChangeList title="Removed from current data" rows={comparison!.removed} tone="removed"/>{comparison!.changed.length>0&&<div className="change-section"><h3>Frequency changes</h3>{comparison!.changed.map(change=><p key={`${String(change.after.src)}-${String(change.after.dst)}-${String(change.after.rel)}`}><strong>{String(change.after.src)} → {String(change.after.dst)}</strong> · {String(change.after.rel)}: {String(change.before.frequency || 1)} → {String(change.after.frequency || 1)}</p>)}</div>}<div className="change-section"><h3>Source text</h3><p>{selected.evidence.source_text === current.source_text ? "Unchanged" : "Changed since this receipt was saved."}</p></div><details className="sealed-case-records"><summary>Inspect sealed case records ({selected.records})</summary>{selected.evidence.records.slice(0,50).map((row,index)=><p key={index}><strong>{String(row.src)} → {String(row.dst)}</strong> · {String(row.rel).replace(/_/g," ")} · {String(row.frequency||1)}×</p>)}</details></section> : selected ? <section className="panel fingerprint-compare"><span className="overline">SEALED CASE FOUND</span><h2>{selected.name}</h2><p>{selected.records} records · block {selected.receipt.block_number}</p><p className="helper">Upload or open a current investigation to compare it with this sealed copy.</p><details className="sealed-case-records"><summary>Inspect sealed case records</summary>{selected.evidence.records.slice(0,50).map((row,index)=><p key={index}><strong>{String(row.src)} → {String(row.dst)}</strong> · {String(row.rel).replace(/_/g," ")}</p>)}</details></section> : <div className="panel fingerprint-empty"><GitDiff size={30}/><h2>Choose a saved fingerprint</h2><p>Select a receipt to compare it with the current investigation.</p></div>}
    </div>}
  </>;
}

function ChangeList({title, rows, tone}: {title: string; rows: Record<string, unknown>[]; tone: string}) {
  return <div className={`change-section ${tone}`}><h3>{title}</h3>{rows.length ? rows.slice(0, 30).map((row, i) => <p key={`${String(row.src)}-${String(row.dst)}-${i}`}><strong>{String(row.src)} → {String(row.dst)}</strong> · {String(row.rel)} · frequency {String(row.frequency || 1)}</p>) : <p className="helper">None</p>}</div>;
}
