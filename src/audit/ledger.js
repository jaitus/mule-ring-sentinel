import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";

const GENESIS = "0".repeat(64);

function canonical(entry) {
  return JSON.stringify({ ...entry, hash: undefined, prevHash: undefined });
}

function hashEntry(prevHash, entry) {
  return createHash("sha256").update(`${prevHash}|${canonical(entry)}`).digest("hex");
}

export class Ledger {
  constructor(path) {
    this.path = path;
    this.seq = 0;
    this.prevHash = GENESIS;
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length) {
        const last = JSON.parse(lines[lines.length - 1]);
        this.seq = last.seq;
        this.prevHash = last.hash;
      }
    }
  }

  append(entry) {
    this.seq++;
    const body = { seq: this.seq, ts: new Date().toISOString(), prevHash: this.prevHash, ...entry };
    body.hash = hashEntry(this.prevHash, body);
    this.prevHash = body.hash;
    appendFileSync(this.path, JSON.stringify(body) + "\n");
    return body;
  }
}

export function verify(path) {
  if (!existsSync(path)) return { ok: false, reason: "missing", checked: 0 };
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  let prevHash = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]);
    if (entry.prevHash !== prevHash) return { ok: false, reason: `chain break at seq ${entry.seq}`, checked: i };
    if (hashEntry(prevHash, entry) !== entry.hash) return { ok: false, reason: `hash mismatch at seq ${entry.seq}`, checked: i + 1 };
    prevHash = entry.hash;
  }
  return { ok: true, checked: lines.length };
}
