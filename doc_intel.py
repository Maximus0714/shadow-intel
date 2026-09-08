"""
Document intelligence: summarize, threat-classify, extract graph triples.

Runs offline by default (extractive summarizer, keyword threat scorer,
dependency/pattern triple extractor). Each stage has a HuggingFace upgrade
behind a flag — no caller changes needed:
  summarize(..., method="abstractive")  -> facebook/bart-large-cnn
  classify(..., method="zeroshot")      -> facebook/bart-large-mnli
  (triples stay syntactic; entities come from nlp_pipeline.CrimeNerPipeline)

Graph mapping: triples use relation verbs mapped to schema edge types
  MET -> ASSOCIATE_OF, CALLED -> CALLED, TRANSFERRED/PAID -> FINANCIAL_TRANSFER
  SEEN_WITH/AT + shared location/date -> CO_LOCATED
so output rows feed graph_store.load_relationships() directly.

Usage:
  from doc_intel import DocIntel
  d = DocIntel(source="own_dataset")
  print(d.process("fir102", FIR_TEXT))
"""
import re
from collections import Counter

# ------------------------------------------------------------- constants ---
THREAT_LABELS = ("low", "medium", "high")
HIGH_CUES = ("murder", "kill", "weapon", "pistol", "threaten", "extort",
             "kidnap", "ransom", "blast", "shoot", "assault", "demand",
             "hawala", "smuggl", "traffick")
MED_CUES = ("fraud", "cheat", "bribe", "theft", "stolen", "forgery",
            "gamble", "dispute", "complaint", "accused", "fir", "arrest")

# verb lemma -> schema edge type (graph_store.load_relationships compatible)
REL_MAP = {
    "meet": "ASSOCIATE_OF", "threaten": "ASSOCIATE_OF",
    "call": "CALLED", "phone": "CALLED",
    "pay": "FINANCIAL_TRANSFER", "transfer": "FINANCIAL_TRANSFER",
    "give": "FINANCIAL_TRANSFER", "demand": "FINANCIAL_TRANSFER",
    "see": "CO_LOCATED", "spot": "CO_LOCATED",
}
# definite-NP / pronoun subjects resolved to most recent PERSON (flagged)
COREF_SUBJ = {"he", "she", "him", "her", "they", "them", "the accused",
              "accused", "the complainant", "complainant"}


def _nlp():
    import spacy
    if not hasattr(_nlp, "model"):
        _nlp.model = spacy.load("en_core_web_sm")
    return _nlp.model


def _ent_at(ents, tok, label=None):
    """PERSON/LOCATION/DATE entity whose span contains token, else None."""
    for e in ents:
        if e.start <= tok.i < e.end and (label is None or e.label_ == label):
            return e
    return None


def _sentences(text):
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(])", text.strip())
    return [p.strip() for p in parts if p.strip()]


# ------------------------------------------------------------- summarizer ---
def extractive_summary(text, n=3):
    """Top-n sentences by entity/keyword density (offline default)."""
    sents = _sentences(text)
    if len(sents) <= n:
        return " ".join(sents)
    try:
        from nlp_pipeline import CrimeNerPipeline
        _NER = getattr(extractive_summary, "_ner", None)
        if _NER is None:
            _NER = CrimeNerPipeline(source="own_dataset")
            extractive_summary._ner = _NER
        scored = []
        for s in sents:
            ents = _NER.extract("t", s)["entities"]
            scored.append((len(ents) + 0.2 * len(s.split()), s))
    except Exception:
        freq = Counter(re.findall(r"[a-z]{4,}", text.lower()))
        scored = [(sum(freq[w] for w in re.findall(r"[a-z]{4,}", s.lower())),
                   s) for s in sents]
    top = sorted(range(len(sents)), key=lambda i: -scored[i][0])[:n]
    return " ".join(sents[i] for i in sorted(top))


def abstractive_summary(text, model="facebook/bart-large-cnn"):
    from transformers import pipeline
    pipe = pipeline("summarization", model=model, device=-1,
                    truncation=True)
    out = pipe(text[:4000], max_length=90, min_length=30,
               do_sample=False)[0]["summary_text"]
    # enforce 2-3 sentences
    sents = _sentences(out)[:3]
    return " ".join(sents)


# -------------------------------------------------------------- classifier ---
def keyword_threat(text):
    """Offline default: cue counts -> low/medium/high + confidence."""
    t = text.lower()
    h = sum(1 for c in HIGH_CUES if c in t)
    m = sum(1 for c in MED_CUES if c in t)
    if h >= 1:
        return "high", min(0.95, 0.6 + 0.1 * h)
    if m >= 1:
        return "medium", min(0.85, 0.5 + 0.1 * m)
    return "low", 0.6


def zeroshot_threat(text, model="facebook/bart-large-mnli"):
    from transformers import pipeline
    pipe = pipeline("zero-shot-classification", model=model, device=-1,
                    truncation=True)
    labels = ["violent crime or extortion threat",
              "financial fraud or criminal case",
              "routine or non-threatening matter"]
    r = pipe(text[:2000], labels)
    top = r["labels"][0]
    level = {"violent": "high", "financial": "medium",
             "routine": "low"}[top.split()[0]]
    return level, float(r["scores"][0])


