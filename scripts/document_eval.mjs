import { readFile } from "node:fs/promises";
import { analyzeLocalText } from "../shared/documents.mjs";

const path = process.argv[2] || new URL("../tests/fixtures/document_gold.json", import.meta.url);
const documents = JSON.parse(await readFile(path, "utf8"));

const normalize = ({ text, type }) => `${type}:${text.trim().toLowerCase()}`;
let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;

for (const document of documents) {
  const expected = new Set(document.entities.map(normalize));
  const predicted = new Set(analyzeLocalText(document.text).entities.map(normalize));
  for (const entity of predicted) expected.has(entity) ? truePositive++ : falsePositive++;
  for (const entity of expected) if (!predicted.has(entity)) falseNegative++;
}

const precision = truePositive / Math.max(1, truePositive + falsePositive);
const recall = truePositive / Math.max(1, truePositive + falseNegative);
const f1 = (2 * precision * recall) / Math.max(Number.EPSILON, precision + recall);
console.log(`Document extraction evaluation: P=${precision.toFixed(3)} R=${recall.toFixed(3)} F1=${f1.toFixed(3)} (tp=${truePositive} fp=${falsePositive} fn=${falseNegative})`);
if (f1 < 0.8) {
  console.error("Document extraction F1 fell below the 0.80 regression threshold.");
  process.exit(1);
}
