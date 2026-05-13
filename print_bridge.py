import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


HOST = "127.0.0.1"
PORT = 9876
CHARS_PER_LINE = 42


def esc_init() -> bytes:
    return b"\x1b@"


def esc_align(mode: str) -> bytes:
    mapping = {"left": 0, "center": 1, "right": 2}
    return b"\x1ba" + bytes([mapping.get(mode, 0)])


def esc_bold(enabled: bool) -> bytes:
    return b"\x1bE" + (b"\x01" if enabled else b"\x00")


def esc_double(enabled: bool) -> bytes:
    return b"\x1d!" + (b"\x11" if enabled else b"\x00")


def esc_feed(lines: int = 1) -> bytes:
    return b"\n" * max(1, int(lines))


def esc_cut() -> bytes:
    return b"\x1dV\x00"


def encode_line(text: str) -> bytes:
    return text.encode("cp437", errors="replace") + b"\n"


def money(value: Any) -> str:
    try:
        return f"{float(value or 0):.2f}"
    except Exception:
        return "0.00"


def decimal3(value: Any) -> str:
    try:
        return f"{float(value or 0):.3f}"
    except Exception:
        return "0.000"


def integerish(value: Any) -> str:
    try:
        num = float(value or 0)
    except Exception:
        return "0"
    return str(int(num)) if num.is_integer() else str(num)


def hr() -> str:
    return "-" * CHARS_PER_LINE


def center(text: str) -> bytes:
    return esc_align("center") + encode_line(text) + esc_align("left")


def wrap_text(text: str, width: int):
    text = str(text or "").strip()
    if not text:
        return [""]
    words = text.split()
    lines = []
    current = ""
    for word in words:
        if not current:
            current = word
            continue
        if len(current) + 1 + len(word) <= width:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def lr(left: str, right: str, width: int = CHARS_PER_LINE) -> str:
    left = str(left or "")
    right = str(right or "")
    if len(left) + len(right) + 1 <= width:
        return left + (" " * (width - len(left) - len(right))) + right
    available = max(1, width - len(right) - 1)
    left = left[:available]
    return left + " " + right.rjust(width - len(left) - 1)


def retail_item_lines(item: dict, index: int):
    line_type = str(item.get("line_type") or "STANDARD").upper()
    if line_type == "DRESSED":
        item_width, kgs_width, rate_width, amount_width = 19, 5, 6, 8
        name_lines = wrap_text(item.get("item_name") or "", item_width)
        lines = []
        first = name_lines[0]
        lines.append(
            f"{str(index).rjust(2)} "
            f"{first.ljust(item_width)} "
            f"{decimal3(item.get('weight')).rjust(kgs_width)} "
            f"{money(item.get('rate')).rjust(rate_width)} "
            f"{money(item.get('amount')).rjust(amount_width)}"
        )
        for cont in name_lines[1:]:
            lines.append(f"   {cont}")
        return lines

    item_width, nag_width, kgs_width, rate_width, amount_width = 12, 3, 6, 5, 8
    name_lines = wrap_text(item.get("item_name") or "", item_width)
    lines = []
    first = name_lines[0]
    lines.append(
        f"{str(index).rjust(2)} "
        f"{first.ljust(item_width)} "
        f"{integerish(item.get('nag')).rjust(nag_width)} "
        f"{decimal3(item.get('weight')).rjust(kgs_width)} "
        f"{money(item.get('rate')).rjust(rate_width)} "
        f"{money(item.get('amount')).rjust(amount_width)}"
    )
    for cont in name_lines[1:]:
        lines.append(f"   {cont}")
    return lines


def build_retail_bytes(payload: dict) -> bytes:
    shop = payload.get("shop") or {}
    bill = payload.get("bill") or {}
    items = bill.get("items") or []
    is_dressed_only = bool(items) and all(str(i.get("line_type") or "STANDARD").upper() == "DRESSED" for i in items)

    out = bytearray()
    out += esc_init()
    out += center("INVOICE")
    out += esc_bold(True) + esc_double(True) + center(str(shop.get("name") or "Shop")) + esc_double(False) + esc_bold(False)
    for line in [shop.get("proprietor"), shop.get("address"), f"Mob. {shop.get('phone') or ''}"]:
        if line:
            out += center(str(line))
    out += encode_line(hr())
    out += encode_line(lr("Bill no", str(bill.get("bill_number") or "")))
    out += encode_line(lr("Date", str(bill.get("date") or "")))
    out += encode_line(lr("Time", str(bill.get("time") or "")))
    out += encode_line(lr("Cashier", str(bill.get("cashier_name") or "admin")))

    if bill.get("customer_name"):
      out += encode_line("")
      out += encode_line(f"Customer: {bill.get('customer_name')}")
    if bill.get("customer_phone"):
      out += encode_line(f"Phone   : {bill.get('customer_phone')}")
    if bill.get("customer_address"):
      out += encode_line(f"Address : {bill.get('customer_address')}")

    out += encode_line(hr())
    if is_dressed_only:
        out += encode_line("Sl Item Name             KGS   Rate  Amount")
    else:
        out += encode_line("Sl Item Name      Nag    KGS  Rate   Amount")
    out += encode_line(hr())

    for idx, item in enumerate(items, start=1):
        for line in retail_item_lines(item, idx):
            out += encode_line(line)

    out += encode_line(hr())
    if is_dressed_only:
        out += esc_bold(True) + encode_line(
            lr("Total", f"{decimal3(bill.get('total_weight'))} {money(bill.get('total_amount'))}".rjust(20))
        ) + esc_bold(False)
    else:
        out += esc_bold(True) + encode_line(
            f"{'Total':<15}{integerish(bill.get('total_nag')).rjust(4)} {decimal3(bill.get('total_weight')).rjust(8)} {money(bill.get('total_amount')).rjust(11)}"
        ) + esc_bold(False)

    if float(bill.get("ice_amount") or 0) > 0:
        out += encode_line(lr("Items Total", money(bill.get("items_subtotal_amount"))))
        out += encode_line(lr("Ice Amount", money(bill.get("ice_amount"))))
        out += esc_bold(True) + encode_line(lr("TOTAL", money(bill.get("total_amount")))) + esc_bold(False)

    out += encode_line(lr(f"{bill.get('payment_mode') or 'Cash'} Payment", money(bill.get("paid_amount"))))
    out += encode_line(lr("Outstanding", money(bill.get("outstanding_amount"))))
    if bill.get("notes"):
        out += encode_line(hr())
        for line in wrap_text(str(bill.get("notes")), CHARS_PER_LINE):
            out += encode_line(line)

    out += encode_line(hr())
    out += center("Thank You")
    out += center("Visit Again")
    out += esc_feed(4)
    out += esc_cut()
    return bytes(out)


