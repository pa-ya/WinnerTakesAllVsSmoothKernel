// ============================================================
// DekantPM Comparison — UI: charts, tabs, settings, stats display
// (extracted from index.html; loaded after comparison.js/story.js)
// ============================================================
// CHART.JS PLUGIN: Winning bin vertical marker
// ============================================================
Chart.register({
  id: 'winBinMarker',
  afterDraw: function (chart) {
    var opts = (chart.options.plugins && chart.options.plugins.winBinMarker) || {};
    var winBin = opts.winBin;
    if (winBin == null || winBin < 0) return;
    var meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data[winBin]) return;
    var x = meta.data[winBin].x;
    var ctx = chart.ctx;
    var area = chart.chartArea;
    if (!area) return;
    var colors = getChartColors();
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = colors.success;
    ctx.lineWidth = 2;
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    ctx.fillStyle = colors.success;
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WIN', x, area.top - 4);
    ctx.restore();
  }
});

// ============================================================
// TAB SWITCHING
// ============================================================
function switchMainTab(tabId, btn) {
  document.querySelectorAll('#mainTabs .tab').forEach(function (t) { t.classList.remove('active'); });
  document.querySelectorAll('.main-content > .tab-content').forEach(function (t) { t.classList.remove('active'); });
  btn.classList.add('active');
  var el = document.getElementById('tab-' + tabId);
  if (el) el.classList.add('active');
  // Refresh LP tab when switching to it
  if (tabId === 'lp' && typeof refreshLpTab === 'function') {
    setTimeout(function () { refreshLpTab(); }, 60);
  }
  // Refresh payout analysis when switching to resolve tab
  if (tabId === 'resolve' && typeof renderPayoutAnalysisChart === 'function') {
    setTimeout(function () { renderPayoutAnalysisChart(); }, 60);
  }
  // Refresh the trading tab charts/preview on entry — the canvases are sized
  // (and the preview curve drawn from current inputs) only once visible, so
  // without this the initial chart shows stale data until a manual nudge.
  if (tabId === 'distribution' && typeof refreshDistCharts === 'function') {
    setTimeout(function () { refreshDistCharts(); }, 60);
  }
  // Trigger chart resize on tab switch
  setTimeout(function () { resizeVisibleCharts(); }, 50);
}

function enableTradingTabs() {
  document.getElementById('tabDistribution').disabled = false;
  document.getElementById('tabLp').disabled = false;
  document.getElementById('tabResolve').disabled = false;
}

// ============================================================
// COLLAPSIBLE SECTIONS
// ============================================================
function toggleCollapsible(titleEl) {
  titleEl.classList.toggle('open');
  var body = titleEl.nextElementSibling;
  if (body) body.classList.toggle('open');
}

// ============================================================
// CHART MODE (split/combined)
// ============================================================
var chartMode = 'split';

// When true, Max/Peak Payout stats apply the settlement claimScale (realistic,
// solvency-capped best case). When false, raw best-case kernel claim (current).
var solvencyAwareStats = false;

function toggleSolvencyStats(enabled) {
  solvencyAwareStats = !!enabled;
  var label = document.getElementById('solvencyStatsLabel');
  if (label) label.textContent = enabled ? 'On' : 'Off';
  // Re-render the trading tab through the SAME path a trader change uses
  // (refreshDistStats + refreshCombinedDistStats + updateDistPreview +
  // applyStatsMode). This updates every solvency-dependent value — preview
  // Max Payout AND the position-box Peak Payout — with the correct layout
  // (applyStatsMode keeps the grid/table mode intact, so no box "appears").
  if (dualMarket && dualMarket.initialized && typeof refreshDistCharts === 'function') {
    refreshDistCharts();
  }
}

function setChartMode(mode, btn) {
  chartMode = mode;
  document.querySelectorAll('.chart-mode-btn').forEach(function (b) {
    b.classList.toggle('active', b.textContent.trim().toLowerCase() === mode);
  });
  applyChartMode();
}

