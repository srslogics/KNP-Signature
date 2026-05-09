from uuid import UUID, uuid4
from io import BytesIO
from urllib.parse import quote
from datetime import datetime, timedelta
import hashlib
import hmac
import os
import secrets

from fastapi import FastAPI, HTTPException, Header
from app.db import engine, Base
from fastapi import UploadFile, File, Depends, Body
import pandas as pd
from sqlalchemy.orm import Session
from app.db import SessionLocal
from app import models
from sqlalchemy import case, func, text, or_
from decimal import Decimal
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse

app = FastAPI()

# Create tables
Base.metadata.create_all(bind=engine)


def ensure_database_schema():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE parties ADD COLUMN IF NOT EXISTS phone VARCHAR"))
        conn.execute(text("ALTER TABLE parties ADD COLUMN IF NOT EXISTS address VARCHAR"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS item_type VARCHAR"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_ref VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS quantity NUMERIC"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bill_number VARCHAR"))
        conn.execute(text("UPDATE transactions SET source_ref = '' WHERE source_ref IS NULL"))
        conn.execute(text("ALTER TABLE retail_bill_items ADD COLUMN IF NOT EXISTS line_type VARCHAR NOT NULL DEFAULT 'STANDARD'"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY,
                username VARCHAR NOT NULL UNIQUE,
                password_hash VARCHAR NOT NULL,
                role VARCHAR NOT NULL DEFAULT 'STAFF',
                display_name VARCHAR,
                is_active VARCHAR NOT NULL DEFAULT 'true',
                created_at TIMESTAMP DEFAULT now()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES users(id),
                token VARCHAR NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT now()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions (token)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id)"))
        conn.execute(text("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS unique_txn"))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'unique_txn'
                ) THEN
                    ALTER TABLE transactions
                    ADD CONSTRAINT unique_txn UNIQUE (date, party_id, weight, rate, type, category, item_type, bill_number, source_ref);
                END IF;
            END
            $$;
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_transactions_date_type ON transactions (date, type)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_transactions_party_date ON transactions (party_id, date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_transactions_item_date ON transactions (item_type, date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_party_alias_normalized ON party_aliases (normalized_alias)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_daily_stock_date ON daily_stock (date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_retail_bills_date ON retail_bills (date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_retail_bill_items_bill_id ON retail_bill_items (bill_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_payment_receipts_date ON payment_receipts (date)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS item_opening_stock (
                id UUID PRIMARY KEY,
                date DATE NOT NULL,
                item_type VARCHAR NOT NULL,
                opening_quantity NUMERIC,
                opening_weight NUMERIC,
                created_at TIMESTAMP DEFAULT now(),
                CONSTRAINT unique_item_opening_stock UNIQUE (date, item_type)
            )
        """))
        conn.execute(text("ALTER TABLE item_opening_stock ADD COLUMN IF NOT EXISTS opening_quantity NUMERIC"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS daily_item_stock (
                id UUID PRIMARY KEY,
                date DATE NOT NULL,
                item_type VARCHAR NOT NULL,
                opening_quantity NUMERIC,
                opening_weight NUMERIC,
                purchase_quantity NUMERIC,
                purchase_weight NUMERIC,
                sales_quantity NUMERIC,
                sales_weight NUMERIC,
                expected_closing_quantity NUMERIC,
                expected_closing_weight NUMERIC,
                actual_closing_quantity NUMERIC,
                actual_closing_weight NUMERIC,
                quantity_leakage NUMERIC,
                leakage NUMERIC,
                created_at TIMESTAMP DEFAULT now(),
                CONSTRAINT unique_daily_item_stock UNIQUE (date, item_type)
            )
        """))
        conn.execute(text("ALTER TABLE daily_item_stock ADD COLUMN IF NOT EXISTS opening_quantity NUMERIC"))
        conn.execute(text("ALTER TABLE daily_item_stock ADD COLUMN IF NOT EXISTS purchase_quantity NUMERIC"))
        conn.execute(text("ALTER TABLE daily_item_stock ADD COLUMN IF NOT EXISTS sales_quantity NUMERIC"))
        conn.execute(text("ALTER TABLE daily_item_stock ADD COLUMN IF NOT EXISTS expected_closing_quantity NUMERIC"))
        conn.execute(text("ALTER TABLE daily_item_stock ADD COLUMN IF NOT EXISTS actual_closing_quantity NUMERIC"))
        conn.execute(text("ALTER TABLE daily_item_stock ADD COLUMN IF NOT EXISTS quantity_leakage NUMERIC"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS retail_bills (
                id UUID PRIMARY KEY,
                bill_number VARCHAR NOT NULL,
                date DATE NOT NULL,
                party_id UUID REFERENCES parties(id),
                customer_name VARCHAR,
                customer_phone VARCHAR,
                customer_address VARCHAR,
                cashier_name VARCHAR,
                payment_mode VARCHAR,
                total_quantity NUMERIC,
                total_weight NUMERIC,
                ice_amount NUMERIC,
                total_amount NUMERIC,
                paid_amount NUMERIC,
                outstanding_amount NUMERIC,
                notes VARCHAR,
                created_at TIMESTAMP DEFAULT now(),
                CONSTRAINT unique_retail_bill_number_per_day UNIQUE (date, bill_number)
            )
        """))
        conn.execute(text("ALTER TABLE retail_bills ADD COLUMN IF NOT EXISTS ice_amount NUMERIC"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS retail_bill_items (
                id UUID PRIMARY KEY,
                bill_id UUID NOT NULL REFERENCES retail_bills(id),
                line_order INTEGER NOT NULL DEFAULT 1,
                item_name VARCHAR NOT NULL,
                line_type VARCHAR NOT NULL DEFAULT 'STANDARD',
                quantity NUMERIC,
                unit VARCHAR,
                weight NUMERIC,
                rate NUMERIC,
                amount NUMERIC,
                created_at TIMESTAMP DEFAULT now()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dressed_stock_entries (
                id UUID PRIMARY KEY,
                date DATE NOT NULL,
                item_name VARCHAR NOT NULL,
                live_quantity NUMERIC,
                live_weight NUMERIC,
                dressed_weight NUMERIC,
                remaining_dressed_weight NUMERIC,
                default_rate NUMERIC,
                notes VARCHAR,
                created_at TIMESTAMP DEFAULT now()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS payment_receipts (
                id UUID PRIMARY KEY,
                receipt_number VARCHAR NOT NULL,
                date DATE NOT NULL,
                party_id UUID REFERENCES parties(id),
                party_name VARCHAR,
                party_phone VARCHAR,
                party_address VARCHAR,
                cashier_name VARCHAR,
                direction VARCHAR NOT NULL,
                payment_mode VARCHAR,
                amount NUMERIC,
                notes VARCHAR,
                created_at TIMESTAMP DEFAULT now(),
                CONSTRAINT unique_payment_receipt_number_per_day UNIQUE (date, receipt_number)
            )
        """))


ensure_database_schema()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


SESSION_DAYS = 14
ROLE_OWNER = "OWNER"
ROLE_STAFF = "STAFF"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"{salt}${derived.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, stored = str(password_hash or "").split("$", 1)
    except ValueError:
        return False
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000).hex()
    return hmac.compare_digest(derived, stored)


def serialize_user(user: models.User):
    return {
        "id": str(user.id),
        "username": user.username,
        "role": (user.role or ROLE_STAFF).upper(),
        "display_name": user.display_name or user.username
    }


def create_user_session(db: Session, user: models.User):
    token = secrets.token_urlsafe(32)
    session = models.UserSession(
        id=uuid4(),
        user_id=user.id,
        token=token,
        expires_at=datetime.utcnow() + timedelta(days=SESSION_DAYS)
    )
    db.add(session)
    db.flush()
    return session


def get_active_session(db: Session, token: str | None):
    if not token:
        return None
    session = db.query(models.UserSession).filter(
        models.UserSession.token == token
    ).first()
    if not session:
        return None
    if session.expires_at and session.expires_at < datetime.utcnow():
        db.delete(session)
        db.commit()
        return None
    return session


def get_current_user(
    db: Session = Depends(get_db),
    x_auth_token: str | None = Header(default=None)
):
    session = get_active_session(db, x_auth_token)
    if not session:
        raise HTTPException(status_code=401, detail="Authentication required")
    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not user or str(user.is_active or "true").lower() != "true":
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def require_owner(user: models.User = Depends(get_current_user)):
    if (user.role or ROLE_STAFF).upper() != ROLE_OWNER:
        raise HTTPException(status_code=403, detail="Owner access required")
    return user

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # for now
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


PUBLIC_PATH_PREFIXES = (
    "/auth/",
    "/healthz",
)
PUBLIC_PATHS = {"/"}


@app.middleware("http")
async def auth_middleware(request, call_next):
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)
    if path in PUBLIC_PATHS or any(path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES):
        return await call_next(request)

    token = request.headers.get("X-Auth-Token")
    db = SessionLocal()
    try:
        session = get_active_session(db, token)
        if not session:
            return JSONResponse(status_code=401, content={"error": "Authentication required"})
        user = db.query(models.User).filter(models.User.id == session.user_id).first()
        if not user or str(user.is_active or "true").lower() != "true":
            return JSONResponse(status_code=401, content={"error": "Authentication required"})
    finally:
        db.close()

    return await call_next(request)

@app.get("/")
def root():
    return {"message": "Backend running"}


@app.get("/healthz")
def health_check():
    return {"status": "ok"}


@app.head("/healthz")
def health_check_head():
    return Response(status_code=200)


@app.get("/auth/setup-status")
def auth_setup_status(db: Session = Depends(get_db)):
    count = db.query(models.User).count()
    return {"has_users": count > 0}


@app.post("/auth/setup-owner")
def auth_setup_owner(payload: dict = Body(...), db: Session = Depends(get_db)):
    if db.query(models.User).count() > 0:
        return {"error": "Owner setup already completed"}

    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    display_name = str(payload.get("display_name") or username).strip()
    if len(username) < 3:
        return {"error": "Username must be at least 3 characters"}
    if len(password) < 4:
        return {"error": "Password must be at least 4 characters"}

    user = models.User(
        id=uuid4(),
        username=username,
        password_hash=hash_password(password),
        role=ROLE_OWNER,
        display_name=display_name,
        is_active="true"
    )
    db.add(user)
    db.flush()
    session = create_user_session(db, user)
    db.commit()
    return {"user": serialize_user(user), "token": session.token}


@app.post("/auth/login")
def auth_login(payload: dict = Body(...), db: Session = Depends(get_db)):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    user = db.query(models.User).filter(func.lower(models.User.username) == username.lower()).first()
    if not user or not verify_password(password, user.password_hash):
        return {"error": "Invalid username or password"}
    if str(user.is_active or "true").lower() != "true":
        return {"error": "User is inactive"}

    session = create_user_session(db, user)
    db.commit()
    return {"user": serialize_user(user), "token": session.token}


@app.get("/auth/me")
def auth_me(user: models.User = Depends(get_current_user)):
    return {"user": serialize_user(user)}


@app.post("/auth/logout")
def auth_logout(
    db: Session = Depends(get_db),
    x_auth_token: str | None = Header(default=None),
    user: models.User = Depends(get_current_user)
):
    session = get_active_session(db, x_auth_token)
    if session:
        db.delete(session)
        db.commit()
    return {"status": "ok"}


@app.get("/auth/users")
def auth_list_users(db: Session = Depends(get_db), user: models.User = Depends(require_owner)):
    users = db.query(models.User).order_by(models.User.username.asc()).all()
    return {"results": [serialize_user(item) for item in users]}


@app.post("/auth/users")
def auth_create_user(payload: dict = Body(...), db: Session = Depends(get_db), user: models.User = Depends(require_owner)):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    display_name = str(payload.get("display_name") or username).strip()
    role = str(payload.get("role") or ROLE_STAFF).strip().upper()

    if len(username) < 3:
        return {"error": "Username must be at least 3 characters"}
    if len(password) < 4:
        return {"error": "Password must be at least 4 characters"}
    if role not in [ROLE_OWNER, ROLE_STAFF]:
        return {"error": "Role must be OWNER or STAFF"}
    existing = db.query(models.User).filter(func.lower(models.User.username) == username.lower()).first()
    if existing:
        return {"error": "Username already exists"}

    new_user = models.User(
        id=uuid4(),
        username=username,
        password_hash=hash_password(password),
        role=role,
        display_name=display_name,
        is_active="true"
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"user": serialize_user(new_user)}


TEMPLATES = {
    "dealer": "DEALER,BILL_NO,HEN_TYPE,NAG,KGS,RATE_PER_KG\nABC Supplier,INV-101,Broiler,52,100,120\n",
    "vendor": "VENDOR,HEN_TYPE,NAG,KGS,RATE_PER_KG\nXYZ Hotel,Broiler,24,40,150\n",
    "payment": "DATE,PARTY,AMOUNT,PAYMENT_MODE,DIRECTION\n2026-04-21,XYZ Hotel,5000,Online,RECEIVED\n",
    "opening-balance": "DATE,PARTY,OPENING_BALANCE,BALANCE_TYPE\n2026-04-01,XYZ Hotel,25000,RECEIVABLE\n",
    "opening-stock": "DATE,HEN_TYPE,OPENING_NAG,OPENING_KGS\n2026-04-01,Broiler,220,500\n"
}


@app.get("/templates/{template_type}")
def download_template(template_type: str):
    template = TEMPLATES.get(template_type)
    if not template:
        return {"error": "Template not found"}

    return Response(
        content=template,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={template_type}_template.csv"}
    )


def normalize_party_name(name: str) -> str:
    return name.lower().replace(" ", "").replace(".", "")


def parse_input_date(value: str):
    try:
        return pd.to_datetime(value).date()
    except Exception:
        return None


def summarize_ledger_transactions(txns):
    summarized = []
    index = 0

    while index < len(txns):
        txn = txns[index]
        source_ref = str(getattr(txn, "source_ref", "") or "")

        if source_ref.startswith("retail-bill:"):
            bill_prefix = ":".join(source_ref.split(":")[:2])
            grouped = []

            while index < len(txns):
                candidate = txns[index]
                candidate_ref = str(getattr(candidate, "source_ref", "") or "")
                if not candidate_ref.startswith(bill_prefix):
                    break
                grouped.append(candidate)
                index += 1

            first = grouped[0]
            total_amount = sum(Decimal(g.amount or 0) for g in grouped)
            total_weight = sum(Decimal(g.weight or 0) for g in grouped)
            total_quantity = sum(Decimal(g.quantity or 0) for g in grouped)

            summarized.append({
                "date": first.date,
                "type": "SALE",
                "category": "RETAIL BILL",
                "item": "Retail Bill",
                "payment_mode": first.payment_mode or "NA",
                "bill_number": first.bill_number or "",
                "amount": total_amount,
                "delta": total_amount,
                "weight": total_weight,
                "quantity": total_quantity
            })
            continue

        amount = Decimal(txn.amount or 0)
        delta = ledger_delta(txn)

        txn_type = txn.type
        if txn.type == "PAYMENT" and txn.category:
            txn_type = f"PAYMENT {txn.category}"
        elif txn.type == "OPENING" and txn.category:
            txn_type = f"OPENING {txn.category}"

        summarized.append({
            "date": txn.date,
            "type": txn_type,
            "category": txn.category or "",
            "item": txn.item_type or "",
            "payment_mode": txn.payment_mode or "NA",
            "bill_number": txn.bill_number or "",
            "amount": amount,
            "delta": delta,
            "weight": Decimal(txn.weight or 0),
            "quantity": Decimal(txn.quantity or 0),
            "rate": Decimal(txn.rate or 0)
        })
        index += 1

    return summarized


def build_ledger(txns):
    balance = Decimal("0")
    ledger = []

    for txn in summarize_ledger_transactions(txns):
        amount = Decimal(txn["amount"] or 0)
        delta = Decimal(txn["delta"] or 0)
        balance += delta

        ledger.append({
            "date": str(txn["date"]),
            "type": txn["type"],
            "bill_number": txn["bill_number"] or "",
            "category": txn["category"] or "",
            "item": txn["item"] or "",
            "quantity": float(Decimal(txn["quantity"] or 0)),
            "weight": float(Decimal(txn["weight"] or 0)),
            "rate": float(Decimal(txn.get("rate") or 0)),
            "payment_mode": txn["payment_mode"] or "NA",
            "amount": float(amount),
            "delta": float(delta),
            "balance": float(balance)
        })

    return balance, ledger


def build_party_summary(txns, balance):
    last_txn = txns[-1] if txns else None
    last_date = last_txn.date if last_txn else None
    opening_balance = Decimal("0")
    day_txns = []

    if last_date:
        for txn in txns:
            if txn.date >= last_date:
                day_txns.append(txn)
            else:
                opening_balance += ledger_delta(txn)

    total_sales = sum(Decimal(t.amount or 0) for t in day_txns if t.type == "SALE")
    total_purchase = sum(Decimal(t.amount or 0) for t in day_txns if t.type == "PURCHASE")
    total_received = sum(Decimal(t.amount or 0) for t in day_txns if t.type == "PAYMENT" and t.category == "RECEIVED")
    total_paid = sum(Decimal(t.amount or 0) for t in day_txns if t.type == "PAYMENT" and t.category == "PAID")

    return {
        "opening_balance": float(opening_balance),
        "total_sales": float(total_sales),
        "total_purchase": float(total_purchase),
        "total_received": float(total_received),
        "total_paid": float(total_paid),
        "current_balance": float(balance),
        "last_transaction_date": str(last_txn.date) if last_txn else None
    }


def ledger_delta(txn):
    amount = Decimal(txn.amount or 0)

    if txn.type in ["SALE", "PURCHASE", "OPENING"]:
        return amount

    if txn.type == "PAYMENT":
        return -amount

    return Decimal("0")


def receivable_delta(txn):
    amount = Decimal(txn.amount or 0)

    if txn.type == "SALE" or (txn.type == "OPENING" and txn.category == "RECEIVABLE"):
        return amount

    if txn.type == "PAYMENT" and txn.category == "RECEIVED":
        return -amount

    return Decimal("0")


def payable_delta(txn):
    amount = Decimal(txn.amount or 0)

    if txn.type == "PURCHASE" or (txn.type == "OPENING" and txn.category == "PAYABLE"):
        return amount

    if txn.type == "PAYMENT" and txn.category == "PAID":
        return -amount

    return Decimal("0")


def receivable_case():
    return case(
        (models.Transaction.type == "SALE", models.Transaction.amount),
        (
            (models.Transaction.type == "OPENING") & (models.Transaction.category == "RECEIVABLE"),
            models.Transaction.amount
        ),
        (
            (models.Transaction.type == "PAYMENT") & (models.Transaction.category == "RECEIVED"),
            -models.Transaction.amount
        ),
        else_=0
    )


def payable_case():
    return case(
        (models.Transaction.type == "PURCHASE", models.Transaction.amount),
        (
            (models.Transaction.type == "OPENING") & (models.Transaction.category == "PAYABLE"),
            models.Transaction.amount
        ),
        (
            (models.Transaction.type == "PAYMENT") & (models.Transaction.category == "PAID"),
            -models.Transaction.amount
        ),
        else_=0
    )


def row_error(errors, row_number, message):
    errors.append({"row": row_number, "error": message})


def upload_result(inserted, skipped, errors, extra=None):
    result = {
        "status": "success",
        "rows_inserted": inserted,
        "rows_skipped": skipped,
        "errors": errors[:25],
        "preview": {
            "inserted": inserted,
            "skipped": skipped,
            "errors": len(errors)
        }
    }

    if extra:
        result.update(extra)

    return result


def report_response(rows, columns, filename, file_format, title):
    if file_format == "excel":
        output = BytesIO()
        pd.DataFrame(rows, columns=columns).to_excel(output, index=False, sheet_name="Report")
        output.seek(0)
        return Response(
            content=output.read(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"}
        )

    if file_format == "pdf":
        return Response(
            content=build_simple_pdf(title, columns, rows),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}.pdf"}
        )

    return {"error": "Invalid format"}


def build_simple_pdf(title, columns, rows):
    lines = [title, ""]
    lines.append(" | ".join(columns))
    lines.append("-" * min(110, max(24, len(lines[-1]))))

    for row in rows:
        lines.append(" | ".join(str(row.get(column, "")) for column in columns))

    if not rows:
        lines.append("No records found")

    pages = []
    chunk_size = 42
    for index in range(0, len(lines), chunk_size):
        pages.append(lines[index:index + chunk_size])

    objects = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    }
    page_refs = []
    next_ref = 4

    for page in pages:
        content = ["BT", "/F1 9 Tf", "42 790 Td", "12 TL"]
        for line in page:
            content.append(f"({pdf_escape(line[:150])}) Tj")
            content.append("T*")
        content.append("ET")
        stream = "\n".join(content)
        content_ref = next_ref
        objects[content_ref] = f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream"
        next_ref += 1

        page_ref = next_ref
        objects[page_ref] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_ref} 0 R >>"
        )
        next_ref += 1
        page_refs.append(page_ref)

    objects[2] = (
        "<< /Type /Pages /Kids ["
        + " ".join(f"{ref} 0 R" for ref in page_refs)
        + f"] /Count {len(page_refs)} >>"
    )

    pdf = "%PDF-1.4\n"
    offsets = [0]
    for index in sorted(objects):
        value = objects[index]
        offsets.append(len(pdf.encode("latin-1")))
        pdf += f"{index} 0 obj\n{value}\nendobj\n"

    xref_offset = len(pdf.encode("latin-1"))
    max_ref = max(objects)
    pdf += f"xref\n0 {max_ref + 1}\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n"
    pdf += f"trailer\n<< /Size {max_ref + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF"
    return pdf.encode("latin-1", errors="replace")


