from datetime import date
from decimal import Decimal, InvalidOperation


RECEIVABLE = "RECEIVABLE"
PAYABLE = "PAYABLE"
LEGACY_LEDGER = "legacy"
ACCOUNT_LEDGER = "account"
LEDGER_CUTOVER_DATE = date(2026, 9, 4)


def ledger_mode_for_date(value=None):
    """Use the restored ledger through 03/09 and account ledger from 04/09."""
    value = value or date.today()
    return ACCOUNT_LEDGER if value >= LEDGER_CUTOVER_DATE else LEGACY_LEDGER


def field_value(record, key, default=None):
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def decimal_value(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def posting_account(entry_type, category):
    entry_type = str(entry_type or "").strip().upper()
    category = str(category or "").strip().upper()

    if entry_type == "SALE":
        return RECEIVABLE
    if entry_type == "PURCHASE":
        return PAYABLE
    if entry_type == "PAYMENT":
        if category == "RECEIVED":
            return RECEIVABLE
        if category == "PAID":
            return PAYABLE
    if entry_type == "OPENING" and category in {RECEIVABLE, PAYABLE}:
        return category
    return None


def account_movement(entry_type, category, amount) -> Decimal:
    account = posting_account(entry_type, category)
    value = decimal_value(amount)
    entry_type = str(entry_type or "").strip().upper()

    if not account:
        return Decimal("0")
    if entry_type == "PAYMENT":
        return -value
    return value


def posting_values(entry_type, category, amount):
    account = posting_account(entry_type, category)
    movement = account_movement(entry_type, category, amount)
    if not account:
        return None

    if account == RECEIVABLE:
        debit = movement if movement > 0 else Decimal("0")
        credit = -movement if movement < 0 else Decimal("0")
    else:
        debit = -movement if movement < 0 else Decimal("0")
        credit = movement if movement > 0 else Decimal("0")

    return {
        "account": account,
        "movement": movement,
        "debit": debit,
        "credit": credit,
    }


def retail_bill_id_from_source_ref(source_ref):
    value = str(source_ref or "")
    if not value.startswith(("retail-bill:", "retail-payment:")):
        return None
    parts = value.split(":", 2)
    return parts[1] if len(parts) >= 2 and parts[1] else None


def transaction_event(transaction):
    entry_type = str(field_value(transaction, "type", "") or "").strip().upper()
    category = str(field_value(transaction, "category", "") or "").strip().upper()
    display_type = entry_type
    if entry_type in {"PAYMENT", "OPENING"} and category:
        display_type = f"{entry_type} {category}"

    return {
        "date": field_value(transaction, "date"),
        "type": display_type,
        "entry_type": entry_type,
        "category": category,
        "item": field_value(transaction, "item_type", "") or "",
        "payment_mode": field_value(transaction, "payment_mode", "NA") or "NA",
        "bill_number": field_value(transaction, "bill_number", "") or "",
        "amount": decimal_value(field_value(transaction, "amount")),
        "weight": decimal_value(field_value(transaction, "weight")),
        "quantity": decimal_value(field_value(transaction, "quantity")),
        "rate": decimal_value(field_value(transaction, "rate")),
        "source_ref": field_value(transaction, "source_ref", "") or "",
    }


def summarize_legacy_transactions(transactions, settled_keys=None):
    """Pre-upgrade party balance events; never rewrite financial source rows.

    Preserve stored sale amounts and payments, including unclassified payments.
    Fully settled retail sales have zero balance movement, as in the old ledger.
    Settlement keys include outlet to avoid matching another shop's bill number.
    """
    settled_keys = settled_keys or set()
    events = []
    index = 0
    while index < len(transactions):
        first = transactions[index]
        event = transaction_event(first)
        source_ref = event["source_ref"]
        grouped = source_ref.startswith("retail-bill:")
        if grouped:
            prefix = ":".join(source_ref.split(":")[:2])
            rows = []
            while index < len(transactions):
                candidate = transactions[index]
                if not str(field_value(candidate, "source_ref", "") or "").startswith(prefix):
                    break
                rows.append(candidate)
                index += 1
            for target, field in (("amount", "amount"), ("weight", "weight"), ("quantity", "quantity")):
                event[target] = sum((decimal_value(field_value(row, field)) for row in rows), Decimal("0"))
            rate_base = event["weight"] if event["weight"] > 0 else event["quantity"]
            event.update(type="SALE", entry_type="SALE", category="RETAIL BILL", item="Retail Bill",
                         rate=event["amount"] / rate_base if rate_base > 0 else Decimal("0"))
        else:
            index += 1

        entry_type = event["entry_type"]
        delta = event["amount"] if entry_type in {"SALE", "PURCHASE", "OPENING"} else Decimal("0")
        if entry_type == "PAYMENT":
            delta = -event["amount"]
        bill_key = (field_value(first, "outlet_id"), event["date"], field_value(first, "party_id"),
                    str(event["bill_number"]).strip())
        if bill_key in settled_keys and (grouped or (entry_type == "SALE" and event["category"] in {"RETAIL", "RETAIL DRESSED"})):
            delta = Decimal("0")
        events.append({**event, "delta": delta})
    return events


def build_legacy_ledger(events, opening_balance=0):
    balance = decimal_value(opening_balance)
    rows = []
    for event in events:
        balance += event["delta"]
        rows.append({**event, "balance": balance})
    return balance, rows


def summarize_transactions(transactions, retail_bills=None):
    """Return financial events without rewriting the source transactions.

    Retail line transactions are collapsed into one sale. The matching bill is
    the authority for total and paid amounts, while an orphaned payment remains
    visible instead of being silently discarded.
    """
    bills = {str(key): value for key, value in (retail_bills or {}).items()}
    groups = {}
    events = []

    for order, transaction in enumerate(transactions):
        source_ref = field_value(transaction, "source_ref", "") or ""
        bill_id = retail_bill_id_from_source_ref(source_ref)
        if str(source_ref).startswith("retail-bill:") and bill_id:
            group = groups.setdefault(bill_id, {"order": order, "transactions": []})
            group["transactions"].append(transaction)

    for order, transaction in enumerate(transactions):
        source_ref = field_value(transaction, "source_ref", "") or ""
        bill_id = retail_bill_id_from_source_ref(source_ref)
        if str(source_ref).startswith("retail-bill:") and bill_id:
            continue
        if str(source_ref).startswith("retail-payment:") and bill_id in bills:
            continue
        events.append((order, 0, transaction_event(transaction)))

    for bill_id, group in groups.items():
        rows = group["transactions"]
        first = rows[0]
        bill = bills.get(bill_id)
        line_total = sum(decimal_value(field_value(row, "amount")) for row in rows)
        total_weight = sum(decimal_value(field_value(row, "weight")) for row in rows)
        total_quantity = sum(decimal_value(field_value(row, "quantity")) for row in rows)
        bill_total = field_value(bill, "total_amount") if bill else None
        total_amount = decimal_value(bill_total) if bill_total not in (None, "") else line_total
        rate_base = total_weight if total_weight > 0 else total_quantity

        events.append((group["order"], 0, {
            "date": field_value(first, "date"),
            "type": "SALE",
            "entry_type": "SALE",
            "category": "RETAIL BILL",
            "item": "Retail Bill",
            "payment_mode": field_value(first, "payment_mode", "NA") or "NA",
            "bill_number": field_value(first, "bill_number", "") or "",
            "amount": total_amount,
            "weight": total_weight,
            "quantity": total_quantity,
            "rate": total_amount / rate_base if rate_base > 0 else Decimal("0"),
            "source_ref": f"retail-bill:{bill_id}",
        }))

        paid_amount = decimal_value(field_value(bill, "paid_amount")) if bill else Decimal("0")
        if paid_amount > 0:
            events.append((group["order"], 1, {
                "date": field_value(first, "date"),
                "type": "PAYMENT RECEIVED",
                "entry_type": "PAYMENT",
                "category": "RECEIVED",
                "item": "Retail Bill Payment",
                "payment_mode": field_value(first, "payment_mode", "NA") or "NA",
                "bill_number": field_value(first, "bill_number", "") or "",
                "amount": paid_amount,
                "weight": Decimal("0"),
                "quantity": Decimal("0"),
                "rate": Decimal("0"),
                "source_ref": f"retail-payment:{bill_id}",
            }))

    return [event for _, _, event in sorted(events, key=lambda row: (row[0], row[1]))]


def empty_balances():
    return {
        "receivable": Decimal("0"),
        "payable": Decimal("0"),
        "net": Decimal("0"),
    }


def normalize_balances(value=None):
    value = value or {}
    receivable = decimal_value(value.get("receivable"))
    payable = decimal_value(value.get("payable"))
    return {
        "receivable": receivable,
        "payable": payable,
        "net": receivable - payable,
    }


def build_account_ledger(rows, opening_balances=None):
    balances = normalize_balances(opening_balances)
    ledger = []

    for source in rows:
        posting = posting_values(
            source.get("entry_type") or source.get("type"),
            source.get("category"),
            source.get("amount"),
        )
        if not posting:
            continue

        balance_key = posting["account"].lower()
        balances[balance_key] += posting["movement"]
        balances["net"] = balances["receivable"] - balances["payable"]

        ledger.append({
            **source,
            "account": posting["account"],
            "debit": posting["debit"],
            "credit": posting["credit"],
            "delta": posting["movement"],
            "account_balance": balances[balance_key],
            "net_balance": balances["net"],
        })

    return balances, ledger
