let reportPartySuggestTimer = null;
let pendingReportImageShare = null;

function getReportImageShareButton() {
  return document.getElementById("shareReportImageButton");
}

function clearPendingReportImageShare() {
  pendingReportImageShare = null;
  const button = getReportImageShareButton();
  if (button) button.textContent = "Share Image";
}

function getReportImageShareKey(request) {
  const selectedOutletId = typeof getSelectedOutletId === "function" ? getSelectedOutletId() : "";
  return `${selectedOutletId}|${request.params.toString()}`;
}

function dedupeReportPartyResults(parties) {
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

function toggleReportFields() {
  clearPendingReportImageShare();
  const reportType = document.getElementById("reportType")?.value;
  const partyInput = document.getElementById("reportParty");
  const startDate = document.getElementById("reportStartDate");
  const endDate = document.getElementById("reportEndDate");
  const reportDate = document.getElementById("reportDate");

  if (!partyInput || !startDate || !endDate || !reportDate) return;

  const needsParty = reportType === "ledger";
  const allowsParty = reportType === "transactions";
  const usesSingleDate = reportType === "inventory";

  partyInput.style.display = needsParty || allowsParty ? "inline-flex" : "none";
  partyInput.placeholder = needsParty ? "Party name required" : "Party name optional";
  startDate.style.display = usesSingleDate ? "none" : "inline-flex";
  endDate.style.display = usesSingleDate ? "none" : "inline-flex";
  reportDate.style.display = usesSingleDate ? "inline-flex" : "none";
}

function buildReportRequest(format) {
  const reportType = document.getElementById("reportType")?.value;
  const party = document.getElementById("reportParty")?.value.trim();
  const startDate = document.getElementById("reportStartDate")?.value;
  const endDate = document.getElementById("reportEndDate")?.value;
  const reportDate = document.getElementById("reportDate")?.value;

  if (!reportType) return null;

  if (reportType === "ledger" && !party) {
    showToast("Enter party name");
    return null;
  }

  if (reportType !== "inventory" && startDate && endDate && startDate > endDate) {
    showToast("Start date cannot be after end date");
    return null;
  }

  const params = new URLSearchParams({
    report_type: reportType,
    file_format: format
  });

  if (party) params.set("party", party);
  if (reportType === "inventory") {
    if (reportDate) params.set("date", reportDate);
  } else {
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
  }

  return { reportType, params, startDate, endDate, reportDate };
}

function buildReportHeaders() {
  const headers = {};
  const authToken = typeof getAuthToken === "function" ? getAuthToken() : "";
  const selectedOutletId = typeof getSelectedOutletId === "function" ? getSelectedOutletId() : "";
  if (authToken) headers["X-Auth-Token"] = authToken;
  if (selectedOutletId) headers["X-Outlet-Id"] = selectedOutletId;
  return headers;
}

async function downloadReport(format) {
  const request = buildReportRequest(format);
  if (!request) return;
  const { reportType, params } = request;

  try {
    toggleButtons(true);
    const headers = buildReportHeaders();

    const response = await withLoading("Preparing report...", () => (
      fetchWithRetry(
        `${BASE_URL}/reports/export?${params.toString()}`,
        { headers }
      )
    ));

    if (response.status === 401) {
      if (typeof clearAuthState === "function") {
        clearAuthState();
      }
      throw new Error("AUTH_REQUIRED");
    }

    if (!response.ok) {
      throw new Error(`Report failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      showToast(data.error || "Report could not be downloaded");
      return;
    }

    const blob = await response.blob();
    const extension = format === "pdf" ? "pdf" : "xlsx";
    const filename = `${reportType}_report.${extension}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Report downloaded");
  } catch (e) {
    console.error(e);
    showToast("Report download failed");
  } finally {
    toggleButtons(false);
  }
}

function escapeReportImageHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatReportImageDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function getReportImagePeriodLine(request) {
  if (request.reportType === "inventory") {
    return request.reportDate ? `Date: ${formatReportImageDate(request.reportDate)}` : "";
  }
  if (request.startDate && request.endDate) {
    return `Period: ${formatReportImageDate(request.startDate)} to ${formatReportImageDate(request.endDate)}`;
  }
  if (request.startDate) return `Period: From ${formatReportImageDate(request.startDate)}`;
  if (request.endDate) return `Period: Up to ${formatReportImageDate(request.endDate)}`;
  return "Period: All Dates";
}

function formatReportImageValue(column, value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value !== "number") return String(value);

  const moneyColumns = new Set([
    "Amount", "Balance", "Rate", "Sales", "Purchase", "Profit",
    "Payment Received", "Payment Paid", "Opening", "Receivable",
    "Payable", "Net Outstanding", "Old Bal", "Purchases", "Payment", "Total"
  ]);
  const wholeColumns = new Set(["NAG", "Nag"]);
  const weightColumns = new Set([
    "KGS", "Kg", "Weight", "Opening Kg", "Purchase Kg", "Sales Kg",
    "Expected Kg", "Actual Kg", "Leakage Kg"
  ]);
  const maximumFractionDigits = wholeColumns.has(column) ? 0 : (weightColumns.has(column) ? 3 : 2);
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: moneyColumns.has(column) ? 2 : 0,
    maximumFractionDigits
  }).format(value);
  return moneyColumns.has(column) ? `Rs ${formatted}` : formatted;
}

