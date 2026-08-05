"""Add production control foundation.

Revision ID: 20260805_0001
Revises:
Create Date: 2026-08-05
"""
from alembic import op

from app.db import Base
from app import models  # noqa: F401


revision = "20260805_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Transitional baseline: creates a complete schema for a new install and
    # leaves the existing production tables untouched.
    Base.metadata.create_all(bind=bind)

    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES transactions(id)")
    op.execute("ALTER TABLE retail_bills ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'POSTED'")
    op.execute("ALTER TABLE retail_bills ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP")
    op.execute("ALTER TABLE retail_bills ADD COLUMN IF NOT EXISTS voided_by_user_id UUID REFERENCES users(id)")
    op.execute("ALTER TABLE retail_bills ADD COLUMN IF NOT EXISTS void_reason VARCHAR")
    op.execute("ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'POSTED'")
    op.execute("ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP")
    op.execute("ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS voided_by_user_id UUID REFERENCES users(id)")
    op.execute("ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS void_reason VARCHAR")

    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_outlet_time ON audit_events (outlet_id, occurred_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events (entity_type, entity_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_period_locks_outlet_date ON accounting_period_locks (outlet_id, lock_date)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_transactions_reversal_of ON transactions (reversal_of_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_accounts_outlet_type ON accounts (outlet_id, account_type)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_journal_entries_outlet_date ON journal_entries (outlet_id, date)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_journal_entries_reference ON journal_entries (reference_type, reference_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines (entry_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines (account_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_party_credit_outlet_party ON party_credit_profiles (outlet_id, party_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS party_credit_profiles")
    op.execute("DROP TABLE IF EXISTS journal_lines")
    op.execute("DROP TABLE IF EXISTS journal_entries")
    op.execute("DROP TABLE IF EXISTS accounts")
    op.execute("DROP INDEX IF EXISTS idx_transactions_reversal_of")
    op.execute("DROP INDEX IF EXISTS idx_period_locks_outlet_date")
    op.execute("DROP INDEX IF EXISTS idx_audit_events_entity")
    op.execute("DROP INDEX IF EXISTS idx_audit_events_outlet_time")
    op.execute("DROP TABLE IF EXISTS audit_events")
    op.execute("DROP TABLE IF EXISTS accounting_period_locks")
