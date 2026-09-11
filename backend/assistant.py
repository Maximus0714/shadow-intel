"""Structured evidence questions with conjunctive filters and cited answers."""
import re
from collections import defaultdict, deque
from decimal import Decimal, InvalidOperation

from .timeline import _parse_date

VERBS = {
    "CALLED": "called", "CONTACTED": "contacted", "EMAILED": "emailed",
    "FINANCIAL_TRANSFER": "transferred money to", "OWNS_VEHICLE": "owns vehicle",
    "USED_VEHICLE": "used vehicle", "HAS_PHONE": "has phone",
    "HAS_ACCOUNT": "has account", "VISITED": "visited", "REGISTERED_AT": "is registered at",
    "WORKS_FOR": "works for", "ASSOCIATE_OF": "is associated with", "FAMILY_OF": "is family of",
    "CO_LOCATED": "was co-located with", "ARGUED_WITH": "argued with", "THREATENED": "threatened",
}
RELATION_INTENTS = [
    (r"\b(pay\w*|paid|transfer\w*|money|amount|transaction\w*|receiv\w*|sent|send)\b", {"FINANCIAL_TRANSFER"}),
    (r"\b(call\w*|phoned|rang)\b", {"CALLED"}),
    (r"\b(email\w*|mailed)\b", {"EMAILED"}),
    (r"\b(message\w*|messag\w*|texted)\b", {"CONTACTED"}),
    (r"\b(contact\w*|communicat\w*)\b", {"CALLED", "CONTACTED", "EMAILED"}),
    (r"\b(vehicle\w*|cars?|plates?|driv\w*|drove|owns?|owned)\b", {"OWNS_VEHICLE", "USED_VEHICLE"}),
    (r"\b(locations?|places?|visits?|visited|address\w*|where)\b", {"VISITED", "REGISTERED_AT", "CO_LOCATED"}),
    (r"\b(phones?|mobiles?)\b", {"HAS_PHONE"}),
    (r"\b(accounts?)\b", {"HAS_ACCOUNT"}),
    (r"\b(employ\w*|works?|worked|organizations?|companies|company)\b", {"WORKS_FOR"}),
    (r"\b(threat\w*)\b", {"THREATENED"}),
    (r"\b(argu\w*|fought|conflict\w*)\b", {"ARGUED_WITH"}),
    (r"\b(family|relative\w*)\b", {"FAMILY_OF"}),
    (r"\b(associate\w*|knows?|knew|met|accompanied)\b", {"ASSOCIATE_OF"}),
]
METHOD = "Structured case query: entity, relationship, direction and date constraints must all match. Counts use every matching record. Answers are computed from records, without an external language model."


def _citation(index, row):
    return {"record": index, **{key: row.get(key, "") for key in ("src", "dst", "rel", "date", "amount", "currency")},
            "frequency": row.get("frequency", 1), "source_rows": row.get("source_rows", []),
            "source_page": row.get("attributes", {}).get("source_page", ""),
            "source_file": row.get("attributes", {}).get("source_file", ""),
            "excerpt": row.get("evidence", "")[:500]}


def _result(answer, rows=(), *, status=None, named=(), path=(), path_directed=False, warnings=(), facts=(), interpretation=""):
    return {"answer": answer, "status": status or ("supported" if rows else "not_found"),
            "entities_recognized": list(named), "path": list(path), "path_directed": path_directed,
            "citations": [_citation(i, r) for i, r in rows[:50]],
            "matched_records": len(rows), "citations_truncated": len(rows) > 50,
            "facts": list(facts), "warnings": list(warnings), "interpretation": interpretation,
            "method": METHOD, "limitations": "These answers describe supplied records. They cannot establish motive, guilt or the truth of a source. No matching record does not prove that an event never happened."}


