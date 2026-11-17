'use strict';
/* ===================== 賽跑抽獎系統 ===================== */
const $ = (id) => document.getElementById(id);
const STORE_KEY = 'race-lottery-v1';
const TRACK = 1000;          // 賽道長度 (m)
const COLORS = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93','#ff924c','#52a675','#4267ac','#c5ca30','#f15bb5','#00bbf9','#00f5d4','#9b5de5','#fee440','#e76f51'];

let state = null;
let pendingAvatar = null;

/* ---------- 狀態儲存 ---------- */
function newState() {
  return { phase: 'setup', total: 0, pool: [], players: [], awards: {}, finishOrder: [] };
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); } }
function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.phase) return s; } catch (e) {}
  return newState();
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- 音效 ---------- */
let actx = null, muted = false;
function beep(freq = 600, dur = 0.08, type = 'square', vol = 0.08) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch (e) {}
}
function fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.12), i * 120)); }
$('muteBtn').onclick = () => { muted = !muted; $('muteBtn').textContent = muted ? '🔇' : '🔊'; };

/* ---------- 頭像 ---------- */
function defaultAvatar(name, idx) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = COLORS[idx % COLORS.length]; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText((name || '?').trim().charAt(0) || '?', 64, 70);
  return c.toDataURL('image/png');
}
function fileToAvatar(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height), c = document.createElement('canvas');
        c.width = c.height = 160;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}
const imgCache = {};
function avatarImg(p) {
  if (!imgCache[p.id]) { const i = new Image(); i.src = p.avatar; imgCache[p.id] = i; }
  return imgCache[p.id];
}

/* ---------- 畫面切換 ---------- */
function show(phase) {
  ['setup', 'register', 'race', 'results'].forEach(s => $('screen-' + s).classList.toggle('hidden', s !== phase));
  state.phase = phase; save();
  if (phase === 'register') renderRegister();
  if (phase === 'race') initRace();
  if (phase === 'results') renderResults();
}

/* ---------- 設定人數 ---------- */
$('setupBtn').onclick = () => {
  const n = parseInt($('totalInput').value, 10);
  if (!(n >= 2 && n <= 50)) { alert('人數需介於 2 ~ 50'); return; }
  if (!confirm(`確定總人數為 ${n} 人？設定後不可更改。`)) return;
  state.total = n;
  state.pool = shuffle(Array.from({ length: n }, (_, i) => i + 1));
  show('register');
};

/* ---------- 登錄 ---------- */
function renderRegister() {
  const done = state.players.length, full = done >= state.total;
  $('regProgress').textContent = `${done} / ${state.total}`;
  $('playerList').innerHTML = state.players.map(p =>
    `<div class="p"><button class="del" data-id="${p.id}" title="刪除">✕</button><img src="${p.avatar}">${escapeHtml(p.name)}</div>`).join('');
  $('toRaceBtn').classList.toggle('hidden', !full);
  ['nameInput', 'submitBtn', 'fillTestBtn', 'photoInput'].forEach(id => $(id).disabled = full);
  $('submitBtn').textContent = full ? '全員登錄完畢 ✅' : '送出領取號碼';
  if (!pendingAvatar) $('avatarPreview').src = defaultAvatar($('nameInput').value || '?', done);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('playerList').onclick = (e) => {
  const id = e.target.dataset && e.target.dataset.id; if (!id) return;
  const p = state.players.find(x => x.id === id); if (!p) return;
  if (!confirm(`確定刪除「${p.name}」？其號碼將放回號碼池，可重新登錄。`)) return;
  state.players = state.players.filter(x => x.id !== id);
  state.pool.push(p.num); shuffle(state.pool);
  delete imgCache[id]; save(); renderRegister();
};
$('nameInput').oninput = () => { if (!pendingAvatar) $('avatarPreview').src = defaultAvatar($('nameInput').value || '?', state.players.length); };
$('photoInput').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { pendingAvatar = await fileToAvatar(f); $('avatarPreview').src = pendingAvatar; } catch (err) { alert('照片讀取失敗'); }
  e.target.value = '';
};
function addPlayer(name, avatar) {
  const num = state.pool.pop();
  const p = { id: 'p' + state.players.length + '_' + Date.now().toString(36), name, avatar: avatar || defaultAvatar(name, state.players.length), num };
  state.players.push(p); save();
  return p;
}
$('submitBtn').onclick = () => {
  const name = $('nameInput').value.trim();
  if (!name) { $('regError').textContent = '請輸入姓名'; return; }
  if (state.players.some(p => p.name === name)) { $('regError').textContent = '姓名重複，請加上區別'; return; }
  if (state.players.length >= state.total) return;
  $('regError').textContent = '';
  const p = addPlayer(name, pendingAvatar);
  beep(880, 0.15, 'triangle');
  $('numAvatar').src = p.avatar; $('numName').textContent = p.name; $('numValue').textContent = p.num;
  $('numberModal').classList.remove('hidden');
};
$('numOkBtn').onclick = () => {
  $('numberModal').classList.add('hidden');
  $('numValue').textContent = '';
  $('nameInput').value = ''; pendingAvatar = null;
  renderRegister();
};
$('fillTestBtn').onclick = () => {
  if (!confirm('以測試玩家填滿剩餘名額？（不會顯示號碼）')) return;
  let i = 1;
  while (state.players.length < state.total) {
    let nm = '測試' + i++;
    if (!state.players.some(p => p.name === nm)) addPlayer(nm);
  }
  renderRegister();
};
$('toRaceBtn').onclick = () => {
  // 驗證號碼全部配置
  const nums = state.players.map(p => p.num).sort((a, b) => a - b);
  const ok = nums.length === state.total && nums.every((n, i) => n === i + 1);
  if (!ok) { alert('號碼配置異常！請重新開始'); return; }
  show('race');
};
function resetAll() {
  if (!confirm('確定要清除所有資料並重新開始？')) return;
  localStorage.removeItem(STORE_KEY); location.reload();
}
$('resetBtn1').onclick = resetAll; $('resetBtn2').onclick = resetAll;

