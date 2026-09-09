import type { FullGraphNode } from "./api";
export function analyzeLocalText(text: string, nodes: FullGraphNode[]) {
  if (text.length > 100000)
    throw new Error("Use up to 100,000 characters per document.");
  const entities = new Map<string, { text: string; type: string }>();
  const add = (text: string, type: string) =>
    entities.set(type + ":" + text, { text, type });
  for (const n of nodes)
    if (text.toLowerCase().includes(n.name.toLowerCase())) add(n.name, n.label);
  for (const m of text.matchAll(
    /\b[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{4}\b/g,
  ))
    add(m[0], "Vehicle");
  for (const m of text.matchAll(
    /(?<!\d)(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g,
  ))
    add(m[0], "Phone");
  for (const m of text.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi))
    add(m[0], "Email");
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(m[0], "Date");
  for (const m of text.matchAll(/(?:Rs\.?|INR|USD|\$)\s?[\d,]+(?:\.\d+)?/g))
    add(m[0], "Amount");
  const triples: {
    subject: string;
    relation: string;
    object: string;
    evidence: string;
  }[] = [];
  const sentences = text
    .match(/[^.!?]+[.!?]*/g)
    ?.map((s) => s.trim())
    .filter(Boolean) || [text];
  const pattern =
    /\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\s+(called|emailed|met|paid|transferred to)\s+([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\b/g;
  const relationships: Record<string, string> = {
    called: "CALLED",
    emailed: "EMAILED",
    met: "ASSOCIATE_OF",
    paid: "FINANCIAL_TRANSFER",
    "transferred to": "FINANCIAL_TRANSFER",
  };
  for (const sentence of sentences)
    for (const m of sentence.matchAll(pattern)) {
      add(m[1], "Person");
      add(m[3], "Person");
      triples.push({
        subject: m[1],
        relation: relationships[m[2]],
        object: m[3],
        evidence: sentence,
      });
    }
  const terms = [...entities.values()].map((e) => e.text.toLowerCase());
  const selected = sentences
    .map((s, i) => ({
      s,
      i,
      score: terms.filter((t) => s.toLowerCase().includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i);
  return {
    doc_id: "local-text",
    summary: selected.map((s) => s.s).join(" "),
    entities: [...entities.values()],
    triples,
    classification: {
      method: "Local rule-based extraction and extractive summary",
      sentences: sentences.length,
      characters: text.length,
    },
    warnings: [
      "Matches are candidate mentions for review, not verified identities. Rules recognize explicit English name-verb-name statements and formatted identifiers; no generative model or threat classification is used.",
      "Document results are separate from the network. Import relationship rows to build a graph.",
    ],
  };
}
