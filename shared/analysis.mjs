import { compare, rounded, metrics } from "./metrics.mjs";
export const ANALYSIS_VERSION = "3.1.0";
const supported = new Set(["CALLED", "EMAILED", "CONTACTED", "ASSOCIATE_OF", "FINANCIAL_TRANSFER", "FAMILY_OF", "CO_LOCATED", "OWNS_VEHICLE", "REGISTERED_AT", "USED_VEHICLE", "HAS_PHONE", "HAS_ACCOUNT", "VISITED", "WORKS_FOR", "ARGUED_WITH", "THREATENED"]);
const relationshipAliases = new Map([
  ["PAID", "FINANCIAL_TRANSFER"], ["PAYMENT", "FINANCIAL_TRANSFER"],
  ["TRANSFERRED", "FINANCIAL_TRANSFER"], ["TRANSFER", "FINANCIAL_TRANSFER"],
  ["CALLED_BY", "CALLED"], ["CALL", "CALLED"],
  ["EMAIL", "EMAILED"], ["E-MAILED", "EMAILED"],
  ["COLOCATED", "CO_LOCATED"], ["CO-LOCATED", "CO_LOCATED"],
  ["FAMILY", "FAMILY_OF"], ["OWNS", "OWNS_VEHICLE"],
  ["KNOWS", "ASSOCIATE_OF"], ["LEADS", "ASSOCIATE_OF"],
]);
export function normalizeRelationship(value) {
  const key = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return relationshipAliases.get(key) || key;
}

