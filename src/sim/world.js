import { makeRng } from "./rng.js";

const ARCHETYPES = [
  { name: "kirana", weight: 0.35, lambda: 9, avgAmt: 800, amtSigma: 0.9, custPool: 40, custReuse: 0.55, vendors: 2, payoutFrac: 0.45, payoutEvery: 4 },
  { name: "d2c", weight: 0.25, lambda: 16, avgAmt: 1600, amtSigma: 1.0, custPool: 80, custReuse: 0.35, vendors: 3, payoutFrac: 0.55, payoutEvery: 3 },
  { name: "saas", weight: 0.2, lambda: 4, avgAmt: 4500, amtSigma: 0.6, custPool: 25, custReuse: 0.85, vendors: 2, payoutFrac: 0.4, payoutEvery: 6 },
  { name: "dormant", weight: 0.2, lambda: 0.25, avgAmt: 1200, amtSigma: 0.8, custPool: 10, custReuse: 0.5, vendors: 1, payoutFrac: 0.5, payoutEvery: 9 },
];

let cpCounter = 0;

function pickArchetype(rng) {
  const roll = rng.next();
  let acc = 0;
  for (const a of ARCHETYPES) {
    acc += a.weight;
    if (roll < acc) return a;
  }
  return ARCHETYPES[ARCHETYPES.length - 1];
}

function genLegit(merchant, arch, rng, days, events) {
  for (let d = 0; d < days; d++) {
    const n = rng.poisson(arch.lambda);
    let dayIn = 0;
    for (let i = 0; i < n; i++) {
      const cp = rng.chance(arch.custReuse)
        ? `cp:${merchant.id}:${rng.int(0, arch.custPool - 1)}`
        : `pers:${cpCounter++}`;
      const amount = Math.round(rng.lognormal(Math.log(arch.avgAmt), arch.amtSigma));
      events.push({ m: merchant.id, d, dir: "in", cp, amount });
      dayIn += amount;
    }
    if (d % arch.payoutEvery === arch.payoutEvery - 1 && dayIn >= 0) {
      const lookback = Math.max(dayIn, arch.lambda * arch.avgAmt);
      const amount = Math.round(lookback * arch.payoutFrac * rng.float(0.8, 1.2));
      const cp = `vend:${merchant.id}:${rng.int(0, arch.vendors - 1)}`;
      events.push({ m: merchant.id, d, dir: "out", cp, amount });
    }
  }
}

function genLayeringFanOut(merchant, rng, days, events) {
  const warmupStart = rng.int(2, Math.max(2, days - 14));
  const warmupLen = rng.int(5, 9);
  const burstDay = warmupStart + warmupLen + rng.int(0, 2);
  let pooled = 0;
  const smurfCps = new Set();
  for (let d = warmupStart; d < Math.min(warmupStart + warmupLen, days); d++) {
    const n = rng.int(2, 6);
    for (let i = 0; i < n; i++) {
      const cp = `pers:${cpCounter++}`;
      smurfCps.add(cp);
      const amount = rng.int(2000, 15000);
      events.push({ m: merchant.id, d, dir: "in", cp, amount });
      pooled += amount;
    }
    if (rng.chance(0.3)) {
      events.push({ m: merchant.id, d, dir: "out", cp: `pers:${cpCounter++}`, amount: Math.round(pooled * 0.08) });
    }
  }
  if (burstDay < days) {
    const splitCount = rng.int(8, 18);
    const thresholds = [19000, 24000, 49000, 95000];
    let remaining = pooled * 0.92;
    for (let i = 0; i < splitCount && remaining > 500; i++) {
      const base = rng.pick(thresholds);
      const amount = Math.min(remaining, Math.round(base * rng.float(0.9, 1.05)));
      if (amount < 500) break;
      events.push({ m: merchant.id, d: burstDay, dir: "out", cp: `pers:${cpCounter++}`, amount });
      remaining -= amount;
    }
    merchant.burstDay = burstDay;
  }
  merchant.muleTypology = "layering_fan_out";
}

export function buildWorld({ seed = 42, days = 30, legitCount = 300, ringCount = 12 } = {}) {
  cpCounter = 0;
  const rng = makeRng(seed);
  const merchants = [];
  const events = [];
  const truth = new Map();

  for (let i = 0; i < legitCount; i++) {
    const arch = pickArchetype(rng);
    const m = { id: `M${String(i).padStart(4, "0")}`, archetype: arch.name };
    merchants.push(m);
    truth.set(m.id, false);
    genLegit(m, arch, rng, days, events);
  }

  for (let r = 0; r < ringCount; r++) {
    const m = { id: `M${String(legitCount + r).padStart(4, "0")}`, archetype: "new_onboarding" };
    merchants.push(m);
    truth.set(m.id, true);
    genLayeringFanOut(m, rng, days, events);
  }

  events.sort((a, b) => a.d - b.d || a.m.localeCompare(b.m));
  return { seed, days, merchants, events, truth };
}
