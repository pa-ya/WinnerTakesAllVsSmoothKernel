# LMSR + Smooth Kernel: The Complete-Set Arbitrage (and why L2-norm hides it)

> **What this document is.** A careful, corrected write-up of a finding from the
> comparison playground: under the **smooth triangular settlement kernel**, an
> **LMSR** AMM lets traders extract money from LPs **risk-free**, while the
> **L2-norm** AMM does not. This is *not* a bug in either engine's code or math —
> both are implemented correctly. It is a property of how each AMM prices a
> "complete set" against a kernel that pays more than 1 per complete set.
>
> **Companion to** `../specs/details/improved/SMOOTH_KERNEL_SOLVENCY.md`. That
> document proves the kernel is *solvent* (the vault never overpays, max LP loss
> is the deposit `k`). **Everything here is consistent with that proof.** This
> document explains a *different* property — arbitrage / adverse-selection — that
> the solvency proof does not address, and shows which half of that proof depends
> on the L2-norm and therefore does **not** carry over to LMSR.

---

## 0. TL;DR

1. A **complete set** = holding the same number of tokens in *every* bin. It pays
   the same amount no matter which outcome wins, so it is a pure "how is a
   guaranteed payout priced vs. what the settlement pays" probe.
2. The **smooth kernel pays a complete set `1 + W`** (e.g. **4×** for the default
   `W = 3`), because the triangular weights around the winner sum to `1 + W`.
3. **LMSR prices a complete set at exactly `1`.** That is the *mathematically
   correct* probability price. So under LMSR: pay `1`, receive `1 + W` → a
   **risk-free `(1+W)×` return**, independent of the outcome.
4. **L2-norm prices a complete set at `√N`** (e.g. **8** for `N = 64`). Since
   `√N > 1 + W` whenever `N > (1+W)²`, the complete set costs *more* than it can
   ever pay → **no arbitrage**. The L2 geometry blocks the play.
5. **Solvency is never violated** in either case. `claimScale` caps total payout
   at the pool. The arbitrage drains the LP *up to* their deposit `k` — never
   beyond. The market stays solvent; the LP just loses (risk-free, under LMSR).
6. **The root cause is the kernel**, not the AMM: `Σ K = 1 + W > 1`. Normalizing
   the kernel so a complete set pays exactly `1` removes the arbitrage under LMSR
   and changes concentrated/informative trades almost not at all.

---

## 1. The input that triggered it

In the playground, set **Confidence = 0%**. The UI maps that to a very wide
Gaussian: for a `0–100` range, `σ = 50`. A distribution buy with `σ = 50` spreads
the spend almost **uniformly across all bins** — you are buying "a little of
everything," which is essentially a **complete set**.

That is the regime that exposes the effect. With a normal, *informative* trade —
a trader who actually has a view and buys a **concentrated** distribution (small
`σ`) — the two engines behave much more similarly, and the L2-norm is competitive
or better. The screenshot that started this was the diffuse extreme, not a
typical trade.

Observed (N = 64, W = 3, spend = 5,000):

| Engine | Tokens received | Max payout | Max profit |
|---|---:|---:|---:|
| **LMSR** | 319.5 K | 23.33 K | **+18.33 K (+367 %)** |
| **L2-norm** | 40.0 K | 2.92 K | **−2.08 K (−42 %)** |

The rest of this document explains *exactly* where those numbers come from.

---

## 2. The key object: a "complete set"

A **complete set** is one token in *every* bin (or, more generally, the same
amount `c` in every bin). Two facts make it the perfect diagnostic:

- **At settlement it pays the same no matter who wins.** If you hold `c` in every
  bin and bin `w` wins, your kernel-weighted claim is
  `Σ_i c · K(i, w) = c · Σ_i K(i, w)` — and `Σ_i K(i, w)` is the same constant for
  every interior `w`. So a complete set is **outcome-independent**: it is a pure
  store of value, not a bet.
- **In a sound market it should cost exactly its guaranteed payout.** If a
  complete set is guaranteed to return `P`, it must cost `P`, otherwise it is free
  money (if cost `< P`) or a guaranteed loss (if cost `> P`).

