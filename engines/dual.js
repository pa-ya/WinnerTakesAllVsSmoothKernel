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
  // Ordered action timeline (creation -> LPs -> trades -> resolve). Each entry is
  // a compact, scalar-only record (see _record / _digestEngine) so the full
  // history serializes to localStorage cheaply (~600 bytes/action). Drives the
  // Stories report. Captured from this point forward; pre-feature saves have none.
  this.history = [];
}

// --- Action-history capture ---------------------------------------------------
// Trim an engine result to scalar fields only (drop per-bin tokensPerBin /
// payouts arrays) so history stays compact and serializable.
DualMarket._RESULT_KEYS = [
  'tokensOut', 'totalTokens', 'totalSold', 'cost', 'fee', 'lpFee', 'net',
  'newProb', 'peakPayout', 'peakBin', 'maxProfit', 'collateralOut', 'grossOut',
  'tokensReturned', 'sharesReceived', 'totalShares', 'poolFraction', 'amount',
  'sharesBurned', 'feeShare', 'totalPayout', 'remainingShares',
  'winningBin', 'lpResidual', 'claimScale',
];
DualMarket._trimResult = function (r) {
  if (!r || typeof r !== 'object') return null;
  var out = {};
  for (var i = 0; i < DualMarket._RESULT_KEYS.length; i++) {
    var k = DualMarket._RESULT_KEYS[i];
    if (typeof r[k] === 'number' && isFinite(r[k])) out[k] = r[k];
  }
  return out;
};

// Compact, scalar-only state digest of one engine (no per-bin arrays).
DualMarket.prototype._digestEngine = function (eng) {
  var probs = eng.getProbabilities();
  var N = eng.N, peakBin = 0, peakProb = -1, mean = 0, entropy = 0;
  for (var i = 0; i < N; i++) {
    var p = probs[i];
    if (p > peakProb) { peakProb = p; peakBin = i; }
    mean += eng.centers[i] * p;
    if (p > 1e-12) entropy -= p * Math.log(p);
  }
  entropy = N > 1 ? entropy / Math.log(N) : 0;  // normalized 0..1 (1 = uniform)
  var sumTraderTokens = 0;
  for (var nm in eng.traderHoldings) {
    var h = eng.traderHoldings[nm].holdings;
    for (var j = 0; j < N; j++) sumTraderTokens += h[j];
  }
  var d = {
    pool: eng.getPool(),
    peakBin: peakBin, peakProb: peakProb, peakValue: eng.centers[peakBin],
    mean: mean, entropy: entropy,
    lpFees: eng.accumulatedLpFees, lpShares: eng.totalLpShares,
    traderTokens: sumTraderTokens,
  };
  if (typeof eng.k === 'number') d.k = eng.k;
  if (typeof eng.b === 'number') d.b = eng.b;
  if (typeof eng.seed === 'number') d.seed = eng.seed;
  if (eng.mode) d.mode = eng.mode;
  return d;
};

DualMarket.prototype._digest = function () {
  if (!this.initialized) return null;
  return { lmsr: this._digestEngine(this.lmsr), l2: this._digestEngine(this.l2) };
};

// Trim a trader portfolio to scalar fields for compact per-step history.
DualMarket._PF_KEYS = ['totalHoldings', 'expectedPayout', 'peakPayout', 'peakBin',
  'wallet', 'totalSpent', 'totalReceived', 'unrealizedPnL', 'pnlPct'];
DualMarket._LP_KEYS = ['shares', 'poolFraction', 'deposited', 'withdrawn',
  'feeEarnings', 'currentValue', 'unrealizedPnL', 'pnlPct'];
DualMarket._pick = function (obj, keys) {
  if (!obj) return null;
  var out = {};
  for (var i = 0; i < keys.length; i++) {
    if (typeof obj[keys[i]] === 'number' && isFinite(obj[keys[i]])) out[keys[i]] = obj[keys[i]];
  }
  return out;
};

