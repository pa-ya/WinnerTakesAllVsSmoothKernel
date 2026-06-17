// ============================================================
// DekantPM Comparison — Setup tab: market creation, custom bins, modals, input sync
// ============================================================
// PHASE 2: SETUP TAB
// ============================================================
var marketCreated = false;

// --- Trader Registry (persisted in localStorage, independent of market) ---
var traderRegistry = [];

function saveTraderRegistry() {
  try {
    localStorage.setItem('dekantpm_trader_registry_v1', JSON.stringify(traderRegistry));
  } catch (e) { /* ignore */ }
}

function loadTraderRegistry() {
  try {
    var raw = localStorage.getItem('dekantpm_trader_registry_v1');
    if (raw) traderRegistry = JSON.parse(raw);
  } catch (e) { /* ignore */ }
}

function registerTradersWithMarket() {
  if (!dualMarket || !dualMarket.initialized) return;
  for (var i = 0; i < traderRegistry.length; i++) {
    dualMarket.addTrader(traderRegistry[i].name, traderRegistry[i].balance);
  }
}

// ============================================================
// CONFIRM MODAL
// ============================================================
function showConfirmModal(title, text, onYes) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmText').textContent = text;
  var yesBtn = document.getElementById('confirmYes');
  yesBtn.onclick = function () { closeConfirmModal(); onYes(); };
  document.getElementById('confirmModal').classList.add('open');
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('open');
}

document.getElementById('confirmModal').addEventListener('click', function (e) {
  if (e.target === this) closeConfirmModal();
});

// ============================================================
// CUSTOM BINS
// ============================================================
function onBinsChange(sel) {
  var customInput = document.getElementById('setupBinsCustom');
  if (sel.value === 'custom') {
    customInput.classList.add('visible');
    customInput.focus();
  } else {
    customInput.classList.remove('visible');
  }
}

function getSelectedBins() {
  var sel = document.getElementById('setupBins');
  if (sel.value === 'custom') {
    var v = parseInt(document.getElementById('setupBinsCustom').value, 10);
    return isNaN(v) ? null : v;
  }
  return parseInt(sel.value, 10);
}

// Show the LS-LMSR sensitivity input only when the LS-LMSR variant is selected.
function onLmsrModeChange(sel) {
  var grp = document.getElementById('setupLsSensitivityGroup');
  if (grp) grp.style.display = (sel.value === 'lslmsr') ? '' : 'none';
}

// Relabel the left engine across the UI as "LS-LMSR" when that variant is active.
// Caches each label's original "LMSR…" text in data-base so repeated calls (and
// switching markets back to plain LMSR) stay correct.
function updateEngineLabels() {
  var isLs = dualMarket && dualMarket.initConfig && dualMarket.initConfig.fees &&
    dualMarket.initConfig.fees.lmsrMode === 'lslmsr';
  var els = document.querySelectorAll('.js-lmsr-name');
  for (var i = 0; i < els.length; i++) {
    var base = els[i].getAttribute('data-base');
    if (base === null) { base = els[i].textContent; els[i].setAttribute('data-base', base); }
    els[i].textContent = isLs ? base.replace('LMSR', 'LS-LMSR') : base;
  }
}

// ============================================================
// MARKET CREATION
// ============================================================
function confirmCreateMarket() {
  if (marketCreated) {
    showConfirmModal(
      'Replace Market?',
      'Creating a new market will discard all current market data, trades, and LP positions. Continue?',
      createMarket
    );
  } else {
    createMarket();
  }
}

