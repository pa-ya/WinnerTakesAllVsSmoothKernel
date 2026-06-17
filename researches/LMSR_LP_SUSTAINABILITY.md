# Making LMSR Sustainable for LPs (and the L2-norm Trader-Profit Alternative)

> **What this document is.** A careful, computed answer to the question raised by
> [`market-story-lmsr-vs-l2-64bins.md`](../specs/profitability/market-story-lmsr-vs-l2-64bins.md):
> under the shared smooth-kernel settlement, **LMSR pays traders generously but
> drains LPs to zero**, while **L2-norm protects LPs but leaves traders losing**.
> We ask: *what can make LMSR reasonable for LPs* (the preferred goal), and — if
> that fails — *what can make L2-norm more profitable for traders.* It surveys the
> worldwide design space and tests the implementable fixes by **replaying the exact
> sample-story action sequence through the playground engines** (no estimates).
>
> **Companion to** [`LMSR_KERNEL_ARBITRAGE.md`](LMSR_KERNEL_ARBITRAGE.md), which
> proves the *complete-set* arbitrage. This document covers the broader, everyday
> LP-drain on *concentrated, informed* trades (the sample) and the full menu of
> remedies.
>
> **Constraint honoured throughout:** the **kernel width `W = 3` is held constant**
> (winner + 3 neighbours each side). "Normalizing the kernel" below rescales only
> the *payout magnitude* (so a complete set pays 1 instead of `1 + W`); it does
> **not** change `W` or which bins pay.

---

## 0. TL;DR — the answer, ranked

**Yes, LMSR can be made reasonable for LPs.** No single knob does it; the drain has
two distinct components and you must address both:

1. **Normalize the settlement kernel so `Σ K = 1`** (a complete set pays exactly 1,
   not `1 + W`). This is the single highest-impact fix. On the sample path it cuts
   LMSR LP loss from **−120,000 → −36,369** and restores solvency from **36% →
   100%**. It removes the structural *over-payment leak*; what remains is the honest
   adverse-selection cost.
2. **Add an out-of-pool fee that LPs keep — a redemption (settlement) fee, and/or a
   trade fee booked to a separate LP account.** These are the only fees that help
   against a *drain*, because they divert value **outside** the pool the winners
   empty. A redemption fee recovers ≈ **2,760 per 1%** on the sample path.
3. **Optionally add an LS-LMSR overround for noise/round-trip flow** — but know its
   limit: on a *directional, informed* path the vig is collected **into** the pool
   and is then reclaimed by the winners, so on the sample it changed LP P&L by **0**
   even at a +300% overround. It is a complement, not the cure.

**The single most important mechanism insight** (§3): to protect LPs you must either
**reduce what winners can claim** (normalize the kernel; or issue fewer tokens) or
**divert value to an account outside the claimable pool** (redemption/trade fees).
**Inflating the pool itself (the LS-LMSR vig) does not help a full drain.**

If instead you keep **L2-norm** and want to **help traders** (§5): generalize the
hypersphere to an **`Lp`-norm AMM** and tune `p` just above the arbitrage-safety
threshold `p* = 1.5` (for `N = 64, W = 3`). At `p ≈ 1.6` the complete-set price is
`4.76 > 1 + W = 4` (still arb-safe) while traders receive **≈ 1.7× more tokens** per
unit collateral than today's `p = 2`. This is a real lever, but it is strictly
inferior to fixing LMSR for a protocol that wants sustainable LPs *and* fair traders.

---

## 1. The sample, restated in one table

`N = 64`, range `[0, 100]`, `W = 3`, initial liquidity `100,000`, **all fees `0`**,
resolved at `53` (bin 33). Traders made **concentrated, informed** Gaussian buys
(σ ≈ 4–34, *not* the diffuse complete-set case of the arbitrage doc), and the
outcome landed in the region they had populated.

| Aggregate (computed) | LMSR | L2-norm |
| :--- | ---: | ---: |
| Total trader net P&L | **+120,000** | −28,137 |
| Total LP net P&L | **−120,000** | +28,137 |
| Solvency factor at resolve | **35.87%** | 100.00% |
| Total trader tokens issued | 7,596,609 | 1,175,992 |

