// ============================================================
// DekantPM — Market Comparison Playground
// ============================================================
// Two continuous market engines (Current quadratic WTA vs.
// Improved linear kernel) running side-by-side with shared
// inputs and separate outputs.
// ============================================================

'use strict';

// ============================================================
// 1. CONSTANTS
// ============================================================
var SCALE_WEIGHT = 1e9;
var Z_CUTOFF = 5;
var DEFAULT_TRADE_FEE_BPS = 0;
var DEFAULT_LP_FEE_SHARE_PCT = 0;
var DEFAULT_REDEMPTION_FEE_BPS = 0;
var DEFAULT_KERNEL_WIDTH = 3;

// ============================================================
// 2. GLOBAL STATE
// ============================================================
var currentTheme = 'dark';
var globalTraders = {};        // { name: { wallet } }
var dualMarket = null;         // DualMarket instance

var settings = {
  fontSize: 'md',
  numberFormat: 'short',
  decimalPrecision: 1,
  statsMode: 'cards',
};

// ============================================================
// 3. THEME
// ============================================================
function applyHtmlClass() {
  document.documentElement.className = 'theme-' + currentTheme;
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyHtmlClass();
  var icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = currentTheme === 'dark' ? '\u263E' : '\u2600';
  updateAllCharts();
  saveSettings();
}

function applyFontSize(size) {
  settings.fontSize = size || 'md';
  var map = { xs: '13px', sm: '14px', md: '16px', lg: '18px', xl: '20px' };
  document.documentElement.style.fontSize = map[settings.fontSize] || '16px';
}

// ============================================================
// 4. UTILITIES
// ============================================================
function debounce(fn, ms) {
  var timer;
  return function () {
    var ctx = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
  };
}

function isLargeMarket() {
  return dualMarket && dualMarket.current && dualMarket.current.N >= 128;
}

function formatCompact(n) {
  if (n == null || isNaN(n)) return '—';
  var abs = Math.abs(n);
  var prec = settings.decimalPrecision;
  if (settings.numberFormat === 'long') {
    return n.toLocaleString('en-US', { minimumFractionDigits: prec, maximumFractionDigits: prec });
  }
  if (abs >= 1e9) return (n / 1e9).toFixed(prec) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(prec) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(prec) + 'K';
  return n.toFixed(prec);
}

function formatPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(settings.decimalPrecision) + '%';
}

function formatPnl(n) {
  if (n == null || isNaN(n)) return '—';
  var s = formatCompact(n);
  return n >= 0 ? '+' + s : s;
}

function getChartColors() {
  var s = getComputedStyle(document.documentElement);
  return {
    primary: s.getPropertyValue('--primary').trim() || '#3b82f6',
    accent: s.getPropertyValue('--accent').trim() || '#06b6d4',
    text: s.getPropertyValue('--text').trim() || '#e2e8f0',
    textMuted: s.getPropertyValue('--text-muted').trim() || '#94a3b8',
    border: s.getPropertyValue('--border').trim() || '#334155',
    success: s.getPropertyValue('--success').trim() || '#22c55e',
    warning: s.getPropertyValue('--warning').trim() || '#f59e0b',
    danger: s.getPropertyValue('--danger').trim() || '#ef4444',
    purple: s.getPropertyValue('--purple').trim() || '#a855f7',
    bg: s.getPropertyValue('--bg-secondary').trim() || '#1e293b',
    grid: currentTheme === 'dark' ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.12)',
  };
}

function showToast(message, type) {
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3100);
}

function updateAllCharts() {
  if (dualMarket && dualMarket.initialized) {
    if (typeof initDistCharts === 'function') {
      initDistCharts();
      if (typeof refreshDistCharts === 'function') refreshDistCharts();
    }
    // Combined charts
    if (typeof initCombinedDistChart === 'function') initCombinedDistChart();
    if (typeof refreshCombinedDistChart === 'function') refreshCombinedDistChart();
    // Re-apply dataset visibility from checkbox states after chart recreation
    if (typeof reapplyDatasetToggles === 'function') reapplyDatasetToggles();
    // Re-apply resolution markers and kernel chart if resolved
    if (typeof applyResolutionMarkers === 'function') applyResolutionMarkers();
    if (dualMarket.current.resolved && typeof renderKernelChart === 'function') {
      renderKernelChart(dualMarket.current.winningBin);
    }
    // LP charts
    if (typeof initLpPayoutCharts === 'function') initLpPayoutCharts();
    if (typeof refreshLpTab === 'function') refreshLpTab();
    // Payout analysis chart
    if (typeof renderPayoutAnalysisChart === 'function') renderPayoutAnalysisChart();
  }
}

function saveSettings() {
  try {
    localStorage.setItem('dekantpm_comparison_settings_v1', JSON.stringify({
      theme: currentTheme,
      fontSize: settings.fontSize,
      numberFormat: settings.numberFormat,
      decimalPrecision: settings.decimalPrecision,
      statsMode: settings.statsMode,
    }));
  } catch (e) { /* ignore */ }
}

function loadSettings() {
  try {
    var raw = localStorage.getItem('dekantpm_comparison_settings_v1');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.theme) currentTheme = s.theme;
    if (s.fontSize) settings.fontSize = s.fontSize;
    if (s.numberFormat) settings.numberFormat = s.numberFormat;
    if (typeof s.decimalPrecision === 'number') settings.decimalPrecision = s.decimalPrecision;
    if (s.statsMode) settings.statsMode = s.statsMode;
  } catch (e) { /* ignore */ }
}

// ============================================================
// 5. CURRENT MARKET ENGINE (Quadratic WTA)
// ============================================================
// Probability: p_i = x_i^2 / k^2
// Resolution: Winner-Takes-All — only winning bin pays 1:1
// ============================================================
function CurrentMarket(N, rangeMin, rangeMax, liquidity, fees) {
  this.N = N;
  this.rangeMin = rangeMin;
  this.rangeMax = rangeMax;
  this.binWidth = (rangeMax - rangeMin) / N;
  this.k = liquidity;

  this.tradeFeeBps = (fees && typeof fees.tradeFeeBps === 'number') ? fees.tradeFeeBps : DEFAULT_TRADE_FEE_BPS;
  this.lpFeeSharePct = (fees && typeof fees.lpFeeSharePct === 'number') ? fees.lpFeeSharePct : DEFAULT_LP_FEE_SHARE_PCT;
  this.redemptionFeeBps = (fees && typeof fees.redemptionFeeBps === 'number') ? fees.redemptionFeeBps : DEFAULT_REDEMPTION_FEE_BPS;

  var xUniform = Math.sqrt(liquidity * liquidity / N);
  this.positions = [];
  this.centers = [];
  for (var j = 0; j < N; j++) {
    this.positions.push(xUniform);
    this.centers.push(rangeMin + (2 * j + 1) * this.binWidth / 2);
  }

  this.totalLpShares = liquidity;
  this.lpProviders = {};
  this.lpProviders['Creator'] = { shares: liquidity, deposited: liquidity, withdrawn: 0 };
  this.accumulatedLpFees = 0;
  this.traderHoldings = {};
  this.resolved = false;
  this.winningBin = -1;
  this.lastResolveValue = null;
  this.lastResolvePayouts = null;
}

