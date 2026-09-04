const WINDOW = 10;
export const MIN_INFLOW = 300000;
export const MIN_OUTFLOW_FOR_BURST = 2500000;
export const UNIQ_MIN_CPS = 12;
export const UNIQ_MIN_SUMIN = 5000000;

export function buildAccumulators(world) {
  const map = new Map();
  for (const m of world.merchants) {
    map.set(m.id, {
      id: m.id,
      archetype: m.archetype,
      sumIn: 0,
      sumOut: 0,
      nIn: 0,
      inCps: new Set(),
      outCps: new Set(),
      outByDay: new Array(WINDOW).fill(0),
    });
  }
  return map;
}

export function computeFeaturesForDay(world, acc, evalDay) {
  const startDay = Math.max(0, evalDay - WINDOW + 1);
  for (const f of acc.values()) {
    f.sumIn = 0;
    f.sumOut = 0;
    f.nIn = 0;
    f.inCps.clear();
    f.outCps.clear();
    f.outByDay.fill(0);
  }
  for (const e of world.events) {
    if (e.d < startDay || e.d > evalDay) continue;
    const f = acc.get(e.m);
    if (!f) continue;
    const idx = e.d - startDay;
    if (e.dir === "in") {
      f.sumIn += e.amount;
      f.nIn++;
      f.inCps.add(e.cp);
    } else {
      f.sumOut += e.amount;
      f.outCps.add(e.cp);
      f.outByDay[idx] += e.amount;
    }
  }
  const features = [];
  for (const f of acc.values()) {
    let passThrough = 0;
    let fanOut = 0;
    let burstRatio = 0;
    let uniqueInShare = 0;
    const active = f.sumIn >= MIN_INFLOW;
    if (active) {
      passThrough = f.sumOut / Math.max(f.sumIn, 1);
      fanOut = f.outCps.size / Math.max(f.inCps.size, 1);
      uniqueInShare = f.inCps.size / Math.max(f.nIn, 1);
      if (f.sumOut >= MIN_OUTFLOW_FOR_BURST) {
        burstRatio = maxRolling2(f.outByDay) / Math.max((f.sumOut / WINDOW) * 2, 50000);
      }
    }
    features.push({
      id: f.id,
      archetype: f.archetype,
      sumIn: f.sumIn,
      sumOut: f.sumOut,
      passThrough,
      fanOut,
      burstRatio,
      uniqueInShare,
      distInCp: f.inCps.size,
      distOutCp: f.outCps.size,
      active,
    });
  }
  return features;
}

function maxRolling2(arr) {
  let best = 0;
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i] + (arr[i + 1] ?? 0);
    if (s > best) best = s;
  }
  return best;
}

// A "loop edge" is a payout to an account that also funds a DIFFERENT merchant.
//
// This used to be evaluated in a single forward pass that only fired when the
// inbound leg had already been seen before the outbound leg. That made detection
// depend on the order the two legs happened to occur in: a ring that pays out on
// day d and whose next hop receives on day d+1 produced NO edge at all, while the
// same structure in the opposite order produced one. Chained typologies always
// forward in that direction, so they scored zero on this feature.
//
// Fixed by tracking both directions and attributing the edge on the day the
// SECOND leg is observed. That keeps the stream causal — nothing here reads an
// event dated later than the day the edge is credited to, which is what
// test/loop.test.js pins — while making detection independent of leg order.
export function computeLoopEdgeDays(world) {
  const cpFunds = new Map(); // counterparty -> merchants it has paid INTO, so far
  const cpPaidBy = new Map(); // counterparty -> merchants that have paid OUT to it, so far
  const hits = new Map();

  const credit = (merchant, day, cp) => {
    let perDay = hits.get(merchant);
    if (!perDay) {
      perDay = new Map();
      hits.set(merchant, perDay);
    }
    let cps = perDay.get(day);
    if (!cps) {
      cps = new Set();
      perDay.set(day, cps);
    }
    cps.add(cp);
  };

  for (const e of world.events) {
    if (e.dir === "in") {
      let funded = cpFunds.get(e.cp);
      if (!funded) {
        funded = new Set();
        cpFunds.set(e.cp, funded);
      }
      const firstTime = !funded.has(e.m);
      funded.add(e.m);
      // Knowledge arrives now: any merchant that already paid out to this
      // account is funding an account that funds someone else.
      if (firstTime) {
        const paidBy = cpPaidBy.get(e.cp);
        if (paidBy) for (const pm of paidBy) if (pm !== e.m) credit(pm, e.d, e.cp);
      }
    } else if (e.kind !== "refund") {
      let paidBy = cpPaidBy.get(e.cp);
      if (!paidBy) {
        paidBy = new Set();
        cpPaidBy.set(e.cp, paidBy);
      }
      paidBy.add(e.m);
      const funded = cpFunds.get(e.cp);
      if (funded) {
        for (const fm of funded) {
          if (fm !== e.m) {
            credit(e.m, e.d, e.cp);
            break;
          }
        }
      }
    }
  }
  return hits;
}

export function cumulativeLoopCounts(hits) {
  const out = new Map();
  for (const [m, perDay] of hits) {
    const seen = new Set();
    const timeline = [];
    for (const d of [...perDay.keys()].sort((a, b) => a - b)) {
      for (const cp of perDay.get(d)) seen.add(cp);
      timeline.push({ d, count: seen.size });
    }
    out.set(m, timeline);
  }
  return out;
}
