// ============================================================
// DekantPM Comparison — Resolve tab, save/load, payout analysis, app init
// ============================================================
// PHASE 5: RESOLVE TAB
// ============================================================
var lastResolveValue = null;
var lastResolveResult = null;

function resolveMarket() {
  if (!dualMarket || !dualMarket.initialized) return showToast('Create a market first', 'error');

  var value = parseFloat(document.getElementById('resolveInput').value);
  if (isNaN(value)) return showToast('Invalid resolve value', 'error');

  var rangeMin = dualMarket.lmsr.rangeMin;
  var rangeMax = dualMarket.lmsr.rangeMax;
  if (value < rangeMin || value > rangeMax) {
    return showToast('Value must be in range [' + rangeMin + ', ' + rangeMax + ']', 'error');
  }

  var result = dualMarket.resolve(value);
  if (result.error) return showToast(result.error, 'error');
  if (result.lmsr && result.lmsr.error) return showToast('Current: ' + result.lmsr.error, 'error');
  if (result.l2 && result.l2.error) return showToast('Improved: ' + result.l2.error, 'error');

  if (lastResolveValue !== null) {
    document.getElementById('resolvePrevValue').textContent = lastResolveValue.toFixed(1);
  }
  lastResolveValue = value;

  // Store result for re-rendering (format changes etc.)
  lastResolveResult = result;

  renderResolveSummary(result, value);
  renderPayoutTable(result);
  renderKernelChart(result.l2.winningBin);

  document.getElementById('resolveSummaryCard').style.display = '';
  document.getElementById('payoutTableWrapper').style.display = '';
  document.getElementById('kernelVizCard').style.display = '';

  document.getElementById('resolveBtn').textContent = 'Re-resolve';

  // Apply winning bin markers on trading charts
  applyResolutionMarkers();

  renderPayoutAnalysisChart();
  document.getElementById('payoutAnalysisCard').style.display = '';

  applyStatsMode();
  showStoryButton();
  refreshStoryOutdated(); // if a story was already generated, flag it stale after re-resolve

  var label = dualMarket.lmsr.getLabels()[result.lmsr.winningBin] || result.lmsr.winningBin;
  showToast('Resolved at ' + value.toFixed(1) + ' \u2192 bin ' + result.lmsr.winningBin + ' (' + label + ')', 'resolve');
}

// --- Payout Comparison Summary (P5-3) ---
function renderResolveSummary(result, value) {
  var grid = document.getElementById('resolveSummaryGrid');
  var winBin = result.lmsr.winningBin;
  var label = dualMarket.lmsr.getLabels()[winBin] || winBin;

  var cTraderTotal = 0, iTraderTotal = 0;
  var cLpTotal = 0, iLpTotal = 0;
  for (var i = 0; i < result.lmsr.payouts.length; i++) {
    if (result.lmsr.payouts[i].type === 'Trader') cTraderTotal += result.lmsr.payouts[i].payout;
    else cLpTotal += result.lmsr.payouts[i].payout;
  }
  for (var i = 0; i < result.l2.payouts.length; i++) {
    if (result.l2.payouts[i].type === 'Trader') iTraderTotal += result.l2.payouts[i].payout;
    else iLpTotal += result.l2.payouts[i].payout;
  }

  var traderDelta = iTraderTotal - cTraderTotal;
  var traderDeltaClass = traderDelta >= 0 ? 'positive' : 'negative';
  var traderDeltaSign = traderDelta >= 0 ? '+' : '';

  var solvencyClass = result.l2.claimScale >= 1 ? 'positive' : 'negative';
  grid.innerHTML = '' +
    '<div class="result-item"><div class="result-label">Resolve Value</div><div class="result-value">' + value.toFixed(1) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Winning Bin</div><div class="result-value" style="color:var(--success)">' + winBin + ' (' + label + ')</div></div>' +
    '<div class="result-item"><div class="result-label">LMSR Vault</div><div class="result-value">' + formatCompact(dualMarket.lmsr.getPool()) + '</div></div>' +
    '<div class="result-item"><div class="result-label">L2 Solvency Factor</div><div class="result-value ' + solvencyClass + '">' + (result.l2.claimScale * 100).toFixed(2) + '%</div></div>' +
    '<div class="result-item"><div class="result-label">LMSR Trader Payouts</div><div class="result-value" style="color:var(--primary-light)">' + formatCompact(cTraderTotal) + '</div></div>' +
    '<div class="result-item"><div class="result-label">L2 Trader Payouts</div><div class="result-value" style="color:var(--accent)">' + formatCompact(iTraderTotal) + '</div></div>' +
    '<div class="result-item"><div class="result-label">LMSR LP Residual</div><div class="result-value" style="color:var(--primary-light)">' + formatCompact(result.lmsr.lpResidual) + '</div></div>' +
    '<div class="result-item"><div class="result-label">L2 LP Residual</div><div class="result-value" style="color:var(--accent)">' + formatCompact(result.l2.lpResidual) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Trader Delta (I-C)</div><div class="result-value ' + traderDeltaClass + '">' + traderDeltaSign + formatCompact(traderDelta) + '</div></div>';
}

