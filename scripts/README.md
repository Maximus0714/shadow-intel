# Data tools

These scripts prepare source datasets and evaluate the optional Python NLP pipeline.

- `caviar_ingest.py` — normalize the CAVIAR phases.
- `enron_ingest.py` — normalize Enron mail exports.
- `ingest.py` — combined ingestion pipeline.
- `ner_eval.py` — evaluate named-entity extraction.

Run them from the repository root so their relative input and output paths work.
Use module commands, for example `python -m scripts.ner_eval --gold path/to/your_gold.json`
or `python -m scripts.caviar_ingest --help`. The Python NER evaluator is optional
and expects spaCy plus a model supplied by the developer.

## Quality evaluation

`node scripts/document_eval.mjs` runs the production shared document extractor
against `tests/fixtures/document_gold.json` and fails below an F1 score of 0.80.
CI runs this regression on every push and pull request.
