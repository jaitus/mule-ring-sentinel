import { buildWorld } from "../sim/world.js";
import { scoreStream, applyThreshold } from "../detect/rules.js";
import { decide, summarize } from "../gate/policy.js";
import { Ledger, verify } from "../audit/ledger.js";
import { mkdirSync } from "node:fs";
import { integerArg } from "../util/args.js";

const seed = integerArg(process.argv, "--seed", 42);
const threshold = 0.4;

function fmt(paise) {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

mkdirSync("runs", { recursive: true });
const ledgerPath = `runs/audit-${seed}.jsonl`;
const ledger = new Ledger(ledgerPath);

const world = buildWorld({ seed, days: 30, legitCount: 320 });
const rows = applyThreshold(scoreStream(world), threshold);
const decisions = decide(rows, { merchantCount: world.merchants.length });

for (const d of decisions) {
  if (d.action === "RELEASE") continue;
  ledger.append({
    type: "decision",
    merchantId: d.merchantId,
    action: d.action,
    score: Number(d.score.toFixed(3)),
    exposurePaise: d.exposurePaise,
    reasons: d.reasons,
    guardrails: d.guardrails,
    autoReleaseInDays: d.autoReleaseInDays,
  });
}

const sum = summarize(decisions);
console.log(`=== PIPELINE :: seed=${seed}, ${world.merchants.length} merchants, thr=${threshold} ===`);
console.log("");
console.log(`ESCALATE  ${String(sum.counts.ESCALATE).padStart(3)}   (manual review queue)`);
console.log(`HOLD      ${String(sum.counts.HOLD).padStart(3)}   settlements paused, auto-release in 14d`);
console.log(`WATCH     ${String(sum.counts.WATCH).padStart(3)}   logged only, no money action`);
console.log(`RELEASE   ${String(sum.counts.RELEASE).padStart(3)}`);
console.log("");
console.log(`funds held: ${fmt(sum.heldPaise)}`);
console.log("");
console.log("--- sample ESCALATE case ---");
const esc = decisions.find((d) => d.action === "ESCALATE");
if (esc) {
  console.log(`${esc.merchantId} [${esc.archetype}] score=${esc.score.toFixed(2)} exposure=${fmt(esc.exposurePaise)}`);
  for (const why of esc.reasons) console.log(`  - ${why}`);
}
console.log("");
const v = verify(ledgerPath);
console.log(`ledger: ${ledgerPath} → ${v.checked} entries, chain verify: ${v.ok ? "OK (tamper-evident)" : `FAILED: ${v.reason}`}`);
