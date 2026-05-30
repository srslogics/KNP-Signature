let lastDailySheetExport = null;

async function loadDailySheet() {
  const date = document.getElementById("dailySheetDate")?.value;
  const sheetType = document.getElementById("dailySheetType")?.value || "stock";
  const title = document.getElementById("dailySheetTitle");
  const meta = document.getElementById("dailySheetMeta");
  const content = document.getElementById("dailySheetContent");

  if (!date || !title || !meta || !content) return;

  title.innerText = `${formatSheetType(sheetType)} ${formatDisplayDate(date)}`;
  meta.className = "notice info";
  meta.innerHTML = "<strong>Loading daily sheet...</strong>";
  content.innerHTML = "";
  lastDailySheetExport = null;

  try {
    const data = await apiCall(`/daily-sheet?date=${encodeURIComponent(date)}&sheet_type=${encodeURIComponent(sheetType)}`);

    if (data.error) {
      meta.className = "notice error";
      meta.innerHTML = `<strong>${data.error}</strong>`;
      return;
    }

    lastDailySheetExport = {
      date,
      sheetType,
      title: data.title || formatSheetType(sheetType),
      data
    };

    content.innerHTML = "";

    if (sheetType === "stock") {
      meta.className = "notice info";
      meta.innerHTML = `<strong>${data.meta?.nag_available ? "NAG values are available for this sheet." : "Some older records were saved without NAG, so blank NAG cells mean count was not captured on that day."}</strong><br>Retail bills created from Retail Billing are included automatically under Retail and Retail Dressed. Retail credit customers are shown separately below the stock summary.`;

      if (data.stock_warning) {
        const warning = document.createElement("div");
        warning.className = "notice error";
        warning.innerHTML = `<strong>${data.stock_warning}</strong>`;
        content.appendChild(warning);
      }

      if (data.metric_cards?.length) {
        content.appendChild(createMetricCardStrip(data.metric_cards));
      }

      content.appendChild(createSheetSection(`Opening Stock ${formatDisplayDate(date)}`, data.opening_stock));
      content.appendChild(createSheetSection("Purchase Stock", data.purchase_stock));
      if (data.transport_mortality_stock?.rows?.length) {
        content.appendChild(createSheetSection("Transportation Mortality", data.transport_mortality_stock));
      }
      if (data.shop_mortality_stock?.rows?.length) {
        content.appendChild(createSheetSection("Shop Mortality", data.shop_mortality_stock));
      }

      (data.sales_sections || []).forEach(section => {
        content.appendChild(createSheetSection(section.title, section));
      });

      if (data.special_sections?.dressed_cutting_summary && Number(data.special_sections.dressed_cutting_summary.live_weight_cut || 0) > 0) {
        content.appendChild(createDressedCuttingSummarySection(data.special_sections.dressed_cutting_summary));
      }

      if (data.retail_credit_sheet?.rows?.length) {
        content.appendChild(createRetailCreditSection("Retail Credit Customers", data.retail_credit_sheet.rows, data.retail_credit_sheet.total));
      }

      content.appendChild(createFinalSummarySection(data.final_stock));

      if (data.rate_analysis) {
        const sections = [
          createRateAnalysisSection("Avg Buy Rate by Hen Type", data.rate_analysis.purchase_by_hen_type || [], false),
          createRateAnalysisSection("Avg Sale Rate by Category", data.rate_analysis.sales_by_category || [], false),
          createRateAnalysisSection("Avg Sale Rate by Hen Type in Each Category", data.rate_analysis.sales_by_hen_type_category || [], true)
        ].filter(Boolean);
        sections.forEach(section => content.appendChild(section));
      }

      if (data.business_controls) {
        const controls = [
          createCategoryMixSection("Category Mix", data.business_controls.category_mix || []),
          createItemPerformanceSection("Hen Type Performance", data.business_controls.item_performance || [])
        ].filter(Boolean);
        controls.forEach(section => content.appendChild(section));
      }
      return;
    }

    meta.className = "notice info";
    meta.innerHTML = "<strong>Old balance is the balance up to the previous day. Purchases and payment are for the selected day.</strong>";
    content.appendChild(createBalanceSheetSection(data.title || formatSheetType(sheetType), data.rows || [], data.totals));
  } catch (e) {
    console.error(e);
    meta.className = "notice error";
    meta.innerHTML = "<strong>Daily sheet failed to load.</strong>";
  }
}

function downloadDailySheetExcel() {
  const date = document.getElementById("dailySheetDate")?.value;
  const sheetType = document.getElementById("dailySheetType")?.value || "stock";

  if (!date) {
    showToast("Load the sheet first");
    return;
  }

  try {
    downloadDailySheetExcelFile(date, sheetType);
  } catch (error) {
    console.error(error);
    showToast("Excel download failed");
  }
}

