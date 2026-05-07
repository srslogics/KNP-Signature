const RETAIL_SHOP_PROFILE = {
  name: "NP Chicken Shop",
  proprietor: "Prop. Sandeep S. Alag (Appu)",
  address: "Shop No. 58, Kamaal Chowk Bazaar, Nagpur",
  phone: "9371291195 / 7972329562"
};

const RETAIL_SHORTCUT_ITEMS = [
  { name: "CB", rate: 0, line_type: "STANDARD", unit: "KGS" },
  { name: "BB", rate: 0, line_type: "STANDARD", unit: "KGS" },
  { name: "COCREL", rate: 0, line_type: "STANDARD", unit: "KGS" },
  { name: "DESI", rate: 0, line_type: "STANDARD", unit: "KGS" },
  { name: "LEGOAN", rate: 0, line_type: "STANDARD", unit: "KGS" },
  { name: "LOOS", rate: 0, line_type: "STANDARD", unit: "KGS" }
];
const RETAIL_PENDING_STORAGE_KEY = "stockpilot.retail.pending";
const RETAIL_SHORTCUT_STORAGE_KEY = "stockpilot.retail.shortcuts";

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
const retailPartyBalanceByMode = {
  regular: 0,
  dressed: 0
};
let retailSuggestHideTimer = null;

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

function initRetailPage() {
  retailPageBootstrapped = false;
  paymentReceiptHistoryLoaded = false;
  dressedStockLoadedForDate = "";
  const regularDate = retailField("regular", "date");
  if (!regularDate) return;

  regularDate.value = formatDateInput(new Date());
  regularDate.addEventListener("change", async () => {
    await refreshRetailBillNumber();
    await loadRetailBills();
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
    "paymentReceiptPartyAddress",
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
    paymentReceiptPartyName.addEventListener("change", () => hydratePaymentReceiptPartyProfile(paymentReceiptPartyName.value));
    paymentReceiptPartyName.addEventListener("blur", () => hydratePaymentReceiptPartyProfile(paymentReceiptPartyName.value));
    paymentReceiptPartyName.addEventListener("blur", () => scheduleSuggestionBoxHide("paymentReceiptPartySuggestBox"));
  }

  attachRetailConnectivityListeners();
  addRegularRetailRow();
  renderRetailShortcuts();
  renderShortcutManagerList();
  renderRetailOfflineBanner();
  syncRetailSettlementUi();
  setRetailBillingMode("regular");
  ensureRetailPartyDirectoryLoaded();
  refreshRetailBillNumber();
  scheduleRetailPreviewRender();
  loadRetailBills();
  syncPendingRetailBills(true);
  retailPageBootstrapped = true;
}

function setRetailBillingMode(mode) {
  retailBillingMode = mode === "dressed" ? "dressed" : mode === "payment" ? "payment" : "regular";
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
  if (regularSection) regularSection.style.display = retailBillingMode === "regular" ? "" : "none";
  if (dressedSection) dressedSection.style.display = retailBillingMode === "dressed" ? "" : "none";
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
    if (retailBillingMode === "dressed") {
      modeTitle.innerText = "Dressed Billing";
    } else if (retailBillingMode === "payment") {
      modeTitle.innerText = "Payment Receipt";
    } else {
      modeTitle.innerText = "Regular Billing";
    }
  }
  if (previewTitle) {
    if (retailBillingMode === "payment") {
      previewTitle.innerText = "Payment Receipt Preview";
    } else if (retailBillingMode === "dressed") {
      previewTitle.innerText = "Dressed Bill Preview";
    } else {
      previewTitle.innerText = "Regular Bill Preview";
    }
  }
  if (historyTitle) {
    historyTitle.innerText = retailBillingMode === "dressed" ? "Recent Dressed Bills" : "Recent Retail Bills";
  }
  if (addItemButton) {
    addItemButton.innerText = retailBillingMode === "dressed" ? "Add Dressed Item" : "Add Regular Item";
  }

  if (retailBillingMode === "payment") {
    ensurePaymentReceiptModeReady();
    schedulePaymentReceiptPreviewRender();
  } else {
    if (retailBillingMode === "dressed") {
      ensureDressedModeReady();
    } else {
      ensureRegularModeReady();
    }
    if (currentRetailBill && !retailDraftDirty && getRetailBillMode(currentRetailBill) === retailBillingMode) {
      renderRetailPreview(currentRetailBill);
    }
    scheduleRetailPreviewRender();
    loadRetailBills();
  }
}

