const RETAIL_SHOP_PROFILE = {
  name: "NP Chicken Shop",
  proprietor: "Prop. Sandeep S. Alag (Appu)",
  address: "Shop No. 58, Kamaal Chowk Bazaar, Nagpur",
  phone: "9371291195 / 7972329562"
};

const RETAIL_PAYMENT_QR_VIEW = {
  label: "Scan & Pay",
  imageSrc: "assets/payment-qr.png",
  upiId: "soney.1105-1@okicici"
};

const RETAIL_PENDING_STORAGE_KEY = "stockpilot.retail.pending";
const RETAIL_BILL_HISTORY_PAGE_SIZE = 30;
const LOCAL_PRINT_BRIDGE_URL = localStorage.getItem("stockpilot.printBridgeUrl") || "http://127.0.0.1:9876";

let retailItemSuggestTimer = null;
let retailCustomerSuggestTimer = null;
let paymentReceiptSuggestTimer = null;
let currentRetailBill = null;
let currentPaymentReceipt = null;
let retailDraftDirty = false;
let retailBillCompleted = false;
let paymentReceiptDraftDirty = false;
let paymentReceiptCompleted = false;
let retailConnectivityListenersAttached = false;
let dressedStockCache = [];
let retailBillingMode = "regular";
let retailPreviewRenderTimer = null;
let paymentReceiptPreviewRenderTimer = null;
let retailPageBootstrapped = false;
let paymentReceiptHistoryLoaded = false;
let dressedStockLoadedForDate = "";
let retailPartyDirectoryCache = [];
let retailPartyDirectoryLoaded = false;
let retailPartyDirectoryPromise = null;
let retailShortcutsCache = [];
let retailShortcutsLoaded = false;
let retailShortcutsPromise = null;
let retailShortcutsOutletId = "";
let retailBillHistoryServerBills = [];
let retailBillHistoryDate = "";
let retailBillHistoryLoaded = false;
let retailBillHistoryHasMore = false;
let retailBillHistoryNextOffset = 0;
let retailBillHistoryRequestId = 0;
const retailPartyBalanceByMode = {
  regular: 0,
  dressed: 0
};
let retailSuggestHideTimer = null;

async function printThroughLocalBridge(path, payload) {
  const response = await fetch(`${LOCAL_PRINT_BRIDGE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Printer bridge failed (${response.status})`);
  }
  return data;
}

function buildRetailBridgePayload(bill) {
  return {
    shop: RETAIL_SHOP_PROFILE,
    bill: {
      bill_number: bill.bill_number,
      date: bill.date,
      time: bill.time || new Date().toLocaleTimeString("en-GB"),
      cashier_name: bill.cashier_name || "admin",
      customer_name: bill.customer_name || "",
      customer_phone: bill.customer_phone || "",
      customer_address: bill.customer_address || "",
      payment_mode: bill.payment_mode || "Cash",
      paid_amount: Number(bill.paid_amount || 0),
      outstanding_amount: Number(bill.outstanding_amount || 0),
      running_balance: Number(bill.party_balance ?? bill.outstanding_amount ?? 0),
      total_amount: Number(bill.total_amount || 0),
      total_weight: Number(bill.total_weight || 0),
      total_nag: Number(bill.total_nag || bill.total_quantity || 0),
      ice_amount: Number(bill.ice_amount || 0),
      items_subtotal_amount: Number(bill.items_subtotal_amount ?? (Number(bill.total_amount || 0) - Number(bill.ice_amount || 0))),
      notes: bill.notes || "",
      items: (bill.items || []).map(item => ({
        item_name: item.item_name || "",
        line_type: item.line_type || "STANDARD",
        nag: Number(item.nag || item.quantity || 0),
        weight: Number(item.weight || 0),
        rate: Number(item.rate || 0),
        amount: Number(item.amount || 0)
      }))
    }
  };
}

function buildPaymentReceiptBridgePayload(receipt) {
  return {
    shop: RETAIL_SHOP_PROFILE,
    receipt: {
      receipt_number: receipt.receipt_number,
      date: receipt.date,
      time: receipt.time || new Date().toLocaleTimeString("en-GB"),
      cashier_name: receipt.cashier_name || "admin",
      party_name: receipt.party_name || "",
      party_phone: receipt.party_phone || "",
      party_address: receipt.party_address || "",
      old_balance: getPaymentReceiptOldBalanceValue(receipt),
      direction: receipt.direction || "RECEIVED",
      payment_mode: receipt.payment_mode || "Cash",
      amount: Number(receipt.amount || 0),
      balance_after: Number(receipt.balance_after || 0),
      notes: receipt.notes || ""
    }
  };
}