function buildReportImageSurface(report) {
  const columns = Array.isArray(report.columns) ? report.columns : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const host = document.createElement("div");
  const width = Math.min(1800, Math.max(920, columns.length * 145));
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;padding:28px;background:#fff;color:#221b16;font-family:Inter,Arial,sans-serif;z-index:-1;box-sizing:border-box;`;

  const meta = (report.meta_rows || [])
    .map(line => `<div style="font-size:15px;font-weight:700;margin:4px 0;color:#58493d;">${escapeReportImageHtml(line)}</div>`)
    .join("");
  const header = columns
    .map(column => `<th style="padding:10px 9px;border:1px solid #d8cbb9;background:#eee7dc;text-align:left;font-size:13px;white-space:nowrap;">${escapeReportImageHtml(column)}</th>`)
    .join("");
  const body = rows.map((row, rowIndex) => {
    const label = String(row?.Type ?? row?.[columns[0]] ?? "").trim().toLowerCase();
    const isTotal = label === "total" || label === "closing balance";
    const background = isTotal ? "#f3e2be" : (rowIndex % 2 ? "#fcfaf6" : "#ffffff");
    const cells = columns.map(column => {
      const rawValue = row?.[column];
      const align = typeof rawValue === "number" ? "right" : "left";
      return `<td style="padding:9px;border:1px solid #ded4c6;text-align:${align};font-size:13px;font-weight:${isTotal ? 800 : 600};white-space:nowrap;">${escapeReportImageHtml(formatReportImageValue(column, rawValue))}</td>`;
    }).join("");
    return `<tr style="background:${background};">${cells}</tr>`;
  }).join("");

  host.innerHTML = `
    <div style="padding-bottom:16px;border-bottom:2px solid #b98a51;">
      <div style="font-size:25px;font-weight:800;">${escapeReportImageHtml(report.title || "Report")}</div>
      ${meta}
    </div>
    <table style="width:100%;margin-top:16px;border-collapse:collapse;table-layout:auto;">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div style="margin-top:14px;text-align:right;font-size:12px;color:#75685d;">KNP Signature</div>
  `;
  document.body.appendChild(host);
  return host;
}