def pdf_escape(value):
    return str(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def parse_report_dates(start_date, end_date):
    start = parse_input_date(start_date) if start_date else None
    end = parse_input_date(end_date) if end_date else None
    return start, end


def safe_filename(value):
    cleaned = "".join(char if char.isalnum() or char in ["-", "_"] else "_" for char in value)
    return quote(cleaned[:120] or "report")


def latest_item_rates(db: Session, target_date):
    rows = db.query(
        models.Transaction.item_type,
        models.Transaction.rate,
        models.Transaction.date
    ).filter(
        models.Transaction.item_type.isnot(None),
        models.Transaction.rate.isnot(None),
        models.Transaction.date <= target_date,
        models.Transaction.type == "PURCHASE"
    ).order_by(
        models.Transaction.item_type.asc(),
        models.Transaction.date.desc(),
        models.Transaction.created_at.desc()
    ).all()

    rates = {}
    for row in rows:
        if row.item_type and row.item_type not in rates:
            rates[row.item_type] = Decimal(row.rate or 0)
    return rates


def stock_item_names_query(db: Session):
    sale_purchase_items = db.query(models.Transaction.item_type).filter(
        models.Transaction.item_type.isnot(None),
        models.Transaction.type.in_(["PURCHASE", "SALE"])
    ).distinct().all()
    opening_items = db.query(models.ItemOpeningStock.item_type).distinct().all()

    items = set()
    for row in sale_purchase_items:
        if row.item_type:
            items.add(row.item_type)
    for row in opening_items:
        if row.item_type:
            items.add(row.item_type)
    return items


def format_sheet_row(label, weight=0, rate=0, amount=0, nag=None):
    return {
        "goods": label,
        "nag": float(nag) if nag is not None else "",
        "weight": float(weight or 0),
        "rate": float(rate or 0),
        "total": float(amount or 0)
    }


def format_balance_row(party_name, old_balance=0, purchases=0, payment=0, balance=0):
    return {
        "party_name": party_name,
        "old_balance": float(old_balance or 0),
        "purchases": float(purchases or 0),
        "payment": float(payment or 0),
        "balance": float(balance or 0)
    }


def format_retail_credit_row(customer_name, bill_number, total_amount=0, paid_amount=0, outstanding_amount=0, payment_mode="Credit"):
    return {
        "customer_name": customer_name or "Walk-in Customer",
        "bill_number": bill_number or "",
        "total_amount": float(total_amount or 0),
        "paid_amount": float(paid_amount or 0),
        "outstanding_amount": float(outstanding_amount or 0),
        "payment_mode": payment_mode or "Credit"
    }


def decimal_ratio(amount, weight):
    amount_value = Decimal(amount or 0)
    weight_value = Decimal(weight or 0)
    if weight_value <= 0:
        return Decimal("0")
    return amount_value / weight_value


def optional_decimal_sum(values):
    found = False
    total = Decimal("0")
    for value in values:
        if value not in [None, ""]:
            found = True
            total += Decimal(value or 0)
    return total if found else None


def optional_float(value):
    if value in [None, ""]:
        return None
    return float(value)


def format_rate_analysis_row(label, avg_rate=0, weight=0, amount=0, category=None, goods=None):
    row = {
        "label": label,
        "avg_rate": float(avg_rate or 0),
        "weight": float(weight or 0),
        "amount": float(amount or 0)
    }
    if category is not None:
        row["category"] = category
    if goods is not None:
        row["goods"] = goods
    return row


def format_performance_row(item, purchase_kg=0, sales_kg=0, buy_rate=0, sell_rate=0, spread=0, gross_profit=0):
    return {
        "item": item,
        "purchase_kg": float(purchase_kg or 0),
        "sales_kg": float(sales_kg or 0),
        "buy_rate": float(buy_rate or 0),
        "sell_rate": float(sell_rate or 0),
        "spread": float(spread or 0),
        "gross_profit": float(gross_profit or 0)
    }


def parse_decimal(value, default="0"):
    if value in [None, ""]:
        return Decimal(default)

    try:
        return Decimal(str(value).strip())
    except Exception:
        return Decimal(default)


def serialize_dressed_stock_entry(entry):
    return {
        "id": str(entry.id),
        "date": str(entry.date),
        "item_name": entry.item_name,
        "live_quantity": float(entry.live_quantity or 0),
        "live_weight": float(entry.live_weight or 0),
        "dressed_weight": float(entry.dressed_weight or 0),
        "remaining_dressed_weight": float(entry.remaining_dressed_weight or 0),
        "default_rate": float(entry.default_rate or 0),
        "notes": entry.notes or ""
    }


def serialize_retail_bill(bill, items):
    created_at = bill.created_at or datetime.utcnow()
    bill_mode = "dressed" if any((item.line_type or "STANDARD").upper() == "DRESSED" for item in items) else "regular"

    return {
        "id": str(bill.id),
        "bill_number": bill.bill_number,
        "bill_mode": bill_mode,
        "date": str(bill.date),
        "time": created_at.strftime("%H:%M:%S"),
        "customer_name": bill.customer_name or "",
        "customer_phone": bill.customer_phone or "",
        "customer_address": bill.customer_address or "",
        "cashier_name": bill.cashier_name or "admin",
        "payment_mode": bill.payment_mode or "Cash",
        "total_nag": float(bill.total_quantity or 0),
        "total_quantity": float(bill.total_quantity or 0),
        "total_weight": float(bill.total_weight or 0),
        "ice_amount": float(bill.ice_amount or 0),
        "total_amount": float(bill.total_amount or 0),
        "paid_amount": float(bill.paid_amount or 0),
        "outstanding_amount": float(bill.outstanding_amount or 0),
        "party_balance": None,
        "notes": bill.notes or "",
        "items": [
            {
                "line_order": item.line_order,
                "item_name": item.item_name,
                "line_type": (item.line_type or "STANDARD").upper(),
                "nag": float(item.quantity or 0),
                "quantity": float(item.quantity or 0),
                "unit": item.unit or "KGS",
                "weight": float(item.weight or 0),
                "rate": float(item.rate or 0),
                "amount": float(item.amount or 0)
            }
            for item in items
        ]
    }


def retail_party_balance_after(db: Session, party_id):
    if not party_id:
        return None

    txns = db.query(models.Transaction).filter(
        models.Transaction.party_id == party_id
    ).order_by(
        models.Transaction.date.asc(),
        models.Transaction.created_at.asc()
    ).all()
    txns = filter_party_ledger_transactions(db, txns)

    balance_after, _ = build_ledger(txns)
    return float(balance_after or 0)


def filter_party_ledger_transactions(db: Session, txns):
    if not txns:
        return txns

    retail_keys = {
        (txn.date, txn.party_id, str(txn.bill_number or "").strip())
        for txn in txns
        if txn.party_id
        and str(txn.bill_number or "").strip()
        and txn.type == "SALE"
        and (txn.category or "").upper() in ["RETAIL", "RETAIL DRESSED"]
    }

    if not retail_keys:
        return txns

    retail_dates = {key[0] for key in retail_keys}
    retail_parties = {key[1] for key in retail_keys}
    retail_bill_numbers = {key[2] for key in retail_keys}

    paid_bill_keys = {
        (bill.date, bill.party_id, str(bill.bill_number or "").strip())
        for bill in db.query(models.RetailBill).filter(
            models.RetailBill.party_id.in_(list(retail_parties)),
            models.RetailBill.date.in_(list(retail_dates)),
            models.RetailBill.bill_number.in_(list(retail_bill_numbers)),
            models.RetailBill.outstanding_amount <= 0
        ).all()
    }

    if not paid_bill_keys:
        return txns

    return [
        txn for txn in txns
        if not (
            txn.type == "SALE" and
            (txn.category or "").upper() in ["RETAIL", "RETAIL DRESSED"] and
            (txn.date, txn.party_id, str(txn.bill_number or "").strip()) in paid_bill_keys
        )
    ]


def serialize_payment_receipt(receipt, balance_after=None):
    created_at = receipt.created_at or datetime.utcnow()
    return {
        "id": str(receipt.id),
        "receipt_number": receipt.receipt_number,
        "date": str(receipt.date),
        "time": created_at.strftime("%H:%M:%S"),
        "party_name": receipt.party_name or "",
        "party_phone": receipt.party_phone or "",
        "party_address": receipt.party_address or "",
        "cashier_name": receipt.cashier_name or "admin",
        "direction": receipt.direction or "RECEIVED",
        "payment_mode": receipt.payment_mode or "Cash",
        "amount": float(receipt.amount or 0),
        "balance_after": float(balance_after or 0),
        "notes": receipt.notes or ""
    }


def recompute_dressed_stock_remaining(db: Session, target_date):
    if not target_date:
        return

    entries = db.query(models.DressedStockEntry).filter(
        models.DressedStockEntry.date == target_date
    ).order_by(
        models.DressedStockEntry.created_at.asc()
    ).all()

    if not entries:
        return

    for entry in entries:
        base_weight = Decimal(entry.dressed_weight or 0)
        entry.remaining_dressed_weight = base_weight if base_weight > 0 else Decimal("0")

    total_dressed_sold = db.query(
        func.coalesce(func.sum(models.RetailBillItem.weight), 0)
    ).join(
        models.RetailBill,
        models.RetailBill.id == models.RetailBillItem.bill_id
    ).filter(
        models.RetailBill.date == target_date,
        models.RetailBillItem.line_type == "DRESSED"
    ).scalar()

    remaining_required = Decimal(total_dressed_sold or 0)
    for entry in entries:
        if remaining_required <= 0:
            break
        available_weight = Decimal(entry.remaining_dressed_weight or 0)
        used_weight = min(available_weight, remaining_required)
        entry.remaining_dressed_weight = available_weight - used_weight
        remaining_required -= used_weight


def merge_party_type(existing_type: str | None, new_type: str | None):
    existing = str(existing_type or "").strip().upper()
    incoming = str(new_type or "").strip().upper()

    if not existing:
        return incoming or None
    if not incoming or incoming == existing:
        return existing
    if "BOTH" in [existing, incoming]:
        return "BOTH"
    return "BOTH"


def update_party_details(party, party_type: str | None = None, phone: str | None = None, address: str | None = None):
    if party is None:
        return

    merged_type = merge_party_type(party.type, party_type)
    if merged_type and merged_type != party.type:
        party.type = merged_type

    cleaned_phone = str(phone or "").strip()
    cleaned_address = str(address or "").strip()
    if cleaned_phone and not (party.phone or "").strip():
        party.phone = cleaned_phone
    if cleaned_address and not (party.address or "").strip():
        party.address = cleaned_address


def get_or_create_party(
    db: Session,
    party_name: str,
    party_type: str,
    seen_aliases: dict,
    phone: str | None = None,
    address: str | None = None
):
    normalized = normalize_party_name(party_name)

    if normalized in seen_aliases:
        party_id = seen_aliases[normalized]
        party = db.query(models.Party).filter_by(id=party_id).first()
        update_party_details(party, party_type, phone, address)
        return party_id

    alias = db.query(models.PartyAlias).filter_by(
        normalized_alias=normalized
    ).first()

    if alias:
        party_id = alias.party_id
        party = db.query(models.Party).filter_by(id=party_id).first()
        update_party_details(party, party_type, phone, address)
    else:
        party = models.Party(
            name=party_name,
            normalized_name=normalized,
            type=party_type,
            phone=str(phone or "").strip() or None,
            address=str(address or "").strip() or None
        )
        db.add(party)
        db.flush()

        alias = models.PartyAlias(
            alias=party_name,
            normalized_alias=normalized,
            party_id=party.id
        )
        db.add(alias)

        party_id = party.id

    seen_aliases[normalized] = party_id
    return party_id


def get_party_by_name(db: Session, party_name: str):
    normalized = normalize_party_name(party_name)
    if not normalized:
        return None

    alias = db.query(models.PartyAlias).filter(
        models.PartyAlias.normalized_alias == normalized
    ).first()
    if alias:
        return db.query(models.Party).filter_by(id=alias.party_id).first()

    alias = db.query(models.PartyAlias).filter(
        models.PartyAlias.normalized_alias.contains(normalized)
    ).first()
    if not alias:
        return None

    return db.query(models.Party).filter_by(id=alias.party_id).first()


def normalize_payment_direction(value: str):
    normalized = str(value).strip().upper()

    if normalized in ["RECEIVED", "RECEIVE", "FROM", "IN", "INCOMING", "CREDIT"]:
        return "RECEIVED"

    if normalized in ["PAID", "PAY", "TO", "OUT", "OUTGOING", "DEBIT"]:
        return "PAID"

    return None


def get_first_existing_column(df, candidates):
    for col in candidates:
        if col in df.columns:
            return col

    return None


def require_column(df, candidates, label):
    col = get_first_existing_column(df, candidates)
    if not col:
        return None, {"error": f"Missing column: {label}"}

    return col, None


def get_optional_row_value(row, candidates):
    for col in candidates:
        if col in row.index and not pd.isna(row[col]):
            value = str(row[col]).strip()
            if value:
                return value

    return None


def resolve_upload_date(row, date_col, fallback_date):
    if date_col and date_col in row.index and not pd.isna(row[date_col]):
        return pd.to_datetime(row[date_col], dayfirst=True).date()

    return fallback_date


@app.post("/entries/vendor")
def create_vendor_entries(payload: dict = Body(...), input_date: str = None, db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Select working date"}

    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one vendor row"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_transactions = set()

    for index, row in enumerate(rows, start=1):
        try:
            party_name = str(row.get("vendor") or row.get("party") or "").strip()
            item_type = str(row.get("hen_type") or row.get("item_type") or "").strip()
            category = str(row.get("category") or "").strip() or None
            quantity = parse_decimal(row.get("nag", row.get("quantity")))
            weight = parse_decimal(row.get("kgs", row.get("weight")))
            rate = parse_decimal(row.get("rate_per_kg", row.get("rate")))

            if not party_name or not item_type or weight <= 0 or rate <= 0 or quantity < 0:
                skipped += 1
                row_error(errors, index, "Enter vendor, hen type, valid NAG, kg, and rate")
                continue

            party_id = get_or_create_party(db, party_name, "VENDOR", seen_aliases)
            txn_key = (target_date, party_id, float(weight), float(rate), "SALE", category, item_type)
            existing_txn = db.query(models.Transaction).filter_by(
                date=target_date,
                party_id=party_id,
                weight=float(weight),
                rate=float(rate),
                type="SALE",
                category=category,
                item_type=item_type
            ).first()

            if existing_txn or txn_key in seen_transactions:
                skipped += 1
                continue

            db.add(models.Transaction(
                date=target_date,
                party_id=party_id,
                type="SALE",
                category=category,
                item_type=item_type,
                quantity=quantity if quantity > 0 else None,
                weight=weight,
                rate=rate,
                amount=weight * rate,
                payment_mode="NA"
            ))
            seen_transactions.add(txn_key)
            inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving vendor entries failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/entries/dealer")
def create_dealer_entries(payload: dict = Body(...), input_date: str = None, db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Select working date"}

    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one dealer row"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_transactions = set()

    for index, row in enumerate(rows, start=1):
        try:
            party_name = str(row.get("dealer") or row.get("party") or "").strip()
            bill_number = str(row.get("bill_no") or row.get("bill_number") or "").strip() or None
            item_type = str(row.get("hen_type") or row.get("item_type") or "").strip()
            quantity = parse_decimal(row.get("nag", row.get("quantity")))
            weight = parse_decimal(row.get("kgs", row.get("weight")))
            rate = parse_decimal(row.get("rate_per_kg", row.get("rate")))

            if not party_name or not item_type or weight <= 0 or rate <= 0 or quantity < 0:
                skipped += 1
                row_error(errors, index, "Enter dealer, hen type, valid NAG, kg, and rate")
                continue

            party_id = get_or_create_party(db, party_name, "DEALER", seen_aliases)
            txn_key = (target_date, party_id, float(weight), float(rate), "PURCHASE", bill_number or "", item_type)
            existing_txn = db.query(models.Transaction).filter_by(
                date=target_date,
                party_id=party_id,
                weight=float(weight),
                rate=float(rate),
                type="PURCHASE",
                category=None,
                item_type=item_type,
                bill_number=bill_number
            ).first()

            if existing_txn or txn_key in seen_transactions:
                skipped += 1
                continue

            db.add(models.Transaction(
                date=target_date,
                party_id=party_id,
                type="PURCHASE",
                category=None,
                item_type=item_type,
                quantity=quantity if quantity > 0 else None,
                weight=weight,
                rate=rate,
                amount=weight * rate,
                payment_mode="NA",
                bill_number=bill_number
            ))
            seen_transactions.add(txn_key)
            inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving dealer entries failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/entries/payment")
def create_payment_entries(payload: dict = Body(...), input_date: str = None, db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Select working date"}

    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one payment row"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_payments = set()

    for index, row in enumerate(rows, start=1):
        try:
            party_name = str(row.get("party") or "").strip()
            amount = parse_decimal(row.get("amount"))
            payment_mode = str(row.get("payment_mode") or "NA").strip()
            direction = normalize_payment_direction(row.get("direction"))

            if not party_name or amount <= 0 or not direction:
                skipped += 1
                row_error(errors, index, "Enter party, amount, payment mode, and valid direction")
                continue

            party_id = get_or_create_party(db, party_name, "BOTH", seen_aliases)
            payment_key = (target_date, party_id, float(amount), payment_mode, direction)
            existing_payment = db.query(models.Transaction).filter_by(
                date=target_date,
                party_id=party_id,
                type="PAYMENT",
                amount=amount,
                payment_mode=payment_mode,
                category=direction
            ).first()

            if existing_payment or payment_key in seen_payments:
                skipped += 1
                continue

            db.add(models.Transaction(
                date=target_date,
                party_id=party_id,
                type="PAYMENT",
                category=direction,
                amount=amount,
                payment_mode=payment_mode
            ))
            seen_payments.add(payment_key)
            inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving payment entries failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/entries/mortality")
def create_mortality_entries(payload: dict = Body(...), input_date: str = None, db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Select working date"}

    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one mortality row"}

    inserted = 0
    skipped = 0
    errors = []
    seen_transactions = set()

    for index, row in enumerate(rows, start=1):
        try:
            item_type = str(row.get("hen_type") or row.get("item_type") or "").strip()
            quantity = parse_decimal(row.get("nag", row.get("quantity")))
            weight = parse_decimal(row.get("weight", row.get("kgs")))

            if not item_type:
                skipped += 1
                row_error(errors, index, "Enter hen type")
                continue

            if quantity < 0 or weight < 0:
                skipped += 1
                row_error(errors, index, "NAG and weight cannot be negative")
                continue

            if quantity <= 0 and weight <= 0:
                skipped += 1
                row_error(errors, index, "Enter NAG or weight")
                continue

            txn_key = (target_date, item_type, float(quantity), float(weight), "MORTALITY")
            existing_txn = db.query(models.Transaction).filter_by(
                date=target_date,
                party_id=None,
                type="MORTALITY",
                category="MORTALITY",
                item_type=item_type,
                quantity=quantity if quantity > 0 else None,
                weight=weight if weight > 0 else 0
            ).first()

            if existing_txn or txn_key in seen_transactions:
                skipped += 1
                continue

            db.add(models.Transaction(
                date=target_date,
                party_id=None,
                type="MORTALITY",
                category="MORTALITY",
                item_type=item_type,
                quantity=quantity if quantity > 0 else None,
                weight=weight if weight > 0 else 0,
                rate=0,
                amount=0,
                payment_mode="NA"
            ))
            seen_transactions.add(txn_key)
            inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving mortality entries failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/entries/opening-balance")
def create_opening_balance_entries(payload: dict = Body(...), input_date: str = None, db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Select working date"}

    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one opening balance row"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_opening = set()

    for index, row in enumerate(rows, start=1):
        try:
            party_name = str(row.get("party") or "").strip()
            amount = parse_decimal(row.get("opening_balance", row.get("amount")))
            balance_type = str(row.get("balance_type") or "").strip().upper()

            if balance_type in ["RECEIVABLE", "RECEIVE", "CUSTOMER", "VENDOR"]:
                balance_type = "RECEIVABLE"
                party_type = "VENDOR"
            elif balance_type in ["PAYABLE", "PAY", "SUPPLIER", "DEALER"]:
                balance_type = "PAYABLE"
                party_type = "DEALER"
            else:
                skipped += 1
                row_error(errors, index, "Balance type must be RECEIVABLE or PAYABLE")
                continue

            if not party_name or amount < 0:
                skipped += 1
                row_error(errors, index, "Enter party and valid opening balance")
                continue

            party_id = get_or_create_party(db, party_name, party_type, seen_aliases)
            opening_key = (target_date, party_id, balance_type)
            existing_opening = db.query(models.Transaction).filter_by(
                date=target_date,
                party_id=party_id,
                type="OPENING",
                category=balance_type
            ).first()
            if existing_opening or opening_key in seen_opening:
                skipped += 1
                continue

            db.add(models.Transaction(
                date=target_date,
                party_id=party_id,
                type="OPENING",
                category=balance_type,
                amount=amount,
                payment_mode="NA"
            ))
            seen_opening.add(opening_key)
            inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving opening balances failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/entries/opening-stock")
def create_opening_stock_entries(payload: dict = Body(...), input_date: str = None, db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Select working date"}

    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one opening stock row"}

    inserted = 0
    skipped = 0
    errors = []
    seen_stock = set()

    for index, row in enumerate(rows, start=1):
        try:
            item_type = str(row.get("hen_type") or row.get("item_type") or "").strip()
            opening_quantity = parse_decimal(row.get("opening_nag", row.get("nag", row.get("quantity"))))
            opening_weight = parse_decimal(row.get("opening_kgs", row.get("kgs", row.get("weight"))))

            if not item_type or opening_weight < 0 or opening_quantity < 0:
                skipped += 1
                row_error(errors, index, "Enter hen type, valid opening NAG, and opening kg")
                continue

            stock_key = (target_date, item_type)
            existing_stock = db.query(models.ItemOpeningStock).filter_by(
                date=target_date,
                item_type=item_type
            ).first()
            if existing_stock or stock_key in seen_stock:
                skipped += 1
                continue

            db.add(models.ItemOpeningStock(
                date=target_date,
                item_type=item_type,
                opening_quantity=opening_quantity if opening_quantity > 0 else None,
                opening_weight=opening_weight
            ))
            seen_stock.add(stock_key)
            inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving opening stock failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/upload/vendor")
def upload_vendor(file: UploadFile = File(...), preview: bool = False, input_date: str = None, db: Session = Depends(get_db)):

    import io
    import hashlib

    filename = (file.filename or "").lower()
    contents = file.file.read()

    # --- File hash (duplicate file protection) ---
    file_hash = hashlib.sha256(contents).hexdigest()

    existing_file = db.query(models.UploadedFile).filter_by(file_hash=file_hash).first()
    if existing_file:
        return {"error": "File already uploaded"}

    # --- Read file ---
    try:
        if filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")

        elif filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(contents), engine="xlrd")

        elif filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8")

        else:
            return {"error": "Unsupported file format"}

    except Exception as e:
        return {"error": f"File read failed: {str(e)}"}

    # --- Validation ---
    if df.empty:
        return {"error": "File is empty"}

    df.columns = df.columns.str.strip().str.upper()

    date_col = get_first_existing_column(df, ["DATE"])
    fallback_date = parse_input_date(input_date) if input_date else None
    if not date_col and not fallback_date:
        return {"error": "Provide DATE column in file or select the upload date in the app"}

    party_col, error = require_column(df, ["VENDOR", "PARTY", "NAME"], "VENDOR")
    if error:
        return error

    weight_col, error = require_column(df, ["KGS", "KG", "WEIGHT"], "KGS")
    if error:
        return error

    rate_col, error = require_column(df, ["RATE_PER_KG", "RATE PER KG", "RATE/KG", "RATE"], "RATE PER KG")
    if error:
        return error

    item_col, error = require_column(df, ["HEN_TYPE", "HEN TYPE", "ITEM", "TYPE"], "HEN TYPE")
    if error:
        return error

    quantity_col = get_first_existing_column(df, ["NAG", "QTY", "QUANTITY", "PCS", "PIECES"])

    # --- Numeric validation ---
    try:
        df[weight_col] = df[weight_col].astype(float)
        df[rate_col] = df[rate_col].astype(float)
        if quantity_col:
            df[quantity_col] = df[quantity_col].astype(float)
    except:
        return {"error": "Invalid numeric values"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_transactions = set()

    # --- Process rows ---
    for index, row in df.iterrows():
        row_number = int(index) + 2
        try:
            if pd.isna(row[party_col]) or pd.isna(row[weight_col]) or pd.isna(row[rate_col]) or pd.isna(row[item_col]):
                skipped += 1
                row_error(errors, row_number, "Missing vendor, hen type, kg, or rate")
                continue

            party_name = str(row[party_col]).strip()
            weight = float(row[weight_col])
            rate = float(row[rate_col])
            quantity = Decimal(str(float(row[quantity_col]))) if quantity_col and not pd.isna(row[quantity_col]) else None
            date = resolve_upload_date(row, date_col, fallback_date)
            if not date:
                skipped += 1
                row_error(errors, row_number, "Invalid or missing date")
                continue
            item_type = str(row[item_col]).strip()
            category = get_optional_row_value(row, ["CATEGORY"])
            if weight <= 0 or rate <= 0 or (quantity is not None and quantity < 0):
                skipped += 1
                row_error(errors, row_number, "NAG cannot be negative. KG and rate must be greater than zero")
                continue

            # --- Party mapping ---
            party_id = get_or_create_party(db, party_name, "VENDOR", seen_aliases)

            # --- Duplicate check ---
            existing_txn = db.query(models.Transaction).filter_by(
                date=date,
                party_id=party_id,
                weight=weight,
                rate=rate,
                type="SALE",
                category=category,
                item_type=item_type
            ).first()

            txn_key = (date, party_id, weight, rate, "SALE", category, item_type)

            if existing_txn or txn_key in seen_transactions:
                skipped += 1
                continue

            # --- Create sale transaction ---
            txn = models.Transaction(
                date=date,
                party_id=party_id,
                type="SALE",
                category=category,
                item_type=item_type,
                quantity=quantity,
                weight=weight,
                rate=rate,
                amount=weight * rate,
                payment_mode="NA"
            )

            db.add(txn)
            seen_transactions.add(txn_key)
            inserted += 1

        except Exception as e:
            skipped += 1
            row_error(errors, row_number, str(e))
            continue

    # --- Final commit (ONLY ONCE) ---
    try:
        if preview:
            db.rollback()
            return upload_result(inserted, skipped, errors, {"preview_mode": True})

        file_record = models.UploadedFile(
            file_hash=file_hash,
            file_type="vendor"
        )
        db.add(file_record)
        db.commit()

    except Exception as e:
        db.rollback()
        return {"error": "Transaction failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)

@app.post("/upload/dealer")
def upload_dealer(file: UploadFile = File(...), preview: bool = False, input_date: str = None, db: Session = Depends(get_db)):

    import io
    import hashlib

    filename = (file.filename or "").lower()
    contents = file.file.read()

    # --- File hash protection ---
    file_hash = hashlib.sha256(contents).hexdigest()

    existing_file = db.query(models.UploadedFile).filter_by(file_hash=file_hash).first()
    if existing_file:
        return {"error": "File already uploaded"}

    # --- Read file ---
    try:
        if filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")

        elif filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(contents), engine="xlrd")

        elif filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8")

        else:
            return {"error": "Unsupported file format"}

    except Exception as e:
        return {"error": f"File read failed: {str(e)}"}

    # --- Validation ---
    if df.empty:
        return {"error": "File is empty"}

    df.columns = df.columns.str.strip().str.upper()

    date_col = get_first_existing_column(df, ["DATE"])
    fallback_date = parse_input_date(input_date) if input_date else None
    if not date_col and not fallback_date:
        return {"error": "Provide DATE column in file or select the upload date in the app"}

    party_col, error = require_column(df, ["DEALER", "PARTY", "NAME"], "DEALER")
    if error:
        return error

    bill_number_col = get_first_existing_column(df, ["BILL_NO", "BILL NO", "BILL_NUMBER", "BILL NUMBER", "INVOICE_NO", "INVOICE NO"])

    item_col, error = require_column(df, ["HEN_TYPE", "HEN TYPE", "ITEM", "TYPE"], "HEN TYPE")
    if error:
        return error

    weight_col, error = require_column(df, ["KGS", "KG", "WEIGHT"], "KGS")
    if error:
        return error

    rate_col, error = require_column(df, ["RATE_PER_KG", "RATE PER KG", "RATE/KG", "RATE"], "RATE PER KG")
    if error:
        return error

    quantity_col = get_first_existing_column(df, ["NAG", "QTY", "QUANTITY", "PCS", "PIECES"])

    # --- Numeric validation ---
    try:
        df[weight_col] = df[weight_col].astype(float)
        df[rate_col] = df[rate_col].astype(float)
        if quantity_col:
            df[quantity_col] = df[quantity_col].astype(float)
    except:
        return {"error": "Invalid numeric values"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_transactions = set()

    # --- Process rows ---
    for index, row in df.iterrows():
        row_number = int(index) + 2
        try:
            if (
                pd.isna(row[party_col]) or
                pd.isna(row[item_col]) or
                pd.isna(row[weight_col]) or
                pd.isna(row[rate_col])
            ):
                skipped += 1
                row_error(errors, row_number, "Missing dealer, hen type, kg, or rate")
                continue

            party_name = str(row[party_col]).strip()
            bill_number = get_optional_row_value(row, ["BILL_NO", "BILL NO", "BILL_NUMBER", "BILL NUMBER", "INVOICE_NO", "INVOICE NO"])
            item_type = str(row[item_col]).strip()
            weight = float(row[weight_col])
            rate = float(row[rate_col])
            quantity = Decimal(str(float(row[quantity_col]))) if quantity_col and not pd.isna(row[quantity_col]) else None
            date = resolve_upload_date(row, date_col, fallback_date)
            if not date:
                skipped += 1
                row_error(errors, row_number, "Invalid or missing date")
                continue

            if weight <= 0 or rate <= 0 or (quantity is not None and quantity < 0):
                skipped += 1
                row_error(errors, row_number, "NAG cannot be negative. KG and rate must be greater than zero")
                continue

            # --- Party mapping ---
            party_id = get_or_create_party(db, party_name, "DEALER", seen_aliases)

            # --- Duplicate check (CORRECT TYPE) ---
            existing_txn = db.query(models.Transaction).filter_by(
                date=date,
                party_id=party_id,
                weight=weight,
                rate=rate,
                type="PURCHASE",
                category=None,
                item_type=item_type,
                bill_number=bill_number
            ).first()

            txn_key = (date, party_id, weight, rate, "PURCHASE", bill_number or "", item_type)

            if existing_txn or txn_key in seen_transactions:
                skipped += 1
                continue

            # --- Create purchase transaction ---
            txn = models.Transaction(
                date=date,
                party_id=party_id,
                type="PURCHASE",
                category=None,
                item_type=item_type,
                quantity=quantity,
                weight=weight,
                rate=rate,
                amount=weight * rate,
                payment_mode="NA",
                bill_number=bill_number
            )

            db.add(txn)
            seen_transactions.add(txn_key)
            inserted += 1

        except Exception as e:
            skipped += 1
            row_error(errors, row_number, str(e))
            continue

    # --- Final commit ---
    try:
        if preview:
            db.rollback()
            return upload_result(inserted, skipped, errors, {"preview_mode": True})

        file_record = models.UploadedFile(
            file_hash=file_hash,
            file_type="dealer"
        )
        db.add(file_record)
        db.commit()

    except Exception as e:
        db.rollback()
        return {"error": "Transaction failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/upload/payment")
def upload_payment(file: UploadFile = File(...), preview: bool = False, input_date: str = None, db: Session = Depends(get_db)):

    import io
    import hashlib

    filename = (file.filename or "").lower()
    contents = file.file.read()
    file_hash = hashlib.sha256(contents).hexdigest()

    existing_file = db.query(models.UploadedFile).filter_by(file_hash=file_hash).first()
    if existing_file:
        return {"error": "File already uploaded"}

    try:
        if filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")
        elif filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(contents), engine="xlrd")
        elif filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8")
        else:
            return {"error": "Unsupported file format"}
    except Exception as e:
        return {"error": f"File read failed: {str(e)}"}

    if df.empty:
        return {"error": "File is empty"}

    df.columns = df.columns.str.strip().str.upper()

    date_col = "DATE" if "DATE" in df.columns else None
    required_cols = ["PARTY", "AMOUNT", "PAYMENT_MODE", "DIRECTION"]
    for col in required_cols:
        if col not in df.columns:
            return {"error": f"Missing column: {col}"}

    try:
        df["AMOUNT"] = df["AMOUNT"].astype(float)
    except Exception:
        return {"error": "Invalid amount values"}

    fallback_date = parse_input_date(input_date) if input_date else None
    if not date_col and not fallback_date:
        return {"error": "Provide DATE column in file or select the upload date in the app"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_payments = set()

    for index, row in df.iterrows():
        row_number = int(index) + 2
        try:
            if pd.isna(row["PARTY"]) or pd.isna(row["AMOUNT"]) or pd.isna(row["DIRECTION"]):
                skipped += 1
                row_error(errors, row_number, "Missing party, amount, or direction")
                continue

            party_name = str(row["PARTY"]).strip()
            amount = Decimal(str(float(row["AMOUNT"])))
            target_date = resolve_upload_date(row, date_col, fallback_date)
            if not target_date:
                skipped += 1
                row_error(errors, row_number, "Invalid or missing date")
                continue
            payment_mode = str(row["PAYMENT_MODE"]).strip() if not pd.isna(row["PAYMENT_MODE"]) else "NA"
            direction = normalize_payment_direction(row["DIRECTION"])

            if not party_name or amount <= 0 or not direction:
                skipped += 1
                row_error(errors, row_number, "Invalid party, amount, or payment direction")
                continue

            party_id = get_or_create_party(db, party_name, "BOTH", seen_aliases)

            existing_payment = db.query(models.Transaction).filter_by(
                date=target_date,
                party_id=party_id,
                type="PAYMENT",
                amount=amount,
                payment_mode=payment_mode,
                category=direction
            ).first()

            payment_key = (target_date, party_id, amount, payment_mode, direction)
            if existing_payment or payment_key in seen_payments:
                skipped += 1
                continue

            txn = models.Transaction(
                date=target_date,
                party_id=party_id,
                type="PAYMENT",
                category=direction,
                amount=amount,
                payment_mode=payment_mode
            )

            db.add(txn)
            seen_payments.add(payment_key)
            inserted += 1

        except Exception as e:
            skipped += 1
            row_error(errors, row_number, str(e))
            continue

    try:
        if preview:
            db.rollback()
            return upload_result(inserted, skipped, errors, {"preview_mode": True})

        file_record = models.UploadedFile(
            file_hash=file_hash,
            file_type="payment"
        )
        db.add(file_record)
        db.commit()

    except Exception as e:
        db.rollback()
        return {"error": "Transaction failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/upload/opening-balance")
def upload_opening_balance(file: UploadFile = File(...), preview: bool = False, db: Session = Depends(get_db)):

    import io
    import hashlib

    filename = (file.filename or "").lower()
    contents = file.file.read()
    file_hash = hashlib.sha256(contents).hexdigest()

    existing_file = db.query(models.UploadedFile).filter_by(file_hash=file_hash).first()
    if existing_file:
        return {"error": "File already uploaded"}

    try:
        if filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")
        elif filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(contents), engine="xlrd")
        elif filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8")
        else:
            return {"error": "Unsupported file format"}
    except Exception as e:
        return {"error": f"File read failed: {str(e)}"}

    if df.empty:
        return {"error": "File is empty"}

    df.columns = df.columns.str.strip().str.upper()

    date_col, error = require_column(df, ["DATE"], "DATE")
    if error:
        return error

    party_col, error = require_column(df, ["PARTY", "NAME", "VENDOR", "DEALER"], "PARTY")
    if error:
        return error

    amount_col, error = require_column(df, ["OPENING_BALANCE", "OPENING BALANCE", "AMOUNT", "BALANCE"], "OPENING BALANCE")
    if error:
        return error

    balance_type_col, error = require_column(df, ["BALANCE_TYPE", "BALANCE TYPE", "TYPE"], "BALANCE TYPE")
    if error:
        return error

    try:
        df[amount_col] = df[amount_col].astype(float)
    except Exception:
        return {"error": "Invalid opening balance values"}

    inserted = 0
    skipped = 0
    errors = []
    seen_aliases = {}
    seen_opening = set()

    for index, row in df.iterrows():
        row_number = int(index) + 2
        try:
            if pd.isna(row[party_col]) or pd.isna(row[amount_col]) or pd.isna(row[balance_type_col]):
                skipped += 1
                row_error(errors, row_number, "Missing party, opening balance, or balance type")
                continue

            party_name = str(row[party_col]).strip()
            amount = Decimal(str(float(row[amount_col])))
            target_date = pd.to_datetime(row[date_col], dayfirst=True).date()
            balance_type = str(row[balance_type_col]).strip().upper()

            if balance_type in ["RECEIVABLE", "RECEIVE", "CUSTOMER", "VENDOR"]:
                balance_type = "RECEIVABLE"
                party_type = "VENDOR"
            elif balance_type in ["PAYABLE", "PAY", "SUPPLIER", "DEALER"]:
                balance_type = "PAYABLE"
                party_type = "DEALER"
            else:
                skipped += 1
                row_error(errors, row_number, "Balance type must be RECEIVABLE or PAYABLE")
                continue

            if not party_name or amount < 0:
                skipped += 1
                row_error(errors, row_number, "Invalid party or opening balance")
                continue

            party_id = get_or_create_party(db, party_name, party_type, seen_aliases)

            existing_opening = db.query(models.Transaction).filter_by(
                date=target_date,
                party_id=party_id,
                type="OPENING",
                category=balance_type
            ).first()

            opening_key = (target_date, party_id, balance_type)
            if existing_opening or opening_key in seen_opening:
                skipped += 1
                continue

            txn = models.Transaction(
                date=target_date,
                party_id=party_id,
                type="OPENING",
                category=balance_type,
                amount=amount,
                payment_mode="NA"
            )

            db.add(txn)
            seen_opening.add(opening_key)
            inserted += 1

        except Exception as e:
            skipped += 1
            row_error(errors, row_number, str(e))
            continue

    try:
        if preview:
            db.rollback()
            return upload_result(inserted, skipped, errors, {"preview_mode": True})

        file_record = models.UploadedFile(
            file_hash=file_hash,
            file_type="opening_balance"
        )
        db.add(file_record)
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Transaction failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/upload/opening-stock")
def upload_opening_stock(file: UploadFile = File(...), preview: bool = False, db: Session = Depends(get_db)):

    import io
    import hashlib

    filename = (file.filename or "").lower()
    contents = file.file.read()
    file_hash = hashlib.sha256(contents).hexdigest()

    existing_file = db.query(models.UploadedFile).filter_by(file_hash=file_hash).first()
    if existing_file:
        return {"error": "File already uploaded"}

    try:
        if filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")
        elif filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(contents), engine="xlrd")
        elif filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8")
        else:
            return {"error": "Unsupported file format"}
    except Exception as e:
        return {"error": f"File read failed: {str(e)}"}

    if df.empty:
        return {"error": "File is empty"}

    df.columns = df.columns.str.strip().str.upper()

    date_col, error = require_column(df, ["DATE"], "DATE")
    if error:
        return error

    item_col, error = require_column(df, ["HEN_TYPE", "HEN TYPE", "ITEM", "TYPE"], "HEN TYPE")
    if error:
        return error

    weight_col, error = require_column(df, ["OPENING_KGS", "OPENING KGS", "KGS", "KG", "WEIGHT"], "OPENING KGS")
    if error:
        return error

    quantity_col = get_first_existing_column(df, ["OPENING_NAG", "OPENING QTY", "NAG", "QTY", "QUANTITY", "PCS", "PIECES"])

    try:
        df[weight_col] = df[weight_col].astype(float)
        if quantity_col:
            df[quantity_col] = df[quantity_col].astype(float)
    except Exception:
        return {"error": "Invalid opening stock values"}

    inserted = 0
    skipped = 0
    errors = []
    seen_stock = set()

    for index, row in df.iterrows():
        row_number = int(index) + 2
        try:
            if pd.isna(row[item_col]) or pd.isna(row[weight_col]):
                skipped += 1
                row_error(errors, row_number, "Missing hen type or opening kg")
                continue

            target_date = pd.to_datetime(row[date_col], dayfirst=True).date()
            item_type = str(row[item_col]).strip()
            opening_weight = Decimal(str(float(row[weight_col])))
            opening_quantity = Decimal(str(float(row[quantity_col]))) if quantity_col and not pd.isna(row[quantity_col]) else None

            if not item_type or opening_weight < 0 or (opening_quantity is not None and opening_quantity < 0):
                skipped += 1
                row_error(errors, row_number, "Invalid hen type, opening kg, or opening NAG")
                continue

            existing_stock = db.query(models.ItemOpeningStock).filter_by(
                date=target_date,
                item_type=item_type
            ).first()

            stock_key = (target_date, item_type)
            if existing_stock or stock_key in seen_stock:
                skipped += 1
                continue

            db.add(models.ItemOpeningStock(
                date=target_date,
                item_type=item_type,
                opening_quantity=opening_quantity,
                opening_weight=opening_weight
            ))
            seen_stock.add(stock_key)
            inserted += 1

        except Exception as e:
            skipped += 1
            row_error(errors, row_number, str(e))
            continue

    try:
        if preview:
            db.rollback()
            return upload_result(inserted, skipped, errors, {"preview_mode": True})

        file_record = models.UploadedFile(
            file_hash=file_hash,
            file_type="opening_stock"
        )
        db.add(file_record)
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Transaction failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.post("/process-day")
def process_day(input_date: str, actual_stock: float, db: Session = Depends(get_db)):

    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Invalid date format"}

    # --- Validate stock ---
    if actual_stock is None or actual_stock < 0:
        return {"error": "Invalid actual stock"}

    # --- Prevent duplicate processing ---
    existing = db.query(models.DailyStock).filter_by(date=target_date).first()
    if existing:
        return {"error": "Day already processed"}

    try:
        # --- Get previous day's closing ---
        prev_stock = db.query(models.DailyStock).filter(
            models.DailyStock.date < target_date
        ).order_by(models.DailyStock.date.desc()).first()

        opening_stock = Decimal(str(prev_stock.actual_closing_weight)) if prev_stock else Decimal("0")

        # --- Total purchases ---
        purchase_weight = db.query(func.sum(models.Transaction.weight)).filter(
            models.Transaction.date == target_date,
            models.Transaction.type == "PURCHASE"
        ).scalar() or 0

        # --- Total sales ---
        sales_weight = db.query(func.sum(models.Transaction.weight)).filter(
            models.Transaction.date == target_date,
            models.Transaction.type == "SALE"
        ).scalar() or 0

        purchase_weight = Decimal(str(purchase_weight))
        sales_weight = Decimal(str(sales_weight))

        # --- Expected stock ---
        expected_stock = opening_stock + purchase_weight - sales_weight

        # --- Leakage ---
        actual_stock_dec = Decimal(str(actual_stock))
        leakage = expected_stock - actual_stock_dec

        # --- Save ---
        daily = models.DailyStock(
            date=target_date,
            opening_weight=opening_stock,
            purchase_weight=purchase_weight,
            sales_weight=sales_weight,
            expected_closing_weight=expected_stock,
            actual_closing_weight=actual_stock_dec,
            leakage=leakage
        )

        db.add(daily)
        db.commit()

    except Exception as e:
        db.rollback()
        return {"error": "Processing failed", "details": str(e)}

    return {
        "date": str(target_date),
        "opening_stock": float(opening_stock),
        "purchase": float(purchase_weight),
        "sales": float(sales_weight),
        "expected_stock": float(expected_stock),
        "actual_stock": float(actual_stock_dec),
        "leakage": float(leakage)
    }


@app.post("/process-day/items")
def process_day_items(input_date: str, actual_stock: list[dict], db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Invalid date format"}

    if not actual_stock:
        return {"error": "Enter actual stock for at least one hen type"}

    normalized_actuals = {}
    for row in actual_stock:
        item = str(row.get("item_type", "")).strip()
        try:
            actual_weight = Decimal(str(row.get("actual_weight", "")))
        except Exception:
            return {"error": f"Invalid actual stock for {item or 'item'}"}

        actual_quantity_raw = row.get("actual_quantity")
        try:
            actual_quantity = Decimal(str(actual_quantity_raw)) if actual_quantity_raw not in [None, ""] else None
        except Exception:
            return {"error": f"Invalid actual NAG for {item or 'item'}"}

        if not item or actual_weight < 0 or (actual_quantity is not None and actual_quantity < 0):
            return {"error": "Invalid hen type, actual stock, or actual NAG"}

        normalized_actuals[item] = {
            "actual_weight": actual_weight,
            "actual_quantity": actual_quantity
        }

    expected_items = set()
    latest_previous_stock = {}
    for row in db.query(models.DailyItemStock).filter(
        models.DailyItemStock.date < target_date
    ).order_by(
        models.DailyItemStock.item_type.asc(),
        models.DailyItemStock.date.desc()
    ).all():
        latest_previous_stock.setdefault(row.item_type, row)

    for item_type, row in latest_previous_stock.items():
        if Decimal(row.actual_closing_weight or 0) > 0 or Decimal(row.actual_closing_quantity or 0) > 0:
            expected_items.add(item_type)

    latest_openings = {}
    for row in db.query(models.ItemOpeningStock).filter(
        models.ItemOpeningStock.date <= target_date
    ).order_by(
        models.ItemOpeningStock.item_type.asc(),
        models.ItemOpeningStock.date.desc()
    ).all():
        latest_openings.setdefault(row.item_type, row)

    for item_type, row in latest_openings.items():
        if Decimal(row.opening_weight or 0) > 0 or Decimal(row.opening_quantity or 0) > 0:
            expected_items.add(item_type)

    for row in db.query(models.Transaction.item_type).filter(
        models.Transaction.date == target_date,
        models.Transaction.type.in_(["PURCHASE", "SALE"]),
        models.Transaction.item_type.isnot(None)
    ).distinct().all():
        if row.item_type:
            expected_items.add(row.item_type)

    missing_items = sorted(item for item in expected_items if item not in normalized_actuals)
    if missing_items:
        return {"error": f"Enter actual stock for all tracked hen types. Missing: {', '.join(missing_items[:8])}"}

    existing = db.query(models.DailyItemStock).filter(
        models.DailyItemStock.date == target_date,
        models.DailyItemStock.item_type.in_(list(normalized_actuals.keys()))
    ).first()
    if existing:
        return {"error": "One or more hen types already processed for this day"}

    results = []

    try:
        for item_type, actuals in normalized_actuals.items():
            actual_weight = actuals["actual_weight"]
            actual_quantity = actuals["actual_quantity"]
            prev_stock = db.query(models.DailyItemStock).filter(
                models.DailyItemStock.item_type == item_type,
                models.DailyItemStock.date < target_date
            ).order_by(models.DailyItemStock.date.desc()).first()

            if prev_stock:
                opening_weight = Decimal(prev_stock.actual_closing_weight or 0)
                opening_quantity = Decimal(prev_stock.actual_closing_quantity or 0) if prev_stock.actual_closing_quantity is not None else None
            else:
                opening = db.query(models.ItemOpeningStock).filter(
                    models.ItemOpeningStock.item_type == item_type,
                    models.ItemOpeningStock.date <= target_date
                ).order_by(models.ItemOpeningStock.date.desc()).first()
                opening_weight = Decimal(opening.opening_weight or 0) if opening else Decimal("0")
                opening_quantity = Decimal(opening.opening_quantity or 0) if opening and opening.opening_quantity is not None else None

            purchase_weight = db.query(func.sum(models.Transaction.weight)).filter(
                models.Transaction.date == target_date,
                models.Transaction.item_type == item_type,
                models.Transaction.type == "PURCHASE"
            ).scalar() or 0
            purchase_quantity_raw = db.query(func.sum(models.Transaction.quantity)).filter(
                models.Transaction.date == target_date,
                models.Transaction.item_type == item_type,
                models.Transaction.type == "PURCHASE"
            ).scalar()

            sales_weight = db.query(func.sum(models.Transaction.weight)).filter(
                models.Transaction.date == target_date,
                models.Transaction.item_type == item_type,
                models.Transaction.type == "SALE"
            ).scalar() or 0
            sales_quantity_raw = db.query(func.sum(models.Transaction.quantity)).filter(
                models.Transaction.date == target_date,
                models.Transaction.item_type == item_type,
                models.Transaction.type == "SALE"
            ).scalar()

            purchase_weight = Decimal(str(purchase_weight))
            sales_weight = Decimal(str(sales_weight))
            purchase_quantity = Decimal(purchase_quantity_raw or 0) if purchase_quantity_raw is not None else None
            sales_quantity = Decimal(sales_quantity_raw or 0) if sales_quantity_raw is not None else None
            expected_stock = opening_weight + purchase_weight - sales_weight
            expected_quantity = None
            if any(value is not None for value in [opening_quantity, purchase_quantity, sales_quantity]):
                expected_quantity = Decimal(opening_quantity or 0) + Decimal(purchase_quantity or 0) - Decimal(sales_quantity or 0)
            leakage = expected_stock - actual_weight
            quantity_leakage = None
            if expected_quantity is not None or actual_quantity is not None:
                quantity_leakage = Decimal(expected_quantity or 0) - Decimal(actual_quantity or 0)

            daily = models.DailyItemStock(
                date=target_date,
                item_type=item_type,
                opening_quantity=opening_quantity,
                opening_weight=opening_weight,
                purchase_quantity=purchase_quantity,
                purchase_weight=purchase_weight,
                sales_quantity=sales_quantity,
                sales_weight=sales_weight,
                expected_closing_quantity=expected_quantity,
                expected_closing_weight=expected_stock,
                actual_closing_quantity=actual_quantity,
                actual_closing_weight=actual_weight,
                quantity_leakage=quantity_leakage,
                leakage=leakage
            )
            db.add(daily)

            results.append({
                "date": str(target_date),
                "item": item_type,
                "opening_nag": optional_float(opening_quantity),
                "opening_stock": float(opening_weight),
                "purchase_nag": optional_float(purchase_quantity),
                "purchase": float(purchase_weight),
                "sales_nag": optional_float(sales_quantity),
                "sales": float(sales_weight),
                "expected_nag": optional_float(expected_quantity),
                "expected_stock": float(expected_stock),
                "actual_nag": optional_float(actual_quantity),
                "actual_stock": float(actual_weight),
                "quantity_leakage": optional_float(quantity_leakage),
                "leakage": float(leakage)
            })

        total_opening_weight = sum(Decimal(str(row["opening_stock"])) for row in results)
        total_purchase_weight = sum(Decimal(str(row["purchase"])) for row in results)
        total_sales_weight = sum(Decimal(str(row["sales"])) for row in results)
        total_expected_weight = sum(Decimal(str(row["expected_stock"])) for row in results)
        total_actual_weight = sum(Decimal(str(row["actual_stock"])) for row in results)
        total_leakage_weight = sum(Decimal(str(row["leakage"])) for row in results)

        daily_stock = db.query(models.DailyStock).filter(
            models.DailyStock.date == target_date
        ).first()
        if daily_stock:
            daily_stock.opening_weight = total_opening_weight
            daily_stock.purchase_weight = total_purchase_weight
            daily_stock.sales_weight = total_sales_weight
            daily_stock.expected_closing_weight = total_expected_weight
            daily_stock.actual_closing_weight = total_actual_weight
            daily_stock.leakage = total_leakage_weight
        else:
            db.add(models.DailyStock(
                date=target_date,
                opening_weight=total_opening_weight,
                purchase_weight=total_purchase_weight,
                sales_weight=total_sales_weight,
                expected_closing_weight=total_expected_weight,
                actual_closing_weight=total_actual_weight,
                leakage=total_leakage_weight
            ))

        db.commit()

    except Exception as e:
        db.rollback()
        return {"error": "Processing failed", "details": str(e)}

    return {
        "status": "success",
        "date": str(target_date),
        "items": results,
        "total_expected_nag": float(optional_decimal_sum(row["expected_nag"] for row in results) or 0),
        "total_expected_stock": sum(row["expected_stock"] for row in results),
        "total_actual_nag": float(optional_decimal_sum(row["actual_nag"] for row in results) or 0),
        "total_actual_stock": sum(row["actual_stock"] for row in results),
        "total_quantity_leakage": float(optional_decimal_sum(row["quantity_leakage"] for row in results) or 0),
        "total_leakage": sum(row["leakage"] for row in results)
    }


@app.get("/party/{party_id}/ledger")
def get_party_ledger(
    party_id: UUID,
    start_date: str | None = None,
    end_date: str | None = None,
    db: Session = Depends(get_db)
):

    # --- Validate party ---
    party = db.query(models.Party).filter_by(id=party_id).first()
    if not party:
        return {"error": "Party not found"}

    query = db.query(models.Transaction).filter_by(party_id=party_id)

    if start_date:
        start = parse_input_date(start_date)
        if not start:
            return {"error": "Invalid start date"}
        query = query.filter(models.Transaction.date >= start)

    if end_date:
        end = parse_input_date(end_date)
        if not end:
            return {"error": "Invalid end date"}
        query = query.filter(models.Transaction.date <= end)

    # --- Fetch transactions ---
    txns = query.order_by(models.Transaction.date.asc()).all()
    txns = filter_party_ledger_transactions(db, txns)

    if not txns:
        return {
            "party_id": party_id,
            "party_name": party.name,
            "total_balance": 0,
            "summary": build_party_summary([], Decimal("0")),
            "ledger": []
        }

    balance, ledger = build_ledger(txns)

    return {
        "party_id": party_id,
        "party_name": party.name,
        "total_balance": float(balance),
        "summary": build_party_summary(txns, balance),
        "ledger": ledger
    }

@app.get("/party/search")
def search_party(name: str, db: Session = Depends(get_db)):

    if not name or len(name.strip()) < 2:
        return {"results": []}

    normalized = normalize_party_name(name)

    # --- Search aliases (limited for performance) ---
    aliases = db.query(models.PartyAlias).filter(
        models.PartyAlias.normalized_alias.contains(normalized)
    ).limit(10).all()

    if not aliases:
        return {"results": []}

    party_ids = list(set([a.party_id for a in aliases]))

    parties = db.query(models.Party).filter(
        models.Party.id.in_(party_ids)
    ).all()

    # --- Sort by name (better UX) ---
    parties = sorted(parties, key=lambda x: x.name)

    return {
        "results": [
            {
                "id": str(p.id),
                "name": p.name,
                "type": p.type,
                "phone": p.phone or "",
                "address": p.address or ""
            }
            for p in parties
        ]
    }


@app.get("/party/profile")
def get_party_profile(name: str, db: Session = Depends(get_db)):
    if not name or len(name.strip()) < 2:
        return {"error": "Invalid party name"}

    party = get_party_by_name(db, name)
    if not party:
        return {"error": "Party not found"}

    txns = db.query(models.Transaction).filter(
        models.Transaction.party_id == party.id
    ).order_by(
        models.Transaction.date.asc(),
        models.Transaction.created_at.asc()
    ).all()
    balance_after, _ = build_ledger(txns)

    return {
        "party": {
            "id": str(party.id),
            "name": party.name,
            "type": party.type or "",
            "phone": party.phone or "",
            "address": party.address or "",
            "balance_after": float(balance_after or 0)
        }
    }


@app.get("/party-directory")
def list_party_directory(name: str | None = None, db: Session = Depends(get_db)):
    query = db.query(models.Party)
    if name and len(name.strip()) >= 2:
        normalized = normalize_party_name(name)
        query = query.filter(
            or_(
                models.Party.normalized_name.contains(normalized),
                func.lower(models.Party.name).contains(name.strip().lower())
            )
        )

    parties = query.order_by(models.Party.name.asc()).limit(500).all()
    return {
        "results": [
            {
                "id": str(p.id),
                "name": p.name,
                "type": p.type or "",
                "phone": p.phone or "",
                "address": p.address or ""
            }
            for p in parties
        ]
    }


@app.post("/party-directory")
def save_party_directory(payload: dict = Body(...), db: Session = Depends(get_db)):
    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one party"}

    inserted = 0
    updated = 0
    skipped = 0
    errors = []

    for index, row in enumerate(rows, start=1):
        try:
            party_name = str(row.get("name") or row.get("party") or "").strip()
            party_type = str(row.get("type") or "BOTH").strip().upper() or "BOTH"
            phone = str(row.get("phone") or "").strip()
            address = str(row.get("address") or "").strip()

            if not party_name:
                skipped += 1
                row_error(errors, index, "Enter party name")
                continue

            party = get_party_by_name(db, party_name)
            if party:
                had_details = bool((party.phone or "").strip() or (party.address or "").strip())
                update_party_details(party, party_type, phone, address)
                if party.name != party_name:
                    party.name = party_name
                updated += 1 if had_details or phone or address or party_type else 0
            else:
                get_or_create_party(db, party_name, party_type, {}, phone=phone, address=address)
                inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving party directory failed", "details": str(e)}

    return {
        "status": "success",
        "rows_inserted": inserted,
        "rows_updated": updated,
        "rows_skipped": skipped,
        "errors": errors
    }


@app.get("/party/ledger")
def get_ledger_by_name(
    name: str,
    start_date: str | None = None,
    end_date: str | None = None,
    db: Session = Depends(get_db)
):
    if not name or len(name.strip()) < 2:
        return {"error": "Invalid party name"}

    normalized = normalize_party_name(name)

    # --- Step 1: Try EXACT match first (important) ---
    alias = db.query(models.PartyAlias).filter(
        models.PartyAlias.normalized_alias == normalized
    ).first()

    if alias:
        party_ids = [alias.party_id]
    else:
        # --- Step 2: Fuzzy match (limited results) ---
        aliases = db.query(models.PartyAlias).filter(
            models.PartyAlias.normalized_alias.contains(normalized)
        ).limit(10).all()

        if not aliases:
            return {"error": "Party not found"}

        party_ids = list(set([a.party_id for a in aliases]))

    # --- Step 3: Multiple matches ---
    if len(party_ids) > 1:
        parties = db.query(models.Party).filter(
            models.Party.id.in_(party_ids)
        ).all()

        return {
            "multiple_matches": True,
            "results": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "type": p.type
                }
                for p in parties
            ]
        }

    # --- Step 4: Single match → ledger ---
    party_id = party_ids[0]

    query = db.query(models.Transaction).filter(
        models.Transaction.party_id == party_id
    )

    if start_date:
        start = parse_input_date(start_date)
        if not start:
            return {"error": "Invalid start date"}
        query = query.filter(models.Transaction.date >= start)

    if end_date:
        end = parse_input_date(end_date)
        if not end:
            return {"error": "Invalid end date"}
        query = query.filter(models.Transaction.date <= end)

    party = db.query(models.Party).filter_by(id=party_id).first()
    txns = query.order_by(models.Transaction.date.asc()).all()
    txns = filter_party_ledger_transactions(db, txns)

    if not txns:
        return {
            "party_name": party.name if party else name,
            "total_balance": 0,
            "summary": build_party_summary([], Decimal("0")),
            "ledger": []
        }

    balance, ledger = build_ledger(txns)

    return {
        "party_name": party.name if party else name,
        "total_balance": float(balance),
        "summary": build_party_summary(txns, balance),
        "ledger": ledger
    }


@app.get("/party/detail")
def get_party_detail(name: str, db: Session = Depends(get_db)):
    if not name or len(name.strip()) < 2:
        return {"error": "Invalid party name"}

    normalized = normalize_party_name(name)
    alias = db.query(models.PartyAlias).filter(
        models.PartyAlias.normalized_alias == normalized
    ).first()

    if not alias:
        alias = db.query(models.PartyAlias).filter(
            models.PartyAlias.normalized_alias.contains(normalized)
        ).first()

    if not alias:
        return {"error": "Party not found"}

    party = db.query(models.Party).filter_by(id=alias.party_id).first()
    if not party:
        return {"error": "Party not found"}

    txns = db.query(models.Transaction).filter_by(
        party_id=party.id
    ).order_by(models.Transaction.date.asc()).all()
    txns = filter_party_ledger_transactions(db, txns)

    balance, ledger = build_ledger(txns)

    return {
        "party": {
            "id": str(party.id),
            "name": party.name,
            "type": party.type,
            "phone": party.phone or "",
            "address": party.address or ""
        },
        "summary": build_party_summary(txns, balance),
        "ledger": ledger
    }


@app.get("/reports/export")
def export_report(
    report_type: str,
    file_format: str = "excel",
    party: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    date: str | None = None,
    db: Session = Depends(get_db)
):
    report_type = report_type.lower().strip()
    file_format = file_format.lower().strip()
    start, end = parse_report_dates(start_date, end_date)

    if (start_date and not start) or (end_date and not end):
        return {"error": "Invalid date format"}

    if report_type == "ledger":
        if not party or len(party.strip()) < 2:
            return {"error": "Party name is required for ledger report"}

        normalized = normalize_party_name(party)
        alias = db.query(models.PartyAlias).filter(
            models.PartyAlias.normalized_alias == normalized
        ).first()

        if not alias:
            alias = db.query(models.PartyAlias).filter(
                models.PartyAlias.normalized_alias.contains(normalized)
            ).first()

        if not alias:
            return {"error": "Party not found"}

        party_row = db.query(models.Party).filter_by(id=alias.party_id).first()
        query = db.query(models.Transaction).filter(models.Transaction.party_id == alias.party_id)

        if start:
            query = query.filter(models.Transaction.date >= start)
        if end:
            query = query.filter(models.Transaction.date <= end)

        txns = query.order_by(models.Transaction.date.asc()).all()
        txns = filter_party_ledger_transactions(db, txns)
        balance, ledger = build_ledger(txns)
        rows = [
            {
                "Party": party_row.name if party_row else party,
                "Date": row["date"],
                "Type": row["type"],
                "Bill No": row.get("bill_number", ""),
                "Category": row["category"],
                "Item": row["item"],
                "NAG": row.get("quantity", 0),
                "KGS": row.get("weight", 0),
                "Rate": row.get("rate", 0),
                "Mode": row["payment_mode"],
                "Amount": row["amount"],
                "Balance": row["balance"]
            }
            for row in ledger
        ]
        rows.append({
            "Party": party_row.name if party_row else party,
            "Date": "",
            "Type": "TOTAL",
            "Bill No": "",
            "Category": "",
            "Item": "",
            "NAG": "",
            "KGS": "",
            "Rate": "",
            "Mode": "",
            "Amount": "",
            "Balance": float(balance)
        })
        columns = ["Party", "Date", "Type", "Bill No", "Category", "Item", "NAG", "KGS", "Rate", "Mode", "Amount", "Balance"]
        filename = safe_filename(f"ledger_{party}")
        return report_response(rows, columns, filename, file_format, f"Ledger Report - {party}")

    if report_type == "summary":
        query = db.query(models.Transaction)
        if start:
            query = query.filter(models.Transaction.date >= start)
        if end:
            query = query.filter(models.Transaction.date <= end)

        txns = query.order_by(models.Transaction.date.asc()).all()
        by_date = {}
        for txn in txns:
            key = str(txn.date)
            by_date.setdefault(key, {
                "Date": key,
                "Sales": Decimal("0"),
                "Purchase": Decimal("0"),
                "Payment Received": Decimal("0"),
                "Payment Paid": Decimal("0"),
                "Opening": Decimal("0")
            })

            amount = Decimal(txn.amount or 0)
            if txn.type == "SALE":
                by_date[key]["Sales"] += amount
            elif txn.type == "PURCHASE":
                by_date[key]["Purchase"] += amount
            elif txn.type == "PAYMENT" and txn.category == "RECEIVED":
                by_date[key]["Payment Received"] += amount
            elif txn.type == "PAYMENT" and txn.category == "PAID":
                by_date[key]["Payment Paid"] += amount
            elif txn.type == "OPENING":
                by_date[key]["Opening"] += amount

        rows = []
        for row in by_date.values():
            sales = row["Sales"]
            purchase = row["Purchase"]
            rows.append({
                "Date": row["Date"],
                "Sales": float(sales),
                "Purchase": float(purchase),
                "Profit": float(sales - purchase),
                "Payment Received": float(row["Payment Received"]),
                "Payment Paid": float(row["Payment Paid"]),
                "Opening": float(row["Opening"])
            })

        columns = ["Date", "Sales", "Purchase", "Profit", "Payment Received", "Payment Paid", "Opening"]
        return report_response(rows, columns, "financial_summary", file_format, "Financial Summary")

    if report_type == "outstanding":
        rows = []
        parties = db.query(models.Party).order_by(models.Party.name.asc()).all()

        for party_row in parties:
            query = db.query(models.Transaction).filter_by(party_id=party_row.id)
            if start:
                query = query.filter(models.Transaction.date >= start)
            if end:
                query = query.filter(models.Transaction.date <= end)
            txns = query.all()
            receivable = sum(receivable_delta(t) for t in txns)
            payable = sum(payable_delta(t) for t in txns)

            if receivable or payable:
                rows.append({
                    "Party": party_row.name,
                    "Type": party_row.type or "",
                    "Receivable": float(receivable),
                    "Payable": float(payable),
                    "Net Outstanding": float(receivable - payable)
                })

        columns = ["Party", "Type", "Receivable", "Payable", "Net Outstanding"]
        return report_response(rows, columns, "outstanding_balances", file_format, "Outstanding Balances")

    if report_type == "inventory":
        target = parse_input_date(date) if date else pd.Timestamp.today().date()
        if date and not target:
            return {"error": "Invalid date format"}

        rows = []
        items = stock_item_names_query(db)

        for item in sorted(items):
            processed = db.query(models.DailyItemStock).filter_by(
                date=target,
                item_type=item
            ).first()

            if processed:
                rows.append({
                    "Date": str(processed.date),
                    "Item": processed.item_type,
                    "Opening Kg": float(processed.opening_weight or 0),
                    "Purchase Kg": float(processed.purchase_weight or 0),
                    "Sales Kg": float(processed.sales_weight or 0),
                    "Expected Kg": float(processed.expected_closing_weight or 0),
                    "Actual Kg": float(processed.actual_closing_weight or 0),
                    "Leakage Kg": float(processed.leakage or 0)
                })
                continue

            opening = db.query(models.ItemOpeningStock).filter(
                models.ItemOpeningStock.item_type == item,
                models.ItemOpeningStock.date <= target
            ).order_by(models.ItemOpeningStock.date.desc()).first()

            opening_date = opening.date if opening else None
            opening_weight = Decimal(opening.opening_weight or 0) if opening else Decimal("0")
            query = db.query(models.Transaction).filter(
                models.Transaction.item_type == item,
                models.Transaction.date <= target
            )

            if opening_date:
                query = query.filter(models.Transaction.date >= opening_date)

            txns = query.all()
            purchase_weight = sum(Decimal(t.weight or 0) for t in txns if t.type == "PURCHASE")
            sales_weight = sum(Decimal(t.weight or 0) for t in txns if t.type == "SALE")
            expected = opening_weight + purchase_weight - sales_weight

            rows.append({
                "Date": str(target),
                "Item": item,
                "Opening Kg": float(opening_weight),
                "Purchase Kg": float(purchase_weight),
                "Sales Kg": float(sales_weight),
                "Expected Kg": float(expected),
                "Actual Kg": "",
                "Leakage Kg": ""
            })

        columns = ["Date", "Item", "Opening Kg", "Purchase Kg", "Sales Kg", "Expected Kg", "Actual Kg", "Leakage Kg"]
        return report_response(rows, columns, f"inventory_{target}", file_format, f"Inventory Report - {target}")

    if report_type == "transactions":
        query = db.query(models.Transaction, models.Party).outerjoin(
            models.Party,
            models.Transaction.party_id == models.Party.id
        )
        if start:
            query = query.filter(models.Transaction.date >= start)
        if end:
            query = query.filter(models.Transaction.date <= end)
        if party and len(party.strip()) >= 2:
            normalized = normalize_party_name(party)
            aliases = db.query(models.PartyAlias).filter(
                models.PartyAlias.normalized_alias.contains(normalized)
            ).all()
            party_ids = [alias.party_id for alias in aliases]
            query = query.filter(models.Transaction.party_id.in_(party_ids))

        rows = []
        for txn, party_row in query.order_by(models.Transaction.date.asc()).all():
            rows.append({
                "Date": str(txn.date),
                "Party": party_row.name if party_row else (txn.category.title() if txn.category else "Walk-in Customer"),
                "Party Type": party_row.type if party_row else ("RETAIL" if txn.type == "SALE" else ""),
                "Type": txn.type or "",
                "Category": txn.category or "",
                "Item": txn.item_type or "",
                "Kg": float(txn.weight or 0),
                "Rate": float(txn.rate or 0),
                "Amount": float(txn.amount or 0),
                "Mode": txn.payment_mode or ""
            })

        columns = ["Date", "Party", "Party Type", "Type", "Category", "Item", "Kg", "Rate", "Amount", "Mode"]
        return report_response(rows, columns, "transactions", file_format, "Transaction Report")

    return {"error": "Unknown report type"}


@app.get("/dashboard")
def get_dashboard(date: str, db: Session = Depends(get_db)):

    target_date = parse_input_date(date)
    if not target_date:
        return {"error": "Invalid date format"}

    try:
        totals = db.query(
            func.sum(
                case(
                    (models.Transaction.type == "SALE", models.Transaction.amount),
                    else_=0
                )
            ).label("sales"),
            func.sum(
                case(
                    (models.Transaction.type == "PURCHASE", models.Transaction.amount),
                    else_=0
                )
            ).label("purchase"),
            func.sum(receivable_case()).label("receivable"),
            func.sum(payable_case()).label("payable")
        ).filter(
            models.Transaction.date <= target_date
        ).first()

        daily_totals = db.query(
            func.sum(
                case(
                    (models.Transaction.type == "SALE", models.Transaction.amount),
                    else_=0
                )
            ).label("sales"),
            func.sum(
                case(
                    (models.Transaction.type == "PURCHASE", models.Transaction.amount),
                    else_=0
                )
            ).label("purchase")
        ).filter(
            models.Transaction.date == target_date
        ).first()

        daily_operational = db.query(
            func.sum(
                case(
                    (
                        (models.Transaction.type == "SALE") &
                        (models.Transaction.category.in_(["RETAIL", "RETAIL DRESSED"])),
                        models.Transaction.amount
                    ),
                    else_=0
                )
            ).label("retail_sales"),
            func.sum(
                case(
                    (
                        (models.Transaction.type == "SALE") &
                        (models.Transaction.category == "RETAIL DRESSED"),
                        models.Transaction.amount
                    ),
                    else_=0
                )
            ).label("dressed_sales_amount"),
            func.sum(
                case(
                    (
                        (models.Transaction.type == "PAYMENT") &
                        (models.Transaction.category == "RECEIVED"),
                        models.Transaction.amount
                    ),
                    else_=0
                )
            ).label("payments_received"),
            func.sum(
                case(
                    (
                        (models.Transaction.type == "PAYMENT") &
                        (models.Transaction.category == "PAID"),
                        models.Transaction.amount
                    ),
                    else_=0
                )
            ).label("payments_paid"),
            func.sum(
                case(
                    (models.Transaction.type == "MORTALITY", models.Transaction.weight),
                    else_=0
                )
            ).label("mortality_weight"),
            func.sum(
                case(
                    (models.Transaction.type == "MORTALITY", models.Transaction.quantity),
                    else_=0
                )
            ).label("mortality_quantity")
        ).filter(
            models.Transaction.date == target_date
        ).first()

        sales = daily_totals.sales or 0
        purchase = daily_totals.purchase or 0
        receivable = totals.receivable or 0
        payable = totals.payable or 0
        retail_sales = daily_operational.retail_sales or 0
        dressed_sales_amount = daily_operational.dressed_sales_amount or 0
        payments_received = daily_operational.payments_received or 0
        payments_paid = daily_operational.payments_paid or 0
        mortality_weight = daily_operational.mortality_weight or 0
        mortality_quantity = daily_operational.mortality_quantity or 0

        # --- Stock ---
        stock = db.query(models.DailyStock).filter(
            models.DailyStock.date == target_date
        ).first()
        processed_rows = db.query(models.DailyItemStock).filter(
            models.DailyItemStock.date == target_date
        ).count()

        # --- Profit (simple approximation) ---
        profit = float(sales or 0) - float(purchase or 0)

    except Exception as e:
        return {"error": "Dashboard calculation failed", "details": str(e)}

    return {
        "date": str(target_date),

        "purchase": float(purchase or 0),
        "sales": float(sales or 0),
        "profit": profit,

        "expected_stock": float(stock.expected_closing_weight) if stock else 0,
        "actual_stock": float(stock.actual_closing_weight) if stock else 0,
        "leakage": float(stock.leakage) if stock else 0,

        "receivable": float(receivable),
        "payable": float(payable),
        "total_outstanding": float(receivable + payable),
        "retail_sales": float(retail_sales or 0),
        "dressed_sales_amount": float(dressed_sales_amount or 0),
        "payments_received": float(payments_received or 0),
        "payments_paid": float(payments_paid or 0),
        "mortality_weight": float(mortality_weight or 0),
        "mortality_quantity": float(mortality_quantity or 0),
        "processed_items_count": int(processed_rows or 0)
    }


@app.get("/top-debtors")
def top_debtors(start_date: str | None = None, end_date: str | None = None, db: Session = Depends(get_db)):
    start = parse_input_date(start_date) if start_date else None
    end = parse_input_date(end_date) if end_date else None
    if (start_date and not start) or (end_date and not end):
        return {"error": "Invalid date format"}

    balance_expr = func.sum(receivable_case())
    query = db.query(
        models.Party.name,
        balance_expr.label("balance")
    ).join(
        models.Transaction,
        models.Transaction.party_id == models.Party.id
    )

    if start:
        query = query.filter(models.Transaction.date >= start)
    if end:
        query = query.filter(models.Transaction.date <= end)

    rows = query.group_by(
        models.Party.id,
        models.Party.name
    ).having(
        balance_expr > 0
    ).order_by(
        balance_expr.desc()
    ).limit(5).all()

    return {
        "top_debtors": [
            {"party_name": row.name, "balance": float(row.balance or 0)}
            for row in rows
        ]
    }


@app.get("/top-payables")
def top_payables(db: Session = Depends(get_db)):
    balance_expr = func.sum(payable_case())
    rows = db.query(
        models.Party.name,
        balance_expr.label("balance")
    ).join(
        models.Transaction,
        models.Transaction.party_id == models.Party.id
    ).group_by(
        models.Party.id,
        models.Party.name
    ).having(
        balance_expr > 0
    ).order_by(
        balance_expr.desc()
    ).limit(5).all()

    return {
        "top_payables": [
            {"party_name": row.name, "balance": float(row.balance or 0)}
            for row in rows
        ]
    }


@app.get("/analytics/trend")
def get_trend(start_date: str, end_date: str, db: Session = Depends(get_db)):

    start = parse_input_date(start_date)
    end = parse_input_date(end_date)
    if not start or not end:
        return {"error": "Invalid date format"}

    results = db.query(
        models.Transaction.date,
        func.sum(
            case(
                (models.Transaction.type == "SALE", models.Transaction.amount),
                else_=0
            )
        ).label("sales"),
        func.sum(
            case(
                (models.Transaction.type == "PURCHASE", models.Transaction.amount),
                else_=0
            )
        ).label("purchase"),
        func.sum(
            case(
                (
                    (models.Transaction.type == "SALE") &
                    (models.Transaction.category == "RETAIL"),
                    models.Transaction.amount
                ),
                else_=0
            )
        ).label("regular_billing"),
        func.sum(
            case(
                (
                    (models.Transaction.type == "SALE") &
                    (models.Transaction.category == "RETAIL DRESSED"),
                    models.Transaction.amount
                ),
                else_=0
            )
        ).label("dressed_billing")
    ).filter(
        models.Transaction.date.between(start, end)
    ).group_by(models.Transaction.date).order_by(models.Transaction.date).all()

    by_date = {
        r.date: {
            "sales": float(r.sales or 0),
            "purchase": float(r.purchase or 0),
            "regular_billing": float(r.regular_billing or 0),
            "dressed_billing": float(r.dressed_billing or 0)
        }
        for r in results
    }

    trend = []
    for day in pd.date_range(start=start, end=end):
        current_date = day.date()
        row = by_date.get(current_date, {"sales": 0, "purchase": 0, "regular_billing": 0, "dressed_billing": 0})
        trend.append({
            "date": str(current_date),
            "sales": row["sales"],
            "purchase": row["purchase"],
            "profit": row["sales"] - row["purchase"],
            "regular_billing": row["regular_billing"],
            "dressed_billing": row["dressed_billing"]
        })

    return trend

@app.get("/analytics/leakage")
def leakage_trend(start_date: str, end_date: str, db: Session = Depends(get_db)):

    start = parse_input_date(start_date)
    end = parse_input_date(end_date)
    if not start or not end:
        return {"error": "Invalid date format"}

    rows = db.query(models.DailyStock).filter(
        models.DailyStock.date.between(start, end)
    ).order_by(models.DailyStock.date).all()

    return [
        {
            "date": str(r.date),
            "leakage": float(r.leakage or 0)
        }
        for r in rows
    ]


@app.get("/analytics/summary")
def analytics_summary(start_date: str, end_date: str, db: Session = Depends(get_db)):
    start = parse_input_date(start_date)
    end = parse_input_date(end_date)
    if not start or not end:
        return {"error": "Invalid date format"}

    totals = db.query(
        func.sum(
            case(
                (models.Transaction.type == "SALE", models.Transaction.amount),
                else_=0
            )
        ).label("sales"),
        func.sum(
            case(
                (models.Transaction.type == "PURCHASE", models.Transaction.amount),
                else_=0
            )
        ).label("purchase"),
        func.sum(
            case(
                (
                    (models.Transaction.type == "PAYMENT") & (models.Transaction.category == "RECEIVED"),
                    models.Transaction.amount
                ),
                else_=0
            )
        ).label("received"),
        func.sum(
            case(
                (
                    (models.Transaction.type == "PAYMENT") & (models.Transaction.category == "PAID"),
                    models.Transaction.amount
                ),
                else_=0
            )
        ).label("paid")
    ).filter(
        models.Transaction.date.between(start, end)
    ).first()

    sales = Decimal(totals.sales or 0)
    purchase = Decimal(totals.purchase or 0)
    received = Decimal(totals.received or 0)
    paid = Decimal(totals.paid or 0)
    leakage = db.query(func.sum(models.DailyItemStock.leakage)).filter(
        models.DailyItemStock.date.between(start, end)
    ).scalar() or 0

    return {
        "sales": float(sales),
        "purchase": float(purchase),
        "profit": float(sales - purchase),
        "received": float(received),
        "paid": float(paid),
        "net_cash": float(received - paid),
        "leakage": float(leakage)
    }


@app.get("/analytics/item-volume")
def item_volume(start_date: str, end_date: str, db: Session = Depends(get_db)):
    start = parse_input_date(start_date)
    end = parse_input_date(end_date)
    if not start or not end:
        return {"error": "Invalid date format"}

    rows = db.query(
        models.Transaction.item_type.label("item"),
        func.sum(
            case(
                (models.Transaction.type == "PURCHASE", models.Transaction.weight),
                else_=0
            )
        ).label("purchase_kg"),
        func.sum(
            case(
                (models.Transaction.type == "SALE", models.Transaction.weight),
                else_=0
            )
        ).label("sales_kg")
    ).filter(
        models.Transaction.date.between(start, end),
        models.Transaction.item_type.isnot(None)
    ).group_by(
        models.Transaction.item_type
    ).order_by(
        models.Transaction.item_type.asc()
    ).all()

    return [
        {
            "item": row.item,
            "purchase_kg": float(row.purchase_kg or 0),
            "sales_kg": float(row.sales_kg or 0)
        }
        for row in rows
    ]


@app.get("/analytics/payment-modes")
def payment_modes(start_date: str, end_date: str, db: Session = Depends(get_db)):
    start = parse_input_date(start_date)
    end = parse_input_date(end_date)
    if not start or not end:
        return {"error": "Invalid date format"}

    mode = func.coalesce(models.Transaction.payment_mode, "NA").label("mode")
    rows = db.query(
        mode,
        func.sum(
            case(
                (models.Transaction.category == "RECEIVED", models.Transaction.amount),
                else_=0
            )
        ).label("received"),
        func.sum(
            case(
                (models.Transaction.category == "PAID", models.Transaction.amount),
                else_=0
            )
        ).label("paid")
    ).filter(
        models.Transaction.date.between(start, end),
        models.Transaction.type == "PAYMENT"
    ).group_by(
        mode
    ).all()

    return [
        {
            "mode": row.mode,
            "received": float(row.received or 0),
            "paid": float(row.paid or 0),
            "total": float((row.received or 0) + (row.paid or 0))
        }
        for row in sorted(rows, key=lambda value: (value.received or 0) + (value.paid or 0), reverse=True)
    ]


@app.get("/retail-bills/next-number")
def next_retail_bill_number(date: str, db: Session = Depends(get_db)):
    target_date = parse_input_date(date)
    if not target_date:
        return {"error": "Invalid date format"}

    bill_numbers = db.query(models.RetailBill.bill_number).filter(
        models.RetailBill.date == target_date
    ).all()
    receipt_numbers = db.query(models.PaymentReceipt.receipt_number).filter(
        models.PaymentReceipt.date == target_date
    ).all()

    max_number = 0
    for row in list(bill_numbers) + list(receipt_numbers):
        raw_value = getattr(row, "bill_number", None) or getattr(row, "receipt_number", None)
        digits = "".join(char for char in str(raw_value or "") if char.isdigit())
        if digits:
            max_number = max(max_number, int(digits))

    return {"bill_number": str(max_number + 1)}


@app.get("/retail-bills")
def list_retail_bills(date: str = None, db: Session = Depends(get_db)):
    query = db.query(models.RetailBill).order_by(
        models.RetailBill.date.desc(),
        models.RetailBill.created_at.desc()
    )

    if date:
        target_date = parse_input_date(date)
        if not target_date:
            return {"error": "Invalid date format"}
        query = query.filter(models.RetailBill.date == target_date)

    bills = query.limit(50).all()
    bill_ids = [bill.id for bill in bills]
    mode_map = {}
    if bill_ids:
        item_rows = db.query(
            models.RetailBillItem.bill_id,
            models.RetailBillItem.line_type
        ).filter(
            models.RetailBillItem.bill_id.in_(bill_ids)
        ).all()
        for row in item_rows:
            if str(row.line_type or "STANDARD").upper() == "DRESSED":
                mode_map[row.bill_id] = "dressed"
            else:
                mode_map.setdefault(row.bill_id, "regular")

    return {
        "results": [
            {
                "id": str(bill.id),
                "bill_number": bill.bill_number,
                "bill_mode": mode_map.get(bill.id, "regular"),
                "date": str(bill.date),
                "customer_name": bill.customer_name or "Walk-in Customer",
                "payment_mode": bill.payment_mode or "Cash",
                "total_amount": float(bill.total_amount or 0),
                "paid_amount": float(bill.paid_amount or 0),
                "outstanding_amount": float(bill.outstanding_amount or 0)
            }
            for bill in bills
        ]
    }


@app.get("/payment-receipts/next-number")
def next_payment_receipt_number(date: str, db: Session = Depends(get_db)):
    target_date = parse_input_date(date)
    if not target_date:
        return {"error": "Invalid date format"}

    receipt_numbers = db.query(models.PaymentReceipt.receipt_number).filter(
        models.PaymentReceipt.date == target_date
    ).all()
    bill_numbers = db.query(models.RetailBill.bill_number).filter(
        models.RetailBill.date == target_date
    ).all()

    max_number = 0
    for row in list(receipt_numbers) + list(bill_numbers):
        raw_value = getattr(row, "receipt_number", None) or getattr(row, "bill_number", None)
        digits = "".join(char for char in str(raw_value or "") if char.isdigit())
        if digits:
            max_number = max(max_number, int(digits))

    return {"receipt_number": str(max_number + 1)}


@app.get("/payment-receipts")
def list_payment_receipts(date: str = None, db: Session = Depends(get_db)):
    query = db.query(models.PaymentReceipt).order_by(
        models.PaymentReceipt.date.desc(),
        models.PaymentReceipt.created_at.desc()
    )

    if date:
        target_date = parse_input_date(date)
        if not target_date:
            return {"error": "Invalid date format"}
        query = query.filter(models.PaymentReceipt.date == target_date)

    receipts = query.limit(50).all()

    return {
        "results": [
            {
                "id": str(receipt.id),
                "receipt_number": receipt.receipt_number,
                "date": str(receipt.date),
                "party_name": receipt.party_name or "",
                "direction": receipt.direction or "RECEIVED",
                "payment_mode": receipt.payment_mode or "Cash",
                "amount": float(receipt.amount or 0)
            }
            for receipt in receipts
        ]
    }


@app.get("/dressed-stock")
def list_dressed_stock(date: str | None = None, db: Session = Depends(get_db)):
    query = db.query(models.DressedStockEntry).order_by(
        models.DressedStockEntry.date.desc(),
        models.DressedStockEntry.created_at.desc()
    )

    target_date = parse_input_date(date) if date else None
    if date and not target_date:
        return {"error": "Invalid date format"}
    if target_date:
        query = query.filter(models.DressedStockEntry.date == target_date)

    entries = query.all()
    grouped = {}
    for entry in entries:
        grouped.setdefault(entry.item_name, {
            "item_name": entry.item_name,
            "live_quantity": Decimal("0"),
            "live_weight": Decimal("0"),
            "available_dressed_weight": Decimal("0"),
            "default_rate": Decimal("0")
        })
        grouped[entry.item_name]["live_quantity"] += Decimal(entry.live_quantity or 0)
        grouped[entry.item_name]["live_weight"] += Decimal(entry.live_weight or 0)
        grouped[entry.item_name]["available_dressed_weight"] += Decimal(entry.remaining_dressed_weight or 0)
        if Decimal(grouped[entry.item_name]["default_rate"] or 0) <= 0 and Decimal(entry.default_rate or 0) > 0:
            grouped[entry.item_name]["default_rate"] = Decimal(entry.default_rate or 0)

    return {
        "entries": [serialize_dressed_stock_entry(entry) for entry in entries],
        "available_items": [
            {
                "item_name": item["item_name"],
                "live_quantity": float(item["live_quantity"]),
                "live_weight": float(item["live_weight"]),
                "available_dressed_weight": float(item["available_dressed_weight"]),
                "default_rate": float(item["default_rate"] or 0)
            }
            for item in grouped.values()
            if item["available_dressed_weight"] > 0
        ]
    }


@app.post("/dressed-stock")
def create_dressed_stock_entries(payload: dict = Body(...), input_date: str = None, db: Session = Depends(get_db)):
    target_date = parse_input_date(input_date)
    if not target_date:
        return {"error": "Select working date"}

    rows = payload.get("rows") or []
    if not rows:
        return {"error": "Add at least one dressed stock row"}

    inserted = 0
    skipped = 0
    errors = []

    for index, row in enumerate(rows, start=1):
        try:
            item_name = str(row.get("item_name") or row.get("hen_type") or "").strip() or "Dressed Chicken"
            live_quantity = parse_decimal(row.get("live_quantity", row.get("nag")))
            live_weight = parse_decimal(row.get("live_weight"))
            dressed_weight = parse_decimal(row.get("dressed_weight"))
            default_rate = parse_decimal(row.get("default_rate"))
            notes = str(row.get("notes") or "").strip() or None

            if live_quantity < 0 or live_weight < 0 or dressed_weight < 0 or default_rate < 0:
                skipped += 1
                row_error(errors, index, "Enter valid live NAG and live weight")
                continue

            db.add(models.DressedStockEntry(
                date=target_date,
                item_name=item_name,
                live_quantity=live_quantity if live_quantity > 0 else None,
                live_weight=live_weight if live_weight > 0 else None,
                dressed_weight=dressed_weight if dressed_weight > 0 else None,
                remaining_dressed_weight=dressed_weight if dressed_weight > 0 else None,
                default_rate=default_rate if default_rate > 0 else None,
                notes=notes
            ))
            inserted += 1
        except Exception as e:
            skipped += 1
            row_error(errors, index, str(e))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving dressed stock failed", "details": str(e)}

    return upload_result(inserted, skipped, errors)


@app.get("/payment-receipts/{receipt_id}")
def get_payment_receipt(receipt_id: UUID, db: Session = Depends(get_db)):
    receipt = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.id == receipt_id).first()
    if not receipt:
        return {"error": "Payment receipt not found"}
    txns = db.query(models.Transaction).filter(models.Transaction.party_id == receipt.party_id).order_by(
        models.Transaction.date.asc(),
        models.Transaction.created_at.asc()
    ).all()
    balance_after, _ = build_ledger(txns)
    return serialize_payment_receipt(receipt, balance_after)


@app.post("/payment-receipts")
def create_payment_receipt(payload: dict = Body(...), db: Session = Depends(get_db)):
    target_date = parse_input_date(payload.get("date"))
    if not target_date:
        return {"error": "Invalid receipt date"}

    party_name = str(payload.get("party_name") or "").strip()
    if not party_name:
        return {"error": "Party name is required"}

    amount = parse_decimal(payload.get("amount"))
    if amount <= 0:
        return {"error": "Amount must be greater than 0"}

    direction = normalize_payment_direction(payload.get("direction"))
    if not direction:
        return {"error": "Direction must be RECEIVED or PAID"}

    receipt_number = str(payload.get("receipt_number") or "").strip()
    if not receipt_number:
        next_number = next_payment_receipt_number(str(target_date), db)
        receipt_number = next_number.get("receipt_number", "1")

    existing = db.query(models.PaymentReceipt).filter(
        models.PaymentReceipt.date == target_date,
        models.PaymentReceipt.receipt_number == receipt_number
    ).first()
    existing_bill = db.query(models.RetailBill).filter(
        models.RetailBill.date == target_date,
        models.RetailBill.bill_number == receipt_number
    ).first()
    if existing or existing_bill:
        return {"error": "Receipt number already exists"}

    party_phone = str(payload.get("party_phone") or "").strip()
    party_address = str(payload.get("party_address") or "").strip()
    cashier_name = str(payload.get("cashier_name") or "admin").strip()
    payment_mode = str(payload.get("payment_mode") or "Cash").strip()
    notes = str(payload.get("notes") or "").strip()

    party_id = get_or_create_party(db, party_name, "BOTH", {}, phone=party_phone, address=party_address)

    receipt = models.PaymentReceipt(
        id=uuid4(),
        receipt_number=receipt_number,
        date=target_date,
        party_id=party_id,
        party_name=party_name,
        party_phone=party_phone or None,
        party_address=party_address or None,
        cashier_name=cashier_name or "admin",
        direction=direction,
        payment_mode=payment_mode,
        amount=amount,
        notes=notes or None
    )
    db.add(receipt)
    db.flush()

    db.add(models.Transaction(
        date=target_date,
        party_id=party_id,
        type="PAYMENT",
        category=direction,
        amount=amount,
        payment_mode=payment_mode,
        bill_number=receipt_number,
        source_ref=f"payment-receipt:{receipt.id}"
    ))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Saving payment receipt failed", "details": str(e)}

    db.refresh(receipt)
    txns = db.query(models.Transaction).filter(models.Transaction.party_id == party_id).order_by(
        models.Transaction.date.asc(),
        models.Transaction.created_at.asc()
    ).all()
    balance_after, _ = build_ledger(txns)
    return {"receipt": serialize_payment_receipt(receipt, balance_after)}


@app.put("/payment-receipts/{receipt_id}")
def update_payment_receipt(receipt_id: UUID, payload: dict = Body(...), db: Session = Depends(get_db), user: models.User = Depends(require_owner)):
    receipt = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.id == receipt_id).first()
    if not receipt:
        return {"error": "Payment receipt not found"}

    target_date = parse_input_date(payload.get("date"))
    if not target_date:
        return {"error": "Invalid receipt date"}

    party_name = str(payload.get("party_name") or "").strip()
    if not party_name:
        return {"error": "Party name is required"}

    amount = parse_decimal(payload.get("amount"))
    if amount <= 0:
        return {"error": "Amount must be greater than 0"}

    direction = normalize_payment_direction(payload.get("direction"))
    if not direction:
        return {"error": "Direction must be RECEIVED or PAID"}

    receipt_number = str(payload.get("receipt_number") or "").strip()
    if not receipt_number:
        return {"error": "Receipt number is required"}

    existing = db.query(models.PaymentReceipt).filter(
        models.PaymentReceipt.receipt_number == receipt_number,
        models.PaymentReceipt.id != receipt.id
    ).first()
    existing_bill = db.query(models.RetailBill).filter(
        models.RetailBill.bill_number == receipt_number
    ).first()
    if existing or existing_bill:
        return {"error": "Receipt number already exists"}

    party_phone = str(payload.get("party_phone") or "").strip()
    party_address = str(payload.get("party_address") or "").strip()
    cashier_name = str(payload.get("cashier_name") or "admin").strip()
    payment_mode = str(payload.get("payment_mode") or "Cash").strip()
    notes = str(payload.get("notes") or "").strip()

    party_id = get_or_create_party(db, party_name, "BOTH", {}, phone=party_phone, address=party_address)

    receipt.receipt_number = receipt_number
    receipt.date = target_date
    receipt.party_id = party_id
    receipt.party_name = party_name
    receipt.party_phone = party_phone or None
    receipt.party_address = party_address or None
    receipt.cashier_name = cashier_name or "admin"
    receipt.direction = direction
    receipt.payment_mode = payment_mode
    receipt.amount = amount
    receipt.notes = notes or None

    db.query(models.Transaction).filter(
        models.Transaction.source_ref == f"payment-receipt:{receipt.id}"
    ).delete(synchronize_session=False)

    db.add(models.Transaction(
        date=target_date,
        party_id=party_id,
        type="PAYMENT",
        category=direction,
        amount=amount,
        payment_mode=payment_mode,
        bill_number=receipt_number,
        source_ref=f"payment-receipt:{receipt.id}"
    ))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Updating payment receipt failed", "details": str(e)}

    db.refresh(receipt)
    txns = db.query(models.Transaction).filter(models.Transaction.party_id == party_id).order_by(
        models.Transaction.date.asc(),
        models.Transaction.created_at.asc()
    ).all()
    balance_after, _ = build_ledger(txns)
    return {"receipt": serialize_payment_receipt(receipt, balance_after)}


@app.get("/retail-bills/{bill_id}")
def get_retail_bill(bill_id: UUID, db: Session = Depends(get_db)):
    bill = db.query(models.RetailBill).filter(models.RetailBill.id == bill_id).first()
    if not bill:
        return {"error": "Retail bill not found"}

    items = db.query(models.RetailBillItem).filter(
        models.RetailBillItem.bill_id == bill.id
    ).order_by(models.RetailBillItem.line_order.asc()).all()

    data = serialize_retail_bill(bill, items)
    data["party_balance"] = retail_party_balance_after(db, bill.party_id)
    return data


@app.post("/retail-bills")
def create_retail_bill(payload: dict = Body(...), db: Session = Depends(get_db)):
    target_date = parse_input_date(payload.get("date"))
    if not target_date:
        return {"error": "Invalid bill date"}

    raw_items = payload.get("items") or []
    if not raw_items:
        return {"error": "Add at least one retail item"}

    bill_number = str(payload.get("bill_number") or "").strip()
    if not bill_number:
        next_number = next_retail_bill_number(str(target_date), db)
        bill_number = next_number.get("bill_number", "1")

    existing = db.query(models.RetailBill).filter(
        models.RetailBill.date == target_date,
        models.RetailBill.bill_number == bill_number
    ).first()
    existing_receipt = db.query(models.PaymentReceipt).filter(
        models.PaymentReceipt.date == target_date,
        models.PaymentReceipt.receipt_number == bill_number
    ).first()
    if existing or existing_receipt:
        return {"error": "Bill number already exists"}

    customer_name = str(payload.get("customer_name") or "").strip()
    customer_phone = str(payload.get("customer_phone") or "").strip()
    customer_address = str(payload.get("customer_address") or "").strip()
    cashier_name = str(payload.get("cashier_name") or "admin").strip()
    payment_mode = str(payload.get("payment_mode") or "Cash").strip()
    notes = str(payload.get("notes") or "").strip()
    ice_amount = parse_decimal(payload.get("ice_amount"))
    raw_paid_amount = payload.get("paid_amount")
    paid_amount = parse_decimal(raw_paid_amount)

    party_id = None
    if customer_name:
        party_id = get_or_create_party(db, customer_name, "VENDOR", {}, phone=customer_phone, address=customer_address)

    normalized_items = []
    total_quantity = Decimal("0")
    total_weight = Decimal("0")
    total_amount = Decimal("0")

    for index, raw_item in enumerate(raw_items, start=1):
        item_name = str(raw_item.get("item_name") or "").strip()
        if not item_name:
            return {"error": f"Item name missing on row {index}"}

        line_type = str(raw_item.get("line_type") or "STANDARD").strip().upper()
        if line_type not in ["STANDARD", "DRESSED"]:
            line_type = "STANDARD"
        quantity = parse_decimal(raw_item.get("nag", raw_item.get("quantity")))
        rate = parse_decimal(raw_item.get("rate"))
        unit = str(raw_item.get("unit") or "KGS").strip().upper()
        weight = parse_decimal(raw_item.get("weight"))

        if line_type != "DRESSED" and quantity <= 0:
            return {"error": f"Quantity must be greater than 0 on row {index}"}

        if line_type != "DRESSED" and unit == "KGS" and weight <= 0:
            weight = quantity

        amount = parse_decimal(raw_item.get("amount"))
        if line_type == "DRESSED":
            unit = "KGS"
            if quantity < 0:
                return {"error": f"Quantity cannot be negative on row {index}"}
            if weight <= 0:
                return {"error": f"Kgs must be greater than 0 for dressed chicken on row {index}"}
            if amount <= 0 and rate > 0:
                amount = weight * rate
            if amount <= 0:
                return {"error": f"Amount must be greater than 0 for dressed chicken on row {index}"}
            rate = decimal_ratio(amount, weight)
            quantity = Decimal("0")
        elif amount <= 0:
            amount_base = weight if weight > 0 else quantity
            amount = amount_base * rate

        normalized_items.append({
            "line_order": index,
            "item_name": item_name,
            "line_type": line_type,
            "quantity": quantity,
            "unit": unit,
            "weight": weight,
            "rate": rate,
            "amount": amount
        })

        total_quantity += quantity
        total_weight += weight
        total_amount += amount

    if ice_amount < 0:
        return {"error": "Ice amount cannot be negative"}

    total_amount += ice_amount

    if raw_paid_amount in [None, ""] and payment_mode.strip().upper() != "CREDIT":
        paid_amount = total_amount

    if paid_amount < 0:
        return {"error": "Paid amount cannot be negative"}

    if paid_amount > total_amount:
        paid_amount = total_amount

    outstanding_amount = total_amount - paid_amount
    if outstanding_amount > 0 and not customer_name:
        return {"error": "Customer name is required for credit retail bills"}

    if outstanding_amount > 0 and payment_mode.strip().upper() == "CASH":
        payment_mode = "Credit"

    transaction_party_id = party_id if outstanding_amount > 0 else None

    bill = models.RetailBill(
        id=uuid4(),
        bill_number=bill_number,
        date=target_date,
        party_id=party_id,
        customer_name=customer_name or None,
        customer_phone=customer_phone or None,
        customer_address=customer_address or None,
        cashier_name=cashier_name or "admin",
        payment_mode=payment_mode,
        total_quantity=total_quantity,
        total_weight=total_weight,
        ice_amount=ice_amount,
        total_amount=total_amount,
        paid_amount=paid_amount,
        outstanding_amount=outstanding_amount,
        notes=notes or None
    )
    db.add(bill)
    db.flush()

    for item in normalized_items:
        db.add(models.RetailBillItem(
            bill_id=bill.id,
            line_order=item["line_order"],
            item_name=item["item_name"],
            line_type=item["line_type"],
            quantity=item["quantity"],
            unit=item["unit"],
            weight=item["weight"],
            rate=item["rate"],
            amount=item["amount"]
        ))
        transaction_category = "RETAIL DRESSED" if item["line_type"] == "DRESSED" else "RETAIL"
        db.add(models.Transaction(
            date=target_date,
            party_id=transaction_party_id,
            type="SALE",
            category=transaction_category,
            item_type=item["item_name"],
            quantity=item["quantity"],
            weight=item["weight"],
            rate=item["rate"],
            amount=item["amount"],
            payment_mode=payment_mode,
            bill_number=bill_number,
            source_ref=f"retail-bill:{bill.id}:{item['line_order']}"
        ))

    if ice_amount > 0:
        db.add(models.Transaction(
            date=target_date,
            party_id=transaction_party_id,
            type="SALE",
            category="RETAIL DRESSED" if any(item["line_type"] == "DRESSED" for item in normalized_items) else "RETAIL",
            item_type="ICE",
            quantity=Decimal("0"),
            weight=Decimal("0"),
            rate=ice_amount,
            amount=ice_amount,
            payment_mode=payment_mode,
            bill_number=bill_number,
            source_ref=f"retail-bill:{bill.id}:ice"
        ))

    if paid_amount > 0 and outstanding_amount > 0:
        db.add(models.Transaction(
            date=target_date,
            party_id=party_id,
            type="PAYMENT",
            category="RECEIVED",
            item_type="Retail Bill Payment",
            quantity=Decimal("0"),
            weight=0,
            rate=0,
            amount=paid_amount,
            payment_mode=payment_mode,
            bill_number=bill_number,
            source_ref=f"retail-payment:{bill.id}"
        ))

    recompute_dressed_stock_remaining(db, target_date)
    db.commit()
    db.refresh(bill)

    saved_items = db.query(models.RetailBillItem).filter(
        models.RetailBillItem.bill_id == bill.id
    ).order_by(models.RetailBillItem.line_order.asc()).all()

    bill_data = serialize_retail_bill(bill, saved_items)
    bill_data["party_balance"] = retail_party_balance_after(db, bill.party_id)

    return {
        "status": "success",
        "message": "Retail bill created",
        "bill": bill_data
    }


@app.put("/retail-bills/{bill_id}")
def update_retail_bill(bill_id: UUID, payload: dict = Body(...), db: Session = Depends(get_db), user: models.User = Depends(require_owner)):
    bill = db.query(models.RetailBill).filter(models.RetailBill.id == bill_id).first()
    if not bill:
        return {"error": "Retail bill not found"}

    target_date = parse_input_date(payload.get("date"))
    if not target_date:
        return {"error": "Invalid bill date"}

    raw_items = payload.get("items") or []
    if not raw_items:
        return {"error": "Add at least one retail item"}

    bill_number = str(payload.get("bill_number") or "").strip()
    if not bill_number:
        return {"error": "Bill number is required"}

    existing = db.query(models.RetailBill).filter(
        models.RetailBill.date == target_date,
        models.RetailBill.bill_number == bill_number,
        models.RetailBill.id != bill.id
    ).first()
    existing_receipt = db.query(models.PaymentReceipt).filter(
        models.PaymentReceipt.date == target_date,
        models.PaymentReceipt.receipt_number == bill_number
    ).first()
    if existing or existing_receipt:
        return {"error": "Bill number already exists"}

    customer_name = str(payload.get("customer_name") or "").strip()
    customer_phone = str(payload.get("customer_phone") or "").strip()
    customer_address = str(payload.get("customer_address") or "").strip()
    cashier_name = str(payload.get("cashier_name") or "admin").strip()
    payment_mode = str(payload.get("payment_mode") or "Cash").strip()
    notes = str(payload.get("notes") or "").strip()
    ice_amount = parse_decimal(payload.get("ice_amount"))
    raw_paid_amount = payload.get("paid_amount")
    paid_amount = parse_decimal(raw_paid_amount)

    party_id = None
    if customer_name:
        party_id = get_or_create_party(db, customer_name, "VENDOR", {}, phone=customer_phone, address=customer_address)

    normalized_items = []
    total_quantity = Decimal("0")
    total_weight = Decimal("0")
    total_amount = Decimal("0")

    for index, raw_item in enumerate(raw_items, start=1):
        item_name = str(raw_item.get("item_name") or "").strip()
        if not item_name:
            return {"error": f"Item name missing on row {index}"}

        line_type = str(raw_item.get("line_type") or "STANDARD").strip().upper()
        if line_type not in ["STANDARD", "DRESSED"]:
            line_type = "STANDARD"
        quantity = parse_decimal(raw_item.get("nag", raw_item.get("quantity")))
        rate = parse_decimal(raw_item.get("rate"))
        unit = str(raw_item.get("unit") or "KGS").strip().upper()
        weight = parse_decimal(raw_item.get("weight"))

        if line_type != "DRESSED" and quantity <= 0:
            return {"error": f"Quantity must be greater than 0 on row {index}"}

        if line_type != "DRESSED" and unit == "KGS" and weight <= 0:
            weight = quantity

        amount = parse_decimal(raw_item.get("amount"))
        if line_type == "DRESSED":
            unit = "KGS"
            if quantity < 0:
                return {"error": f"Quantity cannot be negative on row {index}"}
            if weight <= 0:
                return {"error": f"Kgs must be greater than 0 for dressed chicken on row {index}"}
            if amount <= 0 and rate > 0:
                amount = weight * rate
            if amount <= 0:
                return {"error": f"Amount must be greater than 0 for dressed chicken on row {index}"}
            rate = decimal_ratio(amount, weight)
            quantity = Decimal("0")
        elif amount <= 0:
            amount_base = weight if weight > 0 else quantity
            amount = amount_base * rate

        normalized_items.append({
            "line_order": index,
            "item_name": item_name,
            "line_type": line_type,
            "quantity": quantity,
            "unit": unit,
            "weight": weight,
            "rate": rate,
            "amount": amount
        })

        total_quantity += quantity
        total_weight += weight
        total_amount += amount

    if ice_amount < 0:
        return {"error": "Ice amount cannot be negative"}

    total_amount += ice_amount

    if raw_paid_amount in [None, ""] and payment_mode.strip().upper() != "CREDIT":
        paid_amount = total_amount

    if paid_amount < 0:
        return {"error": "Paid amount cannot be negative"}

    if paid_amount > total_amount:
        paid_amount = total_amount

    outstanding_amount = total_amount - paid_amount
    if outstanding_amount > 0 and not customer_name:
        return {"error": "Customer name is required for credit retail bills"}

    if outstanding_amount > 0 and payment_mode.strip().upper() == "CASH":
        payment_mode = "Credit"

    transaction_party_id = party_id if outstanding_amount > 0 else None

    previous_date = bill.date

    bill.bill_number = bill_number
    bill.date = target_date
    bill.party_id = party_id
    bill.customer_name = customer_name or None
    bill.customer_phone = customer_phone or None
    bill.customer_address = customer_address or None
    bill.cashier_name = cashier_name or "admin"
    bill.payment_mode = payment_mode
    bill.total_quantity = total_quantity
    bill.total_weight = total_weight
    bill.ice_amount = ice_amount
    bill.total_amount = total_amount
    bill.paid_amount = paid_amount
    bill.outstanding_amount = outstanding_amount
    bill.notes = notes or None

    db.query(models.RetailBillItem).filter(
        models.RetailBillItem.bill_id == bill.id
    ).delete(synchronize_session=False)

    db.query(models.Transaction).filter(
        or_(
            models.Transaction.source_ref.like(f"retail-bill:{bill.id}:%"),
            models.Transaction.source_ref == f"retail-payment:{bill.id}"
        )
    ).delete(synchronize_session=False)

    for item in normalized_items:
        db.add(models.RetailBillItem(
            bill_id=bill.id,
            line_order=item["line_order"],
            item_name=item["item_name"],
            line_type=item["line_type"],
            quantity=item["quantity"],
            unit=item["unit"],
            weight=item["weight"],
            rate=item["rate"],
            amount=item["amount"]
        ))
        transaction_category = "RETAIL DRESSED" if item["line_type"] == "DRESSED" else "RETAIL"
        db.add(models.Transaction(
            date=target_date,
            party_id=transaction_party_id,
            type="SALE",
            category=transaction_category,
            item_type=item["item_name"],
            quantity=item["quantity"],
            weight=item["weight"],
            rate=item["rate"],
            amount=item["amount"],
            payment_mode=payment_mode,
            bill_number=bill_number,
            source_ref=f"retail-bill:{bill.id}:{item['line_order']}"
        ))

    if ice_amount > 0:
        db.add(models.Transaction(
            date=target_date,
            party_id=transaction_party_id,
            type="SALE",
            category="RETAIL DRESSED" if any(item["line_type"] == "DRESSED" for item in normalized_items) else "RETAIL",
            item_type="ICE",
            quantity=Decimal("0"),
            weight=Decimal("0"),
            rate=ice_amount,
            amount=ice_amount,
            payment_mode=payment_mode,
            bill_number=bill_number,
            source_ref=f"retail-bill:{bill.id}:ice"
        ))

    if paid_amount > 0 and outstanding_amount > 0:
        db.add(models.Transaction(
            date=target_date,
            party_id=party_id,
            type="PAYMENT",
            category="RECEIVED",
            item_type="Retail Bill Payment",
            quantity=Decimal("0"),
            weight=0,
            rate=0,
            amount=paid_amount,
            payment_mode=payment_mode,
            bill_number=bill_number,
            source_ref=f"retail-payment:{bill.id}"
        ))

    recompute_dressed_stock_remaining(db, previous_date)
    if previous_date != target_date:
        recompute_dressed_stock_remaining(db, target_date)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"error": "Updating retail bill failed", "details": str(e)}

    db.refresh(bill)
    saved_items = db.query(models.RetailBillItem).filter(
        models.RetailBillItem.bill_id == bill.id
    ).order_by(models.RetailBillItem.line_order.asc()).all()

    bill_data = serialize_retail_bill(bill, saved_items)
    bill_data["party_balance"] = retail_party_balance_after(db, bill.party_id)

    return {
        "status": "success",
        "message": "Retail bill updated",
        "bill": bill_data
    }


@app.get("/daily-sheet")
def daily_sheet(date: str, sheet_type: str = "stock", db: Session = Depends(get_db), user: models.User = Depends(require_owner)):
    target_date = parse_input_date(date)
    if not target_date:
        return {"error": "Invalid date format"}

    sheet_type = sheet_type.strip().lower()

    if sheet_type in ["vendor", "dealer"]:
        if sheet_type == "vendor":
            non_retail_sale = (
                (models.Transaction.type == "SALE") &
                or_(
                    models.Transaction.category.is_(None),
                    ~models.Transaction.category.in_(["RETAIL", "RETAIL DRESSED"])
                )
            )
            received_payment = (
                (models.Transaction.type == "PAYMENT") &
                (models.Transaction.category == "RECEIVED") &
                or_(
                    models.Transaction.item_type.is_(None),
                    models.Transaction.item_type != "Retail Bill Payment"
                )
            )
            relevant_filter = (
                non_retail_sale |
                ((models.Transaction.type == "OPENING") & (models.Transaction.category == "RECEIVABLE")) |
                received_payment
            )
            old_case = case(
                (
                    (models.Transaction.date < target_date) & non_retail_sale,
                    models.Transaction.amount
                ),
                (
                    (models.Transaction.date <= target_date) & (models.Transaction.type == "OPENING") & (models.Transaction.category == "RECEIVABLE"),
                    models.Transaction.amount
                ),
                (
                    (models.Transaction.date < target_date) & (models.Transaction.type == "PAYMENT") & (models.Transaction.category == "RECEIVED"),
                    -models.Transaction.amount
                ),
                else_=0
            )
            purchases_case = case(
                (
                    (models.Transaction.date == target_date) & non_retail_sale,
                    models.Transaction.amount
                ),
                else_=0
            )
            payment_case = case(
                (
                    (models.Transaction.date == target_date) & received_payment,
                    models.Transaction.amount
                ),
                else_=0
            )
        else:
            relevant_filter = (
                (models.Transaction.type == "PURCHASE") |
                ((models.Transaction.type == "OPENING") & (models.Transaction.category == "PAYABLE")) |
                ((models.Transaction.type == "PAYMENT") & (models.Transaction.category == "PAID"))
            )
            old_case = case(
                (
                    (models.Transaction.date < target_date) & (models.Transaction.type == "PURCHASE"),
                    models.Transaction.amount
                ),
                (
                    (models.Transaction.date <= target_date) & (models.Transaction.type == "OPENING") & (models.Transaction.category == "PAYABLE"),
                    models.Transaction.amount
                ),
                (
                    (models.Transaction.date < target_date) & (models.Transaction.type == "PAYMENT") & (models.Transaction.category == "PAID"),
                    -models.Transaction.amount
                ),
                else_=0
            )
            purchases_case = case(
                (
                    (models.Transaction.date == target_date) & (models.Transaction.type == "PURCHASE"),
                    models.Transaction.amount
                ),
                else_=0
            )
            payment_case = case(
                (
                    (models.Transaction.date == target_date) & (models.Transaction.type == "PAYMENT") & (models.Transaction.category == "PAID"),
                    models.Transaction.amount
                ),
                else_=0
            )

        rows = db.query(
            models.Party.name.label("party_name"),
            func.sum(old_case).label("old_balance"),
            func.sum(purchases_case).label("purchases"),
            func.sum(payment_case).label("payment")
        ).join(
            models.Transaction,
            models.Transaction.party_id == models.Party.id
        ).filter(
            relevant_filter
        ).group_by(
            models.Party.id,
            models.Party.name
        ).order_by(
            models.Party.name.asc()
        ).all()

        result_rows = []
        total_old = Decimal("0")
        total_purchases = Decimal("0")
        total_payment = Decimal("0")
        total_balance = Decimal("0")

        for row in rows:
            old_balance = Decimal(row.old_balance or 0)
            purchases = Decimal(row.purchases or 0)
            payment = Decimal(row.payment or 0)
            balance = old_balance + purchases - payment

            if old_balance == 0 and purchases == 0 and payment == 0 and balance == 0:
                continue

            result_rows.append(format_balance_row(row.party_name, old_balance, purchases, payment, balance))
            total_old += old_balance
            total_purchases += purchases
            total_payment += payment
            total_balance += balance

        return {
            "date": str(target_date),
            "sheet_type": sheet_type,
            "title": "Vendor Balance Sheet" if sheet_type == "vendor" else "Dealer Balance Sheet",
            "rows": result_rows,
            "totals": format_balance_row("TOTAL", total_old, total_purchases, total_payment, total_balance)
        }

    rates = latest_item_rates(db, target_date)

    processed_rows = db.query(models.DailyItemStock).filter(
        models.DailyItemStock.date == target_date
    ).all()
    processed_by_item = {row.item_type: row for row in processed_rows}

    opening_source = {}
    if processed_rows:
        for row in processed_rows:
            opening_source[row.item_type] = {
                "nag": Decimal(row.opening_quantity or 0) if row.opening_quantity is not None else None,
                "weight": Decimal(row.opening_weight or 0)
            }
    else:
        prev_rows = db.query(models.DailyItemStock).filter(
            models.DailyItemStock.date < target_date
        ).order_by(models.DailyItemStock.date.desc()).all()
        if prev_rows:
            for row in prev_rows:
                opening_source.setdefault(row.item_type, {
                    "nag": Decimal(row.actual_closing_quantity or 0) if row.actual_closing_quantity is not None else None,
                    "weight": Decimal(row.actual_closing_weight or 0)
                })
        else:
            for row in db.query(models.ItemOpeningStock).filter(
                models.ItemOpeningStock.date <= target_date
            ).order_by(models.ItemOpeningStock.date.desc()).all():
                opening_source.setdefault(row.item_type, {
                    "nag": Decimal(row.opening_quantity or 0) if row.opening_quantity is not None else None,
                    "weight": Decimal(row.opening_weight or 0)
                })

    opening_rows = []
    opening_total_quantity = None
    opening_total_weight = Decimal("0")
    opening_total_amount = Decimal("0")
    for item, values in sorted(opening_source.items()):
        nag = values["nag"]
        weight = values["weight"]
        rate = rates.get(item, Decimal("0"))
        amount = weight * rate
        opening_rows.append(format_sheet_row(item, weight, rate, amount, nag))
        if nag is not None:
            opening_total_quantity = Decimal(opening_total_quantity or 0) + nag
        opening_total_weight += weight
        opening_total_amount += amount

    purchase_rows_raw = db.query(models.Transaction).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "PURCHASE"
    ).order_by(models.Transaction.item_type.asc(), models.Transaction.party_id.asc()).all()

    purchase_rows = []
    purchase_total_quantity = None
    purchase_total_weight = Decimal("0")
    purchase_total_amount = Decimal("0")
    purchase_total_rate_weight = Decimal("0")
    for txn in purchase_rows_raw:
        nag = Decimal(txn.quantity or 0) if txn.quantity is not None else None
        weight = Decimal(txn.weight or 0)
        rate = Decimal(txn.rate or 0)
        amount = Decimal(txn.amount or 0)
        label = txn.item_type or "Unknown"
        purchase_rows.append(format_sheet_row(label, weight, rate, amount, nag))
        if nag is not None:
            purchase_total_quantity = Decimal(purchase_total_quantity or 0) + nag
        purchase_total_weight += weight
        purchase_total_amount += amount
        purchase_total_rate_weight += weight * rate

    mortality_rows_raw = db.query(models.Transaction).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "MORTALITY"
    ).order_by(models.Transaction.item_type.asc()).all()

    mortality_grouped = db.query(
        models.Transaction.item_type.label("item_type"),
        func.sum(models.Transaction.quantity).label("quantity"),
        func.sum(models.Transaction.weight).label("weight")
    ).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "MORTALITY"
    ).group_by(
        models.Transaction.item_type
    ).order_by(
        models.Transaction.item_type.asc()
    ).all()

    mortality_rows = []
    mortality_total_quantity = None
    mortality_total_weight = Decimal("0")
    for row in mortality_grouped:
        quantity = Decimal(row.quantity or 0) if row.quantity is not None else None
        weight = Decimal(row.weight or 0)
        mortality_rows.append(format_sheet_row(row.item_type or "Unknown", weight, Decimal("0"), Decimal("0"), quantity))
        if quantity is not None:
            mortality_total_quantity = Decimal(mortality_total_quantity or 0) + quantity
        mortality_total_weight += weight

    sales_raw = db.query(models.Transaction).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "SALE"
    ).order_by(models.Transaction.category.asc().nulls_last(), models.Transaction.item_type.asc()).all()

    sales_grouped = db.query(
        models.Transaction.category.label("category"),
        models.Transaction.item_type.label("item_type"),
        func.sum(models.Transaction.quantity).label("quantity"),
        func.sum(models.Transaction.weight).label("weight"),
        func.sum(models.Transaction.amount).label("amount")
    ).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "SALE"
    ).group_by(
        models.Transaction.category,
        models.Transaction.item_type
    ).order_by(
        models.Transaction.category.asc().nulls_last(),
        models.Transaction.item_type.asc()
    ).all()

    sales_sections = {}
    for row in sales_grouped:
        section = (row.category or "OTHER").strip().upper()
        sales_sections.setdefault(section, [])
        quantity = Decimal(row.quantity or 0) if row.quantity is not None else None
        weight = Decimal(row.weight or 0)
        amount = Decimal(row.amount or 0)
        avg_rate = decimal_ratio(amount, weight)
        sales_sections[section].append(format_sheet_row(row.item_type or "Unknown", weight, avg_rate, amount, quantity))

    section_order = ["WHOLESALE", "HOTEL", "RETAIL", "RETAIL DRESSED", "RETAILS", "SHOP", "CUSTOMER", "OTHER"]
    ordered_sales_sections = []
    for section in section_order + [s for s in sales_sections.keys() if s not in section_order]:
        rows = sales_sections.get(section)
        if not rows:
            continue
        total_quantity = optional_decimal_sum(Decimal(str(row["nag"])) for row in rows if row["nag"] not in ["", None])
        total_weight = sum(Decimal(str(row["weight"])) for row in rows)
        total_amount = sum(Decimal(str(row["total"])) for row in rows)
        avg_rate = (total_amount / total_weight) if total_weight > 0 else Decimal("0")
        ordered_sales_sections.append({
            "title": section.title(),
            "rows": rows,
            "total": format_sheet_row("TOTAL", total_weight, avg_rate, total_amount, total_quantity)
        })

    total_sales_quantity = optional_decimal_sum(
        Decimal(t.quantity or 0) for t in sales_raw if t.quantity is not None
    )
    total_sales_weight = sum(Decimal(t.weight or 0) for t in sales_raw)
    total_sales_amount = sum(Decimal(t.amount or 0) for t in sales_raw)
    total_sales_rate = (total_sales_amount / total_sales_weight) if total_sales_weight > 0 else Decimal("0")

    total_purchase_rate = (purchase_total_amount / purchase_total_weight) if purchase_total_weight > 0 else Decimal("0")

    closing_quantity = None
    if any(value is not None for value in [opening_total_quantity, purchase_total_quantity, total_sales_quantity, mortality_total_quantity]):
        closing_quantity = (
            Decimal(opening_total_quantity or 0)
            + Decimal(purchase_total_quantity or 0)
            - Decimal(total_sales_quantity or 0)
            - Decimal(mortality_total_quantity or 0)
        )

    closing_weight = opening_total_weight + purchase_total_weight - total_sales_weight - mortality_total_weight
    closing_rate = total_purchase_rate if total_purchase_rate > 0 else Decimal("0")
    closing_amount = closing_weight * closing_rate

    actual_quantity = optional_decimal_sum(Decimal(row.actual_closing_quantity or 0) for row in processed_rows if row.actual_closing_quantity is not None) if processed_rows else None
    actual_weight = sum(Decimal(row.actual_closing_weight or 0) for row in processed_rows) if processed_rows else Decimal("0")
    actual_amount = actual_weight * closing_rate
    short_quantity = Decimal(closing_quantity or 0) - Decimal(actual_quantity or 0) if (closing_quantity is not None or actual_quantity is not None) else None
    short_weight = closing_weight - actual_weight
    short_amount = short_weight * closing_rate

    gross_profit = total_sales_amount - purchase_total_amount + closing_amount - opening_total_amount

    retail_credit_bills = db.query(models.RetailBill).filter(
        models.RetailBill.date == target_date,
        models.RetailBill.outstanding_amount > 0
    ).order_by(
        models.RetailBill.customer_name.asc().nulls_last(),
        models.RetailBill.bill_number.asc()
    ).all()

    retail_credit_rows = []
    retail_credit_total = Decimal("0")
    retail_credit_paid = Decimal("0")
    retail_credit_outstanding = Decimal("0")
    for bill in retail_credit_bills:
        bill_total = Decimal(bill.total_amount or 0)
        bill_paid = Decimal(bill.paid_amount or 0)
        bill_outstanding = Decimal(bill.outstanding_amount or 0)
        retail_credit_rows.append(format_retail_credit_row(
            bill.customer_name,
            bill.bill_number,
            bill_total,
            bill_paid,
            bill_outstanding,
            bill.payment_mode
        ))
        retail_credit_total += bill_total
        retail_credit_paid += bill_paid
        retail_credit_outstanding += bill_outstanding

    purchase_rate_rows = []
    purchase_by_item = {}
    purchase_rate_query = db.query(
        models.Transaction.item_type.label("item_type"),
        func.sum(models.Transaction.weight).label("weight"),
        func.sum(models.Transaction.amount).label("amount")
    ).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "PURCHASE",
        models.Transaction.item_type.isnot(None)
    ).group_by(
        models.Transaction.item_type
    ).order_by(
        models.Transaction.item_type.asc()
    ).all()
    for row in purchase_rate_query:
        weight = Decimal(row.weight or 0)
        amount = Decimal(row.amount or 0)
        avg_rate = decimal_ratio(amount, weight)
        purchase_rate_rows.append(
            format_rate_analysis_row(row.item_type, avg_rate, weight, amount)
        )
        purchase_by_item[row.item_type] = {
            "weight": weight,
            "amount": amount,
            "avg_rate": avg_rate
        }

    category_rate_rows = []
    category_mix_rows = []
    category_rate_query = db.query(
        models.Transaction.category.label("category"),
        func.sum(models.Transaction.weight).label("weight"),
        func.sum(models.Transaction.amount).label("amount")
    ).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "SALE"
    ).group_by(
        models.Transaction.category
    ).order_by(
        models.Transaction.category.asc().nulls_last()
    ).all()
    for row in category_rate_query:
        weight = Decimal(row.weight or 0)
        amount = Decimal(row.amount or 0)
        avg_rate = decimal_ratio(amount, weight)
        weight_share = (weight / total_sales_weight * Decimal("100")) if total_sales_weight > 0 else Decimal("0")
        amount_share = (amount / total_sales_amount * Decimal("100")) if total_sales_amount > 0 else Decimal("0")
        category_rate_rows.append(
            format_rate_analysis_row(row.category or "OTHER", avg_rate, weight, amount, category=row.category or "OTHER")
        )
        category_mix_rows.append({
            "category": row.category or "OTHER",
            "weight": float(weight),
            "amount": float(amount),
            "avg_rate": float(avg_rate),
            "weight_share": float(weight_share),
            "amount_share": float(amount_share)
        })

    category_item_rate_rows = []
    category_item_rate_query = db.query(
        models.Transaction.category.label("category"),
        models.Transaction.item_type.label("item_type"),
        func.sum(models.Transaction.weight).label("weight"),
        func.sum(models.Transaction.amount).label("amount")
    ).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "SALE",
        models.Transaction.item_type.isnot(None)
    ).group_by(
        models.Transaction.category,
        models.Transaction.item_type
    ).order_by(
        models.Transaction.category.asc().nulls_last(),
        models.Transaction.item_type.asc()
    ).all()
    for row in category_item_rate_query:
        weight = Decimal(row.weight or 0)
        amount = Decimal(row.amount or 0)
        category_item_rate_rows.append(
            format_rate_analysis_row(
                f"{row.category or 'OTHER'} - {row.item_type}",
                decimal_ratio(amount, weight),
                weight,
                amount,
                category=row.category or "OTHER",
                goods=row.item_type
            )
        )

    sales_by_item_rows = db.query(
        models.Transaction.item_type.label("item_type"),
        func.sum(models.Transaction.weight).label("weight"),
        func.sum(models.Transaction.amount).label("amount")
    ).filter(
        models.Transaction.date == target_date,
        models.Transaction.type == "SALE",
        models.Transaction.item_type.isnot(None)
    ).group_by(
        models.Transaction.item_type
    ).order_by(
        models.Transaction.item_type.asc()
    ).all()

    sales_by_item = {}
    for row in sales_by_item_rows:
        weight = Decimal(row.weight or 0)
        amount = Decimal(row.amount or 0)
        sales_by_item[row.item_type] = {
            "weight": weight,
            "amount": amount,
            "avg_rate": decimal_ratio(amount, weight)
        }

    item_performance_rows = []
    for item in sorted(set(purchase_by_item.keys()) | set(sales_by_item.keys())):
        purchase_info = purchase_by_item.get(item, {"weight": Decimal("0"), "amount": Decimal("0"), "avg_rate": Decimal("0")})
        sales_info = sales_by_item.get(item, {"weight": Decimal("0"), "amount": Decimal("0"), "avg_rate": Decimal("0")})
        spread = sales_info["avg_rate"] - purchase_info["avg_rate"]
        comparable_weight = sales_info["weight"] if sales_info["weight"] > 0 else Decimal("0")
        estimated_profit = spread * comparable_weight
        item_performance_rows.append(format_performance_row(
            item,
            purchase_info["weight"],
            sales_info["weight"],
            purchase_info["avg_rate"],
            sales_info["avg_rate"],
            spread,
            estimated_profit
        ))

    total_purchase_rate_value = decimal_ratio(purchase_total_amount, purchase_total_weight)
    total_sales_rate_value = decimal_ratio(total_sales_amount, total_sales_weight)
    dressed_sales_weight = sum(Decimal(str(row["total"]["weight"])) for row in ordered_sales_sections if row["title"].upper() == "RETAIL DRESSED")
    dressed_sales_amount = sum(Decimal(str(row["total"]["total"])) for row in ordered_sales_sections if row["title"].upper() == "RETAIL DRESSED")
    dressed_live_cut_weight = Decimal(
        db.query(func.coalesce(func.sum(models.DressedStockEntry.live_weight), 0))
        .filter(models.DressedStockEntry.date == target_date)
        .scalar() or 0
    )
    dressed_yield_weight = Decimal(
        db.query(func.coalesce(func.sum(models.DressedStockEntry.dressed_weight), 0))
        .filter(models.DressedStockEntry.date == target_date)
        .scalar() or 0
    )
    dressed_avg_on_live_weight = decimal_ratio(dressed_sales_amount, dressed_live_cut_weight)
    dressed_yield_percent = (dressed_yield_weight / dressed_live_cut_weight * Decimal("100")) if dressed_live_cut_weight > 0 else Decimal("0")
    sell_through = (total_sales_weight / (opening_total_weight + purchase_total_weight) * Decimal("100")) if (opening_total_weight + purchase_total_weight) > 0 else Decimal("0")
    leakage_percent = (short_weight / closing_weight * Decimal("100")) if closing_weight > 0 else Decimal("0")
    realized_spread = total_sales_rate_value - total_purchase_rate_value
    retail_total_amount = sum(Decimal(str(section["total"]["total"])) for section in ordered_sales_sections if section["title"].upper() in ["RETAIL", "RETAIL DRESSED"])
    retail_mix_percent = (retail_total_amount / total_sales_amount * Decimal("100")) if total_sales_amount > 0 else Decimal("0")
    stock_coverage_days = (closing_weight / total_sales_weight) if total_sales_weight > 0 else Decimal("0")

    return {
        "date": str(target_date),
        "opening_stock": {
            "rows": opening_rows,
            "total": format_sheet_row("TOTAL", opening_total_weight, (opening_total_amount / opening_total_weight) if opening_total_weight > 0 else Decimal("0"), opening_total_amount, opening_total_quantity)
        },
        "purchase_stock": {
            "rows": purchase_rows,
            "total": format_sheet_row("TOTAL", purchase_total_weight, total_purchase_rate, purchase_total_amount, purchase_total_quantity)
        },
        "mortality_stock": {
            "rows": mortality_rows,
            "total": format_sheet_row("TOTAL", mortality_total_weight, Decimal("0"), Decimal("0"), mortality_total_quantity)
        },
        "sales_sections": ordered_sales_sections,
        "final_stock": {
            "total_purchases": format_sheet_row("TOTAL PURCHASES", purchase_total_weight, total_purchase_rate, purchase_total_amount, purchase_total_quantity),
            "mortality": format_sheet_row("MORTALITY", mortality_total_weight, Decimal("0"), Decimal("0"), mortality_total_quantity),
            "sales": format_sheet_row("SALES", total_sales_weight, total_sales_rate, total_sales_amount, total_sales_quantity),
            "closing_stock": format_sheet_row("CLOSING STOCK", closing_weight, closing_rate, closing_amount, closing_quantity),
            "actual_stock": format_sheet_row("ACTUAL STOCK", actual_weight, closing_rate, actual_amount, actual_quantity),
            "short_by": format_sheet_row("SHORT BY", short_weight, closing_rate, short_amount, short_quantity),
            "gross_profit": {
                "rate": float((gross_profit / total_sales_amount * Decimal("100")) if total_sales_amount > 0 else Decimal("0")),
                "total": float(gross_profit)
            }
        },
        "retail_credit_sheet": {
            "rows": retail_credit_rows,
            "total": {
                "label": "TOTAL CREDIT",
                "total_amount": float(retail_credit_total),
                "paid_amount": float(retail_credit_paid),
                "outstanding_amount": float(retail_credit_outstanding)
            }
        },
        "meta": {
            "nag_available": any(value is not None for value in [opening_total_quantity, purchase_total_quantity, total_sales_quantity, actual_quantity])
        },
        "rate_analysis": {
            "purchase_by_hen_type": purchase_rate_rows,
            "sales_by_category": category_rate_rows,
            "sales_by_hen_type_category": category_item_rate_rows
        },
        "business_controls": {
            "category_mix": category_mix_rows,
            "item_performance": item_performance_rows
        },
        "metric_cards": [
            {
                "label": "Opening Stock",
                "value": float(opening_total_weight),
                "suffix": " kg",
                "subvalue": opening_total_quantity is not None and f"{float(opening_total_quantity):.0f} NAG" or None
            },
            {
                "label": "Purchases",
                "value": float(purchase_total_weight),
                "suffix": " kg",
                "subvalue": purchase_total_quantity is not None and f"{float(purchase_total_quantity):.0f} NAG" or None
            },
            {
                "label": "Sales",
                "value": float(total_sales_weight),
                "suffix": " kg",
                "subvalue": total_sales_quantity is not None and f"{float(total_sales_quantity):.0f} NAG" or None
            },
            {
                "label": "Mortality",
                "value": float(mortality_total_weight),
                "suffix": " kg",
                "subvalue": mortality_total_quantity is not None and f"{float(mortality_total_quantity):.0f} NAG" or None
            },
            {
                "label": "Expected Closing",
                "value": float(closing_weight),
                "suffix": " kg",
                "subvalue": closing_quantity is not None and f"{float(closing_quantity):.0f} NAG" or None
            },
            {
                "label": "Actual Stock",
                "value": float(actual_weight),
                "suffix": " kg",
                "subvalue": actual_quantity is not None and f"{float(actual_quantity):.0f} NAG" or None
            },
            {
                "label": "Short By",
                "value": float(short_weight),
                "suffix": " kg",
                "subvalue": short_quantity is not None and f"{float(short_quantity):.0f} NAG" or None
            },
            {
                "label": "Avg Buy Rate",
                "value": float(total_purchase_rate_value),
                "suffix": "/kg"
            },
            {
                "label": "Avg Sale Rate",
                "value": float(total_sales_rate_value),
                "suffix": "/kg"
            },
            {
                "label": "Leakage %",
                "value": float(leakage_percent),
                "suffix": "%"
            },
            {
                "label": "Sell Through",
                "value": float(sell_through),
                "suffix": "%"
            },
            {
                "label": "Sale-Buy Spread",
                "value": float(realized_spread),
                "suffix": "/kg"
            },
            {
                "label": "Retail Mix",
                "value": float(retail_mix_percent),
                "suffix": "%"
            },
            {
                "label": "Retail Credit",
                "value": float(retail_credit_outstanding),
                "prefix": "Rs "
            },
            {
                "label": "Dressed Sale",
                "value": float(dressed_sales_weight),
                "suffix": " kg",
                "subvalue": f"Rs {float(dressed_sales_amount):,.2f}" if dressed_sales_amount > 0 else None
            },
            {
                "label": "Dressed Avg",
                "value": float(dressed_avg_on_live_weight),
                "suffix": "/live kg",
                "subvalue": f"Live cut {float(dressed_live_cut_weight):.3f} kg" if dressed_live_cut_weight > 0 else None
            },
            {
                "label": "Stock Cover",
                "value": float(stock_coverage_days),
                "suffix": " days"
            },
            {
                "label": "Gross Profit",
                "value": float((gross_profit / total_sales_amount * Decimal('100')) if total_sales_amount > 0 else Decimal('0')),
                "suffix": "%",
                "subvalue": f"Rs {float(gross_profit):,.2f}"
            }
        ],
        "special_sections": {
            "dressed_retail": next((section for section in ordered_sales_sections if section["title"].upper() == "RETAIL DRESSED"), None),
            "dressed_cutting_summary": {
                "live_weight_cut": float(dressed_live_cut_weight),
                "dressed_weight_prepared": float(dressed_yield_weight),
                "dressed_weight_sold": float(dressed_sales_weight),
                "dressed_sales_amount": float(dressed_sales_amount),
                "avg_amount_per_live_kg": float(dressed_avg_on_live_weight),
                "yield_percent": float(dressed_yield_percent)
            }
        }
    }