CurrentMarket.prototype.getProbabilities = function () {
  var kSq = this.k * this.k;
  var probs = [];
  for (var i = 0; i < this.N; i++) {
    probs.push((this.positions[i] * this.positions[i]) / kSq);
  }
  return probs;
};

CurrentMarket.prototype.getLabels = function () {
  var labels = [];
  for (var i = 0; i < this.N; i++) {
    var lo = this.rangeMin + i * this.binWidth;
    var hi = lo + this.binWidth;
    if (this.N > 100) {
      labels.push(Math.round(lo).toString());
    } else {
      labels.push(Math.round(lo) + '-' + Math.round(hi));
    }
  }
  return labels;
};

CurrentMarket.prototype.ensureTrader = function (name) {
  if (!this.traderHoldings[name]) {
    var holdings = [];
    for (var i = 0; i < this.N; i++) holdings.push(0);
    this.traderHoldings[name] = { holdings: holdings, spent: 0, received: 0 };
  }
};

CurrentMarket.prototype.discreteBuy = function (traderName, binIdx, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  if (binIdx < 0 || binIdx >= this.N) return { error: 'Invalid bin index' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var kNew = this.k + net;
  var sumOtherSq = 0;
  for (var j = 0; j < this.N; j++) {
    if (j !== binIdx) sumOtherSq += this.positions[j] * this.positions[j];
  }
  var newXi = Math.sqrt(kNew * kNew - sumOtherSq);
  if (isNaN(newXi) || newXi < 0) return { error: 'Math error: sqrt of negative' };

  var tokensOut = newXi - this.positions[binIdx];
  this.positions[binIdx] = newXi;
  this.k = kNew;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] += tokensOut;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var peakPayout = tokensOut * (1 - this.redemptionFeeBps / 10000);

  return {
    tokensOut: tokensOut, fee: fee, lpFee: lpFee, net: net,
    newProb: (newXi * newXi) / (kNew * kNew),
    peakPayout: peakPayout, cost: grossCollateral,
    maxProfit: peakPayout - grossCollateral,
  };
};

CurrentMarket.prototype.discreteSell = function (traderName, binIdx, tokenAmount) {
  if (this.resolved) return { error: 'Market is resolved' };
  if (binIdx < 0 || binIdx >= this.N) return { error: 'Invalid bin index' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];
  if (th.holdings[binIdx] < tokenAmount - 0.01) return { error: 'Insufficient tokens in bin ' + binIdx };

  var newXi = this.positions[binIdx] - tokenAmount;
  if (newXi < 0) return { error: 'Position would go negative' };

  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    var xj = (j === binIdx) ? newXi : this.positions[j];
    sumSq += xj * xj;
  }
  var kNew = Math.sqrt(sumSq);
  var grossOut = this.k - kNew;

  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.positions[binIdx] = newXi;
  this.k = kNew;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] -= tokenAmount;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    collateralOut: netOut, grossOut: grossOut, fee: fee, lpFee: lpFee,
    tokensReturned: tokenAmount,
  };
};

CurrentMarket.prototype._computeWeights = function (mu, sigma) {
  if (!isFinite(sigma) || sigma <= 0) return null;
  var rawWeights = [];
  var weightSum = 0;
  for (var j = 0; j < this.N; j++) {
    var z = (this.centers[j] - mu) / sigma;
    if (Math.abs(z) > Z_CUTOFF) {
      rawWeights.push(0);
    } else {
      var w = Math.exp(-z * z / 2);
      rawWeights.push(w);
      weightSum += w;
    }
  }
  if (weightSum === 0) return null;
  var W = [];
  for (var j = 0; j < this.N; j++) W.push((rawWeights[j] / weightSum) * SCALE_WEIGHT);
  return W;
};

CurrentMarket.prototype.distributionBuy = function (traderName, mu, sigma, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var W = this._computeWeights(mu, sigma);
  if (!W) return { error: 'All bins outside 5 sigma' };

  var XW = 0, W2 = 0;
  for (var j = 0; j < this.N; j++) {
    XW += this.positions[j] * W[j];
    W2 += W[j] * W[j];
  }

  var kNew = this.k + net;
  var excess = kNew * kNew - this.k * this.k;
  var disc = XW * XW + W2 * excess;
  if (disc < 0) return { error: 'Negative discriminant' };
  var lambda = Math.sqrt(disc) - XW;

  var tokensPerBin = [];
  var totalTokens = 0;
  var maxTokensInBin = 0;
  var peakBin = 0;
  for (var j = 0; j < this.N; j++) {
    var t = (lambda * W[j]) / W2;
    tokensPerBin.push(t);
    this.positions[j] += t;
    th.holdings[j] += t;
    totalTokens += t;
    if (t > maxTokensInBin) { maxTokensInBin = t; peakBin = j; }
  }
  this.k = kNew;
  this.accumulatedLpFees += lpFee;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var peakPayout = maxTokensInBin * (1 - this.redemptionFeeBps / 10000);

  return {
    tokensPerBin: tokensPerBin, totalTokens: totalTokens, fee: fee, lpFee: lpFee, net: net,
    peakPayout: peakPayout, peakBin: peakBin, cost: grossCollateral,
    maxProfit: peakPayout - grossCollateral,
  };
};

CurrentMarket.prototype.distributionSell = function (traderName, mu, sigma, totalTokens) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var W = this._computeWeights(mu, sigma);
  if (!W) return { error: 'All bins outside 5 sigma' };

  var tokensPerBin = [];
  for (var j = 0; j < this.N; j++) {
    var t = totalTokens * W[j] / SCALE_WEIGHT;
    t = Math.min(t, th.holdings[j]);
    t = Math.min(t, this.positions[j]);
    tokensPerBin.push(t);
  }

  var totalSold = 0;
  for (var j = 0; j < this.N; j++) totalSold += tokensPerBin[j];
  if (totalSold < 0.01) return { error: 'No tokens available to sell in this distribution' };

  var oldK = this.k;
  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    this.positions[j] -= tokensPerBin[j];
    th.holdings[j] -= tokensPerBin[j];
    sumSq += this.positions[j] * this.positions[j];
  }

  var kNew = Math.sqrt(sumSq);
  var grossOut = oldK - kNew;
  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.k = kNew;
  this.accumulatedLpFees += lpFee;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    tokensPerBin: tokensPerBin, totalSold: totalSold, collateralOut: netOut,
    grossOut: grossOut, fee: fee, lpFee: lpFee,
  };
};

