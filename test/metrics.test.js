import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confusion,
  netAt,
  RECOVERY_RATE,
  MISS_COST_FRAC,
  DISRUPTION_FRAC,
  DISRUPTION_FIXED_PAISE,
} from "../src/eval/metrics.js";
import { baselineNone, baselinePassThroughTopK, baselineVolume } from "../src/eval/baselines.js";

// Minimal hand-built world so every rupee in the assertions is checkable by hand.
function world(spec) {
  const truth = new Map();
  const members = [];
  for (const s of spec) {
    truth.set(s.id, s.mule);
    if (s.mule) members.push(s.id);
  }
  return {
    merchants: spec.map((s) => ({ id: s.id, archetype: "kirana" })),
    truth,
    ringMeta: members.length ? [{ typology: "layering_fan_out", members }] : [],
    days: 30,
  };
}
const rows = (spec) => spec.map((s) => ({ id: s.id, sumIn: s.sumIn, sumOut: s.sumIn, flagged: s.flagged }));

test("a missed mule is priced, not free", () => {
  const spec = [{ id: "M1", mule: true, sumIn: 10_000_000, flagged: false }];
  const c = confusion(world(spec), rows(spec));
  assert.equal(c.fn, 1);
  assert.equal(c.tp, 0);
  assert.equal(c.missedInflowPaise, 10_000_000);
  assert.equal(c.missCostPaise, 10_000_000 * MISS_COST_FRAC);
  // The whole point: NET must be negative when a conduit gets through.
  assert.equal(netAt(c), -10_000_000 * MISS_COST_FRAC);
  assert.ok(netAt(c) < 0, "missing a mule must cost money");
});

test("catching that same mule instead is worth the recovery", () => {
  const spec = [{ id: "M1", mule: true, sumIn: 10_000_000, flagged: true }];
  const c = confusion(world(spec), rows(spec));
  assert.equal(c.fn, 0);
  assert.equal(c.missCostPaise, 0);
  assert.equal(netAt(c), 10_000_000 * RECOVERY_RATE);
});

test("a wrongful hold still costs its disruption plus the fixed fee", () => {
  const spec = [{ id: "M1", mule: false, sumIn: 10_000_000, flagged: true }];
  const c = confusion(world(spec), rows(spec));
  assert.equal(c.fp, 1);
  assert.equal(netAt(c), -(10_000_000 * DISRUPTION_FRAC) - DISRUPTION_FIXED_PAISE);
});

test("netAt can re-price miss cost without recomputing the confusion", () => {
  const spec = [
    { id: "M1", mule: true, sumIn: 10_000_000, flagged: false },
    { id: "M2", mule: true, sumIn: 10_000_000, flagged: true },
  ];
  const c = confusion(world(spec), rows(spec));
  const atZero = netAt(c, RECOVERY_RATE, 1, DISRUPTION_FIXED_PAISE, 0);
  const atHalf = netAt(c, RECOVERY_RATE, 1, DISRUPTION_FIXED_PAISE, 0.5);
  // missFrac=0 reproduces the old one-sided objective, so it must be strictly better
  assert.equal(atZero, 10_000_000 * RECOVERY_RATE);
  assert.equal(atHalf, 10_000_000 * RECOVERY_RATE - 10_000_000 * 0.5);
  assert.ok(atZero > atHalf, "pricing misses can only lower NET, never raise it");
});

test("the null baseline flags nobody and is no longer free", () => {
  const spec = [
    { id: "M1", mule: true, sumIn: 10_000_000, flagged: true },
    { id: "M2", mule: false, sumIn: 5_000_000, flagged: true },
  ];
  const w = world(spec);
  const none = baselineNone(rows(spec));
  assert.equal(none.filter((r) => r.flagged).length, 0, "must flag nothing");
  const c = confusion(w, none);
  assert.equal(c.tp, 0);
  assert.equal(c.fp, 0);
  assert.equal(c.fn, 1);
  // Doing nothing used to score exactly 0 and beat every other baseline.
  assert.ok(netAt(c) < 0, "doing nothing must cost the misses it allows");
  assert.equal(netAt(c), -10_000_000 * MISS_COST_FRAC);
});

test("pass-through top-k is budget-matched and ranks by ratio", () => {
  // sumOut/sumIn: A=0.95, B=0.50, C=0.99 — top 2 must be C then A
  const spec = [
    { id: "A", mule: false, sumIn: 10_000_000 },
    { id: "B", mule: false, sumIn: 10_000_000 },
    { id: "C", mule: false, sumIn: 10_000_000 },
  ];
  const r = [
    { id: "A", sumIn: 10_000_000, sumOut: 9_500_000 },
    { id: "B", sumIn: 10_000_000, sumOut: 5_000_000 },
    { id: "C", sumIn: 10_000_000, sumOut: 9_900_000 },
  ];
  const out = baselinePassThroughTopK(r, 2);
  assert.equal(out.filter((x) => x.flagged).length, 2, "must honour the budget exactly");
  assert.equal(out.find((x) => x.id === "C").flagged, true);
  assert.equal(out.find((x) => x.id === "A").flagged, true);
  assert.equal(out.find((x) => x.id === "B").flagged, false);
});

test("pass-through top-k ignores merchants below the activity floor", () => {
  // a dust-volume merchant has a meaningless ratio and must not consume budget
  const r = [
    { id: "dust", sumIn: 1000, sumOut: 1000 },
    { id: "real", sumIn: 10_000_000, sumOut: 6_000_000 },
  ];
  const out = baselinePassThroughTopK(r, 1);
  assert.equal(out.find((x) => x.id === "real").flagged, true);
  assert.equal(out.find((x) => x.id === "dust").flagged, false);
});

test("volume top-k honours its budget too", () => {
  const r = [
    { id: "A", sumIn: 3, sumOut: 0 },
    { id: "B", sumIn: 2, sumOut: 0 },
    { id: "C", sumIn: 1, sumOut: 0 },
  ];
  const out = baselineVolume(r, 2);
  assert.deepEqual(
    out.filter((x) => x.flagged).map((x) => x.id),
    ["A", "B"]
  );
});
