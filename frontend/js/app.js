let currentPage = "";
let currentUser = null;
let authBootstrapped = false;
let authNeedsSetup = false;
const ALL_OUTLETS_TOKEN = "ALL";

function getStoredAuthUser() {
  try {
    return JSON.parse(localStorage.getItem("STOCKPILOT_AUTH_USER") || "null");
  } catch (e) {
    return null;
  }
}

function isOwner() {
  return String(currentUser?.role || "").toUpperCase() === "OWNER";
}

function isStaff() {
  return String(currentUser?.role || "").toUpperCase() === "STAFF";
}

function getAccessibleOutlets() {
  return Array.isArray(currentUser?.outlets) ? currentUser.outlets : [];
}

function canViewAllOutlets() {
  return !!currentUser?.can_view_all_outlets;
}

function getStoredOutletId() {
  return localStorage.getItem("STOCKPILOT_SELECTED_OUTLET_ID") || "";
}

function pageRequiresSingleOutlet(page) {
  return ["retail", "billing-setup", "upload", "daily-sheet"].includes(page);
}

function getSingleOutletFallback() {
  return getAccessibleOutlets()[0]?.id || "";
}

function normalizeSelectedOutletId(page = currentPage || "dashboard") {
  const outlets = getAccessibleOutlets();
  if (!currentUser || !outlets.length) {
    localStorage.removeItem("STOCKPILOT_SELECTED_OUTLET_ID");
    return "";
  }

  const stored = getStoredOutletId();
  const validIds = new Set(outlets.map(outlet => String(outlet.id)));
  let selected = stored;

  if (selected === ALL_OUTLETS_TOKEN && !canViewAllOutlets()) {
    selected = "";
  }

  if (selected && selected !== ALL_OUTLETS_TOKEN && !validIds.has(String(selected))) {
    selected = "";
  }

  if (!selected) {
    selected = canViewAllOutlets() && !pageRequiresSingleOutlet(page)
      ? ALL_OUTLETS_TOKEN
      : getSingleOutletFallback();
  }

  if (pageRequiresSingleOutlet(page) && selected === ALL_OUTLETS_TOKEN) {
    selected = getSingleOutletFallback();
  }

  if (selected) {
    localStorage.setItem("STOCKPILOT_SELECTED_OUTLET_ID", selected);
  }

  return selected;
}

function getSelectedOutletLabel(page = currentPage || "dashboard") {
  const selected = normalizeSelectedOutletId(page);
  if (selected === ALL_OUTLETS_TOKEN) return "All Outlets";
  const outlet = getAccessibleOutlets().find(entry => String(entry.id) === String(selected));
  return outlet?.name || "";
}

function renderOutletSwitcher(page = currentPage || "dashboard") {
  const switcher = document.getElementById("outletSwitcher");
  if (!switcher) return;

  if (!currentUser) {
    switcher.style.display = "none";
    switcher.innerHTML = "";
    return;
  }

  const outlets = getAccessibleOutlets();
  if (!outlets.length) {
    switcher.style.display = "none";
    switcher.innerHTML = "";
    return;
  }

  const selected = normalizeSelectedOutletId(page);
  const options = [];

  if (canViewAllOutlets() && !pageRequiresSingleOutlet(page)) {
    options.push(`<option value="${ALL_OUTLETS_TOKEN}">All Outlets</option>`);
  }

  options.push(...outlets.map(outlet => `<option value="${outlet.id}">${outlet.name}</option>`));
  switcher.innerHTML = options.join("");
  switcher.value = selected;
  switcher.style.display = "";
  switcher.disabled = outlets.length === 1 && !canViewAllOutlets();
}

function handleOutletChange(value) {
  if (!currentUser) return;
  const page = currentPage || "dashboard";
  const nextValue = value || normalizeSelectedOutletId(page);

  if (pageRequiresSingleOutlet(page) && nextValue === ALL_OUTLETS_TOKEN) {
    const fallback = getSingleOutletFallback();
    localStorage.setItem("STOCKPILOT_SELECTED_OUTLET_ID", fallback);
    renderOutletSwitcher(page);
    showToast("Choose one outlet for this page");
    return;
  }

  localStorage.setItem("STOCKPILOT_SELECTED_OUTLET_ID", nextValue);
  if (typeof clearApiCache === "function") clearApiCache();
  renderOutletSwitcher(page);
  loadPage(page);
}

function updateAuthUi() {
  const authMeta = document.getElementById("authMeta");
  const authButton = document.getElementById("authButton");
  const dailySheetMenu = document.getElementById("menu-daily-sheet");
  const accessControlMenu = document.getElementById("menu-access-control");

  if (authMeta) {
    authMeta.textContent = currentUser
      ? `${currentUser.display_name || currentUser.username} (${currentUser.role})`
      : "";
  }

  if (authButton) {
    authButton.textContent = currentUser ? "Logout" : "Login";
  }

  if (dailySheetMenu) {
    dailySheetMenu.style.display = isOwner() ? "" : "none";
  }

  if (accessControlMenu) {
    accessControlMenu.style.display = isOwner() ? "" : "none";
  }

  renderOutletSwitcher();
}

function renderLoginScreen(setupMode = false) {
  const content = document.getElementById("content");
  const title = document.getElementById("pageTitle");
  if (title) title.innerText = setupMode ? "Owner Setup" : "Login";
  if (!content) return;

  content.innerHTML = `
    <div class="container auth-shell">
      <div class="card auth-card">
        <div class="page-intro">
          <span>${setupMode ? "First Time Setup" : "Welcome Back"}</span>
          <h2>${setupMode ? "Create the owner account" : "Login to continue"}</h2>
        </div>
        <div class="report-form auth-form">
          <input type="text" id="authUsername" placeholder="Username" autocomplete="username">
          ${setupMode ? `<input type="text" id="authDisplayName" placeholder="Display name">` : ""}
          <input type="password" id="authPassword" placeholder="Password" autocomplete="current-password">
        </div>
        <div class="report-actions">
          <button onclick="${setupMode ? "setupOwnerAccount()" : "loginUser()"}">${setupMode ? "Create Owner" : "Login"}</button>
        </div>
      </div>
    </div>
  `;
}

