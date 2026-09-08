import * as XLSX from "xlsx";

export interface CleanedEdge {
  src: string;
  dst: string;
  rel: string;
  frequency: number;
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
  source: [/:START_ID/i, /person_a/i, /sender/i, /^source$/i, /^from$/i],
  target: [/:END_ID/i, /person_b/i, /recipient/i, /^target$/i, /^to$/i],
  rel: [/:TYPE/i, /^rel$/i, /^type$/i],
  weight: [/frequency/i, /weight/i, /count/i, /calls/i],
  date: [/timestamp/i, /^date$/i, /datetime/i],
  amount: [/amount/i, /value/i],
};

export function detectMapping(columns: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [role, res] of Object.entries(PATTERNS)) {
    out[role] = columns.find((c) => res.some((r) => r.test(c.trim()))) ?? null;
  }
  return out;
}

export function cleanRows(
  rows: Record<string, string>[],
  m: Record<string, string | null>
): { cleaned: CleanedEdge[]; skipped: SkippedRow[] } {
  const agg = new Map<string, CleanedEdge>();
  const skipped: SkippedRow[] = [];
  rows.forEach((r, i) => {
    const src = (m.source ? (r[m.source] ?? "") : "").trim();
    const dst = (m.target ? (r[m.target] ?? "") : "").trim();
    if (!src || !dst) {
      skipped.push({ row: i + 2, reason: "missing endpoint" });
      return;
    }
    const rel =
      ((m.rel ? (r[m.rel] ?? "") : "") || "ASSOCIATE_OF").trim().toUpperCase() ||
      "ASSOCIATE_OF";
    const freq = Math.max(1, Math.round(Number(m.weight ? r[m.weight] : 1) || 1));
    const k = `${src}>${dst}>${rel}`;
    const prev = agg.get(k);
    if (prev) prev.frequency += freq;
    else agg.set(k, { src, dst, rel, frequency: freq });
  });
  return { cleaned: [...agg.values()], skipped };
}

export function parseCsvText(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { columns: [], rows: [] };
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const columns = split(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    columns.forEach((c, i) => {
      row[c] = (cells[i] ?? "").trim();
    });
    return row;
  });
  return { columns, rows };
}

export interface SheetInfo {
  sheetNames: string[];
  sheet: string;
  columns: string[];
  rows: Record<string, string>[];
}

export async function parseFile(file: File, sheet?: string): Promise<SheetInfo> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const { columns, rows } = parseCsvText(text);
    return { sheetNames: [], sheet: "", columns, rows };
  }
  if (name.endsWith(".json")) {
    const g = JSON.parse(await file.text());
    const el = g.edges || g.links || [];
    const rows = el.map((e: Record<string, unknown>) => ({
      src: String(e.src ?? e.a ?? e.source ?? e.from ?? ""),
      dst: String(e.dst ?? e.b ?? e.target ?? e.to ?? ""),
      rel: String(e.rel ?? e.t ?? e.type ?? ""),
      frequency: String((e.frequency ?? e.s ?? e.weight ?? 1) as unknown),
    }));
    return { sheetNames: [], sheet: "", columns: ["src", "dst", "rel", "frequency"], rows };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const pick = (sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0]) || "";
    const ws = wb.Sheets[pick];
    const table = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];
    const nonEmpty = table.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
    let hi = 0;
    for (let i = 0; i < Math.min(10, nonEmpty.length); i++) {
      if (nonEmpty[i].filter((c) => String(c ?? "").trim() !== "").length >= 2) {
        hi = i;
        break;
      }
    }
    const columns = (nonEmpty[hi] || []).map((h) => String(h ?? "").trim());
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