CurrentMarket.prototype.sellAll = function (traderName) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var totalTokens = 0;
  for (var j = 0; j < this.N; j++) totalTokens += th.holdings[j];
  if (totalTokens < 0.01) return { error: 'No tokens to sell' };

  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    var newPos = this.positions[j] - th.holdings[j];
    sumSq += newPos * newPos;
  }

  var kNew = Math.sqrt(sumSq);
  var grossOut = this.k - kNew;
  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  for (var j = 0; j < this.N; j++) {
    this.positions[j] -= th.holdings[j];
    th.holdings[j] = 0;
  }
  this.k = kNew;
  this.accumulatedLpFees += lpFee;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    collateralOut: netOut, grossOut: grossOut, fee: fee, lpFee: lpFee,
    tokensReturned: totalTokens,
  };
};

CurrentMarket.prototype.resolve = function (value) {
  var bin = Math.floor((value - this.rangeMin) * this.N / (this.rangeMax - this.rangeMin));
  bin = Math.max(0, Math.min(this.N - 1, bin));
  this.resolved = true;
  this.winningBin = bin;
  this.lastResolveValue = value;

  var payouts = [];

  var totalTraderTokensInWinBin = 0;
  for (var name in this.traderHoldings) {
    totalTraderTokensInWinBin += this.traderHoldings[name].holdings[bin];
  }
  var lpResidual = this.k - totalTraderTokensInWinBin;

  var totalRedemptionFees = 0;
  for (var name in this.traderHoldings) {
    var th = this.traderHoldings[name];
    var winTokens = th.holdings[bin];
    var redemptionFee = winTokens * this.redemptionFeeBps / 10000;
    totalRedemptionFees += redemptionFee;
    var payout = winTokens - redemptionFee;
    payouts.push({
      name: name, type: 'Trader',
      detail: Math.floor(winTokens).toLocaleString() + ' tokens',
      grossPayout: winTokens,
      payout: payout, fee: redemptionFee,
      spent: th.spent, received: th.received,
      netPnL: payout + th.received - th.spent,
    });
  }

  var lpPool = lpResidual + totalRedemptionFees;
  for (var name in this.lpProviders) {
    var lp = this.lpProviders[name];
    if (lp.shares <= 0 && lp.deposited <= 0) continue;
    var fraction = (this.totalLpShares > 0) ? lp.shares / this.totalLpShares : 0;
    var reserveShare = lpPool * fraction;
    var feeShare = this.accumulatedLpFees * fraction;
    var totalPayout = reserveShare + feeShare;
    var lpWithdrawn = lp.withdrawn || 0;
    payouts.push({
      name: name, type: 'LP',
      detail: Math.floor(lp.shares).toLocaleString() + ' shares',
      grossPayout: totalPayout,
      payout: totalPayout, fee: 0,
      spent: lp.deposited, received: lpWithdrawn,
      netPnL: totalPayout + lpWithdrawn - lp.deposited,
    });
  }

  this.lastResolvePayouts = payouts;
  return { winningBin: bin, payouts: payouts, lpResidual: lpResidual, claimScale: 1 };
};

CurrentMarket.prototype.getTraderPortfolio = function (traderName) {
  var gt = globalTraders[traderName];
  if (!gt) return null;
  var th = this.traderHoldings[traderName];
  var mSpent = th ? th.spent : 0;
  var mReceived = th ? th.received : 0;
  if (!th) {
    return {
      totalHoldings: 0, expectedPayout: 0, peakPayout: 0, peakBin: 0,
      wallet: gt.wallet, totalSpent: mSpent, totalReceived: mReceived,
      unrealizedPnL: mReceived - mSpent, pnlPct: 0,
    };
  }

  var probs = this.getProbabilities();
  var expectedPayout = 0;
  var totalHoldings = 0;
  var peakBin = 0;
  var peakTokens = 0;
  for (var j = 0; j < this.N; j++) {
    var h = th.holdings[j];
    totalHoldings += h;
    expectedPayout += probs[j] * h * (1 - this.redemptionFeeBps / 10000);
    if (h > peakTokens) { peakTokens = h; peakBin = j; }
  }
  var peakPayout = peakTokens * (1 - this.redemptionFeeBps / 10000);
  var unrealizedPnL = expectedPayout + mReceived - mSpent;
  var pnlPct = mSpent > 0 ? (unrealizedPnL / mSpent * 100) : 0;

  return {
    totalHoldings: totalHoldings, expectedPayout: expectedPayout,
    peakPayout: peakPayout, peakBin: peakBin,
    wallet: gt.wallet, totalSpent: mSpent, totalReceived: mReceived,
    unrealizedPnL: unrealizedPnL, pnlPct: pnlPct,
  };
};

CurrentMarket.prototype.getTraderPayoutPerOutcome = function (traderName) {
  var th = this.traderHoldings[traderName];
  if (!th) return null;
  var rf = 1 - this.redemptionFeeBps / 10000;
  var payouts = [];
  for (var w = 0; w < this.N; w++) payouts.push(th.holdings[w] * rf);
  return payouts;
};

// ============================================================
// 6. IMPROVED MARKET ENGINE (Linear Kernel)
// ============================================================
// Probability: p_i = x_i / sum(x_j)
// Resolution: Triangular kernel — nearby bins get partial payout
// Solvency: claimScale = min(1, k / totalKernelClaim)
// ============================================================
function ImprovedMarket(N, rangeMin, rangeMax, liquidity, fees) {
  this.N = N;
  this.rangeMin = rangeMin;
  this.rangeMax = rangeMax;
  this.binWidth = (rangeMax - rangeMin) / N;
  this.k = liquidity;
  this.kernelWidth = (fees && typeof fees.kernelWidth === 'number') ? fees.kernelWidth : DEFAULT_KERNEL_WIDTH;

  this.tradeFeeBps = (fees && typeof fees.tradeFeeBps === 'number') ? fees.tradeFeeBps : DEFAULT_TRADE_FEE_BPS;
  this.lpFeeSharePct = (fees && typeof fees.lpFeeSharePct === 'number') ? fees.lpFeeSharePct : DEFAULT_LP_FEE_SHARE_PCT;
  this.redemptionFeeBps = (fees && typeof fees.redemptionFeeBps === 'number') ? fees.redemptionFeeBps : DEFAULT_REDEMPTION_FEE_BPS;

  var xUniform = Math.sqrt(liquidity * liquidity / N);
  this.positions = [];
  this.centers = [];
  for (var j = 0; j < N; j++) {
    this.positions.push(xUniform);
    this.centers.push(rangeMin + (2 * j + 1) * this.binWidth / 2);
  }

  this.totalLpShares = liquidity;
  this.lpProviders = {};
  this.lpProviders['Creator'] = { shares: liquidity, deposited: liquidity, withdrawn: 0 };
  this.accumulatedLpFees = 0;
  this.traderHoldings = {};
  this.resolved = false;
  this.winningBin = -1;
  this.lastResolveValue = null;
  this.lastResolvePayouts = null;
}

