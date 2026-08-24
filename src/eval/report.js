import { scoreWorld } from "./baselines.js";
import { applyThreshold } from "../detect/rules.js";
import { confusion, netAt, RECOVERY_RATE } from "./metrics.js";
import { baselineVolume, baselinePassThrough, baselineRandom } from "./baselines.js";
import { writeFileSync, mkdirSync } from "node:fs";

const TRAIN_SEEDS = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011];
const HELDOUT_SEEDS = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019];
const THRESHOLDS = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

function fmt(paise) {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

function mean(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function std(a) {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

console.log("=== EVAL HARNESS :: train → held-out protocol ===\n");

console.log(`[phase A] threshold sweep on ${TRAIN_SEEDS.length} TRAIN worlds (never touch held-out)\n`);
const scored = new Map();
for (const s of TRAIN_SEEDS) scored.set("t" + s, scoreWorld(s));
for (const s of HELDOUT_SEEDS) scored.set("h" + s, scoreWorld(s));

console.log("thr    prec     rec      NET/world");
const sweep = [];
for (const t of THRESHOLDS) {
  const cs = TRAIN_SEEDS.map((s) => confusion(scored.get("t" + s).world, applyThreshold(scored.get("t" + s).rows, t)));
  const p = mean(cs.map((c) => c.precision));
  const r = mean(cs.map((c) => c.recall));
  const n = mean(cs.map((c) => netAt(c)));
  sweep.push({ t, p, r, n });
  console.log(`${t.toFixed(2)}   ${(p * 100).toFixed(1)}%   ${(r * 100).toFixed(1)}%   ${fmt(n)}`);
}

const best = sweep.reduce((a, b) => (b.n > a.n ? b : a));
console.log(`\noperating point chosen on TRAIN: threshold=${best.t.toFixed(2)} (max NET)\n`);

console.log(`[phase B] HELD-OUT evaluation on ${HELDOUT_SEEDS.length} unseen worlds @ thr=${best.t.toFixed(2)}\n`);
const heldoutCs = HELDOUT_SEEDS.map((s) => {
  const { world, rows } = scored.get("h" + s);
  return confusion(world, applyThreshold(rows, best.t));
});
const P = heldoutCs.map((c) => c.precision);
const R = heldoutCs.map((c) => c.recall);
const N = heldoutCs.map((c) => netAt(c));
const typAgg = {};
for (const c of heldoutCs) {
  for (const [t, v] of Object.entries(c.byTypology)) {
    typAgg[t] = typAgg[t] ?? { caught: 0, total: 0 };
    typAgg[t].caught += v.caught;
    typAgg[t].total += v.total;
  }
}
console.log(`precision   ${(mean(P) * 100).toFixed(1)}%  ±${(std(P) * 100).toFixed(1)}`);
console.log(`recall      ${(mean(R) * 100).toFixed(1)}%  ±${(std(R) * 100).toFixed(1)}`);
console.log(`NET/world   ${fmt(mean(N))}  ±${fmt(std(N))}`);
console.log("");
console.log("typology            caught/total");
for (const [t, v] of Object.entries(typAgg)) {
  console.log(`${t.padEnd(20)} ${v.caught}/${v.total}`);
}

console.log(`\n[phase C] budget-matched baselines on the same held-out worlds\n`);
let winVol = 0, winPt = 0, winRnd = 0;
const detN = [];
const volN = [], ptN = [], rndN = [];
HELDOUT_SEEDS.forEach((s, i) => {
  const { world, rows } = scored.get("h" + s);
  const det = confusion(world, applyThreshold(rows, best.t));
  const vol = confusion(world, baselineVolume(rows, det.flagCount));
  const pt = confusion(world, baselinePassThrough(rows));
  const rnd = confusion(world, baselineRandom(rows, det.flagCount, s * 31 + 7));
  const dn = netAt(det), vn = netAt(vol), pn = netAt(pt), rn = netAt(rnd);
  detN.push(dn); volN.push(vn); ptN.push(pn); rndN.push(rn);
  if (dn > vn) winVol++;
  if (dn > pn) winPt++;
  if (dn > rn) winRnd++;
});
console.log(`detector NET/world     ${fmt(mean(detN))}`);
console.log(`volume-top-k NET       ${fmt(mean(volN))}   detector wins ${winVol}/${HELDOUT_SEEDS.length} worlds`);
console.log(`pass-through-only NET  ${fmt(mean(ptN))}   detector wins ${winPt}/${HELDOUT_SEEDS.length} worlds`);
console.log(`random-at-budget NET   ${fmt(mean(rndN))}   detector wins ${winRnd}/${HELDOUT_SEEDS.length} worlds`);

console.log(`\n[phase D] sensitivity of NET on held-out (recovery × wrongful-hold cost scale)\n`);
console.log("recov\\frac" + " ".repeat(5) + "0.7x".padStart(12) + "1.4x".padStart(12) + "2.1x".padStart(12));
for (const rec of [0.3, 0.45, 0.6, 0.75, 0.9]) {
  const row = [0.7, 1.4, 2.1].map((fscale) => {
    const ns = heldoutCs.map((c) => netAt(c, rec, fscale));
    return fmt(mean(ns)).padStart(12);
  });
  console.log(`${(rec * 100).toFixed(0)}%`.padEnd(10) + row.join(""));
}

mkdirSync("runs", { recursive: true });
writeFileSync(
  "runs/report.json",
  JSON.stringify(
    {
      protocol: { train: TRAIN_SEEDS, heldout: HELDOUT_SEEDS },
      operatingPoint: { threshold: best.t, chosenOn: "train:maxNET" },
      heldout: {
        precisionMean: mean(P), precisionStd: std(P),
        recallMean: mean(R), recallStd: std(R),
        netMeanPaise: mean(N), netStdPaise: std(N),
        byTypology: typAgg,
      },
      baselines: {
        volumeTopK: { netMeanPaise: mean(volN), wins: winVol },
        passThroughOnly: { netMeanPaise: mean(ptN), wins: winPt },
        randomAtBudget: { netMeanPaise: mean(rndN), wins: winRnd },
      },
      constants: { RECOVERY_RATE },
    },
    null,
    2
  )
);
console.log("\nsaved runs/report.json");
