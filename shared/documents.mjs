function analyzeLocalText(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Add document text first.");
  text = text.trim();
  if (text.length > 1e5)
    throw new Error("Use up to 100,000 characters per document.");
  const entities = /* @__PURE__ */ new Map();
  const add = (text2, type) => entities.set(type + ":" + text2, { text: text2, type });
  for (const m of text.matchAll(
    /\b[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{4}\b/g
  ))
    add(m[0], "Vehicle");
  for (const m of text.matchAll(
    /(?<!\d)(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g
  ))
    add(m[0], "Phone");
  for (const m of text.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi))
    add(m[0], "Email");
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(m[0], "Date");
  for (const m of text.matchAll(/(?:Rs\.?|INR|USD|\$)\s?[\d,]+(?:\.\d+)?/g))
    add(m[0], "Amount");
  for (const m of text.matchAll(/\b[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*\s+(?:Ltd|Limited|LLP|Inc|Corporation|Corp|Company|Enterprises|Traders|Foundation|Association)\b/g))
    add(m[0], "Organization");
  for (const m of text.matchAll(/\b(?:at|near|in|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g))
    add(m[1], "Location");
  for (const m of text.matchAll(/\b(?:account|a\/c)\s*(?:number|no\.?|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,23})\b/gi))
    add(m[1], "Account");
  for (const m of text.matchAll(/\b(?:[Oo]peration|[Ee]vent|[Mm]eeting)\s+(?:named\s+|code(?:named)?\s+)?([A-Z][\w-]+(?:\s+[A-Z][\w-]+){0,3})\b/g))
    add(m[1], "Event");
  const triples = [];
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [text];
  const pattern = /\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\s+(called|emailed|met|paid|transferred to)\s+([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\b/g;
  const relationships = {
    called: "CALLED",
    emailed: "EMAILED",
    met: "ASSOCIATE_OF",
    paid: "FINANCIAL_TRANSFER",
    "transferred to": "FINANCIAL_TRANSFER"
  };
  for (const sentence of sentences)
    for (const m of sentence.matchAll(pattern)) {
      add(m[1], "Person");
      add(m[3], "Person");
      triples.push({
        subject: m[1],
        relation: relationships[m[2]],
        object: m[3],
        evidence: sentence
      });
    }
  const terms = [...entities.values()].map((e) => e.text.toLowerCase());
  const selected = sentences.map((s, i) => ({
    s,
    i,
    score: terms.filter((t) => s.toLowerCase().includes(t)).length
  })).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i);
  const people=[...entities.values()].filter(e=>e.type==="Person");
  const normalizeName=value=>value.toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
  const clusters=new Map();
  for(const person of people){const key=normalizeName(person.text);const cluster=clusters.get(key)||{canonical_label:person.text,type:"Person",members:[],confidence:1};cluster.members.push(person.text);if(person.text.length>cluster.canonical_label.length)cluster.canonical_label=person.text;clusters.set(key,cluster);}
  const clusterValues=[...clusters.values()], review_queue=[];
  for(let i=0;i<clusterValues.length;i++)for(let j=i+1;j<clusterValues.length;j++){
    const a=normalizeName(clusterValues[i].canonical_label).split(" "),b=normalizeName(clusterValues[j].canonical_label).split(" ");
    if(a.length<2||b.length<2||a.at(-1)!==b.at(-1)||a[0][0]!==b[0][0])continue;
    const score=a[0]===b[0]?0.92:(a[0].length===1||b[0].length===1?0.88:0.72);
    review_queue.push({entity_a:clusterValues[i].canonical_label,entity_b:clusterValues[j].canonical_label,confidence:score,reason:"Matching surname and first-name initial"});
  }
  const cueGroups = {
    high: ["weapon", "explosive", "attack", "kidnap", "murder", "extortion"],
    moderate: ["threat", "fraud", "ransom", "illegal", "stolen", "suspicious"],
  };
  const lower = text.toLowerCase();
  const matched_cues = [...cueGroups.high, ...cueGroups.moderate].filter((cue) => lower.includes(cue));
  const highCount = cueGroups.high.filter((cue) => lower.includes(cue)).length;
  const review_priority = highCount ? "high" : matched_cues.length >= 2 ? "moderate" : "routine";
  const confidence = review_priority === "high" ? Math.min(0.9, 0.68 + highCount * 0.08) : review_priority === "moderate" ? 0.66 : 0.55;
  return {
    doc_id: "shared-text",
    summary: selected.map((s) => s.s).join(" "),
    entities: [...entities.values()],
    triples,
    resolution: { clusters: clusterValues, review_queue, method: "Normalized exact matching with initial-and-surname review candidates" },
    classification: {
      method: "Shared English rules and extractive summary v3.0.0",
      sentences: sentences.length,
      characters: text.length,
      review_priority,
      confidence,
      matched_cues,
      interpretation: "Keyword-based review prioritization; not a determination of criminality or intent."
    },
    warnings: [
      "Matches are candidate mentions for review, not verified identities. Rules recognize explicit English name-verb-name statements and formatted identifiers. Review priority is keyword-based triage, not a finding.",
      "Document results are separate from the network. Import relationship rows to build a graph."
    ]
  };
}
export {
  analyzeLocalText
};
