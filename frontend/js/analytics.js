const analyticsCharts = {
  trend: null,
  cashFlow: null,
  leakage: null,
  itemVolume: null,
  debtor: null,
  paymentMode: null,
  profitByItem: null
};

let analyticsRequestToken = 0;

async function loadAnalytics() {
  const requestToken = ++analyticsRequestToken;

  const start = document.getElementById("startDate")?.value;
  const end = document.getElementById("endDate")?.value;

  if (!start || !end) {
    showToast("Select date range");
    return;
  }

  if (start > end) {
    showToast("Start date cannot be after end date");
    return;
  }

  resetAnalyticsView();

  const endpoints = {
    trend: `/analytics/trend?start_date=${start}&end_date=${end}`,
    summary: `/analytics/summary?start_date=${start}&end_date=${end}`,
    leakage: `/analytics/leakage?start_date=${start}&end_date=${end}`,
    debtors: `/top-debtors?start_date=${start}&end_date=${end}`,
    profitByItem: `/analytics/profit-by-item?start_date=${start}&end_date=${end}`,
    itemVolume: `/analytics/item-volume?start_date=${start}&end_date=${end}`,
    paymentModes: `/analytics/payment-modes?start_date=${start}&end_date=${end}`
  };

  const cachedTrend = getCachedResponse(endpoints.trend);
  const cachedSummary = getCachedResponse(endpoints.summary);
  if (cachedSummary) renderAnalyticsSummary(cachedSummary);
  if (cachedTrend) renderTrendCharts(cachedTrend);

  loadAnalyticsPart(endpoints.summary, null, renderAnalyticsSummary, requestToken);
  loadAnalyticsPart(endpoints.trend, [], renderTrendCharts, requestToken);
  loadAnalyticsPart(endpoints.leakage, [], renderLeakageChart, requestToken);
  loadAnalyticsPart(endpoints.debtors, { top_debtors: [] }, renderDebtorChart, requestToken);
  loadAnalyticsPart(endpoints.profitByItem, [], renderProfitByItemChart, requestToken);
  loadAnalyticsPart(endpoints.itemVolume, [], renderItemVolumeChart, requestToken);
  loadAnalyticsPart(endpoints.paymentModes, [], renderPaymentModeChart, requestToken);
}

function renderAnalyticsSummary(summary) {
  if (!isActivePage("analytics")) return;
  if (!summary || summary.error) return;

  setText("analyticsSales", formatMoney(summary.sales));
  setText("analyticsPurchase", formatMoney(summary.purchase));
  setText("analyticsProfit", summary.profit == null ? "N/A" : formatMoney(summary.profit));
  setText("analyticsCash", formatMoney(summary.net_cash));
}

async function loadAnalyticsPart(url, fallback, renderer, requestToken) {
  try {
    const data = await optionalApiCall(url, fallback, "GET", null, { loader: false, cache: true });
    if (!isActivePage("analytics") || requestToken !== analyticsRequestToken) return;
    renderer(data);
  } catch (e) {
    console.error(e);
  }
}

function resetAnalyticsView() {
    if (!isActivePage("analytics")) return;
    destroyAnalyticsCharts();

    ["trendChart", "cashFlowChart", "leakageChart", "itemVolumeChart", "debtorChart", "paymentModeChart", "profitByItemChart"].forEach(id => {
      drawCanvasMessage(id, "Loading...");
    });
}

function canRenderCharts(chartIds) {
    if (typeof Chart === "undefined") {
      chartIds.forEach(id => drawCanvasMessage(id, "Charts are unavailable. Check internet connection."));
      return false;
    }
    return true;
}

function renderTrendCharts(trend) {
    if (!isActivePage("analytics")) return;
    trend = Array.isArray(trend) ? trend : [];
    if (!canRenderCharts(["trendChart", "cashFlowChart"])) return;

    destroyChart("trend");
    destroyChart("cashFlow");
    const trendCanvas = document.getElementById("trendChart");
    const cashFlowCanvas = document.getElementById("cashFlowChart");
    if (!trendCanvas || !cashFlowCanvas) return;
    const dates = trend.map(d => d.date);
    const sales = trend.map(d => d.sales || 0);
    const purchase = trend.map(d => d.purchase || 0);
    const profit = trend.map(d => d.profit ?? null);

    // --- Trend Chart ---
    if (trend && trend.length > 0) {
      analyticsCharts.trend = new Chart(trendCanvas, {
        type: "line",
        data: {
          labels: dates,
          datasets: [
            { label: "Sales", data: sales, borderColor: "#2f7f96", backgroundColor: "rgb(47 127 150 / 0.12)", tension: 0.35 },
            { label: "Purchase", data: purchase, borderColor: "#b86f20", backgroundColor: "rgb(184 111 32 / 0.12)", tension: 0.35 }
          ]
        }
      });
    } else {
      drawCanvasMessage("trendChart", "No sales or purchase data");
    }

    if (trend && trend.length > 0) {
      analyticsCharts.cashFlow = new Chart(cashFlowCanvas, {
        type: "bar",
        data: {
          labels: dates,
          datasets: [
            { label: "Sales", data: sales, backgroundColor: "#2f7f96" },
            { label: "Purchase", data: purchase, backgroundColor: "#b7791f" },
            { label: "Profit", data: profit, backgroundColor: "#1f7a5c" }
          ]
        },
        options: {
          responsive: true,
          scales: { x: { stacked: false }, y: { beginAtZero: true } }
        }
      });
    } else {
      drawCanvasMessage("cashFlowChart", "No cash movement data");
    }
}

