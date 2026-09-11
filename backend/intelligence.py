"""Case-local machine learning; source-linked observations, never guilt predictions."""
from collections import defaultdict
import numpy as np
from sklearn.ensemble import IsolationForest

FEATURES = ["distinct contacts", "recorded interactions", "relationship types",
            "payment records", "asset connections", "dated records"]
MODEL_VERSION = "isolation-forest-v1"


def make_brief(snapshot):
    records = snapshot["records"]
    people = sorted(snapshot["players"], key=lambda p: p["person_id"])
    evidence = defaultdict(list)
    for index, row in enumerate(records, 1):
        for entity in {row["src"], row["dst"]}:
            evidence[entity].append((index, row))
    vectors = []
    for person in people:
        entity = person["person_id"]
        rows = [r for _, r in evidence[entity]]
        vectors.append([
            len({r["dst"] if r["src"] == entity else r["src"] for r in rows}),
            sum(r.get("frequency", 1) for r in rows),
            len({r["rel"] for r in rows}),
            sum(r["rel"] == "FINANCIAL_TRANSFER" for r in rows),
            sum(r["rel"] in {"OWNS_VEHICLE", "USED_VEHICLE", "HAS_ACCOUNT", "HAS_PHONE", "REGISTERED_AT"} for r in rows),
            sum(bool(r.get("date")) for r in rows),
        ])
    ready = len(people) >= 6 and len({tuple(v) for v in vectors}) >= 3
    findings = []
    if ready:
        # Each case is fitted separately. Log counts limit domination by frequencies.
        matrix = np.asarray(vectors, dtype=float)
        model = IsolationForest(n_estimators=150, max_samples=min(256, len(people)),
                                contamination="auto", random_state=42, n_jobs=1)
        model.fit(np.log1p(matrix))
        scores = -model.score_samples(np.log1p(matrix))
        medians = np.median(matrix, axis=0)
        for i in sorted(range(len(people)), key=lambda i: (-scores[i], people[i]["person_id"]))[:5]:
            person = people[i]
            deviations = sorted(range(len(FEATURES)), key=lambda j: -abs(matrix[i, j] - medians[j]) / (medians[j] + 1))[:3]
            findings.append({"entity_id": person["person_id"], "name": person["name"],
                "outlier": bool(scores[i] > 0.5),
                "relative_percentile": round(float(np.mean(scores < scores[i]) * 100), 1),
                "model_score": round(float(scores[i]), 5),
                "observations": [f"{FEATURES[j].capitalize()}: {vectors[i][j]:g}; case median {medians[j]:g}." for j in deviations],
                "evidence": [{"record": index, "src": r["src"], "dst": r["dst"], "rel": r["rel"],
                              "source_rows": r.get("source_rows", []), "excerpt": r.get("evidence", "")[:400]}
                             for index, r in evidence[person["person_id"]][:3]],
                "next_step": "Check the linked source records and confirm identifiers before drawing conclusions."})
    missing_dates = sum(not r.get("date") for r in records)
    payments = [r for r in records if r["rel"] == "FINANCIAL_TRANSFER"]
    missing_amounts = sum(not r.get("amount") for r in payments)
    return {"model": MODEL_VERSION, "status": "ready" if ready else "insufficient_data",
            "method": "Isolation Forest, 150 trees, six count features, fitted only to this case. Fixed seed 42.",
            "summary": f"This case contains {len(records)} relationship records and {len(people)} people, including {len(payments)} payment records. "
                       + ("The model ranks unusual activity for human review." if ready else "At least six people and three different activity profiles are needed for ML ranking."),
            "summary_method": "Evidence-based template; not an LLM-generated narrative.",
            "people_analyzed": len(people), "features": FEATURES, "findings": findings,
            "data_gaps": [{"label": "Records without dates", "count": missing_dates},
                          {"label": "Payments without amounts", "count": missing_amounts}],
            "limitations": "Relative percentile is a within-case ranking, not a probability of crime or model accuracy. Observations describe feature differences, not causal explanations. Small, incomplete or biased datasets can produce misleading rankings. No relationships are invented."}
