from fastapi.testclient import TestClient
from backend.api import app
from backend.narrative import extract_narrative


def test_transcript_payments_assets_and_negation():
    text = ('Asha Rao: I paid INR 12000 to Kabir Shah on 2026-09-01.\n'
            'Kabir Shah paid Asha Rao INR 500 on 2026-09-03.\n'
            'Kabir Shah drove vehicle MH12AB1234.\n'
            'Meera Sen has account ACCT92831.\n'
            'Meera Sen uses phone +91 98765 43210.\n'
            'Asha Rao did not pay Meera Sen.\n'
            'Asha Rao argued with Meera Sen.')
    result = extract_narrative(text)
    payments = [r for r in result['records'] if r['rel'] == 'FINANCIAL_TRANSFER']
    assert [(r['src'], r['dst'], r['amount'], r['currency'], r['date']) for r in payments] == [
        ('Asha Rao', 'Kabir Shah', '12000', 'INR', '2026-09-01'),
        ('Kabir Shah', 'Asha Rao', '500', 'INR', '2026-09-03')]
    assert len(result['records']) == 6
    assert result['unresolved'][0]['line'] == 6
    assert all(r['evidence'] and r['source_rows'] for r in result['records'])
    with TestClient(app) as client:
        response = client.post('/workspace/analyze', json={'name':'transcript','records':result['records'],'source_text':text})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data['source_document']['source_text'] == text
        assert data['details']['MH12AB1234']['label'] == 'Vehicle'
        assert data['details']['ACCT92831']['label'] == 'Account'
        assert len(data['details']['Asha Rao']['properties']['payment_history']) == 2
        assert data['records'][0]['evidence']


def test_payments_same_sentence_are_not_combined_or_misassigned():
    result = extract_narrative('Asha Rao paid Kabir Shah INR 100 and Meera Sen paid Dev Shah USD 200.')
    assert [(r['dst'], r['amount'], r['currency']) for r in result['records']] == [('Kabir Shah','100','INR'),('Dev Shah','200','USD')]
    assert len(extract_narrative('Asha Rao paid Kabir Shah INR 100. Asha Rao paid Kabir Shah INR 100.')['records']) == 2


def test_unstructured_paragraph_active_passive_pronouns_and_context():
    text = ('On 12 September 2026, Asha Rao called Kabir Shah at 8:30 pm. '
            'She then sent INR 25,000 to Meera Sen via NEFT, reference TXN-77881. '
            'Vehicle DL01AB1234 was driven by Kabir Shah. Kabir Shah went to New Delhi. '
            'A payment of USD 300 was made from Dev Shah to Asha Rao. '
            'Meera Sen may know Dev Shah.')
    result = extract_narrative(text)
    facts = {(r['src'], r['rel'], r['dst']) for r in result['records']}
    assert ('Asha Rao', 'CALLED', 'Kabir Shah') in facts
    assert ('Asha Rao', 'FINANCIAL_TRANSFER', 'Meera Sen') in facts
    assert ('Kabir Shah', 'USED_VEHICLE', 'DL01AB1234') in facts
    assert ('Kabir Shah', 'VISITED', 'New Delhi') in facts
    assert ('Dev Shah', 'FINANCIAL_TRANSFER', 'Asha Rao') in facts
    transfer = next(r for r in result['records'] if r['dst'] == 'Meera Sen')
    assert transfer['amount'] == '25000' and transfer['currency'] == 'INR'
    assert transfer['attributes']['channel_or_method'] == 'NEFT'
    assert transfer['attributes']['reference'] == 'TXN-77881'
    assert any('may know' in row['text'] for row in result['unresolved'])


def test_server_file_preview_metadata_and_path_filters():
    with TestClient(app) as client:
        response = client.post('/workspace/file', data={'kind':'data'}, files={'file':('case.csv',b'src,dst,rel,currency,amount,date,note\nA,B,PAID,INR,50,2026-09-01,receipt','text/csv')})
        assert response.status_code == 200
        parsed=response.json()
        preview=client.post('/workspace/preview',json={'rows':parsed['rows'],'mapping':parsed['mapping']}).json()
        row=preview['cleaned'][0]
        assert row['currency']=='INR' and row['attributes']['note']=='receipt'
        assert row['rel']=='FINANCIAL_TRANSFER'
        graph={'nodes':['A','B','C'],'edges':[{'src':'A','dst':'B'},{'src':'B','dst':'C'}],'start':'A','end':'C','hops':3}
        assert client.post('/workspace/paths',json=graph).json()['paths']==[['A','B','C']]
        graph['edges']=graph['edges'][:1]
        assert client.post('/workspace/paths',json=graph).json()['paths']==[]
        graph['nodes']=['A','B']
        assert client.post('/workspace/paths',json=graph).status_code==422
        large=b' '*5_000_001+b'src,dst\nA,B\n'
        # File limit is above the former 5 MB boundary, without bypassing graph limits.
        assert client.post('/workspace/file',data={'kind':'data'},files={'file':('large.csv',large)}).status_code==200
        assert client.post('/workspace/file',data={'kind':'text'},files={'file':('note.txt',b'Asha Rao called Kabir Shah.')} ).json()['records'][0]['dst']=='Kabir Shah'


def test_telephone_speaker_pronoun_and_compound_vehicle_clause():
    text = ('Kabir Shah used telephone number +91-9000000003. '
            'Meera Sen has telephone number +91-9000000002.\n'
            'Dev Shah: Kabir Shah argued with me.\n'
            'Kabir Shah is associated with Northstar Trading and has used vehicle MH12AB1234.')
    result = extract_narrative(text)
    facts = {(row['src'], row['rel'], row['dst']) for row in result['records']}
    assert ('Kabir Shah', 'HAS_PHONE', '+91-9000000003') in facts
    assert ('Meera Sen', 'HAS_PHONE', '+91-9000000002') in facts
    assert ('Kabir Shah', 'ARGUED_WITH', 'Dev Shah') in facts
    assert ('Kabir Shah', 'ASSOCIATE_OF', 'Northstar Trading') in facts
    assert ('Kabir Shah', 'USED_VEHICLE', 'MH12AB1234') in facts
    assert all(row['dst'].casefold() != 'me' for row in result['records'])
    assert ('Northstar Trading', 'USED_VEHICLE', 'MH12AB1234') not in facts