function applyChartMode() {
  var isCombined = chartMode === 'combined';

  // Trading tab
  var dc = document.getElementById('distChartPanelCurrent');
  var di = document.getElementById('distChartPanelImproved');
  var dx = document.getElementById('distChartPanelCombined');
  if (dc) dc.style.display = isCombined ? 'none' : '';
  if (di) di.style.display = isCombined ? 'none' : '';
  if (dx) dx.style.display = isCombined ? '' : 'none';
  var dCharts = document.getElementById('distCharts');
  if (dCharts) dCharts.classList.toggle('combined-mode', isCombined);

  var dStats = document.getElementById('distStats');
  var dStatsCombined = document.getElementById('distStatsCombined');
  if (dStats) dStats.style.display = isCombined ? 'none' : '';
  if (dStatsCombined) dStatsCombined.style.display = isCombined ? '' : 'none';

  // Preview stats: swap split/combined visibility
  var previewSplit = document.getElementById('distPreviewStats');
  var previewCombined = document.getElementById('distPreviewCombined');
  if (previewSplit && isCombined) previewSplit.style.display = 'none';
  if (previewCombined && !isCombined) previewCombined.style.display = 'none';

  // LP tab payout charts
  var lpPayC = document.getElementById('lpPayoutPanelCurrent');
  var lpPayI = document.getElementById('lpPayoutPanelImproved');
  var lpPayX = document.getElementById('lpPayoutPanelCombined');
  if (lpPayC) lpPayC.style.display = isCombined ? 'none' : '';
  if (lpPayI) lpPayI.style.display = isCombined ? 'none' : '';
  if (lpPayX) lpPayX.style.display = isCombined ? '' : 'none';
  var lpPayCharts = document.getElementById('lpPayoutCharts');
  if (lpPayCharts) lpPayCharts.classList.toggle('combined-mode', isCombined);

  // LP tab sim charts
  var lpSimC = document.getElementById('lpSimPanelCurrent');
  var lpSimI = document.getElementById('lpSimPanelImproved');
  var lpSimX = document.getElementById('lpSimPanelCombined');
  if (lpSimC) lpSimC.style.display = isCombined ? 'none' : '';
  if (lpSimI) lpSimI.style.display = isCombined ? 'none' : '';
  if (lpSimX) lpSimX.style.display = isCombined ? '' : 'none';
  var lpSimCharts = document.getElementById('lpSimCharts');
  if (lpSimCharts) lpSimCharts.classList.toggle('combined-mode', isCombined);

  // LP tab stats
  var lpStatsEl = document.getElementById('lpStats');
  var lpStatsCombined = document.getElementById('lpStatsCombined');
  if (lpStatsEl) lpStatsEl.style.display = isCombined ? 'none' : '';
  if (lpStatsCombined) lpStatsCombined.style.display = isCombined ? '' : 'none';

  // LP tab preview
  var lpPreviewSplit = document.getElementById('lpPreviewStats');
  var lpPreviewCombined = document.getElementById('lpPreviewCombined');
  if (lpPreviewSplit && isCombined) lpPreviewSplit.style.display = 'none';
  if (lpPreviewSplit && !isCombined) lpPreviewSplit.style.display = '';
  if (lpPreviewCombined && !isCombined) lpPreviewCombined.style.display = 'none';
  if (lpPreviewCombined && isCombined) lpPreviewCombined.style.display = '';

  // Payout analysis charts
  var paC = document.getElementById('payoutAnalysisPanelCurrent');
  var paI = document.getElementById('payoutAnalysisPanelImproved');
  var paX = document.getElementById('payoutAnalysisPanelCombined');
  if (paC) paC.style.display = isCombined ? 'none' : '';
  if (paI) paI.style.display = isCombined ? 'none' : '';
  if (paX) paX.style.display = isCombined ? '' : 'none';
  var paCharts = document.getElementById('payoutAnalysisCharts');
  if (paCharts) paCharts.classList.toggle('combined-mode', isCombined);

  // Refresh combined content when switching to combined mode
  if (isCombined && dualMarket && dualMarket.initialized) {
    refreshCombinedDistChart();
    updateCombinedDistPreview();
    var distTraderName = document.getElementById('distTraderSelect').value;
    refreshCombinedDistStats(distTraderName);
    if (typeof refreshLpTab === 'function') refreshLpTab();
    if (typeof renderPayoutAnalysisChart === 'function') renderPayoutAnalysisChart();
  }
  // Update preview stats for current mode
  if (dualMarket && dualMarket.initialized && typeof updatePreviewStats === 'function') {
    updatePreviewStats();
  }
  if (!isCombined && dualMarket && dualMarket.initialized && typeof renderPayoutAnalysisChart === 'function') {
    renderPayoutAnalysisChart();
  }

  setTimeout(function () { resizeVisibleCharts(); }, 50);
}

// ============================================================
// Y-AXIS AUTO-FIT
// ============================================================
var autoFitY = true;

function toggleAutoFitY(enabled) {
  autoFitY = enabled;
  var label = document.getElementById('autoFitYLabel');
  if (label) label.textContent = enabled ? 'Auto' : 'Manual';
  try { localStorage.setItem('dekantpm_autoFitY', String(autoFitY)); } catch (e) { /* ignore */ }
  if (enabled) {
    updateDistPreview();
  }
}

// Sync Y-axis scales before chart.update().
// Auto mode: compute max from visible data, set explicit bounds so
//   the chart always fits all datasets (overrides any prior zoom on Y).
// Manual mode: freeze Y at its current rendered range so data changes
//   don't shift the axis — only user zoom/pan can move it.
function syncChartYAxes(chart) {
  if (!chart) return;

  if (autoFitY) {
    var yProbMax = 0;
    var yPosMax = 0;

    for (var i = 0; i < chart.data.datasets.length; i++) {
      if (!chart.isDatasetVisible(i)) continue;
      var ds = chart.data.datasets[i];
      var axisId = ds.yAxisID || 'y';
      for (var j = 0; j < ds.data.length; j++) {
        var v = ds.data[j];
        if (v == null || isNaN(v)) continue;
        if (axisId === 'yProb' && v > yProbMax) yProbMax = v;
        if (axisId === 'yPos' && v > yPosMax) yPosMax = v;
      }
    }

    // 15% headroom
    if (chart.options.scales.yProb) {
      chart.options.scales.yProb.min = 0;
      chart.options.scales.yProb.max = yProbMax > 0 ? yProbMax * 1.15 : undefined;
    }
    if (chart.options.scales.yPos) {
      chart.options.scales.yPos.min = 0;
      chart.options.scales.yPos.max = yPosMax > 0 ? yPosMax * 1.15 : undefined;
    }
    // Reset Y-axis link base ranges since data changed
    chart._yAxisBase = null;
    chart._yAxisPrev = null;
  } else {
    // Freeze: capture current rendered axis bounds
    if (chart.scales && chart.scales.yProb) {
      chart.options.scales.yProb.min = chart.scales.yProb.min;
      chart.options.scales.yProb.max = chart.scales.yProb.max;
    }
    if (chart.scales && chart.scales.yPos) {
      chart.options.scales.yPos.min = chart.scales.yPos.min;
      chart.options.scales.yPos.max = chart.scales.yPos.max;
    }
  }
}

