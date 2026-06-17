# Scaling the Bin Count — Wide-Range Markets on Solana

> Companion to `LMSR_KERNEL_ARBITRAGE.md` and `LMSR_LP_SUSTAINABILITY.md`.
> **Question.** A continuous (scalar) market discretises its outcome variable into
> `N` bins. On Solana the program caps `N` at **256** (`MAX_BINS`). For wide-range
> topics — *"what will BTC close at?"* over `$0–$200k` — 256 bins means a bucket is
> `$781` wide, far too coarse. How do we get finer resolution **without** breaking
> Solana's compute-unit (CU), rent, and account-size limits — and, where possible,
> **improve LP/trader profitability at the same time**?

All on-chain figures below are read directly from the current program
(`dekant-sms/programs/dekant-pm/`, deployed on devnet as the L2-norm smooth-kernel
build), not estimated.

> **Settlement model, to be exact.** The **L2-norm + smooth-kernel** settlement is
> *live on-chain*: `resolve_market` stores a solvency `scaling_factor` and
> `claim_payout` pays each trader a kernel-weighted, scaled sum over their bins
> (`engine/kernel.rs`). The **LMSR** smooth-kernel variant — the subject of
> `LMSR_LP_SUSTAINABILITY.md` and `SUBBIN_POINT_SETTLEMENT.md` — is a *research
> direction*, not yet deployed. The bin-count constraints in this doc (CU/rent/size)
> are engine-agnostic: they bind the same way whether the curve is L2-norm or LMSR.

---

## 0. TL;DR — ranked

