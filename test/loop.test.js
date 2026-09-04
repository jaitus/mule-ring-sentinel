import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLoopEdgeDays, cumulativeLoopCounts } from "../src/detect/features.js";

let seq = 0;
const ev = (m, d, dir, cp, amount = 1000000, kind = dir === "in" ? "payment" : "payout") => ({
  pay: `pay_${seq++}`,
  m,
  d,
  dir,
  cp,
  amount,
  method: dir === "in" ? "upi" : "payout",
  kind,
});

const edgesFor = (events, merchant) => {
  const perDay = computeLoopEdgeDays({ events }).get(merchant);
  if (!perDay) return [];
  return [...perDay.entries()].map(([d, cps]) => ({ day: d, count: cps.size })).sort((a, b) => a.day - b.day);
};

test("loop edge is found whichever leg happens first", () => {
  // outbound first, then the account funds someone else (the chained-typology order)
  const outFirst = [ev("M1", 1, "out", "X"), ev("M2", 2, "in", "X")];
  // inbound first, then a merchant pays into that account
  const inFirst = [ev("M2", 1, "in", "X"), ev("M1", 2, "out", "X")];

  assert.equal(edgesFor(outFirst, "M1").length, 1, "out-then-in must produce an edge");
  assert.equal(edgesFor(inFirst, "M1").length, 1, "in-then-out must produce an edge");
});

test("the edge is credited on the day the second leg is observed, never earlier", () => {
  const events = [ev("M1", 3, "out", "X"), ev("M2", 9, "in", "X")];
  const edges = edgesFor(events, "M1");
  assert.deepEqual(edges, [{ day: 9, count: 1 }]);
  // Causality: scoring day 3 must not see an edge that only became knowable on day 9.
  const timeline = cumulativeLoopCounts(computeLoopEdgeDays({ events })).get("M1");
  assert.ok(timeline.every((t) => t.d >= 9), "no edge may be dated before its second leg");
});

test("a counterparty that only ever funds this same merchant is not a loop", () => {
  const events = [ev("M1", 1, "out", "X"), ev("M1", 2, "in", "X")];
  assert.equal(edgesFor(events, "M1").length, 0);
});

test("refunds are not loop edges", () => {
  const events = [ev("M1", 1, "out", "X", 1000000, "refund"), ev("M2", 2, "in", "X")];
  assert.equal(edgesFor(events, "M1").length, 0);
});

test("a four-hop chain credits an edge to every forwarding hop", () => {
  // M1 -> c1 -> M2 -> c2 -> M3 -> c3 -> M4, each hop paying out before the next receives
  const events = [
    ev("M1", 1, "out", "c1"),
    ev("M2", 2, "in", "c1"),
    ev("M2", 2, "out", "c2"),
    ev("M3", 3, "in", "c2"),
    ev("M3", 3, "out", "c3"),
    ev("M4", 4, "in", "c3"),
  ];
  const hits = computeLoopEdgeDays({ events });
  for (const m of ["M1", "M2", "M3"]) {
    assert.ok(hits.has(m), `${m} forwards through a shared account and must show an edge`);
  }
  assert.equal(hits.has("M4"), false, "the terminal hop pays out to nobody here");
});

test("cumulative counts are monotonic and de-duplicated per counterparty", () => {
  const events = [
    ev("M1", 1, "out", "X"),
    ev("M2", 2, "in", "X"),
    ev("M1", 3, "out", "X"), // same counterparty again — must not double-count
    ev("M1", 4, "out", "Y"),
    ev("M3", 5, "in", "Y"),
  ];
  const timeline = cumulativeLoopCounts(computeLoopEdgeDays({ events })).get("M1");
  const counts = timeline.map((t) => t.count);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], "counts must be monotonic");
  assert.equal(counts.at(-1), 2, "two distinct loop counterparties");
});
