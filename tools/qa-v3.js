// PERIHELION — QA v3 feature blocks (owner: QA AGENT): wormholes + Volume III (CONTRACT-v3), Atlas with three volumes,
// Endless no-repeat run, Volume III frame budget, and the silent-switch revert (no <audio>, no navigator.audioSession).
// Sections: 18 = wormholes / Volume III, 15 = Atlas (shared with qa-v2b), 4 = Endless, 5 = frame rate, 19 = audio.
const L = require('./qa-lib.js');
const { fs, path, ROOT, DIST, check, note, sleep, newPage, tapEl, cdpTap, touchDrag, touchHold, cardOn, frames, shot, text, rectOf, solutionPull, layoutAudit, SEED_SEEN, seedScript, zeros, metrics } = L;

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'fixtures-wormhole.json'), 'utf8'));

// ---------------------------------------------------------------- helpers that run in the page
// Instrument a flight: every Physics.stepSim call (distance moved, warps gained), Render.warp / Sound.warp / navigator.vibrate calls.
const INSTRUMENT = `(() => {
  const P = __peri, Ph = P.Physics, W = window.__w = { steps: [], rw: [], sw: 0, vib: 0 };
  if (!Ph.__orig) Ph.__orig = Ph.stepSim;
  Ph.stepSim = function (s, lv) { const x = s.x, y = s.y, w = s.warps, r = Ph.__orig.apply(this, arguments); W.steps.push([Math.hypot(s.x - x, s.y - y), s.warps - w, s.step]); return r; };
  if (!P.Render.__warp) P.Render.__warp = P.Render.warp;
  P.Render.warp = function (a, b, c, d) { const t = P.state.trail, cap = t.pts.length >> 1, l = (t.head - 1 + cap) % cap, q = (l - 1 + cap) % cap;
    W.rw.push({ args: [a, b, c, d], trailJump: Math.hypot(t.pts[2 * l] - t.pts[2 * q], t.pts[2 * l + 1] - t.pts[2 * q + 1]), at: performance.now() }); return P.Render.__warp.apply(this, arguments); };
  if (!P.Sound.__warp) P.Sound.__warp = P.Sound.warp;
  P.Sound.warp = function () { W.sw++; return P.Sound.__warp.apply(this, arguments); };
  try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: function () { W.vib++; return true; } }); } catch (e) {}
})()`;
const UNINSTRUMENT = `(() => { const P = __peri; if (P.Physics.__orig) P.Physics.stepSim = P.Physics.__orig; if (P.Render.__warp) P.Render.warp = P.Render.__warp; if (P.Sound.__warp) P.Sound.warp = P.Sound.__warp; })()`;

// differential pixel probe: how many samples along the straight chord between two world points differ between frame A and frame B
// (A: the path layer on, B: the same frame with it off). A line drawn ACROSS a wormhole jump would show up as differing samples.
const CHORD = `window.__chordDiff = function (draw, setA, setB, ax, ay, bx, by, exclWorld) {
  const P = __peri, S = P.state, cv = document.getElementById('game'), g = cv.getContext('2d'), Lo = P.Render.layout, d = cv.width / Lo.w, t = performance.now();
  const grab = fn => { fn(); P.Render.frame(S, t); return g.getImageData(0, 0, cv.width, cv.height).data; };
  const A = grab(setA), A2 = grab(setA), B = grab(setB);
  const p = P.Render.worldToScreen(ax, ay), q = P.Render.worldToScreen(bx, by), len = Math.hypot(q.x - p.x, q.y - p.y), ex = exclWorld * Lo.scale;
  const cnt = (X, Y) => { let n = 0, tot = 0;
    for (let s = 0; s <= len; s += 1.5) { const x = p.x + (q.x - p.x) * s / len, y = p.y + (q.y - p.y) * s / len;
      if (Math.hypot(x - p.x, y - p.y) < ex || Math.hypot(x - q.x, y - q.y) < ex) continue; tot++;
      const cx = Math.round(x * d), cy = Math.round(y * d); let differ = false;
      for (let dy = -d; dy <= d && !differ; dy++) for (let dx = -d; dx <= d; dx++) { const k = ((cy + dy) * cv.width + cx + dx) * 4; if (Math.abs(X[k] - Y[k]) + Math.abs(X[k + 1] - Y[k + 1]) + Math.abs(X[k + 2] - Y[k + 2]) > 40) { differ = true; break; } }
      if (differ) n++; }
    return { n, tot }; };
  return { chordLen: +(len / Lo.scale).toFixed(0), chord: cnt(A, B), control: cnt(A, A2) };
};
window.__pathDiff = function (setA, setB, pts, i0, i1) {   // positive control: the same probe along a stretch of the real path (sampled every ~1 css px)
  const P = __peri, S = P.state, cv = document.getElementById('game'), g = cv.getContext('2d'), Lo = P.Render.layout, d = cv.width / Lo.w, t = performance.now();
  const grab = fn => { fn(); P.Render.frame(S, t); return g.getImageData(0, 0, cv.width, cv.height).data; };
  const A = grab(setA), B = grab(setB); let n = 0, tot = 0;
  for (let i = i0; i < i1; i++) { const p = P.Render.worldToScreen(pts[2 * i], pts[2 * i + 1]), q = P.Render.worldToScreen(pts[2 * i + 2], pts[2 * i + 3]), len = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y));
    for (let s = 0; s < len; s += 1) { const x = p.x + (q.x - p.x) * s / len, y = p.y + (q.y - p.y) * s / len; tot++; const cx = Math.round(x * d), cy = Math.round(y * d); let differ = false;
      for (let dy = -d; dy <= d && !differ; dy++) for (let dx = -d; dx <= d; dx++) { const k = ((cy + dy) * cv.width + cx + dx) * 4; if (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 40) { differ = true; break; } }
      if (differ) n++; } }
  return { n, tot };
};`;

const jumpsIn = `(pts, n) => { const J = []; for (let k = 1; k < n; k++) if (Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]) > K.WARP_JUMP) J.push(k); return J; }`;

