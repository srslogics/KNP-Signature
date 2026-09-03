from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from uuid import uuid4

from openpyxl import load_workbook
import pytest

from app import models
from app.finance import build_legacy_ledger, summarize_legacy_transactions


@pytest.fixture(autouse=True)
def fixed_pre_cutover_today(endpoints):
    endpoints['ledger_today'] = lambda: date(2026, 9, 3)


@pytest.mark.parametrize('kind,category,expected', [
    ('SALE', 'WHOLESALE', 100), ('PURCHASE', None, 100),
    ('OPENING', 'PAYABLE', 100), ('OPENING', 'RECEIVABLE', 100), ('OPENING', 'OLD', 100),
    ('PAYMENT', 'RECEIVED', -100), ('PAYMENT', 'PAID', -100), ('PAYMENT', None, -100),
    ('MORTALITY', 'SHOP', 0),
])
def test_pre_upgrade_movement(kind, category, expected):
    balance, rows = build_legacy_ledger(summarize_legacy_transactions([
        {'type': kind, 'category': category, 'amount': '100'}
    ]))
    assert balance == expected
    assert rows[0]['delta'] == expected


def test_stored_retail_amounts_and_partial_payment_are_preserved():
    events = summarize_legacy_transactions([
        {'type': 'SALE', 'source_ref': 'retail-bill:one:1', 'amount': '600', 'weight': 4},
        {'type': 'SALE', 'source_ref': 'retail-bill:one:2', 'amount': '400', 'weight': 6},
        {'type': 'PAYMENT', 'category': 'RECEIVED', 'source_ref': 'retail-payment:one', 'amount': '300'},
    ])
    balance, rows = build_legacy_ledger(events, 200)
    assert len(rows) == 2
    assert rows[0]['amount'] == 1000
    assert rows[0]['rate'] == 100
    assert rows[0]['balance'] == 1200
    assert balance == 900


@pytest.fixture
def account(db):
    outlet = models.Outlet(name='Main', code='MAIN')
    other = models.Outlet(name='Other', code='OTHER')
    party = models.Party(name='Example Supplier', normalized_name='examplesupplier', type='BOTH')
    db.add_all([outlet, other, party])
    db.flush()
    db.add(models.PartyAlias(alias=party.name, normalized_alias=party.normalized_name, party_id=party.id))
    for day, kind, category, amount in [
        (1, 'OPENING', 'PAYABLE', 1000), (2, 'PURCHASE', 'WHOLESALE', 500),
        (2, 'PAYMENT', 'RECEIVED', 200), (2, 'PAYMENT', 'PAID', 100), (3, 'SALE', 'WHOLESALE', 50),
    ]:
        db.add(models.Transaction(date=date(2026, 9, day), party_id=party.id, outlet_id=outlet.id,
            type=kind, category=category, amount=amount, created_at=datetime(2026, 9, day, 12, 0, amount % 60)))
    db.add(models.Transaction(date=date(2026, 9, 2), party_id=party.id, outlet_id=other.id,
        type='PURCHASE', amount=9000))
    db.add(models.Transaction(date=date(2026, 9, 4), party_id=party.id, outlet_id=outlet.id,
        type='OPENING', category='RECEIVABLE', item_type='Ledger cutover', amount=1250,
        source_ref=f'ledger-cutover:2026-09-04:{outlet.id}', created_at=datetime(2026, 9, 4, 0, 0)))
    db.commit()
    return party, outlet, other


def ledger(endpoints, db, account, **kwargs):
    party, outlet, _ = account
    return endpoints['get_party_ledger'](party.id, db=db, scope={'mode':'single', 'selected':outlet}, **kwargs)


def test_party_ledger_preserves_later_entries_and_other_outlets(db, endpoints, account):
    before = [(t.id, t.amount, t.type, t.category) for t in db.query(models.Transaction).order_by(models.Transaction.id)]
    result = ledger(endpoints, db, account)
    assert result['total_balance'] == result['summary']['current_balance'] == 1250
    assert result['ledger'][-1]['balance'] == 1250
    assert result['balances']['balance'] == 1250
    assert result['balances']['net'] == -1550  # Diagnostic, never the primary party balance.
    assert len(result['ledger']) == 5
    assert before == [(t.id, t.amount, t.type, t.category) for t in db.query(models.Transaction).order_by(models.Transaction.id)]
    other = account[2]
    assert endpoints['get_party_ledger'](account[0].id, db=db, scope={'mode':'single','selected':other})['total_balance'] == 9000


def test_filtered_and_empty_windows_carry_earlier_balance(db, endpoints, account):
    result = ledger(endpoints, db, account, start_date='2026-09-02', end_date='2026-09-02')
    assert result['summary']['opening_balance'] == 1000
    assert result['total_balance'] == 1200
    empty = ledger(endpoints, db, account, start_date='2026-09-06', end_date='2026-09-06')
    assert empty['total_balance'] == empty['summary']['opening_balance'] == 1250
    assert empty['ledger'] == []


