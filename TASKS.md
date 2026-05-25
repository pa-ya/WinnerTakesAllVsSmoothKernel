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

#### P0-1: Create `comparison.js` with shared constants and utilities
- `SCALE_WEIGHT = 1e9`, `Z_CUTOFF = 5`
- `formatCompact(n)` — number formatter (short mode only, no settings persistence needed)
- `getChartColors()` — read CSS custom properties
- Theme toggle (`dark`/`light`) — no language toggle needed

#### P0-2: Implement `CurrentMarket` engine class
- Port from `specs/math/math_doc_script.js` `ContinuousMarket` (lines 262-630)
- Quadratic probability: `p_i = x_i^2 / k^2`
- Methods needed: constructor, `getProbabilities()`, `getLabels()`, `ensureTrader()`,
  `discreteBuy()`, `discreteSell()`, `distributionBuy()`, `distributionSell()`,
  `addLiquidity()` (initial LP only), `resolve()`, `getTraderPortfolio()`
- WTA resolution: winning bin tokens pay 1:1
- **No multi-market support** — single market instance
- **No LP add/remove UI** — only Creator's initial liquidity

#### P0-3: Implement `ImprovedMarket` engine class
- Port from `specs/math/improved/math_doc_script.js` `ContinuousMarket` (lines 263-760)
- Linear probability: `p_i = x_i / sum(x_j)`
- Extra field: `kernelWidth` (default 3)
- Extra method: `getSettlementKernel(winBin)` — triangular kernel
- Kernel resolution: `payout = sum_i(holdings[i] * kernel[i]) * claimScale`
- Solvency: `claimScale = min(1, k / totalKernelClaim)`
- Portfolio uses kernel-weighted expected payout (loop over all possible win bins)

#### P0-4: Implement `DualMarket` orchestrator
- Wraps `CurrentMarket` + `ImprovedMarket` with the same parameters
- Exposes a single API that delegates each operation to both engines:
  - `init(N, rangeMin, rangeMax, liquidity, fees)` — creates both markets
  - `addTrader(name, balance)` — adds to shared `globalTraders` + both engines
  - `discreteBuy(trader, bin, amount)` — returns `{ current: result, improved: result }`
  - `discreteSell(trader, bin, amount)` — same
  - `distributionBuy(trader, mu, sigma, amount)` — same
  - `distributionSell(trader, mu, sigma, amount)` — same
  - `resolve(value)` — resolves both, returns dual payouts
- This ensures every action is atomically applied to both markets
- Global trader wallet deduction: each engine tracks its own copy. The `DualMarket`
  manages two separate wallet snapshots per trader (current vs improved), both
  starting from the same initial balance

> **Potential bugs:**
> - Wallet sync: if one market's operation fails (e.g., sqrt of negative) but the
>   other succeeds, the dual state diverges. **Fix:** Execute both in dry-run first;
>   if either fails, abort both and show the error.
> - Holdings are per-engine, but input amounts are shared. A sell of N tokens must
>   check both engines have sufficient holdings; if one doesn't, show which engine
>   blocked it.

#### P0-5: Unit-test the engines manually
- Create a temporary test section (or use console) to verify:
  - Both markets start with identical k, positions, probabilities
  - After the same buy, positions diverge only in probability display (trade math is identical)
  - Resolution payouts differ: current has single-bin WTA, improved has multi-bin kernel
  - Solvency scaling triggers correctly when kernel claims > k
- **Remove test code before Phase 1**

---

### Phase 1: HTML Layout & Tab Structure

> **Goal:** Build the page skeleton with all containers, tabs, and placeholders
> — no functional logic yet, just static HTML/CSS.

#### P1-1: Create `index.html` page structure
- Full-width layout (no sidebar — all space goes to playground)
- Top bar: title "DekantPM — Market Comparison", theme toggle, settings gear icon
- Below top bar: a thin formula banner showing both formulas side by side:
  ```
  Current (WTA): Payout = holdings[win]  |  Improved (Kernel): Payout = sum(holdings_i * K(i,win,W)) * s
  ```
- Main content: full-width playground area

#### P1-2: Tab navigation — Setup, Trader, Distribution, Resolve
- Tab bar across the top of the playground area
- **Setup tab:** Market creation form (shared inputs)
- **Trader tab:** Discrete bin trading (buy/sell) with dual chart + dual stats
- **Distribution tab:** Distribution trading (mu/sigma) with dual chart + dual stats
- **Resolve tab:** Resolution controls + dual payout table