The LMSR LPs lost **exactly their entire deposit** (Creator 100,000 + B 20,000).
That is not a coincidence — it is the signature of a *full drain* (see §2.3).

---

## 2. Diagnosis — why LMSR drains the LPs

### 2.1 LMSR LPs are unpaid market makers; their max loss is `b · ln N`

Plain LMSR sets `b = liquidity / ln N`, so the market maker's textbook worst-case
loss is

```
max MM loss  =  b · ln N  =  liquidity  =  100,000
```

That loss is *realised in full* precisely when traders move the market to the true
outcome — i.e. when they are **collectively informed**. With **zero fees**, the
LMSR LP is a counterparty who subsidises price discovery and is paid **nothing** for
it. The −120,000 in the sample is that subsidy being collected by informed traders.
This is standard LMSR theory, not a bug: real venues always compensate the maker
with fees or a spread (Augur, Gnosis CTF, LS-LMSR's vig). A 0-fee LMSR LP is
*designed* to lose up to `b · ln N` to informed flow.

### 2.2 The smooth kernel lets traders drain *more than* `b · ln N`

Here is the part specific to this protocol. The triangular kernel pays a complete
set `Σ K = 1 + W = 4`, but LMSR prices trades as if a complete set is worth `1`
(see [`LMSR_KERNEL_ARBITRAGE.md`](LMSR_KERNEL_ARBITRAGE.md) §3–4). Every token LMSR
issues is therefore *under-priced relative to what the kernel will pay for it*. The
consequence: traders can extract **beyond** the `b · ln N` bound.

We can measure the split exactly by re-running the sample with the kernel
**normalized** (`Σ K = 1`, `W` unchanged):

| Kernel | LMSR LP P&L | Solvency | Within `b·ln N = 100k` bound? |
| :--- | ---: | ---: | :--- |
| Current (`Σ K = 1 + W = 4`) | **−120,000** | 36% | ❌ drained 120k > 100k |
| Normalized (`Σ K = 1`) | **−36,369** | 100% | ✅ 36k < 100k |

> **The −120,000 decomposes into ≈ 83,631 of kernel over-payment leak + ≈ 36,369 of
> honest adverse selection.** Normalizing the kernel removes the leak, restores the
> `b · ln N` bound, and brings the market back to full solvency (no claim scaling).
> The residual −36,369 is the *legitimate* LMSR subsidy cost — the thing fees exist
> to offset.

(Note the same normalization is *bad* for the current L2-norm engine — it makes L2
traders lose −124,034 because L2 already over-prices and now payouts are 4× smaller.
Normalization is the right move **only if paired with LMSR or a lower-`p` AMM**; see
§5.)

### 2.3 Why "full drain" pins LP loss to exactly the deposit

Settlement caps total payout at the pool via `claimScale = min(1, pool / Σ claims)`.
When informed traders' kernel-weighted claims exceed the pool (here `claims/pool ≈
2.8`, so `claimScale = 36%`), the winners are scaled down to take **the entire
pool**, and the LP residual is **0** — i.e. the LP loses 100% of principal. This is
why no amount of *pool-inflating* compensation helps once you are in the drained
regime: the bigger you make the pool, the bigger the amount the winners walk away
with. This single fact drives the whole remedy analysis in §3.

---

## 3. The unifying principle (verified): three places value can go

Every remedy moves value to one of three destinations. Only two of them protect LPs.

| Mechanism | Where the value lands | Helps a drain? | Sample effect |
| :--- | :--- | :---: | :--- |
| **Reduce claims** (normalize kernel; issue fewer tokens via higher complete-set price) | winners simply claim less | ✅ **yes** | LP −120k → −36k |
| **Out-of-pool fee** (redemption fee; trade fee → separate LP account) | a vault LPs keep, *not* claimable | ✅ **yes** | +2,760 per 1% redemption |
| **In-pool vig** (LS-LMSR overround; bigger `b`) | the pool the winners empty | ❌ **no** | LP unchanged at −120k |

This is the crux and it is counter-intuitive: **the famous "liquidity-sensitive
vig" (LS-LMSR) does nothing for LPs on a directional informed drain**, because the
overround it charges is added to the same vault the winning traders then claim. We
verified this by replaying the sample under LS-LMSR at escalating overrounds:

```
LS-LMSR overround +30%   →  LP −120,000   (solvency 46%)
LS-LMSR overround +100%  →  LP −120,000   (solvency 46%)
LS-LMSR overround +300%  →  LP −120,000   (solvency 46%)
```

The vig raised `claimScale` from 36% to 46% (claims/pool fell from ~2.8 to ~2.2) but
never crossed below 1, so the residual stayed 0. The vig *does* help against **noise
/ round-trip churn** and it raises the complete-set price (mitigating the §1
arbitrage of the companion doc) — but it is not a defence against being right.

---

## 4. The remedy menu — making LMSR reasonable for LPs

### 4.1 Normalize the kernel (`Σ K = 1`) — **primary fix** *(settlement-side)*

Replace the peak-normalized kernel with the L1-normalized one:

```
K'(i, w) = K(i, w) / (1 + W)          # Σ_i K'(i, w) = 1; W and shape unchanged
```

- **Effect (measured):** LMSR LP −120,000 → −36,369; solvency 36% → 100%; the
  `b · ln N` loss bound is restored.
- **Removes** the complete-set arbitrage entirely (a set now costs 1 and pays 1).
- **Keeps `W` constant** — same winner + 3-neighbour shape, only the absolute payout
  scale shrinks by `1/(1+W)`. Relative near-miss rewards are identical.
- **Cost:** absolute trader payouts shrink 4×. If the kernel's intent was genuinely
  to *over-reward* near-misses, that intent is what creates the leak; you cannot have
  both "over-pay near-misses" and "LP-safe LMSR" without pricing the over-payment in
  (§4.3). For a market whose job is calibrated probabilities, `Σ K = 1` is the
  principled choice.

This is the same recommendation as `LMSR_KERNEL_ARBITRAGE.md` §12, now quantified on
a realistic informed path rather than the diffuse extreme.

### 4.2 Out-of-pool fees that LPs keep — **the essential complement** *(AMM-side)*

After normalization, LPs still bear the honest −36,369 adverse-selection cost. Fees
are how every real venue pays the maker for that. **But only fees that sit outside
the claimable pool work against a drain:**

**Redemption (settlement) fee** — a percentage skimmed off gross payouts at resolve
and credited to the LP pool. Most direct, because it taxes exactly the outflow:

```
redemption  0%  → LP −120,000
redemption 10%  → LP  −92,400
redemption 20%  → LP  −64,800
redemption 30%  → LP  −37,200
redemption 40%  → LP   −9,600
redemption 50%  → LP  +18,000      # break-even ≈ 43.5% on this path
```

Recovery ≈ **2,760 per 1%**, linear. A 43% standalone fee is impractical, but
**combined with kernel normalization** a *modest* redemption fee (say 5–10%) turns
the residual −36k into roughly break-even.

**Trade fee booked to a separate LP account** (`accumulatedLpFees`, not the vault) —
helps, but is volume-based and small here (≈ 1,560 per 1% of trade fee), because the
drain is far larger than the traded volume. Useful as steady yield, not as drain
insurance.

> Real-world anchor: Polymarket's 2025 fee overhaul funds a **maker-rebate program**
> paid to liquidity providers — fees routed *to* LPs, held *outside* the settlement
> pool. ([crypto.news](https://crypto.news/polymarket-rolls-out-clob-v2-with-1m-liquidity-rewards-to-harden-prediction-markets/),
> [Polymarket docs](https://docs.polymarket.com/market-makers/liquidity-rewards))

### 4.3 LS-LMSR / Othman–Sandholm "profit-charging" maker — *useful, but not the cure here*

Othman, Pennock, Sandholm & Reeves' **liquidity-sensitive LMSR** sets `b(q) = α · Σ
q_i`, which makes prices sum to an **overround** `1 + α · n · ln n > 1`. They prove
the maker has **bounded loss for any initial liquidity** and can define a region of
final states inside which it **books a profit regardless of outcome**
([Othman–Sandholm, EC'10 / TEAC](https://www.cs.cmu.edu/~sandholm/liquidity-sensitive%20automated%20market%20maker.teac.pdf)).
The playground's `lslmsr` mode implements exactly this (`α = sensitivity / (n ln n)`,
so the uniform overround = `1 + sensitivity`).

Why it is *not sufficient* for our problem:

- Its profit guarantee is over the **whole price simplex** against *uninformed /
  bounded* movement. A trader who concentrates on the *eventual winner* moves the
  market **out** of the profit region — that is adverse selection, which LS-LMSR
  bounds but does not eliminate.
- Critically, its vig lands **in the pool** (§3), so on a full drain it is recycled
  to the winners — measured LP impact **0** on the sample.

Where it *does* earn its keep: pricing the complete-set arb (raising `P_set` above
1), and harvesting noise/round-trip flow into the maker's favour over time. Treat it
as a **complement** to §4.1 + §4.2, not a substitute. Note also that **no major
consumer venue shipped LS-LMSR as its primary mechanism** in 2025–26; production
LMSR mostly survives in the Gnosis CTF contracts.

### 4.4 pm-AMM (Paradigm, 2024) — *dynamic liquidity, different failure mode*

Paradigm's **pm-AMM** targets a *uniform* loss-versus-rebalancing (LVR) rate using a
Gaussian-score invariant `(y−x)Φ(z) + Lϕ(z) − y = 0` with `z = (y−x)/L`, and its
**dynamic** variant shrinks liquidity toward expiry (`L_t = L₀√(T−t)`) so the
expected loss rate is constant in time
([Paradigm, *pm-AMM*](https://www.paradigm.xyz/2024/11/pm-amm)). The transferable
idea for us is **time-decaying depth**: most of the LP drain happens late, when
informed traders have the sharpest edge; reducing `b` (or the L2 `k`) as resolution
approaches caps late-stage adverse selection. The pm-AMM itself is built for
binary/2-token outcomes and a GBM-style score model, so it is an inspiration for a
*depth schedule*, not a drop-in for an `N`-bin scalar market. It also explicitly
accepts that LPs lose ≈ half their capital by maturity — it *smooths* LP loss, it
does not remove it.

### 4.5 Dynamic parimutuel (Pennock) — *zero LP risk, by construction*

A **dynamic pari-mutuel market** offers infinite buy-in liquidity with **zero risk
to the market institution**: there is no LP counterparty at all — the pool is the
traders' own money, redistributed to winners
([Pennock, EC'04](http://db.cs.duke.edu/courses/spring07/cps296.3/pennock-ec-2004-dynamic-parimutuel.pdf)).
If the protocol's real objective is "LPs must never be drained," the cleanest answer
is to **not have LPs bear settlement risk** — make the seed a bounded, fixed subsidy
and let traders fund each other. Trade-offs: no LP yield product, weaker
two-sided/exit liquidity, and a different pricing feel. Worth a serious look if LP
protection is paramount and an LP *yield* business is not the point.

### 4.6 Order book / hybrid (Polymarket) and capped exposure — *move or bound the risk*

- **CLOB / hybrid:** Polymarket abandoned its AMM for an off-chain **CLOB** with
  on-chain settlement, pushing inventory risk onto *active, informed* market makers
  who price adverse selection themselves
  ([Interexy](https://interexy.com/amm-vs-order-book-prediction-market),
  [KuCoin](https://www.kucoin.com/blog/en-the-prediction-market-playbook-uncovering-alpha-top-players-core-risks-and-the-infrastructure-landscape)).
  This *solves* passive-LP drain by removing passive LPs — a large architectural
  change, out of scope for an AMM protocol but the honest "industry has moved here"
  footnote.
- **Capped per-trader exposure / circuit breakers:** bound the tokens any one
  address can hold near a bin, or widen `b`'s effective floor as concentration
  rises. Mitigates the worst single-actor drains (X's 100,000 buy here) without
  changing the curve.

---

## 5. The alternative: improving trader profitability on L2-norm

The user's secondary ask (explicitly *less* preferred). On the sample, L2 traders
lost −28,137 in aggregate — the flip side of L2's LP safety. The lever that improves
traders *without* re-opening the LP drain is to **stop over-pricing positions more
than necessary.**

### 5.1 Generalize the hypersphere to an `Lp`-norm AMM, then tune `p`

Today's L2 invariant `Σ xᵢ² = k²` prices a complete set at `√N` — *more than
arbitrage-safety requires*. Generalize to the `Lp` invariant `Σ xᵢᵖ = kᵖ`
(a power-mean / `G3M`-style family;
[axioms for CFMMs](https://arxiv.org/pdf/2210.00048)). The complete-set price
becomes:

```
P_set(p) = N^(1 − 1/p)          # p=1 → 1 (LMSR-like) ; p=2 → √N (today)
```

Arbitrage-safety (from `LMSR_KERNEL_ARBITRAGE.md` §10) requires `P_set > 1 + W`. The
threshold exponent is

```
p* = 1 / (1 − log_N(1 + W))      # N=64, W=3  →  log_64(4) = 1/3  →  p* = 1.5
```

Computed complete-set prices (`N = 64`, need `> 1 + W = 4`):

```
p = 1.00   P_set = 1.000   ARB OPEN
p = 1.25   P_set = 2.297   ARB OPEN
p = 1.50   P_set = 4.000   boundary (marginal)
p = 1.60   P_set = 4.757   arb-safe  ← recommended
p = 1.75   P_set = 5.944   arb-safe
p = 2.00   P_set = 8.000   arb-safe  (today — over-priced)
```

> **Pick `p ≈ 1.6`.** It stays safely above the `1 + W` arbitrage wall (4.76 > 4)
> while pricing broad positions at `4.76` instead of `8` — traders get **≈ 1.68×
> more tokens per unit collateral** on broad buys (and a smaller, still-positive
> improvement on concentrated buys). It interpolates L2 toward LMSR's
> capital-efficiency *exactly as far as arbitrage-safety allows, and no further.*

Caveat: this requires **building and proving an `Lp`-norm engine** (invariant,
pricing, LP proportionality, reversibility, a Cauchy–Schwarz-analogue overclaim
bound in the `Lp/Lq` dual norm). The complete-set prices above are exact; the
per-trade P&L on the sample path needs that engine to measure — flagged as a
build-and-verify follow-up, not asserted here.

### 5.2 Lesser levers
- **Deepen liquidity / lower trade fees** — reduces slippage and the fee drag, but
  does not change the structural `√N` over-pricing.
- **Do *not* normalize the kernel for L2** — it makes L2 traders strictly worse
  (§2.2: −124,034). Kernel normalization belongs with the LMSR/low-`p` path.

### 5.3 Why this is the weaker option
L2 + `Lp` tuning improves traders only by *spending down LP safety margin*. It cannot
make traders net-positive on an informed path without eventually re-exposing LPs —
it just chooses a point on the same trader↔LP trade-off curve. Fixing LMSR (§4)
changes the curve itself (removes the leak, then prices adverse selection via fees),
which is why it is the preferred direction.

---

## 6. Recommendation

For a protocol that wants **sustainable LPs and fairly-priced traders**, adopt LMSR
with a layered fix — in priority order:

1. **Normalize the settlement kernel to `Σ K = 1`** (keep `W = 3`). Removes the
   over-payment leak; restores the `b · ln N` loss bound and full solvency.
   *(−120k → −36k, 36% → 100% solvency, measured.)*
2. **Add a modest redemption fee (≈ 5–10%) credited to LPs**, and route trade fees
   to a separate LP account. Out-of-pool value that offsets the residual
   adverse-selection cost. *(≈ 2,760 LP recovery per 1% redemption, measured.)*
3. **Optionally enable an LS-LMSR overround** for noise/complete-set pricing — with
   eyes open that it does **not** defend a directional drain on its own.
4. **Consider a late-market depth taper** (pm-AMM-inspired) and **per-trader
   exposure caps** to blunt single-actor informed drains.

If LMSR is rejected and you keep **L2-norm**, ship an **`Lp`-norm engine with
`p ≈ 1.6`** to hand traders ~1.7× better fills while staying inside the arbitrage
wall — understanding it trades against LP margin rather than removing the leak.

If "LPs must never be drained" is an absolute, evaluate a **dynamic parimutuel**
core (no LP settlement risk by construction) or a **CLOB/hybrid** (risk moved to
active makers) — both are larger architectural changes.

---

## Appendix A — Methodology

All P&L figures are **computed**, by replaying the sample story's exact action
sequence through the playground engines (`engines/core.js`, `l2.js`, `lmsr.js`,
`dual.js`) and reading `resolve()` payouts — no estimation, no LLM.

- **Fixed setup:** `N = 64`, range `[0, 100]`, `W = 3`, liquidity `100,000`.
- **Actors/wallets:** A `10,050,000`; B `50,000`; X `5,000,000`; Creator is the
  founding LP `100,000`.
- **Action sequence (seq 4–12):** A buy μ50/σ25.39 ×5,000; A μ50/σ25.39 ×10,000; A
  μ79.9/σ33.76 ×10,000; B μ79.9/σ23.91 ×10,000; B μ35.9/σ23.91 ×10,000; X
  μ35.9/σ23.91 ×100,000; X μ78.8/σ23.91 ×1,000; B add-liquidity 20,000; A
  μ53.9/σ4.23 ×10,000. Resolve at `53` (bin 33).
- **Variants tested:** trade-fee sweep (→LP), redemption-fee sweep (→LP),
  LS-LMSR overround `α = s/(N ln N)` for `s ∈ {0.3, 1.0, 3.0}`, and kernel
  normalization (`Σ K = 1`) applied to **both** engine prototypes
  (`LmsrMarket.prototype` / `L2Market.prototype`, since `applySmoothKernel` copies
  the mixin onto each prototype at load).
- **Baseline reproduces the saved story exactly** (LMSR LP −120,000 at 36%
  solvency; L2 LP +28,137 at 100%), validating the harness.

## Appendix B — Key formulas

```
LMSR cost           C(q;b) = b · ln Σ exp(q_i / b)         complete-set price = 1
LMSR depth          b = liquidity / ln N    ⇒  max MM loss = b · ln N = liquidity
LS-LMSR depth       b(q) = α · Σ q_i        overround = 1 + α · n · ln n = 1 + s
Kernel L1 norm      Σ_i K(i,w) = 1 + W                     (over-payment factor)
L2 complete set     P_set = √N
Lp complete set     P_set(p) = N^(1 − 1/p)
Arb-safe exponent   p* = 1 / (1 − log_N(1 + W))            (N=64,W=3 ⇒ 1.5)
Solvency guard      claimScale = min(1, pool / Σ claims)
```

## Sources

- Othman, Pennock, Sandholm, Reeves — *A Practical Liquidity-Sensitive Automated Market Maker* (EC'10 / TEAC): [PDF](https://www.cs.cmu.edu/~sandholm/liquidity-sensitive%20automated%20market%20maker.teac.pdf), [ACM](https://dl.acm.org/doi/10.1145/2509413.2509414)
- Paradigm — *pm-AMM: A Uniform AMM for Prediction Markets* (2024): [paradigm.xyz](https://www.paradigm.xyz/2024/11/pm-amm)
- Pennock — *A Dynamic Pari-Mutuel Market for Hedging, Wagering, and Information Aggregation* (EC'04): [PDF](http://db.cs.duke.edu/courses/spring07/cps296.3/pennock-ec-2004-dynamic-parimutuel.pdf)
- *Axioms for Constant Function Market Makers* (generalized-mean / `Lp` CFMM family): [arXiv:2210.00048](https://arxiv.org/pdf/2210.00048)
- Polymarket liquidity rewards / CLOB v2: [docs](https://docs.polymarket.com/market-makers/liquidity-rewards), [crypto.news](https://crypto.news/polymarket-rolls-out-clob-v2-with-1m-liquidity-rewards-to-harden-prediction-markets/)
- AMM vs order-book prediction markets (industry context): [Interexy](https://interexy.com/amm-vs-order-book-prediction-market), [KuCoin](https://www.kucoin.com/blog/en-the-prediction-market-playbook-uncovering-alpha-top-players-core-risks-and-the-infrastructure-landscape)
- Companion: [`LMSR_KERNEL_ARBITRAGE.md`](LMSR_KERNEL_ARBITRAGE.md), sample: [`market-story-lmsr-vs-l2-64bins.md`](../specs/profitability/market-story-lmsr-vs-l2-64bins.md)

---

_Computed against the playground engines on the recorded sample path. Worldwide
mechanisms cited inline; all P&L figures are derived, not estimated — no AI/LLM
involved in the numbers._