def build_payment_receipt_bytes(payload: dict) -> bytes:
    shop = payload.get("shop") or {}
    receipt = payload.get("receipt") or {}
    direction = str(receipt.get("direction") or "RECEIVED").upper()
    title = "Payment Voucher" if direction == "PAID" else "Payment Receipt"
    amount_label = "Amount Paid" if direction == "PAID" else "Amount Received"

    out = bytearray()
    out += esc_init()
    out += center(title)
    out += esc_bold(True) + esc_double(True) + center(str(shop.get("name") or "Shop")) + esc_double(False) + esc_bold(False)
    for line in [shop.get("proprietor"), shop.get("address"), f"Mob. {shop.get('phone') or ''}"]:
        if line:
            out += center(str(line))
    out += encode_line(hr())
    out += encode_line(lr("Receipt no", str(receipt.get("receipt_number") or "")))
    out += encode_line(lr("Date", str(receipt.get("date") or "")))
    out += encode_line(lr("Time", str(receipt.get("time") or "")))
    out += encode_line(lr("Handled by", str(receipt.get("cashier_name") or "admin")))
    if receipt.get("party_name"):
        out += encode_line("")
        out += encode_line(f"Party  : {receipt.get('party_name')}")
    if receipt.get("party_phone"):
        out += encode_line(f"Phone  : {receipt.get('party_phone')}")
    if receipt.get("party_address"):
        out += encode_line(f"Address: {receipt.get('party_address')}")
    out += encode_line(hr())
    out += encode_line(lr("Direction", direction))
    out += encode_line(lr("Mode", str(receipt.get("payment_mode") or "Cash")))
    out += esc_bold(True) + encode_line(lr(amount_label, money(receipt.get("amount")))) + esc_bold(False)
    out += encode_line(lr("Balance After", money(receipt.get("balance_after"))))
    if receipt.get("notes"):
        out += encode_line(hr())
        for line in wrap_text(str(receipt.get("notes")), CHARS_PER_LINE):
            out += encode_line(line)
    out += encode_line(hr())
    out += center("Thank You")
    out += center("Visit Again")
    out += esc_feed(4)
    out += esc_cut()
    return bytes(out)


def print_raw(raw_bytes: bytes, printer_name: str | None = None):
    try:
        import win32print  # type: ignore
    except Exception as exc:
        raise RuntimeError("pywin32 is not installed. Install it with: pip install pywin32") from exc

    target_printer = printer_name or win32print.GetDefaultPrinter()
    if not target_printer:
        raise RuntimeError("No default printer configured")

    handle = win32print.OpenPrinter(target_printer)
    try:
        job = win32print.StartDocPrinter(handle, 1, ("KNP Signature Receipt", None, "RAW"))
        try:
            win32print.StartPagePrinter(handle)
            win32print.WritePrinter(handle, raw_bytes)
            win32print.EndPagePrinter(handle)
        finally:
            win32print.EndDocPrinter(handle)
    finally:
        win32print.ClosePrinter(handle)
    return target_printer


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload: dict):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok"})
        if self.path == "/printers":
            try:
                import win32print  # type: ignore
                flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
                printers = [entry[2] for entry in win32print.EnumPrinters(flags)]
                default_printer = win32print.GetDefaultPrinter()
                return self._json(200, {"default_printer": default_printer, "printers": printers})
            except Exception as exc:
                return self._json(500, {"error": str(exc)})
        return self._json(404, {"error": "Not found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", "0") or 0)
        raw_body = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "Invalid JSON"})

        try:
            printer_name = payload.get("printer_name")
            if self.path == "/print/retail":
                raw_bytes = build_retail_bytes(payload)
            elif self.path == "/print/payment-receipt":
                raw_bytes = build_payment_receipt_bytes(payload)
            else:
                return self._json(404, {"error": "Not found"})

            used_printer = print_raw(raw_bytes, printer_name)
            return self._json(200, {"status": "printed", "printer": used_printer})
        except Exception as exc:
            return self._json(500, {"error": str(exc)})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"KNP Signature print bridge running on http://{HOST}:{PORT}")
    server.serve_forever()
