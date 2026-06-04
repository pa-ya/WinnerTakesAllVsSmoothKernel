// ============================================================
// DekantPM — Market Comparison Playground
// ============================================================
// Two continuous market engines running side-by-side under the
// SAME smooth-kernel settlement, differing ONLY in the AMM:
//   • L2-norm AMM (hypersphere invariant sum(x_i^2)=k^2)
//   • LMSR AMM    (cost function C(q)=b·ln Σexp(q_i/b))
// Shared inputs, separate outputs (trader & LP profitability).
//
// NOTE (internal naming): the DualMarket.current slot holds the
// LMSR engine (UI left column); DualMarket.improved holds the
// L2-norm engine (UI right column). These property names are kept
// from the previous (WTA-vs-kernel) version to bound UI churn; a
// clean rename to lmsr/l2 is scheduled for Phase 2.
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
  if (icon) icon.textContent = currentTheme === 'dark' ? '☾' : '☀';
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
// 5. SHARED HELPERS (engine-agnostic math)
// ============================================================

// Gaussian distribution weights over bins (normalized to sum SCALE_WEIGHT).
// Depends only on centers + N; shared by both engines' distribution trades.
function gaussianWeights(centers, N, mu, sigma) {
  if (!isFinite(sigma) || sigma <= 0) return null;
  var rawWeights = [];
  var weightSum = 0;
  for (var j = 0; j < N; j++) {
    var z = (centers[j] - mu) / sigma;
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
  for (var j = 0; j < N; j++) W.push((rawWeights[j] / weightSum) * SCALE_WEIGHT);
  return W;
}

// Peak kernel-weighted payout over all possible winning bins, for a single
// trade's tokensPerBin. Identical for both engines (settlement is shared).
function computeKernelPeak(tokensPerBin, N, KW, redemptionFeeBps) {
  var peakPayout = 0, peakBin = 0;
  for (var w = 0; w < N; w++) {
    var payoutW = 0;
    var lo = Math.max(0, w - KW);
    var hi = Math.min(N - 1, w + KW);
    for (var jj = lo; jj <= hi; jj++) {
      payoutW += tokensPerBin[jj] * (1 - Math.abs(jj - w) / (KW + 1));
    }
    if (payoutW > peakPayout) { peakPayout = payoutW; peakBin = w; }
  }
  peakPayout *= (1 - redemptionFeeBps / 10000);
  return { peakPayout: peakPayout, peakBin: peakBin };
}

// --- LMSR cost-function primitives ---
// C(q; b) = m + b·ln Σ exp((q_i − m)/b),  m = max q_i  (log-sum-exp stable form)
function lmsrCost(q, b) {
  var n = q.length, m = -Infinity, i;
  for (i = 0; i < n; i++) if (q[i] > m) m = q[i];
  var sum = 0;
  for (i = 0; i < n; i++) sum += Math.exp((q[i] - m) / b);
  return m + b * Math.log(sum);
}

// p_i = softmax(q_i / b)
function lmsrPrices(q, b) {
  var n = q.length, m = -Infinity, i;
  for (i = 0; i < n; i++) if (q[i] > m) m = q[i];
  var ex = [], sum = 0;
  for (i = 0; i < n; i++) { var e = Math.exp((q[i] - m) / b); ex.push(e); sum += e; }
  var p = [];
  for (i = 0; i < n; i++) p.push(ex[i] / sum);
  return p;
}

// Solve for b such that C(q; b) = target. C is strictly increasing in b
// (dC/db = entropy(prices) ≥ 0), with range (max q_i, ∞), so a unique b exists
// for any target > max q_i. Bisection.
function lmsrSolveB(q, target) {
  var lo = 1e-12, hi = 1, guard = 0;
  while (lmsrCost(q, hi) < target && guard++ < 300) hi *= 2;
  for (var it = 0; it < 300; it++) {
    var mid = 0.5 * (lo + hi);
    var c = lmsrCost(q, mid);
    if (Math.abs(c - target) <= Math.max(1e-9, 1e-12 * target)) return mid;
    if (c < target) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Solve for scalar s ≥ 0 such that C(q + s·dir; b) − C(q; b) = target.
// f(s) is monotone increasing in s for any non-negative dir; bisection.
function lmsrSolveShares(q, b, dir, target) {
  if (target <= 0) return 0;
  var n = q.length, c0 = lmsrCost(q, b);
  function f(s) {
    var qq = new Array(n);
    for (var i = 0; i < n; i++) qq[i] = q[i] + s * dir[i];
    return lmsrCost(qq, b) - c0;
  }
  var lo = 0, hi = target + 1, guard = 0;
  while (f(hi) < target && guard++ < 300) hi *= 2;
  for (var it = 0; it < 300; it++) {
    var mid = 0.5 * (lo + hi);
    var v = f(mid);
    if (Math.abs(v - target) <= Math.max(1e-9, 1e-12 * target)) return mid;
    if (v < target) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ============================================================
// 6. SHARED SMOOTH-KERNEL SETTLEMENT (mixin)
// ============================================================
// These methods depend only on: N, kernelWidth, rangeMin/Max, binWidth,
// centers, traderHoldings, lpProviders, totalLpShares, accumulatedLpFees,
// redemptionFeeBps, this.getPool() and this.getProbabilities(). They are
// assigned to BOTH engine prototypes so the settlement / portfolio / LP
// payout math is provably identical across L2-norm and LMSR.
// ============================================================
var SmoothKernel = {};

SmoothKernel.ensureTrader = function (name) {
  if (!this.traderHoldings[name]) {
    var holdings = [];
    for (var i = 0; i < this.N; i++) holdings.push(0);
    this.traderHoldings[name] = { holdings: holdings, spent: 0, received: 0 };
  }
};

SmoothKernel.getLabels = function () {
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

SmoothKernel._computeWeights = function (mu, sigma) {
  return gaussianWeights(this.centers, this.N, mu, sigma);
};

SmoothKernel.getSettlementKernel = function (winBin) {
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

SmoothKernel.resolve = function (value) {
  var bin = Math.floor((value - this.rangeMin) * this.N / (this.rangeMax - this.rangeMin));
  bin = Math.max(0, Math.min(this.N - 1, bin));
  this.resolved = true;
  this.winningBin = bin;
  this.lastResolveValue = value;

  var pool = this.getPool();
  var kernel = this.getSettlementKernel(bin);
  var payouts = [];

  // Total kernel-weighted trader claims
  var totalKernelClaim = 0;
  var traderClaims = {};
  for (var name in this.traderHoldings) {
    var th = this.traderHoldings[name];
    var claim = 0;
    for (var i = 0; i < this.N; i++) claim += th.holdings[i] * kernel[i];
    traderClaims[name] = claim;
    totalKernelClaim += claim;
  }

  // Solvency guard
  var claimScale = 1;
  if (totalKernelClaim > pool && totalKernelClaim > 0) claimScale = pool / totalKernelClaim;
  var lpResidual = pool - totalKernelClaim * claimScale;

  var totalRedemptionFees = 0;
  for (var name in this.traderHoldings) {
    var th = this.traderHoldings[name];
    var grossPayout = traderClaims[name] * claimScale;
    var redemptionFee = grossPayout * this.redemptionFeeBps / 10000;
    totalRedemptionFees += redemptionFee;
    var payout = grossPayout - redemptionFee;

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

SmoothKernel.getTraderPortfolio = function (traderName) {
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

  for (var j = 0; j < this.N; j++) totalHoldings += th.holdings[j];

  var unrealizedPnL = expectedPayout + mReceived - mSpent;
  var pnlPct = mSpent > 0 ? (unrealizedPnL / mSpent * 100) : 0;

  return {
    totalHoldings: totalHoldings, expectedPayout: expectedPayout,
    peakPayout: peakPayout, peakBin: peakBin,
    wallet: gt.wallet, totalSpent: mSpent, totalReceived: mReceived,
    unrealizedPnL: unrealizedPnL, pnlPct: pnlPct,
  };
};

SmoothKernel.getTraderPayoutPerOutcome = function (traderName) {
  var th = this.traderHoldings[traderName];
  if (!th) return null;
  var pool = this.getPool();
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
    var cs = (totalClaim > pool && totalClaim > 0) ? pool / totalClaim : 1;
    payouts.push(myClaim * cs * rf);
  }
  return payouts;
};

SmoothKernel.getLpPortfolio = function (lpName) {
  var lp = this.lpProviders[lpName];
  if (!lp) return null;
  var pool = this.getPool();
  var poolFraction = this.totalLpShares > 0 ? lp.shares / this.totalLpShares : 0;
  var feeEarnings = this.accumulatedLpFees * poolFraction;
  var currentValue = pool * poolFraction + feeEarnings;
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
    var claimScale = (totalKernelClaim > pool && totalKernelClaim > 0) ? pool / totalKernelClaim : 1;
    var lpResidual = pool - totalKernelClaim * claimScale;
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

SmoothKernel.getAllLpPortfolio = function () {
  var pool = this.getPool();
  var totalDeposited = 0, totalWithdrawn = 0;
  for (var name in this.lpProviders) {
    totalDeposited += this.lpProviders[name].deposited;
    totalWithdrawn += this.lpProviders[name].withdrawn;
  }
  var feeEarnings = this.accumulatedLpFees;
  var currentValue = pool + feeEarnings;
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
    var claimScale = (totalKernelClaim > pool && totalKernelClaim > 0) ? pool / totalKernelClaim : 1;
    var lpResidual = pool - totalKernelClaim * claimScale;
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

// Generic sell-all by token holdings — works for either AMM because it routes
// through the engine's own discreteSell-style mechanics via _sellShares hook.
SmoothKernel.sellAll = function (traderName) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var totalTokens = 0;
  for (var j = 0; j < this.N; j++) totalTokens += th.holdings[j];
  if (totalTokens < 0.01) return { error: 'No tokens to sell' };

  var sell = this._sellShares(th.holdings.slice());  // engine-specific collateral math
  var fee = Math.floor(sell.grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = sell.grossOut - fee;

  for (var j = 0; j < this.N; j++) th.holdings[j] = 0;
  sell.commit();
  this.accumulatedLpFees += lpFee;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    collateralOut: netOut, grossOut: sell.grossOut, fee: fee, lpFee: lpFee,
    tokensReturned: totalTokens,
  };
};

function applySmoothKernel(proto) {
  for (var key in SmoothKernel) proto[key] = SmoothKernel[key];
}

// ============================================================
// 7. L2-NORM MARKET ENGINE (smooth kernel)
// ============================================================
// AMM:        sum(x_i^2) = k^2  (hypersphere)
// Probability: p_i = x_i / sum(x_j)  (linear display)
// Pool:        k
// Settlement:  shared smooth triangular kernel + claimScale solvency
// ============================================================
function L2Market(N, rangeMin, rangeMax, liquidity, fees) {
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

L2Market.prototype.getPool = function () { return this.k; };

L2Market.prototype.getProbabilities = function () {
  var sum = 0;
  for (var i = 0; i < this.N; i++) sum += this.positions[i];
  var probs = [];
  for (var i = 0; i < this.N; i++) {
    probs.push(sum > 0 ? this.positions[i] / sum : 1 / this.N);
  }
  return probs;
};

L2Market.prototype.discreteBuy = function (traderName, binIdx, grossCollateral) {
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

L2Market.prototype.discreteSell = function (traderName, binIdx, tokenAmount) {
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

// Internal: compute collateral returned for removing `shares[]` (no fee, no
// holdings mutation). Returns { grossOut, commit() } — commit applies the AMM
// state change. Used by shared sellAll.
L2Market.prototype._sellShares = function (shares) {
  var self = this;
  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    var newPos = this.positions[j] - shares[j];
    sumSq += newPos * newPos;
  }
  var kNew = Math.sqrt(sumSq);
  var grossOut = this.k - kNew;
  return {
    grossOut: grossOut,
    commit: function () {
      for (var j = 0; j < self.N; j++) self.positions[j] -= shares[j];
      self.k = kNew;
    },
  };
};

L2Market.prototype.distributionBuy = function (traderName, mu, sigma, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var prev = this._distributionBuyTokens(mu, sigma, net);
  if (prev.error) return prev;
  var tokensPerBin = prev.tokensPerBin;

  var totalTokens = 0;
  for (var j = 0; j < this.N; j++) {
    this.positions[j] += tokensPerBin[j];
    th.holdings[j] += tokensPerBin[j];
    totalTokens += tokensPerBin[j];
  }
  this.k = prev.kNew;
  this.accumulatedLpFees += lpFee;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var peak = computeKernelPeak(tokensPerBin, this.N, this.kernelWidth, this.redemptionFeeBps);

  return {
    tokensPerBin: tokensPerBin, totalTokens: totalTokens, fee: fee, lpFee: lpFee, net: net,
    peakPayout: peak.peakPayout, peakBin: peak.peakBin, cost: grossCollateral,
    maxProfit: peak.peakPayout - grossCollateral,
  };
};

// Internal: solve token allocation for a net-collateral distribution buy
// without mutating state. Returns { tokensPerBin, kNew } or { error }.
L2Market.prototype._distributionBuyTokens = function (mu, sigma, net) {
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
  for (var j = 0; j < this.N; j++) tokensPerBin.push((lambda * W[j]) / W2);
  return { tokensPerBin: tokensPerBin, kNew: kNew };
};

L2Market.prototype.previewDistributionBuy = function (mu, sigma, grossCollateral) {
  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var net = grossCollateral - fee;
  var prev = this._distributionBuyTokens(mu, sigma, net);
  if (prev.error) return null;
  var tokensPerBin = prev.tokensPerBin;
  var totalTokens = 0;
  for (var j = 0; j < this.N; j++) totalTokens += tokensPerBin[j];
  var peak = computeKernelPeak(tokensPerBin, this.N, this.kernelWidth, this.redemptionFeeBps);
  return {
    tokensPerBin: tokensPerBin, totalTokens: totalTokens,
    peakPayout: peak.peakPayout, peakBin: peak.peakBin,
    fee: fee, cost: grossCollateral,
  };
};

L2Market.prototype.distributionSell = function (traderName, mu, sigma, totalTokens) {
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

L2Market.prototype.addLiquidity = function (lpName, amount) {
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

L2Market.prototype.removeLiquidity = function (lpName, amount) {
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

L2Market.prototype.getState = function () {
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

L2Market.prototype.loadState = function (s) {
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

applySmoothKernel(L2Market.prototype);

// ============================================================
// 8. LMSR MARKET ENGINE (smooth kernel)
// ============================================================
// AMM:        C(q; b) = b·ln Σ exp(q_i/b)   (logarithmic market scoring rule)
// Probability: p_i = softmax(q_i / b)
// Pool:        C(q; b)  (= subsidy b·ln(N) + net trade collateral)
// b:           liquidity / ln(N)  (so locked collateral == L2-norm vault k)
// LP:          add/remove scales b (deeper/shallower); holdings q untouched
// Settlement:  shared smooth triangular kernel + claimScale solvency
// ============================================================
function LmsrMarket(N, rangeMin, rangeMax, liquidity, fees) {
  this.N = N;
  this.rangeMin = rangeMin;
  this.rangeMax = rangeMax;
  this.binWidth = (rangeMax - rangeMin) / N;
  this.kernelWidth = (fees && typeof fees.kernelWidth === 'number') ? fees.kernelWidth : DEFAULT_KERNEL_WIDTH;

  this.tradeFeeBps = (fees && typeof fees.tradeFeeBps === 'number') ? fees.tradeFeeBps : DEFAULT_TRADE_FEE_BPS;
  this.lpFeeSharePct = (fees && typeof fees.lpFeeSharePct === 'number') ? fees.lpFeeSharePct : DEFAULT_LP_FEE_SHARE_PCT;
  this.redemptionFeeBps = (fees && typeof fees.redemptionFeeBps === 'number') ? fees.redemptionFeeBps : DEFAULT_REDEMPTION_FEE_BPS;

  // b chosen so worst-case MM loss b·ln(N) == liquidity (matches L2 vault k).
  this.b = liquidity / Math.log(N);

  // positions[i] = aggregate net shares q_i (mirror of Σ trader holdings).
  this.positions = [];
  this.centers = [];
  for (var j = 0; j < N; j++) {
    this.positions.push(0);
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

LmsrMarket.prototype.getPool = function () { return lmsrCost(this.positions, this.b); };

LmsrMarket.prototype.getProbabilities = function () { return lmsrPrices(this.positions, this.b); };

LmsrMarket.prototype.discreteBuy = function (traderName, binIdx, grossCollateral) {
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

  var dir = [];
  for (var j = 0; j < this.N; j++) dir.push(j === binIdx ? 1 : 0);
  var tokensOut = lmsrSolveShares(this.positions, this.b, dir, net);

  this.positions[binIdx] += tokensOut;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] += tokensOut;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var prices = lmsrPrices(this.positions, this.b);
  var peakPayout = tokensOut * (1 - this.redemptionFeeBps / 10000);

  return {
    tokensOut: tokensOut, fee: fee, lpFee: lpFee, net: net,
    newProb: prices[binIdx],
    peakPayout: peakPayout, cost: grossCollateral,
    maxProfit: peakPayout - grossCollateral,
  };
};

LmsrMarket.prototype.discreteSell = function (traderName, binIdx, tokenAmount) {
  if (this.resolved) return { error: 'Market is resolved' };
  if (binIdx < 0 || binIdx >= this.N) return { error: 'Invalid bin index' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];
  if (th.holdings[binIdx] < tokenAmount - 0.01) return { error: 'Insufficient tokens in bin ' + binIdx };

  var c0 = lmsrCost(this.positions, this.b);
  this.positions[binIdx] -= tokenAmount;
  if (this.positions[binIdx] < -1e-9) { this.positions[binIdx] += tokenAmount; return { error: 'Position would go negative' }; }
  var grossOut = c0 - lmsrCost(this.positions, this.b);

  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.accumulatedLpFees += lpFee;
  th.holdings[binIdx] -= tokenAmount;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    collateralOut: netOut, grossOut: grossOut, fee: fee, lpFee: lpFee,
    tokensReturned: tokenAmount,
  };
};

LmsrMarket.prototype._sellShares = function (shares) {
  var self = this;
  var c0 = lmsrCost(this.positions, this.b);
  var q2 = this.positions.slice();
  for (var j = 0; j < this.N; j++) q2[j] -= shares[j];
  var grossOut = c0 - lmsrCost(q2, this.b);
  return {
    grossOut: grossOut,
    commit: function () { self.positions = q2; },
  };
};

// Internal: normalized buy direction (Σ dir = 1) from Gaussian weights.
LmsrMarket.prototype._dirFromWeights = function (mu, sigma) {
  var W = this._computeWeights(mu, sigma);
  if (!W) return null;
  var wsum = 0;
  for (var j = 0; j < this.N; j++) wsum += W[j];
  if (wsum <= 0) return null;
  var dir = [];
  for (var j = 0; j < this.N; j++) dir.push(W[j] / wsum);
  return dir;
};

LmsrMarket.prototype.distributionBuy = function (traderName, mu, sigma, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var dir = this._dirFromWeights(mu, sigma);
  if (!dir) return { error: 'All bins outside 5 sigma' };

  var s = lmsrSolveShares(this.positions, this.b, dir, net);

  var tokensPerBin = [];
  var totalTokens = 0;
  for (var j = 0; j < this.N; j++) {
    var t = s * dir[j];
    tokensPerBin.push(t);
    this.positions[j] += t;
    th.holdings[j] += t;
    totalTokens += t;
  }
  this.accumulatedLpFees += lpFee;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var peak = computeKernelPeak(tokensPerBin, this.N, this.kernelWidth, this.redemptionFeeBps);

  return {
    tokensPerBin: tokensPerBin, totalTokens: totalTokens, fee: fee, lpFee: lpFee, net: net,
    peakPayout: peak.peakPayout, peakBin: peak.peakBin, cost: grossCollateral,
    maxProfit: peak.peakPayout - grossCollateral,
  };
};

LmsrMarket.prototype.previewDistributionBuy = function (mu, sigma, grossCollateral) {
  var dir = this._dirFromWeights(mu, sigma);
  if (!dir) return null;
  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var net = grossCollateral - fee;
  var s = lmsrSolveShares(this.positions, this.b, dir, net);
  var tokensPerBin = [];
  var totalTokens = 0;
  for (var j = 0; j < this.N; j++) { var t = s * dir[j]; tokensPerBin.push(t); totalTokens += t; }
  var peak = computeKernelPeak(tokensPerBin, this.N, this.kernelWidth, this.redemptionFeeBps);
  return {
    tokensPerBin: tokensPerBin, totalTokens: totalTokens,
    peakPayout: peak.peakPayout, peakBin: peak.peakBin,
    fee: fee, cost: grossCollateral,
  };
};

LmsrMarket.prototype.distributionSell = function (traderName, mu, sigma, totalTokens) {
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

  var c0 = lmsrCost(this.positions, this.b);
  for (var j = 0; j < this.N; j++) {
    this.positions[j] -= tokensPerBin[j];
    th.holdings[j] -= tokensPerBin[j];
  }
  var grossOut = c0 - lmsrCost(this.positions, this.b);

  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.accumulatedLpFees += lpFee;
  th.received += netOut;
  gt.wallet += netOut;

  return {
    tokensPerBin: tokensPerBin, totalSold: totalSold, collateralOut: netOut,
    grossOut: grossOut, fee: fee, lpFee: lpFee,
  };
};

LmsrMarket.prototype.addLiquidity = function (lpName, amount) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[lpName];
  if (!gt) return { error: 'Unknown user' };
  if (gt.wallet < amount) return { error: 'Insufficient balance' };

  var pool = lmsrCost(this.positions, this.b);
  var newShares = this.totalLpShares > 0 ? this.totalLpShares * amount / pool : amount;
  // Deepen the market: grow b so the vault grows by `amount` (prices drift toward uniform).
  this.b = lmsrSolveB(this.positions, pool + amount);

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

LmsrMarket.prototype.removeLiquidity = function (lpName, amount) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[lpName];
  if (!gt) return { error: 'Unknown user' };
  var lp = this.lpProviders[lpName];
  if (!lp || lp.shares <= 0) return { error: 'No LP position' };

  var pool = lmsrCost(this.positions, this.b);
  var maxq = 0;
  for (var j = 0; j < this.N; j++) if (this.positions[j] > maxq) maxq = this.positions[j];

  // Solvency floor: vault must stay strictly above max q_i (so a finite b exists).
  var maxByFloor = Math.max(0, pool - maxq - 1e-6);
  var maxAmount = pool * lp.shares / this.totalLpShares;
  var actualAmount = Math.min(amount, maxAmount, maxByFloor);
  if (actualAmount <= 0) return { error: 'Withdrawal would breach LMSR solvency floor' };

  var sharesToBurn = actualAmount * this.totalLpShares / pool;
  sharesToBurn = Math.min(sharesToBurn, lp.shares);

  var collateralOut = pool * sharesToBurn / this.totalLpShares;
  var feeShare = this.accumulatedLpFees * sharesToBurn / this.totalLpShares;
  var totalPayout = collateralOut + feeShare;

  // Shallow the market: shrink b so the vault drops by collateralOut.
  this.b = lmsrSolveB(this.positions, pool - collateralOut);

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

LmsrMarket.prototype.getState = function () {
  return {
    b: this.b, positions: this.positions.slice(),
    totalLpShares: this.totalLpShares,
    lpProviders: JSON.parse(JSON.stringify(this.lpProviders)),
    accumulatedLpFees: this.accumulatedLpFees,
    traderHoldings: JSON.parse(JSON.stringify(this.traderHoldings)),
    resolved: this.resolved, winningBin: this.winningBin,
    lastResolveValue: this.lastResolveValue,
    lastResolvePayouts: this.lastResolvePayouts,
  };
};

LmsrMarket.prototype.loadState = function (s) {
  this.b = s.b;
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

applySmoothKernel(LmsrMarket.prototype);

// ============================================================
// 9. DUAL MARKET ORCHESTRATOR
// ============================================================
// Wraps the LMSR engine (current slot, UI left) + L2-norm engine (improved
// slot, UI right). Every action is applied to both engines with separate
// wallet snapshots. Because the two AMMs differ, holdings/positions diverge
// by design — only the smooth-kernel settlement is shared.
// ============================================================
function DualMarket() {
  this.current = null;   // LmsrMarket
  this.improved = null;  // L2Market
  this.traders = {};     // { name: { currentWallet, improvedWallet, initialBalance } }
  this.initialized = false;
}

DualMarket.prototype.init = function (N, rangeMin, rangeMax, liquidity, fees, kernelWidth) {
  var kw = (typeof kernelWidth === 'number') ? kernelWidth : DEFAULT_KERNEL_WIDTH;
  var f = {
    tradeFeeBps: (fees && fees.tradeFeeBps) || 0,
    lpFeeSharePct: (fees && fees.lpFeeSharePct) || 0,
    redemptionFeeBps: (fees && fees.redemptionFeeBps) || 0,
    kernelWidth: kw,
  };

  this.current = new LmsrMarket(N, rangeMin, rangeMax, liquidity, f);   // LMSR smooth kernel (left)
  this.improved = new L2Market(N, rangeMin, rangeMax, liquidity, f);    // L2-norm smooth kernel (right)

  this.traders = {};
  this.traders['Creator'] = { currentWallet: 0, improvedWallet: 0, initialBalance: liquidity };
  globalTraders = {};
  this.initialized = true;
  this.initConfig = {
    N: N, rangeMin: rangeMin, rangeMax: rangeMax, liquidity: liquidity,
    fees: { tradeFeeBps: f.tradeFeeBps, lpFeeSharePct: f.lpFeeSharePct, redemptionFeeBps: f.redemptionFeeBps },
    kernelWidth: kw,
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

  // Execute on current (LMSR) engine
  this._setWallets(traderName, 'current');
  var currentResult = this.current[method].apply(this.current, [traderName].concat(args));

  if (currentResult.error) {
    return { error: 'LMSR engine: ' + currentResult.error, current: currentResult, improved: null };
  }
  this._saveWallet(traderName, 'current');

  // Execute on improved (L2-norm) engine
  this._setWallets(traderName, 'improved');
  var improvedResult = this.improved[method].apply(this.improved, [traderName].concat(args));

  if (improvedResult.error) {
    // The two AMMs hold different holdings, so a sell that succeeds on one engine
    // may have nothing to sell on the other. Log and continue (left engine stands).
    console.warn('Dual trade divergence: LMSR succeeded but L2-norm failed:', improvedResult.error);
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

// Report cross-engine divergence (the two AMMs are expected to diverge — this is
// informational, not an assertion). Returns each engine's pool plus the max
// absolute difference in displayed probabilities.
DualMarket.prototype.verifySync = function () {
  if (!this.initialized) return { synced: false, error: 'Not initialized' };
  var cp = this.current.getProbabilities();
  var ip = this.improved.getProbabilities();
  var maxProbDiff = 0;
  for (var j = 0; j < this.current.N; j++) {
    var diff = Math.abs(cp[j] - ip[j]);
    if (diff > maxProbDiff) maxProbDiff = diff;
  }
  return {
    lmsrPool: this.current.getPool(),
    l2Pool: this.improved.getPool(),
    maxProbDiff: maxProbDiff,
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
// 10. INITIALIZATION
// ============================================================
(function () {
  loadSettings();
  applyHtmlClass();
  applyFontSize(settings.fontSize);
})();