#### P1-3: Dual-column chart layout
- In Trader and Distribution tabs, side-by-side layout:
  ```
  [ Current Market Chart ]  [ Improved Market Chart ]
  [ Current Stats/Preview ] [ Improved Stats/Preview ]
  ```
- Charts have equal width, stacked vertically on narrow screens
- Each chart has a label: "Current (Quadratic WTA)" / "Improved (Linear Kernel)"
- Below each chart: stats panel showing key metrics

#### P1-4: Combined chart mode toggle
- A button/toggle above the dual charts: "Split" / "Combined"
- **Split mode (default):** two separate charts side by side
- **Combined mode:** single wide chart with all curves overlaid:
  - Current market probability (solid blue)
  - Improved market probability (solid cyan/teal)
  - Trader position (if in Trader tab, dashed)
  - Trade preview curve (if applicable, dotted)
  - Show/hide toggle for each dataset
  - Dashed horizontal/vertical comparison guidelines

#### P1-5: CSS styling
- Reuse CSS custom properties from the existing math docs (dark/light themes)
- No sidebar, no TOC — maximize horizontal space
- Responsive: side-by-side on desktop (>1024px), stacked on mobile
- Charts should be tall enough to see detail (min-height 320px)
- Stats panels use compact grid layout (result-grid pattern from existing code)

> **Potential bugs:**
> - Tab switching must properly show/hide sections and trigger chart resize
>   (Chart.js needs `.resize()` when container visibility changes)
> - Combined chart must handle different Y-axis scales gracefully (the two markets
>   may have very different probability ranges after trades)

---

### Phase 2: Setup Tab

> **Goal:** Market creation form with shared parameters that initializes both engines.

#### P2-1: Setup form fields
- **Bins:** dropdown (16, 32, 64, 128, 256, 512, custom) — same as existing
- **Range Min/Max:** number inputs
- **Initial Liquidity (k):** number input
- **Kernel Width (W):** number input (only affects improved market), default 3,
  with a helper note: "Only affects Improved market resolution"
- **Question:** text input (optional, for labeling)
- **Fee Configuration:** collapsible section with trade fee bps, LP fee share %,
  redemption fee bps (shared between both markets)
- **Random Question** button

#### P2-2: "Create Market" button
- Validates inputs (range, bins, liquidity > 0)
- Calls `DualMarket.init(...)` to create both engines
- Switches to Trader tab automatically
- Shows both charts with initial uniform probability distributions
- Initializes slider controls for Trader and Distribution tabs

#### P2-3: Trader management section (in Setup tab)
- Add trader: name + initial balance
- List of existing traders with wallet balances
- Top-up trader functionality
- Active trader selector (shared across both tabs)
- **No LP management UI** — Creator is the only LP

> **Potential bugs:**
> - Kernel width must be validated: `W >= 0`, `W < N`. If W=0, improved degrades to
>   WTA (document this as expected behaviour). If W >= N, all bins contribute
>   (extreme smoothing) — allowed but warn user.

---

### Phase 3: Trader Tab (Discrete Trading)

> **Goal:** Discrete bin buy/sell with live dual charts and side-by-side comparison.

#### P3-1: Shared trade controls
- Bin selector: slider + number input (synced), label showing bin range
- Amount input: collateral for buy, tokens for sell
- Buy / Sell buttons
- Buy/Sell mode toggle for preview

#### P3-2: Dual charts rendering
- Two Chart.js instances: `currentChart`, `improvedChart`
- Both show smooth line charts (tension 0.4) — no bar chart option
- Y-axis: Probability (%)
- X-axis: range values (bin centers or ranges)
- Each chart displays:
  - **Market probability curve** (primary dataset)
  - **Trader position curve** (overlay, can show/hide) — trader's holdings
    normalized as a curve (holdings per bin)
- Resolved state: winning bin highlighted on both charts
- **Axis drag-to-zoom:** allow user to drag on Y-axis to change range,
  and on X-axis to pan/zoom. Implement via Chart.js zoom plugin or custom
  mouse handlers. Both charts should zoom independently.

#### P3-3: Dual stats panels
- Below each chart, show:
  - k (minted)
  - Invariant check (`sum(x^2) - k^2`)
  - LP fees accumulated
  - Active trader: wallet, spent, received, expected payout, peak payout, PnL
