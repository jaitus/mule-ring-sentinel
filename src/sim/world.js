import { makeRng } from "./rng.js";
import { pickArchetype, pickMethod } from "./archetypes.js";
import { RING_GENERATORS, DEFAULT_RING_MIX, makeEmitters } from "./rings/index.js";

function festivalMult(days) {
  const lo = Math.floor(days * 0.72);
  const hi = Math.floor(days * 0.86);
  return (d) => (d >= lo && d <= hi ? 1.7 : 1);
}

function genLegit(ctx, m, arch, fest) {
  const { rng, days } = ctx;
  const e = makeEmitters(ctx);
  for (let d = 0; d < days; d++) {
    const isEventDay = arch.eventLambda && m.eventDays.includes(d);
    let lam = isEventDay ? arch.eventLambda : arch.lambda;
    if (arch.seasonal) lam *= fest(d);
    const n = rng.poisson(lam);
    let dayIn = 0;
    for (let i = 0; i < n; i++) {
      const cp = rng.chance(arch.custReuse)
        ? `cp:${m.id}:${rng.int(0, arch.custPool - 1)}`
        : `walkin:${ctx.cpSeq++}`;
      const amount = Math.round(rng.lognormal(Math.log(arch.avgAmt), arch.amtSigma));
      e.inPayment(m.id, d, cp, amount);
      dayIn += amount;
      if (rng.chance(0.02)) {
        const refundDay = Math.min(days - 1, d + rng.int(1, 3));
        e.outRefund(m.id, refundDay, cp, amount);
      }
    }
    if (d % arch.payoutEvery === arch.payoutEvery - 1 && (dayIn > 0 || rng.chance(0.5))) {
      const lookback = Math.max(dayIn, arch.lambda * arch.avgAmt);
      const amount = Math.round(lookback * arch.payoutFrac * rng.float(0.8, 1.2));
      const cp = `vend:${m.id}:${rng.int(0, arch.vendors - 1)}`;
      e.outPayout(m.id, d, cp, amount);
    }
  }
}

export function buildWorld({ seed = 42, days = 30, legitCount = 320, ringMix = DEFAULT_RING_MIX } = {}) {
  const rng = makeRng(seed);
  const ctx = { rng, days, events: [], paySeq: 0, cpSeq: 0, ringSeq: 0 };
  const merchants = [];
  const truth = new Map();
  const ringMeta = [];
  const fest = festivalMult(days);

  for (let i = 0; i < legitCount; i++) {
    const arch = pickArchetype(rng);
    const m = { id: `M${String(i).padStart(4, "0")}`, archetype: arch.name };
    if (arch.eventLambda) m.eventDays = [rng.int(4, days - 6), rng.int(4, days - 6)];
    merchants.push(m);
    truth.set(m.id, false);
    genLegit(ctx, m, arch, fest);
  }

  for (const [type, count] of Object.entries(ringMix)) {
    const spec = RING_GENERATORS[type];
    for (let r = 0; r < count; r++) {
      let members;
      if (spec.newAccounts) {
        members = [];
        for (let k = 0; k < spec.newAccounts; k++) {
          const id = `M${String(merchants.length).padStart(4, "0")}`;
          merchants.push({ id, archetype: "new_onboarding" });
          truth.set(id, true);
          members.push(id);
        }
      } else if (spec.hijackArchetype) {
        const candidates = merchants.filter((x) => x.archetype === spec.hijackArchetype && !truth.get(x.id));
        const victim = candidates[rng.int(0, candidates.length - 1)];
        truth.set(victim.id, true);
        members = [victim.id];
      }
      ctx.ringSeq++;
      ringMeta.push(spec.gen(ctx, members));
    }
  }

  ctx.events.sort((a, b) => a.d - b.d || (a.dir === "in" ? -1 : 1) - (b.dir === "in" ? -1 : 1));
  return { seed, days, merchants, events: ctx.events, truth, ringMeta };
}