/* ===================== 賽跑 ===================== */
let runners = [], raceRunning = false, paused = true, lastT = 0, speedTimer = 0, finishQueue = [], camX = 0, camZ = 0, rafId = 0, elapsed = 0;
const camCv = $('camCanvas'), topCv = $('topCanvas');

function initRace() {
  state.finishOrder = state.finishOrder.filter(id => state.awards[id] !== undefined); save();
  // 每位跑者隱藏的「實力係數」平均分布在 0.5~1.15，讓抵達時間拉開
  const n = state.players.length;
  const ranks = shuffle(Array.from({ length: n }, (_, i) => i));
  runners = state.players.map((p, i) => {
    const done = state.finishOrder.includes(p.id);
    const ability = 1.15 - (n > 1 ? ranks[i] / (n - 1) : 0) * 0.65;
    return { p, lane: i, pos: done ? TRACK + 20 : 0, speed: 0, target: 0, fx: '', fxT: 0, done, ability, bob: Math.random() * 6 };
  });
  camFocus = null;
  finishQueue = []; paused = true; raceRunning = false;
  $('startRaceBtn').classList.remove('hidden');
  $('startRaceBtn').textContent = state.finishOrder.length ? '繼續比賽' : '開始比賽';
  resizeCanvases();
  cancelAnimationFrame(rafId); lastT = performance.now(); rafId = requestAnimationFrame(loop);
}
function resizeCanvases() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  [camCv, topCv].forEach(c => { const r = c.getBoundingClientRect(); c.width = r.width * dpr; c.height = r.height * dpr; c.dpr = dpr; });
}
window.addEventListener('resize', () => { if (state.phase === 'race') resizeCanvases(); });

$('startRaceBtn').onclick = () => {
  $('startRaceBtn').classList.add('hidden');
  const cd = $('countdown'); let n = 3;
  const tick = () => {
    cd.classList.remove('hidden'); cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = '';
    if (n > 0) { cd.textContent = n; beep(500, 0.2, 'square', 0.1); n--; setTimeout(tick, 1000); }
    else { cd.textContent = 'GO!'; beep(1000, 0.4, 'square', 0.12); setTimeout(() => cd.classList.add('hidden'), 700); startRunning(); }
  };
  tick();
};
function startRunning() { raceRunning = true; paused = false; speedTimer = 0; rerollSpeeds(); }

