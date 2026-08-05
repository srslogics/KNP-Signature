import uuid
from sqlalchemy import Boolean, Column, Date, ForeignKey, Integer, JSON, Numeric, String, TIMESTAMP, UniqueConstraint
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


class Outlet(Base):
    __tablename__ = "outlets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False, unique=True)
    code = Column(String, unique=True)
    is_active = Column(String, nullable=False, default="true")
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


class UserOutletAccess(Base):
    __tablename__ = "user_outlet_access"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "outlet_id", name="unique_user_outlet_access"),
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token = Column(String, nullable=False, unique=True)
    expires_at = Column(TIMESTAMP, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())


class DocumentNumberCounter(Base):
    __tablename__ = "document_number_counters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"), nullable=False)
    target_date = Column(Date, nullable=False)
    next_number = Column(Integer, nullable=False, default=1)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("outlet_id", "target_date", name="unique_document_counter_per_day"),
    )


class PartyAlias(Base):
    __tablename__ = "party_aliases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alias = Column(String)
    normalized_alias = Column(String)
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"))


class RetailShortcut(Base):
    __tablename__ = "retail_shortcuts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"), nullable=False)
    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False)
    line_type = Column(String, nullable=False, default="STANDARD")
    source_item_type = Column(String)
    unit = Column(String, nullable=False, default="KGS")
    rate = Column(Numeric)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("outlet_id", "normalized_name", "line_type", name="unique_retail_shortcut_per_outlet"),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
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
    reversal_of_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"))
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "party_id", "weight", "rate", "type", "category", "item_type", "bill_number", "source_ref", name="unique_txn"),
    )


class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_hash = Column(String, unique=True)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
    file_type = Column(String)  # vendor / dealer / payment
    created_at = Column(TIMESTAMP, server_default=func.now())


class ItemOpeningStock(Base):
    __tablename__ = "item_opening_stock"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
    item_type = Column(String, nullable=False)
    opening_quantity = Column(Numeric)
    opening_weight = Column(Numeric)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "outlet_id", "item_type", name="unique_item_opening_stock"),
    )


class DailyStock(Base):
    __tablename__ = "daily_stock"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
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
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
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
        UniqueConstraint("date", "outlet_id", "item_type", name="unique_daily_item_stock"),
    )


class RetailBill(Base):
    __tablename__ = "retail_bills"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bill_number = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
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
    status = Column(String, nullable=False, default="POSTED", server_default="POSTED")
    voided_at = Column(TIMESTAMP)
    voided_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    void_reason = Column(String)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "outlet_id", "bill_number", name="unique_retail_bill_number_per_day"),
    )


class RetailBillItem(Base):
    __tablename__ = "retail_bill_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bill_id = Column(UUID(as_uuid=True), ForeignKey("retail_bills.id"), nullable=False)
    line_order = Column(Integer, nullable=False, default=1)
    item_name = Column(String, nullable=False)
    line_type = Column(String, nullable=False, default="STANDARD")
    source_item_type = Column(String)
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
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
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
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"))
    party_name = Column(String)
    party_phone = Column(String)
    party_address = Column(String)
    cashier_name = Column(String)
    direction = Column(String, nullable=False)
    payment_mode = Column(String)
    amount = Column(Numeric)
    notes = Column(String)
    status = Column(String, nullable=False, default="POSTED", server_default="POSTED")
    voided_at = Column(TIMESTAMP)
    voided_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    void_reason = Column(String)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", "outlet_id", "receipt_number", name="unique_payment_receipt_number_per_day"),
    )


class AccountingPeriodLock(Base):
    __tablename__ = "accounting_period_locks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"), nullable=False)
    lock_date = Column(Date, nullable=False)
    is_locked = Column(Boolean, nullable=False, default=True, server_default="true")
    reason = Column(String)
    locked_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    locked_at = Column(TIMESTAMP, nullable=False, server_default=func.now())
    unlocked_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    unlocked_at = Column(TIMESTAMP)

    __table_args__ = (
        UniqueConstraint("outlet_id", "lock_date", name="unique_accounting_period_lock"),
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    occurred_at = Column(TIMESTAMP, nullable=False, server_default=func.now())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"))
    event_date = Column(Date)
    entity_type = Column(String, nullable=False)
    entity_id = Column(String)
    action = Column(String, nullable=False)
    reason = Column(String)
    before_data = Column(JSON)
    after_data = Column(JSON)
    context_data = Column(JSON)


class Account(Base):
    __tablename__ = "accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"), nullable=False)
    code = Column(String, nullable=False)
    name = Column(String, nullable=False)
    account_type = Column(String, nullable=False)
    subtype = Column(String)
    is_system = Column(Boolean, nullable=False, default=False, server_default="false")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(TIMESTAMP, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("outlet_id", "code", name="unique_account_code_per_outlet"),
    )


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"), nullable=False)
    date = Column(Date, nullable=False)
    entry_number = Column(String, nullable=False)
    entry_type = Column(String, nullable=False, default="GENERAL", server_default="GENERAL")
    reference_type = Column(String)
    reference_id = Column(String)
    narration = Column(String)
    status = Column(String, nullable=False, default="POSTED", server_default="POSTED")
    reversal_of_id = Column(UUID(as_uuid=True), ForeignKey("journal_entries.id"))
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    voided_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    voided_at = Column(TIMESTAMP)
    void_reason = Column(String)
    created_at = Column(TIMESTAMP, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("outlet_id", "entry_number", name="unique_journal_number_per_outlet"),
    )


class JournalLine(Base):
    __tablename__ = "journal_lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("journal_entries.id"), nullable=False)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"))
    description = Column(String)
    debit = Column(Numeric, nullable=False, default=0, server_default="0")
    credit = Column(Numeric, nullable=False, default=0, server_default="0")
    created_at = Column(TIMESTAMP, nullable=False, server_default=func.now())


class PartyCreditProfile(Base):
    __tablename__ = "party_credit_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outlet_id = Column(UUID(as_uuid=True), ForeignKey("outlets.id"), nullable=False)
    party_id = Column(UUID(as_uuid=True), ForeignKey("parties.id"), nullable=False)
    credit_limit = Column(Numeric, nullable=False, default=0, server_default="0")
    credit_days = Column(Integer, nullable=False, default=0, server_default="0")
    block_on_limit = Column(Boolean, nullable=False, default=False, server_default="false")
    updated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_at = Column(TIMESTAMP, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("outlet_id", "party_id", name="unique_party_credit_profile"),
    )
