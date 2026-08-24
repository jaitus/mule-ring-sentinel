import { pickMethod } from "../archetypes.js";

export function makeEmitters(ctx) {
  function emit(m, d, dir, cp, amount, kind) {
    ctx.events.push({
      pay: `pay_${ctx.paySeq++}`,
      m,
      d,
      dir,
      cp,
      amount: Math.round(amount),
      method: dir === "in" ? pickMethod(ctx.rng) : "payout",
      kind,
    });
  }
  return {
    inPayment: (m, d, cp, amount) => emit(m, d, "in", cp, amount, "payment"),
    outPayout: (m, d, cp, amount) => emit(m, d, "out", cp, amount, "payout"),
    outRefund: (m, d, cp, amount) => emit(m, d, "out", cp, amount, "refund"),
  };
}

function genLayeringFanOut(ctx, [mId]) {
  const { rng, days } = ctx;
  const e = makeEmitters(ctx);
  const warmupStart = rng.int(1, Math.max(1, days - 13));
  const warmupLen = rng.int(5, 9);
  const burstDay = Math.min(days - 1, warmupStart + warmupLen + rng.int(0, 2));
  let pooled = 0;
  for (let d = warmupStart; d < warmupStart + warmupLen && d < days; d++) {
    const n = rng.int(2, 6);
    for (let i = 0; i < n; i++) {
      const amount = rng.int(200000, 1500000);
      e.inPayment(mId, d, `pers:${ctx.cpSeq++}`, amount);
      pooled += amount;
    }
    if (rng.chance(0.3)) {
      e.outPayout(mId, d, `pers:${ctx.cpSeq++}`, pooled * 0.08);
    }
  }
  if (burstDay > warmupStart && burstDay < days && pooled > 10000000) {
    const thresholds = [1900000, 2400000, 4900000, 9500000];
    let remaining = pooled * 0.92;
    const splits = rng.int(8, 18);
    for (let i = 0; i < splits && remaining > 50000; i++) {
      const amount = Math.min(remaining, rng.pick(thresholds) * rng.float(0.9, 1.05));
      if (amount < 50000) break;
      e.outPayout(mId, burstDay, `pers:${ctx.cpSeq++}`, amount);
      remaining -= amount;
    }
  }
  return { typology: "layering_fan_out", members: [mId] };
}

function genSmurfingFanIn(ctx, [mId]) {
  const { rng, days } = ctx;
  const e = makeEmitters(ctx);
  const startDay = rng.int(1, Math.max(1, days - 10));
  const len = rng.int(3, 6);
  let pooled = 0;
  for (let d = startDay; d < startDay + len && d < days; d++) {
    const n = rng.int(15, 50);
    for (let i = 0; i < n; i++) {
      const amount = rng.int(30000, 500000);
      e.inPayment(mId, d, `pers:${ctx.cpSeq++}`, amount);
      pooled += amount;
    }
  }
  const sweepDay = Math.min(days - 1, startDay + len + rng.int(0, 1));
  if (pooled > 10000000 && sweepDay < days) {
    const outs = rng.int(1, 3);
    let remaining = pooled * 0.93;
    for (let i = 0; i < outs && remaining > 50000; i++) {
      const amount = i === outs - 1 ? remaining : remaining * rng.float(0.4, 0.7);
      e.outPayout(mId, sweepDay, `pers:${ctx.cpSeq++}`, amount);
      remaining -= amount;
    }
  }
  return { typology: "smurfing_fan_in", members: [mId] };
}

function genDormancySpike(ctx, [mId]) {
  const { rng, days } = ctx;
  const e = makeEmitters(ctx);
  const spikeDay = rng.int(Math.floor(days * 0.55), days - 2);
  const ins = rng.int(3, 8);
  let spiked = 0;
  for (let i = 0; i < ins; i++) {
    const amount = rng.int(5000000, 20000000);
    e.inPayment(mId, spikeDay, `pers:${ctx.cpSeq++}`, amount);
    spiked += amount;
  }
  const outs = rng.int(2, 5);
  let remaining = spiked * 0.9;
  for (let i = 0; i < outs && remaining > 100000; i++) {
    const day = Math.min(days - 1, spikeDay + rng.int(0, 1));
    const amount = i === outs - 1 ? remaining : remaining * rng.float(0.35, 0.6);
    e.outPayout(mId, day, `pers:${ctx.cpSeq++}`, amount);
    remaining -= amount;
  }
  return { typology: "dormancy_spike", members: [mId] };
}

function genCarousel(ctx, memberIds) {
  const { rng, days } = ctx;
  const e = makeEmitters(ctx);
  const [A, B, C] = memberIds;
  const s = rng.int(1, Math.max(1, days - 8));
  const allyAB = `ally:${ctx.ringSeq}:ab`;
  const allyBC = `ally:${ctx.ringSeq}:bc`;
  const allyCA = `ally:${ctx.ringSeq}:ca`;
  let pot = 0;
  const seeds = rng.int(1, 2);
  for (let i = 0; i < seeds; i++) {
    const amount = rng.int(3000000, 8000000);
    e.inPayment(A, s, `pers:${ctx.cpSeq++}`, amount);
    pot += amount;
  }
  const cycles = rng.int(2, 3);
  let d = s;
  for (let c = 0; c < cycles && d + 2 < days; c++) {
    const hop1 = pot * rng.float(0.96, 0.99);
    e.outPayout(A, d, allyAB, hop1);
    e.inPayment(B, d + 1, allyAB, hop1);
    const hop2 = hop1 * rng.float(0.96, 0.99);
    e.outPayout(B, d + 1, allyBC, hop2);
    e.inPayment(C, d + 2, allyBC, hop2);
    const back = hop2 * rng.float(0.96, 0.99);
    e.outPayout(C, d + 2, allyCA, back);
    e.inPayment(A, Math.min(days - 1, d + 3), allyCA, back);
    pot = back;
    d += 3;
  }
  const extractDay = Math.min(days - 1, d + 1);
  const outs = rng.int(2, 4);
  let remaining = pot * 0.85;
  for (let i = 0; i < outs && remaining > 100000; i++) {
    const amount = i === outs - 1 ? remaining : remaining * rng.float(0.4, 0.65);
    e.outPayout(C, extractDay, `pers:${ctx.cpSeq++}`, amount);
    remaining -= amount;
  }
  return { typology: "carousel", members: [A, B, C] };
}

export const RING_GENERATORS = {
  layering_fan_out: { gen: genLayeringFanOut, newAccounts: 1 },
  smurfing_fan_in: { gen: genSmurfingFanIn, newAccounts: 1 },
  dormancy_spike: { gen: genDormancySpike, hijackArchetype: "dormant" },
  carousel: { gen: genCarousel, newAccounts: 3 },
};

export const DEFAULT_RING_MIX = {
  layering_fan_out: 4,
  smurfing_fan_in: 3,
  dormancy_spike: 3,
  carousel: 2,
};