// ============================================================
// CHART MANAGEMENT
// ============================================================
var charts = {};  // { chartId: Chart instance }

// Shared zoom/pan plugin config for all charts
function getZoomPluginConfig() {
  return {
    zoom: {
      wheel: { enabled: true },
      pinch: { enabled: true },
      mode: 'xy',
      overScaleMode: 'xy',
      onZoom: function (ctx) { syncLinkedYAxes(ctx.chart); },
    },
    pan: {
      enabled: true,
      mode: 'xy',
      modifierKey: 'ctrl',
      overScaleMode: 'xy',
      onPan: function (ctx) { syncLinkedYAxes(ctx.chart); },
    },
    limits: {
      x: { minRange: 2 },
      yProb: { min: 0 },
      yPos: { min: 0 },
    },
  };
}

function resetZoom(chartId) {
  var chart = charts[chartId];
  if (chart) {
    chart.resetZoom();
    chart._yAxisBase = null;
    chart._yAxisPrev = null;
  }
}

// ============================================================
// Y-AXIS LINKED ZOOM/PAN
// ============================================================
// When user zooms/pans one Y axis (yProb or yPos), proportionally
// adjust the other so all curves zoom/pan together.
var _yAxisSyncing = {};

function initYAxisBase(chart) {
  if (!chart.scales || !chart.scales.yProb || !chart.scales.yPos) return;
  chart._yAxisBase = {
    yProb: { min: chart.scales.yProb.min, max: chart.scales.yProb.max },
    yPos: { min: chart.scales.yPos.min, max: chart.scales.yPos.max },
  };
  chart._yAxisPrev = {
    yProb: { min: chart.scales.yProb.min, max: chart.scales.yProb.max },
    yPos: { min: chart.scales.yPos.min, max: chart.scales.yPos.max },
  };
}

function syncLinkedYAxes(chart) {
  var id = chart.canvas ? chart.canvas.id : '';
  if (_yAxisSyncing[id]) return;

  var yProb = chart.scales.yProb;
  var yPos = chart.scales.yPos;
  if (!yProb || !yPos) return;

  // Initialize base ranges on first zoom/pan
  if (!chart._yAxisBase || !chart._yAxisPrev) {
    initYAxisBase(chart);
    return;
  }

  var prev = chart._yAxisPrev;
  var base = chart._yAxisBase;
  var baseProbRange = base.yProb.max - base.yProb.min;
  var basePosRange = base.yPos.max - base.yPos.min;
  if (baseProbRange <= 0 || basePosRange <= 0) return;

  // Detect which axis changed
  var probDiff = Math.abs(yProb.min - prev.yProb.min) + Math.abs(yProb.max - prev.yProb.max);
  var posDiff = Math.abs(yPos.min - prev.yPos.min) + Math.abs(yPos.max - prev.yPos.max);

  var needsUpdate = false;
  _yAxisSyncing[id] = true;

  if (probDiff > 1e-8 && posDiff < 1e-4) {
    // yProb changed -> sync yPos proportionally
    var zoomRatio = (yProb.max - yProb.min) / baseProbRange;
    var panFrac = ((yProb.min + yProb.max) / 2 - (base.yProb.min + base.yProb.max) / 2) / baseProbRange;
    var newPosRange = basePosRange * zoomRatio;
    var newPosMid = (base.yPos.min + base.yPos.max) / 2 + panFrac * basePosRange;
    chart.options.scales.yPos.min = Math.max(0, newPosMid - newPosRange / 2);
    chart.options.scales.yPos.max = newPosMid + newPosRange / 2;
    needsUpdate = true;
  } else if (posDiff > 0.01 && probDiff < 1e-6) {
    // yPos changed -> sync yProb proportionally
    var zoomRatio = (yPos.max - yPos.min) / basePosRange;
    var panFrac = ((yPos.min + yPos.max) / 2 - (base.yPos.min + base.yPos.max) / 2) / basePosRange;
    var newProbRange = baseProbRange * zoomRatio;
    var newProbMid = (base.yProb.min + base.yProb.max) / 2 + panFrac * baseProbRange;
    chart.options.scales.yProb.min = Math.max(0, newProbMid - newProbRange / 2);
    chart.options.scales.yProb.max = newProbMid + newProbRange / 2;
    needsUpdate = true;
  }

  if (needsUpdate) {
    chart.update('none');
  }

  chart._yAxisPrev = {
    yProb: { min: chart.scales.yProb.min, max: chart.scales.yProb.max },
    yPos: { min: chart.scales.yPos.min, max: chart.scales.yPos.max },
  };

  _yAxisSyncing[id] = false;
}