async function bootAuth() {
  currentUser = getStoredAuthUser();
  updateAuthUi();

  try {
    const setup = await optionalApiCall("/auth/setup-status", { has_users: true }, "GET", null, { cache: false });
    const token = localStorage.getItem("STOCKPILOT_AUTH_TOKEN");

    if (!setup.has_users) {
      authNeedsSetup = true;
      currentUser = null;
      updateAuthUi();
      renderLoginScreen(true);
      authBootstrapped = true;
      return;
    }

    if (!token) {
      authNeedsSetup = false;
      currentUser = null;
      updateAuthUi();
      renderLoginScreen(false);
      authBootstrapped = true;
      return;
    }

    let me = null;
    try {
      me = await apiCall("/auth/me", "GET", null, {}, { loader: false, cache: false });
    } catch (e) {
      const authMessage = String(e?.message || "");
      if (authMessage === "AUTH_REQUIRED" || authMessage.toLowerCase().includes("authentication required")) {
        localStorage.removeItem("STOCKPILOT_AUTH_TOKEN");
        localStorage.removeItem("STOCKPILOT_AUTH_USER");
        authNeedsSetup = false;
        currentUser = null;
        updateAuthUi();
        renderLoginScreen(false);
        authBootstrapped = true;
        return;
      }

      if (currentUser) {
        authNeedsSetup = false;
        normalizeSelectedOutletId("dashboard");
        updateAuthUi();
        authBootstrapped = true;
        loadPage("dashboard");
        return;
      }

      throw e;
    }

    if (!me?.user) {
      localStorage.removeItem("STOCKPILOT_AUTH_TOKEN");
      localStorage.removeItem("STOCKPILOT_AUTH_USER");
      authNeedsSetup = false;
      currentUser = null;
      updateAuthUi();
      renderLoginScreen(false);
      authBootstrapped = true;
      return;
    }

    currentUser = me.user;
    authNeedsSetup = false;
    localStorage.setItem("STOCKPILOT_AUTH_USER", JSON.stringify(currentUser));
    normalizeSelectedOutletId("dashboard");
    updateAuthUi();
    authBootstrapped = true;
    loadPage("dashboard");
  } catch (e) {
    authNeedsSetup = false;
    currentUser = null;
    updateAuthUi();
    renderLoginScreen(false);
    authBootstrapped = true;
  }
}

async function loginUser() {
  const username = document.getElementById("authUsername")?.value.trim() || "";
  const password = document.getElementById("authPassword")?.value || "";
  if (!username || !password) {
    showToast("Enter username and password");
    return;
  }
  const data = await apiCall("/auth/login", "POST", JSON.stringify({ username, password }), { "Content-Type": "application/json" });
  if (data.error) {
    showToast(data.error);
    return;
  }
  localStorage.setItem("STOCKPILOT_AUTH_TOKEN", data.token);
  localStorage.setItem("STOCKPILOT_AUTH_USER", JSON.stringify(data.user));
  authNeedsSetup = false;
  currentUser = data.user;
  normalizeSelectedOutletId("dashboard");
  updateAuthUi();
  loadPage("dashboard");
}

async function setupOwnerAccount() {
  const username = document.getElementById("authUsername")?.value.trim() || "";
  const password = document.getElementById("authPassword")?.value || "";
  const displayName = document.getElementById("authDisplayName")?.value.trim() || username;
  if (!username || !password) {
    showToast("Enter username and password");
    return;
  }
  const data = await apiCall("/auth/setup-owner", "POST", JSON.stringify({ username, password, display_name: displayName }), { "Content-Type": "application/json" });
  if (data.error) {
    showToast(data.error);
    return;
  }
  localStorage.setItem("STOCKPILOT_AUTH_TOKEN", data.token);
  localStorage.setItem("STOCKPILOT_AUTH_USER", JSON.stringify(data.user));
  authNeedsSetup = false;
  currentUser = data.user;
  normalizeSelectedOutletId("dashboard");
  updateAuthUi();
  loadPage("dashboard");
}

async function handleAuthButton() {
  if (!currentUser) {
    renderLoginScreen(authNeedsSetup);
    return;
  }
  await optionalApiCall("/auth/logout", { status: "ok" }, "POST", null, { cache: false });
  localStorage.removeItem("STOCKPILOT_AUTH_TOKEN");
  localStorage.removeItem("STOCKPILOT_AUTH_USER");
  localStorage.removeItem("STOCKPILOT_SELECTED_OUTLET_ID");
  authNeedsSetup = false;
  currentUser = null;
  updateAuthUi();
  renderLoginScreen(false);
}

function handleAuthExpired() {
  currentUser = null;
  localStorage.removeItem("STOCKPILOT_SELECTED_OUTLET_ID");
  updateAuthUi();
  renderLoginScreen(authNeedsSetup);
}

async function loadUserAccessList() {
  const box = document.getElementById("userAccessList");
  if (!box || !isOwner()) return;
  box.textContent = "Loading users...";
  const data = await optionalApiCall("/auth/users", { results: [] }, "GET", null, { cache: false });
  const users = data.results || [];
  if (!users.length) {
    box.textContent = "No users yet";
    return;
  }
  box.innerHTML = users.map(user => {
    const outletText = (user.outlets || []).map(outlet => outlet.name).join(", ") || "No outlet";
    return `${user.display_name || user.username} - ${user.username} (${user.role})<br><small>${outletText}</small>`;
  }).join("<br><br>");
}

async function loadOutletAdminData() {
  const listBox = document.getElementById("outletAccessList");
  const select = document.getElementById("newUserOutlets");
  if (!isOwner()) return;

  const data = await optionalApiCall("/outlets", { results: [] }, "GET", null, { cache: false });
  const outlets = data.results || [];

  if (listBox) {
    listBox.innerHTML = outlets.length
      ? outlets.map(outlet => `${outlet.name}${outlet.code ? ` (${outlet.code})` : ""}`).join("<br>")
      : "No outlets yet";
  }

  if (select) {
    select.innerHTML = outlets.map(outlet => `<option value="${outlet.id}">${outlet.name}</option>`).join("");
  }
}

function syncUserOutletPicker() {
  const role = document.getElementById("newUserRole")?.value || "STAFF";
  const outletField = document.getElementById("newUserOutlets");
  if (!outletField) return;
  outletField.disabled = role === "OWNER";
  outletField.closest(".user-outlet-picker")?.classList.toggle("is-disabled", role === "OWNER");
}

