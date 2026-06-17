// ============================================================
// DekantPM Comparison — engine core (constants, shared helpers, settlement mixin)
// ============================================================
// Loaded FIRST. Defines engine-wide constants, the shared trader-wallet map,
// the engine-agnostic math helpers (Gaussian weights, kernel peak, LMSR cost
// primitives), and the SmoothKernel settlement mixin shared by both engines.
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


// --- shared trader wallet map (engines read globalTraders[name].wallet) ---
var globalTraders = {};

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

// solvencyAware (optional): when true, every payout-derived figure
// (expectedPayout, peakPayout, and therefore unrealizedPnL / pnlPct) applies the
// settlement claimScale = min(1, pool / totalClaim) at each winning bin — the
// realistic, vault-capped payout. When false (default) the raw pre-solvency
// figures are returned, byte-for-byte identical to before.
SmoothKernel.getTraderPortfolio = function (traderName, solvencyAware) {
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

  // For solvency-aware figures we need the pool and the TOTAL kernel claim
  // (across all traders) at each winning bin to compute claimScale.
  var pool = 0, totalHPB = null;
  if (solvencyAware) {
    pool = this.getPool();
    totalHPB = [];
    for (var i = 0; i < this.N; i++) totalHPB.push(0);
    for (var nm in this.traderHoldings) {
      var thh = this.traderHoldings[nm];
      for (var i = 0; i < this.N; i++) totalHPB[i] += thh.holdings[i];
    }
  }

  var peakPayout = 0;
  for (var w = 0; w < this.N; w++) {
    var payoutIfW = 0, totalClaimW = 0;
    var lo = Math.max(0, w - KW);
    var hi = Math.min(this.N - 1, w + KW);
    for (var j = lo; j <= hi; j++) {
      var kw = 1 - Math.abs(j - w) / (KW + 1);
      payoutIfW += th.holdings[j] * kw;
      if (solvencyAware) totalClaimW += totalHPB[j] * kw;
    }
    var cs = (solvencyAware && totalClaimW > pool && totalClaimW > 0) ? pool / totalClaimW : 1;
    var scaled = payoutIfW * cs;
    expectedPayout += probs[w] * scaled * redemptionFactor;
    if (scaled > peakPayout) { peakPayout = scaled; peakBin = w; }
  }
  peakPayout *= redemptionFactor;

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

// Non-mutating LP add preview. Add-liquidity accounting is identical for both
// engines: the vault grows by exactly `amount` and shares are pro-rata on the
// pre-add pool. (L2 grows k by amount; LMSR grows b so C grows by amount.)
SmoothKernel.previewAddLiquidity = function (lpName, amount) {
  var lp = this.lpProviders[lpName];
  var existingShares = lp ? lp.shares : 0;
  var pool = this.getPool();
  var newShares = this.totalLpShares > 0 ? this.totalLpShares * amount / pool : amount;
  var newTotalShares = this.totalLpShares + newShares;
  var poolFraction = newTotalShares > 0 ? (existingShares + newShares) / newTotalShares : 0;
  var newPool = pool + amount;
  var feeEarnings = this.accumulatedLpFees * poolFraction;
  var currentValue = newPool * poolFraction + feeEarnings;
  var totalDeposited = (lp ? lp.deposited : 0) + amount;
  var totalWithdrawn = lp ? lp.withdrawn : 0;
  return {
    sharesReceived: newShares, totalShares: newTotalShares,
    poolFraction: poolFraction, newPool: newPool,
    currentValue: currentValue, totalDeposited: totalDeposited,
    unrealizedPnL: currentValue + totalWithdrawn - totalDeposited,
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

// Peak (best-case winning bin) payout for a hypothetical buy of `tokensPerBin`,
// matching the shape of computeKernelPeak. Two modes:
//   solvencyAware = false  -> raw kernel claim (what the engines return today):
//                             max_w Σ_j tokens_j·K(j,w) · (1 − redemptionFee).
//   solvencyAware = true   -> apply the settlement claimScale that would obtain
//                             at each winning bin, using the pool AFTER paying
//                             `net` collateral and the TOTAL holdings AFTER this
//                             trade (this trade's tokens + every trader's current
//                             holdings). This is the realistic best case — the
//                             most the vault can actually pay for this trade.
// Returns { peakPayout, peakBin }. With solvencyAware = false the result is
// byte-for-byte the engine's existing peakPayout (cs ≡ 1).
SmoothKernel.previewPeakPayout = function (tokensPerBin, net, solvencyAware) {
  var N = this.N, KW = this.kernelWidth;
  var rf = 1 - this.redemptionFeeBps / 10000;
  var poolAfter = this.getPool() + (net || 0);

  // Total holdings per bin after this trade (only needed when solvency-aware).
  var totalAfter = [];
  for (var i = 0; i < N; i++) totalAfter.push(tokensPerBin[i] || 0);
  if (solvencyAware) {
    for (var nm in this.traderHoldings) {
      var th = this.traderHoldings[nm];
      for (var i = 0; i < N; i++) totalAfter[i] += th.holdings[i];
    }
  }

  var peakPayout = 0, peakBin = 0;
  for (var w = 0; w < N; w++) {
    var lo = Math.max(0, w - KW), hi = Math.min(N - 1, w + KW);
    var myClaim = 0, totalClaim = 0;
    for (var j = lo; j <= hi; j++) {
      var kw = 1 - Math.abs(j - w) / (KW + 1);
      myClaim += (tokensPerBin[j] || 0) * kw;
      totalClaim += totalAfter[j] * kw;
    }
    var cs = (solvencyAware && totalClaim > poolAfter && totalClaim > 0) ? poolAfter / totalClaim : 1;
    var pay = myClaim * cs * rf;
    if (pay > peakPayout) { peakPayout = pay; peakBin = w; }
  }
  return { peakPayout: peakPayout, peakBin: peakBin };
};

function applySmoothKernel(proto) {
  for (var key in SmoothKernel) proto[key] = SmoothKernel[key];
}

