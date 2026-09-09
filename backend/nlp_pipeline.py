"""
Criminal-network NER pipeline (source-aware, swappable NER backend).

Usage:
  from backend.nlp_pipeline import CrimeNerPipeline, PHONE_PATTERNS, SOURCE_CONFIG

    pipe = CrimeNerPipeline(source="own_dataset")   # or "enron"
    print(pipe.extract("doc1", "Ravi called +919876543210 from MH12AB1234."))

    # batch: pipe.extract_batch([(doc_id, text, source), ...]) -> [json, ...]

    # swap backend later without touching callers:
    CrimeNerPipeline.register_backend("indicner", MyIndicNerBackend)
    pipe = CrimeNerPipeline(source="own_dataset", backend="indicner")

Entity types: PERSON, PHONE_NUMBER, VEHICLE_NUMBER, LOCATION, ORGANIZATION,
DATE, MONEY_AMOUNT.

spaCy pretrained NER supplies: PERSON, LOCATION (GPE/LOC/FAC), ORGANIZATION
(ORG/NORP), DATE (DATE/TIME), MONEY_AMOUNT (MONEY/QUANTITY).
Rule layer (compiled regex over raw text) supplies PHONE_NUMBER and
VEHICLE_NUMBER, and WINS over spaCy on overlapping spans (spaCy often tags
phone digits as DATE/CARDINAL, e.g. "98765 43210" -> DATE).

SOURCE_CONFIG controls which rule layers run per source:
  "own_dataset": indian + us phones, vehicle plates ON
  "enron":       indian + us phones, vehicle plates OFF
Add regions by appending to PHONE_PATTERNS + SOURCE_CONFIG, no code rewrite.
"""
import re

# --------------------------------------------------------------------------
# Configurable phone patterns: list of (name, regex). Append new regions here.
# (?<!\d) guard stops matches inside longer digit strings.
# --------------------------------------------------------------------------
PHONE_PATTERNS = [
    # Indian 10-digit, optional +91 / 91 / 0 prefix, optional spaces/dashes
    ("IN_MOBILE", r"(?<!\d)(?:\+?91[\s\-]?|0)?[6-9]\d{4}[\s\-]?\d{5}\b"),
    # US (XXX) XXX-XXXX with optional space/dash + optional +1
    ("US_PARENS", r"(?<!\d)(?:\+?1[\s\-]?)?\(\d{3}\)[\s\-]?\d{3}[\s\-]?\d{4}\b"),
    # US XXX-XXX-XXXX with dash/space/dot separators + optional +1
    ("US_DASHED", r"(?<!\d)(?:\+?1[\s\-]?)?\d{3}[\s\-.]\d{3}[\s\-.]\d{4}\b"),
]

# Indian vehicle plates: MH12AB1234, MH-12-AB-1234, MH 12 AB 1234, DL1CAA1234
VEHICLE_PATTERNS = [
    ("IN_PLATE",
     r"\b[A-Z]{2}[\s\-]?[0-9]{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?[0-9]{4}\b"),
]

# Money with explicit currency markers (spaCy catches "$2.5 million" itself,
# but Indian "Rs. 50,000" is tagged CARDINAL, which we exclude to avoid bare
# numbers — so a currency-anchored rule covers it). Runs for every source.
MONEY_PATTERNS = [
    ("CURRENCY_AMOUNT",
     r"(?<!\w)(?:Rs\.?|INR|USD|\$)\s?[\d,]+(?:\.\d+)?"
     r"\s?(?:lakh|crore|million|billion|thousand)?\b"),
]

SOURCE_CONFIG = {
    # phones: list of pattern names from PHONE_PATTERNS ("all" = every entry)
    # vehicles: True/False toggle per source
    "own_dataset": {"phones": "all", "vehicles": True},
    "enron": {"phones": "all", "vehicles": False},
}

# spaCy label -> our label. CARDINAL/PERCENT deliberately excluded: bare
# numbers ("102/2024", "713") are not money; only MONEY/QUANTITY map.
SPACY_MAP = {
    "PERSON": "PERSON",
    "GPE": "LOCATION", "LOC": "LOCATION", "FAC": "LOCATION",
    "ORG": "ORGANIZATION", "NORP": "ORGANIZATION",
    "DATE": "DATE", "TIME": "DATE",
    "MONEY": "MONEY_AMOUNT", "QUANTITY": "MONEY_AMOUNT",
}

NER_BACKENDS = {}


def _spacy_backend_factory(nlp):
    """Default backend: spaCy pretrained NER. Swap via register_backend."""
    def run(text):
        return [(e.text, SPACY_MAP[e.label_], e.start_char, e.end_char, None)
                for e in nlp(text).ents if e.label_ in SPACY_MAP]
    return run


