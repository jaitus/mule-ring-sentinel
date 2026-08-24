import { buildWorld } from "../sim/world.js";
import { detectStream } from "../detect/rules.js";

const RECOVERY_RATE = 0.6;
const DISRUPTION_MULT = 0.4;
const DISRUPTION_DAYS = 14;
const REVIEW_COST = 500;

function fmtInr(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

const world = buildWorld({ seed: 42, days: 30, legitCount: 300, ringCount: 12 });
const results = detectStream(world);

let tp = 0, fp = 0, fn = 0, tn = 0;
let heldMuleInr = 0, disruptionCost = 0;
const flaggedMules = [], flaggedLegit = [];

for (const r of results) {
  const isMule = world.truth.get(r.id);
  if (r.flagged && isMule) {
    tp++;
    heldMuleInr += r.sumIn;
    flaggedMules.push(r);
  } else if (r.flagged && !isMule) {
    fp++;
    disruptionCost += DISRUPTION_MULT * r.sumIn * (DISRUPTION_DAYS / 10) + REVIEW_COST;
    flaggedLegit.push(r);
  } else if (!r.flagged && isMule) {
    fn++;
  } else {
    tn++;
  }
}

const precision = tp / Math.max(tp + fp, 1);
const recall = tp / Math.max(tp + fn, 1);
const f1 = (2 * precision * recall) / Math.max(precision + recall, 1e-9);
const netSaved = heldMuleInr * RECOVERY_RATE - disruptionCost;

console.log("=== MULE-RING SENTINEL :: SLICE EVAL ===");
console.log(`world: seed=42, ${world.merchants.length} merchants, ${world.days} days, rings injected: 12`);
console.log("");
console.log("|         | mule | legit |");
console.log("|---------|------|-------|");
console.log(`| flagged | ${String(tp).padStart(4)} | ${String(fp).padStart(5)} |`);
console.log(`| passed  | ${String(fn).padStart(4)} | ${String(tn).padStart(5)} |`);
console.log("");
console.log(`precision      ${(precision * 100).toFixed(1)}%`);
console.log(`recall         ${(recall * 100).toFixed(1)}%`);
console.log(`f1             ${f1.toFixed(3)}`);
console.log("");
console.log(`mule inflow held        ${fmtInr(heldMuleInr)}`);
console.log(`recovered @60%          ${fmtInr(heldMuleInr * RECOVERY_RATE)}`);
console.log(`FP disruption cost      ${fmtInr(disruptionCost)}  (${fp} good merchants hit)`);
console.log(`NET saved               ${fmtInr(netSaved)}`);
console.log("");
console.log("--- sample flagged cases ---");
for (const m of [...flaggedMules.slice(0, 3), ...flaggedLegit.slice(0, 2)]) {
  const tag = world.truth.get(m.id) ? "TRUE-MULE " : "FALSE-POS ";
  console.log(`${tag} ${m.id} [${m.archetype}] score=${m.score.toFixed(2)} pass=${(m.passThrough * 100).toFixed(0)}% fan=${m.fanOut.toFixed(2)} burst=${m.burstRatio.toFixed(1)}x`);
  for (const why of m.reasons) console.log(`           - ${why}`);
}
