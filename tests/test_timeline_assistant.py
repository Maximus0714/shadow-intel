from fastapi.testclient import TestClient

from backend.api import app
from backend.assistant import answer_question
from backend.document_extract import extract_document_text, extract_uploaded_narrative, _reflow
from backend.timeline import build_timeline


RECORDS = [
    {"src": "Asha Rao", "dst": "Kabir Shah", "rel": "CALLED", "frequency": 4,
     "date": "2026-08-03T09:30:00", "evidence": "Asha Rao called Kabir Shah four times.", "source_rows": [2]},
    {"src": "Kabir Shah", "dst": "Meera Sen", "rel": "FINANCIAL_TRANSFER", "frequency": 1,
     "date": "2026-08-03", "amount": "12000", "currency": "INR",
     "evidence": "Kabir Shah paid INR 12000 to Meera Sen.", "source_rows": [3]},
    {"src": "Meera Sen", "dst": "MH12AB1234", "rel": "USED_VEHICLE", "frequency": 1,
     "date": "", "evidence": "Meera Sen used vehicle MH12AB1234.", "source_rows": [4]},
]


def test_timeline_sorts_events_and_keeps_undated_records():
    result = build_timeline(list(reversed(RECORDS)))
    assert result["dated_count"] == 2
    assert result["undated_count"] == 1
    assert result["events"][0]["timestamp"].startswith("2026-08-03")
    assert result["overlaps"][0]["event_count"] == 2
    assert result["undated"][0]["rel"] == "USED_VEHICLE"


def test_assistant_returns_path_with_record_citations():
    result = answer_question(RECORDS, "How are Asha Rao and Meera Sen connected?")
    assert result["status"] == "supported"
    assert result["path"] == ["Asha Rao", "Kabir Shah", "Meera Sen"]
    assert {citation["record"] for citation in result["citations"]} >= {1, 2}


def test_assistant_does_not_invent_an_unsupported_answer():
    result = answer_question(RECORDS, "Which aircraft was involved?")
    assert result["status"] == "unsupported"
    assert result["citations"] == []


def test_workspace_timeline_and_assistant_routes():
    client = TestClient(app)
    evidence = {"name": "Case", "records": RECORDS}
    timeline = client.post("/workspace/timeline", json=evidence)
    assert timeline.status_code == 200
    assert timeline.json()["dated_count"] == 2
    answer = client.post("/workspace/assistant", json={"evidence": evidence, "question": "Show payment records"})
    assert answer.status_code == 200
    assert answer.json()["citations"][0]["rel"] == "FINANCIAL_TRANSFER"


def test_selectable_text_pdf_extraction():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length 55 >>\nstream\nBT /F1 12 Tf 72 720 Td (Asha Rao called Kabir Shah.) Tj ET\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    text, meta = extract_document_text("statement.pdf", bytes(pdf))
    assert "Asha Rao called Kabir Shah" in text
    assert meta["source_type"] == "pdf" and meta["pages"] == 1
    extracted = extract_uploaded_narrative("statement.pdf", bytes(pdf))
    assert extracted["records"][0]["attributes"]["source_page"] == "1"
    assert extracted["records"][0]["src"] == "Asha Rao"


def query_rows():
    return [
        {"src":"Asha Rao","dst":"Kabir Shah","rel":"CALLED","frequency":4,"date":"2026-08-03"},
        {"src":"Kabir Shah","dst":"Asha Rao","rel":"CALLED","frequency":6,"date":"2026-08-04"},
        {"src":"Asha Rao","dst":"Kabir Shah","rel":"FINANCIAL_TRANSFER","frequency":5,"amount":"12000","currency":"INR","date":"2026-08-03"},
        {"src":"Asha Rao","dst":"Kabir Shah","rel":"FINANCIAL_TRANSFER","frequency":1,"amount":"50","currency":"USD","date":"2026-08-04"},
        {"src":"Meera Sen","dst":"Dev Patel","rel":"FINANCIAL_TRANSFER","frequency":1,"amount":"99999","currency":"INR","date":"2026-08-03"},
        {"src":"Kabir Shah","dst":"Meera Sen","rel":"EMAILED","frequency":2,"date":""},
        {"src":"Asha Rao","dst":"MH12AB1234","rel":"USED_VEHICLE","frequency":1,"date":""},
    ]


def test_direction_and_conjunctive_filtering():
    rows = query_rows()
    incoming = answer_question(rows, "Who called Asha?")
    outgoing = answer_question(rows, "Who did Asha call?")
    assert [r["record"] for r in incoming["citations"]] == [2]
    assert [r["record"] for r in outgoing["citations"]] == [1]
    assert "Kabir Shah called Asha Rao" in incoming["answer"]
    assert [r["record"] for r in answer_question(rows, "Show payments from Asha to Kabir")["citations"]] == [3, 4]
    assert answer_question(rows, "Who did Meera call?")["status"] == "not_found"


