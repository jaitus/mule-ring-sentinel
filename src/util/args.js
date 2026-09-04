// Shared CLI argument parsing.
//
// `--seed` with no value behind it used to reach Number(undefined) === NaN, and
// every downstream consumer accepted it: the RNG produced a degenerate world and
// the pipeline wrote a ledger to runs/audit-NaN.jsonl. A silently wrong run is
// worse than a failed one, so bad input stops here.

export function numericArg(argv, flag, fallback) {
  const i = argv.indexOf(flag);
  if (i < 0) return fallback;
  const raw = argv[i + 1];
  if (raw === undefined || raw.startsWith("--")) {
    throw new Error(`${flag} needs a value, e.g. ${flag} 42`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${flag} must be a finite number, got "${raw}"`);
  }
  return n;
}

export function integerArg(argv, flag, fallback) {
  const n = numericArg(argv, flag, fallback);
  if (!Number.isInteger(n)) {
    throw new Error(`${flag} must be a whole number, got "${n}"`);
  }
  return n;
}
