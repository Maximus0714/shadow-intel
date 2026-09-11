"""Upload parse/detect/clean helpers for POST /ingest/preview + /ingest/load.

Pure functions (no FastAPI imports) so they are unit-testable without a server.
Column synonyms mirror the legacy dashboard validation + graph store loaders.
"""
import csv
import io
import json
import re
import zipfile

MAX_FILE_BYTES = 20_000_000

_ROLE_PATTERNS = {
    "source": [r":START_ID", r"person_a", r"sender", r"^source$", r"^src$", r"\bfrom\b", r"^caller$", r"^from_number$"],
    "target": [r":END_ID", r"person_b", r"recipient", r"^target$", r"^dst$", r"\bto\b", r"^receiver$", r"^callee$", r"^to_number$"],
    "rel": [r":TYPE", r"^rel$", r"^type$", r"^relationship$"],
    "weight": [r"frequency", r"weight", r"count", r"calls"],
    "date": [r"timestamps?", r"^date$", r"datetime", r"approx_date_range"],
    "amount": [r"amount", r"value", r"\brs\b", r"inr"],
    "currency": [r"^currency$"],
    "node_id": [r"person_id", r"email", r"account_id", r"^id$"],
    "node_label": [r"^label$", r"^name$", r"person_id"],
}

RELATIONSHIP_ALIASES = {
    "PAID": "FINANCIAL_TRANSFER", "PAYMENT": "FINANCIAL_TRANSFER",
    "TRANSFER": "FINANCIAL_TRANSFER", "TRANSFERRED": "FINANCIAL_TRANSFER",
    "CALL": "CALLED", "CALLED_BY": "CALLED",
    "EMAIL": "EMAILED", "E-MAILED": "EMAILED",
    "COLOCATED": "CO_LOCATED", "CO-LOCATED": "CO_LOCATED",
    "FAMILY": "FAMILY_OF", "OWNS": "OWNS_VEHICLE",
    "KNOWS": "ASSOCIATE_OF", "LEADS": "ASSOCIATE_OF",
}


def detect_column_mapping(headers):
    """Map each role -> matched header name (or None). First match wins."""
    mapping = {}
    for role, patterns in _ROLE_PATTERNS.items():
        found = None
        for h in headers:
            hl = (h or "").strip()
            for p in patterns:
                if re.search(p, hl, re.IGNORECASE):
                    found = h
                    break
            if found:
                break
        mapping[role] = found
    return mapping


def _to_int_freq(value):
    try:
        return max(1, int(float(value)))
    except (TypeError, ValueError, OverflowError):
        return 1


def clean_edge_rows(rows, mapping):
    """Trim, drop empty-endpoint rows, dedupe (src,dst,rel) summing frequency.

    Returns (cleaned, skipped). cleaned: [{src,dst,rel,frequency,date,amount}].
    skipped: [{row (1-based incl. header), reason}].
    """
    s_key, t_key = mapping.get("source"), mapping.get("target")
    r_key, w_key = mapping.get("rel"), mapping.get("weight")
    d_key, a_key = mapping.get("date"), mapping.get("amount")
    cleaned_by_key, order, skipped = {}, [], []
    for i, r in enumerate(rows, start=2):  # 1-based, row 1 = header
        src = str(r.get(s_key) or "").strip() if s_key else ""
        dst = str(r.get(t_key) or "").strip() if t_key else ""
        if not src or not dst:
            skipped.append({"row": i, "reason": "missing endpoint"})
            continue
        rel = str(r.get(r_key) or "ASSOCIATE_OF").strip().upper() or "ASSOCIATE_OF"
        rel = RELATIONSHIP_ALIASES.get(rel, rel)
        freq = _to_int_freq(r.get(w_key)) if w_key else 1
        date = str(r.get(d_key) or "").strip() if d_key else ""
        amount = str(r.get(a_key) or "").strip() if a_key else ""
        key = (src, dst, rel, date, amount, i if rel == "FINANCIAL_TRANSFER" else None)
        if key in cleaned_by_key:
            cleaned_by_key[key]["frequency"] += freq
        else:
            cleaned_by_key[key] = {
                "src": src, "dst": dst, "rel": rel, "frequency": freq,
                "date": str(r.get(d_key) or "").strip() if d_key else "",
                "amount": str(r.get(a_key) or "").strip() if a_key else "",
            }
            order.append(key)
    return [cleaned_by_key[k] for k in order], skipped