function openRetailBrowserPrintWindow(bill) {
  const printWindow = window.open("", "_blank", "width=420,height=820");
  if (!printWindow) {
    showToast("Allow popups to print bill");
    return false;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Retail Bill ${escapeHtml(bill.bill_number)}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body { margin: 0; font-family: "Courier New", monospace; background: white; color: #111; }
          .bill { width: 76mm; margin: 0 auto; padding: 4mm 2.5mm 5mm; }
          .thermal-bill { width: 100%; color: #111; }
          .thermal-label, .thermal-header-mini, .thermal-rule, .thermal-note-mini { text-align: center; }
          .thermal-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
          .thermal-center { text-align: center; }
          .thermal-center h3 { margin: 2px 0 3px; font-size: 18px; line-height: 1.1; }
          .thermal-center p { margin: 1px 0; font-size: 11px; line-height: 1.25; }
          .thermal-header-mini { margin-top: 4px; font-size: 10px; }
          .thermal-header-title { font-weight: 700; letter-spacing: 0.08em; }
          .thermal-meta-grid { margin-top: 7px; font-size: 11px; }
          .thermal-meta-row { display: flex; justify-content: space-between; gap: 8px; margin: 1px 0; }
          .thermal-customer { margin-top: 6px; font-size: 11px; }
          .thermal-customer p { margin: 1px 0; }
          .thermal-rule { margin: 2px 0 0; font-size: 10px; letter-spacing: 0; }
          .thermal-items-table { width: 100% !important; min-width: 0 !important; max-width: 100% !important; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
          .thermal-items-table th, .thermal-items-table td { padding: 2px 0; vertical-align: top; white-space: nowrap; overflow: hidden; text-overflow: clip; }
          .thermal-items-table th { font-weight: 700; }
          .thermal-items-table th:nth-child(1), .thermal-items-table td:nth-child(1) { width: 6%; text-align: left; }
          .thermal-items-table th:nth-child(2), .thermal-items-table td:nth-child(2) { width: 30%; text-align: left; white-space: normal; overflow-wrap: anywhere; }
          .thermal-items-table th:nth-child(3), .thermal-items-table td:nth-child(3) { width: 15%; text-align: right; padding-right: 6px; }
          .thermal-items-table th:nth-child(4), .thermal-items-table td:nth-child(4) { width: 17%; text-align: right; padding-left: 6px; padding-right: 4px; }
          .thermal-items-table th:nth-child(5), .thermal-items-table td:nth-child(5) { width: 14%; text-align: right; }
          .thermal-items-table th:nth-child(6), .thermal-items-table td:nth-child(6) { width: 18%; text-align: right; }
          .thermal-items-table.thermal-items-table-dressed th:nth-child(1), .thermal-items-table.thermal-items-table-dressed td:nth-child(1) { width: 8%; }
          .thermal-items-table.thermal-items-table-dressed th:nth-child(2), .thermal-items-table.thermal-items-table-dressed td:nth-child(2) { width: 38%; text-align: left; white-space: normal; overflow-wrap: anywhere; }
          .thermal-items-table.thermal-items-table-dressed th:nth-child(3), .thermal-items-table.thermal-items-table-dressed td:nth-child(3) { width: 18%; text-align: right; }
          .thermal-items-table.thermal-items-table-dressed th:nth-child(4), .thermal-items-table.thermal-items-table-dressed td:nth-child(4) { width: 16%; text-align: right; }
          .thermal-items-table.thermal-items-table-dressed th:nth-child(5), .thermal-items-table.thermal-items-table-dressed td:nth-child(5) { width: 20%; text-align: right; }
          .thermal-section-row td { padding-top: 5px; font-weight: 700; border-top: 1px dashed #a8adb7; }
          .thermal-summary { margin-top: 1px; font-size: 11px; }
          .thermal-summary p, .thermal-summary-row { display: flex; justify-content: space-between; gap: 10px; margin: 2px 0; }
          .thermal-summary-compact { margin-bottom: 2px; }
          .thermal-balance-summary { margin-top: 4px; }
          .thermal-totals-table { margin-top: 1px; }
          .thermal-total-row td { padding-top: 3px; font-size: 11px; font-weight: 700; border-top: none; }
          .thermal-total-row td:first-child { text-align: left; }
          .thermal-total { margin-top: 4px; padding-top: 4px; border-top: 1px dashed #666; font-weight: 700; }
          .thermal-notes, .thermal-note-mini { margin-top: 6px; font-size: 10px; line-height: 1.25; }
          .thermal-footer { margin-top: 10px; text-align: center; font-size: 11px; }
          .thermal-footer p { margin: 1px 0; }
        </style>
      </head>
      <body>
        <div class="bill">${getRetailReceiptMarkup(bill)}</div>
        <script>
          window.onload = function () {
            window.print();
            setTimeout(function () { window.close(); }, 250);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
  return true;
}

function openPaymentReceiptBrowserPrintWindow(receipt) {
  const printWindow = window.open("", "_blank", "width=420,height=820");
  if (!printWindow) {
    showToast("Allow popups to print receipt");
    return false;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Payment Receipt ${escapeHtml(receipt.receipt_number)}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body { margin: 0; font-family: "Courier New", monospace; background: white; color: #111; }
          .bill { width: 76mm; margin: 0 auto; padding: 4mm 2.5mm 5mm; }
          .thermal-section-row td { padding-top: 5px; font-weight: 700; border-top: 1px dashed #a8adb7; }
        </style>
      </head>
      <body>
        <div class="bill">${getPaymentReceiptMarkup(receipt)}</div>
        <script>
          window.onload = function () {
            window.print();
            setTimeout(function () { window.close(); }, 250);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
  return true;
}

const RETAIL_MODE_FIELDS = {
  regular: {
    date: "retailDate",
    billNumber: "retailBillNumber",
    cashier: "retailCashier",
    settlementType: "retailSettlementType",
    paymentMode: "retailPaymentMode",
    customerName: "retailCustomerName",
    customerPhone: "retailCustomerPhone",
    customerAddress: "retailCustomerAddress",
    iceAmount: "retailIceAmount",
    paidAmount: "retailPaidAmount",
    notes: "retailNotes"
  },
  dressed: {
    date: "retailDate",
    billNumber: "retailBillNumber",
    cashier: "retailCashier",
    settlementType: "retailSettlementType",
    paymentMode: "retailPaymentMode",
    customerName: "retailCustomerName",
    customerPhone: "retailCustomerPhone",
    customerAddress: "retailCustomerAddress",
    iceAmount: "retailIceAmount",
    paidAmount: "retailPaidAmount",
    notes: "retailNotes"
  }
};

function retailFieldId(mode, field) {
  return RETAIL_MODE_FIELDS[mode]?.[field];
}

function retailField(mode, field) {
  const id = retailFieldId(mode, field);
  return id ? document.getElementById(id) : null;
}

async function initRetailPage() {
  retailPageBootstrapped = false;
  paymentReceiptHistoryLoaded = false;
  dressedStockLoadedForDate = "";
  resetRetailBillHistoryState();
  const regularDate = retailField("regular", "date");
  if (!regularDate) return;

  regularDate.value = formatDateInput(new Date());
  regularDate.addEventListener("change", async () => {
    resetRetailBillHistoryState();
    await refreshRetailBillNumber();
    await loadRetailBills(true);
    if (retailBillingMode === "dressed") {
      await ensureDressedStockLoaded();
    }
    scheduleRetailPreviewRender();
  });

  Array.from(new Set(Object.values(RETAIL_MODE_FIELDS.regular))).forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener("input", markRetailDraftDirty);
    input.addEventListener("change", markRetailDraftDirty);
  });

  const settlementType = retailField("regular", "settlementType");
  if (settlementType) {
    settlementType.addEventListener("change", () => handleRetailSettlementTypeChange());
  }

  const customerNameInput = retailField("regular", "customerName");
  if (customerNameInput) {
    customerNameInput.addEventListener("input", () => resetLinkedRetailPartyFieldsIfNameChanged("regular"));
    customerNameInput.addEventListener("change", () => hydrateRetailCustomerProfile(customerNameInput.value));
    customerNameInput.addEventListener("blur", () => hydrateRetailCustomerProfile(customerNameInput.value));
    customerNameInput.addEventListener("blur", () => scheduleSuggestionBoxHide("retailCustomerSuggestBox"));
  }

  const paymentReceiptDate = document.getElementById("paymentReceiptDate");
  if (paymentReceiptDate) {
    paymentReceiptDate.value = formatDateInput(new Date());
    paymentReceiptDate.addEventListener("change", async () => {
      await refreshPaymentReceiptNumber();
      loadPaymentReceipts();
      if (retailBillingMode === "payment") {
        renderPaymentReceiptPreviewFromForm();
      }
    });
  }

  const paymentReceiptIds = [
    "paymentReceiptDate",
    "paymentReceiptNumber",
    "paymentReceiptCashier",
    "paymentReceiptDirection",
    "paymentReceiptMode",
    "paymentReceiptPartyName",
    "paymentReceiptPartyPhone",
    "paymentReceiptOldBalance",
    "paymentReceiptAmount",
    "paymentReceiptNotes"
  ];

  paymentReceiptIds.forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener("input", markPaymentReceiptDraftDirty);
    input.addEventListener("change", markPaymentReceiptDraftDirty);
  });

  const paymentReceiptPartyName = document.getElementById("paymentReceiptPartyName");
  if (paymentReceiptPartyName) {
    paymentReceiptPartyName.addEventListener("input", resetLinkedPaymentReceiptFieldsIfNameChanged);
    paymentReceiptPartyName.addEventListener("change", () => hydratePaymentReceiptPartyProfile(paymentReceiptPartyName.value));
    paymentReceiptPartyName.addEventListener("blur", () => hydratePaymentReceiptPartyProfile(paymentReceiptPartyName.value));
    paymentReceiptPartyName.addEventListener("blur", () => scheduleSuggestionBoxHide("paymentReceiptPartySuggestBox"));
  }

  attachRetailConnectivityListeners();
  addRegularRetailRow();
  addDressedRetailRow();
  await ensureRetailShortcutsLoaded();
  renderRetailShortcuts();
  renderShortcutManagerList();
  renderRetailOfflineBanner();
  syncRetailSettlementUi();
  setRetailBillingMode("regular", { loadHistory: false });
  refreshRetailBillNumber();
  scheduleRetailPreviewRender();
  loadRetailBills();
  setTimeout(() => ensureRetailPartyDirectoryLoaded(), 120);
  setTimeout(() => ensureDressedStockLoaded(), 180);
  setTimeout(() => syncPendingRetailBills(true), 320);
  retailPageBootstrapped = true;
}

async function initRetailSetupPage() {
  const setupDate = document.getElementById("retailDate");
  if (!setupDate) return;

  dressedStockLoadedForDate = "";
  setupDate.value = formatDateInput(new Date());
  setupDate.addEventListener("change", async () => {
    dressedStockLoadedForDate = "";
    if (retailBillingMode === "dressed") {
      await ensureDressedStockLoaded();
    }
  });

  await ensureRetailShortcutsLoaded();
  renderShortcutManagerList();
  setRetailBillingMode("regular");
  ensureRetailPartyDirectoryLoaded();
}

function setRetailBillingMode(mode, options = {}) {
  const { loadHistory = true } = options;
  retailBillingMode = mode === "dressed" ? "dressed" : mode === "payment" ? "payment" : "regular";
  const onSetupPage = isRetailSetupPage();
  const regularButton = document.getElementById("retailModeRegular");
  const dressedButton = document.getElementById("retailModeDressed");
  const paymentButton = document.getElementById("retailModePayment");
  const salesSection = document.getElementById("retailSalesSection");
  const regularSection = document.getElementById("retailRegularSection");
  const dressedSection = document.getElementById("retailDressedSection");
  const paymentSection = document.getElementById("paymentReceiptSection");
  const setupSection = document.querySelector(".retail-setup-panel");
  const dressedStockSetupSection = document.getElementById("dressedStockSetupSection");
  const shortcutLineType = document.getElementById("shortcutLineType");
  const shortcutManagerHelp = document.getElementById("shortcutManagerHelp");
  const shortcutRate = document.getElementById("shortcutRate");
  const shortcutUnit = document.getElementById("shortcutUnit");
  const retailHistorySection = document.getElementById("retailBillHistorySection");
  const paymentHistorySection = document.getElementById("paymentReceiptHistorySection");
  const modeTitle = document.getElementById("retailModeTitle");
  const previewTitle = document.getElementById("retailPreviewTitle");
  const addItemButton = document.getElementById("retailAddItemButton");

  if (regularButton) regularButton.classList.toggle("active", retailBillingMode === "regular");
  if (dressedButton) dressedButton.classList.toggle("active", retailBillingMode === "dressed");
  if (paymentButton) paymentButton.classList.toggle("active", retailBillingMode === "payment");
  if (salesSection) salesSection.style.display = retailBillingMode === "payment" ? "none" : "";
  if (regularSection) regularSection.style.display = onSetupPage ? (retailBillingMode === "regular" ? "" : "none") : "";
  if (dressedSection) dressedSection.style.display = onSetupPage ? (retailBillingMode === "dressed" ? "" : "none") : "";
  if (paymentSection) paymentSection.style.display = retailBillingMode === "payment" ? "" : "none";
  if (setupSection) setupSection.style.display = retailBillingMode === "payment" ? "none" : "";
  if (dressedStockSetupSection) dressedStockSetupSection.style.display = retailBillingMode === "dressed" ? "" : "none";
  if (shortcutLineType) shortcutLineType.value = retailBillingMode === "dressed" ? "DRESSED" : "STANDARD";
  if (shortcutManagerHelp) shortcutManagerHelp.innerText = retailBillingMode === "dressed"
    ? "Add your own quick dressed items with default rate."
    : "Add your own quick regular items with default rate.";
  if (shortcutRate) shortcutRate.style.display = "";
  if (shortcutUnit) shortcutUnit.style.display = retailBillingMode === "dressed" ? "none" : "";
  if (retailHistorySection) retailHistorySection.style.display = retailBillingMode === "payment" ? "none" : "";
  if (paymentHistorySection) paymentHistorySection.style.display = retailBillingMode === "payment" ? "" : "none";
  const historyTitle = document.getElementById("retailHistoryTitle");
  if (modeTitle) {
    if (onSetupPage && retailBillingMode === "dressed") {
      modeTitle.innerText = "Dressed Setup";
    } else if (onSetupPage && retailBillingMode === "regular") {
      modeTitle.innerText = "Regular Setup";
    } else if (retailBillingMode === "payment") {
      modeTitle.innerText = "Payment Receipt";
    } else {
      modeTitle.innerText = "Retail Billing";
    }
  }
  if (previewTitle) {
    if (retailBillingMode === "payment") {
      previewTitle.innerText = "Payment Receipt Preview";
    } else {
      previewTitle.innerText = "Retail Bill Preview";
    }
  }
  if (historyTitle) {
    historyTitle.innerText = onSetupPage
      ? (retailBillingMode === "dressed" ? "Recent Dressed Bills" : "Recent Retail Bills")
      : "Recent Retail Bills";
  }
  if (addItemButton) {
    addItemButton.innerText = retailBillingMode === "dressed" ? "Add Dressed Item" : "Add Regular Item";
  }

  renderShortcutManagerList();

  if (retailBillingMode === "payment") {
    ensurePaymentReceiptModeReady();
    schedulePaymentReceiptPreviewRender();
  } else {
    if (onSetupPage) {
      if (retailBillingMode === "dressed") {
        ensureDressedModeReady();
      } else {
        ensureRegularModeReady();
      }
      if (currentRetailBill && !retailDraftDirty && getRetailBillMode(currentRetailBill) === retailBillingMode) {
        renderRetailPreview(currentRetailBill);
      }
    } else {
      ensureRegularModeReady();
      ensureDressedModeReady();
      if (currentRetailBill && !retailDraftDirty) {
        renderRetailPreview(currentRetailBill);
      }
    }
    scheduleRetailPreviewRender();
    if (loadHistory) {
      if (retailBillHistoryLoaded && retailBillHistoryDate === getActiveRetailDate()) {
        renderRetailBillHistory();
      } else {
        loadRetailBills();
      }
    }
  }
}

function isRetailSetupPage() {
  return !!document.querySelector(".retail-setup-page");
}

function isCombinedRetailBillingPage() {
  return !isRetailSetupPage();
}

function getRetailBillMode(bill) {
  const items = bill?.items || [];
  const hasRegular = items.some(item => (item.line_type || "STANDARD").toUpperCase() !== "DRESSED");
  const hasDressed = items.some(item => (item.line_type || "STANDARD").toUpperCase() === "DRESSED");
  if (hasRegular && hasDressed) return "both";
  if (hasDressed) return "dressed";
  return "regular";
}

function normalizeRetailBillMode(bill) {
  if (bill?.bill_mode) return String(bill.bill_mode).toLowerCase();
  return getRetailBillMode(bill);
}

function getActiveRetailDate() {
  return retailField("regular", "date")?.value || "";
}

function normalizeRetailPartyLookup(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "").replace(/\./g, "").trim();
}

async function ensureRetailPartyDirectoryLoaded(force = false) {
  if (retailPartyDirectoryLoaded && !force) return retailPartyDirectoryCache;
  if (retailPartyDirectoryPromise && !force) return retailPartyDirectoryPromise;

  retailPartyDirectoryPromise = optionalApiCall(
    "/party-directory",
    { results: [] },
    "GET",
    null,
    { cache: true }
  ).then(data => {
    retailPartyDirectoryCache = Array.isArray(data?.results) ? data.results : [];
    retailPartyDirectoryLoaded = true;
    retailPartyDirectoryPromise = null;
    return retailPartyDirectoryCache;
  }).catch(err => {
    console.error(err);
    retailPartyDirectoryPromise = null;
    return retailPartyDirectoryCache;
  });

  return retailPartyDirectoryPromise;
}

function getRetailPartyMatches(query) {
  const normalizedQuery = normalizeRetailPartyLookup(query);
  if (!normalizedQuery) return [];
  const digitQuery = String(query || "").replace(/\D/g, "");

  return retailPartyDirectoryCache.filter(party => {
    const normalizedName = normalizeRetailPartyLookup(party.name);
    const normalizedPhone = String(party.phone || "").replace(/\D/g, "");
    const nameMatch = normalizedName.includes(normalizedQuery);
    const phoneMatch = digitQuery ? normalizedPhone.includes(digitQuery) : false;
    return nameMatch || phoneMatch;
  }).sort((a, b) => compareRetailPartyMatches(a, b, query)).slice(0, 12);
}

function getRetailPartyMatchScore(party, query) {
  const normalizedQuery = normalizeRetailPartyLookup(query);
  const digitQuery = String(query || "").replace(/\D/g, "");
  const normalizedName = normalizeRetailPartyLookup(party?.name);
  const normalizedPhone = String(party?.phone || "").replace(/\D/g, "");

  if (!normalizedQuery && !digitQuery) return 999;
  if (normalizedQuery && normalizedName === normalizedQuery) return 0;
  if (normalizedQuery && normalizedName.startsWith(normalizedQuery)) return 1;
  if (normalizedQuery) {
    const words = String(party?.name || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (words.some(word => word.startsWith(String(query || "").trim().toLowerCase()))) return 2;
  }
  if (normalizedQuery && normalizedName.includes(normalizedQuery)) return 3;
  if (digitQuery && normalizedPhone.startsWith(digitQuery)) return 4;
  if (digitQuery && normalizedPhone.includes(digitQuery)) return 5;
  return 999;
}

function compareRetailPartyMatches(a, b, query) {
  const scoreDiff = getRetailPartyMatchScore(a, query) - getRetailPartyMatchScore(b, query);
  if (scoreDiff !== 0) return scoreDiff;
  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

function mergeRetailPartyMatches(localParties, remoteParties, query) {
  const merged = new Map();
  [...(localParties || []), ...(remoteParties || [])].forEach(party => {
    const key = normalizeRetailPartyLookup(party?.name);
    if (!key) return;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...party });
      return;
    }
    merged.set(key, {
      ...existing,
      ...party,
      phone: existing.phone || party.phone || "",
      address: existing.address || party.address || ""
    });
  });
  return Array.from(merged.values())
    .sort((a, b) => compareRetailPartyMatches(a, b, query))
    .slice(0, 12);
}

function fillPartySuggestions(suggestions, parties) {
  if (!suggestions) return;
  suggestions.innerHTML = "";
  parties.forEach(party => {
    const option = document.createElement("option");
    option.value = party.name;
    const text = party.phone ? `${party.name} - ${party.phone}` : party.name;
    option.label = text;
    option.textContent = text;
    suggestions.appendChild(option);
  });
}

function renderPartySuggestionBox(boxId, parties, onPick) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = "";

  if (!parties.length) {
    box.style.display = "none";
    return;
  }

  parties.forEach(party => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "typeahead-option";
    button.innerHTML = `
      <strong>${party.name}</strong>
      ${party.phone ? `<span>${party.phone}</span>` : ""}
    `;
    button.onmousedown = evt => {
      evt.preventDefault();
      onPick(party);
    };
    box.appendChild(button);
  });

  box.style.display = "block";
}

function hideSuggestionBox(boxId) {
  const box = document.getElementById(boxId);
  if (box) {
    box.innerHTML = "";
    box.style.display = "none";
  }
}

function scheduleSuggestionBoxHide(boxId) {
  clearTimeout(retailSuggestHideTimer);
  retailSuggestHideTimer = setTimeout(() => hideSuggestionBox(boxId), 220);
}

function getCachedPartyProfile(name) {
  const normalized = normalizeRetailPartyLookup(name);
  if (!normalized) return null;
  return retailPartyDirectoryCache.find(party => normalizeRetailPartyLookup(party.name) === normalized) || null;
}

function partyHasResolvedBalance(party) {
  return party && (
    party.balance_after != null ||
    party.party_balance != null
  );
}

function getPaymentReceiptOldBalanceValue(receipt = null) {
  if (receipt && receipt.old_balance != null && receipt.old_balance !== "") {
    return Number(receipt.old_balance || 0);
  }
  if (receipt && receipt.balance_after != null) {
    return Number(receipt.balance_after || 0) + Number(receipt.amount || 0);
  }
  return getRetailPartyBalance("payment");
}

function syncPaymentReceiptOldBalanceField(value = null) {
  const input = document.getElementById("paymentReceiptOldBalance");
  if (!input) return;
  input.value = formatBillMoney(Number(value != null ? value : getRetailPartyBalance("payment") || 0));
}

function setRetailPartyBalance(mode, value) {
  if (!retailPartyBalanceByMode[mode]) retailPartyBalanceByMode[mode] = 0;
  retailPartyBalanceByMode[mode] = Number(value || 0);
  if (mode === "payment") {
    syncPaymentReceiptOldBalanceField(retailPartyBalanceByMode[mode]);
  }
}

function getRetailPartyBalance(mode) {
  return Number(retailPartyBalanceByMode[mode] || 0);
}

function storeLinkedPartyState(nameInput, phoneInput, addressInput, party) {
  if (!nameInput) return;
  nameInput.dataset.linkedPartyName = normalizeRetailPartyLookup(party?.name || "");
  nameInput.dataset.linkedPartyPhone = party?.phone || "";
  nameInput.dataset.linkedPartyAddress = party?.address || "";
  if (phoneInput) phoneInput.dataset.linkedFromParty = "true";
  if (addressInput) addressInput.dataset.linkedFromParty = "true";
}

function clearLinkedPartyState(nameInput, phoneInput, addressInput) {
  if (nameInput) {
    delete nameInput.dataset.linkedPartyName;
    delete nameInput.dataset.linkedPartyPhone;
    delete nameInput.dataset.linkedPartyAddress;
  }
  if (phoneInput) delete phoneInput.dataset.linkedFromParty;
  if (addressInput) delete addressInput.dataset.linkedFromParty;
}

function resetLinkedRetailPartyFieldsIfNameChanged(mode = retailBillingMode) {
  const input = retailField(mode, "customerName");
  const phoneInput = retailField(mode, "customerPhone");
  const addressInput = retailField(mode, "customerAddress");
  if (!input) return;

  const linkedName = input.dataset.linkedPartyName || "";
  const currentName = normalizeRetailPartyLookup(input.value);
  if (!linkedName || linkedName === currentName) return;

  if (phoneInput) phoneInput.value = "";
  if (addressInput) addressInput.value = "";
  clearLinkedPartyState(input, phoneInput, addressInput);
  setRetailPartyBalance(mode, 0);
  scheduleRetailPreviewRender();
}

function resetLinkedPaymentReceiptFieldsIfNameChanged() {
  const input = document.getElementById("paymentReceiptPartyName");
  const phoneInput = document.getElementById("paymentReceiptPartyPhone");
  const oldBalanceInput = document.getElementById("paymentReceiptOldBalance");
  if (!input) return;

  const linkedName = input.dataset.linkedPartyName || "";
  const currentName = normalizeRetailPartyLookup(input.value);
  if (!linkedName || linkedName === currentName) return;

  if (phoneInput) phoneInput.value = "";
  clearLinkedPartyState(input, phoneInput, null);
  setRetailPartyBalance("payment", 0);
  if (oldBalanceInput) oldBalanceInput.value = "";
  schedulePaymentReceiptPreviewRender();
}

function applyRetailPartyToFields(party, mode = retailBillingMode) {
  if (!party) return;
  const input = retailField(mode, "customerName");
  const phoneInput = retailField(mode, "customerPhone");
  const addressInput = retailField(mode, "customerAddress");
  if (input) input.value = party.name || input.value;
  if (phoneInput) phoneInput.value = party.phone || "";
  if (addressInput) addressInput.value = party.address || "";
  storeLinkedPartyState(input, phoneInput, addressInput, party);
  setRetailPartyBalance(mode, party.balance_after ?? party.party_balance ?? 0);
  scheduleRetailPreviewRender();
}

function applyPaymentReceiptPartyToFields(party) {
  if (!party) return;
  const input = document.getElementById("paymentReceiptPartyName");
  const phoneInput = document.getElementById("paymentReceiptPartyPhone");
  if (input) input.value = party.name || input.value;
  if (phoneInput) phoneInput.value = party.phone || "";
  storeLinkedPartyState(input, phoneInput, null, party);
  setRetailPartyBalance("payment", party.balance_after ?? party.party_balance ?? 0);
  schedulePaymentReceiptPreviewRender();
}

async function fetchRetailPartyProfile(name) {
  const query = String(name || "").trim();
  if (query.length < 2) return null;
  const data = await optionalApiCall(`/party/profile?name=${encodeURIComponent(query)}`, null, "GET", null, { cache: false });
  const party = data?.party;
  if (!party) return null;
  retailPartyDirectoryCache = retailPartyDirectoryCache.filter(
    existing => normalizeRetailPartyLookup(existing.name) !== normalizeRetailPartyLookup(party.name)
  );
  retailPartyDirectoryCache.push(party);
  return party;
}

function renderRetailPartyMatches(boxId, suggestions, parties, onPick) {
  fillPartySuggestions(suggestions, parties);
  renderPartySuggestionBox(boxId, parties, onPick);
}

function isCurrentRetailBillForActiveMode() {
  if (!currentRetailBill) return false;
  if (isCombinedRetailBillingPage()) return retailBillingMode !== "payment";
  return getRetailBillMode(currentRetailBill) === retailBillingMode;
}

async function ensurePaymentReceiptModeReady() {
  const paymentReceiptDate = document.getElementById("paymentReceiptDate");
  if (paymentReceiptDate && !paymentReceiptDate.value) {
    paymentReceiptDate.value = formatDateInput(new Date());
  }
  await refreshPaymentReceiptNumber();
  if (!paymentReceiptHistoryLoaded) {
    await loadPaymentReceipts();
    paymentReceiptHistoryLoaded = true;
  }
}

function ensureRegularModeReady() {
  const regularRows = document.getElementById("retailRegularRows");
  if (regularRows && regularRows.children.length === 0) {
    addRegularRetailRow();
  }
}

async function ensureDressedModeReady() {
  const dressedRows = document.getElementById("retailDressedRows");
  const dressedStockRows = document.getElementById("dressedStockRows");
  if (dressedRows && dressedRows.children.length === 0) {
    addDressedRetailRow();
  }
  if (dressedStockRows && dressedStockRows.children.length === 0) {
    addDressedStockRow();
  }
  await ensureDressedStockLoaded();
}

async function ensureDressedStockLoaded() {
  const date = retailField("regular", "date")?.value || "";
  if (!date) return;
  if (dressedStockLoadedForDate === date && dressedStockCache.length) return;
  await loadDressedStock();
}

async function refreshPaymentReceiptNumber() {
  const dateInput = document.getElementById("paymentReceiptDate");
  const numberInput = document.getElementById("paymentReceiptNumber");
  if (!dateInput || !numberInput) return;

  if (!dateInput.value) {
    dateInput.value = formatDateInput(new Date());
  }

  try {
    const data = await optionalApiCall(
      `/payment-receipts/next-number?date=${encodeURIComponent(dateInput.value)}`,
      { receipt_number: "1" },
      "GET",
      null,
      { cache: false }
    );
    numberInput.value = data.receipt_number || "1";
  } catch (e) {
    console.error(e);
    numberInput.value = "1";
  }
}

function renderRetailShortcuts() {
  const regularContainer = document.getElementById("retailRegularShortcutItems");
  const dressedContainer = document.getElementById("retailDressedShortcutItems");
  if (!regularContainer || !dressedContainer) return;

  regularContainer.innerHTML = "";
  dressedContainer.innerHTML = "";
  getRetailShortcuts().forEach(shortcut => {
    const shortcutLineType = (shortcut.line_type || "STANDARD").toUpperCase();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "retail-shortcut-chip";
    button.innerText = shortcutLineType === "DRESSED"
      ? `${shortcut.name}${Number(shortcut.rate || 0) > 0 ? ` - Rs ${Number(shortcut.rate).toFixed(2)}` : ""}`
      : `${shortcut.name}${Number(shortcut.rate || 0) > 0 ? ` - Rs ${Number(shortcut.rate).toFixed(2)}` : ""}`;
    button.onclick = () => addShortcutRetailItem(shortcut);
    if (shortcutLineType === "DRESSED") {
      dressedContainer.appendChild(button);
    } else {
      regularContainer.appendChild(button);
    }
  });

  if (!regularContainer.children.length) {
    regularContainer.innerHTML = `<span class="retail-shortcut-empty">No regular shortcuts yet.</span>`;
  }
  if (!dressedContainer.children.length) {
    dressedContainer.innerHTML = `<span class="retail-shortcut-empty">No dressed shortcuts yet.</span>`;
  }
}

function getRetailShortcuts() {
  return Array.isArray(retailShortcutsCache) ? retailShortcutsCache : [];
}

async function ensureRetailShortcutsLoaded(force = false) {
  const activeOutletId = getSelectedOutletId();
  if (retailShortcutsOutletId !== activeOutletId) {
    retailShortcutsCache = [];
    retailShortcutsLoaded = false;
    retailShortcutsPromise = null;
    retailShortcutsOutletId = activeOutletId;
  }
  if (retailShortcutsLoaded && !force) return retailShortcutsCache;
  if (retailShortcutsPromise && !force) return retailShortcutsPromise;

  retailShortcutsPromise = optionalApiCall(
    "/retail-shortcuts",
    { results: [] },
    "GET",
    null,
    { cache: !force }
  ).then(data => {
    retailShortcutsCache = Array.isArray(data?.results) ? data.results : [];
    retailShortcutsLoaded = true;
    retailShortcutsPromise = null;
    retailShortcutsOutletId = activeOutletId;
    return retailShortcutsCache;
  }).catch(err => {
    console.error("Failed to load shortcuts", err);
    retailShortcutsPromise = null;
    retailShortcutsCache = [];
    return retailShortcutsCache;
  });

  return retailShortcutsPromise;
}

function resetRetailShortcutCache() {
  retailShortcutsLoaded = false;
  retailShortcutsPromise = null;
  retailShortcutsCache = [];
  clearCachedResponse("/retail-shortcuts");
}

function cancelRetailShortcutEdit() {
  const editingInput = document.getElementById("editingShortcutOriginalName");
  const nameInput = document.getElementById("shortcutName");
  const rateInput = document.getElementById("shortcutRate");
  const unitInput = document.getElementById("shortcutUnit");
  const lineTypeInput = document.getElementById("shortcutLineType");
  const sourceTypeInput = document.getElementById("shortcutSourceItemType");
  const saveButton = document.getElementById("saveShortcutButton");
  const cancelButton = document.getElementById("cancelShortcutEditButton");

  if (editingInput) editingInput.value = "";
  if (nameInput) nameInput.value = "";
  if (rateInput) rateInput.value = "";
  if (lineTypeInput) lineTypeInput.value = retailBillingMode === "dressed" ? "DRESSED" : "STANDARD";
  if (sourceTypeInput) sourceTypeInput.value = "";
  if (unitInput) {
    unitInput.value = "KGS";
    unitInput.style.display = retailBillingMode === "dressed" ? "none" : "";
  }
  if (saveButton) saveButton.innerText = "Save Shortcut";
  if (cancelButton) cancelButton.style.display = "none";
}

function startRetailShortcutEdit(shortcut) {
  const editingInput = document.getElementById("editingShortcutOriginalName");
  const nameInput = document.getElementById("shortcutName");
  const rateInput = document.getElementById("shortcutRate");
  const unitInput = document.getElementById("shortcutUnit");
  const lineTypeInput = document.getElementById("shortcutLineType");
  const sourceTypeInput = document.getElementById("shortcutSourceItemType");
  const saveButton = document.getElementById("saveShortcutButton");
  const cancelButton = document.getElementById("cancelShortcutEditButton");

  if (editingInput) editingInput.value = shortcut.id || "";
  if (nameInput) nameInput.value = shortcut.name || "";
  if (rateInput) rateInput.value = Number(shortcut.rate || 0) > 0 ? Number(shortcut.rate).toFixed(2) : "";
  if (lineTypeInput) lineTypeInput.value = (shortcut.line_type || "STANDARD").toUpperCase();
  if (sourceTypeInput) sourceTypeInput.value = shortcut.source_item_type || "";
  if (unitInput) {
    unitInput.value = shortcut.unit || "KGS";
    unitInput.style.display = (shortcut.line_type || "STANDARD").toUpperCase() === "DRESSED" ? "none" : "";
  }
  if (saveButton) saveButton.innerText = "Update Shortcut";
  if (cancelButton) cancelButton.style.display = "";
  nameInput?.focus();
}

async function saveRetailShortcut() {
  const name = document.getElementById("shortcutName")?.value.trim();
  const editingShortcutId = document.getElementById("editingShortcutOriginalName")?.value.trim();
  const lineType = retailBillingMode === "dressed"
    ? "DRESSED"
    : (document.getElementById("shortcutLineType")?.value || "STANDARD");
  const rate = Number(document.getElementById("shortcutRate")?.value || 0);
  const sourceItemType = document.getElementById("shortcutSourceItemType")?.value || "";
  const unit = lineType === "DRESSED" ? "KGS" : (document.getElementById("shortcutUnit")?.value || "KGS");

  if (!name) {
    showToast("Enter shortcut item name");
    return;
  }

  const response = await apiCall(
    "/retail-shortcuts",
    "POST",
    JSON.stringify({
      id: editingShortcutId || "",
      name,
      rate,
      line_type: lineType,
      source_item_type: sourceItemType,
      unit
    }),
    { "Content-Type": "application/json" }
  );

  if (response?.error) {
    showToast(response.error);
    return;
  }

  resetRetailShortcutCache();
  await ensureRetailShortcutsLoaded(true);
  renderRetailShortcuts();
  renderShortcutManagerList();
  cancelRetailShortcutEdit();
  showToast(editingShortcutId ? "Shortcut updated" : "Shortcut saved");
}

async function removeRetailShortcut(shortcutId) {
  const response = await apiCall(`/retail-shortcuts/${shortcutId}`, "DELETE");
  if (response?.error) {
    showToast(response.error);
    return;
  }

  resetRetailShortcutCache();
  await ensureRetailShortcutsLoaded(true);
  renderRetailShortcuts();
  renderShortcutManagerList();
}

function renderShortcutManagerList() {
  const container = document.getElementById("retailShortcutManagerList");
  if (!container) return;
  container.innerHTML = "";
  const activeLineType = retailBillingMode === "dressed" ? "DRESSED" : "STANDARD";
  const visibleShortcuts = getRetailShortcuts().filter(shortcut => ((shortcut.line_type || "STANDARD").toUpperCase() === activeLineType));
  visibleShortcuts.forEach(shortcut => {
    const chip = document.createElement("div");
    chip.className = "retail-shortcut-chip retail-shortcut-chip-managed";
    const text = document.createElement("span");
    text.innerText = activeLineType === "DRESSED"
      ? `${shortcut.name} | ${shortcut.source_item_type || "-"} | DRESSED | Rs ${Number(shortcut.rate || 0).toFixed(2)}`
      : `${shortcut.name} | ${shortcut.source_item_type || "-"} | ${shortcut.line_type || "STANDARD"} | ${shortcut.unit || "KGS"} | Rs ${Number(shortcut.rate || 0).toFixed(2)}`;
    const actions = document.createElement("div");
    actions.className = "retail-shortcut-managed-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.innerText = "Edit";
    editButton.onclick = () => startRetailShortcutEdit(shortcut);
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.innerText = "Remove";
    removeButton.onclick = () => removeRetailShortcut(shortcut.id);
    actions.appendChild(editButton);
    actions.appendChild(removeButton);
    chip.appendChild(text);
    chip.appendChild(actions);
    container.appendChild(chip);
  });
  if (!visibleShortcuts.length) {
    container.innerHTML = `<span class="retail-shortcut-empty">No ${retailBillingMode === "dressed" ? "dressed" : "regular"} shortcuts saved yet.</span>`;
  }
}

async function refreshRetailBillNumber(mode = retailBillingMode) {
  const date = retailField(mode, "date")?.value;
  const billNumber = retailField(mode, "billNumber");
  if (!date || !billNumber) return;

  try {
    let nextNumber = "1";

    if (navigator.onLine) {
      const data = await optionalApiCall(
        `/retail-bills/next-number?date=${encodeURIComponent(date)}`,
        { bill_number: "1" },
        "GET",
        null,
        { cache: false }
      );
      nextNumber = data.bill_number || "1";
    }

    billNumber.value = computeNextRetailBillNumber(date, nextNumber);
    if (mode === retailBillingMode) {
      renderRetailPreviewFromForm();
    }
  } catch (e) {
    console.error(e);
    billNumber.value = computeNextRetailBillNumber(date, "1");
  }
}

function addRegularRetailRow(item = null) {
  addRetailItemRow(item, "STANDARD");
}

function addDressedRetailRow(item = null) {
  addRetailItemRow(item, "DRESSED");
}

function addRetailItemRow(item = null, defaultLineType = "STANDARD") {
  const container = document.getElementById(defaultLineType === "DRESSED" ? "retailDressedRows" : "retailRegularRows");
  if (!container) return;
  const lineType = (item?.line_type || defaultLineType || "STANDARD").toUpperCase();

  const row = document.createElement("div");
  row.className = "retail-item-row";
  row.dataset.lineType = lineType;
  row.dataset.sourceItemType = item?.source_item_type || "";
  row.innerHTML = `
    <input type="text" class="retailItemName" placeholder="Item name" list="retailItemSuggestions" autocomplete="off" oninput="suggestRetailItems(this); recalcRetailLine(this)">
    <input type="number" class="retailQty" placeholder="NAG" min="0" step="1" oninput="recalcRetailLine(this)">
    <select class="retailUnit" onchange="recalcRetailLine(this)">
      <option value="KGS">KGS</option>
      <option value="PCS">PCS</option>
    </select>
    <input type="number" class="retailWeight" placeholder="KGS" min="0" step="0.001" oninput="recalcRetailLine(this)">
    <input type="number" class="retailRate" placeholder="Rate" min="0" step="0.01" oninput="recalcRetailLine(this)">
    <input type="number" class="retailAmount" placeholder="Amount" min="0" step="0.01" oninput="markRetailAmountDirty(this)">
    <button type="button" onclick="removeRetailItemRow(this)">Remove</button>
  `;
  container.appendChild(row);

  if (item) {
    row.querySelector(".retailItemName").value = item.item_name || "";
    row.querySelector(".retailQty").value = item.nag || item.quantity || "";
    row.querySelector(".retailUnit").value = item.unit || "KGS";
    row.querySelector(".retailWeight").value = item.weight || "";
    row.querySelector(".retailRate").value = item.rate || "";
    row.querySelector(".retailAmount").value = item.amount || "";
  }

  syncRetailLineUi(row);
  retailDraftDirty = true;
  retailBillCompleted = false;
  scheduleRetailPreviewRender();
}

function addShortcutRetailItem(shortcut) {
  const lineType = (shortcut.line_type || "STANDARD").toUpperCase();
  const rows = Array.from(document.querySelectorAll(lineType === "DRESSED" ? "#retailDressedRows .retail-item-row" : "#retailRegularRows .retail-item-row"));
  let targetRow = rows.find(row => !row.querySelector(".retailItemName")?.value.trim());

  if (!targetRow) {
    addRetailItemRow(null, lineType);
    targetRow = Array.from(document.querySelectorAll(lineType === "DRESSED" ? "#retailDressedRows .retail-item-row" : "#retailRegularRows .retail-item-row")).at(-1);
  }

  const itemInput = targetRow?.querySelector(".retailItemName");
  const qtyInput = targetRow?.querySelector(".retailQty");
  const unitSelect = targetRow?.querySelector(".retailUnit");
  const rateInput = targetRow?.querySelector(".retailRate");

  if (!itemInput || !qtyInput || !unitSelect || !rateInput) return;

  itemInput.value = shortcut.name;
  targetRow.dataset.lineType = lineType;
  targetRow.dataset.sourceItemType = shortcut.source_item_type || "";
  unitSelect.value = shortcut.unit || "KGS";
  if (lineType !== "DRESSED" && !qtyInput.value && unitSelect.value === "PCS") {
    qtyInput.value = "1";
  }
  if (Number(shortcut.rate || 0) > 0) {
    rateInput.value = Number(shortcut.rate).toFixed(2);
  }

  retailDraftDirty = true;
  retailBillCompleted = false;
  syncRetailLineUi(targetRow);
  recalcRetailLine(itemInput);
}

function removeRetailItemRow(button) {
  const row = button.closest(".retail-item-row");
  if (!row) return;

  if (row.classList.contains("dressed-stock-row")) {
    const container = row.parentElement;
    row.remove();
    if (container && container.children.length === 0) addDressedStockRow();
    return;
  }

  const container = row.parentElement;
  const rows = container ? container.querySelectorAll(".retail-item-row") : [];
  if (rows.length <= 1) {
    row?.querySelectorAll("input").forEach(input => {
      input.value = "";
    });
    const unitSelect = row?.querySelector(".retailUnit");
    if (unitSelect) unitSelect.value = "KGS";
    syncRetailLineUi(row);
    retailDraftDirty = true;
    retailBillCompleted = false;
    scheduleRetailPreviewRender();
    return;
  }

  row.remove();
  retailDraftDirty = true;
  retailBillCompleted = false;
  scheduleRetailPreviewRender();
}

function recalcRetailLine(source) {
  const row = source?.closest(".retail-item-row");
  if (!row) return;

  applyRetailDefaults(row);

  const qtyInput = row.querySelector(".retailQty");
  const unitInput = row.querySelector(".retailUnit");
  const weightInput = row.querySelector(".retailWeight");
  const rateInput = row.querySelector(".retailRate");
  const amountInput = row.querySelector(".retailAmount");

  const lineType = getRetailRowLineType(row);
  const quantity = Number(qtyInput?.value || 0);
  const unit = unitInput?.value || "KGS";
  let weight = Number(weightInput?.value || 0);
  let rate = Number(rateInput?.value || 0);
  let amount = Number(amountInput?.value || 0);

  if (lineType === "DRESSED") {
    if (unitInput) unitInput.value = "KGS";
  }

  if (lineType === "DRESSED") {
    if (source === weightInput) {
      if (rate > 0 && weight > 0) {
        amountInput.value = (weight * rate).toFixed(2);
      } else if (amount > 0 && weight > 0) {
        rateInput.value = (amount / weight).toFixed(2);
      }
    } else if (source === rateInput) {
      if (rate > 0 && amount > 0) {
        weight = amount / rate;
        weightInput.value = weight.toFixed(3);
      } else if (rate > 0 && weight > 0) {
        amountInput.value = (weight * rate).toFixed(2);
      }
    } else if (source === amountInput) {
      if (rate > 0 && amount > 0) {
        weight = amount / rate;
        weightInput.value = weight.toFixed(3);
      } else if (weight > 0 && amount > 0) {
        rateInput.value = (amount / weight).toFixed(2);
      }
    } else if (rate > 0 && weight > 0 && amount <= 0) {
      amountInput.value = (weight * rate).toFixed(2);
    }
  } else {
    const base = weight > 0 ? weight : quantity;
    if (rate > 0 && base > 0 && source !== amountInput) {
      amountInput.value = (base * rate).toFixed(2);
    } else if (amount > 0 && base > 0 && source === amountInput) {
      rateInput.value = (amount / base).toFixed(2);
    }
  }

  retailDraftDirty = true;
  retailBillCompleted = false;
  scheduleRetailPreviewRender();
}

function getRetailShortcutByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return getRetailShortcuts().find(item => String(item.name || "").trim().toLowerCase() === normalized) || null;
}

function getDressedStockByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return dressedStockCache.find(item => String(item.item_name || "").trim().toLowerCase() === normalized) || null;
}

function applyRetailDefaults(row) {
  const itemName = row?.querySelector(".retailItemName")?.value.trim();
  const lineType = getRetailRowLineType(row);
  const rateInput = row?.querySelector(".retailRate");
  const unitInput = row?.querySelector(".retailUnit");
  if (!itemName || !rateInput || !unitInput) return;

  const shortcut = getRetailShortcutByName(itemName);
  if (shortcut) {
    row.dataset.sourceItemType = shortcut.source_item_type || "";
    if (lineType !== "DRESSED" && (!unitInput.value || unitInput.value === "KGS")) {
      unitInput.value = shortcut.unit || unitInput.value || "KGS";
    }
    if (Number(rateInput.value || 0) <= 0 && Number(shortcut.rate || 0) > 0) {
      rateInput.value = Number(shortcut.rate).toFixed(2);
    }
  }
}

function collectRetailItemsFromForm(mode = retailBillingMode) {
  const selectors = isCombinedRetailBillingPage() && mode !== "payment"
    ? ["#retailRegularRows .retail-item-row", "#retailDressedRows .retail-item-row"]
    : [mode === "dressed" ? "#retailDressedRows .retail-item-row" : "#retailRegularRows .retail-item-row"];

  return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)))
    .map(row => {
      const lineType = getRetailRowLineType(row);
      const quantity = lineType === "DRESSED" ? 0 : Number(row.querySelector(".retailQty")?.value || 0);
      const weight = Number(row.querySelector(".retailWeight")?.value || 0);
      return {
        item_name: row.querySelector(".retailItemName")?.value.trim(),
        line_type: lineType,
        source_item_type: row.dataset.sourceItemType || "",
        nag: quantity,
        quantity,
        unit: lineType === "DRESSED" ? "KGS" : (row.querySelector(".retailUnit")?.value || "KGS"),
        weight,
        rate: Number(row.querySelector(".retailRate")?.value || 0),
        amount: Number(row.querySelector(".retailAmount")?.value || 0)
      };
    })
    .filter(item => item.item_name && (item.line_type === "DRESSED" ? item.weight > 0 : (item.quantity > 0 || item.weight > 0)));
}

