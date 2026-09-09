# Data tools

These scripts prepare source datasets and evaluate the optional Python NLP pipeline.

- `caviar_ingest.py` — normalize the CAVIAR phases.
- `enron_ingest.py` — normalize Enron mail exports.
- `ingest.py` — combined ingestion pipeline.
- `ner_eval.py` — evaluate named-entity extraction.

Run them from the repository root so their relative input and output paths work.
Use module commands, for example `python -m scripts.ner_eval --gold gold_sample.json`
or `python -m scripts.caviar_ingest --help`. This resolves backend imports correctly.
