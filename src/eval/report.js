import { scoreWorld } from "./baselines.js";
import { applyThreshold } from "../detect/rules.js";
import { confusion, netAt, RECOVERY_RATE, MISS_COST_FRAC, DISRUPTION_FIXED_PAISE } from "./metrics.js";
import {
  baselineVolume,
  baselinePassThrough,
  baselinePassThroughTopK,
  baselineRandom,
  baselineNone,
} from "./baselines.js";
import { writeFileSync, mkdirSync } from "node:fs";

const TRAIN_SEEDS = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011];
const HELDOUT_SEEDS = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019];
// Deliberately wider than the old [0.35 .. 0.60]. Pricing misses pulls the optimum
// down, and an argmax sitting on the edge of its own grid is not an optimum.
// Finely sampled between 0.34 and 0.42: precision falls off a cliff there
// (100% at 0.40 down to 81% at 0.35), so a coarse grid would hide any optimum
// that lives inside the cliff and make 0.40 look inevitable when it may not be.
const THRESHOLDS = [0.2, 0.25, 0.3, 0.32, 0.34, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.45, 0.5, 0.55, 0.6];
const MISS_FRACS = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9];

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

const scored = new Map();
for (const s of TRAIN_SEEDS) scored.set("t" + s, scoreWorld(s));
for (const s of HELDOUT_SEEDS) scored.set("h" + s, scoreWorld(s));

// confusion() does not depend on the miss-cost fraction, so cache it per threshold
// once and let netAt() re-price it. That makes phase E essentially free.
const trainCs = new Map();
const heldCs = new Map();
for (const t of THRESHOLDS) {
  trainCs.set(
    t,
    TRAIN_SEEDS.map((s) => confusion(scored.get("t" + s).world, applyThreshold(scored.get("t" + s).rows, t)))
  );
  heldCs.set(
    t,
    HELDOUT_SEEDS.map((s) => confusion(scored.get("h" + s).world, applyThreshold(scored.get("h" + s).rows, t)))
  );
}

const argmaxOnTrain = (missFrac) => {
  let bestT = THRESHOLDS[0];
  let bestN = -Infinity;
  for (const t of THRESHOLDS) {
    const n = mean(trainCs.get(t).map((c) => netAt(c, RECOVERY_RATE, 1, DISRUPTION_FIXED_PAISE, missFrac)));
    if (n > bestN) {
      bestN = n;
      bestT = t;
    }
  }
  return { t: bestT, n: bestN };
};

console.log(`[phase A] threshold sweep on ${TRAIN_SEEDS.length} TRAIN worlds (never touch held-out)`);
console.log(`          NET prices recovered funds, wrongful-hold disruption AND missed conduits`);
console.log(`          miss cost = ${MISS_COST_FRAC} x laundered inflow that got through (modelled)\n`);

console.log("thr    prec     rec      NET/world");
for (const t of THRESHOLDS) {
  const cs = trainCs.get(t);
  const p = mean(cs.map((c) => c.precision));
  const r = mean(cs.map((c) => c.recall));
  const n = mean(cs.map((c) => netAt(c)));
  console.log(`${t.toFixed(2)}   ${(p * 100).toFixed(1)}%   ${(r * 100).toFixed(1)}%   ${fmt(n)}`);
}

const best = argmaxOnTrain(MISS_COST_FRAC);
console.log(`\noperating point chosen on TRAIN: threshold=${best.t.toFixed(2)} (max NET)`);
if (best.t === THRESHOLDS[0] || best.t === THRESHOLDS[THRESHOLDS.length - 1]) {
  console.log(`WARNING: the optimum sits on the EDGE of the swept grid — widen THRESHOLDS.`);
}
console.log("");

console.log(`[phase B] HELD-OUT evaluation on ${HELDOUT_SEEDS.length} unseen worlds @ thr=${best.t.toFixed(2)}\n`);
const heldoutCs = heldCs.get(best.t);
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
console.log(`  of which: recovered ${fmt(mean(heldoutCs.map((c) => c.heldPaise * RECOVERY_RATE)))}`);
console.log(`            wrongful-hold cost -${fmt(mean(heldoutCs.map((c) => c.disruptionPaise)))}`);
console.log(`            missed-conduit cost -${fmt(mean(heldoutCs.map((c) => c.missCostPaise)))}`);
console.log("");
console.log("typology            caught/total");
for (const [t, v] of Object.entries(typAgg)) {
  console.log(`${t.padEnd(20)} ${v.caught}/${v.total}`);
}