function downloadReportPng(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function copyReportImageAndOpenWhatsApp() {
  const pending = pendingReportImageShare;
  if (!pending) return;

  let clipboardPromise = null;
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      // Start the protected clipboard action immediately from this second click.
      clipboardPromise = navigator.clipboard.write([
        new ClipboardItem({ "image/png": pending.blob })
      ]);
    } catch (clipboardError) {
      console.warn("Image clipboard unavailable", clipboardError);
    }
  }

  const whatsappWindow = window.open("https://web.whatsapp.com/", "_blank");
  let copied = false;
  if (clipboardPromise) {
    try {
      await clipboardPromise;
      copied = true;
    } catch (clipboardError) {
      console.warn("Image clipboard unavailable", clipboardError);
    }
  }

  if (!copied) downloadReportPng(pending.file);
  clearPendingReportImageShare();

  if (copied) {
    showToast(whatsappWindow
      ? "Report copied. In WhatsApp press Ctrl+V (Cmd+V on Mac), then Send."
      : "Report copied. Open WhatsApp Web and paste it with Ctrl+V (Cmd+V on Mac)."
    );
  } else {
    showToast(whatsappWindow
      ? "Clipboard was blocked. Attach the downloaded image in WhatsApp."
      : "Image downloaded. Open WhatsApp and attach it."
    );
  }
}

async function shareReportImage() {
  const request = buildReportRequest("json");
  if (!request) return;

  const shareKey = getReportImageShareKey(request);
  if (pendingReportImageShare?.key === shareKey) {
    await copyReportImageAndOpenWhatsApp();
    return;
  }
  clearPendingReportImageShare();

  let surface = null;
  try {
    toggleButtons(true);
    const headers = buildReportHeaders();

    const response = await withLoading("Preparing image...", () => (
      fetchWithRetry(`${BASE_URL}/reports/export?${request.params.toString()}`, { headers })
    ));
    if (response.status === 401) {
      if (typeof clearAuthState === "function") clearAuthState();
      throw new Error("Please log in again");
    }
    if (!response.ok) throw new Error(`Report failed: ${response.status}`);

    const report = await response.json();
    if (report.error) throw new Error(report.error);
    if (!Array.isArray(report.rows) || !report.rows.length) {
      throw new Error("No report data is available for this selection");
    }
    if (report.rows.length > 120) {
      throw new Error("Select a shorter date range (maximum 120 rows) for a readable WhatsApp image");
    }
    if (!window.html2canvas) throw new Error("Image capture is unavailable");

    const periodLine = getReportImagePeriodLine(request);
    const reportMeta = Array.isArray(report.meta_rows) ? report.meta_rows : [];
    if (periodLine && !reportMeta.some(line => String(line).toLowerCase().startsWith("period:"))) {
      report.meta_rows = [periodLine, ...reportMeta];
    }

    surface = buildReportImageSurface(report);
    const canvas = await window.html2canvas(surface, {
      backgroundColor: "#ffffff",
      scale: 1.5,
      useCORS: true,
      logging: false
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Report image could not be created");

    const safeName = String(report.filename || request.reportType || "report")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const file = new File([blob], `${safeName || "report"}.png`, { type: "image/png" });
    pendingReportImageShare = { blob, file, key: shareKey };
    const button = getReportImageShareButton();
    if (button) button.textContent = "Copy & Open WhatsApp";
    showToast("Image ready. Click Copy & Open WhatsApp.");
  } catch (error) {
    console.error(error);
    clearPendingReportImageShare();
    showToast(error.message || "Report image failed");
  } finally {
    surface?.remove();
    toggleButtons(false);
  }
}

function suggestReportParties() {
  const input = document.getElementById("reportParty");
  const suggestions = document.getElementById("reportPartySuggestions");
  const boxId = "reportPartySuggestBox";
  const name = input?.value.trim();

  if (!suggestions) return;

  clearTimeout(reportPartySuggestTimer);

  if (!name || name.length < 2) {
    suggestions.innerHTML = "";
    if (typeof hideSuggestionBox === "function") hideSuggestionBox(boxId);
    return;
  }

  reportPartySuggestTimer = setTimeout(async () => {
    try {
      const data = await apiCall(`/party/search?name=${encodeURIComponent(name)}`);
      suggestions.innerHTML = "";

      const results = dedupeReportPartyResults(data.results || []);
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
        });
      }
    } catch (e) {
      console.error(e);
      suggestions.innerHTML = "";
      if (typeof hideSuggestionBox === "function") hideSuggestionBox(boxId);
    }
  }, 250);
}
