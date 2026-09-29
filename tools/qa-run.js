// PERIHELION — QA suite (owner: QA AGENT).   node tools/qa-run.js
// Builds dist/, then drives both variants in Chromium with iPhone 14 emulation (390×844 @3x, touch, notch
// safe-area insets via CDP Emulation.setSafeAreaInsetsOverride) through the §10 hooks and real CDP touch events.
// Outputs: qa/qa-*.png, qa/qa-report.md (auto section is regenerated; text after the MANUAL marker is preserved).
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), QA = path.join(ROOT, 'qa'), DIST = path.join(ROOT, 'dist');
fs.mkdirSync(QA, { recursive: true });

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const INSETS_P = { top: 47, bottom: 34, left: 0, right: 0 };
const INSETS_L = { top: 0, bottom: 21, left: 47, right: 47 };

const results = [], notes = [], metrics = {};
function check(sec, name, ok, detail) {
  results.push({ sec, name, ok: !!ok, detail: detail == null ? '' : String(detail) });
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

const allErrors = [], allRequests = [];
async function newPage(browser, { url, landscape = false, insets, init = [], label, ctxOpts = {} }) {
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
    if (/Potential permissions policy violation: autoplay/.test(t)) { notes.push(label + ': Chromium permissions-policy notice "' + t + '" (emitted when the game creates its AudioContext inside a file:// iframe on the first gesture — host iframe policy, not a game error)'); return; }
    if (m.type() === 'error') { errors.push(t); allErrors.push(label + ': ' + t); } else notes.push(label + ' console.warn: ' + t);
  } });
  page.on('pageerror', e => { errors.push('pageerror: ' + e.message); allErrors.push(label + ': pageerror: ' + e.message); });
  page.on('request', r => { const u = r.url(); if (!/^(file|data|blob|about):/.test(u)) allRequests.push(label + ' ' + u); });
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
  const r = await f.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
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
const cardOn = (page, t = 15000) => page.waitForFunction(() => document.getElementById('card').classList.contains('on'), null, { timeout: t, polling: 50 });

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
    // scroll/zoom
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollWidth > W + 1) issues.push('horizontal overflow: scrollWidth ' + se.scrollWidth + ' > ' + W);
    window.scrollTo(0, 300); if (window.scrollY !== 0 || window.scrollX !== 0) issues.push('page scrolls: scrollY=' + scrollY); window.scrollTo(0, 0);
    // visible interactive elements
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
    // pairwise overlap of visible buttons outside scrollers
    const fixedBtns = btns.filter(b => !b.closest('.scroll'));
    for (let i = 0; i < fixedBtns.length; i++) for (let j = i + 1; j < fixedBtns.length; j++) {
      const a = fixedBtns[i], b = fixedBtns[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (ov(R(a), R(b))) issues.push('buttons overlap: ' + name(a) + ' / ' + name(b));
    }
    // text elements clipped / outside viewport
    for (const e of [...document.querySelectorAll('#ui h1,#ui h2,#ui h3,#ui p,#ui .kicker')].filter(vis)) {
      const r = R(e); if (e.closest('.scroll')) continue;
      if (r.x < -0.5 || r.r > W + 0.5 || r.y < -0.5 || r.b > H + 0.5) issues.push('text outside viewport: ' + name(e) + ' ' + JSON.stringify([r.x, r.y, r.r, r.b].map(v => +v.toFixed(1))));
      else if (r.y < S.top - 0.5 || r.b > H - S.bottom + 0.5) issues.push('text in unsafe area: ' + name(e) + ' y ' + r.y.toFixed(1) + '..' + r.b.toFixed(1));
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') issues.push('text clipped: ' + name(e));
    }
    if (scr === 'play') {
      const pl = { x: L.plate.x, y: L.plate.y, w: L.plate.w, h: L.plate.h, r: L.plate.x + L.plate.w, b: L.plate.y + L.plate.h };
      info.plate = [pl.x, pl.y, pl.w, pl.h].map(v => +v.toFixed(1)); info.scale = +L.scale.toFixed(4); info.safe = S;
      const hudY = L.plate.y - 29, roY = L.plate.y + L.plate.h + 29;
      info.hudY = +hudY.toFixed(1); info.readoutY = +roY.toFixed(1);
      if (hudY - 8 < S.top) issues.push('top HUD text (y=' + hudY.toFixed(1) + ') within 8px of safe top ' + S.top);
      if (roY + 7 > H - S.bottom) issues.push('bottom readout (y=' + roY.toFixed(1) + ') collides with home-indicator inset (' + (H - S.bottom) + ')');
      if (L.plate.y < S.top) issues.push('plate under the notch');
      if (pl.b > H - S.bottom) issues.push('plate under home indicator');
      const ro = { x: W * 0.25 + 6, r: W * 0.75 - 6, y: roY - 7, b: roY + 7 };
      const top = { x: 0, r: W, y: hudY - 9, b: hudY + 9 };
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
        // target ring vs card
        const t = P.state.level.target, tp = P.Render.worldToScreen(t.x, t.y), tr = t.r * L.scale + 6;
        if (ov(r, { x: tp.x - tr, r: tp.x + tr, y: tp.y - tr, b: tp.y + tr })) issues.push('card covers the target');
      }
      // readout natural width (the renderer squeezes via maxWidth — squeezed text is a visual defect)
      const c = document.createElement('canvas').getContext('2d');
      c.font = '400 10px ' + FONT.mono;
      const worst = ['v₀ 640 u/s  ·  power 100%', 'v 1850 u/s  ·  closest 1234 u'];
      info.readoutW = worst.map(s => +c.measureText(s).width.toFixed(1)); info.readoutMax = +(W * 0.5 - 12).toFixed(1);
      for (let i = 0; i < worst.length; i++) if (info.readoutW[i] > info.readoutMax) issues.push('readout "' + worst[i] + '" squeezed: ' + info.readoutW[i] + ' > ' + info.readoutMax);
    }
    return { tag, W, H, issues, info };
  }, tag);
}

