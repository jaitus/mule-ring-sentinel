import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld } from "../src/sim/world.js";
import { detectStream } from "../src/detect/rules.js";

test("same seed produces identical worlds", () => {
  const a = buildWorld({ seed: 7, days: 20, legitCount: 50, ringCount: 3 });
  const b = buildWorld({ seed: 7, days: 20, legitCount: 50, ringCount: 3 });
  assert.equal(a.events.length, b.events.length);
  assert.deepEqual(a.events[0], b.events[0]);
});

test("streaming detector separates rings from legit on fixed seed", () => {
  const world = buildWorld({ seed: 42, days: 30, legitCount: 300 });
  const results = detectStream(world);
  let tp = 0, fp = 0, fn = 0;
  for (const r of results) {
    const isMule = world.truth.get(r.id);
    if (r.flagged && isMule) tp++;
    if (r.flagged && !isMule) fp++;
    if (!r.flagged && isMule) fn++;
  }
  assert.equal(tp + fn, 16);
  assert.ok(recall(tp, fn) >= 0.75, `recall too low: ${tp}/16`);
  assert.ok(fp <= 10, `too many false positives: ${fp}`);
});

function recall(tp, fn) {
  return tp / Math.max(tp + fn, 1);
}
