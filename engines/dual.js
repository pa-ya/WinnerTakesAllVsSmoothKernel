// ============================================================
// DekantPM Comparison — DualMarket orchestrator
// ============================================================
// Loaded after l2.js + lmsr.js. Wraps both engines (lmsr = LMSR-family engine,
// UI left; l2 = L2-norm engine, UI right) and applies every action to both
// with isolated wallets.
'use strict';

// ============================================================
// 9. DUAL MARKET ORCHESTRATOR
// ============================================================
// Wraps the LMSR-family engine (this.lmsr, UI left) + L2-norm engine
// (this.l2, UI right). Every action is applied to both engines with separate
// wallet snapshots. Because the two AMMs differ, holdings/positions diverge
// by design — only the smooth-kernel settlement is shared.
// ============================================================
function DualMarket() {
  this.lmsr = null;   // LmsrMarket (mode: 'lmsr' or 'lslmsr')
  this.l2 = null;     // L2Market
  this.traders = {};     // { name: { lmsrWallet, l2Wallet, initialBalance } }
  this.initialized = false;
}

DualMarket.prototype.init = function (N, rangeMin, rangeMax, liquidity, fees, kernelWidth) {
  var kw = (typeof kernelWidth === 'number') ? kernelWidth : DEFAULT_KERNEL_WIDTH;

  // LMSR-family engine mode: 'lmsr' (plain) or 'lslmsr' (pure Othman b = α·ΣQ).
  // The setup control passes a sensitivity in (0,1]; map it to α = sens/(N·ln N)
  // so the uniform-point overround N·α·ln N == sensitivity (N-independent knob).
  var lmsrMode = (fees && fees.lmsrMode === 'lslmsr') ? 'lslmsr' : 'lmsr';
  var lsSensitivity = (fees && typeof fees.lsSensitivity === 'number' && fees.lsSensitivity > 0)
    ? fees.lsSensitivity : 0.3;
  var lsAlpha = lsSensitivity / (N * Math.log(N));

  var f = {
    tradeFeeBps: (fees && fees.tradeFeeBps) || 0,
    lpFeeSharePct: (fees && fees.lpFeeSharePct) || 0,
    redemptionFeeBps: (fees && fees.redemptionFeeBps) || 0,
    kernelWidth: kw,
  };
  // LMSR engine also gets the mode + α; L2 ignores these extra fields.
  var fLmsr = {
    tradeFeeBps: f.tradeFeeBps, lpFeeSharePct: f.lpFeeSharePct,
    redemptionFeeBps: f.redemptionFeeBps, kernelWidth: kw,
    lmsrMode: lmsrMode, lsAlpha: lsAlpha,
  };

  this.lmsr = new LmsrMarket(N, rangeMin, rangeMax, liquidity, fLmsr);  // LMSR-family (left)
  this.l2 = new L2Market(N, rangeMin, rangeMax, liquidity, f);          // L2-norm (right)

  this.traders = {};
  this.traders['Creator'] = { lmsrWallet: 0, l2Wallet: 0, initialBalance: liquidity };
  globalTraders = {};
  this.initialized = true;
  this.initConfig = {
    N: N, rangeMin: rangeMin, rangeMax: rangeMax, liquidity: liquidity,
    fees: {
      tradeFeeBps: f.tradeFeeBps, lpFeeSharePct: f.lpFeeSharePct, redemptionFeeBps: f.redemptionFeeBps,
      lmsrMode: lmsrMode, lsSensitivity: lsSensitivity,
    },
    kernelWidth: kw,
  };

  return { lmsr: this.lmsr, l2: this.l2 };
};

DualMarket.prototype.addTrader = function (name, balance) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (this.traders[name]) return { error: 'Trader already exists: ' + name };

  this.traders[name] = { lmsrWallet: balance, l2Wallet: balance, initialBalance: balance };
  return { name: name, balance: balance };
};

DualMarket.prototype._setWallets = function (traderName, engine) {
  var t = this.traders[traderName];
  if (!t) return false;
  if (engine === 'lmsr') {
    globalTraders[traderName] = { wallet: t.lmsrWallet };
  } else {
    globalTraders[traderName] = { wallet: t.l2Wallet };
  }
  return true;
};

DualMarket.prototype._saveWallet = function (traderName, engine) {
  var t = this.traders[traderName];
  if (!t || !globalTraders[traderName]) return;
  if (engine === 'lmsr') {
    t.lmsrWallet = globalTraders[traderName].wallet;
  } else {
    t.l2Wallet = globalTraders[traderName].wallet;
  }
};

