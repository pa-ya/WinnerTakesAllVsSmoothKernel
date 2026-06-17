# Sub-Bin Point Settlement — Analysis of the Stored-Trading-Point Idea

> Companion to `LMSR_LP_SUSTAINABILITY.md` (why LMSR drains LPs),
> `LMSR_KERNEL_ARBITRAGE.md` (the kernel over-payment), and
> `BIN_SCALING_SOLANA.md` (the bin-count limit). This doc analyses **your** idea:
> remember the *actual point* each trader aimed at, and at settlement scale their
> kernel payout by how close that point is to the **exact** resolved value — not
> merely which bin they landed in.
>
> **Scope.** The protocol's *live* on-chain settlement is the **L2-norm** smooth
> kernel (`dekant-sms`, `engine/kernel.rs` — `resolve` stores a `scaling_factor`,
> `claim_payout` pays a kernel-weighted scaled sum). This doc concerns the **LMSR**
> smooth-kernel variant — the research track you want to develop — because (as you
> noted) the point-factor helps LMSR's over-payment problem, not L2-norm. Everything
> here is settlement-layer design for that LMSR build, not a change to what is deployed.
>
> Every P&L figure below is **computed** by replaying the saved sample story
> (`specs/profitability/market-story-lmsr-vs-l2-64bins.md`) through the real engines
> with the proposed settlement (`/tmp/point-sim.js`); the replay reproduces the
> published baseline exactly (pool 276,000, solvency 35.87%, grosses A 96,049.46 /
> B 32,876.71 / X 147,073.83), so the deltas are trustworthy. No AI in the numbers.

---

## 0. TL;DR

- **The idea works, and well.** On the sample path it takes LP P&L from
  **−120,000 (−100%)** to **−4,566 (−3.8%)** while *raising* the payout of the one
  trader who actually aimed at the truth (A: **+61k → +126k**) and zeroing the two
  who didn't (B, X). Solvency 35.87% → **100%**. It is simultaneously a
  **profitability rebalancer** and an **accuracy/incentive upgrade**.
- **It is not "trader → LP".** It is **wrong-trader → {right-trader + LP}**. Value is
  taken from those whose *point* missed and redistributed to the accurate trader and
  the LPs. That is arguably the *most correct* prediction-market outcome.
- **It does fix the bin limit** (`BIN_SCALING_SOLANA.md` §3.3): discrimination becomes
  **continuous in the stored point**, i.e. sub-bin, so a coarser grid suffices.
- **Storage fidelity is everything.** Your two options are not equivalent:
  - **Per-position points** (each trade's `μ`): accurate, but the hard one on Solana.
  - **Running weighted-average point**: cheap & on-chain-native (16 bytes, O(1)), but
    **structurally fooled by traders who reposition** — on the sample it *wipes out
    A*, the best predictor, because A's late high-conviction bet (μ=53.9) is averaged
    against earlier exploratory bets (μ=50, 79.9) into a point (59.66) outside the
    payout reach.
  - A *free* alternative — the holdings **center-of-mass** (no extra storage at all) —
    is **also fooled** (B's two opposite bets cancel to 53.5 and would over-pay a
    trader who never bet near 53).
- **Recommendation:** ship the per-position version via the **backend-proxy +
  two-signature resolve** you proposed, but make it **verifiable** (commit a Merkle
  root of points on-chain) so the backend cannot forge factors. Use the running
  average only as a fallback, guarded by a variance check.

---

## 1. The idea, restated precisely

### 1.1 The mechanism

Current smooth-kernel settlement pays a trader, at resolved bin `w`:

```
claim_u = Σ_i  holdings_u[i] · K(i, w)          (K = triangular kernel, width W)
payout_u = claim_u · claimScale                 (claimScale = min(1, pool / Σ claim))
```

The kernel `K(i,w)` only knows **which bin** `i` a token sits in. It cannot tell a
trader who aimed dead-on (point = resolved value) from one whose tokens merely *bleed*
into the winning region from a wide, badly-centred bet. Your idea adds a second,
**continuous** factor per trader (or per position):

```
f_u = PointKernel(point_u , resolvedValue)      ∈ (0, 1]
payout_u = claim_u · f_u · claimScale'          claimScale' = min(1, pool / Σ claim·f)
LP_residual = pool − Σ payout_u                 (everything not paid stays with LPs)
```

where `point_u` is the trader's aimed value. `PointKernel` peaks at 1 when the point
equals the *exact* resolved value and decays with distance. I use the **same
triangular shape as the settlement kernel**, measured in continuous bin-distance and
centred on the *fractional* resolved bin (here 53 → bin 33.92, not integer 33):

```
f = max(0, 1 − |pointBin − resolvedFracBin| / reach)
```

`reach` (in bins) is the one new parameter. `reach = W+1` matches the settlement
kernel's own reach; larger `reach` is gentler. (A Gaussian decay works too; the shape
is a tuning choice, the principle is the same.)