// --- Dual Payout Table (P5-2) ---
function renderPayoutRow(p, model, separator) {
  var pnlPct = p.spent > 0 ? (p.netPnL / p.spent * 100).toFixed(1) : '0.0';
  var pnlClass = p.netPnL >= 0 ? 'pnl-positive' : 'pnl-negative';
  var pnlSign = p.netPnL >= 0 ? '+' : '';
  var modelLabel = model === 'lmsr' ? 'LMSR' : 'L2-norm';
  var rowClass = 'row-' + model + (separator ? ' row-separator' : '');

  return '<tr class="' + rowClass + '">' +
    '<td style="font-weight:700;color:var(--text-heading);text-align:left;">' + p.name + ' (' + p.type + ')</td>' +
    '<td>' + modelLabel + '</td>' +
    '<td style="text-align:left;font-size:0.78rem;">' + p.detail + '</td>' +
    '<td>' + formatCompact(p.grossPayout) + '</td>' +
    '<td>' + formatCompact(p.fee) + '</td>' +
    '<td>' + formatCompact(p.payout) + '</td>' +
    '<td>' + formatCompact(p.spent) + '</td>' +
    '<td>' + formatCompact(p.received) + '</td>' +
    '<td class="' + pnlClass + '">' + pnlSign + formatCompact(p.netPnL) + '</td>' +
    '<td class="' + pnlClass + '">' + pnlSign + pnlPct + '%</td>' +
    '</tr>';
}

function renderPayoutTable(result) {
  var tbody = document.getElementById('payoutTableBody');
  var cPayouts = result.lmsr.payouts;
  var iPayouts = result.l2.payouts;

  // Map improved payouts by name+type
  var iMap = {};
  for (var i = 0; i < iPayouts.length; i++) {
    iMap[iPayouts[i].name + ':' + iPayouts[i].type] = iPayouts[i];
  }

  var html = '';
  for (var i = 0; i < cPayouts.length; i++) {
    var cp = cPayouts[i];
    var ip = iMap[cp.name + ':' + cp.type];
    var isLast = (i === cPayouts.length - 1);

    html += renderPayoutRow(cp, 'lmsr', false);
    if (ip) {
      html += renderPayoutRow(ip, 'l2', !isLast);
    }
  }

  tbody.innerHTML = html;
  renderCombinedPayoutTable(result);
}

