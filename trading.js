// ============================================================
// DekantPM Comparison — Trading tab: distribution trading + live preview
// ============================================================
// PHASE 4: DISTRIBUTION TRADING
// ============================================================
function buildDistChartConfig(labels, probData, posData, previewData, colorScheme) {
  var colors = getChartColors();
  var probColor = colorScheme === 'l2' ? colors.accent : colors.primary;
  var posColor = colors.warning;
  var large = isLargeMarket();
  return {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Probability',
          data: probData,
          borderColor: probColor,
          backgroundColor: probColor + '22',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: large ? 0 : 4,
          fill: !large,
          tension: large ? 0 : 0.3,
          yAxisID: 'yProb',
          order: 1,
          _datasetKey: 'prob',
        },
        {
          label: 'Holdings',
          data: posData,
          borderColor: posColor,
          backgroundColor: posColor + '33',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: large ? 0 : 3,
          fill: !large,
          tension: large ? 0 : 0.3,
          yAxisID: 'yPos',
          order: 3,
          _datasetKey: 'pos',
        },
        {
          label: 'Preview',
          data: previewData,
          borderColor: colors.purple,
          backgroundColor: colors.purple + '22',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: large ? 0 : 3,
          borderDash: [6, 3],
          fill: !large,
          tension: large ? 0 : 0.3,
          yAxisID: 'yPos',
          order: 2,
          _datasetKey: 'preview',
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
              if (ctx.dataset._datasetKey === 'prob') return 'P: ' + (ctx.raw * 100).toFixed(2) + '%';
              if (ctx.dataset._datasetKey === 'preview') return 'Preview: ' + formatCompact(ctx.raw);
              return 'Holdings: ' + formatCompact(ctx.raw);
            },
          },
        },
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

function initDistCharts() {
  if (!dualMarket || !dualMarket.lmsr) return;
  var labels = dualMarket.lmsr.getLabels();
  var cProbs = dualMarket.lmsr.getProbabilities();
  var iProbs = dualMarket.l2.getProbabilities();
  var empty = [];
  for (var j = 0; j < dualMarket.lmsr.N; j++) empty.push(0);

  getOrCreateChart('distCurrentChart', buildDistChartConfig(labels, cProbs, empty.slice(), empty.slice(), 'lmsr'));
  getOrCreateChart('distImprovedChart', buildDistChartConfig(labels, iProbs, empty.slice(), empty.slice(), 'l2'));
  attachChartInteraction('distCurrentChart');
  attachChartInteraction('distImprovedChart');
}

function refreshDistCharts() {
  if (!dualMarket || !dualMarket.lmsr) return;

  var traderName = document.getElementById('distTraderSelect').value;
  var cProbs = dualMarket.lmsr.getProbabilities();
  var iProbs = dualMarket.l2.getProbabilities();

  var cHoldings = [], iHoldings = [];
  for (var j = 0; j < dualMarket.lmsr.N; j++) {
    cHoldings.push(0);
    iHoldings.push(0);
  }
  if (traderName) {
    var cTh = dualMarket.lmsr.traderHoldings[traderName];
    var iTh = dualMarket.l2.traderHoldings[traderName];
    if (cTh) cHoldings = cTh.holdings.slice();
    if (iTh) iHoldings = iTh.holdings.slice();
  }

  // Zero out preview to avoid stale flicker before updateDistPreview re-fills it
  var empty = [];
  for (var e = 0; e < dualMarket.lmsr.N; e++) empty.push(0);

  if (chartMode === 'combined') {
    refreshCombinedDistChart();
  } else {
    var cc = charts['distCurrentChart'];
    if (cc) {
      cc.data.datasets[0].data = cProbs;
      cc.data.datasets[1].data = cHoldings;
      if (cc.data.datasets[2]) cc.data.datasets[2].data = empty.slice();
      syncChartYAxes(cc);
      cc.update('none');
    }
    var ic = charts['distImprovedChart'];
    if (ic) {
      ic.data.datasets[0].data = iProbs;
      ic.data.datasets[1].data = iHoldings;
      if (ic.data.datasets[2]) ic.data.datasets[2].data = empty.slice();
      syncChartYAxes(ic);
      ic.update('none');
    }
  }

  refreshDistStats(traderName);
  if (chartMode === 'combined') refreshCombinedDistStats(traderName);
  updateDistPreview();
  applyStatsMode();
}

