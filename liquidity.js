// ============================================================
// DekantPM Comparison — Liquidity (LP) tab
// ============================================================
// LP TAB
// ============================================================

var lpChartsInitialized = false;

function refreshLpTab() {
  if (!dualMarket || !dualMarket.initialized) return;
  var lpName = document.getElementById('lpTraderSelect').value;
  var isAll = lpName === '__ALL__';
  var lpBtns = document.querySelectorAll('#lpControls .btn');
  for (var bi = 0; bi < lpBtns.length; bi++) lpBtns[bi].disabled = isAll;
  var lpAmountEl = document.getElementById('lpAmount');
  if (lpAmountEl) lpAmountEl.disabled = isAll;
  var topUpBtn = document.getElementById('lpTopUpBtn');
  if (topUpBtn) topUpBtn.style.display = (isAll ? 'none' : '');
  if (!lpChartsInitialized) initLpPayoutCharts();
  refreshLpPayoutCharts(lpName);
  refreshLpStats(lpName);
  refreshLpCombinedTraderStats(lpName);
  updateLpPreview();
  if (chartMode === 'combined') refreshLpCombinedStats(lpName);
  applyStatsMode();
}

// --- LP Payout Chart: shows LP payout at each resolution outcome ---

function buildLpPayoutChartConfig(labels, payoutData, depositedLine, engine) {
  var colors = getChartColors();
  var lineColor = engine === 'lmsr' ? colors.primary : colors.accent;
  return {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'LP Payout',
          data: payoutData,
          borderColor: lineColor,
          backgroundColor: lineColor + '22',
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: 'Break-even',
          data: depositedLine,
          borderColor: colors.textMuted,
          borderDash: [6, 3],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
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
            label: function (ctx) { return ctx.dataset.label + ': ' + formatCompact(ctx.parsed.y); },
          },
        },
        zoom: getZoomPluginConfig(),
      },
      scales: {
        x: {
          ticks: { color: colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 9 } },
          grid: { color: colors.grid },
        },
        y: {
          ticks: { color: colors.text, font: { size: 9 }, callback: function (v) { return formatCompact(v); } },
          grid: { color: colors.grid },
        },
      },
    },
  };
}

function buildLpPayoutCombinedConfig(labels, cPayout, iPayout, depositedLine) {
  var colors = getChartColors();
  return {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Current LP Payout',
          data: cPayout,
          borderColor: colors.primary,
          backgroundColor: colors.primary + '18',
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: 'Improved LP Payout',
          data: iPayout,
          borderColor: colors.accent,
          backgroundColor: colors.accent + '18',
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: 'Break-even',
          data: depositedLine,
          borderColor: colors.textMuted,
          borderDash: [6, 3],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: colors.text, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: function (ctx) { return ctx.dataset.label + ': ' + formatCompact(ctx.parsed.y); },
          },
        },
        zoom: getZoomPluginConfig(),
      },
      scales: {
        x: {
          ticks: { color: colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 9 } },
          grid: { color: colors.grid },
        },
        y: {
          ticks: { color: colors.text, font: { size: 9 }, callback: function (v) { return formatCompact(v); } },
          grid: { color: colors.grid },
        },
      },
    },
  };
}

function initLpPayoutCharts() {
  if (!dualMarket || !dualMarket.lmsr) return;
  var labels = dualMarket.lmsr.getLabels();
  var N = dualMarket.lmsr.N;
  var empty = [];
  var deposited = [];
  var dep = dualMarket.lmsr.lpProviders['Creator'] ? dualMarket.lmsr.lpProviders['Creator'].deposited : dualMarket.initConfig.liquidity;
  for (var j = 0; j < N; j++) { empty.push(dep); deposited.push(dep); }

  getOrCreateChart('lpPayoutCurrentChart', buildLpPayoutChartConfig(labels, deposited.slice(), deposited.slice(), 'lmsr'));
  getOrCreateChart('lpPayoutImprovedChart', buildLpPayoutChartConfig(labels, deposited.slice(), deposited.slice(), 'l2'));
  getOrCreateChart('lpPayoutCombinedChart', buildLpPayoutCombinedConfig(labels, deposited.slice(), deposited.slice(), deposited.slice()));
  lpChartsInitialized = true;
}

