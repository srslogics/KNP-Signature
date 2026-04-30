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
      } else {
        const quantityLeakage = Number(data.total_quantity_leakage || 0);
        const leakageText = `Leakage: ${Number(data.total_leakage || 0).toLocaleString()} kg${quantityLeakage ? `, ${quantityLeakage.toLocaleString()} NAG` : ""}`;
        showToast(`Processed. ${leakageText}`);
        setUploadStatus("success", `Day processed. ${leakageText}`);
      }

    } catch (e) {
      console.error(e);
      showToast("Processing failed");
      setUploadStatus("error", "Processing failed. Check backend connection and entered stock values.");
    } finally {
      toggleButtons(false);
    }
  }

  function toggleButtons(disable) {
    document.querySelectorAll("button").forEach(btn => {
      btn.disabled = disable;
      btn.classList.toggle("is-loading", disable);
    });
  }

  function addActualStockRow() {
    const container = document.getElementById("actualStockRows");
    const row = document.createElement("div");
    row.className = "upload-box actual-stock-row";
    row.innerHTML = `
      <input type="text" class="actualItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
      <input type="number" class="actualNag" placeholder="Actual NAG" min="0" step="1">
      <input type="number" class="actualWeight" placeholder="Actual stock (kg)" min="0" step="0.01">
      <button onclick="removeActualStockRow(this)">Remove</button>
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
}

function initPartyDirectory() {
  loadPartyDirectory();
  const nameInput = document.getElementById("directoryPartyName");
  if (!nameInput) return;

  nameInput.addEventListener("change", () => hydrateDirectoryPartyForm(nameInput.value));
  nameInput.addEventListener("blur", () => hydrateDirectoryPartyForm(nameInput.value));
}

function createManualRow(containerId, html) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement("div");
  row.className = "upload-box manual-entry-row";
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
    <input type="text" class="dealerParty" placeholder="Dealer name" list="manualPartySuggestions" autocomplete="off" oninput="suggestManualParties(this)">
    <input type="text" class="dealerBillNo" placeholder="Bill no. (optional)">
    <input type="text" class="dealerItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="dealerNag" placeholder="NAG" min="0" step="1">
    <input type="number" class="dealerWeight" placeholder="Kgs" min="0" step="0.01">
    <input type="number" class="dealerRate" placeholder="Rate/kg" min="0" step="0.01">
    <button type="button" onclick="removeManualEntryRow(this)">Remove</button>
  `);
}

function addVendorEntryRow() {
  createManualRow("vendorEntryRows", `
    <input type="text" class="vendorParty" placeholder="Vendor name" list="manualPartySuggestions" autocomplete="off" oninput="suggestManualParties(this)">
    <input type="text" class="vendorCategory" placeholder="Category (optional)">
    <input type="text" class="vendorItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="vendorNag" placeholder="NAG" min="0" step="1">
    <input type="number" class="vendorWeight" placeholder="Kgs" min="0" step="0.01">
    <input type="number" class="vendorRate" placeholder="Rate/kg" min="0" step="0.01">
    <button type="button" onclick="removeManualEntryRow(this)">Remove</button>
  `);
}

function addPaymentEntryRow() {
  createManualRow("paymentEntryRows", `
    <input type="text" class="paymentParty" placeholder="Party name" list="manualPartySuggestions" autocomplete="off" oninput="suggestManualParties(this)">
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
    <button type="button" onclick="removeManualEntryRow(this)">Remove</button>
  `);
}

function addMortalityEntryRow() {
  createManualRow("mortalityEntryRows", `
    <input type="text" class="mortalityItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="mortalityNag" placeholder="NAG (optional)" min="0" step="1">
    <input type="number" class="mortalityWeight" placeholder="Weight (optional)" min="0" step="0.01">
    <button type="button" onclick="removeManualEntryRow(this)">Remove</button>
  `);
}

function addOpeningBalanceEntryRow() {
  createManualRow("openingBalanceEntryRows", `
    <input type="text" class="openingBalanceParty" placeholder="Party name" list="manualPartySuggestions" autocomplete="off" oninput="suggestManualParties(this)">
    <input type="number" class="openingBalanceAmount" placeholder="Opening balance" min="0" step="0.01">
    <select class="openingBalanceType">
      <option value="RECEIVABLE">Receivable</option>
      <option value="PAYABLE">Payable</option>
    </select>
    <button type="button" onclick="removeManualEntryRow(this)">Remove</button>
  `);
}

function addOpeningStockEntryRow() {
  createManualRow("openingStockEntryRows", `
    <input type="text" class="openingStockItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
    <input type="number" class="openingStockNag" placeholder="Opening NAG" min="0" step="1">
    <input type="number" class="openingStockWeight" placeholder="Opening kgs" min="0" step="0.01">
    <button type="button" onclick="removeManualEntryRow(this)">Remove</button>
  `);
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
      rate_per_kg: row.querySelector(".dealerRate")?.value
    }))
    .filter(row => row.dealer || row.hen_type || row.kgs || row.rate_per_kg);
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

  if (!suggestions) return;

  clearTimeout(manualPartySuggestTimer);

  if (query.length < 2) {
    suggestions.innerHTML = "";
    return;
  }

  manualPartySuggestTimer = setTimeout(async () => {
    try {
      const data = await optionalApiCall(`/party/search?name=${encodeURIComponent(query)}`, { results: [] });
      suggestions.innerHTML = "";
      (data.results || []).forEach(party => {
        const option = document.createElement("option");
        option.value = party.name;
        suggestions.appendChild(option);
      });
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
    }
  }, 200);
}

async function hydrateDirectoryPartyForm(name) {
  const query = String(name || "").trim();
  if (query.length < 2) return;

  try {
    const data = await optionalApiCall(`/party/profile?name=${encodeURIComponent(query)}`, null, "GET", null, { cache: false });
    const party = data?.party;
    if (!party) return;

    const phoneInput = document.getElementById("directoryPartyPhone");
    const addressInput = document.getElementById("directoryPartyAddress");
    const typeInput = document.getElementById("directoryPartyType");
    if (phoneInput) phoneInput.value = party.phone || "";
    if (addressInput) addressInput.value = party.address || "";
    if (typeInput) typeInput.value = party.type || "BOTH";
  } catch (e) {
    console.error(e);
  }
}

async function selectDirectoryParty(name) {
  if (!name) {
    resetDirectoryPartyForm(false);
    return;
  }
  const nameInput = document.getElementById("directoryPartyName");
  if (nameInput) nameInput.value = name;
  await hydrateDirectoryPartyForm(name);
}

async function savePartyDirectoryEntry() {
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
      JSON.stringify({ rows: [{ name, phone, address, type }] }),
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
    const data = await optionalApiCall("/party-directory", { results: [] }, "GET", null, { cache: false });
    const results = data.results || [];
    if (select) {
      select.innerHTML = `<option value="">Select saved party</option>`;
      results.forEach(party => {
        const option = document.createElement("option");
        option.value = party.name || "";
        option.textContent = party.phone ? `${party.name} - ${party.phone}` : party.name;
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
  const name = document.getElementById("directoryPartyName");
  const phone = document.getElementById("directoryPartyPhone");
  const address = document.getElementById("directoryPartyAddress");
  const type = document.getElementById("directoryPartyType");

  if (resetSelect && select) select.value = "";
  if (name) name.value = "";
  if (phone) phone.value = "";
  if (address) address.value = "";
  if (type) type.value = "BOTH";
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
