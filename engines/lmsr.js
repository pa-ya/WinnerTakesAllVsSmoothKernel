// ============================================================
// DekantPM Comparison — LMSR engine (modes: 'lmsr' and 'lslmsr')
// ============================================================
// Loaded after core.js. Depends on: constants, globalTraders, SmoothKernel,
// applySmoothKernel, gaussianWeights, computeKernelPeak, lmsr* primitives.
'use strict';

// ============================================================
// 8. LMSR MARKET ENGINE (smooth kernel)
// ============================================================
// Two modes, selected at construction via fees.lmsrMode:
//
//   'lmsr'  (plain LMSR, default):
//     C(q; b) = b·ln Σ exp(q_i/b);  p_i = softmax(q_i/b);  pool = C(q; b)
//     b = liquidity / ln(N) at start (locked collateral == L2-norm vault k).
//     LP add/remove scales the free parameter b (deeper/shallower).
//
//   'lslmsr' (pure Othman liquidity-sensitive, b = α·ΣQ):
//     Carries a uniform phantom-share `seed` (per bin) separate from trader
//     holdings, so Q_i = seed + positions[i] and b = α·ΣQ (well-defined even at
//     positions = 0). pool = C(Q; b). Display prices = softmax(Q/b) (the belief;
//     the LS overround manifests as worse trader fills, not in displayed probs).
//     LP add/remove scales `seed`. α from the setup "sensitivity" control.
//     Initial seed is collateral-matched: C(Q0) = liquidity at the uniform start.
//
// In BOTH modes every trade grows/shrinks the vault by exactly the net collateral
// (vault == C), so conservation and the shared smooth-kernel settlement hold.
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

  this.mode = (fees && fees.lmsrMode === 'lslmsr') ? 'lslmsr' : 'lmsr';

  if (this.mode === 'lslmsr') {
    // α must be > 0 (b = α·ΣQ degenerates at α = 0). Fall back to a small default.
    this.alpha = (fees && typeof fees.lsAlpha === 'number' && fees.lsAlpha > 0)
      ? fees.lsAlpha
      : 0.1 / (N * Math.log(N));
    // Collateral-matched uniform seed: C(Q0) = seed·(α·N·ln N + 1) = liquidity.
    this.seed = liquidity / (this.alpha * N * Math.log(N) + 1);
    this.b = this.alpha * N * this.seed;  // effective initial b (informational)
  } else {
    this.alpha = 0;
    this.seed = 0;
    // b chosen so worst-case MM loss b·ln(N) == liquidity (matches L2 vault k).
    this.b = liquidity / Math.log(N);
  }

  // positions[i] = aggregate net TRADER shares q_i (mirror of Σ trader holdings).
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

// ---- mode-aware effective-quantity / cost helpers ----
// Effective Q vector for a given trader-share vector (lslmsr adds the phantom seed).
LmsrMarket.prototype._effQ = function (pos) {
  if (this.mode !== 'lslmsr') return pos;
  var q = new Array(this.N);
  for (var i = 0; i < this.N; i++) q[i] = pos[i] + this.seed;
  return q;
};

// Effective b for a given trader-share vector (lslmsr: α·ΣQ; lmsr: fixed this.b).
LmsrMarket.prototype._effB = function (pos) {
  if (this.mode !== 'lslmsr') return this.b;
  var sum = 0;
  for (var i = 0; i < this.N; i++) sum += pos[i] + this.seed;
  return this.alpha * sum;
};

// Cost C evaluated at a given trader-share vector, using the mode's effective b.
LmsrMarket.prototype._costAt = function (pos) {
  return lmsrCost(this._effQ(pos), this._effB(pos));
};