function buildRetailBillFromForm(mode = retailBillingMode) {
  const items = collectRetailItemsFromForm(mode);
  const itemsSubtotalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalNag = items.reduce((sum, item) => sum + Number(item.nag || item.quantity || 0), 0);
  const totalWeight = items.reduce((sum, item) => sum + Number(item.weight || (item.unit === "KGS" ? item.nag || item.quantity : 0) || 0), 0);
  const paymentMode = retailField(mode, "paymentMode")?.value || "Cash";
  const settlementType = retailField(mode, "settlementType")?.value || "paid";
  const customerName = retailField(mode, "customerName")?.value.trim() || "";
  const iceAmount = Number(retailField(mode, "iceAmount")?.value || 0);
  const rawPaidAmount = retailField(mode, "paidAmount")?.value;
  const totalAmount = itemsSubtotalAmount + iceAmount;
  let paidAmount = Math.min(
    rawPaidAmount === "" && paymentMode !== "Credit" ? totalAmount : Number(rawPaidAmount || 0),
    totalAmount
  );

  if (settlementType === "paid") {
    paidAmount = totalAmount;
  } else if (settlementType === "credit") {
    paidAmount = 0;
  }

  const outstandingAmount = Math.max(totalAmount - paidAmount, 0);
  const priorPartyBalance = customerName ? getRetailPartyBalance(mode) : 0;
  const partyBalance = priorPartyBalance + outstandingAmount;

  return {
    bill_number: retailField(mode, "billNumber")?.value.trim() || "Draft",
    date: retailField(mode, "date")?.value || formatDateInput(new Date()),
    time: new Date().toLocaleTimeString("en-GB"),
    cashier_name: retailField(mode, "cashier")?.value.trim() || "admin",
    bill_mode: getRetailBillMode({ items }),
    customer_name: customerName,
    customer_phone: retailField(mode, "customerPhone")?.value.trim() || "",
    customer_address: retailField(mode, "customerAddress")?.value.trim() || "",
    settlement_type: settlementType,
    payment_mode: paymentMode,
    paid_amount: paidAmount,
    outstanding_amount: outstandingAmount,
    party_balance: partyBalance,
    requires_customer: outstandingAmount > 0,
    total_amount: totalAmount,
    items_subtotal_amount: itemsSubtotalAmount,
    ice_amount: iceAmount,
    total_nag: totalNag,
    total_quantity: totalNag,
    total_weight: totalWeight,
    notes: retailField(mode, "notes")?.value.trim() || "",
    items
  };
}