console.log(`\n[phase C] baselines on the same held-out worlds\n`);
const wins = { none: 0, vol: 0, ptFixed: 0, ptTopK: 0, rnd: 0 };
const nets = { det: [], none: [], vol: [], ptFixed: [], ptTopK: [], rnd: [] };
HELDOUT_SEEDS.forEach((s) => {
  const { world, rows } = scored.get("h" + s);
  const det = confusion(world, applyThreshold(rows, best.t));
  const b = {
    none: confusion(world, baselineNone(rows)),
    vol: confusion(world, baselineVolume(rows, det.flagCount)),
    ptFixed: confusion(world, baselinePassThrough(rows)),
    ptTopK: confusion(world, baselinePassThroughTopK(rows, det.flagCount)),
    rnd: confusion(world, baselineRandom(rows, det.flagCount, s * 31 + 7)),
  };
  const dn = netAt(det);
  nets.det.push(dn);
  for (const k of Object.keys(b)) {
    const n = netAt(b[k]);
    nets[k].push(n);
    if (dn > n) wins[k]++;
  }
});
const W = HELDOUT_SEEDS.length;
console.log(`detector                    ${fmt(mean(nets.det)).padStart(16)}`);
console.log(`do nothing (null baseline)  ${fmt(mean(nets.none)).padStart(16)}   detector wins ${wins.none}/${W}   <- the real bar`);
console.log(`pass-through top-k (budget) ${fmt(mean(nets.ptTopK)).padStart(16)}   detector wins ${wins.ptTopK}/${W}   <- strongest simple rule`);
console.log(`volume top-k (budget)       ${fmt(mean(nets.vol)).padStart(16)}   detector wins ${wins.vol}/${W}`);
console.log(`pass-through @0.72 (fixed)  ${fmt(mean(nets.ptFixed)).padStart(16)}   detector wins ${wins.ptFixed}/${W}   (not budget-matched)`);
console.log(`random at budget            ${fmt(mean(nets.rnd)).padStart(16)}   detector wins ${wins.rnd}/${W}`);

console.log(`\n[phase D] sensitivity of NET on held-out (recovery × wrongful-hold cost scale)\n`);
console.log("recov\\frac" + " ".repeat(5) + "0.7x".padStart(12) + "1.4x".padStart(12) + "2.1x".padStart(12));
for (const rec of [0.3, 0.45, 0.6, 0.75, 0.9]) {
  const row = [0.7, 1.4, 2.1].map((fscale) =>
    fmt(mean(heldoutCs.map((c) => netAt(c, rec, fscale)))).padStart(12)
  );
  console.log(`${(rec * 100).toFixed(0)}%`.padEnd(10) + row.join(""));
}

console.log(`\n[phase E] does the operating point survive the miss-cost assumption?\n`);
console.log("           re-derives the argmax on TRAIN at each miss cost, then reports HELD-OUT there");
console.log("           missFrac=0 reproduces the old, one-sided objective\n");
console.log("missFrac   thr     prec     rec     NET/world");
const missSweep = [];
for (const mf of MISS_FRACS) {
  const a = argmaxOnTrain(mf);
  const cs = heldCs.get(a.t);
  const p = mean(cs.map((c) => c.precision));
  const r = mean(cs.map((c) => c.recall));
  const n = mean(cs.map((c) => netAt(c, RECOVERY_RATE, 1, DISRUPTION_FIXED_PAISE, mf)));
  missSweep.push({ missFrac: mf, threshold: a.t, precision: p, recall: r, netPaise: n });
  const mark = mf === MISS_COST_FRAC ? "  <- shipped" : "";
  console.log(
    `${mf.toFixed(2)}       ${a.t.toFixed(2)}    ${(p * 100).toFixed(1)}%   ${(r * 100).toFixed(1)}%   ${fmt(n).padStart(14)}${mark}`
  );
}

mkdirSync("runs", { recursive: true });
writeFileSync(
  "runs/report.json",
  JSON.stringify(
    {
      protocol: { train: TRAIN_SEEDS, heldout: HELDOUT_SEEDS, thresholds: THRESHOLDS },
      operatingPoint: { threshold: best.t, chosenOn: "train:maxNET" },
      heldout: {
        precisionMean: mean(P), precisionStd: std(P),
        recallMean: mean(R), recallStd: std(R),
        netMeanPaise: mean(N), netStdPaise: std(N),
        recoveredPaise: mean(heldoutCs.map((c) => c.heldPaise * RECOVERY_RATE)),
        wrongfulHoldPaise: mean(heldoutCs.map((c) => c.disruptionPaise)),
        missedConduitPaise: mean(heldoutCs.map((c) => c.missCostPaise)),
        byTypology: typAgg,
      },
      baselines: {
        none: { netMeanPaise: mean(nets.none), wins: wins.none },
        passThroughTopK: { netMeanPaise: mean(nets.ptTopK), wins: wins.ptTopK },
        volumeTopK: { netMeanPaise: mean(nets.vol), wins: wins.vol },
        passThroughFixed: { netMeanPaise: mean(nets.ptFixed), wins: wins.ptFixed },
        randomAtBudget: { netMeanPaise: mean(nets.rnd), wins: wins.rnd },
      },
      missCostSweep: missSweep,
      constants: { RECOVERY_RATE, MISS_COST_FRAC },
    },
    null,
    2
  )
);
console.log("\nsaved runs/report.json");
