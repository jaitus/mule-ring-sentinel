export const RECOVERY_RATE = 0.6;
export const DISRUPTION_FRAC = 0.56;
export const DISRUPTION_FIXED_PAISE = 50000;

// Cost of a MISSED conduit, as a fraction of the laundered inflow that got through.
//
// Until this existed, `fn` was counted for recall and then priced at zero, so the
// objective was one-sided: false positives cost money and misses were free. Choosing
// the operating point by "max NET" under that objective could only ever push the
// threshold up toward precision, with nothing pulling back — and it contradicted the
// README's own framing, which says an undetected conduit means frozen settlements,
// regulatory penalties and licence risk. Those are the aggregator's costs, so they
// belong in the aggregator's NET.
//
// MODELLED, NOT MEASURED. It stands for the aggregator's downstream exposure on value
// laundered across its own rails — clawbacks, penalties, remediation. 0.35 is a
// deliberately mid-range guess and it is swept in report.js phase E, which also shows
// what the operating point does at MISS_COST_FRAC = 0 (the old, incomplete objective).
export const MISS_COST_FRAC = 0.35;

export function confusion(world, rows) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  let heldPaise = 0;
  let disruptionVarPaise = 0;
  let missedInflowPaise = 0;
  const typologyOf = new Map();
  for (const r of world.ringMeta) {
    for (const m of r.members) typologyOf.set(m, r.typology);
  }
  const byTypology = {};
  for (const t of new Set(typologyOf.values())) byTypology[t] = { caught: 0, total: 0 };
  for (const r of world.ringMeta) {
    for (const m of r.members) byTypology[typologyOf.get(m)].total++;
  }
  for (const r of rows) {
    const isMule = world.truth.get(r.id);
    if (r.flagged && isMule) {
      tp++;
      heldPaise += r.sumIn;
      byTypology[typologyOf.get(r.id)].caught++;
    } else if (r.flagged && !isMule) {
      fp++;
      disruptionVarPaise += DISRUPTION_FRAC * r.sumIn;
    } else if (!r.flagged && isMule) {
      fn++;
      missedInflowPaise += r.sumIn;
    } else {
      tn++;
    }
  }
  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  return {
    tp, fp, fn, tn,
    precision,
    recall,
    f1: (2 * precision * recall) / Math.max(precision + recall, 1e-9),
    heldPaise,
    disruptionVarPaise,
    missedInflowPaise,
    disruptionPaise: disruptionVarPaise + fp * DISRUPTION_FIXED_PAISE,
    missCostPaise: missedInflowPaise * MISS_COST_FRAC,
    netPaise:
      heldPaise * RECOVERY_RATE -
      (disruptionVarPaise + fp * DISRUPTION_FIXED_PAISE) -
      missedInflowPaise * MISS_COST_FRAC,
    byTypology,
    flagCount: tp + fp,
  };
}

export function netAt(
  c,
  recovery = RECOVERY_RATE,
  fracScale = 1,
  fixedPaise = DISRUPTION_FIXED_PAISE,
  missFrac = MISS_COST_FRAC
) {
  return (
    c.heldPaise * recovery -
    c.disruptionVarPaise * fracScale -
    c.fp * fixedPaise -
    c.missedInflowPaise * missFrac
  );
}
