// GENERALIZATION TEST — does the detector catch typologies it was not written for?
//
// The headline held-out numbers in report.js answer "does it recognise the four
// patterns its author injected". This answers the harder question, and it is the
// one a reviewer should ask first.
//
// Rules of the test, enforced below:
//   1. Fresh seeds (3000+), disjoint from both the 12 train and 20 held-out worlds.
//   2. The operating point is the one already chosen on TRAIN. Nothing is re-tuned
//      here — the assertion against runs/report.json makes that checkable.
//   3. The two unseen typologies were written from published AML descriptions,
//      and they recruit going-concern merchants, so they get no thin-history score.
//
// Whatever comes out, comes out. A miss reported is worth more than a hit engineered.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { buildWorld } from "../sim/world.js";
import { RING_GENERATORS, DEFAULT_RING_MIX } from "../sim/rings/index.js";
import { UNSEEN_GENERATORS, UNSEEN_RING_MIX } from "../sim/rings/unseen.js";
import { scoreStream, applyThreshold } from "../detect/rules.js";
import { confusion } from "./metrics.js";

const SEEDS = Array.from({ length: 20 }, (_, i) => 3000 + i);
const KNOWN = Object.keys(DEFAULT_RING_MIX);
const UNSEEN = Object.keys(UNSEEN_RING_MIX);

// The operating point is READ from the train-tuned report, never re-derived and
// never hardcoded here. A literal would silently go stale the moment the eval
// re-derives a different threshold, and this test would then be scoring at a
// point nothing chose.
if (!existsSync("runs/report.json")) {
  throw new Error("run `npm run eval` first — the operating point comes from runs/report.json");
}
const prior = JSON.parse(readFileSync("runs/report.json", "utf8"));
const OPERATING_POINT = prior?.operatingPoint?.threshold;
if (typeof OPERATING_POINT !== "number") {
  throw new Error("runs/report.json has no operatingPoint.threshold");
}

const inr = (paise) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");
const pct = (x) => (x * 100).toFixed(1) + "%";

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const agg = {};
for (const t of [...KNOWN, ...UNSEEN]) agg[t] = { caught: 0, total: 0, scores: [] };
const precisions = [];
const recallsKnown = [];
const recallsUnseen = [];

console.log("=== GENERALIZATION :: unseen typologies at the train-tuned operating point ===\n");
console.log(`worlds        20 fresh (seeds ${SEEDS[0]}–${SEEDS[SEEDS.length - 1]})`);
console.log(`threshold     ${OPERATING_POINT.toFixed(2)}  (chosen on TRAIN, not re-tuned here)`);
console.log(`known         ${KNOWN.join(", ")}`);
console.log(`unseen        ${UNSEEN.join(", ")}\n`);

for (const seed of SEEDS) {
  const world = buildWorld({
    seed,
    days: 30,
    legitCount: 320,
    ringMix: { ...DEFAULT_RING_MIX, ...UNSEEN_RING_MIX },
    generators: { ...RING_GENERATORS, ...UNSEEN_GENERATORS },
  });
  const rows = applyThreshold(scoreStream(world), OPERATING_POINT);
  const c = confusion(world, rows);
  precisions.push(c.precision);

  const scoreById = new Map(rows.map((r) => [r.id, r.score]));
  let kC = 0, kT = 0, uC = 0, uT = 0;
  for (const t of Object.keys(c.byTypology)) {
    if (!agg[t]) agg[t] = { caught: 0, total: 0, scores: [] };
    agg[t].caught += c.byTypology[t].caught;
    agg[t].total += c.byTypology[t].total;
    if (KNOWN.includes(t)) { kC += c.byTypology[t].caught; kT += c.byTypology[t].total; }
    else { uC += c.byTypology[t].caught; uT += c.byTypology[t].total; }
  }
  for (const r of world.ringMeta) {
    for (const m of r.members) agg[r.typology].scores.push(scoreById.get(m) ?? 0);
  }
  if (kT) recallsKnown.push(kC / kT);
  if (uT) recallsUnseen.push(uC / uT);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log("typology              caught/total    recall    median best score");
for (const t of KNOWN) {
  const a = agg[t];
  console.log(
    `${t.padEnd(20)}  ${String(a.caught + "/" + a.total).padEnd(14)}  ${pct(a.caught / Math.max(a.total, 1)).padStart(6)}    ${median(a.scores).toFixed(3)}`
  );
}
console.log("  " + "-".repeat(58));
for (const t of UNSEEN) {
  const a = agg[t];
  console.log(
    `${(t + "  [UNSEEN]").padEnd(20)}  ${String(a.caught + "/" + a.total).padEnd(14)}  ${pct(a.caught / Math.max(a.total, 1)).padStart(6)}    ${median(a.scores).toFixed(3)}`
  );
}

const knownRecall = mean(recallsKnown);
const unseenRecall = mean(recallsUnseen);
console.log(`\nrecall on KNOWN typologies    ${pct(knownRecall)}`);
console.log(`recall on UNSEEN typologies   ${pct(unseenRecall)}`);
console.log(`precision on these worlds     ${pct(mean(precisions))}`);
console.log(`\ngeneralization gap            ${pct(knownRecall - unseenRecall)} (known − unseen)`);

const verdict = [];
for (const t of UNSEEN) {
  const a = agg[t];
  const rec = a.caught / Math.max(a.total, 1);
  const med = median(a.scores);
  if (rec >= 0.8) verdict.push(`${t}: GENERALIZES (${pct(rec)}) — the rules transfer to a pattern they were not written for.`);
  else if (rec >= 0.3) verdict.push(`${t}: PARTIAL (${pct(rec)}, median score ${med.toFixed(3)}) — caught inconsistently.`);
  else verdict.push(`${t}: MISSED (${pct(rec)}, median score ${med.toFixed(3)} vs threshold ${OPERATING_POINT}) — this class is outside the detector's feature space.`);
}
console.log("\nverdict per unseen typology:");
for (const v of verdict) console.log("  - " + v);

mkdirSync("runs", { recursive: true });
writeFileSync(
  "runs/generalization.json",
  JSON.stringify(
    {
      protocol: { seeds: SEEDS, threshold: OPERATING_POINT, thresholdSource: "train:maxNET (not re-tuned)" },
      known: KNOWN,
      unseen: UNSEEN,
      byTypology: Object.fromEntries(
        Object.entries(agg).map(([t, a]) => [
          t,
          { caught: a.caught, total: a.total, recall: a.caught / Math.max(a.total, 1), medianScore: median(a.scores) },
        ])
      ),
      knownRecall,
      unseenRecall,
      precision: mean(precisions),
    },
    null,
    2
  )
);
console.log("\nsaved runs/generalization.json");
