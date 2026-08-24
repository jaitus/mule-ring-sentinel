import { buildWorld } from "../sim/world.js";
import { scoreStream, applyThreshold } from "../detect/rules.js";
import { decide } from "../gate/policy.js";
import { investigate } from "./investigate.js";

const seedIdx = process.argv.indexOf("--seed");
const seed = seedIdx >= 0 ? Number(process.argv[seedIdx + 1]) : 42;
const mIdx = process.argv.indexOf("--merchant");
let merchantId = mIdx >= 0 ? process.argv[mIdx + 1] : null;

function fmt(paise) {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

const world = buildWorld({ seed, days: 30, legitCount: 320 });
const rows = scoreStream(world);
const flagged = applyThreshold(rows, 0.4);
const decisions = decide(flagged, { merchantCount: world.merchants.length });

if (!merchantId) {
  merchantId = decisions.find((d) => d.action === "ESCALATE")?.merchantId;
}
const decision = decisions.find((d) => d.merchantId === merchantId);
if (!decision) {
  console.log(`no flagged decision for ${merchantId ?? "(no escalated merchant found)"} on seed ${seed}`);
  process.exit(1);
}

const row = rows.find((r) => r.id === merchantId);
const events = world.events.filter((e) => e.m === merchantId);
const stats = { txnCount: events.length, totalInPaise: 0, totalOutPaise: 0, distinctInCp: 0, distinctOutCp: 0 };
const flows = new Map();
const dailyNet = new Array(world.days).fill(0);
for (const e of events) {
  if (e.dir === "in") {
    stats.totalInPaise += e.amount;
    dailyNet[e.d] += e.amount;
  } else {
    stats.totalOutPaise += e.amount;
    dailyNet[e.d] -= e.amount;
  }
  const f = flows.get(e.cp) ?? { cp: e.cp, inPaise: 0, outPaise: 0 };
  if (e.dir === "in") f.inPaise += e.amount;
  else f.outPaise += e.amount;
  flows.set(e.cp, f);
}
stats.distinctInCp = new Set(events.filter((e) => e.dir === "in").map((e) => e.cp)).size;
stats.distinctOutCp = new Set(events.filter((e) => e.dir === "out").map((e) => e.cp)).size;

const bundle = {
  merchantId,
  archetype: world.merchants.find((m) => m.id === merchantId)?.archetype,
  action: decision.action,
  score: row?.score,
  exposurePaise: decision.exposurePaise,
  reasons: decision.reasons,
  stats,
  dailyNet,
  topFlows: [...flows.values()].sort((a, b) => b.inPaise + b.outPaise - (a.inPaise + a.outPaise)).slice(0, 8),
};

console.log(`=== INVESTIGATOR :: ${merchantId} [${bundle.archetype}] seed=${seed} ===`);
console.log(`gate: ${decision.action} · score ${row?.score?.toFixed(2)} · exposure ${fmt(decision.exposurePaise)}`);
for (const why of decision.reasons) console.log(`  - ${why}`);
console.log("");
const inv = await investigate(bundle);
if (!inv.ok) {
  console.log(`AI investigation unavailable (${inv.reason}).`);
  console.log("Drop a GROQ_API_KEY into .env and re-run — the gate decision does not depend on it.");
  process.exit(0);
}
const d = inv.dossier;
console.log(`AI investigation (${inv.model}, advisory only — gate unchanged):`);
console.log(`  narrative: ${d.narrative}`);
console.log(`  typology:  ${d.typology_assessment}`);
for (const rf of d.risk_factors ?? []) console.log(`  risk:      ${rf}`);
for (const mf of d.mitigating_factors ?? []) console.log(`  mitigating: ${mf}`);
console.log(`  recommendation: ${d.recommended_action} (confidence ${d.confidence})`);
