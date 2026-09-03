from decimal import Decimal
from datetime import date

import pytest

from app.finance import PAYABLE, RECEIVABLE
from app.ledger_cutover import PENDING_PARTY_IDS, allocate_cutover_balance
from app import models


def test_amar_is_carried_as_receivable():
    result = allocate_cutover_balance(
        'AMAR', 'BOTH', Decimal('156386.84'),
        {'receivable': Decimal('110768.84'), 'payable': Decimal('45618')},
    )
    assert result == {
        'account': RECEIVABLE,
        'amount': Decimal('156386.84'),
        'reason': 'client-confirmed',
    }


@pytest.mark.parametrize('name', [
    'Ashok Singh', 'Ramesh Singh', 'SAYEED NEW', 'VK Chicken',
])
def test_unconfirmed_review_parties_must_not_be_settled(name):
    with pytest.raises(ValueError, match='unresolved'):
        allocate_cutover_balance(
            name, 'BOTH', Decimal('999'),
            {'receivable': Decimal('400'), 'payable': Decimal('599')},
        )


def test_unambiguous_history_keeps_the_restored_amount_in_its_account():
    receivable = allocate_cutover_balance(
        'Customer', 'VENDOR', Decimal('700'),
        {'receivable': Decimal('700'), 'payable': Decimal('0')},
    )
    payable = allocate_cutover_balance(
        'Supplier', 'DEALER', Decimal('800'),
        {'receivable': Decimal('0'), 'payable': Decimal('800')},
    )
    assert (receivable['account'], receivable['amount']) == (RECEIVABLE, Decimal('700'))
    assert (payable['account'], payable['amount']) == (PAYABLE, Decimal('800'))


def test_unresolved_two_sided_party_fails_closed():
    with pytest.raises(ValueError, match='unresolved'):
        allocate_cutover_balance(
            'Unknown Both Party', 'BOTH', Decimal('100'),
            {'receivable': Decimal('40'), 'payable': Decimal('60')},
        )


@pytest.mark.parametrize('party_id', sorted(PENDING_PARTY_IDS, key=str))
def test_pending_party_preserves_history_and_new_payments(db, endpoints, party_id):
    outlet = models.Outlet(name='Main', code='MAIN')
    party = models.Party(id=party_id, name='Pending Party', type='BOTH', normalized_name='pendingparty')
    db.add_all([outlet, party])
    db.flush()
    db.add(models.PartyAlias(party_id=party.id, alias=party.name, normalized_alias='pendingparty'))
    for day, kind, category, amount in [
        (3, 'PURCHASE', '', '1250741.929'),
        (4, 'PAYMENT', 'RECEIVED', '1000'),
    ]:
        db.add(models.Transaction(outlet_id=outlet.id, party_id=party.id,
            date=date(2026,9,day), type=kind, category=category, amount=Decimal(amount)))
    db.commit()
    endpoints['ledger_today'] = lambda: date(2026,9,4)
    scope = {'mode':'single','selected':outlet}
    result = endpoints['get_party_ledger'](party.id, db=db, scope=scope,
        start_date='2026-09-04', end_date='2026-09-04')
    assert result['ledger_mode'] == 'legacy'
    assert result['summary']['opening_balance'] == 1250741.929
    assert result['total_balance'] == 1249741.929
    assert result['ledger'][0]['balance'] == 1249741.929
    spanning = endpoints['get_party_ledger'](party.id, db=db, scope=scope,
        start_date='2026-09-03', end_date='2026-09-04')
    assert spanning['total_balance'] == 1249741.929
    assert len(spanning['ledger']) == 2
    empty = endpoints['get_party_ledger'](party.id, db=db, scope=scope,
        start_date='2026-09-05', end_date='2026-09-05')
    assert empty['ledger'] == []
    assert empty['total_balance'] == 1249741.929
    profile = endpoints['get_party_profile'](party.name, db=db, scope=scope)
    assert profile['party']['balance_after'] == 1249741.929
    report = endpoints['export_report']('outstanding', file_format='json',
        end_date='2026-09-05', db=db, scope=scope)
    assert report['rows'][0]['Unclassified Balance'] == 1249741.929
    assert report['rows'][0]['Receivable'] is None
    ledger_export = endpoints['export_report']('ledger', file_format='json', party=party.name,
        start_date='2026-09-03', end_date='2026-09-04', db=db, scope=scope)
    assert ledger_export['rows'][-1]['Balance'] == 1249741.929
    assert db.query(models.Transaction).count() == 2


@pytest.mark.parametrize('pending', [False, True])
def test_balance_sheet_does_not_double_count_carried_opening(db, endpoints, pending):
    party = models.Party(name='Sheet Party', type='DEALER')
    if pending:
        party.id = next(iter(PENDING_PARTY_IDS))
    outlet = models.Outlet(name='Main', code='MAIN')
    db.add_all([party, outlet])
    db.flush()
    rows = []
    for day, kind, amount, source in [
        (3, 'PURCHASE', '500', None),
        (4, 'OPENING', '500', 'ledger-cutover:test'),
        (4, 'PURCHASE', '100', None),
    ]:
        row = models.Transaction(party_id=party.id, outlet_id=outlet.id,
            date=date(2026,9,day), type=kind, category='PAYABLE' if kind == 'OPENING' else '',
            amount=Decimal(amount), source_ref=source)
        db.add(row)
        rows.append(row)
    db.flush()
    result = endpoints['build_balance_sheet_rows_from_ledger'](
        db, {party.id: {'party_name': party.name, 'txns': rows}}, date(2026,9,4),
        lambda row: True, None, None, None, None)
    assert result['totals']['old_balance'] == 500
    assert result['totals']['purchases'] == 100
    assert result['totals']['balance'] == 600
