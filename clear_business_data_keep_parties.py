from app.db import SessionLocal
from app.models import (
    DailyItemStock,
    DailyStock,
    DressedStockEntry,
    ItemOpeningStock,
    PaymentReceipt,
    RetailBill,
    RetailBillItem,
    Transaction,
    UploadedFile,
)


TABLES_TO_CLEAR = [
    RetailBillItem,
    RetailBill,
    PaymentReceipt,
    DressedStockEntry,
    DailyItemStock,
    DailyStock,
    ItemOpeningStock,
    UploadedFile,
    Transaction,
]


def main():
    print("This will delete business data and keep party names/directory intact.")
    print("Kept:")
    print("- parties")
    print("- party_aliases")
    print("- users")
    print("- outlets")
    print("- user access / sessions")
    print("")
    print("Deleted:")
    print("- retail bills and bill items")
    print("- payment receipts")
    print("- transactions / ledger rows")
    print("- dressed stock entries")
    print("- daily sheet stock rows")
    print("- opening stock rows")
    print("- uploaded file history")
    print("")

    confirmation = input("Type CLEAR to continue: ").strip()
    if confirmation != "CLEAR":
        print("Cancelled.")
        return

    db = SessionLocal()
    try:
        for model in TABLES_TO_CLEAR:
            db.query(model).delete(synchronize_session=False)
        db.commit()
        print("Business data cleared successfully. Party names were kept.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
