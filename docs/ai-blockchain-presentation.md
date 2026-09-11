# AI and blockchain additions for X-Tracer

Implemented September 10, 2026. Open **AI & Evidence Proof** in the workspace.

## The explanation to give judges

“X-Tracer connects investigation records into a graph. Our machine-learning model
compares activity profiles and helps an investigator decide which records to
review first. We also put a salted digital fingerprint of the evidence into an
Ethereum transaction. If someone changes the evidence later, its fingerprint no
longer matches. AI helps review the information; blockchain helps check its integrity.”

This is a working local prototype. It does not predict guilt or establish that a
source is truthful. Its Ethereum node is a **single-node development network**,
not a decentralized multi-agency or public deployment.

## What changed compared with your PDF

Compared visually with `SIH2026-IDEA-Presentattion-Team Sentinal.pdf` from Downloads,
including the graphics on pages 2–5. The PDF itself has not been edited.

| Addition | Relationship to the presentation | Suggested slide change |
| --- | --- | --- |
| Isolation Forest activity ranking | Makes page 2's AI-assisted insights / unusual patterns and page 4's reviewable AI more concrete | Add **scikit-learn: Isolation Forest** alongside graph analytics on page 3 |
| Six activity features and source-linked observations | Extends page 4's source records and reasoning | List contact diversity, interaction frequency, relationship diversity, payment records, asset connections and dated records |
| Evidence-based brief and missing-data counts | New explicit UI feature supporting the existing investigation workflow | Add **case briefing and evidence-quality checks**; describe the summary as a template, not generative AI |
| Salted SHA-256 evidence commitment in an Ethereum transaction | Concrete extension of page 2's “secure & auditable” / tamper-evident logs; **no blockchain implementation appears in page 3's architecture** | Add a branch **Evidence → salted hash → Ethereum receipt → verification** and a **Geth development node** box |
| Receipt viewer, proof-bundle export/import and changed-copy demonstration | New explicit features beyond the PDF | Add a small “Seal → verify → detect changes” demo panel |

Do not change the slides to claim that this work completes every original promise.
The upload workflow now includes investigator-approved identity merging based on
similar names and shared normalized identifiers, with aliases retained in source
provenance. It does not introduce spaCy, Neo4j persistence, agency roles, full
evidence custody, or external data connectors.
The existing English extraction is rule-based. The new learned model is the
Isolation Forest in the backend.

## Two-minute demo

1. Start `docker compose up --build -d`, then open `http://localhost:4179`.
2. Sign in, open the demo or upload a case, then choose **AI & Evidence Proof**.
3. Click **Generate AI brief**. The bundled demo has enough people to run the
   model. Very small or uniform cases show an honest insufficient-data message.
4. Expand **Inspect supporting records**. Explain that these are actual source
   rows, not relationships invented by an AI model.
5. Open **Evidence proof** and click **Seal evidence on blockchain**. Point to the
   block number, transaction hash and evidence fingerprint.
6. Click **Verify original**: it should show `verified`.
7. Click **Test a changed copy**: it should show `mismatch`. This changes one
   frequency in a temporary backend copy, never the investigation itself.
8. Download the proof bundle and select it in **Verify a downloaded bundle**.
   An unchanged bundle verifies. Editing its evidence and uploading it again fails.
9. Open **Saved fingerprints** and search using the transaction hash or SHA-256
   fingerprint. The chain returns the mined receipt; the private case opens only
   when its saved copy is available for that signed-in account on that device.

## How the AI works

`backend/intelligence.py` constructs six numeric features per person from the
backend's normalized records. Counts use a log transform. A 150-tree Isolation
Forest learns a new model from each case with a fixed random seed of 42.
It uses up to 256 samples per tree and runs with one worker per request.

An Isolation Forest tries to isolate observations using random splits. Unusual
profiles tend to be isolated more easily. The UI shows up to five highest-ranked
profiles and whether they exceed the model's default outlier threshold.
It requires at least six people and three distinct feature vectors. These are
practical demo safeguards, not a scientifically validated minimum sample size.

The percentile is the percentage of case members with a strictly lower anomaly
score. Ties share a percentile. It is **not accuracy, confidence, influence or a
probability of crime**. The feature comparisons are descriptive differences from
the case median, not SHAP explanations or proof of model causality.

Names do not serve as predictive features. Payment amounts are not summed across
currencies. Missing dates and amounts are reported separately. Incomplete data
can still distort results. The model has not been validated on a representative
labeled investigation dataset. Human review is required.

## How the blockchain works

`backend/evidence_proof.py` serializes the validated evidence with stable object
key ordering. Record order, case name, source text, record attributes, amounts
and quotations are significant. Pydantic defaults make omitted optional fields
equivalent to their explicit defaults. Original upload-file bytes are not retained
or hashed. Extra fields outside the Evidence schema are not part of the commitment.

Each seal uses a fresh 32-byte random salt and SHA-256. Only a version marker and
the 32-byte digest are put in the transaction's data field. Evidence, salt, account
identity and quotations are not published in transaction data. A zero-value
transaction is sent by the backend using the internal node's development signer.
There is **no Solidity smart contract**: this is transaction-data anchoring.

Verification recomputes the digest and checks the actual transaction input,
successful receipt, block number, block hash and inclusion in that block. It
returns `unavailable` if the transaction is missing, rather than declaring a
local hash match to be blockchain verification.

The Docker `chain` service runs Geth in development mode (chain ID 1337), with
chain data and receipts persisted in the `evidence-chain` volume. Its RPC port
is internal and is not published to the host. The backend refuses other chain IDs.
No MetaMask account, paid RPC subscription or real cryptocurrency is needed.

Receipts are saved in browser storage under the signed-in user and case scope.
Download the proof bundle for portability: it contains evidence, salt and receipt
and optionally the generated brief. The brief itself is **not** covered by the
receipt. Verification on another machine requires access to the same chain data;
a fresh Git clone creates a different ledger. A JSON receipt is not a substitute
for a blockchain backup. Normal Docker restarts preserve the chain; deleting its
volume destroys it.

The case-lookup endpoint accepts a transaction hash or evidence fingerprint. A
transaction hash is looked up directly; fingerprint lookup scans at most the 500
most recent development-chain blocks. The result contains only the fingerprint
and mined transaction metadata because private evidence is deliberately off-chain.

## Questions judges may ask

- **Why blockchain instead of a database hash?** It demonstrates independently
  checking a mined record of a commitment. In this local version the same operator
  controls the node, so it does not yet provide multi-party trust. A consortium
  deployment would require independent nodes and governance.
- **Can the evidence be changed?** Copies can be changed; verification detects
  differences from a particular receipt. An administrator can reset this local chain.
- **Does “verified” mean true or legally admissible?** No. It means the selected
  evidence matches the committed fingerprint on this chain.
- **Is this ChatGPT?** No. It is a trained unsupervised ML model plus a template
  summary. All analysis and hashing happen in the backend without an external AI API.
- **What is new beyond the PDF?** The explicit Ethereum architecture, receipt UI,
  proof bundles, changed-copy demo, and named Isolation Forest implementation.

## Deployment boundary

The current stateless workspace API does not validate Supabase JWTs server-side;
UI sign-in is not API authorization. Keep this as a local hackathon prototype
until authenticated backend access, case permissions, custody events, chain
backup/recovery, monitored node operations and a production signing strategy
are implemented. Do not expose the development RPC or its unlocked signer.

Technical references: [Isolation Forest documentation](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html)
and [Geth developer mode](https://geth.ethereum.org/docs/developers/dapp-developer/dev-mode).
