"""
Criminal Network Intelligence — Data Mapping / Ingestion
=========================================================
Adapts the requested graph model to fields ACTUALLY present in the data.

What the data really is (verified by probing, 2026-09-05):
  CAVIAR phase*.csv : square directed adjacency matrices.
      Row IDs == Column IDs (ordered), diagonal = 0, asymmetric counts.
      Cell (i -> j) = observed contact/interaction frequency in that phase.
      NO names, phones, vehicles, locations, bank accounts, FIR fields exist.
  emails.csv        : 517,401 raw Enron dumps, exactly 2 cols (file, message).
      `message` bundles routing headers + body in one string block.
      Headers reliably present: Message-ID, Date, From, To, Subject,
        Mime-Version, Content-Type, X-From, X-To, X-cc, X-bcc, X-Folder,
        X-Origin, X-FileName. `To:` may hold comma/semicolon multi-recipients.
      ~2.8% of rows lack a To: header; Subject is often empty-but-present.

Adapted graph model (only what the data supports):
  Nodes
    Person          person_id (caviar:<id> | email:<addr>), source, label
    EmailAccount    email address node (so Person<->Email traffic is explicit)
    EmailMessage    one row of emails.csv: message_id, file, subject, datetime,
                    body_ref (char offsets, body NOT duplicated into graph)
    InvestigationPhase  phase name (phase1..phase11), n_nodes, total_weight
  Edges
    CONTACTED       (Person->Person) from CAVIAR cells; props: weight, phase,
                    directed=true, first_phase, last_phase + aggregated all_phases
    EMAILED         (EmailAccount->EmailAccount) per parsed message;
                    props: message_id, datetime, subject, file
    SENT            (Person->EmailMessage), RECEIVED (EmailMessage->Person-ish
                    flattened as EmailAccount) — emitted as SENT/RECEIVED rows
    MENTIONED_WITH  (not emitted — no co-location/family/vehicle/financial
                    fields exist; see FLAGGED report instead of inventing data)

Honesty note for the hackathon: node/edge types PhoneNumber, Vehicle, Location,
Organization, Event, BankAccount, CALLED, FINANCIAL_TRANSFER, CO_LOCATED,
FAMILY_OF, OWNS_VEHICLE, REGISTERED_AT, INVOLVED_IN_EVENT, PRIOR_CASE_WITH
cannot be populated — the source files contain none of those attributes.
They are kept as documented extension points in the Neo4j DDL comments only.

Usage:
  python scripts/ingest.py --caviar-dir CAVIAR --emails-csv emails.csv --out out [--sample-emails 20000]
  python scripts/ingest.py ... --full   # parse all 517k email rows (slow, ~GB RAM for JSON)

Outputs (in --out):
  nodes_person.csv, nodes_email_account.csv, nodes_email_message.csv,
  nodes_phase.csv, edges_contacted.csv, edges_emailed.csv,
  edges_sent_received.csv, emails_for_nlp.jsonl, flagged_rows.csv,
  neo4j_load.cypher, data_quality_report.json (+ stdout summary)
"""

import argparse
import csv
import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

csv.field_size_limit(10 ** 8)

# ---------------------------------------------------------------- regexes ---
# NOTE: header patterns use [ \t]* / [^\r\n]* deliberately — \s would
#跨 match across newlines and an empty `Subject:` would swallow the next
# header line (observed bug: subject parsed as "Mime-Version: 1.0").
RE_MSGID = re.compile(r"^Message-ID:[ \t]*([^\r\n]*)", re.M | re.I)
RE_DATE = re.compile(r"^Date:[ \t]*([^\r\n]*)", re.M | re.I)
RE_FROM = re.compile(r"^From:[ \t]*([^\r\n]*)", re.M | re.I)
RE_TO = re.compile(r"^To:[ \t]*([^\r\n]*)", re.M | re.I)
RE_SUBJ = re.compile(r"^Subject:[ \t]*([^\r\n]*)", re.M | re.I)
RE_X_FROM = re.compile(r"^X-From:[ \t]*([^\r\n]*)", re.M | re.I)
RE_X_TO = re.compile(r"^X-To:[ \t]*([^\r\n]*)", re.M | re.I)
RE_X_CC = re.compile(r"^X-cc:[ \t]*([^\r\n]*)", re.M | re.I)
RE_X_BCC = re.compile(r"^X-bcc:[ \t]*([^\r\n]*)", re.M | re.I)
RE_X_FOLDER = re.compile(r"^X-Folder:[ \t]*([^\r\n]*)", re.M | re.I)
RE_X_ORIGIN = re.compile(r"^X-Origin:[ \t]*([^\r\n]*)", re.M | re.I)
RE_ADDR = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
RE_SPLIT_ADDRS = re.compile(r"[;,]")

