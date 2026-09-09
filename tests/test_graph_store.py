from unittest.mock import MagicMock
from backend.graph_store import GraphStore


def test_neo4j_existing_edge_update_is_scoped_to_target():
    store = GraphStore(fallback=True)
    store.fallback = False
    store.driver = MagicMock()
    session = store.driver.session.return_value.__enter__.return_value
    session.run.return_value.single.return_value = {"f": 2, "ts": [], "txs": []}
    store._merge_edge("P1", "P2", "CALLED", 1, [], {})
    query = session.run.call_args.args[0]
    assert "(b:Person {id:$dst})" in query
    assert session.run.call_args.kwargs["dst"] == "P2"
    assert session.run.call_args.kwargs["props"]["frequency"] == 3
