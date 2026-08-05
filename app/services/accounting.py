from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func

from app import models
from app.domain.finance import account_balance_value, decimal_value, normalize_journal_lines


SYSTEM_ACCOUNTS = (
    ("1000", "Cash", "ASSET", "CASH"),
    ("1010", "Bank", "ASSET", "BANK"),
    ("1100", "Accounts Receivable", "ASSET", "RECEIVABLE"),
    ("1200", "Inventory", "ASSET", "INVENTORY"),
    ("2000", "Accounts Payable", "LIABILITY", "PAYABLE"),
    ("3000", "Owner Equity", "EQUITY", "CAPITAL"),
    ("4000", "Sales", "INCOME", "SALES"),
    ("5000", "Cost of Goods Sold", "EXPENSE", "COGS"),
    ("5100", "Purchases", "EXPENSE", "PURCHASES"),
    ("6000", "General Expense", "EXPENSE", "GENERAL"),
    ("6010", "Transport Expense", "EXPENSE", "TRANSPORT"),
    ("6020", "Rent Expense", "EXPENSE", "RENT"),
    ("6030", "Utilities Expense", "EXPENSE", "UTILITIES"),
    ("6040", "Salary Expense", "EXPENSE", "SALARY"),
    ("6050", "Repairs Expense", "EXPENSE", "REPAIRS"),
    ("6060", "Other Expense", "EXPENSE", "OTHER"),
)


def ensure_system_accounts(db, outlet_id):
    existing = {
        row.code: row
        for row in db.query(models.Account).filter(models.Account.outlet_id == outlet_id).all()
    }
    created = []
    for code, name, account_type, subtype in SYSTEM_ACCOUNTS:
        if code in existing:
            continue
        account = models.Account(
            id=uuid4(),
            outlet_id=outlet_id,
            code=code,
            name=name,
            account_type=account_type,
            subtype=subtype,
            is_system=True,
            is_active=True,
        )
        db.add(account)
        existing[code] = account
        created.append(account)
    if created:
        db.flush()
    return existing


def journal_number(entry_type, target_date):
    prefix = str(entry_type or "JV").upper()[:3]
    return f"{prefix}-{target_date.strftime('%Y%m%d')}-{uuid4().hex[:8].upper()}"


def create_journal_entry(
    db,
    *,
    outlet_id,
    target_date,
    entry_type,
    lines,
    user_id=None,
    narration=None,
    reference_type=None,
    reference_id=None,
):
    accounts = ensure_system_accounts(db, outlet_id)
    normalized = normalize_journal_lines(lines)

    if reference_type and reference_id:
        existing = db.query(models.JournalEntry).filter(
            models.JournalEntry.outlet_id == outlet_id,
            models.JournalEntry.reference_type == str(reference_type).upper(),
            models.JournalEntry.reference_id == str(reference_id),
            models.JournalEntry.status == "POSTED",
        ).first()
        if existing:
            return existing

    entry = models.JournalEntry(
        id=uuid4(),
        outlet_id=outlet_id,
        date=target_date,
        entry_number=journal_number(entry_type, target_date),
        entry_type=str(entry_type or "GENERAL").upper(),
        reference_type=str(reference_type or "").upper() or None,
        reference_id=str(reference_id) if reference_id is not None else None,
        narration=str(narration or "").strip() or None,
        status="POSTED",
        created_by_user_id=user_id,
    )
    db.add(entry)
    db.flush()

    for line in normalized:
        account = None
        account_id = line.get("account_id")
        account_code = str(line.get("account_code") or "").strip()
        if account_id:
            account = db.query(models.Account).filter(
                models.Account.id == account_id,
                models.Account.outlet_id == outlet_id,
                models.Account.is_active.is_(True),
            ).first()
        elif account_code:
            account = accounts.get(account_code) or db.query(models.Account).filter(
                models.Account.outlet_id == outlet_id,
                models.Account.code == account_code,
                models.Account.is_active.is_(True),
            ).first()
        if not account:
            raise ValueError(f"Account not found: {account_code or account_id}")
        db.add(models.JournalLine(
            id=uuid4(),
            entry_id=entry.id,
            account_id=account.id,
            party_id=line.get("party_id") or None,
            description=str(line.get("description") or "").strip() or None,
            debit=line["debit"],
            credit=line["credit"],
        ))
    db.flush()
    return entry


