"""Live-bird reconciliation. Counts come only from the preceding day's actuals."""

from collections import defaultdict, deque
from datetime import timedelta
from decimal import Decimal
from sqlalchemy import case, func

from app import models


SOURCE_ITEMS = ("BB", "CB", "COCREL", "LEGOAN", "DP")
SOURCE_ALIASES = {
    **{name: name for name in SOURCE_ITEMS},
    **{name: "BB" for name in (
        "BB HOTEL", "BB SHOP", "BB WHOLESALE", "BB DRESS", "B. DRESS",
        "BONE", "BONELESS", "DRESS", "LEG PIC", "LEG THAI",
        "THAI BONELESS", "THAIL BONLESS", "WINGS",
    )},
    **{name: "CB" for name in ("CB HOTEL", "CB SHOP", "CB WHOLESALE")},
    "COCKREL": "COCREL", "COCKEREL": "COCREL", "LEGOON": "LEGOAN",
}
ZERO = Decimal("0")


def normalize_source(value):
    key = " ".join(str(value or "").upper().split())
    return SOURCE_ALIASES.get(key, key)


def number(value):
    return Decimal(str(value)) if value is not None else None


def complete_sum(values):
    values = list(values)
    return None if any(value is None for value in values) else sum(values, ZERO)


def difference(left, right):
    return None if left is None or right is None else left - right


def stock_value(weight, rate):
    if weight == 0:
        return ZERO
    return None if weight is None or rate is None else weight * rate