// Snapshot the actor's post-action trader portfolio and (if any) LP position on
// both engines — lets the Stories report narrate how each user's E[payout] /
// peak payout / P&L evolved step by step. Read-only (no market mutation).
DualMarket.prototype._actorSnapshot = function (name) {
  if (!name || !this.traders[name]) return null;
  var pf = this.getPortfolios(name);
  var snap = {
    trader: {
      lmsr: pf ? DualMarket._pick(pf.lmsr, DualMarket._PF_KEYS) : null,
      l2: pf ? DualMarket._pick(pf.l2, DualMarket._PF_KEYS) : null,
    },
    lp: null,
  };
  var hasLp = (this.lmsr.lpProviders[name] && this.lmsr.lpProviders[name].shares > 0) ||
    (this.l2.lpProviders[name] && this.l2.lpProviders[name].shares > 0);
  if (hasLp) {
    var lp = this.getLpPortfolios(name);
    snap.lp = {
      lmsr: lp ? DualMarket._pick(lp.lmsr, DualMarket._LP_KEYS) : null,
      l2: lp ? DualMarket._pick(lp.l2, DualMarket._LP_KEYS) : null,
    };
  }
  return snap;
};

// Append a timeline entry. `before` is the digest captured before the action;
// the after-digest is taken now (post-mutation).
DualMarket.prototype._record = function (type, actor, params, before, result) {
  var entry = {
    seq: this.history.length,
    type: type,
    actor: actor || null,
    params: params || {},
    before: before || null,
    after: this._digest(),
    result: result || null,
  };
  // Per-step actor portfolio (skip 'join' — no market interaction yet).
  if (actor && this.traders[actor] && type !== 'join') {
    entry.actorState = this._actorSnapshot(actor);
  }
  this.history.push(entry);
};

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

  // Timeline starts with creation (Creator's initial liquidity == the first LP).
  this.history = [];
  this._record('create', 'Creator', {
    N: N, rangeMin: rangeMin, rangeMax: rangeMax, liquidity: liquidity,
    kernelWidth: kw, lmsrMode: lmsrMode, lsSensitivity: lsSensitivity,
    tradeFeeBps: f.tradeFeeBps, lpFeeSharePct: f.lpFeeSharePct, redemptionFeeBps: f.redemptionFeeBps,
  }, null, null);

  return { lmsr: this.lmsr, l2: this.l2 };
};

DualMarket.prototype.addTrader = function (name, balance) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (this.traders[name]) return { error: 'Trader already exists: ' + name };

  this.traders[name] = { lmsrWallet: balance, l2Wallet: balance, initialBalance: balance };
  // Roster event: a participant joined (no market-state change; impact score 0).
  this._record('join', name, { balance: balance }, this._digest(), { amount: balance });
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

// Run a dual trade and, on success, append a timeline entry. `before` must be
// captured before the mutation; `params` describes the action for the report.
DualMarket.prototype._tradeAndRecord = function (method, traderName, args, type, params) {
  var before = this._digest();
  var r = this._dualTrade(method, traderName, args);
  if (!r.error && r.lmsr && !r.lmsr.error) {
    this._record(type, traderName, params,
      before, { lmsr: DualMarket._trimResult(r.lmsr), l2: DualMarket._trimResult(r.l2) });
  }
  return r;
};

DualMarket.prototype.discreteBuy = function (traderName, binIdx, amount) {
  return this._tradeAndRecord('discreteBuy', traderName, [binIdx, amount],
    'discreteBuy', { binIdx: binIdx, amount: amount });
};

DualMarket.prototype.discreteSell = function (traderName, binIdx, amount) {
  return this._tradeAndRecord('discreteSell', traderName, [binIdx, amount],
    'discreteSell', { binIdx: binIdx, amount: amount });
};

DualMarket.prototype.distributionBuy = function (traderName, mu, sigma, amount) {
  return this._tradeAndRecord('distributionBuy', traderName, [mu, sigma, amount],
    'distributionBuy', { mu: mu, sigma: sigma, amount: amount });
};

DualMarket.prototype.distributionSell = function (traderName, mu, sigma, amount) {
  return this._tradeAndRecord('distributionSell', traderName, [mu, sigma, amount],
    'distributionSell', { mu: mu, sigma: sigma, amount: amount });
};

