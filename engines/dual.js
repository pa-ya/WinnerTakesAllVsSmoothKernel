// ============================================================
// DekantPM Comparison — DualMarket orchestrator
// ============================================================
// Loaded after l2.js + lmsr.js. Wraps both engines (current=LMSR left,
// improved=L2-norm right) and applies every action to both with isolated wallets.
'use strict';

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

