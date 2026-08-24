import { computeFeaturesForDay, buildAccumulators } from "./features.js";

function sig(x, mid, steep) {
  return 1 / (1 + Math.exp(-steep * (x - mid)));
}

export function scoreMerchant(f) {
  if (!f.active) {
    return { score: 0, reasons: [], components: { passThrough: 0, fanOut: 0, burst: 0 } };
  }
  const cPass = sig(f.passThrough, 0.7, 6);
  const cFan = sig(f.fanOut, 0.55, 8);
  const cBurst = sig(f.burstRatio, 4.5, 1.2);
  const score = 0.45 * cPass + 0.35 * cFan + 0.2 * cBurst;
  const reasons = [];
  if (f.passThrough > 0.7) reasons.push(`pass-through ${(f.passThrough * 100).toFixed(0)}% of inflow sent onward`);
  if (f.fanOut > 0.55) reasons.push(`fan-out ${f.distOutCp} out-accounts vs ${f.distInCp} in-sources`);
  if (f.burstRatio > 4.5) reasons.push(`burst ${f.burstRatio.toFixed(1)}x its normal outflow pace`);
  return { score, reasons, components: { passThrough: cPass, fanOut: cFan, burst: cBurst } };
}

export function detectStream(world, threshold = 0.5) {
  const acc = buildAccumulators(world);
  const best = new Map();
  for (const m of world.merchants) {
    best.set(m.id, { id: m.id, archetype: m.archetype, score: 0, day: -1, reasons: [], sumIn: 0, sumOut: 0 });
  }
  for (let d = 9; d < world.days; d++) {
    const feats = computeFeaturesForDay(world, acc, d);
    for (const f of feats) {
      const { score, reasons } = scoreMerchant(f);
      const b = best.get(f.id);
      if (score > b.score) {
        b.score = score;
        b.day = d;
        b.reasons = reasons;
        b.sumIn = f.sumIn;
        b.sumOut = f.sumOut;
        b.passThrough = f.passThrough;
        b.fanOut = f.fanOut;
        b.burstRatio = f.burstRatio;
      }
    }
  }
  return [...best.values()].map((b) => ({ ...b, flagged: b.score >= threshold }));
}

export function detect(world, threshold = 0.5, evalDay = world.days - 1) {
  const acc = buildAccumulators(world);
  const features = computeFeaturesForDay(world, acc, evalDay);
  return features.map((f) => {
    const { score, reasons, components } = scoreMerchant(f);
    return { ...f, score, reasons, components, flagged: score >= threshold };
  });
}
