# Live Stock and Sheet Reconciliation

## Stock Basis

- Process Day actuals are physical **live-bird** counts, in kg and whole NAG.
- Supported sources are BB, CB, COCREL, LEGOAN and DP. Known sale subtypes map to these sources without changing historical transactions.
- The five Process Day inputs retain their zero defaults. Saving replaces that date's actuals and refreshes later derived snapshots for the same outlet.
- Opening is the exact previous calendar day's actual, never one-time setup stock or the last older available count.
- Expected closing = opening + purchases - live sales - live birds taken for dressing - transport mortality - shop mortality.
- Dressed sales do not reduce live stock a second time. Cutting entries must identify their live source.
- Shortage = expected closing - actual. Missing counts are unknown, not zero. Sheets remain accessible.

## Cost and Profit

- Live stock uses weighted-average cost per source, including valued opening stock and today's purchases. A known purchase cost can seed subsequent counted stock even if the initial opening quantity was missing; it does not fill that missing quantity.
- Known cost carries across no-purchase days. Unknown opening costs are not treated as free stock.
- Cutting transfers live cost into dressed output using the entered yield. Dressed cost is consumed oldest-batch-first and unsold output carries forward.
- Gross profit is live and dressed revenue minus their costs and recorded mortality cost. It is not sales minus today's purchases, and is not net profit after expenses or unexplained physical variance.
- Incomplete or unidentified movements, costs or yields show unavailable values rather than invented profit. Legacy generic cutting names need source correction before affected stock can reconcile.

## Financial Sheets and Downloads

- Financial Summary and daily party balance sheets use the ledger's financial events, including both sale and payment for fully paid retail bills.
- A part-payment is counted once; the remaining balance stays outstanding. Date and outlet filters remain in effect.
- Stock export bill details have dedicated Party, Bill No, Bill Amount, Paid, Outstanding and Mode columns. They never occupy NAG or Weight columns.
- Missing numeric values stay blank/unavailable in downloads. Kg columns retain three decimals.

## Verification and Release

- `python -m pytest -q` runs isolated in-memory tests against the real calculation and endpoint functions. It does not import production startup DDL or connect to production.
- Local browser checks use sample data, not the client's records. These checks do not verify PostgreSQL locking, authentication or a deployed release.
- No schema migration, print bridge update or historical transaction rewrite is required by this change.
- Before production rollout, test a database copy with a known processed day, the following day, a corrected backdated count, and cash/credit/part-paid bills. Check legacy cutting sources and costs flagged as unavailable.
- Deploy backend and frontend together after that check. Updated asset versions invalidate old frontend files; do not deploy automatically from this verification task.