function getOrCreateChart(canvasId, config) {
  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }
  var ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  charts[canvasId] = new Chart(ctx, config);
  return charts[canvasId];
}

// ============================================================
// PHASE 6: COMBINED CHART MODE
// ============================================================

// --- P6-1: Combined chart config builders ---
function buildCombinedDistChartConfig(labels, cProbs, iProbs, holdings, cPreview, iPreview, uniformProb) {
  var colors = getChartColors();
  var large = isLargeMarket();
  var uniformData = [];
  for (var j = 0; j < labels.length; j++) uniformData.push(uniformProb);
  return {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Current Probability',
          data: cProbs,
          borderColor: colors.primary,
          backgroundColor: colors.primary + '18',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: large ? 0 : 4,
          fill: false,
          tension: large ? 0 : 0.3,
          yAxisID: 'yProb',
          order: 1,
          _datasetKey: 'cProb',
        },
        {
          label: 'Improved Probability',
          data: iProbs,
          borderColor: colors.accent,
          backgroundColor: colors.accent + '18',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: large ? 0 : 4,
          fill: false,
          tension: large ? 0 : 0.3,
          yAxisID: 'yProb',
          order: 1,
          _datasetKey: 'iProb',
        },
        {
          label: 'Holdings',
          data: holdings,
          borderColor: colors.warning,
          backgroundColor: colors.warning + '33',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: large ? 0 : 3,
          fill: !large,
          tension: large ? 0 : 0.3,
          yAxisID: 'yPos',
          order: 4,
          _datasetKey: 'pos',
        },
        {
          label: 'Current Preview',
          data: cPreview,
          borderColor: colors.primary,
          backgroundColor: colors.primary + '15',
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [6, 3],
          fill: false,
          tension: large ? 0 : 0.3,
          yAxisID: 'yPos',
          order: 2,
          _datasetKey: 'cPreview',
        },
        {
          label: 'Improved Preview',
          data: iPreview,
          borderColor: colors.accent,
          backgroundColor: colors.accent + '15',
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [6, 3],
          fill: false,
          tension: large ? 0 : 0.3,
          yAxisID: 'yPos',
          order: 2,
          _datasetKey: 'iPreview',
        },
        {
          label: 'Uniform',
          data: uniformData,
          borderColor: colors.textMuted,
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
          yAxisID: 'yProb',
          order: 0,
          _datasetKey: 'uniform',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              if (ctx.dataset._datasetKey === 'cProb') return 'Current P: ' + (ctx.raw * 100).toFixed(2) + '%';
              if (ctx.dataset._datasetKey === 'iProb') return 'Improved P: ' + (ctx.raw * 100).toFixed(2) + '%';
              if (ctx.dataset._datasetKey === 'cPreview') return 'C Preview: ' + formatCompact(ctx.raw);
              if (ctx.dataset._datasetKey === 'iPreview') return 'I Preview: ' + formatCompact(ctx.raw);
              if (ctx.dataset._datasetKey === 'uniform') return 'Uniform: ' + (ctx.raw * 100).toFixed(2) + '%';
              return 'Holdings: ' + formatCompact(ctx.raw);
            },
          },
        },
        divergenceAnnotation: true,
        zoom: getZoomPluginConfig(),
      },
      scales: {
        x: {
          ticks: { color: colors.textMuted, font: { size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 20 },
          grid: { color: colors.grid },
        },
        yProb: {
          type: 'linear', position: 'left',
          title: { display: true, text: 'Probability', color: colors.textMuted, font: { size: 10 } },
          ticks: { color: colors.textMuted, font: { size: 9 }, callback: function (v) { return (v * 100).toFixed(1) + '%'; } },
          grid: { color: colors.grid },
          min: 0,
        },
        yPos: {
          type: 'linear', position: 'right',
          title: { display: true, text: 'Holdings / Preview', color: colors.textMuted, font: { size: 10 } },
          ticks: { color: colors.textMuted, font: { size: 9 } },
          grid: { drawOnChartArea: false },
          min: 0,
        },
      },
    },
  };
}

// --- P6-1: Init combined charts ---
function initCombinedDistChart() {
  if (!dualMarket || !dualMarket.lmsr) return;
  var labels = dualMarket.lmsr.getLabels();
  var cProbs = dualMarket.lmsr.getProbabilities();
  var iProbs = dualMarket.l2.getProbabilities();
  var empty = [];
  for (var j = 0; j < dualMarket.lmsr.N; j++) empty.push(0);
  var uniformProb = 1 / dualMarket.lmsr.N;
  getOrCreateChart('distCombinedChart', buildCombinedDistChartConfig(labels, cProbs, iProbs, empty, empty.slice(), empty.slice(), uniformProb));
  attachChartInteraction('distCombinedChart');
}

