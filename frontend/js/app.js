let currentPage = "";
let currentUser = null;
let authBootstrapped = false;
let authNeedsSetup = false;
const ALL_OUTLETS_TOKEN = "ALL";
let deferredInstallPrompt = null;

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
  const installButton = document.getElementById("installAppButton");
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

  if (installButton) {
    installButton.style.display = "";
    installButton.textContent = deferredInstallPrompt ? "Install App" : "Add to Home";
  }

  if (dailySheetMenu) {
    dailySheetMenu.style.display = currentUser ? "" : "none";
  }

  if (accessControlMenu) {
    accessControlMenu.style.display = isOwner() ? "" : "none";
  }

  renderOutletSwitcher();
}

async function promptInstallApp() {
  if (!deferredInstallPrompt) {
    const isAndroid = /Android/i.test(navigator.userAgent || "");
    if (isAndroid) {
      showToast("Open browser menu and tap Add to Home screen");
    } else {
      showToast("Open browser menu and choose Install app");
    }
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  updateAuthUi();

  if (choice?.outcome === "accepted") {
    showToast("App install started");
  }
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateAuthUi();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateAuthUi();
  showToast("App installed");
});

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
  const data = await optionalApiCall("/auth/users", { results: [] }, "GET", null, { cache: true });
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

  const data = await optionalApiCall("/outlets", { results: [] }, "GET", null, { cache: true });
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
  if (typeof clearCachedResponse === "function") clearCachedResponse("/outlets");
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
  if (typeof clearCachedResponse === "function") clearCachedResponse("/auth/users");
  loadUserAccessList();
}

function toggleSidebarMenu() {
    const sidebar = document.querySelector(".sidebar");
    const button = document.querySelector(".mobile-menu-button");
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle("menu-open");
    if (button) button.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function closeSidebarMenu() {
    document.querySelector(".sidebar")?.classList.remove("menu-open");
    document.querySelector(".mobile-menu-button")?.setAttribute("aria-expanded", "false");
}

function setDailyEntryWorkspace(mode) {
    const selectedMode = mode || "purchases";
    document.querySelectorAll("[data-entry-tab]").forEach(button => {
      const active = button.dataset.entryTab === selectedMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-entry-panel]").forEach(panel => {
      panel.hidden = panel.dataset.entryPanel !== selectedMode;
    });
}