function renderCombinedPayoutTable(result) {
  var wrapper = document.getElementById('combinedPayoutWrapper');
  var tbody = document.getElementById('combinedPayoutBody');
  if (!wrapper || !tbody) return;

  // Build maps: name -> payout for traders and LPs, per model
  var cTraders = {}, cLps = {}, iTraders = {}, iLps = {};
  for (var i = 0; i < result.lmsr.payouts.length; i++) {
    var p = result.lmsr.payouts[i];
    if (p.type === 'Trader') cTraders[p.name] = p;
    else cLps[p.name] = p;
  }
  for (var i = 0; i < result.l2.payouts.length; i++) {
    var p = result.l2.payouts[i];
    if (p.type === 'Trader') iTraders[p.name] = p;
    else iLps[p.name] = p;
  }

  // Find names that appear in both trader and LP
  var dualNames = [];
  for (var name in cTraders) {
    if (cLps[name]) dualNames.push(name);
  }

  if (dualNames.length === 0) {
    wrapper.style.display = 'none';
    return;
  }

  var html = '';
  for (var d = 0; d < dualNames.length; d++) {
    var name = dualNames[d];
    var ct = cTraders[name], cl = cLps[name];
    var it = iTraders[name], il = iLps[name];

    // Current model combined row
    var cTotalPayout = ct.payout + cl.payout;
    var cTotalSpent = ct.spent + cl.spent;
    var cTotalReceived = ct.received + cl.received;
    var cNetPnL = ct.netPnL + cl.netPnL;
    var cPnlPct = cTotalSpent > 0 ? (cNetPnL / cTotalSpent * 100).toFixed(1) : '0.0';
    var cPnlClass = cNetPnL >= 0 ? 'pnl-positive' : 'pnl-negative';
    var cPnlSign = cNetPnL >= 0 ? '+' : '';

    html += '<tr class="row-current">' +
      '<td style="font-weight:700;color:var(--text-heading);text-align:left;">' + name + '</td>' +
      '<td>LMSR</td>' +
      '<td>' + formatCompact(ct.payout) + '</td>' +
      '<td>' + formatCompact(cl.payout) + '</td>' +
      '<td style="font-weight:700;">' + formatCompact(cTotalPayout) + '</td>' +
      '<td>' + formatCompact(cTotalSpent) + '</td>' +
      '<td>' + formatCompact(cTotalReceived) + '</td>' +
      '<td class="' + cPnlClass + '">' + cPnlSign + formatCompact(cNetPnL) + '</td>' +
      '<td class="' + cPnlClass + '">' + cPnlSign + cPnlPct + '%</td>' +
      '</tr>';

    // Improved model combined row
    if (it && il) {
      var iTotalPayout = it.payout + il.payout;
      var iTotalSpent = it.spent + il.spent;
      var iTotalReceived = it.received + il.received;
      var iNetPnL = it.netPnL + il.netPnL;
      var iPnlPct = iTotalSpent > 0 ? (iNetPnL / iTotalSpent * 100).toFixed(1) : '0.0';
      var iPnlClass = iNetPnL >= 0 ? 'pnl-positive' : 'pnl-negative';
      var iPnlSign = iNetPnL >= 0 ? '+' : '';
      var isLast = (d === dualNames.length - 1);

      html += '<tr class="row-improved' + (isLast ? '' : ' row-separator') + '">' +
        '<td style="font-weight:700;color:var(--text-heading);text-align:left;">' + name + '</td>' +
        '<td>L2-norm</td>' +
        '<td>' + formatCompact(it.payout) + '</td>' +
        '<td>' + formatCompact(il.payout) + '</td>' +
        '<td style="font-weight:700;">' + formatCompact(iTotalPayout) + '</td>' +
        '<td>' + formatCompact(iTotalSpent) + '</td>' +
        '<td>' + formatCompact(iTotalReceived) + '</td>' +
        '<td class="' + iPnlClass + '">' + iPnlSign + formatCompact(iNetPnL) + '</td>' +
        '<td class="' + iPnlClass + '">' + iPnlSign + iPnlPct + '%</td>' +
        '</tr>';
    }
  }

  tbody.innerHTML = html;
  wrapper.style.display = '';
}

// --- Kernel Visualization (P5-4) ---
var kernelZoomed = false;
var lastKernelWinBin = -1;