async function downloadDailySheetExcelFile(date, sheetType) {
  const params = new URLSearchParams({
    date,
    sheet_type: sheetType
  });

  const headers = {};
  const authToken = typeof getAuthToken === "function" ? getAuthToken() : "";
  if (authToken) headers["X-Auth-Token"] = authToken;

  const selectedOutletId = typeof getSelectedOutletId === "function" ? getSelectedOutletId() : "";
  if (selectedOutletId) headers["X-Outlet-Id"] = selectedOutletId;

  const response = await withLoading("Preparing Excel...", () => (
    fetchWithRetry(`${BASE_URL}/daily-sheet/export?${params.toString()}`, { headers })
  ));

  if (response.status === 401) {
    if (typeof clearAuthState === "function") {
      clearAuthState();
    }
    throw new Error("AUTH_REQUIRED");
  }

  if (!response.ok) {
    throw new Error(`Daily sheet export failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json();
    showToast(data.error || "Excel could not be downloaded");
    return;
  }

  const blob = await response.blob();
  const title = lastDailySheetExport?.title || formatSheetType(sheetType);
  const safeTitle = String(title || "daily-sheet")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeTitle || "daily-sheet"}-${date}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Excel downloaded");
}

function createSheetSection(title, section) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = title;
  wrapper.appendChild(heading);

  wrapper.appendChild(createSheetTable(section.rows || [], section.total));
  return wrapper;
}

function createSheetTable(rows, totalRow) {
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-card daily-sheet-table";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Goods</th>
        <th>Nag</th>
        <th>Weight</th>
        <th>Rate</th>
        <th>Total</th>
      </tr>
    </thead>
  `;

  const body = document.createElement("tbody");
  (rows || []).forEach(row => body.appendChild(createSheetRow(row)));
  if (totalRow) body.appendChild(createSheetRow(totalRow, true));
  table.appendChild(body);
  tableWrap.appendChild(table);
  return tableWrap;
}

function createSheetRow(row, isTotal = false) {
  const tr = document.createElement("tr");
  if (isTotal) tr.className = "sheet-total-row";

  appendDailyCell(tr, row.goods || "");
  appendDailyCell(tr, row.nag === "" ? "-" : row.nag);
  appendDailyCell(tr, formatNumber(row.weight));
  appendDailyCell(tr, formatNumber(row.rate));
  appendDailyCell(tr, formatMoneyCompact(row.total));
  return tr;
}

function createFinalSummarySection(summary) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = "Final Stock";
  wrapper.appendChild(heading);

  const rows = [
    summary.total_purchases,
    summary.transport_mortality,
    summary.shop_mortality,
    summary.sales,
    summary.closing_stock,
    summary.actual_stock,
    summary.short_by
  ];
  wrapper.appendChild(createSheetTable(rows, null));

  const profitCard = document.createElement("div");
  profitCard.className = "dashboard-kpi-card sheet-profit-box tone-green";
  profitCard.innerHTML = `
    <span>Gross Profit</span>
    <h2>${formatNumber(summary.gross_profit?.rate)}%</h2>
    <p>${formatMoneyCompact(summary.gross_profit?.total)}</p>
  `;
  wrapper.appendChild(profitCard);

  return wrapper;
}

function createDressedCuttingSummarySection(summary) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = "Dressed Cutting Summary";
  wrapper.appendChild(heading);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-card daily-sheet-table";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Live Weight Cut</th>
        <th>Dressed Weight Prepared</th>
        <th>Dressed Weight Sold</th>
        <th>Dressed Sales</th>
        <th>Avg on Live Kg</th>
        <th>Yield %</th>
      </tr>
    </thead>
    <tbody>
      <tr class="sheet-total-row">
        <td>${formatNumber(summary.live_weight_cut)} kg</td>
        <td>${formatNumber(summary.dressed_weight_prepared)} kg</td>
        <td>${formatNumber(summary.dressed_weight_sold)} kg</td>
        <td>${formatMoneyCompact(summary.dressed_sales_amount)}</td>
        <td>${formatMetricDisplay(summary.avg_amount_per_live_kg, "", true)}</td>
        <td>${formatMetricDisplay(summary.yield_percent, "%")}</td>
      </tr>
    </tbody>
  `;

  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);

  const note = document.createElement("div");
  note.className = "notice info";
  note.innerHTML = "<strong>Dressed Avg</strong> = total dressed sales amount for the day / total live kg cut for the day.";
  wrapper.appendChild(note);

  if (summary.warning) {
    const warning = document.createElement("div");
    warning.className = "notice error";
    warning.innerHTML = `<strong>${summary.warning}</strong>`;
    wrapper.appendChild(warning);
  }

  return wrapper;
}

function createMetricCardStrip(cards) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-metric-strip";

  cards.forEach(card => {
    const metric = document.createElement("div");
    metric.className = `dashboard-kpi-card daily-metric-card ${getDailyMetricTone(card.label)}`;
    const prefix = card.prefix || "";
    const suffix = card.suffix || "";
    const displayValue = card.display_value ?? `${prefix}${formatNumber(card.value)}${suffix}`;
    metric.innerHTML = `
      <span>${card.label || ""}</span>
      <h2>${displayValue}</h2>
      ${card.subvalue ? `<p>${card.subvalue}</p>` : ""}
    `;
    wrapper.appendChild(metric);
  });

  return wrapper;
}

function getDailyMetricTone(label) {
  const value = String(label || "").toLowerCase();

  if (value.includes("profit") || value.includes("closing") || value.includes("payments in") || value.includes("received")) {
    return "tone-green";
  }

  if (value.includes("mortality") || value.includes("short") || value.includes("leakage") || value.includes("payment") || value.includes("paid")) {
    return "tone-red";
  }

  if (value.includes("old balance") || value.includes("outstanding") || value.includes("buy") || value.includes("purchase") || value.includes("cost")) {
    return "tone-slate";
  }

  return "tone-blue";
}

function createBalanceSheetSection(title, rows, totals) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = title;
  wrapper.appendChild(heading);

  const metrics = buildBalanceMetrics(rows || [], totals);
  wrapper.appendChild(createMetricCardStrip(metrics.cards));

  const help = document.createElement("div");
  help.className = "notice info balance-help";
  help.innerHTML = `
    <strong>How to read this sheet</strong>
    <ul>
      <li><strong>Old Bal</strong>: balance up to the previous day.</li>
      <li><strong>Purchases</strong>: today's sale or purchase amount for the selected party.</li>
      <li><strong>Payment</strong>: money received or paid today.</li>
      <li><strong>Balance</strong>: old balance + today's business - today's payment.</li>
      <li><strong>All Parties</strong>: shows every party in the sheet.</li>
      <li><strong>Active Today</strong>: parties with some movement today, either business or payment.</li>
      <li><strong>Unpaid Today</strong>: parties with today's business but no payment today.</li>
      <li><strong>High Balance</strong>: parties with larger outstanding balance.</li>
      <li><strong>Search</strong>: type any party name to narrow the list.</li>
      <li><strong>Row colors</strong>: pale yellow means unpaid today, pale blue means high balance, green text means advance or credit in your favor.</li>
    </ul>
  `;
  wrapper.appendChild(help);

  const controls = document.createElement("div");
  controls.className = "balance-filter-bar";
  controls.innerHTML = `
    <input type="text" class="balance-search" placeholder="Search party name">
    <div class="balance-chip-group">
      <button type="button" class="balance-filter-chip active" data-filter="all">All Parties</button>
      <button type="button" class="balance-filter-chip" data-filter="active">Active Today</button>
      <button type="button" class="balance-filter-chip" data-filter="unpaid">Unpaid Today</button>
      <button type="button" class="balance-filter-chip" data-filter="high">High Balance</button>
    </div>
  `;
  wrapper.appendChild(controls);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-card daily-sheet-table";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Party Name</th>
        <th>Old Bal</th>
        <th>Purchases</th>
        <th>Payment</th>
        <th>Balance</th>
      </tr>
    </thead>
  `;

  const body = document.createElement("tbody");
  table.appendChild(body);
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);

  let currentFilter = "all";
  let currentQuery = "";

  function renderBalanceRows() {
    body.innerHTML = "";
    const filteredRows = filterBalanceRows(rows || [], currentFilter, currentQuery, metrics.highBalanceThreshold);
    filteredRows.forEach(row => body.appendChild(createBalanceRow(row, false, metrics.highBalanceThreshold)));
    if (totals) {
      const summaryRow = currentFilter === "all" && !currentQuery.trim()
        ? totals
        : buildFilteredBalanceTotals(filteredRows);
      body.appendChild(createBalanceRow(summaryRow, true));
    }
  }

  controls.querySelectorAll(".balance-filter-chip").forEach(button => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter || "all";
      controls.querySelectorAll(".balance-filter-chip").forEach(chip => chip.classList.remove("active"));
      button.classList.add("active");
      renderBalanceRows();
    });
  });

  controls.querySelector(".balance-search")?.addEventListener("input", (event) => {
    currentQuery = event.target.value || "";
    renderBalanceRows();
  });

  renderBalanceRows();
  return wrapper;
}

