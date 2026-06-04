// ============================================================
// DekantPM Comparison — L2-norm engine
// ============================================================
// Loaded after core.js. Depends on: constants, globalTraders, SmoothKernel,
// applySmoothKernel, gaussianWeights, computeKernelPeak.
'use strict';

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

// Non-mutating LP remove preview — mirrors removeLiquidity exactly (pool = k).
L2Market.prototype.previewRemoveLiquidity = function (lpName, amount) {
  var lp = this.lpProviders[lpName];
  if (!lp || lp.shares <= 0) return null;
  var pool = this.k;
  var maxAmount = pool * lp.shares / this.totalLpShares;
  var actualAmount = Math.min(amount, maxAmount);
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

