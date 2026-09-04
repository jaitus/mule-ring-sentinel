import { test } from "node:test";
import assert from "node:assert/strict";
import { numericArg, integerArg } from "../src/util/args.js";

const argv = (...rest) => ["node", "script.js", ...rest];

test("returns the fallback when the flag is absent", () => {
  assert.equal(integerArg(argv(), "--seed", 42), 42);
  assert.equal(integerArg(argv("--merchant", "M0066"), "--seed", 42), 42);
});

test("parses a provided value", () => {
  assert.equal(integerArg(argv("--seed", "7"), "--seed", 42), 7);
  assert.equal(numericArg(argv("--thr", "0.45"), "--thr", 0.4), 0.45);
});

test("a flag with no value throws instead of becoming NaN", () => {
  // This is the regression: Number(undefined) is NaN, which used to flow into
  // buildWorld and write a ledger to runs/audit-NaN.jsonl.
  assert.throws(() => integerArg(argv("--seed"), "--seed", 42), /needs a value/);
  assert.throws(() => integerArg(argv("--seed", "--merchant", "M1"), "--seed", 42), /needs a value/);
});

test("a non-numeric value throws", () => {
  assert.throws(() => integerArg(argv("--seed", "abc"), "--seed", 42), /finite number/);
  assert.throws(() => integerArg(argv("--seed", "NaN"), "--seed", 42), /finite number/);
  assert.throws(() => integerArg(argv("--seed", "Infinity"), "--seed", 42), /finite number/);
});

test("integerArg rejects a fractional seed", () => {
  assert.throws(() => integerArg(argv("--seed", "4.5"), "--seed", 42), /whole number/);
  assert.equal(numericArg(argv("--seed", "4.5"), "--seed", 42), 4.5, "numericArg still allows it");
});