function refreshLpPayoutCharts(lpName) {
  if (!dualMarket || !dualMarket.initialized) return;
  var N = dualMarket.lmsr.N;

  var cLp, iLp;
  if (lpName === '__ALL__') {
    cLp = dualMarket.lmsr.getAllLpPortfolio();
    iLp = dualMarket.l2.getAllLpPortfolio();
  } else if (lpName) {
    cLp = dualMarket.lmsr.getLpPortfolio(lpName);
    iLp = dualMarket.l2.getLpPortfolio(lpName);
  } else {
    cLp = null;
    iLp = null;
  }

  var cPayout = [], iPayout = [], deposited = [];
  var dep = cLp ? cLp.deposited - cLp.withdrawn : dualMarket.initConfig.liquidity;
  for (var j = 0; j < N; j++) {
    cPayout.push(cLp ? cLp.payoutPerOutcome[j] : 0);
    iPayout.push(iLp ? iLp.payoutPerOutcome[j] : 0);
    deposited.push(dep);
  }

  var cc = charts['lpPayoutCurrentChart'];
  if (cc) {
    cc.data.datasets[0].data = cPayout;
    cc.data.datasets[1].data = deposited;
    cc.update('none');
  }
  var ic = charts['lpPayoutImprovedChart'];
  if (ic) {
    ic.data.datasets[0].data = iPayout;
    ic.data.datasets[1].data = deposited;
    ic.update('none');
  }
  var xc = charts['lpPayoutCombinedChart'];
  if (xc) {
    xc.data.datasets[0].data = cPayout;
    xc.data.datasets[1].data = iPayout;
    xc.data.datasets[2].data = deposited;
    xc.update('none');
  }
}

// --- LP Stats ---

function lpStatsHtml(lp, engine) {
  if (!lp) return '<div class="result-item"><div class="result-label">No LP position</div><div class="result-value">—</div></div>';
  var pnlClass = lp.unrealizedPnL >= 0 ? 'positive' : 'negative';
  var valueClass = lp.currentValue >= lp.deposited ? 'positive' : 'negative';
  return '' +
    '<div class="result-item"><div class="result-label">Shares</div><div class="result-value">' + formatCompact(lp.shares) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Pool %</div><div class="result-value">' + (lp.poolFraction * 100).toFixed(1) + '%</div></div>' +
    '<div class="result-item"><div class="result-label">Deposited</div><div class="result-value" style="color:var(--danger)">' + formatCompact(lp.deposited) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Withdrawn</div><div class="result-value" style="color:var(--success)">' + formatCompact(lp.withdrawn) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Fee Earnings</div><div class="result-value" style="color:var(--warning)">' + formatCompact(lp.feeEarnings) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Current Value</div><div class="result-value ' + valueClass + '">' + formatCompact(lp.currentValue) + '</div></div>' +
    '<div class="result-item"><div class="result-label">Unreal. PnL</div><div class="result-value ' + pnlClass + '">' + formatPnl(lp.unrealizedPnL) + ' (' + lp.pnlPct.toFixed(1) + '%)</div></div>';
}

function refreshLpStats(lpName) {
  if (!dualMarket || !dualMarket.initialized) return;
  var cGrid = document.getElementById('lpStatsCurrentGrid');
  var iGrid = document.getElementById('lpStatsImprovedGrid');

  if (!lpName) {
    var emptyHtml = '<div class="result-item"><div class="result-label">Select an LP</div><div class="result-value">—</div></div>';
    if (cGrid) cGrid.innerHTML = emptyHtml;
    if (iGrid) iGrid.innerHTML = emptyHtml;
    return;
  }

  var portfolios = dualMarket.getLpPortfolios(lpName);
  if (cGrid) cGrid.innerHTML = lpStatsHtml(portfolios ? portfolios.lmsr : null, 'lmsr');
  if (iGrid) iGrid.innerHTML = lpStatsHtml(portfolios ? portfolios.l2 : null, 'l2');
}