async function createOutlet() {
  if (!isOwner()) {
    showToast("Only owner can create outlets");
    return;
  }

  const name = document.getElementById("newOutletName")?.value.trim() || "";
  const code = document.getElementById("newOutletCode")?.value.trim() || "";
  if (!name) {
    showToast("Enter outlet name");
    return;
  }

  const data = await apiCall("/outlets", "POST", JSON.stringify({ name, code }), { "Content-Type": "application/json" });
  if (data.error) {
    showToast(data.error);
    return;
  }

  document.getElementById("newOutletName").value = "";
  document.getElementById("newOutletCode").value = "";

  currentUser = {
    ...currentUser,
    outlets: data.results || currentUser.outlets || []
  };
  localStorage.setItem("STOCKPILOT_AUTH_USER", JSON.stringify(currentUser));
  normalizeSelectedOutletId(currentPage || "dashboard");
  updateAuthUi();
  await loadOutletAdminData();
  showToast("Outlet created");
}

async function createAppUser() {
  if (!isOwner()) {
    showToast("Only owner can create users");
    return;
  }
  const display_name = document.getElementById("newUserDisplayName")?.value.trim() || "";
  const username = document.getElementById("newUsername")?.value.trim() || "";
  const password = document.getElementById("newUserPassword")?.value || "";
  const role = document.getElementById("newUserRole")?.value || "STAFF";
  const outlet_ids = Array.from(document.getElementById("newUserOutlets")?.selectedOptions || []).map(option => option.value);
  if (!username || !password) {
    showToast("Enter username and password");
    return;
  }
  if (role !== "OWNER" && !outlet_ids.length) {
    showToast("Select at least one outlet for staff");
    return;
  }
  const data = await apiCall("/auth/users", "POST", JSON.stringify({ display_name, username, password, role, outlet_ids }), { "Content-Type": "application/json" });
  if (data.error) {
    showToast(data.error);
    return;
  }
  document.getElementById("newUserDisplayName").value = "";
  document.getElementById("newUsername").value = "";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newUserRole").value = "STAFF";
  Array.from(document.getElementById("newUserOutlets")?.options || []).forEach(option => {
    option.selected = false;
  });
  syncUserOutletPicker();
  showToast("User created");
  loadUserAccessList();
}

