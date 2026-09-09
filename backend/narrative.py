"""Bounded, evidence-preserving English extraction. No guessed pronoun resolution."""
import re
from datetime import datetime

MAX_TEXT = 500_000
WORD = r"(?!(?:INR|USD|EUR|GBP|Rs)\b)[A-Z][a-zA-Z'’-]+"
NAME = rf"{WORD}(?:[ \t]+{WORD}){{0,3}}"
PLATE = r"[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{4}"
MONEY = r"(?:INR|USD|EUR|GBP|Rs\.?|₹|\$|€|£)\s*[\d,]+(?:\.\d+)?"
VERBS = {
    "called": "CALLED", "phoned": "CALLED", "emailed": "EMAILED",
    "messaged": "CONTACTED", "texted": "CONTACTED", "contacted": "CONTACTED",
    "met": "ASSOCIATE_OF", "knows": "ASSOCIATE_OF", "argued with": "ARGUED_WITH",
    "threatened": "THREATENED", "paid": "FINANCIAL_TRANSFER",
    "transferred to": "FINANCIAL_TRANSFER", "sent money to": "FINANCIAL_TRANSFER",
}


def extract_narrative(text):
    if not text.strip() or len(text) > MAX_TEXT:
        raise ValueError("Provide 1–500,000 characters of English text.")
    records, entities, unresolved = [], {}, []
    def mention(value, kind):
        value = value.strip()
        entities[(value, kind)] = {"text": value, "type": kind}
        return value
    # Keep line numbers and sentences; do not split decimal amounts or Rs. markers.
    for line_no, line in enumerate(text.splitlines(), 1):
        for sentence in re.split(r"(?<=[!?])\s+|(?<!Rs)(?<=\.)\s+(?=[A-Z])", line.strip()):
            if not sentence:
                continue
            if len(sentence) > 5000:
                unresolved.append({"line": line_no, "text": sentence, "reason": "Statement too long; split it into sentences."})
                continue
            original = sentence
            speaker = re.match(rf"^({NAME}):\s*", sentence)
            if speaker:
                sentence = sentence[speaker.end():]
                sentence = re.sub(r"^I\b", speaker[1], sentence)
            dates = re.findall(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} [A-Za-z]+ \d{4}\b", sentence)
            date = ""
            if len(set(dates)) == 1:
                for fmt in ("%Y-%m-%d", "%d %B %Y", "%d %b %Y"):
                    try:
                        date = datetime.strptime(dates[0], fmt).date().isoformat()
                        break
                    except ValueError:
                        pass
            for pattern, kind in [(PLATE, "Vehicle"), (r"(?<!\d)(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)", "Phone"), (r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", "Email")]:
                for m in re.finditer(pattern, sentence):
                    mention(m[0], kind)
            for m in re.finditer(r"\baccount\s+(?:number\s+)?([A-Z0-9-]{6,30})", sentence, re.I):
                mention(m[1], "Account")
            for m in re.finditer(MONEY, sentence, re.I):
                mention(m[0], "Amount")
            for value in dates:
                mention(value, "Date")
            if re.search(r"\b(?:not|never|denied|denies|allegedly|might|may|could|would|if)\b|n't\b|\?", sentence, re.I):
                unresolved.append({"line": line_no, "text": original, "reason": "Negated, conditional, alleged or uncertain statement; no asserted link created."})
                continue
            before = len(records)
            def edge(src, dst, rel, target_type="Person", source_type="Person", payment=None):
                src, dst = mention(src, source_type), mention(dst, target_type)
                payment_amount, payment_currency = "", ""
                if payment:
                    payment_amount = re.sub(r"[^\d.]", "", payment)
                    marker = re.sub(r"[\d,.\s]", "", payment).upper()
                    payment_currency = {"RS": "INR", "₹": "INR", "$": "USD", "€": "EUR", "£": "GBP"}.get(marker, marker)
                attributes = {"extraction": "explicit English statement"}
                method = re.search(r"\b(?:via|by|using)\s+(UPI|cash|NEFT|RTGS|IMPS|bank transfer|card)\b", sentence, re.I)
                reference = re.search(r"\b(?:transaction|reference|receipt)\s*(?:id|number|no\.)?\s*[:#]?\s*([A-Z0-9-]{5,40})", sentence, re.I)
                if method and rel == "FINANCIAL_TRANSFER": attributes["payment_method"] = method[1]
                if reference and rel == "FINANCIAL_TRANSFER": attributes["transaction_reference"] = reference[1]
                if len(set(dates)) > 1: attributes["date_note"] = "Multiple dates in statement; date left unresolved."
                records.append({"src": src, "dst": dst, "src_type": source_type, "dst_type": target_type,
                                "rel": rel, "frequency": 1, "date": date,
                                "amount": payment_amount,
                                "currency": payment_currency,
                                "evidence": original, "source_rows": [line_no], "attributes": attributes})
            for m in re.finditer(rf"\b({NAME})\s+({'|'.join(VERBS)})\s+({NAME})", sentence):
                payment = re.match(rf"\s*({MONEY})", sentence[m.end():], re.I) if VERBS[m[2]] == "FINANCIAL_TRANSFER" else None
                edge(m[1], m[3], VERBS[m[2]], payment=payment[1] if payment else None)
            # Payments with the amount between sender and recipient.
            for m in re.finditer(rf"\b({NAME})\s+(?:paid|sent|transferred)\s+({MONEY})\s+to\s+({NAME})", sentence):
                edge(m[1], m[3], "FINANCIAL_TRANSFER", payment=m[2])
            for m in re.finditer(rf"\b({NAME})\s+received\s+({MONEY})\s+from\s+({NAME})", sentence):
                edge(m[3], m[1], "FINANCIAL_TRANSFER", payment=m[2])
            for m in re.finditer(rf"\b({NAME})\s+(owns|owned|drove|drives|used|uses)\s+(?:(?:a|the|vehicle|car|bike|number|registration)\s+)*({PLATE})\b", sentence):
                edge(m[1], m[3], "OWNS_VEHICLE" if m[2] in ("owns", "owned") else "USED_VEHICLE", "Vehicle")
            for m in re.finditer(rf"\b({NAME})\s+(?:uses|used|owns|has)\s+(?:phone|mobile|number)\s+((?:\+91[ -]?)?[6-9]\d{{4}}[ -]?\d{{5}})\b", sentence):
                edge(m[1], m[2], "HAS_PHONE", "Phone")
            for m in re.finditer(rf"\b({NAME})\s+(?:uses|used|owns|has)\s+(?:bank\s+)?account\s+(?:number\s+)?([A-Z0-9-]{{6,30}})\b", sentence):
                edge(m[1], m[2], "HAS_ACCOUNT", "Account")
            for m in re.finditer(rf"\b({NAME})\s+(?:lives|resides|is registered)\s+(?:at|in)\s+({NAME})", sentence):
                edge(m[1], m[2], "REGISTERED_AT", "Location")
            for m in re.finditer(rf"\b({NAME})\s+(?:visited|was at|arrived at)\s+({NAME})", sentence):
                edge(m[1], m[2], "VISITED", "Location")
            for m in re.finditer(rf"\b({NAME})\s+(?:works for|is employed by)\s+({NAME})", sentence):
                edge(m[1], m[2], "WORKS_FOR", "Organization")
            if len(records) == before:
                unresolved.append({"line": line_no, "text": original, "reason": "No explicit supported relationship found. Retained for review."})
            if len(records) > 10000:
                raise ValueError("More than 10,000 relationships extracted. Split this evidence into smaller cases.")
    return {"records": records, "entities": list(entities.values()), "unresolved": unresolved,
            "source_text": text, "warnings": ["English rule-based extraction has limited coverage. Review candidate links; unresolved text and standalone identifiers remain in the report. Pronouns are not resolved except I under an explicit speaker label."]}