| # | Approach | Buys resolution? | Buys bin headroom? | Helps profitability? | Cost to build |
| --- | --- | :---: | :---: | :---: | --- |
| 1 | **Log / non-uniform bin spacing** | ✅✅ | — | ↗ (minor) | Low — remap `centers[]` |
| 2 | **Horizon-matched range selection** (don't make the range absurd) | ✅✅ | — | ↗ (minor) | None — market-design rule |
| 3 | **Sub-bin point settlement** (the stored-point idea → see `SUBBIN_POINT_SETTLEMENT.md`) | ✅✅✅ | ✅ (fewer bins needed) | ✅✅ | Medium |
| 4 | **Sparse reserves + global scale factor** (store only touched bins) | — | ✅✅ (breaks the O(N) CU wall) | — | Medium–High |
| 5 | **Lazy allocation + `realloc` growth** | — | ✅ (rent paid on demand) | — | Low |
| 6 | **Range / tick LP positions** (Uniswap-v3 analog) | — | ✅ (per-user O(N)→O(orders)) | ✅✅ | High |
| 7 | **CU relief: crank/chunking, compute-budget, lookup tables** | — | ✅ | — | Low–Medium |
| 8 | **Account compression (Merkle)** | — | ✅✅ | — | High + trust shift |

**The headline:** the "256 bin" wall is not one limit but **three budgets** (rent,
CU, per-position bytes), and most of the pain is solved *before* you add a single
bin — by **spending the bins you already have more wisely** (log spacing + tight
ranges + sub-bin settlement). When you genuinely need more bins, **sparse storage**
is what removes the binding constraint (the O(N) CU loop), and **range LP
positions** are the one bin-headroom fix that *also* lifts profitability.

---

## 1. Where the "256" actually comes from — the three budgets

`MAX_BINS = 256` (`constants.rs:16`) is a chosen ceiling, but it sits just under
where three independent Solana budgets start to bind. A continuous market keeps a
`Vec<u64>` of length `N` **twice** in the `Market` account (`reserves` +
`trader_token_totals`), and every trader's `UserPosition` keeps a `Vec<u64>` of
length `N` (`holdings`).

### 1a. Account-size / rent budget

From `Market::space()` and `UserPosition::space()`:

| Account | Bytes | At N=64 | At N=256 | Per-bin marginal |
| --- | --- | ---: | ---: | ---: |
| `Market` | `311 + 16·N` | 1,335 | 4,407 | **16 B/bin** |
| `UserPosition` (per trader) | `111 + 8·N` | 623 | 2,159 | **8 B/bin** |

Rent-exempt minimum ≈ `(bytes + 128) · 3480 · 2` lamports
(`lamports_per_byte_year = 3480`, 2-year, 128 B account overhead) ≈
**6,960 lamports/byte**:

| | N=64 | N=256 | Per extra bin |
| --- | ---: | ---: | ---: |
| `Market` rent | ≈ 0.0102 SOL | ≈ 0.0316 SOL | ≈ 0.000111 SOL |
| `UserPosition` rent (each trader) | ≈ 0.0052 SOL | ≈ 0.0159 SOL | ≈ 0.0000557 SOL |

Rent is **recoverable** (refunded on close) and small in absolute terms. The hard
ceiling — Solana's **10 MiB** max account size — is nowhere near (256 bins ≈ 4 KB).
Rent is therefore *not* the binding limit; it is a per-trader friction that grows
linearly and is felt most in the `UserPosition` (every trader pays for `N` slots,
even though they hold tokens in only a handful of bins).

### 1b. Compute-unit budget — **this is the real wall**

Every state-changing trade loops over **all N bins** with checked `u128`/`U256`
integer math. From `engine/amm.rs`:

- `compute_buy` / `compute_collateral_for_target_prob`: O(N) — `Σ_{j≠i} x_j²`
  loop, complete-set mint loop, plus one `isqrt`.
- `compute_distribution_buy` / `_sell` / `compute_sell_all`: O(N) loops for
  `Σ x·W`, `Σ W²`, reserve mint/burn, plus one `isqrt_u256` (U256 square root).
- `scale_reserves` (every LP add/remove): O(N).
- Distribution trades additionally compute Gaussian weights over bins (O(N) with
  `exp`).

A Solana transaction can request at most **1,400,000 CU**
(`MAX_COMPUTE_UNIT_LIMIT`; default 200k). The per-bin work — wide-integer multiply
+ checked-add, and especially the `U256` `isqrt` — is what makes large `N`
expensive. **256 bins is roughly where one distribution trade still fits inside one
transaction's CU with margin.** Push N higher and trades stop landing atomically.

This is why naive "just raise `MAX_BINS`" does not work: rent would be fine, but the
trade instruction would blow the CU ceiling.

### 1c. `realloc` growth budget

A single instruction can grow an account by at most **10,240 bytes**
(`MAX_PERMITTED_DATA_INCREASE`, 10 KiB). The initial `CreateAccount` can allocate
up to the full 10 MiB in one shot, so this only matters if we want to *grow* a
market's bin count after creation (see §4b) — each growth step adds ≤ 640 bins
worth of `Market` vectors.

**Summary:** rent = linear but cheap & recoverable; account ceiling = irrelevant at
this scale; **CU = the binding constraint**; per-position bytes = the secondary
friction. Any real fix must attack CU and/or per-position size — *not* just rent.

---

## 2. Reframe the problem: we need **resolution**, not bins

"Bitcoin over `$0–$200k`" is the wrong way to pose the market. Two observations:

1. **Price is multiplicative, bins are additive.** A `$781` bucket is meaningless
   at `$2,000` (39% of the price) and overkill at `$190,000` (0.4%). Uniform linear
   bins waste resolution exactly where it is not needed and starve it where it is.

2. **You almost never need the whole range live.** A 1-week BTC market does not need
   `$0` or `$1M` as live outcomes. The *useful* outcome space is a tight band around
   the current price.

So before any Solana engineering, two market-design choices recover most of the
"resolution" the bin cap seems to deny — for **zero** extra CU/rent. They are
§3.1 and §3.2.

---

## 3. Get more resolution per bin (no new bins, ~free)

### 3.1 Log / non-uniform bin spacing — biggest lever, nearly free

Keep `N = 256`, but place the bin **centers** geometrically instead of uniformly.
For BTC: `center_i = P_min · (P_max/P_min)^(i/N)`. Resolution becomes *relative*
(constant % per bin) instead of *absolute* (constant $ per bin) — fine where the
price is, coarse only in the irrelevant tails.

Worked example, `$10k–$500k`, N=256:

| Spacing | Resolution at $30k | Resolution at $100k | Resolution at $400k |
| --- | ---: | ---: | ---: |
| Linear (`$1,914`/bin) | $1,914 (6.4%) | $1,914 (1.9%) | $1,914 (0.5%) |
| Log (`×1.0154`/bin) | ≈ $462 (1.54%) | ≈ $1,540 (1.54%) | ≈ $6,160 (1.54%) |

At the live price (~$100k) log spacing is **wider**, but near the realistic
outcome band ($30k–$120k) it is **3–4× finer** than linear for the same 256 bins.

**On-chain cost: zero.** The program already stores per-bin `centers[]`
(`lmsr.js:62`; the on-chain analog is `range_min/range_max` + index → value). Only
two things change: (a) the bin→value mapping at creation, and (b) the Gaussian
weight computation (it already uses `centers`, so distribution trades keep working).
CU, rent, and account size are **unchanged** — the loops are still O(N), N is still
256. *Caveat:* the settlement kernel's "width = W bins" now means a **value-width
that varies across the range** (wider in $ terms at high prices). That is usually
*desirable* for a log market, but it must be documented, and the sub-bin settlement
of §3.3 makes it moot.

### 3.2 Horizon-matched range selection — a market-design rule, free

Make `[range_min, range_max]` tight around the live value for the market's horizon.
A 1-week BTC market priced at `$100k` might use `$80k–$130k` → `$195`/bin at N=256
(linear) — 4× finer than `$0–$200k`, no engineering at all. Combine with §3.1 and a
day-ahead market can hit single-dollar resolution.

This also has a **mild profitability benefit**: the AMM's fixed liquidity (the
LMSR `b`, the L2 `k`) is no longer diluted across dead outcomes, so the same LP
capital provides deeper effective books on the bins that actually trade — better
fills for traders, more fee turnover per unit of LP capital.