function createMarket() {
  var N = getSelectedBins();
  var rangeMin = parseFloat(document.getElementById('setupRangeMin').value);
  var rangeMax = parseFloat(document.getElementById('setupRangeMax').value);
  var liquidity = parseFloat(document.getElementById('setupLiquidity').value);
  var kernelWidth = parseInt(document.getElementById('setupKernelWidth').value, 10);
  var tradeFeeBps = parseInt(document.getElementById('setupTradeFeeBps').value, 10) || 0;
  var lpFeeSharePct = parseInt(document.getElementById('setupLpFeeSharePct').value, 10) || 0;
  var redemptionFeeBps = parseInt(document.getElementById('setupRedemptionFeeBps').value, 10) || 0;
  var lmsrMode = document.getElementById('setupLmsrMode').value === 'lslmsr' ? 'lslmsr' : 'lmsr';
  var lsSensitivity = (parseFloat(document.getElementById('setupLsSensitivity').value) || 30) / 100;

  if (!N || isNaN(N) || N < 2) return showToast('Bins must be >= 2', 'error');
  if (N > 1024) showToast('Warning: ' + N + ' bins may be slow for some operations', 'info');
  if (isNaN(rangeMin) || isNaN(rangeMax) || rangeMin >= rangeMax) return showToast('Range min must be < max', 'error');
  if (isNaN(liquidity) || liquidity <= 0) return showToast('Liquidity must be > 0', 'error');
  if (isNaN(kernelWidth) || kernelWidth < 0) return showToast('Kernel width must be >= 0', 'error');
  if (kernelWidth >= N) showToast('Warning: kernel width >= bins (extreme smoothing)', 'info');
  if (kernelWidth === 0) showToast('Note: W=0 makes settlement winner-takes-all (only the winning bin pays)', 'info');
  if (lmsrMode === 'lslmsr' && (isNaN(lsSensitivity) || lsSensitivity <= 0)) return showToast('LS-LMSR sensitivity must be > 0', 'error');

  dualMarket = new DualMarket();
  dualMarket.init(N, rangeMin, rangeMax, liquidity, {
    tradeFeeBps: tradeFeeBps,
    lpFeeSharePct: lpFeeSharePct,
    redemptionFeeBps: redemptionFeeBps,
    lmsrMode: lmsrMode,
    lsSensitivity: lsSensitivity,
  }, kernelWidth);
  if (lmsrMode === 'lslmsr') showToast('Left engine: LS-LMSR (sensitivity ' + Math.round(lsSensitivity * 100) + '%)', 'info');
  updateEngineLabels();

  // Re-register all traders from persistent registry (with fresh wallets)
  registerTradersWithMarket();

  marketCreated = true;

  document.getElementById('distMuSlider').min = rangeMin;
  document.getElementById('distMuSlider').max = rangeMax;
  document.getElementById('distMuSlider').value = (rangeMin + rangeMax) / 2;
  document.getElementById('distMuInput').min = rangeMin;
  document.getElementById('distMuInput').max = rangeMax;
  document.getElementById('distMuInput').value = (rangeMin + rangeMax) / 2;
  updateDistLabels();

  document.getElementById('resolveSlider').min = rangeMin;
  document.getElementById('resolveSlider').max = rangeMax;
  document.getElementById('resolveSlider').value = (rangeMin + rangeMax) / 2;
  document.getElementById('resolveInput').min = rangeMin;
  document.getElementById('resolveInput').max = rangeMax;
  document.getElementById('resolveInput').value = (rangeMin + rangeMax) / 2;
  document.getElementById('resolveKernelWidthDisplay').textContent = kernelWidth;

  lastResolveValue = null;
  document.getElementById('resolveBtn').textContent = 'Resolve';
  document.getElementById('resolvePrevValue').textContent = '\u2014';
  document.getElementById('resolveSummaryCard').style.display = 'none';
  document.getElementById('payoutTableWrapper').style.display = 'none';
  document.getElementById('combinedPayoutWrapper').style.display = 'none';
  document.getElementById('kernelVizCard').style.display = 'none';
  document.getElementById('payoutAnalysisCard').style.display = 'none';
  document.getElementById('storyGenerateCard').style.display = 'none';
  document.getElementById('storyCard').style.display = 'none';
  resetStoryState();

  var ps = document.getElementById('distPreviewStats');
  var pc = document.getElementById('distPreviewCombined');
  if (ps) ps.style.display = 'none';
  if (pc) pc.style.display = 'none';

  enableTradingTabs();

  initDistCharts();
  initCombinedDistChart();
  // Draw the preview curve for the default mu/sigma/amount so the initial chart
  // matches the inputs (otherwise the preview stays empty until a manual nudge).
  updateDistPreview();

  renderTraderList();
  updateTraderSelectors();

  lpChartsInitialized = false;
  updateSaveLoadBtn();
  initSliderFills();
  showToast('Market created: ' + N + ' bins, range [' + rangeMin + ', ' + rangeMax + '], k=' + formatCompact(liquidity), 'info');
}