// --- P6-1: Refresh combined charts ---
function refreshCombinedDistChart() {
  if (!dualMarket || !dualMarket.lmsr) return;
  var chart = charts['distCombinedChart'];
  if (!chart) return;

  var cProbs = dualMarket.lmsr.getProbabilities();
  var iProbs = dualMarket.l2.getProbabilities();

  var traderName = document.getElementById('distTraderSelect').value;
  var holdings = [];
  for (var j = 0; j < dualMarket.lmsr.N; j++) holdings.push(0);
  if (traderName) {
    var cTh = dualMarket.lmsr.traderHoldings[traderName];
    if (cTh) holdings = cTh.holdings.slice();
  }

  // datasets: [cProb, iProb, holdings, cPreview, iPreview, uniform]
  chart.data.datasets[0].data = cProbs;
  chart.data.datasets[1].data = iProbs;
  chart.data.datasets[2].data = holdings;
  // previews updated separately via updateCombinedDistPreview
  syncChartYAxes(chart);
  chart.update('none');
}

function updateCombinedDistPreview(cPreviewArg, iPreviewArg) {
  if (!dualMarket || !dualMarket.lmsr) return;
  var chart = charts['distCombinedChart'];
  if (!chart) return;

  var empty = [];
  for (var j = 0; j < dualMarket.lmsr.N; j++) empty.push(0);

  var cPreview = cPreviewArg, iPreview = iPreviewArg;
  if (cPreview === undefined) {
    var mu = parseFloat(document.getElementById('distMuSlider').value);
    var sigma = getDistSigma();
    var amount = parseFloat(document.getElementById('distAmount').value);
    if (sigma && sigma > 0 && amount > 0) {
      cPreview = computeDistPreview(dualMarket.lmsr, mu, sigma, amount);
      iPreview = computeDistPreview(dualMarket.l2, mu, sigma, amount);
    }
  }

  chart.data.datasets[3].data = cPreview ? cPreview.tokensPerBin : empty;
  chart.data.datasets[4].data = iPreview ? iPreview.tokensPerBin : empty;
  syncChartYAxes(chart);
  chart.update('none');
}

// --- P6-2: Divergence annotation plugin ---
Chart.register({
  id: 'divergenceAnnotation',
  afterDraw: function (chart) {
    if (!chart.options.plugins || !chart.options.plugins.divergenceAnnotation) return;
    // Find cProb and iProb datasets
    var cDs = null, iDs = null, cIdx = -1, iIdx = -1;
    for (var i = 0; i < chart.data.datasets.length; i++) {
      if (chart.data.datasets[i]._datasetKey === 'cProb') { cDs = chart.data.datasets[i]; cIdx = i; }
      if (chart.data.datasets[i]._datasetKey === 'iProb') { iDs = chart.data.datasets[i]; iIdx = i; }
    }
    if (!cDs || !iDs || !cDs.data || !iDs.data) return;

    // Find max divergence
    var maxDiv = 0, maxBin = -1;
    for (var j = 0; j < cDs.data.length; j++) {
      var d = Math.abs(cDs.data[j] - iDs.data[j]);
      if (d > maxDiv) { maxDiv = d; maxBin = j; }
    }
    if (maxBin < 0 || maxDiv < 0.001) return;

    var cMeta = chart.getDatasetMeta(cIdx);
    var iMeta = chart.getDatasetMeta(iIdx);
    if (!cMeta.data[maxBin] || !iMeta.data[maxBin]) return;

    var x = cMeta.data[maxBin].x;
    var y1 = cMeta.data[maxBin].y;
    var y2 = iMeta.data[maxBin].y;

    var ctx = chart.ctx;
    var colors = getChartColors();
    ctx.save();

    // Draw vertical line between the two points
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = colors.danger + '99';
    ctx.lineWidth = 1.5;
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();

    // Draw label
    var labelY = Math.min(y1, y2) - 8;
    ctx.fillStyle = colors.danger;
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u0394' + (maxDiv * 100).toFixed(1) + '%', x, labelY);
    ctx.restore();
  }
});

// ============================================================
// CHART DRAG INTERACTION: Set mu/sigma by dragging on chart
// ============================================================
// Drag horizontally: changes mu (center)
// Drag vertically: changes confidence (up = higher confidence)
// Click: sets mu to clicked x-value
// Ctrl+drag: pan (handled by zoom plugin with modifierKey: 'ctrl')
// Scroll: zoom (unchanged)
var _chartDrag = { active: false, startX: null, startY: null, chartId: null, moved: false };

function getXValueFromPixel(chart, pixelX) {
  var xScale = chart.scales.x;
  if (!xScale) return null;
  var idx = xScale.getValueForPixel(pixelX);
  if (idx == null || !dualMarket || !dualMarket.lmsr) return null;
  var binIdx = Math.round(idx);
  binIdx = Math.max(0, Math.min(dualMarket.lmsr.N - 1, binIdx));
  return dualMarket.lmsr.centers[binIdx];
}

function getConfFromPixelY(chart, pixelY) {
  // Top of chart area = high confidence (100), bottom = low confidence (0)
  var area = chart.chartArea;
  if (!area) return null;
  var ratio = (pixelY - area.top) / (area.bottom - area.top);
  ratio = Math.max(0, Math.min(1, ratio));
  // Invert: top=100, bottom=0
  return Math.round((1 - ratio) * 100);
}

function isInChartArea(chart, x, y) {
  var area = chart.chartArea;
  return area && x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
}

