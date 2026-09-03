# Party balance cutover

The primary party balance uses the pre-upgrade mixed-ledger calculation through
04/09/2026. The separate receivable/payable ledger begins on 05/09/2026 from a
derived cutover opening. Historical transactions are never rewritten.

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

The cutover was postponed from September 4 to September 5. Existing September 4
`ledger-cutover:` records remain stored but are excluded from historical totals.
They supply the already-established account direction, not a second balance.
The shared read path derives a September 5 opening from the entire legacy
closing through September 4. Entries added later on September 4 therefore carry
forward without a second migration or duplicate opening. This projection is
never added to the database session. The old preparation script now rejects
`--apply`; use the read-only audit script to verify the projected openings.

Unambiguous parties carry the restored 04/09 closing balance into the one
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

Preservation applies to every party, not only the unresolved list. Run
`scripts/audit_ledger_cutover.py --host HOST --user USER --output PATH` to check
all parties in all outlets. It prompts for the password and enforces a
repeatable-read, read-only database transaction. It checks exact carried amounts
and account direction, missing/duplicate openings, unresolved parties and zero
balances without importing application startup or modifying records. Payable
amounts are compared in their own account, not to the net receivable-minus-payable
sign shown in some reports. The command exits unsuccessfully for any discrepancy.

The initial 04/09/2026 production audit checked 205 parties across 3 outlets (615
combinations): 136 exact carried openings, 45 legacy combinations for the 15
unresolved parties, and 434 zero combinations, including empty outlets. No
discrepancies were found. The historical balances also matched all 205 entries
in the saved restoration verification file. This verifies the cutover against
that reconstruction, not an independent database backup from before the upgrade.
The postponed 05/09 projection was audited again with the full 04/09 history and
reported the same coverage with zero preservation failures.

Tests use an isolated SQLite database, not production startup or DDL. They cover
later transactions, mixed parties, unknown payment categories, paid retail bills,
outlets, profiles, receipts and filtered/empty report windows, including Excel
and PDF exports. Current-record reconstructions are not proof of exact past
balances when source entries or bill settlement status have since changed.

Deploy the date-boundary correction before 05/09/2026. No schema change or
production data write is required. Verify projected openings with the read-only
audit. Other stock-sheet
changes in the same release remain covered by their own tests and rules.