This factor is applied **only inside the kernel's payout window** — bins outside it
already pay zero, exactly as you noted. The clawed-back remainder is not burned; it
falls to `LP_residual`.

### 1.2 The two ways to store the point (yours), plus a free one

| Fidelity | What's stored | Extra state | Update cost | Accurate? |
| --- | --- | --- | --- | --- |
| **Per-position** | every trade's `μ` (+ its size) | O(#trades) | O(1)/trade | ✅ exact |
| **Running average** | `Σμ·amt`, `Σamt` → one weighted mean | **16 bytes** (`i64 + u64`) | O(1)/trade | ❌ fooled by repositioning |
| **Center-of-mass** (free) | nothing — derive from `holdings[]` at claim | **0 bytes** | — | ❌ fooled by bimodal bets |

The **center-of-mass** is worth naming because it costs *nothing*: `point_u =
Σ_i center_i·holdings_u[i] / Σ_i holdings_u[i]` is computable at claim time from state
that already exists. But, like the running average, it is an *average* — and §3 shows
averages misrepresent any trader who didn't bet as a single blob.

### 1.3 Why the point adds information the kernel doesn't have

The kernel knows token *locations* (bin granularity). The stored `μ` of a distribution
buy is the trader's **continuous aim** — information the bin discretisation throws
away. Two facts follow:

1. **Sub-bin precision.** Two traders both holding bin-33 tokens, one having aimed at
   53.0 and one at 51.6, are indistinguishable to the kernel but separable by `μ`.
   That is the bin-limit fix.
2. **Anti-spray.** A trader who sprays a wide Gaussian *far* from the truth still
   collects kernel payout via tail overlap with the winning bin (in the sample,
   X aimed at 35.9 yet collected **147,074**). The point-factor checks *where they
   aimed* and removes that windfall.

> Note: the continuous point only exists for **distribution buys** (which carry `μ`).
> A single-bin buy carries only its bin centre, so it gets bin-granular discrimination
> only — no sub-bin gain, but no harm either.

---

## 2. What changes vs. normal smooth-kernel LMSR

| Aspect | Normal kernel LMSR | + Point settlement |
| --- | --- | --- |
| Payout depends on | token bin locations | bin locations **× aimed point** |
| Resolution | bin width | **continuous** (sub-bin) |
| Wide far-spray bet | paid via tail overlap | **clawed back** (f→0) |
| LP residual | whatever the kernel leaks | **+ all clawed-back claims** |
| Rewards | outcome coverage | **point accuracy / conviction** |
| New parameter | — | `reach` (point-kernel width) |

Mechanically the factor is a *second* multiplicative discount that is **correlated**
with the kernel (a far `μ` already has low kernel overlap). That correlation is not a
bug — it is the clawback. It does mean the factor is **both** a sub-bin accuracy tool
**and** a value-transfer-to-LP lever; `reach` controls how aggressive.

---

## 3. Simulated effect on the sample story (the meat)

Setup: N=64, range [0,100] (bin width 1.5625), W=3, liquidity 100,000, all fees 0,
resolved at **53** (bin 33, fractional 33.92). Actors: A (4 buys, ending with a tight
μ=53.9 conviction bet), B (μ=79.9 then μ=35.9, + LP 20k), X (μ=35.9 ×100k, μ=78.8 ×1k).

### 3.0 Baseline (current model) — for reference

| | A | B (trader) | X | **Traders** | **LPs** | Solvency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Net P&L | +61,049 | +12,877 | +46,074 | **+120,000** | **−120,000** | 35.87% |