function loadPage(page) {
    if (!currentUser) {
      renderLoginScreen(authNeedsSetup);
      return;
    }
    const selectedOutlet = normalizeSelectedOutletId(page);
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
    closeSidebarMenu();
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

          <div class="section upload-date-section upload-shell-section section-full">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Working Date</h2>
              </div>
            </div>
            <div class="upload-box upload-date-box">
              <input type="date" id="uploadWorkingDate">
            </div>
            <div id="uploadStatus" class="notice upload-status" aria-live="polite"></div>
          </div>

          <datalist id="itemSuggestions"></datalist>
          <datalist id="manualPartySuggestions"></datalist>

          <div class="workspace-tabs entry-workspace-tabs section-full" role="tablist" aria-label="Daily entry type">
            <button type="button" class="active" data-entry-tab="purchases" aria-selected="true" onclick="setDailyEntryWorkspace('purchases')"><i data-lucide="truck"></i><span>Purchases</span></button>
            <button type="button" data-entry-tab="sales" aria-selected="false" onclick="setDailyEntryWorkspace('sales')"><i data-lucide="shopping-bag"></i><span>Sales</span></button>
            <button type="button" data-entry-tab="payments" aria-selected="false" onclick="setDailyEntryWorkspace('payments')"><i data-lucide="banknote"></i><span>Payments</span></button>
            <button type="button" data-entry-tab="stock" aria-selected="false" onclick="setDailyEntryWorkspace('stock')"><i data-lucide="clipboard-check"></i><span>Stock Count</span></button>
            <button type="button" data-entry-tab="setup" aria-selected="false" onclick="setDailyEntryWorkspace('setup')"><i data-lucide="settings-2"></i><span>Setup</span></button>
          </div>

          <div class="section upload-shell-section section-full entry-workspace-panel" data-entry-panel="setup" hidden>
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Party Directory</h2>
              </div>
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
          </div>

          <div class="section upload-shell-section upload-entry-section entry-workspace-panel" data-entry-panel="purchases">
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Purchases from Dealers</h2>
              </div>
            </div>
            <div id="dealerEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addDealerEntryRow()">Add Dealer Row</button>
              <button onclick="submitDealerEntries()">Save Dealer Entries</button>
            </div>
          </div>

          <div class="section upload-shell-section upload-entry-section entry-workspace-panel" data-entry-panel="sales" hidden>
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Sales to Vendors</h2>
              </div>
            </div>
            <div id="vendorEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addVendorEntryRow()">Add Vendor Row</button>
              <button onclick="submitVendorEntries()">Save Vendor Entries</button>
            </div>
          </div>

          <div class="section upload-shell-section upload-entry-section entry-workspace-panel" data-entry-panel="payments" hidden>
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Payments</h2>
              </div>
            </div>
            <div id="paymentEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addPaymentEntryRow()">Add Payment Row</button>
              <button onclick="submitPaymentEntries()">Save Payments</button>
            </div>
          </div>

          <div class="section upload-shell-section upload-entry-section entry-workspace-panel" data-entry-panel="stock" hidden>
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Shop Mortality</h2>
              </div>
            </div>
            <div id="mortalityEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addMortalityEntryRow()">Add Mortality Row</button>
              <button onclick="submitMortalityEntries()">Save Shop Mortality</button>
            </div>
          </div>

          <div class="section upload-shell-section process-day-section section-full entry-workspace-panel" data-entry-panel="stock" hidden>
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Process Day</h2>
              </div>
            </div>
            <div class="upload-box process-day-controls">
              <input type="date" id="processDate">
            </div>
            <div class="process-day-grid-head" aria-hidden="true">
              <span>Hen Type</span>
              <span>Actual NAG</span>
              <span>Actual Stock (kg)</span>
              <span>Action</span>
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
            <div id="processDaySummary" class="notice upload-status" style="display:none;"></div>
          </div>

          <div class="section upload-shell-section upload-entry-section entry-workspace-panel" data-entry-panel="setup" hidden>
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Opening Balance</h2>
              </div>
            </div>
            <div id="openingBalanceEntryRows" class="stock-rows"></div>
            <div class="upload-box upload-actions">
              <button onclick="addOpeningBalanceEntryRow()">Add Opening Balance Row</button>
              <button onclick="submitOpeningBalanceEntries()">Save Opening Balances</button>
            </div>
          </div>

          <div class="section upload-shell-section upload-entry-section entry-workspace-panel" data-entry-panel="setup" hidden>
            <div class="section-head upload-section-head">
              <div class="upload-heading-block">
                <h2>Opening Stock</h2>
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
        setDailyEntryWorkspace("purchases");
        refreshIcons();
      }, 100);
    }

    // --- Dashboard Page
    else if (page === "dashboard") {
      title.innerText = "Business Dashboard";

      content.innerHTML = `
        <div class="container dashboard-page">

          <div class="card toolbar dashboard-toolbar">
            <label class="form-field compact-field"><span>Working date</span><input type="date" id="dashboardDate"></label>
            <div class="dashboard-toolbar-actions">
              <button onclick="loadDashboard()"><i data-lucide="refresh-cw"></i><span>Refresh</span></button>
            </div>
          </div>

          <div class="quick-actions" aria-label="Quick actions">
            <button type="button" onclick="loadPage('retail')"><i data-lucide="receipt-text"></i><span>New bill</span></button>
            <button type="button" onclick="loadPage('upload')"><i data-lucide="list-plus"></i><span>Daily entries</span></button>
            <button type="button" onclick="loadPage('ledger')"><i data-lucide="book-open-check"></i><span>Check ledger</span></button>
            <button type="button" onclick="loadPage('daily-sheet')"><i data-lucide="sheet"></i><span>Daily sheet</span></button>
          </div>

          <div class="dashboard-kpi-grid dashboard-kpi-grid-primary">
            <div class="dashboard-kpi-card tone-blue">
              <span>Sales</span>
              <h2 id="sales">₹ 0</h2>
            </div>

            <div class="dashboard-kpi-card tone-slate">
              <span>Purchases</span>
              <h2 id="purchase">₹ 0</h2>
            </div>

            <div class="dashboard-kpi-card tone-green">
              <span>Receivable</span>
              <h2 id="receivable">₹ 0</h2>
            </div>

            <div class="dashboard-kpi-card tone-red">
              <span>Payable</span>
              <h2 id="payable">₹ 0</h2>
            </div>
          </div>

          <div class="process-status-bar">
            <div>
              <span>Process status</span>
              <strong id="dashboardProcessStatus">Pending</strong>
            </div>
            <p id="dashboardProcessMeta">No item rows processed</p>
          </div>

          <details class="dashboard-more collapsible-section">
            <summary class="section-summary">More daily figures</summary>
            <div class="dashboard-mini-grid dashboard-ops-grid">
              <div class="dashboard-mini-card"><span>Gross Profit</span><h2 id="profit">N/A</h2></div>
              <div class="dashboard-mini-card"><span>Net position</span><h2 id="outstanding">₹ 0</h2></div>
              <div class="dashboard-mini-card"><span>Leakage</span><h2 id="leakage">0 kg</h2></div>
              <div class="dashboard-mini-card"><span>Retail sales</span><h2 id="dashboardRetailSales">₹ 0</h2></div>
              <div class="dashboard-mini-card"><span>Dressed sales</span><h2 id="dashboardDressedSales">₹ 0</h2></div>
              <div class="dashboard-mini-card"><span>Payments in</span><h2 id="dashboardPaymentsReceived">₹ 0</h2></div>
              <div class="dashboard-mini-card"><span>Payments out</span><h2 id="dashboardPaymentsPaid">₹ 0</h2></div>
              <div class="dashboard-mini-card"><span>Mortality</span><h2 id="dashboardMortality">0 kg</h2><p id="dashboardMortalityNag">0 NAG</p></div>
            </div>
          </details>

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
                  <h2>Gross Profit Trend</h2>
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

          <div class="section">
            <div class="section-head">
              <div>
                <h2>Add Outlet</h2>
              </div>
            </div>

            <div class="upload-box compact-form-card">
              <div class="report-form auth-form auth-inline-form access-inline-form">
                <label class="form-field"><span>Outlet name</span><input type="text" id="newOutletName" placeholder="Enter name"></label>
                <label class="form-field"><span>Code</span><input type="text" id="newOutletCode" placeholder="Optional"></label>
                <button onclick="createOutlet()"><i data-lucide="plus"></i><span>Add Outlet</span></button>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
                <h2>Saved Outlets</h2>
              </div>
            </div>
            <div id="outletAccessList" class="upload-box directory-intro access-list">Loading outlets...</div>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
                <h2>Add App User</h2>
              </div>
            </div>

            <div class="upload-box compact-form-card">
              <div class="report-form auth-form auth-inline-form access-inline-form access-user-form">
                <label class="form-field"><span>Display name</span><input type="text" id="newUserDisplayName" placeholder="Enter name"></label>
                <label class="form-field"><span>Username</span><input type="text" id="newUsername" placeholder="Username"></label>
                <label class="form-field"><span>Password</span><input type="password" id="newUserPassword" placeholder="Password"></label>
                <label class="form-field"><span>Role</span><select id="newUserRole">
                    <option value="STAFF">Staff</option>
                    <option value="OWNER">Owner</option>
                  </select></label>
                <div class="user-outlet-picker form-field">
                  <span>Outlet access</span>
                  <select id="newUserOutlets" multiple aria-label="Outlet access"></select>
                </div>
                <button onclick="createAppUser()"><i data-lucide="user-plus"></i><span>Add User</span></button>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <div>
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
        <div class="container ledger-page">

          <div class="card search-card toolbar ledger-query-card">
            <div class="ledger-query-fields">
              <div class="form-field ledger-party-field">
                <span>Party</span>
                <div class="typeahead-field">
                  <input type="text" id="party" placeholder="Enter party name" autocomplete="off" oninput="suggestParties()" onfocus="suggestParties()" onblur="scheduleSuggestionBoxHide('ledgerPartySuggestBox')">
                  <div id="ledgerPartySuggestBox" class="typeahead-box"></div>
                </div>
              </div>
              <datalist id="partySuggestions"></datalist>
              <label class="form-field"><span>From</span><input type="date" id="ledgerStartDate"></label>
              <label class="form-field"><span>To</span><input type="date" id="ledgerEndDate"></label>
            </div>
            <div class="ledger-query-actions">
              <button onclick="searchLedger()"><i data-lucide="search"></i><span>View ledger</span></button>
            </div>
          </div>

          <div class="summary ledger-summary">
            <div class="summary-box ledger-account-balance" hidden>
              <span>Receivable</span>
              <h2 id="receivableBalance">₹ 0</h2>
            </div>
            <div class="summary-box ledger-account-balance" hidden>
              <span>Payable</span>
              <h2 id="payableBalance">₹ 0</h2>
            </div>
            <div class="summary-box">
              <span>Balance</span>
              <h2 id="totalBalance">₹ 0</h2>
            </div>
          </div>

          <div class="grid ledger-metrics" id="partySummary"></div>

          <div class="card table-card ledger-table-card">
            <table class="ledger-table">
              <thead id="ledgerHead">
                <tr>
                  <th>Date</th>
                  <th>Transaction</th>
                  <th>Ref</th>
                  <th>Details</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody id="ledgerBody">
                <tr>
                  <td colspan="6" class="empty">Search for a party to view the ledger</td>
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
          <div class="retail-layout">
            <div class="section">
              <div id="retailOfflineBanner" class="notice info" style="display:none;"></div>
              <datalist id="retailCustomerSuggestions"></datalist>

              <div class="retail-workbench-head">
                <div class="retail-mode-switch" role="tablist" aria-label="Retail billing mode">
                  <button type="button" id="retailModeRegular" class="retail-mode-button active" onclick="setRetailBillingMode('regular')">Billing</button>
                  <button type="button" id="retailModePayment" class="retail-mode-button" onclick="setRetailBillingMode('payment')">Payment Receipt</button>
                </div>
                <div class="retail-header-actions">
                  <button type="button" class="button-secondary retail-reset-button" onclick="resetRetailForm()">New Bill</button>
                </div>
              </div>

              <div id="retailSalesSection" class="retail-billing-panel retail-billing-section retail-combined-billing">
                <div class="retail-shortcuts retail-bill-details-panel">
                <div class="retail-shortcuts-head">
                    <span>Bill Details</span>
                  </div>
                  <div class="retail-form-grid">
                    <label class="form-field"><span>Date</span><input type="date" id="retailDate"></label>
                    <label class="form-field"><span>Bill no.</span><input type="text" id="retailBillNumber" placeholder="Bill number"></label>
                    <label class="form-field"><span>Cashier</span><input type="text" id="retailCashier" value="admin"></label>
                    <div class="billing-priority-field">
                      <span class="billing-priority-label">Settlement</span>
                      <select id="retailSettlementType">
                        <option value="credit">Credit</option>
                        <option value="partial">Part Payment</option>
                        <option value="paid">Full Payment</option>
                      </select>
                    </div>
                    <label class="form-field"><span>Payment mode</span><select id="retailPaymentMode">
                        <option value="Cash">Cash</option>
                        <option value="Online">Online</option>
                        <option value="Bank">Bank</option>
                        <option value="Credit">Credit</option>
                      </select></label>
                    <div class="form-field"><span>Customer</span><div class="typeahead-field">
                        <input type="text" id="retailCustomerName" placeholder="Optional" autocomplete="off" oninput="suggestRetailCustomers()" onfocus="suggestRetailCustomers()">
                        <div id="retailCustomerSuggestBox" class="typeahead-box"></div>
                      </div>
                    </div>
                    <label class="form-field"><span>Phone</span><input type="text" id="retailCustomerPhone" placeholder="Optional"></label>
                    <label class="form-field"><span>Address</span><input type="text" id="retailCustomerAddress" placeholder="Optional"></label>
                    <label class="form-field"><span>Ice amount</span><input type="number" id="retailIceAmount" placeholder="0" min="0" step="0.01"></label>
                  </div>
                </div>

                <div class="retail-shortcuts retail-combined-shortcuts retail-shortcuts-panel">
                  <div class="retail-shortcuts-head">
                    <span>Shortcuts</span>
                  </div>
                  <div class="retail-shortcut-groups">
                    <div class="retail-shortcut-group">
                      <div class="retail-shortcuts-head">
                        <span>Regular Shortcuts</span>
                      </div>
                      <div id="retailRegularShortcutItems" class="retail-shortcut-list"></div>
                    </div>
                    <div class="retail-shortcut-group">
                      <div class="retail-shortcuts-head">
                        <span>Dressed Shortcuts</span>
                      </div>
                      <div id="retailDressedShortcutItems" class="retail-shortcut-list"></div>
                    </div>
                  </div>
                </div>

                <div class="retail-combined-workspace">
                  <div id="retailRegularSection" class="retail-billing-section retail-billing-card">
                    <div class="retail-shortcuts-head">
                      <span>Regular Items</span>
                    </div>
                    <div id="retailRegularRows" class="retail-items retail-items-horizontal"></div>
                    <div class="retail-inline-actions">
                      <button type="button" id="retailAddRegularItemButton" onclick="addRegularRetailRow()">Add Regular Item</button>
                    </div>
                  </div>

                  <div id="retailDressedSection" class="retail-billing-section retail-billing-card">
                    <div class="retail-shortcuts-head">
                      <span>Dressed Items</span>
                    </div>
                    <div id="retailDressedRows" class="retail-items retail-items-horizontal"></div>
                    <div class="retail-inline-actions">
                      <button type="button" id="retailAddDressedItemButton" onclick="addDressedRetailRow()">Add Dressed Item</button>
                    </div>
                  </div>
                </div>

                <div class="retail-form-grid retail-notes-grid">
                  <label class="form-field"><span>Paid amount</span><input type="number" id="retailPaidAmount" placeholder="0" min="0" step="0.01"></label>
                  <label class="form-field"><span>Notes</span><textarea id="retailNotes" placeholder="Optional"></textarea></label>
                </div>
                <div class="report-actions retail-actions">
                  <button type="button" onclick="saveRetailBill({ autoStartNext: true })"><i data-lucide="save"></i><span>Save Bill</span></button>
                  <button type="button" onclick="printCurrentRetailBill()"><i data-lucide="printer"></i><span>Print</span></button>
                  <button type="button" onclick="sendCurrentRetailBill()"><i data-lucide="message-circle"></i><span>WhatsApp</span></button>
                </div>
              </div>

              <div id="paymentReceiptSection" class="retail-billing-panel retail-billing-section" style="display:none;">
                <div class="retail-shortcuts-head">
                  <span>Payment Receipt</span>
                </div>

                <div class="retail-form-grid">
                  <label class="form-field"><span>Date</span><input type="date" id="paymentReceiptDate"></label>
                  <label class="form-field"><span>Receipt no.</span><input type="text" id="paymentReceiptNumber" placeholder="Receipt number"></label>
                  <label class="form-field"><span>Handled by</span><input type="text" id="paymentReceiptCashier" value="admin"></label>
                  <label class="form-field"><span>Direction</span><select id="paymentReceiptDirection">
                      <option value="RECEIVED">Amount Received</option>
                      <option value="PAID">Amount Paid</option>
                    </select></label>
                  <label class="form-field"><span>Mode</span><select id="paymentReceiptMode">
                      <option value="Cash">Cash</option>
                      <option value="Online">Online</option>
                      <option value="Bank">Bank</option>
                      <option value="Cheque">Cheque</option>
                    </select></label>
                  <div class="form-field"><span>Party</span><div class="typeahead-field">
                      <input type="text" id="paymentReceiptPartyName" placeholder="Enter party name" autocomplete="off" oninput="suggestPaymentReceiptParties()" onfocus="suggestPaymentReceiptParties()">
                      <div id="paymentReceiptPartySuggestBox" class="typeahead-box"></div>
                    </div>
                  </div>
                  <datalist id="paymentReceiptPartySuggestions"></datalist>
                  <label class="form-field"><span>Phone</span><input type="text" id="paymentReceiptPartyPhone" placeholder="Optional"></label>
                  <label class="form-field"><span>Old balance</span><input type="text" id="paymentReceiptOldBalance" placeholder="₹ 0" readonly></label>
                  <label class="form-field"><span>Amount</span><input type="number" id="paymentReceiptAmount" placeholder="0" min="0" step="0.01"></label>
                </div>

                <div class="retail-form-grid retail-notes-grid">
                  <label class="form-field"><span>Notes</span><textarea id="paymentReceiptNotes" placeholder="Optional"></textarea></label>
                </div>

                <div class="report-actions retail-actions">
                  <button type="button" onclick="savePaymentReceipt({ autoStartNext: true })"><i data-lucide="save"></i><span>Save Receipt</span></button>
                  <button type="button" onclick="printCurrentPaymentReceipt()"><i data-lucide="printer"></i><span>Print</span></button>
                  <button type="button" onclick="sendCurrentPaymentReceipt()"><i data-lucide="message-circle"></i><span>WhatsApp</span></button>
                  <button type="button" class="button-secondary" onclick="resetPaymentReceiptForm()"><i data-lucide="plus"></i><span>New Receipt</span></button>
                </div>
              </div>

              <datalist id="retailItemSuggestions"></datalist>
            </div>

            <div class="section retail-preview-panel">
              <div class="section-head">
              <div>
                <h2 id="retailPreviewTitle">Retail Bill Preview</h2>
              </div>
              </div>
              <div id="retailPreview" class="thermal-preview"></div>
            </div>
          </div>

          <details class="section collapsible-section" id="retailBillHistorySection">
            <summary class="section-summary">Recent Retail Bills</summary>
            <div class="section-head compact-section-head">
              <button type="button" id="retailBillsLoadMore" onclick="loadMoreRetailBills()" style="display:none">Load More</button>
              <button type="button" onclick="loadRetailBills(true)">Refresh</button>
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
          </details>

          <details class="section collapsible-section" id="paymentReceiptHistorySection">
            <summary class="section-summary">Recent Payment Receipts</summary>
            <div class="section-head compact-section-head">
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
          </details>

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

          <div class="section retail-setup-page">
            <div class="section-head">
              <div>
                <h2 id="retailModeTitle">Regular Setup</h2>
              </div>
            </div>

            <div class="retail-shortcuts">
              <div class="retail-shortcuts-head">
                <span>Working Date</span>
              </div>
              <div class="retail-form-grid retail-setup-date-grid">
                <label class="form-field"><span>Date</span><input type="date" id="retailDate"></label>
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
                </div>
                <div class="retail-shortcut-form">
                  <input type="hidden" id="editingShortcutOriginalName">
                  <label class="form-field"><span>Item name</span><input type="text" id="shortcutName" placeholder="Item name"></label>
                  <label class="form-field"><span>Default rate</span><input type="number" id="shortcutRate" placeholder="0" min="0" step="0.01"></label>
                  <label class="form-field"><span>Line type</span><select id="shortcutLineType" >
                      <option value="STANDARD">Regular</option>
                      <option value="DRESSED">Dressed</option>
                    </select></label>
                  <label class="form-field"><span>Stock source</span><select id="shortcutSourceItemType">
                      <option value="">Select source</option>
                      <option value="BB">BB</option>
                      <option value="CB">CB</option>
                      <option value="COCREL">COCREL</option>
                      <option value="LEGOAN">LEGOAN</option>
                      <option value="DP">DP</option>
                    </select></label>
                  <label class="form-field"><span>Unit</span><select id="shortcutUnit">
                      <option value="KGS">KGS</option>
                      <option value="PCS">PCS</option>
                    </select></label>
                  <button type="button" id="saveShortcutButton" onclick="saveRetailShortcut()"><i data-lucide="save"></i><span>Save Shortcut</span></button>
                  <button type="button" id="cancelShortcutEditButton" onclick="cancelRetailShortcutEdit()" style="display:none;">Cancel</button>
                </div>
                <div id="retailShortcutManagerList" class="retail-shortcut-list retail-shortcut-list-managed"></div>
              </div>

              <div class="retail-shortcuts" id="dressedStockSetupSection" >
                <div class="retail-shortcuts-head">
                  <span>Dressed Stock Entry</span>
                </div>
                <div id="dressedStockRows" class="retail-items"></div>
                <div class="retail-item-actions">
                  <button type="button" onclick="addDressedStockRow()">Add Dressed Stock</button>
                  <button type="button" onclick="saveDressedStock()">Save Dressed Stock</button>
                </div>
                <div class="retail-saved-subsection">
                  <div class="retail-shortcuts-head retail-saved-head">
                    <span>Saved Dressed Stock</span>
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
        <div class="container daily-sheet-page">

          <div class="card filter toolbar daily-sheet-toolbar">
            <div class="daily-sheet-filter-group">
              <label class="form-field"><span>Sheet</span><select id="dailySheetType">
                  <option value="stock">Stock Sheet</option>
                  <option value="vendor">Vendor Balance Sheet</option>
                  <option value="dealer">Dealer Balance Sheet</option>
                </select></label>
              <label class="form-field"><span>Date</span><input type="date" id="dailySheetDate"></label>
            </div>
            <div class="daily-sheet-toolbar-actions">
              <button onclick="loadDailySheet()"><i data-lucide="refresh-cw"></i><span>Load Sheet</span></button>
            </div>
          </div>

          <div class="section daily-sheet-card">
            <div class="section-head">
              <div>
                <h2 id="dailySheetTitle">Opening Stock</h2>
              </div>
              <div class="section-head-actions">
                <button onclick="downloadDailySheetExcel()"><i data-lucide="sheet"></i><span>Excel</span></button>
                <button onclick="window.print()"><i data-lucide="printer"></i><span>Print</span></button>
              </div>
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
        <div class="container analytics-page">

          <div class="card filter toolbar analytics-toolbar">
            <div class="analytics-filter-group">
              <label class="form-field"><span>From</span><input type="date" id="startDate"></label>
              <label class="form-field"><span>To</span><input type="date" id="endDate"></label>
            </div>
            <div class="analytics-toolbar-actions">
              <button onclick="loadAnalytics()"><i data-lucide="refresh-cw"></i><span>Refresh</span></button>
            </div>
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
              <span>Gross Profit</span>
              <h2 id="analyticsProfit">N/A</h2>
            </div>
            <div class="metric green">
              <span>Net Cash</span>
              <h2 id="analyticsCash">₹ 0</h2>
            </div>
          </div>

          <div class="chart-grid analytics-chart-grid">
          <div class="card chart-card analytics-chart-card">
            <div class="dashboard-card-head">
              <div>
                <span>Trend</span>
                <h2>Sales vs Purchase Trend</h2>
              </div>
            </div>
            <canvas id="trendChart"></canvas>
          </div>

          <div class="card chart-card analytics-chart-card">
            <div class="dashboard-card-head">
              <div>
                <span>Cash Flow</span>
                <h2>Cash In vs Cash Out</h2>
              </div>
            </div>
            <canvas id="cashFlowChart"></canvas>
          </div>

          <div class="card chart-card analytics-chart-card">
            <div class="dashboard-card-head">
              <div>
                <span>Stock Risk</span>
                <h2>Leakage Trend</h2>
              </div>
            </div>
            <canvas id="leakageChart"></canvas>
          </div>

          <div class="card chart-card analytics-chart-card">
            <div class="dashboard-card-head">
              <div>
                <span>Volume</span>
                <h2>Purchase vs Sales Kg By Hen Type</h2>
              </div>
            </div>
            <canvas id="itemVolumeChart"></canvas>
          </div>

          <div class="card chart-card analytics-chart-card">
            <div class="dashboard-card-head">
              <div>
                <span>Exposure</span>
                <h2>Top Debtors</h2>
              </div>
            </div>
            <canvas id="debtorChart"></canvas>
          </div>

          <div class="card chart-card analytics-chart-card">
            <div class="dashboard-card-head">
              <div>
                <span>Settlement</span>
                <h2>Payment Mode Split</h2>
              </div>
            </div>
            <canvas id="paymentModeChart"></canvas>
          </div>

          <div class="card chart-card analytics-chart-card">
            <div class="dashboard-card-head">
              <div>
                <span>Margin</span>
                <h2>Gross Profit By Hen Type</h2>
              </div>
            </div>
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

          <div class="section">
            <div class="section-head">
              <div>
                <h2>Create a Report</h2>
              </div>
            </div>
            <div class="report-form">
              <label class="form-field"><span>Report</span><select id="reportType" onchange="toggleReportFields()">
                  <option value="ledger">Party Ledger</option>
                  <option value="transactions">All Transactions</option>
                  <option value="summary">Financial Summary</option>
                  <option value="outstanding">Outstanding Balances</option>
                  <option value="inventory">Inventory & Leakage</option>
                </select></label>

              <div class="form-field">
                <span>Party</span>
                <div class="typeahead-field">
                  <input type="text" id="reportParty" placeholder="Enter party name" autocomplete="off" oninput="suggestReportParties()" onfocus="suggestReportParties()" onblur="scheduleSuggestionBoxHide('reportPartySuggestBox')">
                  <div id="reportPartySuggestBox" class="typeahead-box"></div>
                </div>
              </div>
              <datalist id="reportPartySuggestions"></datalist>

              <label class="form-field"><span>From</span><input type="date" id="reportStartDate"></label>
              <label class="form-field"><span>To</span><input type="date" id="reportEndDate"></label>
              <label class="form-field"><span>Date</span><input type="date" id="reportDate"></label>
            </div>

            <div class="report-actions">
              <button onclick="downloadReport('excel')"><i data-lucide="sheet"></i><span>Excel</span></button>
              <button onclick="downloadReport('pdf')"><i data-lucide="file-text"></i><span>PDF</span></button>
              <button type="button" id="shareReportImageButton" onclick="shareReportImage()"><i data-lucide="share-2"></i><span>Share Image</span></button>
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
