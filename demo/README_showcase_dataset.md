# X-Tracer showcase dataset

These two files describe the same fictional Meridian Signal investigation:

- xtracer_showcase_dataset.txt is the natural-language version. Upload it from Add your own data → Natural language or paste its contents.
- xtracer_showcase_dataset.csv is the structured version. Upload it from Add your own data → Data file. The CSV uses the import headers source, target, relationship, frequency, date, amount, and currency.

The case is intentionally synthetic and should not be presented as a real incident. It includes explicit examples of calls, email/contact activity, payments in INR, repeated frequencies, vehicle use and ownership, phone and account identifiers, work relationships, locations, family/association links, conflict signals, reciprocal transfers, and dated evidence.

Useful demo questions after importing either version:

- Who did Asha Rao call?
- Who called Meera Sen?
- How much did Asha Rao pay Kabir Shah?
- Which vehicles did Meera Sen use?
- Which phone belongs to Asha Rao?
- How is Asha Rao connected to Northstar Trading?
- Show payments from Northstar Trading to Farah Khan.
- What happened on 2026-08-14?

The natural-language extractor may produce a few additional candidate links from a sentence containing multiple clauses. Review the evidence table before building the graph; the CSV is the deterministic row-level version.
