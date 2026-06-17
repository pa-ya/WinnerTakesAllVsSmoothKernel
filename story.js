// ============================================================
// DekantPM Comparison — Stories (market report generator + Markdown preview)
// ============================================================
// Loaded after comparison.js. Two concerns, both pure data processing (no LLM):
//   1. renderMarkdown(md)        -> HTML (small, self-contained MD subset renderer)
//   2. buildStoryMarkdown(dm)    -> a full Markdown narrative of a resolved market
//      built ENTIRELY from dm.history (the action timeline) + final engine state.
// Plus the UI glue: showStoryButton / generateStoryReport / saveStoryReport.
//
// buildStoryMarkdown is intentionally independent of the user's display settings
// (it uses its own deterministic number formatters) so a saved .md is stable.
'use strict';

// ============================================================
// Deterministic formatters (independent of the UI `settings`)
// ============================================================
function _snum(n) {
  if (n == null || isNaN(n) || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function _ssign(n) {
  if (n == null || isNaN(n) || !isFinite(n)) return '—';
  return n >= 0 ? '+' + _snum(n) : _snum(n);
}
function _spct(n) { // n already in percent units
  if (n == null || isNaN(n) || !isFinite(n)) return '—';
  return n.toFixed(2) + '%';
}
function _sprob(p) { // p in 0..1
  if (p == null || isNaN(p) || !isFinite(p)) return '—';
  return (p * 100).toFixed(2) + '%';
}
function _sround(n, d) {
  if (n == null || isNaN(n) || !isFinite(n)) return '—';
  return Number(n).toFixed(d == null ? 3 : d);
}

// ============================================================
// 1. MARKDOWN -> HTML  (supports the subset this report emits:
//    headings, tables, bold/italic/inline-code, ordered/unordered lists,
//    blockquotes, horizontal rules, fenced code, paragraphs)
// ============================================================
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdInline(s) {
  s = escapeHtml(s);
  // inline code first (protects its contents from further inline rules)
  s = s.replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function _splitRow(line) {
  var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(function (c) { return c.trim(); });
}

function renderMarkdown(md) {
  var lines = String(md).replace(/\r\n/g, '\n').split('\n');
  var out = [];
  var i = 0, n = lines.length;

  while (i < n) {
    var line = lines[i];

    // fenced code block
    if (/^```/.test(line)) {
      var buf = [];
      i++;
      while (i < n && !/^```/.test(lines[i])) { buf.push(escapeHtml(lines[i])); i++; }
      i++; // skip closing fence
      out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
      continue;
    }

    // table: a row with a pipe followed by a separator row of dashes/colons/pipes
    if (line.indexOf('|') !== -1 && i + 1 < n &&
        /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      var header = _splitRow(line);
      i += 2; // skip header + separator
      var rows = [];
      while (i < n && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
        rows.push(_splitRow(lines[i]));
        i++;
      }
      var html = '<table><thead><tr>';
      for (var h = 0; h < header.length; h++) html += '<th>' + mdInline(header[h]) + '</th>';
      html += '</tr></thead><tbody>';
      for (var r = 0; r < rows.length; r++) {
        html += '<tr>';
        for (var c = 0; c < header.length; c++) html += '<td>' + mdInline(rows[r][c] || '') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      out.push(html);
      continue;
    }

    // heading
    var hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      var lvl = hm[1].length;
      out.push('<h' + lvl + '>' + mdInline(hm[2]) + '</h' + lvl + '>');
      i++;
      continue;
    }

    // horizontal rule (standalone --- / *** / ___, no pipes)
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      var qbuf = [];
      while (i < n && /^\s*>\s?/.test(lines[i])) {
        qbuf.push(mdInline(lines[i].replace(/^\s*>\s?/, '')));
        i++;
      }
      out.push('<blockquote>' + qbuf.join('<br>') + '</blockquote>');
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      var ubuf = [];
      while (i < n && /^\s*[-*]\s+/.test(lines[i])) {
        ubuf.push('<li>' + mdInline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ul>' + ubuf.join('') + '</ul>');
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      var obuf = [];
      while (i < n && /^\s*\d+\.\s+/.test(lines[i])) {
        obuf.push('<li>' + mdInline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ol>' + obuf.join('') + '</ol>');
      continue;
    }

    // blank line
    if (/^\s*$/.test(line)) { i++; continue; }

    // paragraph (gather consecutive plain lines)
    var pbuf = [];
    while (i < n && lines[i].trim() !== '' &&
           !/^```/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i]) &&
           !/^\s*>\s?/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
           !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]) &&
           lines[i].indexOf('|') === -1) {
      pbuf.push(mdInline(lines[i]));
      i++;
    }
    if (pbuf.length) out.push('<p>' + pbuf.join(' ') + '</p>');
    else { i++; } // safety: avoid infinite loop on an unmatched pipe line
  }

  return out.join('\n');
}

// ============================================================
// 2. STORY REPORT BUILDER  (pure: takes a DualMarket, returns Markdown)
// ============================================================

// short engine display name
function _lmsrName(dm) { return dm.lmsr.mode === 'lslmsr' ? 'LS-LMSR' : 'LMSR'; }

// Per-engine effect clause from a before/after digest pair.
function _effClause(b, a) {
  if (!b || !a) return 'n/a';
  var dp = a.pool - b.pool;
  var binTxt = (b.peakBin !== a.peakBin)
    ? ('peak bin ' + b.peakBin + '→' + a.peakBin)
    : ('peak bin ' + a.peakBin);
  return 'pool ' + _snum(b.pool) + '→' + _snum(a.pool) + ' (' + _ssign(dp) + '), ' +
    binTxt + ', top ' + _sprob(b.peakProb) + '→' + _sprob(a.peakProb) +
    ', entropy ' + _sround(b.entropy) + '→' + _sround(a.entropy);
}

// Human label for an action.
function _actionLabel(e) {
  var p = e.params || {};
  switch (e.type) {
    case 'create': return 'Market created & seeded';
    case 'join': return e.actor + ' joined (wallet ' + _snum(p.balance) + ')';
    case 'addLiquidity': return e.actor + ' added liquidity ' + _snum(p.amount);
    case 'removeLiquidity': return e.actor + ' removed liquidity ' + _snum(p.amount);
    case 'discreteBuy': return e.actor + ' bought bin ' + p.binIdx + ' for ' + _snum(p.amount);
    case 'discreteSell': return e.actor + ' sold ' + _snum(p.amount) + ' tokens of bin ' + p.binIdx;
    case 'distributionBuy': return e.actor + ' bought Gaussian (μ=' + p.mu + ', σ=' + p.sigma + ') for ' + _snum(p.amount);
    case 'distributionSell': return e.actor + ' sold Gaussian (μ=' + p.mu + ', σ=' + p.sigma + ')';
    case 'sellAll': return e.actor + ' liquidated all positions';
    case 'resolve': return 'Market resolved at ' + p.value;
    default: return e.type;
  }
}

// Composite impact score (Section 1 ranking): collateral moved relative to the
// initial seed, plus shifts in top price / entropy / peak bin (avg of engines).
function _impactScore(e, initLiquidity, N) {
  var b = e.before, a = e.after;
  if (!b || !a) return 0;
  var pool = (Math.abs(a.lmsr.pool - b.lmsr.pool) + Math.abs(a.l2.pool - b.l2.pool)) / 2;
  var prob = (Math.abs(a.lmsr.peakProb - b.lmsr.peakProb) + Math.abs(a.l2.peakProb - b.l2.peakProb)) / 2;
  var ent = (Math.abs(a.lmsr.entropy - b.lmsr.entropy) + Math.abs(a.l2.entropy - b.l2.entropy)) / 2;
  var bin = (Math.abs(a.lmsr.peakBin - b.lmsr.peakBin) + Math.abs(a.l2.peakBin - b.l2.peakBin)) / 2 / Math.max(1, N);
  return pool / Math.max(1, initLiquidity) + 2 * prob + ent + bin;
}

// Build a name -> payout map (by type) from a resolve payouts array.
function _payoutMap(payouts) {
  var m = { Trader: {}, LP: {} };
  if (!payouts) return m;
  for (var i = 0; i < payouts.length; i++) {
    var p = payouts[i];
    m[p.type][p.name] = p;
  }
  return m;
}

function buildStoryMarkdown(dm) {
  if (!dm || !dm.initialized) return '# Market Story\n\n_No market._';
  var hist = dm.history || [];
  var cfg = dm.initConfig;
  var N = cfg.N, W = cfg.kernelWidth;
  var labels = dm.lmsr.getLabels();
  var lmsrName = _lmsrName(dm);
  var resolved = dm.lmsr.resolved;
  var cMap = _payoutMap(dm.lmsr.lastResolvePayouts);
  var iMap = _payoutMap(dm.l2.lastResolvePayouts);
  var winBin = dm.lmsr.winningBin;
  var winLabel = labels[winBin] || winBin;

  // state-changing actions only (drop create/join for the highlight ranking)
  var stateActions = hist.filter(function (e) {
    return e.type !== 'create' && e.type !== 'join' && e.type !== 'resolve';
  });

  var md = [];
  function P(s) { md.push(s == null ? '' : s); }

  // ---- Title ----
  P('# Market Story — ' + lmsrName + ' vs L2-norm');
  P('');
  P('> A complete, data-derived narrative of this market\'s life — generated by replaying ' +
    'its action timeline (no AI). Left engine: **' + lmsrName + '**. Right engine: **L2-norm**. ' +
    'Both share the same smooth-kernel settlement (triangular, width ' + W + ').');
  P('');
  P('- **Bins (N):** ' + N + '  |  **Range:** [' + cfg.rangeMin + ', ' + cfg.rangeMax + ']  |  **Kernel width (W):** ' + W);
  P('- **Initial liquidity:** ' + _snum(cfg.liquidity) + '  |  **Trade fee:** ' + cfg.fees.tradeFeeBps +
    ' bps  |  **LP fee share:** ' + cfg.fees.lpFeeSharePct + '%  |  **Redemption fee:** ' + cfg.fees.redemptionFeeBps + ' bps');
  P('- **Total actions recorded:** ' + hist.length + '  |  **State-changing trades/LP ops:** ' + stateActions.length);
  if (resolved) P('- **Resolved at:** ' + dm.lmsr.lastResolveValue + ' → winning bin **' + winBin + '** (' + winLabel + ')');
  P('');

  // ============================================================
  // SECTION 1 — Brief narrative
  // ============================================================
  P('## 1. What Happened — The Brief');
  P('');
  P('The market opened with **' + N + '** outcome bins spanning [' + cfg.rangeMin + ', ' + cfg.rangeMax +
    '], seeded with **' + _snum(cfg.liquidity) + '** collateral by **Creator** — the first liquidity provider. ' +
    'Both engines started at uniform prices (1/' + N + ' ≈ ' + _sprob(1 / N) + ' per bin, entropy 1.000). ' +
    'The left market priced trades with **' + lmsrName + '**; the right with the **L2-norm** hypersphere AMM. ' +
    'Settlement was identical for both: a triangular kernel of width ' + W + ' pays bins near the winner, ' +
    'capped by a solvency factor.');
  P('');

  // Choose highlighted actions: all if few, else top-by-impact + always first & last.
  var MAX_HL = 8;
  var highlights;
  if (stateActions.length <= MAX_HL) {
    highlights = stateActions.slice();
  } else {
    var ranked = stateActions.slice().sort(function (x, y) {
      return _impactScore(y, cfg.liquidity, N) - _impactScore(x, cfg.liquidity, N);
    }).slice(0, MAX_HL);
    var keepSeq = {};
    ranked.forEach(function (e) { keepSeq[e.seq] = true; });
    keepSeq[stateActions[0].seq] = true;
    keepSeq[stateActions[stateActions.length - 1].seq] = true;
    highlights = stateActions.filter(function (e) { return keepSeq[e.seq]; });
    P('_The market had ' + stateActions.length + ' state-changing actions; the ' + highlights.length +
      ' most impactful (by collateral moved and price/entropy shift) are highlighted below, in order._');
    P('');
  }

  // first non-creator LP, if any
  var firstLp = null;
  for (var fi = 0; fi < hist.length; fi++) {
    if (hist[fi].type === 'addLiquidity' && hist[fi].actor !== 'Creator') { firstLp = hist[fi]; break; }
  }
  if (firstLp) {
    P('The first outside liquidity arrived when **' + firstLp.actor + '** added **' + _snum(firstLp.params.amount) +
      '**, deepening both pools (' + lmsrName + ': pool ' + _snum(firstLp.before.lmsr.pool) + '→' + _snum(firstLp.after.lmsr.pool) +
      '; L2-norm: pool ' + _snum(firstLp.before.l2.pool) + '→' + _snum(firstLp.after.l2.pool) + ').');
    P('');
  }

  for (var hl = 0; hl < highlights.length; hl++) {
    var e = highlights[hl];
    P('- **#' + e.seq + ' · ' + _actionLabel(e) + '**');
    P('  - ' + lmsrName + ': ' + _effClause(e.before.lmsr, e.after.lmsr));
    P('  - L2-norm: ' + _effClause(e.before.l2, e.after.l2));
  }
  P('');

  if (resolved) {
    var rEntry = null;
    for (var ri = hist.length - 1; ri >= 0; ri--) { if (hist[ri].type === 'resolve') { rEntry = hist[ri]; break; } }
    var cScale = rEntry && rEntry.result && rEntry.result.lmsr ? rEntry.result.lmsr.claimScale : 1;
    var iScale = rEntry && rEntry.result && rEntry.result.l2 ? rEntry.result.l2.claimScale : 1;
    P('Finally the market **resolved at ' + dm.lmsr.lastResolveValue + '** (bin ' + winBin + ', ' + winLabel +
      '). The smooth kernel paid the winning bin and its ' + W + ' neighbours on each side. ' +
      'Solvency factor — ' + lmsrName + ': **' + _sprob(cScale) + '**, L2-norm: **' + _sprob(iScale) + '** ' +
      '(100% = the vault covered every claim in full; below 100% means trader claims were scaled down to keep the pool solvent).');
    P('');
  }

  // ============================================================
  // SECTION 2 — Tables
  // ============================================================
  P('## 2. The Numbers — Final Tables');
  P('');

  // 2a. Configuration
  P('### 2.1 Market Configuration');
  P('');
  P('| Parameter | Value |');
  P('| :--- | ---: |');
  P('| Bins (N) | ' + N + ' |');
  P('| Range | [' + cfg.rangeMin + ', ' + cfg.rangeMax + '] |');
  P('| Kernel width (W) | ' + W + ' |');
  P('| Initial liquidity | ' + _snum(cfg.liquidity) + ' |');
  P('| Left engine | ' + lmsrName + (cfg.fees.lmsrMode === 'lslmsr' ? ' (sensitivity ' + Math.round(cfg.fees.lsSensitivity * 100) + '%)' : '') + ' |');
  P('| Right engine | L2-norm |');
  P('| Trade fee | ' + cfg.fees.tradeFeeBps + ' bps |');
  P('| LP fee share | ' + cfg.fees.lpFeeSharePct + '% |');
  P('| Redemption fee | ' + cfg.fees.redemptionFeeBps + ' bps |');
  P('');

  // 2b. Final market state per engine
  var cd = dm._digestEngine(dm.lmsr), idd = dm._digestEngine(dm.l2);
  P('### 2.2 Final Market State');
  P('');
  P('| Metric | ' + lmsrName + ' | L2-norm |');
  P('| :--- | ---: | ---: |');
  P('| Pool / vault | ' + _snum(cd.pool) + ' | ' + _snum(idd.pool) + ' |');
  P('| Peak bin | ' + cd.peakBin + ' (' + (labels[cd.peakBin] || cd.peakBin) + ') | ' + idd.peakBin + ' (' + (labels[idd.peakBin] || idd.peakBin) + ') |');
  P('| Peak probability | ' + _sprob(cd.peakProb) + ' | ' + _sprob(idd.peakProb) + ' |');
  P('| Mean (E[value]) | ' + _sround(cd.mean, 2) + ' | ' + _sround(idd.mean, 2) + ' |');
  P('| Entropy (norm.) | ' + _sround(cd.entropy) + ' | ' + _sround(idd.entropy) + ' |');
  P('| Accrued LP fees | ' + _snum(cd.lpFees) + ' | ' + _snum(idd.lpFees) + ' |');
  P('| Total trader tokens | ' + _snum(cd.traderTokens) + ' | ' + _snum(idd.traderTokens) + ' |');
  P('');

  if (resolved) {
    // 2c. Trader payouts
    P('### 2.3 Trader Payouts (at resolution, bin ' + winBin + ')');
    P('');
    P('| Trader | Engine | Gross | Fee | Net Payout | Spent | Received | Net P&L | P&L % |');
    P('| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    var traderNames = Object.keys(cMap.Trader);
    for (var t = 0; t < traderNames.length; t++) {
      var nm = traderNames[t];
      var cp = cMap.Trader[nm], ip = iMap.Trader[nm];
      md.push(_payoutRow(nm, lmsrName, cp));
      if (ip) md.push(_payoutRow(nm, 'L2-norm', ip));
    }
    P('');

    // 2d. LP payouts
    P('### 2.4 LP Payouts (at resolution)');
    P('');
    P('| LP | Engine | Deposited | Withdrawn | Final Payout | Net P&L | P&L % |');
    P('| :--- | :--- | ---: | ---: | ---: | ---: | ---: |');
    var lpNames = Object.keys(cMap.LP);
    for (var l = 0; l < lpNames.length; l++) {
      var ln = lpNames[l];
      var clp = cMap.LP[ln], ilp = iMap.LP[ln];
      md.push(_lpRow(ln, lmsrName, clp));
      if (ilp) md.push(_lpRow(ln, 'L2-norm', ilp));
    }
    P('');

    // 2e. Combined (dual-role) summary
    var dualNames = traderNames.filter(function (nm) { return cMap.LP[nm]; });
    if (dualNames.length) {
      P('### 2.5 Combined Trader + LP Summary (dual-role participants)');
      P('');
      P('| Participant | Engine | Trade Payout | LP Payout | Total Payout | Total Spent | Net P&L |');
      P('| :--- | :--- | ---: | ---: | ---: | ---: | ---: |');
      for (var d = 0; d < dualNames.length; d++) {
        var dn = dualNames[d];
        md.push(_combinedRow(dn, lmsrName, cMap.Trader[dn], cMap.LP[dn]));
        if (iMap.Trader[dn] && iMap.LP[dn]) md.push(_combinedRow(dn, 'L2-norm', iMap.Trader[dn], iMap.LP[dn]));
      }
      P('');
    }
  }

  // ============================================================
  // SECTION 3 — Per-user stories
  // ============================================================
  P('## 3. Player by Player');
  P('');
  P('Each participant\'s journey, step by step, on **both** engines — what they did, ' +
    'what it cost or paid, and how their position value (best-case "peak" payout, ' +
    'expected payout, and unrealized P&L) moved after each action.');
  P('');

  // gather every participant (traders + LPs), in first-seen order
  var seen = {}, order = [];
  for (var oi = 0; oi < hist.length; oi++) {
    var ac = hist[oi].actor;
    if (ac && !seen[ac]) { seen[ac] = true; order.push(ac); }
  }
  // Creator may only appear in 'create' — ensure included
  if (!seen['Creator'] && dm.traders['Creator']) order.unshift('Creator');

  for (var u = 0; u < order.length; u++) {
    md.push.apply(md, _userStory(dm, order[u], hist, lmsrName, cMap, iMap, resolved, winBin));
  }

  // ============================================================
  // SECTION 4 — AMM comparison & verdict
  // ============================================================
  md.push.apply(md, _comparisonSection(dm, hist, stateActions, lmsrName, cMap, iMap, resolved, winBin, N, W));

  P('');
  P('---');
  P('');
  P('_Report generated by the DekantPM Comparison playground from the recorded action ' +
    'timeline and final engine state. All figures are computed, not estimated — no AI/LLM involved._');

  return md.join('\n');
}

// ---- row helpers (Section 2) ----
function _payoutRow(name, engine, p) {
  if (!p) return '| ' + name + ' | ' + engine + ' | — | — | — | — | — | — | — |';
  var pct = p.spent > 0 ? (p.netPnL / p.spent * 100) : 0;
  return '| ' + name + ' | ' + engine + ' | ' + _snum(p.grossPayout) + ' | ' + _snum(p.fee) +
    ' | ' + _snum(p.payout) + ' | ' + _snum(p.spent) + ' | ' + _snum(p.received) +
    ' | ' + _ssign(p.netPnL) + ' | ' + _spct(pct) + ' |';
}
function _lpRow(name, engine, p) {
  if (!p) return '| ' + name + ' | ' + engine + ' | — | — | — | — | — |';
  var pct = p.spent > 0 ? (p.netPnL / p.spent * 100) : 0;
  return '| ' + name + ' | ' + engine + ' | ' + _snum(p.spent) + ' | ' + _snum(p.received) +
    ' | ' + _snum(p.payout) + ' | ' + _ssign(p.netPnL) + ' | ' + _spct(pct) + ' |';
}
function _combinedRow(name, engine, tr, lp) {
  var totalPayout = tr.payout + lp.payout;
  var totalSpent = tr.spent + lp.spent;
  var netPnL = tr.netPnL + lp.netPnL;
  return '| ' + name + ' | ' + engine + ' | ' + _snum(tr.payout) + ' | ' + _snum(lp.payout) +
    ' | ' + _snum(totalPayout) + ' | ' + _snum(totalSpent) + ' | ' + _ssign(netPnL) + ' |';
}

// ---- per-user narrative (Section 3) ----
function _userStory(dm, name, hist, lmsrName, cMap, iMap, resolved, winBin) {
  var out = [];
  var acts = hist.filter(function (e) { return e.actor === name && e.type !== 'join'; });
  var joinEntry = hist.filter(function (e) { return e.actor === name && e.type === 'join'; })[0];
  var isCreator = (name === 'Creator');
  var isLp = (dm.lmsr.lpProviders[name] || dm.l2.lpProviders[name]);
  var roleBits = [];
  if (acts.some(function (e) { return /Buy|Sell|sellAll|discrete|distribution/.test(e.type); })) roleBits.push('Trader');
  if (isLp || isCreator) roleBits.push('LP');
  var role = roleBits.length ? roleBits.join(' + ') : 'Participant';

  out.push('### ' + name + '  _(' + role + ')_');
  out.push('');
  var startWallet = dm.traders[name] ? dm.traders[name].initialBalance : 0;
  if (isCreator) {
    out.push('**Creator** seeded the market with **' + _snum(dm.initConfig.liquidity) +
      '** collateral, becoming the founding LP on both engines.');
  } else if (joinEntry) {
    out.push(name + ' joined with a wallet of **' + _snum(startWallet) + '**.');
  }
  out.push('');

  if (!acts.length) {
    out.push('_No state-changing actions beyond joining._');
    out.push('');
  } else {
    for (var i = 0; i < acts.length; i++) {
      var e = acts[i];
      out.push('**Step ' + (i + 1) + ' — #' + e.seq + ': ' + _actionLabel(e) + '**');
      out.push('');
      var rc = e.result ? e.result.lmsr : null;
      var ri = e.result ? e.result.l2 : null;
      out.push('| Engine | What it cost / paid | Tokens Δ | Best-case peak payout | E[payout] now | Unrealized P&L now |');
      out.push('| :--- | ---: | ---: | ---: | ---: | ---: |');
      out.push(_userStepRow(lmsrName, e, rc, e.actorState ? e.actorState.trader.lmsr : null));
      out.push(_userStepRow('L2-norm', e, ri, e.actorState ? e.actorState.trader.l2 : null));
      out.push('');
      // LP value line if this user is an LP and we captured an LP snapshot
      if (e.actorState && e.actorState.lp) {
        var clp = e.actorState.lp.lmsr, ilp = e.actorState.lp.l2;
        if (clp || ilp) {
          out.push('  - _LP position value_ — ' + lmsrName + ': ' +
            (clp ? _snum(clp.currentValue) + ' (P&L ' + _ssign(clp.unrealizedPnL) + ')' : '—') +
            '; L2-norm: ' + (ilp ? _snum(ilp.currentValue) + ' (P&L ' + _ssign(ilp.unrealizedPnL) + ')' : '—'));
          out.push('');
        }
      }
    }
  }

  // final outcome from resolve payouts
  if (resolved) {
    var ct = cMap.Trader[name], it = iMap.Trader[name];
    var cl = cMap.LP[name], il = iMap.LP[name];
    var bits = [];
    if (ct || it) {
      bits.push('as a **trader** — ' + lmsrName + ' net P&L ' + (ct ? _ssign(ct.netPnL) : '—') +
        ', L2-norm ' + (it ? _ssign(it.netPnL) : '—'));
    }
    if (cl || il) {
      bits.push('as an **LP** — ' + lmsrName + ' net P&L ' + (cl ? _ssign(cl.netPnL) : '—') +
        ', L2-norm ' + (il ? _ssign(il.netPnL) : '—'));
    }
    if (bits.length) {
      out.push('**Outcome at resolution (bin ' + winBin + '):** ' + bits.join('; ') + '.');
      out.push('');
    }
  }
  return out;
}

function _userStepRow(engine, e, res, pf) {
  var costTxt = '—', tokTxt = '—';
  if (res) {
    if (typeof res.cost === 'number') costTxt = '−' + _snum(res.cost) + ' (buy)';
    else if (typeof res.collateralOut === 'number') costTxt = '+' + _snum(res.collateralOut) + ' (sell)';
    if (typeof res.totalTokens === 'number') tokTxt = '+' + _snum(res.totalTokens);
    else if (typeof res.tokensOut === 'number') tokTxt = '+' + _snum(res.tokensOut);
    else if (typeof res.tokensReturned === 'number') tokTxt = '−' + _snum(res.tokensReturned);
    else if (typeof res.totalSold === 'number') tokTxt = '−' + _snum(res.totalSold);
    else if (typeof res.amount === 'number' && (e.type === 'addLiquidity' || e.type === 'removeLiquidity'))
      tokTxt = 'LP ' + (e.type === 'addLiquidity' ? '+' : '−') + _snum(res.amount);
  }
  var peakTxt = pf && typeof pf.peakPayout === 'number' ? _snum(pf.peakPayout) : '—';
  var expTxt = pf && typeof pf.expectedPayout === 'number' ? _snum(pf.expectedPayout) : '—';
  var pnlTxt = pf && typeof pf.unrealizedPnL === 'number' ? _ssign(pf.unrealizedPnL) : '—';
  return '| ' + engine + ' | ' + costTxt + ' | ' + tokTxt + ' | ' + peakTxt + ' | ' + expTxt + ' | ' + pnlTxt + ' |';
}

// ---- comparison & verdict (Section 4) ----
function _comparisonSection(dm, hist, stateActions, lmsrName, cMap, iMap, resolved, winBin, N, W) {
  var out = [];
  out.push('## 4. ' + lmsrName + ' vs L2-norm — Who Played Better?');
  out.push('');
  out.push('Both engines saw the **same** actions and the **same** settlement; they differ only ' +
    'in how each prices a trade. Below: how they diverged action by action, then a three-lens verdict.');
  out.push('');

  // 4.1 per-action comparison (trades only)
  var trades = stateActions.filter(function (e) {
    return /Buy|Sell/.test(e.type) || e.type === 'sellAll';
  });
  if (trades.length) {
    out.push('### 4.1 Action-by-Action');
    out.push('');
    out.push('| # | Action | ' + lmsrName + ' tokens/out | L2 tokens/out | ' + lmsrName + ' peak | L2 peak | Better for trader | Better for LP |');
    out.push('| :--- | :--- | ---: | ---: | ---: | ---: | :--- | :--- |');
    var maxRows = 14;
    var shown = trades.slice(0, maxRows);
    for (var i = 0; i < shown.length; i++) {
      var e = shown[i];
      var rc = e.result ? e.result.lmsr : null, ri = e.result ? e.result.l2 : null;
      var cTok = _metricTokens(rc), iTok = _metricTokens(ri);
      var cPeak = rc && typeof rc.peakPayout === 'number' ? rc.peakPayout : null;
      var iPeak = ri && typeof ri.peakPayout === 'number' ? ri.peakPayout : null;
      var isBuy = /Buy/.test(e.type);
      // For a buy: more tokens / higher peak = better for trader (worse for LP).
      // For a sell: more collateral out = better for trader (worse for LP).
      var traderBetter = '—', lpBetter = '—';
      if (cPeak != null && iPeak != null && isBuy) {
        traderBetter = cPeak > iPeak ? lmsrName : (iPeak > cPeak ? 'L2-norm' : 'tie');
        lpBetter = cPeak > iPeak ? 'L2-norm' : (iPeak > cPeak ? lmsrName : 'tie');
      } else if (!isBuy && cTok.val != null && iTok.val != null) {
        traderBetter = cTok.val > iTok.val ? lmsrName : (iTok.val > cTok.val ? 'L2-norm' : 'tie');
        lpBetter = cTok.val > iTok.val ? 'L2-norm' : (iTok.val > cTok.val ? lmsrName : 'tie');
      }
      out.push('| #' + e.seq + ' | ' + _actionLabel(e) + ' | ' + cTok.txt + ' | ' + iTok.txt +
        ' | ' + (cPeak != null ? _snum(cPeak) : '—') + ' | ' + (iPeak != null ? _snum(iPeak) : '—') +
        ' | ' + traderBetter + ' | ' + lpBetter + ' |');
    }
    if (trades.length > maxRows) out.push('');
    if (trades.length > maxRows) out.push('_(' + (trades.length - maxRows) + ' further trades omitted from this table; all are covered in Section 3.)_');
    out.push('');
    out.push('Reading this: for a **buy**, the engine giving more tokens / a higher best-case peak ' +
      'payout for the same collateral is more generous to the **trader** — and therefore shifts more ' +
      'risk onto **LPs**. For a **sell**, more collateral out favours the trader. ' + lmsrName +
      ' (a log-cost rule) tends to hand out more shares per unit collateral than the L2-norm ' +
      'hypersphere, so it usually reads "better for trader / worse for LP" on buys.');
    out.push('');
  }

  // 4.2 aggregates
  var cAgg = _aggPnL(dm.lmsr.lastResolvePayouts);
  var iAgg = _aggPnL(dm.l2.lastResolvePayouts);
  out.push('### 4.2 Aggregate Outcome');
  out.push('');
  out.push('| Aggregate | ' + lmsrName + ' | L2-norm |');
  out.push('| :--- | ---: | ---: |');
  out.push('| Total trader net P&L | ' + _ssign(cAgg.trader) + ' | ' + _ssign(iAgg.trader) + ' |');
  out.push('| Total LP net P&L | ' + _ssign(cAgg.lp) + ' | ' + _ssign(iAgg.lp) + ' |');
  out.push('| Final pool | ' + _snum(dm.lmsr.getPool()) + ' | ' + _snum(dm.l2.getPool()) + ' |');
  if (resolved) {
    var rEntry = null;
    for (var ri2 = hist.length - 1; ri2 >= 0; ri2--) { if (hist[ri2].type === 'resolve') { rEntry = hist[ri2]; break; } }
    var cScale = rEntry && rEntry.result.lmsr ? rEntry.result.lmsr.claimScale : 1;
    var iScale = rEntry && rEntry.result.l2 ? rEntry.result.l2.claimScale : 1;
    out.push('| Solvency factor | ' + _sprob(cScale) + ' | ' + _sprob(iScale) + ' |');
  }
  out.push('');

  // 4.3 three-lens verdict (rule-based)
  out.push('### 4.3 Verdict — Three Lenses');
  out.push('');

  // prediction-market lens: which displayed peak ended nearer the resolved bin
  var cd = dm._digestEngine(dm.lmsr), idd = dm._digestEngine(dm.l2);
  var cDist = Math.abs(cd.peakBin - winBin), iDist = Math.abs(idd.peakBin - winBin);
  var pmWinner = resolved ? (cDist < iDist ? lmsrName : (iDist < cDist ? 'L2-norm' : 'a tie')) : 'n/a (unresolved)';
  out.push('**Prediction-market lens (calibration & responsiveness).** ' +
    (resolved
      ? ('At resolution the true outcome was bin ' + winBin + '. ' + lmsrName + '\'s displayed peak sat ' +
         cDist + ' bin(s) away (top ' + _sprob(cd.peakProb) + '); L2-norm\'s was ' + iDist + ' bin(s) away (top ' +
         _sprob(idd.peakProb) + '). On this run, **' + pmWinner + '** tracked the eventual outcome more tightly. ' +
         lmsrName + ' concentrates probability faster (softmax), so its peak is sharper but can over-react; ' +
         'L2-norm\'s linear display moves more gently and stays better spread.')
      : 'Market is unresolved, so calibration cannot be scored.'));
  out.push('');

  // amm lens: complete-set arbitrage condition √N vs 1+W, plus generosity
  var l2complete = Math.sqrt(N), kernelPay = 1 + W;
  var arbBlocked = l2complete > kernelPay;
  out.push('**AMM-mechanics lens (curve behaviour & arbitrage safety).** ' +
    'A complete set of one token in every bin is paid **' + kernelPay + '×** by the width-' + W +
    ' kernel. The L2-norm prices a complete set at **√N = ' + _sround(l2complete, 3) + '**, while ' + lmsrName +
    ' (plain LMSR) prices it at exactly **1**. ' +
    (arbBlocked
      ? ('Because √N (' + _sround(l2complete, 2) + ') > ' + kernelPay + ', the L2-norm **blocks** the risk-free ' +
         'complete-set drain that LMSR leaves open — a decisive structural advantage for L2-norm here. ' +
         '(See `LMSR_KERNEL_ARBITRAGE.md`.)')
      : ('Here √N (' + _sround(l2complete, 2) + ') ≤ ' + kernelPay + ', so neither engine structurally blocks the ' +
         'complete-set arbitrage by price alone — the solvency factor is what bounds LP loss in both.')) +
    ' ' + lmsrName + ' is more capital-efficient for traders (more tokens per unit collateral) but pushes ' +
    'more tail risk to LPs.');
  out.push('');

  // economic lens: sustainability — did LP get drained while traders profited?
  var econWinner, econWhy;
  if (iAgg.lp >= cAgg.lp && cAgg.lp < 0 && iAgg.lp >= cAgg.lp) {
    econWinner = 'L2-norm';
    econWhy = 'it preserved more LP capital (LP P&L ' + _ssign(iAgg.lp) + ' vs ' + _ssign(cAgg.lp) +
      ') while still settling traders, i.e. it is the more sustainable book for liquidity providers.';
  } else if (cAgg.lp > iAgg.lp) {
    econWinner = lmsrName;
    econWhy = 'on this particular path its LPs ended better off (LP P&L ' + _ssign(cAgg.lp) + ' vs ' +
      _ssign(iAgg.lp) + '), though that is path-dependent and not structural.';
  } else {
    econWinner = 'a near tie';
    econWhy = 'LP outcomes were close (' + lmsrName + ' ' + _ssign(cAgg.lp) + ' vs L2-norm ' + _ssign(iAgg.lp) + ').';
  }
  out.push('**Economic lens (sustainability & value distribution).** Across the whole run, ' +
    lmsrName + ' delivered traders ' + _ssign(cAgg.trader) + ' and LPs ' + _ssign(cAgg.lp) + '; ' +
    'L2-norm delivered traders ' + _ssign(iAgg.trader) + ' and LPs ' + _ssign(iAgg.lp) + '. ' +
    'On this metric **' + econWinner + '** comes out ahead — ' + econWhy);
  out.push('');

  // overall
  var overall;
  if (arbBlocked) {
    overall = 'L2-norm';
  } else if (econWinner === lmsrName && pmWinner === lmsrName) {
    overall = lmsrName;
  } else {
    overall = 'L2-norm';
  }
  out.push('### 4.4 Overall');
  out.push('');
  out.push('> **' + overall + '** is the better all-round design for this market. ' +
    (arbBlocked
      ? ('Its complete-set price (√N = ' + _sround(l2complete, 2) + ') exceeds the kernel payout (' + kernelPay +
         '×), so it structurally blocks the risk-free LP drain that the LMSR family leaves open under smooth-kernel ' +
         'settlement — the dominant economic and AMM-safety consideration. ' + lmsrName +
         ' remains attractive for traders (cheaper shares, sharper probabilities), but that generosity is exactly ' +
         'the LP risk L2-norm contains.')
      : (overall === lmsrName
         ? ('On this run it both tracked the outcome and treated LPs at least as well, while pricing trades efficiently.')
         : ('With √N ≤ 1+W neither price structurally blocks the complete-set arbitrage, so the solvency-capped, ' +
            'better-spread L2-norm is the safer default; the LMSR edge is mainly trader-side capital efficiency.'))));
  out.push('');
  return out;
}

function _metricTokens(res) {
  if (!res) return { val: null, txt: '—' };
  if (typeof res.totalTokens === 'number') return { val: res.totalTokens, txt: '+' + _snum(res.totalTokens) };
  if (typeof res.tokensOut === 'number') return { val: res.tokensOut, txt: '+' + _snum(res.tokensOut) };
  if (typeof res.collateralOut === 'number') return { val: res.collateralOut, txt: '+' + _snum(res.collateralOut) + ' coll' };
  if (typeof res.totalSold === 'number') return { val: res.totalSold, txt: '−' + _snum(res.totalSold) };
  if (typeof res.tokensReturned === 'number') return { val: res.tokensReturned, txt: '−' + _snum(res.tokensReturned) };
  return { val: null, txt: '—' };
}

function _aggPnL(payouts) {
  var t = 0, l = 0;
  if (payouts) for (var i = 0; i < payouts.length; i++) {
    if (payouts[i].type === 'Trader') t += payouts[i].netPnL; else l += payouts[i].netPnL;
  }
  return { trader: t, lp: l };
}

// ============================================================
// 3. UI GLUE
// ============================================================
function showStoryButton() {
  var card = document.getElementById('storyGenerateCard');
  if (card) card.style.display = '';
}

var _lastStoryMarkdown = '';

function generateStoryReport() {
  if (typeof dualMarket === 'undefined' || !dualMarket || !dualMarket.initialized) {
    return showToast('Create and resolve a market first', 'error');
  }
  if (!dualMarket.lmsr.resolved) {
    return showToast('Resolve the market before generating its story', 'error');
  }
  try {
    _lastStoryMarkdown = buildStoryMarkdown(dualMarket);
    var preview = document.getElementById('storyPreview');
    preview.innerHTML = renderMarkdown(_lastStoryMarkdown);
    document.getElementById('storyCard').style.display = '';
    document.getElementById('storyCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Story generated (' + dualMarket.history.length + ' actions)', 'info');
  } catch (e) {
    showToast('Story generation failed: ' + e.message, 'error');
    if (typeof console !== 'undefined') console.error(e);
  }
}

function _storyFilename() {
  var nm = _lmsrName(dualMarket).toLowerCase();
  var n = dualMarket.lmsr.N;
  return 'market-story-' + nm + '-vs-l2-' + n + 'bins.md';
}

function saveStoryReport() {
  if (!_lastStoryMarkdown) return showToast('Generate the story first', 'error');
  var filename = _storyFilename();
  var content = _lastStoryMarkdown;

  // Preferred: native "Save As" dialog (Chromium). Lets the user pick a location.
  if (typeof window !== 'undefined' && window.showSaveFilePicker) {
    window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    }).then(function (handle) {
      return handle.createWritable().then(function (w) {
        return w.write(content).then(function () { return w.close(); });
      });
    }).then(function () {
      showToast('Story saved', 'info');
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return; // user cancelled
      _downloadFallback(filename, content);
    });
    return;
  }
  _downloadFallback(filename, content);
}

function _downloadFallback(filename, content) {
  try {
    var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Story downloaded', 'info');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// Export for headless tests (no-op in browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMarkdown: renderMarkdown, buildStoryMarkdown: buildStoryMarkdown, escapeHtml: escapeHtml };
}
