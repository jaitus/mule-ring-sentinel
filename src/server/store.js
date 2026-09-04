import { readFileSync, existsSync } from "node:fs";
import { buildWorld } from "../sim/world.js";
import { scoreStream, applyThreshold } from "../detect/rules.js";
import { decide, summarize } from "../gate/policy.js";

// The dashboard must show the operating point the eval actually chose, not a
// literal that happens to agree with it today. runs/report.json is written by
// `npm run eval`; the fallback only covers a fresh clone that has not run it yet.
const FALLBACK_THRESHOLD = 0.4;
function operatingPoint() {
  try {
    if (existsSync("runs/report.json")) {
      const t = JSON.parse(readFileSync("runs/report.json", "utf8"))?.operatingPoint?.threshold;
      if (typeof t === "number") return t;
    }
  } catch {
    /* fall through to the documented default */
  }
  return FALLBACK_THRESHOLD;
}
const THRESHOLD = operatingPoint();
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
    evidenceBundle,
  };

  function evidenceBundle(merchantId) {
    const row = run.rowById.get(merchantId);
    const decision = run.decisions.find((d) => d.merchantId === merchantId);
    const events = run.eventsFor(merchantId);
    const stats = { txnCount: events.length, totalInPaise: 0, totalOutPaise: 0, distinctInCp: 0, distinctOutCp: 0 };
    const flows = new Map();
    const dailyNet = new Array(world.days).fill(0);
    for (const e of events) {
      if (e.dir === "in") {
        stats.totalInPaise += e.amount;
        stats.distinctInCp++;
        dailyNet[e.d] += e.amount;
      } else {
        stats.totalOutPaise += e.amount;
        stats.distinctOutCp++;
        dailyNet[e.d] -= e.amount;
      }
      const f = flows.get(e.cp) ?? { cp: e.cp, inPaise: 0, outPaise: 0 };
      if (e.dir === "in") f.inPaise += e.amount;
      else f.outPaise += e.amount;
      flows.set(e.cp, f);
    }
    stats.distinctInCp = new Set(events.filter((e) => e.dir === "in").map((e) => e.cp)).size;
    stats.distinctOutCp = new Set(events.filter((e) => e.dir === "out").map((e) => e.cp)).size;
    const topFlows = [...flows.values()].sort((a, b) => b.inPaise + b.outPaise - (a.inPaise + a.outPaise)).slice(0, 8);
    return {
      merchantId,
      archetype: run.archetypeOf[merchantId],
      action: decision?.action,
      score: row?.score,
      exposurePaise: decision?.exposurePaise,
      reasons: decision?.reasons ?? [],
      guardrails: decision?.guardrails ?? [],
      stats,
      dailyNet,
      topFlows,
    };
  }

  cache.set(key, run);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return run;
}
