// ============================================================
// DekantPM Comparison — LMSR engine
// ============================================================
// Loaded after core.js. Depends on: constants, globalTraders, SmoothKernel,
// applySmoothKernel, gaussianWeights, computeKernelPeak, lmsr* primitives.
'use strict';

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

// Non-mutating LP remove preview — mirrors removeLiquidity exactly, including
// the LMSR solvency floor (vault must stay strictly above max q_i).
LmsrMarket.prototype.previewRemoveLiquidity = function (lpName, amount) {
  var lp = this.lpProviders[lpName];
  if (!lp || lp.shares <= 0) return null;
  var pool = lmsrCost(this.positions, this.b);
  var maxq = 0;
  for (var j = 0; j < this.N; j++) if (this.positions[j] > maxq) maxq = this.positions[j];
  var maxByFloor = Math.max(0, pool - maxq - 1e-6);
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