function refreshDistStats(traderName) {
  if (!dualMarket || !dualMarket.lmsr) return;

  var cGrid = document.getElementById('distStatsCurrentGrid');
  var iGrid = document.getElementById('distStatsImprovedGrid');

  if (!traderName) {
    var emptyHtml = '<div class="result-item"><div class="result-label">Select a trader</div><div class="result-value">—</div></div>';
    if (cGrid) cGrid.innerHTML = emptyHtml;
    if (iGrid) iGrid.innerHTML = emptyHtml;
    return;
  }

  var portfolios = dualMarket.getPortfolios(traderName, solvencyAwareStats);
  if (!portfolios) return;

  var cp = portfolios.lmsr;
  var ip = portfolios.l2;

  function statsHtml(p, engine) {
    var k = engine === 'lmsr' ? dualMarket.lmsr.getPool() : dualMarket.l2.getPool();
    var pnlClass = p.unrealizedPnL >= 0 ? 'positive' : 'negative';
    var epClass = p.expectedPayout > p.totalSpent ? 'positive' : (p.expectedPayout < p.totalSpent && p.totalSpent > 0 ? 'negative' : '');
    return '' +
      '<div class="result-item"><div class="result-label">Vault</div><div class="result-value">' + formatCompact(k) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Wallet</div><div class="result-value">' + formatCompact(p.wallet) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Holdings</div><div class="result-value">' + formatCompact(p.totalHoldings) + '</div></div>' +
      '<div class="result-item"><div class="result-label">E[Payout]</div><div class="result-value ' + epClass + '">' + formatCompact(p.expectedPayout) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Peak Payout</div><div class="result-value">' + formatCompact(p.peakPayout) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Spent</div><div class="result-value" style="color:var(--danger)">' + formatCompact(p.totalSpent) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Received</div><div class="result-value" style="color:var(--success)">' + formatCompact(p.totalReceived) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Unreal. PnL</div><div class="result-value ' + pnlClass + '">' + formatPnl(p.unrealizedPnL) + '</div></div>';
  }

  if (cGrid) cGrid.innerHTML = statsHtml(cp, 'lmsr');
  if (iGrid) iGrid.innerHTML = statsHtml(ip, 'l2');
}

// Non-mutating preview that matches the engine's real distributionBuy exactly
// (L2-norm or LMSR). Returns { tokensPerBin, totalTokens, peakPayout, peakBin,
// fee, cost } or null.
function computeDistPreview(engine, mu, sigma, amount) {
  return engine.previewDistributionBuy(mu, sigma, amount);
}

function updateDistPreview() {
  if (!dualMarket || !dualMarket.lmsr) return;

  var mu = parseFloat(document.getElementById('distMuSlider').value);
  var sigma = getDistSigma();
  var amount = parseFloat(document.getElementById('distAmount').value);

  var cPreview = null, iPreview = null;
  if (sigma && sigma > 0 && amount > 0) {
    cPreview = computeDistPreview(dualMarket.lmsr, mu, sigma, amount);
    iPreview = computeDistPreview(dualMarket.l2, mu, sigma, amount);
  }

  var empty = [];
  for (var j = 0; j < dualMarket.lmsr.N; j++) empty.push(0);

  if (chartMode === 'combined') {
    var xc = charts['distCombinedChart'];
    if (xc) {
      xc.data.datasets[3].data = cPreview ? cPreview.tokensPerBin : empty;
      xc.data.datasets[4].data = iPreview ? iPreview.tokensPerBin : empty;
      syncChartYAxes(xc);
      xc.update('none');
    }
  } else {
    var cc = charts['distCurrentChart'];
    if (cc && cc.data.datasets[2]) {
      cc.data.datasets[2].data = cPreview ? cPreview.tokensPerBin : empty;
      syncChartYAxes(cc);
      cc.update('none');
    }
    var ic = charts['distImprovedChart'];
    if (ic && ic.data.datasets[2]) {
      ic.data.datasets[2].data = iPreview ? iPreview.tokensPerBin : empty;
      syncChartYAxes(ic);
      ic.update('none');
    }
  }

  updatePreviewStats(cPreview, iPreview);
}