class StockHistory:
    """Load once per outlet/request; never trust persisted derived stock columns.

    Live stock uses daily weighted-average purchase cost. Dressed stock costs are
    transferred from live cuts into FIFO output batches; unknown yields/costs
    remain unknown rather than creating fictitious profit.
    """

    def __init__(self, db, outlet_id, end):
        self.actual_rows = db.query(models.DailyItemStock).filter(
            models.DailyItemStock.outlet_id == outlet_id,
            models.DailyItemStock.date <= end,
        ).all()
        # Daily stock math needs totals, not every historical bill line.
        self.transactions = db.query(
            models.Transaction.date.label("date"), models.Transaction.type.label("type"),
            models.Transaction.item_type.label("item_type"), models.Transaction.category.label("category"),
            func.sum(models.Transaction.weight).label("weight"),
            func.sum(models.Transaction.amount).label("amount"),
            case((func.count(models.Transaction.quantity) < func.count(models.Transaction.id), None),
                 else_=func.sum(models.Transaction.quantity)).label("quantity"),
        ).filter(
            models.Transaction.outlet_id == outlet_id,
            models.Transaction.date <= end,
            models.Transaction.type.in_(["PURCHASE", "SALE", "MORTALITY"]),
        ).group_by(models.Transaction.date, models.Transaction.type, models.Transaction.item_type,
                   models.Transaction.category).order_by(models.Transaction.date).all()
        self.cuts = db.query(models.DressedStockEntry).filter(
            models.DressedStockEntry.outlet_id == outlet_id,
            models.DressedStockEntry.date <= end,
        ).order_by(models.DressedStockEntry.date, models.DressedStockEntry.created_at, models.DressedStockEntry.id).all()
        self.actuals = defaultdict(lambda: defaultdict(list))
        self.txns = defaultdict(list)
        self.cuts_by_date = defaultdict(list)
        for row in self.actual_rows:
            self.actuals[row.date][normalize_source(row.item_type)].append(row)
        for txn in self.transactions:
            self.txns[txn.date].append(txn)
        for cut in self.cuts:
            self.cuts_by_date[cut.date].append(cut)
        self.snapshots = {}
        self.rates = {}
        self.dressed_batches = defaultdict(deque)
        self.dressed_unknown = set()
        first = min(set(self.actuals) | set(self.txns) | set(self.cuts_by_date) | {end})
        for offset in range((end - first).days + 1):
            day = first + timedelta(days=offset)
            self.snapshots[day] = self._calculate(day)

    def count(self, day, item, field):
        rows = self.actuals.get(day, {}).get(item, [])
        values = {number(getattr(row, field)) for row in rows}
        # Conflicting legacy aliases require a fresh count, not a guessed sum.
        return next(iter(values)) if len(values) == 1 else None

    def snapshot(self, day):
        if day in self.snapshots:
            return self.snapshots[day]
        if day < min(self.snapshots):
            # Before the first record there is no physical opening or actual count.
            return StockHistory.empty_snapshot(day)
        raise ValueError("Stock history must include the requested end date")

    @staticmethod
    def empty_snapshot(day):
        history = object.__new__(StockHistory)
        history.actuals = {}
        history.txns = {}
        history.cuts_by_date = {}
        history.rates = {}
        history.dressed_batches = defaultdict(deque)
        history.dressed_unknown = set()
        return history._calculate(day)

    def _calculate(self, day):
        previous = day - timedelta(days=1)
        warnings = []
        rows = {}
        for item in SOURCE_ITEMS:
            rows[item] = {
                "item": item,
                "opening_weight": self.count(previous, item, "actual_closing_weight"),
                "opening_quantity": self.count(previous, item, "actual_closing_quantity"),
                "actual_closing_weight": self.count(day, item, "actual_closing_weight"),
                "actual_closing_quantity": self.count(day, item, "actual_closing_quantity"),
                "opening_rate": self.rates.get(item),
                **{key: ZERO for key in (
                    "purchase_weight", "purchase_quantity", "purchase_amount", "sales_weight",
                    "sales_quantity", "sales_amount", "mortality_weight", "mortality_quantity",
                    "cut_weight", "cut_quantity", "dressed_sales_weight", "dressed_sales_amount",
                )},
            }
        unknown_movements = False
        extra_revenue = ZERO
        for txn in self.txns.get(day, []):
            item = normalize_source(txn.item_type)
            weight = number(txn.weight) or ZERO
            qty = number(txn.quantity)
            amount = number(txn.amount) or ZERO
            if item not in rows:
                if txn.type == "SALE" and weight == 0 and not qty:
                    extra_revenue += amount
                    continue
                warnings.append(f"Unmapped stock type: {txn.item_type or 'blank'}")
                unknown_movements = True
                continue
            row = rows[item]
            if txn.type == "SALE" and str(txn.category or "").upper() == "RETAIL DRESSED":
                row["dressed_sales_weight"] += weight
                row["dressed_sales_amount"] += amount
                continue
            prefix = {"PURCHASE": "purchase", "SALE": "sales", "MORTALITY": "mortality"}[txn.type]
            row[f"{prefix}_weight"] += weight
            old_qty = row[f"{prefix}_quantity"]
            row[f"{prefix}_quantity"] = None if old_qty is None or (qty is None and weight) else old_qty + (qty or ZERO)
            if prefix != "mortality":
                row[f"{prefix}_amount"] += amount

        for cut in self.cuts_by_date.get(day, []):
            item = normalize_source(cut.item_name)
            if item not in rows:
                warnings.append(f"Set the live hen type for dressed cutting: {cut.item_name}")
                unknown_movements = True
                continue
            row = rows[item]
            row["cut_weight"] = complete_sum([row["cut_weight"], number(cut.live_weight)])
            row["cut_quantity"] = complete_sum([row["cut_quantity"], number(cut.live_quantity)])

        for item, row in rows.items():
            opening = row["opening_weight"]
            purchase = row["purchase_weight"]
            opening_rate = row["opening_rate"]
            row["opening_amount"] = stock_value(opening, opening_rate)
            if opening == 0 and purchase > 0:
                rate = row["purchase_amount"] / purchase
            elif opening is not None and opening > 0 and opening_rate is not None:
                rate = (opening * opening_rate + row["purchase_amount"]) / (opening + purchase)
            elif purchase > 0 and opening is None:
                # A known acquisition cost may value a subsequent physical count;
                # it never supplies the missing opening quantity for this day.
                rate = row["purchase_amount"] / purchase
            else:
                rate = opening_rate
            if rate is not None:
                self.rates[item] = rate
            row["rate"] = rate
            for unit in ("weight", "quantity"):
                row[f"expected_closing_{unit}"] = difference(
                    complete_sum([row[f"opening_{unit}"], row[f"purchase_{unit}"]]),
                    complete_sum([row[f"sales_{unit}"], row[f"mortality_{unit}"], row[f"cut_{unit}"]]),
                )
            row["leakage"] = difference(row["expected_closing_weight"], row["actual_closing_weight"])
            row["quantity_leakage"] = difference(row["expected_closing_quantity"], row["actual_closing_quantity"])
            row["closing_amount"] = stock_value(row["expected_closing_weight"], rate)
            row["actual_amount"] = stock_value(row["actual_closing_weight"], rate)
            row["short_amount"] = stock_value(row["leakage"], rate)
            row["live_cost"] = stock_value(row["sales_weight"], rate)
            row["mortality_cost"] = stock_value(row["mortality_weight"], rate)
            if row["expected_closing_weight"] is None or row["expected_closing_weight"] < 0:
                row["live_cost"] = None if row["sales_weight"] else ZERO

        for cut in self.cuts_by_date.get(day, []):
            item = normalize_source(cut.item_name)
            if item not in rows:
                continue
            output = number(cut.dressed_weight)
            live = number(cut.live_weight)
            cost = stock_value(live, rows[item]["rate"])
            if output is None or output <= 0 or live is None or live <= 0:
                self.dressed_unknown.add(item)
                continue
            self.dressed_batches[item].append([output, None if cost is None else cost / output])

        for item, row in rows.items():
            required = row["dressed_sales_weight"]
            costs = []
            while required > 0 and self.dressed_batches[item]:
                batch = self.dressed_batches[item][0]
                used = min(batch[0], required)
                costs.append(stock_value(used, batch[1]))
                batch[0] -= used
                required -= used
                if batch[0] == 0:
                    self.dressed_batches[item].popleft()
            if required > 0 or (row["dressed_sales_weight"] > 0 and item in self.dressed_unknown):
                costs.append(None)
            row["dressed_cost"] = complete_sum(costs)
            row["gross_profit"] = difference(
                row["sales_amount"] + row["dressed_sales_amount"],
                complete_sum([row["live_cost"], row["dressed_cost"], row["mortality_cost"]]),
            )

        if unknown_movements:
            # An unidentified movement can affect any source. Do not let the
            # item inventory imply reconciliation while the sheet total is N/A.
            for row in rows.values():
                for key in ("expected_closing_weight", "expected_closing_quantity", "leakage", "quantity_leakage", "gross_profit", "closing_amount", "short_amount"):
                    row[key] = None

        keys = [key for key in next(iter(rows.values())) if key not in ("item", "rate", "opening_rate")]
        totals = {key: complete_sum(row[key] for row in rows.values()) for key in keys}
        totals["gross_profit"] = complete_sum([totals["gross_profit"], extra_revenue])
        if unknown_movements:
            for key in ("expected_closing_weight", "expected_closing_quantity", "leakage", "quantity_leakage", "gross_profit", "closing_amount", "short_amount"):
                totals[key] = None
        if totals["opening_weight"] is None:
            warnings.append(f"Live opening count is incomplete for {previous:%d/%m/%Y}.")
        if any(key not in SOURCE_ITEMS for key in self.actuals.get(day, {})):
            warnings.append("Actual stock contains an unmapped hen type; re-enter the five live-bird counts.")
        if totals["gross_profit"] is None:
            warnings.append("Gross profit is unavailable until stock sources, purchase costs and dressed yields are complete.")
        return {"date": day, "rows": list(rows.values()), "totals": totals, "warning": " ".join(dict.fromkeys(warnings)) or None}


