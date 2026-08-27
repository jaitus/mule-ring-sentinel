import { readFileSync, existsSync } from "node:fs";

export const MODEL = "qwen/qwen3.6-27b";

export function loadEnv(path = ".env") {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m) out[m[1].toUpperCase()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const SYSTEM = `You are a payments-fraud investigator for an Indian payment aggregator.
You receive an evidence bundle about ONE flagged merchant produced by a deterministic
graph-typology detector. Your job is to investigate and explain, never to decide:
the gate policy holds/releases funds in audited code regardless of your output.
Assess whether the evidence fits a known mule-conduit typology (layering fan-out,
smurfing fan-in, dormancy spike, carousel loop) or a legitimate business pattern
(dropshipping, B2B trading, travel bookings, contractor payouts).
Reply with STRICT JSON only:
{"narrative": string (<=120 words, factual, cites the evidence),
 "typology_assessment": string,
 "risk_factors": string[] (each <=15 words),
 "mitigating_factors": string[] (each <=15 words),
 "recommended_action": "ESCALATE" | "HOLD" | "WATCH" | "RELEASE",
 "confidence": number between 0 and 1}`;

// The model must never be asked to convert paise itself — it gets the magnitude
// wrong by a factor of ten often enough to poison a dossier. Convert here.
function inr(paise) {
  return "₹" + Math.round((paise ?? 0) / 100).toLocaleString("en-IN");
}

function lakhs(paise) {
  return ((paise ?? 0) / 10000000).toFixed(2);
}

export function buildPrompt(bundle) {
  const flows = (bundle.topFlows ?? [])
    .map((f) => `  ${f.cp}: in ${inr(f.inPaise)} / out ${inr(f.outPaise)}`)
    .join("\n");
  const series = (bundle.dailyNet ?? []).map((v) => lakhs(v)).join(",");
  return `MERCHANT: ${bundle.merchantId} [${bundle.archetype}]
GATE ACTION: ${bundle.action} (score ${bundle.score?.toFixed?.(2)}, exposure ${inr(bundle.exposurePaise)})
DETERMINISTIC REASONS:
${(bundle.reasons ?? []).map((r) => `- ${r}`).join("\n") || "- none"}
STATS: txns=${bundle.stats?.txnCount} in=${inr(bundle.stats?.totalInPaise)} out=${inr(bundle.stats?.totalOutPaise)} distinctIn=${bundle.stats?.distinctInCp} distinctOut=${bundle.stats?.distinctOutCp}
DAILY NET (₹ lakhs by day): ${series}
TOP COUNTERPARTIES:
${flows || "  none"}`;
}

function sleep(ms, impl) {
  return (impl ?? ((m) => new Promise((r) => setTimeout(r, m))))(ms);
}

function backoffMs(attempt) {
  return 1200 * 2 ** (attempt - 1) + Math.random() * 400;
}

function safeJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

// qwen3.6-27b is a reasoning model: with reasoning on it spends ~3k tokens thinking
// before it emits a character of JSON. A budget that runs out mid-thought yields an
// EMPTY completion, which Groq's json_object validator rejects as HTTP 400
// json_validate_failed — not a 429, so no amount of backoff recovers it.
// Tier 0 turns reasoning off: same verdict, ~256 tokens instead of ~3100, which also
// keeps a live demo inside the ~8000 tok/min free-tier limit. Tier 1 is the escape
// hatch if a bundle genuinely needs the model to think.
const TIERS = [
  { reasoning_effort: "none", max_tokens: 1500 },
  { reasoning_effort: "default", max_tokens: 4000 },
];

// Mocked responses in tests carry only json(); real ones carry text(). Tolerate both.
async function errorCode(r) {
  try {
    if (typeof r.text === "function") return JSON.parse(await r.text())?.error?.code ?? null;
    if (typeof r.json === "function") return (await r.json())?.error?.code ?? null;
  } catch {
    /* body absent or not JSON — caller falls back to the bare status */
  }
  return null;
}

export async function investigate(bundle, opts = {}) {
  const env = opts.apiKey ? {} : loadEnv(opts.envPath ?? ".env");
  const apiKey = opts.apiKey ?? env.GROQ_API_KEY;
  const model = opts.model ?? MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl;
  if (!apiKey) return { ok: false, reason: "no-key" };
  const maxAttempts = opts.maxAttempts ?? 4;
  let tier = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          ...TIERS[tier],
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: buildPrompt(bundle) },
          ],
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
      });
      if (r.status === 429) {
        if (attempt === maxAttempts) return { ok: false, reason: "rate-limited" };
        await sleep(backoffMs(attempt), sleepImpl);
        continue;
      }
      if (!r.ok) {
        // An empty completion is a budget problem, not a bad request. Retry richer.
        if (r.status === 400 && (await errorCode(r)) === "json_validate_failed" && tier < TIERS.length - 1) {
          tier++;
          continue;
        }
        return { ok: false, reason: `http-${r.status}` };
      }
      const data = await r.json();
      const parsed = safeJson(data.choices?.[0]?.message?.content ?? "");
      if (!parsed || typeof parsed.narrative !== "string") return { ok: false, reason: "bad-json" };
      return { ok: true, dossier: parsed, model, effort: TIERS[tier].reasoning_effort };
    } catch (e) {
      if (attempt === maxAttempts) {
        return { ok: false, reason: e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "network" };
      }
      await sleep(backoffMs(attempt), sleepImpl);
    }
  }
  return { ok: false, reason: "exhausted" };
}