def _find_header_row(table):
    """First row (within first 10) with >=2 non-empty cells; default row 0."""
    for i, row in enumerate(table[:10]):
        if sum(1 for c in row if str(c or "").strip()) >= 2:
            return i
    return 0


def parse_upload_file(filename, content, sheet=None):
    """Parse CSV/JSON/XLSX bytes -> (raw_rows: [dict], meta: dict).

    Raises ValueError with a human-readable message on any parse problem.
    """
    name = (filename or "").lower()
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("File too large (max 20 MB).")
    if name.endswith(".json"):
        try:
            g = json.loads(content.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Invalid JSON: {e}")
        if not isinstance(g, dict):
            raise ValueError("JSON must be an object with an edges array.")
        nl = g.get("nodes", []) or g.get("vertices", [])
        el = g.get("edges", []) or g.get("links", [])
        if not isinstance(el, list) or any(not isinstance(e, dict) for e in el):
            raise ValueError("Each edge must be an object.")
        if not isinstance(nl, list) or any(not isinstance(n, dict) for n in nl):
            raise ValueError("Each node must be an object.")
        raw = []
        for e in el:
            raw.append({
                **e,
                "src": e.get("src") or e.get("a") or e.get("source") or e.get("from") or "",
                "dst": e.get("dst") or e.get("b") or e.get("target") or e.get("to") or "",
                "date": e.get("date", ""),
                "amount": e.get("amount", ""),
                "rel": e.get("rel") or e.get("t") or e.get("type") or "",
                "frequency": e.get("frequency") or e.get("s") or e.get("weight") or 1,
            })
        node_ids = [str(n.get("id") or n.get("person_id") or n.get("email") or "") for n in nl]
        return raw, {"kind": "json", "sheet_names": [], "sheet": None,
                     "header_row": 0, "total_rows": len(raw), "node_ids": node_ids}
    if name.endswith(".xls"):
        raise ValueError("Legacy XLS is not supported by the server. Save as XLSX or CSV.")
    if name.endswith(".xlsx"):
        try:
            import openpyxl
        except ImportError:
            raise ValueError("XLSX support needs openpyxl: pip install openpyxl (or upload CSV).")
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(entry.file_size for entry in archive.infolist()) > 100_000_000:
                    raise ValueError("Expanded workbook exceeds 100 MB. Split the workbook.")
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception as e:
            raise ValueError("Cannot read XLSX workbook.") from e
        names = wb.sheetnames
        if sheet and sheet not in names:
            wb.close()
            raise ValueError(f"Worksheet {sheet!r} does not exist.")
        pick = sheet or names[0]
        ws = wb[pick]
        if (ws.max_row or 0) > 10011 or (ws.max_column or 0) > 200:
            wb.close()
            raise ValueError("Use at most 10,000 rows and 200 columns per worksheet.")
        table = [[("" if c is None else str(c)) for c in row] for row in ws.iter_rows(max_row=10011, max_col=min(ws.max_column or 200, 200), values_only=True)]
        wb.close()
        table = [r for r in table if any(x.strip() for x in r)]
        if not table:
            raise ValueError(f"Sheet '{pick}' is empty.")
        hi = _find_header_row(table)
        headers = [h.strip() for h in table[hi]]
        raw = [dict(zip(headers, r)) for r in table[hi + 1:]]
        return raw, {"kind": "xlsx", "sheet_names": names, "sheet": pick,
                     "header_row": hi + 1, "total_rows": len(raw)}
    if not name.endswith(".csv"):
        raise ValueError("Unsupported file type. Upload CSV, XLSX or JSON.")
    # CSV
    try:
        text = content.decode("utf-8-sig")
    except Exception as e:
        raise ValueError(f"Cannot decode CSV as UTF-8: {e}")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row.")
    reader.fieldnames = [h.strip() for h in reader.fieldnames]
    if any(not h for h in reader.fieldnames) or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError("Column names must be non-empty and unique.")
    raw = []
    for r in reader:
        if len(raw) >= 10000:
            raise ValueError("Use at most 10,000 relationship rows per file.")
        raw.append(dict(r))
    return raw, {"kind": "csv", "sheet_names": [], "sheet": None,
                 "header_row": 1, "total_rows": len(raw)}