ImprovedMarket.prototype.getProbabilities = function () {
  var sum = 0;
  for (var i = 0; i < this.N; i++) sum += this.positions[i];
  var probs = [];
  for (var i = 0; i < this.N; i++) {
    probs.push(sum > 0 ? this.positions[i] / sum : 1 / this.N);
  }
  return probs;
};

ImprovedMarket.prototype.getSettlementKernel = function (winBin) {
  var W = this.kernelWidth;
  var weights = [];
  for (var i = 0; i < this.N; i++) {
    var d = Math.abs(i - winBin);
    var w = Math.max(0, 1 - d / (W + 1));
    weights.push(w);
  }
  // Normalize so winning bin = 1.0
  var maxW = weights[winBin];
  if (maxW > 0) {
    for (var i = 0; i < this.N; i++) weights[i] /= maxW;
  }
  return weights;
};

ImprovedMarket.prototype.getLabels = function () {
  var labels = [];
  for (var i = 0; i < this.N; i++) {
    var lo = this.rangeMin + i * this.binWidth;
    var hi = lo + this.binWidth;
    if (this.N > 100) {
      labels.push(Math.round(lo).toString());
    } else {
      labels.push(Math.round(lo) + '-' + Math.round(hi));
    }
  }
  return labels;
};

ImprovedMarket.prototype.ensureTrader = function (name) {
  if (!this.traderHoldings[name]) {
    var holdings = [];
    for (var i = 0; i < this.N; i++) holdings.push(0);
    this.traderHoldings[name] = { holdings: holdings, spent: 0, received: 0 };
  }
};

// AMM trading is identical to CurrentMarket (same L2-norm invariant).
// Only newProb display differs (linear vs quadratic).
ImprovedMarket.prototype.discreteBuy = function (traderName, binIdx, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  if (binIdx < 0 || binIdx >= this.N) return { error: 'Invalid bin index' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var kNew = this.k + net;
  var sumOtherSq = 0;
  for (var j = 0; j < this.N; j++) {
    if (j !== binIdx) sumOtherSq += this.positions[j] * this.positions[j];
  }
  var newXi = Math.sqrt(kNew * kNew - sumOtherSq);
  if (isNaN(newXi) || newXi < 0) return { error: 'Math error: sqrt of negative' };

  var tokensOut = newXi - this.positions[binIdx];
  this.positions[binIdx] = newXi;
  this.k = kNew;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] += tokensOut;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var peakPayout = tokensOut * (1 - this.redemptionFeeBps / 10000);

  // Linear probability
  var sumPos = 0;
  for (var j = 0; j < this.N; j++) sumPos += this.positions[j];
  var newProb = sumPos > 0 ? newXi / sumPos : 1 / this.N;

  return {
    tokensOut: tokensOut, fee: fee, lpFee: lpFee, net: net,
    newProb: newProb,
    peakPayout: peakPayout, cost: grossCollateral,
    maxProfit: peakPayout - grossCollateral,
  };
};

ImprovedMarket.prototype.discreteSell = function (traderName, binIdx, tokenAmount) {
  if (this.resolved) return { error: 'Market is resolved' };
  if (binIdx < 0 || binIdx >= this.N) return { error: 'Invalid bin index' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];
  if (th.holdings[binIdx] < tokenAmount - 0.01) return { error: 'Insufficient tokens in bin ' + binIdx };

  var newXi = this.positions[binIdx] - tokenAmount;
  if (newXi < 0) return { error: 'Position would go negative' };

  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    var xj = (j === binIdx) ? newXi : this.positions[j];
    sumSq += xj * xj;
  }
  var kNew = Math.sqrt(sumSq);
  var grossOut = this.k - kNew;

  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.positions[binIdx] = newXi;
  this.k = kNew;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] -= tokenAmount;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    collateralOut: netOut, grossOut: grossOut, fee: fee, lpFee: lpFee,
    tokensReturned: tokenAmount,
  };
};

ImprovedMarket.prototype._computeWeights = function (mu, sigma) {
  if (!isFinite(sigma) || sigma <= 0) return null;
  var rawWeights = [];
  var weightSum = 0;
  for (var j = 0; j < this.N; j++) {
    var z = (this.centers[j] - mu) / sigma;
    if (Math.abs(z) > Z_CUTOFF) {
      rawWeights.push(0);
    } else {
      var w = Math.exp(-z * z / 2);
      rawWeights.push(w);
      weightSum += w;
    }
  }
  if (weightSum === 0) return null;
  var W = [];
  for (var j = 0; j < this.N; j++) W.push((rawWeights[j] / weightSum) * SCALE_WEIGHT);
  return W;
};

ImprovedMarket.prototype.distributionBuy = function (traderName, mu, sigma, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var W = this._computeWeights(mu, sigma);
  if (!W) return { error: 'All bins outside 5 sigma' };

  var XW = 0, W2 = 0;
  for (var j = 0; j < this.N; j++) {
    XW += this.positions[j] * W[j];
    W2 += W[j] * W[j];
  }

  var kNew = this.k + net;
  var excess = kNew * kNew - this.k * this.k;
  var disc = XW * XW + W2 * excess;
  if (disc < 0) return { error: 'Negative discriminant' };
  var lambda = Math.sqrt(disc) - XW;

  var tokensPerBin = [];
  var totalTokens = 0;
  var maxTokensInBin = 0;
  var peakBin = 0;
  for (var j = 0; j < this.N; j++) {
    var t = (lambda * W[j]) / W2;
    tokensPerBin.push(t);
    this.positions[j] += t;
    th.holdings[j] += t;
    totalTokens += t;
    if (t > maxTokensInBin) { maxTokensInBin = t; peakBin = j; }
  }
  this.k = kNew;
  this.accumulatedLpFees += lpFee;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var peakPayout = 0;
  var KW = this.kernelWidth;
  for (var w = 0; w < this.N; w++) {
    var payoutW = 0;
    var lo = Math.max(0, w - KW);
    var hi = Math.min(this.N - 1, w + KW);
    for (var jj = lo; jj <= hi; jj++) {
      payoutW += tokensPerBin[jj] * (1 - Math.abs(jj - w) / (KW + 1));
    }
    if (payoutW > peakPayout) { peakPayout = payoutW; peakBin = w; }
  }
  peakPayout *= (1 - this.redemptionFeeBps / 10000);

  return {
    tokensPerBin: tokensPerBin, totalTokens: totalTokens, fee: fee, lpFee: lpFee, net: net,
    peakPayout: peakPayout, peakBin: peakBin, cost: grossCollateral,
    maxProfit: peakPayout - grossCollateral,
  };
};

