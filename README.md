# Mule-Ring Sentinel

**Razorpay AI Buildathon — Track 2 (AI Risk Manager) · Entry #2 by Lakshya**

A **defense-only** detector that flags merchants whose payment-aggregator accounts are being used as **money-mule conduits** — before their settlements leave the platform. Every money decision is made by audited deterministic code. The LLM investigates and explains; it never decides. *LLM proposes, code disposes.*

> Track 2 bar: "a working detector... with measured precision and recall on a held-out test set" and "honest metrics including false-positive cost." That bar is this project's design constraint, not an afterthought.

---

## Why this problem, why now

- Indian banking fraud value hit **₹48,021 crore in FY2025-26 (+46% YoY)** while reported case counts *fell* — losses are concentrating in layered, hard-to-trace schemes ([RMAI, Jul 2026](https://rmaindia.org/)).
- India's cybercrime coordination centre (I4C) had flagged **2.47 million+ Layer-1 mule accounts** by early 2026 ([Business Standard, Jun 2026](https://www.business-standard.com/finance/news/what-are-mule-accounts-cybercrime-banking-layer-india-fraud-rbi-126062400855_1.html)).
- RBI's **Digital Payments Intelligence Platform (DPIP)** now mandates real-time fraud-data sharing across payment entities; mule-account tracing is its core use case.
- The **Payment Aggregator Master Directions (Sept 2025)** tighten merchant due-diligence and transaction-monitoring obligations on aggregators exactly like Razorpay.
- The **Supreme Court ordered a mule-account SOP** in August 2026.

For a payment aggregator, undetected mule conduits mean frozen settlements, regulatory penalties, and license risk — a direct class of loss for Razorpay **and** a trust tax on every honest merchant on its rails.

## The NET math

```
net_saved = Σ(held_mule_₹ × recovery_rate)
          − Σ(false_positive_merchants × disruption_cost)
          − ops_cost
```

The false-positive term is **first-class**: wrongly holding a good merchant's settlements costs real money (their disrupted cash flow + review ops). The detector's threshold is chosen against that trade-off explicitly, and every eval reports it. A detector that only brags about recall is hiding its FP bill.

## Architecture — LLM proposes, code disposes

| Layer | What it does | Trust model |
|---|---|---|
| **Simulator** | Synthetic world: legit merchant archetypes + injected mule-ring typologies; transactions shaped like Razorpay payments/settlements objects | Ground truth known by construction |
| **Detector** | Deterministic graph-typology scoring (pass-through ratio, fan-out velocity, dormancy spike, burst timing) | Pure audited code; every flag carries machine-checkable reasons |
| **Investigator** | Groq LLM (`qwen/qwen3.6-27b`) turns a flagged evidence bundle into a structured case dossier (narrative, typology assessment, risk/mitigating factors, recommendation) | Proposes only — no money authority. Activates when `GROQ_API_KEY` is present in `.env`; without it the product degrades gracefully to deterministic findings. 429s handled with exponential backoff + retry cap |
| **Gate** | Deterministic policy converts detector score + dossier into HOLD / RELEASE / ESCALATE | Audited code only |
| **Audit** | Append-only JSONL ledger of every hold/release decision with reasons | Replayable |
| **Eval** | Held-out worlds → precision/recall, FP cost, ₹ recovered; baselines + Monte Carlo + sensitivity sweeps | Honest numbers or it doesn't ship |

### Mule-ring typologies simulated
1. **Layering fan-out** — smurfed inflows during a quiet warm-up, then a 1–3 day burst splitting ~90% onward to many fresh counterparties
2. **Smurfing fan-in** — many small credits from unrelated sources converging, then one clean sweep out
3. **Dormancy-then-spike** — near-dead merchant account suddenly processes disproportionate volume
4. **Carousel** — funds cycling through a closed loop of allied accounts to build fake history before extraction

## Generalization: does it catch typologies it was not written for?

`npm run generalize`

The held-out numbers above answer *"does the detector recognise the four patterns its own author injected?"* That is a closed loop, and a closed loop can be made to produce any number you like. So there is a second test set, and it is the more important one.

Two additional typologies were written from published AML descriptions rather than from the detector's feature set, and are **excluded from the default ring mix** so they can never touch the headline numbers. Both **recruit going-concern merchants** instead of creating fresh accounts — which matters, because all four original typologies sit on `new_onboarding` or `dormant` accounts and are therefore handed a thin-history signal worth 0.15 of the score. A ring built on a real business gets none of it.

- **Peel chain** — value enters the first account, which forwards 90–95% onward and retains a small cut; each hop repeats; the last account extracts. Structurally the *opposite* of fan-out: each hop is roughly one-in, one-out.
- **Slow drain** — a going concern receives a steady stream of small structured credits all month and drips ~60% onward to a few rotating payees, keeping the rest so it reads as an ordinary business margin. Nothing bursty, nothing at 90% pass-through. This is what a launderer does *once they know* burst detection exists.

Scored on 20 fresh worlds at the **same threshold tuned on train**, with nothing re-tuned:

| typology | | recall | median best score |
|---|---|---|---|
| layering_fan_out | known | 98.8% | 0.629 |
| smurfing_fan_in | known | 100.0% | 0.629 |
| dormancy_spike | known | 100.0% | 0.593 |
| carousel | known | 98.3% | 0.550 |
| **peel_chain** | **unseen** | **2.1%** | 0.226 |
| **slow_drain** | **unseen** | **0.0%** | 0.158 |

**Known 99.1%. Unseen 1.6%. A 97.5-point generalization gap.**

That is the honest boundary of the headline result: this detector catches burst-and-fan-out rings sitting on thin-history accounts. It does **not** catch conduits hidden inside a merchant with real trading volume, because every feature it has is computed on aggregate flow, and a going concern's legitimate traffic dilutes all of them — the fan-out *ratio* in particular collapses once a merchant has many genuine customers.

### What was rejected, and why

Both of these would have improved the table. Neither is defensible, so neither shipped:

- **Amount-matched forwarding** (flagging an outbound that closely matches a recent inbound — a real peel-chain primitive). Measured before building: at a 0.5 threshold it catches **15%** of peel chains while falsely hitting **0.6% of 1,505 legit merchants**. On a base that size the false-positive bill exceeds the recovery. Rejected on its numbers.
- **Lowering the loop-edge threshold.** A chain hop produces exactly one loop edge and `cLoop` needs ~2 to fire, so halving the midpoint would catch nearly every chain — because **0 of 1,505 legit merchants have any loop edge at all**. But that is an artifact of this simulator giving legit merchants merchant-scoped vendor accounts; real merchants share marketplaces, PSPs and vendors constantly. The feature that would close the gap in simulation is precisely the one whose real-world false-positive rate is unmeasured. Tuning to it would be gaming the test set.

One genuine defect did surface and was fixed: `computeLoopEdgeDays` only detected a loop when the inbound leg preceded the outbound leg, so detection depended on the order two legs happened to occur in — and chained typologies always forward in the direction that produced nothing. It now attributes the edge on the day the second leg is observed, which keeps the stream causal (pinned by `test/loop.test.js`) while making it order-independent. Effect: peel_chain 0.8% → 2.1%, carousel 96.7% → 98.3%, held-out numbers unchanged.

### What it would actually take

Catching the slow-drain class needs signals this detector does not have: **network-level features across accounts** (mule networks reuse cash-out infrastructure — that shared structure, not any single account's shape, is the real signal), and **real labelled data** to learn where the boundary sits between a low-and-slow conduit and a genuine business with thin margins. Neither is available here, and no amount of rule tuning substitutes for them.

## Honest limitations

- **Ground truth is synthetic, and the four headline typologies were written alongside the rules that detect them.** The generalization section above is the measurement of what that costs: 99.1% on patterns the author injected, 1.6% on patterns written independently. Read the headline numbers as an upper bound on a known threat model, not as a real-world detection rate.
- The loop-edge feature is **suspiciously clean in simulation** — zero legit merchants trip it, by construction. Its real-world precision is unproven and probably much worse.
- Ground-truth distributions are calibrated to published industry statistics, but no claim is made about real-world rates without real data.
- The detector is rules-first **on purpose**: for money decisions, auditable beats clever. ML can extend feature scoring later without touching the gate.
- Recovery rate (share of held mule funds actually saved) is a modeled constant, swept 30–90% in sensitivity analysis rather than pretended as fact.
- Scale is 333 merchants over 30 days, in memory. There is no throughput or latency story.

## Setup

```powershell
Copy-Item .env.example .env    # then paste a Groq key into .env (optional — product works without it)
```

The key is read per-process from this repo's `.env` only. Never commit it; never set it machine-wide.

## Repo structure

```
src/
  sim/        seeded world builder: 10 archetypes, Razorpay-shaped events
    rings/      index.js = the 4 in-mix typologies · unseen.js = the held-out 2
  detect/     streaming graph-typology features + scoring (pure deterministic)
  gate/       tiered money decisions with FP-cost guardrails (pure deterministic)
  agent/      Groq investigator (advisory only) + CLI
  audit/      SHA-256 hash-chained JSONL ledger
  eval/       metrics, budget-matched baselines, train→held-out report,
              generalization.js = unseen-typology test at the train-tuned point
  server/     zero-dependency API + static server for the dashboard
  pipeline/   one-shot sim→detect→gate→ledger runner
  util/       CLI arg parsing that rejects bad input instead of coercing it
web/          vanilla JS dashboard
test/         node:test suites (30 tests)
```

## API (dev server, port 8898)

| Endpoint | Purpose |
|---|---|
| `GET /api/run?seed=` | world summary + non-release gate decisions |
| `GET /api/day?seed=&d=` | payment events for day d |
| `GET /api/case/:id?seed=` | deterministic dossier |
| `GET /api/dossier/:id?seed=` | dossier + AI investigation (if key configured) |
| `GET /api/spark?seed=&m=` | per-day net-flow series for the timeline chart |
| `GET /api/ledger?seed=` | audit entries + chain verification |

## Defense-only statement

This repository contains no offense capability. Mule-behavior generation exists solely as **labeled test-set construction** for measuring the detector — standard practice in fraud ML. Nothing here moves real money, touches real accounts, or provides evasion guidance.

## Status

- [x] Scaffold + README-first
- [x] Thin vertical slice: 1 typology (layering fan-out) + deterministic rules + daily-stream scoring + CLI signal — `npm run slice`
- [x] Full simulator: 10 legit archetypes incl. mule-mimicking ones (dropshippers ~88% pass-through, travel agencies at 98% one-time payers, contractors fanning out to 14 payees, event-burst merchants, refunds) + 4 ring typologies (layering fan-out, smurfing fan-in, dormancy spike, multi-account carousel) in paise-denominated Razorpay-shaped payment events. Seed-robust: 87.5–93.8% recall, 0 FP at default threshold across unseen seeds.
- [x] Generalization test on 2 further typologies written independently of the rules (peel chain, slow drain), held out of the default mix — see the generalization section above for the result and for what was rejected rather than shipped. `npm run generalize`
- [x] Eval harness with honest protocol: threshold tuned on 12 TRAIN worlds only (max NET → thr=0.40), reported on 20 HELD-OUT worlds never seen during tuning. Held-out @0.40: **99.1% precision ±2.1, 97.5% recall ±3.1**, NET ₹12.2L/world ±₹4.3L. Key evidence for the false-positive-cost bar: at thr=0.35 NET turns **negative** (−₹32L/world) — wrongful holds of high-volume legit merchants (contractors, traders) outweigh recovered mule funds, so the operating point is chosen by max NET, not max recall. Budget-matched baselines all lose 20/20 worlds (volume-top-k −₹2.3Cr/world: flags the biggest legit merchants; pass-through-only −₹6Cr/world). Sensitivity grid varies correctly with recovery (30–90%) and disruption-cost scale (0.7–2.1×). `npm run eval`
- [x] Detection gate: tiered decisions (ESCALATE ≥0.6 / HOLD ≥0.4 / WATCH ≥0.3 / RELEASE) with FP-cost guardrails — batch hold cap downgrades weakest holds when holds exceed 5% of base, escalations never auto-downgraded, 14-day auto-release. `npm run pipeline`
- [x] Audit ledger: append-only JSONL with SHA-256 hash chain (tamper-evident), resumable sequence, `verify()` walker
- [x] Groq investigator + case dossiers: unit-tested (30/30 suite-wide, incl. mocked 429/backoff/fence-recovery/token-budget paths), wired into API + dashboard + CLI (`npm run investigate -- --seed 42`). **Verified live against Groq** on seed 42: the LLM independently returned `ESCALATE` (confidence 0.92) with typology "layering fan-out" on merchant M0066, matching the deterministic gate it cannot influence. Without a `GROQ_API_KEY` the server degrades to deterministic findings with an explicit "LLM unavailable" note, and the gate never depends on the LLM either way.
  - Two reasoning-budget notes worth stating, since both were real bugs: `qwen/qwen3.6-27b` is a reasoning model that spends ~3,100 tokens thinking before emitting JSON, so a budget that runs out mid-thought returns an *empty* completion — which Groq's `json_object` validator rejects as HTTP 400 `json_validate_failed`, not a 429, so backoff never recovers it. The investigator now requests `reasoning_effort: "none"` first (same verdict in ~256 tokens, which keeps a live demo inside the ~8,000 tok/min free tier) and escalates to a larger reasoning budget only if that specific 400 comes back. Separately, currency is now converted to rupees *before* the prompt: handing the model raw paise made it misstate magnitudes by 10×.
- [x] Dashboard UI (zero-dependency): live payment-stream playback, flagged queue with reason chips + score bars, case dossier with deterministic findings + in/out timeline sparkline, hash-chained audit ledger view with verify status. `npm run dev` → http://localhost:8898
- [x] Demo video: `docs/demo.mp4` — 47s pitch capture (title → problem → live stream → flagged queue → case dossier → advisory-only AI → hash-chained ledger → held-out eval → outro), cursor + caption overlays, 1584×860. Silent by design; narration captions are burned in.

## Run

```powershell
npm install        # once deps land
npm run slice      # single-world eval signal
npm run eval       # full train/held-out report
npm run generalize # unseen-typology test (the honest one)
npm run pipeline   # sim → detect → gate → audit ledger
npm run dev        # dashboard at http://localhost:8898
npm test
```

---
Lakshya · Razorpay AI Buildathon · Track 2 · Sept 5, 2026 deadline
