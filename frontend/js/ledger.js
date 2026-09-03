let partySuggestTimer = null;

function dedupeLedgerPartyResults(parties) {
  const merged = new Map();
  (parties || []).forEach(party => {
    const key = String(party?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
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

async function searchLedger() {
    const name = document.getElementById("party").value;
    const startDate = document.getElementById("ledgerStartDate")?.value;
    const endDate = document.getElementById("ledgerEndDate")?.value;

    if (!name) {
      showToast("Enter party name");
      return;
    }

    if (startDate && endDate && startDate > endDate) {
      showToast("Start date cannot be after end date");
      return;
    }

    const body = document.getElementById("ledgerBody");
    const total = document.getElementById("totalBalance");
    const receivable = document.getElementById("receivableBalance");
    const payable = document.getElementById("payableBalance");
    const summary = document.getElementById("partySummary");

    // --- Loading state
    setLedgerMode("legacy");
    body.innerHTML = `<tr><td colspan="6" class="empty">Loading...</td></tr>`;
    total.innerText = "₹ 0";
    if (receivable) receivable.innerText = "₹ 0";
    if (payable) payable.innerText = "₹ 0";
    if (summary) summary.innerHTML = "";

    try {
      const params = new URLSearchParams({ name });
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const data = await apiCall(`/party/ledger?${params.toString()}`);

      if (data.error) {
        body.innerHTML = `<tr><td colspan="6" class="empty"></td></tr>`;
        body.querySelector("td").innerText = data.error;
        showToast(data.error);
        return;
      }

      // --- Multiple matches case
      if (data.multiple_matches) {
        const names = data.results.map(p => p.name).join(", ");
        body.innerHTML = `<tr><td colspan="6" class="empty"></td></tr>`;
        body.querySelector("td").innerText = `Multiple matches found:\n${names}`;
        return;
      }

      const accountMode = data.ledger_mode === "account";
      setLedgerMode(data.ledger_mode);

      // --- No data
      if (!data.ledger || data.ledger.length === 0) {
        const partyLabel = data.party_name || name;
        body.innerHTML = `<tr><td colspan="${accountMode ? 9 : 6}" class="empty"></td></tr>`;
        body.querySelector("td").innerText = `${partyLabel} has no transactions in the selected period`;
        total.innerText = formatMoney(data.total_balance || 0);
        if (receivable) receivable.innerText = formatMoney(data.balances?.receivable || 0);
        if (payable) payable.innerText = formatMoney(data.balances?.payable || 0);
        renderPartySummary(data.summary ? { summary: data.summary, ledger_mode: data.ledger_mode } : null);
        return;
      }

      // --- Total balance
      total.innerText = formatMoney(data.total_balance);
      if (receivable) receivable.innerText = formatMoney(data.balances?.receivable || 0);
      if (payable) payable.innerText = formatMoney(data.balances?.payable || 0);
      renderPartySummary(data.summary ? { summary: data.summary, ledger_mode: data.ledger_mode } : null);

      // --- Populate table
      body.innerHTML = "";

      data.ledger.forEach(row => {
        const tr = document.createElement("tr");
        const detailParts = [
          row.category,
          row.item,
          Number(row.quantity || 0) ? `${formatLedgerNumber(row.quantity)} NAG` : "",
          Number(row.weight || 0) ? `${formatLedgerNumber(row.weight)} kg` : "",
          Number(row.rate || 0) ? `${formatMoney(row.rate)}/kg` : "",
          row.payment_mode && row.payment_mode !== "NA" ? row.payment_mode : ""
        ].filter(Boolean);

        appendCell(tr, formatLedgerDate(row.date));
        if (accountMode) {
          appendCell(tr, formatLedgerAccount(row.account));
          appendCell(tr, row.type);
          appendCell(tr, row.bill_number || "-");
          appendCell(tr, detailParts.join(" · ") || "-");
          appendCell(tr, row.debit ? formatMoney(row.debit) : "-", row.debit ? "debit" : "");
          appendCell(tr, row.credit ? formatMoney(row.credit) : "-", row.credit ? "credit" : "");
          appendCell(tr, formatMoney(row.account_balance));
          appendCell(tr, formatMoney(row.net_balance));
        } else {
          appendCell(tr, row.type);
          appendCell(tr, row.bill_number || "-");
          appendCell(tr, detailParts.join(" · ") || "-");
          appendCell(tr, formatMoney(row.amount));
          appendCell(tr, formatMoney(row.balance));
        }

        body.appendChild(tr);
      });

    } catch (e) {
      console.error(e);
      body.innerHTML = `<tr><td colspan="6" class="empty">Error loading data</td></tr>`;
      showToast("Ledger fetch failed");
    }
  }

  function suggestParties() {
    const input = document.getElementById("party");
    const suggestions = document.getElementById("partySuggestions");
    const boxId = "ledgerPartySuggestBox";
    const name = input?.value.trim();

    if (!suggestions) return;

    clearTimeout(partySuggestTimer);

    if (!name || name.length < 2) {
      suggestions.innerHTML = "";
      if (typeof hideSuggestionBox === "function") hideSuggestionBox(boxId);
      return;
    }

    partySuggestTimer = setTimeout(async () => {
      try {
        const data = await apiCall(`/party/search?name=${encodeURIComponent(name)}`);
        suggestions.innerHTML = "";

        const results = dedupeLedgerPartyResults(data.results || []);
        results.forEach(party => {
          const option = document.createElement("option");
          option.value = party.name;
          option.label = party.type ? `${party.name} (${party.type})` : party.name;
          suggestions.appendChild(option);
        });

        if (typeof renderPartySuggestionBox === "function") {
          renderPartySuggestionBox(boxId, results, party => {
            if (input) input.value = party.name;
            if (typeof hideSuggestionBox === "function") hideSuggestionBox(boxId);
            searchLedger();
          });
        }
      } catch (e) {
        console.error(e);
        suggestions.innerHTML = "";
        if (typeof hideSuggestionBox === "function") hideSuggestionBox(boxId);
      }
    }, 250);
  }

  function formatMoney(value) {
    return "₹ " + Number(value || 0).toLocaleString();
  }

  function formatLedgerNumber(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num === 0) return "-";
    return num.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }

  function formatLedgerAccount(value) {
    return String(value || "").toUpperCase() === "PAYABLE" ? "Payable" : "Receivable";
  }

  function setLedgerMode(mode) {
    const accountMode = mode === "account";
    Array.from(document.querySelectorAll?.(".ledger-account-balance") || []).forEach(card => {
      card.hidden = !accountMode;
    });
    const totalLabel = document.querySelector?.("#totalBalance")?.previousElementSibling;
    if (totalLabel) totalLabel.innerText = accountMode ? "Net (Receivable - Payable)" : "Balance";
    const head = document.getElementById("ledgerHead");
    if (!head) return;
    head.innerHTML = accountMode
      ? `<tr><th>Date</th><th>Account</th><th>Transaction</th><th>Ref</th><th>Details</th><th>Debit</th><th>Credit</th><th>Account Balance</th><th>Net</th></tr>`
      : `<tr><th>Date</th><th>Transaction</th><th>Ref</th><th>Details</th><th>Amount</th><th>Balance</th></tr>`;
    document.querySelector?.(".ledger-table")?.classList.toggle("account-ledger", accountMode);
  }

  function formatLedgerDate(value) {
    const parts = String(value || "").split("-");
    if (parts.length !== 3) return value || "";
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function appendCell(row, value, className = "") {
    const cell = document.createElement("td");
    cell.innerText = value ?? "";
    if (className) cell.className = className;
    row.appendChild(cell);
  }

  function renderPartySummary(detail) {
    const summary = document.getElementById("partySummary");
    if (!summary || !detail || detail.error) return;

    const values = detail.ledger_mode === "account" ? [
      ["Opening Receivable", detail.summary.opening_receivable],
      ["Opening Payable", detail.summary.opening_payable],
      ["Sales", detail.summary.total_sales],
      ["Purchases", detail.summary.total_purchase],
      ["Received", detail.summary.total_received],
      ["Paid", detail.summary.total_paid]
    ] : [
      ["Opening Balance", detail.summary.opening_balance],
      ["Sales", detail.summary.total_sales],
      ["Purchases", detail.summary.total_purchase],
      ["Received", detail.summary.total_received],
      ["Paid", detail.summary.total_paid]
    ];

    summary.innerHTML = "";
    values.forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "metric dark";

      const span = document.createElement("span");
      span.innerText = label;
      const h2 = document.createElement("h2");
      h2.innerText = typeof value === "number" ? formatMoney(value) : value;

      card.appendChild(span);
      card.appendChild(h2);
      summary.appendChild(card);
    });
  }