ImprovedMarket.prototype.distributionSell = function (traderName, mu, sigma, totalTokens) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var W = this._computeWeights(mu, sigma);
  if (!W) return { error: 'All bins outside 5 sigma' };

  var tokensPerBin = [];
  for (var j = 0; j < this.N; j++) {
    var t = totalTokens * W[j] / SCALE_WEIGHT;
    t = Math.min(t, th.holdings[j]);
    t = Math.min(t, this.positions[j]);
    tokensPerBin.push(t);
  }

  var totalSold = 0;
  for (var j = 0; j < this.N; j++) totalSold += tokensPerBin[j];
  if (totalSold < 0.01) return { error: 'No tokens available to sell in this distribution' };

  var oldK = this.k;
  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    this.positions[j] -= tokensPerBin[j];
    th.holdings[j] -= tokensPerBin[j];
    sumSq += this.positions[j] * this.positions[j];
  }

  var kNew = Math.sqrt(sumSq);
  var grossOut = oldK - kNew;
  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.k = kNew;
  this.accumulatedLpFees += lpFee;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    tokensPerBin: tokensPerBin, totalSold: totalSold, collateralOut: netOut,
    grossOut: grossOut, fee: fee, lpFee: lpFee,
  };
};

ImprovedMarket.prototype.sellAll = CurrentMarket.prototype.sellAll;

ImprovedMarket.prototype.resolve = function (value) {
  var bin = Math.floor((value - this.rangeMin) * this.N / (this.rangeMax - this.rangeMin));
  bin = Math.max(0, Math.min(this.N - 1, bin));
  this.resolved = true;
  this.winningBin = bin;
  this.lastResolveValue = value;

  var kernel = this.getSettlementKernel(bin);
  var payouts = [];

  // Compute total kernel-weighted trader claims
  var totalKernelClaim = 0;
  var traderClaims = {};
  for (var name in this.traderHoldings) {
    var th = this.traderHoldings[name];
    var claim = 0;
    for (var i = 0; i < this.N; i++) {
      claim += th.holdings[i] * kernel[i];
    }
    traderClaims[name] = claim;
    totalKernelClaim += claim;
  }

  // Solvency guard
  var claimScale = 1;
  if (totalKernelClaim > this.k && totalKernelClaim > 0) {
    claimScale = this.k / totalKernelClaim;
  }
  var lpResidual = this.k - totalKernelClaim * claimScale;

  var totalRedemptionFees = 0;
  for (var name in this.traderHoldings) {
    var th = this.traderHoldings[name];
    var grossPayout = traderClaims[name] * claimScale;
    var redemptionFee = grossPayout * this.redemptionFeeBps / 10000;
    totalRedemptionFees += redemptionFee;
    var payout = grossPayout - redemptionFee;

    // Build detail string showing kernel contributions
    var kernelBins = [];
    for (var i = 0; i < this.N; i++) {
      if (th.holdings[i] > 0.01 && kernel[i] > 0) {
        kernelBins.push({ bin: i, value: Math.floor(th.holdings[i] * kernel[i] * claimScale) });
      }
    }
    var scaleSuffix = claimScale < 1 ? ' (scaled ' + (claimScale * 100).toFixed(1) + '%)' : '';
    var shortDetail;
    if (kernelBins.length === 0) {
      shortDetail = 'No tokens';
    } else if (kernelBins.length === 1) {
      shortDetail = 'bin ' + kernelBins[0].bin + ': ' + kernelBins[0].value.toLocaleString() + scaleSuffix;
    } else {
      shortDetail = kernelBins.length + ' bins' + scaleSuffix;
    }

    payouts.push({
      name: name, type: 'Trader',
      detail: shortDetail, detailBins: kernelBins,
      grossPayout: grossPayout,
      payout: payout, fee: redemptionFee,
      spent: th.spent, received: th.received,
      netPnL: payout + th.received - th.spent,
    });
  }

  var lpPool = lpResidual + totalRedemptionFees;
  for (var name in this.lpProviders) {
    var lp = this.lpProviders[name];
    if (lp.shares <= 0 && lp.deposited <= 0) continue;
    var fraction = (this.totalLpShares > 0) ? lp.shares / this.totalLpShares : 0;
    var reserveShare = lpPool * fraction;
    var feeShare = this.accumulatedLpFees * fraction;
    var totalPayout = reserveShare + feeShare;
    var lpWithdrawn = lp.withdrawn || 0;
    payouts.push({
      name: name, type: 'LP',
      detail: Math.floor(lp.shares).toLocaleString() + ' shares',
      grossPayout: totalPayout,
      payout: totalPayout, fee: 0,
      spent: lp.deposited, received: lpWithdrawn,
      netPnL: totalPayout + lpWithdrawn - lp.deposited,
    });
  }

  this.lastResolvePayouts = payouts;
  return { winningBin: bin, payouts: payouts, lpResidual: lpResidual, claimScale: claimScale };
};

ImprovedMarket.prototype.getTraderPortfolio = function (traderName) {
  var gt = globalTraders[traderName];
  if (!gt) return null;
  var th = this.traderHoldings[traderName];
  var mSpent = th ? th.spent : 0;
  var mReceived = th ? th.received : 0;
  if (!th) {
    return {
      totalHoldings: 0, expectedPayout: 0, peakPayout: 0, peakBin: 0,
      wallet: gt.wallet, totalSpent: mSpent, totalReceived: mReceived,
      unrealizedPnL: mReceived - mSpent, pnlPct: 0,
    };
  }

  var probs = this.getProbabilities();
  var expectedPayout = 0;
  var totalHoldings = 0;
  var peakBin = 0;

  var KW = this.kernelWidth;
  var redemptionFactor = 1 - this.redemptionFeeBps / 10000;
  var peakPayout = 0;
  for (var w = 0; w < this.N; w++) {
    var payoutIfW = 0;
    var lo = Math.max(0, w - KW);
    var hi = Math.min(this.N - 1, w + KW);
    for (var j = lo; j <= hi; j++) {
      payoutIfW += th.holdings[j] * (1 - Math.abs(j - w) / (KW + 1));
    }
    expectedPayout += probs[w] * payoutIfW * redemptionFactor;
    if (payoutIfW > peakPayout) { peakPayout = payoutIfW; peakBin = w; }
  }
  peakPayout *= (1 - this.redemptionFeeBps / 10000);

  for (var j = 0; j < this.N; j++) {
    totalHoldings += th.holdings[j];
  }

  var unrealizedPnL = expectedPayout + mReceived - mSpent;
  var pnlPct = mSpent > 0 ? (unrealizedPnL / mSpent * 100) : 0;

  return {
    totalHoldings: totalHoldings, expectedPayout: expectedPayout,
    peakPayout: peakPayout, peakBin: peakBin,
    wallet: gt.wallet, totalSpent: mSpent, totalReceived: mReceived,
    unrealizedPnL: unrealizedPnL, pnlPct: pnlPct,
  };
};