function chartInteractionMouseDown(e, chart) {
  if (!dualMarket || !dualMarket.initialized) return;
  if (e.ctrlKey || e.metaKey) return; // let zoom plugin handle Ctrl+drag for pan
  var rect = chart.canvas.getBoundingClientRect();
  var x = e.clientX - rect.left;
  var y = e.clientY - rect.top;
  if (!isInChartArea(chart, x, y)) return;

  _chartDrag.active = true;
  _chartDrag.startX = x;
  _chartDrag.startY = y;
  _chartDrag.chartId = chart.canvas.id;
  _chartDrag.moved = false;
  chart.canvas.style.cursor = 'grabbing';
  e.preventDefault();
}

function chartInteractionMouseMove(e, chart) {
  if (!dualMarket || !dualMarket.initialized) return;
  var rect = chart.canvas.getBoundingClientRect();
  var x = e.clientX - rect.left;
  var y = e.clientY - rect.top;

  if (!_chartDrag.active) {
    chart.canvas.style.cursor = isInChartArea(chart, x, y) ? 'crosshair' : '';
    return;
  }

  if (chart.canvas.id !== _chartDrag.chartId) return;
  _chartDrag.moved = true;

  var area = chart.chartArea;
  if (!area) return;

  // Clamp to chart area
  var cx = Math.max(area.left, Math.min(area.right, x));
  var cy = Math.max(area.top, Math.min(area.bottom, y));

  var mu = getXValueFromPixel(chart, cx);
  var conf = getConfFromPixelY(chart, cy);
  if (mu != null && conf != null) {
    setMuConfFromChart(mu, conf);
  }
}

function chartInteractionMouseUp(e, chart) {
  if (!_chartDrag.active) return;
  var wasDrag = _chartDrag.moved;
  _chartDrag.active = false;
  _chartDrag.moved = false;

  var rect = chart.canvas.getBoundingClientRect();
  var x = e.clientX - rect.left;
  var y = e.clientY - rect.top;
  chart.canvas.style.cursor = isInChartArea(chart, x, y) ? 'crosshair' : '';

  // If no significant movement, treat as click — set mu only
  if (!wasDrag) {
    var val = getXValueFromPixel(chart, x);
    if (val != null) setMuFromChart(val);
  }
}

function setMuFromChart(mu) {
  if (!dualMarket || !dualMarket.lmsr) return;
  var min = dualMarket.lmsr.rangeMin;
  var max = dualMarket.lmsr.rangeMax;
  mu = Math.max(min, Math.min(max, mu));
  var sl = document.getElementById('distMuSlider');
  sl.value = mu;
  updateSliderFill(sl);
  document.getElementById('distMuInput').value = mu.toFixed(1);
  updateDistLabels();
  schedulePreview();
}

function setMuConfFromChart(mu, conf) {
  if (!dualMarket || !dualMarket.lmsr) return;
  var min = dualMarket.lmsr.rangeMin;
  var max = dualMarket.lmsr.rangeMax;
  mu = Math.max(min, Math.min(max, mu));
  var muSl = document.getElementById('distMuSlider');
  muSl.value = mu;
  updateSliderFill(muSl);
  document.getElementById('distMuInput').value = mu.toFixed(1);

  conf = Math.max(0, Math.min(100, conf));
  var confSl = document.getElementById('distConfSlider');
  confSl.value = conf;
  updateSliderFill(confSl);

  updateDistLabels();
  schedulePreview();
}

function attachChartInteraction(chartId) {
  var canvas = document.getElementById(chartId);
  if (!canvas || canvas._chartInteractionAttached) return;

  canvas.addEventListener('mousedown', function (e) {
    var chart = charts[chartId];
    if (chart) chartInteractionMouseDown(e, chart);
  });
  canvas.addEventListener('mousemove', function (e) {
    var chart = charts[chartId];
    if (chart) chartInteractionMouseMove(e, chart);
  });
  canvas.addEventListener('mouseup', function (e) {
    var chart = charts[chartId];
    if (chart) chartInteractionMouseUp(e, chart);
  });
  canvas.addEventListener('mouseleave', function () {
    if (_chartDrag.active) {
      _chartDrag.active = false;
      _chartDrag.moved = false;
    }
    var canvas = document.getElementById(chartId);
    if (canvas) canvas.style.cursor = '';
  });
  canvas._chartInteractionAttached = true;
}

// --- P6-3: Combined stats (comparison table with delta column) ---
function refreshCombinedDistStats(traderName) {
  if (!dualMarket || !dualMarket.lmsr) return;
  var table = document.getElementById('distComparisonTable');
  if (!table) return;

  if (!traderName) {
    table.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">Select a trader to see comparison</td></tr>';
    return;
  }

  var portfolios = dualMarket.getPortfolios(traderName, solvencyAwareStats);
  if (!portfolios) return;
  var cp = portfolios.lmsr;
  var ip = portfolios.l2;

  table.innerHTML = buildComparisonTableHtml(cp, ip);
}