function createBalanceRow(row, isTotal = false, highBalanceThreshold = 50000) {
  const tr = document.createElement("tr");
  if (isTotal) {
    tr.className = "sheet-total-row";
  } else {
    const balance = Number(row.balance || 0);
    const purchases = Number(row.purchases || 0);
    const payment = Number(row.payment || 0);
    if (purchases > 0 || payment > 0) tr.classList.add("balance-row-active");
    if (purchases > 0 && payment === 0) tr.classList.add("balance-row-unpaid");
    if (balance < 0) tr.classList.add("balance-row-advance");
    if (balance >= highBalanceThreshold) tr.classList.add("balance-row-high");
  }

  appendDailyCell(tr, row.party_name || "");
  appendDailyCell(tr, formatMoneyCompact(row.old_balance));
  appendDailyCell(tr, formatMoneyCompact(row.purchases));
  appendDailyCell(tr, formatMoneyCompact(row.payment));
  appendDailyCell(tr, formatMoneyCompact(row.balance));
  return tr;
}

function buildBalanceMetrics(rows, totals) {
  const activeRows = rows.filter(row => Number(row.purchases || 0) > 0 || Number(row.payment || 0) > 0);
  const unpaidRows = rows.filter(row => Number(row.purchases || 0) > 0 && Number(row.payment || 0) === 0);
  const highBalanceThreshold = getHighBalanceThreshold(rows);
  const highBalanceRows = rows.filter(row => Number(row.balance || 0) >= highBalanceThreshold);

  return {
    highBalanceThreshold,
    cards: [
    {
      label: "Old Balance",
      value: Number(totals?.old_balance || 0),
      prefix: "Rs ",
      subvalue: "Previous day balance"
    },
    {
      label: "Today Business",
      value: Number(totals?.purchases || 0),
      prefix: "Rs ",
      subvalue: "Today's sale or purchase"
    },
    {
      label: "Today Payment",
      value: Number(totals?.payment || 0),
      prefix: "Rs ",
      subvalue: "Cash received or paid today"
    },
    {
      label: "Closing Balance",
      value: Number(totals?.balance || 0),
      prefix: "Rs ",
      subvalue: "Balance after today's entries"
    },
    {
      label: "Active Parties",
      value: activeRows.length,
      subvalue: "Had business or payment today"
    },
    {
      label: "Unpaid Today",
      value: unpaidRows.length,
      subvalue: "Business today, payment not received"
    },
    {
      label: "High Balance",
      value: highBalanceRows.length,
      subvalue: `Rs ${formatMoneyCompact(highBalanceThreshold)}+`
    }
    ]
  };
}

