import * as XLSX from "xlsx";

export interface CleanedEdge {
  src: string;
  dst: string;
  rel: string;
  frequency: number;
  date: string;
  amount: string;
  source_rows?: number[];
}
export interface SkippedRow {
  row: number;
  reason: string;
}
export interface DetectedUpload {
  columns: string[];
  mapping: Record<string, string | null>;
  cleaned: CleanedEdge[];
  skipped: SkippedRow[];
}

const PATTERNS: Record<string, RegExp[]> = {
  source: [
    /:START_ID/i,
    /person_a/i,
    /sender/i,
    /^source$/i,
    /^src$/i,
    /^from$/i,
    /^caller$/i,
  ],
  target: [
    /:END_ID/i,
    /person_b/i,
    /recipient/i,
    /^target$/i,
    /^dst$/i,
    /^to$/i,
    /^receiver$/i,
    /^callee$/i,
  ],
  rel: [/:TYPE/i, /^rel$/i, /^type$/i, /^relationship$/i],
  weight: [/frequency/i, /weight/i, /count/i, /calls/i],
  date: [/timestamp/i, /^date$/i, /datetime/i],
  amount: [/amount/i, /value/i],
};

export function detectMapping(
  columns: string[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [role, res] of Object.entries(PATTERNS)) {
    out[role] = columns.find((c) => res.some((r) => r.test(c.trim()))) ?? null;
  }
  return out;
}

export function cleanRows(
  rows: Record<string, string>[],
  m: Record<string, string | null>,
): { cleaned: CleanedEdge[]; skipped: SkippedRow[] } {
  const agg = new Map<string, CleanedEdge>();
  const skipped: SkippedRow[] = [];
  const supported = new Set([
    "CALLED",
    "EMAILED",
    "CONTACTED",
    "ASSOCIATE_OF",
    "FINANCIAL_TRANSFER",
    "FAMILY_OF",
    "CO_LOCATED",
    "OWNS_VEHICLE",
    "REGISTERED_AT",
  ]);
  rows.forEach((r, i) => {
    const src = (m.source ? (r[m.source] ?? "") : "").trim();
    const dst = (m.target ? (r[m.target] ?? "") : "").trim();
    if (m.source && m.source === m.target) {
      skipped.push({
        row: i + 2,
        reason: "Source and target must use different columns",
      });
      return;
    }
    if (!src || !dst) {
      skipped.push({ row: i + 2, reason: "missing endpoint" });
      return;
    }
    const rel =
      ((m.rel ? (r[m.rel] ?? "") : "") || "ASSOCIATE_OF")
        .trim()
        .toUpperCase() || "ASSOCIATE_OF";
    if (!supported.has(rel)) {
      skipped.push({ row: i + 2, reason: `Unsupported relationship: ${rel}` });
      return;
    }
    const rawFreq = Math.max(
      1,
      Math.trunc(Number(m.weight ? r[m.weight] : 1) || 1),
    );
    const freq = Number.isFinite(rawFreq) ? rawFreq : 1;
    const date = (m.date ? (r[m.date] ?? "") : "").trim();
    const amount = (m.amount ? (r[m.amount] ?? "") : "").trim();
    const k = JSON.stringify([
      src,
      dst,
      rel,
      date,
      amount,
      rel === "FINANCIAL_TRANSFER" ? i : null,
    ]);
    const prev = agg.get(k);
    if (prev) {
      prev.frequency += freq;
      prev.source_rows?.push(i + 2);
    } else
      agg.set(k, {
        src,
        dst,
        rel,
        frequency: Number.isFinite(freq) ? freq : 1,
        date,
        amount,
        source_rows: [i + 2],
      });
  });
  return { cleaned: [...agg.values()], skipped };
}

export function parseCsvText(text: string): {
  columns: string[];
  rows: Record<string, string>[];
} {
  const records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(cell);
      cell = "";
      if (c !== ",") {
        if (row.some((value) => value.trim())) records.push(row);
        row = [];
        if (c === "\r" && input[i + 1] === "\n") i++;
      }
    } else cell += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim())) records.push(row);
  const columns = (records.shift() || []).map((h) => h.trim());
  if (new Set(columns).size !== columns.length || columns.some((h) => !h))
    throw new Error("Column names must be non-empty and unique.");
  const rows = records.map((cells) =>
    Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? "").trim()])),
  );
  return { columns, rows };
}

export interface SheetInfo {
  sheetNames: string[];
  sheet: string;
  columns: string[];
  rows: Record<string, string>[];
}

export async function parseFile(
  file: File,
  sheet?: string,
): Promise<SheetInfo> {
  if (file.size > 5_000_000) throw new Error("File too large (max 5 MB).");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const { columns, rows } = parseCsvText(text);
    return { sheetNames: [], sheet: "", columns, rows };
  }
  if (name.endsWith(".json")) {
    const g = JSON.parse(await file.text());
    if (!g || typeof g !== "object" || Array.isArray(g))
      throw new Error("JSON must be an object with an edges array.");
    const el = g.edges || g.links || [];
    if (
      !Array.isArray(el) ||
      el.some((e) => !e || typeof e !== "object" || Array.isArray(e))
    )
      throw new Error("Each edge must be an object.");
    const rows = el.map((e: Record<string, unknown>) => ({
      src: String(e.src ?? e.a ?? e.source ?? e.from ?? ""),
      dst: String(e.dst ?? e.b ?? e.target ?? e.to ?? ""),
      date: String(e.date ?? e.timestamp ?? ""),
      amount: String(e.amount ?? ""),
      rel: String(e.rel ?? e.t ?? e.type ?? ""),
      frequency: String((e.frequency ?? e.s ?? e.weight ?? 1) as unknown),
    }));
    return {
      sheetNames: [],
      sheet: "",
      columns: ["src", "dst", "rel", "frequency", "date", "amount"],
      rows,
    };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const pick =
      (sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0]) || "";
    const ws = wb.Sheets[pick];
    const table = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
    }) as string[][];
    const nonEmpty = table.filter((r) =>
      r.some((c) => String(c ?? "").trim() !== ""),
    );
    let hi = 0;
    for (let i = 0; i < Math.min(10, nonEmpty.length); i++) {
      if (
        nonEmpty[i].filter((c) => String(c ?? "").trim() !== "").length >= 2
      ) {
        hi = i;
        break;
      }
    }
    const columns = (nonEmpty[hi] || []).map((h) => String(h ?? "").trim());
    if (new Set(columns).size !== columns.length || columns.some((c) => !c))
      throw new Error("Column names must be non-empty and unique.");
    const rows = nonEmpty.slice(hi + 1).map((r) => {
      const row: Record<string, string> = {};
      columns.forEach((c, i) => {
        row[c] = String(r[i] ?? "").trim();
      });
      return row;
    });
    return { sheetNames: wb.SheetNames, sheet: pick, columns, rows };
  }
  throw new Error("Unsupported file type. Upload .csv, .xlsx, .xls or .json.");
}
