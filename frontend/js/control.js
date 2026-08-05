function controlDateLabel(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

async function initProductionControls() {
  const input = document.getElementById("controlLockDate");
  if (input && !input.value) input.value = formatDateInput(new Date());
  await Promise.all([loadPeriodLocks(), loadAuditEvents()]);
}

async function lockSelectedDay() {
  const targetDate = document.getElementById("controlLockDate")?.value;
  const reason = document.getElementById("controlLockReason")?.value.trim();
  if (!targetDate) return showToast("Select a date");
  try {
    const data = await apiCall(
      `/control/period-locks/${encodeURIComponent(targetDate)}/lock`,
      "POST",
      JSON.stringify({ reason: reason || "Day verified and closed" }),
      { "Content-Type": "application/json" }
    );
    if (data.error) return showToast(data.error);
    showToast(`${controlDateLabel(targetDate)} locked`);
    await Promise.all([loadPeriodLocks(), loadAuditEvents()]);
  } catch (error) {
    showToast(error.message || "Could not lock the day");
  }
}

async function unlockSelectedDay() {
  const targetDate = document.getElementById("controlLockDate")?.value;
  const reason = document.getElementById("controlLockReason")?.value.trim();
  if (!targetDate) return showToast("Select a date");
  if (!reason) return showToast("Enter the reason for reopening the day");
  try {
    const data = await apiCall(
      `/control/period-locks/${encodeURIComponent(targetDate)}/unlock`,
      "POST",
      JSON.stringify({ reason }),
      { "Content-Type": "application/json" }
    );
    if (data.error) return showToast(data.error);
    showToast(`${controlDateLabel(targetDate)} reopened`);
    await Promise.all([loadPeriodLocks(), loadAuditEvents()]);
  } catch (error) {
    showToast(error.message || "Could not reopen the day");
  }
}

async function loadPeriodLocks() {
  const body = document.getElementById("periodLockBody");
  if (!body) return;
  try {
    const data = await apiCall("/control/period-locks", "GET", null, {}, { loader: false });
    const rows = data.results || [];
    body.innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td>${escapeHtml(controlDateLabel(row.date))}</td>
        <td><span class="status-pill ${row.is_locked ? "status-danger" : "status-muted"}">${row.is_locked ? "Locked" : "Open"}</span></td>
        <td>${escapeHtml(row.reason || "-")}</td>
      </tr>
    `).join("") : '<tr><td colspan="3" class="empty">No day locks yet</td></tr>';
  } catch (error) {
    body.innerHTML = '<tr><td colspan="3" class="empty">Could not load day locks</td></tr>';
  }
}

async function loadAuditEvents() {
  const body = document.getElementById("auditEventBody");
  if (!body) return;
  try {
    const data = await apiCall("/control/audit-events?limit=100", "GET", null, {}, { loader: false });
    const rows = data.results || [];
    body.innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td>${escapeHtml(controlDateLabel(row.date))}</td>
        <td>${escapeHtml(row.user || "System")}</td>
        <td>${escapeHtml(row.action || "-")}</td>
        <td>${escapeHtml(String(row.entity_type || "-").replaceAll("_", " "))}</td>
        <td>${escapeHtml(row.reason || "-")}</td>
      </tr>
    `).join("") : '<tr><td colspan="5" class="empty">No recorded changes yet</td></tr>';
  } catch (error) {
    body.innerHTML = '<tr><td colspan="5" class="empty">Could not load audit history</td></tr>';
  }
}