const active = () => runners.filter(r => !r.done);
function leader() {
  const a = active(); if (!a.length) return runners[0];
  return a.reduce((m, r) => r.pos > m.pos ? r : m, a[0]);
}
// 每秒重新決定速度：基礎隨機 × 實力係數 + 暴衝/踉蹌事件 + 極大落差時微弱追趕
let camFocus = null, speedMul = 1;
$('speedBtn').onclick = () => {
  speedMul = speedMul === 1 ? 2 : 1;
  $('speedBtn').classList.toggle('on', speedMul === 2);
  $('speedBtn').textContent = speedMul === 2 ? '⚡ X2 開啟中' : '⏩ X2 加速';
};
function rerollSpeeds() {
  const a = active(); if (!a.length) return;
  const lead = leader().pos;
  a.forEach(r => {
    let s = rand(17, 27) * r.ability;
    const gap = lead - r.pos;
    r.fx = '';
    const roll = Math.random();
    if (roll < 0.08) { s *= rand(1.4, 1.7); r.fx = '🔥'; }
    else if (roll < 0.15) { s *= rand(0.35, 0.6); r.fx = '🍌'; }
    if (gap > 150) { s += Math.min((gap - 150) * 0.02, 3); if (!r.fx) r.fx = '⚡'; }
    r.target = s;
  });
}

function loop(t) {
  const dt = Math.min((t - lastT) / 1000, 0.05); lastT = t;
  if (raceRunning && !paused) update(dt * speedMul);
  draw(t / 1000);
  rafId = requestAnimationFrame(loop);
}
function update(dt) {
  elapsed += dt; speedTimer += dt;
  if (speedTimer >= 1) { speedTimer -= 1; rerollSpeeds(); }
  runners.forEach(r => {
    if (r.done) { if (r.pos < TRACK + 20) r.pos = Math.min(TRACK + 20, r.pos + 15 * dt); return; }
    r.speed += (r.target - r.speed) * Math.min(1, dt * 3);
    r.pos += r.speed * dt; r.bob += dt * r.speed * 0.5;
    if (r.pos >= TRACK && !finishQueue.includes(r)) finishQueue.push(r);
  });
  if (finishQueue.length) {
    finishQueue.sort((a, b) => b.pos - a.pos);
    paused = true;
    nextFinisher();
  }
}
function nextFinisher() {
  const r = finishQueue.shift();
  if (!r) { // 全部處理完
    if (!active().length) { setTimeout(() => show('results'), 1200); return; }
    paused = false; return;
  }
  r.done = true;
  if (!state.finishOrder.includes(r.p.id)) { state.finishOrder.push(r.p.id); save(); }
  openWheel(r.p);
}

/* ---------- 上帝視角 ---------- */
function drawRoundAvatar(ctx, p, x, y, size, ring = '#fff') {
  const img = avatarImg(p);
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = '#666'; ctx.fill(); ctx.clip();
  if (img.complete && img.naturalWidth) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.lineWidth = Math.max(1.5, size * 0.08); ctx.strokeStyle = ring; ctx.stroke();
}
function drawTop(time) {
  const c = topCv, ctx = c.getContext('2d'), W = c.width, H = c.height, d = c.dpr;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#2f7d3a'; ctx.fillRect(0, 0, W, H);
  const N = runners.length, vertical = H > W * 0.9;
  const padStart = (vertical ? H : W) * 0.06, padEnd = (vertical ? H : W) * 0.1;
  const along = (vertical ? H : W) - padStart - padEnd - 30 * d;
  const cross = vertical ? W : H - 30 * d;
  const crossOff = vertical ? 0 : 30 * d;
  const laneW = cross / N;
  // 跑道轉換
  const pt = (pos, lane) => {
    const a = padStart + Math.min(pos, TRACK + 25) / TRACK * along, b = crossOff + (lane + 0.5) * laneW;
    return vertical ? [b, H - a] : [a + 0, b];
  };
  // 跑道底色
  ctx.fillStyle = '#c0533a';
  if (vertical) ctx.fillRect(0, 0, W, H); else ctx.fillRect(0, crossOff, W, cross);
  for (let i = 0; i < N; i++) {
    if (i % 2) continue;
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    if (vertical) ctx.fillRect(i * laneW, 0, laneW, H); else ctx.fillRect(0, crossOff + i * laneW, W, laneW);
  }
  // 距離標線
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1 * d; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `${10 * d}px sans-serif`;
  for (let m = 100; m < TRACK; m += 100) {
    const [x, y] = pt(m, 0); ctx.beginPath();
    if (vertical) { ctx.moveTo(0, y); ctx.lineTo(W, y); } else { ctx.moveTo(x, crossOff); ctx.lineTo(x, H); }
    ctx.stroke();
  }
  // 起跑 / 終點線
  const line = (pos, checker) => {
    const [x, y] = pt(pos, 0), sq = 6 * d;
    if (vertical) {
      for (let i = 0; i * sq < W; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = checker ? ((i + j) % 2 ? '#000' : '#fff') : '#fff'; ctx.fillRect(i * sq, y - j * sq, sq, sq); }
    } else {
      for (let i = 0; i * sq < cross; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = checker ? ((i + j) % 2 ? '#000' : '#fff') : '#fff'; ctx.fillRect(x + j * sq, crossOff + i * sq, sq, sq); }
    }
  };
  line(0, false); line(TRACK, true);
  // 跑者
  const size = Math.max(10 * d, Math.min(laneW * 1.5, 36 * d));
  const lead = leader();
  const order = [...runners].sort((a, b) => a.pos - b.pos);
  order.forEach(r => {
    let [x, y] = pt(r.pos, r.lane);
    // 交錯偏移避免重疊
    const off = (r.lane % 2 ? 1 : -1) * size * 0.12;
    if (vertical) y += off; else x += off;
    const ring = r.done ? '#7CFC00' : (r === lead ? '#ffd23f' : '#fff');
    drawRoundAvatar(ctx, r.p, x, y, size, ring);
    if (r.fx && raceRunning && !r.done) { ctx.font = `${size * 0.6}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(r.fx, x + size * 0.45, y - size * 0.35); }
    if (laneW > 28 * d || r === lead) {
      ctx.font = `bold ${Math.max(9 * d, Math.min(12 * d, laneW * 0.4))}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = '#000a'; const tw = ctx.measureText(r.p.name).width + 6 * d;
      const ly = vertical ? y + size * 0.5 + 8 * d : y - size * 0.5 - 4 * d;
      ctx.fillRect(x - tw / 2, ly - 10 * d, tw, 13 * d); ctx.fillStyle = '#fff'; ctx.fillText(r.p.name, x, ly);
    }
  });
  const done = state.finishOrder.length;
  $('raceInfo').textContent = `完賽 ${done} / ${N}　領先：${Math.min(TRACK, Math.round(lead.pos))}m / ${TRACK}m`;
}

