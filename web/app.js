const $ = (id) => document.getElementById(id);
let seed = 42;
let day = 0;
let timer = null;
let runData = null;

function fmt(paise) {
  if (paise === undefined || paise === null) return "–";
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

async function api(path) {
  const r = await fetch(path);
  return r.json();
}

function kpi(id, v) {
  $(id).textContent = v;
}

function renderKpis() {
  kpi("k-merchants", runData.merchantCount.toLocaleString("en-IN"));
  kpi("k-held", fmt(runData.summary.heldPaise));
  kpi("k-esc", runData.summary.counts.ESCALATE);
  kpi("k-hold", runData.summary.counts.HOLD);
  kpi("k-watch", runData.summary.counts.WATCH);
  $("thr").textContent = runData.threshold.toFixed(2);
}

function renderQueue() {
  const q = $("queue");
  q.innerHTML = "";
  const list = [...runData.decisions].sort((a, b) => b.score - a.score);
  for (const d of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = d.merchantId;
    const chips = d.reasons.map((r) => `<span class="chip">${r}</span>`).join("");
    const guard = d.guardrails.map((g) => `<span class="chip" style="border-color:var(--amber);color:var(--amber)">${g}</span>`).join("");
    card.innerHTML = `
      <div class="top">
        <span class="id">${d.merchantId} <span class="muted">[${d.archetype}]</span></span>
        <span class="badge ${d.action}">${d.action}</span>
      </div>
      <div class="chips">${chips}${guard}</div>
      <div class="scorebar"><i style="width:${Math.min(100, d.score * 100)}%"></i></div>`;
    card.onclick = () => openCase(d.merchantId);
    q.appendChild(card);
  }
}

async function playDay() {
  day++;
  if (day > 30) {
    stopPlay();
    day = 30;
    return;
  }
  $("day").textContent = day;
  const { events } = await api(`/api/day?seed=${seed}&d=${day - 1}`);
  $("feed-count").textContent = `${events.length} txns`;
  const feed = $("feed");
  for (const e of events.slice(0, 400)) {
    const div = document.createElement("div");
    div.className = e.dir === "in" ? "in" : "out";
    const arrow = e.dir === "in" ? "→ in " : "← out";
    div.textContent = `d${day} ${e.pay} ${arrow} ${e.m.padEnd(6)} ${fmt(e.amount).padStart(12)} ${e.kind}`;
    feed.prepend(div);
  }
  while (feed.children.length > 500) feed.lastChild.remove();
}

function startPlay() {
  if (timer) return;
  if (day >= 30) {
    day = 0;
    $("feed").innerHTML = "";
  }
  $("play").textContent = "❚❚ pause";
  timer = setInterval(playDay, 450);
}

function stopPlay() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "▶ play";
}

async function openCase(id) {
  const dossier = await api(`/api/case/${id}?seed=${seed}`);
  $("case-panel").hidden = false;
  $("case-id").textContent = `${id} [${dossier.archetype}]`;
  $("case-ai").innerHTML = `<p class="empty">not run yet — the gate decision never depends on this.</p>`;
  $("ai-btn").onclick = () => runAi(id);
  const f = $("case-findings");
  f.innerHTML = "";
  const addFinding = (text, cls = "") => {
    const div = document.createElement("div");
    div.className = `finding ${cls}`;
    div.textContent = text;
    f.appendChild(div);
  };
  addFinding(`gate action: ${dossier.action} · risk score ${(dossier.score ?? 0).toFixed(2)} · exposure ${fmt(dossier.exposurePaise)}`);
  for (const why of dossier.reasons) addFinding(why);
  if (!dossier.reasons.length) addFinding("no typology signals above threshold", "safe");
  const s = $("case-stats");
  s.innerHTML = `
    <div class="stat-row"><span>total inflow</span><b>${fmt(dossier.stats.totalInPaise)}</b></div>
    <div class="stat-row"><span>total outflow</span><b>${fmt(dossier.stats.totalOutPaise)}</b></div>
    <div class="stat-row"><span>distinct payer accounts</span><b>${dossier.stats.distinctInCp}</b></div>
    <div class="stat-row"><span>distinct payee accounts</span><b>${dossier.stats.distinctOutCp}</b></div>
    <div class="stat-row"><span>transactions</span><b>${dossier.stats.txnCount}</b></div>
    <div class="stat-row"><span>money authority</span><b>deterministic gate only</b></div>`;
  drawSpark(dossier.merchantId);
  document.getElementById("case-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function drawSpark(id) {
  const res = await fetch(`/api/spark?seed=${seed}&m=${encodeURIComponent(id)}`);
  if (!res.ok) return;
  const { series } = await res.json();
  const max = Math.max(...series.map(Math.abs), 1);
  const svg = $("spark");
  const mid = 40;
  svg.innerHTML = series
    .map((v, i) => {
      const h = (Math.abs(v) / max) * 36;
      const up = v >= 0;
      return `<rect x="${i * 10}" y="${up ? mid - h : mid}" width="8" height="${Math.max(h, 1)}" fill="${up ? "#3fd68f" : "#ff5d73"}" rx="1.5"/>`;
    })
    .join("");
}

async function runAi(id) {
  const box = $("case-ai");
  box.innerHTML = `<p class="empty">investigating…</p>`;
  const d = await api(`/api/dossier/${id}?seed=${seed}`);
  if (!d.aiNarrative) {
    box.innerHTML = `<div class="ai-block">${d.aiNote}</div>`;
    return;
  }
  const a = d.aiNarrative;
  box.innerHTML = `
    <div class="ai-block">${a.narrative}</div>
    <div class="ai-block"><b>typology:</b> ${a.typology_assessment}</div>
    ${(a.risk_factors ?? []).map((r) => `<div class="ai-block" style="border-left-color:var(--red)">risk · ${r}</div>`).join("")}
    ${(a.mitigating_factors ?? []).map((m) => `<div class="ai-block" style="border-left-color:var(--green)">mitigating · ${m}</div>`).join("")}
    <div class="ai-block"><b>recommendation:</b> ${a.recommended_action} · confidence ${(a.confidence * 100).toFixed(0)}%</div>
    <div class="ai-note">${d.aiNote}</div>`;
}

$("spark").innerHTML = "";

async function loadWorld() {
  seed = Number($("seed").value) || 42;
  day = 0;
  stopPlay();
  $("feed").innerHTML = "";
  $("day").textContent = 0;
  runData = await api(`/api/run?seed=${seed}`);
  renderKpis();
  renderQueue();
  await loadLedger();
}

async function loadLedger() {
  const data = await api(`/api/ledger?seed=${seed}`);
  const tb = $("ledger-body");
  tb.innerHTML = "";
  for (const e of data.entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.seq}</td>
      <td>${e.merchantId}</td>
      <td><span class="badge ${e.action}">${e.action}</span></td>
      <td>${e.score?.toFixed?.(2) ?? ""}</td>
      <td>${fmt(e.exposurePaise)}</td>
      <td class="muted">${(e.reasons ?? []).slice(0, 2).join("; ")}</td>
      <td class="hashcell">${(e.hash ?? "").slice(0, 10)}…</td>`;
    tb.appendChild(tr);
  }
  $("chain-status").textContent = data.entries.length
    ? `${data.verify.checked} entries · chain verify ${data.verify.ok ? "OK ✓ tamper-evident" : "FAILED ✗"}`
    : "no entries yet";
}

$("load").onclick = loadWorld;
$("play").onclick = () => (timer ? stopPlay() : startPlay());
$("close-case").onclick = () => ($("case-panel").hidden = true);

loadWorld();
