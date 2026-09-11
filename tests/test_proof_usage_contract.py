from pathlib import Path


def test_frontend_only_anchors_from_explicit_seal_action():
    source = Path("frontend/src/pages/Intelligence.tsx").read_text()
    # The browser must not call the anchor endpoint during render, AI analysis,
    # verification, import, or download. It is referenced only by seal().
    assert source.count('postWorkspace<Receipt>("proof/anchor", evidence)') == 1
    assert 'onClick={() => perform("Sealing evidence", seal)}' in source
    assert 'onClick={() => perform("Sealing updated evidence", seal)}' in source
    assert 'postWorkspace<Verification>("proof/verify"' in source