def payment_account_code(payment_mode):
    return "1000" if str(payment_mode or "").strip().upper() == "CASH" else "1010"


def post_retail_bill(db, bill, *, user_id=None):
    total = bill.total_amount or 0
    paid = bill.paid_amount or 0
    outstanding = bill.outstanding_amount or 0
    lines = []
    if paid:
        lines.append({
            "account_code": payment_account_code(bill.payment_mode),
            "party_id": bill.party_id,
            "description": f"Payment for bill {bill.bill_number}",
            "debit": paid,
            "credit": 0,
        })
    if outstanding:
        lines.append({
            "account_code": "1100",
            "party_id": bill.party_id,
            "description": f"Credit for bill {bill.bill_number}",
            "debit": outstanding,
            "credit": 0,
        })
    lines.append({
        "account_code": "4000",
        "party_id": bill.party_id,
        "description": f"Retail bill {bill.bill_number}",
        "debit": 0,
        "credit": total,
    })
    return create_journal_entry(
        db,
        outlet_id=bill.outlet_id,
        target_date=bill.date,
        entry_type="SALE",
        lines=lines,
        user_id=user_id,
        narration=f"Retail bill {bill.bill_number}",
        reference_type="RETAIL_BILL",
        reference_id=bill.id,
    )


def post_payment_receipt(db, receipt, *, user_id=None):
    cash_or_bank = payment_account_code(receipt.payment_mode)
    if str(receipt.direction or "").upper() == "RECEIVED":
        lines = [
            {"account_code": cash_or_bank, "party_id": receipt.party_id, "debit": receipt.amount, "credit": 0},
            {"account_code": "1100", "party_id": receipt.party_id, "debit": 0, "credit": receipt.amount},
        ]
    else:
        lines = [
            {"account_code": "2000", "party_id": receipt.party_id, "debit": receipt.amount, "credit": 0},
            {"account_code": cash_or_bank, "party_id": receipt.party_id, "debit": 0, "credit": receipt.amount},
        ]
    return create_journal_entry(
        db,
        outlet_id=receipt.outlet_id,
        target_date=receipt.date,
        entry_type="RECEIPT" if str(receipt.direction or "").upper() == "RECEIVED" else "PAYMENT",
        lines=lines,
        user_id=user_id,
        narration=f"Payment receipt {receipt.receipt_number}",
        reference_type="PAYMENT_RECEIPT",
        reference_id=receipt.id,
    )


def post_operational_transaction(db, transaction, *, user_id=None):
    transaction_type = str(transaction.type or "").upper()
    category = str(transaction.category or "").upper()
    amount = decimal_value(transaction.amount)
    if amount == 0 or transaction_type == "MORTALITY":
        return None

    value = abs(amount)
    party_id = transaction.party_id
    description = " ".join(part for part in [transaction_type.title(), transaction.item_type, transaction.bill_number] if part)
    payment_code = payment_account_code(transaction.payment_mode)

    if transaction_type == "SALE":
        lines = [
            {"account_code": "1100", "party_id": party_id, "debit": value, "credit": 0},
            {"account_code": "4000", "party_id": party_id, "debit": 0, "credit": value},
        ]
    elif transaction_type == "PURCHASE":
        lines = [
            {"account_code": "5100", "party_id": party_id, "debit": value, "credit": 0},
            {"account_code": "2000", "party_id": party_id, "debit": 0, "credit": value},
        ]
    elif transaction_type == "PAYMENT" and category == "RECEIVED":
        lines = [
            {"account_code": payment_code, "party_id": party_id, "debit": value, "credit": 0},
            {"account_code": "1100", "party_id": party_id, "debit": 0, "credit": value},
        ]
    elif transaction_type == "PAYMENT" and category == "PAID":
        lines = [
            {"account_code": "2000", "party_id": party_id, "debit": value, "credit": 0},
            {"account_code": payment_code, "party_id": party_id, "debit": 0, "credit": value},
        ]
    elif transaction_type == "OPENING" and category == "RECEIVABLE":
        lines = [
            {"account_code": "1100", "party_id": party_id, "debit": value, "credit": 0},
            {"account_code": "3000", "party_id": party_id, "debit": 0, "credit": value},
        ]
    elif transaction_type == "OPENING" and category == "PAYABLE":
        lines = [
            {"account_code": "3000", "party_id": party_id, "debit": value, "credit": 0},
            {"account_code": "2000", "party_id": party_id, "debit": 0, "credit": value},
        ]
    else:
        return None

    if amount < 0:
        lines = [
            {**line, "debit": line["credit"], "credit": line["debit"]}
            for line in lines
        ]
    for line in lines:
        line["description"] = description or transaction_type.title()
    return create_journal_entry(
        db,
        outlet_id=transaction.outlet_id,
        target_date=transaction.date,
        entry_type=transaction_type,
        lines=lines,
        user_id=user_id,
        narration=description or transaction_type.title(),
        reference_type="TRANSACTION",
        reference_id=transaction.id,
    )