- For buy/sell preview (before executing):
  - Tokens out (buy) / Collateral out (sell)
  - Peak payout
  - Max profit / loss
  - Fee
  - New probability at target bin
- Note: "New probability" uses quadratic formula for current, linear for improved

#### P3-4: Trade execution flow
1. User changes bin/amount -> preview updates on both panels instantly
2. User clicks Buy/Sell -> `DualMarket.discreteBuy/Sell(...)` executes on both
3. Both charts update, both stats update
4. Trade result shown below each chart (tokens, payout, fee, etc.)
5. If one engine returns error, show error on that panel, don't execute on either

#### P3-5: Chart dataset toggling
- Below each chart (or in chart header): checkbox toggles for:
  - [x] Probability distribution
  - [x] Trader position
- Toggling hides/shows the dataset on that specific chart
- In combined mode, more toggles available (current prob, improved prob, etc.)

> **Potential bugs:**
> - After many trades, probability values may differ significantly between markets
>   due to linear vs quadratic formula. The Y-axis auto-scale handles this, but
>   combined mode needs careful scaling.
> - Discrete preview for sell must show different "received" amounts because the
>   AMM math is identical but the preview "New Prob" differs between engines.
>   Actually: the AMM (buy/sell) math IS identical (both use L2 invariant).
>   The only difference is probability *display*. So trade results (tokens, cost,
>   collateral) are identical between the two engines. The preview stats should
>   reflect this: same trade amounts, different "New Prob" display. Verify this!
> - **Critical insight:** Since both engines use the same L2 AMM for trading,
>   `discreteBuy()` and `discreteSell()` produce identical `tokensOut` and
>   `collateralOut` in both engines. The engines diverge only in:
>   (a) displayed probabilities, (b) expected/peak payout calculations,
>   (c) resolution payouts. The dual stats must highlight these differences clearly.

---

### Phase 4: Distribution Tab

> **Goal:** Distribution (mu/sigma) trading with the same dual-chart comparison.

#### P4-1: Shared distribution controls
- Mu slider: range [rangeMin, rangeMax], synced with number input
- Confidence slider (log-scale -> sigma), synced with sigma number input
- Amount input: collateral for buy, tokens for sell
- Buy / Sell buttons
- Distribution preview SVG: shows the Gaussian bell curve overlaid on the
  current market probability (one preview SVG is enough since both markets
  have the same positions after identical trades)

#### P4-2: Distribution trade execution
- `DualMarket.distributionBuy/Sell(...)` executes on both engines
- Both charts update with the new probability curves
- Both stats panels update with trade results
- Trade result display for each panel

#### P4-3: Distribution trade preview
- Show buy/sell preview for both markets:
  - Total tokens, peak payout (bin), max profit
  - Note: token amounts are identical (same AMM); only expected/peak payout
    calculations differ due to probability formula and kernel
- Preview updates live as mu/sigma/amount change

> **Potential bugs:**
> - Distribution sell needs to check both engines' holdings independently.
>   Since trades are mirrored, holdings should always be identical between engines.
>   But if a prior trade diverged (shouldn't happen with atomic dual exec), this
>   could cause issues. **Add assertion:** after each dual trade, verify that
>   both engines' positions arrays are identical (they should be, since AMM math
>   is the same). If they drift, log a warning.
> - The confidence slider uses log-scale mapping (`sliderToSigma`). Port this
>   exactly from existing code to avoid sigma computation differences.

---

### Phase 5: Resolve Tab

> **Goal:** Resolution with dual payout table showing both WTA and kernel payouts
> side by side for direct comparison.

#### P5-1: Resolution controls
- Resolve value input: number (within market range)
- Resolve value slider: synced with input
- **Resolve / Re-Resolve** button
- Kernel width display: show current W value (read-only, set at market creation)

