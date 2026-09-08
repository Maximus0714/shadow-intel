"""
Evaluate the NER pipeline against a small manually-labeled sample.

Gold format (gold_sample.json): list of
  {"doc_id":..., "source": "own_dataset"|"enron", "text":...,
   "entities": [{"text":..., "type":...}, ...]}   # offsets optional

Match rule: exact (text, type) pair after strip/lower normalization.
Set --strict-offsets to also require start/end equality.

Usage:
  python3 ner_eval.py --gold gold_sample.json
  python3 ner_eval.py --gold gold_sample.json --strict-offsets

Prints overall P/R/F1, per-source P/R/F1, and per-type P/R/F1.
"""
import argparse
import json
from collections import defaultdict

from nlp_pipeline import CrimeNerPipeline


def norm(e):
    return (e["text"].strip().lower(), e["type"])


def norm_off(e):
    return (e["text"].strip().lower(), e["type"], e.get("start"), e.get("end"))


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold", required=True)
    ap.add_argument("--strict-offsets", action="store_true")
    args = ap.parse_args()
    key = norm_off if args.strict_offsets else norm

    with open(args.gold, encoding="utf-8") as f:
        gold_docs = json.load(f)

    tot = defaultdict(int)     # tp/fp/fn overall
    by_src = defaultdict(lambda: defaultdict(int))
    by_type = defaultdict(lambda: defaultdict(int))
    pipes = {}

    for g in gold_docs:
        src = g["source"]
        pipes.setdefault(src, CrimeNerPipeline(source=src))
        pred = pipes[src].extract(g["doc_id"], g["text"])
        P = defaultdict(int)
        for e in pred["entities"]:
            P[key(e)] += 1
        G = defaultdict(int)
        for e in g["entities"]:
            G[key(e)] += 1
        # count per unique key with multiplicity (min = tp)
        for k in set(P) | set(G):
            tp = min(P[k], G[k])
            fp, fn = P[k] - tp, G[k] - tp
            typ = k[1]
            for d in (tot, by_src[src], by_type[typ]):
                d["tp"] += tp
                d["fp"] += fp
                d["fn"] += fn

    def show(name, d):
        p, r, f = prf(d["tp"], d["fp"], d["fn"])
        print(f"{name:<22} P={p:.3f} R={r:.3f} F1={f:.3f} "
              f"(tp={d['tp']} fp={d['fp']} fn={d['fn']})")

    print("== overall ==")
    show("ALL", tot)
    print("== per source ==")
    for s in sorted(by_src):
        show(s, by_src[s])
    print("== per entity type ==")
    for t in sorted(by_type):
        show(t, by_type[t])


if __name__ == "__main__":
    main()