def refresh_stock_snapshots(db, outlet_id, start):
    """Repair derived fields after a backdated count; never rewrite physical counts."""
    db.flush()
    records = db.query(models.DailyItemStock).filter(
        models.DailyItemStock.outlet_id == outlet_id,
        models.DailyItemStock.date >= start,
    ).all()
    if not records:
        return
    history = StockHistory(db, outlet_id, max(row.date for row in records))
    derived = ("opening_quantity", "opening_weight", "purchase_quantity", "purchase_weight", "sales_quantity", "sales_weight", "expected_closing_quantity", "expected_closing_weight", "quantity_leakage", "leakage")
    for record in records:
        item = normalize_source(record.item_type)
        values = next((row for row in history.snapshot(record.date)["rows"] if row["item"] == item), None)
        if values:
            for key in derived:
                setattr(record, key, values[key])
    existing = {row.date: row for row in db.query(models.DailyStock).filter(
        models.DailyStock.outlet_id == outlet_id, models.DailyStock.date >= start,
    ).all()}
    for day in sorted({row.date for row in records}):
        record = existing.get(day)
        if record is None:
            record = models.DailyStock(outlet_id=outlet_id, date=day)
            db.add(record)
        totals = history.snapshot(day)["totals"]
        for key in ("opening_weight", "purchase_weight", "sales_weight", "expected_closing_weight", "actual_closing_weight", "leakage"):
            setattr(record, key, totals[key])
    return history