function refreshLpCombinedStats(lpName) {
  var table = document.getElementById('lpComparisonTable');
  if (!table || !dualMarket || !dualMarket.initialized) return;
  if (!lpName) { table.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">Select an LP</td></tr>'; return; }

  var portfolios = dualMarket.getLpPortfolios(lpName);
  var cLp = portfolios ? portfolios.lmsr : null;
  var iLp = portfolios ? portfolios.l2 : null;

  if (!cLp && !iLp) { table.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">No LP position</td></tr>'; return; }

  var rows = [
    { label: 'Shares', c: cLp ? cLp.shares : 0, i: iLp ? iLp.shares : 0 },
    { label: 'Pool %', c: cLp ? cLp.poolFraction * 100 : 0, i: iLp ? iLp.poolFraction * 100 : 0, suffix: '%', precision: 1 },
    { label: 'Deposited', c: cLp ? cLp.deposited : 0, i: iLp ? iLp.deposited : 0, style: 'color:var(--danger)' },
    { label: 'Withdrawn', c: cLp ? cLp.withdrawn : 0, i: iLp ? iLp.withdrawn : 0, style: 'color:var(--success)' },
    { label: 'Fee Earnings', c: cLp ? cLp.feeEarnings : 0, i: iLp ? iLp.feeEarnings : 0, style: 'color:var(--warning)' },
    { label: 'Current Value', c: cLp ? cLp.currentValue : 0, i: iLp ? iLp.currentValue : 0 },
    { label: 'Unreal. PnL', c: cLp ? cLp.unrealizedPnL : 0, i: iLp ? iLp.unrealizedPnL : 0, style: 'pnl' },
  ];

  var html = '<thead><tr><th></th><th style="color:var(--primary-light)">LMSR</th><th style="color:var(--accent)">L2-norm</th><th>Delta</th></tr></thead><tbody>';
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var delta = row.i - row.c;
    var deltaStr = (delta >= 0 ? '+' : '') + (row.suffix ? delta.toFixed(row.precision || 0) + row.suffix : formatCompact(delta));
    var cStr = row.suffix ? row.c.toFixed(row.precision || 0) + row.suffix : formatCompact(row.c);
    var iStr = row.suffix ? row.i.toFixed(row.precision || 0) + row.suffix : formatCompact(row.i);

    var cStyle = '', iStyle = '';
    if (row.style === 'pnl') {
      cStyle = row.c >= 0 ? 'color:var(--success)' : 'color:var(--danger)';
      iStyle = row.i >= 0 ? 'color:var(--success)' : 'color:var(--danger)';
      cStr = formatPnl(row.c);
      iStr = formatPnl(row.i);
    } else if (row.style) {
      cStyle = row.style;
      iStyle = row.style;
    }

    html += '<tr><td>' + row.label + '</td><td style="' + cStyle + '">' + cStr + '</td><td style="' + iStyle + '">' + iStr + '</td><td>' + deltaStr + '</td></tr>';
  }
  html += '</tbody>';
  table.innerHTML = html;
}

// --- LP Preview ---

// Delegate to the engine's own non-mutating preview math so LMSR (no `.k`,
// scale-b model + solvency floor) and L2-norm both preview correctly.
function computeLpAddPreview(engine, lpName, amount) {
  return engine.previewAddLiquidity(lpName, amount);
}

function computeLpRemovePreview(engine, lpName, amount) {
  return engine.previewRemoveLiquidity(lpName, amount);
}

function lpPreviewHtml(preview, action) {
  if (!preview) return '<div class="result-item"><div class="result-label">No LP position</div><div class="result-value">—</div></div>';
  if (action === 'add') {
    var pnlClass = preview.unrealizedPnL >= 0 ? 'positive' : 'negative';
    return '' +
      '<div class="result-item"><div class="result-label">Shares +</div><div class="result-value" style="color:var(--success)">' + formatCompact(preview.sharesReceived) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Pool %</div><div class="result-value">' + (preview.poolFraction * 100).toFixed(1) + '%</div></div>' +
      '<div class="result-item"><div class="result-label">New Vault</div><div class="result-value">' + formatCompact(preview.newPool) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Est. Value</div><div class="result-value">' + formatCompact(preview.currentValue) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Est. PnL</div><div class="result-value ' + pnlClass + '">' + formatPnl(preview.unrealizedPnL) + '</div></div>';
  } else {
    return '' +
      '<div class="result-item"><div class="result-label">Shares Burned</div><div class="result-value" style="color:var(--danger)">' + formatCompact(preview.sharesBurned) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Collateral Out</div><div class="result-value" style="color:var(--success)">' + formatCompact(preview.collateralOut) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Fee Share</div><div class="result-value" style="color:var(--warning)">' + formatCompact(preview.feeShare) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Total Payout</div><div class="result-value" style="color:var(--success)">' + formatCompact(preview.totalPayout) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Remaining %</div><div class="result-value">' + (preview.poolFraction * 100).toFixed(1) + '%</div></div>';
  }
}

function updateLpPreview() {
  if (!dualMarket || !dualMarket.initialized) return;
  var lpName = document.getElementById('lpTraderSelect').value;
  var amount = parseFloat(document.getElementById('lpAmount').value);
  if (!lpName || isNaN(amount) || amount <= 0) return;

  if (lpName === '__ALL__') {
    var sp = document.getElementById('lpPreviewStats');
    var cp = document.getElementById('lpPreviewCombined');
    if (sp) sp.style.display = 'none';
    if (cp) cp.style.display = 'none';
    return;
  }

  var cHasLp = dualMarket.lmsr.lpProviders[lpName] && dualMarket.lmsr.lpProviders[lpName].shares > 0;

  // Show add preview by default, remove preview if they have LP
  var cAddP = computeLpAddPreview(dualMarket.lmsr, lpName, amount);
  var iAddP = computeLpAddPreview(dualMarket.l2, lpName, amount);
  var cRemP = cHasLp ? computeLpRemovePreview(dualMarket.lmsr, lpName, amount) : null;
  var iRemP = cHasLp ? computeLpRemovePreview(dualMarket.l2, lpName, amount) : null;

  var cGrid = document.getElementById('lpPreviewCurrentGrid');
  var iGrid = document.getElementById('lpPreviewImprovedGrid');
  if (cGrid) {
    var html = '<div class="lp-preview-section"><div class="lp-preview-label" style="color:var(--success);">Add Preview</div><div class="result-grid">' + lpPreviewHtml(cAddP, 'add') + '</div></div>';
    if (cRemP) html += '<div class="lp-preview-section"><div class="lp-preview-label" style="color:var(--danger);">Remove Preview</div><div class="result-grid">' + lpPreviewHtml(cRemP, 'remove') + '</div></div>';
    cGrid.innerHTML = html;
  }
  if (iGrid) {
    var html2 = '<div class="lp-preview-section"><div class="lp-preview-label" style="color:var(--success);">Add Preview</div><div class="result-grid">' + lpPreviewHtml(iAddP, 'add') + '</div></div>';
    if (iRemP) html2 += '<div class="lp-preview-section"><div class="lp-preview-label" style="color:var(--danger);">Remove Preview</div><div class="result-grid">' + lpPreviewHtml(iRemP, 'remove') + '</div></div>';
    iGrid.innerHTML = html2;
  }

  if (chartMode === 'combined') {
    var table = document.getElementById('lpPreviewComparisonTable');
    if (table) {
      var rows = [
        { label: 'Add: Shares +', c: cAddP.sharesReceived, i: iAddP.sharesReceived },
        { label: 'Add: Pool %', c: cAddP.poolFraction * 100, i: iAddP.poolFraction * 100, suffix: '%', precision: 1 },
        { label: 'Add: Est. Value', c: cAddP.currentValue, i: iAddP.currentValue },
      ];
      if (cRemP && iRemP) {
        rows.push({ label: 'Rem: Payout', c: cRemP.totalPayout, i: iRemP.totalPayout });
        rows.push({ label: 'Rem: Fee Share', c: cRemP.feeShare, i: iRemP.feeShare });
      }
      var html3 = '<thead><tr><th></th><th style="color:var(--primary-light)">LMSR</th><th style="color:var(--accent)">L2-norm</th><th>Delta</th></tr></thead><tbody>';
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var delta = row.i - row.c;
        var cStr = row.suffix ? row.c.toFixed(row.precision || 0) + row.suffix : formatCompact(row.c);
        var iStr = row.suffix ? row.i.toFixed(row.precision || 0) + row.suffix : formatCompact(row.i);
        var deltaStr = (delta >= 0 ? '+' : '') + (row.suffix ? delta.toFixed(row.precision || 0) + row.suffix : formatCompact(delta));
        html3 += '<tr><td>' + row.label + '</td><td>' + cStr + '</td><td>' + iStr + '</td><td>' + deltaStr + '</td></tr>';
      }
      html3 += '</tbody>';
      table.innerHTML = html3;
    }
  }
}