#### P5-2: Dual payout table
- Single table with **two rows per participant** (not two separate tables):
  ```
  | Name    | Model    | Detail          | Gross Payout | Fee   | Net Payout | Spent  | Received | Net P&L | P&L %  |
  |---------|----------|-----------------|--------------|-------|------------|--------|----------|---------|--------|
  | Alice   | Current  | 5,230 tokens    | 5,230        | 0     | 5,230      | 10,000 | 0        | -4,770  | -47.7% |
  | Alice   | Improved | 3 bins (scaled) | 4,892        | 0     | 4,892      | 10,000 | 0        | -5,108  | -51.1% |
  | Bob     | Current  | 8,100 tokens    | 8,100        | 0     | 8,100      | 5,000  | 0        | +3,100  | +62.0% |
  | Bob     | Improved | 2 bins          | 7,450        | 0     | 7,450      | 5,000  | 0        | +2,450  | +49.0% |
  | Creator | Current  | LP: 100K shares | 94,770       | 0     | 94,770     | 100K   | 0        | -5,230  | -5.2%  |
  | Creator | Improved | LP: 100K shares | 95,658       | 0     | 95,658     | 100K   | 0        | -4,342  | -4.3%  |
  ```
- Color coding: Current rows have a subtle blue-left-border, Improved rows have
  a subtle teal-left-border
- PnL cells colored: green for positive, red for negative
- Group rows by participant (Current row then Improved row), with a subtle
  separator between different participants

#### P5-3: Payout comparison summary
- Above the table, show aggregate comparison:
  - Total trader payouts: Current vs Improved
  - Total LP residual: Current vs Improved
  - Solvency scale factor (Improved only): 100% means no scaling needed
  - Vault balance check: both should equal k
- Highlight significant differences (>5% divergence) with a colored indicator

#### P5-4: Kernel visualization (Improved only)
- Small inline chart or visual showing the triangular kernel shape for the
  resolved bin, with kernel weights labeled
- This helps the user understand which bins contribute to improved payouts

#### P5-5: Re-resolve support
- Changing resolve value and clicking Re-Resolve updates both engines
- Payout table refreshes with new values
- Charts update to show new winning bin
- Previous resolve value displayed for reference

#### P5-6: Resolution charts
- Both charts update to show resolved state:
  - Winning bin marker (vertical line or highlight)
  - On improved chart: kernel weight overlay (shaded region around winning bin)
