# tests/test_ingest_preview.py
from backend.ingest_preview import detect_column_mapping, clean_edge_rows


def test_detect_caviar_style_headers():
    m = detect_column_mapping(["person_a", "person_b", "weight"])
    assert m["source"] == "person_a"
    assert m["target"] == "person_b"
    assert m["weight"] == "weight"


def test_detect_sender_recipient_headers():
    m = detect_column_mapping(["sender", "recipient", "frequency"])
    assert m["source"] == "sender"
    assert m["target"] == "recipient"


def test_detect_neo4j_style_headers():
    m = detect_column_mapping([":START_ID", ":END_ID", ":TYPE", "frequency"])
    assert m["source"] == ":START_ID"
    assert m["target"] == ":END_ID"
    assert m["rel"] == ":TYPE"


def test_clean_drops_empty_and_dedupes():
    rows = [
        {"person_a": " P1 ", "person_b": "P2", "weight": "3"},
        {"person_a": "P1", "person_b": "P2", "weight": "2"},
        {"person_a": "", "person_b": "P2", "weight": "1"},
        {"person_a": "P3", "person_b": "", "weight": "1"},
    ]
    mapping = {"source": "person_a", "target": "person_b", "rel": None,
               "weight": "weight", "date": None, "amount": None,
               "node_id": None, "node_label": None}
    cleaned, skipped = clean_edge_rows(rows, mapping)
    assert len(cleaned) == 1
    assert cleaned[0]["src"] == "P1"
    assert cleaned[0]["frequency"] == 5
    assert len(skipped) == 2


def test_detect_native_graph_headers():
    mapping = detect_column_mapping(["src", "dst", "frequency"])
    assert mapping["source"] == "src"
    assert mapping["target"] == "dst"


def test_nonfinite_frequency_and_transaction_preservation():
    rows = [dict(src="P1", dst="P2", rel="FINANCIAL_TRANSFER", amount="900", date="2026-09-08", frequency="Infinity")] * 2
    cleaned, skipped = clean_edge_rows(rows, detect_column_mapping(list(rows[0])))
    assert not skipped
    assert len(cleaned) == 2
    assert all(row["frequency"] == 1 and row["amount"] == "900" for row in cleaned)


def test_invalid_json_shapes_are_validation_errors():
    import pytest
    from backend.ingest_preview import parse_upload_file
    for content in [b"[]", b"null", b'{"edges": [null]}', b'{"edges": {"src":"a"}}']:
        with pytest.raises(ValueError):
            parse_upload_file("bad.json", content)


def test_workbook_missing_sheet_and_corrupt_file():
    import io
    import pytest
    from openpyxl import Workbook
    from backend.ingest_preview import parse_upload_file
    out = io.BytesIO()
    wb = Workbook()
    wb.active.append(["src", "dst"])
    wb.active.append(["a", "b"])
    wb.save(out)
    with pytest.raises(ValueError, match="does not exist"):
        parse_upload_file("data.xlsx", out.getvalue(), "missing")
    with pytest.raises(ValueError, match="Cannot read"):
        parse_upload_file("data.xlsx", b"broken")


def test_csv_header_whitespace_matches_client_mapping():
    from backend.ingest_preview import parse_upload_file
    rows, _ = parse_upload_file("data.csv", b" src , dst \na,b\n")
    assert rows == [{"src": "a", "dst": "b"}]
