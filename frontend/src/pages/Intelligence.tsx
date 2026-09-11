import { useState } from "react";
import { Link } from "react-router-dom";
import { Brain, Fingerprint, CheckCircle, DownloadSimple, ArrowRight } from "@phosphor-icons/react";
import { PageHeader } from "../components/UI";
import { useWorkspace, downloadFile } from "../lib/state/workspace";
import { useAuth } from "../lib/auth";
import { postWorkspace } from "../lib/data/server";
import { demoGraph } from "../lib/data/demo";
import { saveFingerprint } from "../lib/data/proofs";

interface Evidence { name: string; records: Record<string, unknown>[]; source_text: string }
interface Receipt { version: string; salt: string; digest: string; transaction_hash: string; block_hash: string; block_number: number; chain_id: number }
interface Verification { status: "verified" | "mismatch" | "unavailable"; message: string; simulated?: boolean }
interface Brief {
  model: string; status: string; summary: string; method: string; limitations: string;
  data_gaps: {label: string; count: number}[];
  findings: {entity_id: string; name: string; relative_percentile: number; outlier: boolean; observations: string[]; next_step: string;
    evidence: {record: number; src: string; dst: string; rel: string; source_rows: number[]; excerpt: string}[]}[];
}

export default function Intelligence() {
  const { mode, dataset } = useWorkspace();
  const { user } = useAuth();
  const scope = `${user?.id || "guest"}:${mode === "demo" ? "demo" : dataset?.id}:${dataset?.created}`;
  const evidence: Evidence | null = mode === "demo" ? {
    name: "Fictional demonstration", source_text: "",
    records: demoGraph.edges.map(e => ({...e,
      src_type: demoGraph.nodes.find(n => n.id === e.src)?.label || "Person",
      dst_type: demoGraph.nodes.find(n => n.id === e.dst)?.label || "Person"})),
  } : dataset ? {name: dataset.name, records: dataset.records as unknown as Record<string, unknown>[], source_text: dataset.source_document?.source_text || ""} : null;
  return <><PageHeader eyebrow="AI & EVIDENCE PROOF" title="Find what stands out. Verify what stays true."
    description="Review unusual activity, then seal the evidence behind your investigation." />
    {evidence ? <EvidenceTools key={scope} evidence={evidence} scope={scope} demo={mode === "demo"} userId={user?.id || "guest"} />
      : <div className="panel intelligence-panel"><h2>Start with evidence</h2><p>Add a narrative or relationship file to use these tools.</p><Link className="btn primary" to="/upload">Add data <ArrowRight /></Link></div>}</>;
}