- Charts maintain their probability curves (don't clear after resolve)

> **Potential bugs:**
> - Solvency scaling: when `totalKernelClaim > k`, payouts are scaled down. The
>   table must show the scaled payouts, not the raw kernel claims. Show scaling
>   factor explicitly so user understands why improved payouts are lower.
> - LP residual calculation differs:
>   - Current: `k - sum(trader_holdings[win_bin])`
>   - Improved: `k - total_scaled_kernel_claims`
>   These may be very different. Verify vault balance identity holds for both.
> - Re-resolve must NOT mutate positions or holdings (both existing engines
>   already do this correctly — resolve only reads state, doesn't modify it).
>   Verify this is preserved in the comparison implementation.
> - Edge case: resolve at exact bin boundary. Both engines should agree on which
>   bin is selected. Verify `Math.floor((value - rangeMin) * N / (rangeMax - rangeMin))`
>   is used consistently.

---

### Phase 6: Combined Chart Mode

> **Goal:** Overlay both markets' curves in a single chart for direct visual comparison.

#### P6-1: Combined chart rendering
- Single Chart.js instance with multiple datasets:
  1. **Current probability** — solid blue line
  2. **Improved probability** — solid teal line
  3. **Trader position** — dashed purple line (if active trader has holdings)
  4. **Trade preview** — dotted line (if preview is active, e.g., on the
     Distribution tab with mu/sigma set)
- Legend with show/hide checkboxes for each dataset
- X-axis: shared (bin centers / range values)
- Y-axis: probability (%) — auto-scaled to fit all visible datasets

#### P6-2: Comparison guidelines
- Dashed horizontal lines at notable probability levels (e.g., uniform = 1/N)
- Dashed vertical line at the bin with maximum probability difference between
  current and improved
- Optional: thin vertical lines at the resolved bin (if resolved)
- These lines help the user visually locate where the two models diverge

#### P6-3: Combined mode stats
- Below the combined chart, show a compact comparison panel:
  ```
  Metric          | Current  | Improved | Delta
  Max Prob        | 12.3%    | 8.7%     | -3.6%
  Peak Payout     | $5,230   | $4,892   | -$338
  Expected Payout | $2,100   | $2,340   | +$240
  ```
- Delta column highlights which model is better for the active trader

#### P6-4: Toggle between split and combined
- Smooth transition: when switching, charts animate between layouts
- Combined mode hides the individual stats panels and shows the comparison panel
- Split mode restores the dual-column layout

> **Potential bugs:**
> - Combined chart Y-axis: since quadratic probabilities are more extreme
>   (higher peaks, lower valleys) than linear, the Y-axis must auto-scale to
>   accommodate both. If one curve is much higher, the other may appear flat.
>   **Fix:** Use Chart.js suggestedMax/suggestedMin, or allow manual Y-axis
>   drag adjustment.
> - Dataset ordering: ensure the datasets are layered correctly (preview on top,
>   then positions, then probability curves). Use Chart.js `order` property.

---

### Phase 7: Chart Interactivity (Axis Drag)

> **Goal:** Allow users to drag on chart axes to zoom/pan, matching the frontend
> DekantPM chart behavior.

#### P7-1: Y-axis drag to zoom
- Mousedown on Y-axis area -> drag up/down to change Y-axis range
- Show min/max labels updating in real-time during drag
- Double-click Y-axis to reset to auto-scale
- Works on both split charts and combined chart independently

#### P7-2: X-axis drag to pan/zoom
- Mousedown on X-axis area -> drag left/right to pan the view
- Scroll wheel on chart to zoom in/out on X-axis
- Double-click X-axis to reset to full range
- X-axis zoom should be synced between split charts (zoom one = zoom both)
  so the user can compare the same region

#### P7-3: Implementation approach
- Use Chart.js zoom plugin (`chartjs-plugin-zoom`) if available via CDN
- Fallback: custom mouse event handlers that modify chart scale options
- Store current zoom state per chart, restore on tab switch

> **Potential bugs:**
> - Zoom state must persist across chart redraws (after trades). Store zoom
>   config separately and re-apply after `chart.update()`.
> - If X-axis zoom is synced between split charts, ensure the sync doesn't
>   cause infinite update loops. Use a flag to prevent recursive updates.

---

### Phase 8: Settings & Polish

> **Goal:** Settings panel, theme support, final polish.

#### P8-1: Settings modal
- Triggered by gear icon in top bar
- Settings:
  - **Font size:** xs, sm, md, lg, xl (radio group)
  - **Number format:** short (1.2K) vs long (1,234) (radio group)
  - **Decimal precision:** 0-6 (slider)
  - **Theme:** dark / light (toggle)
- Settings saved to `localStorage` (key: `dekantpm_comparison_settings_v1`)
- No autosave toggle, no language option

#### P8-2: Toast notification system
- Lightweight toast for trade confirmations, market creation, errors
- Reuse the existing toast CSS pattern

#### P8-3: Responsive design review
- Test on 1920px, 1440px, 1024px, 768px, 375px widths
- Ensure charts resize properly
- On mobile: stack charts vertically, collapse stats panels
- Ensure tab navigation is touch-friendly

#### P8-4: Visual polish
- Formula banner should use MathJax or pre-formatted HTML for clean rendering
- Color-coded labels: blue for current, teal for improved throughout
- Hover states on interactive elements
- Smooth transitions on tab switches and chart mode toggles

#### P8-5: Performance considerations
- For markets with N > 256 bins, disable chart animations
- Debounce slider inputs to avoid excessive redraws
- Limit tooltip frequency on large charts
- Kernel portfolio computation (O(N^2)) may be slow for N > 512 — consider
  caching or computing only on demand

> **Potential bugs:**
> - `localStorage` key collision with existing math doc pages. Use a unique key
>   (`dekantpm_comparison_settings_v1`).
> - Theme toggle must update all chart colors. Existing code pattern: rebuild
>   charts after theme change (call `updateAllCharts()`).

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

| Phase | Description | Depends On |
|-------|-------------|------------|
| P0 | Dual engine core | — |
| P1 | HTML layout & tabs | — |
| P2 | Setup tab | P0, P1 |
| P3 | Trader tab | P0, P1, P2 |
| P4 | Distribution tab | P0, P1, P2 |
| P5 | Resolve tab | P0, P1, P2 |
| P6 | Combined chart mode | P3 or P4 |
| P7 | Axis drag interactivity | P3 or P4 |
| P8 | Settings & polish | All above |

**P0 and P1 can be developed in parallel** (engine vs layout).
**P3, P4, P5 can be developed in any order** after P2.
**P6 and P7 can be developed in any order** after at least one trading tab exists.
