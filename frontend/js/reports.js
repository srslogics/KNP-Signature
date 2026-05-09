let reportPartySuggestTimer = null;

function toggleReportFields() {
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

async function downloadReport(format) {
  const reportType = document.getElementById("reportType")?.value;
  const party = document.getElementById("reportParty")?.value.trim();
  const startDate = document.getElementById("reportStartDate")?.value;
  const endDate = document.getElementById("reportEndDate")?.value;
  const reportDate = document.getElementById("reportDate")?.value;

  if (!reportType) return;

  if (reportType === "ledger" && !party) {
    showToast("Enter party name");
    return;
  }

  if (reportType !== "inventory" && startDate && endDate && startDate > endDate) {
    showToast("Start date cannot be after end date");
    return;
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

  try {
    toggleButtons(true);
    const headers = {};
    const authToken = typeof getAuthToken === "function" ? getAuthToken() : "";
    if (authToken) {
      headers["X-Auth-Token"] = authToken;
    }

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

function suggestReportParties() {
  const input = document.getElementById("reportParty");
  const suggestions = document.getElementById("reportPartySuggestions");
  const name = input?.value.trim();

  if (!suggestions) return;

  clearTimeout(reportPartySuggestTimer);

  if (!name || name.length < 2) {
    suggestions.innerHTML = "";
    return;
  }

  reportPartySuggestTimer = setTimeout(async () => {
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
