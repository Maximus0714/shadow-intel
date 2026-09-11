"""Chronological evidence without invented times or unrelated same-day clusters."""
from collections import defaultdict
from datetime import datetime, timezone
import re


def _parse_date(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?", raw):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    # Ambiguous numeric dates are left unresolved, rather than guessing locale.
    match = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", raw)
    if match:
        first, second, year = map(int, match.groups())
        if first <= 12 and second <= 12 and first != second:
            return None
        try:
            return datetime(year, second, first) if first > 12 or first == second else datetime(year, first, second)
        except ValueError:
            return None
    for fmt in ("%d %B %Y", "%d %b %Y", "%B %d, %Y", "%B %d %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass
    return None


def build_timeline(records):
    events, undated = [], []
    by_day = defaultdict(list)
    for index, row in enumerate(records, 1):
        raw = str(row.get("date", "")).strip()
        parsed = _parse_date(raw)
        has_time = bool(re.search(r"[T ]\d{2}:\d{2}", raw))
        aware = bool(parsed and parsed.tzinfo)
        normalized = parsed.astimezone(timezone.utc) if aware else parsed
        timestamp = (normalized.isoformat() if has_time else normalized.date().isoformat()) if normalized else ""
        event = {"record": index, "date": raw, "timestamp": timestamp,
                 "precision": ("timestamp" if has_time else "day") if parsed else "unknown",
                 "time_basis": "UTC" if aware else "source local time (timezone unspecified)" if has_time else "date only",
                 "date_issue": "" if parsed else "Date not supplied" if not raw else "Invalid, ambiguous or unsupported date; use YYYY-MM-DD",
                 **{key: row.get(key, "") for key in ("src", "dst", "rel", "amount", "currency", "evidence")},
                 "frequency": row.get("frequency", 1), "source_rows": row.get("source_rows", []),
                 "source_page": row.get("attributes", {}).get("source_page", "")}
        if parsed:
            events.append(event)
            by_day[(normalized.date().isoformat(), "UTC" if aware else "source date")].append(event)
        else:
            undated.append(event)
    # Date-only events have a date bucket, not an invented time; stable record
    # order resolves ties. Offset-aware timestamps are normalized to UTC.
    events.sort(key=lambda e: (e["timestamp"][:10], e["precision"] != "day", e["time_basis"], e["timestamp"], e["record"]))
    overlaps = []
    for (day, basis), day_events in sorted(by_day.items()):
        linked = defaultdict(list)
        for event in day_events:
            for entity in {event["src"], event["dst"]}:
                linked[entity].append(event)
        for entity, related in sorted(linked.items()):
            if len(related) >= 2:
                overlaps.append({"date": day, "time_basis": basis, "shared_entity": entity,
                                 "event_count": len(related),
                                 "entities": sorted({e[key] for e in related for key in ("src", "dst")}),
                                 "relationship_types": sorted({e["rel"] for e in related}),
                                 "records": [e["record"] for e in related]})
    return {"events": events, "undated": undated, "overlaps": overlaps,
            "dated_count": len(events), "undated_count": len(undated),
            "start": events[0]["timestamp"] if events else "", "end": events[-1]["timestamp"] if events else "",
            "method": "Source dates only. Date-only records have no time ordering within their day. Zoned times are shown in UTC; unzoned times retain their source clock and cannot be compared precisely with UTC. Clusters require a shared entity on the same date and time basis; they do not establish a meeting."}
