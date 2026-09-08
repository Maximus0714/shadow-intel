import assert from "node:assert/strict";
import { cleanRows, detectMapping, parseCsvText } from "../src/lib/upload";
import { demoPaths, demoEgo } from "../src/lib/demo";
const parsed = parseCsvText(
  '\uFEFFsrc,dst,note\r\na,b,"two\nlines, and ""quotes"""\r\n',
);
assert.equal(parsed.rows[0].note, 'two\nlines, and "quotes"');
assert.equal(
  cleanRows(parsed.rows, detectMapping(parsed.columns)).cleaned[0].src,
  "a",
);
assert.throws(() => parseCsvText('src,dst\na,"unterminated'));
assert.throws(() => parseCsvText("src,src\na,b"));
const rows = [
  {
    src: "a",
    dst: "b",
    rel: "FINANCIAL_TRANSFER",
    amount: "900",
    date: "2026-09-08",
    frequency: "Infinity",
  },
];
const cleaned = cleanRows(
  [...rows, ...rows],
  detectMapping(Object.keys(rows[0])),
).cleaned;
assert.equal(cleaned.length, 2);
assert.equal(cleaned[0].frequency, 1);
assert.equal(cleaned[0].amount, "900");
const paths = demoPaths("P01", "P07");
assert.ok(paths.count > 0);
assert.ok(
  paths.paths.every(
    (path) => path[0] === "P01" && path.at(-1) === "P07" && path.length <= 4,
  ),
);
assert.ok(demoEgo("P01").nodes.some((node) => node.id === "V1"));
console.log("Upload parsing and offline traversal regressions passed.");