def _overlaps(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end


class CrimeNerPipeline:
    """Source-aware extractor. Backend swappable (e.g. IndicNER later)."""

    RULE_CONF = 1.0  # regex hits are deterministic

    def __init__(self, source="own_dataset", backend="spacy",
                 model="en_core_web_sm", extra_phones=None):
        if source not in SOURCE_CONFIG:
            raise ValueError(f"unknown source {source!r}; "
                             f"known: {sorted(SOURCE_CONFIG)}")
        self.source = source
        self.cfg = SOURCE_CONFIG[source]
        wanted = [n for n, _ in PHONE_PATTERNS] \
            if self.cfg["phones"] == "all" else list(self.cfg["phones"])
        phone_rx = [(n, rx) for n, rx in PHONE_PATTERNS if n in wanted]
        if extra_phones:  # per-run additions without editing module
            phone_rx += list(extra_phones)
        self._phone_res = [(n, re.compile(rx)) for n, rx in phone_rx]
        self._vehicle_res = [(n, re.compile(rx)) for n, rx in VEHICLE_PATTERNS] \
            if self.cfg["vehicles"] else []
        self._money_res = [(n, re.compile(rx, re.IGNORECASE))
                           for n, rx in MONEY_PATTERNS]
        if backend == "spacy":
            import spacy
            self.nlp = spacy.load(model)
            self._backend = _spacy_backend_factory(self.nlp)
        elif backend in NER_BACKENDS:
            self.nlp, self._backend = None, NER_BACKENDS[backend](source)
        else:
            raise ValueError(f"unknown backend {backend!r}")

    @staticmethod
    def register_backend(name, factory):
        """factory(source) -> callable(text) -> [(text,type,start,end,conf)]."""
        NER_BACKENDS[name] = factory

    def _rule_spans(self, text):
        spans = []  # (start, end, text, type)
        for _, rx in self._phone_res:
            for m in rx.finditer(text):
                spans.append((m.start(), m.end(), m.group(0),
                              "PHONE_NUMBER"))
        for _, rx in self._vehicle_res:
            for m in rx.finditer(text):
                spans.append((m.start(), m.end(), m.group(0),
                              "VEHICLE_NUMBER"))
        for _, rx in self._money_res:
            for m in rx.finditer(text):
                spans.append((m.start(), m.end(), m.group(0),
                              "MONEY_AMOUNT"))
        # dedupe identical spans; keep longest on partial overlap
        spans.sort(key=lambda s: (s[0], -(s[1] - s[0])))
        kept = []
        for s in spans:
            if any(s[0] == k[0] and s[1] == k[1] for k in kept):
                continue
            if any(_overlaps(s[0], s[1], k[0], k[1]) and
                   (k[1] - k[0]) >= (s[1] - s[0]) for k in kept):
                continue
            kept = [k for k in kept
                    if not _overlaps(s[0], s[1], k[0], k[1])]
            kept.append(s)
        return kept

    def extract(self, doc_id, text, source=None):
        src = source or self.source
        if src != self.source:  # per-document source switch
            sub = CrimeNerPipeline(source=src)
            return sub.extract(doc_id, text)
        rule_spans = self._rule_spans(text)
        ents = [{"text": t.strip(), "type": typ, "start": s, "end": e,
                 "confidence": self.RULE_CONF}
                for s, e, t, typ in rule_spans]
        for t, typ, s, e, conf in self._backend(text):
            if any(_overlaps(s, e, rs, re_) for rs, re_, _, _ in rule_spans):
                continue  # rule layer wins (e.g. DATE over phone digits)
            ents.append({"text": t, "type": typ, "start": s, "end": e,
                         "confidence": conf})
        ents.sort(key=lambda d: (d["start"], d["end"]))
        return {"doc_id": doc_id, "source": src, "entities": ents}

    def extract_batch(self, docs):
        """docs: iterable of (doc_id, text, source-or-None)."""
        return [self.extract(d, t, s) for d, t, s in docs]


# --------------------------------------------------------------------------
# Example usage on one sample document per source
# --------------------------------------------------------------------------
if __name__ == "__main__":
    own_doc = (
        "FIR No. 102/2024: Complainant Ravi Sharma (phone +91 98765 43210) "
        "reported that accused Mohan Yadav, driving vehicle MH12AB1234, met "
        "him near Gateway of India, Mumbai on 12 March 2024 and demanded "
        "Rs. 50,000 on behalf of Sharma Enterprises."
    )
    enron_doc = (
        "From: jeff.dasovich@enron.com To: richard.shapiro@enron.com "
        "Date: Mon, 14 May 2001. Jeff Dasovich called me at (713) 555-0142 "
        "or 713-555-0199 from the Houston office regarding the $2.5 million "
        "deal with California Power on May 15, 2001."
    )
    import json
    for src, doc in (("own_dataset", own_doc), ("enron", enron_doc)):
        pipe = CrimeNerPipeline(source=src)
        print(json.dumps(pipe.extract(f"sample-{src}", doc), indent=2,
                         ensure_ascii=False))