@app.get("/inventory/by-item")
def inventory_by_item(date: str, db: Session = Depends(get_db)):
    target_date = parse_input_date(date)
    if not target_date:
        return {"error": "Invalid date format"}

    items = stock_item_names_query(db)

    result = []
    processed_by_item = {
        row.item_type: row
        for row in db.query(models.DailyItemStock).filter(
            models.DailyItemStock.date == target_date
        ).all()
    }

    openings_by_item = {}
    openings = db.query(models.ItemOpeningStock).filter(
        models.ItemOpeningStock.date <= target_date
    ).order_by(
        models.ItemOpeningStock.item_type.asc(),
        models.ItemOpeningStock.date.desc()
    ).all()

    for opening in openings:
        openings_by_item.setdefault(opening.item_type, opening)

    txns_by_item = {}
    txns = db.query(models.Transaction).filter(
        models.Transaction.date <= target_date,
        models.Transaction.item_type.isnot(None),
        models.Transaction.type.in_(["PURCHASE", "SALE"])
    ).all()

    for txn in txns:
        txns_by_item.setdefault(txn.item_type, []).append(txn)

    for item in sorted(items):
        processed = processed_by_item.get(item)

        if processed:
            result.append({
                "item": item,
                "opening_date": str(target_date),
                "opening_weight": float(processed.opening_weight or 0),
                "purchase_weight": float(processed.purchase_weight or 0),
                "sales_weight": float(processed.sales_weight or 0),
                "expected_closing_weight": float(processed.expected_closing_weight or 0),
                "actual_closing_weight": float(processed.actual_closing_weight or 0),
                "leakage": float(processed.leakage or 0),
                "closing_weight": float(processed.actual_closing_weight or 0)
            })
            continue

        opening = openings_by_item.get(item)

        opening_date = opening.date if opening else None
        opening_weight = Decimal(opening.opening_weight or 0) if opening else Decimal("0")

        item_txns = txns_by_item.get(item, [])
        if opening_date:
            item_txns = [txn for txn in item_txns if txn.date >= opening_date]

        purchase_weight = sum(Decimal(t.weight or 0) for t in item_txns if t.type == "PURCHASE")
        sales_weight = sum(Decimal(t.weight or 0) for t in item_txns if t.type == "SALE")
        closing_weight = opening_weight + purchase_weight - sales_weight

        result.append({
            "item": item,
            "opening_date": str(opening_date) if opening_date else None,
            "opening_weight": float(opening_weight),
            "purchase_weight": float(purchase_weight),
            "sales_weight": float(sales_weight),
            "expected_closing_weight": float(closing_weight),
            "actual_closing_weight": None,
            "leakage": None,
            "closing_weight": float(closing_weight)
        })

    return {"inventory": result}


