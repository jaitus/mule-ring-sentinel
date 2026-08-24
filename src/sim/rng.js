export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeRng(seed) {
  const rand = mulberry32(seed);
  return {
    next: rand,
    int(lo, hi) {
      return lo + Math.floor(rand() * (hi - lo + 1));
    },
    float(lo, hi) {
      return lo + rand() * (hi - lo);
    },
    poisson(lambda) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= rand();
      } while (p > L);
      return k - 1;
    },
    lognormal(mu, sigma) {
      return Math.exp(mu + sigma * gauss(rand));
    },
    pick(arr) {
      return arr[Math.floor(rand() * arr.length)];
    },
    chance(p) {
      return rand() < p;
    },
  };
}
