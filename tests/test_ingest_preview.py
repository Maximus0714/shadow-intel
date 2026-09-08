# tests/test_ingest_preview.py
from ingest_preview import detect_column_mapping, clean_edge_rows


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