// --- LP Execute ---

function executeLp(action) {
  if (!dualMarket || !dualMarket.initialized) return showToast('Create a market first', 'error');
  var lpName = document.getElementById('lpTraderSelect').value;
  if (!lpName) return showToast('Select an LP', 'error');
  if (lpName === '__ALL__') return showToast('Select a specific LP to add/remove', 'error');
  var result;

  if (action === 'removeAll') {
    var cLp = dualMarket.lmsr.lpProviders[lpName];
    if (!cLp || cLp.shares <= 0) return showToast('No LP position to remove', 'error');
    var maxAmount = dualMarket.lmsr.getPool() * cLp.shares / dualMarket.lmsr.totalLpShares;
    result = dualMarket.removeLiquidity(lpName, maxAmount + 1);
    if (result.error) return showToast(result.error, 'error');
    showToast('Removed all LP for ' + lpName, 'success');
  } else {
    var amount = parseFloat(document.getElementById('lpAmount').value);
    if (isNaN(amount) || amount <= 0) return showToast('Enter a valid amount', 'error');

    if (action === 'add') {
      result = dualMarket.addLiquidity(lpName, amount);
      if (result.error) return showToast(result.error, 'error');
      showToast('Added ' + formatCompact(amount) + ' LP for ' + lpName + ' (' + formatCompact(result.lmsr.sharesReceived) + ' shares)', 'success');
    } else if (action === 'remove') {
      result = dualMarket.removeLiquidity(lpName, amount);
      if (result.error) return showToast(result.error, 'error');
      showToast('Removed LP: ' + formatCompact(result.lmsr.totalPayout) + ' returned to ' + lpName, 'success');
    }
  }

  refreshLpTab();
  refreshDistCharts();
}

