from decimal import Decimal

from app.finance import RECEIVABLE, PAYABLE, decimal_value


SETTLED = "SETTLED"

# Client-confirmed allocation for parties whose old mixed balance could not be
# separated mechanically. Everyone marked SETTLED starts the new ledger at zero.
PARTY_ALLOCATION_OVERRIDES = {
    "amar": RECEIVABLE,
    "ashok singh": SETTLED,
    "friends poultry": SETTLED,
    "kohale sir": SETTLED,
    "legend bar": SETTLED,
    "motilal sahu": SETTLED,
    "nadeem cb": SETTLED,
    "patil": SETTLED,
    "popular chicken shop": SETTLED,
    "popular trading": SETTLED,
    "prakash ashtekar": SETTLED,
    "ramesh singh": SETTLED,
    "sahil chicken shop": SETTLED,
    "sayeed new": SETTLED,
    "str poultry": SETTLED,
    "vk chicken": SETTLED,
}


def normalized_party_name(value):
    return " ".join(str(value or "").strip().lower().split())


def allocate_cutover_balance(party_name, party_type, legacy_balance, account_balances):
    """Choose one opening account without changing the restored old balance."""
    legacy_balance = decimal_value(legacy_balance)
    override = PARTY_ALLOCATION_OVERRIDES.get(normalized_party_name(party_name))
    if override == SETTLED:
        return {"account": SETTLED, "amount": Decimal("0"), "reason": "client-cleared"}
    if override in {RECEIVABLE, PAYABLE}:
        return {"account": override, "amount": legacy_balance, "reason": "client-confirmed"}

    receivable = decimal_value((account_balances or {}).get("receivable"))
    payable = decimal_value((account_balances or {}).get("payable"))
    has_receivable = receivable != 0
    has_payable = payable != 0
    if has_receivable and not has_payable:
        return {"account": RECEIVABLE, "amount": legacy_balance, "reason": "single-account-history"}
    if has_payable and not has_receivable:
        return {"account": PAYABLE, "amount": legacy_balance, "reason": "single-account-history"}
    if not has_receivable and not has_payable and legacy_balance == 0:
        return {"account": SETTLED, "amount": Decimal("0"), "reason": "zero-balance"}

    party_type = str(party_type or "").strip().upper()
    if not has_receivable and not has_payable and party_type == "VENDOR":
        return {"account": RECEIVABLE, "amount": legacy_balance, "reason": "party-type"}
    if not has_receivable and not has_payable and party_type == "DEALER":
        return {"account": PAYABLE, "amount": legacy_balance, "reason": "party-type"}

    raise ValueError(f"Cutover account is unresolved for {party_name}")