function addTrader() {
  var nameEl = document.getElementById('traderName');
  var balanceEl = document.getElementById('traderBalance');
  var name = nameEl.value.trim();
  var balance = parseFloat(balanceEl.value);

  if (!name) return showToast('Trader name is required', 'error');
  if (isNaN(balance) || balance <= 0) return showToast('Balance must be > 0', 'error');

  for (var i = 0; i < traderRegistry.length; i++) {
    if (traderRegistry[i].name === name) return showToast('Trader already exists: ' + name, 'error');
  }

  traderRegistry.push({ name: name, balance: balance });
  saveTraderRegistry();

  if (dualMarket && dualMarket.initialized) {
    dualMarket.addTrader(name, balance);
  }

  nameEl.value = '';
  renderTraderList();
  updateTraderSelectors();
  showToast('Added trader: ' + name + ' ($' + formatCompact(balance) + ')', 'info');
}

function removeTrader(name) {
  traderRegistry = traderRegistry.filter(function (t) { return t.name !== name; });
  saveTraderRegistry();
  renderTraderList();
  updateTraderSelectors();
  showToast('Removed trader: ' + name, 'info');
}

function resetTraders() {
  if (traderRegistry.length === 0) return showToast('No traders to reset', 'info');
  showConfirmModal('Reset Traders', 'This will clear all traders from the list. Continue?', function () {
    traderRegistry = [];
    saveTraderRegistry();
    renderTraderList();
    updateTraderSelectors();
    showToast('Trader list cleared', 'info');
  });
}

function topUpTrader(name) {
  if (!dualMarket || !dualMarket.initialized) return showToast('Create a market first to top up traders', 'error');
  showInputModal('Top Up Trader', 'Enter amount for ' + name + ':', '', function (val) {
    var amount = parseFloat(val);
    if (isNaN(amount) || amount <= 0) return showToast('Invalid amount', 'error');
    var t = dualMarket.traders[name];
    if (!t) return;
    t.lmsrWallet += amount;
    t.l2Wallet += amount;
    for (var i = 0; i < traderRegistry.length; i++) {
      if (traderRegistry[i].name === name) {
        traderRegistry[i].balance += amount;
        break;
      }
    }
    saveTraderRegistry();
    renderTraderList();
    refreshDistCharts();
    showToast('Topped up ' + name + ' by $' + formatCompact(amount), 'info');
  });
}