ImprovedMarket.prototype.getTraderPayoutPerOutcome = function (traderName) {
  var th = this.traderHoldings[traderName];
  if (!th) return null;
  var KW = this.kernelWidth;
  var rf = 1 - this.redemptionFeeBps / 10000;
  var totalHPB = [];
  for (var i = 0; i < this.N; i++) totalHPB.push(0);
  for (var n in this.traderHoldings) {
    var thh = this.traderHoldings[n];
    for (var i = 0; i < this.N; i++) totalHPB[i] += thh.holdings[i];
  }
  var payouts = [];
  for (var w = 0; w < this.N; w++) {
    var myClaim = 0, totalClaim = 0;
    var lo = Math.max(0, w - KW), hi = Math.min(this.N - 1, w + KW);
    for (var j = lo; j <= hi; j++) {
      var kw = 1 - Math.abs(j - w) / (KW + 1);
      myClaim += th.holdings[j] * kw;
      totalClaim += totalHPB[j] * kw;
    }
    var cs = (totalClaim > this.k && totalClaim > 0) ? this.k / totalClaim : 1;
    payouts.push(myClaim * cs * rf);
  }
  return payouts;
};

// ============================================================
// LP OPERATIONS
// ============================================================

CurrentMarket.prototype.addLiquidity = function (lpName, amount) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[lpName];
  if (!gt) return { error: 'Unknown user' };
  if (gt.wallet < amount) return { error: 'Insufficient balance' };

  var newShares = this.totalLpShares > 0 ? this.totalLpShares * amount / this.k : amount;
  var scaleFactor = (this.k + amount) / this.k;
  for (var j = 0; j < this.N; j++) this.positions[j] *= scaleFactor;

  this.k += amount;
  this.totalLpShares += newShares;
  if (!this.lpProviders[lpName]) this.lpProviders[lpName] = { shares: 0, deposited: 0, withdrawn: 0 };
  this.lpProviders[lpName].shares += newShares;
  this.lpProviders[lpName].deposited += amount;
  gt.wallet -= amount;

  return {
    sharesReceived: newShares, totalShares: this.totalLpShares,
    poolFraction: this.lpProviders[lpName].shares / this.totalLpShares, amount: amount,
  };
};

CurrentMarket.prototype.removeLiquidity = function (lpName, amount) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[lpName];
  if (!gt) return { error: 'Unknown user' };
  var lp = this.lpProviders[lpName];
  if (!lp || lp.shares <= 0) return { error: 'No LP position' };

  var maxAmount = this.k * lp.shares / this.totalLpShares;
  var actualAmount = Math.min(amount, maxAmount);
  var sharesToBurn = actualAmount * this.totalLpShares / this.k;
  sharesToBurn = Math.min(sharesToBurn, lp.shares);

  var collateralOut = this.k * sharesToBurn / this.totalLpShares;
  var feeShare = this.accumulatedLpFees * sharesToBurn / this.totalLpShares;
  var totalPayout = collateralOut + feeShare;

  var scaleFactor = (this.k - collateralOut) / this.k;
  for (var j = 0; j < this.N; j++) this.positions[j] *= scaleFactor;

  this.k -= collateralOut;
  this.totalLpShares -= sharesToBurn;
  this.accumulatedLpFees -= feeShare;
  lp.shares -= sharesToBurn;
  lp.withdrawn += totalPayout;
  gt.wallet += totalPayout;

  return {
    sharesBurned: sharesToBurn, collateralOut: collateralOut,
    feeShare: feeShare, totalPayout: totalPayout,
    remainingShares: lp.shares,
    poolFraction: this.totalLpShares > 0 ? lp.shares / this.totalLpShares : 0,
  };
};

CurrentMarket.prototype.getLpPortfolio = function (lpName) {
  var lp = this.lpProviders[lpName];
  if (!lp) return null;
  var poolFraction = this.totalLpShares > 0 ? lp.shares / this.totalLpShares : 0;
  var feeEarnings = this.accumulatedLpFees * poolFraction;
  var currentValue = this.k * poolFraction + feeEarnings;
  var unrealizedPnL = currentValue + lp.withdrawn - lp.deposited;

  var payoutPerOutcome = [];
  for (var bin = 0; bin < this.N; bin++) {
    var totalTraderTokens = 0;
    for (var name in this.traderHoldings) totalTraderTokens += this.traderHoldings[name].holdings[bin];
    var lpResidual = this.k - totalTraderTokens;
    var redemptionFees = totalTraderTokens * this.redemptionFeeBps / 10000;
    payoutPerOutcome.push((lpResidual + redemptionFees) * poolFraction + feeEarnings);
  }

  return {
    shares: lp.shares, totalShares: this.totalLpShares, poolFraction: poolFraction,
    deposited: lp.deposited, withdrawn: lp.withdrawn, feeEarnings: feeEarnings,
    currentValue: currentValue, unrealizedPnL: unrealizedPnL,
    pnlPct: lp.deposited > 0 ? unrealizedPnL / lp.deposited * 100 : 0,
    payoutPerOutcome: payoutPerOutcome,
  };
};

CurrentMarket.prototype.getAllLpPortfolio = function () {
  var totalDeposited = 0, totalWithdrawn = 0;
  for (var name in this.lpProviders) {
    totalDeposited += this.lpProviders[name].deposited;
    totalWithdrawn += this.lpProviders[name].withdrawn;
  }
  var feeEarnings = this.accumulatedLpFees;
  var currentValue = this.k + feeEarnings;
  var unrealizedPnL = currentValue + totalWithdrawn - totalDeposited;

  var payoutPerOutcome = [];
  for (var bin = 0; bin < this.N; bin++) {
    var totalTraderTokens = 0;
    for (var n in this.traderHoldings) totalTraderTokens += this.traderHoldings[n].holdings[bin];
    var lpResidual = this.k - totalTraderTokens;
    var redemptionFees = totalTraderTokens * this.redemptionFeeBps / 10000;
    payoutPerOutcome.push(lpResidual + redemptionFees + feeEarnings);
  }

  return {
    shares: this.totalLpShares, totalShares: this.totalLpShares, poolFraction: 1,
    deposited: totalDeposited, withdrawn: totalWithdrawn, feeEarnings: feeEarnings,
    currentValue: currentValue, unrealizedPnL: unrealizedPnL,
    pnlPct: totalDeposited > 0 ? unrealizedPnL / totalDeposited * 100 : 0,
    payoutPerOutcome: payoutPerOutcome,
  };
};

ImprovedMarket.prototype.addLiquidity = CurrentMarket.prototype.addLiquidity;
ImprovedMarket.prototype.removeLiquidity = CurrentMarket.prototype.removeLiquidity;