function renderRetailPreviewFromForm() {
  renderRetailPreview(buildRetailBillFromForm(retailBillingMode), true);
}

function buildPaymentReceiptFromForm() {
  return {
    receipt_number: document.getElementById("paymentReceiptNumber")?.value.trim() || "Draft",
    date: document.getElementById("paymentReceiptDate")?.value || formatDateInput(new Date()),
    time: new Date().toLocaleTimeString("en-GB"),
    cashier_name: document.getElementById("paymentReceiptCashier")?.value.trim() || "admin",
    party_name: document.getElementById("paymentReceiptPartyName")?.value.trim() || "",
    party_phone: document.getElementById("paymentReceiptPartyPhone")?.value.trim() || "",
    old_balance: getRetailPartyBalance("payment"),
    direction: document.getElementById("paymentReceiptDirection")?.value || "RECEIVED",
    payment_mode: document.getElementById("paymentReceiptMode")?.value || "Cash",
    amount: Number(document.getElementById("paymentReceiptAmount")?.value || 0),
    notes: document.getElementById("paymentReceiptNotes")?.value.trim() || ""
  };
}

function renderPaymentReceiptPreviewFromForm() {
  renderPaymentReceiptPreview(buildPaymentReceiptFromForm(), true);
}

function markRetailAmountDirty(source) {
  recalcRetailLine(source);
}

function markRetailDraftDirty() {
  retailDraftDirty = true;
  retailBillCompleted = false;
  scheduleRetailPreviewRender();
}

function markPaymentReceiptDraftDirty() {
  paymentReceiptDraftDirty = true;
  paymentReceiptCompleted = false;
  if (retailBillingMode === "payment") {
    schedulePaymentReceiptPreviewRender();
  }
}

function handleRetailSettlementTypeChange(mode = retailBillingMode) {
  syncRetailSettlementUi(mode);
  markRetailDraftDirty();
}

function scheduleRetailPreviewRender() {
  clearTimeout(retailPreviewRenderTimer);
  retailPreviewRenderTimer = setTimeout(() => {
    if (retailBillingMode !== "payment") {
      renderRetailPreviewFromForm();
    }
  }, 60);
}

function schedulePaymentReceiptPreviewRender() {
  clearTimeout(paymentReceiptPreviewRenderTimer);
  paymentReceiptPreviewRenderTimer = setTimeout(() => {
    if (retailBillingMode === "payment") {
      renderPaymentReceiptPreviewFromForm();
    }
  }, 60);
}

function syncRetailSettlementUi(mode = retailBillingMode) {
  const settlementType = retailField(mode, "settlementType");
  const paymentMode = retailField(mode, "paymentMode");
  const paidAmount = retailField(mode, "paidAmount");

  if (!settlementType || !paymentMode || !paidAmount) return;

  const settlementValue = settlementType.value || "paid";

  if (settlementValue === "credit") {
    paymentMode.value = "Credit";
    paidAmount.value = "0";
    paidAmount.disabled = true;
    paidAmount.placeholder = "Paid amount (0 for credit)";
  } else if (settlementValue === "paid") {
    if (paymentMode.value === "Credit") paymentMode.value = "Cash";
    paidAmount.disabled = true;
    paidAmount.value = "";
    paidAmount.placeholder = "Paid automatically as full bill";
  } else {
    if (paymentMode.value === "Credit") paymentMode.value = "Cash";
    paidAmount.disabled = false;
    paidAmount.placeholder = "Paid amount";
  }
}

function populateRetailFormFromBill(bill) {
  const regularRows = document.getElementById("retailRegularRows");
  const dressedRows = document.getElementById("retailDressedRows");
  if (!regularRows || !dressedRows || !bill) return;
  const billMode = getRetailBillMode(bill);
  const formMode = isCombinedRetailBillingPage() ? "regular" : (billMode === "both" ? "regular" : billMode);

  retailField(formMode, "date").value = bill.date || formatDateInput(new Date());
  retailField(formMode, "billNumber").value = bill.bill_number || "";
  retailField(formMode, "cashier").value = bill.cashier_name || "admin";
  const totalAmount = Number(bill.total_amount || 0);
  const paidAmount = Number(bill.paid_amount || 0);
  let settlementType = "partial";
  if (paidAmount <= 0) settlementType = "credit";
  else if (paidAmount >= totalAmount) settlementType = "paid";
  retailField(formMode, "settlementType").value = settlementType;
  retailField(formMode, "paymentMode").value = bill.payment_mode || "Cash";
  retailField(formMode, "customerName").value = bill.customer_name || "";
  retailField(formMode, "customerPhone").value = bill.customer_phone || "";
  retailField(formMode, "customerAddress").value = bill.customer_address || "";
  retailField(formMode, "iceAmount").value = bill.ice_amount ?? "";
  retailField(formMode, "paidAmount").value = bill.paid_amount ?? "";
  retailField(formMode, "notes").value = bill.notes || "";
  syncRetailSettlementUi(formMode);
  if (settlementType === "partial") {
    retailField(formMode, "paidAmount").value = bill.paid_amount ?? "";
  }

  regularRows.innerHTML = "";
  dressedRows.innerHTML = "";
  (bill.items || []).forEach(item => {
    if ((item.line_type || "STANDARD").toUpperCase() === "DRESSED") {
      addRetailItemRow(item, "DRESSED");
    } else {
      addRetailItemRow(item, "STANDARD");
    }
  });

  if (!(bill.items || []).some(item => (item.line_type || "STANDARD").toUpperCase() === "STANDARD")) {
    addRegularRetailRow();
  }
  if (!(bill.items || []).some(item => (item.line_type || "STANDARD").toUpperCase() === "DRESSED")) {
    addDressedRetailRow();
  }

  currentRetailBill = bill;
  retailDraftDirty = false;
  retailBillCompleted = true;
  setRetailBillingMode(
    isCombinedRetailBillingPage() ? "regular" : (billMode === "both" ? "regular" : billMode),
    { loadHistory: false }
  );
  renderRetailPreview(currentRetailBill);
}

function renderRetailPreview(bill, isDraft = false) {
  const preview = document.getElementById("retailPreview");
  if (!preview) return;

  if (!bill || !(bill.items || []).length) {
    preview.innerHTML = `<div class="thermal-empty">Add retail items to preview the printed bill.</div>`;
    return;
  }

  preview.innerHTML = getRetailReceiptMarkup(bill);
}

function renderPaymentReceiptPreview(receipt, isDraft = false) {
  const preview = document.getElementById("retailPreview");
  if (!preview) return;

  if (!receipt || !receipt.party_name || Number(receipt.amount || 0) <= 0) {
    preview.innerHTML = `<div class="thermal-empty">Add party name and amount to preview the payment receipt.</div>`;
    return;
  }

  preview.innerHTML = getPaymentReceiptMarkup(receipt);
}

async function saveRetailBill(options = {}) {
  const { autoStartNext = false } = options;
  const draft = buildRetailBillFromForm(retailBillingMode);

  if (!draft.date) {
    showToast("Select bill date");
    return;
  }

  if (!draft.items.length) {
    showToast(isCombinedRetailBillingPage() ? "Add at least one regular or dressed item" : (retailBillingMode === "dressed" ? "Add at least one dressed item" : "Add at least one regular item"));
    return;
  }

  if (draft.outstanding_amount > 0 && !draft.customer_name) {
    showToast("Enter customer name for credit retail bill");
    return;
  }

  try {
    const isEditing = Boolean(currentRetailBill?.id && !String(currentRetailBill.id).startsWith("local-"));
    if (isEditing && typeof isOwner === "function" && !isOwner()) {
      showToast("Only owner can edit previous bills");
      return null;
    }
    const url = isEditing ? `/retail-bills/${currentRetailBill.id}` : "/retail-bills";
    const method = isEditing ? "PUT" : "POST";
    const data = await apiCall(url, method, JSON.stringify({
      date: draft.date,
      bill_number: draft.bill_number,
      cashier_name: draft.cashier_name,
      customer_name: draft.customer_name,
      customer_phone: draft.customer_phone,
      customer_address: draft.customer_address,
      payment_mode: draft.payment_mode,
      paid_amount: draft.paid_amount,
      ice_amount: draft.ice_amount,
      notes: draft.notes,
      items: draft.items
    }), { "Content-Type": "application/json" });

    if (data.error) {
      showToast(data.error);
      return null;
    }

    currentRetailBill = data.bill;
    retailDraftDirty = false;
    retailBillCompleted = true;
    renderRetailPreview(currentRetailBill);
    showToast(`Retail bill ${currentRetailBill.bill_number} ${isEditing ? "updated" : "saved"}`);
    if (typeof clearCachedResponsesByPrefix === "function") {
      clearCachedResponsesByPrefix("/retail-bills");
      clearCachedResponsesByPrefix("/party/profile?name=");
    }
    if (typeof clearOperationalCaches === "function") {
      clearOperationalCaches();
    }
    rememberRetailBillInHistory(currentRetailBill);
    if (retailBillingMode === "dressed") {
      await loadDressedStock(true);
    }
    if (autoStartNext) {
      startNextRetailBill();
    }
    return currentRetailBill;
  } catch (e) {
    console.error(e);
    if (shouldQueueRetailOffline(e)) {
      const offlineBill = queueRetailBillForSync(draft);
      currentRetailBill = offlineBill;
      retailDraftDirty = false;
      retailBillCompleted = true;
      renderRetailPreview(currentRetailBill);
      renderRetailOfflineBanner();
      if (typeof clearCachedResponsesByPrefix === "function") {
        clearCachedResponsesByPrefix("/retail-bills");
      }
      if (typeof clearOperationalCaches === "function") {
        clearOperationalCaches();
      }
      renderRetailBillHistory();
      showToast(`Saved offline. Bill ${offlineBill.bill_number} will sync later.`);
      return offlineBill;
    }

    showToast("Retail bill save failed");
    return null;
  }
}

