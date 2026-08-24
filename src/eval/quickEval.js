import { buildWorld } from "../sim/world.js";
import { detectStream } from "../detect/rules.js";

function fmtInr(paise) {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const seed = arg("--seed", 42);
const world = buildWorld({ seed, days: 30, legitCount: 320 });
const results = detectStream(world);

const typologyOf = new Map();
for (const r of world.ringMeta) for (const m of r.members) typologyOf.set(m, r.typology);

let tp = 0, fp = 0, fn = 0, tn = 0;
let heldMulePaise = 0, disruptionPaise = 0;
const byTypology = {};
const flaggedLegit = [];

const RECOVERY_RATE = 0.6;

for (const r of results) {
  const isMule = world.truth.get(r.id);
  if (r.flagged && isMule) {
    tp++;
    heldMulePaise += r.sumIn;
    const t = typologyOf.get(r.id);
    byTypology[t] = (byTypology[t] ?? { caught: 0, total: 0 });
    byTypology[t].caught++;
  } else if (!r.flagged && isMule) {
    fn++;
    const t = typologyOf.get(r.id);
    byTypology[t] = (byTypology[t] ?? { caught: 0, total: 0 });
  } else if (r.flagged && !isMule) {
    fp++;
    disruptionPaise += 0.4 * r.sumIn * 1.4 + 50000;
    flaggedLegit.push(r);
  } else {
    tn++;
  }
}
const totals = {};
for (const r of world.ringMeta) {
  for (const m of r.members) {
    const t = r.typology;
    totals[t] = (totals[t] ?? 0) + 1;
  }
}

const precision = tp / Math.max(tp + fp, 1);
const recall = tp / Math.max(tp + fn, 1);
const f1 = (2 * precision * recall) / Math.max(precision + recall, 1e-9);

console.log("=== MULE-RING SENTINEL :: FULL-SIM EVAL ===");
console.log(`world: seed=${seed}, ${world.merchants.length} merchants (${world.merchants.length - Object.values(totals).reduce((a, b) => a + b, 0)} legit), 30 days`);
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
console.log("typology           caught/total");
for (const [t, n] of Object.entries(totals)) {
  const c = byTypology[t]?.caught ?? 0;
  console.log(`${t.padEnd(20)} ${c}/${n}`);
}
console.log("");
console.log(`mule inflow held        ${fmtInr(heldMulePaise)}`);
console.log(`recovered @60%          ${fmtInr(heldMulePaise * RECOVERY_RATE)}`);
console.log(`FP disruption cost      ${fmtInr(disruptionPaise)}  (${fp} good merchants hit)`);
console.log(`NET saved               ${fmtInr(heldMulePaise * RECOVERY_RATE - disruptionPaise)}`);
if (flaggedLegit.length) {
  console.log("");
  console.log("--- false positives (why) ---");
  for (const m of flaggedLegit.slice(0, 5)) {
    console.log(`FALSE-POS  ${m.id} [${m.archetype}] score=${m.score.toFixed(2)}`);
    for (const why of m.reasons) console.log(`           - ${why}`);
  }
}
