"""Evidence-preserving English extraction from loosely structured narratives."""
import re
from datetime import datetime

MAX_TEXT = 500_000
WORD = r"(?!(?:INR|USD|EUR|GBP|Rs|The|A|An|He|She|They|It|His|Her|Their)\b)[A-Z][a-zA-Z'’-]+"
NAME = rf"{WORD}(?:[ \t]+{WORD}){{0,3}}"
PERSON = rf"(?:{NAME}|he|she|him|her|they|them)"
PLATE = r"[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{4}"
PHONE = r"(?<!\d)(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)"
EMAIL = r"[\w.+-]+@[\w.-]+\.[a-z]{2,}"
MONEY = r"(?:INR|USD|EUR|GBP|Rs\.?|₹|\$|€|£)\s*[\d,]+(?:\.\d+)?"
COUNT_WORDS = {"once": 1, "twice": 2, "thrice": 3, "one": 1, "two": 2,
               "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
               "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
               "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
               "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20}
DATE = r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}\b"
VERBS = {
    "called":"CALLED", "phoned":"CALLED", "rang":"CALLED", "telephoned":"CALLED",
    "emailed":"EMAILED", "mailed":"EMAILED", "messaged":"CONTACTED", "texted":"CONTACTED",
    "contacted":"CONTACTED", "spoke to":"CONTACTED", "talked to":"CONTACTED", "chatted with":"CONTACTED",
    "met with":"ASSOCIATE_OF", "met":"ASSOCIATE_OF", "knows":"ASSOCIATE_OF", "knew":"ASSOCIATE_OF",
    "worked with":"ASSOCIATE_OF", "travelled with":"ASSOCIATE_OF", "traveled with":"ASSOCIATE_OF",
    "accompanied":"ASSOCIATE_OF", "argued with":"ARGUED_WITH", "fought with":"ARGUED_WITH",
    "threatened":"THREATENED", "warned":"THREATENED", "paid":"FINANCIAL_TRANSFER",
    "transferred to":"FINANCIAL_TRANSFER", "sent money to":"FINANCIAL_TRANSFER", "gave money to":"FINANCIAL_TRANSFER",
}
UNCERTAIN = r"\b(?:not|never|denied|denies|alleged(?:ly)?|reportedly|apparently|possibly|probably|suspected|claims?|might|may|could|would|perhaps|if|whether|rumou?red)\b|n't\b|\?"

def _date(raw):
    raw = re.sub(r"(\d)(?:st|nd|rd|th)\b", r"\1", raw.strip(), flags=re.I)
    for fmt in ("%Y-%m-%d","%d/%m/%Y","%d-%m-%Y","%d/%m/%y","%d-%m-%y","%d %B %Y","%d %b %Y"):
        try: return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError: pass
    return ""

def _money(raw):
    amount = re.sub(r"[^\d.]", "", raw)
    marker = re.sub(r"[\d,.\s]", "", raw).upper().replace(".", "")
    return amount, {"RS":"INR","₹":"INR","$":"USD","€":"EUR","£":"GBP"}.get(marker, marker)