# ------------------------------------------------------------ triple extract ---
def extract_triples(text, source="own_dataset"):
    """Dependency-based (subject, relation, object, location, date).

    Endpoints = spaCy nsubj/dobj (or prep-pobj for passive "spotted with"),
    resolved to PERSON entity spans; location/date from prep children.
    Pronoun/definite-NP subjects resolve to the most recent PERSON seen so
    far across the document (marked coref_resolved=True for review).
    Non-person endpoints are dropped. Output `src` rows feed
    graph_store.load_relationships() directly.
    """
    nlp = _nlp()
    triples, last_person = [], None
    for sent in nlp(text).sents:
        ents = list(sent.ents)
        persons = [e for e in ents if e.label_ == "PERSON"]
        locs = [e for e in ents
                if e.label_ in ("GPE", "LOC", "FAC")]
        dates = [e for e in ents if e.label_ in ("DATE", "TIME")]

        def person_name(tok):
            e = _ent_at(ents, tok, "PERSON")
            if e:
                return e.text
            chunk = next((c for c in sent.noun_chunks
                          if c.start <= tok.i < c.end), None)
            if chunk and chunk.text.lower() in COREF_SUBJ:
                return last_person  # coreference fallback
            return None

        for tok in sent:
            if tok.pos_ != "VERB" or tok.lemma_.lower() not in REL_MAP:
                continue
            rel = REL_MAP[tok.lemma_.lower()]
            head = tok.head if tok.dep_ == "conj" and tok.head.pos_ == "VERB" \
                else tok  # conjoined verbs share the first verb's subject
            subj_t = next((c for c in head.children
                           if c.dep_ in ("nsubj", "nsubjpass")), None)
            obj_t = next((c for c in tok.children
                          if c.dep_ in ("dobj", "dative")), None)
            # pronoun objects ("threatened him") -> most recent PERSON
            obj_coref = False
            if obj_t is not None and obj_t.pos_ == "PRON" \
                    and obj_t.text.lower() in ("him", "her", "them"):
                obj_t = None
                obj_coref = True
            if obj_t is None:  # passive "spotted with X" / "met with X"
                for prep in [c for c in tok.children if c.dep_ == "prep"
                             and c.text.lower() in ("with", "to")]:
                    obj_t = next((c for c in prep.children
                                  if c.dep_ == "pobj"), None)
                    if obj_t and person_name(obj_t):
                        break
                    obj_t = None
            if subj_t is None or (obj_t is None and not obj_coref):
                continue
            subj = person_name(subj_t)
            obj = last_person if obj_coref else person_name(obj_t)
            if not subj or not obj:
                continue
            subj_coref = _ent_at(ents, subj_t, "PERSON") is None
            place = next((p.text for prep in tok.children
                          if prep.dep_ == "prep" and prep.text.lower()
                          in ("at", "near", "in")
                          for p in [next((c for c in prep.children
                                          if c.dep_ == "pobj"), None)]
                          if p and _ent_at(ents, p)), "")
            # phone-fragment guard: spaCy tags digit runs like
            # "98765 43210" as DATE. Real dates contain a month name or
            # separator; pure digit/space strings are phone fragments.
            def _real_date(txt):
                return bool(re.search(r"[A-Za-z]", txt)
                            or re.search(r"[/\-.]", txt))
            attached = [_ent_at(ents, c).text
                        for prep in tok.children if prep.dep_ == "prep"
                        and prep.text.lower() != "at"  # phone fragments
                        for c in prep.subtree
                        if _ent_at(ents, c, "DATE")
                        and _real_date(c.text)]
            if attached:
                date = attached[0]
            else:
                # fallback: sentence-level DATE (verb-attached search
                # misses dates on the matrix clause, e.g. "stated that
                # on 12 March ... Yadav met Sharma").
                date = ""
                for d in reversed(dates):
                    if _real_date(d.text):
                        date = d.text
                        break
            if not place and locs:
                place = locs[-1].text
            key = (subj, rel, obj)
            if not any((t["subject"], t["relation"], t["object"]) == key
                       for t in triples):
                triples.append({
                    "subject": subj, "relation": rel, "object": obj,
                    "location": place, "date": date,
                    "sentence": sent.text.strip(),
                    "coref_resolved": subj_coref or obj_coref,
                    "src": {"src": subj, "dst": obj, "rel": rel,
                            "timestamp": date, "event": place},
                })
        if persons:
            last_person = persons[-1].text
    return triples


# ------------------------------------------------------------------ facade ---
class DocIntel:
    def __init__(self, source="own_dataset"):
        self.source = source

    def summarize(self, text, method="extractive"):
        return abstractive_summary(text) if method == "abstractive" \
            else extractive_summary(text)

    def classify(self, text, method="keyword"):
        level, conf = zeroshot_threat(text) if method == "zeroshot" \
            else keyword_threat(text)
        return {"threat_level": level, "confidence": round(conf, 3),
                "method": method}

    def triples(self, text):
        return extract_triples(text, self.source)

    def process(self, doc_id, text, summary_method="extractive",
                classify_method="keyword"):
        return {"doc_id": doc_id,
                "summary": self.summarize(text, summary_method),
                "classification": self.classify(text, classify_method),
                "triples": self.triples(text)}


FIR_SAMPLE = (
    "FIR No. 102/2024 was registered at Andheri Police Station on the "
    "complaint of Ravi Sharma. The complainant stated that on 12 March 2024, "
    "accused Mohan Yadav met Ravi Sharma near Gateway of India, Mumbai and "
    "threatened him with a pistol. Mohan Yadav demanded Rs. 50,000 on behalf "
    "of Sharma Enterprises and warned of dire consequences. Later, Ravi "
    "Sharma called Mohan Yadav at +91 98765 43210 to negotiate. The police "
    "have registered a case of extortion and criminal intimidation and the "
    "accused was spotted with Anil Verma in Andheri on 15 March 2024."
)

if __name__ == "__main__":
    import json
    d = DocIntel(source="own_dataset")
    print(json.dumps(d.process("fir102", FIR_SAMPLE), indent=2,
                     ensure_ascii=False))
