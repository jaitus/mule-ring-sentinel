import { buildWorld } from "../sim/world.js";
import { scoreStream } from "../detect/rules.js";
import { mulberry32 } from "../sim/rng.js";
import { MIN_INFLOW } from "../detect/features.js";

export function scoreWorld(seed, opts = {}) {
  const world = buildWorld({ seed, days: 30, legitCount: 320, ...opts });
  const rows = scoreStream(world);
  return { world, rows };
}

export function baselineVolume(rows, k) {
  const sorted = [...rows].sort((a, b) => b.sumIn - a.sumIn);
  const flagged = new Set(sorted.slice(0, k).map((r) => r.id));
  return rows.map((r) => ({ ...r, flagged: flagged.has(r.id) }));
}

export function baselinePassThrough(rows, thr = 0.72) {
  return rows.map((r) => ({
    ...r,
    flagged: r.sumIn >= MIN_INFLOW && r.sumOut / r.sumIn >= thr,
  }));
}

// The real bar is not "beat a bad policy", it is "beat doing nothing at all".
// Flagging nobody holds no funds and disrupts no one, so its only cost is the
// miss cost of every mule on the platform. Before miss cost was priced this
// scored exactly 0 and silently beat all three other baselines.
export function baselineNone(rows) {
  return rows.map((r) => ({ ...r, flagged: false }));
}

// Budget-matched version of the strongest simple signal available.
// baselinePassThrough uses a fixed 0.72 cutoff and so flags however many
// merchants happen to clear it — not the detector's budget. Beating that is a
// weaker claim than beating the best single rule held to the same flag count.
export function baselinePassThroughTopK(rows, k) {
  const ratio = (r) => (r.sumIn >= MIN_INFLOW ? r.sumOut / Math.max(r.sumIn, 1) : -1);
  const sorted = [...rows].sort((a, b) => ratio(b) - ratio(a));
  const flagged = new Set(sorted.slice(0, k).filter((r) => ratio(r) >= 0).map((r) => r.id));
  return rows.map((r) => ({ ...r, flagged: flagged.has(r.id) }));
}

export function baselineRandom(rows, k, seed) {
  const rng = mulberry32(seed);
  const idx = rows.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const flagged = new Set(idx.slice(0, k));
  return rows.map((r, i) => ({ ...r, flagged: flagged.has(i) }));
}
