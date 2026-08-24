const WINDOW = 10;
export const MIN_INFLOW = 3000;
export const MIN_OUTFLOW_FOR_BURST = 25000;

export function buildAccumulators(world) {
  const map = new Map();
  for (const m of world.merchants) {
    map.set(m.id, {
      id: m.id,
      archetype: m.archetype,
      sumIn: 0,
      sumOut: 0,
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
    if (f.sumIn >= MIN_INFLOW) {
      passThrough = f.sumOut / Math.max(f.sumIn, 1);
      fanOut = f.outCps.size / Math.max(f.inCps.size, 1);
      if (f.sumOut >= MIN_OUTFLOW_FOR_BURST) {
        const sumOut2d = maxRolling2(f.outByDay);
        burstRatio = sumOut2d / Math.max((f.sumOut / WINDOW) * 2, 500);
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
      distInCp: f.inCps.size,
      distOutCp: f.outCps.size,
      active: f.sumIn >= MIN_INFLOW,
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
