# DekantPM Market Comparison Playground

**[Live Demo](https://pydea-rs.github.io/WinnerTakesAllVsSmoothKernel)**

An interactive browser-based playground for comparing two continuous prediction market AMM designs side-by-side: the **Current (Quadratic WTA)** model and the **Improved (Linear Kernel)** model.

Both engines share the same L2-norm AMM for trading but differ in how probabilities are displayed and how payouts work at resolution.

## Why This Exists

DekantPM's on-chain program uses a quadratic winner-takes-all (WTA) settlement model. This playground was built to explore an alternative: a kernel-based settlement where bins near the winning outcome receive partial payouts instead of all-or-nothing. The tool lets you run identical trading sequences against both engines and directly compare the economic consequences — trader P&L, LP returns, and payout distributions.

## The Two Engines

### Current — Quadratic WTA

- **Probability**: `p_i = x_i^2 / k^2` (quadratic, matching the on-chain L2-norm invariant)
- **Resolution**: Winner-takes-all — only tokens in the exact winning bin pay out 1:1
- Traders who are close but not exactly right get nothing

### Improved — Linear Kernel

- **Probability**: `p_i = x_i / sum(x_j)` (linear display)
- **Resolution**: Triangular kernel — bins within `W` steps of the winning bin receive partial payouts that decay linearly with distance
- A solvency `claimScale` factor ensures total claims never exceed the collateral pool (`claimScale = min(1, k / totalKernelClaim)`)
- Traders with nearby predictions still earn a return, incentivizing participation

## Features

### Setup Tab
- Configure market parameters: number of bins (16–1024+), value range, initial liquidity
- Adjustable kernel width (`W`) for the improved engine
- Fee configuration: trade fees (bps), LP fee share (%), redemption fees (bps)
- Create multiple named traders with individual wallet balances

### Trading Tab
- **Distribution trades**: Set a belief as a Gaussian (mu + confidence/sigma) and buy/sell across bins in proportion to that distribution
- **Discrete trades**: Buy or sell individual bins directly
- **Sell All**: Liquidate all positions for a trader
- Side-by-side probability charts (split or combined view) with Chart.js zoom/pan
- Real-time portfolio stats: holdings, expected payout, unrealized P&L
- Trade history log with per-trade details

### Liquidity Tab
- Add/remove liquidity (LP shares)
- LP portfolio breakdown: share fraction, reserve value, fee earnings
- Per-outcome LP payout charts for both engines

### Resolve Tab
- Resolve the market at any value within the range
- Kernel visualization showing the triangular payout weights (improved engine)
- Payout analysis chart comparing trader returns across all possible outcomes
- Detailed payout tables: per-trader and per-LP results with gross payout, fees, P&L
- Combined summary table merging trader and LP results

### General
- Dark/light theme toggle
- Configurable display: font size, number format (compact/long), decimal precision
- Save/load market state to localStorage (preserves all positions, trades, and LP state)
- Stats displayed as cards or inline text
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

## File Structure

```
comparison/
├── index.html          # Full UI (~4000 lines, all tabs and controls)
├── comparison.js       # Both market engines + DualMarket orchestrator
├── styles.css          # Theming (dark/light), layout, components
├── test-engines.html   # Standalone engine unit tests
├── vendor/             # Chart.js, Hammer.js, zoom plugin, Inter font
└── TASKS.md            # Development task tracker
```