function loadPage(page) {
    if (!currentUser) {
      renderLoginScreen(authNeedsSetup);
      return;
    }
    const selectedOutlet = normalizeSelectedOutletId(page);
    if (page === "daily-sheet" && !isOwner()) {
      showToast("Daily Sheet is only for owner");
      return;
    }
    if (page === "access-control" && !isOwner()) {
      showToast("Access Control is only for owner");
      return;
    }
    if (pageRequiresSingleOutlet(page) && selectedOutlet === ALL_OUTLETS_TOKEN) {
      const fallback = getSingleOutletFallback();
      localStorage.setItem("STOCKPILOT_SELECTED_OUTLET_ID", fallback);
      showToast("Choose one outlet for this page");
    }
    currentPage = page;
    renderOutletSwitcher(page);
    const content = document.getElementById("content");
    const title = document.getElementById("pageTitle");
    const toast = document.getElementById("toast");
    if (toast) toast.style.display = "none";

    if (typeof destroyDashboardCharts === "function") {
      destroyDashboardCharts();
    }
    if (typeof destroyAnalyticsCharts === "function") {
      destroyAnalyticsCharts();
    }

    // --- Active menu highlight
    document.querySelectorAll(".menu button").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`menu-${page}`);
    if (activeBtn) activeBtn.classList.add("active");

    // --- Upload Page
    if (page === "upload") {
      title.innerText = "Daily Entries";

      content.innerHTML = `
        <div class="container upload-page">

          <div class="page-intro">
            <span>Daily Operations</span>
            <h2>Capture purchases, sales, payments, mortality, and opening figures in one working screen</h2>
          </div>

          <div class="section upload-date-section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Working Date</span>
                <h2>Choose one date before entering the day</h2>
                <p>This date is shared by manual entries and the day-processing step.</p>
              </div>
            </div>
            <div class="upload-box upload-date-box">
              <input type="date" id="uploadWorkingDate">
            </div>
            <div id="uploadStatus" class="notice upload-status" aria-live="polite"></div>
          </div>

          <datalist id="itemSuggestions"></datalist>
          <datalist id="manualPartySuggestions"></datalist>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Party Directory</span>
                <h2>Save party details once and reuse them everywhere</h2>
                <p>Keep customer, vendor, and dealer names clean so billing and ledger stay consistent.</p>
              </div>
            </div>
            <div class="upload-box directory-intro upload-note-box">
              Save customer, vendor, or dealer name with phone number once. Billing and receipts can then fetch it automatically.
            </div>
            <div class="upload-box manual-entry-row party-directory-form">
              <select id="directoryPartySelect" onchange="selectDirectoryParty(this.value)">
                <option value="">Select saved party</option>
              </select>
              <input type="hidden" id="directoryPartyId">
              <div class="typeahead-field">
                <input type="text" id="directoryPartyName" placeholder="Name" autocomplete="off">
                <div id="directoryPartySuggestBox" class="typeahead-box"></div>
              </div>
              <input type="text" id="directoryPartyPhone" placeholder="Phone number">
              <input type="text" id="directoryPartyAddress" placeholder="Address (optional)">
              <select id="directoryPartyType">
                <option value="BOTH">Customer / Both</option>
                <option value="VENDOR">Vendor</option>
                <option value="DEALER">Dealer</option>
              </select>
              <button type="button" class="directory-save-button" onclick="savePartyDirectoryEntry()">Save Party</button>
            </div>
            <div class="upload-box directory-intro upload-note-box">
              Pick a saved party from the dropdown to edit it, or leave the dropdown empty to add a new one.
            </div>
          </div>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Dealer Purchases</span>
                <h2>Capture inward stock and transport loss together</h2>
                <p>Use one row per dealer line so purchase and transport mortality stay tied to the same entry.</p>
              </div>
            </div>
            <div class="upload-box directory-intro upload-note-box">
              Add dealer purchase here. If any birds died in transport, add that directly in the same row under transport mortality.
            </div>
            <div id="dealerEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addDealerEntryRow()">Add Dealer Row</button>
              <button onclick="submitDealerEntries()">Save Dealer Entries</button>
            </div>
          </div>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Vendor Sales</span>
                <h2>Enter vendor-side movement cleanly</h2>
                <p>Keep category, item, NAG, kgs, and rate in one compact sales row.</p>
              </div>
            </div>
            <div id="vendorEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addVendorEntryRow()">Add Vendor Row</button>
              <button onclick="submitVendorEntries()">Save Vendor Entries</button>
            </div>
          </div>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Payments</span>
                <h2>Log incoming and outgoing money separately from billing</h2>
                <p>Use this for direct party payments that are not being entered from the counter billing screen.</p>
              </div>
            </div>
            <div id="paymentEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addPaymentEntryRow()">Add Payment Row</button>
              <button onclick="submitPaymentEntries()">Save Payments</button>
            </div>
          </div>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Shop Mortality</span>
                <h2>Record post-arrival mortality separately</h2>
                <p>This is for shop-side loss only. Transport mortality belongs inside dealer purchase rows.</p>
              </div>
            </div>
            <div id="mortalityEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addMortalityEntryRow()">Add Mortality Row</button>
              <button onclick="submitMortalityEntries()">Save Shop Mortality</button>
            </div>
          </div>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Process Day</span>
                <h2>Close the day with actual stock</h2>
                <p>Enter actual closing NAG and weight per hen type, then process the day to calculate leakage.</p>
              </div>
            </div>
            <div class="upload-box process-day-controls">
              <input type="date" id="processDate">
            </div>
            <div id="actualStockRows" class="stock-rows">
              <div class="upload-box actual-stock-row">
                <input type="text" class="actualItem" placeholder="Hen type" list="itemSuggestions" autocomplete="off" oninput="suggestItems(this)">
                <input type="number" class="actualNag" placeholder="Actual NAG" min="0" step="1">
                <input type="number" class="actualWeight" placeholder="Actual stock (kg)" min="0" step="0.01">
              </div>
            </div>
            <div class="upload-box upload-actions">
              <button onclick="addActualStockRow()">Add Hen Type</button>
              <button onclick="processDay()">Process</button>
            </div>
          </div>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Initial Setup</span>
                <h2>Opening Balance</h2>
                <p>Use this when carrying forward party receivable or payable at the start of the system.</p>
              </div>
            </div>
            <div id="openingBalanceEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addOpeningBalanceEntryRow()">Add Opening Balance Row</button>
              <button onclick="submitOpeningBalanceEntries()">Save Opening Balances</button>
            </div>
          </div>

          <div class="section">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <span>Initial Setup</span>
                <h2>Opening Stock</h2>
                <p>Set the beginning live stock so the first stock sheet starts from a real baseline.</p>
              </div>
            </div>
            <div id="openingStockEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addOpeningStockEntryRow()">Add Opening Stock Row</button>
              <button onclick="submitOpeningStockEntries()">Save Opening Stock</button>
            </div>
          </div>

        </div>
      `;

      setTimeout(() => {
        const uploadWorkingDate = document.getElementById("uploadWorkingDate");
        const processDate = document.getElementById("processDate");
        if (uploadWorkingDate) uploadWorkingDate.value = formatDateInput(new Date());
        if (processDate) processDate.value = formatDateInput(new Date());
        if (uploadWorkingDate && processDate) {
          uploadWorkingDate.addEventListener("change", () => {
            if (!processDate.dataset.touched || processDate.dataset.touched === "false") {
              processDate.value = uploadWorkingDate.value;
            }
          });
          processDate.addEventListener("change", () => {
            processDate.dataset.touched = "true";
          });
        }
        if (typeof initManualEntryRows === "function") {
          initManualEntryRows();
        }
        if (typeof initPartyDirectory === "function") {
          initPartyDirectory();
        }
      }, 100);
    }

    // --- Dashboard Page
    else if (page === "dashboard") {
      title.innerText = "Business Dashboard";

      content.innerHTML = `
        <div class="container">

          <div class="page-intro dashboard-intro">
            <span>Control Center</span>
            <h2>Daily revenue, stock control, collections, and counter activity in one working view</h2>
          </div>

          <div class="card toolbar dashboard-toolbar">
            <div class="dashboard-toolbar-copy">
              <span>Working Date</span>
              <h3>Load one day and review the business quickly</h3>
            </div>
            <div class="dashboard-toolbar-actions">
              <input type="date" id="dashboardDate">
              <button onclick="loadDashboard()">Load Dashboard</button>
            </div>
          </div>

          <div class="dashboard-kpi-grid">
            <div class="dashboard-kpi-card tone-blue">
              <span>Today's Revenue</span>
              <h2 id="sales">₹ 0</h2>
              <p>Total sales booked for the selected day</p>
            </div>

            <div class="dashboard-kpi-card tone-slate">
              <span>Today's Cost</span>
              <h2 id="purchase">₹ 0</h2>
              <p>Stock purchase value recorded for the day</p>
            </div>

            <div class="dashboard-kpi-card tone-green">
              <span>Profit</span>
              <h2 id="profit">₹ 0</h2>
              <p>Simple operating spread for the selected day</p>
            </div>

            <div class="dashboard-kpi-card tone-red">
              <span>Leakage</span>
              <h2 id="leakage">0 kg</h2>
              <p>Difference between expected and actual stock</p>
            </div>
          </div>

          <div class="dashboard-kpi-grid dashboard-kpi-grid-secondary">
            <div class="dashboard-kpi-card tone-green">
              <span>Receivable</span>
              <h2 id="receivable">₹ 0</h2>
              <p>Money expected from parties up to this date</p>
            </div>

            <div class="dashboard-kpi-card tone-slate">
              <span>Payable</span>
              <h2 id="payable">₹ 0</h2>
              <p>Money to be paid out up to this date</p>
            </div>

            <div class="dashboard-kpi-card tone-green">
              <span>Total Outstanding</span>
              <h2 id="outstanding">₹ 0</h2>
              <p>Combined open balance across parties</p>
            </div>
          </div>

          <div class="dashboard-mini-grid">
            <div class="dashboard-mini-card">
              <span>Retail Sales</span>
              <h2 id="dashboardRetailSales">₹ 0</h2>
            </div>

            <div class="dashboard-mini-card">
              <span>Dressed Sales</span>
              <h2 id="dashboardDressedSales">₹ 0</h2>
            </div>

            <div class="dashboard-mini-card">
              <span>Payments In</span>
              <h2 id="dashboardPaymentsReceived">₹ 0</h2>
            </div>

            <div class="dashboard-mini-card">
              <span>Payments Out</span>
              <h2 id="dashboardPaymentsPaid">₹ 0</h2>
            </div>

            <div class="dashboard-mini-card">
              <span>Mortality</span>
              <h2 id="dashboardMortality">0 kg</h2>
              <p id="dashboardMortalityNag">0 NAG</p>
            </div>

            <div class="dashboard-mini-card">
              <span>Process Status</span>
              <h2 id="dashboardProcessStatus">Pending</h2>
              <p id="dashboardProcessMeta">No item rows processed</p>
            </div>
          </div>

          <div class="chart-grid dashboard-chart-grid">
            <div class="card chart-card dashboard-chart-card">
              <div class="dashboard-card-head">
                <div>
                  <span>Trend</span>
                  <h2>Sales vs Purchase Trend</h2>
                </div>
              </div>
              <canvas id="trendChart"></canvas>
            </div>

            <div class="card chart-card dashboard-chart-card">
              <div class="dashboard-card-head">
                <div>
                  <span>Margin</span>
                  <h2>Profit Trend</h2>
                </div>
              </div>
              <canvas id="profitChart"></canvas>
            </div>

            <div class="card chart-card dashboard-chart-card">
              <div class="dashboard-card-head">
                <div>
                  <span>Counter Mix</span>
                  <h2>Regular vs Dressed Billing</h2>
                </div>
              </div>
              <canvas id="leakageChart"></canvas>
            </div>
          </div>

          <div class="dashboard-detail-grid">
            <div class="card insights dashboard-insights-card">
              <div class="dashboard-card-head">
                <div>
                  <span>Observations</span>
                  <h2>Daily Insights</h2>
                </div>
              </div>
              <ul id="insightsList"></ul>
            </div>

            <div class="card table-card dashboard-inventory-card">
              <div class="dashboard-card-head">
                <div>
                  <span>Stock Position</span>
                  <h2>Inventory By Hen Type</h2>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Opening</th>
                    <th>Purchase</th>
                    <th>Sales</th>
                    <th>Expected</th>
                    <th>Actual</th>
                    <th>Leakage</th>
                  </tr>
                </thead>
                <tbody id="inventoryBody">
                  <tr><td colspan="7" class="empty">No data yet</td></tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>
      `;

      // ✅ Auto load dashboard
      setTimeout(() => {
        const today = formatDateInput(new Date());
        document.getElementById("dashboardDate").value = today;
        loadDashboard();
      }, 100);
    }

    // --- Access Control Page
    else if (page === "access-control") {
      title.innerText = "Access Control";

      content.innerHTML = `
        <div class="container access-control-page">

          <div class="page-intro">
            <span>Owner Only</span>
            <h2>Create staff users and keep editing rights with owner only</h2>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
                <span>Outlet Management</span>
                <h2>Add Outlet</h2>
              </div>
            </div>

            <div class="upload-box compact-form-card">
              <div class="report-form auth-form auth-inline-form access-inline-form">
                <input type="text" id="newOutletName" placeholder="Outlet name">
                <input type="text" id="newOutletCode" placeholder="Code (optional)">
                <button onclick="createOutlet()">Add Outlet</button>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
                <span>Current Outlets</span>
                <h2>Saved Outlets</h2>
              </div>
            </div>
            <div id="outletAccessList" class="upload-box directory-intro access-list">Loading outlets...</div>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
                <span>User Management</span>
                <h2>Add App User</h2>
              </div>
            </div>

            <div class="upload-box compact-form-card">
              <div class="report-form auth-form auth-inline-form access-inline-form access-user-form">
                <input type="text" id="newUserDisplayName" placeholder="Display name">
                <input type="text" id="newUsername" placeholder="Username">
                <input type="password" id="newUserPassword" placeholder="Password">
                <select id="newUserRole">
                  <option value="STAFF">Staff</option>
                  <option value="OWNER">Owner</option>
                </select>
                <div class="user-outlet-picker">
                  <select id="newUserOutlets" multiple aria-label="Outlet access"></select>
                </div>
                <button onclick="createAppUser()">Add User</button>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
                <span>Current Access</span>
                <h2>Saved Users</h2>
              </div>
            </div>
            <div id="userAccessList" class="upload-box directory-intro access-list">Loading users...</div>
          </div>

        </div>
      `;

      setTimeout(() => {
        loadOutletAdminData();
        loadUserAccessList();
        syncUserOutletPicker();
        document.getElementById("newUserRole")?.addEventListener("change", syncUserOutletPicker);
      }, 100);
    }

    // --- Ledger Page
    else if (page === "ledger") {
      title.innerText = "Ledger";

      content.innerHTML = `
        <div class="container">

          <div class="page-intro">
            <span>Party Ledger</span>
            <h2>Search customer, hotel, shop, or dealer balances</h2>
          </div>

          <div class="card search-card toolbar">
            <div class="typeahead-field">
              <input type="text" id="party" placeholder="Search party..." autocomplete="off" oninput="suggestParties()" onfocus="suggestParties()" onblur="scheduleSuggestionBoxHide('ledgerPartySuggestBox')">
              <div id="ledgerPartySuggestBox" class="typeahead-box"></div>
            </div>
            <datalist id="partySuggestions"></datalist>
            <input type="date" id="ledgerStartDate" aria-label="Ledger start date">
            <input type="date" id="ledgerEndDate" aria-label="Ledger end date">
            <button onclick="searchLedger()">Search</button>
          </div>

          <div class="summary">
            <div class="summary-box">
              <span>Total Balance</span>
              <h2 id="totalBalance">₹ 0</h2>
            </div>
          </div>

          <div class="grid" id="partySummary"></div>

          <div class="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Bill No</th>
                  <th>Category</th>
                  <th>Item</th>
                  <th>NAG</th>
                  <th>KGS</th>
                  <th>Rate</th>
                  <th>Mode</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody id="ledgerBody">
                <tr>
                  <td colspan="11" class="empty">No data yet</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      `;
    }

    // --- Retail Billing Page
    else if (page === "retail") {
      title.innerText = "Retail Billing";

      content.innerHTML = `
        <div class="container">

          <div class="page-intro">
            <span>Counter Billing</span>
            <h2>Create retail bills, payment receipts, print thermal slips, and push records into the system</h2>
          </div>

          <div class="retail-layout">
            <div class="section">
              <div class="section-head">
                <div>
                  <span>New Bill</span>
                  <h2 id="retailModeTitle">Retail Billing</h2>
                </div>
                <button type="button" onclick="resetRetailForm()">New Bill</button>
              </div>

              <div id="retailOfflineBanner" class="notice info" style="display:none;"></div>
              <datalist id="retailCustomerSuggestions"></datalist>

              <div class="retail-mode-switch" role="tablist" aria-label="Retail billing mode">
                <button type="button" id="retailModeRegular" class="retail-mode-button active" onclick="setRetailBillingMode('regular')">Billing</button>
                <button type="button" id="retailModePayment" class="retail-mode-button" onclick="setRetailBillingMode('payment')">Payment Receipt</button>
              </div>

              <div id="retailSalesSection" class="retail-billing-panel retail-billing-section retail-combined-billing">
                <div class="retail-shortcuts">
                  <div class="retail-shortcuts-head">
                    <span>Bill Details</span>
                    <p>Use one bill for regular items, dressed items, or both together.</p>
                  </div>
                  <div class="retail-form-grid">
                    <input type="date" id="retailDate" aria-label="Retail bill date">
                    <input type="text" id="retailBillNumber" placeholder="Bill no">
                    <input type="text" id="retailCashier" placeholder="Cashier name" value="admin">
                    <div class="billing-priority-field">
                      <span class="billing-priority-label">Settlement</span>
                      <select id="retailSettlementType">
                        <option value="credit">Credit</option>
                        <option value="partial">Part Payment</option>
                        <option value="paid">Full Payment</option>
                      </select>
                    </div>
                    <select id="retailPaymentMode">
                      <option value="Cash">Cash</option>
                      <option value="Online">Online</option>
                      <option value="Bank">Bank</option>
                      <option value="Credit">Credit</option>
                    </select>
                    <div class="typeahead-field">
                      <input type="text" id="retailCustomerName" placeholder="Customer name (optional)" autocomplete="off" oninput="suggestRetailCustomers()" onfocus="suggestRetailCustomers()">
                      <div id="retailCustomerSuggestBox" class="typeahead-box"></div>
                    </div>
                    <input type="text" id="retailCustomerPhone" placeholder="Phone (optional)">
                    <input type="text" id="retailCustomerAddress" placeholder="Address (optional)">
                    <input type="number" id="retailIceAmount" placeholder="Ice amount (optional)" min="0" step="0.01">
                  </div>
                </div>

                <div class="retail-shortcuts retail-combined-shortcuts">
                  <div class="retail-shortcuts-head">
                    <span>Shortcuts</span>
                    <p>Keep regular and dressed shortcuts together so counter staff can add either kind of line from one place.</p>
                  </div>
                  <div class="retail-shortcut-groups">
                    <div class="retail-shortcut-group">
                      <div class="retail-shortcuts-head">
                        <span>Regular Shortcuts</span>
                        <p>Tap an item to add it with its default rate.</p>
                      </div>
                      <div id="retailRegularShortcutItems" class="retail-shortcut-list"></div>
                    </div>
                    <div class="retail-shortcut-group">
                      <div class="retail-shortcuts-head">
                        <span>Dressed Shortcuts</span>
                        <p>Tap an item to add it with its default rate.</p>
                      </div>
                      <div id="retailDressedShortcutItems" class="retail-shortcut-list"></div>
                    </div>
                  </div>
                </div>

                <div class="retail-combined-workspace">
                  <div id="retailRegularSection" class="retail-billing-section retail-billing-card">
                    <div class="retail-shortcuts-head">
                      <span>Regular Billing</span>
                      <p>Regular chicken billing with automatic rate fill from shortcuts.</p>
                    </div>
                    <div id="retailRegularRows" class="retail-items retail-items-horizontal"></div>
                    <div class="retail-inline-actions">
                      <button type="button" id="retailAddRegularItemButton" onclick="addRegularRetailRow()">Add Regular Item</button>
                    </div>
                  </div>

                  <div id="retailDressedSection" class="retail-billing-section retail-billing-card">
                    <div class="retail-shortcuts-head">
                      <span>Dressed Billing</span>
                      <p>Bill dressed chicken separately with item name, kgs, rate, and amount.</p>
                    </div>
                    <div id="retailDressedRows" class="retail-items retail-items-horizontal"></div>
                    <div class="retail-inline-actions">
                      <button type="button" id="retailAddDressedItemButton" onclick="addDressedRetailRow()">Add Dressed Item</button>
                    </div>
                  </div>
                </div>

                <div class="retail-form-grid retail-notes-grid">
                  <input type="number" id="retailPaidAmount" placeholder="Paid amount" min="0" step="0.01">
                  <textarea id="retailNotes" placeholder="Notes for bill"></textarea>
                </div>
                <div class="report-actions retail-actions">
                  <button type="button" onclick="saveRetailBill({ autoStartNext: true })">Save Bill</button>
                  <button type="button" onclick="sendCurrentRetailBill()">Send on WhatsApp</button>
                  <button type="button" onclick="printCurrentRetailBill()">Print Bill</button>
                </div>
              </div>

              <div id="paymentReceiptSection" class="retail-billing-panel retail-billing-section" style="display:none;">
                <div class="retail-shortcuts-head">
                  <span>Payment Receipt</span>
                  <p>Create a separate receipt when money is received from or paid to a vendor or dealer.</p>
                </div>

                <div class="retail-form-grid">
                  <input type="date" id="paymentReceiptDate" aria-label="Payment receipt date">
                  <input type="text" id="paymentReceiptNumber" placeholder="Receipt no">
                  <input type="text" id="paymentReceiptCashier" placeholder="Handled by" value="admin">
                  <select id="paymentReceiptDirection">
                    <option value="RECEIVED">Amount Received</option>
                    <option value="PAID">Amount Paid</option>
                  </select>
                  <select id="paymentReceiptMode">
                    <option value="Cash">Cash</option>
                    <option value="Online">Online</option>
                    <option value="Bank">Bank</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                  <div class="typeahead-field">
                    <input type="text" id="paymentReceiptPartyName" placeholder="Party name" autocomplete="off" oninput="suggestPaymentReceiptParties()" onfocus="suggestPaymentReceiptParties()">
                    <div id="paymentReceiptPartySuggestBox" class="typeahead-box"></div>
                  </div>
                  <datalist id="paymentReceiptPartySuggestions"></datalist>
                  <input type="text" id="paymentReceiptPartyPhone" placeholder="Phone (optional)">
                  <input type="text" id="paymentReceiptPartyAddress" placeholder="Address (optional)">
                  <input type="number" id="paymentReceiptAmount" placeholder="Amount" min="0" step="0.01">
                </div>

                <div class="retail-form-grid retail-notes-grid">
                  <textarea id="paymentReceiptNotes" placeholder="Notes for payment receipt"></textarea>
                </div>

                <div class="report-actions retail-actions">
                  <button type="button" onclick="savePaymentReceipt({ autoStartNext: true })">Save Receipt</button>
                  <button type="button" onclick="sendCurrentPaymentReceipt()">Send on WhatsApp</button>
                  <button type="button" onclick="printCurrentPaymentReceipt()">Print Payment Receipt</button>
                  <button type="button" onclick="resetPaymentReceiptForm()">New Payment Receipt</button>
                </div>
              </div>

              <datalist id="retailItemSuggestions"></datalist>
            </div>

            <div class="section retail-preview-panel">
              <div class="section-head">
                <div>
                  <span>Print Preview</span>
                  <h2 id="retailPreviewTitle">Retail Bill Preview</h2>
                </div>
              </div>
              <div id="retailPreview" class="thermal-preview"></div>
            </div>
          </div>

          <div class="section" id="retailBillHistorySection">
            <div class="section-head">
              <div>
                <span>Saved Bills</span>
                <h2 id="retailHistoryTitle">Recent Retail Bills</h2>
              </div>
              <button type="button" onclick="loadRetailBills()">Refresh</button>
            </div>

            <div class="card table-card">
              <table>
                <thead>
                  <tr>
                    <th>Bill No</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Mode</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Outstanding</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody id="retailBillsBody">
                  <tr><td colspan="8" class="empty">No retail bills yet</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="section" id="paymentReceiptHistorySection" >
            <div class="section-head">
              <div>
                <span>Saved Payment Receipts</span>
                <h2>Recent Payment Receipts</h2>
              </div>
              <button type="button" onclick="loadPaymentReceipts()">Refresh</button>
            </div>

            <div class="card table-card">
              <table>
                <thead>
                  <tr>
                    <th>Receipt No</th>
                    <th>Date</th>
                    <th>Party</th>
                    <th>Direction</th>
                    <th>Mode</th>
                    <th>Amount</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody id="paymentReceiptBody">
                  <tr><td colspan="7" class="empty">No payment receipts yet</td></tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>
      `;

      setTimeout(() => {
        if (typeof initRetailPage === "function") initRetailPage();
      }, 100);
    }

    // --- Billing Setup Page
    else if (page === "billing-setup") {
      title.innerText = "Billing Setup";

      content.innerHTML = `
        <div class="container">

          <div class="page-intro">
            <span>Billing Admin</span>
            <h2>Manage shortcut items and dressed stock without cluttering the live billing counter</h2>
          </div>

          <div class="section retail-setup-page">
            <div class="section-head">
              <div>
                <span>Setup Tools</span>
                <h2 id="retailModeTitle">Regular Setup</h2>
              </div>
            </div>

            <div class="retail-shortcuts">
              <div class="retail-shortcuts-head">
                <span>Working Date</span>
                <p>Use one outlet and one billing date while preparing shortcuts or dressed stock.</p>
              </div>
              <div class="retail-form-grid retail-setup-date-grid">
                <input type="date" id="retailDate" aria-label="Billing setup date">
              </div>
            </div>

            <div class="retail-mode-switch" role="tablist" aria-label="Billing setup mode">
              <button type="button" id="retailModeRegular" class="retail-mode-button active" onclick="setRetailBillingMode('regular')">Regular Shortcuts</button>
              <button type="button" id="retailModeDressed" class="retail-mode-button" onclick="setRetailBillingMode('dressed')">Dressed Setup</button>
            </div>

            <div class="retail-billing-panel retail-setup-panel retail-setup-panel-standalone">
              <div class="retail-shortcut-manager">
                <div class="retail-shortcuts-head">
                  <span>Shortcut Manager</span>
                  <p id="shortcutManagerHelp">Add your own quick items with default rate for this billing type.</p>
                </div>
                <div class="retail-shortcut-form">
                  <input type="text" id="shortcutName" placeholder="Item name">
                  <input type="number" id="shortcutRate" placeholder="Default rate" min="0" step="0.01">
                  <select id="shortcutLineType" >
                    <option value="STANDARD">Regular</option>
                    <option value="DRESSED">Dressed</option>
                  </select>
                  <select id="shortcutUnit">
                    <option value="KGS">KGS</option>
                    <option value="PCS">PCS</option>
                  </select>
                  <button type="button" onclick="saveRetailShortcut()">Save Shortcut</button>
                </div>
                <div id="retailShortcutManagerList" class="retail-shortcut-list retail-shortcut-list-managed"></div>
              </div>

              <div class="retail-shortcuts" id="dressedStockSetupSection" >
                <div class="retail-shortcuts-head">
                  <span>Dressed Stock Entry</span>
                  <p>Enter live stock and dressed weight. Bills deduct dressed weight automatically.</p>
                </div>
                <div id="dressedStockRows" class="retail-items"></div>
                <div class="retail-item-actions">
                  <button type="button" onclick="addDressedStockRow()">Add Dressed Stock</button>
                  <button type="button" onclick="saveDressedStock()">Save Dressed Stock</button>
                </div>
                <div class="retail-saved-subsection">
                  <div class="retail-shortcuts-head retail-saved-head">
                    <span>Saved Dressed Stock</span>
                    <p>Review dressed stock entries saved for the selected billing date.</p>
                  </div>
                  <div class="card table-card">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Item</th>
                          <th>Live NAG</th>
                          <th>Live Weight</th>
                          <th>Dressed Weight</th>
                          <th>Remaining</th>
                        </tr>
                      </thead>
                      <tbody id="dressedStockSavedBody">
                        <tr>
                          <td colspan="6" class="empty">No dressed stock saved yet</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      `;

      setTimeout(() => {
        if (typeof initRetailSetupPage === "function") initRetailSetupPage();
      }, 100);
    }

    // --- Daily Sheet Page
    else if (page === "daily-sheet") {
      title.innerText = "Daily Sheet";

      content.innerHTML = `
        <div class="container">

          <div class="page-intro">
            <span>Daily Trading Sheet</span>
            <h2>Opening stock, purchases, sales by section, and final stock summary</h2>
          </div>

          <div class="card filter toolbar">
            <select id="dailySheetType">
              <option value="stock">Stock Sheet</option>
              <option value="vendor">Vendor Balance Sheet</option>
              <option value="dealer">Dealer Balance Sheet</option>
            </select>
            <input type="date" id="dailySheetDate">
            <button onclick="loadDailySheet()">Load Sheet</button>
          </div>

          <div class="section daily-sheet-card">
            <div class="section-head">
              <div>
                <span>Daily Statement</span>
                <h2 id="dailySheetTitle">Opening Stock</h2>
              </div>
              <button onclick="window.print()">Print</button>
            </div>

            <div id="dailySheetMeta" class="notice info"></div>
            <div id="dailySheetContent"></div>
          </div>

        </div>
      `;

      setTimeout(() => {
        document.getElementById("dailySheetDate").value = formatDateInput(new Date());
        loadDailySheet();
      }, 100);
    }

    // --- Analytics Page
    else if (page === "analytics") {
      title.innerText = "Analytics";

      content.innerHTML = `
        <div class="container">

          <div class="page-intro">
            <span>Performance Review</span>
            <h2>Track sales, leakage, debtors, and hen-type profitability</h2>
          </div>

          <div class="card filter toolbar">
            <input type="date" id="startDate">
            <input type="date" id="endDate">
            <button onclick="loadAnalytics()">Load</button>
          </div>

          <div class="grid analytics-kpi-grid">
            <div class="metric blue">
              <span>Sales</span>
              <h2 id="analyticsSales">₹ 0</h2>
            </div>
            <div class="metric dark">
              <span>Purchase</span>
              <h2 id="analyticsPurchase">₹ 0</h2>
            </div>
            <div class="metric profit">
              <span>Profit</span>
              <h2 id="analyticsProfit">₹ 0</h2>
            </div>
            <div class="metric green">
              <span>Net Cash</span>
              <h2 id="analyticsCash">₹ 0</h2>
            </div>
          </div>

          <div class="chart-grid">
          <div class="card chart-card">
            <h2>Sales vs Purchase Trend</h2>
            <canvas id="trendChart"></canvas>
          </div>

          <div class="card chart-card">
            <h2>Cash In vs Cash Out</h2>
            <canvas id="cashFlowChart"></canvas>
          </div>

          <div class="card chart-card">
            <h2>Leakage Trend</h2>
            <canvas id="leakageChart"></canvas>
          </div>

          <div class="card chart-card">
            <h2>Purchase vs Sales Kg By Hen Type</h2>
            <canvas id="itemVolumeChart"></canvas>
          </div>

          <div class="card chart-card">
            <h2>Top Debtors</h2>
            <canvas id="debtorChart"></canvas>
          </div>

          <div class="card chart-card">
            <h2>Payment Mode Split</h2>
            <canvas id="paymentModeChart"></canvas>
          </div>

          <div class="card chart-card">
            <h2>Profit By Hen Type</h2>
            <canvas id="profitByItemChart"></canvas>
          </div>
          </div>

        </div>
      `;

      // ✅ Auto load analytics
      setTimeout(() => {
        const today = new Date();
        const past = new Date();
        past.setDate(today.getDate() - 6);

        document.getElementById("startDate").value = formatDateInput(past);
        document.getElementById("endDate").value = formatDateInput(today);

        loadAnalytics();
      }, 100);
    }

    // --- Reports Page
    else if (page === "reports") {
      title.innerText = "Reports";

      content.innerHTML = `
        <div class="container">

          <div class="page-intro">
            <span>Exports</span>
            <h2>Download financial records for review, audit, and client sharing</h2>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
                <span>Report Builder</span>
                <h2>Download Financial Records</h2>
              </div>
            </div>
            <div class="report-form">
              <select id="reportType" onchange="toggleReportFields()">
                <option value="ledger">Party Ledger</option>
                <option value="transactions">All Transactions</option>
                <option value="summary">Financial Summary</option>
                <option value="outstanding">Outstanding Balances</option>
                <option value="inventory">Inventory & Leakage</option>
              </select>

              <div class="typeahead-field">
                <input type="text" id="reportParty" placeholder="Party name" autocomplete="off" oninput="suggestReportParties()" onfocus="suggestReportParties()" onblur="scheduleSuggestionBoxHide('reportPartySuggestBox')">
                <div id="reportPartySuggestBox" class="typeahead-box"></div>
              </div>
              <datalist id="reportPartySuggestions"></datalist>

              <input type="date" id="reportStartDate" aria-label="Report start date">
              <input type="date" id="reportEndDate" aria-label="Report end date">
              <input type="date" id="reportDate" aria-label="Inventory date">
            </div>

            <div class="report-actions">
              <button onclick="downloadReport('excel')">Download Excel</button>
              <button onclick="downloadReport('pdf')">Download PDF</button>
            </div>
          </div>

          <div class="grid report-summary-grid">
            <div class="metric blue">
              <span>Party Ledger</span>
              <h2>Client-wise</h2>
            </div>
            <div class="metric green">
              <span>Financial Summary</span>
              <h2>Daily totals</h2>
            </div>
            <div class="metric dark">
              <span>Outstanding</span>
              <h2>Receivable / Payable</h2>
            </div>
            <div class="metric red">
              <span>Inventory</span>
              <h2>Leakage kg</h2>
            </div>
          </div>

        </div>
      `;

      setTimeout(() => {
        const today = new Date();
        const past = new Date();
        past.setDate(today.getDate() - 6);
        document.getElementById("reportStartDate").value = formatDateInput(past);
        document.getElementById("reportEndDate").value = formatDateInput(today);
        document.getElementById("reportDate").value = formatDateInput(today);
        toggleReportFields();
      }, 100);
    }

    refreshIcons();
  }

  // --- Initial load
  window.onload = () => {
    const today = new Date().toLocaleDateString();
    document.getElementById("todayDate").innerText = today;
    bootAuth();
  };

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function drawCanvasMessage(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 180;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.font = "14px Inter, sans-serif";
    ctx.fillStyle = "#8792a7";
    ctx.textAlign = "center";
    ctx.fillText(message, width / 2, height / 2);
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function isActivePage(page) {
    return currentPage === page;
  }

  let toastTimer = null;

  // --- Toast
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.innerText = message;
    toast.style.display = "block";

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.display = "none";
    }, 3200);
  }