So the question "is this market arbitrage-free for broad positions?" reduces to:
**does the price of a complete set equal what settlement pays for it?**

We now compute both sides.

---

## 3. What settlement pays for a complete set: `1 + W`

The triangular kernel (normalized to peak 1 at the winner) is

```
K(i, w) = max(0, 1 − |i − w| / (W + 1))
```

For an interior winning bin `w`, the weights are symmetric around `w`:

```
W = 3, winner at w:
  offset   −3    −2    −1    0    +1    +2    +3
  K       0.25  0.50  0.75  1.0  0.75  0.50  0.25
```

The **sum** of the weights (the L1 norm of the kernel) is

```
Σ_i K(i, w) = 1 + 2 · Σ_{d=1..W} (1 − d/(W+1))
            = 1 + 2 · (W − W/2)
            = 1 + W
```

For `W = 3`: `1 + 0.25 + 0.50 + 0.75 + 0.75 + 0.50 + 0.25 = 4.0`.

> **A complete set of size `c` pays `c · (1 + W)` at every interior outcome.**
> For `W = 3`, that is `4c`. (Verified in code: `Σ_i K = 4.00`.)

This is the crux. The smooth kernel deliberately rewards "near-misses" — bins
*next to* the winner also pay. The price of that fairness is that the **total**
weight exceeds 1: a basket covering the winner *and its neighbours* collects more
than the single winning token would. For a complete set, you always cover the
winner and all its neighbours, so you always collect `1 + W`.

---

## 4. What LMSR charges for a complete set: exactly `1`

LMSR's cost function is `C(q; b) = b · ln Σ_i exp(q_i / b)`. Buying `c` shares in
**every** bin moves `q → q + c·𝟙` (where `𝟙` is the all-ones vector). The cost is

```
C(q + c·𝟙; b) − C(q; b)
  = b · ln Σ_i exp((q_i + c)/b)        − b · ln Σ_i exp(q_i / b)
  = b · ln [ e^{c/b} · Σ_i exp(q_i/b) ] − b · ln Σ_i exp(q_i / b)
  = b · (c/b) + b·ln Σ(…) − b·ln Σ(…)
  = c
```

> **In LMSR, a complete set of size `c` costs exactly `c`.** Price per set = **1**.
> (Verified in code: complete-set price = `1.0000`.)

This is *correct* LMSR behaviour, and it is *desirable* in a normal prediction
market: a bundle guaranteed to pay 1 unit should cost 1 unit. There is nothing
wrong with the LMSR engine here — it is doing exactly the right thing.

**Worked example (N = 64, W = 3):** spend 5,000 on a flat buy.
- Complete-set price is 1, so 5,000 collateral buys ≈ **5,000 tokens in each of
  the 64 bins → ≈ 320,000 tokens total.** (Matches the observed 319.5 K.)
- At settlement, those ≈5,000-per-bin holdings pay `5,000 · (1 + W) = 5,000 · 4 =
  20,000` at any interior outcome. (Matches the observed ≈23 K, the extra coming
  from the slight Gaussian doming and edge effects.)
- **Pay 5,000, receive ≈20,000, at every outcome.** That is the +367 %.

Why no slippage punishes this? Because buying *proportionally to the current
(uniform) prices* does not move prices — the LMSR bonding curve only charges
slippage when you push prices *apart*. A flat buy keeps prices flat, so it is
priced at the floor of `1`/set.

---

## 5. What L2-norm charges for a complete set: `√N`

The L2-norm AMM holds the invariant `Σ_i x_i² = k²` and the pool equals `k`.
Start at the uniform state `x_i = k/√N`. Add `c` to every bin: `x_i' = k/√N + c`.
The new pool is

```
k' = √( Σ_i x_i'² ) = √( N · (k/√N + c)² ) = √N · (k/√N + c) = k + √N · c
```

So the cost is `k' − k = √N · c`.

> **In L2-norm, a complete set of size `c` costs `√N · c`.** Price per set = **√N**.
> For `N = 64`, that is **8**. (Verified in code: complete-set price = `8.000`.)

