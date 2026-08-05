from decimal import Decimal, InvalidOperation


def decimal_value(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def ledger_delta_value(transaction_type, category, amount) -> Decimal:
    transaction_type = str(transaction_type or "").upper()
    amount_value = decimal_value(amount)
    if transaction_type in {"SALE", "PURCHASE", "OPENING"}:
        return amount_value
    if transaction_type == "PAYMENT":
        return -amount_value
    return Decimal("0")


def receivable_delta_value(transaction_type, category, amount) -> Decimal:
    transaction_type = str(transaction_type or "").upper()
    category = str(category or "").upper()
    amount_value = decimal_value(amount)
    if transaction_type == "SALE" or (transaction_type == "OPENING" and category == "RECEIVABLE"):
        return amount_value
    if transaction_type == "PAYMENT" and category == "RECEIVED":
        return -amount_value
    return Decimal("0")


def payable_delta_value(transaction_type, category, amount) -> Decimal:
    transaction_type = str(transaction_type or "").upper()
    category = str(category or "").upper()
    amount_value = decimal_value(amount)
    if transaction_type == "PURCHASE" or (transaction_type == "OPENING" and category == "PAYABLE"):
        return amount_value
    if transaction_type == "PAYMENT" and category == "PAID":
        return -amount_value
    return Decimal("0")


def reversal_numeric_values(quantity, weight, amount):
    return {
        "quantity": -decimal_value(quantity),
        "weight": -decimal_value(weight),
        "amount": -decimal_value(amount),
    }


def normalize_journal_lines(lines):
    normalized = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for index, line in enumerate(lines or [], start=1):
        debit = decimal_value(line.get("debit"))
        credit = decimal_value(line.get("credit"))
        if debit < 0 or credit < 0:
            raise ValueError(f"Journal line {index} cannot contain a negative value")
        if (debit > 0 and credit > 0) or (debit == 0 and credit == 0):
            raise ValueError(f"Journal line {index} must contain either debit or credit")
        normalized.append({**line, "debit": debit, "credit": credit})
        total_debit += debit
        total_credit += credit
    if len(normalized) < 2:
        raise ValueError("A journal entry requires at least two lines")
    if total_debit != total_credit:
        raise ValueError(f"Journal is not balanced: debit {total_debit} and credit {total_credit}")
    return normalized


def account_balance_value(account_type, debit, credit):
    account_type = str(account_type or "").upper()
    debit_value = decimal_value(debit)
    credit_value = decimal_value(credit)
    if account_type in {"ASSET", "EXPENSE"}:
        return debit_value - credit_value
    return credit_value - debit_value