The cost is *coverage risk*: if the variable jumps outside the range, the edge bins
absorb it (the program clamps the resolved bin to `[0, N-1]`,
`core.js:157`). Choose ranges with enough tail; pair with §4b (grow on demand) for
long-horizon markets.

### 3.3 Sub-bin settlement via the stored trading point — resolution *below* bin size

This is the user's own proposal, analysed in full in
**`SUBBIN_POINT_SETTLEMENT.md`**. In one line: store each trader's *continuous*
predicted point (the `μ` of their distribution buys), and at settlement scale each
trader's kernel payout by how close **their point** is to the **exact** resolved
value — not just which bin they landed in. This recovers *continuous* discrimination
**inside** a bin, so a coarser bin grid suffices for the same payoff sharpness. It is
the one resolution fix that also directly rebalances LP↔trader economics (it claws
back LMSR's structural over-payment), which is why it is the most important item for
this protocol. Cross-referenced here because it is *also* a bin-count workaround:
fewer bins are needed when each bin resolves continuously.

---

## 4. Afford more bins when you truly need them

### 4.1 Lazy allocation + `realloc` growth

Don't pre-pay 256 bins of `trader_token_totals`/`reserves` if a market will only
ever touch 40. Create with a modest `N`, and `realloc` the `Market` vectors upward
(≤ 10,240 B/step → ≤ 640 bins/step) when demand warrants. Reduces *rent friction*;
does **nothing** for the CU wall (§1b), so it is necessary-but-not-sufficient for
large N. Best paired with §4.2.

### 4.2 Sparse reserves + a global scale factor — the fix that breaks the O(N) CU wall

The decisive insight: **untouched bins are all identical.** At a uniform start every
bin has the same reserve; an untouched bin stays at that value forever (LP scaling is
*uniform multiplicative*). So both engines' core sums decompose:

- **L2:** `Σ x_i² = (#untouched)·x_unif² + Σ_touched x_i²`.
- **LMSR:** `Σ exp(q_i/b) = (#untouched)·1 + Σ_touched exp(q_i/b)` (untouched `q=0`).

Store reserves as **(uniform_base, untouched_count) + a sparse map of touched
bins**, and carry LP add/remove as a **global multiplier** instead of writing every
slot. A trade or settlement then costs **O(#touched)**, not O(N). Since real trades
touch only a contiguous `±5σ` window (and single-bin buys touch one bin), the hot
path becomes nearly N-independent — so `MAX_BINS` could rise to thousands while each
trade's CU stays roughly flat.

Costs/risks: more intricate accounting (the sparse map, the global multiplier, and
their interaction with the invariant check); `UserPosition` should mirror the sparse
form (store only non-zero `(bin, amount)` pairs — also shrinks per-trader rent from
O(N) to O(held-bins)). This is the highest-leverage *engineering* change for genuine
high-N markets and the prerequisite for raising the cap.

### 4.3 Range / tick LP positions (Uniswap-v3 analog) — bin headroom **and** profitability

Today liquidity is global (one `b` / one `k`) and every `UserPosition` carries `N`
slots. Borrowing concentrated-liquidity ideas: let an LP supply depth only over a
**sub-range** of bins, and represent both LP and trader positions as **range orders**
`(lo, hi, amount)` rather than length-N vectors. Per-user storage collapses from
O(N) to O(#orders), and LPs can **concentrate capital where the action is**, earning
materially more fee/PnL per unit deposited — the central Uniswap-v3 lesson, and a
direct answer to the LP-sustainability problem in the companion doc.

Honest caveat: LMSR's `b` and the L2 norm are *global* parameters; making liquidity
piecewise over the outcome axis is a real redesign of the cost function (piecewise-`b`
LMSR, or a partitioned L2), not a drop-in. High build cost, but it is the one
bin-headroom mechanism that is *also* a first-class profitability lever — flagged as
a serious R&D candidate, not a quick fix.

### 4.4 CU relief that doesn't change the data model

- **Chunked / crank settlement & trades.** Split an O(N) operation across several
  transactions accumulating into scratch state (the established Solana "crank"
  pattern). With the L2-norm smooth kernel now **on-chain**, both settlement steps
  are O(N): `resolve_market` computes the solvency `scaling_factor` over all bins
  (`kernel::compute_scaling_factor` on `trader_token_totals`), and each
  `claim_payout` sums the trader's kernel-weighted holdings over all bins
  (`kernel::compute_kernel_payout`). (Only WTA markets — binary/multi, or continuous
  with `kernel_width = 0` — keep the O(1) single-bin path.) So the O(N) tax now hits
  trades **and** resolve/claim — which is exactly why **sparse storage (§4.2)** is the
  higher-leverage fix than cranking.
- **Request the full compute budget** (`ComputeBudget::set_compute_unit_limit` up to
  1.4M) — buys ~7× headroom over the 200k default; a config knob, already free CU.
- **Cheaper math / lookup tables.** Precompute Gaussian weight tables and reuse
  `isqrt` results where possible; the `U256` `isqrt` dominates per-trade CU.

### 4.5 Account compression (Merkle) — advanced, with a trust shift

Solana state-compression (concurrent Merkle trees, as used by cNFTs) stores only a
root on-chain and serves leaves + proofs off-chain. It could hold per-trader
positions for very large N at negligible rent. **But** it shifts the trust/liveness
model: an indexer must serve proofs, and reads/writes need proof plumbing. Listed for
completeness; not recommended unless N reaches the thousands and §4.2/§4.3 are
insufficient.

---

## 5. The profitability-coupled shortlist (what the user asked to prioritise)

Ranked by how much they fix **both** resolution/bin-count **and** profitability:

1. **Sub-bin point settlement (§3.3 → `SUBBIN_POINT_SETTLEMENT.md`).** Recovers
   sub-bin resolution *and* claws back LMSR's over-payment to LPs. Best dual-win;
   moderate build. **Do this first.**
2. **Range / tick LP positions (§4.3).** Real bin headroom *and* concentrated-LP
   profitability. Biggest build; highest ceiling.
3. **Log spacing + tight ranges (§3.1–3.2).** Mostly resolution, mild profitability
   (less wasted depth). Nearly free — **do these immediately, regardless.**
4. **Sparse storage (§4.2).** Pure scalability (unlocks high N); profitability-neutral
   but a prerequisite for #2 at scale.

Approaches that scale bins but **don't** touch profitability — lazy `realloc`
(§4.1), crank/compute-budget (§4.4), compression (§4.5) — are enabling plumbing, not
ends in themselves.

---

## 6. Recommendation (layered)

1. **Immediately, zero engineering:** adopt **log spacing** (§3.1) and a
   **horizon-matched range policy** (§3.2). This alone turns "BTC `$0–$200k`,
   `$781`/bin" into low-single-percent (often single-dollar) resolution on the bins
   that matter, at no CU/rent cost.
2. **Next, the dual-win:** implement **sub-bin point settlement** (§3.3) — finer
   effective resolution per bin *and* the LP-rebalancing the companion doc calls for.
   See `SUBBIN_POINT_SETTLEMENT.md` for the full design, math, and simulated P&L.
3. **When demand justifies high N:** build **sparse reserves + global scale factor**
   (§4.2) to break the O(N) CU wall, with **lazy `realloc`** (§4.1) for rent; only
   then consider **range LP positions** (§4.3) for the profitability ceiling, and
   **compression** (§4.5) for extreme N.

Net: the bin cap is best beaten **first by spending existing bins wisely** (log +
tight range + sub-bin settlement), and only **then by engineering more bins**
(sparse storage), with **range LP positions** as the one growth path that also pays
LPs better.

---

### Appendix — the numbers, restated

| Quantity | Value | Source |
| --- | --- | --- |
| `MAX_BINS` (continuous) | 256 | `constants.rs:16` |
| `MAX_OUTCOMES` (multi) | 32 | `constants.rs:13` |
| `Market` size | `311 + 16·N` bytes | `state/market.rs` `space()` |
| `UserPosition` size | `111 + 8·N` bytes | `state/user_position.rs` `space()` |
| Rent / byte | ≈ 6,960 lamports (`(b+128)·3480·2`) | Solana rent model |
| Max account size | 10,485,760 B (10 MiB) | `MAX_PERMITTED_DATA_LENGTH` |
| Max `realloc` / ix | 10,240 B (10 KiB) | `MAX_PERMITTED_DATA_INCREASE` |
| Max CU / tx | 1,400,000 (default 200,000) | `MAX_COMPUTE_UNIT_LIMIT` |
| Per-trade compute | **O(N)** wide-int + 1× `U256 isqrt` | `engine/amm.rs` |
| `resolve_market` | **O(N)** — computes solvency `scaling_factor` over all bins (kernel markets) | `resolve_market.rs`, `engine/kernel.rs` |
| `claim_payout` | **O(N)** kernel-weighted sum (continuous, `kernel_width > 0`); O(1) WTA otherwise | `claim_payout.rs`, `engine/kernel.rs` |

> SOL rent figures use an illustrative `lamports_per_byte_year = 3480`; treat absolute
> SOL/USD amounts as order-of-magnitude. The *shape* (linear in N, CU-bound) is exact.
