#!/usr/bin/env python3
import argparse
import csv
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import models  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.finance import (  # noqa: E402
    build_account_ledger,
    decimal_value,
    posting_account,
    retail_bill_id_from_source_ref,
    summarize_transactions,
)


def legacy_mixed_balance(transactions, bills_by_key):
    balance = Decimal("0")
    for transaction in transactions:
        amount = decimal_value(transaction.amount)
        category = str(transaction.category or "").upper()
        key = (
            transaction.outlet_id,
            transaction.date,
            transaction.party_id,
            str(transaction.bill_number or "").strip(),
        )
        if (
            transaction.type == "SALE"
            and category in {"RETAIL", "RETAIL DRESSED"}
            and decimal_value(getattr(bills_by_key.get(key), "outstanding_amount", None)) <= 0
            and key in bills_by_key
        ):
            continue
        if transaction.type in {"SALE", "PURCHASE", "OPENING"}:
            balance += amount
        elif transaction.type == "PAYMENT":
            balance -= amount
    return balance


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create a read-only receivable/payable reconciliation CSV."
    )
    parser.add_argument("--outlet-id", help="Limit the report to one outlet UUID")
    parser.add_argument("--party", help="Limit the report to party names containing this text")
    parser.add_argument(
        "--output",
        default="ledger-reconciliation.csv",
        help="CSV destination (default: ledger-reconciliation.csv)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    db = SessionLocal()
    try:
        transaction_query = db.query(models.Transaction).filter(
            models.Transaction.party_id.isnot(None)
        )
        bill_query = db.query(models.RetailBill).filter(
            models.RetailBill.party_id.isnot(None)
        )
        if args.outlet_id:
            transaction_query = transaction_query.filter(models.Transaction.outlet_id == args.outlet_id)
            bill_query = bill_query.filter(models.RetailBill.outlet_id == args.outlet_id)

        transactions = transaction_query.order_by(
            models.Transaction.outlet_id.asc(),
            models.Transaction.party_id.asc(),
            models.Transaction.date.asc(),
            models.Transaction.created_at.asc(),
            models.Transaction.id.asc(),
        ).all()
        bills = bill_query.all()
        party_ids = {transaction.party_id for transaction in transactions}
        parties = {
            party.id: party
            for party in db.query(models.Party).filter(models.Party.id.in_(party_ids)).all()
        } if party_ids else {}

        bills_by_id = {str(bill.id): bill for bill in bills}
        bills_by_key = {
            (bill.outlet_id, bill.date, bill.party_id, str(bill.bill_number or "").strip()): bill
            for bill in bills
        }
        grouped = defaultdict(list)
        for transaction in transactions:
            party = parties.get(transaction.party_id)
            if args.party and args.party.lower() not in str(getattr(party, "name", "")).lower():
                continue
            grouped[(transaction.outlet_id, transaction.party_id)].append(transaction)

        rows = []
        for (outlet_id, party_id), party_transactions in grouped.items():
            events = summarize_transactions(party_transactions, bills_by_id)
            balances, postings = build_account_ledger(events)
            orphaned_bill_refs = {
                bill_id
                for transaction in party_transactions
                if (bill_id := retail_bill_id_from_source_ref(transaction.source_ref))
                and bill_id not in bills_by_id
            }
            unmapped = sum(
                1
                for transaction in party_transactions
                if transaction.type != "MORTALITY"
                and posting_account(transaction.type, transaction.category) is None
            )
            old_balance = legacy_mixed_balance(party_transactions, bills_by_key)
            party = parties.get(party_id)
            rows.append({
                "Outlet ID": str(outlet_id or ""),
                "Party": party.name if party else str(party_id),
                "Party Type": party.type if party else "",
                "Source Transactions": len(party_transactions),
                "Ledger Postings": len(postings),
                "Receivable": balances["receivable"],
                "Payable": balances["payable"],
                "Net": balances["net"],
                "Former Mixed Balance": old_balance,
                "Unmapped Financial Rows": unmapped,
                "Missing Retail Bills": len(orphaned_bill_refs),
                "Status": "REVIEW" if unmapped or orphaned_bill_refs else "OK",
            })

        destination = Path(args.output).expanduser().resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        columns = [
            "Outlet ID", "Party", "Party Type", "Source Transactions", "Ledger Postings",
            "Receivable", "Payable", "Net", "Former Mixed Balance",
            "Unmapped Financial Rows", "Missing Retail Bills", "Status",
        ]
        with destination.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)

        review_count = sum(1 for row in rows if row["Status"] == "REVIEW")
        print(f"Wrote {len(rows)} party balances to {destination}")
        print(f"Rows requiring review: {review_count}")
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Reconciliation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