def _entity_matches(entities, question):
    """Whole names first; accept unique short names and surface ambiguity."""
    occupied, matches, ambiguous = [], [], []
    for entity in sorted(entities, key=lambda value: (-len(value), value)):
        for match in re.finditer(r"(?<!\w)" + re.escape(entity) + r"(?!\w)", question, re.I):
            if not any(match.start() < end and match.end() > start for start, end in occupied):
                matches.append((match.start(), match.end(), entity))
                occupied.append(match.span())
    aliases = defaultdict(set)
    for entity in entities:
        for token in re.findall(r"[\w'-]+", entity):
            if len(token) >= 3:
                aliases[token.casefold()].add(entity)
    common = {"account", "phone", "vehicle", "bank", "road", "street", "records", "company", "limited"}
    for token in re.finditer(r"[\w'-]+", question):
        if any(token.start() < end and token.end() > start for start, end in occupied):
            continue
        candidates = aliases.get(token[0].casefold(), set())
        if token[0].casefold() in common:
            continue
        if len(candidates) == 1:
            matches.append((token.start(), token.end(), next(iter(candidates))))
        elif len(candidates) > 1:
            ambiguous.append((token[0], sorted(candidates)))
    return sorted(matches), ambiguous


def _path(indexed, start, end, directed=False):
    adjacency = defaultdict(list)
    for index, row in indexed:
        adjacency[row["src"]].append((row["dst"], index))
        if not directed:
            adjacency[row["dst"]].append((row["src"], index))
    queue, visited = deque([(start, [start], [])]), {start}
    while queue:
        node, nodes, ids = queue.popleft()
        if node == end:
            return nodes, ids
        if len(ids) == 4:
            continue
        for target, index in adjacency[node]:
            if target not in visited:
                visited.add(target)
                queue.append((target, nodes + [target], ids + [index]))
    return [], []


def _date_filter(question):
    iso = list(re.finditer(r"\b\d{4}-\d{2}-\d{2}\b", question))
    if not iso:
        return None, ""
    dates = [_parse_date(match[0]) for match in iso]
    if any(date is None for date in dates):
        return None, "A date in the question is invalid. Use YYYY-MM-DD."
    days = [date.date() for date in dates]
    if len(days) == 2 and re.search(r"\b(between|from)\b", question, re.I):
        if days[0] > days[1]:
            return None, "The start date is after the end date."
        return lambda value: days[0] <= value <= days[1], ""
    if len(days) != 1:
        return None, "Use one date, or a range such as from 2026-08-01 to 2026-08-31."
    prefix = question[:iso[0].start()].lower()
    if re.search(r"\b(before|earlier than)\s*$", prefix):
        return lambda value: value < days[0], ""
    if re.search(r"\b(after|later than)\s*$", prefix):
        return lambda value: value > days[0], ""
    if re.search(r"\b(since|from)\s*$", prefix):
        return lambda value: value >= days[0], ""
    return lambda value: value == days[0], ""


def _fact(index, row):
    if row["rel"] == "FINANCIAL_TRANSFER" and row.get("amount"):
        connection = f"transferred {row.get('currency') or '(currency unspecified)'} {row['amount']} to"
    else:
        connection = VERBS.get(row["rel"], row["rel"].replace("_", " ").lower())
    date = f" on {row['date']}" if row.get("date") else "; date not supplied"
    return f"{row['src']} {connection} {row['dst']}{date}; recorded frequency {row.get('frequency', 1)}. [Record {index}]"