function renderKernelChart(winBin) {
  lastKernelWinBin = winBin;
  var N = dualMarket.l2.N;
  var W = dualMarket.l2.kernelWidth;
  var kernel = dualMarket.l2.getSettlementKernel(winBin);
  var labels = dualMarket.l2.getLabels();
  var colors = getChartColors();

  // Show zoom button when bins are high relative to kernel width
  var zoomBtn = document.getElementById('kernelZoomBtn');
  if (zoomBtn) {
    zoomBtn.style.display = N > (W + 1) * 6 ? '' : 'none';
    zoomBtn.textContent = kernelZoomed ? 'Show All Bins' : 'Zoom to Kernel';
  }

  var startBin = 0, endBin = N - 1;
  if (kernelZoomed) {
    startBin = Math.max(0, winBin - W * 2 - 2);
    endBin = Math.min(N - 1, winBin + W * 2 + 2);
  }

  var displayLabels = [], displayKernel = [], barColors = [], borderCol = [];
  for (var i = startBin; i <= endBin; i++) {
    displayLabels.push(labels[i]);
    displayKernel.push(kernel[i]);
    if (kernel[i] > 0) {
      barColors.push(i === winBin ? colors.success + 'CC' : colors.accent + '66');
      borderCol.push(i === winBin ? colors.success : colors.accent);
    } else {
      barColors.push('transparent');
      borderCol.push('transparent');
    }
  }

  var markerIdx = kernelZoomed ? winBin - startBin : winBin;

  getOrCreateChart('kernelChart', {
    type: 'bar',
    data: {
      labels: displayLabels,
      datasets: [{
        label: 'Kernel Weight',
        data: displayKernel,
        backgroundColor: barColors,
        borderColor: borderCol,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        winBinMarker: { winBin: markerIdx },
        tooltip: {
          callbacks: {
            title: function (items) { return 'Bin ' + (items[0].dataIndex + startBin); },
            label: function (ctx) { return 'K = ' + ctx.raw.toFixed(4); },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: colors.textMuted, font: { size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 20 },
          grid: { color: colors.grid },
        },
        y: {
          min: 0, max: 1.1,
          title: { display: true, text: 'Kernel Weight', color: colors.textMuted, font: { size: 10 } },
          ticks: { color: colors.textMuted, font: { size: 9 } },
          grid: { color: colors.grid },
        },
      },
    },
  });
}

function toggleKernelZoom() {
  kernelZoomed = !kernelZoomed;
  if (lastKernelWinBin >= 0) renderKernelChart(lastKernelWinBin);
}

// --- Resolution Chart Markers (P5-6) ---
function applyResolutionMarkers() {
  if (!dualMarket || !dualMarket.lmsr || !dualMarket.lmsr.resolved) return;
  var winBin = dualMarket.lmsr.winningBin;
  var chartIds = ['distCurrentChart', 'distImprovedChart', 'distCombinedChart'];
  for (var c = 0; c < chartIds.length; c++) {
    var chart = charts[chartIds[c]];
    if (chart) {
      if (!chart.options.plugins) chart.options.plugins = {};
      chart.options.plugins.winBinMarker = { winBin: winBin };
      chart.update('none');
    }
  }
}

// ============================================================
// SAVE / LOAD MARKET STATE
// ============================================================
function saveMarketState() {
  if (!dualMarket || !dualMarket.initialized) return showToast('No market to save', 'error');
  try {
    var data = { market: dualMarket.serialize(), traderRegistry: traderRegistry };
    localStorage.setItem('dekantpm_saved_market_v1', JSON.stringify(data));
    showToast('Market state saved', 'info');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

function loadMarketState() {
  try {
    var raw = localStorage.getItem('dekantpm_saved_market_v1');
    if (!raw) return showToast('No saved market found', 'error');
    var data = JSON.parse(raw);

    traderRegistry = data.traderRegistry || [];
    saveTraderRegistry();

    dualMarket = DualMarket.loadFromSave(data.market);
    marketCreated = true;
    document.getElementById('storyCard').style.display = 'none';
    resetStoryState();

    var cfg = dualMarket.initConfig;

    var binsSel = document.getElementById('setupBins');
    var found = false;
    for (var i = 0; i < binsSel.options.length; i++) {
      if (binsSel.options[i].value === String(cfg.N)) { binsSel.value = String(cfg.N); found = true; break; }
    }
    if (!found) {
      binsSel.value = 'custom';
      document.getElementById('setupBinsCustom').value = cfg.N;
      document.getElementById('setupBinsCustom').classList.add('visible');
    }

    document.getElementById('setupRangeMin').value = cfg.rangeMin;
    document.getElementById('setupRangeMax').value = cfg.rangeMax;
    document.getElementById('setupLiquidity').value = cfg.liquidity;
    document.getElementById('setupKernelWidth').value = cfg.kernelWidth;
    document.getElementById('setupTradeFeeBps').value = cfg.fees.tradeFeeBps;
    document.getElementById('setupLpFeeSharePct').value = cfg.fees.lpFeeSharePct;
    document.getElementById('setupRedemptionFeeBps').value = cfg.fees.redemptionFeeBps;
    var loadedMode = (cfg.fees.lmsrMode === 'lslmsr') ? 'lslmsr' : 'lmsr';
    document.getElementById('setupLmsrMode').value = loadedMode;
    if (typeof cfg.fees.lsSensitivity === 'number') {
      document.getElementById('setupLsSensitivity').value = Math.round(cfg.fees.lsSensitivity * 100);
    }
    onLmsrModeChange(document.getElementById('setupLmsrMode'));
    updateEngineLabels();

    document.getElementById('distMuSlider').min = cfg.rangeMin;
    document.getElementById('distMuSlider').max = cfg.rangeMax;
    document.getElementById('distMuSlider').value = (cfg.rangeMin + cfg.rangeMax) / 2;
    document.getElementById('distMuInput').min = cfg.rangeMin;
    document.getElementById('distMuInput').max = cfg.rangeMax;
    document.getElementById('distMuInput').value = ((cfg.rangeMin + cfg.rangeMax) / 2).toFixed(1);
    updateDistLabels();

    document.getElementById('resolveSlider').min = cfg.rangeMin;
    document.getElementById('resolveSlider').max = cfg.rangeMax;
    document.getElementById('resolveSlider').value = (cfg.rangeMin + cfg.rangeMax) / 2;
    document.getElementById('resolveInput').min = cfg.rangeMin;
    document.getElementById('resolveInput').max = cfg.rangeMax;
    document.getElementById('resolveInput').value = ((cfg.rangeMin + cfg.rangeMax) / 2).toFixed(1);
    document.getElementById('resolveKernelWidthDisplay').textContent = cfg.kernelWidth;

    lastResolveValue = dualMarket.lmsr.lastResolveValue;
    document.getElementById('resolveBtn').textContent = dualMarket.lmsr.resolved ? 'Re-resolve' : 'Resolve';
    document.getElementById('resolvePrevValue').textContent = lastResolveValue != null ? lastResolveValue.toFixed(1) : '—';

    enableTradingTabs();
    lpChartsInitialized = false;
    initDistCharts();
    initCombinedDistChart();
    renderTraderList();
    updateTraderSelectors();
    refreshDistCharts();

    if (dualMarket.lmsr.resolved) {
      // Re-resolve to get accurate lpResidual/claimScale for display. This would
      // append a duplicate 'resolve' entry to the restored timeline, so snapshot
      // and restore history around the call.
      var savedHistory = dualMarket.history;
      dualMarket.history = savedHistory.slice();
      var rr = dualMarket.resolve(dualMarket.lmsr.lastResolveValue);
      dualMarket.history = savedHistory;
      lastResolveResult = rr;
      renderResolveSummary(rr, dualMarket.lmsr.lastResolveValue);
      renderPayoutTable(rr);
      renderKernelChart(dualMarket.l2.winningBin);
      document.getElementById('resolveSummaryCard').style.display = '';
      document.getElementById('payoutTableWrapper').style.display = '';
      document.getElementById('kernelVizCard').style.display = '';
      applyResolutionMarkers();
      renderPayoutAnalysisChart();
      document.getElementById('payoutAnalysisCard').style.display = '';
      showStoryButton();
    }

    updateSaveLoadBtn();
    initSliderFills();
    showToast('Market loaded (' + cfg.N + ' bins)', 'info');
  } catch (e) {
    showToast('Load failed: ' + e.message, 'error');
  }
}

function hasSavedMarket() {
  try { return !!localStorage.getItem('dekantpm_saved_market_v1'); } catch (e) { return false; }
}

function updateSaveLoadBtn() {
  var btn = document.getElementById('saveLoadBtn');
  if (!btn) return;
  if (!marketCreated && hasSavedMarket()) {
    btn.textContent = 'Load';
    btn.title = 'Load previously saved market';
    btn.onclick = loadMarketState;
    btn.disabled = false;
  } else {
    btn.textContent = 'Save';
    btn.title = marketCreated ? 'Save market state' : 'Create a market first';
    btn.onclick = saveMarketState;
    btn.disabled = !marketCreated;
  }
}

// ============================================================
// INPUT MODAL (replaces native prompt())
// ============================================================
function showInputModal(title, text, defaultValue, onSubmit) {
  document.getElementById('inputModalTitle').textContent = title;
  var textEl = document.getElementById('inputModalText');
  if (text) { textEl.textContent = text; textEl.style.display = ''; }
  else { textEl.style.display = 'none'; }
  var field = document.getElementById('inputModalField');
  field.value = defaultValue || '';
  var submitBtn = document.getElementById('inputModalSubmit');
  var handler = function () { closeInputModal(); if (onSubmit) onSubmit(field.value); };
  submitBtn.onclick = handler;
  field.onkeydown = function (e) { if (e.key === 'Enter') handler(); };
  document.getElementById('inputModal').classList.add('open');
  setTimeout(function () { field.focus(); field.select(); }, 50);
}

function closeInputModal() {
  document.getElementById('inputModal').classList.remove('open');
}

document.getElementById('inputModal').addEventListener('click', function (e) {
  if (e.target === this) closeInputModal();
});

// ============================================================
// PAYOUT ANALYSIS CHART
// ============================================================
var PARTICIPANT_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

var payoutAnalysisYAxis = 'payout';
var payoutAnalysisFilter = 'both';
var payoutAnalysisHidden = {};

function getPayoutAnalysisParticipants() {
  if (!dualMarket || !dualMarket.initialized) return [];
  var participants = [];
  var seen = {};
  var fm = payoutAnalysisFilter;

  if (fm === 'trader' || fm === 'both') {
    for (var name in dualMarket.lmsr.traderHoldings) {
      var th = dualMarket.lmsr.traderHoldings[name];
      var has = false;
      for (var j = 0; j < dualMarket.lmsr.N; j++) {
        if (th.holdings[j] > 0.01) { has = true; break; }
      }
      if (has || th.spent > 0) {
        participants.push({ name: name, type: 'trader' });
        seen[name] = true;
      }
    }
  }

  if (fm === 'lp' || fm === 'both') {
    for (var name in dualMarket.lmsr.lpProviders) {
      var lp = dualMarket.lmsr.lpProviders[name];
      if (lp.shares > 0 || lp.deposited > 0) {
        if (seen[name] && fm === 'both') {
          for (var i = 0; i < participants.length; i++) {
            if (participants[i].name === name) { participants[i].type = 'both'; break; }
          }
        } else if (!seen[name]) {
          participants.push({ name: name, type: 'lp' });
          seen[name] = true;
        }
      }
    }
  }

  return participants;
}

function computePayoutAnalysisData(engine, participant) {
  var N = engine.N;
  var name = participant.name;
  var pType = participant.type;
  var traderPayouts = null, lpPayouts = null;
  var spent = 0, received = 0;

  if (pType === 'trader' || pType === 'both') {
    traderPayouts = engine.getTraderPayoutPerOutcome(name);
    var th = engine.traderHoldings[name];
    if (th) { spent += th.spent; received += th.received; }
  }

  if (pType === 'lp' || pType === 'both') {
    var lpP = engine.getLpPortfolio(name);
    if (lpP) {
      lpPayouts = lpP.payoutPerOutcome;
      spent += lpP.deposited;
      received += lpP.withdrawn;
    }
  }

  var data = [];
  for (var w = 0; w < N; w++) {
    var payout = 0;
    if (traderPayouts) payout += traderPayouts[w];
    if (lpPayouts) payout += lpPayouts[w];
    if (payoutAnalysisYAxis === 'payout') {
      data.push(payout);
    } else if (payoutAnalysisYAxis === 'profit') {
      data.push(payout + received - spent);
    } else {
      var profit = payout + received - spent;
      data.push(spent > 0 ? (profit / spent) * 100 : 0);
    }
  }
  return data;
}

function buildPayoutAnalysisConfig(engine, participants, labels, chartColors, panelType) {
  var N = engine ? engine.N : dualMarket.lmsr.N;
  var large = N >= 128;
  var yTitle = payoutAnalysisYAxis === 'payout' ? 'Payout'
    : payoutAnalysisYAxis === 'profit' ? 'Profit (Payout + Received − Spent)'
    : 'PnL (%)';
  var yTickCb = payoutAnalysisYAxis === 'pnl'
    ? function (v) { return v.toFixed(1) + '%'; }
    : function (v) { return formatCompact(v); };

  var datasets = [];

  if (panelType === 'combined') {
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      var color = PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length];
      var hidden = !!payoutAnalysisHidden[p.name];
      var cData = computePayoutAnalysisData(dualMarket.lmsr, p);
      var iData = computePayoutAnalysisData(dualMarket.l2, p);
      datasets.push({
        label: p.name + ' (C)',
        data: cData, borderColor: color, backgroundColor: color + '18',
        borderWidth: 2, pointRadius: 0, pointHoverRadius: large ? 0 : 3,
        fill: false, tension: large ? 0 : 0.3, hidden: hidden,
        _participantName: p.name,
      });
      datasets.push({
        label: p.name + ' (I)',
        data: iData, borderColor: color, backgroundColor: color + '18',
        borderWidth: 2, borderDash: [6, 3], pointRadius: 0, pointHoverRadius: large ? 0 : 3,
        fill: false, tension: large ? 0 : 0.3, hidden: hidden,
        _participantName: p.name,
      });
    }
  } else {
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      var color = PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length];
      var hidden = !!payoutAnalysisHidden[p.name];
      var data = computePayoutAnalysisData(engine, p);
      datasets.push({
        label: p.name,
        data: data, borderColor: color, backgroundColor: color + '22',
        borderWidth: 2, pointRadius: 0, pointHoverRadius: large ? 0 : 3,
        fill: false, tension: large ? 0 : 0.3, hidden: hidden,
        _participantName: p.name,
      });
    }
  }

  if (payoutAnalysisYAxis !== 'payout') {
    var zeroLine = [];
    for (var j = 0; j < N; j++) zeroLine.push(0);
    datasets.push({
      label: 'Break-even', data: zeroLine,
      borderColor: chartColors.textMuted, borderWidth: 1, borderDash: [4, 4],
      pointRadius: 0, fill: false, tension: 0, _participantName: '__zero__',
    });
  }

  return {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              if (ctx.dataset._participantName === '__zero__') return null;
              return ctx.dataset.label + ': ' + (payoutAnalysisYAxis === 'pnl' ? ctx.raw.toFixed(1) + '%' : formatCompact(ctx.raw));
            },
          },
        },
        zoom: getZoomPluginConfig(),
      },
      scales: {
        x: {
          ticks: { color: chartColors.textMuted, font: { size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 20 },
          grid: { color: chartColors.grid },
        },
        y: {
          title: { display: true, text: yTitle, color: chartColors.textMuted, font: { size: 10 } },
          ticks: { color: chartColors.textMuted, font: { size: 9 }, callback: yTickCb },
          grid: { color: chartColors.grid },
        },
      },
    },
  };
}