// Solve scalar s >= 0 such that C(positions + s·dir) - C(positions) = target.
// Monotone increasing in s (marginal = Σ dir_i·price_i > 0) in both modes.
LmsrMarket.prototype._solveBuyShares = function (dir, target) {
  if (target <= 0) return 0;
  var self = this, n = this.N, pos = this.positions;
  var c0 = this._costAt(pos);
  function f(s) {
    var qq = new Array(n);
    for (var i = 0; i < n; i++) qq[i] = pos[i] + s * dir[i];
    return self._costAt(qq) - c0;
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
};

// LP lever: set the vault to `target` by adjusting b (lmsr) or seed (lslmsr).
LmsrMarket.prototype._setVault = function (target) {
  if (this.mode === 'lslmsr') {
    this.seed = this._solveSeed(target);
    this.b = this._effB(this.positions);  // keep informational b in sync
  } else {
    this.b = lmsrSolveB(this.positions, target);
  }
};

// Minimum vault the LP lever can reach for the current positions (its floor).
// lmsr: b -> 0 gives C -> max q_i. lslmsr: seed -> 0+ gives C(positions, ~0).
LmsrMarket.prototype._minVault = function () {
  if (this.mode === 'lslmsr') {
    return this._costWithSeed(this.positions, 1e-9);
  }
  var maxq = 0;
  for (var j = 0; j < this.N; j++) if (this.positions[j] > maxq) maxq = this.positions[j];
  return maxq;
};

// lslmsr-only: C evaluated with a hypothetical seed (used by _setVault/_minVault).
LmsrMarket.prototype._costWithSeed = function (pos, seed) {
  var n = this.N, q = new Array(n), sum = 0;
  for (var i = 0; i < n; i++) { q[i] = pos[i] + seed; sum += q[i]; }
  return lmsrCost(q, this.alpha * sum);
};

// lslmsr-only: solve seed > 0 such that C(positions, seed) = target.
// C is strictly increasing in seed (dC/dseed = 1 + α·N·H(p) > 0). Bisection.
LmsrMarket.prototype._solveSeed = function (target) {
  var pos = this.positions, self = this;
  var lo = 1e-12, hi = Math.max(1, this.seed), guard = 0;
  while (self._costWithSeed(pos, hi) < target && guard++ < 300) hi *= 2;
  for (var it = 0; it < 300; it++) {
    var mid = 0.5 * (lo + hi);
    var c = self._costWithSeed(pos, mid);
    if (Math.abs(c - target) <= Math.max(1e-9, 1e-12 * target)) return mid;
    if (c < target) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
};

LmsrMarket.prototype.getPool = function () { return this._costAt(this.positions); };

LmsrMarket.prototype.getProbabilities = function () {
  return lmsrPrices(this._effQ(this.positions), this._effB(this.positions));
};

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
  var tokensOut = this._solveBuyShares(dir, net);

  this.positions[binIdx] += tokensOut;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] += tokensOut;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  var prices = this.getProbabilities();
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

  var c0 = this._costAt(this.positions);
  this.positions[binIdx] -= tokenAmount;
  if (this.positions[binIdx] < -1e-9) { this.positions[binIdx] += tokenAmount; return { error: 'Position would go negative' }; }
  var grossOut = c0 - this._costAt(this.positions);

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
  var c0 = this._costAt(this.positions);
  var q2 = this.positions.slice();
  for (var j = 0; j < this.N; j++) q2[j] -= shares[j];
  var grossOut = c0 - this._costAt(q2);
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

  var s = this._solveBuyShares(dir, net);

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
  var s = this._solveBuyShares(dir, net);
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

  var c0 = this._costAt(this.positions);
  for (var j = 0; j < this.N; j++) {
    this.positions[j] -= tokensPerBin[j];
    th.holdings[j] -= tokensPerBin[j];
  }
  var grossOut = c0 - this._costAt(this.positions);

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

  var pool = this.getPool();
  var newShares = this.totalLpShares > 0 ? this.totalLpShares * amount / pool : amount;
  // Deepen the market: grow the LP lever (b or seed) so the vault grows by `amount`.
  this._setVault(pool + amount);

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

  var pool = this.getPool();
  // Solvency floor: vault must stay strictly above the LP lever's minimum.
  var maxByFloor = Math.max(0, pool - this._minVault() - 1e-6);
  var maxAmount = pool * lp.shares / this.totalLpShares;
  var actualAmount = Math.min(amount, maxAmount, maxByFloor);
  if (actualAmount <= 0) return { error: 'Withdrawal would breach LMSR solvency floor' };

  var sharesToBurn = actualAmount * this.totalLpShares / pool;
  sharesToBurn = Math.min(sharesToBurn, lp.shares);

  var collateralOut = pool * sharesToBurn / this.totalLpShares;
  var feeShare = this.accumulatedLpFees * sharesToBurn / this.totalLpShares;
  var totalPayout = collateralOut + feeShare;

  // Shallow the market: shrink the LP lever so the vault drops by collateralOut.
  this._setVault(pool - collateralOut);

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

// Non-mutating LP remove preview — mirrors removeLiquidity exactly, including
// the solvency floor (vault must stay above the LP lever's minimum).
LmsrMarket.prototype.previewRemoveLiquidity = function (lpName, amount) {
  var lp = this.lpProviders[lpName];
  if (!lp || lp.shares <= 0) return null;
  var pool = this.getPool();
  var maxByFloor = Math.max(0, pool - this._minVault() - 1e-6);
  var maxAmount = pool * lp.shares / this.totalLpShares;
  var actualAmount = Math.min(amount, maxAmount, maxByFloor);
  if (actualAmount <= 0) return null;
  var sharesToBurn = Math.min(actualAmount * this.totalLpShares / pool, lp.shares);
  var collateralOut = pool * sharesToBurn / this.totalLpShares;
  var feeShare = this.accumulatedLpFees * sharesToBurn / this.totalLpShares;
  var totalPayout = collateralOut + feeShare;
  var remainingShares = lp.shares - sharesToBurn;
  var newTotalShares = this.totalLpShares - sharesToBurn;
  return {
    sharesBurned: sharesToBurn, collateralOut: collateralOut,
    feeShare: feeShare, totalPayout: totalPayout, remainingShares: remainingShares,
    poolFraction: newTotalShares > 0 ? remainingShares / newTotalShares : 0,
  };
};

LmsrMarket.prototype.getState = function () {
  return {
    mode: this.mode, b: this.b, alpha: this.alpha, seed: this.seed,
    positions: this.positions.slice(),
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
  if (s.mode) this.mode = s.mode;
  this.b = s.b;
  if (typeof s.alpha === 'number') this.alpha = s.alpha;
  if (typeof s.seed === 'number') this.seed = s.seed;
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
