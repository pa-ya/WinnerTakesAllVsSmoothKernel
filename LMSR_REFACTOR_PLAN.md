# Comparison Refactor — L2-norm Kernel vs LMSR Kernel

> **Goal:** Repurpose the comparison playground to find which AMM maximizes
> **trader & LP profitability under the smooth-kernel settlement** the program now
> ships: **L2-norm smooth kernel** (kept) vs **LMSR smooth kernel** (new).
>
> WTA (the old "Current" quadratic engine) is **removed entirely** — engine, UI,
> formulas, tests, README. The smooth-kernel settlement / fee / LP logic is shared
> and identical across both engines; **only the AMM (pricing + trade mechanics)
> differs**: L2-norm hypersphere vs LMSR cost function.

---

## Locked design decisions (confirmed with user)

1. **LMSR depth from `liquidity` input:** `b = liquidity / ln(N)`.
   Worst-case MM loss is `b·ln(N)`, so the LMSR creator escrows exactly the same
   collateral as the L2-norm vault `k = liquidity`. Both markets start at uniform
   prices `1/N` and lock the same amount.

2. **LP model = "scale b with deposits".** Adding liquidity deepens the LMSR
   market (b ↑ → prices drift toward uniform); removing shallows it (b ↓ → prices
   drift out). LP shares / deposited / withdrawn / pro-rata fee + residual
   accounting stay **identical** to the L2-norm engine.

3. **Variants:** Phase 1 = plain LMSR (fixed-`b` curve, `b` only moved by LP ops).
   Phase 2 = market-creation toggle **LMSR vs LS-LMSR** (`b = α·Σqᵢ`).

---

## LMSR math (the core of Phase 1)

State per engine instance:
- `positions[i]` = aggregate net shares `qᵢ ≥ 0` (mirrors Σ of all trader holdings
  in bin i; LP ops do **not** change it).
- `b` = liquidity parameter.

**Cost function (log-sum-exp, stabilized with `m = max qᵢ`):**
```
C(q; b) = m + b · ln( Σ exp((qᵢ − m) / b) )
```

**Prices:** `pᵢ = exp((qᵢ−m)/b) / Σ exp((qⱼ−m)/b)` = softmax(q/b).

**Vault collateral = C(q; b).**
Proof: subsidy locked = C(0;b) = b·ln(N) = liquidity; traders have since paid
net `C(q)−C(0)`; vault = subsidy + net trade collateral = C(q). At q=0 this is
exactly `liquidity`. ✓

**b is well-posed under LP ops.** `dC/db = H(p) ≥ 0` (Shannon entropy of the price
distribution; from `C = Σpᵢqᵢ + b·H(p)`). So C is strictly increasing in b for any
fixed q ⇒ "find b such that C(q;b) = targetVault" is a monotone 1-D root-find
(bisection). Range: `C(q;b)→max qᵢ` as `b→0⁺`, `→∞` as `b→∞`.

**Trades:**
- **Buy** (collateral-driven): given net collateral `X` and a non-negative direction
  `d` (unit bin `e_i` for discrete; normalized Gaussian weights `w` for distribution),
  solve `C(q + s·d; b) − C(q; b) = X` for scalar `s ≥ 0` (monotone increasing in s ⇒
  bisection; upper bound by doubling). `tokensPerBin = s·dᵢ`.
- **Sell** (share-driven): shares to remove are known (tokenAmount, or
  `totalTokens·wᵢ` capped by holdings) ⇒ `grossOut = C(q;b) − C(q−Δ;b)` directly,
  **no root-find**.
- Fees: identical to L2-norm — buy fee taken from gross collateral (`net = gross−fee`),
  sell fee taken from `grossOut`; `lpFee = floor(fee·lpFeeSharePct/100)`.

**LP add(D):** `newShares = totalLpShares·D/C(q;b)`; set `b' = solveB(q, C(q;b)+D)`
(deepen). **LP remove(D):** cap to pro-rata share of `C(q;b)`; `collateralOut` +
`feeShare` pro-rata; set `b' = solveB(q, C(q;b)−collateralOut)` (shallow, floored so
new vault ≥ `max qᵢ`).