def test_cutover_keeps_historical_rows_old_and_uses_accounts_from_05_september(db, endpoints, account):
    historical = ledger(endpoints, db, account, end_date='2026-09-04')
    assert historical['ledger_mode'] == 'legacy'
    assert historical['total_balance'] == 1250
    assert len(historical['ledger']) == 5
    assert all(row['ledger_mode'] == 'legacy' for row in historical['ledger'])

    upgraded = ledger(endpoints, db, account, start_date='2026-09-05', end_date='2026-09-05')
    assert upgraded['ledger_mode'] == 'account'
    assert upgraded['balances']['receivable'] == 1250
    assert upgraded['balances']['payable'] == 0
    assert upgraded['total_balance'] == 1250
    assert len(upgraded['ledger']) == 1
    assert upgraded['ledger'][0]['account'] == 'RECEIVABLE'


def test_current_profiles_and_receipts_switch_to_account_balance_on_cutover(db, endpoints, account):
    party, outlet, _ = account
    endpoints['ledger_today'] = lambda: date(2026, 9, 5)
    profile = endpoints['get_party_profile'](party.name, db, {'mode':'single','selected':outlet})
    assert profile['party']['balance_after'] == 1250
    assert profile['party']['receivable_balance'] == 1250
    assert profile['party']['payable_balance'] == 0

    received = models.PaymentReceipt(receipt_number='R', date=date(2026,9,4), outlet_id=outlet.id,
        party_id=party.id, party_name=party.name, direction='RECEIVED', amount=1)
    paid = models.PaymentReceipt(receipt_number='P', date=date(2026,9,4), outlet_id=outlet.id,
        party_id=party.id, party_name=party.name, direction='PAID', amount=1)
    db.add_all([received, paid])
    db.commit()
    assert endpoints['get_payment_receipt'](received.id, db, outlet)['balance_after'] == 1250
    assert endpoints['get_payment_receipt'](paid.id, db, outlet)['balance_after'] == 0


def test_future_cutover_opening_is_hidden_until_05_september(db, endpoints, account):
    party, outlet, _ = account
    scope = {'mode':'single', 'selected':outlet}
    assert endpoints['top_debtors'](db=db, scope=scope)['top_debtors'] == []

    endpoints['ledger_today'] = lambda: date(2026, 9, 5)
    assert endpoints['top_debtors'](db=db, scope=scope)['top_debtors'] == [
        {'party_name': party.name, 'balance': 1250.0}
    ]


@pytest.mark.parametrize('party_type', ['DEALER', 'VENDOR', 'BOTH'])
def test_profile_receipts_and_billing_use_same_party_balance(db, endpoints, account, party_type):
    party, outlet, _ = account
    party.type = party_type
    db.commit()
    profile = endpoints['get_party_profile'](party.name, db, {'mode':'single','selected':outlet})
    assert profile['party']['balance_after'] == 1250
    assert endpoints['retail_party_balance_after'](db, party.id, outlet.id) == 1250
    for direction in ('RECEIVED', 'PAID'):
        receipt = models.PaymentReceipt(receipt_number=direction, date=date(2026,9,2), outlet_id=outlet.id,
            party_id=party.id, party_name=party.name, direction=direction, amount=100)
        db.add(receipt)
        db.commit()
        assert endpoints['get_payment_receipt'](receipt.id, db, outlet)['balance_after'] == 1250


@pytest.mark.parametrize('file_format', ['json', 'excel', 'pdf'])
def test_export_balances_match_filtered_ledger(db, endpoints, account, file_format):
    party, outlet, _ = account
    result = endpoints['export_report']('ledger', file_format=file_format, party=party.name,
        start_date='2026-09-02', end_date='2026-09-02', db=db, scope={'mode':'single','selected':outlet})
    if file_format == 'json':
        assert result['rows'][-1]['Balance'] == 1200
        assert 'Account Balance' not in result['columns']
        assert 'Opening Balance: 1,000.00' in result['meta_rows']
    elif file_format == 'excel':
        values = list(load_workbook(BytesIO(result.body), data_only=True).active.values)
        assert any('Opening Balance: 1,000.00' in row for row in values)
        assert next(row for row in values if 'Closing Balance' in row)[-1] == 1200
    else:
        assert result.body.startswith(b'%PDF-')
        assert b'Opening Balance: 1,000.00' in result.body
        assert b'Closing Balance: 1,200.00' in result.body


def test_all_party_outstanding_uses_same_balance_and_keeps_prior_history(db, endpoints, account):
    party, outlet, _ = account
    result = endpoints['export_report']('outstanding', file_format='json', start_date='2026-09-02',
        end_date='2026-09-02', db=db, scope={'mode':'single','selected':outlet})
    assert result['rows'] == [{'Party':party.name, 'Type':'BOTH', 'Balance':1200}]