The L2 geometry makes broad/flat positions **expensive**: to raise *every*
coordinate you must grow the radius `k` by `√N` per unit, because the radius grows
with the L2 length of the position, not its sum. This is a quirk of the
hypersphere, not a deliberate fee — but it has a crucial side effect (next
section).

**Worked example (N = 64, W = 3):** spend 5,000 on a flat buy.
- Complete-set price is `√64 = 8`, so 5,000 collateral buys only ≈ `5,000 / 8 ≈
  625` tokens per bin → ≈ **40,000 tokens total.** (Matches the observed 40.0 K.)
- Those pay `625 · (1 + W) = 625 · 4 = 2,500` at any interior outcome. (Matches
  the observed ≈2.92 K.)
- **Pay 5,000, receive ≈2,900 — a loss at every outcome.** That is the −42 %.

---

## 6. Putting it together

The complete set is the same object in both engines and pays the same `1 + W` at
settlement. Only the **price** differs:

| | Complete-set price | Settlement pays | Risk-free outcome |
|---|---:|---:|---|
| **LMSR** | `1` | `1 + W = 4` | **+300 % (drain LP)** |
| **L2-norm** | `√N = 8` | `1 + W = 4` | **−50 % (lose to LP)** |

- LMSR prices the set *correctly* (at its fair probability value of 1). The kernel
  *overpays* it (at 4). The gap (3) is pure profit, taken from the LP.
- L2-norm *overprices* the set (at 8, a geometry artifact). The kernel still pays
  4. Now the gap is negative — the trader loses, the LP keeps the difference.

> **The kernel's over-payment is identical in both engines.** What differs is
> whether the AMM lets you *buy into* that over-payment cheaply. LMSR does; L2-norm
> does not. **L2's overpricing of flat positions accidentally cancels the kernel's
> overpayment.** That cancellation is the only thing that was protecting LPs.

---

## 7. It is a transfer, not value creation

The trader's profit does not come from nowhere. Resolving the market at **every**
possible outcome and averaging the net P&L (N = 64, W = 3, L = 150,000, flat buy
of 5,000):

```
LMSR  : avg trader P&L = +14,686  (+294 %)   avg LP P&L = −14,686  (−9.79 %)
L2    : avg trader P&L =  −2,537  (−51 %)     avg LP P&L =  +2,537  (+1.69 %)
```

The trader's gain equals the LP's loss **to the unit, at every outcome**. Under
LMSR it is a near-risk-free wealth transfer from LP to trader. Under L2 the LP is
the (small) net winner.

Note the "MAX PROFIT" figure in the UI is the *best-case* (peak-bin) number, but
here even the **expected** return is +294 % — because a complete set pays `1 + W`
regardless of outcome, there is barely any "best case vs. expected" gap. This is
the signature of an arbitrage rather than a lucky bet.

---

## 8. Solvency is NOT broken — reconciling with the solvency spec

This is the most important section, because it is where the wording must be exact.

`SMOOTH_KERNEL_SOLVENCY.md` proves the kernel is **solvent**: the vault never pays
out more than it holds, via

```
claimScale  s = min(1, pool / totalClaims)
payout      = raw_claim · s · (1 − redemption_fee)
```

**This guarantee is AMM-agnostic and holds under LMSR exactly as under L2-norm.**
`claimScale` looks only at `pool` and `totalClaims`; it does not care which curve
priced the trades. The vault can always cover the (scaled) payouts. **Switching to
LMSR does not reintroduce insolvency.** Verified at many trade sizes:

```
spend X   pool=L+X   claim≈4X   claimScale   traderPay   traderPnL   LP P&L     solvent?
  5,000    155,000     20,000     1.0000       23,310     +18,310    −18,310     YES
 20,000    170,000     80,000     1.0000       92,863     +72,863    −72,863     YES
 50,000    200,000    200,000     0.8682      200,000    +150,000   −150,000     YES
100,000    250,000    400,000     0.5490      250,000    +150,000   −150,000     YES
300,000    450,000  1,200,000     0.3409      450,000    +150,000   −150,000     YES
```

Two things are simultaneously true in that table:

