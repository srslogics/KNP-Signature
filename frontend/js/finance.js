let financeAccounts = [];
let financeTrialRows = [];
let financeProfitRows = [];
let financeCreditProfiles = [];

function financeMoney(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function financeDateLabel(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function financeRangeQuery() {
  const start = document.getElementById("financeStartDate")?.value || "";
  const end = document.getElementById("financeEndDate")?.value || "";
  return `start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
}

function showFinanceTab(name) {
  document.querySelectorAll("[data-finance-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.financeTab === name);
  });
  document.querySelectorAll(".finance-panel").forEach(panel => panel.classList.add("is-hidden"));
  const target = document.getElementById(`financePanel${name.charAt(0).toUpperCase()}${name.slice(1)}`);
  target?.classList.remove("is-hidden");
}

async function initFinanceWorkspace() {
  await loadFinanceAccounts();
  await loadFinanceWorkspace();
}

async function loadFinanceAccounts() {
  try {
    const data = await apiCall("/finance/accounts", "GET", null, {}, { loader: false });
    financeAccounts = data.results || [];
    renderFinanceAccountOptions();
    renderFinanceAccounts();
  } catch (error) {
    showToast(error.message || "Could not load accounts");
  }
}

function renderFinanceAccountOptions() {
  const optionHtml = financeAccounts.map(account => (
    `<option value="${escapeHtml(account.code)}">${escapeHtml(account.code)} - ${escapeHtml(account.name)}</option>`
  )).join("");
  const expenseOptions = financeAccounts
    .filter(account => account.account_type === "EXPENSE" && account.code.startsWith("6"))
    .map(account => `<option value="${escapeHtml(account.code)}">${escapeHtml(account.name)}</option>`)
    .join("");
  const expense = document.getElementById("expenseAccount");
  const debit = document.getElementById("journalDebitAccount");
  const credit = document.getElementById("journalCreditAccount");
  if (expense) expense.innerHTML = expenseOptions;
  if (debit) debit.innerHTML = `<option value="">Debit account</option>${optionHtml}`;
  if (credit) credit.innerHTML = `<option value="">Credit account</option>${optionHtml}`;
}

function renderFinanceAccounts() {
  const body = document.getElementById("financeAccountBody");
  if (!body) return;
  body.innerHTML = financeAccounts.length ? financeAccounts.map(account => `
    <tr>
      <td>${escapeHtml(account.code)}</td>
      <td>${escapeHtml(account.name)}</td>
      <td>${escapeHtml(account.account_type)}</td>
      <td>${account.is_system ? "System" : "Custom"}</td>
    </tr>
  `).join("") : '<tr><td colspan="4" class="empty">No accounts</td></tr>';
}

async function loadFinanceWorkspace() {
  const query = financeRangeQuery();
  try {
    const [trial, profit, journals, credit] = await Promise.all([
      apiCall(`/finance/trial-balance?${query}`, "GET", null, {}, { loader: false }),
      apiCall(`/finance/profit-loss?${query}`, "GET", null, {}, { loader: false }),
      apiCall(`/finance/journals?${query}&limit=250`, "GET", null, {}, { loader: false }),
      apiCall("/finance/credit-profiles?limit=250", "GET", null, {}, { loader: false }),
    ]);
    if (trial.error || profit.error || journals.error || credit.error) {
      return showToast(trial.error || profit.error || journals.error || credit.error);
    }
    financeTrialRows = trial.results || [];
    financeProfitRows = profit.accounts || [];
    renderTrialBalance(trial);
    renderProfitLoss(profit);
    renderFinanceJournals(journals.results || []);
    financeCreditProfiles = credit.results || [];
    renderCreditProfiles(financeCreditProfiles);
    await loadFinanceAccountBook();
  } catch (error) {
    showToast(error.message || "Could not load accounts");
  }
}

async function loadFinanceAccountBook() {
  const body = document.getElementById("financeBookBody");
  if (!body) return;
  const accountCode = document.getElementById("financeBookAccount")?.value || "1000";
  try {
    const data = await apiCall(`/finance/account-book/${encodeURIComponent(accountCode)}?${financeRangeQuery()}`, "GET", null, {}, { loader: false });
    if (data.error) return showToast(data.error);
    document.getElementById("financeBookOpening").textContent = financeMoney(data.opening_balance);
    document.getElementById("financeBookClosing").textContent = financeMoney(data.closing_balance);
    const rows = data.results || [];
    body.innerHTML = rows.length ? rows.map(row => `
      <tr><td>${financeDateLabel(row.date)}</td><td>${escapeHtml(row.entry_number)}</td><td>${escapeHtml(row.entry_type)}</td><td>${escapeHtml(row.narration || "-")}</td><td>${financeMoney(row.debit)}</td><td>${financeMoney(row.credit)}</td><td>${financeMoney(row.balance)}</td></tr>
    `).join("") : '<tr><td colspan="7" class="empty">No movement in this period</td></tr>';
  } catch (error) {
    body.innerHTML = '<tr><td colspan="7" class="empty">Could not load account book</td></tr>';
  }
}

function renderCreditProfiles(rows) {
  const body = document.getElementById("creditProfileBody");
  if (!body) return;
  body.innerHTML = rows.length ? rows.map(row => `
    <tr data-credit-party="${escapeHtml(String(row.party_name || "").toLowerCase())}">
      <td><strong>${escapeHtml(row.party_name)}</strong>${row.phone ? `<br><small>${escapeHtml(row.phone)}</small>` : ""}</td>
      <td>${financeMoney(row.balance)}</td>
      <td><input type="number" id="creditLimit-${row.party_id}" min="0" step="0.01" value="${Number(row.credit_limit || 0)}" aria-label="Credit limit for ${escapeHtml(row.party_name)}"></td>
      <td><input type="number" id="creditDays-${row.party_id}" min="0" step="1" value="${Number(row.credit_days || 0)}" aria-label="Credit days for ${escapeHtml(row.party_name)}"></td>
      <td><input type="checkbox" id="creditBlock-${row.party_id}" ${row.block_on_limit ? "checked" : ""} aria-label="Block credit for ${escapeHtml(row.party_name)}"></td>
      <td><button type="button" class="button-compact" onclick="saveCreditProfile('${row.party_id}')">Save</button></td>
    </tr>
  `).join("") : '<tr><td colspan="6" class="empty">No parties found</td></tr>';
}

function filterCreditProfiles() {
  const term = document.getElementById("creditPartySearch")?.value.trim().toLowerCase() || "";
  const filtered = term
    ? financeCreditProfiles.filter(row => String(row.party_name || "").toLowerCase().includes(term))
    : financeCreditProfiles;
  renderCreditProfiles(filtered);
}

async function saveCreditProfile(partyId) {
  const payload = {
    credit_limit: document.getElementById(`creditLimit-${partyId}`)?.value || 0,
    credit_days: document.getElementById(`creditDays-${partyId}`)?.value || 0,
    block_on_limit: !!document.getElementById(`creditBlock-${partyId}`)?.checked,
  };
  try {
    const data = await apiCall(`/finance/credit-profiles/${encodeURIComponent(partyId)}`, "PUT", JSON.stringify(payload), { "Content-Type": "application/json" });
    if (data.error) return showToast(data.error);
    showToast("Credit settings saved");
  } catch (error) {
    showToast(error.message || "Could not save credit settings");
  }
}

function renderTrialBalance(data) {
  const body = document.getElementById("trialBalanceBody");
  if (!body) return;
  body.innerHTML = financeTrialRows.length ? financeTrialRows.map(row => `
    <tr>
      <td>${escapeHtml(row.code)}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.account_type)}</td>
      <td>${financeMoney(row.debit)}</td>
      <td>${financeMoney(row.credit)}</td>
      <td>${financeMoney(row.balance)}</td>
    </tr>
  `).join("") : '<tr><td colspan="6" class="empty">No journal activity in this period</td></tr>';
  document.getElementById("trialDebitTotal").textContent = financeMoney(data.total_debit);
  document.getElementById("trialCreditTotal").textContent = financeMoney(data.total_credit);
  const funds = financeTrialRows
    .filter(row => ["1000", "1010"].includes(row.code))
    .reduce((sum, row) => sum + Number(row.balance || 0), 0);
  document.getElementById("financeFunds").textContent = financeMoney(funds);
}

function renderProfitLoss(data) {
  document.getElementById("financeIncome").textContent = financeMoney(data.income);
  document.getElementById("financeExpenses").textContent = financeMoney(data.expenses);
  document.getElementById("financeNetProfit").textContent = financeMoney(data.net_profit);
  const body = document.getElementById("profitLossBody");
  if (!body) return;
  const rows = financeProfitRows.filter(row => ["INCOME", "EXPENSE"].includes(row.account_type));
  body.innerHTML = rows.length ? rows.map(row => `
    <tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.account_type === "INCOME" ? "Income" : "Expense")}</td><td>${financeMoney(row.balance)}</td></tr>
  `).join("") + `
    <tr class="finance-total-row"><th>Net Profit</th><th></th><th>${financeMoney(data.net_profit)}</th></tr>
  ` : '<tr><td colspan="3" class="empty">No income or expense entries in this period</td></tr>';
}

function renderFinanceJournals(rows) {
  const body = document.getElementById("financeJournalBody");
  if (!body) return;
  body.innerHTML = rows.length ? rows.map(entry => {
    const details = (entry.lines || []).map(line => {
      const side = Number(line.debit || 0) > 0 ? `Dr ${financeMoney(line.debit)}` : `Cr ${financeMoney(line.credit)}`;
      return `${escapeHtml(line.account_name)}: ${side}`;
    }).join("<br>");
    const canVoid = entry.status === "POSTED" && !["RETAIL_BILL", "PAYMENT_RECEIPT", "JOURNAL_REVERSAL"].includes(entry.reference_type);
    return `
      <tr>
        <td>${financeDateLabel(entry.date)}</td>
        <td>${escapeHtml(entry.entry_number)}</td>
        <td>${escapeHtml(entry.entry_type)}</td>
        <td><strong>${escapeHtml(entry.narration || "-")}</strong><br>${details}</td>
        <td><span class="status-pill ${entry.status === "POSTED" ? "status-success" : "status-danger"}">${escapeHtml(entry.status)}</span></td>
        <td>${canVoid ? `<button type="button" class="button-danger button-compact" onclick="voidFinanceJournal('${entry.id}')">Cancel</button>` : ""}</td>
      </tr>`;
  }).join("") : '<tr><td colspan="6" class="empty">No journal entries in this period</td></tr>';
}

async function saveExpenseEntry() {
  const payload = {
    date: document.getElementById("expenseDate")?.value,
    account_code: document.getElementById("expenseAccount")?.value,
    category: document.getElementById("expenseAccount")?.selectedOptions[0]?.textContent || "Expense",
    amount: document.getElementById("expenseAmount")?.value,
    payment_mode: document.getElementById("expensePaymentMode")?.value,
    notes: document.getElementById("expenseNotes")?.value.trim(),
  };
  if (!payload.date || Number(payload.amount || 0) <= 0) return showToast("Enter date and expense amount");
  try {
    const data = await apiCall("/finance/expenses", "POST", JSON.stringify(payload), { "Content-Type": "application/json" });
    if (data.error) return showToast(data.error);
    document.getElementById("expenseAmount").value = "";
    document.getElementById("expenseNotes").value = "";
    showToast(`Expense saved: ${data.entry_number}`);
    await loadFinanceWorkspace();
  } catch (error) {
    showToast(error.message || "Could not save expense");
  }
}

async function saveManualJournal() {
  const date = document.getElementById("journalDate")?.value;
  const debit = document.getElementById("journalDebitAccount")?.value;
  const credit = document.getElementById("journalCreditAccount")?.value;
  const amount = Number(document.getElementById("journalAmount")?.value || 0);
  const narration = document.getElementById("journalNarration")?.value.trim();
  if (!date || !debit || !credit || debit === credit || amount <= 0 || !narration) {
    return showToast("Enter date, two different accounts, amount, and narration");
  }
  const payload = {
    date,
    entry_type: "GENERAL",
    narration,
    lines: [
      { account_code: debit, debit: amount, credit: 0, description: narration },
      { account_code: credit, debit: 0, credit: amount, description: narration },
    ],
  };
  try {
    const data = await apiCall("/finance/journals", "POST", JSON.stringify(payload), { "Content-Type": "application/json" });
    if (data.error) return showToast(data.error);
    document.getElementById("journalAmount").value = "";
    document.getElementById("journalNarration").value = "";
    showToast(`Journal posted: ${data.entry_number}`);
    await loadFinanceWorkspace();
  } catch (error) {
    showToast(error.message || "Could not post journal");
  }
}

async function saveFinanceAccount() {
  const payload = {
    code: document.getElementById("accountCode")?.value.trim(),
    name: document.getElementById("accountName")?.value.trim(),
    account_type: document.getElementById("accountType")?.value,
  };
  if (!payload.code || !payload.name) return showToast("Enter account code and name");
  try {
    const data = await apiCall("/finance/accounts", "POST", JSON.stringify(payload), { "Content-Type": "application/json" });
    if (data.error) return showToast(data.error);
    document.getElementById("accountCode").value = "";
    document.getElementById("accountName").value = "";
    showToast("Account added");
    await loadFinanceAccounts();
  } catch (error) {
    showToast(error.message || "Could not add account");
  }
}

async function voidFinanceJournal(id) {
  const reason = window.prompt("Reason for cancelling this journal:");
  if (!reason?.trim()) return;
  try {
    const data = await apiCall(`/finance/journals/${encodeURIComponent(id)}/void`, "POST", JSON.stringify({ reason: reason.trim() }), { "Content-Type": "application/json" });
    if (data.error) return showToast(data.error);
    showToast("Journal cancelled with a reversing entry");
    await loadFinanceWorkspace();
  } catch (error) {
    showToast(error.message || "Could not cancel journal");
  }
}

async function syncExistingBooks() {
  const startDate = document.getElementById("financeStartDate")?.value || null;
  const endDate = document.getElementById("financeEndDate")?.value || null;
  if (!window.confirm("Sync existing bills, purchases, payments, and opening balances into the accounting books?")) return;
  showLoading("Syncing accounting books...");
  try {
    let remaining = 1;
    let totalPosted = 0;
    let rounds = 0;
    while (remaining > 0 && rounds < 40) {
      const response = await fetch(`${BASE_URL}/finance/sync-books`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": getAuthToken(),
          "X-Outlet-Id": getSelectedOutletId(),
        },
        body: JSON.stringify({ start_date: startDate, end_date: endDate, batch_size: 250 }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || data.detail || "Accounting sync failed");
      totalPosted += Number(data.posted || 0);
      remaining = Number(data.remaining || 0);
      rounds += 1;
    }
    showToast(`${totalPosted.toLocaleString("en-IN")} records added to the accounting books`);
    await loadFinanceWorkspace();
  } catch (error) {
    showToast(error.message || "Accounting sync failed");
  } finally {
    hideLoading();
  }
}

async function downloadFinanceTable(reportType) {
  const query = financeRangeQuery();
  showLoading("Preparing Excel file...");
  try {
    const headers = { "X-Auth-Token": getAuthToken(), "X-Outlet-Id": getSelectedOutletId() };
    const response = await fetch(`${BASE_URL}/finance/export?report_type=${encodeURIComponent(reportType)}&${query}`, { headers });
    if (!response.ok) throw new Error("Could not prepare Excel file");
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const name = match?.[1] || `${reportType}.xlsx`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    showToast(error.message || "Could not download Excel file");
  } finally {
    hideLoading();
  }
}

async function downloadTallyXml() {
  const query = financeRangeQuery();
  showLoading("Preparing Tally file...");
  try {
    const response = await fetch(`${BASE_URL}/integrations/tally/export?${query}`, {
      headers: { "X-Auth-Token": getAuthToken(), "X-Outlet-Id": getSelectedOutletId() },
    });
    if (!response.ok) throw new Error("Could not prepare Tally file");
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = match?.[1] || "tally-vouchers.xml";
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    showToast(error.message || "Could not download Tally file");
  } finally {
    hideLoading();
  }
}