DualMarket.prototype._dualTrade = function (method, traderName, args) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[traderName]) return { error: 'Unknown trader: ' + traderName };

  // Execute on the LMSR-family engine (this.lmsr)
  this._setWallets(traderName, 'lmsr');
  var lmsrResult = this.lmsr[method].apply(this.lmsr, [traderName].concat(args));

  if (lmsrResult.error) {
    return { error: 'LMSR engine: ' + lmsrResult.error, lmsr: lmsrResult, l2: null };
  }
  this._saveWallet(traderName, 'lmsr');

  // Execute on the L2-norm engine (this.l2)
  this._setWallets(traderName, 'l2');
  var l2Result = this.l2[method].apply(this.l2, [traderName].concat(args));

  if (l2Result.error) {
    // The two AMMs hold different holdings, so a sell that succeeds on one engine
    // may have nothing to sell on the other. Log and continue (left engine stands).
    console.warn('Dual trade divergence: LMSR succeeded but L2-norm failed:', l2Result.error);
  }
  this._saveWallet(traderName, 'l2');

  return { lmsr: lmsrResult, l2: l2Result };
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

  this._setWallets(traderName, 'lmsr');
  var lmsrResult = this.lmsr.sellAll(traderName);
  if (lmsrResult.error) {
    return { error: lmsrResult.error, lmsr: lmsrResult, l2: null };
  }
  this._saveWallet(traderName, 'lmsr');

  this._setWallets(traderName, 'l2');
  var l2Result = this.l2.sellAll(traderName);
  this._saveWallet(traderName, 'l2');

  return { lmsr: lmsrResult, l2: l2Result };
};

DualMarket.prototype.resolve = function (value) {
  if (!this.initialized) return { error: 'Market not initialized' };

  for (var name in this.traders) {
    this._setWallets(name, 'lmsr');
  }
  var lmsrResult = this.lmsr.resolve(value);

  for (var name in this.traders) {
    this._setWallets(name, 'l2');
  }
  var l2Result = this.l2.resolve(value);

  return { lmsr: lmsrResult, l2: l2Result };
};

DualMarket.prototype.getPortfolios = function (traderName, solvencyAware) {
  if (!this.initialized || !this.traders[traderName]) return null;

  this._setWallets(traderName, 'lmsr');
  var lmsrPortfolio = this.lmsr.getTraderPortfolio(traderName, solvencyAware);

  this._setWallets(traderName, 'l2');
  var l2Portfolio = this.l2.getTraderPortfolio(traderName, solvencyAware);

  return { lmsr: lmsrPortfolio, l2: l2Portfolio };
};

DualMarket.prototype.getTraderBalance = function (traderName) {
  var t = this.traders[traderName];
  if (!t) return null;
  return { lmsr: t.lmsrWallet, l2: t.l2Wallet };
};

// Report cross-engine divergence (the two AMMs are expected to diverge — this is
// informational, not an assertion). Returns each engine's pool plus the max
// absolute difference in displayed probabilities.
DualMarket.prototype.verifySync = function () {
  if (!this.initialized) return { synced: false, error: 'Not initialized' };
  var cp = this.lmsr.getProbabilities();
  var ip = this.l2.getProbabilities();
  var maxProbDiff = 0;
  for (var j = 0; j < this.lmsr.N; j++) {
    var diff = Math.abs(cp[j] - ip[j]);
    if (diff > maxProbDiff) maxProbDiff = diff;
  }
  return {
    lmsrPool: this.lmsr.getPool(),
    l2Pool: this.l2.getPool(),
    maxProbDiff: maxProbDiff,
  };
};

DualMarket.prototype.addLiquidity = function (lpName, amount) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[lpName]) return { error: 'Unknown user: ' + lpName };

  this._setWallets(lpName, 'lmsr');
  var lmsrResult = this.lmsr.addLiquidity(lpName, amount);
  if (lmsrResult.error) return { error: lmsrResult.error, lmsr: lmsrResult, l2: null };
  this._saveWallet(lpName, 'lmsr');

  this._setWallets(lpName, 'l2');
  var l2Result = this.l2.addLiquidity(lpName, amount);
  this._saveWallet(lpName, 'l2');

  return { lmsr: lmsrResult, l2: l2Result };
};

DualMarket.prototype.removeLiquidity = function (lpName, amount) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[lpName]) return { error: 'Unknown user: ' + lpName };

  this._setWallets(lpName, 'lmsr');
  var lmsrResult = this.lmsr.removeLiquidity(lpName, amount);
  if (lmsrResult.error) return { error: lmsrResult.error, lmsr: lmsrResult, l2: null };
  this._saveWallet(lpName, 'lmsr');

  this._setWallets(lpName, 'l2');
  var l2Result = this.l2.removeLiquidity(lpName, amount);
  this._saveWallet(lpName, 'l2');

  return { lmsr: lmsrResult, l2: l2Result };
};

// --- Serialization (Save/Load) ---
DualMarket.prototype.serialize = function () {
  return JSON.stringify({
    initConfig: this.initConfig,
    traders: this.traders,
    lmsr: this.lmsr.getState(),
    l2: this.l2.getState(),
  });
};

DualMarket.loadFromSave = function (json) {
  var d = typeof json === 'string' ? JSON.parse(json) : json;
  var c = d.initConfig;
  var dm = new DualMarket();
  dm.init(c.N, c.rangeMin, c.rangeMax, c.liquidity, c.fees, c.kernelWidth);
  dm.lmsr.loadState(d.lmsr);
  dm.l2.loadState(d.l2);
  dm.traders = d.traders;
  return dm;
};

DualMarket.prototype.getLpPortfolios = function (lpName) {
  if (!this.initialized) return null;
  if (lpName === '__ALL__') {
    return { lmsr: this.lmsr.getAllLpPortfolio(), l2: this.l2.getAllLpPortfolio() };
  }
  return { lmsr: this.lmsr.getLpPortfolio(lpName), l2: this.l2.getLpPortfolio(lpName) };
};