function renderTraderList() {
  var container = document.getElementById('traderList');
  if (traderRegistry.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-text">No traders yet</div></div>';
    return;
  }
  var html = '';
  for (var i = 0; i < traderRegistry.length; i++) {
    var reg = traderRegistry[i];
    var n = reg.name;
    var walletInfo = '';
    if (dualMarket && dualMarket.initialized && dualMarket.traders[n]) {
      var t = dualMarket.traders[n];
      walletInfo = 'C: $' + formatCompact(t.lmsrWallet) + ' | I: $' + formatCompact(t.l2Wallet);
    } else {
      walletInfo = 'Balance: $' + formatCompact(reg.balance);
    }
    html += '<div class="trader-row">' +
      '<span class="trader-name">' + n + '</span>' +
      '<span class="trader-wallet">' + walletInfo + '</span>' +
      '<button class="btn btn-sm btn-outline" onclick="topUpTrader(\'' + n.replace(/'/g, "\\'") + '\')">Top Up</button>' +
      '<button class="btn btn-sm btn-outline" onclick="removeTrader(\'' + n.replace(/'/g, "\\'") + '\')" title="Remove" style="color:var(--danger);padding:4px 8px;">&times;</button>' +
      '</div>';
  }
  container.innerHTML = html;
}

function updateTraderSelectors() {
  var names = traderRegistry.map(function (t) { return t.name; });
  var lpNames = ['Creator'].concat(names);

  var distSel = document.getElementById('distTraderSelect');
  if (distSel) {
    var prevDist = distSel.value;
    distSel.innerHTML = '';
    for (var i = 0; i < names.length; i++) {
      var opt = document.createElement('option');
      opt.value = names[i];
      opt.textContent = names[i];
      distSel.appendChild(opt);
    }
    if (prevDist && names.indexOf(prevDist) >= 0) distSel.value = prevDist;
  }

  var lpSel = document.getElementById('lpTraderSelect');
  if (lpSel) {
    var prevLp = lpSel.value;
    lpSel.innerHTML = '';
    // "All LPs" aggregate option
    var allOpt = document.createElement('option');
    allOpt.value = '__ALL__';
    allOpt.textContent = 'All LPs (aggregate)';
    lpSel.appendChild(allOpt);
    for (var j = 0; j < lpNames.length; j++) {
      var opt2 = document.createElement('option');
      opt2.value = lpNames[j];
      opt2.textContent = lpNames[j] + (lpNames[j] === 'Creator' ? ' (initial LP)' : '');
      lpSel.appendChild(opt2);
    }
    if (prevLp && (lpNames.indexOf(prevLp) >= 0 || prevLp === '__ALL__')) lpSel.value = prevLp;
  }
}

// ============================================================
// INPUT SYNC HELPERS
// ============================================================
function getDistSigma() {
  if (!dualMarket || !dualMarket.lmsr) return null;
  var range = dualMarket.lmsr.rangeMax - dualMarket.lmsr.rangeMin;
  var conf = parseInt(document.getElementById('distConfSlider').value, 10);
  var maxSigma = range / 2;
  var minSigma = range / (dualMarket.lmsr.N * 2);
  return maxSigma - (conf / 100) * (maxSigma - minSigma);
}

function updateDistLabels() {
  if (!dualMarket || !dualMarket.lmsr) return;
  var mu = parseFloat(document.getElementById('distMuSlider').value);
  var el = document.getElementById('distMuLabel');
  if (el) el.textContent = '(' + mu.toFixed(1) + ')';

  var sigma = getDistSigma();
  var conf = parseInt(document.getElementById('distConfSlider').value, 10);
  document.getElementById('distSigmaDisplay').textContent = '\u03C3 = ' + (sigma !== null ? sigma.toFixed(2) : '—');
  document.getElementById('distSigmaLabel').textContent = '(' + conf + '%)';
}

// Slider filled-track (Webkit/Blink — Firefox handled by ::-moz-range-progress CSS)
function updateSliderFill(el) {
  var min = parseFloat(el.min) || 0;
  var max = parseFloat(el.max) || 100;
  var val = parseFloat(el.value);
  if (isNaN(val)) val = min;
  var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  el.style.background = 'linear-gradient(to right, var(--primary) 0%, var(--primary) ' + pct + '%, var(--border) ' + pct + '%, var(--border) 100%)';
}
function initSliderFills() {
  var sliders = document.querySelectorAll('input[type="range"]');
  for (var i = 0; i < sliders.length; i++) updateSliderFill(sliders[i]);
}
document.addEventListener('input', function (e) {
  if (e.target && e.target.type === 'range') updateSliderFill(e.target);
});

// Adaptive preview scheduling — rAF for moderate markets, debounce for very large
var _previewRAF = 0;
var _debouncedPreview60 = debounce(function () { updateDistPreview(); }, 60);
function schedulePreview() {
  if (!dualMarket || !dualMarket.lmsr) return;
  var N = dualMarket.lmsr.N;
  if (N < 128) { updateDistPreview(); return; }
  if (N >= 512) { _debouncedPreview60(); return; }
  if (_previewRAF) cancelAnimationFrame(_previewRAF);
  _previewRAF = requestAnimationFrame(function () { _previewRAF = 0; updateDistPreview(); });
}

// Mu slider <-> input sync
document.getElementById('distMuSlider').addEventListener('input', function () {
  document.getElementById('distMuInput').value = this.value;
  updateDistLabels();
  schedulePreview();
});
document.getElementById('distMuInput').addEventListener('input', function () {
  var min = parseFloat(document.getElementById('distMuSlider').min);
  var max = parseFloat(document.getElementById('distMuSlider').max);
  var v = parseFloat(this.value);
  if (!isNaN(v) && !isNaN(min) && !isNaN(max)) {
    v = Math.max(min, Math.min(max, v));
    this.value = v;
  }
  document.getElementById('distMuSlider').value = this.value;
  updateDistLabels();
  schedulePreview();
});

// Confidence slider updates sigma display + preview
document.getElementById('distConfSlider').addEventListener('input', function () {
  updateDistLabels();
  schedulePreview();
});

// Amount change updates preview
document.getElementById('distAmount').addEventListener('input', function () {
  schedulePreview();
});

// Resolve slider <-> input sync
document.getElementById('resolveSlider').addEventListener('input', function () {
  document.getElementById('resolveInput').value = this.value;
});
document.getElementById('resolveInput').addEventListener('input', function () {
  document.getElementById('resolveSlider').value = this.value;
});

