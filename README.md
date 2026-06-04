# DekantPM Market Comparison Playground

**[Live Demo](https://pydea-rs.github.io/WinnerTakesAllVsSmoothKernel)**

An interactive browser-based playground for comparing two continuous prediction
market AMM designs side-by-side under the **same smooth-kernel settlement**: an
**L2-norm (hypersphere) AMM** versus an **LMSR (logarithmic market scoring rule)
AMM**.

Both engines settle identically — a triangular kernel pays nearby bins around the
winning outcome, with a solvency `claimScale` guard. They differ **only in the AMM**
that prices and fills trades. The goal: find which AMM gives traders and LPs better
outcomes under the smooth-kernel model the protocol now ships.

## Why This Exists

DekantPM's on-chain program uses the smooth-kernel settlement (linear probability
display + triangular payout). This tool keeps that settlement fixed and swaps the
underlying AMM to see which curve is more profitable / fairer in practice. Run an
identical sequence of trades against both engines and compare trader P&L, LP
returns, payout distributions, and solvency.

## The Two Engines

Shared by both: the smooth triangular settlement kernel
`K(i, win, W) = max(0, 1 − |i − win| / (W + 1))`, the solvency scale
`claimScale = min(1, pool / Σ kernel claims)`, the fee model (trade / LP-share /
redemption), and LP share accounting.

### L2-norm (Hypersphere AMM)

- **Invariant**: `Σ xᵢ² = k²` — trades move reserves along a hypersphere
- **Probability**: `pᵢ = xᵢ / Σ xⱼ` (linear display)
- **Pool / vault**: `k`
- **Liquidity provision**: add/remove scales all reserves proportionally, which
  **preserves the probability distribution** and changes depth

### LMSR (Logarithmic Market Scoring Rule)

The left engine has two selectable variants (set in the Setup tab):

**LMSR (fixed `b`)** — the default:

- **Cost function**: `C(q; b) = b · ln Σ exp(qᵢ / b)`; a buy of `Δq` shares costs
  `C(q + Δq) − C(q)`
- **Probability**: `pᵢ = softmax(qᵢ / b)`
- **Pool / vault**: `C(q; b)` (initial subsidy `b·ln(N)` + net trade collateral)
- **Liquidity parameter**: `b = liquidity / ln(N)`, so the LMSR market locks exactly
  the same collateral as the L2-norm vault `k` and both start at uniform prices
- **Liquidity provision**: add/remove scales `b` (deeper/shallower market), which
  drifts live prices toward/away from uniform; trader holdings are untouched

**LS-LMSR (liquidity-sensitive, pure Othman `b = α·ΣQ`)**:

- Liquidity parameter grows with traded volume: `b = α · ΣQ`, where `Q = seed +
  positions` includes a uniform phantom-share `seed` (so `b > 0` even before any
  trades). `α = sensitivity / (N · ln N)` from the Setup "Sensitivity (%)" control
  (the uniform-point overround/vig).
- **Pool / vault**: `C(Q; b)`; the initial `seed` is collateral-matched so the LS
  market also locks exactly `liquidity` at the uniform start.
- **Probability (display)**: `softmax(Q / b)` — the belief. The LS overround shows
  up as worse trader fills / profitability, not in the displayed probabilities.
- **Liquidity provision**: add/remove scales `seed` (deeper/shallower), floored so
  `seed > 0`. Every trade still moves the vault by exactly the net collateral.

## Features

### Setup Tab
- Configure market parameters: number of bins (16–1024+), value range, initial liquidity
- **LMSR variant** (left engine): plain LMSR or LS-LMSR, with an LS-LMSR sensitivity
  control (right engine is always L2-norm)
- Adjustable settlement kernel width (`W`) — applies to both engines
- Fee configuration: trade fees (bps), LP fee share (%), redemption fees (bps)
- Create multiple named traders with individual wallet balances

### Trading Tab
- **Distribution trades**: set a belief as a Gaussian (mu + confidence/sigma) and
  buy/sell across bins; each engine fills the same collateral with its own AMM
- **Discrete trades**: buy or sell individual bins directly
- **Sell All**: liquidate all positions for a trader
- Side-by-side probability charts (split or combined view) with Chart.js zoom/pan
- Real-time portfolio stats: holdings, expected payout, unrealized P&L
- Live trade preview driven by each engine's real (non-mutating) fill math

### Liquidity Tab
- Add/remove liquidity (LP shares)
- LP portfolio breakdown: share fraction, reserve value, fee earnings
- Per-outcome LP payout charts for both engines
- LP E[PnL] vs trader-count simulation, run independently on each AMM

### Resolve Tab
- Resolve the market at any value within the range
- Kernel visualization showing the triangular payout weights
- Payout analysis chart comparing trader returns across all possible outcomes
- Detailed payout tables: per-trader and per-LP results (gross, fees, P&L)
- Solvency factor and LP residual per engine

### General
- Dark/light theme toggle
- Configurable display: font size, number format (compact/long), decimal precision
- Save/load market state to localStorage (preserves positions, trades, LP, LMSR `b`)
- Toast notifications for actions and errors

## Tech Stack

- Vanilla HTML/CSS/JS — no build step, no framework
- [Chart.js](https://www.chartjs.org/) for all charts
- [Hammer.js](https://hammerjs.github.io/) + chartjs-plugin-zoom for chart pan/zoom
- Inter font (vendored)
- All dependencies are in `vendor/` — fully self-contained, works offline

## Running It

Serve the directory with any static HTTP server:

```bash
# Python
python3 -m http.server 8765

# Node
npx serve .

# PHP
php -S localhost:8765
```

Then open `http://localhost:8765` in a browser.
Open `test-engines.html` to run the engine unit tests in the browser.

## File Structure

```
comparison/
├── index.html              # Full UI (all tabs and controls)
├── engines/
│   ├── core.js             # Constants, globalTraders, shared math helpers, settlement mixin
│   ├── l2.js               # L2-norm (hypersphere) engine
│   ├── lmsr.js             # LMSR engine
│   └── dual.js             # DualMarket orchestrator (runs both engines side-by-side)
├── comparison.js           # UI glue only (theme, formatting, settings, init)
├── styles.css              # Theming (dark/light), layout, components
├── test-engines.html       # Standalone engine unit tests (LMSR + L2-norm + kernel)
├── LMSR_REFACTOR_PLAN.md   # Refactor plan / design decisions
├── vendor/                 # Chart.js, Hammer.js, zoom plugin, Inter font
└── TASKS.md                # Development task tracker
```

Scripts load in dependency order: `engines/core.js` → `l2.js` → `lmsr.js` →
`dual.js` → `comparison.js`. No build step — plain `<script>` tags.
