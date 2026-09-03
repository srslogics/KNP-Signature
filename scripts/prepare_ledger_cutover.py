#!/usr/bin/env python3
import argparse
import csv
import getpass
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import models
from app.finance import (
    LEDGER_CUTOVER_DATE,
    build_account_ledger,
    build_legacy_ledger,
    retail_bill_id_from_source_ref,
    summarize_legacy_transactions,
    summarize_transactions,
)
from app.ledger_cutover import SETTLED, allocate_cutover_balance


def parse_args():
    parser = argparse.ArgumentParser(description="Prepare the 04/09/2026 party-ledger cutover openings.")
    parser.add_argument("--database-url", help="Full PostgreSQL URL. Omit to enter connection fields securely.")
    parser.add_argument("--host", help="PostgreSQL host used with the secure password prompt")
    parser.add_argument("--user", default="postgres")
    parser.add_argument("--database", default="postgres")
    parser.add_argument("--port", default="5432")
    parser.add_argument("--apply", action="store_true", help="Insert openings; default is read-only preview")
    parser.add_argument("--output", default="ledger-cutover-preview.csv")
    return parser.parse_args()


def connection_url(args):
    if args.database_url:
        return args.database_url
    if not args.host:
        raise ValueError("Provide --database-url or --host")
    password = getpass.getpass("Database password: ")
    return f"postgresql://{quote(args.user)}:{quote(password)}@{args.host}:{args.port}/{args.database}"


def bill_maps(db, txns):
    bill_ids = set()
    for txn in txns:
        bill_id = retail_bill_id_from_source_ref(txn.source_ref)
        if bill_id:
            bill_ids.add(bill_id)
    bills = db.query(models.RetailBill).filter(
        models.RetailBill.date < LEDGER_CUTOVER_DATE,
        models.RetailBill.party_id.isnot(None),
    ).all()
    bills_by_id = {str(bill.id): bill for bill in bills if str(bill.id) in bill_ids}
    settled_keys = {
        (bill.outlet_id, bill.date, bill.party_id, str(bill.bill_number or "").strip())
        for bill in bills if (bill.outstanding_amount or 0) <= 0
    }
    return bills_by_id, settled_keys


def main():
    args = parse_args()
    engine = create_engine(connection_url(args))
    db = sessionmaker(bind=engine)()
    try:
        txns = db.query(models.Transaction).filter(
            models.Transaction.party_id.isnot(None),
            models.Transaction.date < LEDGER_CUTOVER_DATE,
        ).order_by(
            models.Transaction.outlet_id,
            models.Transaction.party_id,
            models.Transaction.date,
            models.Transaction.created_at,
            models.Transaction.id,
        ).all()
        party_ids = {txn.party_id for txn in txns}
        parties = {
            party.id: party
            for party in db.query(models.Party).filter(models.Party.id.in_(party_ids)).all()
        }
        bills_by_id, settled_keys = bill_maps(db, txns)
        grouped = defaultdict(list)
        for txn in txns:
            grouped[(txn.outlet_id, txn.party_id)].append(txn)

        rows = []
        inserts = []
        for (outlet_id, party_id), party_txns in grouped.items():
            party = parties[party_id]
            legacy_balance, _ = build_legacy_ledger(
                summarize_legacy_transactions(party_txns, settled_keys)
            )
            account_balances, _ = build_account_ledger(
                summarize_transactions(party_txns, bills_by_id)
            )
            allocation = allocate_cutover_balance(
                party.name, party.type, legacy_balance, account_balances
            )
            source_ref = f"ledger-cutover:{LEDGER_CUTOVER_DATE}:{outlet_id}"
            existing = db.query(models.Transaction).filter(
                models.Transaction.party_id == party_id,
                models.Transaction.outlet_id == outlet_id,
                models.Transaction.source_ref == source_ref,
            ).first()
            action = "settled" if allocation["account"] == SETTLED else "insert"
            if existing:
                expected = (allocation["account"], allocation["amount"])
                actual = (str(existing.category or "").upper(), existing.amount)
                if expected != actual:
                    raise ValueError(f"Existing cutover opening differs for {party.name}")
                action = "already-present"
            elif allocation["account"] != SETTLED and allocation["amount"] != 0:
                inserts.append(models.Transaction(
                    date=LEDGER_CUTOVER_DATE,
                    outlet_id=outlet_id,
                    party_id=party_id,
                    type="OPENING",
                    category=allocation["account"],
                    item_type="Ledger cutover",
                    quantity=0,
                    weight=0,
                    rate=0,
                    amount=allocation["amount"],
                    payment_mode="NA",
                    bill_number="",
                    source_ref=source_ref,
                ))
            rows.append({
                "Party": party.name,
                "Party Type": party.type or "",
                "Outlet ID": str(outlet_id or ""),
                "Restored Balance 03/09/2026": legacy_balance,
                "Opening Account 04/09/2026": allocation["account"],
                "Opening Amount": allocation["amount"],
                "Reason": allocation["reason"],
                "Action": action,
            })

        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

        if args.apply:
            db.add_all(inserts)
            db.commit()
        else:
            db.rollback()
        print(f"Prepared {len(rows)} party/outlet balances; {len(inserts)} openings {'inserted' if args.apply else 'ready'}.")
        print(f"Review file: {output}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    main()
