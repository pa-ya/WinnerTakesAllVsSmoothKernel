# Comparison Playground — Implementation Tasks

> **Goal:** A single-page HTML/CSS/JS app that runs two continuous prediction markets
> side-by-side (Current quadratic L2-norm vs. Improved smooth-kernel) with shared
> inputs but separate outputs, allowing direct comparison of profitability,
> payouts, PnL, and distribution behaviour.

---

## Architecture Overview

```
comparison/
  index.html          — Single-page app (HTML + embedded CSS)
  comparison.js       — All JS logic (engines, UI, charts)
```

**Dependencies (CDN):**
- Chart.js 4 (smooth curve charting)
- Google Fonts: Inter, JetBrains Mono

**No build step required** — open `index.html` directly in browser.

---

## Key Design Decisions

### What differs between the two engines

| Aspect | Current | Improved |
|--------|---------|----------|
| **Probability formula** | `p_i = x_i^2 / k^2` (quadratic) | `p_i = x_i / sum(x_j)` (linear) |
| **Resolution** | Winner-Takes-All (1:1): winning bin tokens redeem at face value | Smooth Triangular Kernel: `K(i, win, W) = max(0, 1 - |i - win| / (W + 1))`, nearby bins get partial payout |
| **Solvency** | Always solvent (only one bin pays) | Scaling factor `s = min(1, k / total_kernel_claims)` ensures vault never overpays |
| **Expected payout** | `E[payout] = sum(p_i * holdings_i)` | `E[payout] = sum_w(p_w * sum_i(holdings_i * K(i, w, W)))` |
| **LP residual at resolution** | `k - sum(trader_holdings[win])` | `k - total_scaled_kernel_claims` |

### What is identical (shared)

- AMM invariant: `sum(x_i^2) = k^2` (L2-norm hypersphere)
- Trading mechanics: buy, sell, distribution buy/sell (same formulas)
- Fee structure: trade fee, LP fee share, redemption fee
- LP operations: add/remove liquidity (same ratio scaling)
- Market setup: bins, range, initial liquidity
- Trader management: global traders with wallets

### Formula display

Show the key differing formulas at the top of each market column:
- **Current:** `Payout = holdings[win_bin]` (WTA)
- **Improved:** `Payout = sum_i(holdings[i] * K(i, win, W)) * s` (Kernel)

---

## Phases

### Phase 0: Project Scaffold & Dual Engine Core

> **Goal:** Set up the project structure, implement both market engines in a single
> JS file, and verify they produce correct results before any UI.

- [x] **P0-1:** Create `comparison.js` with shared constants and utilities
- [x] **P0-2:** Implement `CurrentMarket` engine class (quadratic WTA)
- [x] **P0-3:** Implement `ImprovedMarket` engine class (linear kernel)
- [x] **P0-4:** Implement `DualMarket` orchestrator
- [x] **P0-5:** Unit-test the engines (39/39 passed)

---

### Phase 1: HTML Layout & Tab Structure

> **Goal:** Build the page skeleton with all containers, tabs, and placeholders
> — no functional logic yet, just static HTML/CSS.

- [x] **P1-1:** Create `index.html` page structure (navbar, formula banner, full-width layout)
- [x] **P1-2:** Tab navigation — Setup, Trader, Distribution, Resolve
- [x] **P1-3:** Dual-column chart layout (split + combined panels)
- [x] **P1-4:** Combined chart mode toggle (Split/Combined button)
- [x] **P1-5:** CSS styling (dark/light themes, responsive, result grids, toasts, settings modal)

---

### Phase 2: Setup Tab

> **Goal:** Market creation form with shared parameters that initializes both engines.

- [x] **P2-1:** Setup form fields (bins, range, liquidity, kernel width, fees)
- [x] **P2-2:** "Create Market" button (validates, inits DualMarket, switches to Trader tab)
- [x] **P2-3:** Trader management section (add trader, list, top-up, active selector)

> **Potential bugs:**
> - Kernel width must be validated: `W >= 0`, `W < N`. If W=0, improved degrades to
>   WTA (document this as expected behaviour). If W >= N, all bins contribute
>   (extreme smoothing) — allowed but warn user.

---

### ~~Phase 3: Trader Tab (Discrete Trading)~~ — Removed

> Merged into Distribution/Trading tab. Discrete single-bin trading was redundant
> since distribution trading is strictly more flexible, and trader management
> lives in the Setup tab.

---

### Phase 4: Trading Tab (Distribution Trading)

> **Goal:** Distribution (mu/sigma) trading with the same dual-chart comparison.

- [x] **P4-1:** Shared distribution controls (mu slider, confidence/sigma, amount)
- [x] **P4-2:** Distribution trade execution (dual buy/sell)
- [x] **P4-3:** Distribution trade preview (live preview as inputs change)

---

### Phase 5: Resolve Tab

> **Goal:** Resolution with dual payout table showing both WTA and kernel payouts
> side by side for direct comparison.