function buildComparisonTableHtml(cp, ip) {
  var rows = [
    { label: 'Vault', c: dualMarket.lmsr.getPool(), i: dualMarket.l2.getPool(), style: '' },
    { label: 'Wallet', c: cp.wallet, i: ip.wallet, style: '' },
    { label: 'Holdings', c: cp.totalHoldings, i: ip.totalHoldings, style: '' },
    { label: 'E[Payout]', c: cp.expectedPayout, i: ip.expectedPayout, style: '' },
    { label: 'Peak Payout', c: cp.peakPayout, i: ip.peakPayout, style: '' },
    { label: 'Spent', c: cp.totalSpent, i: ip.totalSpent, style: 'color:var(--danger)' },
    { label: 'Received', c: cp.totalReceived, i: ip.totalReceived, style: 'color:var(--success)' },
    { label: 'Unreal. PnL', c: cp.unrealizedPnL, i: ip.unrealizedPnL, style: 'pnl' },
  ];

  var html = '<thead><tr>' +
    '<th>Metric</th>' +
    '<th style="color:var(--primary-light)">LMSR</th>' +
    '<th style="color:var(--accent)">L2-norm</th>' +
    '<th>Delta (I\u2212C)</th>' +
    '</tr></thead><tbody>';

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var delta = row.i - row.c;
    var deltaClass = Math.abs(delta) < 0.005 ? '' : (delta >= 0 ? 'positive' : 'negative');
    var deltaSign = delta >= 0 ? '+' : '';
    var valStyle = '';
    if (row.style === 'pnl') {
      var cPnlClass = row.c >= 0 ? 'positive' : 'negative';
      var iPnlClass = row.i >= 0 ? 'positive' : 'negative';
      html += '<tr>' +
        '<td style="font-weight:600;color:var(--text-heading);text-align:left;">' + row.label + '</td>' +
        '<td class="col-delta ' + cPnlClass + '">' + formatPnl(row.c) + '</td>' +
        '<td class="col-delta ' + iPnlClass + '">' + formatPnl(row.i) + '</td>' +
        '<td class="col-delta ' + deltaClass + '">' + deltaSign + formatCompact(delta) + '</td>' +
        '</tr>';
    } else {
      valStyle = row.style ? ' style="' + row.style + '"' : '';
      html += '<tr>' +
        '<td style="font-weight:600;color:var(--text-heading);text-align:left;">' + row.label + '</td>' +
        '<td class="col-current"' + valStyle + '>' + formatCompact(row.c) + '</td>' +
        '<td class="col-improved"' + valStyle + '>' + formatCompact(row.i) + '</td>' +
        '<td class="col-delta ' + deltaClass + '">' + deltaSign + formatCompact(delta) + '</td>' +
        '</tr>';
    }
  }

  html += '</tbody>';
  return html;
}

// ============================================================
// DATASET TOGGLES
// ============================================================
function toggleDataset(chartId, datasetKey, visible) {
  var chart = charts[chartId];
  if (!chart) return;
  for (var i = 0; i < chart.data.datasets.length; i++) {
    if (chart.data.datasets[i]._datasetKey === datasetKey) {
      chart.setDatasetVisibility(i, visible);
    }
  }
  syncChartYAxes(chart);
  chart.update('none');
}