function topUpLpUser() {
  if (!dualMarket || !dualMarket.initialized) return showToast('Create a market first', 'error');
  var lpName = document.getElementById('lpTraderSelect').value;
  if (!lpName || lpName === '__ALL__') return showToast('Select a specific LP', 'error');
  showInputModal('Top Up LP', 'Enter amount for ' + lpName + ':', '', function (val) {
    var amount = parseFloat(val);
    if (isNaN(amount) || amount <= 0) return showToast('Invalid amount', 'error');
    var t = dualMarket.traders[lpName];
    if (!t) return showToast('Unknown user', 'error');
    t.lmsrWallet += amount;
    t.l2Wallet += amount;
    for (var i = 0; i < traderRegistry.length; i++) {
      if (traderRegistry[i].name === lpName) {
        traderRegistry[i].balance += amount;
        break;
      }
    }
    saveTraderRegistry();
    renderTraderList();
    refreshLpTab();
    showToast('Topped up ' + lpName + ' by $' + formatCompact(amount), 'info');
  });
}

// --- Combined Trader + LP Stats ---

function refreshLpCombinedTraderStats(lpName) {
  var cGrid = document.getElementById('lpCombinedCurrentGrid');
  var iGrid = document.getElementById('lpCombinedImprovedGrid');
  if (!cGrid || !iGrid) return;
  if (!dualMarket || !dualMarket.initialized || !lpName) {
    var emptyHtml = '<div class="result-item"><div class="result-label">Select a user</div><div class="result-value">—</div></div>';
    cGrid.innerHTML = emptyHtml;
    iGrid.innerHTML = emptyHtml;
    return;
  }

  var traderP = lpName !== '__ALL__' ? dualMarket.getPortfolios(lpName) : null;
  var lpP = dualMarket.getLpPortfolios(lpName);

  function combinedHtml(tp, lp, engine) {
    var hasTrading = tp && tp.totalSpent > 0;
    var hasLp = lp && lp.shares > 0;
    if (!hasTrading && !hasLp) return '<div class="result-item"><div class="result-label">No positions</div><div class="result-value">—</div></div>';

    var tradingEP = hasTrading ? tp.expectedPayout : 0;
    var lpValue = hasLp ? lp.currentValue : 0;
    var totalValue = tradingEP + lpValue;
    var totalSpent = (hasTrading ? tp.totalSpent : 0) + (hasLp ? lp.deposited : 0);
    var totalReceived = (hasTrading ? tp.totalReceived : 0) + (hasLp ? lp.withdrawn : 0);
    var totalPnL = totalValue + totalReceived - totalSpent;
    var pnlClass = totalPnL >= 0 ? 'positive' : 'negative';
    var pnlPct = totalSpent > 0 ? (totalPnL / totalSpent * 100).toFixed(1) : '0.0';

    return '' +
      '<div class="result-item"><div class="result-label">Trading E[Payout]</div><div class="result-value">' + formatCompact(tradingEP) + '</div></div>' +
      '<div class="result-item"><div class="result-label">LP Value</div><div class="result-value">' + formatCompact(lpValue) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Total Value</div><div class="result-value">' + formatCompact(totalValue) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Total Spent</div><div class="result-value" style="color:var(--danger)">' + formatCompact(totalSpent) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Total Received</div><div class="result-value" style="color:var(--success)">' + formatCompact(totalReceived) + '</div></div>' +
      '<div class="result-item"><div class="result-label">Combined PnL</div><div class="result-value ' + pnlClass + '">' + formatPnl(totalPnL) + ' (' + pnlPct + '%)</div></div>';
  }

  cGrid.innerHTML = combinedHtml(traderP ? traderP.lmsr : null, lpP ? lpP.lmsr : null, 'lmsr');
  iGrid.innerHTML = combinedHtml(traderP ? traderP.l2 : null, lpP ? lpP.l2 : null, 'l2');
}