DualMarket.prototype.sellAll = function (traderName) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[traderName]) return { error: 'Unknown trader: ' + traderName };

  var before = this._digest();
  this._setWallets(traderName, 'lmsr');
  var lmsrResult = this.lmsr.sellAll(traderName);
  if (lmsrResult.error) {
    return { error: lmsrResult.error, lmsr: lmsrResult, l2: null };
  }
  this._saveWallet(traderName, 'lmsr');

  this._setWallets(traderName, 'l2');
  var l2Result = this.l2.sellAll(traderName);
  this._saveWallet(traderName, 'l2');

  this._record('sellAll', traderName, {}, before,
    { lmsr: DualMarket._trimResult(lmsrResult), l2: DualMarket._trimResult(l2Result) });
  return { lmsr: lmsrResult, l2: l2Result };
};

DualMarket.prototype.resolve = function (value) {
  if (!this.initialized) return { error: 'Market not initialized' };

  var before = this._digest();
  for (var name in this.traders) {
    this._setWallets(name, 'lmsr');
  }
  var lmsrResult = this.lmsr.resolve(value);

  for (var name in this.traders) {
    this._setWallets(name, 'l2');
  }
  var l2Result = this.l2.resolve(value);

  // Re-resolve replaces the prior resolution rather than appending a second
  // 'resolve' event (a re-resolve is the user changing the simulated outcome,
  // not a new market action). Keeps exactly one resolve entry at the tail.
  if (this.history.length && this.history[this.history.length - 1].type === 'resolve') {
    this.history.pop();
  }
  this._record('resolve', null, { value: value }, before,
    { lmsr: DualMarket._trimResult(lmsrResult), l2: DualMarket._trimResult(l2Result) });
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

  var before = this._digest();
  this._setWallets(lpName, 'lmsr');
  var lmsrResult = this.lmsr.addLiquidity(lpName, amount);
  if (lmsrResult.error) return { error: lmsrResult.error, lmsr: lmsrResult, l2: null };
  this._saveWallet(lpName, 'lmsr');

  this._setWallets(lpName, 'l2');
  var l2Result = this.l2.addLiquidity(lpName, amount);
  this._saveWallet(lpName, 'l2');

  this._record('addLiquidity', lpName, { amount: amount }, before,
    { lmsr: DualMarket._trimResult(lmsrResult), l2: DualMarket._trimResult(l2Result) });
  return { lmsr: lmsrResult, l2: l2Result };
};

DualMarket.prototype.removeLiquidity = function (lpName, amount) {
  if (!this.initialized) return { error: 'Market not initialized' };
  if (!this.traders[lpName]) return { error: 'Unknown user: ' + lpName };

  var before = this._digest();
  this._setWallets(lpName, 'lmsr');
  var lmsrResult = this.lmsr.removeLiquidity(lpName, amount);
  if (lmsrResult.error) return { error: lmsrResult.error, lmsr: lmsrResult, l2: null };
  this._saveWallet(lpName, 'lmsr');

  this._setWallets(lpName, 'l2');
  var l2Result = this.l2.removeLiquidity(lpName, amount);
  this._saveWallet(lpName, 'l2');

  this._record('removeLiquidity', lpName, { amount: amount }, before,
    { lmsr: DualMarket._trimResult(lmsrResult), l2: DualMarket._trimResult(l2Result) });
  return { lmsr: lmsrResult, l2: l2Result };
};

// --- Serialization (Save/Load) ---
DualMarket.prototype.serialize = function () {
  return JSON.stringify({
    initConfig: this.initConfig,
    traders: this.traders,
    history: this.history,
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
  // Restore the timeline if the save carries one (pre-feature saves do not).
  // init() seeded a fresh 'create' entry; replace it with the saved history.
  dm.history = Array.isArray(d.history) ? d.history : [];
  return dm;
};

DualMarket.prototype.getLpPortfolios = function (lpName) {
  if (!this.initialized) return null;
  if (lpName === '__ALL__') {
    return { lmsr: this.lmsr.getAllLpPortfolio(), l2: this.l2.getAllLpPortfolio() };
  }
  return { lmsr: this.lmsr.getLpPortfolio(lpName), l2: this.l2.getLpPortfolio(lpName) };
};