ImprovedMarket.prototype.getLpPortfolio = function (lpName) {
  var lp = this.lpProviders[lpName];
  if (!lp) return null;
  var poolFraction = this.totalLpShares > 0 ? lp.shares / this.totalLpShares : 0;
  var feeEarnings = this.accumulatedLpFees * poolFraction;
  var currentValue = this.k * poolFraction + feeEarnings;
  var unrealizedPnL = currentValue + lp.withdrawn - lp.deposited;

  var totalHoldingsPerBin = [];
  for (var i = 0; i < this.N; i++) totalHoldingsPerBin.push(0);
  for (var name in this.traderHoldings) {
    var thh = this.traderHoldings[name];
    for (var i = 0; i < this.N; i++) totalHoldingsPerBin[i] += thh.holdings[i];
  }

  var KW = this.kernelWidth;
  var payoutPerOutcome = [];
  for (var bin = 0; bin < this.N; bin++) {
    var totalKernelClaim = 0;
    var lo = Math.max(0, bin - KW);
    var hi = Math.min(this.N - 1, bin + KW);
    for (var i = lo; i <= hi; i++) {
      totalKernelClaim += totalHoldingsPerBin[i] * (1 - Math.abs(i - bin) / (KW + 1));
    }
    var claimScale = (totalKernelClaim > this.k && totalKernelClaim > 0) ? this.k / totalKernelClaim : 1;
    var lpResidual = this.k - totalKernelClaim * claimScale;
    var redemptionFees = totalKernelClaim * claimScale * this.redemptionFeeBps / 10000;
    payoutPerOutcome.push((lpResidual + redemptionFees) * poolFraction + feeEarnings);
  }

  return {
    shares: lp.shares, totalShares: this.totalLpShares, poolFraction: poolFraction,
    deposited: lp.deposited, withdrawn: lp.withdrawn, feeEarnings: feeEarnings,
    currentValue: currentValue, unrealizedPnL: unrealizedPnL,
    pnlPct: lp.deposited > 0 ? unrealizedPnL / lp.deposited * 100 : 0,
    payoutPerOutcome: payoutPerOutcome,
  };
};

ImprovedMarket.prototype.getAllLpPortfolio = function () {
  var totalDeposited = 0, totalWithdrawn = 0;
  for (var name in this.lpProviders) {
    totalDeposited += this.lpProviders[name].deposited;
    totalWithdrawn += this.lpProviders[name].withdrawn;
  }
  var feeEarnings = this.accumulatedLpFees;
  var currentValue = this.k + feeEarnings;
  var unrealizedPnL = currentValue + totalWithdrawn - totalDeposited;

  var totalHoldingsPerBin = [];
  for (var i = 0; i < this.N; i++) totalHoldingsPerBin.push(0);
  for (var n in this.traderHoldings) {
    var thh = this.traderHoldings[n];
    for (var i = 0; i < this.N; i++) totalHoldingsPerBin[i] += thh.holdings[i];
  }

  var KW = this.kernelWidth;
  var payoutPerOutcome = [];
  for (var bin = 0; bin < this.N; bin++) {
    var totalKernelClaim = 0;
    var lo = Math.max(0, bin - KW);
    var hi = Math.min(this.N - 1, bin + KW);
    for (var i = lo; i <= hi; i++) {
      totalKernelClaim += totalHoldingsPerBin[i] * (1 - Math.abs(i - bin) / (KW + 1));
    }
    var claimScale = (totalKernelClaim > this.k && totalKernelClaim > 0) ? this.k / totalKernelClaim : 1;
    var lpResidual = this.k - totalKernelClaim * claimScale;
    var redemptionFees = totalKernelClaim * claimScale * this.redemptionFeeBps / 10000;
    payoutPerOutcome.push(lpResidual + redemptionFees + feeEarnings);
  }

  return {
    shares: this.totalLpShares, totalShares: this.totalLpShares, poolFraction: 1,
    deposited: totalDeposited, withdrawn: totalWithdrawn, feeEarnings: feeEarnings,
    currentValue: currentValue, unrealizedPnL: unrealizedPnL,
    pnlPct: totalDeposited > 0 ? unrealizedPnL / totalDeposited * 100 : 0,
    payoutPerOutcome: payoutPerOutcome,
  };
};

// ============================================================
// 7. DUAL MARKET ORCHESTRATOR
// ============================================================
// Wraps CurrentMarket + ImprovedMarket. Every action is applied
// atomically to both engines with separate wallet snapshots.
// ============================================================
function DualMarket() {
  this.current = null;
  this.improved = null;
  this.traders = {};  // { name: { currentWallet, improvedWallet, initialBalance } }
  this.initialized = false;
}

DualMarket.prototype.init = function (N, rangeMin, rangeMax, liquidity, fees, kernelWidth) {
  var baseFees = {
    tradeFeeBps: (fees && fees.tradeFeeBps) || 0,
    lpFeeSharePct: (fees && fees.lpFeeSharePct) || 0,
    redemptionFeeBps: (fees && fees.redemptionFeeBps) || 0,
  };

  this.current = new CurrentMarket(N, rangeMin, rangeMax, liquidity, baseFees);

  var improvedFees = {
    tradeFeeBps: baseFees.tradeFeeBps,
    lpFeeSharePct: baseFees.lpFeeSharePct,
    redemptionFeeBps: baseFees.redemptionFeeBps,
    kernelWidth: typeof kernelWidth === 'number' ? kernelWidth : DEFAULT_KERNEL_WIDTH,
  };
  this.improved = new ImprovedMarket(N, rangeMin, rangeMax, liquidity, improvedFees);

  this.traders = {};
  this.traders['Creator'] = { currentWallet: 0, improvedWallet: 0, initialBalance: liquidity };
  globalTraders = {};
  this.initialized = true;
  this.initConfig = {
    N: N, rangeMin: rangeMin, rangeMax: rangeMax, liquidity: liquidity,
    fees: baseFees, kernelWidth: improvedFees.kernelWidth,
  };

  return { current: this.current, improved: this.improved };
};

DualMarket.prototype.addTrader = function (name, balance) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (this.traders[name]) return { error: 'Trader already exists: ' + name };

  this.traders[name] = { currentWallet: balance, improvedWallet: balance, initialBalance: balance };
  return { name: name, balance: balance };
};

DualMarket.prototype._setWallets = function (traderName, engine) {
  var t = this.traders[traderName];
  if (!t) return false;
  if (engine === 'current') {
    globalTraders[traderName] = { wallet: t.currentWallet };
  } else {
    globalTraders[traderName] = { wallet: t.improvedWallet };
  }
  return true;
};

DualMarket.prototype._saveWallet = function (traderName, engine) {
  var t = this.traders[traderName];
  if (!t || !globalTraders[traderName]) return;
  if (engine === 'current') {
    t.currentWallet = globalTraders[traderName].wallet;
  } else {
    t.improvedWallet = globalTraders[traderName].wallet;
  }
};

DualMarket.prototype._dualTrade = function (method, traderName, args) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[traderName]) return { error: 'Unknown trader: ' + traderName };

  // Dry-run on current engine
  this._setWallets(traderName, 'current');
  var currentResult = this.current[method].apply(this.current, [traderName].concat(args));

  if (currentResult.error) {
    return { error: 'Current engine: ' + currentResult.error, current: currentResult, improved: null };
  }

  // Since the current engine already mutated state, we need to proceed with improved.
  // But first, save the current wallet.
  this._saveWallet(traderName, 'current');

  // Execute on improved engine
  this._setWallets(traderName, 'improved');
  var improvedResult = this.improved[method].apply(this.improved, [traderName].concat(args));

  if (improvedResult.error) {
    // Current already executed — this shouldn't happen since both use same L2 AMM.
    // Log warning but continue.
    console.warn('Dual trade divergence: current succeeded but improved failed:', improvedResult.error);
  }
  this._saveWallet(traderName, 'improved');

  return { current: currentResult, improved: improvedResult };
};