// --- LP Simulation ---

function runLpSimulation() {
  if (!dualMarket || !dualMarket.initialized) return showToast('Create a market first', 'error');

  var maxTraders = parseInt(document.getElementById('lpSimTraderCount').value, 10);
  var avgTradeSize = parseInt(document.getElementById('lpSimTradeSize').value, 10);
  if (isNaN(maxTraders) || isNaN(avgTradeSize)) return;

  var cfg = dualMarket.initConfig;
  var N = cfg.N;
  var initLiq = cfg.liquidity;

  var savedGT = globalTraders;
  globalTraders = {};

  // Two independent sim engines — one per AMM — fed identical trades.
  var simFees = {
    tradeFeeBps: cfg.fees.tradeFeeBps, lpFeeSharePct: cfg.fees.lpFeeSharePct,
    redemptionFeeBps: cfg.fees.redemptionFeeBps, kernelWidth: cfg.kernelWidth,
  };
  var simC = new LmsrMarket(N, cfg.rangeMin, cfg.rangeMax, initLiq, simFees);  // LMSR
  var simI = new L2Market(N, cfg.rangeMin, cfg.rangeMax, initLiq, simFees);    // L2-norm

  var traderLabels = ['0'];
  var cPnL = [0];
  var iPnL = [0];

  for (var t = 0; t < maxTraders; t++) {
    var mu = cfg.rangeMin + ((t + 0.5) / maxTraders) * (cfg.rangeMax - cfg.rangeMin);
    var sigma = (cfg.rangeMax - cfg.rangeMin) / 6;
    var name = '_sim_' + t;

    globalTraders[name] = { wallet: avgTradeSize * 10 };
    simC.distributionBuy(name, mu, sigma, avgTradeSize);
    globalTraders[name] = { wallet: avgTradeSize * 10 };
    simI.distributionBuy(name, mu, sigma, avgTradeSize);

    // LP E[PnL] = Σ p(bin)·LPpayout(bin) − initial deposit, using each engine's
    // own probabilities and the shared kernel LP payout curve.
    var cPort = simC.getAllLpPortfolio();
    var cProbs = simC.getProbabilities();
    var iPort = simI.getAllLpPortfolio();
    var iProbs = simI.getProbabilities();
    var cExp = 0, iExp = 0;
    for (var bin = 0; bin < N; bin++) {
      cExp += cProbs[bin] * cPort.payoutPerOutcome[bin];
      iExp += iProbs[bin] * iPort.payoutPerOutcome[bin];
    }

    traderLabels.push(String(t + 1));
    cPnL.push(cExp - initLiq);
    iPnL.push(iExp - initLiq);
  }

  globalTraders = savedGT;

  var colors = getChartColors();
  var simConfig = function (data, label, color) {
    return {
      type: 'line',
      data: {
        labels: traderLabels,
        datasets: [
          {
            label: label,
            data: data,
            borderColor: color,
            backgroundColor: color + '22',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
          },
          {
            label: 'Break-even',
            data: traderLabels.map(function () { return 0; }),
            borderColor: colors.textMuted,
            borderDash: [6, 3],
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return items[0].label + ' traders'; },
              label: function (ctx) { return ctx.dataset.label + ': ' + formatPnl(ctx.parsed.y); },
            },
          },
          zoom: getZoomPluginConfig(),
        },
        scales: {
          x: {
            title: { display: true, text: 'Number of Traders', color: colors.text, font: { size: 10 } },
            ticks: { color: colors.text, maxTicksLimit: 10, font: { size: 9 } },
            grid: { color: colors.grid },
          },
          y: {
            title: { display: true, text: 'LP E[PnL]', color: colors.text, font: { size: 10 } },
            ticks: { color: colors.text, font: { size: 9 }, callback: function (v) { return formatCompact(v); } },
            grid: { color: colors.grid },
          },
        },
      },
    };
  };

  getOrCreateChart('lpSimCurrentChart', simConfig(cPnL, 'Current LP E[PnL]', colors.primary));
  getOrCreateChart('lpSimImprovedChart', simConfig(iPnL, 'Improved LP E[PnL]', colors.accent));

  getOrCreateChart('lpSimCombinedChart', {
    type: 'line',
    data: {
      labels: traderLabels,
      datasets: [
        { label: 'Current LP E[PnL]', data: cPnL, borderColor: colors.primary, backgroundColor: colors.primary + '18', fill: true, borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: 'Improved LP E[PnL]', data: iPnL, borderColor: colors.accent, backgroundColor: colors.accent + '18', fill: true, borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: 'Break-even', data: traderLabels.map(function () { return 0; }), borderColor: colors.textMuted, borderDash: [6, 3], borderWidth: 1, pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colors.text, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            title: function (items) { return items[0].label + ' traders'; },
            label: function (ctx) { return ctx.dataset.label + ': ' + formatPnl(ctx.parsed.y); },
          },
        },
        zoom: getZoomPluginConfig(),
      },
      scales: {
        x: {
          title: { display: true, text: 'Number of Traders', color: colors.text, font: { size: 10 } },
          ticks: { color: colors.text, maxTicksLimit: 10, font: { size: 9 } },
          grid: { color: colors.grid },
        },
        y: {
          title: { display: true, text: 'LP E[PnL]', color: colors.text, font: { size: 10 } },
          ticks: { color: colors.text, font: { size: 9 }, callback: function (v) { return formatCompact(v); } },
          grid: { color: colors.grid },
        },
      },
    },
  });

  applyChartMode();
  showToast('Simulation complete: ' + maxTraders + ' traders, ' + formatCompact(avgTradeSize) + ' avg size', 'success');
}

// LP tab event listeners
document.getElementById('lpTraderSelect').addEventListener('change', function () {
  refreshLpTab();
});
document.getElementById('lpAmount').addEventListener('input', function () {
  updateLpPreview();
  applyStatsMode();
});
document.getElementById('lpSimTraderCount').addEventListener('input', function () {
  document.getElementById('lpSimTraderCountLabel').textContent = '(' + this.value + ')';
});
document.getElementById('lpSimTradeSize').addEventListener('input', function () {
  document.getElementById('lpSimTradeSizeLabel').textContent = '(' + this.value + ')';
});