// Re-apply dataset visibility from checkbox states (after chart recreation)
function reapplyDatasetToggles() {
  var toggles = document.querySelectorAll('.chart-toggle input[type="checkbox"]');
  for (var i = 0; i < toggles.length; i++) {
    var cb = toggles[i];
    if (!cb.checked) {
      var onchange = cb.getAttribute('onchange');
      if (onchange) {
        // Extract chartId and datasetKey from onchange="toggleDataset('id','key',this.checked)"
        var match = onchange.match(/toggleDataset\('([^']+)','([^']+)'/);
        if (match) toggleDataset(match[1], match[2], false);
      }
    }
  }
}

// ============================================================
// CHART RESIZE
// ============================================================
function resizeVisibleCharts() {
  for (var id in charts) {
    if (charts[id] && charts[id].canvas && charts[id].canvas.offsetParent !== null) {
      charts[id].resize();
    }
  }
}

// ============================================================
// SETTINGS
// ============================================================
function openSettings() {
  // Sync button active states with current settings
  var fsMap = { xs: 0, sm: 1, md: 2, lg: 3, xl: 4 };
  var fsBtns = document.querySelectorAll('#fontSizeGroup .btn');
  fsBtns.forEach(function (b, i) { b.classList.toggle('active', i === (fsMap[settings.fontSize] || 2)); });

  var nfBtns = document.querySelectorAll('#numFormatGroup .btn');
  nfBtns.forEach(function (b) {
    var isShort = b.textContent.indexOf('Short') >= 0;
    b.classList.toggle('active', isShort ? settings.numberFormat === 'short' : settings.numberFormat === 'long');
  });

  var thBtns = document.querySelectorAll('#themeGroup .btn');
  thBtns.forEach(function (b) {
    b.classList.toggle('active', b.textContent.trim().toLowerCase() === currentTheme);
  });

  document.getElementById('precSlider').value = settings.decimalPrecision;
  document.getElementById('precDisplay').textContent = settings.decimalPrecision;

  document.getElementById('settingsModal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function setFontSize(size, btn) {
  applyFontSize(size);
  document.querySelectorAll('#fontSizeGroup .btn').forEach(function (b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  saveSettings();
}

function setNumFormat(fmt, btn) {
  settings.numberFormat = fmt;
  document.querySelectorAll('#numFormatGroup .btn').forEach(function (b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  saveSettings();
  refreshAllDisplayedStats();
}

function setDecimalPrec(val) {
  settings.decimalPrecision = parseInt(val, 10);
  document.getElementById('precDisplay').textContent = val;
  saveSettings();
  refreshAllDisplayedStats();
}

function refreshAllDisplayedStats() {
  if (!dualMarket || !dualMarket.initialized) return;
  var traderName = document.getElementById('distTraderSelect').value;
  refreshDistStats(traderName);
  refreshCombinedDistStats(traderName);
  updatePreviewStats();
  var lpName = document.getElementById('lpTraderSelect').value;
  refreshLpStats(lpName);
  refreshLpCombinedTraderStats(lpName);
  updateLpPreview();
  if (chartMode === 'combined') refreshLpCombinedStats(lpName);
  if (dualMarket.lmsr.resolved && lastResolveResult) {
    renderResolveSummary(lastResolveResult, dualMarket.lmsr.lastResolveValue);
    renderPayoutTable(lastResolveResult);
    renderCombinedPayoutTable(lastResolveResult);
  }
  renderTraderList();
  applyStatsMode();
}

function setTheme(t, btn) {
  currentTheme = t;
  applyHtmlClass();
  document.getElementById('themeIcon').textContent = t === 'dark' ? '\u263E' : '\u2600';
  document.querySelectorAll('#themeGroup .btn').forEach(function (b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  updateAllCharts();
  saveSettings();
}

document.getElementById('settingsModal').addEventListener('click', function (e) {
  if (e.target === this) closeSettings();
});

// ============================================================
// STATS MODE: Cards / Table
// ============================================================
function toggleStatsMode() {
  settings.statsMode = settings.statsMode === 'cards' ? 'table' : 'cards';
  updateStatsModeUI();
  applyStatsMode();
  saveSettings();
}

function updateStatsModeUI() {
  var icon = document.getElementById('statsModeIcon');
  var label = document.getElementById('statsModeLabel');
  var btn = document.getElementById('statsModeBtn');
  if (settings.statsMode === 'cards') {
    if (icon) icon.innerHTML = '&#8862;';
    if (label) label.textContent = 'Cards';
    if (btn) btn.title = 'Stats display: Cards (click for Table)';
  } else {
    if (icon) icon.innerHTML = '&#9776;';
    if (label) label.textContent = 'Table';
    if (btn) btn.title = 'Stats display: Table (click for Cards)';
  }
}

function applyStatsMode() {
  var grids = document.querySelectorAll('.result-grid');
  for (var i = 0; i < grids.length; i++) {
    var grid = grids[i];
    if (settings.statsMode === 'table') {
      convertGridToTable(grid);
    } else {
      restoreGridFromTable(grid);
    }
  }
}

function convertGridToTable(grid) {
  var items = grid.querySelectorAll('.result-item');
  if (items.length === 0) {
    // Grid may already be converted (table mode) and not refreshed
    return;
  }
  // Fresh card content — remove stale table-mode if present
  grid.classList.remove('table-mode');

  // Parse children into sections: each non-result-item text element starts a new section
  var children = grid.children;
  var sections = [];
  var currentSection = { label: null, items: [] };

  for (var c = 0; c < children.length; c++) {
    var child = children[c];
    if (child.classList && child.classList.contains('result-item')) {
      currentSection.items.push({
        label: child.querySelector('.result-label') ? child.querySelector('.result-label').textContent : '',
        valueHtml: child.querySelector('.result-value') ? child.querySelector('.result-value').outerHTML : '',
      });
    } else if (child.textContent && child.textContent.trim() && !child.classList.contains('result-table-inner')) {
      if (currentSection.items.length > 0) sections.push(currentSection);
      currentSection = { label: child.textContent.trim(), items: [] };
    }
  }
  if (currentSection.items.length > 0) sections.push(currentSection);
  if (sections.length === 0) return;

  // Store original HTML for restoring on toggle
  grid.setAttribute('data-cards-html', grid.innerHTML);

  var html = '<table class="result-table-inner">';

  if (sections.length === 1 && !sections[0].label) {
    html += '<tr>';
    for (var i = 0; i < sections[0].items.length; i++) html += '<th>' + sections[0].items[i].label + '</th>';
    html += '</tr><tr>';
    for (var i = 0; i < sections[0].items.length; i++) html += '<td>' + sections[0].items[i].valueHtml + '</td>';
    html += '</tr>';
  } else {
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      html += '<tr>';
      if (sec.label) html += '<th style="color:var(--text-heading);text-align:left;font-size:0.66rem;" colspan="1">' + sec.label + '</th>';
      for (var i = 0; i < sec.items.length; i++) html += '<th>' + sec.items[i].label + '</th>';
      html += '</tr><tr>';
      if (sec.label) html += '<td></td>';
      for (var i = 0; i < sec.items.length; i++) html += '<td>' + sec.items[i].valueHtml + '</td>';
      html += '</tr>';
    }
  }
  html += '</table>';

  grid.innerHTML = html;
  grid.classList.add('table-mode');
}

function restoreGridFromTable(grid) {
  if (!grid.classList.contains('table-mode')) return;
  var saved = grid.getAttribute('data-cards-html');
  if (saved) {
    grid.innerHTML = saved;
    grid.removeAttribute('data-cards-html');
  }
  grid.classList.remove('table-mode');
}

