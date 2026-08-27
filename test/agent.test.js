import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEnv, buildPrompt, investigate } from "../src/agent/investigate.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
  };
}

const BUNDLE = {
  merchantId: "M0323",
  archetype: "new_onboarding",
  action: "ESCALATE",
  score: 0.68,
  exposurePaise: 11710000,
  reasons: ["pass-through 211% of inflow sent onward"],
  stats: { txnCount: 32, totalInPaise: 23177700, totalOutPaise: 24715500, distinctInCp: 25, distinctOutCp: 7 },
  dailyNet: [0, 1000000, -2000000],
  topFlows: [{ cp: "pers:9", inPaise: 100000, outPaise: 90000 }],
};

test("loadEnv parses KEY=value and strips quotes", () => {
  const p = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(p, "GROQ_API_KEY=\"abc_123\"\n# comment\nBAD LINE\nOTHER=x\n");
  const env = loadEnv(p);
  assert.equal(env.GROQ_API_KEY, "abc_123");
  assert.equal(env.OTHER, "x");
  assert.equal(env.BAD, undefined);
});

test("buildPrompt includes merchant and evidence, no key material", () => {
  const s = buildPrompt(BUNDLE);
  assert.match(s, /M0323/);
  assert.match(s, /pass-through 211%/);
  assert.doesNotMatch(s, /api|key|Bearer/i);
});

test("investigate without key degrades cleanly", async () => {
  const r = await investigate(BUNDLE, { envPath: join(tmpdir(), "definitely-missing.env"), fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-key");
});

test("investigate parses a good JSON response", async () => {
  const good = { narrative: "n", typology_assessment: "t", risk_factors: [], mitigating_factors: [], recommended_action: "HOLD", confidence: 0.7 };
  let calls = 0;
  const r = await investigate(BUNDLE, {
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      return okResponse(good);
    },
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 1);
  assert.equal(r.dossier.recommended_action, "HOLD");
});

test("investigate backs off on 429 then succeeds", async () => {
  const good = { narrative: "n", typology_assessment: "t", risk_factors: [], mitigating_factors: [], recommended_action: "WATCH", confidence: 0.5 };
  let calls = 0;
  const r = await investigate(BUNDLE, {
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
      return okResponse(good);
    },
    sleepImpl: async () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
});

test("investigate gives up after repeated 429s", async () => {
  let calls = 0;
  const r = await investigate(BUNDLE, {
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      return { ok: false, status: 429, json: async () => ({}) };
    },
    sleepImpl: async () => {},
    maxAttempts: 3,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "rate-limited");
  assert.equal(calls, 3);
});

test("buildPrompt sends rupees, never raw paise, and labels lakhs correctly", () => {
  const s = buildPrompt(BUNDLE);
  // exposurePaise 11710000 = ₹1,17,100. The model must never see the paise integer.
  assert.match(s, /exposure ₹1,17,100/);
  assert.doesNotMatch(s, /11710000/);
  assert.doesNotMatch(s, /paise/);
  // dailyNet [0, 1000000, -2000000] paise = 0, ₹0.10L, -₹0.20L. The old code divided
  // by 100000 and called the result lakhs, overstating every day by 100x.
  assert.match(s, /DAILY NET \(₹ lakhs by day\): 0\.00,0\.10,-0\.20/);
});

test("json_validate_failed escalates the token budget instead of dying", async () => {
  const good = { narrative: "n", typology_assessment: "t", risk_factors: [], mitigating_factors: [], recommended_action: "ESCALATE", confidence: 0.9 };
  const sent = [];
  const r = await investigate(BUNDLE, {
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      if (sent.length === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { code: "json_validate_failed" } }),
        };
      }
      return okResponse(good);
    },
    sleepImpl: async () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].reasoning_effort, "none");
  assert.equal(sent[1].reasoning_effort, "default");
  assert.ok(sent[1].max_tokens > sent[0].max_tokens);
  assert.equal(r.effort, "default");
});

test("a non-budget 400 still fails fast without a second call", async () => {
  let calls = 0;
  const r = await investigate(BUNDLE, {
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: "model_decommissioned" } }) };
    },
    sleepImpl: async () => {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "http-400");
  assert.equal(calls, 1);
});

test("investigate survives markdown-fenced JSON", async () => {
  const good = { narrative: "n", typology_assessment: "t", risk_factors: [], mitigating_factors: [], recommended_action: "RELEASE", confidence: 0.4 };
  const r = await investigate(BUNDLE, {
    apiKey: "k",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "```json\n" + JSON.stringify(good) + "\n```" } }] }),
    }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.dossier.recommended_action, "RELEASE");
});
