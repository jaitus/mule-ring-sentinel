import { buildWorld } from "../sim/world.js";
import { detectStream } from "../detect/rules.js";
import { integerArg } from "../util/args.js";
import { confusion, netAt, RECOVERY_RATE, MISS_COST_FRAC } from "./metrics.js";

// This used to re-implement the NET arithmetic inline with its own copy of the
// constants, which is how a second source of truth drifts from the first. It now
// calls the same confusion()/netAt() the real eval uses, so a change to the cost
// model lands here too — including the miss cost, which this file never priced.

function fmtInr(paise) {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

const seed = integerArg(process.argv, "--seed", 42);
const world = buildWorld({ seed, days: 30, legitCount: 320 });
const rows = detectStream(world);
const c = confusion(world, rows);

const legitCount = world.merchants.length - [...world.truth.values()].filter(Boolean).length;

console.log("=== MULE-RING SENTINEL :: FULL-SIM EVAL ===");
console.log(`world: seed=${seed}, ${world.merchants.length} merchants (${legitCount} legit), ${world.days} days`);
console.log("");
console.log("|         | mule | legit |");
console.log("|---------|------|-------|");
console.log(`| flagged | ${String(c.tp).padStart(4)} | ${String(c.fp).padStart(5)} |`);
console.log(`| passed  | ${String(c.fn).padStart(4)} | ${String(c.tn).padStart(5)} |`);
console.log("");
console.log(`precision      ${(c.precision * 100).toFixed(1)}%`);
console.log(`recall         ${(c.recall * 100).toFixed(1)}%`);
console.log(`f1             ${c.f1.toFixed(3)}`);
console.log("");
console.log("typology           caught/total");
for (const [t, v] of Object.entries(c.byTypology)) {
  console.log(`${t.padEnd(20)} ${v.caught}/${v.total}`);
}
console.log("");
console.log(`mule inflow held        ${fmtInr(c.heldPaise)}`);
console.log(`recovered @${(RECOVERY_RATE * 100).toFixed(0)}%          ${fmtInr(c.heldPaise * RECOVERY_RATE)}`);
console.log(`FP disruption cost     -${fmtInr(c.disruptionPaise)}  (${c.fp} good merchants hit)`);
console.log(`missed-conduit cost    -${fmtInr(c.missCostPaise)}  (${c.fn} missed @ ${MISS_COST_FRAC} of inflow)`);
console.log(`NET saved               ${fmtInr(netAt(c))}`);

const flaggedLegit = rows.filter((r) => r.flagged && !world.truth.get(r.id));
if (flaggedLegit.length) {
  console.log("");
  console.log("--- false positives (why) ---");
  for (const m of flaggedLegit.slice(0, 5)) {
    console.log(`FALSE-POS  ${m.id} [${m.archetype}] score=${m.score.toFixed(2)}`);
    for (const why of m.reasons) console.log(`           - ${why}`);
  }
}
