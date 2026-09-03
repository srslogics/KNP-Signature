# Party Ledger Rules

From 05/09/2026, migrated parties use two independent balances. The unresolved
parties retain their historical running balance without an assumed settlement.
Reports ending on or before 04/09/2026 retain the restored historical
mixed-balance calculation.

The September 5 opening is derived from the full September 4 legacy closing.
Earlier cutover markers are not business transactions and are excluded from
historical calculations. No stored bills, payments or opening records are moved
or rewritten to change the cutover date.

| Business event | Account | Debit | Credit | Balance effect |
| --- | --- | ---: | ---: | --- |
| Customer opening balance | Receivable | Amount | 0 | Customer owes more |
| Sale | Receivable | Amount | 0 | Customer owes more |
| Payment received | Receivable | 0 | Amount | Customer owes less |
| Supplier opening balance | Payable | 0 | Amount | Business owes more |
| Purchase | Payable | 0 | Amount | Business owes more |
| Payment paid | Payable | Amount | 0 | Business owes less |

`Net balance = receivable - payable`.

Receivable and payable must never be collapsed before they are displayed. A
party can be both a customer and a supplier, so a positive receivable and a
positive payable may exist at the same time.

## Retail bills

A retail bill posts its full total as a receivable sale. The amount collected
with that bill posts as a separate receivable credit. This preserves the sale
value while leaving only the unpaid portion in the receivable balance.

## Date ranges

For a report with a start date, opening receivable and opening payable are
calculated from all postings before that date. Only postings inside the chosen
period are displayed. Closing balances are the opening balances plus the
period postings.

## Invoice allocation

General payment receipts reduce the party receivable or payable immediately.
They are not assigned to a particular retail invoice unless the user selects
an invoice or an explicit FIFO allocation rule is introduced. Party balances
must not depend on an assumed invoice allocation.

## Production reconciliation

The ledger redesign derives postings from existing transactions and does not
rewrite historical data. Before deployment, run the read-only reconciliation:

```bash
.venv/bin/python scripts/reconcile_ledger.py --output ledger-reconciliation.csv
```

Use `--outlet-id` or `--party` to narrow the report. Rows marked `REVIEW` have
an unrecognized financial transaction or a retail transaction whose source
bill is missing. The former mixed balance is included only for comparison; it
is not an accounting balance and is expected to differ for supplier activity.