DualMarket.prototype.discreteBuy = function (traderName, binIdx, amount) {
  return this._dualTrade('discreteBuy', traderName, [binIdx, amount]);
};

DualMarket.prototype.discreteSell = function (traderName, binIdx, amount) {
  return this._dualTrade('discreteSell', traderName, [binIdx, amount]);
};

DualMarket.prototype.distributionBuy = function (traderName, mu, sigma, amount) {
  return this._dualTrade('distributionBuy', traderName, [mu, sigma, amount]);
};

DualMarket.prototype.distributionSell = function (traderName, mu, sigma, amount) {
  return this._dualTrade('distributionSell', traderName, [mu, sigma, amount]);
};

DualMarket.prototype.sellAll = function (traderName) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[traderName]) return { error: 'Unknown trader: ' + traderName };

  this._setWallets(traderName, 'current');
  var currentResult = this.current.sellAll(traderName);
  if (currentResult.error) {
    return { error: currentResult.error, current: currentResult, improved: null };
  }
  this._saveWallet(traderName, 'current');

  this._setWallets(traderName, 'improved');
  var improvedResult = this.improved.sellAll(traderName);
  this._saveWallet(traderName, 'improved');

  return { current: currentResult, improved: improvedResult };
};

DualMarket.prototype.resolve = function (value) {
  if (!this.initialized) return { error: 'Market not initialized' };

  // Set up all trader wallets for resolution (wallets aren't used by resolve, but just in case)
  for (var name in this.traders) {
    this._setWallets(name, 'current');
  }
  var currentResult = this.current.resolve(value);

  for (var name in this.traders) {
    this._setWallets(name, 'improved');
  }
  var improvedResult = this.improved.resolve(value);

  return { current: currentResult, improved: improvedResult };
};

DualMarket.prototype.getPortfolios = function (traderName) {
  if (!this.initialized || !this.traders[traderName]) return null;

  this._setWallets(traderName, 'current');
  var currentPortfolio = this.current.getTraderPortfolio(traderName);

  this._setWallets(traderName, 'improved');
  var improvedPortfolio = this.improved.getTraderPortfolio(traderName);

  return { current: currentPortfolio, improved: improvedPortfolio };
};

DualMarket.prototype.getTraderBalance = function (traderName) {
  var t = this.traders[traderName];
  if (!t) return null;
  return { current: t.currentWallet, improved: t.improvedWallet };
};

// Verify both engines have identical positions (AMM invariant check)
DualMarket.prototype.verifySync = function () {
  if (!this.initialized) return { synced: false, error: 'Not initialized' };
  var maxDrift = 0;
  for (var j = 0; j < this.current.N; j++) {
    var diff = Math.abs(this.current.positions[j] - this.improved.positions[j]);
    if (diff > maxDrift) maxDrift = diff;
  }
  var kDiff = Math.abs(this.current.k - this.improved.k);
  return {
    synced: maxDrift < 0.001 && kDiff < 0.001,
    maxPositionDrift: maxDrift,
    kDrift: kDiff,
  };
};

DualMarket.prototype.addLiquidity = function (lpName, amount) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[lpName]) return { error: 'Unknown user: ' + lpName };

  this._setWallets(lpName, 'current');
  var currentResult = this.current.addLiquidity(lpName, amount);
  if (currentResult.error) return { error: currentResult.error, current: currentResult, improved: null };
  this._saveWallet(lpName, 'current');

  this._setWallets(lpName, 'improved');
  var improvedResult = this.improved.addLiquidity(lpName, amount);
  this._saveWallet(lpName, 'improved');

  return { current: currentResult, improved: improvedResult };
};

DualMarket.prototype.removeLiquidity = function (lpName, amount) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[lpName]) return { error: 'Unknown user: ' + lpName };

  this._setWallets(lpName, 'current');
  var currentResult = this.current.removeLiquidity(lpName, amount);
  if (currentResult.error) return { error: currentResult.error, current: currentResult, improved: null };
  this._saveWallet(lpName, 'current');

  this._setWallets(lpName, 'improved');
  var improvedResult = this.improved.removeLiquidity(lpName, amount);
  this._saveWallet(lpName, 'improved');

  return { current: currentResult, improved: improvedResult };
};

// --- Serialization (Save/Load) ---
CurrentMarket.prototype.getState = function () {
  return {
    k: this.k, positions: this.positions.slice(),
    totalLpShares: this.totalLpShares,
    lpProviders: JSON.parse(JSON.stringify(this.lpProviders)),
    accumulatedLpFees: this.accumulatedLpFees,
    traderHoldings: JSON.parse(JSON.stringify(this.traderHoldings)),
    resolved: this.resolved, winningBin: this.winningBin,
    lastResolveValue: this.lastResolveValue,
    lastResolvePayouts: this.lastResolvePayouts,
  };
};

CurrentMarket.prototype.loadState = function (s) {
  this.k = s.k;
  this.positions = s.positions.slice();
  this.totalLpShares = s.totalLpShares;
  this.lpProviders = JSON.parse(JSON.stringify(s.lpProviders));
  this.accumulatedLpFees = s.accumulatedLpFees;
  this.traderHoldings = JSON.parse(JSON.stringify(s.traderHoldings));
  this.resolved = s.resolved;
  this.winningBin = s.winningBin;
  this.lastResolveValue = s.lastResolveValue;
  this.lastResolvePayouts = s.lastResolvePayouts;
};

ImprovedMarket.prototype.getState = CurrentMarket.prototype.getState;
ImprovedMarket.prototype.loadState = CurrentMarket.prototype.loadState;

DualMarket.prototype.serialize = function () {
  return JSON.stringify({
    initConfig: this.initConfig,
    traders: this.traders,
    current: this.current.getState(),
    improved: this.improved.getState(),
  });
};

DualMarket.loadFromSave = function (json) {
  var d = typeof json === 'string' ? JSON.parse(json) : json;
  var c = d.initConfig;
  var dm = new DualMarket();
  dm.init(c.N, c.rangeMin, c.rangeMax, c.liquidity, c.fees, c.kernelWidth);
  dm.current.loadState(d.current);
  dm.improved.loadState(d.improved);
  dm.traders = d.traders;
  return dm;
};

DualMarket.prototype.getLpPortfolios = function (lpName) {
  if (!this.initialized) return null;
  if (lpName === '__ALL__') {
    return { current: this.current.getAllLpPortfolio(), improved: this.improved.getAllLpPortfolio() };
  }
  return { current: this.current.getLpPortfolio(lpName), improved: this.improved.getLpPortfolio(lpName) };
};

// ============================================================
// 8. INITIALIZATION
// ============================================================
(function () {
  loadSettings();
  applyHtmlClass();
  applyFontSize(settings.fontSize);
})();
