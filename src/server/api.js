import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRun } from "./store.js";
import { Ledger, verify } from "../audit/ledger.js";
import { investigate } from "../agent/investigate.js";

const PORT = 8898;
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const WEB = join(ROOT, "web");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function ledgerPathFor(seed) {
  mkdirSync(join(ROOT, "runs"), { recursive: true });
  return join(ROOT, "runs", `audit-${seed}.jsonl`);
}

function buildDossier(run, merchantId) {
  const row = run.rowById.get(merchantId);
  const decision = run.decisions.find((d) => d.merchantId === merchantId);
  const events = run.eventsFor(merchantId);
  let inSum = 0;
  let outSum = 0;
  const cpIn = new Set();
  const cpOut = new Set();
  for (const e of events) {
    if (e.dir === "in") {
      inSum += e.amount;
      cpIn.add(e.cp);
    } else {
      outSum += e.amount;
      cpOut.add(e.cp);
    }
  }
  return {
    merchantId,
    archetype: run.archetypeOf[merchantId],
    action: decision?.action,
    score: row?.score,
    dayFlagged: row?.day,
    reasons: decision?.reasons ?? [],
    guardrails: decision?.guardrails ?? [],
    exposurePaise: decision?.exposurePaise,
    stats: {
      totalInPaise: inSum,
      totalOutPaise: outSum,
      distinctInCp: cpIn.size,
      distinctOutCp: cpOut.size,
      txnCount: events.length,
    },
    deterministicFindings: {
      method: "graph-typology rules v1 (pass-through, fan-out, burst, one-time-payer share, cross-account loop, thin-history volume)",
      moneyAuthority: "gate policy — LLM has no money authority",
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path.startsWith("/api/")) {
    if (path === "/api/run") {
      const seed = Number(url.searchParams.get("seed") ?? 42);
      const run = getRun(seed);
      return json(res, 200, {
        seed: run.seed,
        threshold: run.threshold,
        days: run.days,
        merchantCount: run.merchantCount,
        summary: run.summary,
        decisions: run.decisions.filter((d) => d.action !== "RELEASE"),
      });
    }
    if (path === "/api/day") {
      const seed = Number(url.searchParams.get("seed") ?? 42);
      const d = Number(url.searchParams.get("d") ?? 0);
      const run = getRun(seed);
      return json(res, 200, { day: d, events: run.eventsByDay[d] ?? [] });
    }
    if (path.startsWith("/api/case/")) {
      const seed = Number(url.searchParams.get("seed") ?? 42);
      const id = decodeURIComponent(path.split("/")[3]);
      const run = getRun(seed);
      if (!run.rowById.has(id)) return json(res, 404, { error: "unknown merchant" });
      return json(res, 200, buildDossier(run, id));
    }
    if (path === "/api/spark") {
      const seedQ = Number(url.searchParams.get("seed") ?? 42);
      const m = url.searchParams.get("m") ?? "";
      const run = getRun(seedQ);
      const series = new Array(run.days).fill(0);
      if (run.rowById.has(m)) {
        for (const e of run.eventsFor(m)) series[e.d] += e.dir === "in" ? e.amount : -e.amount;
      }
      return json(res, 200, { series });
    }
    if (path.startsWith("/api/dossier/")) {
      const seedQ = Number(url.searchParams.get("seed") ?? 42);
      const id = decodeURIComponent(path.split("/")[3]);
      const run = getRun(seedQ);
      if (!run.rowById.has(id)) return json(res, 404, { error: "unknown merchant" });
      const dossier = buildDossier(run, id);
      const bundle = run.evidenceBundle(id);
      const inv = await investigate(bundle);
      dossier.aiNarrative = inv.ok ? inv.dossier : null;
      dossier.aiNote = inv.ok
        ? `AI investigation via ${inv.model} — advisory only; the gate decision is unchanged.`
        : `LLM investigator unavailable (${inv.reason}); deterministic findings are authoritative.`;
      return json(res, 200, dossier);
    }
    if (path === "/api/ledger") {
      const seed = Number(url.searchParams.get("seed") ?? 42);
      const p = ledgerPathFor(seed);
      let entries = [];
      if (existsSync(p)) entries = readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      return json(res, 200, { entries: entries.slice(-50), verify: verify(p), path: p });
    }
    return json(res, 404, { error: "not found" });
  }

  let file = join(WEB, path === "/" ? "index.html" : path);
  if (!existsSync(file)) file = join(WEB, "index.html");
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    json(res, 500, { error: "read failed" });
  }
});

server.listen(PORT, () => console.log(`Mule-Ring Sentinel dashboard → http://localhost:${PORT}`));