LPs lose everything; even X — who aimed at 35.9, far from 53 — walks away **+46,074**.

### 3.1 Per-position points, `reach = W+1 = 4` bins (±6.25 value) — the headline

| | A | B (trader) | X | **Traders** | **LPs** | Solvency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Net P&L | **+125,566** | −20,000 | −101,000 | **+4,566** | **−4,566** | **100%** |

Per-trade factors (why):

| Trade | claim | f (point) | paid |
| --- | ---: | ---: | ---: |
| A μ=50 (×5k) | 32,027 | 0.520 | 16,654 |
| A μ=50 (×10k) | 60,312 | 0.520 | 31,362 |
| A μ=79.9 (×10k) | 43,958 | 0.000 | 0 |
| A **μ=53.9** (×10k) | 131,484 | **0.856** | **112,550** |
| B μ=79.9 (×10k) | 34,877 | 0.000 | 0 |
| B μ=35.9 (×10k) | 56,782 | 0.000 | 0 |
| X μ=35.9 (×100k) | 403,108 | 0.000 | 0 |
| X μ=78.8 (×1k) | 6,926 | 0.000 | 0 |

**Reading it.** The mechanism finds the one accurate aim — A's late μ=53.9 — and pays
it almost in full, while B's and X's far bets collapse to zero. Because total scaled
claims now fit the pool, `claimScale` returns to **100%**, so A is paid *more than the
baseline* (no longer diluted by B/X), LPs are nearly whole, and the two traders who
were directionally wrong correctly take losses. **Value moved from wrong traders to
{the right trader + LPs}, not bluntly from traders to LPs.**

### 3.2 The running-average point — the flaw, quantified

Same factor, but each trader collapsed to one collateral-weighted mean point first:

| Trader | avg point | f | payout | P&L |
| --- | ---: | ---: | ---: | ---: |
| A | 59.66 | **0.000** | 0 | **−35,000** |
| B | 57.90 | 0.216 | 19,798 | −202 |
| X | 36.32 | 0.000 | 0 | −101,000 |

Traders **−136,202** / LPs **+136,202** — a wild *over-correction*. A, the best
predictor, is **wiped out**: averaging A's exploratory μ=50/79.9 bets against the
sharp μ=53.9 conviction bet yields 59.66, *past* the payout reach. **The average
cannot represent a trader who repositions** — and repositioning toward the truth as a
market matures is exactly what good traders do. This is the decisive argument against
the cheap on-chain storage as a *standalone* solution.

### 3.3 The free center-of-mass — also fooled, differently

| Trader | center-of-mass | f |
| --- | ---: | ---: |
| A | 55.73 | 0.563 |
| B | **53.50** | **0.920** |
| X | 39.62 | 0.000 |

Here **B** scores f=0.92 — nearly maximal — because B's two opposite bets (79.9 and
35.9) cancel to a centre of mass *near* the truth, even though **B never placed a bet
near 53**. A token-weighted average rewards an accidental cancellation. (Note it even
*disagrees* with the collateral-weighted running average, which gave B f=0.216 — two
"averages," two different wrong answers. Only per-position is robust.)

### 3.4 `reach` sensitivity, and a clean cross-check

| Settlement | Traders P&L | LPs P&L | Solvency |
| --- | ---: | ---: | ---: |
| Baseline (no point factor) | +120,000 | −120,000 | 35.87% |
| Per-position, reach 4 (±6.25) | +4,566 | −4,566 | 100% |
| Per-position, reach 8 (±12.5) | +36,194 | **−36,194** | 100% |
| Average, reach 4 | −136,202 | +136,202 | 100% |
| Average, reach 8 | +24,897 | −24,897 | 100% |

`reach` is a genuine LP↔trader dial: tighter → more clawback → more LP protection.
Notably, **per-position at reach 8 lands LPs at −36,194 — essentially identical to the
−36,369 "honest adverse-selection cost"** that the normalized-kernel fix produced in
`LMSR_LP_SUSTAINABILITY.md` (§2–§3). Two independent mechanisms converge on the same
number: the part of the LP loss that is *legitimate information cost* (which should be
paid), versus the structural over-payment leak (which this removes). That convergence
is strong evidence the model is doing the economically right thing.