function getHighBalanceThreshold(rows) {
  const balances = rows
    .map(row => Number(row.balance || 0))
    .filter(value => value > 0)
    .sort((a, b) => b - a);

  if (!balances.length) return 50000;
  return Math.max(50000, balances[Math.min(4, balances.length - 1)]);
}

function filterBalanceRows(rows, filter, query, highBalanceThreshold) {
  const normalizedQuery = (query || "").trim().toLowerCase();

  return rows.filter(row => {
    const partyName = String(row.party_name || "").toLowerCase();
    const purchases = Number(row.purchases || 0);
    const payment = Number(row.payment || 0);
    const balance = Number(row.balance || 0);

    if (normalizedQuery && !partyName.includes(normalizedQuery)) return false;
    if (filter === "active") return purchases > 0 || payment > 0;
    if (filter === "unpaid") return purchases > 0 && payment === 0;
    if (filter === "high") return balance >= highBalanceThreshold;
    return true;
  });
}

function buildFilteredBalanceTotals(rows) {
  const summed = rows.reduce((acc, row) => {
    acc.old_balance += Number(row.old_balance || 0);
    acc.purchases += Number(row.purchases || 0);
    acc.payment += Number(row.payment || 0);
    acc.balance += Number(row.balance || 0);
    return acc;
  }, { old_balance: 0, purchases: 0, payment: 0, balance: 0 });

  return {
    party_name: "FILTERED TOTAL",
    ...summed
  };
}