function EvidenceTools({ evidence, scope, demo, userId }: {evidence: Evidence; scope: string; demo: boolean; userId: string}) {
  const displayName = (id: string) => demo ? demoGraph.nodes.find(n => n.id === id)?.name || id : id;
  const [tab, setTab] = useState<"ai" | "proof">("ai");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(() => {
    try { const saved = JSON.parse(localStorage.getItem(`xt-proof:${scope}`) || "null"); return saved?.transaction_hash ? saved : null; } catch { return null; }
  });
  const [verification, setVerification] = useState<Verification | null>(null);
  const [imported, setImported] = useState<Verification | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [storageNote, setStorageNote] = useState("");
  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed. Please retry."); }
    finally { setBusy(""); }
  }
  async function seal() {
    const result = await postWorkspace<Receipt>("proof/anchor", evidence);
    setReceipt(result); setVerification(null);
    try { localStorage.setItem(`xt-proof:${scope}`, JSON.stringify(result)); }
    catch { setStorageNote("Receipt could not be saved on this device. Download the proof bundle to keep it."); }
    try { saveFingerprint(userId, { id: `${scope}:${result.transaction_hash}`, name: evidence.name, saved_at: new Date().toISOString(), nodes: new Set(evidence.records.flatMap(row => [String(row.src || ""), String(row.dst || "")])).size, records: evidence.records.length, receipt: result, evidence }); }
    catch { setStorageNote("Receipt created, but the saved-fingerprint index could not be updated. Download the proof bundle to keep it."); }
  }
  async function check(simulate_tamper = false) {
    setVerification(null);
    setVerification(await postWorkspace<Verification>("proof/verify", {evidence, receipt, simulate_tamper}));
  }
  function exportBundle() {
    downloadFile("x-tracer-evidence-proof.json", JSON.stringify({format: "x-tracer-proof-bundle-v1", evidence, receipt,
      intelligence: brief, notice: "Receipt covers evidence only, not the AI briefing or truth of the source. Local Ethereum development chain."}, null, 2), "application/json");
  }
  return <div className="intelligence-page">
    <div className="intelligence-tabs" role="group" aria-label="Investigation tools">
      <button className={`btn ${tab === "ai" ? "primary" : ""}`} aria-pressed={tab === "ai"} onClick={() => setTab("ai")}><Brain /> AI brief</button>
      <button className={`btn ${tab === "proof" ? "primary" : ""}`} aria-pressed={tab === "proof"} onClick={() => setTab("proof")}><Fingerprint /> Evidence proof</button>
      <span className="helper">{demo ? "Fictional demo · " : ""}{evidence.records.length} source records</span>
    </div>
    {error && <p role="alert" className="error-copy">{error}</p>}
    {busy && <p role="status" className="helper">{busy}…</p>}
    {tab === "ai" ? <>
      <section className="panel intelligence-panel">
        <div className="intelligence-heading"><div><span className="eyebrow">CASE-LOCAL MACHINE LEARNING</span><h2>A second look at your network</h2></div><Brain size={36} aria-hidden="true" /></div>
        <p>{brief?.summary || "Compare contact diversity, interaction frequency, relationship types, payments, asset links and dated activity. The model learns from this case and surfaces unusual profiles for you to review."}</p>
        <button className="btn primary" disabled={!!busy} onClick={() => perform("Analyzing evidence", async () => setBrief(await postWorkspace<Brief>("intelligence", evidence)))}>{brief ? "Regenerate brief" : "Generate AI brief"} <ArrowRight /></button>
      </section>
      {brief && <div className="intelligence-results">
        <section aria-label="Unusual activity ranking">
          {brief.findings.length > 0 && <p className="helper">Percentile compares unusualness with other people in this case. It is not a risk or guilt probability.</p>}
          {brief.findings.map((f, i) => <article className="intelligence-finding" key={f.entity_id}>
            <div className="intelligence-heading"><h3><span className="mono">0{i + 1}</span> {displayName(f.name)}</h3><span className="tag">Percentile {f.relative_percentile}</span></div>
            <p className="helper">{f.outlier ? "Above the model’s outlier threshold" : "Relative ranking · below the model’s outlier threshold"}</p>
            <ul>{f.observations.map(o => <li key={o}>{o}</li>)}</ul>
            <details><summary>Inspect supporting records</summary>{f.evidence.map(e => <p key={e.record}><strong>Record {e.record}</strong> · {displayName(e.src)} → {displayName(e.dst)} · {e.rel.replace(/_/g, " ")}{e.source_rows.length > 0 && ` · source rows ${e.source_rows.join(", ")}`}<br />{e.excerpt}</p>)}<p className="helper">Showing up to three linked records; ranking uses all linked records.</p></details>
            <p className="helper">{f.next_step}</p>
          </article>)}
          {brief.status === "insufficient_data" && <p className="inline-notice">The case is too small or too uniform for a useful ML comparison. Add more evidence; no artificial scores have been generated.</p>}
        </section>
        <aside className="panel intelligence-panel"><h3>Before drawing conclusions</h3>{brief.data_gaps.map(g => <div className="intelligence-gap" key={g.label}><span>{g.label}</span><strong>{g.count}</strong></div>)}<details><summary>How this brief was made</summary><p>{brief.method}</p><p>The summary uses an evidence-based template. Feature comparisons are descriptive context, not causal model explanations.</p><p>{brief.limitations}</p></details></aside>
      </div>}
    </> : <section className="panel intelligence-panel">
      <div className="intelligence-heading"><div><span className="eyebrow">ETHEREUM · LOCAL DEVELOPMENT CHAIN</span><h2>A fingerprint for your evidence</h2></div><Fingerprint size={40} aria-hidden="true" /></div>
      <p>Nothing is sealed when this page opens, when analysis runs, or when the AI brief is generated. Press the button below to create one receipt for the current copy. Only a salted fingerprint goes on chain; the evidence stays off chain.</p>
      <ol className="proof-steps"><li><span>01</span> Choose a copy</li><li><span>02</span> Press seal</li><li><span>03</span> Verify later</li></ol>
      {!receipt && <><p className="helper">No blockchain receipt exists for this investigation on this device yet.</p><button className="btn primary" disabled={!!busy} onClick={() => perform("Sealing evidence", seal)}>Seal this copy on blockchain <ArrowRight /></button></>}
      {receipt && <>
        <div className="proof-receipt"><div className="intelligence-heading"><h3><CheckCircle /> Receipt created</h3><span className="tag">Block {receipt.block_number} · Chain {receipt.chain_id}</span></div>
          <dl><dt>Evidence SHA-256</dt><dd>{receipt.digest}</dd><dt>Case key / transaction hash</dt><dd>{receipt.transaction_hash}</dd><dt>Block hash</dt><dd>{receipt.block_hash}</dd></dl></div>
        <div className="intelligence-actions"><button className="btn primary" disabled={!!busy} onClick={() => perform("Verifying original evidence", () => check())}>Verify original</button>
          <button className="btn" disabled={!!busy} onClick={() => perform("Testing a changed copy", () => check(true))}>Test a changed copy</button>
          <button className="btn" disabled={!!busy} onClick={exportBundle}><DownloadSimple /> Download proof bundle</button></div>
        <p className="helper">The test changes one interaction count in a temporary server copy. Your investigation stays unchanged.</p>
        {verification && <div role="status" className={`proof-result ${verification.status}`}><strong>{verification.simulated ? "Changed-copy test: " : "Original evidence: "}{verification.status}</strong><p>{verification.message}</p></div>}
        {storageNote && <p role="status">{storageNote}</p>}
      </>}
      <div className="proof-import"><h3>Verify a downloaded bundle</h3><p className="helper">Choose an X-Tracer proof JSON file. Verification requires the same blockchain and does not replace your current investigation.</p>
        <input aria-label="Upload proof bundle" type="file" accept=".json,application/json" disabled={!!busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          setImported(null);
          void perform("Verifying proof bundle", async () => {
            if (file.size > 20_000_000) throw new Error("Proof bundles must be under 20 MB.");
            const bundle = JSON.parse(await file.text());
            if (bundle.format !== "x-tracer-proof-bundle-v1" || !bundle.evidence || !bundle.receipt) throw new Error("Choose a downloaded X-Tracer proof bundle.");
            setImported(await postWorkspace<Verification>("proof/verify", {evidence: bundle.evidence, receipt: bundle.receipt}));
          });
        }} />{imported && <div role="status" className={`proof-result ${imported.status}`}><strong>Uploaded bundle: {imported.status}</strong><p>{imported.message}</p></div>}<Link className="btn" to="/fingerprints"><Fingerprint size={17}/> Search sealed cases by key</Link></div>
      <details><summary>What this proof establishes</summary><p>It detects changes to the case name, ordered records and source text after sealing. It does not prove that the source is truthful, who collected it, or that AI conclusions are correct. Original file bytes and AI results are not sealed.</p><p>This is a single-node Ethereum development blockchain, not a public or multi-agency network. Its administrator can reset it. Receipts survive normal Docker restarts; deleting the chain volume removes the ledger. Downloaded bundles contain your evidence, so share them deliberately.</p>{receipt && <button className="btn" disabled={!!busy} onClick={() => perform("Sealing updated evidence", seal)}>Seal updated copy</button>}</details>
    </section>}
  </div>;
}
