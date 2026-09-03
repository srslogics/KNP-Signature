from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.ledger_cutover import PENDING_PARTY_IDS
from scripts.audit_ledger_cutover import audit, check_opening
from app import models


def party():
    return SimpleNamespace(id=uuid4(), name='Test Party', type='BOTH')


def opening(amount, account='PAYABLE'):
    return SimpleNamespace(type='OPENING', date=date(2026, 9, 4),
                           category=account, amount=Decimal(amount))


@pytest.mark.parametrize('account', ['receivable', 'payable'])
@pytest.mark.parametrize('amount', ['1250741.929', '-129.3', '0'])
def test_preserves_exact_amount_in_either_account(account, amount):
    value = Decimal(amount)
    assert check_opening(party(), value, {account: Decimal('1')},
                         [opening(amount, account.upper())]) == 'preserved-opening'


def test_flags_missing_nonzero_opening():
    assert check_opening(party(), Decimal('500'), {'payable': 500}, []) == 'missing-opening'


def test_flags_duplicate_or_altered_openings():
    assert check_opening(party(), Decimal('500'), {'payable': 500},
                         [opening('500'), opening('500')]) == 'duplicate-opening'
    assert check_opening(party(), Decimal('500'), {'payable': 500},
                         [opening('0')]) == 'opening-mismatch'
    assert check_opening(party(), Decimal('500'), {'payable': 500},
                         [opening('500', 'RECEIVABLE')]) == 'opening-mismatch'


def test_pending_parties_keep_history_without_an_opening():
    p = party()
    p.id = next(iter(PENDING_PARTY_IDS))
    assert check_opening(p, Decimal('500'), {}, []) == 'preserved-legacy'
    assert check_opening(p, Decimal('500'), {}, [opening('500')]) == 'unexpected-opening'


def test_full_audit_includes_empty_parties_and_each_outlet(db):
    db.add_all([models.Party(name='Empty', type='BOTH'),
                models.Outlet(name='Main', code='MAIN'), models.Outlet(name='Other', code='OTHER')])
    db.flush()
    result = audit(db)
    assert result['party_count'] == 1
    assert result['party_outlet_count'] == 2
    assert result['statuses'] == {'preserved-zero': 2}
    assert result['failure_count'] == 0