// ============================================================
// TRADE PREVIEW STATS
// ============================================================
function updatePreviewStats(cPreviewArg, iPreviewArg) {
  if (!dualMarket || !dualMarket.lmsr) return;

  var splitPanel = document.getElementById('distPreviewStats');
  var combinedPanel = document.getElementById('distPreviewCombined');
  var isCombined = chartMode === 'combined';

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

  if (!cPreview || !iPreview) {
    if (splitPanel) splitPanel.style.display = 'none';
    if (combinedPanel) combinedPanel.style.display = 'none';
    return;
  }

  var labels = dualMarket.lmsr.getLabels();

  // Stats come straight from the engine previews (LMSR / L2-norm), so they match
  // the executed trade exactly — both use the shared kernel-weighted peak payout.
  // The Solvency toggle swaps the raw best-case peak for the claimScale-capped
  // peak (previewPeakPayout reproduces the raw value exactly when the toggle is off).
  var cNet = cPreview.cost - cPreview.fee, iNet = iPreview.cost - iPreview.fee;
  var cPk = dualMarket.lmsr.previewPeakPayout(cPreview.tokensPerBin, cNet, solvencyAwareStats);
  var iPk = dualMarket.l2.previewPeakPayout(iPreview.tokensPerBin, iNet, solvencyAwareStats);
  var cStats = { total: cPreview.totalTokens, maxPayout: cPk.peakPayout, peakBin: cPk.peakBin, fee: cPreview.fee, cost: cPreview.cost };
  var iStats = { total: iPreview.totalTokens, maxPayout: iPk.peakPayout, peakBin: iPk.peakBin, fee: iPreview.fee, cost: iPreview.cost };

  if (isCombined) {
    if (splitPanel) splitPanel.style.display = 'none';
    if (combinedPanel) {
      combinedPanel.style.display = '';
      var table = document.getElementById('distPreviewComparisonTable');
      if (table) table.innerHTML = buildPreviewComparisonHtml(cStats, iStats, labels);
    }
  } else {
    if (combinedPanel) combinedPanel.style.display = 'none';
    if (splitPanel) {
      splitPanel.style.display = '';
      document.getElementById('distPreviewCurrentGrid').innerHTML = buildPreviewStatsHtml(cStats, labels);
      document.getElementById('distPreviewImprovedGrid').innerHTML = buildPreviewStatsHtml(iStats, labels);
    }
  }
  applyStatsMode();
}

function buildPreviewStatsHtml(stats, labels) {
  var maxProfit = stats.maxPayout - stats.cost;
  var profitClass = maxProfit >= 0 ? 'positive' : 'negative';
  var roi = stats.cost > 0 ? (maxProfit / stats.cost * 100).toFixed(1) : '0.0';
  return '' +
    '<div class="result-item"><div class="result-label">Tokens</div><div class="result-value">' + formatCompact(stats.total) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Peak Bin</div><div class="result-value">' + labels[stats.peakBin] + '</div></div>' +
    '<div class="result-item"><div class="result-label">Max Payout</div><div class="result-value" style="color:var(--success)">' + formatCompact(stats.maxPayout) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Cost</div><div class="result-value" style="color:var(--danger)">' + formatCompact(stats.cost) + '</div></div>' +
    (stats.fee > 0 ? '<div class="result-item"><div class="result-label">Fee</div><div class="result-value" style="color:var(--warning)">' + formatCompact(stats.fee) + '</div></div>' : '') +
    '<div class="result-item"><div class="result-label">Max Profit</div><div class="result-value ' + profitClass + '">' + formatPnl(maxProfit) + ' (' + roi + '%)</div></div>';
}

