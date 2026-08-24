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

export function buildPrompt(bundle) {
  const flows = (bundle.topFlows ?? [])
    .map((f) => `  ${f.cp}: in ${f.inPaise} paise / out ${f.outPaise} paise`)
    .join("\n");
  const series = (bundle.dailyNet ?? []).map((v) => Math.round(v / 100000)).join(",");
  return `MERCHANT: ${bundle.merchantId} [${bundle.archetype}]
GATE ACTION: ${bundle.action} (score ${bundle.score?.toFixed?.(2)}, exposure ${bundle.exposurePaise} paise)
DETERMINISTIC REASONS:
${(bundle.reasons ?? []).map((r) => `- ${r}`).join("\n") || "- none"}
STATS: txns=${bundle.stats?.txnCount} in=${bundle.stats?.totalInPaise}p out=${bundle.stats?.totalOutPaise}p distinctIn=${bundle.stats?.distinctInCp} distinctOut=${bundle.stats?.distinctOutCp}
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

export async function investigate(bundle, opts = {}) {
  const env = opts.apiKey ? {} : loadEnv(opts.envPath ?? ".env");
  const apiKey = opts.apiKey ?? env.GROQ_API_KEY;
  const model = opts.model ?? MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl;
  if (!apiKey) return { ok: false, reason: "no-key" };
  const maxAttempts = opts.maxAttempts ?? 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 900,
          response_format: { type: "json_object" },
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
      if (!r.ok) return { ok: false, reason: `http-${r.status}` };
      const data = await r.json();
      const parsed = safeJson(data.choices?.[0]?.message?.content ?? "");
      if (!parsed || typeof parsed.narrative !== "string") return { ok: false, reason: "bad-json" };
      return { ok: true, dossier: parsed, model };
    } catch (e) {
      if (attempt === maxAttempts) {
        return { ok: false, reason: e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "network" };
      }
      await sleep(backoffMs(attempt), sleepImpl);
    }
  }
  return { ok: false, reason: "exhausted" };
}