1. **The market is solvent in every row** (`traderPay + lpPay ≤ pool`). ✓
2. **The LP is still drained** — and at the small trades it is drained while
   `claimScale = 1.0`, i.e. *with no scaling at all*.

The reason `claimScale` does not protect the LP is that **`pool` includes the LP's
own principal.** `claimScale` only begins to bite when claims exceed the *entire*
pool (around `X = L/3` here). But by then the trader's payout already equals the
whole pool — which means the LP is already wiped to zero residual. So
`claimScale`'s threshold is "LP fully drained," not "LP protected." Look at the
`traderPnL` column: it climbs to +150,000 and then **caps** — capped at exactly
the LP's entire deposit `k = 150,000`. That cap *is* solvency working: it stops the
trader taking *more* than the pool. It does nothing to stop them taking *all* of
it.

> **Both statements are true and not in tension:**
> - **Solvency:** the market never overpays; the most an LP can lose is `k`.
>   (Your spec's theorem — holds under LMSR.)
> - **Arbitrage:** under LMSR an arbitrageur can realise that maximum `k` loss
>   **risk-free and on purpose**, which is new.

---

## 9. Which half of the solvency proof depends on the L2-norm

Your solvency analysis (§3 of the spec) has two independent pieces:

| Piece of the proof | Relies on | Carries over to LMSR? |
|---|---|---|
| `claimScale` ⇒ vault never overpays; max LP loss = `k` | nothing AMM-specific | ✅ **yes** |
| Overclaim bounded by `‖K‖ · k = 1.658 k` (Cauchy–Schwarz) | the invariant `Σ x_i² = k²` | ❌ **no** |

The Cauchy–Schwarz bound in the spec is

```
Σ_i K_i · x_i  ≤  ‖K‖ · ‖x‖  =  ‖K‖ · k        (because ‖x‖ = √Σx_i² = k)
```

That last equality is *exactly the L2 invariant*. LMSR has **no** such invariant —
`Σ q_i²` is unbounded relative to the pool — so the `1.658 k` ceiling simply does
not apply. Measured maximum overclaim:

```
L2 concentrated (worst case):  totalClaim / pool = 1.429   (under the 1.658 bound ✓)
LMSR flat (complete set):      totalClaim / pool = 3.911   (≈ 1 + W = 4, far past 1.658)
```

So under LMSR the relevant bound is the **L1 norm** `Σ K = 1 + W = 4`, not the
**L2 norm** `‖K‖ = 1.658`. Same kernel, different bound, because the two AMMs
constrain positions in different norms. (This does not break solvency — `claimScale`
still caps at the pool — it just means the residual reaches zero far more easily.)

---

## 10. The real difference: risk-free arbitrage vs. adverse selection

Solvency is equal. Max LP loss magnitude is equal (`k`). The difference that
matters is **how that loss is realised**:

- **L2-norm — adverse selection only.** The LP loses when traders *correctly*
  concentrate near the actual winner. That requires being right; a wrong guess
  loses. And the broad/flat "always wins" play is *blocked*, because a complete set
  costs `√N > 1 + W`. Verified — a flat buy under L2 loses at **every** outcome:

  ```
  L2 flat position: trader P&L across all 64 outcomes = [−28,852 … −18,709]   (always negative)
  ```

- **LMSR — risk-free arbitrage.** A complete set costs `1` and pays `1 + W`, so a
  flat buy profits at **every** outcome, no prediction required. Verified:

  ```
  LMSR flat position: trader P&L across all 64 outcomes = [+49,055 … +130,083]  (always positive)
  ```

**The exact condition.** A complete set costs `P_set` and pays `1 + W`. It is a
risk-free profit iff `1 + W > P_set`:

```
LMSR:  P_set = 1     →  1 + W > 1      → arbitrage for any W ≥ 1   (never safe)
L2  :  P_set = √N    →  arbitrage iff  √N < 1 + W  ⇔  N < (1 + W)²
```

For the default `W = 3`, L2 is safe whenever `N > 16` — which is precisely the
"keep `W` small relative to `N`" regime your solvency spec already recommends. The
L2 invariant was quietly giving you arbitrage-resistance as a bonus. **LMSR has no
such safe regime — the arbitrage exists for every `N`.**

---

## 11. Is this an LMSR bug? No.

To be unambiguous:

- The **LMSR engine** is implemented correctly. Complete-set price = 1 is the
  textbook-correct result. (164 unit tests + 743 numerical-probe checks + the
  8-item math checklist all pass.)
- The **L2-norm engine** is implemented correctly. Invariant, pricing, LP
  proportionality, reversibility all verified.
- The **`claimScale` solvency guard** is implemented correctly and keeps the
  market solvent under *both* engines.

The effect is an **interaction**: the kernel pays `1 + W > 1` for a complete set,
and LMSR (correctly) prices a complete set at `1`. No single component is wrong;
the *combination* is exploitable. L2-norm only "hides" it by an unrelated geometric
overpricing of flat positions.

---

## 12. The fix (if you adopt LMSR): normalize the kernel

If you want LMSR's correct pricing **and** arbitrage-resistance, fix the kernel so
a complete set pays exactly `1`:

```
K'(i, w) = K(i, w) / (1 + W)          // normalize the L1 norm to 1
```

Then `Σ_i K'(i, w) = 1`, so a complete set pays exactly `1` — equal to LMSR's price
— and the arbitrage vanishes. Properties of this fix:

- **Concentrated/informative trades are barely affected** — they are rescaled by
  the same constant `1/(1+W)`, so relative payouts (the shape of the smoothing) are
  unchanged; only the absolute scale of payouts changes.
- **It also makes L2-norm strictly safer** (the complete set now costs `√N` and
  pays `1`, an even wider safety margin).
- **Trade-off:** absolute payouts shrink by `1/(1+W)`, so the headline "near-miss
  reward" is smaller. If the intent of the kernel was genuinely to *over-reward*
  near-misses, then the `1 + W` payout is by design and the conclusion is simply
  "LMSR is incompatible with this kernel without an explicit LP vig to price the
  overpayment in."

An alternative to normalization is an **LS-LMSR-style overround / vig** sized to at
least the kernel's overpayment, so the market charges enough on broad positions to
cover the `1 + W` payout. (The playground's LS-LMSR mode adds a vig, but its
default sensitivity is far below the `(1+W)`-sized overround needed to fully close
this specific gap — it mitigates rather than eliminates.)

---

## 13. Practical takeaway for the protocol decision

- Today the on-chain program uses **L2-norm + smooth kernel**, which (for `N >
  (1+W)²`) is **arbitrage-resistant for broad positions** and solvent. Good.
- **Switching the program to LMSR + the *current* kernel would introduce a
  risk-free, LP-draining complete-set arbitrage** — solvency intact, but LPs bleed
  to arbitrageurs with certainty. Not advisable as-is.
- If LMSR is desired (for its cleaner pricing, bounded loss `b·ln N`, etc.),
  **ship it together with a normalized kernel (`Σ K = 1`)** or an explicitly
  `(1+W)`-sized vig. Then re-run this comparison; the broad-position arbitrage
  should disappear and the engines can be compared on their *intended* merits
  (slippage, depth, LP fee capture on informative trades).

---

## Appendix — how to reproduce

All numbers above were produced against the playground engines
(`engines/core.js`, `l2.js`, `lmsr.js`, `dual.js`) with `N = 64`, `W = 3`,
`L = 150,000`, range `0–100`, zero trade fees. Key probes:

- **Complete-set prices:** add `1` to every position; measure the cost difference.
  LMSR → `1.0000`; L2 → `8.000 = √N`.
- **Kernel total weight:** `Σ_i K(i, w) = 4.00 = 1 + W`.
- **Risk-free test:** execute a flat (`σ = 50`) buy, then resolve at *every* bin
  and record trader P&L. LMSR positive at all outcomes; L2 negative at all
  outcomes.
- **Solvency/drain table:** flat buys of increasing size; record `claimScale`,
  trader P&L, LP P&L. Always solvent; LP loss caps at `k`.
- **Overclaim bounds:** max `totalClaim / pool` over all win bins. L2 ≤ 1.43
  (under `‖K‖ = 1.658`); LMSR ≈ 3.91 (≈ `1 + W = 4`).
