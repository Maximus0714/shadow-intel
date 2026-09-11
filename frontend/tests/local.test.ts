import assert from "node:assert/strict";
import { buildDataset, localPaths } from "../src/lib/analysis/local";
import { analyzeLocalText } from "../src/lib/analysis/localDocuments";
import { cleanRows, detectMapping, parseCsvText } from "../src/lib/data/upload";
const parsed = parseCsvText(
  "src,dst,rel,frequency,date,amount\nA,B,FINANCIAL_TRANSFER,2,2026-09-01,100\nB,C,FINANCIAL_TRANSFER,2,2026-09-02,90\nC,A,FINANCIAL_TRANSFER,2,2026-09-03,80\nC,D,CALLED,5,,\nD,Place,REGISTERED_AT,1,,\nE,Place,REGISTERED_AT,1,,\nH,Place,REGISTERED_AT,1,,\nF,G,CALLED,1,,",
);
const records = cleanRows(parsed.rows, detectMapping(parsed.columns)).cleaned;
const d = buildDataset(records, "test.csv");
assert.equal(d.graph.total_nodes, 9);
assert.equal(d.graph.total_edges, 8);
assert.equal(d.details.Place.label, "Location");
assert.ok(d.alerts.some((a) => a.pattern_type === "Time-linked transfer cycle"));
assert.ok(d.alerts.some((a) => a.pattern_type === "Address concentration"));
assert.ok(d.communities.length >= 2);
assert.ok(
  d.players.find((p) => p.person_id === "C")!.influence_score >
    d.players.find((p) => p.person_id === "F")!.influence_score,
);
assert.equal(localPaths(d.graph, "A", "G", 5).count, 0);
assert.ok(
  localPaths(d.graph, "A", "D", 2).paths.some((p) => p.join(",") === "A,C,D"),
);
assert.equal(
  (d.details.A.properties!.records as { amount: string }[])[0].amount,
  "100",
);
assert.equal(
  cleanRows(
    [{ src: "A", dst: "B", rel: "FAKE" }],
    detectMapping(["src", "dst", "rel"]),
  ).skipped.length,
  1,
);
assert.throws(() => buildDataset([], "empty"));
const doc = analyzeLocalText(
  "Asha Rao called Kabir Shah. Their vehicle is MH12AB1234. Meeting date 2026-09-01.",
);
assert.equal(doc.triples[0].subject, "Asha Rao");
assert.equal(doc.triples[0].object, "Kabir Shah");
assert.ok(doc.entities.some((e) => e.text === "MH12AB1234"));
assert.equal(
  analyzeLocalText("No identifiable structured evidence here.").triples
    .length,
  0,
);
console.log(
  "Local analysis, disconnected paths, provenance, validation and document extraction passed.",
);
