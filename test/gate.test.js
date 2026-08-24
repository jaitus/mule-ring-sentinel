import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, summarize } from "../src/gate/policy.js";

function row(score, sumIn = 10000000) {
  return { id: `M${score}`, archetype: "new_onboarding", score, day: 10, reasons: [], sumIn };
}

test("tiers map scores to actions", () => {
  const d = decide([row(0.7), row(0.5), row(0.35), row(0.1)]);
  assert.equal(d[0].action, "ESCALATE");
  assert.equal(d[1].action, "HOLD");
  assert.equal(d[2].action, "WATCH");
  assert.equal(d[3].action, "RELEASE");
});

test("batch hold cap downgrades weakest holds", () => {
  const rows = [];
  for (let i = 0; i < 1000; i++) rows.push({ id: `M${i}`, archetype: "new_onboarding", score: 0.45 + i / 100000, day: 10, reasons: [], sumIn: 100000 });
  const d = decide(rows, { merchantCount: 1000 });
  const hardHeld = d.filter((x) => x.action === "HOLD" || x.action === "ESCALATE").length;
  assert.ok(hardHeld <= Math.floor(1000 * 0.05), `cap violated: ${hardHeld}`);
  assert.ok(d.some((x) => x.guardrails.some((g) => g.startsWith("downgraded"))));
});

test("escalates never downgraded by cap", () => {
  const rows = [];
  for (let i = 0; i < 2000; i++) rows.push({ id: `M${i}`, archetype: "new_onboarding", score: i < 50 ? 0.65 : 0.45, day: 10, reasons: [], sumIn: 100000 });
  const d = decide(rows, { merchantCount: 2000 });
  assert.equal(d.filter((x) => x.action === "ESCALATE").length, 50);
});

test("summarize totals exposure of held funds only", () => {
  const s = summarize(decide([row(0.7, 500000), row(0.5, 700000), row(0.35, 900000)]));
  assert.equal(s.counts.HOLD, 1);
  assert.equal(s.counts.WATCH, 1);
  assert.equal(s.heldPaise, 1200000);
});
