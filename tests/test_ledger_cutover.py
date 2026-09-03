from decimal import Decimal

import pytest

from app.finance import PAYABLE, RECEIVABLE
from app.ledger_cutover import SETTLED, allocate_cutover_balance


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
def test_client_cleared_review_parties_start_at_zero(name):
    result = allocate_cutover_balance(
        name, 'BOTH', Decimal('999'),
        {'receivable': Decimal('400'), 'payable': Decimal('599')},
    )
    assert result['account'] == SETTLED
    assert result['amount'] == 0


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
