# Production Upgrade

## Deployment order

1. Take a Supabase database backup.
2. Deploy the backend. The start command runs `alembic upgrade head` before starting the API.
3. Confirm `/healthz` responds successfully.
4. Deploy the frontend and refresh once so service-worker cache `20260805-5` activates.
5. Sign in as Owner, select one outlet, and open **Accounts**.
6. Set the full historical date range and run **Sync Existing Records** once.
7. Confirm Trial Balance total debit equals total credit.
8. Compare Accounts Receivable and Accounts Payable with the existing party ledgers.
9. Lock completed business dates from **Access Control** after verification.

## Operational rules

- Cancelling a bill, receipt, expense, or journal creates a reversing entry. Posted financial records are not deleted.
- A locked day cannot accept bills, receipts, uploads, process-day changes, expenses, journals, or cancellations.
- Credit blocking is disabled until an owner sets a positive limit and enables **Block** for that party.
- Existing operational records remain the source for party ledgers and stock sheets. The accounting journal is a parallel balanced book.
- GST calculation is not enabled until the business GSTIN, tax status, and item tax rates are confirmed.

## Recovery

- If migration fails, the API will not start. Review the migration error before retrying; do not restore an older application against a partially migrated database.
- If historical sync stops, run **Sync Existing Records** again. The sync is idempotent and continues with records that do not yet have a journal reference.
- Do not delete journal rows manually. Use the cancellation action so the audit history and balances remain complete.
