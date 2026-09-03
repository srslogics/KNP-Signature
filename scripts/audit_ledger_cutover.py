#!/usr/bin/env python3
"""Read-only reconciliation of every party/outlet across the ledger cutover."""
import argparse
import json
import sys
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import models
from app.finance import LEDGER_CUTOVER_DATE, build_legacy_ledger, summarize_legacy_transactions
from app.ledger_cutover import PENDING_PARTY_IDS, allocate_cutover_balance, is_cutover_opening, project_cutover_openings
from scripts.prepare_ledger_cutover import bill_maps, connection_url


def check_opening(party, historical_balance, account_balances, openings, approved_account=None):
    """Compare account amounts, not net signs: a payable remains money owed."""
    if party.id in PENDING_PARTY_IDS:
        return 'preserved-legacy' if not openings else 'unexpected-opening'
    try:
        allocation = {'account': approved_account} if approved_account else allocate_cutover_balance(
            party.name, party.type, historical_balance, account_balances)
    except ValueError:
        return 'unresolved-allocation'
    if not openings:
        return 'preserved-zero' if historical_balance == 0 else 'missing-opening'
    if len(openings) != 1:
        return 'duplicate-opening'
    opening = openings[0]
    if (opening.type != 'OPENING' or opening.date != LEDGER_CUTOVER_DATE
            or opening.category != allocation['account']
            or Decimal(opening.amount) != historical_balance):
        return 'opening-mismatch'
    return 'preserved-opening'


def audit(db):
    from app.finance import build_account_ledger, summarize_transactions

    parties = db.query(models.Party).order_by(models.Party.name).all()
    outlets = db.query(models.Outlet).all()
    txns = db.query(models.Transaction).filter(models.Transaction.party_id.isnot(None)).all()
    history = defaultdict(list)
    openings = defaultdict(list)
    anchors = defaultdict(list)
    bills, settled = bill_maps(db, txns)
    for txn in txns:
        key = (txn.party_id, txn.outlet_id)
        if txn.date < LEDGER_CUTOVER_DATE and not is_cutover_opening(txn):
            history[key].append(txn)
        if is_cutover_opening(txn):
            anchors[key].append(txn)
    projected = project_cutover_openings(txns, {party.id: party for party in parties}, bills, settled, LEDGER_CUTOVER_DATE)
    for txn in projected:
        key = (txn.party_id, txn.outlet_id)
        if is_cutover_opening(txn):
            openings[key].append(txn)
    outlet_names = {outlet.id: outlet.name for outlet in outlets}
    rows = []
    for party in parties:
        # Include empty outlets and parties as well as any legacy null outlet.
        outlet_ids = set(outlet_names) | {
            outlet_id for party_id, outlet_id in set(history) | set(openings)
            if party_id == party.id}
        for outlet_id in sorted(outlet_ids, key=str):
            key = (party.id, outlet_id)
            old_rows = sorted(history[key], key=lambda row: (row.date, row.created_at, str(row.id)))
            balance, _ = build_legacy_ledger(summarize_legacy_transactions(old_rows, settled))
            accounts, _ = build_account_ledger(summarize_transactions(old_rows, bills))
            directions = {txn.category for txn in anchors[key]}
            approved = next(iter(directions)) if len(directions) == 1 else None
            status = check_opening(party, balance, accounts, openings[key], approved)
            rows.append({
                'party': party.name, 'party_id': str(party.id),
                'outlet': outlet_names.get(outlet_id, 'Unassigned'),
                'outlet_id': str(outlet_id), 'historical_balance': str(balance),
                'opening_amount': str(sum((Decimal(row.amount) for row in openings[key]), Decimal('0'))),
                'opening_count': len(openings[key]), 'historical_entries': len(old_rows),
                'status': status,
            })
    failures = [row for row in rows if not row['status'].startswith('preserved-')]
    return {'cutover_date': str(LEDGER_CUTOVER_DATE), 'opening_basis': 'projected from legacy closing',
            'stored_cutover_count': sum(len(rows) for rows in anchors.values()),
            'party_count': len(parties), 'outlet_count': len(outlets),
            'party_outlet_count': len(rows), 'statuses': dict(Counter(row['status'] for row in rows)),
            'failure_count': len(failures), 'failures': failures, 'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--user', default='postgres')
    parser.add_argument('--database', default='postgres')
    parser.add_argument('--port', default='5432')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    args.database_url = None
    engine = create_engine(connection_url(args), connect_args={'connect_timeout': 20})
    with engine.connect() as conn:
        transaction = conn.begin()
        conn.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
        conn.execute(text('SET LOCAL statement_timeout = 60000'))
        with Session(bind=conn) as db:
            result = audit(db)
            result['transaction_read_only'] = conn.execute(text('SHOW transaction_read_only')).scalar()
        transaction.rollback()
    engine.dispose()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key not in {'rows', 'failures'}}, indent=2))
    print('Audit report:', output)
    if result['failures']:
        print(json.dumps(result['failures'], indent=2))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