function buildPreviewComparisonHtml(cStats, iStats, labels) {
  var cProfit = cStats.maxPayout - cStats.cost;
  var iProfit = iStats.maxPayout - iStats.cost;
  var rows = [
    { label: 'Tokens', c: cStats.total, i: iStats.total },
    { label: 'Max Payout', c: cStats.maxPayout, i: iStats.maxPayout },
    { label: 'Cost', c: cStats.cost, i: iStats.cost },
    { label: 'Max Profit', c: cProfit, i: iProfit },
  ];

  var html = '<thead><tr>' +
    '<th>Preview</th>' +
    '<th style="color:var(--primary-light)">LMSR</th>' +
    '<th style="color:var(--accent)">L2-norm</th>' +
    '<th>Delta</th>' +
    '</tr></thead><tbody>';

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var delta = row.i - row.c;
    var deltaClass = Math.abs(delta) < 0.005 ? '' : (delta >= 0 ? 'positive' : 'negative');
    html += '<tr>' +
      '<td style="font-weight:600;color:var(--text-heading);text-align:left;">' + row.label + '</td>' +
      '<td class="col-current">' + formatCompact(row.c) + '</td>' +
      '<td class="col-improved">' + formatCompact(row.i) + '</td>' +
      '<td class="col-delta ' + deltaClass + '">' + (delta >= 0 ? '+' : '') + formatCompact(delta) + '</td>' +
      '</tr>';
  }

  html += '<tr><td style="font-weight:600;color:var(--text-heading);text-align:left;">Peak Bin</td>' +
    '<td class="col-current">' + labels[cStats.peakBin] + '</td>' +
    '<td class="col-improved">' + labels[iStats.peakBin] + '</td>' +
    '<td>\u2014</td></tr>';

  if (cStats.fee > 0) {
    html += '<tr><td style="font-weight:600;color:var(--text-heading);text-align:left;">Fee</td>' +
      '<td class="col-current">' + formatCompact(cStats.fee) + '</td>' +
      '<td class="col-improved">' + formatCompact(iStats.fee) + '</td>' +
      '<td>\u2014</td></tr>';
  }

  html += '</tbody>';
  return html;
}

function executeDistTrade(side) {
  if (!dualMarket || !dualMarket.initialized) return showToast('Create a market first', 'error');
  var traderName = document.getElementById('distTraderSelect').value;
  if (!traderName) return showToast('Select a trader first', 'error');

  var mu = parseFloat(document.getElementById('distMuSlider').value);
  var sigma = getDistSigma();
  if (!sigma || sigma <= 0) return showToast('Invalid sigma', 'error');
  var amount = parseFloat(document.getElementById('distAmount').value);
  if (isNaN(amount) || amount <= 0) return showToast('Amount must be > 0', 'error');

  var result;
  if (side === 'buy') {
    result = dualMarket.distributionBuy(traderName, mu, sigma, amount);
  } else {
    result = dualMarket.distributionSell(traderName, mu, sigma, amount);
  }

  if (result.error) return showToast(result.error, 'error');
  if (result.lmsr && result.lmsr.error) return showToast('Current: ' + result.lmsr.error, 'error');
  if (result.l2 && result.l2.error) showToast('Improved: ' + result.l2.error, 'error');

  if (side === 'buy') {
    showToast(traderName + ' dist-bought \u03BC=' + mu.toFixed(1) + ' \u03C3=' + sigma.toFixed(2) + ': ' +
      formatCompact(result.lmsr.totalTokens) + ' tokens for $' + formatCompact(amount), 'buy');
  } else {
    showToast(traderName + ' dist-sold \u03BC=' + mu.toFixed(1) + ' \u03C3=' + sigma.toFixed(2) + ': $' +
      formatCompact(result.lmsr.collateralOut), 'sell');
  }

  refreshDistCharts();
  renderTraderList();
}

function executeSellAll() {
  if (!dualMarket || !dualMarket.initialized) return showToast('Create a market first', 'error');
  var traderName = document.getElementById('distTraderSelect').value;
  if (!traderName) return showToast('Select a trader first', 'error');

  var result = dualMarket.sellAll(traderName);
  if (result.error) return showToast(result.error, 'error');
  if (result.lmsr && result.lmsr.error) return showToast(result.lmsr.error, 'error');

  showToast(traderName + ' sold all: ' + formatCompact(result.lmsr.tokensReturned) +
    ' tokens → $' + formatCompact(result.lmsr.collateralOut), 'sell');

  refreshDistCharts();
  renderTraderList();
}

// Active trader change -> refresh dist charts
document.getElementById('distTraderSelect').addEventListener('change', function () {
  refreshDistCharts();
});