**Settlement (shared, unchanged from L2-norm):** triangular kernel
`K(i,w)=max(0,1−|i−w|/(W+1))` normalized to peak 1; `totalKernelClaim = Σ holdingsᵢ·Kᵢ`;
`claimScale = min(1, pool/totalKernelClaim)` where `pool = C(q;b)` for LMSR, `k` for
L2-norm; LP residual = `pool − scaledClaims`; redemption fees → LP pool.

---

## Shared-logic refactor (guarantees "same logic")

Introduce `this.getPool()` (L2: `return this.k`; LMSR: `return C(positions,b)`).
Replace every `this.k`-as-pool usage in the **settlement / portfolio / LP-read**
methods with `this.getPool()`, then share those methods across both engines via
prototype assignment so the kernel logic is provably identical:
`resolve`, `getSettlementKernel`, `getTraderPortfolio`, `getTraderPayoutPerOutcome`,
`getLpPortfolio`, `getAllLpPortfolio`, `sellAll`, `ensureTrader`, `getLabels`.

Engine-specific (NOT shared): `getProbabilities`, `getPool`, `discreteBuy/Sell`,
`distributionBuy/Sell`, `_computeWeights`, `addLiquidity`, `removeLiquidity`,
constructor, `getState/loadState`.

For L2-norm `getPool()` returns `this.k` ⇒ **zero behavioral change** to the kept
engine (regression-safe).

---

## Naming decision (read this before reviewing the diff)

Phase 1 keeps the DualMarket property names **`current` = LMSR engine** (UI left
column) and **`improved` = L2-norm engine** (UI right column). Rationale: ~182
`.current`/`.improved` property accesses live in a 4000-line `index.html` with **no
automated UI test coverage**; a mass rename there is where silent bugs hide.
Element IDs do **not** contain these words, so only labels + the engine behind the
`current` slot change in Phase 1. The clean rename `current→lmsr`, `improved→l2`
happens in **Phase 2** during the approved file-split, as one focused diff.

---

## Phase 1 — Replace WTA with LMSR smooth kernel

- [x] **1.1** Delete `CurrentMarket` (WTA). Rename `ImprovedMarket` class → `L2Market`
      (the kept L2-norm smooth-kernel engine).
- [x] **1.2** Add `getPool()` to `L2Market`; refactor settlement/portfolio/LP-read
      methods to use `getPool()`; extract them as shared prototype functions.
- [x] **1.3** Implement `LmsrMarket`: cost fn `C`, softmax probs, `getPool`,
      `solveB`, buy root-find, direct sells, distribution buy/sell, LP scale-b
      add/remove, `getState/loadState`. Reuse the shared settlement/portfolio code.
