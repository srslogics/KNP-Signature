from decimal import Decimal
from uuid import UUID

from app.finance import RECEIVABLE, PAYABLE, decimal_value


SETTLED = "SETTLED"

# Only AMAR's direction was explicitly confirmed. An unresolved classification
# is not evidence of settlement; keep those parties on their existing ledger.
PARTY_ALLOCATION_OVERRIDES = {"amar": RECEIVABLE}
PENDING_PARTY_IDS = frozenset(UUID(value) for value in (
    "cd85e074-e271-4f83-82e9-3569ff198f12",
    "e63a9810-7f98-4fc2-8979-c9a274a5d633",
    "9ae406ee-af83-4dbc-ad9e-9a78889ff339",
    "b0f66ec8-e533-44c3-ad79-4538b1002ae6",
    "e0731d52-8e7c-49f3-b40a-55fd0f516b38",
    "0afddca2-fb1a-4a83-b104-a5b176e2e4d1",
    "80703bff-02ac-4e79-9346-e5f86e401cc9",
    "e5a2b15d-1048-4495-96d5-02186614aec5",
    "768f3653-1e50-4cc8-8be4-4d61a04c09f3",
    "6d142b61-aaa5-4183-bd75-8cab346c2694",
    "0877b172-846f-422d-889d-d564295504b0",
    "cedb98f6-2ec3-4fa0-bb38-10f4eabed3b8",
    "009d6563-df93-4c00-8a28-0257f512718d",
    "13919713-46f3-4f3a-b81b-af900954da6f",
    "ec26c0ca-773b-4072-b001-b44c5ff92111",
))


def normalized_party_name(value):
    return " ".join(str(value or "").strip().lower().split())


def allocate_cutover_balance(party_name, party_type, legacy_balance, account_balances):
    """Choose one opening account without changing the restored old balance."""
    legacy_balance = decimal_value(legacy_balance)
    override = PARTY_ALLOCATION_OVERRIDES.get(normalized_party_name(party_name))
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