@app.get("/items/search")
def search_items(q: str = "", db: Session = Depends(get_db)):
    normalized_query = q.strip().lower()
    items = stock_item_names_query(db)

    results = sorted(
        item for item in items
        if not normalized_query or normalized_query in item.lower()
    )[:20]

    return {"results": results}


@app.get("/analytics/profit-by-item")
def profit_by_item(start_date: str, end_date: str, db: Session = Depends(get_db)):
    start = parse_input_date(start_date)
    end = parse_input_date(end_date)
    if not start or not end:
        return {"error": "Invalid date format"}

    rows = db.query(
        models.Transaction.item_type.label("item"),
        func.sum(
            case(
                (models.Transaction.type == "SALE", models.Transaction.amount),
                else_=0
            )
        ).label("sales"),
        func.sum(
            case(
                (models.Transaction.type == "PURCHASE", models.Transaction.amount),
                else_=0
            )
        ).label("purchase")
    ).filter(
        models.Transaction.date.between(start, end),
        models.Transaction.item_type.isnot(None)
    ).group_by(
        models.Transaction.item_type
    ).order_by(
        models.Transaction.item_type.asc()
    ).all()

    return [
        {
            "item": row.item,
            "sales": float(row.sales or 0),
            "purchase": float(row.purchase or 0),
            "profit": float((row.sales or 0) - (row.purchase or 0))
        }
        for row in rows
    ]

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=10000)