/* ---------- 第一名第三人稱視角 ---------- */
function drawCam(time) {
  const c = camCv, ctx = c.getContext('2d'), W = c.width, H = c.height;
  const N = runners.length, LW = 1.6, half = N * LW / 2;
  const lead = camFocus || leader();
  const laneX = (l) => (l - (N - 1) / 2) * LW;
  const tz = lead.pos - 7, tx = laneX(lead.lane);
  camZ += (tz - camZ) * 0.15; camX += (tx - camX) * 0.08;
  if (!raceRunning && !state.finishOrder.length) { camZ = tz; camX = tx; }
  const horizon = H * 0.36, f = H * 1.1, camH = 2.2;
  const proj = (x, z) => { const dz = z - camZ; return [W / 2 + (x - camX) * f / dz, horizon + camH * f / dz, f / dz]; };
  // 天空 & 草地
  let g = ctx.createLinearGradient(0, 0, 0, horizon); g.addColorStop(0, '#4aa3ff'); g.addColorStop(1, '#bfe3ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon);
  ctx.fillStyle = '#3c9a46'; ctx.fillRect(0, horizon, W, H - horizon);
  // 觀眾席
  ctx.fillStyle = '#5a5f8a'; ctx.fillRect(0, horizon - H * 0.07, W, H * 0.07);
  for (let i = 0; i < 60; i++) { ctx.fillStyle = COLORS[i % COLORS.length]; const x = ((i * 53 + camZ * 2) % (W + 20)) - 10; ctx.beginPath(); ctx.arc(x, horizon - H * 0.035 + Math.sin(time * 6 + i) * 2, H * 0.012, 0, 7); ctx.fill(); }
  const near = 0.6, far = 260;
  // 跑道
  const poly = (x1, x2, z1, z2, col) => {
    const a = proj(x1, z1), b = proj(x2, z1), cc = proj(x2, z2), dd = proj(x1, z2);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(cc[0], cc[1]); ctx.lineTo(dd[0], dd[1]); ctx.fill();
  };
  poly(-half - 1, half + 1, camZ + near, camZ + far, '#c0533a');
  // 斑馬分段(速度感)
  const seg = 10;
  for (let z = Math.floor((camZ + near) / seg) * seg; z < camZ + far; z += seg) {
    if ((z / seg) % 2 === 0) poly(-half - 1, half + 1, Math.max(z, camZ + near), z + seg, 'rgba(0,0,0,.06)');
  }
  // 跑道分隔線
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5 * c.dpr;
  for (let i = 0; i <= N; i++) {
    const x = -half + i * LW, a = proj(x, camZ + near), b = proj(x, camZ + far);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  // 終點線 + 拱門
  if (TRACK - camZ > near && TRACK - camZ < far) {
    const cells = N * 2;
    for (let i = 0; i < cells; i++) for (let j = 0; j < 2; j++) {
      const x1 = -half + i * (LW / 2), z1 = TRACK + j * 0.8;
      poly(x1, x1 + LW / 2, z1, z1 + 0.8, (i + j) % 2 ? '#111' : '#fff');
    }
    const l = proj(-half - 1, TRACK), r = proj(half + 1, TRACK), top = l[2] * 6;
    ctx.fillStyle = '#ff2f6d'; ctx.fillRect(l[0] - l[2] * 0.4, l[1] - top, l[2] * 0.4, top); ctx.fillRect(r[0], r[1] - top, r[2] * 0.4, top);
    ctx.fillRect(l[0] - l[2] * 0.4, l[1] - top, r[0] - l[0] + r[2] * 0.8, l[2] * 1.2);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${l[2] * 0.9}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('FINISH', (l[0] + r[0]) / 2, l[1] - top + l[2] * 0.95);
  }
  // 跑者 (遠到近)
  const vis = runners.filter(r => r.pos - camZ > 1 && r.pos - camZ < far).sort((a, b) => b.pos - a.pos);
  vis.forEach(r => {
    const [x, y, s] = proj(laneX(r.lane), r.pos);
    const bob = raceRunning && !paused && !r.done ? Math.abs(Math.sin(r.bob)) * s * 0.25 : 0;
    const body = s * 1.1, head = s * 1.1;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.6, s * 0.15, 0, 0, 7); ctx.fill();
    ctx.fillStyle = COLORS[r.lane % COLORS.length];
    ctx.beginPath(); ctx.ellipse(x, y - body * 0.6 - bob, s * 0.38, body * 0.55, 0, 0, 7); ctx.fill();
    drawRoundAvatar(ctx, r.p, x, y - body * 1.25 - head * 0.4 - bob, head, r === lead ? '#ffd23f' : '#fff');
    if (s > 12 * c.dpr) {
      ctx.font = `bold ${Math.min(s * 0.35, 16 * c.dpr)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3 * c.dpr; const ty = y - body * 1.25 - head - bob;
      ctx.strokeText(r.p.name, x, ty); ctx.fillText(r.p.name, x, ty);
      if (r.fx && raceRunning && !r.done) ctx.fillText(r.fx, x + head * 0.6, ty + head * 0.3);
    }
  });
  // 速度線
  if (raceRunning && !paused) {
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2 * c.dpr;
    for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, r1 = W * 0.35, r2 = r1 + rand(20, 80) * c.dpr; ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r1, H * 0.55 + Math.sin(a) * r1 * 0.6); ctx.lineTo(W / 2 + Math.cos(a) * r2, H * 0.55 + Math.sin(a) * r2 * 0.6); ctx.stroke(); }
  }
  const lb = $('leaderBanner');
  const key = lead.p.id + (active().length ? 'L' : 'E');
  if (lb.dataset.k !== key) { lb.dataset.k = key; lb.innerHTML = `<img src="${lead.p.avatar}"><span>👑 領先：${escapeHtml(lead.p.name)}</span>`; }
}
function draw(time) {
  if (state.phase !== 'race') return;
  drawCam(time); drawTop(time);
}

/* ===================== 轉盤抽獎 ===================== */
let wheelNums = [], wheelRot = 0, wheelPlayer = null, spinning = false;
const wheelCv = $('wheelCanvas');

function remainingNumbers() {
  const used = new Set(Object.values(state.awards));
  return Array.from({ length: state.total }, (_, i) => i + 1).filter(n => !used.has(n));
}
// 合法號碼：不能是自己的，且抽完後剩下的人仍能完成「沒人抽到自己」的配對
function validNumbers(player) {
  const rem = remainingNumbers();
  const others = state.players.filter(p => p.id !== player.id && state.awards[p.id] === undefined);
  return rem.filter(x => {
    if (x === player.num) return false;
    const left = rem.filter(n => n !== x);
    // 每人只排除自己一個號碼；只有剩 1 人且剩下號碼正好是他自己時才會死鎖
    if (others.length === 1 && left.length === 1 && left[0] === others[0].num) return false;
    return true;
  });
}
function drawWheel() {
  const ctx = wheelCv.getContext('2d'), S = wheelCv.width, R = S / 2, n = wheelNums.length, seg = Math.PI * 2 / n;
  ctx.clearRect(0, 0, S, S);
  ctx.save(); ctx.translate(R, R); ctx.rotate(wheelRot);
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * seg;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a0 + seg); ctx.closePath();
    ctx.fillStyle = n === 1 ? COLORS[0] : COLORS[i % COLORS.length]; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.rotate(a0 + seg / 2); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0006'; ctx.lineWidth = 4;
    ctx.font = `bold ${Math.max(18, Math.min(60, 380 / n + 14))}px sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.strokeText(wheelNums[i], R - 16, 0); ctx.fillText(wheelNums[i], R - 16, 0); ctx.restore();
  }
  ctx.restore();
}
function openWheel(player) {
  camFocus = runners.find(r => r.p.id === player.id) || null;
  wheelPlayer = player; wheelNums = remainingNumbers(); wheelRot = 0; spinning = false;
  $('wheelAvatar').src = player.avatar; $('wheelName').textContent = player.name;
  $('wheelResult').textContent = '按下 SPIN 抽獎！';
  $('spinBtn').disabled = false; $('continueBtn').classList.add('hidden');
  drawWheel(); fanfare();
  $('wheelModal').classList.remove('hidden');
}
$('spinBtn').onclick = () => {
  if (spinning) return; spinning = true; $('spinBtn').disabled = true;
  const valid = validNumbers(wheelPlayer);
  const win = valid[Math.floor(Math.random() * valid.length)];
  const n = wheelNums.length, seg = Math.PI * 2 / n, idx = wheelNums.indexOf(win);
  // 目標：第 idx 格中心轉到正上方
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const target = -(idx + 0.5) * seg + jitter;
  const cur = ((wheelRot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let delta = ((target - cur) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const start = wheelRot, total = delta + Math.PI * 2 * 6, dur = 4200, t0 = performance.now();
  let lastSeg = -1;
  const anim = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
    wheelRot = start + total * e; drawWheel();
    const sIdx = Math.floor((((-wheelRot) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / seg);
    if (sIdx !== lastSeg) { lastSeg = sIdx; beep(1200, 0.03, 'square', 0.05); }
    if (k < 1) requestAnimationFrame(anim); else finishSpin(win);
  };
  requestAnimationFrame(anim);
};
function finishSpin(win) {
  state.awards[wheelPlayer.id] = win; save();
  $('wheelResult').textContent = `${wheelPlayer.name} ➔ 獲得 ${win} 號！`;
  fanfare(); confetti(60);
  $('continueBtn').classList.remove('hidden');
}
$('continueBtn').onclick = () => {
  $('wheelModal').classList.add('hidden');
  camFocus = null;
  nextFinisher();
};

/* ===================== 結果 ===================== */
function renderResults() {
  const rows = state.finishOrder.map((id, i) => {
    const p = state.players.find(x => x.id === id);
    return `<div class="result-row"><span class="rank">${i + 1}</span><img src="${p.avatar}"><span class="nm">${escapeHtml(p.name)}</span><span class="prize">➔ ${state.awards[id]} 號</span></div>`;
  });
  $('resultList').innerHTML = rows.join('');
  confetti(150); fanfare();
}
$('copyBtn').onclick = async () => {
  const txt = '🏆 抽獎結果\n' + state.finishOrder.map((id, i) => {
    const p = state.players.find(x => x.id === id); return `${i + 1}. ${p.name} ➔ ${state.awards[id]} 號`;
  }).join('\n');
  try { await navigator.clipboard.writeText(txt); alert('已複製！'); }
  catch (e) { prompt('請手動複製：', txt); }
};

function confetti(n) {
  const box = $('confetti');
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div'); d.className = 'cf';
    d.style.left = Math.random() * 100 + 'vw'; d.style.background = COLORS[i % COLORS.length];
    d.style.animationDuration = rand(2, 4) + 's'; d.style.animationDelay = rand(0, 0.8) + 's';
    box.appendChild(d); setTimeout(() => d.remove(), 5000);
  }
}

/* ===================== 啟動 ===================== */
state = load();
if (state.phase === 'race' && state.finishOrder.length >= state.total) state.phase = 'results';
show(state.phase);