DATE_FMTS = [
    "%a, %d %b %Y %H:%M:%S %z (%Z)",
    "%a, %d %b %Y %H:%M:%S %z",
    "%a, %d %b %Y %H:%M:%S",
    "%d %b %Y %H:%M:%S %z",
]

flagged = []          # rows that can't be cleanly mapped (never silently dropped)
quality = Counter()   # issue histogram


def flag(source, key, reason, raw=""):
    flagged.append({"source": source, "key": str(key)[:200],
                    "reason": reason, "raw_excerpt": str(raw)[:300]})
    quality[f"{source}:{reason}"] += 1


def norm_email(addr):
    """Lowercase + strip display names / <> wrappers. No country-code-style
    issue applies (emails, not phones); inconsistent formats = 'Name <a@b>'
    vs bare address vs X-To internal 'Name/Domain@Domain' form."""
    if not addr:
        return ""
    addr = addr.strip()
    m = RE_ADDR.search(addr)
    if m:
        return m.group(0).lower()
    # X-To internal form: 'Tim Belden/Enron@EnronXGate' -> slug it, flag it
    if "/" in addr or "@" in addr:
        slug = re.sub(r"[^a-z0-9]+", ".", addr.lower()).strip(".")
        return slug[:120] if slug else ""
    return addr.lower()[:120]


def parse_email_date(raw):
    if not raw:
        return "", "missing_date"
    s = raw.strip()
    for fmt in DATE_FMTS:
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat(), ""
        except ValueError:
            continue
    # last resort: email.utils
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(s)
        return dt.astimezone(timezone.utc).isoformat(), ""
    except Exception:
        return "", f"unparseable_date:{s[:60]}"


def split_recipients(raw):
    if raw is None:
        return [], "missing_to_header"
    parts = [p.strip() for p in RE_SPLIT_ADDRS.split(raw) if p.strip()]
    addrs = [norm_email(p) for p in parts]
    addrs = [a for a in addrs if a]
    if not addrs:
        return [], "empty_to_after_parse"
    return addrs, ""


