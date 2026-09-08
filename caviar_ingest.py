"""
DATASET 1 — CAVIAR drug-trafficking wiretap network (phase1.csv..phase11.csv).

ENCODING (confirmed from your files, not assumed):
  Phase 1 distinct cells: 0..9.  All 11 phases: integers 0..76 (max per phase
  ranges 9..76). NOT binary 0/1 — weighted communication strength. Every phase
  matrix is square, row IDs == column IDs (ordered), diagonal all 0
  (no self-loops), asymmetric (directed ties preserved).

  Handles both cases anyway: --binary-threshold N binarizes any cell >= N to 1
  (default: no binarization, raw weights kept).

Phase date windows: each phase covers ~2 months between 1994-1996. The CSVs
carry no dates, so windows are sequential labels P1..P11 mapped to consecutive
2-month slots starting 1994-01. Treat as APPROXIMATE ordering anchors, not
ground-truth wiretap dates (published CAVIAR docs give 1994-1996 only).

Usage:
  python3 caviar_ingest.py --caviar-dir CAVIAR --out out_caviar
  python3 caviar_ingest.py --caviar-dir CAVIAR --out out_caviar --binary-threshold 1

Outputs (in --out):
  caviar_edges.csv       person_a,person_b,weight,phase_number,approx_date_range
  nodes_person.csv       person_id:ID,person_id,raw_id,source
  edges_contacted.csv    :START_ID,:END_ID,:TYPE,weight,phase_number,approx_date_range
  caviar_graph.json      {"phases": {phase: {"edges": [...]}},
                          "cumulative": [{"src","dst","weight","phases"}]}
  caviar_validation.txt  per-phase: active individuals, edges, density
"""
import argparse
import csv
import glob
import json
import os
import sys
from collections import defaultdict

PHASE_MONTHS = 2
EPOCH_YEAR, EPOCH_MONTH = 1994, 1  # approx anchor; see docstring


def phase_window(n):
    """Consecutive ~2-month slot n (1-indexed) from Jan 1994."""
    m0 = (EPOCH_MONTH - 1) + (n - 1) * PHASE_MONTHS
    y0, mo0 = EPOCH_YEAR + m0 // 12, m0 % 12 + 1
    m1 = m0 + PHASE_MONTHS - 1
    y1, mo1 = EPOCH_YEAR + m1 // 12, m1 % 12 + 1
    return f"{y0:04d}-{mo0:02d}..{y1:04d}-{mo1:02d}(approx)"


