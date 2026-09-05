const $ = (id) => document.getElementById(id);
let seed = 42;
let day = 0;
let timer = null;
let runData = null;
let filter = "ALL";
let openId = null;

function fmt(paise) {
  if (paise === undefined || paise === null) return "–";
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

async function api(path) {
  const r = await fetch(path);
  return r.json();
}

function renderTopStats() {
  $("k-merchants").textContent = runData.merchantCount.toLocaleString("en-IN");
  $("k-held").textContent = fmt(runData.summary.heldPaise);
  $("k-esc").textContent = runData.summary.counts.ESCALATE;
  $("k-hold").textContent = runData.summary.counts.HOLD;
  $("k-watch").textContent = runData.summary.counts.WATCH;
  $("thr").textContent = runData.threshold.toFixed(2);
}

function renderQueue() {
  const q = $("queue");
  q.innerHTML = "";
  const list = [...runData.decisions]
    .filter((d) => filter === "ALL" || d.action === filter)
    .sort((a, b) => b.score - a.score);
  if (!list.length) {
    q.innerHTML = `<p class="empty">nothing at this filter.</p>`;
    return;
  }
  for (const d of list) {
    const card = document.createElement("div");
    card.className = "card" + (d.merchantId === openId ? " open" : "");
    card.dataset.id = d.merchantId;
    const chips = d.reasons.slice(0, 2).map((r) => `<span class="chip">${r}</span>`).join("");
    const guard = d.guardrails.length ? `<span class="chip guard">${d.guardrails.length} guardrail</span>` : "";
    card.innerHTML = `
      <div class="top">
        <span class="id">${d.merchantId}</span>
        <span class="badge ${d.action}">${d.action}</span>
      </div>
      <div class="cardmeta">${d.archetype} · ${fmt(d.exposurePaise)}</div>
      <div class="chips">${chips}${guard}</div>
      <div class="scorebar"><i style="width:${Math.min(100, d.score * 100)}%"></i></div>`;
    card.onclick = () => openCase(d.merchantId);
    q.appendChild(card);
  }
}

for (const b of document.querySelectorAll("#filters .f")) {
  b.onclick = () => {
    filter = b.dataset.f;
    for (const x of document.querySelectorAll("#filters .f")) x.classList.toggle("on", x === b);
    renderQueue();
  };
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
    const arrow = e.dir === "in" ? "→" : "←";
    div.textContent = `d${day} ${arrow} ${e.m} ${fmt(e.amount)}`;
    feed.prepend(div);
  }
  while (feed.children.length > 400) feed.lastChild.remove();
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
  openId = id;
  const dossier = await api(`/api/case/${id}?seed=${seed}`);
  $("case-empty").hidden = true;
  $("case-panel").hidden = false;
  $("case-merchant").textContent = id;
  $("case-arch").textContent = `[${dossier.archetype}]`;

  const action = dossier.action ?? "RELEASE";
  const badge = $("case-action");
  badge.textContent = action;
  badge.className = `badge ${action}`;
  const score = dossier.score ?? 0;
  $("case-score").textContent = score.toFixed(2);
  $("case-scorebar").style.width = `${Math.min(100, score * 100)}%`;

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
  addFinding(`exposure ${fmt(dossier.exposurePaise)} · flagged on day ${dossier.dayFlagged ?? "–"}`);
  for (const why of dossier.reasons) addFinding(why);
  if (!dossier.reasons.length) addFinding("no typology signals above threshold", "safe");
  for (const g of dossier.guardrails ?? []) addFinding(g, "guard");

  $("case-stats").innerHTML = `
    <div class="stat-row"><span>total inflow</span><b>${fmt(dossier.stats.totalInPaise)}</b></div>
    <div class="stat-row"><span>total outflow</span><b>${fmt(dossier.stats.totalOutPaise)}</b></div>
    <div class="stat-row"><span>distinct payers</span><b>${dossier.stats.distinctInCp}</b></div>
    <div class="stat-row"><span>distinct payees</span><b>${dossier.stats.distinctOutCp}</b></div>
    <div class="stat-row"><span>transactions</span><b>${dossier.stats.txnCount}</b></div>
    <div class="stat-row"><span>money authority</span><b class="auth">deterministic gate only</b></div>`;

  drawSpark(id);
  renderQueue();
}

async function drawSpark(id) {
  const res = await fetch(`/api/spark?seed=${seed}&m=${encodeURIComponent(id)}`);
  if (!res.ok) return;
  const { series } = await res.json();
  const max = Math.max(...series.map(Math.abs), 1);
  const mid = 40;
  $("spark").innerHTML = series
    .map((v, i) => {
      const h = (Math.abs(v) / max) * 36;
      const up = v >= 0;
      return `<rect x="${i * 10}" y="${up ? mid - h : mid}" width="8" height="${Math.max(h, 1)}" fill="${up ? "#3dff9a" : "#ff5f6d"}" rx="1"/>`;
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
    ${(a.risk_factors ?? []).map((r) => `<div class="ai-block risk">risk · ${r}</div>`).join("")}
    ${(a.mitigating_factors ?? []).map((m) => `<div class="ai-block mit">mitigating · ${m}</div>`).join("")}
    <div class="ai-block"><b>recommendation:</b> ${a.recommended_action} · confidence ${(a.confidence * 100).toFixed(0)}%</div>
    <div class="ai-note">${d.aiNote}</div>`;
}

$("spark").innerHTML = "";

async function loadWorld() {
  seed = Number($("seed").value) || 42;
  day = 0;
  openId = null;
  stopPlay();
  $("feed").innerHTML = "";
  $("day").textContent = 0;
  $("case-panel").hidden = true;
  $("case-empty").hidden = false;
  runData = await api(`/api/run?seed=${seed}`);
  renderTopStats();
  renderQueue();
  await loadLedger();
}

// Re-reads the ledger from disk and re-walks the hash chain. This is a real
// operator action, not a refresh button: the whole point of a tamper-evident log
// is being able to re-verify it on demand, against the file as it is right now.
async function loadLedger() {
  const btn = $("reverify");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "verifying…";
  }
  const data = await api(`/api/ledger?seed=${seed}`);
  if (btn) {
    btn.disabled = false;
    btn.textContent = "re-verify";
  }
  const tb = $("ledger-body");
  tb.innerHTML = "";
  for (const e of data.entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.seq}</td>
      <td>${e.merchantId}</td>
      <td><span class="badge ${e.action}">${e.action}</span></td>
      <td>${fmt(e.exposurePaise)}</td>
      <td class="hashcell">${(e.hash ?? "").slice(0, 8)}…</td>`;
    tb.appendChild(tr);
  }
  const st = $("chain-status");
  st.textContent = data.entries.length
    ? `${data.verify.checked} entries · chain ${data.verify.ok ? "verify OK ✓" : "FAILED ✗"}`
    : "no entries yet";
  st.classList.toggle("broken", data.entries.length > 0 && !data.verify.ok);
}

$("load").onclick = loadWorld;
$("reverify").onclick = loadLedger;
$("play").onclick = () => (timer ? stopPlay() : startPlay());

loadWorld();
