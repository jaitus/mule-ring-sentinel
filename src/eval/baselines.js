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
