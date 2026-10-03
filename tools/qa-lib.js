// PERIHELION — QA shared helpers (owner: QA AGENT). Used by tools/qa-run.js and tools/qa-v2.js.
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), QA = path.join(ROOT, 'qa'), DIST = path.join(ROOT, 'dist');
fs.mkdirSync(QA, { recursive: true });

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const INSETS_P = { top: 47, bottom: 34, left: 0, right: 0 };
const INSETS_L = { top: 0, bottom: 21, left: 47, right: 47 };

const results = [], notes = [], metrics = {};
function check(sec, name, ok, detail) {
  results.push({ sec: String(sec), name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log((ok ? 'PASS ' : 'FAIL ') + '[' + sec + '] ' + name + (detail ? '  — ' + String(detail).slice(0, 300) : ''));
}
function note(s) { notes.push(s); console.log('NOTE ' + s); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// frame-script timing: wrap rAF so every callback's synchronous cost is recorded while __qaRec is on
const RAF_WRAP = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__qaFrames = []; window.__qaRec = false;
  window.requestAnimationFrame = function (cb) { return raf(function (t) {
    const s = performance.now(); cb(t); const e = performance.now();
    if (window.__qaRec) window.__qaFrames.push(t, e - s);
  }); };
})();`;

// seed a save into localStorage only if none exists yet (so reloads keep progress). `obj` is a JSON-able save.
function seedScript(obj) {
  return `(() => { try { if (!localStorage.getItem('perihelion.v1')) localStorage.setItem('perihelion.v1', ${JSON.stringify(JSON.stringify(obj))}); } catch (e) {} })();`;
}
const zeros = n => new Array(n).fill(0);
const SEEN_SAVE = { v: 2, stars: zeros(90), frags: zeros(90), unlocked: 1, endlessBest: 0, muted: false, seen: { intro: true, fragments: true, wormholes: true } };
const SEED_SEEN = seedScript(SEEN_SAVE);
// date stub: window.__dayOffset shifts "now" by whole days
const DATE_STUB = `(() => {
  const R = Date; window.__dayOffset = 0;
  class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + window.__dayOffset * 86400000); } static now() { return R.now() + window.__dayOffset * 86400000; } }
  window.Date = D;
})();`;
// half-full save with dates relative to the page's "today" (Observer's Log / Atlas screenshots)
const SEED_HALF = `(() => { try { if (localStorage.getItem('perihelion.v1')) return;
  const pad = n => (n < 10 ? '0' : '') + n, key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = new Date(), done = {};
  [[0, 3], [1, 2], [2, 3], [3, 1], [5, 2], [6, 3], [9, 1], [12, 2]].forEach(([ago, st]) => { done[key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 12))] = st; });
  const stars = [], frags = [];
  for (let i = 0; i < 90; i++) { stars.push(i < 44 ? [3, 2, 3, 1, 3, 2][i % 6] : 0); frags.push(i < 27 ? (i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0) : 0); }
  const ach = {}; ['first_light', 'thread_needle', 'cartographer_10', 'apprentice', 'daily_3', 'near_ten', 'persistence', 'event_horizon', 'comet_hunter', 'one_shot_ten', 'long_way_round'].forEach((id, i) => { ach[id] = '2026-09-' + pad(10 + i); });
  localStorage.setItem('perihelion.v1', JSON.stringify({ v: 2, stars, frags, unlocked: 45, endlessBest: 7, muted: true, seen: { intro: true, fragments: true, wormholes: true },
    daily: { last: key(now), lastStars: 3, lastLaunches: 1, streak: 4, best: 6, done },
    stats: { launches: 143, wins: 61, losses: 82, crashes: 40, lost: 42, distance: 184230, frags: 31, hints: 3, nearMiss: 17, threads: 5, platesNoHint: 22, dailyWins: 8, endlessRounds: 12 }, ach }));
} catch (e) {} })();`;

const allErrors = [], allRequests = [];
async function newPage(browser, { url, landscape = false, insets, init = [], label, ctxOpts = {}, track = true }) {
  const opts = { ...IPHONE, ...ctxOpts };
  if (landscape) opts.viewport = { width: 844, height: 390 };
  const ctx = await browser.newContext(opts);
  for (const s of [RAF_WRAP, ...init]) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const ins = insets === undefined ? (landscape ? INSETS_L : INSETS_P) : insets;
  if (ins) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: ins });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') {
    const t = m.text(); if (/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_PROXY|ERR_NAME|ERR_CONNECTION|net::ERR/i.test(t)) return;
    if (/Potential permissions policy violation: autoplay/.test(t)) { notes.push(label + ': Chromium permissions-policy notice "' + t + '" (AudioContext created inside a file:// iframe on first gesture — host iframe policy, not a game error)'); return; }
    if (m.type() === 'error') { errors.push(t); allErrors.push(label + ': ' + t); } else notes.push(label + ' console.warn: ' + t);
  } });
  page.on('pageerror', e => { errors.push('pageerror: ' + e.message); allErrors.push(label + ': pageerror: ' + e.message); });
  if (track) page.on('request', r => { const u = r.url(); if (!/^(file|data|blob|about):/.test(u)) allRequests.push(label + ' ' + u); });
  if (url) await page.goto(url);
  return { ctx, page, cdp, errors };
}

// ---------------------------------------------------------------- touch helpers (CDP)
async function cdpTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapEl(page, cdp, sel, frame) {
  const f = frame || page;
  const r = await f.evaluate(s => { const e = document.querySelector(s); if (!e) return null; if (e.closest('.scroll')) e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  if (!r) throw new Error('no element ' + sel);
  let ox = 0, oy = 0;
  if (frame) { const fe = await frame.frameElement(); const bb = await fe.boundingBox(); ox = bb.x; oy = bb.y; }
  await cdpTap(cdp, r.x + ox, r.y + oy);
  await sleep(60);
}
async function touchDrag(cdp, x0, y0, x1, y1, steps = 10, hold = 0) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, id: 1 }] });
    await sleep(16);
  }
  if (hold) await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// start a drag and keep the finger down; returns { move(x,y), end() }
async function touchHold(cdp, x0, y0, x1, y1, steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, id: 1 }] });
    await sleep(16);
  }
  return {
    move: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }),
    end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  };
}
const cardOn = (page, t = 15000) => page.waitForFunction(() => document.getElementById('card').classList.contains('on'), null, { timeout: t, polling: 50 });
const frames = (page, n) => page.evaluate(n => new Promise(r => { let k = 0; const f = () => { if (++k >= n) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
// Achievement toasts (Log) legitimately queue up while the suite plays through plates; hide the toast host for every
// screenshot except the ones named *toast*, so the visual review judges the screen itself.
const shot = async (page, name, opts) => {
  const keep = /toast/.test(name);
  try { await page.evaluate(k => { let st = document.getElementById('qa-notoast'); if (!st) { st = document.createElement('style'); st.id = 'qa-notoast'; document.head.appendChild(st); } st.textContent = k ? '' : '#logui-toasts{visibility:hidden!important}'; }, keep); } catch (e) {}
  return page.screenshot({ path: path.join(QA, name), ...(opts || {}) });
};
const text = (page, sel) => page.evaluate(s => document.querySelector(s).innerText.replace(/\s+/g, ' ').trim(), sel);
const rectOf = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
// the pull (screen px) that reproduces the level's stored solution at a given rotation (deg) and power factor
const solutionPull = (page, rotDeg = 0, pf = 1) => page.evaluate(({ rotDeg, pf }) => {
  const S = __peri.state, sol = S.level.solution, L = __peri.Render.layout, sp = Math.hypot(sol.vx, sol.vy), len = Math.max(41, sp / 640 * 300 * pf);
  const a = rotDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const ux = -(sol.vx * ca - sol.vy * sa) / sp, uy = -(sol.vx * sa + sol.vy * ca) / sp;
  return { dx: ux * len * L.scale, dy: uy * len * L.scale };
}, { rotDeg, pf });

// ---------------------------------------------------------------- layout audit (runs in page)
async function layoutAudit(page, tag) {
  return page.evaluate((tag) => {
    const P = window.__peri, L = P.Render.layout, S = L.safe || { top: 0, bottom: 0, left: 0, right: 0 };
    const W = innerWidth, H = innerHeight, issues = [], info = {};
    const R = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const vis = e => { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
      for (let p = e.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; } const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const ov = (a, b) => a.x < b.r - 0.5 && a.r > b.x + 0.5 && a.y < b.b - 0.5 && a.b > b.y + 0.5;
    const name = e => (e.id ? '#' + e.id : '') + (e.dataset && e.dataset.act ? '[' + e.dataset.act + ']' : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : '') + ' "' + (e.textContent || '').trim().slice(0, 24) + '"';
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollWidth > W + 1) issues.push('horizontal overflow: scrollWidth ' + se.scrollWidth + ' > ' + W);
    window.scrollTo(0, 300); if (window.scrollY !== 0 || window.scrollX !== 0) issues.push('page scrolls: scrollY=' + scrollY); window.scrollTo(0, 0);
    const btns = [...document.querySelectorAll('button')].filter(vis);
    info.buttons = btns.length;
    const scr = P.state.screen;
    for (const b of btns) {
      const r = R(b);
      const inScroll = !!b.closest('.scroll');
      if (r.w < 44 - 0.5 || r.h < 44 - 0.5) issues.push('tap target < 44px: ' + name(b) + ' ' + r.w.toFixed(1) + '×' + r.h.toFixed(1));
      if (!inScroll) {
        if (r.x < S.left - 0.5 || r.r > W - S.right + 0.5) issues.push('outside horizontal safe area: ' + name(b) + ' x ' + r.x.toFixed(1) + '..' + r.r.toFixed(1));
        if (r.y < S.top - 0.5 || r.b > H - S.bottom + 0.5) issues.push('outside vertical safe area: ' + name(b) + ' y ' + r.y.toFixed(1) + '..' + r.b.toFixed(1) + ' (safe ' + S.top + '..' + (H - S.bottom) + ')');
      }
    }
    const fixedBtns = btns.filter(b => !b.closest('.scroll'));
    for (let i = 0; i < fixedBtns.length; i++) for (let j = i + 1; j < fixedBtns.length; j++) {
      const a = fixedBtns[i], b = fixedBtns[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (ov(R(a), R(b))) issues.push('buttons overlap: ' + name(a) + ' / ' + name(b));
    }
    for (const e of [...document.querySelectorAll('#ui h1,#ui h2,#ui h3,#ui p,#ui .kicker')].filter(vis)) {
      const r = R(e); if (e.closest('.scroll')) continue;
      if (r.x < -0.5 || r.r > W + 0.5 || r.y < -0.5 || r.b > H + 0.5) issues.push('text outside viewport: ' + name(e) + ' ' + JSON.stringify([r.x, r.y, r.r, r.b].map(v => +v.toFixed(1))));
      else if (r.y < S.top - 0.5 || r.b > H - S.bottom + 0.5) issues.push('text in unsafe area: ' + name(e) + ' y ' + r.y.toFixed(1) + '..' + r.b.toFixed(1));
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') issues.push('text clipped: ' + name(e));
    }
    if (scr === 'play') {
      const pl = { x: L.plate.x, y: L.plate.y, w: L.plate.w, h: L.plate.h, r: L.plate.x + L.plate.w, b: L.plate.y + L.plate.h };
      info.plate = [pl.x, pl.y, pl.w, pl.h].map(v => +v.toFixed(1)); info.scale = +L.scale.toFixed(4); info.safe = S;
      const cap = P.Render.caption || {}, two = !!cap.two;
      const hudY = L.plate.y - 29, roY = L.plate.y + L.plate.h + 29, topTextY = two ? L.plate.y - 41 : hudY;
      info.hudY = +hudY.toFixed(1); info.readoutY = +roY.toFixed(1); info.captionRows = two ? 2 : 1;
      if (topTextY - 8 < S.top) issues.push('top HUD text (y=' + topTextY.toFixed(1) + ', ' + (two ? 'two-row' : 'one-row') + ') within 8px of safe top ' + S.top);
      if (roY + 7 > H - S.bottom) issues.push('bottom readout (y=' + roY.toFixed(1) + ') collides with home-indicator inset (' + (H - S.bottom) + ')');
      if (L.plate.y < S.top) issues.push('plate under the notch');
      if (pl.b > H - S.bottom) issues.push('plate under home indicator');
      const ro = { x: W * 0.25 + 6, r: W * 0.75 - 6, y: roY - 7, b: roY + 7 };
      const top = { x: 0, r: W, y: topTextY - 9, b: hudY + 9 };
      const hudBtns = fixedBtns.filter(b => b.classList.contains('hud-btn'));
      for (const b of fixedBtns.filter(b => !b.classList.contains('hud-btn') && b.closest('#card'))) {
        const r = R(b);
        if (ov(r, ro)) issues.push('card button over the bottom readout: ' + name(b));
        if (ov(r, top)) issues.push('card button over top HUD: ' + name(b));
      }
      for (const b of hudBtns) {
        const r = R(b);
        if (ov(r, pl)) issues.push('DOM button over the plate: ' + name(b));
        if (ov(r, ro)) issues.push('DOM button over the bottom readout: ' + name(b));
        if (ov(r, top)) issues.push('DOM button over top HUD: ' + name(b));
      }
      for (const id of ['hint', 'note']) { const e = document.getElementById(id); if (!vis(e)) continue; const r = R(e);
        for (const b of hudBtns) if (ov(r, R(b))) issues.push('#' + id + ' overlaps ' + name(b) + ' (#' + id + ' ' + [r.x, r.y, r.r, r.b].map(v => +v.toFixed(0)).join(',') + ')');
        if (r.x < pl.x - 0.5 || r.r > pl.r + 0.5) issues.push('#' + id + ' outside plate horizontally ' + r.x.toFixed(1) + '..' + r.r.toFixed(1)); }
      const card = document.getElementById('card');
      if (card.classList.contains('on')) {
        const r = R(card); info.card = [r.x, r.y, r.w, r.h].map(v => +v.toFixed(1));
        if (r.x < S.left || r.r > W - S.right || r.y < S.top || r.b > H - S.bottom) issues.push('card outside safe viewport ' + JSON.stringify(info.card));
        for (const b of hudBtns) if (ov(r, R(b))) issues.push('card overlaps ' + name(b));
        for (const b of card.querySelectorAll('button')) { const q = R(b); if (q.x < r.x - 0.5 || q.r > r.r + 0.5) issues.push('card button wider than card: ' + name(b) + ' ' + q.w.toFixed(0) + ' px in a ' + r.w.toFixed(0) + ' px card'); }
        const t = P.state.level.target, tp = P.Render.worldToScreen(t.x, t.y), tr = t.r * L.scale + 6;
        if (ov(r, { x: tp.x - tr, r: tp.x + tr, y: tp.y - tr, b: tp.y + tr })) issues.push('card covers the target');
      }
      const pc = document.getElementById('pcard');
      if (pc.classList.contains('on')) {
        const r = R(pc); info.pcard = [r.x, r.y, r.w, r.h].map(v => +v.toFixed(1));
        if (r.x < S.left || r.r > W - S.right || r.y < S.top || r.b > H - S.bottom) issues.push('popup card outside safe viewport ' + JSON.stringify(info.pcard));
        if (pc.scrollHeight > pc.clientHeight + 1) issues.push('popup card scrolls internally (' + pc.scrollHeight + ' > ' + pc.clientHeight + ')');
        for (const b of hudBtns) if (ov(r, R(b))) issues.push('popup card overlaps ' + name(b));
        if (ov(r, top)) issues.push('popup card over top HUD text');
        if (ov(r, ro)) issues.push('popup card over bottom readout');
        for (const b of pc.querySelectorAll('button')) { const q = R(b); if (q.x < r.x - 0.5 || q.r > r.r + 0.5) issues.push('popup button wider than card: ' + name(b)); }
        if (P.state.spotlight) {
          info.rings = 0;
          for (const f of P.state.spotlight) {
            const c = P.Render.worldToScreen(f.x, f.y), rr = (f.r || 2.2 * K.FRAG_R) * L.scale + 5; info.rings++;
            if (ov(r, { x: c.x - rr, r: c.x + rr, y: c.y - rr, b: c.y + rr })) issues.push('popup card overlaps the spotlight ring at (' + c.x.toFixed(0) + ',' + c.y.toFixed(0) + ')');
          }
        }
      }
      const c = document.createElement('canvas').getContext('2d');
      c.font = '400 10px ' + FONT.mono;
      const worst = ['v₀ 640 u/s  ·  power 100%', 'v 1850 u/s  ·  closest 1234 u'];
      info.readoutW = worst.map(s => +c.measureText(s).width.toFixed(1)); info.readoutMax = +(W * 0.5 - 12).toFixed(1);
      for (let i = 0; i < worst.length; i++) if (info.readoutW[i] > info.readoutMax) issues.push('readout "' + worst[i] + '" squeezed: ' + info.readoutW[i] + ' > ' + info.readoutMax);
    }
    return { tag, W, H, issues, info };
  }, tag);
}

// Playwright may expect a newer browser build than the one preinstalled under PLAYWRIGHT_BROWSERS_PATH: fall back to whatever is there.
function launchOpts(chromium) {
  try { if (fs.existsSync(chromium.executablePath())) return {}; } catch (e) {}
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH, cands = [];
  try {
    for (const d of fs.readdirSync(base).sort().reverse()) {
      if (/^chromium_headless_shell-/.test(d)) cands.push(path.join(base, d, 'chrome-linux', 'headless_shell'), path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
      else if (/^chromium-/.test(d)) cands.push(path.join(base, d, 'chrome-linux', 'chrome'), path.join(base, d, 'chrome-linux64', 'chrome'));
    }
  } catch (e) {}
  for (const c of cands) if (fs.existsSync(c)) return { executablePath: c };
  return {};
}
module.exports = { launchOpts, fs, path, ROOT, QA, DIST, IPHONE, INSETS_P, INSETS_L, results, notes, metrics, check, note, sleep, RAF_WRAP,
  seedScript, zeros, SEEN_SAVE, SEED_SEEN, DATE_STUB, SEED_HALF, allErrors, allRequests, newPage, cdpTap, tapEl, touchDrag, touchHold,
  cardOn, frames, shot, text, rectOf, solutionPull, layoutAudit };