(async () => {
  // ================================================================= build + size (8)
  cp.execSync('node tools/build.js', { cwd: ROOT, stdio: 'inherit' });
  const sizes = {};
  for (const f of ['perihelion.html', 'perihelion.artifact.html']) sizes[f] = fs.statSync(path.join(DIST, f)).size;
  metrics.sizes = sizes;
  for (const f in sizes) check('8', 'size < 300 KB: ' + f, sizes[f] < 300 * 1024, (sizes[f] / 1024).toFixed(1) + ' KB');
  const html = fs.readFileSync(path.join(DIST, 'perihelion.html'), 'utf8');
  const extRefs = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:[^"']+)/g)].map(m => m[1]);
  check('8', 'only Google Fonts referenced in markup', extRefs.every(u => /fonts\.(googleapis|gstatic)\.com/.test(u)), extRefs.join(', '));
  check('8', 'no alert/confirm/prompt/window.open', !/\b(alert|confirm|prompt)\s*\(|window\.open\s*\(/.test(html.replace(/\/\/.*$/mg, '')));

  // ================================================================= node tests (2)
  let pt = '';
  try { pt = cp.execSync('node tools/physics-test.js', { cwd: ROOT }).toString(); check('2', 'node tools/physics-test.js ALL GREEN', /ALL GREEN/.test(pt), (pt.match(/bench.*$/m) || [''])[0]); }
  catch (e) { check('2', 'node tools/physics-test.js', false, String(e.stdout || e)); }
  try { const v = cp.execSync('node tools/levels-bake.js --verify', { cwd: ROOT }).toString(); check('3', 'levels-bake --verify', /all 30 baked plates OK/.test(v), v.trim().split('\n').pop()); }
  catch (e) { check('3', 'levels-bake --verify', false, String(e.stdout || e)); }

  // host-wrapped variant files
  const art = fs.readFileSync(path.join(DIST, 'perihelion.artifact.html'), 'utf8');
  const HOST_HEAD = '<!doctype html><head><meta charset="utf-8"><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)} body{margin:0;font:14px system-ui;background:#fafaf8} [hidden]{display:none!important}</style></head><body>';
  fs.writeFileSync(path.join(QA, 'qa-host.html'), HOST_HEAD + art + '</body>');
  fs.writeFileSync(path.join(QA, 'qa-host-iframe.html'), '<!doctype html><head><meta charset="utf-8"><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%;background:#fafaf8}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="qa-host.html" allow="autoplay"></iframe></body>');

  const STD = 'file://' + path.join(DIST, 'perihelion.html');
  const HOST = 'file://' + path.join(QA, 'qa-host.html');
  const HOSTF = 'file://' + path.join(QA, 'qa-host-iframe.html');
  const browser = await chromium.launch();
  metrics.chromium = browser.version();

  // ================================================================= MAIN standalone session
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'std' });
    await page.waitForTimeout(1500);
    check('6', 'hooks present', await page.evaluate(() => ['state', 'Physics', 'Levels', 'Render', 'loadLevel', 'loadEndless', 'launch', 'fastForward', 'solveCurrent', 'fps', 'screen'].every(k => k in window.__peri)));
    const safeRead = await page.evaluate(() => __peri.Render.layout.safe);
    check('7', 'safe-area insets reach Render.resize (top 47 / bottom 34)', safeRead.top === 47 && safeRead.bottom === 34, JSON.stringify(safeRead));

    // ---- (2) selfTest in browser
    const st = await page.evaluate(() => { const t0 = performance.now(); const r = __peri.Physics.selfTest(); return { ok: r.ok, ms: performance.now() - t0, bad: r.checks.filter(c => !c.ok) }; });
    check('2', 'Physics.selfTest().ok in browser', st.ok, st.ms.toFixed(1) + ' ms ' + JSON.stringify(st.bad));

    // ---- title
    check('6', 'boots to title', await page.evaluate(() => __peri.state.screen === 'title'));
    await page.screenshot({ path: path.join(QA, 'qa-title.png') });
    const aTitle = await layoutAudit(page, 'portrait title');
    check('7', 'layout: title (portrait)', !aTitle.issues.length, aTitle.issues.join(' | '));

    // ---- real touch: Begin → select
    await tapEl(page, cdp, '[data-act="begin"]');
    await page.waitForTimeout(700);
    check('6', 'touch tap "Begin the Atlas" → select', await page.evaluate(() => __peri.state.screen === 'select'));
    await page.screenshot({ path: path.join(QA, 'qa-select.png') });
    const aSel = await layoutAudit(page, 'portrait select');
    check('7', 'layout: select (portrait)', !aSel.issues.length, aSel.issues.join(' | '));
    // select scroll works via touch drag inside .scroll, page itself never scrolls
    await touchDrag(cdp, 195, 700, 195, 300, 8);
    await page.waitForTimeout(300);
    const scr = await page.evaluate(() => ({ s: document.getElementById('s-scroll').scrollTop, win: scrollY, vv: visualViewport.scale }));
    check('7', 'atlas grid scrolls by touch; page does not', scr.s > 50 && scr.win === 0 && scr.vv === 1, JSON.stringify(scr));
    await page.evaluate(() => { document.getElementById('s-scroll').scrollTop = 0; });
    await page.waitForTimeout(150);
    // locked plate ignored
    await tapEl(page, cdp, '.plate[data-i="1"]');
    check('6', 'tap on sealed plate II ignored', await page.evaluate(() => __peri.state.screen === 'select'));

    // ---- plate I via touch
    await tapEl(page, cdp, '.plate[data-i="0"]');
    await page.waitForTimeout(700);
    check('6', 'touch tap plate I → play', await page.evaluate(() => __peri.state.screen === 'play' && __peri.state.levelIndex === 0 && __peri.state.phase === 'aim'));

    // ---- (9) level01 mid-aim screenshot (hint visible on first run) — aim toward the solution
    async function aimShot(i, file) {
      const info = await page.evaluate((i) => {
        const P = __peri, S = P.state;
        if (S.levelIndex !== i || S.screen !== 'play' || S.mode !== 'campaign') P.loadLevel(i);
        const lv = S.level, sol = lv.solution, sp = Math.hypot(sol.vx, sol.vy), pw = sp / 640, L = Math.max(40.5, pw * 300);
        // a plausible pull: solution direction rotated 2.5° with power a touch below, so the dots show a near-miss study
        const rot = 0.044, ca = Math.cos(rot), sa = Math.sin(rot);
        const ux = -(sol.vx * ca - sol.vy * sa) / sp, uy = -(sol.vx * sa + sol.vy * ca) / sp;
        const v = P.Physics.launchVelocity(ux * L * 0.97, uy * L * 0.97);
        S.step = sol.t0Step | 0;
        Object.assign(S.aim, { active: true, dx: ux * L * 0.97, dy: uy * L * 0.97, power: v.power, vx: v.vx, vy: v.vy, cancel: v.cancel });
        P.fastForward(0);
        return { n: S.predict.n, power: +v.power.toFixed(2), t0: sol.t0Step | 0, name: lv.name };
      }, i);
      await page.waitForTimeout(450);
      const n = await page.evaluate(() => __peri.state.predict.n);
      await page.screenshot({ path: path.join(QA, file) });
      check('9', 'screenshot ' + file + ' mid-aim with prediction', n > 20, JSON.stringify(info));
    }
    await aimShot(0, 'qa-level01.png');
    const aPlay = await layoutAudit(page, 'portrait play (aim, hint)');
    metrics.playLayout = aPlay.info;
    check('7', 'layout: play screen (portrait, aiming, hint on)', !aPlay.issues.length, aPlay.issues.join(' | '));
    await page.evaluate(() => { const a = __peri.state.aim; a.active = false; a.cancel = true; __peri.state.predict.n = 0; });

    // ---- (6) real-touch drag-launch on plate I, pull computed from the level's solution
    const pull = await page.evaluate(() => {
      const S = __peri.state, sol = S.level.solution, L = __peri.Render.layout;
      const sp = Math.hypot(sol.vx, sol.vy), len = sp / 640 * 300;
      return { dx: -sol.vx / sp * len * L.scale, dy: -sol.vy / sp * len * L.scale, moving: S.level.bodies.some(b => b.orbit) };
    });
    const x0 = 195, y0 = 380;
    await touchDrag(cdp, x0, y0, x0 + pull.dx, y0 + pull.dy, 12, 250);
    await page.waitForTimeout(40);
    const fl = await page.evaluate(() => ({ phase: __peri.state.phase, l: __peri.state.launches }));
    check('6', 'touch drag-release launches (plate I)', fl.l === 1 && fl.phase !== 'aim', JSON.stringify(fl) + ' pull ' + JSON.stringify(pull));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(QA, 'qa-flight.png') });
    let ok1 = true; try { await cardOn(page, 15000); } catch (e) { ok1 = false; }
    const res1 = await page.evaluate(() => ({ r: __peri.state.result && { s: __peri.state.result.success, st: __peri.state.result.stars }, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
    check('6', 'touch-launched flight → success result card', ok1 && res1.r && res1.r.s && /Sealed/.test(res1.card), JSON.stringify(res1));
    await page.waitForTimeout(1400);        // seal (700+460 ms) + ripple + card transition (340 ms)
    await page.screenshot({ path: path.join(QA, 'qa-success.png') });
    const aCard = await layoutAudit(page, 'portrait success card');
    metrics.cardLayout = aCard.info;
    check('7', 'layout: success card (portrait)', !aCard.issues.length, aCard.issues.join(' | '));
    // Next plate via touch
    await tapEl(page, cdp, '#card [data-act="next"]');
    await page.waitForTimeout(400);
    check('6', 'touch "Next plate" → plate II', await page.evaluate(() => __peri.state.levelIndex === 1 && __peri.state.phase === 'aim' && !document.getElementById('card').classList.contains('on')));

    // ---- (6) fail flow with real touch: 3 pulls UP (launch straight down → lost)
    await page.evaluate(() => __peri.loadLevel(0));
    await page.waitForTimeout(300);
    for (let k = 0; k < 3; k++) {
      await page.waitForFunction(() => __peri.state.phase === 'aim', null, { timeout: 8000, polling: 50 }).catch(() => {});
      await page.waitForTimeout(80);
      await touchDrag(cdp, 195, 500, 195, 380, 8);
      await page.waitForTimeout(50);
      if (k === 0) { await page.waitForFunction(() => __peri.state.ghosts.length === 1, null, { timeout: 8000, polling: 50 }).catch(() => {}); await page.waitForTimeout(150);
        const nt = await page.evaluate(() => ({ on: document.getElementById('note').classList.contains('on'), t: document.getElementById('note').textContent }));
        check('6', 'miss → marginal note', nt.on && /remain/.test(nt.t), JSON.stringify(nt));
        await page.screenshot({ path: path.join(QA, 'qa-miss.png') }); }
    }
    let ok2 = true; try { await cardOn(page, 15000); } catch (e) { ok2 = false; }
    const f1 = await page.evaluate(() => ({ ph: __peri.state.phase, l: __peri.state.launches, g: __peri.state.ghosts.length, s: __peri.state.result && __peri.state.result.success, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
    check('6', '3 real-touch misses → fail card', ok2 && f1.ph === 'result' && f1.l === 3 && f1.s === false && /Unsealed/.test(f1.card), JSON.stringify(f1));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(QA, 'qa-fail.png') });
    const aFail = await layoutAudit(page, 'portrait fail card');
    check('7', 'layout: fail card (portrait)', !aFail.issues.length, aFail.issues.join(' | '));
    await tapEl(page, cdp, '#card [data-act="retry"]');
    await page.waitForTimeout(200);
    check('6', 'touch "Retry plate" resets attempt', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.phase === 'aim' && __peri.state.ghosts.length === 0));

    // ---- Reset button (after one launch)
    await touchDrag(cdp, 195, 500, 195, 380, 6);
    await page.waitForTimeout(100);
    await tapEl(page, cdp, '#zone-l .btn');
    await page.waitForTimeout(150);
    check('6', 'touch Reset button restarts attempt', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.phase === 'aim' && __peri.state.step < 60));
    // touch on the Reset button must NOT start aiming
    check('6', 'tap on HUD button does not start an aim', await page.evaluate(() => !__peri.state.aim.active));

    // ---- Atlas button → pause sheet, time frozen, then Return to the Atlas
    await tapEl(page, cdp, '#zone-r .btn');
    await page.waitForTimeout(400);
    const s0 = await page.evaluate(() => __peri.state.step);
    await page.waitForTimeout(400);
    check('6', 'touch Atlas button → pause sheet, clock frozen', await page.evaluate(s => __peri.state.paused && __peri.state.step === s && document.getElementById('sheet').classList.contains('on'), s0));
    await page.screenshot({ path: path.join(QA, 'qa-pause.png') });
    const aPause = await layoutAudit(page, 'portrait pause sheet');
    check('7', 'layout: pause sheet (portrait)', !aPause.issues.length, aPause.issues.join(' | '));
    await tapEl(page, cdp, '#sheet [data-act="resume"]');
    await page.waitForTimeout(200);
    check('6', 'touch Resume', await page.evaluate(() => !__peri.state.paused && !document.getElementById('sheet').classList.contains('on')));
    await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(350);
    await tapEl(page, cdp, '#sheet [data-act="atlas"]'); await page.waitForTimeout(400);
    check('6', 'pause sheet "Return to the Atlas" → select', await page.evaluate(() => __peri.state.screen === 'select' && !__peri.state.paused));
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(200);

    // ---- visibilitychange: real (another tab brought to front), fallback to synthetic
    await page.evaluate(() => __peri.launch(0, -200));
    const other = await ctx.newPage();
    await other.bringToFront(); await sleep(400);
    let vis = await page.evaluate(() => ({ hidden: document.hidden, paused: __peri.state.paused }));
    let visMode = 'real (bringToFront other tab)';
    if (!vis.hidden) {
      visMode = 'synthetic (document.hidden override)';
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      vis = await page.evaluate(() => ({ hidden: document.hidden, paused: __peri.state.paused }));
    }
    const stepH = await page.evaluate(() => __peri.state.step); await sleep(300);
    const stepH2 = await page.evaluate(() => __peri.state.step);
    check('6', 'visibilitychange → paused, clock frozen [' + visMode + ']', vis.paused && stepH === stepH2, JSON.stringify(vis));
    await page.bringToFront(); await other.close();
    await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(200);
    await cdpTap(cdp, 195, 90);            // veil tap resumes
    await sleep(200);
    check('6', 'tap on veil resumes after visibility pause', await page.evaluate(() => !__peri.state.paused));

    // ---- (3) all 30 campaign levels via hooks
    const camp = await page.evaluate(() => {
      const P = __peri, out = [];
      for (let i = 0; i < P.Levels.CAMPAIGN.length; i++) {
        P.loadLevel(i);
        const t0 = performance.now();
        const sol = P.solveCurrent();
        P.fastForward(1300);
        const r = P.state.result;
        out.push({ i, name: P.state.level.name, sol: !!sol, t0: sol && sol.t0Step, moving: P.state.level.bodies.some(b => b.orbit), kinds: [...new Set(P.state.level.bodies.map(b => b.kind))].join('+'), frags: (P.state.level.frags || []).length,
          ok: !!(r && r.success && r.stars === 3), status: r && r.status, stars: r && r.stars, card: document.getElementById('card').classList.contains('on'), ms: +(performance.now() - t0).toFixed(1) });
      }
      return out;
    });
    metrics.campaign = camp;
    check('3', 'campaign: ' + camp.length + ' levels present', camp.length === 30);
    for (const c of camp) check('3', 'plate ' + (c.i + 1) + ' "' + c.name + '" solveCurrent+fastForward → success ★3', c.ok && c.card, c.status + ' stars ' + c.stars + ' t0 ' + c.t0 + ' ' + c.kinds + (c.moving ? ' (moving)' : '') + ' frags ' + c.frags);

    // ---- (3) prediction === live flight, incl. moving bodies launched at a nonzero step
    const movingIdx = camp.filter(c => c.moving).map(c => c.i);
    const pick = [0, ...movingIdx.slice(0, 2), ...movingIdx.slice(-2), 29].filter((v, i, a) => a.indexOf(v) === i);
    const pv = await page.evaluate((pick) => {
      const P = __peri, S = P.state, out = [];
      for (const i of pick) {
        for (const S0 of [0, 173, 611]) {
          P.loadLevel(i);
          const sol = S.level.solution; let vx = sol.vx * 0.93, vy = sol.vy * 0.93;
          const rot = 0.05, ca = Math.cos(rot), sa = Math.sin(rot); [vx, vy] = [vx * ca - vy * sa, vx * sa + vy * ca];
          P.fastForward(S0);                      // advance the level clock while aiming idle
          const dx = -vx / 640 * 300, dy = -vy / 640 * 300, lvv = P.Physics.launchVelocity(dx, dy);
          Object.assign(S.aim, { active: true, cancel: false, dx, dy, power: lvv.power, vx: lvv.vx, vy: lvv.vy });
          P.fastForward(0);                        // → updatePrediction at state.step
          const stepAt = S.step, pn = S.predict.n, pred = S.predict.pts.slice(0, pn * 2);
          // launch in the same synchronous turn, then step live and record
          S.aim.active = false;
          P.launch(lvv.vx, lvv.vy);
          const t0 = S.sim.t0Step, live = [];
          for (let k = 0; k < pn && S.sim && S.sim.status === 'flying'; k++) { P.fastForward(1); live.push(S.sim.x, S.sim.y); }
          let mism = -1; const m = Math.min(pred.length, live.length);
          for (let k = 0; k < m; k++) if (pred[k] !== Math.fround(live[k])) { mism = k >> 1; break; }
          out.push({ i, S0, stepAt, t0, pn, ln: live.length / 2, mism, status: S.sim && S.sim.status });
        }
      }
      return out;
    }, pick);
    metrics.predict = pv;
    for (const r of pv) check('3', 'predict === live: plate ' + (r.i + 1) + ' launch@step ' + r.stepAt, r.mism === -1 && r.t0 === r.stepAt && (r.ln === r.pn || r.status !== 'flying'), JSON.stringify(r));

    // ---- (9) level 15 / level 30 mid-aim
    await page.evaluate(() => __peri.loadLevel(14)); await page.waitForTimeout(300);
    await aimShot(14, 'qa-level15.png');
    await page.evaluate(() => __peri.loadLevel(29)); await page.waitForTimeout(300);
    await aimShot(29, 'qa-level30.png');
    const a30 = await layoutAudit(page, 'portrait play plate XXX');
    check('7', 'layout: plate XXX (portrait, aiming)', !a30.issues.length, a30.issues.join(' | '));
    await page.evaluate(() => { const a = __peri.state.aim; a.active = false; a.cancel = true; });

    // caption fit for all 30 plates (replicates Render's shrink loop; flags < 10 px or overflow at 8.5 px)
    const caps = await page.evaluate(() => {
      const L = __peri.Render.layout, c = document.createElement('canvas').getContext('2d'), out = [];
      c.font = '600 10px ' + FONT.sc; const lw = (() => { let w = 0; const s = 'LAUNCH  3 / 3'; w = c.measureText(s).width + 1.4 * (s.length - 1); return w + 4; })();
      const maxW = 2 * (L.w / 2 - (L.plate.x + lw + 14)), starsL = L.plate.x + L.plate.w - 6 - 2 * 14 - 6;
      for (const lv of __peri.Levels.CAMPAIGN) {
        const cap = 'PLATE ' + lv.plate + '  ·  ' + String(lv.name).toUpperCase();
        let size = 12.5, w = 0;
        for (; size > 8.5; size -= 0.5) { c.font = '600 ' + size + 'px ' + FONT.sc; w = c.measureText(cap).width + size * 0.12 * (cap.length - 1); if (w <= maxW) break; }
        c.font = '600 ' + size + 'px ' + FONT.sc; w = c.measureText(cap).width + size * 0.12 * (cap.length - 1);
        out.push({ cap, size, w: +w.toFixed(1), maxW: +maxW.toFixed(1), hitsStars: L.w / 2 + w / 2 > starsL });
      }
      return out;
    });
    metrics.captions = caps;
    const badCaps = caps.filter(c => c.w > c.maxW || c.hitsStars);
    const smallCaps = caps.filter(c => c.size < 10);
    check('7', 'plate captions fit between LAUNCH label and stars (fallback fonts)', !badCaps.length, badCaps.map(c => c.cap + ' ' + c.size + 'px').join('; '));
    if (smallCaps.length) note('captions shrunk below 10 px: ' + smallCaps.map(c => c.cap + ' @' + c.size + 'px').join('; '));

    for (const i of [28, 1]) {
      await page.evaluate(i => __peri.loadLevel(i), i); await page.waitForTimeout(250);
      const L = await page.evaluate(() => __peri.Render.layout);
      await page.screenshot({ path: path.join(QA, 'qa-caption-' + (i + 1) + '.png'), clip: { x: 0, y: L.plate.y - 50, width: L.w, height: 50 } });
    }
    // ---- (9) crash screenshot: aim straight at the first fixed planet of a mid-campaign plate
    const cr = await page.evaluate(() => {
      const P = __peri;
      for (const i of [4, 5, 7, 8, 2, 3, 9, 10]) {
        const lv = P.Levels.CAMPAIGN[i];
        for (const b of lv.bodies) {
          if (b.orbit || b.kind !== 'planet') continue;
          const dx = b.x - lv.probe.x, dy = b.y - lv.probe.y, d = Math.hypot(dx, dy);
          for (const sp of [520, 440, 600, 380]) {
            const vx = dx / d * sp, vy = dy / d * sp, s = P.Physics.simulate(lv, vx, vy, 0, 1200);
            if (s.status === 'crash' && s.n > 60) return { i, vx, vy, n: s.n };
          }
        }
      }
      return null;
    });
    if (cr) {
      await page.evaluate(c => { __peri.loadLevel(c.i); __peri.launch(c.vx, c.vy); }, cr);
      await page.waitForFunction(() => __peri.state.ghosts.length >= 1, null, { timeout: 10000, polling: 'raf' }).catch(() => {});
      await page.waitForTimeout(70);
      await page.screenshot({ path: path.join(QA, 'qa-crash.png') });
      check('9', 'screenshot qa-crash.png (crash burst)', true, 'plate ' + (cr.i + 1) + ' after ' + cr.n + ' steps');
    } else check('9', 'screenshot qa-crash.png', false, 'no crash trajectory found');

    // ---- (4) Endless: 10 rounds with their own solutions, advancing with the card's Next button
    const en = await page.evaluate(() => {
      const P = __peri, S = P.state, out = [];
      P.loadEndless(20260929);
      for (let r = 0; r < 10; r++) {
        const lv = S.level, sol = P.solveCurrent();
        P.fastForward(1300);
        const res = S.result;
        out.push({ round: S.endless.round, seed: lv.seed, diff: +lv.difficulty.toFixed(2), bodies: lv.bodies.map(b => b.kind[0]).join(''), hasSol: !!lv.solution, ok: !!(res && res.success && res.stars === 3), score: S.endless.score, caption: lv.caption });
        const nx = document.querySelector('#card [data-act="next"]'); if (!nx) break; nx.click();
      }
      return out;
    });
    metrics.endless = en;
    check('4', 'endless: 10 rounds played', en.length === 10, en.length + ' rounds');
    for (const r of en) check('4', 'endless round ' + r.round + ' (d=' + r.diff + ') solvable with level.solution', r.ok && r.hasSol, JSON.stringify(r));
    const enSeeds = await page.evaluate(() => {
      const P = __peri, out = [];
      for (let k = 0; k < 10; k++) {
        const seed = (k * 2654435761 + 99) >>> 0; P.loadEndless(seed);
        const sol = P.solveCurrent(); P.fastForward(1300);
        out.push({ seed, ok: !!(P.state.result && P.state.result.success) });
      }
      return out;
    });
    check('4', 'endless: loadEndless(seed) × 10 distinct seeds solvable', enSeeds.every(r => r.ok), enSeeds.filter(r => !r.ok).map(r => r.seed).join(','));
    // generate() timing, unthrottled and 4× throttled; also verify solvability at high difficulty
    const genBench = async () => page.evaluate(() => {
      const P = __peri, ts = [], bad = [];
      for (let k = 0; k < 20; k++) {
        const seed = (k * 747796405 + 12345) >>> 0, d = k / 19;
        const t0 = performance.now(); const lv = P.Levels.generate(seed, d); const ms = performance.now() - t0; ts.push(ms);
        const s = lv.solution; if (!s || P.Physics.simulate(lv, s.vx, s.vy, s.t0Step | 0, 1200).status !== 'hit') bad.push(seed + '@' + d.toFixed(2));
      }
      const slow = ts.map((ms, k) => ({ ms: +ms.toFixed(0), d: +(k / 19).toFixed(2) })).filter(o => o.ms > 60);
      ts.sort((a, b) => a - b);
      return { slow, avg: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1), p50: +ts[10].toFixed(1), p95: +ts[18].toFixed(1), max: +ts[19].toFixed(1), bad };
    });
    const g1 = await genBench();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const g4 = await genBench();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    metrics.generate = { x1: g1, x4: g4 };
    check('4', 'Levels.generate: every generated level carries a hitting solution (d 0..1)', !g1.bad.length, g1.bad.join(','));
    check('4', 'Levels.generate ≤ 150 ms at 4× CPU throttle (p95)', g4.p95 <= 150, '1×: ' + JSON.stringify(g1) + ' | 4×: ' + JSON.stringify(g4));

    // ---- (6) mute persists (touch toggle on title, reload)
    await page.evaluate(() => __peri.screen('title')); await page.waitForTimeout(400);
    const m0 = await page.evaluate(() => __peri.Sound.isMuted());
    await tapEl(page, cdp, '#scr-title [data-act="sound"]');
    const m1 = await page.evaluate(() => ({ lbl: document.querySelector('#scr-title [data-sound]').textContent, muted: __peri.Sound.isMuted() }));
    await page.reload(); await page.waitForTimeout(900);
    const m2 = await page.evaluate(() => ({ lbl: document.querySelector('#scr-title [data-sound]').textContent, muted: __peri.Sound.isMuted(), saved: __peri.Save.data.muted, unlocked: __peri.Save.data.unlocked }));
    check('6', 'mute toggle persists across reload', m0 === false && m1.muted && m2.muted && m2.saved === true && /Off/.test(m2.lbl), JSON.stringify({ m1, m2 }));
    check('6', 'progress persists across reload', m2.unlocked >= 30, 'unlocked ' + m2.unlocked);
    await tapEl(page, cdp, '#scr-title [data-act="sound"]');

    // ---- (7) pinch-zoom attempt on play screen & title
    await page.evaluate(() => __peri.loadLevel(3)); await page.waitForTimeout(200);
    try { await cdp.send('Input.synthesizePinchGesture', { x: 195, y: 420, scaleFactor: 2.2, gestureSourceType: 'touch' }); } catch (e) { note('pinch synth failed: ' + e.message); }
    await page.waitForTimeout(300);
    const z = await page.evaluate(() => ({ vv: visualViewport.scale, sy: scrollY, aim: __peri.state.aim.active, l: __peri.state.launches }));
    check('7', 'pinch gesture does not zoom (standalone)', z.vv === 1 && z.sy === 0, JSON.stringify(z));
    await page.evaluate(() => { if (visualViewport.scale !== 1) document.querySelector('meta[name=viewport]').setAttribute('content', document.querySelector('meta[name=viewport]').content); });

    // ---- (1)
    check('1', 'no console errors / page errors (standalone portrait session)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ================================================================= (5) frame rate on a busy late plate, 4× CPU throttle
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'std-perf' });
    await page.waitForTimeout(1200);
    const busy = await page.evaluate(() => {
      const P = __peri, C = P.Levels.CAMPAIGN;
      const score = i => C[i].bodies.length * 2 + C[i].bodies.filter(b => b.orbit).length * 2 + (C[i].frags || []).length + C[i].bodies.filter(b => b.kind === 'blackhole' || b.kind === 'repulsor').length * 2;
      const i = [26, 27, 28, 29].sort((a, b) => score(b) - score(a))[0];
      const lv = C[i];
      // longest flight we can find (timeout = 10 s in the air)
      let best = null;
      for (let a = 0; a < 360; a += 3) for (const p of [0.45, 0.6, 0.75, 0.9]) {
        const ang = a * Math.PI / 180, vx = Math.cos(ang) * 640 * p, vy = Math.sin(ang) * 640 * p;
        const s = P.Physics.simulate(lv, vx, vy, 0, 1200);
        if (!best || s.n > best.n) best = { vx, vy, n: s.n, status: s.status };
      }
      return { i, name: lv.name, bodies: lv.bodies.map(b => b.kind + (b.orbit ? '*' : '')).join(','), frags: (lv.frags || []).length, best };
    });
    metrics.perfLevel = busy;
    await page.evaluate(b => __peri.loadLevel(b.i), busy);
    await page.waitForTimeout(400);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const stats = async (secs, mode) => {
      await page.evaluate(({ b, mode }) => {
        const P = __peri, S = P.state;
        window.__qaFrames.length = 0;
        const keep = () => {
          if (mode === 'flight') {
            if (!(S.phase === 'flight' && S.sim && S.sim.status === 'flying')) { P.launch(b.best.vx, b.best.vy); window.__qaRelaunch = (window.__qaRelaunch || 0) + 1; }
          } else {
            const sol = S.level.solution, t = performance.now() / 700;
            const vx = sol.vx * (0.9 + 0.1 * Math.sin(t)), vy = sol.vy * (0.9 + 0.1 * Math.cos(t));
            const dx = -vx / 640 * 300, dy = -vy / 640 * 300, v = P.Physics.launchVelocity(dx, dy);
            Object.assign(S.aim, { active: true, cancel: false, dx, dy, power: v.power, vx: v.vx, vy: v.vy });
          }
        };
        keep(); window.__qaKeep = setInterval(keep, 30);
        window.__qaRec = true;
      }, { b: busy, mode });
      await sleep(secs * 1000);
      return page.evaluate(() => {
        window.__qaRec = false; clearInterval(window.__qaKeep);
        const F = window.__qaFrames, sc = [], iv = [];
        for (let k = 0; k < F.length; k += 2) { sc.push(F[k + 1]); if (k) iv.push(F[k] - F[k - 2]); }
        const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
        const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
        const a = __peri.state.aim; a.active = false; a.cancel = true;
        return { frames: sc.length, scriptAvg: +avg(sc).toFixed(2), scriptP95: +q(sc, 0.95).toFixed(2), scriptMax: +Math.max(...sc).toFixed(2),
          intervalAvg: +avg(iv).toFixed(2), intervalP95: +q(iv, 0.95).toFixed(2), fpsFromIntervals: +(1000 / avg(iv)).toFixed(1), periFps: +__peri.fps().toFixed(1),
          over16: sc.filter(x => x > 16.7).length, relaunches: window.__qaRelaunch || 0 };
      });
    };
    const fFlight = await stats(5, 'flight');
    const fAim = await stats(3, 'aim');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const fFlight1 = await stats(3, 'flight');
    // raster-inclusive: Render.frame + 1-px readback (forces the canvas to flush) per frame, 4× throttle
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const flush = await page.evaluate((b) => {
      const P = __peri, S = P.state, g = document.getElementById('game').getContext('2d'), ts = [];
      const run = (mode) => { const out = [];
        for (let k = 0; k < 150; k++) {
          if (mode === 'flight' && !(S.phase === 'flight' && S.sim && S.sim.status === 'flying')) P.launch(b.best.vx, b.best.vy);
          if (mode === 'aim') { const sol = S.level.solution, dx = -sol.vx / 640 * 300, dy = -sol.vy / 640 * 300, v = P.Physics.launchVelocity(dx, dy); Object.assign(S.aim, { active: true, cancel: false, dx, dy, power: v.power, vx: v.vx, vy: v.vy }); }
          const t0 = performance.now(); P.fastForward(2); P.Render.frame(S, t0); g.getImageData(0, 0, 1, 1); out.push(performance.now() - t0);
        }
        out.sort((x, y) => x - y); return { avg: +(out.reduce((x, y) => x + y, 0) / out.length).toFixed(2), p95: +out[Math.floor(out.length * 0.95)].toFixed(2), max: +out[out.length - 1].toFixed(2) }; };
      P.loadLevel(b.i); const fl = run('flight'); P.loadLevel(b.i); const am = run('aim'); S.aim.active = false; S.aim.cancel = true;
      return { flight: fl, aim: am };
    }, busy);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    check('5', 'raster-inclusive frame cost @4× (frame + canvas flush): p95 < 12 ms', flush.flight.p95 < 12 && flush.aim.p95 < 12, JSON.stringify(flush));
    metrics.fps = { level: busy, flight4x: fFlight, aim4x: fAim, flight1x: fFlight1, flush4x: flush };
    check('5', 'frame script time mid-flight @4× (plate ' + (busy.i + 1) + '): p95 < 8 ms', fFlight.scriptP95 < 8, JSON.stringify(fFlight));
    check('5', 'frame script time while aiming (420-step prediction/frame) @4×: p95 < 10 ms', fAim.scriptP95 < 10, JSON.stringify(fAim));
    check('5', '__peri.fps() ≥ 55 during flight @4×', fFlight.periFps >= 55, 'fps() ' + fFlight.periFps + ', rAF-interval fps ' + fFlight.fpsFromIntervals);
    check('1', 'no console errors (perf session)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ================================================================= localStorage throwing (getter AND methods)
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'std-nostorage', init: [`(() => {
      const boom = function () { throw new DOMException('denied', 'SecurityError'); };
      try { Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom; Storage.prototype.clear = boom; } catch (e) {}
      try { Object.defineProperty(window, 'localStorage', { configurable: true, get: boom }); } catch (e) {}
    })();`] });
    await page.waitForTimeout(1000);
    const boot = await page.evaluate(() => ({ scr: __peri.state.screen, pers: __peri.Save.persistent }));
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(500);
    await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(400);
    await page.evaluate(() => { __peri.solveCurrent(); });
    let ok = true; try { await cardOn(page); } catch (e) { ok = false; }
    await tapEl(page, cdp, '#card [data-act="atlas"]'); await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ scr: __peri.state.screen, u: __peri.Save.data.unlocked, st: __peri.Save.data.stars[0], plate2: !document.querySelector('.plate[data-i="1"]').classList.contains('locked') }));
    await page.evaluate(() => __peri.screen('title')); await page.waitForTimeout(350);
    await tapEl(page, cdp, '#scr-title [data-act="sound"]');
    const mu = await page.evaluate(() => __peri.Sound.isMuted());
    check('6', 'localStorage throwing (getter + methods): full flow works, in-memory progress', boot.scr === 'title' && ok && r.u === 2 && r.st === 3 && r.plate2 && mu, JSON.stringify({ boot, r, mu }));
    check('1', 'no console errors (localStorage throwing)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ================================================================= landscape 844×390 (standalone)
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, landscape: true, label: 'std-landscape' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(QA, 'qa-landscape-title.png') });
    const t = await layoutAudit(page, 'landscape title');
    check('7', 'layout: title (landscape 844×390)', !t.issues.length, t.issues.join(' | '));
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(QA, 'qa-landscape-select.png') });
    const s = await layoutAudit(page, 'landscape select');
    check('7', 'layout: select (landscape)', !s.issues.length, s.issues.join(' | '));
    await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(500);
    const lay = await page.evaluate(() => __peri.Render.layout);
    metrics.landscape = { scale: +lay.scale.toFixed(4), plate: [lay.plate.x, lay.plate.y, lay.plate.w, lay.plate.h].map(v => +v.toFixed(1)), safe: lay.safe };
    // playable by touch in landscape
    const pull = await page.evaluate(() => { const sol = __peri.state.level.solution, L = __peri.Render.layout, sp = Math.hypot(sol.vx, sol.vy), len = sp / 640 * 300; return { dx: -sol.vx / sp * len * L.scale, dy: -sol.vy / sp * len * L.scale }; });
    await touchDrag(cdp, 422, 150, 422 + pull.dx, 150 + pull.dy, 10, 200);
    await page.waitForTimeout(30);
    const lc = await page.evaluate(() => __peri.state.launches);
    let ok = true; try { await cardOn(page, 15000); } catch (e) { ok = false; }
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(QA, 'qa-landscape-play.png') });
    const p = await layoutAudit(page, 'landscape play + card');
    check('7', 'landscape: touch launch works (pull ' + Math.hypot(pull.dx, pull.dy).toFixed(1) + ' px for full solution power at scale ' + lay.scale.toFixed(3) + ')', lc === 1 && ok, 'launches ' + lc + ' card ' + ok);
    check('7', 'layout: play + result card (landscape)', !p.issues.length, p.issues.join(' | '));
    check('7', 'landscape plate scale usable (≥ 0.15 → world 900 u ≥ 135 px)', lay.scale >= 0.15, 'scale ' + lay.scale.toFixed(3) + ' plate ' + metrics.landscape.plate.join('×'));
    // rotation back to portrait
    await page.setViewportSize({ width: 390, height: 844 });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS_P });
    await page.waitForTimeout(600);
    const back = await page.evaluate(() => ({ w: __peri.Render.layout.w, h: __peri.Render.layout.h, s: __peri.Render.layout.safe }));
    check('7', 'rotate landscape → portrait re-lays out (size + insets)', back.w === 390 && back.h === 844 && back.s.top === 47, JSON.stringify(back));
    check('1', 'no console errors (landscape session)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ================================================================= host-wrapped artifact variant (direct + inside iframe)
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: HOST, label: 'artifact' });
    await page.waitForTimeout(1300);
    const root = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement), c = document.getElementById('game').getBoundingClientRect(), u = document.getElementById('ui').getBoundingClientRect();
      return { pt: cs.paddingTop, pb: cs.paddingBottom, canvas: [c.left, c.top, c.width, c.height], ui: [u.left, u.top, u.width, u.height], bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: cs.backgroundColor, safe: __peri.Render.layout.safe, compat: document.compatMode }; });
    check('7', 'artifact: host :root safe-area padding neutralised; game fixed inset:0', root.pt === '0px' && root.pb === '0px' && root.canvas.join() === '0,0,390,844' && root.ui.join() === '0,0,390,844', JSON.stringify(root));
    check('7', 'artifact: body/html background is ink (no host #fafaf8 flash)', /14, 13, 11/.test(root.bodyBg) && /14, 13, 11/.test(root.htmlBg), root.bodyBg + ' / ' + root.htmlBg);
    await page.screenshot({ path: path.join(QA, 'qa-artifact-title.png') });
    const t = await layoutAudit(page, 'artifact title');
    check('7', 'artifact layout: title', !t.issues.length, t.issues.join(' | '));
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
    await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(500);
    const pull = await page.evaluate(() => { const sol = __peri.state.level.solution, L = __peri.Render.layout, sp = Math.hypot(sol.vx, sol.vy), len = sp / 640 * 300; return { dx: -sol.vx / sp * len * L.scale, dy: -sol.vy / sp * len * L.scale }; });
    await touchDrag(cdp, 195, 380, 195 + pull.dx, 380 + pull.dy, 12, 200);
    let ok = true; try { await cardOn(page, 15000); } catch (e) { ok = false; }
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(QA, 'qa-artifact-success.png') });
    const p = await layoutAudit(page, 'artifact play + card');
    check('6', 'artifact: touch flow title → atlas → plate I → launch → success card', ok, '');
    check('7', 'artifact layout: play + card', !p.issues.length, p.issues.join(' | '));
    const camp = await page.evaluate(() => { const P = __peri, bad = []; for (let i = 0; i < 30; i++) { P.loadLevel(i); P.solveCurrent(); P.fastForward(1300); if (!(P.state.result && P.state.result.success)) bad.push(i + 1); } return bad; });
    check('3', 'artifact: all 30 plates solve', !camp.length, camp.join(','));
    try { await cdp.send('Input.synthesizePinchGesture', { x: 195, y: 420, scaleFactor: 2.2, gestureSourceType: 'touch' }); } catch (e) {}
    await page.waitForTimeout(300);
    const z = await page.evaluate(() => visualViewport.scale);
    check('7', 'artifact: pinch does not zoom (host viewport lacks user-scalable=no)', z === 1, 'visualViewport.scale ' + z);
    check('1', 'no console errors (artifact direct)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: HOSTF, label: 'artifact-iframe' });
    await page.waitForTimeout(1500);
    const fr = page.frames().find(f => /qa-host\.html$/.test(f.url()));
    const has = fr && await fr.evaluate(() => !!window.__peri && __peri.state.screen === 'title');
    check('6', 'artifact in iframe: boots to title', !!has);
    if (fr) {
      await tapEl(page, cdp, '[data-act="begin"]', fr); await page.waitForTimeout(600);
      await tapEl(page, cdp, '.plate[data-i="0"]', fr); await page.waitForTimeout(500);
      const pull = await fr.evaluate(() => { const sol = __peri.state.level.solution, L = __peri.Render.layout, sp = Math.hypot(sol.vx, sol.vy), len = sp / 640 * 300; return { dx: -sol.vx / sp * len * L.scale, dy: -sol.vy / sp * len * L.scale }; });
      await touchDrag(cdp, 195, 380, 195 + pull.dx, 380 + pull.dy, 12, 200);
      let ok = true; try { await fr.waitForFunction(() => document.getElementById('card').classList.contains('on'), null, { timeout: 15000, polling: 50 }); } catch (e) { ok = false; }
      await page.waitForTimeout(1300);
      await page.screenshot({ path: path.join(QA, 'qa-artifact-iframe.png') });
      const sf = await fr.evaluate(() => __peri.Render.layout.safe);
      check('6', 'artifact in iframe: real touch flow → success card', ok, 'safe inside iframe ' + JSON.stringify(sf));
      if (sf.top === 0) note('inside an iframe env(safe-area-inset-*) resolves to 0 (Chromium; iOS Safari behaves the same for cross-origin iframes) — the host page must keep the iframe itself inside the safe area; the game cannot see the notch there.');
      const stS = await fr.evaluate(() => __peri.Physics.selfTest().ok);
      check('2', 'Physics.selfTest().ok inside artifact iframe', stS);
    }
    check('1', 'no console errors (artifact iframe)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();

  // ================================================================= (8) external requests
  const ext = [...new Set(allRequests)];
  const badReq = ext.filter(u => !/https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u.split(' ')[1]));
  check('8', 'no external requests other than fonts.googleapis/gstatic', !badReq.length, badReq.join(', ') + ' (seen: ' + [...new Set(ext.map(u => u.split(' ')[1].split('?')[0]))].join(', ') + ')');
  check('1', 'no console/page errors across all sessions (both variants)', !allErrors.length, allErrors.join(' | '));

  // ================================================================= report
  const secNames = { 1: 'Console / page errors', 2: 'Physics self-test', 3: 'Campaign solvability & prediction', 4: 'Endless', 5: 'Frame rate', 6: 'Touch flow', 7: 'Layout', 8: 'Size & network', 9: 'Screenshots' };
  let md = '# PERIHELION — QA report\n\n_Generated by `node tools/qa-run.js` on ' + new Date().toISOString() + ' — Chromium ' + metrics.chromium +
    ', iPhone 14 emulation (390×844 @3×, touch, safe-area insets top 47 / bottom 34 via CDP `Emulation.setSafeAreaInsetsOverride`; landscape 844×390 with left/right 47, bottom 21)._\n\n';
  md += '## Summary\n\n| # | Area | Result | Passed |\n|---|---|---|---|\n';
  for (const s of Object.keys(secNames)) {
    const r = results.filter(x => x.sec === s), bad = r.filter(x => !x.ok);
    md += `| ${s} | ${secNames[s]} | ${bad.length ? '**FAIL**' : 'PASS'} | ${r.length - bad.length}/${r.length} |\n`;
  }
  md += '\n## Measurements\n\n';
  md += `- Size: standalone ${(metrics.sizes['perihelion.html'] / 1024).toFixed(1)} KB, artifact ${(metrics.sizes['perihelion.artifact.html'] / 1024).toFixed(1)} KB (budget 300 KB)\n`;
  if (metrics.fps) {
    const f = metrics.fps;
    md += `- Frame timing, plate ${f.level.i + 1} "${f.level.name}" (${f.level.bodies}; ${f.level.frags} frags), longest flight ${f.level.best.n} steps:\n`;
    md += `  - flight @4× CPU throttle: script avg **${f.flight4x.scriptAvg} ms**, p95 **${f.flight4x.scriptP95} ms**, max ${f.flight4x.scriptMax} ms; rAF interval avg ${f.flight4x.intervalAvg} ms (p95 ${f.flight4x.intervalP95}); __peri.fps() ${f.flight4x.periFps}; frames >16.7 ms script: ${f.flight4x.over16}/${f.flight4x.frames}\n`;
    md += `  - aiming (prediction each frame) @4×: script avg **${f.aim4x.scriptAvg} ms**, p95 **${f.aim4x.scriptP95} ms**, max ${f.aim4x.scriptMax} ms; fps() ${f.aim4x.periFps}\n`;
    md += `  - raster-inclusive (physics + Render.frame + 1-px getImageData flush, 150 frames) @4×: flight avg ${f.flush4x.flight.avg} / p95 ${f.flush4x.flight.p95} / max ${f.flush4x.flight.max} ms; aiming avg ${f.flush4x.aim.avg} / p95 ${f.flush4x.aim.p95} / max ${f.flush4x.aim.max} ms\n`;
    md += `  - flight @1×: script avg ${f.flight1x.scriptAvg} ms, p95 ${f.flight1x.scriptP95} ms; fps() ${f.flight1x.periFps}\n`;
    md += `  - caveat: the rAF script time excludes deferred canvas raster (Chromium records a display list and rasters later), so it mostly measures physics + draw-call issue; the raster-inclusive row forces a flush each frame and is the better upper-bound proxy. 4× throttle of this sandbox CPU ≈ iPhone 12 Safari only roughly.\n`;
  }
  if (metrics.generate) md += `- Levels.generate (20 seeds, d 0→1): 1× avg ${metrics.generate.x1.avg} ms / p95 ${metrics.generate.x1.p95} / max ${metrics.generate.x1.max}; 4× avg ${metrics.generate.x4.avg} ms / p95 ${metrics.generate.x4.p95} / max ${metrics.generate.x4.max}\n`;
  if (metrics.playLayout) md += `- Portrait play layout: plate ${metrics.playLayout.plate.join(' × ')} (scale ${metrics.playLayout.scale}); top HUD y ${metrics.playLayout.hudY}; readout y ${metrics.playLayout.readoutY}; readout widths ${JSON.stringify(metrics.playLayout.readoutW)} vs max ${metrics.playLayout.readoutMax}\n`;
  if (metrics.cardLayout) md += `- Success card rect: ${JSON.stringify(metrics.cardLayout.card)}\n`;
  if (metrics.landscape) md += `- Landscape: scale ${metrics.landscape.scale}, plate ${metrics.landscape.plate.join(' × ')}\n`;
  if (metrics.captions) md += `- Caption sizes (fallback fonts): ${metrics.captions.map(c => c.size).join(', ')}\n`;
  md += '\n## All checks\n\n| # | Check | Result | Evidence |\n|---|---|---|---|\n';
  for (const r of results) md += `| ${r.sec} | ${r.name.replace(/\|/g, '/')} | ${r.ok ? 'PASS' : '**FAIL**'} | ${r.detail.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 400)} |\n`;
  if (notes.length) md += '\n## Notes\n\n' + notes.map(n => '- ' + n).join('\n') + '\n';
  md += '\n## Screenshots\n\n' + fs.readdirSync(QA).filter(f => /^qa-.*\.png$/.test(f)).map(f => '- `qa/' + f + '`').join('\n') + '\n';
  const RP = path.join(QA, 'qa-report.md'), MARK = '<!-- MANUAL: visual review & fix list (preserved across runs) -->';
  let manual = '';
  try { const old = fs.readFileSync(RP, 'utf8'); const k = old.indexOf(MARK); if (k >= 0) manual = old.slice(k); } catch (e) {}
  fs.writeFileSync(RP, md + '\n' + (manual || MARK + '\n'));
  fs.writeFileSync(path.join(QA, 'qa-metrics.json'), JSON.stringify(metrics, null, 1));
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
