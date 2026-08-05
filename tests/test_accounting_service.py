import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.db import Base
from app.services.accounting import (
    post_operational_transaction,
    reverse_journal_entry,
    trial_balance_rows,
)


class AccountingServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.outlet = models.Outlet(id=uuid4(), name="Test Outlet", code="TEST")
        self.party = models.Party(id=uuid4(), name="Test Party", normalized_name="TESTPARTY", type="BOTH")
        self.db.add_all([self.outlet, self.party])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def add_transaction(self, transaction_type, category, amount, payment_mode="Cash"):
        transaction = models.Transaction(
            id=uuid4(),
            date=date(2026, 8, 5),
            outlet_id=self.outlet.id,
            party_id=self.party.id,
            type=transaction_type,
            category=category,
            item_type="CB",
            amount=Decimal(str(amount)),
            payment_mode=payment_mode,
            source_ref="",
        )
        self.db.add(transaction)
        self.db.flush()
        return transaction

    def test_sale_posts_balanced_journal_once(self):
        transaction = self.add_transaction("SALE", "WHOLESALE", "1250.50")
        entry = post_operational_transaction(self.db, transaction)
        duplicate = post_operational_transaction(self.db, transaction)
        self.db.commit()

        lines = self.db.query(models.JournalLine).filter(models.JournalLine.entry_id == entry.id).all()
        self.assertEqual(entry.id, duplicate.id)
        self.assertEqual(self.db.query(models.JournalEntry).count(), 1)
        self.assertEqual(sum(Decimal(line.debit or 0) for line in lines), Decimal("1250.50"))
        self.assertEqual(sum(Decimal(line.credit or 0) for line in lines), Decimal("1250.50"))

    def test_paid_payment_debits_payable_and_credits_cash(self):
        transaction = self.add_transaction("PAYMENT", "PAID", "500", "Cash")
        entry = post_operational_transaction(self.db, transaction)
        self.db.commit()
        lines = self.db.query(models.JournalLine, models.Account).join(
            models.Account, models.Account.id == models.JournalLine.account_id,
        ).filter(models.JournalLine.entry_id == entry.id).all()
        amounts = {account.code: (Decimal(line.debit or 0), Decimal(line.credit or 0)) for line, account in lines}
        self.assertEqual(amounts["2000"], (Decimal("500"), Decimal("0")))
        self.assertEqual(amounts["1000"], (Decimal("0"), Decimal("500")))

    def test_reversal_nets_trial_balance_to_zero(self):
        transaction = self.add_transaction("PURCHASE", None, "900")
        entry = post_operational_transaction(self.db, transaction)
        reverse_journal_entry(self.db, entry, user_id=None, reason="Test correction")
        self.db.commit()

        balances = trial_balance_rows(self.db, self.outlet.id)
        self.assertTrue(all(abs(row["balance"]) < 0.0001 for row in balances))


if __name__ == "__main__":
    unittest.main()