function createRetailCreditSection(title, rows, totals) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = title;
  wrapper.appendChild(heading);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-card daily-sheet-table";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Customer</th>
        <th>Bill No</th>
        <th>Total</th>
        <th>Paid</th>
        <th>Outstanding</th>
        <th>Mode</th>
      </tr>
    </thead>
  `;

  const body = document.createElement("tbody");
  (rows || []).forEach(row => body.appendChild(createRetailCreditRow(row)));
  if (totals) body.appendChild(createRetailCreditRow(totals, true));
  table.appendChild(body);
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);
  return wrapper;
}

function createRateAnalysisSection(title, rows, showCategoryAndGoods = false) {
  if (!rows.length) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = title;
  wrapper.appendChild(heading);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-card daily-sheet-table";

  const table = document.createElement("table");
  table.innerHTML = showCategoryAndGoods
    ? `
      <thead>
        <tr>
          <th>Category</th>
          <th>Hen Type</th>
          <th>Avg Rate</th>
          <th>Kgs</th>
          <th>Amount</th>
        </tr>
      </thead>
    `
    : `
      <thead>
        <tr>
          <th>Label</th>
          <th>Avg Rate</th>
          <th>Kgs</th>
          <th>Amount</th>
        </tr>
      </thead>
    `;

  const body = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    if (showCategoryAndGoods) {
      appendDailyCell(tr, row.category || "", "analysis-text");
      appendDailyCell(tr, row.goods || "", "analysis-text");
    } else {
      appendDailyCell(tr, row.label || "", "analysis-text");
    }
    appendDailyCell(tr, formatNumber(row.avg_rate));
    appendDailyCell(tr, formatNumber(row.weight));
    appendDailyCell(tr, formatMoneyCompact(row.amount));
    body.appendChild(tr);
  });

  table.appendChild(body);
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);
  return wrapper;
}

function createCategoryMixSection(title, rows) {
  if (!rows.length) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = title;
  wrapper.appendChild(heading);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-card daily-sheet-table";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Category</th>
        <th>Kgs</th>
        <th>Amount</th>
        <th>Avg Rate</th>
        <th>Kg Share</th>
        <th>Sale Share</th>
      </tr>
    </thead>
  `;

  const body = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    appendDailyCell(tr, row.category || "", "analysis-text");
    appendDailyCell(tr, formatNumber(row.weight));
    appendDailyCell(tr, formatMoneyCompact(row.amount));
    appendDailyCell(tr, formatNumber(row.avg_rate));
    appendDailyCell(tr, `${formatNumber(row.weight_share)}%`);
    appendDailyCell(tr, `${formatNumber(row.amount_share)}%`);
    body.appendChild(tr);
  });

  table.appendChild(body);
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);
  return wrapper;
}

function createItemPerformanceSection(title, rows) {
  if (!rows.length) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "daily-sheet-section";

  const heading = document.createElement("h3");
  heading.innerText = title;
  wrapper.appendChild(heading);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-card daily-sheet-table";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Hen Type</th>
        <th>Buy Kg</th>
        <th>Sale Kg</th>
        <th>Buy Rate</th>
        <th>Sale Rate</th>
        <th>Spread</th>
        <th>Est. Profit</th>
      </tr>
    </thead>
  `;

  const body = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    appendDailyCell(tr, row.item || "", "analysis-text");
    appendDailyCell(tr, formatNumber(row.purchase_kg));
    appendDailyCell(tr, formatNumber(row.sales_kg));
    appendDailyCell(tr, formatNumber(row.buy_rate));
    appendDailyCell(tr, formatNumber(row.sell_rate));
    appendDailyCell(tr, formatNumber(row.spread));
    appendDailyCell(tr, formatMoneyCompact(row.gross_profit));
    body.appendChild(tr);
  });

  table.appendChild(body);
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);
  return wrapper;
}

function createRetailCreditRow(row, isTotal = false) {
  const tr = document.createElement("tr");
  if (isTotal) tr.className = "sheet-total-row";

  appendDailyCell(tr, row.customer_name || row.label || "");
  appendDailyCell(tr, row.bill_number || "-");
  appendDailyCell(tr, formatMoneyCompact(row.total_amount));
  appendDailyCell(tr, formatMoneyCompact(row.paid_amount));
  appendDailyCell(tr, formatMoneyCompact(row.outstanding_amount));
  appendDailyCell(tr, row.payment_mode || (isTotal ? "-" : "Credit"));
  return tr;
}

function appendDailyCell(row, value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.innerText = value ?? "";
  row.appendChild(cell);
}

function formatDisplayDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("en-GB");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatMetricDisplay(value, suffix = "", money = false) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return `${money ? formatMoneyCompact(value) : formatNumber(value)}${suffix}`;
}

function formatMoneyCompact(value) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSheetType(sheetType) {
  if (sheetType === "vendor") return "Vendor Balance Sheet";
  if (sheetType === "dealer") return "Dealer Balance Sheet";
  return "Daily Sheet";
}
