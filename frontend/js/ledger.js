let partySuggestTimer = null;

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
    const summary = document.getElementById("partySummary");

    // --- Loading state
    body.innerHTML = `<tr><td colspan="11" class="empty">Loading...</td></tr>`;
    total.innerText = "₹ 0";
    if (summary) summary.innerHTML = "";

    try {
      const params = new URLSearchParams({ name });
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const data = await apiCall(`/party/ledger?${params.toString()}`);

      if (data.error) {
        body.innerHTML = `<tr><td colspan="11" class="empty"></td></tr>`;
        body.querySelector("td").innerText = data.error;
        showToast(data.error);
        return;
      }

      // --- Multiple matches case
      if (data.multiple_matches) {
        const names = data.results.map(p => p.name).join(", ");
        body.innerHTML = `<tr><td colspan="11" class="empty"></td></tr>`;
        body.querySelector("td").innerText = `Multiple matches found:\n${names}`;
        return;
      }

      // --- No data
      if (!data.ledger || data.ledger.length === 0) {
        const partyLabel = data.party_name || name;
        body.innerHTML = `<tr><td colspan="11" class="empty">${partyLabel} found, but opening balance is 0 and no transactions are recorded yet</td></tr>`;
        total.innerText = formatMoney(data.total_balance || 0);
        renderPartySummary(data.summary ? { summary: data.summary } : null);
        return;
      }

      // --- Total balance
      total.innerText = formatMoney(data.total_balance);
      renderPartySummary(data.summary ? { summary: data.summary } : null);

      // --- Populate table
      body.innerHTML = "";

      data.ledger.forEach(row => {
        const tr = document.createElement("tr");

        const typeClass = Number(row.delta || 0) < 0 ? "credit" : "debit";

        appendCell(tr, row.date);
        appendCell(tr, row.type);
        appendCell(tr, row.bill_number || "-");
        appendCell(tr, row.category || "-");
        appendCell(tr, row.item || "-");
        appendCell(tr, formatLedgerNumber(row.quantity));
        appendCell(tr, formatLedgerNumber(row.weight));
        appendCell(tr, formatLedgerNumber(row.rate));
        appendCell(tr, row.payment_mode || "NA");
        appendCell(tr, formatMoney(row.amount), typeClass);
        appendCell(tr, formatMoney(row.balance));

        body.appendChild(tr);
      });

    } catch (e) {
      console.error(e);
      body.innerHTML = `<tr><td colspan="11" class="empty">Error loading data</td></tr>`;
      showToast("Ledger fetch failed");
    }
  }

  function suggestParties() {
    const input = document.getElementById("party");
    const suggestions = document.getElementById("partySuggestions");
    const name = input?.value.trim();

    if (!suggestions) return;

    clearTimeout(partySuggestTimer);

    if (!name || name.length < 2) {
      suggestions.innerHTML = "";
      return;
    }

    partySuggestTimer = setTimeout(async () => {
      try {
        const data = await apiCall(`/party/search?name=${encodeURIComponent(name)}`);
        suggestions.innerHTML = "";

        (data.results || []).forEach(party => {
          const option = document.createElement("option");
          option.value = party.name;
          option.label = party.type ? `${party.name} (${party.type})` : party.name;
          suggestions.appendChild(option);
        });
      } catch (e) {
        console.error(e);
        suggestions.innerHTML = "";
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

  function appendCell(row, value, className = "") {
    const cell = document.createElement("td");
    cell.innerText = value ?? "";
    if (className) cell.className = className;
    row.appendChild(cell);
  }

  function renderPartySummary(detail) {
    const summary = document.getElementById("partySummary");
    if (!summary || !detail || detail.error) return;

    const values = [
      ["Opening", detail.summary.opening_balance],
      ["Sales", detail.summary.total_sales],
      ["Purchase", detail.summary.total_purchase],
      ["Received", detail.summary.total_received],
      ["Paid", detail.summary.total_paid],
      ["Last Date", detail.summary.last_transaction_date || "-"]
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