def test_counts_use_frequency_and_totals_keep_currency_separate():
    rows = query_rows()
    assert "4 recorded interactions" in answer_question(rows, "How many times did Asha call Kabir?")["answer"]
    result = answer_question(rows, "How much did Asha pay Kabir?")
    assert "INR 12,000.00" in result["answer"] and "USD 50.00" in result["answer"]
    assert "60,000" not in result["answer"] and "99999" not in result["answer"]
    rows.append({"src":"Asha Rao","dst":"Kabir Shah","rel":"FINANCIAL_TRANSFER","frequency":1,"amount":"200"})
    result = answer_question(rows, "How much did Asha pay Kabir?")
    assert any("1 record(s)" in warning for warning in result["warnings"])


def test_ambiguous_names_unknown_predicates_and_unknown_people():
    rows = query_rows() + [{"src":"Asha Singh","dst":"Dev Patel","rel":"CALLED","frequency":1}]
    assert answer_question(rows, "Who called Asha?")["status"] == "clarification"
    assert answer_question(rows, "Why did Asha Rao pay Kabir?")["citations"] == []
    assert answer_question(rows, "Did Asha Rao fly an aircraft?")["status"] == "unsupported"
    assert answer_question(rows, "Who called Rohan Kapoor?")["citations"] == []
    assert answer_question(rows, "Show payments over 10000")["citations"] == []


def test_date_constraints_do_not_leak_other_records():
    result = answer_question(query_rows(), "Show payments from Asha to Kabir after 2026-08-03")
    assert [r["record"] for r in result["citations"]] == [4]
    assert answer_question(query_rows(), "Show payments yesterday")["status"] == "clarification"
    assert answer_question(query_rows(), "Show calls on 2026-02-31")["status"] == "clarification"


def test_path_cites_only_its_edges_and_missing_path_has_no_support():
    rows = query_rows()
    result = answer_question(rows, "How are Asha and Meera connected?")
    assert [r["record"] for r in result["citations"]] == [1, 6]
    assert "either direction" in result["warnings"][0]
    rows.append({"src":"Remote Person","dst":"Other Person","rel":"CALLED","frequency":1})
    result = answer_question(rows, "How are Asha and Remote Person connected?")
    assert result["status"] == "not_found" and result["citations"] == []
    result = answer_question(rows, "Find a directed path from Meera to Asha")
    assert result["status"] == "not_found"


def test_counts_include_records_beyond_citation_limit():
    rows = [{"src":"Asha Rao","dst":"Kabir Shah","rel":"CALLED","frequency":2} for _ in range(60)]
    result = answer_question(rows, "How many times did Asha call Kabir?")
    assert "120 recorded interactions" in result["answer"]
    assert result["matched_records"] == 60 and len(result["citations"]) == 50
    assert result["citations_truncated"]


def test_timeline_preserves_date_precision_and_rejects_ambiguity():
    rows = [
        {"src":"A","dst":"B","rel":"CALLED","date":"2026-08-03"},
        {"src":"X","dst":"Y","rel":"CALLED","date":"2026-08-03"},
        {"src":"A","dst":"C","rel":"CALLED","date":"03/08/2026"},
        {"src":"A","dst":"D","rel":"CALLED","date":"not a date"},
    ]
    result = build_timeline(rows)
    assert result["events"][0]["timestamp"] == "2026-08-03"
    assert result["events"][0]["precision"] == "day"
    assert result["overlaps"] == []  # Unrelated same-day rows are not an overlap.
    assert result["undated_count"] == 2
    assert all(row["date_issue"] for row in result["undated"])


def test_timeline_normalizes_offset_timestamps():
    rows = [
        {"src":"A","dst":"B","rel":"CALLED","date":"2026-08-03T10:00:00+05:30"},
        {"src":"A","dst":"C","rel":"CALLED","date":"2026-08-03T05:00:00Z"},
    ]
    result = build_timeline(rows)
    assert result["events"][0]["timestamp"] == "2026-08-03T04:30:00+00:00"
    assert result["overlaps"][0]["shared_entity"] == "A"


def test_pdf_wrapped_sentences_and_page_isolation(monkeypatch):
    from backend import document_extract
    wrapped = _reflow("Asha Rao called\nKabir Shah four times.\nMeera Sen visited Pune.")
    assert wrapped.startswith("Asha Rao called Kabir Shah four times.\n")
    sections = [{"page":1,"text":wrapped}, {"page":2,"text":"He paid INR 500 to Dev Patel."}]
    monkeypatch.setattr(document_extract, "extract_document_text", lambda *_: (
        "\n\n".join(s["text"] for s in sections),
        {"source_type":"pdf","pages":2,"sections":sections,"empty_pages":[]}))
    result = extract_uploaded_narrative("case.pdf", b"unused")
    assert result["records"][0]["frequency"] == 4
    assert all(r["rel"] != "FINANCIAL_TRANSFER" for r in result["records"])
    assert result["records"][0]["attributes"]["source_page"] == "1"
