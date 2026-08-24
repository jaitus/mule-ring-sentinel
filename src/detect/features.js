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

export function computeLoopEdgeDays(world) {
  const cpPayers = new Map();
  const hits = new Map();
  for (const e of world.events) {
    if (e.dir === "in") {
      let s = cpPayers.get(e.cp);
      if (!s) {
        s = new Set();
        cpPayers.set(e.cp, s);
      }
      s.add(e.m);
    } else if (e.kind !== "refund") {
      const s = cpPayers.get(e.cp);
      if (!s || s.size === 0) continue;
      let selfOnly = true;
      for (const x of s) {
        if (x !== e.m) {
          selfOnly = false;
          break;
        }
      }
      if (selfOnly) continue;
      let perDay = hits.get(e.m);
      if (!perDay) {
        perDay = new Map();
        hits.set(e.m, perDay);
      }
      let cps = perDay.get(e.d);
      if (!cps) {
        cps = new Set();
        perDay.set(e.d, cps);
      }
      cps.add(e.cp);
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
