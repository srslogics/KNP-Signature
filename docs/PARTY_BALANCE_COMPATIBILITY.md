# Party balance cutover

The primary party balance uses the pre-upgrade mixed-ledger calculation through
03/09/2026. The separate receivable/payable ledger begins on 04/09/2026 from an
explicit cutover opening. Historical transactions are never rewritten.

## Rule

- Sales, purchases and all opening entries increase the party balance.
- All stored payments reduce it, whether marked RECEIVED, PAID or unclassified.
- Mortality has no monetary movement.
- Stored retail line amounts are grouped into a bill; effective rate is preserved.
- A fully settled retail sale contributes zero, matching the previous ledger.
  Stored payment transactions remain included exactly as before; no synthetic
  payment is introduced in this compatibility view. This intentionally preserves
  old behaviour, including its accounting limitations, rather than repairing
  historical payment classifications or deduplication rules.
- Settlement matching remains outlet-specific, so another outlet's settled bill
  cannot clear this outlet's sale with the same date/party/bill number.

The pre-upgrade reference is `07f885e:app/main.py`. The new pure helpers in
`app/finance.py` keep this calculation separate from the accounting helpers.

## Cutover opening

Run `scripts/prepare_ledger_cutover.py` in preview mode first, inspect its CSV,
then rerun with `--apply`. It inserts dated `OPENING` rows with a
`ledger-cutover:2026-09-04` source reference. The command is idempotent and
refuses to overwrite a differing opening.

Unambiguous parties carry the restored 03/09 closing balance into the one
account used by their history. AMAR is client-confirmed as receivable. The
other 15 reviewed parties have NOT been confirmed settled. They retain their
historical running ledger, including new transactions, until their account
direction is established. The preparation script rejects unresolved allocations;
it must not create zero openings or infer settlement for them.

The initial cutover release incorrectly treated those 15 parties as settled and
omitted their openings. No settlement transactions were inserted. The correction
removes that unsupported assumption at read time without rewriting any records.

## Consumers

Party ledger totals, profiles, receipts, retail and WhatsApp balances use the
historical method before cutover and the account method after cutover. The
dashboard, top debtors/payables and outstanding report read cutover openings plus
later entries for migrated parties. Unresolved parties remain on the legacy
ledger and appear separately as unclassified balances, not guessed receivables
or payables.

The API returns `ledger_mode` as `legacy` or `account`. Historical views show
one running Balance. Account views show receivable, payable, debit, credit,
account balance and net. A report ending before cutover remains historical; a
current or later report starts at the cutover opening.

Account-specific receivable/payable analytics and dealer/vendor daily sheets
keep their existing scoped definitions. Stock, costing, source mapping, invoice
creation and printer bridge behavior are not changed by this restoration.

## Verification and release

Tests use an isolated SQLite database, not production startup or DDL. They cover
later transactions, mixed parties, unknown payment categories, paid retail bills,
outlets, profiles, receipts and filtered/empty report windows, including Excel
and PDF exports. Current-record reconstructions are not proof of exact past
balances when source entries or bill settlement status have since changed.

Deploy matching backend and frontend versions together after verification and a
database backup. No schema change is required. Prepare the cutover openings
before 04/09/2026, then deploy the matching application version. Other stock-sheet
changes in the same release remain covered by their own tests and rules.