---

## 4. Pros

1. **Restores LP sustainability** without touching kernel width — your stated goal.
   LP −120k → −4.5k (reach 4) or −36k (reach 8), tunable.
2. **Sub-bin resolution → eases the bin limit** (`BIN_SCALING_SOLANA.md` §3.3): fewer
   bins needed for the same payoff sharpness; finer effective granularity on wide
   ranges.
3. **Better incentives.** Rewards *point accuracy and conviction*; defunds *spray*.
   A market that pays for being right (not for being wide) is better-calibrated.
4. **Keeps the right trader whole — even improves them.** Unlike a blunt fee or vig,
   accurate traders are *not* taxed; they gain (claimScale recovers).
5. **Conserves value exactly.** Clawed-back claims become LP residual; nothing is
   minted or burned. Solvency is automatic (claimScale ≤ 1 still applies).
6. **Composable** with the normalized-kernel fix and out-of-pool fees from the
   sustainability doc; orthogonal levers.

## 5. Cons / new problems

1. **Storage/compute of per-position points is the hard part on Solana.** O(#trades)
   per-trade points don't fit a fixed account; this is what forces the backend-proxy
   design (§7). The cheap on-chain average is **not** an acceptable substitute on its
   own (§3.2).
2. **Averages misrepresent repositioning and bimodal traders** (§3.2–3.3). Any
   single-number-per-user scheme is structurally exposed.
3. **It is also a value-transfer lever, not just an accuracy refinement.** The factor
   double-discounts far bets (correlated with the kernel). Set `reach` too tight and
   you under-pay genuinely-correct-but-uncertain traders; the average variant at
   reach 4 over-corrected to LP +136k. `reach` must be chosen deliberately and made a
   public, fixed parameter.
4. **Penalises honest uncertainty.** A trader who is correctly *unsure* (wide σ
   centred on the truth) keeps f≈1 (centre is right) — good — but a trader who hedges
   across two scenarios is penalised on the losing leg. That is intended, but it is a
   behavioural change traders must understand.
5. **Backend-proxy centralisation/trust** (the per-position fallback): if the backend
   computes factors, it can mis-pay. The two-signature (oracle + superadmin) resolve
   stops a *rogue oracle*, but not a *rogue/buggy backend*. Needs verifiability (§7).
6. **Only distribution buys carry a continuous point.** Single-bin buys get
   bin-granular treatment only (no harm, but no sub-bin benefit). Mixed books are fine
   but the benefit is uneven.
7. **More moving parts at settlement** → more surface for bugs; must be covered by the
   same conservation/solvency invariants the current resolve enforces.

## 6. Effect on market state, trader & LP profitability (side-by-side)

| Dimension | Normal kernel LMSR | + Per-position point settlement |
| --- | --- | --- |
| **Displayed prices / belief** | unchanged during trading | **unchanged** (factor applies only at settlement) |
| **Pool / vault path** | unchanged | **unchanged** (no change to trade pricing) |
| **Trader profitability** | generous to *all* near-ish bettors incl. spray | concentrated on the *accurate*; spray defunded |
| **LP profitability** | structurally drained (−100% here) | near-whole, dialled by `reach` (−3.8% to −30%) |
| **Solvency factor** | often < 100% (35.87% here) | → 100% (claims shrink to fit pool) |
| **Calibration/incentive** | pays outcome coverage | pays point accuracy |
| **Resolution** | bin width | sub-bin (continuous) |

Crucially, the point-factor is a **settlement-only** change: trading, pricing, the AMM
curve, displayed probabilities, and the pool path are all **byte-identical** to today
up to the moment of resolution. It cannot be arbitraged during trading because it does
not exist during trading.

## 7. Implementing it on Solana

**(a) Running average — fully on-chain, cheap, but only a fallback.** Add `i64
point_sum_weighted` and `u64 point_weight` to `UserPosition` (16 bytes, O(1) update on
each distribution buy: `sum += μ·amount; weight += amount`). At claim, `point =
sum/weight`, compute `f`, scale payout. **Use only with the variance guard below.**

**(b) Per-position — the accurate version, via your backend-proxy + 2-sig resolve.**
- Backend indexes every distribution buy's `(position, μ, size)` (it already indexes
  trades).