function populatePaymentReceiptForm(receipt) {
  if (!receipt) return;
  document.getElementById("paymentReceiptDate").value = receipt.date || formatDateInput(new Date());
  document.getElementById("paymentReceiptNumber").value = receipt.receipt_number || "";
  document.getElementById("paymentReceiptCashier").value = receipt.cashier_name || "admin";
  document.getElementById("paymentReceiptPartyName").value = receipt.party_name || "";
  document.getElementById("paymentReceiptPartyPhone").value = receipt.party_phone || "";
  document.getElementById("paymentReceiptDirection").value = receipt.direction || "RECEIVED";
  document.getElementById("paymentReceiptMode").value = receipt.payment_mode || "Cash";
  document.getElementById("paymentReceiptAmount").value = receipt.amount ?? "";
  document.getElementById("paymentReceiptNotes").value = receipt.notes || "";
  setRetailPartyBalance("payment", getPaymentReceiptOldBalanceValue(receipt));
  syncPaymentReceiptOldBalanceField(getPaymentReceiptOldBalanceValue(receipt));

  currentPaymentReceipt = receipt;
  paymentReceiptDraftDirty = false;
  paymentReceiptCompleted = true;
  setRetailBillingMode("payment");
  renderPaymentReceiptPreview(currentPaymentReceipt);
}

async function savePaymentReceipt(options = {}) {
  const { autoStartNext = false } = options;
  const draft = buildPaymentReceiptFromForm();

  if (!draft.date) {
    showToast("Select receipt date");
    return null;
  }
  if (!draft.party_name) {
    showToast("Enter party name");
    return null;
  }
  if (Number(draft.amount || 0) <= 0) {
    showToast("Enter valid amount");
    return null;
  }

  try {
    const isEditing = Boolean(currentPaymentReceipt?.id);
    if (isEditing && typeof isOwner === "function" && !isOwner()) {
      showToast("Only owner can edit previous receipts");
      return null;
    }
    const url = isEditing ? `/payment-receipts/${currentPaymentReceipt.id}` : "/payment-receipts";
    const method = isEditing ? "PUT" : "POST";
    const data = await apiCall(url, method, JSON.stringify(draft), { "Content-Type": "application/json" });
    if (data.error) {
      showToast(data.error);
      return null;
    }

    currentPaymentReceipt = data.receipt;
    paymentReceiptDraftDirty = false;
    paymentReceiptCompleted = true;
    renderPaymentReceiptPreview(currentPaymentReceipt);
    showToast(`Payment receipt ${currentPaymentReceipt.receipt_number} ${isEditing ? "updated" : "saved"}`);
    if (typeof clearCachedResponsesByPrefix === "function") {
      clearCachedResponsesByPrefix("/payment-receipts");
      clearCachedResponsesByPrefix("/party/profile?name=");
    }
    if (typeof clearOperationalCaches === "function") {
      clearOperationalCaches();
    }
    await loadPaymentReceipts(true);
    if (autoStartNext) {
      startNextPaymentReceipt();
    }
    return currentPaymentReceipt;
  } catch (e) {
    console.error(e);
    showToast("Payment receipt save failed");
    return null;
  }
}

async function loadPaymentReceipts(force = false) {
  const date = document.getElementById("paymentReceiptDate")?.value;
  const body = document.getElementById("paymentReceiptBody");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="7" class="empty">Loading payment receipts...</td></tr>`;

  try {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    const query = params.toString();
    const data = await optionalApiCall(
      `/payment-receipts${query ? `?${query}` : ""}`,
      { results: [] },
      "GET",
      null,
      { cache: !force }
    );

    if (!(data.results || []).length) {
      body.innerHTML = `<tr><td colspan="7" class="empty">No payment receipts for this date</td></tr>`;
      return;
    }

    body.innerHTML = "";
    data.results.forEach(receipt => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(receipt.receipt_number)}</td>
        <td>${formatDisplayDate(receipt.date)}</td>
        <td>${escapeHtml(receipt.party_name || "-")}</td>
        <td>${escapeHtml(receipt.direction || "RECEIVED")}</td>
        <td>${escapeHtml(receipt.payment_mode || "Cash")}</td>
        <td>${formatBillMoney(receipt.amount)}</td>
        <td><button type="button" onclick="openPaymentReceipt('${receipt.id}')">Open</button></td>
      `;
      body.appendChild(row);
    });
  } catch (e) {
    console.error(e);
    body.innerHTML = `<tr><td colspan="7" class="empty">Payment receipts failed to load</td></tr>`;
  }
}

async function openPaymentReceipt(receiptId) {
  try {
    const data = await apiCall(`/payment-receipts/${receiptId}`, "GET", null, {}, { cache: false });
    if (data.error) {
      showToast(data.error);
      return;
    }
    populatePaymentReceiptForm(data);
  } catch (e) {
    console.error(e);
    showToast("Unable to open payment receipt");
  }
}

function resetRetailBillHistoryState() {
  retailBillHistoryRequestId += 1;
  retailBillHistoryServerBills = [];
  retailBillHistoryDate = "";
  retailBillHistoryLoaded = false;
  retailBillHistoryHasMore = false;
  retailBillHistoryNextOffset = 0;
  const loadMoreButton = document.getElementById("retailBillsLoadMore");
  if (loadMoreButton) loadMoreButton.style.display = "none";
}

