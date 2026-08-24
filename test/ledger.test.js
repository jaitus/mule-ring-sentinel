import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger, verify } from "../src/audit/ledger.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempLedger() {
  return join(mkdtempSync(join(tmpdir(), "ledger-")), "audit.jsonl");
}

test("appends and verifies a clean chain", () => {
  const p = tempLedger();
  const l = new Ledger(p);
  l.append({ type: "decision", merchantId: "M1", action: "HOLD" });
  l.append({ type: "decision", merchantId: "M2", action: "RELEASE" });
  const v = verify(p);
  assert.equal(v.ok, true);
  assert.equal(v.checked, 2);
});

test("detects tampering with an entry", () => {
  const p = tempLedger();
  const l = new Ledger(p);
  l.append({ type: "decision", merchantId: "M1", action: "HOLD" });
  l.append({ type: "decision", merchantId: "M2", action: "RELEASE" });
  const raw = readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (line.includes('"M1"') ? line.replace('"HOLD"', '"RELEASE"') : line))
    .join("\n");
  writeFileSync(p, raw);
  const v = verify(p);
  assert.equal(v.ok, false);
  assert.match(v.reason, /hash mismatch/);
});

test("resumes sequence on existing file", () => {
  const p = tempLedger();
  new Ledger(p).append({ type: "decision", merchantId: "M1", action: "HOLD" });
  const l2 = new Ledger(p);
  l2.append({ type: "decision", merchantId: "M2", action: "HOLD" });
  const v = verify(p);
  assert.equal(v.ok, true);
  assert.equal(v.checked, 2);
});