- [x] **1.4** `DualMarket`: `current = new LmsrMarket(...)`, `improved = new L2Market(...)`.
      Drop/replace `verifySync` (identical-positions no longer holds — repurpose it
      to report each engine's pool & price divergence instead of asserting sync).
- [x] **1.5** `index.html` labels/formulas: "Current (WTA/Quadratic)" → "LMSR",
      "Improved (Linear Kernel)" → "L2-norm"; update the formula banner, preview
      headers, LP/resolve table headers, legends. No structural/ID changes.
- [x] **1.6** Update `test-engines.html`: drop WTA-specific suites; keep L2-norm
      suites (now `L2Market`); add LMSR suites — cost-fn correctness, uniform start,
      vault=C(q), price=softmax, buy/sell collateral round-trip, monotone b solve,
      LP scale-b prob-drift direction, kernel settlement + claimScale, solvency
      (`pool ≥ scaledClaims`). All green before phase close.
- [x] **1.7** Update `README.md`: replace WTA description with LMSR; restate the
      "which AMM is better under the smooth kernel" goal.
- [x] **1.8** Run headless test harness — 0 failures. Report.

### Phase 1 post-review (fixes applied before Phase 2)

Full re-audit of the committed Phase 1 work. Findings + fixes:

- **BUG (LMSR LP preview NaN):** `computeLpAddPreview`/`computeLpRemovePreview` in
  `index.html` read `engine.k` inline — `undefined` on the LMSR engine, so the LMSR
  LP preview rendered NaN. Fixed by adding non-mutating engine methods
  `previewAddLiquidity` (shared mixin) + `previewRemoveLiquidity` (per-engine, LMSR
  one enforces the solvency floor) and delegating the UI to them. Preview now equals
  execution for both engines (new tests assert parity, incl. fees + floor).
- **BUG (chart border color):** 4 `colors.muted` references → `colors.textMuted`
  (`colors` has no `muted` key; break-even / reference lines drew with undefined color).
- **Label:** "New Vault (k)" → "New Vault" (LMSR has no `k`); field `newK` → `newPool`.
- **Verified numerically:** collateral conservation across a full mixed lifecycle
  (dist/discrete buy+sell, sellAll, LP add/remove, fees) — LMSR drift ~2e-7 (solver
  tol, rel. ~1e-12), L2 exact; resolve balances `pool+accLpFees == Σpayouts` to ~1e-11;
  `claimScale ≤ 1` (solvent) on both engines.
- **Tests:** 141 passed / 0 failed (was 125; +16 LP-preview-parity assertions).

## Phase 2 — LMSR vs LS-LMSR toggle + modularization

- [x] **2.1** Split `comparison.js` into `engines/*.js` (core/shared, l2, lmsr,
      dual) + UI-glue `comparison.js`, loaded via ordered `<script>` tags (no
      build step). Engine tests + browser load-order + inline-script compile all
      verified green (141 tests).
- [x] **2.2** Clean rename `current→lmsr`, `improved→l2` (DualMarket slot props,
      return keys, `*Wallet` fields, model-selector strings) across dual.js,
      comparison.js, index.html, test-engines.html. Preserved `currentTheme`,
      `currentSection`, `currentValue`, CSS class names (`panel-current`,
      `col-current`, …) and element IDs (non-functional). Verified: 141 tests,
      inline compile, full dual API smoke (lmsr/l2 keys, serialize roundtrip).
- [ ] **2.3** Add `LS-LMSR` (`b = α·Σqᵢ`, liquidity-sensitive) as an `LmsrMarket`
      mode; derive `α` so initial depth matches the fixed-b mapping at q→uniform.
- [ ] **2.4** Setup-tab control to pick LMSR vs LS-LMSR; thread through DualMarket
      init + serialize/load. Update tests.

## Phase 3 — Full review & debugging

- [ ] **3.1** Line-by-line math review of LMSR, LS-LMSR, and (re-assurance) L2-norm.
- [ ] **3.2** Cross-engine invariants: solvency (`pool ≥ scaledClaims` both engines,
      all resolve points), conservation (`pool = Σpayouts + residual + protocolFees`),
      no-arbitrage round-trips, LP prob-preservation (L2) / prob-drift (LMSR).
- [ ] **3.3** Full test sweep + manual UI pass; fix all findings.

---

## Math verification checklist (apply each phase)

1. LMSR start: q=0 ⇒ uniform `1/N`, vault = `liquidity`, `b = liquidity/ln N`.
2. Vault identity: `getPool() == C(q;b)` after every trade.
3. Buy/sell collateral conservation: buy cost = vault Δ; sell proceeds = −vault Δ.
4. `solveB` monotonicity: unique `b'` for any target ≥ `max qᵢ`.
5. Solvency: `totalKernelClaim·claimScale ≤ pool` (both engines, every win bin).
6. Conservation at resolution: `pool == Σ trader_payouts + lp_residual + redemption_fees`.
7. LP scale-b: add ⇒ entropy(prices) ↑ (toward uniform); remove ⇒ ↓.
8. L2-norm regression: kept engine numerically unchanged vs pre-refactor.
