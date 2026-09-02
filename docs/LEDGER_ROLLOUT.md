# Ledger Rollout

This change is read-compatible with the existing `transactions`,
`retail_bills`, and `payment_receipts` tables. It does not rewrite historical
records and does not add startup DDL.

## Before deployment

1. Take a database backup or create a database snapshot.
2. Point `DATABASE_URL` at a restored copy of production data.
3. Run `.venv/bin/python scripts/reconcile_ledger.py`.
4. Investigate every row marked `REVIEW`.
5. Compare at least one customer, one supplier, and one `BOTH` party against
   verified statements.
6. Confirm that a cash retail bill closes its receivable to zero and that a
   credit bill leaves only its unpaid amount.

## Deployment

Deploy the backend and frontend from the same commit. The response contains
the old `total_balance` field for compatibility plus separate `receivable`,
`payable`, and `net` balances for the new interface.

## Rollback

Rollback only the application commit. No database rollback is needed because
this phase does not change or migrate stored data.

## Deferred work

Payment receipts change the correct party account, but they are not allocated
to individual invoices. Invoice ageing must remain labelled as invoice-level
outstanding until an explicit allocation workflow is implemented and tested.