function renderPayoutAnalysisChart() {
  var card = document.getElementById('payoutAnalysisCard');
  if (!dualMarket || !dualMarket.initialized) { if (card) card.style.display = 'none'; return; }

  var participants = getPayoutAnalysisParticipants();
  if (participants.length === 0) { if (card) card.style.display = 'none'; return; }
  if (card) card.style.display = '';

  var labels = dualMarket.lmsr.getLabels();
  var colors = getChartColors();

  var togglesEl = document.getElementById('payoutParticipantToggles');
  if (togglesEl) {
    var th = '';
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      var c = PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length];
      var checked = !payoutAnalysisHidden[p.name] ? ' checked' : '';
      var typeLabel = p.type === 'both' ? ' (T+LP)' : (p.type === 'lp' ? ' (LP)' : '');
      th += '<label class="chart-toggle"><input type="checkbox"' + checked +
        ' onchange="togglePayoutParticipant(\'' + p.name.replace(/'/g, "\\'") + '\',this.checked)">' +
        '<span class="curve-dot" style="background:' + c + '"></span> ' + p.name + typeLabel + '</label>';
    }
    togglesEl.innerHTML = th;
  }

  getOrCreateChart('payoutAnalysisCurrentChart',
    buildPayoutAnalysisConfig(dualMarket.lmsr, participants, labels, colors, 'lmsr'));
  getOrCreateChart('payoutAnalysisImprovedChart',
    buildPayoutAnalysisConfig(dualMarket.l2, participants, labels, colors, 'l2'));
  getOrCreateChart('payoutAnalysisCombinedChart',
    buildPayoutAnalysisConfig(null, participants, labels, colors, 'combined'));
}

