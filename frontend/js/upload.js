async function handleUpload(inputId, endpoint, label, preview = false) {
    const fileInput = document.getElementById(inputId);
    const file = fileInput.files[0];

    if (!file) {
      showToast("Select a file");
      return;
    }

    // --- Basic validation
    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
      "text/plain",
      ""
    ];
    const allowedExtensions = [".csv", ".xls", ".xlsx"];
    const fileName = file.name.toLowerCase();

    if (!allowedTypes.includes(file.type) && !allowedExtensions.some(ext => fileName.endsWith(ext))) {
      showToast("Invalid file type");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("File too large (max 5MB)");
      return;
    }

    showToast(`${preview ? "Previewing" : "Uploading"} ${label}...`);
    setUploadStatus("info", `${preview ? "Checking" : "Uploading"} ${label}...`);

    const formData = new FormData();
    formData.append("file", file);
    const workingDate = document.getElementById("uploadWorkingDate")?.value;

    // 🔥 Disable button during upload
    toggleButtons(true);

    try {
      const params = new URLSearchParams();
      if (preview) params.set("preview", "true");
      if (workingDate) params.set("input_date", workingDate);
      const url = params.toString() ? `${endpoint}?${params.toString()}` : endpoint;
      const data = await apiCall(url, "POST", formData);

      if (data.error) {
        showToast(data.error);
        setUploadStatus("error", data.error, data.errors || []);
      } else {
        const skipped = data.rows_skipped ? `, ${data.rows_skipped} skipped` : "";
        const action = preview ? "preview" : "uploaded";
        showToast(`${label} ${action}: ${data.rows_inserted} rows${skipped}`);
        setUploadStatus(
          data.errors?.length ? "warning" : "success",
          `${label} ${action}: ${data.rows_inserted} rows${skipped}`,
          data.errors || []
        );
        if (!preview) fileInput.value = ""; // reset input
      }

    } catch (e) {
      console.error(e);
      showToast("Upload failed");
      setUploadStatus("error", "Upload failed. Check the file format and try again.");
    } finally {
      toggleButtons(false);
    }
  }

  function uploadVendor() {
    handleUpload("vendorFile", "/upload/vendor", "Vendor sales file");
  }

  function previewVendor() {
    handleUpload("vendorFile", "/upload/vendor", "Vendor sales file", true);
  }

  function uploadDealer() {
    handleUpload("dealerFile", "/upload/dealer", "Dealer purchase file");
  }

  function previewDealer() {
    handleUpload("dealerFile", "/upload/dealer", "Dealer purchase file", true);
  }

  function uploadPayment() {
    handleUpload("paymentFile", "/upload/payment", "Payment file");
  }

  function previewPayment() {
    handleUpload("paymentFile", "/upload/payment", "Payment file", true);
  }

  function uploadOpeningBalance() {
    handleUpload("openingBalanceFile", "/upload/opening-balance", "Opening balance file");
  }

  function previewOpeningBalance() {
    handleUpload("openingBalanceFile", "/upload/opening-balance", "Opening balance file", true);
  }

  function uploadOpeningStock() {
    handleUpload("openingStockFile", "/upload/opening-stock", "Opening stock file");
  }

  function previewOpeningStock() {
    handleUpload("openingStockFile", "/upload/opening-stock", "Opening stock file", true);
  }

  function downloadTemplate(type) {
    showLoading("Preparing template...");
    setTimeout(() => hideLoading(), 900);
    window.location.href = `${BASE_URL}/templates/${type}`;
  }

  async function processDay() {
    const date = document.getElementById("processDate").value;
    const rows = Array.from(document.querySelectorAll(".actual-stock-row"))
      .map(row => ({
        item_type: row.querySelector(".actualItem")?.value.trim(),
        actual_quantity: row.querySelector(".actualNag")?.value,
        actual_weight: row.querySelector(".actualWeight")?.value
      }))
      .filter(row => row.item_type && row.actual_weight !== "");

    if (!date || rows.length === 0) {
      showToast("Enter date and actual stock");
      return;
    }

    const invalidWeight = rows.some(row => Number(row.actual_weight) < 0);
    const invalidNag = rows.some(row => row.actual_quantity !== "" && Number(row.actual_quantity) < 0);
    if (invalidWeight || invalidNag) {
      showToast("Actual stock and NAG cannot be negative");
      return;
    }

    showToast("Processing day...");
    toggleButtons(true);
    setProcessDaySummary("info", "Saving Process Day...");

    try {
      const data = await apiCall(
        `/process-day/items?input_date=${encodeURIComponent(date)}`,
        "POST",
        JSON.stringify(rows),
        { "Content-Type": "application/json" }
      );

      if (data.error) {
        showToast(data.error);
        setUploadStatus("error", data.error);
        setProcessDaySummary("error", data.error);
      } else {
        const wasUpdated = Boolean(data.replaced_existing);
        const quantityLeakage = Number(data.total_quantity_leakage || 0);
        const leakageText = `Leakage: ${Number(data.total_leakage || 0).toLocaleString()} kg${quantityLeakage ? `, ${quantityLeakage.toLocaleString()} NAG` : ""}`;
        showToast(`${wasUpdated ? "Updated" : "Processed"}. ${leakageText}`);
        setUploadStatus("success", `Day ${wasUpdated ? "updated" : "processed"}. ${leakageText}`);
        setProcessDaySummary(
          "success",
          `Process Day ${wasUpdated ? "updated" : "saved"} for ${formatProcessDayDisplayDate(data.date || date)}`,
          [
            `Hen types saved: ${Array.isArray(data.items) ? data.items.length : rows.length}`,
            `Expected stock: ${formatProcessMetric(data.total_expected_stock, "kg")} ${formatProcessMetricInline(data.total_expected_nag, "NAG")}`,
            `Actual stock: ${formatProcessMetric(data.total_actual_stock, "kg")} ${formatProcessMetricInline(data.total_actual_nag, "NAG")}`,
            `Short by: ${formatProcessMetric(data.total_leakage, "kg")} ${formatProcessMetricInline(data.total_quantity_leakage, "NAG")}`
          ]
        );
        if (typeof clearOperationalCaches === "function") {
          clearOperationalCaches();
        }
      }

    } catch (e) {
      console.error(e);
      showToast("Processing failed");
      setUploadStatus("error", "Processing failed. Check backend connection and entered stock values.");
      setProcessDaySummary("error", "Process Day did not save.", [
        "The day will not update Actual Stock.",
        "The next day opening stock will also not carry forward until this saves successfully."
      ]);
    } finally {
      toggleButtons(false);
    }
  }

  function formatProcessDayDisplayDate(date) {
    if (!date) return "";
    const parsed = new Date(`${date}T00:00:00`);
    return parsed.toLocaleDateString("en-GB");
  }

  function formatProcessMetric(value, suffix) {
    return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${suffix}`;
  }

  function formatProcessMetricInline(value, suffix) {
    if (value === null || value === undefined || value === "") return "";
    return `| ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${suffix}`;
  }

  function setProcessDaySummary(type, message, details = []) {
    const summary = document.getElementById("processDaySummary");
    if (!summary) return;

    summary.style.display = "";
    summary.className = `notice upload-status ${type}`;
    summary.innerHTML = "";

    const title = document.createElement("strong");
    title.innerText = message;
    summary.appendChild(title);

    if (details.length) {
      const list = document.createElement("ul");
      details.forEach(detail => {
        const item = document.createElement("li");
        item.innerText = detail;
        list.appendChild(item);
      });
      summary.appendChild(list);
    }
  }

  function toggleButtons(disable) {
    document.querySelectorAll("button").forEach(btn => {
      btn.disabled = disable;
      btn.classList.toggle("is-loading", disable);
    });
  }

  function addActualStockRow() {
    return addActualStockRowWithValue("");
  }

  function addActualStockRowWithValue(itemType = "") {
    const container = document.getElementById("actualStockRows");
    if (!container) return;
    const row = document.createElement("div");
    row.className = "upload-box actual-stock-row";
    row.innerHTML = `
      <input type="text" class="actualItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)" value="${escapeHtmlAttr(itemType)}">
      <input type="number" class="actualNag" placeholder="Actual NAG" min="0" step="1" value="0">
      <input type="number" class="actualWeight" placeholder="Actual stock (kg)" min="0" step="0.01" value="0">
      <button type="button" class="row-remove-button" onclick="removeActualStockRow(this)">Remove</button>
    `;
    container.appendChild(row);
  }

  function removeActualStockRow(button) {
    button.closest(".actual-stock-row")?.remove();
  }

function initManualEntryRows() {
  if (document.getElementById("dealerEntryRows")?.children.length === 0) addDealerEntryRow();
  if (document.getElementById("vendorEntryRows")?.children.length === 0) addVendorEntryRow();
  if (document.getElementById("paymentEntryRows")?.children.length === 0) addPaymentEntryRow();
  if (document.getElementById("mortalityEntryRows")?.children.length === 0) addMortalityEntryRow();
  if (document.getElementById("openingBalanceEntryRows")?.children.length === 0) addOpeningBalanceEntryRow();
  if (document.getElementById("openingStockEntryRows")?.children.length === 0) addOpeningStockEntryRow();
  upgradeManualWhatsappActions();
  loadTrackedActualStockRows();
}

function upgradeManualWhatsappActions() {
  document.querySelectorAll("#dealerEntryRows .manual-entry-row").forEach(row => {
    if (row.querySelector(".manual-row-actions")) return;
    const removeButton = row.querySelector(".row-remove-button");
    if (!removeButton) return;
    const actionWrap = document.createElement("div");
    actionWrap.className = "manual-row-actions";
    actionWrap.innerHTML = `
      <button type="button" class="button-secondary manual-whatsapp-button" onclick="sendDealerEntryOnWhatsApp(this)">Send on WhatsApp</button>
    `;
    actionWrap.appendChild(removeButton);
    row.appendChild(actionWrap);
  });

  document.querySelectorAll("#vendorEntryRows .manual-entry-row").forEach(row => {
    if (row.querySelector(".manual-row-actions")) return;
    const removeButton = row.querySelector(".row-remove-button");
    if (!removeButton) return;
    const actionWrap = document.createElement("div");
    actionWrap.className = "manual-row-actions";
    actionWrap.innerHTML = `
      <button type="button" class="button-secondary manual-whatsapp-button" onclick="sendVendorEntryOnWhatsApp(this)">Send on WhatsApp</button>
    `;
    actionWrap.appendChild(removeButton);
    row.appendChild(actionWrap);
  });
}

async function loadTrackedActualStockRows() {
  const container = document.getElementById("actualStockRows");
  if (!container) return;

  try {
    const data = await apiCall("/items/tracked");
    if (data?.error) {
      if (container.children.length === 0) addActualStockRowWithValue("");
      return;
    }

    const items = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
    container.innerHTML = "";

    if (!items.length) {
      addActualStockRowWithValue("");
      return;
    }

    items.forEach(item => addActualStockRowWithValue(item));
  } catch (error) {
    console.error(error);
    if (container.children.length === 0) addActualStockRowWithValue("");
  }
}

function escapeHtmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function initPartyDirectory() {
  loadPartyDirectory();
  const nameInput = document.getElementById("directoryPartyName");
  if (!nameInput) return;

  nameInput.addEventListener("input", () => {
    resetDirectoryLinkedFieldsIfNameChanged();
  });
  nameInput.addEventListener("input", suggestDirectoryParties);
  nameInput.addEventListener("focus", suggestDirectoryParties);
  nameInput.addEventListener("change", () => hydrateDirectoryPartyForm(nameInput.value));
  nameInput.addEventListener("blur", () => hydrateDirectoryPartyForm(nameInput.value));
  nameInput.addEventListener("blur", () => scheduleUploadPartySuggestionHide(document.getElementById("directoryPartySuggestBox")));
}

function rememberDirectoryLinkedParty(party) {
  const nameInput = document.getElementById("directoryPartyName");
  if (!nameInput) return;
  nameInput.dataset.linkedPartyName = normalizeUploadPartyLookup(party?.name || "");
}

function clearDirectoryLinkedParty() {
  const nameInput = document.getElementById("directoryPartyName");
  if (nameInput) delete nameInput.dataset.linkedPartyName;
}

function resetDirectoryLinkedFieldsIfNameChanged() {
  const nameInput = document.getElementById("directoryPartyName");
  if (!nameInput) return;

  const linkedName = nameInput.dataset.linkedPartyName || "";
  const currentName = normalizeUploadPartyLookup(nameInput.value);
  if (!linkedName || linkedName === currentName) return;

  const partyId = document.getElementById("directoryPartyId");
  const phone = document.getElementById("directoryPartyPhone");
  const address = document.getElementById("directoryPartyAddress");
  const type = document.getElementById("directoryPartyType");
  if (partyId) partyId.value = "";
  if (phone) phone.value = "";
  if (address) address.value = "";
  if (type) type.value = "BOTH";
  clearDirectoryLinkedParty();
}

function createManualRow(containerId, html, rowClass = "") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement("div");
  row.className = `upload-box manual-entry-row ${rowClass}`.trim();
  row.innerHTML = html;
  container.appendChild(row);
}

function removeManualEntryRow(button) {
  const row = button.closest(".manual-entry-row");
  const container = row?.parentElement;
  row?.remove();
  if (container && container.children.length === 0) {
    const addMap = {
      dealerEntryRows: addDealerEntryRow,
      vendorEntryRows: addVendorEntryRow,
      paymentEntryRows: addPaymentEntryRow,
      mortalityEntryRows: addMortalityEntryRow,
      openingBalanceEntryRows: addOpeningBalanceEntryRow,
      openingStockEntryRows: addOpeningStockEntryRow
    };
    addMap[container.id]?.();
  }
}

function addDealerEntryRow() {
  createManualRow("dealerEntryRows", `
    <div class="typeahead-field">
      <input type="text" class="dealerParty" placeholder="Dealer name" autocomplete="off" oninput="suggestManualParties(this)" onfocus="suggestManualParties(this)" onblur="scheduleUploadPartySuggestionHide(this.parentElement.querySelector('.manual-party-suggest-box'))">
      <div class="typeahead-box manual-party-suggest-box"></div>
    </div>
    <input type="text" class="dealerBillNo" placeholder="Bill no. (optional)">
    <input type="text" class="dealerItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="dealerNag" placeholder="NAG" min="0" step="1">
    <input type="number" class="dealerWeight" placeholder="Kgs" min="0" step="0.01">
    <input type="number" class="dealerRate" placeholder="Rate/kg" min="0" step="0.01">
    <input type="number" class="dealerTransportMortalityNag" placeholder="Transport NAG" min="0" step="1">
    <input type="number" class="dealerTransportMortalityWeight" placeholder="Transport KG" min="0" step="0.01">
    <div class="manual-row-actions">
      <button type="button" class="button-secondary manual-whatsapp-button" onclick="sendDealerEntryOnWhatsApp(this)">Send on WhatsApp</button>
      <button type="button" class="row-remove-button" onclick="removeManualEntryRow(this)">Remove</button>
    </div>
  `, "dealer-entry-row");
}

function addVendorEntryRow() {
  createManualRow("vendorEntryRows", `
    <div class="typeahead-field">
      <input type="text" class="vendorParty" placeholder="Vendor name" autocomplete="off" oninput="suggestManualParties(this)" onfocus="suggestManualParties(this)" onblur="scheduleUploadPartySuggestionHide(this.parentElement.querySelector('.manual-party-suggest-box'))">
      <div class="typeahead-box manual-party-suggest-box"></div>
    </div>
    <input type="text" class="vendorCategory" placeholder="Category (optional)">
    <input type="text" class="vendorItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="vendorNag" placeholder="NAG" min="0" step="1">
    <input type="number" class="vendorWeight" placeholder="Kgs" min="0" step="0.01">
    <input type="number" class="vendorRate" placeholder="Rate/kg" min="0" step="0.01">
    <div class="manual-row-actions">
      <button type="button" class="button-secondary manual-whatsapp-button" onclick="sendVendorEntryOnWhatsApp(this)">Send on WhatsApp</button>
      <button type="button" class="row-remove-button" onclick="removeManualEntryRow(this)">Remove</button>
    </div>
  `, "vendor-entry-row");
}

function addPaymentEntryRow() {
  createManualRow("paymentEntryRows", `
    <div class="typeahead-field">
      <input type="text" class="paymentParty" placeholder="Party name" autocomplete="off" oninput="suggestManualParties(this)" onfocus="suggestManualParties(this)" onblur="scheduleUploadPartySuggestionHide(this.parentElement.querySelector('.manual-party-suggest-box'))">
      <div class="typeahead-box manual-party-suggest-box"></div>
    </div>
    <input type="number" class="paymentAmount" placeholder="Amount" min="0" step="0.01">
    <select class="paymentMode">
      <option value="Cash">Cash</option>
      <option value="Online">Online</option>
      <option value="Bank">Bank</option>
      <option value="Credit">Credit</option>
    </select>
    <select class="paymentDirection">
      <option value="RECEIVED">Received</option>
      <option value="PAID">Paid</option>
    </select>
    <button type="button" class="row-remove-button" onclick="removeManualEntryRow(this)">Remove</button>
  `, "payment-entry-row");
}

function addMortalityEntryRow() {
  createManualRow("mortalityEntryRows", `
    <input type="text" class="mortalityItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="mortalityNag" placeholder="NAG (optional)" min="0" step="1">
    <input type="number" class="mortalityWeight" placeholder="Weight (optional)" min="0" step="0.01">
    <button type="button" class="row-remove-button" onclick="removeManualEntryRow(this)">Remove</button>
  `, "mortality-entry-row");
}

function addOpeningBalanceEntryRow() {
  createManualRow("openingBalanceEntryRows", `
    <div class="typeahead-field">
      <input type="text" class="openingBalanceParty" placeholder="Party name" autocomplete="off" oninput="suggestManualParties(this)" onfocus="suggestManualParties(this)" onblur="scheduleUploadPartySuggestionHide(this.parentElement.querySelector('.manual-party-suggest-box'))">
      <div class="typeahead-box manual-party-suggest-box"></div>
    </div>
    <input type="number" class="openingBalanceAmount" placeholder="Opening balance" min="0" step="0.01">
    <select class="openingBalanceType">
      <option value="RECEIVABLE">Receivable</option>
      <option value="PAYABLE">Payable</option>
    </select>
    <button type="button" class="row-remove-button" onclick="removeManualEntryRow(this)">Remove</button>
  `, "opening-balance-entry-row");
}

function addOpeningStockEntryRow() {
  createManualRow("openingStockEntryRows", `
    <input type="text" class="openingStockItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="openingStockNag" placeholder="Opening NAG" min="0" step="1">
    <input type="number" class="openingStockWeight" placeholder="Opening kgs" min="0" step="0.01">
    <button type="button" class="row-remove-button" onclick="removeManualEntryRow(this)">Remove</button>
  `, "opening-stock-entry-row");
}

function sanitizeWhatsAppPhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatManualEntryValue(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatManualCurrency(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function calculateManualRowAmount(weight, rate) {
  const qty = Number(weight || 0);
  const price = Number(rate || 0);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return qty * price;
}

async function fetchUploadPartyDetails(name) {
  const query = String(name || "").trim();
  if (!query) return { phone: "", balance: 0 };

  try {
    const data = await optionalApiCall(`/party/profile?name=${encodeURIComponent(query)}`, null, "GET", null, { cache: false });
    return {
      phone: sanitizeWhatsAppPhoneNumber(data?.party?.phone || data?.phone || ""),
      balance: Number(data?.party?.balance_after || data?.balance_after || 0)
    };
  } catch (error) {
    console.error(error);
    return { phone: "", balance: 0 };
  }
}

function openUploadWhatsApp(phone, message) {
  const target = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(target, "_blank", "noopener,noreferrer");
}

function buildDealerWhatsAppMessage(row, workingDate, oldBalance = 0) {
  const amount = calculateManualRowAmount(row.kgs, row.rate_per_kg);
  return [
    `Dealer Purchase - ${formatProcessDayDisplayDate(workingDate)}`,
    `Dealer: ${formatManualEntryValue(row.dealer)}`,
    `Old Balance: Rs ${formatManualCurrency(oldBalance)}`,
    `Bill No: ${formatManualEntryValue(row.bill_no)}`,
    `Hen Type: ${formatManualEntryValue(row.hen_type)}`,
    `NAG: ${formatManualEntryValue(row.nag, "0")}`,
    `Kgs: ${formatManualEntryValue(row.kgs, "0")}`,
    `Rate/kg: ${formatManualEntryValue(row.rate_per_kg, "0")}`,
    `Amount: Rs ${formatManualCurrency(amount)}`,
    `Transport NAG: ${formatManualEntryValue(row.transport_mortality_nag, "0")}`,
    `Transport KG: ${formatManualEntryValue(row.transport_mortality_weight, "0")}`
  ].join("\n");
}

function buildVendorWhatsAppMessage(row, workingDate, oldBalance = 0) {
  const amount = calculateManualRowAmount(row.kgs, row.rate_per_kg);
  return [
    `Vendor Sale - ${formatProcessDayDisplayDate(workingDate)}`,
    `Vendor: ${formatManualEntryValue(row.vendor)}`,
    `Old Balance: Rs ${formatManualCurrency(oldBalance)}`,
    `Category: ${formatManualEntryValue(row.category)}`,
    `Hen Type: ${formatManualEntryValue(row.hen_type)}`,
    `NAG: ${formatManualEntryValue(row.nag, "0")}`,
    `Kgs: ${formatManualEntryValue(row.kgs, "0")}`,
    `Rate/kg: ${formatManualEntryValue(row.rate_per_kg, "0")}`,
    `Amount: Rs ${formatManualCurrency(amount)}`
  ].join("\n");
}

async function sendDealerEntryOnWhatsApp(button) {
  const workingDate = document.getElementById("uploadWorkingDate")?.value;
  const row = button?.closest(".manual-entry-row");
  if (!workingDate || !row) {
    showToast("Select working date first");
    return;
  }

  const payload = {
    dealer: row.querySelector(".dealerParty")?.value.trim(),
    bill_no: row.querySelector(".dealerBillNo")?.value.trim(),
    hen_type: row.querySelector(".dealerItem")?.value.trim(),
    nag: row.querySelector(".dealerNag")?.value,
    kgs: row.querySelector(".dealerWeight")?.value,
    rate_per_kg: row.querySelector(".dealerRate")?.value,
    transport_mortality_nag: row.querySelector(".dealerTransportMortalityNag")?.value,
    transport_mortality_weight: row.querySelector(".dealerTransportMortalityWeight")?.value
  };

  if (!payload.dealer) {
    showToast("Enter dealer name first");
    return;
  }

  const party = await fetchUploadPartyDetails(payload.dealer);
  if (!party.phone) {
    showToast("Dealer phone number not found");
    return;
  }

  openUploadWhatsApp(party.phone, buildDealerWhatsAppMessage(payload, workingDate, party.balance));
  showToast("WhatsApp opened for dealer");
}

async function sendVendorEntryOnWhatsApp(button) {
  const workingDate = document.getElementById("uploadWorkingDate")?.value;
  const row = button?.closest(".manual-entry-row");
  if (!workingDate || !row) {
    showToast("Select working date first");
    return;
  }

  const payload = {
    vendor: row.querySelector(".vendorParty")?.value.trim(),
    category: row.querySelector(".vendorCategory")?.value.trim(),
    hen_type: row.querySelector(".vendorItem")?.value.trim(),
    nag: row.querySelector(".vendorNag")?.value,
    kgs: row.querySelector(".vendorWeight")?.value,
    rate_per_kg: row.querySelector(".vendorRate")?.value
  };

  if (!payload.vendor) {
    showToast("Enter vendor name first");
    return;
  }

  const party = await fetchUploadPartyDetails(payload.vendor);
  if (!party.phone) {
    showToast("Vendor phone number not found");
    return;
  }

  openUploadWhatsApp(party.phone, buildVendorWhatsAppMessage(payload, workingDate, party.balance));
  showToast("WhatsApp opened for vendor");
}

async function submitManualEntries(endpoint, rows, label) {
  const workingDate = document.getElementById("uploadWorkingDate")?.value;
  if (!workingDate) {
    showToast("Select working date");
    return;
  }

  if (!rows.length) {
    showToast(`Add at least one ${label.toLowerCase()} row`);
    return;
  }

  toggleButtons(true);
  setUploadStatus("info", `Saving ${label.toLowerCase()}...`);

  try {
    const data = await apiCall(
      `${endpoint}?input_date=${encodeURIComponent(workingDate)}`,
      "POST",
      JSON.stringify({ rows }),
      { "Content-Type": "application/json" }
    );

    if (data.error) {
      showToast(data.error);
      setUploadStatus("error", data.error, data.errors || []);
      return;
    }

    const skipped = data.rows_skipped ? `, ${data.rows_skipped} skipped` : "";
    showToast(`${label}: ${data.rows_inserted} rows${skipped}`);
    setUploadStatus(data.errors?.length ? "warning" : "success", `${label}: ${data.rows_inserted} rows${skipped}`, data.errors || []);
    if (typeof clearOperationalCaches === "function") {
      clearOperationalCaches();
    }
  } catch (e) {
    console.error(e);
    showToast(`${label} failed`);
    setUploadStatus("error", `${label} failed. Check the entered values and try again.`);
  } finally {
    toggleButtons(false);
  }
}

function submitDealerEntries() {
  const rows = Array.from(document.querySelectorAll("#dealerEntryRows .manual-entry-row"))
    .map(row => ({
      dealer: row.querySelector(".dealerParty")?.value.trim(),
      bill_no: row.querySelector(".dealerBillNo")?.value.trim(),
      hen_type: row.querySelector(".dealerItem")?.value.trim(),
      nag: row.querySelector(".dealerNag")?.value,
      kgs: row.querySelector(".dealerWeight")?.value,
      rate_per_kg: row.querySelector(".dealerRate")?.value,
      transport_mortality_nag: row.querySelector(".dealerTransportMortalityNag")?.value,
      transport_mortality_weight: row.querySelector(".dealerTransportMortalityWeight")?.value
    }))
    .filter(row => row.dealer || row.hen_type || row.kgs || row.rate_per_kg || row.transport_mortality_nag || row.transport_mortality_weight);
  submitManualEntries("/entries/dealer", rows, "Dealer entries saved");
}

function submitVendorEntries() {
  const rows = Array.from(document.querySelectorAll("#vendorEntryRows .manual-entry-row"))
    .map(row => ({
      vendor: row.querySelector(".vendorParty")?.value.trim(),
      category: row.querySelector(".vendorCategory")?.value.trim(),
      hen_type: row.querySelector(".vendorItem")?.value.trim(),
      nag: row.querySelector(".vendorNag")?.value,
      kgs: row.querySelector(".vendorWeight")?.value,
      rate_per_kg: row.querySelector(".vendorRate")?.value
    }))
    .filter(row => row.vendor || row.hen_type || row.kgs || row.rate_per_kg);
  submitManualEntries("/entries/vendor", rows, "Vendor entries saved");
}

function submitPaymentEntries() {
  const rows = Array.from(document.querySelectorAll("#paymentEntryRows .manual-entry-row"))
    .map(row => ({
      party: row.querySelector(".paymentParty")?.value.trim(),
      amount: row.querySelector(".paymentAmount")?.value,
      payment_mode: row.querySelector(".paymentMode")?.value,
      direction: row.querySelector(".paymentDirection")?.value
    }))
    .filter(row => row.party || row.amount);
  submitManualEntries("/entries/payment", rows, "Payments saved");
}

function submitMortalityEntries() {
  const rows = Array.from(document.querySelectorAll("#mortalityEntryRows .manual-entry-row"))
    .map(row => ({
      hen_type: row.querySelector(".mortalityItem")?.value.trim(),
      nag: row.querySelector(".mortalityNag")?.value,
      weight: row.querySelector(".mortalityWeight")?.value
    }))
    .filter(row => row.hen_type || row.nag || row.weight);
  submitManualEntries("/entries/mortality", rows, "Mortality saved");
}

function submitOpeningBalanceEntries() {
  const rows = Array.from(document.querySelectorAll("#openingBalanceEntryRows .manual-entry-row"))
    .map(row => ({
      party: row.querySelector(".openingBalanceParty")?.value.trim(),
      opening_balance: row.querySelector(".openingBalanceAmount")?.value,
      balance_type: row.querySelector(".openingBalanceType")?.value
    }))
    .filter(row => row.party || row.opening_balance);
  submitManualEntries("/entries/opening-balance", rows, "Opening balances saved");
}

function submitOpeningStockEntries() {
  const rows = Array.from(document.querySelectorAll("#openingStockEntryRows .manual-entry-row"))
    .map(row => ({
      hen_type: row.querySelector(".openingStockItem")?.value.trim(),
      opening_nag: row.querySelector(".openingStockNag")?.value,
      opening_kgs: row.querySelector(".openingStockWeight")?.value
    }))
    .filter(row => row.hen_type || row.opening_kgs);
  submitManualEntries("/entries/opening-stock", rows, "Opening stock saved");
}

let itemSuggestTimer = null;
let manualPartySuggestTimer = null;
let uploadPartySuggestHideTimer = null;

function normalizeUploadPartyName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeUploadPartyResults(parties) {
  const merged = new Map();
  (parties || []).forEach(party => {
    const key = normalizeUploadPartyName(party?.name);
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
      address: existing.address || party.address || "",
      type: existing.type || party.type || ""
    });
  });
  return Array.from(merged.values()).sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
}

function hideUploadPartySuggestionBox(box) {
  if (!box) return;
  box.innerHTML = "";
  box.style.display = "none";
}

function scheduleUploadPartySuggestionHide(box) {
  clearTimeout(uploadPartySuggestHideTimer);
  uploadPartySuggestHideTimer = setTimeout(() => hideUploadPartySuggestionBox(box), 220);
}

function renderUploadPartySuggestionBox(box, parties, onPick) {
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
    button.onmousedown = event => {
      event.preventDefault();
      onPick(party);
    };
    box.appendChild(button);
  });

  box.style.display = "block";
}

async function suggestItems(input) {
  const suggestions = document.getElementById("itemSuggestions");
  const query = input?.value.trim() || "";

  if (!suggestions) return;

  clearTimeout(itemSuggestTimer);

  if (query.length < 1) {
    suggestions.innerHTML = "";
    return;
  }

  itemSuggestTimer = setTimeout(async () => {
    try {
      const data = await optionalApiCall(`/items/search?q=${encodeURIComponent(query)}`, { results: [] });
      suggestions.innerHTML = "";

      (data.results || []).forEach(item => {
        const option = document.createElement("option");
        option.value = item;
        suggestions.appendChild(option);
      });
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
    }
  }, 200);
}

async function suggestManualParties(input) {
  const suggestions = document.getElementById("manualPartySuggestions");
  const query = input?.value.trim() || "";
  const box = input?.parentElement?.querySelector(".manual-party-suggest-box");

  if (!suggestions) return;

  clearTimeout(manualPartySuggestTimer);

  if (query.length < 2) {
    suggestions.innerHTML = "";
    hideUploadPartySuggestionBox(box);
    return;
  }

  manualPartySuggestTimer = setTimeout(async () => {
    try {
      const data = await optionalApiCall(`/party/search?name=${encodeURIComponent(query)}`, { results: [] });
      suggestions.innerHTML = "";
      const results = dedupeUploadPartyResults(data.results || []);
      results.forEach(party => {
        const option = document.createElement("option");
        option.value = party.name;
        suggestions.appendChild(option);
      });
      renderUploadPartySuggestionBox(box, results, party => {
        if (input) input.value = party.name;
        hideUploadPartySuggestionBox(box);
      });
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
      hideUploadPartySuggestionBox(box);
    }
  }, 200);
}

async function suggestDirectoryParties() {
  const input = document.getElementById("directoryPartyName");
  const suggestions = document.getElementById("manualPartySuggestions");
  const box = document.getElementById("directoryPartySuggestBox");
  const query = input?.value.trim() || "";

  if (!input || !suggestions) return;

  clearTimeout(manualPartySuggestTimer);

  if (query.length < 2) {
    suggestions.innerHTML = "";
    hideUploadPartySuggestionBox(box);
    return;
  }

  manualPartySuggestTimer = setTimeout(async () => {
    try {
      const data = await optionalApiCall(`/party/search?name=${encodeURIComponent(query)}`, { results: [] });
      suggestions.innerHTML = "";
      const results = dedupeUploadPartyResults(data.results || []);
      results.forEach(party => {
        const option = document.createElement("option");
        option.value = party.name;
        suggestions.appendChild(option);
      });
      renderUploadPartySuggestionBox(box, results, async party => {
        input.value = party.name;
        hideUploadPartySuggestionBox(box);
        await hydrateDirectoryPartyForm(party.name);
      });
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
      hideUploadPartySuggestionBox(box);
    }
  }, 200);
}

async function hydrateDirectoryPartyForm(name) {
  const query = String(name || "").trim();
  if (query.length < 2) {
    const partyIdInput = document.getElementById("directoryPartyId");
    if (partyIdInput) partyIdInput.value = "";
    return;
  }

  try {
    const data = await optionalApiCall(`/party/profile?name=${encodeURIComponent(query)}`, null, "GET", null, { cache: false });
    const party = data?.party;
    if (!party) return;

    const partyIdInput = document.getElementById("directoryPartyId");
    const phoneInput = document.getElementById("directoryPartyPhone");
    const addressInput = document.getElementById("directoryPartyAddress");
    const typeInput = document.getElementById("directoryPartyType");
    if (partyIdInput) partyIdInput.value = party.id || "";
    if (phoneInput) phoneInput.value = party.phone || "";
    if (addressInput) addressInput.value = party.address || "";
    if (typeInput) typeInput.value = party.type || "BOTH";
    rememberDirectoryLinkedParty(party);
  } catch (e) {
    console.error(e);
  }
}

async function selectDirectoryParty(name) {
  if (!name) {
    resetDirectoryPartyForm(false);
    return;
  }
  const select = document.getElementById("directoryPartySelect");
  const nameInput = document.getElementById("directoryPartyName");
  const partyIdInput = document.getElementById("directoryPartyId");
  if (nameInput) nameInput.value = name;
  if (partyIdInput && select?.selectedOptions?.[0]) {
    partyIdInput.value = select.selectedOptions[0].dataset.partyId || "";
  }
  await hydrateDirectoryPartyForm(name);
}

async function savePartyDirectoryEntry() {
  const partyId = document.getElementById("directoryPartyId")?.value.trim() || "";
  const name = document.getElementById("directoryPartyName")?.value.trim();
  const phone = document.getElementById("directoryPartyPhone")?.value.trim() || "";
  const address = document.getElementById("directoryPartyAddress")?.value.trim() || "";
  const type = document.getElementById("directoryPartyType")?.value || "BOTH";

  if (!name) {
    showToast("Enter party name");
    return;
  }

  toggleButtons(true);
  setUploadStatus("info", "Saving party...");

  try {
    const data = await apiCall(
      "/party-directory",
      "POST",
      JSON.stringify({ rows: [{ party_id: partyId, name, phone, address, type }] }),
      { "Content-Type": "application/json" }
    );

    if (data.error) {
      showToast(data.error);
      setUploadStatus("error", data.error);
      return;
    }

    showToast("Party saved");
    setUploadStatus("success", `Party saved. ${data.rows_inserted || 0} added, ${data.rows_updated || 0} updated.`);
    resetDirectoryPartyForm();
    if (typeof clearCachedResponse === "function") {
      clearCachedResponse("/party-directory");
      clearCachedResponsesByPrefix?.("/party/profile?name=");
      clearCachedResponsesByPrefix?.("/party/search?name=");
    }
    await loadPartyDirectory();
  } catch (e) {
    console.error(e);
    showToast("Party save failed");
    setUploadStatus("error", "Party save failed. Check the entered details and try again.");
  } finally {
    toggleButtons(false);
  }
}

async function loadPartyDirectory() {
  const select = document.getElementById("directoryPartySelect");
  if (!select) return;

  if (select) {
    select.innerHTML = `<option value="">Loading saved parties...</option>`;
  }

  try {
    const data = await optionalApiCall("/party-directory", { results: [] }, "GET", null, { cache: true });
    const results = data.results || [];
    if (select) {
      select.innerHTML = `<option value="">Select saved party</option>`;
      results.forEach(party => {
        const option = document.createElement("option");
        option.value = party.name || "";
        option.textContent = party.phone ? `${party.name} - ${party.phone}` : party.name;
        option.dataset.partyId = party.id || "";
        select.appendChild(option);
      });
    }
    if (!results.length) {
      return;
    }
  } catch (e) {
    console.error(e);
    if (select) {
      select.innerHTML = `<option value="">Saved parties failed to load</option>`;
    }
  }
}

function resetDirectoryPartyForm(resetSelect = true) {
  const select = document.getElementById("directoryPartySelect");
  const partyId = document.getElementById("directoryPartyId");
  const name = document.getElementById("directoryPartyName");
  const phone = document.getElementById("directoryPartyPhone");
  const address = document.getElementById("directoryPartyAddress");
  const type = document.getElementById("directoryPartyType");

  if (resetSelect && select) select.value = "";
  if (partyId) partyId.value = "";
  if (name) name.value = "";
  if (phone) phone.value = "";
  if (address) address.value = "";
  if (type) type.value = "BOTH";
  clearDirectoryLinkedParty();
}

function setUploadStatus(type, message, errors = []) {
  const status = document.getElementById("uploadStatus");
  if (!status) return;

  status.className = `notice ${type}`;
  status.innerHTML = "";

  const title = document.createElement("strong");
  title.innerText = message;
  status.appendChild(title);

  if (errors.length) {
    const list = document.createElement("ul");
    errors.slice(0, 5).forEach(error => {
      const item = document.createElement("li");
      item.innerText = `Row ${error.row}: ${error.error}`;
      list.appendChild(item);
    });
    status.appendChild(list);
  }
}