def test_settled_retail_bill_does_not_cross_outlets(db, endpoints, account):
    party, outlet, other = account
    bill = models.RetailBill(id=uuid4(), outlet_id=other.id, party_id=party.id, date=date(2026,9,3),
        bill_number='44', total_amount=100, paid_amount=100, outstanding_amount=0)
    db.add(bill)
    sale = models.Transaction(outlet_id=outlet.id, party_id=party.id, date=bill.date, type='SALE',
        category='RETAIL', bill_number='44', source_ref=f'retail-bill:{bill.id}:1', amount=100)
    db.add(sale)
    db.commit()
    assert ledger(endpoints, db, account)['total_balance'] == 1350
    bill.outlet_id = outlet.id
    db.commit()
    result = ledger(endpoints, db, account)
    assert result['total_balance'] == 1250
    settled_sale = next(row for row in result['ledger'] if row['bill_number'] == '44')
    assert settled_sale['amount'] == 100
    assert settled_sale['delta'] == 0


def test_september_four_activity_is_carried_once_on_five_without_writes(db, endpoints, account):
    party, outlet, _ = account
    scope = {'mode': 'single', 'selected': outlet}
    for day, kind, category, amount in [
        (4, 'SALE', 'WHOLESALE', 500), (4, 'PAYMENT', 'RECEIVED', 100),
        (5, 'SALE', 'WHOLESALE', 300), (5, 'PAYMENT', 'RECEIVED', 50),
    ]:
        db.add(models.Transaction(date=date(2026,9,day), party_id=party.id, outlet_id=outlet.id,
            type=kind, category=category, amount=amount))
    db.commit()
    before = [(row.id, row.date, row.amount, row.source_ref) for row in db.query(models.Transaction).order_by(models.Transaction.id)]
    old = ledger(endpoints, db, account, start_date='2026-09-04', end_date='2026-09-04')
    assert old['ledger_mode'] == 'legacy'
    assert old['summary']['opening_balance'] == 1250
    assert old['total_balance'] == 1650
    assert len(old['ledger']) == 2  # Excludes the obsolete September 4 opening.
    new = ledger(endpoints, db, account, start_date='2026-09-05', end_date='2026-09-05')
    assert new['ledger_mode'] == 'account'
    assert new['ledger'][0]['type'] == 'OPENING RECEIVABLE'
    assert new['ledger'][0]['amount'] == 1650
    assert new['total_balance'] == 1900
    empty = ledger(endpoints, db, account, start_date='2026-09-06', end_date='2026-09-06')
    assert empty['summary']['opening_balance'] == 1900
    assert empty['total_balance'] == 1900
    assert not empty['ledger']
    endpoints['ledger_today'] = lambda: date(2026,9,5)
    assert endpoints['get_party_profile'](party.name, db, scope)['party']['balance_after'] == 1900
    assert endpoints['party_account_balances_as_of'](db, scope, date(2026,9,5))[party.id]['receivable'] == 1900
    report = endpoints['export_report']('outstanding', file_format='json', end_date='2026-09-05', db=db, scope=scope)
    assert report['rows'][0]['Receivable'] == 1900
    assert before == [(row.id, row.date, row.amount, row.source_ref) for row in db.query(models.Transaction).order_by(models.Transaction.id)]
    assert not db.dirty and not db.new and not db.deleted


def test_late_september_four_entry_updates_fifth_opening_without_second_migration(db, endpoints, account):
    first = ledger(endpoints, db, account, end_date='2026-09-05')
    assert first['ledger'][0]['amount'] == 1250
    party, outlet, _ = account
    db.add(models.Transaction(date=date(2026,9,4), party_id=party.id, outlet_id=outlet.id,
        type='SALE', category='WHOLESALE', amount=75))
    db.commit()
    later = ledger(endpoints, db, account, end_date='2026-09-05')
    assert later['ledger'][0]['amount'] == 1325
    assert len(later['ledger']) == 1
    assert ledger(endpoints, db, account, end_date='2026-09-04')['total_balance'] == 1325
    assert ledger(endpoints, db, account, end_date='2026-09-03')['total_balance'] == 1250


def test_no_old_cutover_opening_is_counted_in_fourth_balance_sheet(db, endpoints, account):
    party, outlet, _ = account
    rows = db.query(models.Transaction).filter_by(party_id=party.id, outlet_id=outlet.id).all()
    result = endpoints['build_balance_sheet_rows_from_ledger'](
        db, {party.id: {'party_name': party.name, 'txns': rows}}, date(2026,9,4),
        lambda row: row.type == 'SALE' or (row.type == 'OPENING' and row.category == 'RECEIVABLE'),
        None, None, None, None)
    assert result['totals']['balance'] == 50


def test_transaction_report_hides_obsolete_cutover_marker(db, endpoints, account):
    party, outlet, _ = account
    result = endpoints['export_report']('transactions', file_format='json',
        start_date='2026-09-04', end_date='2026-09-04', party=party.name,
        db=db, scope={'mode': 'single', 'selected': outlet})
    assert result['rows'] == []


def test_fifth_balance_sheet_uses_full_legacy_history_not_only_one_side(db, endpoints, account):
    party, outlet, _ = account
    result = endpoints['daily_sheet'](date='2026-09-05', sheet_type='vendor',
        db=db, scope={'mode': 'single', 'selected': outlet})
    assert result['totals']['old_balance'] == 1250
    assert result['totals']['balance'] == 1250