- At resolution the oracle submits the value to the backend; the backend computes each
  position's per-trade factors and the resulting payouts; resolution is a
  **two-signature** instruction (oracle **and** protocol superadmin) so an oracle
  cannot self-resolve with forged factors. *(Your design — sound as far as it goes.)*
- **Make it trustless, not just two-of-two:** have the backend commit a **Merkle root
  of `(position → point)`** on-chain *before* resolution (or incrementally as trades
  arrive). At claim, the user (or backend) supplies the point + Merkle proof; the
  on-chain program verifies the proof against the committed root and computes `f`
  itself. Now neither oracle nor backend can fabricate a point; the chain enforces
  conservation (`Σ payouts ≤ pool`) as it already does. This removes the
  centralisation con (§5.5) at the cost of proof plumbing — the same trade-off as the
  account-compression option in `BIN_SCALING_SOLANA.md` §4.5, and a natural fit if
  that path is taken anyway.

**(c) My suggested refinements**
- **Variance guard for the average.** Also track the second moment (`Σμ²·amt`, one
  more `u128`). If the point variance is high (the trader repositioned), the single
  mean is untrustworthy → fall back to pure kernel (f=1) for that trader rather than
  wrongly zeroing them (this would have saved A in §3.2). Cheap insurance for the
  on-chain-only mode.
- **Bounded per-position (top-K).** Store the K largest-by-size trade points on-chain
  in a fixed `[K]` array (e.g. K=4–8), folding the rest into the running average. Most
  of the weight, most of the accuracy, fixed storage — a middle path between (a) and
  (b).
- **`reach` as governance.** Treat the point-kernel reach like the kernel width: a
  protocol-config parameter, fixed per market at creation, public.
- **Free v1.** If you want a zero-storage pilot, ship the center-of-mass (§1.2) behind
  a flag to validate the settlement plumbing — but know it shares the averaging flaw
  and is not the destination.

## 8. Improvements & open questions

- **Shape of the point-kernel.** Triangular (used here) vs Gaussian vs a sharper
  power — affects how steeply accuracy is rewarded. Worth a parameter sweep on more
  stories, not just this one.
- **Should `f` see σ as well as μ?** Currently only the centre matters; spread is
  already handled by the kernel. A σ-aware factor could reward *calibrated* uncertainty
  (wide-but-right) differently from false confidence — an open design question.
- **Interaction with sells / repositioning credits.** When a trader sells part of a
  position, how should the stored point(s) update? (Per-position: drop the sold lots.
  Average: ambiguous — another reason per-position is cleaner.)
- **Generalisation.** This is, in effect, a *parimutuel-flavoured* refinement layered
  on LMSR pricing: LMSR sets prices during trading; the point-factor makes the
  *payout* closer to "closest aim wins," like a continuous closest-to-the-pin pool.
  That hybrid (LMSR price discovery + accuracy-weighted payout) is itself a novel,
  defensible design worth writing up on its own.

## 9. Recommendation

1. **Adopt the per-position version**, delivered through your **backend-proxy +
   two-signature resolve**, but upgrade it to **Merkle-committed points** so the chain
   verifies factors and no operator can mis-pay (§7b). This is the accurate, sustainable
   target.
2. **Set `reach` deliberately.** On this sample, `reach = W+1` nearly zeroes LP loss;
   `reach = 2(W+1)` leaves LPs paying only the honest information cost (≈ the
   normalized-kernel number). Start near `2(W+1)` (pay legitimate info cost, claw back
   only the structural leak) and tune on more histories.
3. **Do not ship the running average alone.** If an on-chain-only mode is required for
   v1, gate it behind the **variance guard** (§7c) or use **top-K** points — never a
   bare single mean, which §3.2 shows can wipe the best trader.
4. **Layer, don't replace.** This composes with the normalized-kernel fix and
   out-of-pool fees in `LMSR_LP_SUSTAINABILITY.md`; together they give LPs a durable
   book while keeping accurate traders profitable — the balance you were after.

---

_All P&L computed by `/tmp/point-sim.js` replaying the saved sample story through the
real `comparison/engines` (baseline reproduced exactly). Figures are deterministic, not
estimated — no AI/LLM in the numbers._