- [x] **P5-1:** Resolution controls (value slider/input, resolve/re-resolve button)
- [x] **P5-2:** Dual payout table (two rows per participant, color-coded)
- [x] **P5-3:** Payout comparison summary (totals, LP residual, solvency factor)
- [x] **P5-4:** Kernel visualization (triangular kernel shape chart)
- [x] **P5-5:** Re-resolve support (update payouts, show previous value)
- [x] **P5-6:** Resolution charts (winning bin marker, kernel overlay)

---

### Phase 6: Combined Chart Mode

> **Goal:** Overlay both markets' curves in a single chart for direct visual comparison.

- [x] **P6-1:** Combined chart rendering (current + improved + position + preview)
- [x] **P6-2:** Comparison guidelines (dashed lines at uniform, max divergence)
- [x] **P6-3:** Combined mode stats (comparison table with delta column)
- [x] **P6-4:** Toggle between split and combined (smooth transition)

---

### Phase 7: Chart Interactivity (Axis Drag)

> **Goal:** Allow users to drag on chart axes to zoom/pan.

- [x] **P7-1:** Y-axis drag to zoom
- [x] **P7-2:** X-axis drag to pan/zoom (scroll wheel, box-zoom drag, shift+drag pan)
- [x] **P7-3:** Implementation: chartjs-plugin-zoom + Hammer.js, reset zoom buttons per chart

---

### Phase 8: Settings & Polish

> **Goal:** Settings panel, theme support, final polish.

- [ ] **P8-1:** Settings modal (font size, number format, decimal precision, theme)
- [ ] **P8-2:** Toast notification system
- [ ] **P8-3:** Responsive design review
- [ ] **P8-4:** Visual polish (color-coded labels, hover states, transitions)
- [ ] **P8-5:** Performance considerations (debounce, animation disable for large N)

---

## Critical Math Verification Checklist

Before considering each phase complete, verify these invariants:

1. **AMM invariant:** `sum(x_i^2) == k^2` must hold after every trade in both engines
2. **Identical trade outputs:** Since both engines use the same L2-norm AMM,
   `discreteBuy(bin, amount)` must produce identical `tokensOut` and `fee` in both.
   The only difference is `newProb` display (quadratic vs linear).
3. **Identical holdings:** After the same sequence of trades, both engines must have
   identical `positions[]` arrays and identical `traderHoldings`. They only diverge
   in probability display, expected payout, and resolution payouts.
4. **Vault balance at resolution:**
   - Current: `k == sum(all_trader_payouts) + lp_residual + protocol_fees`
   - Improved: `k == sum(all_scaled_kernel_payouts) + lp_residual + protocol_fees`
5. **Solvency:** Improved market total payouts must never exceed `k`
6. **Kernel symmetry:** `K(i, win, W) == K(win + d, win, W)` when `d = |i - win|`
7. **Kernel degradation:** When `kernelWidth = 0`, improved resolution should match
   current WTA behaviour exactly (only winning bin pays)

---

## File Reference

Source code to port/adapt from:

| Function / Section | Current | Improved |
|---|---|---|
| Market engine constructor | `math_doc_script.js:262-292` | `improved/math_doc_script.js:263-294` |
| `getProbabilities()` | `:294-300` (quadratic) | `:296-304` (linear) |
| `getSettlementKernel()` | N/A | `:306-322` |
| `discreteBuy()` | `:331-368` | `:352-395` |
| `discreteSell()` | `:370-404` | `:397-431` |
| `_computeWeights()` | `:406-424` | `:433-451` |
| `distributionBuy()` | `:426-476` | `:453-498` |
| `distributionSell()` | `:478-523` | `:500-559` |
| `resolve()` | `:571-630` (WTA) | `:609-696` (kernel) |
| `getTraderPortfolio()` | `:633-674` | `:700-760` |
| Trade preview math | `:2278-2433` | `:2405-2565` |
| Chart rendering | `:1704-1766` | `:1812-1890` |
| Resolve payout table | `:1411-1445` | `:1500-1551` |
| Toast/utilities | `:147-154, 1995-2015` | Same |
| Settings modal | `:2020-2069` | Same |

---

## Summary of Phases

| Phase | Status | Description | Depends On |
|-------|--------|-------------|------------|
| P0 | Done | Dual engine core | — |
| P1 | Done | HTML layout & tabs | — |
| P2 | Done | Setup tab | P0, P1 |
| P3 | Removed | ~~Trader tab~~ (merged into Trading) | — |
| P4 | Done | Trading tab | P0, P1, P2 |
| P5 | Done | Resolve tab | P0, P1, P2 |
| P6 | Done | Combined chart mode | P3 or P4 |
| P7 | Done | Chart zoom/pan interactivity | P4 |
| P8 | | Settings & polish | All above |

**P0 and P1 can be developed in parallel** (engine vs layout).
**P3, P4, P5 can be developed in any order** after P2.
**P6 and P7 can be developed in any order** after at least one trading tab exists.