def reverse_reference_journal(db, *, outlet_id, reference_type, reference_id, user_id, reason):
    entry = db.query(models.JournalEntry).filter(
        models.JournalEntry.outlet_id == outlet_id,
        models.JournalEntry.reference_type == str(reference_type).upper(),
        models.JournalEntry.reference_id == str(reference_id),
        models.JournalEntry.status == "POSTED",
    ).first()
    if not entry:
        return None
    return reverse_journal_entry(db, entry, user_id=user_id, reason=reason)


def reverse_journal_entry(db, entry, *, user_id, reason):
    if (entry.status or "POSTED").upper() != "POSTED":
        raise ValueError("Only a posted journal can be reversed")
    lines = db.query(models.JournalLine).filter(models.JournalLine.entry_id == entry.id).all()
    reversal_lines = [
        {
            "account_id": line.account_id,
            "party_id": line.party_id,
            "description": f"Reversal: {line.description or entry.narration or entry.entry_number}",
            "debit": line.credit,
            "credit": line.debit,
        }
        for line in lines
    ]
    reversal = create_journal_entry(
        db,
        outlet_id=entry.outlet_id,
        target_date=entry.date,
        entry_type="REVERSAL",
        lines=reversal_lines,
        user_id=user_id,
        narration=f"Reversal of {entry.entry_number}: {reason}",
        reference_type="JOURNAL_REVERSAL",
        reference_id=entry.id,
    )
    reversal.reversal_of_id = entry.id
    entry.status = "VOID"
    entry.voided_by_user_id = user_id
    entry.voided_at = datetime.now(UTC).replace(tzinfo=None)
    entry.void_reason = reason
    return reversal


def trial_balance_rows(db, outlet_id, start_date=None, end_date=None):
    query = db.query(
        models.Account.id,
        models.Account.code,
        models.Account.name,
        models.Account.account_type,
        func.coalesce(func.sum(models.JournalLine.debit), 0).label("debit"),
        func.coalesce(func.sum(models.JournalLine.credit), 0).label("credit"),
    ).outerjoin(models.JournalLine, models.JournalLine.account_id == models.Account.id).outerjoin(
        models.JournalEntry, models.JournalEntry.id == models.JournalLine.entry_id
    ).filter(models.Account.outlet_id == outlet_id)
    if start_date:
        query = query.filter((models.JournalEntry.date.is_(None)) | (models.JournalEntry.date >= start_date))
    if end_date:
        query = query.filter((models.JournalEntry.date.is_(None)) | (models.JournalEntry.date <= end_date))
    rows = query.group_by(
        models.Account.id,
        models.Account.code,
        models.Account.name,
        models.Account.account_type,
    ).order_by(models.Account.code.asc()).all()
    return [
        {
            "account_id": str(row.id),
            "code": row.code,
            "name": row.name,
            "account_type": row.account_type,
            "debit": float(row.debit or 0),
            "credit": float(row.credit or 0),
            "balance": float(account_balance_value(row.account_type, row.debit, row.credit)),
        }
        for row in rows
    ]
