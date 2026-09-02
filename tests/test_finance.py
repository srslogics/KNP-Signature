import unittest
from decimal import Decimal

from app.finance import (
    PAYABLE,
    RECEIVABLE,
    build_account_ledger,
    posting_values,
    summarize_transactions,
)


class FinancePostingTests(unittest.TestCase):
    def test_sales_and_receipts_stay_in_receivables(self):
        balances, rows = build_account_ledger([
            {"type": "SALE", "amount": "1000"},
            {"type": "PAYMENT", "category": "RECEIVED", "amount": "300"},
        ])

        self.assertEqual(balances["receivable"], Decimal("700"))
        self.assertEqual(balances["payable"], Decimal("0"))
        self.assertEqual(rows[-1]["credit"], Decimal("300"))

    def test_purchases_and_payments_stay_in_payables(self):
        balances, rows = build_account_ledger([
            {"type": "PURCHASE", "amount": "900"},
            {"type": "PAYMENT", "category": "PAID", "amount": "250"},
        ])

        self.assertEqual(balances["payable"], Decimal("650"))
        self.assertEqual(rows[0]["account"], PAYABLE)
        self.assertEqual(rows[-1]["debit"], Decimal("250"))

    def test_both_party_balances_are_not_collapsed(self):
        balances, _ = build_account_ledger([
            {"type": "SALE", "amount": "1200"},
            {"type": "PURCHASE", "amount": "800"},
        ])

        self.assertEqual(balances["receivable"], Decimal("1200"))
        self.assertEqual(balances["payable"], Decimal("800"))
        self.assertEqual(balances["net"], Decimal("400"))

    def test_opening_balances_keep_their_account(self):
        receivable = posting_values("OPENING", "RECEIVABLE", "75")
        payable = posting_values("OPENING", "PAYABLE", "40")

        self.assertEqual(receivable["account"], RECEIVABLE)
        self.assertEqual(receivable["debit"], Decimal("75"))
        self.assertEqual(payable["account"], PAYABLE)
        self.assertEqual(payable["credit"], Decimal("40"))

    def test_period_opening_balances_are_carried_forward(self):
        balances, rows = build_account_ledger(
            [{"type": "PAYMENT", "category": "RECEIVED", "amount": "100"}],
            {"receivable": "500", "payable": "200"},
        )

        self.assertEqual(balances["receivable"], Decimal("400"))
        self.assertEqual(balances["payable"], Decimal("200"))
        self.assertEqual(rows[0]["account_balance"], Decimal("400"))
        self.assertEqual(rows[0]["net_balance"], Decimal("200"))

    def test_paid_retail_bill_posts_sale_and_matching_receipt(self):
        transactions = [
            {
                "date": "2026-09-01",
                "type": "SALE",
                "category": "RETAIL",
                "amount": "600",
                "weight": "4",
                "quantity": "2",
                "source_ref": "retail-bill:bill-1:1",
            },
            {
                "date": "2026-09-01",
                "type": "SALE",
                "category": "RETAIL",
                "amount": "400",
                "weight": "2",
                "quantity": "1",
                "source_ref": "retail-bill:bill-1:2",
            },
        ]
        events = summarize_transactions(
            transactions,
            {"bill-1": {"total_amount": "1000", "paid_amount": "1000"}},
        )
        balances, rows = build_account_ledger(events)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["debit"], Decimal("1000"))
        self.assertEqual(rows[1]["credit"], Decimal("1000"))
        self.assertEqual(balances["receivable"], Decimal("0"))

    def test_partial_retail_payment_is_not_counted_twice(self):
        transactions = [
            {
                "type": "SALE",
                "amount": "1000",
                "source_ref": "retail-bill:bill-2:1",
            },
            {
                "type": "PAYMENT",
                "category": "RECEIVED",
                "amount": "300",
                "source_ref": "retail-payment:bill-2",
            },
        ]
        events = summarize_transactions(
            transactions,
            {"bill-2": {"total_amount": "1000", "paid_amount": "300"}},
        )
        balances, rows = build_account_ledger(events)

        self.assertEqual(len(rows), 2)
        self.assertEqual(balances["receivable"], Decimal("700"))

    def test_orphaned_retail_payment_remains_visible(self):
        events = summarize_transactions([
            {
                "type": "PAYMENT",
                "category": "RECEIVED",
                "amount": "250",
                "source_ref": "retail-payment:missing-bill",
            }
        ])
        balances, rows = build_account_ledger(events)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["credit"], Decimal("250"))
        self.assertEqual(balances["receivable"], Decimal("-250"))

    def test_known_knp_statement_closes_to_reported_receivable(self):
        sale_amounts = [
            "3373.25", "798.00", "1584.00", "3026.80",
            "8018.20", "5616.00", "5722.42", "1502.42",
        ]
        rows = [{"type": "OPENING", "category": "RECEIVABLE", "amount": "76977.60"}]
        rows.extend({"type": "SALE", "amount": amount} for amount in sale_amounts)
        rows.extend([
            {"type": "PAYMENT", "category": "RECEIVED", "amount": "8000"},
            {"type": "PAYMENT", "category": "RECEIVED", "amount": "10000"},
        ])

        balances, _ = build_account_ledger(rows)

        self.assertEqual(balances["receivable"], Decimal("88618.69"))
        self.assertEqual(balances["payable"], Decimal("0"))


if __name__ == "__main__":
    unittest.main()
