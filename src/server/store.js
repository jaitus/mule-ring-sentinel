import { buildWorld } from "../sim/world.js";
import { scoreStream, applyThreshold } from "../detect/rules.js";
import { decide, summarize } from "../gate/policy.js";

const THRESHOLD = 0.4;
const cache = new Map();

export function getRun(seed = 42) {
  const key = String(seed);
  if (cache.has(key)) return cache.get(key);
  const world = buildWorld({ seed, days: 30, legitCount: 320 });
  const rows = scoreStream(world);
  const flagged = applyThreshold(rows, THRESHOLD);
  const decisions = decide(flagged, { merchantCount: world.merchants.length });
  const sum = summarize(decisions);
  const eventsByDay = [];
  for (let d = 0; d < world.days; d++) {
    eventsByDay.push(
      world.events.filter((e) => e.d === d).map((e) => ({ pay: e.pay, m: e.m, dir: e.dir, amount: e.amount, method: e.method, kind: e.kind }))
    );
  }
  const truthOfMule = null;
  const run = {
    seed,
    threshold: THRESHOLD,
    days: world.days,
    merchantCount: world.merchants.length,
    archetypeOf: Object.fromEntries(world.merchants.map((m) => [m.id, m.archetype])),
    decisions,
    summary: sum,
    eventsByDay,
    eventsFor: (merchantId) => world.events.filter((e) => e.m === merchantId),
    rowById: new Map(rows.map((r) => [r.id, r])),
    truth: world.truth,
    ringMeta: world.ringMeta,
    truthOfMule,
  };
  cache.set(key, run);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return run;
}
