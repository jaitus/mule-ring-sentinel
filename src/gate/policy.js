const BATCH_HOLD_CAP = 0.05;
const AUTO_RELEASE_DAYS = 14;

function tierFor(score) {
  if (score >= 0.6) return "ESCALATE";
  if (score >= 0.4) return "HOLD";
  if (score >= 0.3) return "WATCH";
  return "RELEASE";
}

export function decide(rows, { merchantCount } = {}) {
  const total = merchantCount ?? rows.length;
  const cap = Math.max(3, Math.floor(total * BATCH_HOLD_CAP));
  const decisions = rows.map((r) => {
    const tier = tierFor(r.score);
    return {
      merchantId: r.id,
      archetype: r.archetype,
      score: r.score,
      day: r.day,
      exposurePaise: r.sumIn,
      action: tier === "WATCH" || tier === "RELEASE" ? tier : tier,
      baseAction: tier,
      reasons: [...r.reasons],
      guardrails: [],
      autoReleaseInDays: tier === "HOLD" ? AUTO_RELEASE_DAYS : null,
    };
  });
  const hardActions = decisions.filter((d) => d.action === "HOLD" || d.action === "ESCALATE");
  const overCap = hardActions.length - cap;
  if (overCap > 0) {
    const downgradable = hardActions
      .filter((d) => d.action === "HOLD" && d.score < 0.6)
      .sort((a, b) => a.score - b.score)
      .slice(0, overCap);
    for (const d of downgradable) {
      d.action = "WATCH";
      d.guardrails.push("downgraded: batch hold cap (FP-cost protection)");
    }
  }
  for (const d of decisions) {
    if (d.action === "ESCALATE") d.guardrails.push("manual review queue: multi-account evidence");
  }
  return decisions;
}

export function summarize(decisions) {
  const out = { ESCALATE: 0, HOLD: 0, WATCH: 0, RELEASE: 0 };
  let heldPaise = 0;
  for (const d of decisions) {
    out[d.action]++;
    if (d.action === "HOLD" || d.action === "ESCALATE") heldPaise += d.exposurePaise;
  }
  return { counts: out, heldPaise };
}
