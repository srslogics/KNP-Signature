import uuid
from sqlalchemy import Column, String, Date, Numeric, ForeignKey, TIMESTAMP, UniqueConstraint, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.db import Base


class Party(Base):
    __tablename__ = "parties"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    normalized_name = Column(String)
    type = Column(String)  # VENDOR / DEALER / BOTH
    phone = Column(String)
    address = Column(String)
    created_at = Column(TIMESTAMP, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="STAFF")  # OWNER / STAFF
    display_name = Column(String)
    is_active = Column(String, nullable=False, default="true")
    created_at = Column(TIMESTAMP, server_default=func.now())


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token = Column(String, nullable=False, unique=True)
    expires_at = Column(TIMESTAMP, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())


class PartyAlias(Base):
    __tablename__ = "party_aliases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alias = Column(String)
    normalized_alias = Column(String)
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"))


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"))
    type = Column(String)
    category = Column(String)
    item_type = Column(String)
    quantity = Column(Numeric)
    weight = Column(Numeric)
    rate = Column(Numeric)
    amount = Column(Numeric)
    payment_mode = Column(String)
    bill_number = Column(String)
    source_ref = Column(String, nullable=False, default="", server_default="")
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "party_id", "weight", "rate", "type", "category", "item_type", "bill_number", "source_ref", name="unique_txn"),
    )


class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_hash = Column(String, unique=True)
    file_type = Column(String)  # vendor / dealer / payment
    created_at = Column(TIMESTAMP, server_default=func.now())


class ItemOpeningStock(Base):
    __tablename__ = "item_opening_stock"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    item_type = Column(String, nullable=False)
    opening_quantity = Column(Numeric)
    opening_weight = Column(Numeric)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "item_type", name="unique_item_opening_stock"),
    )


class DailyStock(Base):
    __tablename__ = "daily_stock"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, unique=True)
    opening_weight = Column(Numeric)
    purchase_weight = Column(Numeric)
    sales_weight = Column(Numeric)
    expected_closing_weight = Column(Numeric)
    actual_closing_weight = Column(Numeric)
    leakage = Column(Numeric)


class DailyItemStock(Base):
    __tablename__ = "daily_item_stock"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    item_type = Column(String, nullable=False)
    opening_quantity = Column(Numeric)
    opening_weight = Column(Numeric)
    purchase_quantity = Column(Numeric)
    purchase_weight = Column(Numeric)
    sales_quantity = Column(Numeric)
    sales_weight = Column(Numeric)
    expected_closing_quantity = Column(Numeric)
    expected_closing_weight = Column(Numeric)
    actual_closing_quantity = Column(Numeric)
    actual_closing_weight = Column(Numeric)
    quantity_leakage = Column(Numeric)
    leakage = Column(Numeric)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "item_type", name="unique_daily_item_stock"),
    )


class RetailBill(Base):
    __tablename__ = "retail_bills"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bill_number = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"))
    customer_name = Column(String)
    customer_phone = Column(String)
    customer_address = Column(String)
    cashier_name = Column(String)
    payment_mode = Column(String)
    total_quantity = Column(Numeric)
    total_weight = Column(Numeric)
    ice_amount = Column(Numeric)
    total_amount = Column(Numeric)
    paid_amount = Column(Numeric)
    outstanding_amount = Column(Numeric)
    notes = Column(String)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "bill_number", name="unique_retail_bill_number_per_day"),
    )


class RetailBillItem(Base):
    __tablename__ = "retail_bill_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bill_id = Column(UUID(as_uuid=True), ForeignKey("retail_bills.id"), nullable=False)
    line_order = Column(Integer, nullable=False, default=1)
    item_name = Column(String, nullable=False)
    line_type = Column(String, nullable=False, default="STANDARD")
    quantity = Column(Numeric)
    unit = Column(String)
    weight = Column(Numeric)
    rate = Column(Numeric)
    amount = Column(Numeric)
    created_at = Column(TIMESTAMP, server_default=func.now())


class DressedStockEntry(Base):
    __tablename__ = "dressed_stock_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    item_name = Column(String, nullable=False)
    live_quantity = Column(Numeric)
    live_weight = Column(Numeric)
    dressed_weight = Column(Numeric)
    remaining_dressed_weight = Column(Numeric)
    default_rate = Column(Numeric)
    notes = Column(String)
    created_at = Column(TIMESTAMP, server_default=func.now())


class PaymentReceipt(Base):
    __tablename__ = "payment_receipts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_number = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"))
    party_name = Column(String)
    party_phone = Column(String)
    party_address = Column(String)
    cashier_name = Column(String)
    direction = Column(String, nullable=False)
    payment_mode = Column(String)
    amount = Column(Numeric)
    notes = Column(String)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "receipt_number", name="unique_payment_receipt_number_per_day"),
    )