function getRetailBillMode(bill) {
  const hasDressed = (bill?.items || []).some(item => (item.line_type || "STANDARD").toUpperCase() === "DRESSED");
  return hasDressed ? "dressed" : "regular";
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
  retailSuggestHideTimer = setTimeout(() => hideSuggestionBox(boxId), 120);
}

function getCachedPartyProfile(name) {
  const normalized = normalizeRetailPartyLookup(name);
  if (!normalized) return null;
  return retailPartyDirectoryCache.find(party => normalizeRetailPartyLookup(party.name) === normalized) || null;
}

function setRetailPartyBalance(mode, value) {
  if (!retailPartyBalanceByMode[mode]) retailPartyBalanceByMode[mode] = 0;
  retailPartyBalanceByMode[mode] = Number(value || 0);
}

function getRetailPartyBalance(mode) {
  return Number(retailPartyBalanceByMode[mode] || 0);
}

function applyRetailPartyToFields(party, mode = retailBillingMode) {
  if (!party) return;
  const input = retailField(mode, "customerName");
  const phoneInput = retailField(mode, "customerPhone");
  const addressInput = retailField(mode, "customerAddress");
  if (input) input.value = party.name || input.value;
  if (phoneInput && !phoneInput.value.trim()) phoneInput.value = party.phone || "";
  if (addressInput && !addressInput.value.trim()) addressInput.value = party.address || "";
  setRetailPartyBalance(mode, party.balance_after ?? party.party_balance ?? 0);
  scheduleRetailPreviewRender();
}

function applyPaymentReceiptPartyToFields(party) {
  if (!party) return;
  const input = document.getElementById("paymentReceiptPartyName");
  const phoneInput = document.getElementById("paymentReceiptPartyPhone");
  const addressInput = document.getElementById("paymentReceiptPartyAddress");
  if (input) input.value = party.name || input.value;
  if (phoneInput && !phoneInput.value.trim()) phoneInput.value = party.phone || "";
  if (addressInput && !addressInput.value.trim()) addressInput.value = party.address || "";
  schedulePaymentReceiptPreviewRender();
}

function renderRetailPartyMatches(boxId, suggestions, parties, onPick) {
  fillPartySuggestions(suggestions, parties);
  renderPartySuggestionBox(boxId, parties, onPick);
}