function setPayoutYAxis(mode, btn) {
  payoutAnalysisYAxis = mode;
  var btns = document.querySelectorAll('#payoutYAxisGroup .chart-mode-btn');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  if (btn) btn.classList.add('active');
  renderPayoutAnalysisChart();
}

function setPayoutFilter(mode, btn) {
  payoutAnalysisFilter = mode;
  var btns = document.querySelectorAll('#payoutFilterGroup .chart-mode-btn');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  if (btn) btn.classList.add('active');
  renderPayoutAnalysisChart();
}

function togglePayoutParticipant(name, visible) {
  if (visible) { delete payoutAnalysisHidden[name]; }
  else { payoutAnalysisHidden[name] = true; }
  var ids = ['payoutAnalysisCurrentChart', 'payoutAnalysisImprovedChart', 'payoutAnalysisCombinedChart'];
  for (var c = 0; c < ids.length; c++) {
    var chart = charts[ids[c]];
    if (!chart) continue;
    for (var i = 0; i < chart.data.datasets.length; i++) {
      if (chart.data.datasets[i]._participantName === name) {
        chart.setDatasetVisibility(i, visible);
      }
    }
    chart.update('none');
  }
}

// ============================================================
// INIT
// ============================================================
(function () {
  loadSettings();
  loadTraderRegistry();
  applyHtmlClass();
  applyFontSize(settings.fontSize);
  document.getElementById('themeIcon').textContent = currentTheme === 'dark' ? '\u263E' : '\u2600';

  // Restore auto-fit Y toggle
  try {
    var saved = localStorage.getItem('dekantpm_autoFitY');
    if (saved !== null) {
      autoFitY = saved === 'true';
      var toggle = document.getElementById('autoFitYToggle');
      if (toggle) toggle.checked = autoFitY;
      var label = document.getElementById('autoFitYLabel');
      if (label) label.textContent = autoFitY ? 'Auto' : 'Manual';
    }
  } catch (e) { /* ignore */ }

  renderTraderList();
  updateTraderSelectors();

  updateStatsModeUI();

  updateSaveLoadBtn();

  initSliderFills();
})();