def answer_question(records, question):
    question = question.strip()
    if not question:
        raise ValueError("Ask a question about the current investigation.")
    entities = {str(row[key]) for row in records for key in ("src", "dst")}
    matches, ambiguous = _entity_matches(entities, question)
    named = list(dict.fromkeys(entity for _, _, entity in matches))
    lower = question.casefold()
    if ambiguous:
        token, candidates = ambiguous[0]
        return _result(f"“{token}” matches several entities: {', '.join(candidates[:10])}. Use the full name or identifier.", status="clarification", named=named)
    masked = list(lower)
    for start, end, _ in matches:
        masked[start:end] = " " * (end-start)
    intent = "".join(masked)
    if re.search(r"\b(why|motive|guilty|guilt|criminal|culprit|arrest|predict|innocent)\b", intent):
        return _result("The records cannot establish motive, guilt or a prediction. Ask about a documented action, a connection, or a payment instead.", status="unsupported", named=named)
    relations = set()
    for pattern, values in RELATION_INTENTS:
        if re.search(pattern, intent):
            relations.update(values)
    if re.search(r"\b(owns?|owned)\b", intent) and "USED_VEHICLE" in relations:
        relations.discard("USED_VEHICLE")
    elif re.search(r"\b(used|drove|drives?|driven)\b", intent) and "OWNS_VEHICLE" in relations:
        relations.discard("OWNS_VEHICLE")
    date_test, date_error = _date_filter(question)
    if date_error:
        return _result(date_error, status="clarification", named=named)
    if not date_test and re.search(r"\b(yesterday|today|last|before|after|since|during|january|february|march|april|may|june|july|august|september|october|november|december)\b|\d{1,2}/\d", intent):
        return _result("Please specify the date or range as YYYY-MM-DD, for example “payments after 2026-08-03”.", status="clarification", named=named)
    wants_path = bool(re.search(r"\b(path\w*|connect\w*|link\w*|related)\b", intent)) and len(named) >= 2
    summary = bool(re.search(r"\b(summari[sz]e|summary|overview)\b", intent))
    count = bool(re.search(r"\b(how many|how often|how much|total|sum|count)\b", intent))
    # Unknown constraints must never be silently dropped, even when a name matches.
    understood = r"\b(show|list|find|tell|give|can|you|about|who|whom|when|where|did|does|has|have|was|were|is|are|what|which|how|many|much|often|times|total|sum|count|all|everything|the|a|an|and|or|to|from|of|by|for|me|please|evidence|records?|history|involving|involved|between|on|in|before|after|since|connections?|relationships?|connected|related|paths?|links?|directed|direct|outgoing|incoming|received|receive|sent|send|use|uses|used|driven|activities|activity|events?|happen\w*|information|info|details|investigation|case|summary|summarize|summarise|overview|appear|appears|earlier|later|than|belongs?|belonging)\b"
    remainder = intent
    for pattern, _ in RELATION_INTENTS:
        remainder = re.sub(pattern, " ", remainder)
    remainder = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", remainder)
    remainder = re.sub(understood, " ", remainder)
    unknown = re.findall(r"\b[\w]+\b", remainder)
    if unknown:
        return _result(f"I cannot reliably interpret “{' '.join(unknown[:8])}” as a case filter. Use an entity and a documented relationship, such as “Who called Asha Rao?” or “How much did Asha Rao pay Kabir Shah?”.", status="unsupported", named=named)
    if not (named or relations or date_test or summary):
        return _result("Specify an entity, relationship or date. You can ask “Show payment records” or “Summarize the case”.", status="clarification")
    indexed = [(index, row) for index, row in enumerate(records, 1)
               if (not relations or row["rel"] in relations)
               and (not date_test or ((date := _parse_date(row.get("date", ""))) and date_test(date.date())))]
    if wants_path:
        directed = bool(re.search(r"\b(directed|outgoing)\b", intent))
        start, end = named[0], named[1]
        if directed:
            for position, _, entity in matches:
                prefix = lower[:position].strip()
                if re.search(r"\bfrom\s*$", prefix):
                    start = entity
                elif re.search(r"\bto\s*$", prefix):
                    end = entity
        nodes, ids = _path(indexed, start, end, directed)
        if not nodes:
            return _result(f"No {'directed ' if directed else ''}path of four or fewer connections from {start} to {end} matches these filters.", named=named)
        by_id = dict(indexed)
        rows = [(index, by_id[index]) for index in ids]
        return _result(f"{'Directed path' if directed else 'Connection path'}: {' → '.join(nodes) if directed else ' ↔ '.join(nodes)} ({len(ids)} links).",
                       rows, named=named, path=nodes, path_directed=directed, facts=[_fact(i, r) for i, r in rows],
                       warnings=[] if directed else ["This path follows connections in either direction. Cited records retain their actual source → target direction."])
    source, target = None, None
    if named:
        if relations:
            first_start, first_end, first = matches[0]
            before, after = lower[:first_start].strip(), lower[first_end:].strip()
            receiving = bool(re.search(r"\b(receiv\w*|incoming)\b", intent))
            ownership = bool(relations <= {"HAS_PHONE", "HAS_ACCOUNT", "OWNS_VEHICLE", "USED_VEHICLE", "WORKS_FOR", "REGISTERED_AT", "VISITED"})
            if ownership and re.search(r"\b(of|for|belongs?\s+to)\s*$", before):
                source = first
            elif receiving and not re.search(r"\b(from|by)\s*$", before):
                target = first
                source = named[1] if len(named) > 1 else None
            elif re.search(r"\b(to|called|phoned|emailed|contacted|messaged|paid|threatened|visited)\s*$", before) and not re.search(r"\b(who did|whom did)\b", before):
                target = first
            elif re.search(r"\b(from|by)\s*$", before) or re.match(r"(?:'s\s+)?(?:pay\w*|paid|send|sent|transfer\w*|call\w*|contact\w*|emailed|threatened|visited|owns?|uses?|used|drove)\b", after) or re.search(r"\b(who did|whom did)\b", before):
                source = first
            if len(named) == 2:
                if source == first:
                    target = named[1]
                elif target == first:
                    source = named[1]
        indexed = [(i, r) for i, r in indexed if all(entity in (r["src"], r["dst"]) for entity in named)
                   and (source is None or r["src"] == source) and (target is None or r["dst"] == target)]
    interpretation = "; ".join(filter(None, [f"Entities: {', '.join(named)}" if named else "",
        f"Relationships: {', '.join(sorted(relations))}" if relations else "", f"From {source}" if source else "",
        f"To {target}" if target else "", "Date filter applied; undated rows excluded" if date_test else ""]))
    if not indexed:
        return _result("No source records match all of those conditions in this investigation.", named=named, interpretation=interpretation)
    warnings = []
    frequency = sum(int(row.get("frequency", 1)) for _, row in indexed)
    facts = [_fact(index, row) for index, row in indexed[:8]]
    if count and relations == {"FINANCIAL_TRANSFER"} and re.search(r"\b(how much|total|sum|amount)\b", intent):
        totals, missing = defaultdict(Decimal), 0
        for _, row in indexed:
            try:
                amount = Decimal(str(row.get("amount", "")).replace(",", ""))
                if not amount.is_finite() or amount < 0 or not row.get("currency"):
                    raise InvalidOperation
                totals[str(row["currency"]).upper()] += amount
            except InvalidOperation:
                missing += 1
        answer = "Recorded amount totals: " + "; ".join(f"{currency} {amount:,.2f}" for currency, amount in sorted(totals.items())) + "." if totals else "No complete amount-and-currency values are available for a reliable total."
        answer += f" {len(indexed)} matching source records."
        warnings.append("Each record's amount is counted once. Frequency is not multiplied into money; the source does not define whether an amount is per transfer or an aggregate.")
        if missing:
            warnings.append(f"{missing} record(s) with missing/invalid amount or currency excluded from totals.")
    elif count:
        answer = f"{frequency:,} recorded interactions across {len(indexed):,} matching source records."
        warnings.append("Frequency is the count supplied in each record, not a count of independently verified events. Duplicate records can inflate totals.")
    elif summary:
        answer = f"The matching evidence contains {len(indexed)} records, {len({r[k] for _, r in indexed for k in ('src', 'dst')})} entities and {len({r['rel'] for _, r in indexed})} relationship types."
    else:
        answer = "\n".join(facts)
        if len(indexed) > 8:
            answer += f"\nShowing 8 of {len(indexed)} matching records. Narrow the entity or date to see a smaller set."
    return _result(answer, indexed, named=named, warnings=warnings, facts=facts if count or summary else [], interpretation=interpretation)
