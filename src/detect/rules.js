import { computeFeaturesForDay, buildAccumulators, computeLoopEdgeDays, cumulativeLoopCounts } from "./features.js";

function sig(x, mid, steep) {
  return 1 / (1 + Math.exp(-steep * (x - mid)));
}

export function scoreMerchant(f, loopEdges = 0) {
  if (!f.active && loopEdges === 0) {
    return { score: 0, reasons: [], components: {} };
  }
  const thinHistory = f.archetype === "dormant" || f.archetype === "new_onboarding";
  const cPass = f.active ? sig(f.passThrough, 0.72, 6) : 0;
  const cFan = f.active ? sig(f.fanOut, 0.6, 8) : 0;
  const cBurst = f.active ? sig(f.burstRatio, 4.0, 1.1) : 0;
  const cUniq = f.active && f.distInCp >= 12 ? sig(f.uniqueInShare, 0.8, 6) : 0;
  const cLoop = loopEdges > 0 ? sig(loopEdges, 1.5, 1.4) : 0;
  const cScale = thinHistory && f.active ? sig(f.sumIn, 10000000, 1.0) : 0;
  const score = 0.25 * cPass + 0.15 * cFan + 0.2 * cBurst + 0.1 * cUniq + 0.15 * cLoop + 0.15 * cScale;
  const reasons = [];
  if (cPass > 0.5) reasons.push(`pass-through ${(f.passThrough * 100).toFixed(0)}% of inflow sent onward`);
  if (cFan > 0.5) reasons.push(`fan-out ${f.distOutCp} out-accounts vs ${f.distInCp} in-sources`);
  if (cBurst > 0.5) reasons.push(`burst ${f.burstRatio.toFixed(1)}x its normal outflow pace`);
  if (cUniq > 0.5) reasons.push(`${(f.uniqueInShare * 100).toFixed(0)}% of inflows from one-time payers (${f.distInCp} accounts)`);
  if (cLoop > 0.5) reasons.push(`payouts to ${loopEdges} accounts that fund other merchants`);
  if (cScale > 0.5) reasons.push(`₹${Math.round(f.sumIn / 100).toLocaleString("en-IN")} volume on thin or dormant history`);
  return { score, reasons, components: { passThrough: cPass, fanOut: cFan, burst: cBurst, uniq: cUniq, loop: cLoop, scale: cScale } };
}

function loopCountAt(loopTimeline, d) {
  let count = 0;
  for (const t of loopTimeline) {
    if (t.d <= d) count = t.count;
    else break;
  }
  return count;
}

export function detectStream(world, threshold = 0.5) {
  const acc = buildAccumulators(world);
  const loopTimeline = cumulativeLoopCounts(computeLoopEdgeDays(world));
  const best = new Map();
  for (const m of world.merchants) {
    best.set(m.id, { id: m.id, archetype: m.archetype, score: 0, day: -1, reasons: [], sumIn: 0, sumOut: 0 });
  }
  for (let d = 9; d < world.days; d++) {
    const feats = computeFeaturesForDay(world, acc, d);
    for (const f of feats) {
      const timeline = loopTimeline.get(f.id);
      const edges = timeline ? loopCountAt(timeline, d) : 0;
      const { score, reasons } = scoreMerchant(f, edges);
      const b = best.get(f.id);
      if (score > b.score) {
        b.score = score;
        b.day = d;
        b.reasons = reasons;
        b.sumIn = f.sumIn;
        b.sumOut = f.sumOut;
      }
    }
  }
  return [...best.values()].map((b) => ({ ...b, flagged: b.score >= threshold }));
}