function renderLeakageChart(leakage) {
    if (!isActivePage("analytics")) return;
    leakage = Array.isArray(leakage) ? leakage : [];
    if (!canRenderCharts(["leakageChart"])) return;

    destroyChart("leakage");
    const canvas = document.getElementById("leakageChart");
    if (!canvas) return;
    if (leakage && leakage.length > 0) {
      analyticsCharts.leakage = new Chart(canvas, {
        type: "line",
        data: {
          labels: leakage.map(d => d.date),
          datasets: [{
            label: "Leakage",
            data: leakage.map(d => d.leakage ?? null),
            borderColor: "#b64a3d",
            backgroundColor: "rgb(182 74 61 / 0.12)",
            tension: 0.35
          }]
        }
      });
    } else {
      drawCanvasMessage("leakageChart", "No leakage data");
    }
}

function renderItemVolumeChart(itemVolume) {
    if (!isActivePage("analytics")) return;
    itemVolume = Array.isArray(itemVolume) ? itemVolume : [];
    if (!canRenderCharts(["itemVolumeChart"])) return;

    destroyChart("itemVolume");
    const canvas = document.getElementById("itemVolumeChart");
    if (!canvas) return;
    if (itemVolume.length > 0) {
      analyticsCharts.itemVolume = new Chart(canvas, {
        type: "bar",
        data: {
          labels: itemVolume.map(d => d.item),
          datasets: [
            { label: "Purchased kg", data: itemVolume.map(d => d.purchase_kg || 0), backgroundColor: "#b7791f" },
            { label: "Sold kg", data: itemVolume.map(d => d.sales_kg || 0), backgroundColor: "#2f7f96" }
          ]
        },
        options: {
          responsive: true,
          scales: { y: { beginAtZero: true } }
        }
      });
    } else {
      drawCanvasMessage("itemVolumeChart", "No hen-type volume data");
    }
}

function renderDebtorChart(debtors) {
    if (!isActivePage("analytics")) return;
    const topDebtors = Array.isArray(debtors?.top_debtors) ? debtors.top_debtors : [];
    if (!canRenderCharts(["debtorChart"])) return;

    destroyChart("debtor");
    const canvas = document.getElementById("debtorChart");
    if (!canvas) return;
    if (topDebtors.length > 0) {
      analyticsCharts.debtor = new Chart(canvas, {
        type: "bar",
        data: {
          labels: topDebtors.map(d => d.party_name),
          datasets: [{
            label: "Outstanding",
            data: topDebtors.map(d => d.balance || 0),
            backgroundColor: "#2f7f96"
          }]
        }
      });
    } else {
      drawCanvasMessage("debtorChart", "No outstanding parties");
    }
}

function renderPaymentModeChart(paymentModes) {
    if (!isActivePage("analytics")) return;
    paymentModes = Array.isArray(paymentModes) ? paymentModes : [];
    if (!canRenderCharts(["paymentModeChart"])) return;

    destroyChart("paymentMode");
    const canvas = document.getElementById("paymentModeChart");
    if (!canvas) return;
    if (paymentModes.length > 0) {
      analyticsCharts.paymentMode = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: paymentModes.map(d => d.mode),
          datasets: [{
            label: "Payments",
            data: paymentModes.map(d => d.total || 0),
            backgroundColor: ["#2f7f96", "#1f7a5c", "#b7791f", "#b64a3d", "#334247"]
          }]
        }
      });
    } else {
      drawCanvasMessage("paymentModeChart", "No payment mode data");
    }
}

function renderProfitByItemChart(profitByItem) {
    if (!isActivePage("analytics")) return;
    profitByItem = Array.isArray(profitByItem) ? profitByItem : [];
    if (!canRenderCharts(["profitByItemChart"])) return;

    destroyChart("profitByItem");
    const canvas = document.getElementById("profitByItemChart");
    if (!canvas) return;
    if (profitByItem && profitByItem.length > 0) {
      analyticsCharts.profitByItem = new Chart(canvas, {
        type: "bar",
        data: {
          labels: profitByItem.map(d => d.item),
          datasets: [{
            label: "Profit",
            data: profitByItem.map(d => d.profit ?? null),
            backgroundColor: "#23785b"
          }]
        }
      });
    } else {
      drawCanvasMessage("profitByItemChart", "No item profit data");
    }
}

function destroyAnalyticsCharts() {
  Object.keys(analyticsCharts).forEach(key => {
    if (analyticsCharts[key]) {
      analyticsCharts[key].destroy();
      analyticsCharts[key] = null;
    }
  });
}

function destroyChart(key) {
  if (analyticsCharts[key]) {
    analyticsCharts[key].destroy();
    analyticsCharts[key] = null;
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.innerText = value;
}
