export const RECOVERY_RATE = 0.6;
export const DISRUPTION_FRAC = 0.56;
export const DISRUPTION_FIXED_PAISE = 50000;

export function confusion(world, rows) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  let heldPaise = 0;
  let disruptionVarPaise = 0;
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
    disruptionPaise: disruptionVarPaise + fp * DISRUPTION_FIXED_PAISE,
    netPaise: heldPaise * RECOVERY_RATE - (disruptionVarPaise + fp * DISRUPTION_FIXED_PAISE),
    byTypology,
    flagCount: tp + fp,
  };
}

export function netAt(c, recovery = RECOVERY_RATE, fracScale = 1, fixedPaise = DISRUPTION_FIXED_PAISE) {
  return c.heldPaise * recovery - c.disruptionVarPaise * fracScale - c.fp * fixedPaise;
}