def load_phase(fp, binary_threshold=None):
    """Parse one phase matrix -> directed edge list. Returns (nodes, edges)."""
    with open(fp, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            print(f"WARN: empty file {fp}", file=sys.stderr)
            return [], []
        col_ids = [c.strip() for c in header[1:]]
        edges, nodes = [], set()
        for r in reader:
            if not r or not r[0].strip():
                continue
            rid = r[0].strip()
            nodes.add(rid)
            cells = r[1:]
            if len(cells) < len(col_ids):
                cells += ["0"] * (len(col_ids) - len(cells))
            for cid, cell in zip(col_ids, cells):
                cell = (cell or "0").strip()
                try:
                    w = int(float(cell))
                except ValueError:
                    print(f"WARN: non-numeric cell {fp}:{rid}->{cid}={cell!r}, skipped",
                          file=sys.stderr)
                    continue
                if w < 0:
                    print(f"WARN: negative cell {fp}:{rid}->{cid}={w}, skipped",
                          file=sys.stderr)
                    continue
                if w == 0:
                    continue
                nodes.add(cid)
                if binary_threshold is not None and w >= binary_threshold:
                    w = 1
                if rid == cid:
                    continue  # self-loop guard (diagonal is 0 in practice)
                edges.append((rid, cid, w))
    return sorted(nodes), edges


def main():
    ap = argparse.ArgumentParser(description="CAVIAR phase-matrix ingestion")
    ap.add_argument("--caviar-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--binary-threshold", type=int, default=None,
                    help="if set, cells >= N become weight 1 (default: keep raw weights)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    fps = sorted(glob.glob(os.path.join(args.caviar_dir, "phase*.csv")))
    if len(fps) != 11:
        print(f"WARN: expected 11 phase files, found {len(fps)}", file=sys.stderr)

    all_edges = []        # (a, b, weight, phase_number, date_range)
    per_phase = {}        # phase -> {"nodes": [...], "edges": [...]}
    cumulative = defaultdict(lambda: {"weight": 0, "phases": set()})
    all_persons = set()
    report_lines = ["phase,n_active,n_edges,density,total_weight,max_weight,approx_range"]

    for fp in fps:
        base = os.path.splitext(os.path.basename(fp))[0]  # phaseN
        try:
            n = int("".join(ch for ch in base if ch.isdigit()))
        except ValueError:
            print(f"WARN: cannot parse phase number from {base}, skipped", file=sys.stderr)
            continue
        window = phase_window(n)
        nodes, edges = load_phase(fp, args.binary_threshold)
        per_phase[n] = {"nodes": nodes, "edges": edges,
                        "approx_range": window}
        for a, b, w in edges:
            all_edges.append((a, b, w, n, window))
            all_persons.update([a, b])
            cumulative[(a, b)]["weight"] += w
            cumulative[(a, b)]["phases"].add(n)
        # validation stats: directed density over active nodes
        k = len(nodes)
        possible = k * (k - 1) if k > 1 else 0
        dens = len(edges) / possible if possible else 0.0
        tot = sum(w for _, _, w in edges)
        mx = max([w for _, _, w in edges], default=0)
        report_lines.append(f"{n},{k},{len(edges)},{dens:.4f},{tot},{mx},{window}")
        print(f"phase {n:>2}: active={k:>3} edges={len(edges):>4} "
              f"density={dens:.4f} total_w={tot:>4} max_w={mx:>3} range={window}")

    # --- schema-mapped outputs (same Neo4j model as ingest.py) ---
    with open(os.path.join(args.out, "caviar_edges.csv"), "w",
              newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["person_a", "person_b", "weight", "phase_number", "approx_date_range"])
        for row in sorted(all_edges, key=lambda r: (r[3], r[0], r[1])):
            w.writerow(row)

    with open(os.path.join(args.out, "nodes_person.csv"), "w",
              newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["person_id:ID", "person_id", "raw_id", "source"])
        for p in sorted(all_persons):
            w.writerow([f"caviar:{p}", f"caviar:{p}", p, "caviar"])

    with open(os.path.join(args.out, "edges_contacted.csv"), "w",
              newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([":START_ID", ":END_ID", ":TYPE", "weight",
                     "phase_number", "approx_date_range"])
        for a, b, wt, n, window in sorted(all_edges, key=lambda r: (r[3], r[0], r[1])):
            w.writerow([f"caviar:{a}", f"caviar:{b}", "CONTACTED",
                        wt, n, window])

    graph = {
        "phases": {str(n): {
            "approx_range": d["approx_range"],
            "nodes": [f"caviar:{p}" for p in d["nodes"]],
            "edges": [{"src": f"caviar:{a}", "dst": f"caviar:{b}",
                       "weight": wt, "phase": n,
                       "approx_range": d["approx_range"]}
                      for a, b, wt in d["edges"]]}
            for n, d in sorted(per_phase.items())},
        "cumulative": [
            {"src": f"caviar:{a}", "dst": f"caviar:{b}",
             "weight": v["weight"], "phases": sorted(v["phases"])}
            for (a, b), v in sorted(cumulative.items())],
    }
    with open(os.path.join(args.out, "caviar_graph.json"), "w",
              encoding="utf-8") as f:
        json.dump(graph, f, indent=1)

    with open(os.path.join(args.out, "caviar_validation.txt"), "w",
              encoding="utf-8") as f:
        f.write("\n".join(report_lines) + "\n")

    # query helpers (in-memory demo of both access patterns)
    def phase_view(n):
        return per_phase[n]["edges"]

    def cumulative_view():
        return [(a, b, v["weight"], sorted(v["phases"]))
                for (a, b), v in cumulative.items()]
    print(f"\nphases={len(per_phase)} persons={len(all_persons)} "
          f"phase_edges={len(all_edges)} cumulative_pairs={len(cumulative)}")
    print(f"outputs in {args.out}")


if __name__ == "__main__":
    main()
