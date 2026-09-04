// HELD-OUT TYPOLOGIES — generalization test set.
//
// PROTOCOL (this is the point of the file, so it is stated first):
// The four typologies in ./index.js were written alongside the detector rules.
// Reporting recall against those alone measures whether the rules recognise the
// patterns their own author injected — a closed loop that can be made to produce
// any number you like.
//
// These two typologies exist to break that loop. Both are written from published
// AML typology descriptions, NOT from the detector's feature set, and the
// detector is scored against them at the SAME operating point (thr=0.40) chosen
// on the original train worlds, with no re-tuning of any kind.
//
// They are deliberately excluded from DEFAULT_RING_MIX so they can never
// contaminate the headline held-out numbers.
//
// Both also recruit EXISTING ordinary merchants rather than creating fresh
// accounts. That matters: the four original typologies all sit on
// `new_onboarding` or `dormant` accounts, which hands the scorer a
// thin-history signal worth 0.15 of the score. A ring built on a going concern
// gets none of it — which is both more realistic and strictly harder.

import { makeEmitters } from "./index.js";

// Ordinary small businesses. Excludes dormant/new_onboarding (thin history) and
// the high-pass-through confusables (dropshipper, travel, contractor, b2b).
const ORDINARY = ["kirana", "d2c", "saas", "freelancer"];

// ---------------------------------------------------------------------------
// PEEL CHAIN (a.k.a. peeling chain / layered forwarding)
//
// FATF/Europol description: value enters the first account in a chain, which
// forwards the large majority onward and retains a small "peel" as its cut.
// Each subsequent hop repeats. The final account extracts to cash-out points.
// Structurally the opposite of fan-out: each hop is close to one-in, one-out,
// which is why it is a fair test of a detector built around fan-out and bursts.
// ---------------------------------------------------------------------------
function genPeelChain(ctx, members) {
  const { rng, days } = ctx;
  const e = makeEmitters(ctx);
  const start = rng.int(1, Math.max(1, days - members.length - 3));

  let carried = 0;
  const seeds = rng.int(2, 4);
  for (let i = 0; i < seeds; i++) {
    const amount = rng.int(1500000, 4500000);
    e.inPayment(members[0], start, `pers:${ctx.cpSeq++}`, amount);
    carried += amount;
  }

  for (let h = 0; h < members.length - 1; h++) {
    const day = Math.min(days - 1, start + h);
    const nextDay = Math.min(days - 1, start + h + 1);
    const forward = carried * rng.float(0.9, 0.95); // peels 5–10% per hop
    const hopAcct = `chain:${ctx.ringSeq}:${h}`;
    e.outPayout(members[h], day, hopAcct, forward);
    e.inPayment(members[h + 1], nextDay, hopAcct, forward);
    carried = forward;
  }

  const last = members[members.length - 1];
  const exitDay = Math.min(days - 1, start + members.length);
  const outs = rng.int(2, 4);
  let remaining = carried * 0.9;
  for (let i = 0; i < outs && remaining > 50000; i++) {
    const amount = i === outs - 1 ? remaining : remaining * rng.float(0.35, 0.6);
    e.outPayout(last, exitDay, `pers:${ctx.cpSeq++}`, amount);
    remaining -= amount;
  }

  return { typology: "peel_chain", members };
}

// ---------------------------------------------------------------------------
// SLOW DRAIN (low-and-slow conduit / structured funnel account)
//
// The evasive real-world case. A going-concern merchant account receives a
// steady stream of small structured credits from unrelated one-time payers for
// the whole month, and drips roughly 60% onward to a small rotating set of
// payees, retaining the rest so the account reads as an ordinary business
// margin. Nothing about it is bursty and nothing passes through at 90%.
//
// This is deliberately the hard case: it is what a launderer does *once they
// know* burst-and-fan-out detection exists.
// ---------------------------------------------------------------------------
function genSlowDrain(ctx, [mId]) {
  const { rng, days } = ctx;
  const e = makeEmitters(ctx);

  const payees = [];
  for (let i = 0; i < rng.int(3, 4); i++) payees.push(`drain:${ctx.ringSeq}:${i}`);

  let pending = 0;
  for (let d = 2; d < days; d++) {
    const n = rng.int(6, 14);
    for (let i = 0; i < n; i++) {
      const amount = rng.int(800000, 4500000); // ₹8,000–₹45,000 structured credits
      e.inPayment(mId, d, `pers:${ctx.cpSeq++}`, amount);
      pending += amount;
    }
    // Drip onward every other day, never in a burst, always well under the
    // pass-through ratio a fan-out detector is tuned for.
    if (d % 2 === 0 && pending > 0) {
      const out = pending * rng.float(0.55, 0.65);
      e.outPayout(mId, d, payees[rng.int(0, payees.length - 1)], out);
      pending = 0;
    }
  }

  return { typology: "slow_drain", members: [mId] };
}

export const UNSEEN_GENERATORS = {
  peel_chain: { gen: genPeelChain, hijackFrom: ORDINARY, members: 4 },
  slow_drain: { gen: genSlowDrain, hijackFrom: ORDINARY, members: 1 },
};

export const UNSEEN_RING_MIX = {
  peel_chain: 3,
  slow_drain: 4,
};