function isCurrentRetailBillForActiveMode() {
  return !!currentRetailBill && getRetailBillMode(currentRetailBill) === retailBillingMode;
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
  try {
    const saved = JSON.parse(localStorage.getItem(RETAIL_SHORTCUT_STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) {
      return saved;
    }
  } catch (e) {
    console.error("Failed to load shortcuts", e);
  }
  return RETAIL_SHORTCUT_ITEMS;
}

function setRetailShortcuts(shortcuts) {
  localStorage.setItem(RETAIL_SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
}

function saveRetailShortcut() {
  const name = document.getElementById("shortcutName")?.value.trim();
  const lineType = retailBillingMode === "dressed"
    ? "DRESSED"
    : (document.getElementById("shortcutLineType")?.value || "STANDARD");
  const rate = Number(document.getElementById("shortcutRate")?.value || 0);
  const unit = lineType === "DRESSED" ? "KGS" : (document.getElementById("shortcutUnit")?.value || "KGS");

  if (!name) {
    showToast("Enter shortcut item name");
    return;
  }

  const shortcuts = getRetailShortcuts().filter(item => item.name.toLowerCase() !== name.toLowerCase());
  shortcuts.push({ name, rate, line_type: lineType, unit });
  shortcuts.sort((a, b) => a.name.localeCompare(b.name));
  setRetailShortcuts(shortcuts);
  renderRetailShortcuts();
  renderShortcutManagerList();
  document.getElementById("shortcutName").value = "";
  const shortcutRateInput = document.getElementById("shortcutRate");
  if (shortcutRateInput) shortcutRateInput.value = "";
  showToast("Shortcut saved");
}

function removeRetailShortcut(name) {
  const shortcuts = getRetailShortcuts().filter(item => item.name !== name);
  setRetailShortcuts(shortcuts);
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
      ? `${shortcut.name} | DRESSED | Rs ${Number(shortcut.rate || 0).toFixed(2)}`
      : `${shortcut.name} | ${shortcut.line_type || "STANDARD"} | ${shortcut.unit || "KGS"} | Rs ${Number(shortcut.rate || 0).toFixed(2)}`;
    const button = document.createElement("button");
    button.type = "button";
    button.innerText = "Remove";
    button.onclick = () => removeRetailShortcut(shortcut.name);
    chip.appendChild(text);
    chip.appendChild(button);
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
  row.innerHTML = `
    <input type="text" class="retailItemName" placeholder="Item name" list="retailItemSuggestions" autocomplete="off" oninput="suggestRetailItems(this); recalcRetailLine(this)">
    <input type="number" class="retailQty" placeholder="NAG" min="0" step="0.01" oninput="recalcRetailLine(this)">
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
    if (lineType !== "DRESSED" && (!unitInput.value || unitInput.value === "KGS")) {
      unitInput.value = shortcut.unit || unitInput.value || "KGS";
    }
    if (Number(rateInput.value || 0) <= 0 && Number(shortcut.rate || 0) > 0) {
      rateInput.value = Number(shortcut.rate).toFixed(2);
    }
  }
}

function collectRetailItemsFromForm(mode = retailBillingMode) {
  const selector = mode === "dressed"
    ? "#retailDressedRows .retail-item-row"
    : "#retailRegularRows .retail-item-row";

  return Array.from(document.querySelectorAll(selector))
    .map(row => {
      const lineType = getRetailRowLineType(row);
      const quantity = lineType === "DRESSED" ? 0 : Number(row.querySelector(".retailQty")?.value || 0);
      const weight = Number(row.querySelector(".retailWeight")?.value || 0);
      return {
        item_name: row.querySelector(".retailItemName")?.value.trim(),
        line_type: lineType,
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
    bill_mode: mode,
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
    party_address: document.getElementById("paymentReceiptPartyAddress")?.value.trim() || "",
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

  retailField(billMode, "date").value = bill.date || formatDateInput(new Date());
  retailField(billMode, "billNumber").value = bill.bill_number || "";
  retailField(billMode, "cashier").value = bill.cashier_name || "admin";
  const totalAmount = Number(bill.total_amount || 0);
  const paidAmount = Number(bill.paid_amount || 0);
  let settlementType = "partial";
  if (paidAmount <= 0) settlementType = "credit";
  else if (paidAmount >= totalAmount) settlementType = "paid";
  retailField(billMode, "settlementType").value = settlementType;
  retailField(billMode, "paymentMode").value = bill.payment_mode || "Cash";
  retailField(billMode, "customerName").value = bill.customer_name || "";
  retailField(billMode, "customerPhone").value = bill.customer_phone || "";
  retailField(billMode, "customerAddress").value = bill.customer_address || "";
  retailField(billMode, "iceAmount").value = bill.ice_amount ?? "";
  retailField(billMode, "paidAmount").value = bill.paid_amount ?? "";
  retailField(billMode, "notes").value = bill.notes || "";
  syncRetailSettlementUi(billMode);
  if (settlementType === "partial") {
    retailField(billMode, "paidAmount").value = bill.paid_amount ?? "";
  }

  regularRows.innerHTML = "";
  dressedRows.innerHTML = "";
  (bill.items || []).forEach(item => {
    if (billMode === "dressed" && (item.line_type || "STANDARD").toUpperCase() === "DRESSED") {
      addRetailItemRow(item, "DRESSED");
    }
    if (billMode === "regular" && (item.line_type || "STANDARD").toUpperCase() !== "DRESSED") {
      addRetailItemRow(item, "STANDARD");
    }
  });

  if (billMode === "regular" && !(bill.items || []).some(item => (item.line_type || "STANDARD").toUpperCase() === "STANDARD")) {
    addRegularRetailRow();
  }
  if (billMode === "dressed" && !(bill.items || []).some(item => (item.line_type || "STANDARD").toUpperCase() === "DRESSED")) {
    addDressedRetailRow();
  }

  currentRetailBill = bill;
  retailDraftDirty = false;
  retailBillCompleted = true;
  setRetailBillingMode(billMode);
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
    showToast(retailBillingMode === "dressed" ? "Add at least one dressed item" : "Add at least one regular item");
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
    await loadRetailBills();
    if (retailBillingMode === "dressed") {
      await loadDressedStock();
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
      await loadRetailBills();
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
  document.getElementById("paymentReceiptPartyAddress").value = receipt.party_address || "";
  document.getElementById("paymentReceiptDirection").value = receipt.direction || "RECEIVED";
  document.getElementById("paymentReceiptMode").value = receipt.payment_mode || "Cash";
  document.getElementById("paymentReceiptAmount").value = receipt.amount ?? "";
  document.getElementById("paymentReceiptNotes").value = receipt.notes || "";

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
    await loadPaymentReceipts();
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

async function loadPaymentReceipts() {
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
      { cache: false }
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

async function loadRetailBills() {
  const date = getActiveRetailDate();
  const body = document.getElementById("retailBillsBody");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="8" class="empty">Loading retail bills...</td></tr>`;

  try {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    const query = params.toString();
    const pendingBills = getPendingRetailBills().filter(bill => !date || bill.date === date);
    const data = navigator.onLine
      ? await optionalApiCall(
          `/retail-bills${query ? `?${query}` : ""}`,
          { results: [] },
          "GET",
          null,
          { cache: false }
        )
      : { results: [] };

    const mergedResults = mergeRetailBillResults(data.results || [], pendingBills);
    const visibleResults = mergedResults.filter(bill => normalizeRetailBillMode(bill) === retailBillingMode);

    if (!visibleResults.length) {
      body.innerHTML = `<tr><td colspan="8" class="empty">No ${retailBillingMode === "dressed" ? "dressed" : "regular"} bills for this date</td></tr>`;
      return;
    }

    body.innerHTML = "";
    visibleResults.forEach(bill => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(bill.bill_number)}</td>
        <td>${formatDisplayDate(bill.date)}</td>
        <td>${escapeHtml(bill.customer_name || "Walk-in Customer")}</td>
        <td>${escapeHtml(formatRetailBillMode(bill))}</td>
        <td>${formatBillMoney(bill.total_amount)}</td>
        <td>${formatBillMoney(bill.paid_amount)}</td>
        <td>${formatBillMoney(bill.outstanding_amount)}</td>
        <td><button type="button" onclick="openRetailBill('${bill.id}')">Open</button></td>
      `;
      body.appendChild(row);
    });
  } catch (e) {
    console.error(e);
    body.innerHTML = `<tr><td colspan="8" class="empty">Retail bills failed to load</td></tr>`;
  }
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
    await loadDressedStock();
  } catch (e) {
    console.error(e);
    showToast("Dressed stock save failed");
  }
}

async function loadDressedStock() {
  const date = document.getElementById("retailDate")?.value;
  if (!date) return;

  try {
    const data = await optionalApiCall(`/dressed-stock?date=${encodeURIComponent(date)}`, { entries: [], available_items: [] }, "GET", null, { cache: false });
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
  const nextMode = retailBillingMode === "dressed" ? "dressed" : "regular";
  const regularDate = retailField("regular", "date");
  const nextDate = regularDate?.value || formatDateInput(new Date());

  currentRetailBill = null;
  retailDraftDirty = false;
  retailBillCompleted = true;
  resetRetailForm();

  retailField("regular", "date").value = nextDate;
  setRetailBillingMode(nextMode);
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

  const printWindow = window.open("", "_blank", "width=420,height=820");
  if (!printWindow) {
    showToast("Allow popups to print bill");
    return;
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
          .thermal-header-mini { margin-top: 2px; font-size: 10px; }
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

  currentRetailBill = bill;
  retailDraftDirty = false;
  retailBillCompleted = true;
  startNextRetailBill();
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
  lines.push(`Total Amount: Rs ${formatBillMoney(bill.total_amount)}`);
  lines.push(`Received: Rs ${formatBillMoney(bill.paid_amount)}`);
  lines.push(`Remaining: Rs ${formatBillMoney(receiptOutstanding)}`);
  lines.push(`Mode: ${bill.payment_mode || "Cash"}`);
  if (bill.notes) {
    lines.push(`Notes: ${bill.notes}`);
  }
  lines.push("");
  lines.push(`Thank you`);
  lines.push(`${RETAIL_SHOP_PROFILE.phone}`);
  return lines.join("\n");
}

async function sendCurrentRetailBill() {
  let bill = currentRetailBill;

  if (!bill || retailDraftDirty || !isCurrentRetailBillForActiveMode()) {
    bill = await saveRetailBill({ autoStartNext: false });
  }

  if (!bill || !(bill.items || []).length) {
    showToast("No bill ready to send");
    return;
  }

  const shareText = getRetailBillShareText(bill);
  const customerPhone = String(bill.customer_phone || "").replace(/\D/g, "");
  const markup = getRetailReceiptMarkup(bill);

  try {
    const imageFile = await renderReceiptMarkupToPngFile(markup, `retail-bill-${bill.bill_number}`);
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [imageFile] })) {
      await navigator.share({
        title: `Retail Bill ${bill.bill_number}`,
        text: `Retail bill ${bill.bill_number}`,
        files: [imageFile]
      });
      showToast("Bill image shared");
      startNextRetailBill();
      return;
    }

    downloadFile(imageFile);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareText);
      } catch (e) {
        console.error("Clipboard copy failed", e);
      }
    }
    const whatsappTarget = customerPhone ? `https://wa.me/${customerPhone}` : `https://wa.me/`;
    window.open(whatsappTarget, "_blank", "noopener,noreferrer");
    showToast("Receipt image downloaded. Attach it in WhatsApp.");
    startNextRetailBill();
    return;
  } catch (e) {
    console.error("Image share failed", e);
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: `Retail Bill ${bill.bill_number}`,
        text: shareText
      });
      showToast("Bill shared");
      startNextRetailBill();
      return;
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.error(e);
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch (e) {
      console.error("Clipboard copy failed", e);
    }
  }

  const whatsappTarget = customerPhone ? `https://wa.me/${customerPhone}?text=${encodeURIComponent(shareText)}` : `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  window.open(whatsappTarget, "_blank", "noopener,noreferrer");
  showToast(customerPhone ? "Bill copied and WhatsApp opened" : "Bill text copied. Add receiver and send");
  startNextRetailBill();
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

  const printWindow = window.open("", "_blank", "width=420,height=820");
  if (!printWindow) {
    showToast("Allow popups to print receipt");
    return;
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

  currentPaymentReceipt = receipt;
  paymentReceiptDraftDirty = false;
  paymentReceiptCompleted = true;
  startNextPaymentReceipt();
}

function getPaymentReceiptShareText(receipt) {
  const directionLabel = (receipt.direction || "RECEIVED") === "PAID" ? "Amount Paid" : "Amount Received";
  const lines = [
    RETAIL_SHOP_PROFILE.name,
    `Receipt No: ${receipt.receipt_number}`,
    `Date: ${formatDisplayDate(receipt.date)}`,
    `Party: ${receipt.party_name || ""}`,
    `${directionLabel}: Rs ${formatBillMoney(receipt.amount)}`,
    `Mode: ${receipt.payment_mode || "Cash"}`,
    `Balance After Payment: Rs ${formatBillMoney(receipt.balance_after)}`
  ];
  if (receipt.notes) lines.push(`Notes: ${receipt.notes}`);
  lines.push(RETAIL_SHOP_PROFILE.phone);
  return lines.join("\n");
}

async function sendCurrentPaymentReceipt() {
  let receipt = currentPaymentReceipt;
  if (!receipt || paymentReceiptDraftDirty) {
    receipt = await savePaymentReceipt({ autoStartNext: false });
  }

  if (!receipt || Number(receipt.amount || 0) <= 0) {
    showToast("No payment receipt ready to send");
    return;
  }

  const shareText = getPaymentReceiptShareText(receipt);
  const partyPhone = String(receipt.party_phone || "").replace(/\D/g, "");
  const markup = getPaymentReceiptMarkup(receipt);

  try {
    const imageFile = await renderReceiptMarkupToPngFile(markup, `payment-receipt-${receipt.receipt_number}`);
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [imageFile] })) {
      await navigator.share({
        title: `Payment Receipt ${receipt.receipt_number}`,
        text: `Payment receipt ${receipt.receipt_number}`,
        files: [imageFile]
      });
      showToast("Payment receipt image shared");
      startNextPaymentReceipt();
      return;
    }

    downloadFile(imageFile);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareText);
      } catch (e) {
        console.error("Clipboard copy failed", e);
      }
    }
    const whatsappTarget = partyPhone ? `https://wa.me/${partyPhone}` : `https://wa.me/`;
    window.open(whatsappTarget, "_blank", "noopener,noreferrer");
    showToast("Receipt image downloaded. Attach it in WhatsApp.");
    startNextPaymentReceipt();
    return;
  } catch (e) {
    console.error("Payment receipt image share failed", e);
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: `Payment Receipt ${receipt.receipt_number}`,
        text: shareText
      });
      showToast("Payment receipt shared");
      startNextPaymentReceipt();
      return;
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.error(e);
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch (e) {
      console.error("Clipboard copy failed", e);
    }
  }

  const whatsappTarget = partyPhone ? `https://wa.me/${partyPhone}?text=${encodeURIComponent(shareText)}` : `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  window.open(whatsappTarget, "_blank", "noopener,noreferrer");
  showToast(partyPhone ? "Payment receipt copied and WhatsApp opened" : "Receipt text copied. Add receiver and send");
  startNextPaymentReceipt();
}

function resetPaymentReceiptForm() {
  document.getElementById("paymentReceiptPartyName").value = "";
  document.getElementById("paymentReceiptPartyPhone").value = "";
  document.getElementById("paymentReceiptPartyAddress").value = "";
  document.getElementById("paymentReceiptAmount").value = "";
  document.getElementById("paymentReceiptNotes").value = "";
  document.getElementById("paymentReceiptDirection").value = "RECEIVED";
  document.getElementById("paymentReceiptMode").value = "Cash";
  document.getElementById("paymentReceiptCashier").value = "admin";
  document.getElementById("paymentReceiptDate").value = formatDateInput(new Date());
  currentPaymentReceipt = null;
  paymentReceiptDraftDirty = false;
  paymentReceiptCompleted = false;
  refreshPaymentReceiptNumber();
  if (retailBillingMode === "payment") {
    schedulePaymentReceiptPreviewRender();
  }
}

function resetRetailForm() {
  const draftHasItems = collectRetailItemsFromForm(retailBillingMode).length > 0;
  if (draftHasItems && !retailBillCompleted) {
    showToast("Save or print this bill before starting a new one");
    return;
  }

  const regularRows = document.getElementById("retailRegularRows");
  const dressedRows = document.getElementById("retailDressedRows");
  if (regularRows) regularRows.innerHTML = "";
  if (dressedRows) dressedRows.innerHTML = "";

  retailField("regular", "customerName").value = "";
  retailField("regular", "customerPhone").value = "";
  retailField("regular", "customerAddress").value = "";
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

  if (retailBillingMode === "dressed") {
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
    renderRetailPartyMatches("retailCustomerSuggestBox", suggestions, cachedMatches, party => {
      applyRetailPartyToFields(party, mode);
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
      renderRetailPartyMatches("retailCustomerSuggestBox", suggestions, mergedMatches, party => {
        applyRetailPartyToFields(party, mode);
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
    renderRetailPartyMatches("paymentReceiptPartySuggestBox", suggestions, cachedMatches, party => {
      applyPaymentReceiptPartyToFields(party);
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
      renderRetailPartyMatches("paymentReceiptPartySuggestBox", suggestions, mergedMatches, party => {
        applyPaymentReceiptPartyToFields(party);
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
    const cachedParty = getCachedPartyProfile(query);
    if (cachedParty) {
      const phoneInput = retailField(mode, "customerPhone");
      const addressInput = retailField(mode, "customerAddress");
      if (phoneInput && !phoneInput.value.trim()) phoneInput.value = cachedParty.phone || "";
      if (addressInput && !addressInput.value.trim()) addressInput.value = cachedParty.address || "";
      scheduleRetailPreviewRender();
      return;
    }

    const data = await optionalApiCall(`/party/profile?name=${encodeURIComponent(query)}`, null, "GET", null, { cache: false });
    const party = data?.party;
    if (!party) return;

    retailPartyDirectoryCache = retailPartyDirectoryCache.filter(
      existing => normalizeRetailPartyLookup(existing.name) !== normalizeRetailPartyLookup(party.name)
    );
    retailPartyDirectoryCache.push(party);

    const phoneInput = retailField(mode, "customerPhone");
    const addressInput = retailField(mode, "customerAddress");
    if (phoneInput && !phoneInput.value.trim()) phoneInput.value = party.phone || "";
    if (addressInput && !addressInput.value.trim()) addressInput.value = party.address || "";
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
    const cachedParty = getCachedPartyProfile(query);
    if (cachedParty) {
      const phoneInput = document.getElementById("paymentReceiptPartyPhone");
      const addressInput = document.getElementById("paymentReceiptPartyAddress");
      if (phoneInput && !phoneInput.value.trim()) phoneInput.value = cachedParty.phone || "";
      if (addressInput && !addressInput.value.trim()) addressInput.value = cachedParty.address || "";
      schedulePaymentReceiptPreviewRender();
      return;
    }

    const data = await optionalApiCall(`/party/profile?name=${encodeURIComponent(query)}`, null, "GET", null, { cache: false });
    const party = data?.party;
    if (!party) return;

    const phoneInput = document.getElementById("paymentReceiptPartyPhone");
    const addressInput = document.getElementById("paymentReceiptPartyAddress");
    if (phoneInput && !phoneInput.value.trim()) phoneInput.value = party.phone || "";
    if (addressInput && !addressInput.value.trim()) addressInput.value = party.address || "";
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

  const receiptOutstanding = bill.customer_name
    ? Number((bill.party_balance ?? bill.outstanding_amount) || 0)
    : Number(bill.outstanding_amount || 0);

  const customerBlock = (bill.customer_name || bill.customer_phone || bill.customer_address) ? `
    <div class="thermal-customer">
      ${bill.customer_name ? `<p><strong>Customer Name</strong> : ${escapeHtml(bill.customer_name)}</p>` : ""}
      ${bill.customer_phone ? `<p><strong>Phone</strong> : ${escapeHtml(bill.customer_phone)}</p>` : ""}
      ${bill.customer_address ? `<p><strong>Customer Add</strong> : ${escapeHtml(bill.customer_address)}</p>` : ""}
    </div>
  ` : "";

  return `
    <div class="thermal-bill">
      <div class="thermal-label">INVOICE</div>
      <div class="thermal-center">
        <h3>${escapeHtml(RETAIL_SHOP_PROFILE.name)}</h3>
        <p>${escapeHtml(RETAIL_SHOP_PROFILE.proprietor)}</p>
        <p>${escapeHtml(RETAIL_SHOP_PROFILE.address)}</p>
        <p>Mob. ${escapeHtml(RETAIL_SHOP_PROFILE.phone)}</p>
      </div>

      <div class="thermal-meta-grid">
        <div class="thermal-meta-row"><span>Bill no</span><span>${escapeHtml(bill.bill_number)}</span></div>
        <div class="thermal-meta-row"><span>Date</span><span>${formatDisplayDate(bill.date)}</span></div>
        <div class="thermal-meta-row"><span>Time</span><span>${escapeHtml(bill.time || new Date().toLocaleTimeString("en-GB"))}</span></div>
        <div class="thermal-meta-row"><span>Cashier</span><span>${escapeHtml(bill.cashier_name || "admin")}</span></div>
      </div>

      ${customerBlock}

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
        ${Number(bill.ice_amount || 0) > 0 ? `<p><span>Items Total</span><strong>${formatBillMoney(bill.items_subtotal_amount ?? (Number(bill.total_amount || 0) - Number(bill.ice_amount || 0)))}</strong></p>` : ""}
        ${Number(bill.ice_amount || 0) > 0 ? `<p><span>Ice Amount</span><strong>${formatBillMoney(bill.ice_amount)}</strong></p>` : ""}
        ${Number(bill.ice_amount || 0) > 0 ? `<p class="thermal-total"><span>TOTAL</span><strong>${formatBillMoney(bill.total_amount)}</strong></p>` : ""}
        <p><span>${escapeHtml(bill.payment_mode || "Cash")} Payment</span><strong>${formatBillMoney(bill.paid_amount)}</strong></p>
        <p><span>Outstanding balance</span><strong>${formatBillMoney(receiptOutstanding)}</strong></p>
      </div>

      ${bill.requires_customer && !bill.customer_name ? `<div class="thermal-notes">Known customer name is required when this bill has credit outstanding.</div>` : ""}
      ${bill.notes ? `<div class="thermal-notes">${escapeHtml(bill.notes)}</div>` : ""}

      <div class="thermal-footer">
        <p>Thank You</p>
        <p>Visit Again</p>
      </div>
    </div>
  `;
}

function getPaymentReceiptMarkup(receipt) {
  const directionLabel = (receipt.direction || "RECEIVED") === "PAID" ? "Payment Voucher" : "Payment Receipt";
  const amountLabel = (receipt.direction || "RECEIVED") === "PAID" ? "Amount Paid" : "Amount Received";
  const partyBlock = (receipt.party_name || receipt.party_phone || receipt.party_address) ? `
    <div class="thermal-customer">
      ${receipt.party_name ? `<p><strong>Party Name</strong> : ${escapeHtml(receipt.party_name)}</p>` : ""}
      ${receipt.party_phone ? `<p><strong>Phone</strong> : ${escapeHtml(receipt.party_phone)}</p>` : ""}
      ${receipt.party_address ? `<p><strong>Address</strong> : ${escapeHtml(receipt.party_address)}</p>` : ""}
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
  const merged = [...pendingBills, ...serverBills];
  return merged.sort((a, b) => {
    if ((a.date || "") !== (b.date || "")) return (b.date || "").localeCompare(a.date || "");
    return Number(String(b.bill_number || "").replace(/\D/g, "")) - Number(String(a.bill_number || "").replace(/\D/g, ""));
  });
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
        remaining.push({ ...bill, last_error: response.error });
        continue;
      }

      if (currentRetailBill?.id === bill.id) {
        currentRetailBill = response.bill;
        populateRetailFormFromBill(response.bill);
      }
      syncedCount += 1;
    } catch (e) {
      remaining.push({ ...bill, last_error: String(e?.message || e || "Sync failed") });
    }
  }

  setPendingRetailBills(remaining);
  renderRetailOfflineBanner();
  await loadRetailBills();
  await refreshRetailBillNumber();
  await loadDressedStock();

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
  const mode = normalizeRetailBillMode(bill) === "dressed" ? "Dressed" : "Regular";
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
