import unittest
from decimal import Decimal

from app.domain.finance import (
    account_balance_value,
    ledger_delta_value,
    normalize_journal_lines,
    payable_delta_value,
    receivable_delta_value,
    reversal_numeric_values,
)


class FinanceDomainTests(unittest.TestCase):
    def test_sale_increases_receivable(self):
        self.assertEqual(receivable_delta_value("SALE", "RETAIL", "1250.50"), Decimal("1250.50"))

    def test_received_payment_reduces_receivable(self):
        self.assertEqual(receivable_delta_value("PAYMENT", "RECEIVED", "500"), Decimal("-500"))

    def test_purchase_increases_payable(self):
        self.assertEqual(payable_delta_value("PURCHASE", None, "900"), Decimal("900"))

    def test_paid_payment_reduces_payable(self):
        self.assertEqual(payable_delta_value("PAYMENT", "PAID", "300"), Decimal("-300"))

    def test_reversal_nets_original_to_zero(self):
        original = {"quantity": Decimal("12"), "weight": Decimal("18.750"), "amount": Decimal("2156.25")}
        reversal = reversal_numeric_values(**original)
        for field, value in original.items():
            self.assertEqual(value + reversal[field], Decimal("0"))

    def test_ledger_reversal_nets_original_sale(self):
        original = ledger_delta_value("SALE", "RETAIL", "725")
        reversal = ledger_delta_value("SALE", "RETAIL", "-725")
        self.assertEqual(original + reversal, Decimal("0"))

    def test_balanced_journal_is_accepted(self):
        lines = normalize_journal_lines([
            {"account_code": "1000", "debit": "500", "credit": "0"},
            {"account_code": "4000", "debit": "0", "credit": "500"},
        ])
        self.assertEqual(sum(line["debit"] for line in lines), sum(line["credit"] for line in lines))

    def test_unbalanced_journal_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_journal_lines([
                {"account_code": "1000", "debit": "500", "credit": "0"},
                {"account_code": "4000", "debit": "0", "credit": "450"},
            ])

    def test_asset_and_income_balances_use_correct_normal_side(self):
        self.assertEqual(account_balance_value("ASSET", "700", "200"), Decimal("500"))
        self.assertEqual(account_balance_value("INCOME", "200", "700"), Decimal("500"))


if __name__ == "__main__":
    unittest.main()
