export const ARCHETYPES = [
  { name: "kirana", weight: 0.2, lambda: 9, avgAmt: 80000, amtSigma: 0.9, custPool: 40, custReuse: 0.55, vendors: 2, payoutFrac: 0.45, payoutEvery: 4, seasonal: true },
  { name: "d2c", weight: 0.16, lambda: 16, avgAmt: 160000, amtSigma: 1.0, custPool: 80, custReuse: 0.35, vendors: 3, payoutFrac: 0.55, payoutEvery: 3, seasonal: true },
  { name: "saas", weight: 0.11, lambda: 4, avgAmt: 450000, amtSigma: 0.6, custPool: 25, custReuse: 0.85, vendors: 2, payoutFrac: 0.4, payoutEvery: 6, seasonal: false },
  { name: "dormant", weight: 0.1, lambda: 0.25, avgAmt: 120000, amtSigma: 0.8, custPool: 10, custReuse: 0.5, vendors: 1, payoutFrac: 0.5, payoutEvery: 9, seasonal: false },
  { name: "dropshipper", weight: 0.11, lambda: 11, avgAmt: 240000, amtSigma: 0.7, custPool: 60, custReuse: 0.3, vendors: 3, payoutFrac: 0.88, payoutEvery: 2, seasonal: true },
  { name: "events", weight: 0.09, lambda: 3, avgAmt: 260000, amtSigma: 0.8, custPool: 200, custReuse: 0.15, vendors: 2, payoutFrac: 0.6, payoutEvery: 2, seasonal: true, eventLambda: 42 },
  { name: "freelancer", weight: 0.06, lambda: 1.2, avgAmt: 350000, amtSigma: 0.5, custPool: 15, custReuse: 0.45, vendors: 1, payoutFrac: 0.5, payoutEvery: 7, seasonal: true },
  { name: "b2b_trader", weight: 0.17, lambda: 5, avgAmt: 4000000, amtSigma: 0.6, custPool: 30, custReuse: 0.5, vendors: 8, payoutFrac: 0.9, payoutEvery: 2, seasonal: false, lumpyPayout: true },
  { name: "travel_agency", weight: 0.06, lambda: 2.5, avgAmt: 4500000, amtSigma: 0.9, custPool: 300, custReuse: 0.02, vendors: 5, payoutFrac: 0.88, payoutEvery: 2, seasonal: true, lumpyPayout: true },
  { name: "contractor", weight: 0.05, lambda: 2, avgAmt: 6000000, amtSigma: 1.0, custPool: 6, custReuse: 0.9, vendors: 14, payoutFrac: 0.93, payoutEvery: 3, seasonal: false, lumpyPayout: true },
];

export const METHODS = [
  { name: "upi", weight: 0.65 },
  { name: "card", weight: 0.2 },
  { name: "netbanking", weight: 0.1 },
  { name: "wallet", weight: 0.05 },
];

export function pickWeighted(rng, items, key = "weight") {
  const roll = rng.next();
  let acc = 0;
  for (const it of items) {
    acc += it[key];
    if (roll < acc) return it;
  }
  return items[items.length - 1];
}

export function pickArchetype(rng) {
  return pickWeighted(rng, ARCHETYPES);
}

export function pickMethod(rng) {
  return pickWeighted(rng, METHODS).name;
}