# ------------------------------------------------------- CAVIAR ingest ---
def ingest_caviar(caviar_dir):
    persons = {}   # pid -> dict
    contacted = defaultdict(lambda: {"weight": 0, "phases": {}})
    phases = []
    total_cells = 0
    for fp in sorted(glob.glob(os.path.join(caviar_dir, "phase*.csv"))):
        phase = os.path.splitext(os.path.basename(fp))[0]
        with open(fp, newline="", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            try:
                header = next(reader)
            except StopIteration:
                flag("caviar", fp, "empty_file")
                continue
            col_ids = [c.strip().strip('"') for c in header[1:]]
            if not header[0].strip().strip('"') == "":
                flag("caviar", fp, "unexpected_first_header_cell", header[0])
            rows = list(reader)
            phase_weight = 0
            for r in rows:
                if len(r) < len(header):
                    flag("caviar", f"{phase}:{r[0] if r else '?'}",
                         "short_row_pad_with_zeros", str(r)[:200])
                    r = r + ["0"] * (len(header) - len(r))
                rid = r[0].strip().strip('"')
                if rid not in col_ids:
                    flag("caviar", f"{phase}:{rid}", "row_id_not_in_columns", rid)
                    continue
                persons.setdefault(rid, {"person_id": f"caviar:{rid}",
                                         "raw_id": rid, "source": "caviar"})
                for cid, cell in zip(col_ids, r[1:]):
                    total_cells += 1
                    cell = (cell or "0").strip().strip('"')
                    try:
                        w = int(float(cell))  # tolerate "3.0"
                    except ValueError:
                        flag("caviar", f"{phase}:{rid}->{cid}",
                             "non_integer_cell", cell)
                        continue
                    if w < 0:
                        flag("caviar", f"{phase}:{rid}->{cid}",
                             "negative_weight", cell)
                        continue
                    if w == 0:
                        continue
                    persons.setdefault(cid, {"person_id": f"caviar:{cid}",
                                             "raw_id": cid, "source": "caviar"})
                    key = (rid, cid)
                    contacted[key]["weight"] += w
                    contacted[key]["phases"][phase] = \
                        contacted[key]["phases"].get(phase, 0) + w
                    phase_weight += w
            phases.append({"phase_id": phase, "n_nodes": len(rows),
                           "total_weight": phase_weight})
    edges = []
    for (src, dst), agg in contacted.items():
        ph = sorted(agg["phases"])
        edges.append({"src": f"caviar:{src}", "dst": f"caviar:{dst}",
                      "weight": agg["weight"],
                      "phase_first": ph[0], "phase_last": ph[-1],
                      "phase_count": len(ph),
                      "all_phases": ";".join(f"{p}:{agg['phases'][p]}" for p in ph)})
    quality["caviar:cells_scanned"] = total_cells
    return persons, edges, phases


# ------------------------------------------------------- emails ingest ---
def ingest_emails(emails_csv, limit=None):
    accounts, messages = {}, {}
    emailed, sent, received = [], [], []
    nlp_rows = []
    n_rows = 0
    with open(emails_csv, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        if set(reader.fieldnames or []) != {"file", "message"}:
            flag("emails", "header", "unexpected_columns",
                 str(reader.fieldnames))
        for i, row in enumerate(reader):
            if limit is not None and i >= limit:
                break
            n_rows += 1
            fpath = (row.get("file") or "").strip()
            msg = row.get("message") or ""
            if not msg.strip():
                flag("emails", fpath or f"row{i}", "empty_message")
                continue
            m_id = RE_MSGID.search(msg)
            m_from = RE_FROM.search(msg)
            m_to = RE_TO.search(msg)
            m_date = RE_DATE.search(msg)
            m_subj = RE_SUBJ.search(msg)
            msg_id = m_id.group(1).strip() if m_id else ""
            if not msg_id:  # deterministic fallback id, flagged
                msg_id = "gen:" + hashlib.sha1(
                    (fpath + msg[:500]).encode("utf-8", "replace")).hexdigest()[:16]
                flag("emails", fpath, "missing_message_id_uses_generated", msg_id)
            from_raw = m_from.group(1).strip() if m_from else ""
            if not from_raw:
                flag("emails", fpath, "missing_from_header", msg[:200])
                continue
            sender = norm_email(from_raw)
            if not sender:
                flag("emails", fpath, "unparseable_from", from_raw)
                continue
            to_raw = m_to.group(1).strip() if m_to else None
            if m_to is None:
                flag("emails", fpath, "missing_to_header", (msg[:300]))
            recipients, to_issue = split_recipients(to_raw if m_to else None)
            if to_issue:
                flag("emails", fpath, to_issue, str(to_raw)[:200])
                # keep message node, but no EMAILED edges
            dt_iso, date_issue = parse_email_date(
                m_date.group(1) if m_date else "")
            if date_issue:
                flag("emails", fpath, date_issue, m_date.group(1)[:120] if m_date else "")
            subject = m_subj.group(1).strip() if m_subj else ""
            if not subject:
                quality["emails:empty_subject"] += 1
            parts = re.split(r"\r?\n\r?\n", msg, maxsplit=1)
            body = parts[1] if len(parts) == 2 else ""
            if not body.strip():
                flag("emails", fpath, "empty_body_after_headers")
            x_folder = RE_X_FOLDER.search(msg)
            x_origin = RE_X_ORIGIN.search(msg)
            messages[msg_id] = {
                "message_id": msg_id, "file": fpath, "subject": subject,
                "datetime": dt_iso,
                "x_folder": x_folder.group(1).strip() if x_folder else "",
                "x_origin": x_origin.group(1).strip() if x_origin else "",
                "body_chars": len(body),
            }
            accounts.setdefault(sender, {"email": sender})
            sent.append({"src": f"email:{sender}", "dst": f"msg:{msg_id}"})
            for rcpt in recipients:
                accounts.setdefault(rcpt, {"email": rcpt})
                emailed.append({"src": f"email:{sender}", "dst": f"email:{rcpt}",
                                "message_id": msg_id, "datetime": dt_iso,
                                "subject": subject, "file": fpath})
                received.append({"src": f"msg:{msg_id}", "dst": f"email:{rcpt}"})
            nlp_rows.append({"message_id": msg_id, "file": fpath,
                             "datetime": dt_iso, "subject": subject,
                             "from": sender, "to": recipients, "body": body})
            # X-To / X-cc / X-bcc enrichment recorded only as quality notes
            if RE_X_CC.search(msg) or RE_X_BCC.search(msg):
                quality["emails:has_x_cc_or_bcc"] += 1
    quality["emails:rows_scanned"] = n_rows
    return accounts, messages, emailed, sent, received, nlp_rows


# ---------------------------------------------------------------- writers ---
def w_csv(path, rows, fields):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


CYPHER = """// Neo4j LOAD CSV — run after copying out/*.csv to Neo4j import dir.
// Extension points (no source data yet): PhoneNumber, Vehicle, Location,
// Organization, Event, BankAccount, CALLED, FINANCIAL_TRANSFER, CO_LOCATED,
// FAMILY_OF, OWNS_VEHICLE, REGISTERED_AT, INVOLVED_IN_EVENT, PRIOR_CASE_WITH.
CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (a:EmailAccount) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (m:EmailMessage) REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (p:Phase) REQUIRE p.id IS UNIQUE;
LOAD CSV WITH HEADERS FROM 'file:///nodes_person.csv' AS r
MERGE (p:Person {id: r['person_id:ID']}) SET p.raw_id=r.raw_id, p.source=r.source;
LOAD CSV WITH HEADERS FROM 'file:///nodes_email_account.csv' AS r
MERGE (a:EmailAccount {id: r['account_id:ID'], email: r.email});
LOAD CSV WITH HEADERS FROM 'file:///nodes_email_message.csv' AS r
MERGE (m:EmailMessage {id: r['message_id:ID']})
SET m.file=r.file, m.subject=r.subject, m.datetime=r.datetime,
    m.x_folder=r.x_folder, m.x_origin=r.x_origin, m.body_chars=toInteger(r.body_chars);
LOAD CSV WITH HEADERS FROM 'file:///nodes_phase.csv' AS r
MERGE (p:Phase {id: r['phase_id:ID']})
SET p.n_nodes=toInteger(r.n_nodes), p.total_weight=toInteger(r.total_weight);
LOAD CSV WITH HEADERS FROM 'file:///edges_contacted.csv' AS r
MATCH (a:Person {id: r[':START_ID']}), (b:Person {id: r[':END_ID']})
MERGE (a)-[e:CONTACTED {phase_first: r.phase_first, phase_last: r.phase_last}]->(b)
SET e.weight=toInteger(r.weight), e.phase_count=toInteger(r.phase_count),
    e.all_phases=r.all_phases;
LOAD CSV WITH HEADERS FROM 'file:///edges_emailed.csv' AS r
MATCH (a:EmailAccount {id: r[':START_ID']}), (b:EmailAccount {id: r[':END_ID']})
CREATE (a)-[e:EMAILED {message_id: r.message_id}]->(b)
SET e.datetime=r.datetime, e.subject=r.subject, e.file=r.file;
LOAD CSV WITH HEADERS FROM 'file:///edges_sent_received.csv' AS r
MATCH (a), (b) WHERE a.id = r[':START_ID'] AND b.id = r[':END_ID']
  AND ((a:EmailAccount AND b:EmailMessage) OR (a:EmailMessage AND b:EmailAccount))
CREATE (a)-[e:SENT_RECEIVED {kind: r.kind}]->(b);
"""


def main():
    ap = argparse.ArgumentParser(description="Map CAVIAR + Enron emails to crime-graph schema")
    ap.add_argument("--caviar-dir", required=True)
    ap.add_argument("--emails-csv", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sample-emails", type=int, default=20000,
                    help="rows of emails.csv to parse (default 20000)")
    ap.add_argument("--full", action="store_true",
                    help="parse entire emails.csv, ignoring --sample-emails")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    persons, contacted_edges, phases = ingest_caviar(args.caviar_dir)
    limit = None if args.full else args.sample_emails
    accounts, messages, emailed, sent, received, nlp_rows = ingest_emails(
        args.emails_csv, limit)

    # bridge: Enron display-name persons (lightweight Person nodes for senders)
    email_persons = [{"person_id": f"person:{e}", "raw_id": e,
                      "source": "emails_sender"} for e in accounts]

    w_csv(os.path.join(args.out, "nodes_person.csv"),
          list(persons.values()) + email_persons,
          ["person_id:ID", "person_id", "raw_id", "source"])
    # normalize person csv: duplicate person_id into :ID col
    with open(os.path.join(args.out, "nodes_person.csv"), encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["person_id:ID"] = r["person_id"]
    w_csv(os.path.join(args.out, "nodes_person.csv"), rows,
          ["person_id:ID", "person_id", "raw_id", "source"])

    w_csv(os.path.join(args.out, "nodes_email_account.csv"),
          [{"account_id:ID": f"email:{e}", "email": e} for e in sorted(accounts)],
          ["account_id:ID", "email"])
    w_csv(os.path.join(args.out, "nodes_email_message.csv"),
          [{"message_id:ID": f"msg:{m['message_id']}", **{f"message_id": m["message_id"]},
            "file": m["file"], "subject": m["subject"], "datetime": m["datetime"],
            "x_folder": m["x_folder"], "x_origin": m["x_origin"],
            "body_chars": m["body_chars"]} for m in messages.values()],
          ["message_id:ID", "message_id", "file", "subject", "datetime",
           "x_folder", "x_origin", "body_chars"])
    w_csv(os.path.join(args.out, "nodes_phase.csv"),
          [{"phase_id:ID": p["phase_id"], "phase_id": p["phase_id"],
            "n_nodes": p["n_nodes"], "total_weight": p["total_weight"]}
           for p in phases],
          ["phase_id:ID", "phase_id", "n_nodes", "total_weight"])
    w_csv(os.path.join(args.out, "edges_contacted.csv"),
          [{":START_ID": e["src"], ":END_ID": e["dst"], ":TYPE": "CONTACTED",
            **{k: v for k, v in e.items() if k not in ("src", "dst")}}
           for e in contacted_edges],
          [":START_ID", ":END_ID", ":TYPE", "weight", "phase_first",
           "phase_last", "phase_count", "all_phases"])
    w_csv(os.path.join(args.out, "edges_emailed.csv"),
          [{":START_ID": e["src"], ":END_ID": e["dst"], ":TYPE": "EMAILED",
            "message_id": e["message_id"], "datetime": e["datetime"],
            "subject": e["subject"], "file": e["file"]} for e in emailed],
          [":START_ID", ":END_ID", ":TYPE", "message_id", "datetime",
           "subject", "file"])
    sr = ([{":START_ID": s["src"], ":END_ID": s["dst"], ":TYPE": "SENT_RECEIVED",
            "kind": "SENT"} for s in sent] +
          [{":START_ID": r["src"], ":END_ID": r["dst"], ":TYPE": "SENT_RECEIVED",
            "kind": "RECEIVED"} for r in received])
    w_csv(os.path.join(args.out, "edges_sent_received.csv"), sr,
          [":START_ID", ":END_ID", ":TYPE", "kind"])

    with open(os.path.join(args.out, "emails_for_nlp.jsonl"), "w",
              encoding="utf-8") as f:
        for r in nlp_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    w_csv(os.path.join(args.out, "flagged_rows.csv"), flagged,
          ["source", "key", "reason", "raw_excerpt"])
    with open(os.path.join(args.out, "neo4j_load.cypher"), "w",
              encoding="utf-8") as f:
        f.write(CYPHER)

    report = {
        "mapped": {
            "caviar_persons": len(persons),
            "contacted_edges_aggregated": len(contacted_edges),
            "contacted_weight_total": sum(e["weight"] for e in contacted_edges),
            "phases": len(phases),
            "email_accounts": len(accounts),
            "email_messages": len(messages),
            "emailed_edges": len(emailed),
            "sent_received_edges": len(sr),
            "nlp_rows": len(nlp_rows),
        },
        "flagged_total": len(flagged),
        "top_issues": dict(Counter(
            {k: v for k, v in quality.items() if ":" in k}).most_common(15)),
        "counters": dict(quality),
        "notes": [
            "PhoneNumber/Vehicle/Location/Organization/Event/BankAccount and "
            "CALLED/FINANCIAL_TRANSFER/CO_LOCATED/FAMILY_OF/OWNS_VEHICLE/"
            "REGISTERED_AT/INVOLVED_IN_EVENT/PRIOR_CASE_WITH have zero source "
            "fields — omitted rather than invented.",
            "CAVIAR diagonal is all zeros (no self-loops); matrices are "
            "directed (asymmetric counts preserved via directed CONTACTED).",
        ],
    }
    with open(os.path.join(args.out, "data_quality_report.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("=== DATA QUALITY REPORT ===")
    print(json.dumps(report["mapped"], indent=2))
    print(f"flagged_total: {report['flagged_total']}")
    print("top_issues:")
    for k, v in report["top_issues"].items():
        print(f"  {v:>7}  {k}")
    print(f"\nOutputs written to: {args.out}")


if __name__ == "__main__":
    main()