// ================================================================= (a) wormholes through the real touch path  [section 18]
async function worm(browser, STD) {
  const S = '18';
  // ---- all 30 Volume III plates and the full-clear table through the hooks (seeded save, cards already seen)
  {
    const { ctx, page, errors } = await newPage(browser, { url: STD, label: 'worm-all', init: [SEED_SEEN] });
    await page.waitForTimeout(900);
    const r = await page.evaluate((jumpsSrc) => {
      const P = __peri, S = P.state, jumpsOf = eval(jumpsSrc), out = [];
      for (let i = 60; i < 90; i++) {
        P.loadLevel(i); const lv = S.level; P.solveCurrent(); P.fastForward(1500); const r = S.result, J = r ? jumpsOf(r.pts, r.n) : [];
        let maxSeg = 0; if (r) for (let k = 1; k < r.n; k++) { const d = Math.hypot(r.pts[2 * k] - r.pts[2 * k - 2], r.pts[2 * k + 1] - r.pts[2 * k - 1]); if (d <= K.WARP_JUMP && d > maxSeg) maxSeg = d; }
        const worms = lv.bodies.filter(b => b.kind === 'wormhole'), mutual = worms.every(b => lv.bodies[b.pair] && lv.bodies[b.pair].pair === lv.bodies.indexOf(b));
        out.push({ i, name: lv.name, ok: !!(r && r.success && r.stars === 3), warps: S.sim ? S.sim.warps : -1, jumps: J.length, maxSeg: +maxSeg.toFixed(1), worms: worms.length, mutual, frags: (lv.frags || []).length, plate: lv.plate });
      }
      const cl = [];
      for (let i = 0; i < P.Levels.CAMPAIGN.length; i++) {
        const lv = P.Levels.CAMPAIGN[i], c = P.Levels.clearFor(lv); if (!c) { cl.push({ i, none: true }); continue; }
        const sim = P.Physics.createSim(lv, c.vx, c.vy, c.t0Step | 0); while (sim.status === 'flying' && sim.step < K.MAX_STEPS) P.Physics.stepSim(sim, lv);
        cl.push({ i, hit: sim.status === 'hit', all: sim.collected.length === (lv.frags || []).length && sim.collected.every(v => v) });
      }
      return { out, cl, n: P.Levels.CAMPAIGN.length, clearLen: P.Levels.CLEAR.length };
    }, jumpsIn);
    const bad = r.out.filter(c => !(c.ok && c.warps >= 1 && c.jumps === c.warps && c.maxSeg < 40 && c.worms >= 2 && c.mutual && c.frags >= 2));
    check(S, 'Volume III: all 30 plates solve to 3 stars through the game loop; every flight warps (sim.warps ≥ 1) and its result path has exactly sim.warps jumps > K.WARP_JUMP, other steps < 40', r.out.length === 30 && !bad.length, bad.map(c => c.plate + ' ' + JSON.stringify(c)).join(' | '));
    check(S, 'Volume III: every mouth has a mutual twin (pair), 2-3 fragments per plate, plates LXI..XC in order', r.out.every((c, k) => c.mutual && c.frags >= 2 && c.frags <= 3) && r.out[0].plate === 'LXI' && r.out[29].plate === 'XC', r.out.map(c => c.plate).join(','));
    const withClear = r.cl.filter(c => !c.none), badCl = withClear.filter(c => !(c.hit && c.all));
    check(S, 'Levels.CLEAR covers 87 plates (all but I-III): every course hits the target and gathers every fragment', r.clearLen === 90 && withClear.length === 87 && r.cl.filter(c => c.none).map(c => c.i).join() === '0,1,2' && !badCl.length, 'with course ' + withClear.length + ', none at ' + r.cl.filter(c => c.none).map(c => c.i + 1).join(',') + ', bad ' + badCl.map(c => c.i + 1).join(','));
    check(S, 'no console errors (Volume III all plates)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- loadCustom with the fixtures: campaign-like play, nothing saved, no plateSealed
  {
    const { ctx, page, errors } = await newPage(browser, { url: STD, label: 'worm-custom', init: [SEED_SEEN] });
    await page.waitForTimeout(900);
    const r = await page.evaluate((fx) => {
      const P = __peri, S = P.state, out = {}; const before = JSON.stringify(P.Save.data); let sealed = 0;
      const orig = P.Log.event; P.Log.event = function (n) { if (n === 'plateSealed') sealed++; return orig.apply(this, arguments); };
      out.rows = [];
      for (const k of Object.keys(fx)) {
        const lv = fx[k], ok = P.loadCustom(lv); const idx = S.levelIndex, scr = S.screen, mode = S.mode;
        const sol = P.solveCurrent(); P.fastForward(1500); const res = S.result;
        out.rows.push({ k, ok: !!ok, idx, scr, mode, sol: !!sol, success: !!(res && res.success), stars: res && res.stars, warps: S.sim ? S.sim.warps : -1 });
      }
      P.Log.event = orig; out.sealed = sealed; out.same = JSON.stringify(P.Save.data) === before;
      return out;
    }, FIX);
    check(S, 'loadCustom(fw1..fw3): campaign-like play with levelIndex -1, solution hits with ≥ 1 warp, ≥ 1 star', r.rows.length === 3 && r.rows.every(x => x.ok && x.idx === -1 && x.scr === 'play' && x.mode === 'campaign' && x.sol && x.success && x.warps >= 1 && x.stars >= 1), JSON.stringify(r.rows));
    check(S, 'loadCustom writes nothing to Save and emits no plateSealed', r.same && r.sealed === 0, JSON.stringify({ same: r.same, sealed: r.sealed }));
    check(S, 'no console errors (loadCustom)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- fresh player, plate LXI, real touch
  const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'worm', init: [`(() => { window.__vib = 0; })();`] });
  await page.waitForTimeout(1000);
  await page.evaluate(() => __peri.loadLevel(60)); await page.waitForTimeout(700);
  const seq = [], cardInfo = {};
  for (let k = 0; k < 4; k++) {
    const c = await page.evaluate(() => __peri.state.card); if (!c) break;
    seq.push(c);
    if (c === 'wormholes') {
      Object.assign(cardInfo, await page.evaluate(() => { const s = __peri.state, lv = s.level, p = document.getElementById('pcard'), ms = lv.bodies.filter(b => b.kind === 'wormhole');
        return { on: p.classList.contains('on'), t: p.innerText.replace(/\s+/g, ' '), sp: (s.spotlight || []).map(q => [q.x, q.y, q.r]), mouths: ms.map(b => [b.x, b.y, b.r + 14]), step: s.step, btn: p.querySelector('[data-act="pop-ok"]').innerText }; }));
      const au = await layoutAudit(page, 'wormholes card'); cardInfo.issues = au.issues; cardInfo.rings = au.info.rings;
      const r0 = await rectOf(page, '#pcard');
      cardInfo.cardY = [r0.t, r0.b];
      cardInfo.mouthsY = await page.evaluate(() => __peri.state.level.bodies.filter(b => b.kind === 'wormhole').map(b => __peri.Render.worldToScreen(b.x, b.y).y));
      const hold = await touchHold(cdp, 195, 120, 150, 190, 6); cardInfo.aimActive = await page.evaluate(() => __peri.state.aim.active); await hold.end();
      await frames(page, 30); cardInfo.stepHeld = await page.evaluate(() => __peri.state.step);
      await shot(page, 'qa-wormholes-card.png');
    }
    await tapEl(page, cdp, '#pcard [data-act="pop-ok"]'); await page.waitForTimeout(600);
  }
  check(S, 'fresh player loads plate LXI: cards arrive in the order intro, fragments, wormholes (each dismissed by touch)', JSON.stringify(seq) === '["intro","fragments","wormholes"]' && await page.evaluate(() => __peri.state.card === null), JSON.stringify(seq));
  check(S, 'wormholes card: title "Wormholes", the contract text with ↻ 90°, button "Understood"', cardInfo.on && /Wormholes/.test(cardInfo.t) && /Wormholes come in pairs, marked with the same Greek letter\. Fly into one and you leave by its twin at the same speed\. A mark such as ↻ 90° means your heading turns that far as you pass through\. They pull on nothing and do no harm\./.test(cardInfo.t) && cardInfo.btn === 'Understood', cardInfo.t);
  check(S, 'wormholes card: state.spotlight holds every mouth as {x, y, r: mouth.r + 14}', cardInfo.sp && cardInfo.sp.length === 2 && JSON.stringify(cardInfo.sp) === JSON.stringify(cardInfo.mouths), JSON.stringify({ sp: cardInfo.sp, mouths: cardInfo.mouths }));
  check(S, 'wormholes card sits on the half of the screen away from the mouths, clear of rings, HUD and notch (layout audit with spotlight radii)', !cardInfo.issues.length && (() => { const my = cardInfo.mouthsY.reduce((a, b) => a + b, 0) / cardInfo.mouthsY.length; return my < 422 ? cardInfo.cardY[0] >= 400 : cardInfo.cardY[1] <= 444; })(), cardInfo.issues.join(' | ') + ' card ' + JSON.stringify(cardInfo.cardY) + ' mouths y ' + JSON.stringify(cardInfo.mouthsY));
  check(S, 'wormholes card blocks aiming and holds the clock (60 frames)', cardInfo.aimActive === false && cardInfo.stepHeld === cardInfo.step, JSON.stringify({ aim: cardInfo.aimActive, step: cardInfo.step, held: cardInfo.stepHeld }));
  check(S, 'dismissing it clears the spotlight and stores seen.wormholes', await page.evaluate(() => __peri.state.spotlight === null && __peri.Save.seen('wormholes') && JSON.parse(localStorage.getItem('perihelion.v1')).seen.wormholes === true));

  // ---- Menu: About wormholes only on wormhole plates
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  const mw = await page.evaluate(() => { const b = document.getElementById('sheet-worm'), r = b.getBoundingClientRect(); return { hidden: b.hidden, w: r.width, h: r.height, t: b.innerText.trim() }; });
  const ma = await layoutAudit(page, 'wormhole menu');
  check(S, 'Menu on plate LXI lists "About wormholes" (visible, ≥ 44 px) and passes the layout audit', !mw.hidden && mw.t === 'About wormholes' && mw.w >= 44 && mw.h >= 44 && !ma.issues.length, JSON.stringify(mw) + ' ' + ma.issues.join(' | '));
  await shot(page, 'qa-menu-wormholes.png');
  await tapEl(page, cdp, '#sheet [data-act="wormholes"]'); await page.waitForTimeout(450);
  check(S, 'Menu → About wormholes reopens the card with the mouth spotlight', await page.evaluate(() => __peri.state.card === 'wormholes' && __peri.state.spotlight && __peri.state.spotlight.length === 2));
  await tapEl(page, cdp, '#pcard [data-act="pop-ok"]'); await page.waitForTimeout(400);
  await tapEl(page, cdp, '#sheet [data-act="resume"]'); await page.waitForTimeout(250);
  await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(400);
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  check(S, 'Menu on a plate without wormholes (I) hides "About wormholes"', await page.evaluate(() => document.getElementById('sheet-worm').hidden));
  await tapEl(page, cdp, '#sheet [data-act="resume"]'); await page.waitForTimeout(250);

  // ---- real finger drag launch whose flight warps
  await page.evaluate(() => __peri.loadLevel(60)); await page.waitForTimeout(500);
  const cardNow = await page.evaluate(() => __peri.state.card); // seen already: none
  await page.evaluate(INSTRUMENT);
  await page.evaluate(CHORD);
  const pull = await solutionPull(page);
  await touchDrag(cdp, 195, 420, 195 + pull.dx, 420 + pull.dy, 12, 150);
  await page.waitForTimeout(40);
  const l1 = await page.evaluate(() => ({ l: __peri.state.launches, ph: __peri.state.phase }));
  check(S, 'plate LXI: a real finger drag-release launches (no card in the way)', cardNow === null && l1.l === 1 && l1.ph === 'flight', JSON.stringify({ cardNow, l1 }));
  let warped = true; try { await page.waitForFunction(() => window.__w.rw.length >= 1, null, { timeout: 12000, polling: 20 }); } catch (e) { warped = false; }
  // flash: paper-white pixels in rings around both mouths just after the passage vs 900 ms later
  const flash = await page.evaluate(async () => {
    const P = __peri, S = P.state, lv = S.level, cv = document.getElementById('game'), g = cv.getContext('2d'), Lo = P.Render.layout, d = cv.width / Lo.w, ms = lv.bodies.filter(b => b.kind === 'wormhole');
    const count = () => { let n = 0; for (const b of ms) { const c = P.Render.worldToScreen(b.x, b.y), r0 = b.r * Lo.scale * 1.12, r1 = b.r * Lo.scale * 2.6, x0 = Math.max(0, Math.floor((c.x - r1) * d)), y0 = Math.max(0, Math.floor((c.y - r1) * d)), w = Math.min(cv.width - x0, Math.ceil(2 * r1 * d)), h = Math.min(cv.height - y0, Math.ceil(2 * r1 * d)), im = g.getImageData(x0, y0, w, h).data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dist = Math.hypot((x0 + x) / d - c.x, (y0 + y) / d - c.y); if (dist >= r0 && dist <= r1) { const k = (y * w + x) * 4; if (Math.min(im[k], im[k + 1], im[k + 2]) > 110) n++; } } } return n; };
    await new Promise(r => setTimeout(r, 90)); const early = count(); await new Promise(r => setTimeout(r, 900)); const late = count();
    return { early, late, phase: S.phase };
  });
  await shot(page, 'qa-wormhole-flight.png');
  let ok1 = true; try { await cardOn(page, 20000); } catch (e) { ok1 = false; }
  await page.waitForTimeout(1500);
  const R = await page.evaluate((jumpsSrc) => {
    const P = __peri, S = P.state, w = window.__w, jumpsOf = eval(jumpsSrc), res = S.result, lv = S.level, sol = lv.solution;
    const J = res ? jumpsOf(res.pts, res.n) : [], stepJ = w.steps.map((s, k) => [s, k]).filter(([s]) => s[0] > K.WARP_JUMP), warpSteps = w.steps.map((s, k) => [s, k]).filter(([s]) => s[1] > 0);
    const buf = new Float32Array(2600), sim = P.Physics.simulate(lv, sol.vx, sol.vy, sol.t0Step | 0, 1200, buf), SJ = jumpsOf(buf, sim.n);
    const t = S.trail, cap = t.pts.length >> 1, n = Math.min(t.n, cap), start = ((t.head - n) % cap + cap) % cap; let tj = 0;
    for (let i = 1; i < n; i++) { const a = (start + i - 1) % cap, b = (start + i) % cap; if (Math.hypot(t.pts[2 * b] - t.pts[2 * a], t.pts[2 * b + 1] - t.pts[2 * a + 1]) > K.WARP_JUMP) tj++; }
    const tailSteps = w.steps.slice(w.steps.length - (n - 1)), expTj = tailSteps.filter(s => s[1] > 0).length;
    const ms = lv.bodies.filter(b => b.kind === 'wormhole'), near = (x, y) => ms.some(b => Math.hypot(b.x - x, b.y - y) < 1);
    return { success: !!(res && res.success), stars: res && res.stars, launches: S.launches, warps: S.sim && S.sim.warps, card: document.getElementById('card').innerText.replace(/\s+/g, ' '),
      resJumps: J, simJumps: SJ, nPts: res && res.n, simN: sim.n, stepJumpN: stepJ.length, warpStepN: warpSteps.length, mismatch: stepJ.length !== warpSteps.length || warpSteps.some(([s]) => s[0] <= K.WARP_JUMP), maxNormal: Math.max(...w.steps.filter(s => s[1] === 0).map(s => s[0])),
      trailJumps: tj, expTrailJumps: expTj, trailN: n, rw: w.rw.map(r => ({ trailJump: +r.trailJump.toFixed(1), ends: [near(r.args[0], r.args[1]), near(r.args[2], r.args[3])], len: +Math.hypot(r.args[0] - r.args[2], r.args[1] - r.args[3]).toFixed(0) })), sw: w.sw, vib: w.vib,
      stat: P.Save.stat('warps'), gate: P.Save.hasAch('first_gate'), stored: P.Save.data.stars[60], unlocked: P.Save.data.unlocked, step: P.state.step };
  }, jumpsIn);
  check(S, 'plate LXI: the flight warped and the result card appeared ("Sealed")', warped && ok1 && R.success && /Sealed/.test(R.card), JSON.stringify({ warped, ok1, success: R.success, card: R.card.slice(0, 80) }));
  check(S, 'plate LXI: one real-touch launch = ★★★ (stars 3, launches 1), saved on plate 61, plate LXII unlocked', R.stars === 3 && R.launches === 1 && R.stored === 3 && R.unlocked === 62, JSON.stringify({ stars: R.stars, launches: R.launches, stored: R.stored, unlocked: R.unlocked }));
  check(S, 'live flight: a step moves the probe more than K.WARP_JUMP exactly when sim.warps rises (once), every other step is smaller (max ' + (R.maxNormal || 0).toFixed(1) + ')', R.warps === 1 && R.stepJumpN === 1 && R.warpStepN === 1 && !R.mismatch && R.maxNormal < 40, JSON.stringify({ warps: R.warps, stepJumpN: R.stepJumpN, warpStepN: R.warpStepN, maxNormal: R.maxNormal }));
  check(S, 'live trail: the ring buffer holds exactly the passage jump(s) (> K.WARP_JUMP), and Render.warp fired once with the trail jump already in place', R.trailJumps === R.expTrailJumps && R.trailJumps === 1 && R.rw.length === 1 && R.rw[0].trailJump > 40, JSON.stringify({ tj: R.trailJumps, exp: R.expTrailJumps, trailN: R.trailN, rw: R.rw }));
  check(S, 'result path (state.result.pts): one jump, at the same index as in Physics.simulate of the stored solution (offset ' + (R.nPts - R.simN) + ')', R.resJumps.length === 1 && R.simJumps.length === 1 && R.resJumps[0] - R.simJumps[0] === R.nPts - R.simN && R.nPts - R.simN >= 0 && R.nPts - R.simN <= 1, JSON.stringify({ res: R.resJumps, sim: R.simJumps, nPts: R.nPts, simN: R.simN }));
  check(S, 'warp effects: Render.warp called with the two mouth centres (entry, exit), Sound.warp once, a short vibrate', R.rw.length === 1 && R.rw[0].ends[0] && R.rw[0].ends[1] && R.rw[0].len >= 150 && R.sw === 1 && R.vib >= 1, JSON.stringify({ rw: R.rw, sw: R.sw, vib: R.vib }));
  check(S, 'warp flash is drawn: paper-white ring pixels around the mouths 90 ms after the passage exceed those 1 s later by ≥ 15', flash.early - flash.late >= 15, JSON.stringify(flash));
  check(S, 'Log: stat warps counted and honour "Through the Gate" (first_gate) unlocked by sealing with a warping flight', R.stat >= 1 && R.gate, JSON.stringify({ stat: R.stat, gate: R.gate }));
  await shot(page, 'qa-wormhole-success.png');
  const sa = await layoutAudit(page, 'wormhole success card'); check(S, 'layout: wormhole plate success card', !sa.issues.length, sa.issues.join(' | '));

  // ---- the replayed path, the live trail never connect across the jump (differential pixels along the chord)
  // (1) result replay: A = replay drawn, B = replay hidden
  const rr = await page.evaluate(() => {
    const P = __peri, S = P.state, res = S.result, pts = res.pts, J = []; for (let k = 1; k < res.n; k++) if (Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]) > K.WARP_JUMP) J.push(k);
    const j = J[0], keepN = res.n; const fx = P.Render.fx;
    const out = window.__chordDiff('replay', () => { res.n = keepN; }, () => { res.n = 0; fx.reset(); }, pts[2 * j - 2], pts[2 * j - 1], pts[2 * j], pts[2 * j + 1], 14);
    res.n = keepN;
    out.positive = window.__pathDiff(() => { res.n = keepN; }, () => { res.n = 0; fx.reset(); }, pts, Math.max(0, j - 40), j - 4); res.n = keepN;
    return out;
  });
  check(S, 'post-flight replay stops at the jump: no ink along the chord between exit and entry (' + rr.chord.n + '/' + rr.chord.tot + ' samples differ over ' + rr.chordLen + ' u; control ' + rr.control.n + '; the real path before the jump differs on ' + rr.positive.n + '/' + rr.positive.tot + ')', rr.chord.tot >= 20 && rr.chord.n === 0 && rr.control.n === 0 && rr.positive.n >= 15, JSON.stringify(rr));

  // (2) consult the astronomer on the wormhole plate, then (3) live trail while flying, (4) prediction
  await tapEl(page, cdp, '#card [data-act="replay"]'); await page.waitForTimeout(300);
  await page.evaluate(UNINSTRUMENT); await page.evaluate(INSTRUMENT);
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  const hen = await page.evaluate(() => ({ dis: document.getElementById('sheet-hint').getAttribute('aria-disabled') }));
  await tapEl(page, cdp, '#sheet-hint'); await page.waitForTimeout(500);
  const hh = await page.evaluate((jumpsSrc) => {
    const P = __peri, S = P.state, h = S.hint, jumpsOf = eval(jumpsSrc), lv = S.level, sol = P.Levels.clearFor(lv) || lv.solution, t0 = sol.t0Step | 0, J = jumpsOf(h.pts, h.n);
    const q = P.Physics.createSim(lv, sol.vx, sol.vy, t0); let tot = 0, lastW = 0, wp = 0, got = 0, lastF = 0;
    while (q.status === 'flying' && q.step < K.MAX_STEPS) { P.Physics.stepSim(q, lv); tot++; if (q.warps > wp) { wp = q.warps; lastW = tot; } const c = q.collected.reduce((a, b) => a + b, 0); if (c > got) { got = c; lastF = tot; } }
    return { on: h.on, used: h.used, fz: S.frozen, step: S.step, t0, n: h.n, J, tot, lastW, lastF, cap92: Math.floor(0.92 * tot), paused: S.paused };
  }, jumpsIn);
  check(S, 'hint on the wormhole plate (real menu tap): brass line shown, heavens held at the course start, line contains the passage jump', hen.dis === 'false' && hh.on && hh.used && hh.fz && hh.step === hh.t0 && hh.J.length === 1 && !hh.paused, JSON.stringify(hh));
  check(S, 'hint on the wormhole plate runs ≥ 24 steps beyond the passage (or to the 92% cap) so the exit heading shows; never the whole course; ≤ K.HINT_MAX', hh.n >= Math.min(hh.lastW + 24, hh.cap92) && hh.n <= hh.cap92 + 1 && hh.n <= 1100 && hh.J[0] < hh.n - 20, JSON.stringify({ n: hh.n, lastW: hh.lastW, lastFrag: hh.lastF, tot: hh.tot, cap92: hh.cap92, jump: hh.J }));
  const hd = await page.evaluate(() => {
    const P = __peri, S = P.state, h = S.hint, j = (() => { for (let k = 1; k < h.n; k++) if (Math.hypot(h.pts[2 * k] - h.pts[2 * k - 2], h.pts[2 * k + 1] - h.pts[2 * k - 1]) > K.WARP_JUMP) return k; })();
    S.frozen = true; S.aim.active = false;
    const out = window.__chordDiff('hint', () => { h.on = true; }, () => { h.on = false; }, h.pts[2 * j - 2], h.pts[2 * j - 1], h.pts[2 * j], h.pts[2 * j + 1], 14); h.on = true;
    out.positive = window.__pathDiff(() => { h.on = true; }, () => { h.on = false; }, h.pts, Math.max(0, j - 40), j - 4); h.on = true;
    return out;
  });
  check(S, 'astronomer’s line stops at the jump: no brass along the chord (' + hd.chord.n + '/' + hd.chord.tot + ' samples differ; control ' + hd.control.n + '; positive control on the line itself ' + hd.positive.n + '/' + hd.positive.tot + ')', hd.chord.tot >= 20 && hd.chord.n === 0 && hd.control.n === 0 && hd.positive.n >= 6, JSON.stringify(hd));
  await shot(page, 'qa-wormhole-hint.png');
  // real touch launch of the hinted course: 2 stars
  const pull2 = await solutionPull(page);
  await touchDrag(cdp, 195, 420, 195 + pull2.dx, 420 + pull2.dy, 12, 150); await page.waitForTimeout(40);
  // live trail differential, sampled once the exit has been flown for a while (fx long over)
  let warped2 = true; try { await page.waitForFunction(() => window.__w.rw.length >= 1, null, { timeout: 12000, polling: 10 }); } catch (e) { warped2 = false; }
  const td = await page.evaluate(() => {
    const P = __peri, S = P.state, t = S.trail, cap = t.pts.length >> 1;
    if (S.phase !== 'flight') return { skipped: S.phase };
    const n = Math.min(t.n, cap), start = ((t.head - n) % cap + cap) % cap, at = i => (start + i) % cap, pt = i => [t.pts[2 * at(i)], t.pts[2 * at(i) + 1]];
    let j = -1; for (let i = 1; i < n; i++) { const a = pt(i - 1), b = pt(i); if (Math.hypot(a[0] - b[0], a[1] - b[1]) > K.WARP_JUMP) { j = i; break; } }
    if (j < 0) return { noJump: true, n };
    const a = pt(j - 1), b = pt(j), keep = t.n;
    const out = window.__chordDiff('trail', () => { t.n = keep; }, () => { t.n = 0; }, a[0], a[1], b[0], b[1], 14); t.n = keep;
    const seg = new Float32Array(2 * 40); for (let i = 0; i < 40; i++) { const q = pt(Math.max(0, j - 40 + i)); seg[2 * i] = q[0]; seg[2 * i + 1] = q[1]; }
    out.positive = window.__pathDiff(() => { t.n = keep; }, () => { t.n = 0; }, seg, 0, 36); t.n = keep; out.trailN = n; out.j = j;
    return out;
  });
  check(S, 'live trail stops at the jump while flying: no vermilion along the chord (' + (td.chord ? td.chord.n + '/' + td.chord.tot : JSON.stringify(td)) + ' samples differ; control ' + (td.control ? td.control.n : '-') + '; positive control ' + (td.positive ? td.positive.n + '/' + td.positive.tot : '-') + ')', warped2 && td.chord && td.chord.tot >= 20 && td.chord.n === 0 && td.control.n === 0 && td.positive.n >= 15, JSON.stringify(td));
  let ok2 = true; try { await cardOn(page, 20000); } catch (e) { ok2 = false; }
  await page.waitForTimeout(1200);
  const hw = await page.evaluate(() => ({ st: __peri.state.result && __peri.state.result.stars, l: __peri.state.launches, card: document.getElementById('card').innerText.replace(/\s+/g, ' '), saved: __peri.Save.data.stars[60] }));
  check(S, 'hinted one-launch win by real touch on the wormhole plate = 2 stars, card says "Astronomer consulted: one star forfeited", best stays 3', ok2 && hw.st === 2 && hw.l === 1 && /Astronomer consulted: one star forfeited/.test(hw.card) && hw.saved === 3, JSON.stringify(hw));
  await page.evaluate(UNINSTRUMENT);

  // (4) prediction: stops at the jump too (first Volume III plate whose 270-step prediction contains one)
  const pd = await page.evaluate((jumpsSrc) => {
    const P = __peri, S = P.state, jumpsOf = eval(jumpsSrc);
    let pick = -1; for (const i of [60, 61, 62, 63, 65, 66]) { const lv = P.Levels.CAMPAIGN[i], s = lv.solution, pb = new Float32Array(K.PREDICT_STEPS * 2 + 8), pr = P.Physics.predict(lv, s.vx, s.vy, s.t0Step | 0, pb); if (jumpsOf(pb, pr.n).length) { pick = i; break; } }
    if (pick < 0) return { none: true };
    P.loadLevel(pick); S.frozen = true; const sol = S.level.solution, dx = -sol.vx / 640 * 300, dy = -sol.vy / 640 * 300, v = P.Physics.launchVelocity(dx, dy);
    const aim = () => Object.assign(S.aim, { active: true, cancel: false, dx, dy, power: v.power, vx: v.vx, vy: v.vy });
    aim(); P.fastForward(0); const n = S.predict.n, pts = S.predict.pts.slice(), J = jumpsOf(pts, n);
    const j = J[0], keep = S.predict.n;
    const out = window.__chordDiff('predict', () => { aim(); S.predict.n = keep; }, () => { S.aim.active = false; S.aim.cancel = true; S.predict.n = 0; }, pts[2 * j - 2], pts[2 * j - 1], pts[2 * j], pts[2 * j + 1], 14);
    out.positive = window.__pathDiff(() => { aim(); S.predict.n = keep; }, () => { S.aim.active = false; S.aim.cancel = true; S.predict.n = 0; }, pts, Math.max(1, j - 24), j - 4);
    S.aim.active = false; S.aim.cancel = true; S.predict.n = 0; S.frozen = false; out.plate = pick + 1; out.n = n; out.jumps = J.length;
    return out;
  }, jumpsIn);
  check(S, 'aiming prediction stops at the jump (plate ' + pd.plate + ', n=' + pd.n + '): no dots along the chord (' + (pd.chord ? pd.chord.n + '/' + pd.chord.tot : '-') + ' samples differ; control ' + (pd.control ? pd.control.n : '-') + '; positive control ' + (pd.positive ? pd.positive.n + '/' + pd.positive.tot : '-') + ')', !pd.none && pd.chord.tot >= 15 && pd.chord.n === 0 && pd.control.n === 0 && pd.positive.n >= 3, JSON.stringify(pd));

  // ---- a two-pair plate (LXXIX): hinted real-touch launch warps twice; "Twice Through"
  await page.evaluate(() => __peri.loadLevel(78)); await page.waitForTimeout(500);
  const c2 = await page.evaluate(() => __peri.state.card);
  await page.evaluate(INSTRUMENT);
  await page.evaluate(() => __peri.useHint()); await page.waitForTimeout(200);
  const pull3 = await solutionPull(page);
  await touchDrag(cdp, 195, 420, 195 + pull3.dx, 420 + pull3.dy, 12, 150);
  let ok3 = true; try { await cardOn(page, 20000); } catch (e) { ok3 = false; }
  await page.waitForTimeout(800);
  const tw = await page.evaluate(() => { const w = window.__w, res = __peri.state.result; return { ok: !!(res && res.success), stars: res && res.stars, warps: __peri.state.sim.warps, rw: w.rw.length, sw: w.sw, twice: __peri.Save.hasAch('double_gate'), jumps: (() => { let n = 0; for (let k = 1; k < res.n; k++) if (Math.hypot(res.pts[2 * k] - res.pts[2 * k - 2], res.pts[2 * k + 1] - res.pts[2 * k - 1]) > K.WARP_JUMP) n++; return n; })() }; });
  check(S, 'plate LXXIX (two pairs, moving bodies): hinted real-touch launch seals with 2 warps, 2 jumps in the path, 2 Render.warp / Sound.warp calls, honour "Twice Through"', ok3 && c2 === null && tw.ok && tw.stars === 2 && tw.warps === 2 && tw.jumps === 2 && tw.rw === 2 && tw.sw === 2 && tw.twice, JSON.stringify({ c2, tw }));
  await page.evaluate(UNINSTRUMENT);
  check(S, 'no console errors (wormhole touch session)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================= (b) Atlas, Volume III  [section 15]
async function atlas3(browser, STD) {
  const S = '15';
  const stars59 = zeros(90).map((_, i) => (i < 59 ? [3, 2, 1][i % 3] : 0));
  const mk = (n, unlocked) => ({ v: 2, stars: zeros(90).map((_, i) => (i < n ? [3, 2, 1][i % 3] : 0)), frags: zeros(90), unlocked, endlessBest: 0, muted: false, seen: { intro: true, fragments: true } });
  const sum = n => zeros(n).reduce((a, _, i) => a + [3, 2, 1][i % 3], 0);
  const lockedOf = page => page.evaluate(() => [...document.querySelectorAll('.plate')].map(c => c.classList.contains('locked')));
  for (const [tag, seedObj, openIdx, sealed] of [['unlocked 60 (plate LX open, LXI locked)', mk(59, 60), 59, 59], ['unlocked 61 (LX sealed, LXI open)', mk(60, 61), 60, 60]]) {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'atlas3-' + openIdx, init: [seedScript(seedObj)] });
    await page.waitForTimeout(1000);
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(700);
    const a = await page.evaluate(() => { const hs = [...document.querySelectorAll('.vol-head')], grids = [...document.querySelectorAll('.grid')], g3 = grids[2];
      return { heads: hs.map(h => h.innerText.replace(/\s+/g, ' ').trim()), grids: grids.length, n3: g3 ? g3.querySelectorAll('.plate').length : 0, first3: g3 && +g3.querySelector('.plate').dataset.i, last3: g3 && +[...g3.querySelectorAll('.plate')].pop().dataset.i,
        names3: g3 ? [...g3.querySelectorAll('.pl-num')].map(e => e.innerText).filter((_, k) => k === 0 || k === 29).join('..') : '', tally: document.getElementById('tally').innerText.replace(/\s+/g, ' '), total: document.querySelectorAll('.plate').length }; });
    check(S, 'Atlas [' + tag + ']: Volume III section present (heading "Volume III · Plates LXI–XC") with 30 plates, indices 60..89', a.grids === 3 && /^Volume III\s*·\s*Plates LXI–XC$/i.test(a.heads[2]) && a.n3 === 30 && a.first3 === 60 && a.last3 === 89 && a.total === 90 && a.names3 === 'LXI..XC', JSON.stringify(a));
    const tally = new RegExp('Stars ' + sum(sealed) + '/270.*Sealed ' + sealed + '/90', 'i');
    check(S, 'Atlas [' + tag + ']: tally "Stars ' + sum(sealed) + '/270 · Sealed ' + sealed + '/90"', tally.test(a.tally), a.tally);
    const lk = await lockedOf(page);
    const expectLocked = k => k > openIdx;
    check(S, 'Atlas [' + tag + ']: plate LXI is ' + (openIdx === 59 ? 'locked' : 'open') + ', every Volume III plate after it locked, LX open', lk.every((v, k) => v === expectLocked(k)) && lk.filter(Boolean).length === 89 - openIdx, 'locked ' + lk.filter(Boolean).length + ' (expected ' + (89 - openIdx) + '), LXI locked=' + lk[60] + ', LX locked=' + lk[59]);
    // scroll down through Volume III by real swipes; every thumbnail of the 30 must get drawn (lazy) and none blank
    await page.evaluate(() => { const hs = document.querySelectorAll('.vol-head'), sc = document.getElementById('s-scroll'); sc.scrollTop = hs[2].getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12; });
    await page.waitForTimeout(600);
    const seen = new Set(), snap = async () => page.evaluate(() => { const sc = document.getElementById('s-scroll').getBoundingClientRect(), out = [];
      for (const c of document.querySelectorAll('.plate')) { const i = +c.dataset.i; if (i < 60) continue; const r = c.getBoundingClientRect(); if (r.bottom > sc.top && r.top < sc.bottom) { const cv = c.querySelector('canvas'), drawn = cv.width !== 300; let n = 0; if (drawn) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] > 120) n++; } out.push({ i, drawn, n }); } } return out; });
    let first = null, blank = [], undrawn = [];
    for (let k = 0; k < 14; k++) {
      const v = await snap(); if (!first) first = v;
      for (const c of v) { seen.add(c.i); if (c.drawn && c.n < 40) blank.push(c.i); }
      await touchDrag(cdp, 195, 650, 195, 330, 8); await page.waitForTimeout(300);
      if (seen.size === 30 && k > 8) break;
    }
    await page.waitForTimeout(400);
    const fin = await snap(); for (const c of fin) { seen.add(c.i); if (c.drawn && c.n < 40) blank.push(c.i); }
    // after the sweep, all 30 have been drawn
    const drawnAll = await page.evaluate(() => [...document.querySelectorAll('.plate')].filter(c => +c.dataset.i >= 60).map(c => c.querySelector('canvas').width !== 300));
    check(S, 'Atlas [' + tag + ']: touch-scrolling through Volume III draws all 30 thumbnails lazily (first screen drew ' + first.filter(c => c.drawn).length + '/' + first.length + ' visible), none blank', seen.size === 30 && drawnAll.every(Boolean) && !blank.length && first.length < 30 && first.every(c => c.drawn), JSON.stringify({ seen: seen.size, drawnAll: drawnAll.filter(Boolean).length, blank: [...new Set(blank)], firstVisible: first.map(c => c.i + (c.drawn ? '' : '!')) }));
    await shot(page, 'qa-atlas-vol3-' + openIdx + '.png');
    const au = await layoutAudit(page, 'atlas vol III ' + openIdx); check(S, 'layout: Atlas Volume III [' + tag + ']', !au.issues.length, au.issues.join(' | '));
    if (openIdx === 59) {
      // locked: tapping LXI does nothing; sealing LX unlocks it (and only it)
      await page.evaluate(() => { const hs = document.querySelectorAll('.vol-head'), sc = document.getElementById('s-scroll'); sc.scrollTop = hs[2].getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12; }); await page.waitForTimeout(300);
      await tapEl(page, cdp, '.plate[data-i="60"]'); await page.waitForTimeout(300);
      check(S, 'tapping the locked plate LXI by touch does nothing (still the Atlas)', await page.evaluate(() => __peri.state.screen === 'select' && __peri.state.levelIndex !== 60));
      await page.evaluate(() => { __peri.loadLevel(59); __peri.solveCurrent(); __peri.fastForward(1500); __peri.screen('select'); }); await page.waitForTimeout(600);
      const lk2 = await lockedOf(page), u = await page.evaluate(() => ({ u: __peri.Save.data.unlocked, tally: document.getElementById('tally').innerText.replace(/\s+/g, ' ') }));
      check(S, 'sealing plate LX unlocks plate LXI (not LXII); tally Sealed 60/90', lk2[60] === false && lk2[61] === true && u.u === 61 && /Sealed 60\/90/.test(u.tally) && lk2.filter(Boolean).length === 29, JSON.stringify({ u, lockedN: lk2.filter(Boolean).length }));
      await page.evaluate(() => { const hs = document.querySelectorAll('.vol-head'), sc = document.getElementById('s-scroll'); sc.scrollTop = hs[2].getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12; }); await page.waitForTimeout(400);
      await tapEl(page, cdp, '.plate[data-i="60"]'); await page.waitForTimeout(700);
      const pl = await page.evaluate(() => ({ scr: __peri.state.screen, i: __peri.state.levelIndex, card: __peri.state.card, name: __peri.state.level.name }));
      check(S, 'touch tap on the freshly unlocked plate LXI opens it; the wormholes card is next (intro/fragments already seen)', pl.scr === 'play' && pl.i === 60 && pl.card === 'wormholes', JSON.stringify(pl));
    } else {
      await tapEl(page, cdp, '.plate[data-i="62"]'); await page.waitForTimeout(300);
      check(S, 'tapping locked plate LXIII does nothing; LXII is locked too', await page.evaluate(() => __peri.state.screen === 'select'));
    }
    check(S, 'no console errors (atlas Volume III ' + openIdx + ')', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ================================================================= (c) Endless: 40 rounds, no repeated layout  [section 4]
async function endless(browser, STD) {
  const S = '4';
  for (const seed of [424242, 20261001]) {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'endless-' + seed, init: [SEED_SEEN] });
    await page.waitForTimeout(900);
    await page.evaluate(s => __peri.loadEndless(s), seed);
    const rows = [], stop = [];
    for (let r = 1; r <= 40; r++) {
      const info = await page.evaluate(() => { const s = __peri.state, l = s.level, rd = v => Math.round(v * 1000) / 1000;
        const sig = JSON.stringify([[rd(l.probe.x), rd(l.probe.y)], [rd(l.target.x), rd(l.target.y), rd(l.target.r)], l.bodies.map(b => [b.kind, rd(b.x), rd(b.y), rd(b.r)])]);
        return { r: s.endless.round, id: l.id, seed: l.seed, name: l.name, d: l.difficulty, nb: l.bodies.length, nf: (l.frags || []).length, sol: !!l.solution, sig, mode: s.mode, screen: s.screen }; });
      rows.push(info);
      const res = await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); const x = __peri.state.result; return { ok: !!(x && x.success), stars: x && x.stars }; });
      rows[rows.length - 1].ok = res.ok && res.stars === 3;
      await page.waitForTimeout(80);
      const nxt = await page.$('#card [data-act="next"]');
      if (!nxt) { stop.push('no Next button after round ' + r); break; }
      await page.evaluate(() => document.querySelector('#card [data-act="next"]').click());
      await page.waitForTimeout(120);
    }
    const sigs = rows.map(x => x.sig), dup = [];
    sigs.forEach((s, i) => { const j = sigs.indexOf(s); if (j !== i) dup.push((j + 1) + '=' + (i + 1)); });
    const quiet = rows.filter(x => x.name === 'Quiet Sky' || x.nb === 0).map(x => x.r);
    const rnd = rows.map(x => x.r), seq = rnd.every((v, i) => v === i + 1);
    check(S, 'endless run seed ' + seed + ': 40 rounds played through the real game loop (solveCurrent, fastForward, tap Next), every round ★3, rounds numbered 1..40', rows.length === 40 && !stop.length && seq && rows.every(x => x.mode === 'endless' && x.sol && x.ok), stop.join('; ') + ' rounds ' + rows.length + ' not-ok ' + rows.filter(x => !x.ok).map(x => x.r).join(','));
    check(S, 'endless run seed ' + seed + ': no two of the 40 rounds share an identical layout (probe, target, every body kind/x/y/r): ' + new Set(sigs).size + ' distinct', new Set(sigs).size === rows.length && !dup.length, 'duplicates (round=round): ' + dup.join(', '));
    check(S, 'endless run seed ' + seed + ': no round is the "Quiet Sky" empty plate (no bodies)', !quiet.length, 'rounds ' + quiet.join(','));
    if (seed === 424242) note('Endless run seed 424242: difficulty ' + rows[0].d + ' → ' + rows[39].d + ', bodies ' + Math.min(...rows.map(x => x.nb)) + '-' + Math.max(...rows.map(x => x.nb)) + ', names distinct ' + new Set(rows.map(x => x.name)).size + '/40.');
    check(S, 'no console errors (endless run ' + seed + ')', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ================================================================= (d) frame budget on the busiest Volume III plates  [section 5]
async function perfV3(browser, STD) {
  const S = '5';
  const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'std-perf-v3', init: [SEED_SEEN] });
  await page.waitForTimeout(1200);
  metrics.perfV3 = {};
  for (const idx of [84, 85, 86, 87, 88, 89]) {   // LXXXV..XC: two pairs plus moons, black holes, repulsors, small targets
    const info = await page.evaluate((i) => { const lv = __peri.Levels.CAMPAIGN[i]; return { i, name: lv.name, plate: lv.plate, bodies: lv.bodies.length, moving: lv.bodies.filter(b => b.orbit).length, worms: lv.bodies.filter(b => b.kind === 'wormhole').length, frags: (lv.frags || []).length }; }, idx);
    await page.evaluate(b => __peri.loadLevel(b.i), info); await page.waitForTimeout(400);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const stats = async (secs, mode) => {
      await page.evaluate(({ b, mode }) => {
        const P = __peri, S = P.state; window.__qaFrames.length = 0;
        const spot = (S.level.frags || []).map(f => ({ x: f.x, y: f.y })), lv = S.level, pairs = [], tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };
        lv.bodies.forEach((b, k) => { if (b.kind === 'wormhole' && b.pair > k) pairs.push([k, b.pair]); });
        window.__flash = () => { const p = pairs[(window.__flashN = (window.__flashN || 0) + 1) % pairs.length], t = S.step * K.DT; P.Physics.bodyPos(lv.bodies[p[0]], t, tmp); P.Physics.bodyPos(lv.bodies[p[1]], t, tmp2); P.Render.warp(tmp.x, tmp.y, tmp2.x, tmp2.y); };
        if (mode === 'aimfx') { if (!P.useHint()) throw new Error('useHint() refused on plate ' + b.plate); }
        const keep = () => {
          if (mode === 'flight') { if (!(S.phase === 'flight' && S.sim && S.sim.status === 'flying')) P.solveCurrent(); }
          else { const sol = S.level.solution, t = performance.now() / 700, vx = sol.vx * (0.9 + 0.1 * Math.sin(t)), vy = sol.vy * (0.9 + 0.1 * Math.cos(t)), dx = -vx / 640 * 300, dy = -vy / 640 * 300, v = P.Physics.launchVelocity(dx, dy);
            Object.assign(S.aim, { active: true, cancel: false, dx, dy, power: v.power, vx: v.vx, vy: v.vy }); S.spotlight = spot.length ? spot : null; }
        };
        keep(); window.__qaKeep = setInterval(keep, 30); window.__qaFlash = setInterval(window.__flash, 300);   // a warp flash at both mouths every 300 ms: at most ~1 live at a time
        window.__qaRec = true;
      }, { b: info, mode });
      await sleep(secs * 1000);
      return page.evaluate(() => {
        window.__qaRec = false; clearInterval(window.__qaKeep); clearInterval(window.__qaFlash);
        const F = window.__qaFrames, sc = [], iv = [];
        for (let k = 0; k < F.length; k += 2) { sc.push(F[k + 1]); if (k) iv.push(F[k] - F[k - 2]); }
        const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }, avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
        const S = __peri.state; S.aim.active = false; S.aim.cancel = true; S.spotlight = null; S.hint.on = false; S.hint.used = false; S.frozen = false;
        return { frames: sc.length, scriptAvg: +avg(sc).toFixed(2), scriptP95: +q(sc, 0.95).toFixed(2), scriptMax: +Math.max(...sc).toFixed(2), intervalAvg: +avg(iv).toFixed(2), intervalP95: +q(iv, 0.95).toFixed(2), periFps: +__peri.fps().toFixed(1), over16: sc.filter(x => x > 16.7).length };
      });
    };
    const fAim = await stats(4, 'aimfx');
    await page.evaluate(b => __peri.loadLevel(b.i), info);
    const fFlight = await stats(4, 'flight');
    const flush = await page.evaluate((b) => {
      const P = __peri, S = P.state, g = document.getElementById('game').getContext('2d'), lv = S.level;
      const spot = (lv.frags || []).map(f => ({ x: f.x, y: f.y })), pairs = [], tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };
      lv.bodies.forEach((k, n) => { if (k.kind === 'wormhole' && k.pair > n) pairs.push([n, k.pair]); });
      const flash = n => { const p = pairs[n % pairs.length], t = S.step * K.DT; P.Physics.bodyPos(lv.bodies[p[0]], t, tmp); P.Physics.bodyPos(lv.bodies[p[1]], t, tmp2); P.Render.warp(tmp.x, tmp.y, tmp2.x, tmp2.y); };
      const run = (mode) => { const out = [];
        for (let k = 0; k < 150; k++) {
          if (mode === 'flight' && !(S.phase === 'flight' && S.sim && S.sim.status === 'flying')) P.solveCurrent();
          if (mode === 'aimfx') { const sol = S.level.solution, dx = -sol.vx / 640 * 300, dy = -sol.vy / 640 * 300, v = P.Physics.launchVelocity(dx, dy); Object.assign(S.aim, { active: true, cancel: false, dx, dy, power: v.power, vx: v.vx, vy: v.vy }); S.spotlight = spot.length ? spot : null; }
          if (k % 12 === 0) flash(k / 12);
          const t0 = performance.now(); P.fastForward(2); P.Render.frame(S, t0); g.getImageData(0, 0, 1, 1); out.push(performance.now() - t0); }
        out.sort((x, y) => x - y); return { avg: +(out.reduce((x, y) => x + y, 0) / out.length).toFixed(2), p95: +out[Math.floor(out.length * 0.95)].toFixed(2), max: +out[out.length - 1].toFixed(2) }; };
      P.loadLevel(b.i); const fl = run('flight');
      P.loadLevel(b.i); if (!P.useHint()) throw new Error('useHint() refused');
      const am = run('aimfx'); S.aim.active = false; S.aim.cancel = true; S.spotlight = null; S.hint.on = false; S.hint.used = false; S.frozen = false;
      return { flight: fl, aim: am };
    }, info);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    metrics.perfV3[idx + 1] = { level: info, aim4x: fAim, flight4x: fFlight, flush4x: flush };
    const tag = 'plate ' + (idx + 1) + ' ' + info.plate + ' (' + info.bodies + ' bodies, ' + info.worms + ' mouths, ' + info.moving + ' moving)';
    check(S, tag + ' aiming + 270-step prediction + astronomer’s line + warp flash every 300 ms @4×: script p95 < 8 ms', fAim.scriptP95 < 8, JSON.stringify(fAim));
    check(S, tag + ' warping flight (stored solution relaunched) + warp flashes @4×: script p95 < 8 ms', fFlight.scriptP95 < 8, JSON.stringify(fFlight));
    check(S, tag + ' __peri.fps() ≥ 55 during aiming and flight @4×', fAim.periFps >= 55 && fFlight.periFps >= 55, 'aim ' + fAim.periFps + ' flight ' + fFlight.periFps);
    check(S, tag + ' raster-inclusive readback proxy @4× with warp flashes (p95 < 16.7 ms)', flush.flight.p95 < 16.7 && flush.aim.p95 < 16.7, JSON.stringify(flush));
  }
  check('1', 'no console errors (Volume III perf session)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================= (e) sound: the silent-switch workaround is gone  [section 19]
async function sound(browser, STD) {
  const S = '19';
  const dist = fs.readFileSync(path.join(DIST, 'perihelion.html'), 'utf8'), art = fs.readFileSync(path.join(DIST, 'perihelion.artifact.html'), 'utf8'), idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const strip = h => h.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
  const forbidden = [['<audio', /<audio\b/i], ['createElement(\'audio\')', /createElement\(\s*['"]audio['"]/], ['new Audio(', /new\s+Audio\s*\(/], ['audioSession', /audioSession/], ['primeSession', /primeSession/], ['data:audio', /data:audio/i], ['audio/wav', /audio\/wav/i], ['<video', /<video\b/i]];
  for (const [name, h] of [['dist/perihelion.html', dist], ['dist/perihelion.artifact.html', art], ['index.html', idx]]) {
    const code = strip(h), hits = forbidden.filter(([, re]) => re.test(code)).map(([n]) => n);
    check(S, 'no keep-alive audio element or audioSession code in ' + name + ' (source scan: ' + forbidden.map(f => f[0]).join(', ') + ')', !hits.length, hits.join(', '));
  }
  const media = `(() => {
    window.__as = []; window.__media = [];
    try { Object.defineProperty(navigator, 'audioSession', { configurable: true, get() { return window.__asv; }, set(v) { window.__as.push(String(v)); window.__asv = v; } }); } catch (e) {}
    const P = HTMLMediaElement.prototype, pl = P.play; P.play = function () { window.__media.push('play:' + this.tagName); return pl.apply(this, arguments); };
    const A = window.Audio; window.Audio = function () { window.__media.push('new Audio'); return new A(...arguments); };
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (/^(AUDIO|VIDEO)$/.test(n.tagName) || (n.querySelector && n.querySelector('audio,video')))) window.__media.push('added:' + n.tagName); }).observe(document, { childList: true, subtree: true });
  })();`;
  const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'sound', init: [media, SEED_SEEN] });
  await page.waitForTimeout(1000);
  const pre = await page.evaluate(() => { const Sd = __peri.Sound; let threw = null; try { Sd.warp(); } catch (e) { threw = String(e); } return { audio: document.querySelectorAll('audio').length, state: Sd.state, hasWarp: typeof Sd.warp === 'function', prime: typeof Sd.primeSession, threw, keys: Object.keys(Sd).join(',') }; });
  check(S, 'before any gesture: no <audio> element, Sound.warp exists and is a safe no-op (AudioContext not created: state "none"), no primeSession on Sound', pre.audio === 0 && pre.hasWarp && pre.state === 'none' && pre.prime === 'undefined' && !pre.threw, JSON.stringify(pre));
  await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
  await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(600);
  const pull = await solutionPull(page); await touchDrag(cdp, 195, 380, 195 + pull.dx, 380 + pull.dy, 12, 150);
  try { await cardOn(page, 15000); } catch (e) {}
  await page.evaluate(() => { __peri.loadLevel(60); __peri.solveCurrent(); __peri.fastForward(1500); }); await page.waitForTimeout(500);
  const post = await page.evaluate(() => { const Sd = __peri.Sound; let threw = null; try { Sd.warp(); Sd.setMuted(true); Sd.warp(); Sd.setMuted(false); } catch (e) { threw = String(e); } return { audio: document.querySelectorAll('audio').length, video: document.querySelectorAll('video').length, state: Sd.state, as: window.__as, media: window.__media, asVal: navigator.audioSession, own: Object.prototype.hasOwnProperty.call(navigator, 'audioSession'), threw }; });
  check(S, 'after real touch gestures, a wormhole flight and Sound.warp (also while muted): the page still has no <audio>/<video> element, no media play() and no new Audio()', post.audio === 0 && post.video === 0 && !post.media.length && !post.threw, JSON.stringify(post));
  check(S, 'no navigator.audioSession assignment (setter trap installed before the page scripts; AudioContext state after the gesture: ' + post.state + ')', post.as.length === 0 && post.asVal === undefined, JSON.stringify({ as: post.as, asVal: post.asVal }));
  check(S, 'the Web Audio context is created by the first real gesture (state ' + post.state + ' is not "none")', post.state !== 'none', post.state);
  check('1', 'no console errors (sound session)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

module.exports = { worm, atlas3, endless, perfV3, sound };