function renderRetailBillHistory() {
  const date = getActiveRetailDate();
  const body = document.getElementById("retailBillsBody");
  if (!body) return;

  const pendingBills = getPendingRetailBills().filter(bill => !date || bill.date === date);
  const mergedResults = mergeRetailBillResults(retailBillHistoryServerBills, pendingBills);
  const visibleResults = isCombinedRetailBillingPage()
    ? mergedResults
    : mergedResults.filter(bill => normalizeRetailBillMode(bill) === retailBillingMode);
  const loadMoreButton = document.getElementById("retailBillsLoadMore");

  if (loadMoreButton) {
    loadMoreButton.style.display = retailBillHistoryHasMore ? "" : "none";
    loadMoreButton.disabled = false;
    loadMoreButton.textContent = "Load More";
  }

  if (!visibleResults.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No ${isCombinedRetailBillingPage() ? "retail" : (retailBillingMode === "dressed" ? "dressed" : "regular")} bills for this date</td></tr>`;
    return;
  }

  body.innerHTML = visibleResults.map(bill => `
    <tr>
      <td>${escapeHtml(bill.bill_number)}</td>
      <td>${formatDisplayDate(bill.date)}</td>
      <td>${escapeHtml(bill.customer_name || "Walk-in Customer")}</td>
      <td>${escapeHtml(formatRetailBillMode(bill))}</td>
      <td>${formatBillMoney(bill.total_amount)}</td>
      <td>${formatBillMoney(bill.paid_amount)}</td>
      <td>${formatBillMoney(bill.outstanding_amount)}</td>
      <td><button type="button" onclick="openRetailBill('${bill.id}')">Open</button></td>
    </tr>
  `).join("");
}

function rememberRetailBillInHistory(bill) {
  const date = getActiveRetailDate();
  if (!bill || !date || String(bill.date || "") !== String(date)) return;

  if (!retailBillHistoryLoaded || retailBillHistoryDate !== date) {
    retailBillHistoryServerBills = [bill];
    retailBillHistoryDate = date;
    retailBillHistoryLoaded = true;
    retailBillHistoryHasMore = false;
    retailBillHistoryNextOffset = 1;
    renderRetailBillHistory();
    return;
  }

  const existingIndex = retailBillHistoryServerBills.findIndex(existing => existing.id === bill.id);
  if (existingIndex >= 0) {
    retailBillHistoryServerBills[existingIndex] = bill;
  } else {
    const loadedCount = Math.max(retailBillHistoryServerBills.length, 1);
    const targetCount = loadedCount < RETAIL_BILL_HISTORY_PAGE_SIZE ? loadedCount + 1 : loadedCount;
    retailBillHistoryServerBills = [bill, ...retailBillHistoryServerBills].slice(0, targetCount);
    retailBillHistoryNextOffset = targetCount;
    if (loadedCount >= RETAIL_BILL_HISTORY_PAGE_SIZE) retailBillHistoryHasMore = true;
  }
  renderRetailBillHistory();
}

async function loadRetailBills(force = false, append = false) {
  const date = getActiveRetailDate();
  const body = document.getElementById("retailBillsBody");
  if (!body) return;

  const shouldAppend = append && retailBillHistoryLoaded && retailBillHistoryDate === date;
  const offset = shouldAppend ? retailBillHistoryNextOffset : 0;
  const requestId = ++retailBillHistoryRequestId;
  const loadMoreButton = document.getElementById("retailBillsLoadMore");

  if (shouldAppend) {
    if (loadMoreButton) {
      loadMoreButton.disabled = true;
      loadMoreButton.textContent = "Loading...";
    }
  } else {
    body.innerHTML = `<tr><td colspan="8" class="empty">Loading retail bills...</td></tr>`;
  }

  try {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    params.set("limit", String(RETAIL_BILL_HISTORY_PAGE_SIZE));
    params.set("offset", String(offset));
    const query = params.toString();
    const data = navigator.onLine
      ? await optionalApiCall(
          `/retail-bills${query ? `?${query}` : ""}`,
          { results: [], has_more: false, next_offset: offset },
          "GET",
          null,
          { cache: !force }
        )
      : { results: [], has_more: false, next_offset: offset };

    if (requestId !== retailBillHistoryRequestId) return;

    const pageResults = Array.isArray(data.results) ? data.results : [];
    retailBillHistoryServerBills = shouldAppend
      ? mergeRetailBillResults(retailBillHistoryServerBills, pageResults)
      : pageResults;
    retailBillHistoryDate = date;
    retailBillHistoryLoaded = true;
    retailBillHistoryHasMore = Boolean(data.has_more);
    retailBillHistoryNextOffset = Number(data.next_offset ?? (offset + pageResults.length));
    renderRetailBillHistory();
  } catch (e) {
    console.error(e);
    if (requestId !== retailBillHistoryRequestId) return;
    if (shouldAppend) {
      showToast("Older retail bills failed to load");
      renderRetailBillHistory();
    } else {
      body.innerHTML = `<tr><td colspan="8" class="empty">Retail bills failed to load</td></tr>`;
    }
  }
}

async function loadMoreRetailBills() {
  if (!retailBillHistoryHasMore) return;
  await loadRetailBills(true, true);
}

function addDressedStockRow(entry = null) {
  const container = document.getElementById("dressedStockRows");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "retail-item-row dressed-stock-row";
  row.innerHTML = `
    <input type="text" class="dressedStockItem" placeholder="Item name (optional)" list="retailItemSuggestions" autocomplete="off" oninput="suggestRetailItems(this)">
    <input type="number" class="dressedLiveNag" placeholder="Live NAG" min="0" step="1">
    <input type="number" class="dressedLiveWeight" placeholder="Live weight (kg)" min="0" step="0.001">
    <input type="number" class="dressedYieldWeight" placeholder="Dressed weight (kg)" min="0" step="0.001">
    <button type="button" onclick="removeRetailItemRow(this)">Remove</button>
  `;
  container.appendChild(row);

  if (entry) {
    row.querySelector(".dressedStockItem").value = entry.item_name || "";
    row.querySelector(".dressedLiveNag").value = entry.live_quantity || "";
    row.querySelector(".dressedLiveWeight").value = entry.live_weight || "";
    row.querySelector(".dressedYieldWeight").value = entry.dressed_weight || "";
  }
}

async function saveDressedStock() {
  const rows = Array.from(document.querySelectorAll("#dressedStockRows .dressed-stock-row"))
    .map(row => ({
      item_name: row.querySelector(".dressedStockItem")?.value.trim(),
      live_quantity: row.querySelector(".dressedLiveNag")?.value,
      live_weight: row.querySelector(".dressedLiveWeight")?.value,
      dressed_weight: row.querySelector(".dressedYieldWeight")?.value
    }))
    .filter(row => row.live_weight || row.dressed_weight);

  const date = document.getElementById("retailDate")?.value;
  if (!date) {
    showToast("Select bill date");
    return;
  }
  if (!rows.length) {
    showToast("Add at least one dressed stock row");
    return;
  }

  try {
    const data = await apiCall(`/dressed-stock?input_date=${encodeURIComponent(date)}`, "POST", JSON.stringify({ rows }), { "Content-Type": "application/json" });
    if (data.error) {
      showToast(data.error);
      return;
    }
    showToast(`Dressed stock saved: ${data.rows_inserted} rows`);
    const container = document.getElementById("dressedStockRows");
    if (container) container.innerHTML = "";
    addDressedStockRow();
    if (typeof clearCachedResponsesByPrefix === "function") {
      clearCachedResponsesByPrefix("/dressed-stock");
    }
    if (typeof clearOperationalCaches === "function") {
      clearOperationalCaches();
    }
    await loadDressedStock(true);
  } catch (e) {
    console.error(e);
    showToast("Dressed stock save failed");
  }
}

async function loadDressedStock(force = false) {
  const date = document.getElementById("retailDate")?.value;
  if (!date) return;

  try {
    const data = await optionalApiCall(`/dressed-stock?date=${encodeURIComponent(date)}`, { entries: [], available_items: [] }, "GET", null, { cache: !force });
    dressedStockCache = data.available_items || [];
    dressedStockLoadedForDate = date;
    renderSavedDressedStock(data.entries || []);
  } catch (e) {
    console.error(e);
    dressedStockLoadedForDate = "";
    renderSavedDressedStock([]);
  }
}

function renderSavedDressedStock(entries) {
  const body = document.getElementById("dressedStockSavedBody");
  if (!body) return;

  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No dressed stock saved for this date</td></tr>`;
    return;
  }

  body.innerHTML = "";
  entries.forEach(entry => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatDisplayDate(entry.date)}</td>
      <td>${escapeHtml(entry.item_name || "Dressed Chicken")}</td>
      <td>${formatBillNag(entry.live_quantity || 0)}</td>
      <td>${Number(entry.live_weight || 0).toFixed(3)}</td>
      <td>${Number(entry.dressed_weight || 0).toFixed(3)}</td>
      <td>${Number(entry.remaining_dressed_weight || 0).toFixed(3)}</td>
    `;
    body.appendChild(row);
  });
}

async function openRetailBill(billId) {
  try {
    if (String(billId).startsWith("local-")) {
      const localBill = getPendingRetailBills().find(bill => bill.id === billId);
      if (!localBill) {
        showToast("Offline bill not found");
        return;
      }
      populateRetailFormFromBill(localBill);
      return;
    }

    const data = await apiCall(`/retail-bills/${billId}`, "GET", null, {}, { cache: false });
    if (data.error) {
      showToast(data.error);
      return;
    }

    populateRetailFormFromBill(data);
  } catch (e) {
    console.error(e);
    showToast("Unable to open retail bill");
  }
}

function startNextPaymentReceipt() {
  resetPaymentReceiptForm();
}

function startNextRetailBill() {
  const nextMode = isCombinedRetailBillingPage() ? "regular" : (retailBillingMode === "dressed" ? "dressed" : "regular");
  const regularDate = retailField("regular", "date");
  const nextDate = regularDate?.value || formatDateInput(new Date());

  currentRetailBill = null;
  retailDraftDirty = false;
  retailBillCompleted = true;
  resetRetailForm();

  retailField("regular", "date").value = nextDate;
  setRetailBillingMode(nextMode, { loadHistory: false });
  refreshRetailBillNumber(nextMode);
  scheduleRetailPreviewRender();
}

async function printCurrentRetailBill() {
  let bill = currentRetailBill;

  if (!bill || retailDraftDirty || !isCurrentRetailBillForActiveMode()) {
    bill = await saveRetailBill({ autoStartNext: false });
  }

  if (!bill || !(bill.items || []).length) {
    showToast("No bill ready to print");
    return;
  }

  let printedViaBridge = false;
  try {
    await printThroughLocalBridge("/print/retail", buildRetailBridgePayload(bill));
    printedViaBridge = true;
    showToast(`Printed bill ${bill.bill_number}`);
  } catch (e) {
    console.error("Local retail print bridge failed", e);
    showToast("Local print bridge unavailable. Using browser print.");
    printedViaBridge = openRetailBrowserPrintWindow(bill);
  }

  currentRetailBill = bill;
  retailDraftDirty = false;
  retailBillCompleted = true;
  if (printedViaBridge) {
    startNextRetailBill();
  }
}

function getRetailBillShareText(bill) {
  const lines = [];
  lines.push(`${RETAIL_SHOP_PROFILE.name}`);
  lines.push(`Bill No: ${bill.bill_number}`);
  lines.push(`Date: ${formatDisplayDate(bill.date)}`);
  if (bill.customer_name) lines.push(`Customer: ${bill.customer_name}`);
  lines.push("");

  (bill.items || []).forEach((item, index) => {
    const lineType = (item.line_type || "STANDARD").toUpperCase();
    const weight = Number(item.weight || 0).toFixed(3);
    const amount = formatBillMoney(item.amount);
    if (lineType === "DRESSED") {
      lines.push(`${index + 1}. ${item.item_name} (Dressed) | KGS ${weight} | Rate ${formatBillRate(item.rate)} | Rs ${amount}`);
    } else {
      const nag = formatBillNag(item.nag || item.quantity || 0);
      lines.push(`${index + 1}. ${item.item_name} | NAG ${nag} | KGS ${weight} | Rate ${formatBillRate(item.rate)} | Rs ${amount}`);
    }
  });

  if (Number(bill.ice_amount || 0) > 0) {
    lines.push(`Ice | Rs ${formatBillMoney(bill.ice_amount)}`);
  }

  lines.push("");
  if (Number(bill.ice_amount || 0) > 0) {
    lines.push(`Items Total: Rs ${formatBillMoney(bill.items_subtotal_amount ?? (Number(bill.total_amount || 0) - Number(bill.ice_amount || 0)))}`);
    lines.push(`Ice Amount: Rs ${formatBillMoney(bill.ice_amount)}`);
  }
  const receiptOutstanding = bill.customer_name
    ? Number((bill.party_balance ?? bill.outstanding_amount) || 0)
    : Number(bill.outstanding_amount || 0);
  const previousBalance = Math.max(0, receiptOutstanding - Number(bill.outstanding_amount || 0));
  lines.push(`Old Balance: Rs ${formatBillMoney(previousBalance)}`);
  lines.push(`Total NAG: ${formatBillNag(bill.total_nag || bill.total_quantity || 0)}`);
  lines.push(`Total KGS: ${Number(bill.total_weight || 0).toFixed(3)}`);
  lines.push(`Total Amount: Rs ${formatBillMoney(bill.total_amount)}`);
  lines.push(`Received: Rs ${formatBillMoney(bill.paid_amount)}`);
  lines.push(`Active Balance: Rs ${formatBillMoney(receiptOutstanding)}`);
  lines.push(`Mode: ${bill.payment_mode || "Cash"}`);
  if (bill.notes) {
    lines.push(`Notes: ${bill.notes}`);
  }
  lines.push("");
  lines.push(`Thank you`);
  lines.push(`${RETAIL_SHOP_PROFILE.phone}`);
  return lines.join("\n");
}

function normalizeRetailWhatsAppPhoneNumber(value) {
  const candidates = String(value || "")
    .split(/[\/,;|]+/)
    .map(part => part.replace(/\D/g, ""))
    .filter(Boolean);
  let digits = candidates.find(number => number.length >= 10 && number.length <= 15) || "";

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;

  return digits.length >= 11 && digits.length <= 15 ? digits : "";
}

function openRetailWhatsAppConversation(phone, message, pendingWindow = null) {
  const normalizedPhone = normalizeRetailWhatsAppPhoneNumber(phone);
  if (!normalizedPhone) {
    if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
    showToast("Valid WhatsApp number not found for this party");
    return false;
  }

  const target = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.opener = null;
    pendingWindow.location.replace(target);
  } else {
    window.location.href = target;
  }
  return true;
}

async function resolveRetailWhatsAppPhone(partyName, currentPhone) {
  if (normalizeRetailWhatsAppPhoneNumber(currentPhone)) return currentPhone;
  const name = String(partyName || "").trim();
  if (name.length < 2) return currentPhone || "";

  try {
    const party = await fetchRetailPartyProfile(name);
    return party?.phone || currentPhone || "";
  } catch (error) {
    console.error("WhatsApp party phone lookup failed", error);
    return currentPhone || "";
  }
}

async function sendCurrentRetailBill() {
  const pendingWindow = window.open("about:blank", "_blank");
  let bill = currentRetailBill;

  if (!bill || retailDraftDirty || !isCurrentRetailBillForActiveMode()) {
    bill = await saveRetailBill({ autoStartNext: false });
  }

  if (!bill || !(bill.items || []).length) {
    if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
    showToast("No bill ready to send");
    return;
  }

  const shareText = getRetailBillShareText(bill);
  const customerPhone = await resolveRetailWhatsAppPhone(bill.customer_name, bill.customer_phone);

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch (e) {
      console.error("Clipboard copy failed", e);
    }
  }

  if (openRetailWhatsAppConversation(customerPhone, shareText, pendingWindow)) {
    showToast("WhatsApp opened for this party");
    startNextRetailBill();
  }
}

async function printCurrentPaymentReceipt() {
  let receipt = currentPaymentReceipt;
  if (!receipt || paymentReceiptDraftDirty) {
    receipt = await savePaymentReceipt({ autoStartNext: false });
  }

  if (!receipt || Number(receipt.amount || 0) <= 0) {
    showToast("No payment receipt ready to print");
    return;
  }

  let printedViaBridge = false;
  try {
    await printThroughLocalBridge("/print/payment-receipt", buildPaymentReceiptBridgePayload(receipt));
    printedViaBridge = true;
    showToast(`Printed receipt ${receipt.receipt_number}`);
  } catch (e) {
    console.error("Local payment receipt print bridge failed", e);
    showToast("Local print bridge unavailable. Using browser print.");
    printedViaBridge = openPaymentReceiptBrowserPrintWindow(receipt);
  }

  currentPaymentReceipt = receipt;
  paymentReceiptDraftDirty = false;
  paymentReceiptCompleted = true;
  if (printedViaBridge) {
    startNextPaymentReceipt();
  }
}

function getPaymentReceiptShareText(receipt) {
  const directionLabel = (receipt.direction || "RECEIVED") === "PAID" ? "Amount Paid" : "Amount Received";
  const oldBalance = getPaymentReceiptOldBalanceValue(receipt);
  const lines = [
    RETAIL_SHOP_PROFILE.name,
    `Receipt No: ${receipt.receipt_number}`,
    `Date: ${formatDisplayDate(receipt.date)}`,
    `Party: ${receipt.party_name || ""}`,
    `Old Balance: Rs ${formatBillMoney(oldBalance)}`,
    `${directionLabel}: Rs ${formatBillMoney(receipt.amount)}`,
    `Mode: ${receipt.payment_mode || "Cash"}`,
    `Balance After Payment: Rs ${formatBillMoney(receipt.balance_after)}`
  ];
  if (receipt.notes) lines.push(`Notes: ${receipt.notes}`);
  lines.push(RETAIL_SHOP_PROFILE.phone);
  return lines.join("\n");
}

async function sendCurrentPaymentReceipt() {
  const pendingWindow = window.open("about:blank", "_blank");
  let receipt = currentPaymentReceipt;
  if (!receipt || paymentReceiptDraftDirty) {
    receipt = await savePaymentReceipt({ autoStartNext: false });
  }

  if (!receipt || Number(receipt.amount || 0) <= 0) {
    if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
    showToast("No payment receipt ready to send");
    return;
  }

  const shareText = getPaymentReceiptShareText(receipt);
  const partyPhone = await resolveRetailWhatsAppPhone(receipt.party_name, receipt.party_phone);

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch (e) {
      console.error("Clipboard copy failed", e);
    }
  }

  if (openRetailWhatsAppConversation(partyPhone, shareText, pendingWindow)) {
    showToast("WhatsApp opened for this party");
    startNextPaymentReceipt();
  }
}

function resetPaymentReceiptForm() {
  const paymentName = document.getElementById("paymentReceiptPartyName");
  const paymentPhone = document.getElementById("paymentReceiptPartyPhone");
  const paymentOldBalance = document.getElementById("paymentReceiptOldBalance");
  paymentName.value = "";
  paymentPhone.value = "";
  if (paymentOldBalance) paymentOldBalance.value = "";
  clearLinkedPartyState(paymentName, paymentPhone, null);
  document.getElementById("paymentReceiptAmount").value = "";
  document.getElementById("paymentReceiptNotes").value = "";
  document.getElementById("paymentReceiptDirection").value = "RECEIVED";
  document.getElementById("paymentReceiptMode").value = "Cash";
  document.getElementById("paymentReceiptCashier").value = "admin";
  document.getElementById("paymentReceiptDate").value = formatDateInput(new Date());
  setRetailPartyBalance("payment", 0);
  if (paymentOldBalance) paymentOldBalance.value = "";
  currentPaymentReceipt = null;
  paymentReceiptDraftDirty = false;
  paymentReceiptCompleted = false;
  refreshPaymentReceiptNumber();
  if (retailBillingMode === "payment") {
    schedulePaymentReceiptPreviewRender();
  }
}

function resetRetailForm() {
  const draftHasItems = collectRetailItemsFromForm(isCombinedRetailBillingPage() ? "regular" : retailBillingMode).length > 0;
  if (draftHasItems && !retailBillCompleted) {
    showToast("Save or print this bill before starting a new one");
    return;
  }

  const regularRows = document.getElementById("retailRegularRows");
  const dressedRows = document.getElementById("retailDressedRows");
  if (regularRows) regularRows.innerHTML = "";
  if (dressedRows) dressedRows.innerHTML = "";

  const customerName = retailField("regular", "customerName");
  const customerPhone = retailField("regular", "customerPhone");
  const customerAddress = retailField("regular", "customerAddress");
  customerName.value = "";
  customerPhone.value = "";
  customerAddress.value = "";
  clearLinkedPartyState(customerName, customerPhone, customerAddress);
  setRetailPartyBalance("regular", 0);
  setRetailPartyBalance("dressed", 0);
  retailField("regular", "iceAmount").value = "";
  retailField("regular", "paidAmount").value = "";
  retailField("regular", "notes").value = "";
  retailField("regular", "settlementType").value = "paid";
  retailField("regular", "paymentMode").value = "Cash";
  retailField("regular", "cashier").value = "admin";
  retailField("regular", "date").value = formatDateInput(new Date());
  syncRetailSettlementUi();

  if (isCombinedRetailBillingPage()) {
    addRegularRetailRow();
    addDressedRetailRow();
  } else if (retailBillingMode === "dressed") {
    addDressedRetailRow();
  } else {
    addRegularRetailRow();
  }
  currentRetailBill = null;
  retailDraftDirty = false;
  retailBillCompleted = false;
  renderRetailOfflineBanner();
  refreshRetailBillNumber();
  scheduleRetailPreviewRender();
}

function addRetailItemForCurrentMode() {
  if (retailBillingMode === "dressed") addDressedRetailRow();
  else addRegularRetailRow();
}

function suggestRetailItems(input) {
  const suggestions = document.getElementById("retailItemSuggestions");
  const query = input?.value.trim() || "";

  clearTimeout(retailItemSuggestTimer);

  if (!suggestions || query.length < 1) {
    if (suggestions) suggestions.innerHTML = "";
    return;
  }

  retailItemSuggestTimer = setTimeout(async () => {
    try {
      const data = await optionalApiCall(`/items/search?q=${encodeURIComponent(query)}`, { results: [] });
      const merged = new Set([
        ...(data.results || []),
        ...getRetailShortcuts().map(item => item.name).filter(name => name && name.toLowerCase().includes(query.toLowerCase())),
        ...dressedStockCache.map(item => item.item_name).filter(name => name && name.toLowerCase().includes(query.toLowerCase()))
      ]);
      suggestions.innerHTML = "";
      Array.from(merged).slice(0, 20).forEach(item => {
        const option = document.createElement("option");
        option.value = item;
        suggestions.appendChild(option);
      });
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
    }
  }, 180);
}

function suggestRetailCustomers(mode = retailBillingMode) {
  const input = retailField(mode, "customerName");
  const suggestions = document.getElementById("retailCustomerSuggestions");
  const query = input?.value.trim() || "";

  clearTimeout(retailCustomerSuggestTimer);

  if (!suggestions || query.length < 1) {
    if (suggestions) suggestions.innerHTML = "";
    hideSuggestionBox("retailCustomerSuggestBox");
    return;
  }

  const cachedMatches = getRetailPartyMatches(query);
  const exactParty = getCachedPartyProfile(query);
  if (exactParty) {
    applyRetailPartyToFields(exactParty, mode);
  }
  if (cachedMatches.length) {
    renderRetailPartyMatches("retailCustomerSuggestBox", suggestions, cachedMatches, async party => {
      applyRetailPartyToFields(party, mode);
      await hydrateRetailCustomerProfile(party?.name || "", mode);
      hideSuggestionBox("retailCustomerSuggestBox");
    });
  }

  retailCustomerSuggestTimer = setTimeout(async () => {
    try {
      await ensureRetailPartyDirectoryLoaded();
      const localMatches = getRetailPartyMatches(query);
      const data = await optionalApiCall(`/party/search?name=${encodeURIComponent(query)}`, { results: [] });
      const mergedMatches = mergeRetailPartyMatches(localMatches, data.results || [], query);
      const remoteExactParty = mergedMatches.find(party => normalizeRetailPartyLookup(party.name) === normalizeRetailPartyLookup(query));
      if (!exactParty && remoteExactParty) {
        applyRetailPartyToFields(remoteExactParty, mode);
      }
      renderRetailPartyMatches("retailCustomerSuggestBox", suggestions, mergedMatches, async party => {
        applyRetailPartyToFields(party, mode);
        await hydrateRetailCustomerProfile(party?.name || "", mode);
        hideSuggestionBox("retailCustomerSuggestBox");
      });
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
      hideSuggestionBox("retailCustomerSuggestBox");
    }
  }, 200);
}

function suggestPaymentReceiptParties() {
  const input = document.getElementById("paymentReceiptPartyName");
  const suggestions = document.getElementById("paymentReceiptPartySuggestions");
  const query = input?.value.trim() || "";

  clearTimeout(paymentReceiptSuggestTimer);

  if (!suggestions || query.length < 1) {
    if (suggestions) suggestions.innerHTML = "";
    hideSuggestionBox("paymentReceiptPartySuggestBox");
    return;
  }

  const cachedMatches = getRetailPartyMatches(query);
  const exactParty = getCachedPartyProfile(query);
  if (exactParty) {
    applyPaymentReceiptPartyToFields(exactParty);
  }
  if (cachedMatches.length) {
    renderRetailPartyMatches("paymentReceiptPartySuggestBox", suggestions, cachedMatches, async party => {
      applyPaymentReceiptPartyToFields(party);
      await hydratePaymentReceiptPartyProfile(party?.name || "");
      hideSuggestionBox("paymentReceiptPartySuggestBox");
    });
  }

  paymentReceiptSuggestTimer = setTimeout(async () => {
    try {
      await ensureRetailPartyDirectoryLoaded();
      const localMatches = getRetailPartyMatches(query);
      const data = await optionalApiCall(`/party/search?name=${encodeURIComponent(query)}`, { results: [] });
      const mergedMatches = mergeRetailPartyMatches(localMatches, data.results || [], query);
      const remoteExactParty = mergedMatches.find(party => normalizeRetailPartyLookup(party.name) === normalizeRetailPartyLookup(query));
      if (!exactParty && remoteExactParty) {
        applyPaymentReceiptPartyToFields(remoteExactParty);
      }
      renderRetailPartyMatches("paymentReceiptPartySuggestBox", suggestions, mergedMatches, async party => {
        applyPaymentReceiptPartyToFields(party);
        await hydratePaymentReceiptPartyProfile(party?.name || "");
        hideSuggestionBox("paymentReceiptPartySuggestBox");
      });
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
      hideSuggestionBox("paymentReceiptPartySuggestBox");
    }
  }, 200);
}

async function hydrateRetailCustomerProfile(name, mode = retailBillingMode) {
  const query = String(name || "").trim();
  if (query.length < 2) return;

  try {
    await ensureRetailPartyDirectoryLoaded();
    let cachedParty = getCachedPartyProfile(query);
    if (cachedParty && !partyHasResolvedBalance(cachedParty)) {
      cachedParty = await fetchRetailPartyProfile(query) || cachedParty;
    }
    if (cachedParty) {
      const phoneInput = retailField(mode, "customerPhone");
      const addressInput = retailField(mode, "customerAddress");
      if (phoneInput) phoneInput.value = cachedParty.phone || "";
      if (addressInput) addressInput.value = cachedParty.address || "";
      storeLinkedPartyState(retailField(mode, "customerName"), phoneInput, addressInput, cachedParty);
      setRetailPartyBalance(mode, cachedParty.balance_after ?? cachedParty.party_balance ?? 0);
      scheduleRetailPreviewRender();
      return;
    }

    const party = await fetchRetailPartyProfile(query);
    if (!party) return;

    const phoneInput = retailField(mode, "customerPhone");
    const addressInput = retailField(mode, "customerAddress");
    if (phoneInput) phoneInput.value = party.phone || "";
    if (addressInput) addressInput.value = party.address || "";
    storeLinkedPartyState(retailField(mode, "customerName"), phoneInput, addressInput, party);
    setRetailPartyBalance(mode, party.balance_after ?? 0);
    scheduleRetailPreviewRender();
  } catch (e) {
    console.error(e);
  }
}

async function hydratePaymentReceiptPartyProfile(name) {
  const query = String(name || "").trim();
  if (query.length < 2) return;

  try {
    await ensureRetailPartyDirectoryLoaded();
    let cachedParty = getCachedPartyProfile(query);
    if (cachedParty && !partyHasResolvedBalance(cachedParty)) {
      cachedParty = await fetchRetailPartyProfile(query) || cachedParty;
    }
    if (cachedParty) {
      const phoneInput = document.getElementById("paymentReceiptPartyPhone");
      if (phoneInput) phoneInput.value = cachedParty.phone || "";
      storeLinkedPartyState(document.getElementById("paymentReceiptPartyName"), phoneInput, null, cachedParty);
      setRetailPartyBalance("payment", cachedParty.balance_after ?? cachedParty.party_balance ?? 0);
      schedulePaymentReceiptPreviewRender();
      return;
    }

    const party = await fetchRetailPartyProfile(query);
    if (!party) return;

    const phoneInput = document.getElementById("paymentReceiptPartyPhone");
    if (phoneInput) phoneInput.value = party.phone || "";
    storeLinkedPartyState(document.getElementById("paymentReceiptPartyName"), phoneInput, null, party);
    setRetailPartyBalance("payment", party.balance_after ?? party.party_balance ?? 0);
    schedulePaymentReceiptPreviewRender();
  } catch (e) {
    console.error(e);
  }
}

function formatBillQuantity(quantity, unit) {
  if (unit === "PCS") {
    return formatBillNag(quantity);
  }

  return `${Number(quantity || 0).toFixed(3)} ${unit}`;
}

function formatBillNag(value) {
  return Number(value || 0).toFixed(0);
}

function formatBillRate(value) {
  return Number(value || 0).toFixed(2);
}

function formatBillMoney(value) {
  return Number(value || 0).toFixed(2);
}

function getThermalReceiptShareStyles() {
  return `
    body { margin: 0; padding: 0; font-family: "Courier New", monospace; background: #ffffff; color: #111111; }
    .thermal-bill { width: 280px; padding: 12px 10px 14px; background: #ffffff; color: #111111; font-family: "Courier New", monospace; }
    .thermal-label { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-align: center; }
    .thermal-center { text-align: center; }
    .thermal-center h3 { margin: 3px 0 4px; font-size: 20px; line-height: 1.05; }
    .thermal-center p, .thermal-customer p, .thermal-notes { margin: 2px 0; font-size: 11px; line-height: 1.25; }
    .thermal-meta-grid, .thermal-customer, .thermal-summary { margin-top: 8px; }
    .thermal-meta-row, .thermal-summary p { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; font-size: 11px; }
    .thermal-summary { margin-top: 1px; }
    .thermal-summary-compact { margin-bottom: 2px; }
    .thermal-header-title { font-weight: 700; letter-spacing: 0.08em; }
    .thermal-balance-summary { margin-top: 4px; }
    .thermal-totals-table { margin-top: 1px; }
    .thermal-total-row td { padding-top: 3px; font-size: 11px; font-weight: 700; border-top: none; }
    .thermal-total-row td:first-child { text-align: left; }
    .thermal-rule { margin: 2px 0 0; font-size: 10px; line-height: 1; color: #5f6b7a; text-align: center; }
    .thermal-items-table { width: 100%; min-width: 0; max-width: 100%; table-layout: fixed; border-collapse: collapse; }
    .thermal-items-table th, .thermal-items-table td { padding: 2px 0; border-bottom: none; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: clip; }
    .thermal-items-table th:nth-child(1), .thermal-items-table td:nth-child(1) { width: 6%; text-align: left; }
    .thermal-items-table th:nth-child(2), .thermal-items-table td:nth-child(2) { width: 30%; text-align: left; white-space: normal; overflow-wrap: anywhere; }
    .thermal-items-table th:nth-child(3), .thermal-items-table td:nth-child(3),
    .thermal-items-table th:nth-child(4), .thermal-items-table td:nth-child(4),
    .thermal-items-table th:nth-child(5), .thermal-items-table td:nth-child(5),
    .thermal-items-table th:nth-child(6), .thermal-items-table td:nth-child(6) { text-align: right; }
    .thermal-items-table th:nth-child(3), .thermal-items-table td:nth-child(3) { width: 15%; padding-right: 6px; }
    .thermal-items-table th:nth-child(4), .thermal-items-table td:nth-child(4) { width: 17%; padding-left: 6px; padding-right: 4px; }
    .thermal-items-table th:nth-child(5), .thermal-items-table td:nth-child(5) { width: 14%; }
    .thermal-items-table th:nth-child(6), .thermal-items-table td:nth-child(6) { width: 18%; }
    .thermal-items-table.thermal-items-table-dressed th:nth-child(1), .thermal-items-table.thermal-items-table-dressed td:nth-child(1) { width: 8%; }
    .thermal-items-table.thermal-items-table-dressed th:nth-child(2), .thermal-items-table.thermal-items-table-dressed td:nth-child(2) { width: 38%; text-align: left; white-space: normal; overflow-wrap: anywhere; }
    .thermal-items-table.thermal-items-table-dressed th:nth-child(3), .thermal-items-table.thermal-items-table-dressed td:nth-child(3) { width: 18%; text-align: right; }
    .thermal-items-table.thermal-items-table-dressed th:nth-child(4), .thermal-items-table.thermal-items-table-dressed td:nth-child(4) { width: 16%; text-align: right; }
    .thermal-items-table.thermal-items-table-dressed th:nth-child(5), .thermal-items-table.thermal-items-table-dressed td:nth-child(5) { width: 20%; text-align: right; }
    .thermal-subrow td { color: #5f6b7a; font-size: 9px; padding-top: 0; padding-bottom: 2px; }
    .thermal-section-row td { padding-top: 5px; font-weight: 700; border-top: 1px dashed #a8adb7; }
    .thermal-total { margin-top: 4px; padding-top: 4px; border-top: 1px dashed #8c98a8; font-weight: 800; }
    .thermal-notes { padding-top: 6px; font-size: 10px; }
    .thermal-payment-qr { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #8c98a8; text-align: center; }
    .thermal-payment-qr strong { display: block; margin-bottom: 6px; font-size: 11px; letter-spacing: 0.04em; }
    .thermal-payment-qr-frame { width: 146px; height: 146px; margin: 0 auto; overflow: hidden; border: 1px solid #d6dce6; border-radius: 4px; background: #fff; padding: 6px; box-sizing: border-box; }
    .thermal-payment-qr img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; image-rendering: crisp-edges; }
    .thermal-payment-qr-id { margin: 6px 0 0; font-size: 9px; font-weight: 700; letter-spacing: 0.02em; word-break: break-all; }
    .thermal-footer { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #8c98a8; text-align: center; }
    .thermal-footer p { margin: 1px 0; font-size: 11px; }
  `;
}

async function renderReceiptMarkupToPngFile(markup, filenameBase) {
  const styles = getThermalReceiptShareStyles();
  if (window.html2canvas) {
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "320px";
    host.style.background = "#ffffff";
    host.style.zIndex = "-1";
    host.innerHTML = `<style>${styles}</style>${markup}`;
    document.body.appendChild(host);

    try {
      const target = host.querySelector(".thermal-bill") || host;
      const canvas = await window.html2canvas(target || host, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false
      });
      const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!pngBlob) {
        throw new Error("PNG render failed");
      }
      return new File([pngBlob], `${filenameBase}.png`, { type: "image/png" });
    } finally {
      host.remove();
    }
  }

  const width = 320;
  const height = 980;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#ffffff;">
          <style>${styles}</style>
          ${markup}
        </div>
      </foreignObject>
    </svg>
  `;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = "sync";
    const imageLoaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    image.src = url;
    await imageLoaded;

    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) {
      throw new Error("PNG render failed");
    }

    return new File([pngBlob], `${filenameBase}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadFile(file) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(file);
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function getRetailReceiptMarkup(bill) {
  const isDressedOnlyBill = (bill.items || []).length > 0 && (bill.items || []).every(item => (item.line_type || "STANDARD").toUpperCase() === "DRESSED");
  const receiptOutstanding = bill.customer_name
    ? Number((bill.party_balance ?? bill.outstanding_amount) || 0)
    : Number(bill.outstanding_amount || 0);
  const previousBalance = Math.max(0, receiptOutstanding - Number(bill.outstanding_amount || 0));
  const invoiceType = Number(bill.outstanding_amount || 0) > 0 ? "Credit" : "Cash";
  const invoiceDateTime = `${formatDisplayDate(bill.date)} ${escapeHtml(bill.time || new Date().toLocaleTimeString("en-GB"))}`;

  const renderReceiptRows = (items, sectionLabel, startIndex) => {
    if (!items.length) return "";
    const rows = items.map((item, index) => {
      const lineType = (item.line_type || "STANDARD").toUpperCase();
      const quantityText = lineType === "DRESSED" ? "" : formatBillNag(item.nag || item.quantity || 0);
      const kgsText = Number(item.weight || 0).toFixed(3);
      const rateText = formatBillRate(item.rate);
      if (isDressedOnlyBill) {
        return `
          <tr>
            <td>${startIndex + index + 1}</td>
            <td>${escapeHtml(item.item_name)}</td>
            <td>${kgsText}</td>
            <td>${rateText}</td>
            <td>${formatBillMoney(item.amount)}</td>
          </tr>
        `;
      }
      return `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td>${escapeHtml(item.item_name)}</td>
          <td>${escapeHtml(quantityText)}</td>
          <td>${kgsText}</td>
          <td>${rateText}</td>
          <td>${formatBillMoney(item.amount)}</td>
        </tr>
      `;
    }).join("");
    return `<tr class="thermal-section-row"><td colspan="6">${sectionLabel}</td></tr>${rows}`;
  };

  const regularItems = (bill.items || []).filter(item => (item.line_type || "STANDARD").toUpperCase() !== "DRESSED");
  const dressedItems = (bill.items || []).filter(item => (item.line_type || "STANDARD").toUpperCase() === "DRESSED");
  const itemsHtml = `
    ${renderReceiptRows(regularItems, "Regular Chicken", 0)}
    ${renderReceiptRows(dressedItems, "Dressed Chicken", regularItems.length)}
  `;

  const customerBlock = (bill.customer_name || bill.customer_phone || bill.customer_address) ? `
    <div class="thermal-customer">
      ${bill.customer_name ? `<p><strong>Customer</strong>: ${escapeHtml(bill.customer_name)}</p>` : ""}
      ${bill.customer_phone ? `<p><strong>Mobile No</strong>: ${escapeHtml(bill.customer_phone)}</p>` : ""}
      ${bill.customer_address ? `<p><strong>Address</strong>: ${escapeHtml(bill.customer_address)}</p>` : ""}
    </div>
  ` : "";

  return `
    <div class="thermal-bill">
      <div class="thermal-center">
        <h3>${escapeHtml(RETAIL_SHOP_PROFILE.name)}</h3>
        <p>${escapeHtml(RETAIL_SHOP_PROFILE.proprietor)}</p>
        <p>${escapeHtml(RETAIL_SHOP_PROFILE.address)}</p>
        <p>Mob. ${escapeHtml(RETAIL_SHOP_PROFILE.phone)}</p>
      </div>
      <div class="thermal-rule">----------------------------------------------</div>
      <div class="thermal-header-mini thermal-header-title">TAX INVOICE</div>

      <div class="thermal-meta-grid">
        <div class="thermal-meta-row"><span><strong>Invoice No</strong>: ${escapeHtml(bill.bill_number)}</span><span><strong>Type</strong>: ${invoiceType}</span></div>
        <div class="thermal-meta-row"><span><strong>Date</strong>: ${invoiceDateTime}</span><span></span></div>
        <div class="thermal-meta-row"><span>Cashier</span><span>${escapeHtml(bill.cashier_name || "admin")}</span></div>
      </div>

      ${customerBlock}

      <div class="thermal-rule">----------------------------------------------</div>
      <table class="thermal-items-table${isDressedOnlyBill ? " thermal-items-table-dressed" : ""}">
        <thead>
          <tr>
            ${isDressedOnlyBill
              ? `
                <th>Sl</th>
                <th>Item Name</th>
                <th>KGS</th>
                <th>Rate</th>
                <th>Amount</th>
              `
              : `
                <th>Sl</th>
                <th>Item Name</th>
                <th>NAG</th>
                <th>KGS</th>
                <th>Rate</th>
                <th>Amount</th>
              `}
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <table class="thermal-items-table thermal-totals-table${isDressedOnlyBill ? " thermal-items-table-dressed" : ""}">
        <tbody>
          ${isDressedOnlyBill
            ? `
              <tr class="thermal-total-row">
                <td></td>
                <td><strong>Total</strong></td>
                <td><strong>${Number(bill.total_weight || 0).toFixed(3)}</strong></td>
                <td></td>
                <td><strong>${formatBillMoney(bill.total_amount)}</strong></td>
              </tr>
            `
            : `
              <tr class="thermal-total-row">
                <td></td>
                <td><strong>Total</strong></td>
                <td><strong>${formatBillNag(bill.total_nag || bill.total_quantity || 0)}</strong></td>
                <td><strong>${Number(bill.total_weight || 0).toFixed(3)}</strong></td>
                <td></td>
                <td><strong>${formatBillMoney(bill.total_amount)}</strong></td>
              </tr>
            `}
        </tbody>
      </table>
      <div class="thermal-summary${Number(bill.ice_amount || 0) <= 0 ? " thermal-summary-compact" : ""}">
        <p><span>Subtotal</span><strong>${formatBillMoney(bill.items_subtotal_amount ?? (Number(bill.total_amount || 0) - Number(bill.ice_amount || 0)))}</strong></p>
        ${Number(bill.ice_amount || 0) > 0 ? `<p><span>Items Total</span><strong>${formatBillMoney(bill.items_subtotal_amount ?? (Number(bill.total_amount || 0) - Number(bill.ice_amount || 0)))}</strong></p>` : ""}
        ${Number(bill.ice_amount || 0) > 0 ? `<p><span>Ice Amount</span><strong>${formatBillMoney(bill.ice_amount)}</strong></p>` : ""}
        <p class="thermal-total"><span>Total</span><strong>${formatBillMoney(bill.total_amount)}</strong></p>
      </div>
      <div class="thermal-rule">----------------------------------------------</div>
      <div class="thermal-summary thermal-balance-summary">
        <p><span>Old Balance</span><strong>${formatBillMoney(previousBalance)}</strong></p>
        <p><span>${escapeHtml(bill.payment_mode || "Cash")} Payment</span><strong>${formatBillMoney(bill.paid_amount)}</strong></p>
        <p><span>Active Balance</span><strong>${formatBillMoney(receiptOutstanding)}</strong></p>
      </div>

      ${bill.requires_customer && !bill.customer_name ? `<div class="thermal-notes">Known customer name is required when this bill has credit outstanding.</div>` : ""}
      ${bill.notes ? `<div class="thermal-notes">${escapeHtml(bill.notes)}</div>` : ""}
      <div class="thermal-payment-qr">
        <strong>${escapeHtml(RETAIL_PAYMENT_QR_VIEW.label)}</strong>
        <div class="thermal-payment-qr-frame">
          <img src="${escapeHtml(RETAIL_PAYMENT_QR_VIEW.imageSrc)}" alt="Payment QR">
        </div>
        <p class="thermal-payment-qr-id">${escapeHtml(RETAIL_PAYMENT_QR_VIEW.upiId)}</p>
      </div>

      <div class="thermal-footer">
        <p>Created By: ${escapeHtml(bill.cashier_name || "admin")}</p>
        <p>Thank You</p>
        <p>Visit Again</p>
      </div>
    </div>
  `;
}

function getPaymentReceiptMarkup(receipt) {
  const directionLabel = (receipt.direction || "RECEIVED") === "PAID" ? "Payment Voucher" : "Payment Receipt";
  const amountLabel = (receipt.direction || "RECEIVED") === "PAID" ? "Amount Paid" : "Amount Received";
  const oldBalance = getPaymentReceiptOldBalanceValue(receipt);
  const partyBlock = (receipt.party_name || receipt.party_phone || oldBalance) ? `
    <div class="thermal-customer">
      ${receipt.party_name ? `<p><strong>Party Name</strong> : ${escapeHtml(receipt.party_name)}</p>` : ""}
      ${receipt.party_phone ? `<p><strong>Phone</strong> : ${escapeHtml(receipt.party_phone)}</p>` : ""}
      <p><strong>Old Balance</strong> : ${formatBillMoney(oldBalance)}</p>
    </div>
  ` : "";

  return `
    <div class="thermal-bill">
      <div class="thermal-label">${escapeHtml(directionLabel)}</div>
      <div class="thermal-center">
        <h3>${escapeHtml(RETAIL_SHOP_PROFILE.name)}</h3>
        <p>${escapeHtml(RETAIL_SHOP_PROFILE.proprietor)}</p>
        <p>${escapeHtml(RETAIL_SHOP_PROFILE.address)}</p>
        <p>Mob. ${escapeHtml(RETAIL_SHOP_PROFILE.phone)}</p>
      </div>

      <div class="thermal-meta-grid">
        <div class="thermal-meta-row"><span>Receipt no</span><span>${escapeHtml(receipt.receipt_number)}</span></div>
        <div class="thermal-meta-row"><span>Date</span><span>${formatDisplayDate(receipt.date)}</span></div>
        <div class="thermal-meta-row"><span>Time</span><span>${escapeHtml(receipt.time || new Date().toLocaleTimeString("en-GB"))}</span></div>
        <div class="thermal-meta-row"><span>Handled by</span><span>${escapeHtml(receipt.cashier_name || "admin")}</span></div>
      </div>

      ${partyBlock}

      <div class="thermal-rule">----------------------------------------------</div>
      <div class="thermal-summary">
        <p><span>Direction</span><strong>${escapeHtml(receipt.direction || "RECEIVED")}</strong></p>
        <p><span>Mode</span><strong>${escapeHtml(receipt.payment_mode || "Cash")}</strong></p>
        <p class="thermal-total"><span>${amountLabel}</span><strong>${formatBillMoney(receipt.amount)}</strong></p>
        <p><span>Balance After Payment</span><strong>${formatBillMoney(receipt.balance_after)}</strong></p>
      </div>
      ${receipt.notes ? `<div class="thermal-notes">${escapeHtml(receipt.notes)}</div>` : ""}

      <div class="thermal-footer">
        <p>Thank You</p>
        <p>Visit Again</p>
      </div>
    </div>
  `;
}

function getRetailRowLineType(row) {
  return (row?.dataset.lineType || "STANDARD").toUpperCase();
}

function syncRetailLineUi(row) {
  const lineType = getRetailRowLineType(row);
  const unitInput = row?.querySelector(".retailUnit");
  const weightInput = row?.querySelector(".retailWeight");
  const rateInput = row?.querySelector(".retailRate");
  const qtyInput = row?.querySelector(".retailQty");
  const amountInput = row?.querySelector(".retailAmount");

  if (!unitInput || !weightInput || !rateInput || !qtyInput || !amountInput) return;
  row.classList.toggle("retail-item-row-dressed", lineType === "DRESSED");

  if (lineType === "DRESSED") {
    unitInput.value = "KGS";
    unitInput.disabled = true;
    qtyInput.value = "";
    qtyInput.placeholder = "";
    weightInput.placeholder = "KGS";
    amountInput.placeholder = "Amount";
    rateInput.placeholder = "Rate";
    rateInput.readOnly = false;
  } else {
    unitInput.disabled = false;
    qtyInput.placeholder = "NAG";
    weightInput.placeholder = "KGS";
    amountInput.placeholder = "Amount";
    rateInput.placeholder = "Rate";
    rateInput.readOnly = false;
  }
}

function getPendingRetailBills() {
  try {
    return JSON.parse(localStorage.getItem(RETAIL_PENDING_STORAGE_KEY) || "[]");
  } catch (e) {
    console.error("Failed to parse pending retail bills", e);
    return [];
  }
}

function setPendingRetailBills(bills) {
  localStorage.setItem(RETAIL_PENDING_STORAGE_KEY, JSON.stringify(bills));
}

function queueRetailBillForSync(draft) {
  const pendingBills = getPendingRetailBills();
  const localId = `local-${Date.now()}`;
  const offlineBill = {
    ...draft,
    id: localId,
    local_only: true,
    sync_status: "Pending Sync",
    payment_mode: draft.payment_mode || "Cash",
    pending_since: new Date().toISOString(),
    last_error: "No internet connection"
  };

  pendingBills.push(offlineBill);
  setPendingRetailBills(pendingBills);
  renderRetailOfflineBanner();
  return offlineBill;
}

function shouldQueueRetailOffline(error) {
  if (!navigator.onLine) return true;
  const message = String(error?.message || error || "");
  return message.includes("Network") || message.includes("fetch");
}

function computeNextRetailBillNumber(date, baseline = "1") {
  const pendingBills = getPendingRetailBills();
  const maxPending = pendingBills.reduce((maxValue, bill) => {
    if ((bill.date || "") !== String(date || "")) return maxValue;
    const digits = Number(String(bill.bill_number || "").replace(/\D/g, "")) || 0;
    return Math.max(maxValue, digits);
  }, 0);
  const baseValue = Number(String(baseline || "1").replace(/\D/g, "")) || 1;
  return String(Math.max(baseValue, maxPending + 1));
}

function mergeRetailBillResults(serverBills, pendingBills) {
  const seen = new Set();
  const merged = [...pendingBills, ...serverBills].filter(bill => {
    const key = String(bill?.id || `${bill?.date || ""}|${bill?.bill_number || ""}|${bill?.local_only ? "local" : "server"}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.sort((a, b) => {
    if ((a.date || "") !== (b.date || "")) return (b.date || "").localeCompare(a.date || "");
    return Number(String(b.bill_number || "").replace(/\D/g, "")) - Number(String(a.bill_number || "").replace(/\D/g, ""));
  });
}

function normalizeRetailBillFingerprintValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRetailBillNumberValue(value) {
  return String(value || "").trim();
}

function normalizeRetailBillNumericValue(value, decimals = 2) {
  return Number(value || 0).toFixed(decimals);
}

function normalizeRetailBillLineTypeValue(value) {
  return String(value || "STANDARD").trim().toUpperCase();
}

function normalizeRetailBillItemNameValue(value) {
  return normalizeRetailBillFingerprintValue(value).replace(/\s+/g, " ");
}

function retailBillLineSignature(item) {
  return [
    normalizeRetailBillLineTypeValue(item?.line_type),
    normalizeRetailBillItemNameValue(item?.item_name),
    normalizeRetailBillNumericValue(item?.quantity ?? item?.nag ?? 0, 3),
    normalizeRetailBillFingerprintValue(item?.unit || ""),
    normalizeRetailBillNumericValue(item?.weight || 0, 3),
    normalizeRetailBillNumericValue(item?.rate || 0, 3),
    normalizeRetailBillNumericValue(item?.amount || 0, 2)
  ].join("|");
}

function retailBillItemsSignature(bill) {
  const items = Array.isArray(bill?.items) ? [...bill.items] : [];
  return items
    .sort((a, b) => Number(a?.line_order || 0) - Number(b?.line_order || 0))
    .map(retailBillLineSignature)
    .join("||");
}

function retailBillSummarySignature(bill) {
  return [
    String(bill?.date || ""),
    normalizeRetailBillNumberValue(bill?.bill_number),
    normalizeRetailBillFingerprintValue(bill?.customer_name),
    normalizeRetailBillFingerprintValue(bill?.customer_phone).replace(/\D/g, ""),
    normalizeRetailBillMode(bill),
    normalizeRetailBillNumericValue(bill?.total_amount || 0, 2),
    normalizeRetailBillNumericValue(bill?.paid_amount || 0, 2),
    normalizeRetailBillNumericValue(bill?.outstanding_amount || 0, 2),
    normalizeRetailBillNumericValue(bill?.ice_amount || 0, 2),
    normalizeRetailBillNumericValue(bill?.total_quantity ?? bill?.total_nag ?? 0, 3),
    normalizeRetailBillNumericValue(bill?.total_weight || 0, 3),
    String(Array.isArray(bill?.items) ? bill.items.length : 0)
  ].join("|");
}

function retailBillFingerprintParts(bill) {
  return {
    date: String(bill?.date || ""),
    billNumber: normalizeRetailBillNumberValue(bill?.bill_number),
    customerName: normalizeRetailBillFingerprintValue(bill?.customer_name),
    customerPhone: normalizeRetailBillFingerprintValue(bill?.customer_phone).replace(/\D/g, ""),
    totalAmount: normalizeRetailBillNumericValue(bill?.total_amount || 0, 2),
    paidAmount: normalizeRetailBillNumericValue(bill?.paid_amount || 0, 2),
    outstandingAmount: normalizeRetailBillNumericValue(bill?.outstanding_amount || 0, 2),
    totalNag: normalizeRetailBillNumericValue(bill?.total_quantity ?? bill?.total_nag ?? 0, 3),
    totalWeight: normalizeRetailBillNumericValue(bill?.total_weight || 0, 3),
    iceAmount: normalizeRetailBillNumericValue(bill?.ice_amount || 0, 2),
    mode: normalizeRetailBillMode(bill),
    itemSignature: retailBillItemsSignature(bill),
    summarySignature: retailBillSummarySignature(bill)
  };
}

function retailBillsMatchByFingerprint(localBill, remoteBill) {
  const local = retailBillFingerprintParts(localBill);
  const remote = retailBillFingerprintParts(remoteBill);

  if (local.date !== remote.date || local.billNumber !== remote.billNumber) {
    return false;
  }

  if (local.itemSignature && remote.itemSignature && local.itemSignature === remote.itemSignature) {
    return local.summarySignature === remote.summarySignature
      || (
        local.totalAmount === remote.totalAmount
        && local.paidAmount === remote.paidAmount
        && local.outstandingAmount === remote.outstandingAmount
        && local.mode === remote.mode
      );
  }

  if (local.summarySignature === remote.summarySignature) {
    return true;
  }

  const customerMatches = !!local.customerName && local.customerName === remote.customerName;
  const phoneMatches = !!local.customerPhone && local.customerPhone === remote.customerPhone;
  return (
    local.totalAmount === remote.totalAmount
    && local.paidAmount === remote.paidAmount
    && local.outstandingAmount === remote.outstandingAmount
    && local.totalNag === remote.totalNag
    && local.totalWeight === remote.totalWeight
    && local.iceAmount === remote.iceAmount
    && local.mode === remote.mode
    && (customerMatches || phoneMatches || (!local.customerName && !remote.customerName))
  );
}

async function findMatchingRemoteRetailBill(pendingBill) {
  if (!pendingBill?.date || !pendingBill?.bill_number) return null;
  const params = new URLSearchParams({
    date: String(pendingBill.date),
    bill_number: String(pendingBill.bill_number),
    limit: "5"
  });
  const response = await apiCall(`/retail-bills?${params.toString()}`, "GET", null, {}, { loader: false });
  const results = Array.isArray(response?.results) ? response.results : [];
  const candidates = results.filter(serverBill =>
    String(serverBill?.date || "") === String(pendingBill.date || "")
    && normalizeRetailBillNumberValue(serverBill?.bill_number) === normalizeRetailBillNumberValue(pendingBill?.bill_number)
  );

  if (!candidates.length) return null;

  for (const candidate of candidates) {
    const details = await apiCall(`/retail-bills/${candidate.id}`, "GET", null, {}, { loader: false });
    if (!details?.error && retailBillsMatchByFingerprint(pendingBill, details)) {
      return details;
    }
  }

  return null;
}

function renderRetailOfflineBanner() {
  const banner = document.getElementById("retailOfflineBanner");
  if (!banner) return;

  const pendingCount = getPendingRetailBills().length;
  if (navigator.onLine && pendingCount === 0) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }

  const statusText = navigator.onLine
    ? `${pendingCount} retail bill${pendingCount === 1 ? "" : "s"} waiting to sync.`
    : `Offline mode. ${pendingCount} retail bill${pendingCount === 1 ? "" : "s"} saved locally.`;

  banner.className = `notice ${navigator.onLine ? "warning" : "info"}`;
  banner.style.display = "block";
  banner.innerHTML = `
    <strong>${statusText}</strong>
    <div class="offline-banner-actions">
      <button type="button" onclick="syncPendingRetailBills()">${navigator.onLine ? "Sync Now" : "Retry When Online"}</button>
    </div>
  `;
}

async function syncPendingRetailBills(silent = false) {
  if (!navigator.onLine) {
    renderRetailOfflineBanner();
    return;
  }

  const pendingBills = getPendingRetailBills();
  if (!pendingBills.length) {
    renderRetailOfflineBanner();
    return;
  }

  const remaining = [];
  let syncedCount = 0;

  for (const bill of pendingBills) {
    try {
      const response = await apiCall("/retail-bills", "POST", JSON.stringify({
        date: bill.date,
        bill_number: bill.bill_number,
        cashier_name: bill.cashier_name,
        customer_name: bill.customer_name,
        customer_phone: bill.customer_phone,
        customer_address: bill.customer_address,
        payment_mode: bill.payment_mode,
        paid_amount: bill.paid_amount,
        ice_amount: bill.ice_amount,
        notes: bill.notes,
        items: bill.items
      }), { "Content-Type": "application/json" }, { loader: false });

      if (response?.error) {
        if (String(response.error || "").toLowerCase().includes("already exists")) {
          const existingBill = await findMatchingRemoteRetailBill(bill);
          if (existingBill) {
            syncedCount += 1;
            continue;
          }
        }
        remaining.push({ ...bill, last_error: response.error });
        continue;
      }

      if (currentRetailBill?.id === bill.id) {
        currentRetailBill = response.bill;
        populateRetailFormFromBill(response.bill);
      }
      if (typeof clearCachedResponsesByPrefix === "function") {
        clearCachedResponsesByPrefix("/retail-bills");
      }
      syncedCount += 1;
    } catch (e) {
      remaining.push({ ...bill, last_error: String(e?.message || e || "Sync failed") });
    }
  }

  setPendingRetailBills(remaining);
  renderRetailOfflineBanner();
  await loadRetailBills(true);
  await refreshRetailBillNumber();
  await loadDressedStock(true);

  if (!silent && syncedCount > 0) {
    showToast(`${syncedCount} offline retail bill${syncedCount === 1 ? "" : "s"} synced`);
  }
}

function attachRetailConnectivityListeners() {
  if (retailConnectivityListenersAttached) return;

  window.addEventListener("online", () => {
    renderRetailOfflineBanner();
    syncPendingRetailBills();
  });
  window.addEventListener("offline", () => {
    renderRetailOfflineBanner();
  });

  retailConnectivityListenersAttached = true;
}

function formatRetailBillMode(bill) {
  const normalizedMode = normalizeRetailBillMode(bill);
  const mode = normalizedMode === "dressed" ? "Dressed" : normalizedMode === "both" ? "Regular + Dressed" : "Regular";
  return bill.local_only ? `${mode} • Pending` : mode;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