export function buildDataset(input, name) {
  if (!Array.isArray(input) || !input.length || input.length > 10000) throw new Error("Use 1–10,000 relationships per investigation.");
  if (typeof name !== "string" || !name.trim() || name.length > 255) throw new Error("Use a dataset name of 1–255 characters.");
  const records = input.map(r => {
    if (typeof r.src !== "string" || typeof r.dst !== "string" || !r.src.trim() || !r.dst.trim() || r.src.length > 200 || r.dst.length > 200) throw new Error("Entity IDs must contain 1–200 characters.");
    const rel = normalizeRelationship(r.rel);
    if (!supported.has(rel)) throw new Error(`Unsupported relationship type: ${r.rel}.`);
    if (!Number.isSafeInteger(r.frequency) || r.frequency < 1 || r.frequency > 1000000) throw new Error("Relationship frequency must be an integer from 1 to 1,000,000.");
    if (typeof r.date !== "string" || typeof r.amount !== "string" || r.date.length > 64 || r.amount.length > 64) throw new Error("Date and amount fields must be text of at most 64 characters.");
    if (r.source_rows && (!Array.isArray(r.source_rows) || r.source_rows.length > 10000 || r.source_rows.some(n => !Number.isSafeInteger(n) || n < 1))) throw new Error("Invalid source row references.");
    return {src: r.src.trim(), dst: r.dst.trim(), rel, frequency: r.frequency, date: r.date, amount: r.amount, source_rows: [...(r.source_rows || [])].sort((a,b)=>a-b), evidence:r.evidence||"", currency:r.currency||"", attributes:r.attributes||{}, src_type:r.src_type||"Person", dst_type:r.dst_type||"Person"};
  }).sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b)));
  const ids = [...new Set(records.flatMap(r => [r.src, r.dst]))].sort(compare);
  if (ids.length > 2000) throw new Error("Use at most 2,000 entities per investigation.");
  const labels = new Map(ids.map(i => [i, "Person"])), explicit = new Map();
  for(const r of records) for(const [id,type] of [[r.src,r.src_type],[r.dst,r.dst_type]]) {
    if(type === "Person") continue;
    if(!["Vehicle","Location","Phone","Account","Organization","Email","Event"].includes(type)) throw new Error(`Unsupported entity type: ${type}`);
    if(explicit.has(id) && explicit.get(id)!==type) throw new Error(`Conflicting entity types for ${id}`);
    explicit.set(id,type); labels.set(id,type);
  }
  const assetTypes = {OWNS_VEHICLE:"Vehicle",USED_VEHICLE:"Vehicle",REGISTERED_AT:"Location",VISITED:"Location",HAS_PHONE:"Phone",HAS_ACCOUNT:"Account",WORKS_FOR:"Organization"};
  for (const r of records) if (assetTypes[r.rel]) {
    const type = assetTypes[r.rel];
    if (explicit.has(r.dst) && explicit.get(r.dst) !== type) throw new Error(`Conflicting entity types for ${r.dst}. Use distinct IDs for vehicles and locations.`);
    explicit.set(r.dst, type); labels.set(r.dst, type);
  }
  const people = ids.filter(i => labels.get(i) === "Person"), index = new Map(people.map((i,n)=>[i,n]));
  const adj = people.map(()=>new Map()), neighbors = new Map(ids.map(i=>[i,new Set()]));
  for (const r of records) {
    if (r.src === r.dst) continue;
    neighbors.get(r.src).add(r.dst); neighbors.get(r.dst).add(r.src);
    if (index.has(r.src) && index.has(r.dst)) {
      const a=index.get(r.src), b=index.get(r.dst);
      adj[a].set(b,(adj[a].get(b)||0)+r.frequency); adj[b].set(a,(adj[b].get(a)||0)+r.frequency);
    }
  }
  const m = metrics(adj);
  const players = people.map((id,i)=>({person_id:id,name:id,community_id:m.groups[i],role:"member",
    influence_score:rounded(0.3*m.degree[i]+0.4*m.betweenness[i]+0.3*m.pagerank[i]),
    centrality_breakdown:{degree:rounded(m.degree[i]),betweenness:rounded(m.betweenness[i]),pagerank:rounded(m.pagerank[i]),
      weighted_connections:[...adj[i].values()].reduce((s,w)=>s+w,0),weights:{degree:0.3,betweenness:0.4,pagerank:0.3}}}))
    .sort((a,b)=>b.influence_score-a.influence_score||compare(a.person_id,b.person_id));
  const communities = [...new Set(m.groups)].sort((a,b)=>a-b).map(c=>{
    const members=players.filter(p=>p.community_id===c);
    for(const p of members) p.role = p === members[0] ? "leader" : [...adj[index.get(p.person_id)].keys()].some(j=>m.groups[j]!==c) ? "bridge" : "member";
    return {community_id:c,size:members.length,leader:members[0]?.person_id,members:members.map(p=>({person_id:p.person_id,name:p.name,role:p.role,influence_score:p.influence_score}))};
  });
  const rank=new Map(players.map(p=>[p.person_id,p]));
  const nodes=ids.map(id=>({id,name:id,label:labels.get(id),role:rank.get(id)?.role??null,community_id:rank.get(id)?.community_id??null,influence_score:rank.get(id)?.influence_score??null}));
  const details=Object.create(null);
  for(const n of nodes) {
    const relevant=records.filter(r=>r.src===n.id||r.dst===n.id);
    details[n.id]={...n,source:name,degree:neighbors.get(n.id).size,in_degree:relevant.filter(r=>r.dst===n.id).length,out_degree:relevant.filter(r=>r.src===n.id).length,
      neighbours_sample:[...neighbors.get(n.id)].sort(compare).slice(0,20),properties:{analysis:rank.get(n.id)?.centrality_breakdown??null,records:relevant,payment_history:relevant.filter(r=>r.rel==="FINANCIAL_TRANSFER").sort((a,b)=>compare(a.date,b.date)),assets:relevant.filter(r=>assetTypes[r.rel]),role_note:"Structural role only; does not establish intent or guilt."}};
  }
  const alerts=[], notes=[
    `Analysis ${ANALYSIS_VERSION}: computed on the backend. Rankings and communities cover people only; assets remain in the graph and source records.`,
    "Exact weighted Brandes betweenness uses every person as a source; path distance is inverse interaction frequency. Degree and betweenness are normalized by network size. Self-links are retained as evidence and excluded from metrics.",
    "PageRank damping is 0.85, with an absolute L1 convergence tolerance of 1e-12. Influence = 0.30 × normalized degree + 0.40 × normalized betweenness + 0.30 × PageRank. Scores are relative to this dataset, not probabilities.",
    "Deterministic multilevel Louvain optimizes weighted modularity. Community IDs and score ties use sorted entity IDs. A leader is the highest-ranked person in a community; other people linked to another community are bridges. Communities are heuristic structural clusters, not verified organizations.",
  ];
  let omitted=0;
  const flag=(pattern_type,entities_involved,plain_language_explanation,evidence,severity_score)=>{
    if(alerts.length>=200){omitted++;return;}
    alerts.push({pattern_type,entities_involved,plain_language_explanation,evidence,severity_score,source_dataset:name});
  };
  // Aggregate directed ties while retaining the source records used by each rule.
  const ties=new Map(), locations=new Map(), financial=new Map(), financialRows=new Map(), assetLinks=new Map();
  for(const r of records){
    const key=JSON.stringify([r.src,r.dst,r.rel]);
    const tie=ties.get(key)||{src:r.src,dst:r.dst,rel:r.rel,frequency:0,records:[]}; tie.frequency+=r.frequency;tie.records.push(r);ties.set(key,tie);
    if(r.rel==="REGISTERED_AT"){if(!locations.has(r.dst))locations.set(r.dst,new Set());locations.get(r.dst).add(r.src);}
    if(r.rel==="FINANCIAL_TRANSFER"){
      if(!financial.has(r.src))financial.set(r.src,new Set());financial.get(r.src).add(r.dst);
      const pair=`${r.src}\u0000${r.dst}`;if(!financialRows.has(pair))financialRows.set(pair,[]);financialRows.get(pair).push(r);
    }
    if(["HAS_PHONE","HAS_ACCOUNT","OWNS_VEHICLE","USED_VEHICLE"].includes(r.rel) && labels.get(r.src)==="Person"){
      const asset=assetLinks.get(r.dst)||{people:new Set(),relationships:new Set()};asset.people.add(r.src);asset.relationships.add(r.rel);assetLinks.set(r.dst,asset);
    }
  }
  const values=[...ties.values()];
  const median=input=>{const sorted=[...input].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length?sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2:0;};
  const contactTypes=new Set(["CALLED","EMAILED","CONTACTED"]), contactTies=values.filter(r=>contactTypes.has(r.rel));
  const contactMedian=median(contactTies.map(r=>r.frequency)), contactMad=median(contactTies.map(r=>Math.abs(r.frequency-contactMedian)));
  const contactThreshold=Math.max(6,Math.ceil(contactMedian+3*Math.max(1,contactMad)));
  for(const r of contactTies){
    const enoughContext=contactTies.length>=3?r.frequency>=contactThreshold&&r.frequency>=Math.max(2,contactMedian*2):r.frequency>=10;
    if(enoughContext)flag("High-volume contact",[r.src,r.dst],"Contact volume is a strong outlier compared with other communication links in this case. Review the time window, whether counts were aggregated, and the underlying source records.",{relationship:r.rel,frequency:r.frequency,case_median:rounded(contactMedian),median_absolute_deviation:rounded(contactMad),review_threshold:contactThreshold,baseline_links:contactTies.length},Math.min(.78,.48+.04*Math.log2(Math.max(1,r.frequency/contactThreshold))));
  }
  for(const r of values.filter(r=>r.rel==="THREATENED" || r.rel==="ARGUED_WITH")){
    if(r.rel==="THREATENED" || r.frequency>=2)flag(r.rel==="THREATENED"?"Reported threat":"Repeated conflict reports",[r.src,r.dst],r.rel==="THREATENED"?"The source data contains an explicit threat report. Prioritize source verification, timing and safeguarding context; this flag does not determine intent or credibility.":"The same pair has multiple argument or conflict records. Review dates and original statements to determine whether these are separate incidents.",{relationship:r.rel,frequency:r.frequency,source_records:r.records.map(x=>({date:x.date,source_rows:x.source_rows,evidence:x.evidence})).slice(0,10)},r.rel==="THREATENED"?.74:.56);
  }
  for(const [asset,value] of assetLinks)if(value.people.size>=2){
    const people=[...value.people].sort(compare),rels=[...value.relationships].sort(compare),kind=labels.get(asset)||"identifier";
    flag(`Shared ${kind.toLowerCase()}`,people.concat(asset),`The same ${kind.toLowerCase()} is linked to multiple people. Check whether it is genuinely shared, reassigned, jointly used, or the result of an identity-resolution error.`,{asset,people,relationships:rels},kind==="Account"?.68:kind==="Phone"?.64:.55);
  }
  for(const [place,owners] of locations) if(owners.size>=3) flag("Address concentration",[place,...[...owners].sort(compare)],"Three or more people are registered at the same location. This can be legitimate; compare dates, household context and source provenance before treating it as an investigative lead.",{location:place,people:[...owners].sort(compare),minimum_people:3},0.42);
  const tieByKey=new Map(values.map(r=>[JSON.stringify([r.src,r.dst,r.rel]),r]));
  for(const r of values)if(compare(r.src,r.dst)<0 && ["CALLED","EMAILED","CONTACTED","FINANCIAL_TRANSFER"].includes(r.rel)){
    const reverse=tieByKey.get(JSON.stringify([r.dst,r.src,r.rel]));if(!reverse)continue;
    const combined=r.frequency+reverse.frequency;
    if(r.rel==="FINANCIAL_TRANSFER" || combined>=6)flag(r.rel==="FINANCIAL_TRANSFER"?"Two-way fund movement":"Two-way communication",[r.src,r.dst],r.rel==="FINANCIAL_TRANSFER"?"Funds are recorded moving in both directions between the same pair. Compare dates, amounts, refunds and business context before interpreting the movement.":"Communication records run in both directions with enough combined volume to warrant timeline review.",{relationship:r.rel,forward_frequency:r.frequency,reverse_frequency:reverse.frequency,combined_frequency:combined},r.rel==="FINANCIAL_TRANSFER"?.61:.47);
  }
  for(const r of values)if(["CALLED","EMAILED","CONTACTED","FINANCIAL_TRANSFER"].includes(r.rel)){
    const from=rank.get(r.src),to=rank.get(r.dst);
    if(from&&to&&from.community_id!==to.community_id&&r.frequency>=3)flag(r.rel==="FINANCIAL_TRANSFER"?"Cross-group financial activity":"Cross-group communication",[r.src,r.dst],`A ${r.rel==="FINANCIAL_TRANSFER"?"financial":"communication"} link connects two graph communities and has at least three recorded interactions. Communities are structural estimates, so confirm operational context.`,{relationship:r.rel,frequency:r.frequency,source_group:from.community_id,target_group:to.community_id},r.rel==="FINANCIAL_TRANSFER"?.59:.5);
  }
  let checks=0; const seen=new Set();
  cycles: for(const a of [...financial.keys()].sort(compare)) for(const b of [...financial.get(a)].sort(compare)) for(const c of [...(financial.get(b)||[])].sort(compare)){
    if(++checks>100000){notes.push("Circular-transfer search reached 100,000 checks; additional loops may exist.");break cycles;}
    if(a===b||b===c||a===c||!financial.get(c)?.has(a))continue;
    const rotations=[[a,b,c],[b,c,a],[c,a,b]].sort((x,y)=>compare(JSON.stringify(x),JSON.stringify(y))), cycle=rotations[0];
    const key=JSON.stringify(cycle);if(seen.has(key))continue;seen.add(key);
    const cycleRows=[[a,b],[b,c],[c,a]].flatMap(([x,y])=>financialRows.get(`${x}\u0000${y}`)||[]);
    const dated=cycleRows.map(r=>Date.parse(r.date)).filter(Number.isFinite), amounts=cycleRows.map(r=>({value:Number(String(r.amount).replace(/,/g,"")),currency:r.currency})).filter(x=>Number.isFinite(x.value)&&x.value>0&&x.currency);
    const rapid=dated.length>=3&&(Math.max(...dated)-Math.min(...dated))/86400000<=30;
    const currencies=new Set(amounts.map(x=>x.currency)), comparable=amounts.length>=3&&currencies.size===1&&Math.max(...amounts.map(x=>x.value))/Math.min(...amounts.map(x=>x.value))<=1.5;
    const repeated=cycleRows.reduce((sum,row)=>sum+row.frequency,0)>=6;
    if(rapid&&(comparable||repeated))flag("Time-linked transfer cycle",cycle,"Transfers form a directed loop within 30 days, supported by similar-value payments or repeated activity. Review transaction references, legitimate pass-through reasons and the complete chronology.",{cycle:[...cycle,cycle[0]],date_span_days:rounded((Math.max(...dated)-Math.min(...dated))/86400000),same_currency:currencies.size===1,similar_amounts:comparable,combined_frequency:cycleRows.reduce((sum,row)=>sum+row.frequency,0),source_records:cycleRows.map(r=>({date:r.date,amount:r.amount,currency:r.currency,source_rows:r.source_rows}))},0.76);
  }
  for(const [pair,payments] of financialRows)if(payments.length>=3){
    const amounts=payments.map(r=>Number(String(r.amount).replace(/,/g,""))),dates=payments.map(r=>Date.parse(r.date)),currencies=new Set(payments.map(r=>r.currency).filter(Boolean));
    const valid=amounts.every(value=>Number.isFinite(value)&&value>0)&&dates.every(Number.isFinite)&&currencies.size===1;
    const spread=valid?(Math.max(...amounts)-Math.min(...amounts))/median(amounts):Infinity,dateSpan=valid?(Math.max(...dates)-Math.min(...dates))/86400000:Infinity;
    if(valid&&spread<=.15&&dateSpan<=30){const [src,dst]=pair.split("\u0000");flag("Repeated similar-value payments",[src,dst],"At least three similarly valued payments are recorded between the same pair within 30 days. Review invoices, references and the reason for repetition.",{payment_count:payments.length,currency:[...currencies][0],minimum_amount:Math.min(...amounts),maximum_amount:Math.max(...amounts),date_span_days:rounded(dateSpan)},0.63);}
  }
  if(omitted)notes.push(`${omitted} additional pattern flags omitted by the 200-flag limit.`);
  notes.push("Pattern coverage uses robust contact baselines, explicit threat/conflict reports, shared identifiers, address concentration, same-type reciprocal flows, cross-community links, time-linked transfer cycles and repeated similar-value payments. Dates, amounts and source claims are not independently verified. Missing fields can prevent a pattern from being raised; every flag requires human review.");
  return {id:crypto.randomUUID(),name,created:new Date().toISOString(),analysis_version:ANALYSIS_VERSION,
    graph:{nodes,edges:records.map((r,i)=>({...r,id:`record-${i}`})),truncated:false,total_nodes:nodes.length,total_edges:records.length},
    players,communities,details,records,notes,alerts:alerts.sort((a,b)=>b.severity_score-a.severity_score||compare(a.pattern_type,b.pattern_type)||compare(JSON.stringify(a.entities_involved),JSON.stringify(b.entities_involved)))};
}