def extract_narrative(text):
    if not text.strip() or len(text) > MAX_TEXT: raise ValueError("Provide 1–500,000 characters of English text.")
    records, entities, unresolved = [], {}, []
    context = {"person":"", "people":[], "asset":""}
    def frequency_for(sentence, after=0):
        tail = sentence[after:]
        pattern = r"\b(\d{1,6}|" + "|".join(COUNT_WORDS) + r")\s*(?:times?|calls?|messages?|emails?|visits?|payments?|transfers?)\b|\b(once|twice|thrice)\b"
        match = re.search(pattern, tail, re.I)
        if not match:
            return 1
        raw = (match.group(1) or match.group(2)).lower()
        return max(1, min(1_000_000, int(raw) if raw.isdigit() else COUNT_WORDS[raw]))
    def split_frequency(value):
        pattern = r"\s+(\d{1,6}|" + "|".join(COUNT_WORDS) + r")\s*(?:times?|calls?|messages?|emails?|visits?|payments?|transfers?)\s*$|\s+(once|twice|thrice)\s*$"
        match = re.search(pattern, value, re.I)
        if not match:
            return value, 1
        raw = (match.group(1) or match.group(2)).lower()
        return value[:match.start()].strip(), max(1, min(1_000_000, int(raw) if raw.isdigit() else COUNT_WORDS[raw]))
    type_priority = {"Person": 10, "Organization": 70, "Location": 80,
                     "Vehicle": 100, "Phone": 100, "Account": 100,
                     "Email": 100, "Amount": 110, "Date": 110}
    ignored_mentions = {"me", "i", "we", "they", "them", "he", "she", "it",
                        "the", "a", "an", "register", "records", "record"}
    def mention(value, kind):
        value = re.sub(r"\s+", " ", value.strip(" ,.;:()[]\"'"))
        if value and value.casefold() not in ignored_mentions:
            key = value.casefold()
            old = entities.get(key)
            # A broad relationship pattern may first see an organisation or
            # place as a generic Person. Keep one canonical mention and let a
            # typed identifier/relationship correct it later.
            if not old or type_priority.get(kind, 0) >= type_priority.get(old["type"], 0):
                entities[key] = {"text":value,"type":kind}
                # A generic pattern may have emitted “Riverside” as a person
                # before a later typed mention identifies “Riverside Cafe” as
                # a location. Remove the shorter false type in that case.
                if kind == "Location":
                    for old_key, old_value in list(entities.items()):
                        if (old_key != key and old_value["type"] == "Person"
                                and key.startswith(old_key + " ")):
                            del entities[old_key]
        return value
    def resolve(value):
        # Relationship regexes intentionally run case-insensitively so they can
        # understand prose verbs. That also means NAME may capture sentence
        # glue (for example “records that Dev Shah”). Keep only the trailing
        # run of genuinely name-like tokens before adding a graph node.
        value = re.sub(r"\s+", " ", value.strip())
        # Remove payment methods, dates and other qualifiers before choosing
        # the title-cased name span. Otherwise a trailing acronym such as NEFT
        # can be mistaken for the recipient.
        value = re.sub(r"\s+(?:on|at|via|through|using|for|about|regarding)\b.*$", "", value, flags=re.I)
        tokens = value.split()
        title = [i for i, token in enumerate(tokens)
                 if re.fullmatch(r"[A-Z][a-zA-Z'’\-]*", token)]
        if title:
            # Prefer the last contiguous title-cased span, capped at four words.
            end = title[-1]
            start = end
            while start > 0 and re.fullmatch(r"[A-Z][a-zA-Z'’\-]*", tokens[start - 1]) and end - start < 3:
                start -= 1
            value = " ".join(tokens[start:end + 1])
        value = re.sub(r"^(?:then|later|afterwards)\s+", "", value.strip(), flags=re.I)
        if re.fullmatch(r"(?:he|she|him|her|his|hers|me|my|mine|us|our|ours)", value, re.I): return context["person"] or value
        if re.fullmatch(r"(?:they|them|their|theirs)", value, re.I): return context["people"][-1] if context["people"] else value
        if re.fullmatch(r"(?:it|its|the vehicle|the car|the account|the phone)", value, re.I): return context["asset"] or value
        return value
    def attrs(sentence, dates):
        out = {"extraction":"explicit English statement","confidence":"high"}
        patterns = {
            "channel_or_method":r"\b(?:via|through|by|using|in)\s+(UPI|cash|NEFT|RTGS|IMPS|bank transfer|wire transfer|credit card|debit card|card|cheque|check|cryptocurrency|bitcoin)\b",
            "reference":r"\b(?:transaction|reference|receipt|UTR|invoice|case|FIR)\s*(?:id|number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9/-]{4,40})",
            "time":r"\b(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b",
            "duration":r"\bfor\s+(\d+(?:\.\d+)?\s+(?:minutes?|hours?|days?|weeks?|months?))\b",
        }
        for key, pattern in patterns.items():
            match = re.search(pattern, sentence, re.I)
            if match: out[key] = match[1]
        purpose = re.search(r"\b(?:for|regarding|about)\s+([^,.;]{3,100})", sentence, re.I)
        if purpose: out["stated_context"] = purpose[1].strip()
        if len(set(dates)) > 1: out["date_note"] = "Multiple dates in statement; date left unresolved."
        return out
    def edge(src,dst,rel,sentence,original,line_no,dates,target_type="Person",source_type="Person",payment=None,extra=None,frequency=1):
        # Reject a regex capture that crossed a compound-clause boundary, for
        # example “Northstar Trading and has” in “Kabir ... and has used a car”.
        if re.search(r"\b(?:and|but|that)\s+(?:has|had|is|was|then)\b", str(src), re.I):
            return
        src,dst = resolve(src),resolve(dst)
        pronouns={"he","she","they","him","her","them","it","me","my","mine","us","our","ours"}
        glue={"and","that","four","times","time","day","days","same","later","records","record","according","one","source","account","payment","payments","the","this","these","who","what","with","from","into"}
        if (not src or not dst or src.casefold()==dst.casefold() or src.lower() in pronouns or dst.lower() in pronouns
                or any(token.casefold() in glue for token in src.split())
                or any(token.casefold() in glue for token in dst.split())): return
        src,dst=mention(src,source_type),mention(dst,target_type)
        amount,currency=_money(payment) if payment else ("","")
        date=_date(dates[0]) if len(set(dates))==1 else ""
        attributes=attrs(sentence,dates)
        if extra: attributes.update({k:str(v) for k,v in extra.items() if v})
        signature=(src.casefold(),dst.casefold(),rel,date,amount)
        if signature in sentence_seen:return
        sentence_seen.add(signature)
        records.append({"src":src,"dst":dst,"src_type":source_type,"dst_type":target_type,"rel":rel,"frequency":frequency,"date":date,"amount":amount,"currency":currency,"evidence":original,"source_rows":[line_no],"attributes":attributes})
        if source_type=="Person": context["person"]=src;context["people"].append(src)
        if target_type=="Person":context["people"].append(dst)
        elif target_type in {"Vehicle","Phone","Account","Email"}:context["asset"]=dst

    for line_no,line in enumerate(text.splitlines(),1):
        for original in filter(None,re.split(r"(?<=[!?])\s+|(?<!Rs)(?<=\.)\s+(?=[A-Z])",line.strip())):
            sentence_seen=set()
            if len(original)>5000:
                unresolved.append({"line":line_no,"text":original,"reason":"Statement too long; split it into shorter sentences."});continue
            sentence=original
            speaker=re.match(rf"^({NAME}):\s*",sentence)
            if speaker:
                context["person"]=speaker[1];sentence=sentence[speaker.end():]
                sentence=re.sub(r"^(?:I|we)\b",speaker[1],sentence,flags=re.I)
            dates=re.findall(DATE,sentence,re.I)
            identifiers=[(PLATE,"Vehicle"),(PHONE,"Phone"),(EMAIL,"Email"),(r"(?<!\w)@[A-Za-z0-9_.-]{2,32}","Account"),(r"\b(?:https?://|www\.)\S+","Account"),(r"\b(?:account|a/c)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9-]{6,34})","Account"),(r"\b(?:IMEI|device id|passport|PAN|Aadhaar|license|licence)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9-]{5,40})","Account")]
            for pattern,kind in identifiers:
                for m in re.finditer(pattern,sentence,re.I):mention(m[1] if m.lastindex else m[0],kind)
            for m in re.finditer(MONEY,sentence,re.I):mention(m[0],"Amount")
            for value in dates:mention(value,"Date")
            if re.search(UNCERTAIN,sentence,re.I):
                unresolved.append({"line":line_no,"text":original,"reason":"Negated, conditional, alleged or uncertain statement; no asserted link created."});continue
            before=len(records)
            verb_pattern="|".join(sorted(map(re.escape,VERBS),key=len,reverse=True))
            for m in re.finditer(rf"\b({PERSON})\s+({verb_pattern})\s+({PERSON})\b",sentence,re.I):
                rel=VERBS[m[2].lower()]; target, count = split_frequency(m[3]); count = max(count, frequency_for(sentence)); money=re.match(rf"\s*({MONEY})",sentence[m.end():],re.I) if rel=="FINANCIAL_TRANSFER" else None
                edge(m[1],target,rel,sentence,original,line_no,dates,payment=money[1] if money else None,frequency=count)
            payments=[(rf"\b({PERSON})(?:\s+then)?\s+(?:paid|sent|transferred|gave)\s+({MONEY})\s+(?:to\s+)?({PERSON})",(1,3,2)),(rf"\b({PERSON})(?:\s+then)?\s+received\s+({MONEY})\s+from\s+({PERSON})",(3,1,2)),(rf"\b(?:a\s+)?(?:payment|transfer)\s+of\s+({MONEY})\s+(?:was\s+)?(?:made|sent|transferred)?\s*from\s+({PERSON})\s+to\s+({PERSON})",(2,3,1)),(rf"\b({PERSON})\s+was\s+paid\s+({MONEY})\s+by\s+({PERSON})",(3,1,2))]
            for pattern,groups in payments:
                for m in re.finditer(pattern,sentence,re.I):edge(m[groups[0]],m[groups[1]],"FINANCIAL_TRANSFER",sentence,original,line_no,dates,payment=m[groups[2]],frequency=frequency_for(sentence,m.end()))
            for m in re.finditer(rf"\b({NAME})\s+and\s+({NAME})\s+(?:met|spoke|talked|communicated|worked|travelled|traveled)\b",sentence):edge(m[1],m[2],"ASSOCIATE_OF",sentence,original,line_no,dates)
            for m in re.finditer(rf"\b({PERSON})\s+is\s+associated\s+with\s+({PERSON})\b", sentence, re.I):
                edge(m[1], m[2], "ASSOCIATE_OF", sentence, original, line_no, dates)
            for m in re.finditer(rf"\b({PERSON})\s+and\s+({PERSON})\s+(?:are|were)\s+family\b", sentence, re.I):
                edge(m[1], m[2], "FAMILY_OF", sentence, original, line_no, dates)
            for m in re.finditer(rf"\b({PERSON})\s+led\s+(?:a\s+)?delivery\s+to\s+({NAME})\b", sentence, re.I):
                edge(m[1], m[2], "VISITED", sentence, original, line_no, dates, "Location")
            for m in re.finditer(rf"\b({NAME})\s+is\s+associated\s+with\s+({NAME})\s+and\s+has\s+used\s+(?:(?:a|the|vehicle|car)\s+)*({PLATE})\b",sentence):
                edge(m[1],m[2],"ASSOCIATE_OF",sentence,original,line_no,dates)
                edge(m[1],m[3],"USED_VEHICLE",sentence,original,line_no,dates,"Vehicle")
            for m in re.finditer(rf"\b({PERSON})\s+(owns?|owned|registered|drove|drives|used|uses|rented|hired|bought|purchased|sold)\s+(?:(?:a|the|vehicle|car|bike|number|registration)\s+)*({PLATE})\b",sentence,re.I):
                rel="OWNS_VEHICLE" if m[2].lower() in {"own","owns","owned","registered","bought","purchased"} else "USED_VEHICLE"
                edge(m[1],m[3],rel,sentence,original,line_no,dates,"Vehicle",extra={"vehicle_action":m[2]},frequency=frequency_for(sentence,m.end()))
            for m in re.finditer(rf"\b(?:vehicle|car|bike)\s+({PLATE})\s+was\s+(?:driven|used|rented|hired)\s+by\s+({PERSON})",sentence,re.I):edge(m[2],m[1],"USED_VEHICLE",sentence,original,line_no,dates,"Vehicle",frequency=frequency_for(sentence,m.end()))
            for m in re.finditer(rf"\b(?:vehicle|car|bike)\s+({PLATE})\s+(?:visited|went\s+to|travelled\s+to|traveled\s+to|arrived\s+at|was\s+seen\s+at)\s+({NAME})", sentence, re.I):
                target, count = split_frequency(m[2])
                edge(m[1], target, "VISITED", sentence, original, line_no, dates, "Location", "Vehicle", frequency=count)
            for m in re.finditer(rf"\b(?:vehicle|car|bike)\s+({PLATE})\s+(?:is|was)\s+registered\s+(?:at|in)\s+({NAME})", sentence, re.I):
                edge(m[1], m[2], "REGISTERED_AT", sentence, original, line_no, dates, "Location", "Vehicle")
            for m in re.finditer(rf"\b({PERSON})\s+(?:uses?|used|owns?|owned|has|had|called\s+from)\s+(?:(?:the|a)\s+)?(?:(?:phone|mobile|telephone)(?:\s+number)?|number)?\s*({PHONE})\b",sentence,re.I):edge(m[1],m[2],"HAS_PHONE",sentence,original,line_no,dates,"Phone",frequency=frequency_for(sentence,m.end()))
            for m in re.finditer(rf"\b({PERSON})\s+(?:uses?|used|owns?|owned|has|had|operates?)\s+(?:(?:the|a|bank)\s+)?(?:account|a/c)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9-]{{6,34}})\b",sentence,re.I):edge(m[1],m[2],"HAS_ACCOUNT",sentence,original,line_no,dates,"Account",frequency=frequency_for(sentence,m.end()))
            for m in re.finditer(rf"\b({PERSON})\s+(?:uses?|used|owns?|owned|has|had)\s+(?:the\s+)?(?:email|email address)\s+({EMAIL})",sentence,re.I):edge(m[1],m[2],"HAS_ACCOUNT",sentence,original,line_no,dates,"Email")
            for m in re.finditer(rf"\b({PERSON})\s+(?:lives?|lived|resides?|resided|stays?|stayed|is registered|was registered)\s+(?:at|in|near)\s+({NAME})",sentence,re.I):edge(m[1],m[2],"REGISTERED_AT",sentence,original,line_no,dates,"Location")
            for m in re.finditer(rf"\b({PERSON})\s+(?:visited|went to|travelled to|traveled to|arrived at|left from|was seen at|was present at)\s+({NAME})",sentence,re.I):
                target, count = split_frequency(m[2]); edge(m[1],target,"VISITED",sentence,original,line_no,dates,"Location",frequency=count)
            for m in re.finditer(rf"\b({PERSON})\s+(?:works?|worked|is employed|was employed)\s+(?:for|at|by)\s+({NAME})",sentence,re.I):edge(m[1],m[2],"WORKS_FOR",sentence,original,line_no,dates,"Organization")
            for m in re.finditer(rf"\b({NAME})\s+and\s+({NAME})\s+(?:were|was)\s+(?:seen|present|located)\s+(?:at|in)\s+({NAME})",sentence):
                edge(m[1],m[2],"CO_LOCATED",sentence,original,line_no,dates,extra={"location":m[3]});mention(m[3],"Location")
            if len(records)==before:unresolved.append({"line":line_no,"text":original,"reason":"No sufficiently explicit supported relationship found. Retained for review."})
            if len(records)>10_000:raise ValueError("More than 10,000 relationships extracted. Split this evidence into smaller cases.")
    return {"records":records,"entities":list(entities.values()),"unresolved":unresolved,"source_text":text,"warnings":["Automatic English extraction is broad but not perfect. Review every candidate link. Uncertain statements remain unlinked; short pronouns resolve only from nearby explicit context."]}
