// Feel-agent browser QA: node tools/feel-test.js   (screens -> qa/feel-*.png)
// NODE_PATH=/home/claude/.npm-global/lib/node_modules node tools/feel-test.js
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('playwright');
const path = require('path');
const build = require('./feel-build.js');
const QA = path.join(__dirname, '..', 'qa'); require('fs').mkdirSync(QA, { recursive: true });
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const LAND = { ...IPHONE, viewport: { width: 844, height: 390 } };

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); }
const shot = (page, n) => page.screenshot({ path: path.join(QA, n) });

async function newPage(browser, opts, init) {
  const ctx = await browser.newContext(opts);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_|net::/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return { ctx, page, errors };
}
async function touchDrag(page, x0, y0, x1, y1, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, id: 1 }] });
    await page.waitForTimeout(16);
  }
  return { cdp, end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) };
}
const cardOn = page => page.waitForFunction(() => document.getElementById('card').classList.contains('on'), null, { timeout: 20000 });
const rectOf = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const inside = (r, W, H, m = 0) => r && r.l >= m && r.t >= m && r.r <= W - m && r.b <= H - m;
const text = (page, sel) => page.evaluate(s => document.querySelector(s).innerText.replace(/\s+/g, ' ').trim(), sel);
const SEEN_ALL = () => { try { Save.markSeen('intro'); Save.markSeen('fragments'); Save.markSeen('wormholes'); } catch (e) {} };
const FX = require('./fixtures-wormhole.json');          // three complete wormhole plates with verified solutions (fw1, fw2, fw3)
// Date stub: window.__dayOffset shifts "now" by whole days
const DATE_STUB = () => {
  const R = Date; window.__dayOffset = 0;
  class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + window.__dayOffset * 86400000); } static now() { return R.now() + window.__dayOffset * 86400000; } }
  window.Date = D;
};

(async () => {
  const { file, levels } = build();
  const url = 'file://' + file;
  console.log('testing', url, 'levels', levels);
  const browser = await chromium.launch();
  const info = await (async () => { const { ctx, page } = await newPage(browser, IPHONE); await page.goto(url); await page.waitForTimeout(300);
    const r = await page.evaluate(() => { const C = __peri.Levels.CAMPAIGN; return { n: C.length, frag: C.findIndex(l => l.frags && l.frags.length), moving: C.findIndex(l => l.bodies.some(b => b.orbit)), vols: (__peri.Levels.VOLUMES || []).length, hasDaily: typeof __peri.Levels.daily === 'function' }; });
    await ctx.close(); return r; })();
  console.log('level info', JSON.stringify(info));
  // While the baked Volume III is missing (CAMPAIGN < 90), a copy of the page gets 30 stand-in plates (the fixtures, cycled) so the
  // 90-plate behaviour can be tested now. With the real plates in place the stand-in is not used.
  const STUB = levels < 90;
  let url3 = url;
  if (STUB) {
    const fs = require('fs'), html = fs.readFileSync(file, 'utf8'), mark = '// ===================== MODULE: 30-render.js';
    if (html.indexOf(mark) < 0) throw new Error('module marker not found');
    const snip = '(function () { var C = Levels.CAMPAIGN, FX = ' + JSON.stringify(FX) + ';\n' +
      'for (var i = C.length; i < 90; i++) { var f = JSON.parse(JSON.stringify(FX[i % 3])); f.id = "c" + (i + 1); f.index = i; f.plate = toRoman(i + 1); f.name = "Stand-in Gate " + toRoman(i + 1); f.difficulty = 1.7 + i * 0.01; C.push(f); }\n' +
      'var V = Levels.VOLUMES; if (V.length < 3) V.push({ name: "Volume III", from: 60, to: 89 }); })();\n';
    const out = path.join(QA, 'feel-vol3.html');
    fs.writeFileSync(out, html.replace(mark, snip + mark));
    url3 = 'file://' + out;
    console.log('stand-in Volume III page', out);
  }
  const atlasTargets = [{ url, stub: false }].concat(STUB ? [{ url: url3, stub: true }] : []);

  // ---------------------------------------------------------------- main iPhone run
  {
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url);
    await page.waitForTimeout(700);
    check('hooks present', await page.evaluate(() => !!(window.__peri && __peri.state && __peri.loadLevel && __peri.solveCurrent && __peri.openCard && __peri.closeCard && __peri.useHint && __peri.loadDaily && __peri.Log && __peri.LogUI && __peri.Save)));
    check('title screen', await page.evaluate(() => __peri.state.screen === 'title'));

    // ---- title layout with Daily
    const tt = await page.evaluate(() => ({ daily: document.querySelector('[data-act="daily"]').innerText.replace(/\s+/g, ' '), log: !!document.querySelector('[data-act="log"]'), snd: !!document.querySelector('#scr-title [data-sound]') }));
    check('title: Daily Plate button + subline, Observer\'s Log, Sound', /Daily Plate/i.test(tt.daily) && /Today.s plate/.test(tt.daily) && tt.log && tt.snd, tt.daily);
    const tr = await page.evaluate(() => [...document.querySelectorAll('#scr-title button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), Math.round(r.height)]; }));
    check('title 390x844: all buttons inside viewport, >=44px', tr.length === 5 && tr.every(r => r[0] >= 0 && r[2] <= 390 && r[1] >= 0 && r[3] <= 844 && r[4] >= 44), JSON.stringify(tr));
    await shot(page, 'feel-title.png');

    // ---- atlas (structure checked in detail in a separate run)
    await page.tap('[data-act="begin"]');
    await page.waitForTimeout(450);
    check('select via tap', await page.evaluate(() => __peri.state.screen === 'select'));
    const nCards = await page.$$eval('.plate', b => b.length);
    check('plate cards = campaign length', nCards === levels, nCards + ' cards');
    await shot(page, 'feel-select.png');
    if (nCards > 1) { await page.tap('.plate[data-i="1"]', { force: true }); await page.waitForTimeout(100); check('locked plate ignored', await page.evaluate(() => __peri.state.screen === 'select')); }

    // ---- intro card on the first plate
    await page.tap('.plate[data-i="0"]');
    await page.waitForTimeout(500);
    check('play plate I via tap', await page.evaluate(() => __peri.state.screen === 'play' && __peri.state.levelIndex === 0 && __peri.state.phase === 'aim'));
    const ic = await page.evaluate(() => ({ card: __peri.state.card, on: document.getElementById('pcard').classList.contains('on'), t: document.getElementById('pcard').innerText.replace(/\s+/g, ' '),
      li: document.querySelectorAll('#pcard .steps li').length, step: __peri.state.step, seen: __peri.Save.seen('intro'), hint: document.getElementById('hint').classList.contains('on') }));
    check('intro card opens on the first plate load', ic.card === 'intro' && ic.on && /To Observe/i.test(ic.t) && ic.li === 4 && /Begin/.test(ic.t) && /Instructions/i.test(ic.t) && !ic.seen, JSON.stringify({ card: ic.card, li: ic.li }));
    check('marginal hint hidden while the intro card is open', !ic.hint);
    const icr = await rectOf(page, '#pcard');
    check('intro card inside the 390x844 viewport', inside(icr, 390, 844, 6), JSON.stringify(icr));
    await shot(page, 'feel-card-intro.png');
    // aiming blocked: drag on canvas above the card
    const dBlocked = await touchDrag(page, 200, 90, 150, 200);
    const ab = await page.evaluate(() => ({ active: __peri.state.aim.active, n: __peri.state.predict.n }));
    await dBlocked.end(); await page.waitForTimeout(60);
    check('aiming blocked while a card is open', !ab.active && ab.n === 0 && await page.evaluate(() => __peri.state.launches === 0));
    const s1 = await page.evaluate(() => __peri.state.step); await page.waitForTimeout(400);
    check('clock held while a card is open', await page.evaluate(s => __peri.state.step === s, s1), 'step ' + s1);
    await page.tap('#pcard [data-act="pop-ok"]');
    await page.waitForTimeout(400);
    const dz = await page.evaluate(() => ({ card: __peri.state.card, on: document.getElementById('pcard').classList.contains('on'), seen: __peri.Save.seen('intro'), saved: JSON.parse(localStorage.getItem('perihelion.v1')).seen }));
    check('Begin dismisses and persists', dz.card === null && !dz.on && dz.seen && dz.saved.intro === true, JSON.stringify(dz));
    const s2 = await page.evaluate(() => __peri.state.step); await page.waitForTimeout(300);
    check('clock runs after dismiss', await page.evaluate(s => __peri.state.step > s, s2));
    check('HUD buttons enabled after dismiss', await page.evaluate(() => getComputedStyle(document.querySelector('#zone-l .btn')).pointerEvents === 'auto'));

    const lay = await page.evaluate(() => { const L = __peri.Render.layout; const r = document.querySelector('#zone-l .btn').getBoundingClientRect(), q = document.querySelector('#zone-r .btn').getBoundingClientRect();
      return { b: L.bottom, l: [r.left, r.top, r.width, r.height], r: [q.left, q.top, q.width, q.height], w: L.w }; });
    const inZone = (e, left) => e[1] >= lay.b.y - 1 && e[1] + e[3] <= lay.b.y + lay.b.h + 1 && e[3] >= 44 &&
      (left ? e[0] >= 0 && e[0] + e[2] <= lay.b.x + lay.b.w * 0.25 + 1 : e[0] >= lay.b.x + lay.b.w * 0.75 - 1 && e[0] + e[2] <= lay.w);
    check('HUD buttons inside bottom 25% zones, >=44px', inZone(lay.l, true) && inZone(lay.r, false), JSON.stringify(lay));

    // drag-launch with real touch events
    const d = await touchDrag(page, 200, 420, 150, 560);
    await page.waitForTimeout(60);
    const aim = await page.evaluate(() => ({ ...__peri.state.aim, n: __peri.state.predict.n }));
    check('aiming via touch drag', aim.active && !aim.cancel && aim.n > 10 && aim.dy > 0, JSON.stringify(aim));
    const PS = await page.evaluate(() => ({ k: K.PREDICT_STEPS, buf: __peri.state.predict.pts.length }));
    check('prediction is the short stub (<= K.PREDICT_STEPS = 270), buffer sized from K', PS.k === 270 && aim.n <= PS.k && PS.buf === PS.k * 2, 'n=' + aim.n + ' K=' + PS.k + ' buf=' + PS.buf);
    await shot(page, 'feel-aim.png');
    await d.end();
    await page.waitForTimeout(80);
    const fl = await page.evaluate(() => ({ phase: __peri.state.phase, launches: __peri.state.launches, vy: __peri.state.sim && __peri.state.sim.vy }));
    check('touch release launches', fl.launches === 1 && (fl.phase === 'flight' || fl.phase === 'result') && fl.vy < 0, JSON.stringify(fl));
    await page.waitForTimeout(500);
    await shot(page, 'feel-flight.png');

    // cancel / multitouch
    await page.evaluate(() => __peri.loadLevel(0));
    const d2 = await touchDrag(page, 200, 400, 205, 410, 3); await d2.end(); await page.waitForTimeout(50);
    check('short pull cancels', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.phase === 'aim'));
    {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400, id: 1 }, { x: 300, y: 300, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400, id: 1 }, { x: 330, y: 500, id: 2 }] });
      const a = await page.evaluate(() => ({ ...__peri.state.aim }));
      check('second finger ignored', a.active && Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1, JSON.stringify(a));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }

    // ---- fragment card
    const F = info.frag;
    await page.evaluate(i => __peri.loadLevel(i), F);
    await page.waitForTimeout(500);
    const fc = await page.evaluate(() => { const s = __peri.state, lv = s.level; return { card: s.card, sp: s.spotlight && s.spotlight.map(p => [p.x, p.y]), fr: lv.frags.map(p => [p.x, p.y]), t: document.getElementById('pcard').innerText.replace(/\s+/g, ' ') }; });
    check('fragment card opens on the first plate with fragments (plate ' + (F + 1) + ')', fc.card === 'fragments' && /Comet Fragments/i.test(fc.t) && /Understood/.test(fc.t) && /Notice/i.test(fc.t), fc.card);
    check('spotlight = fragment positions', fc.sp && JSON.stringify(fc.sp) === JSON.stringify(fc.fr), JSON.stringify(fc.sp));
    const fr = await rectOf(page, '#pcard');
    const cy = await page.evaluate(() => { const f = __peri.state.level.frags; let y = 0; f.forEach(p => y += __peri.Render.worldToScreen(p.x, p.y).y); return y / f.length; });
    const away = cy < 422 ? fr.t >= 422 - 2 : fr.b <= 422 + 2;
    check('fragment card sits on the half away from the comets', inside(fr, 390, 844, 6) && away, JSON.stringify({ card: fr, centroidY: Math.round(cy) }));
    await shot(page, 'feel-card-fragments.png');
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(400);
    check('fragment card dismiss clears spotlight and persists', await page.evaluate(() => __peri.state.card === null && __peri.state.spotlight === null && __peri.Save.seen('fragments') && JSON.parse(localStorage.getItem('perihelion.v1')).seen.fragments === true));
    await page.evaluate(i => __peri.loadLevel(i), F); await page.waitForTimeout(300);
    check('fragment card does not repeat', await page.evaluate(() => __peri.state.card === null));

    // ---- Menu sheet & reopening cards
    await page.tap('#zone-r .btn'); await page.waitForTimeout(400);
    const order = await page.evaluate(() => [...document.querySelectorAll('#sheet .c-btns .btn, #sheet [data-sound]')].filter(b => b.offsetParent !== null).map(b => b.innerText.replace(/\s+/g, ' ').trim()));
    check('menu sheet order', JSON.stringify(order) === JSON.stringify(['Resume', 'Consult the Astronomer', 'How to play', 'About comet fragments', 'Restart plate', 'Return to the Atlas', 'Sound: On']), JSON.stringify(order));
    check('astronomer note text', /Costs one star\. Holds the heavens and shows the course that gathers the comets and reaches the ring/.test(await text(page, '#sheet-hint-note')));
    const sh = await page.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)]; }));
    const pr = await rectOf(page, '#sheet-panel');
    check('menu sheet inside viewport, targets >=44px', inside(pr, 390, 844, 4) && sh.every(r => r[2] >= 44), JSON.stringify(pr));
    await shot(page, 'feel-menu.png');
    await page.tap('#sheet [data-act="howto"]'); await page.waitForTimeout(400);
    const hw = await page.evaluate(() => ({ card: __peri.state.card, paused: __peri.state.paused, on: document.getElementById('pcard').classList.contains('on'), t: document.getElementById('pcard').innerText }));
    check('How to play reopens the intro card from the sheet', hw.card === 'intro' && hw.paused && hw.on && /To Observe/i.test(hw.t));
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(350);
    check('dismiss returns to the paused sheet', await page.evaluate(() => __peri.state.card === null && __peri.state.paused && document.getElementById('sheet').classList.contains('on') && !document.getElementById('sheet').classList.contains('sub')));
    await page.tap('#sheet [data-act="fragments"]'); await page.waitForTimeout(400);
    const af = await page.evaluate(() => ({ card: __peri.state.card, sp: !!__peri.state.spotlight }));
    check('About comet fragments reopens the fragment card (spotlight set)', af.card === 'fragments' && af.sp);
    await shot(page, 'feel-card-fragments-menu.png');
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(350);
    await page.tap('#sheet [data-act="resume"]'); await page.waitForTimeout(200);
    check('resume after cards', await page.evaluate(() => !__peri.state.paused && !__peri.state.card));

    // ---- a card never appears during flight or over a result card: it queues
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(200);
    await page.evaluate(() => __peri.closeCard());
    await page.evaluate(() => __peri.launch(0, 200));
    const q1 = await page.evaluate(() => ({ r: __peri.openCard('fragments'), card: __peri.state.card, ph: __peri.state.phase }));
    check('openCard during flight is queued', q1.r === 'queued' && q1.card === null && q1.ph === 'flight', JSON.stringify(q1));
    await page.evaluate(() => { const s = __peri.state; while (s.sim && s.sim.status === 'flying') __peri.fastForward(1); __peri.fastForward(80); });
    check('queued card opens once the probe is back in aim', await page.evaluate(() => __peri.state.card === 'fragments' && __peri.state.phase === 'aim'));
    await page.evaluate(() => __peri.closeCard());
    await page.evaluate(() => { __peri.loadLevel(0); __peri.solveCurrent(); __peri.fastForward(1500); });
    await cardOn(page);
    const q2 = await page.evaluate(() => ({ r: __peri.openCard('intro'), card: __peri.state.card }));
    check('openCard over a result card is queued', q2.r === 'queued' && q2.card === null, JSON.stringify(q2));
    await page.tap('#card [data-act="replay"]'); await page.waitForTimeout(400);
    check('queued card shows after the result card is dismissed', await page.evaluate(() => __peri.state.card === 'intro' && !document.getElementById('card').classList.contains('on')));
    await page.evaluate(() => __peri.closeCard());

    // ---- solveCurrent on every plate
    for (let i = 0; i < levels; i++) {
      await page.evaluate(i => { __peri.loadLevel(i); }, i);
      const t0 = Date.now();
      const sol = await page.evaluate(() => __peri.solveCurrent());
      if (!sol) { check('solveCurrent plate ' + (i + 1), false, 'no solution'); continue; }
      if (i > 2) await page.evaluate(() => __peri.fastForward(1500));
      try { await cardOn(page); } catch (e) {}
      const r = await page.evaluate(() => ({ res: __peri.state.result && { s: __peri.state.result.success, st: __peri.state.result.stars }, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
      check('solveCurrent plate ' + (i + 1) + ' -> 3-star success card', r.res && r.res.s && r.res.st === 3 && /Sealed|Surveyed/.test(r.card), (Date.now() - t0) + 'ms');
      if (i === 0) {
        await page.waitForTimeout(400);
        const cr = await page.evaluate(() => { const r = document.getElementById('card').getBoundingClientRect(), L = __peri.Render.layout, lv = __peri.state.level;
          const t = __peri.Render.worldToScreen(lv.target.x, lv.target.y + lv.target.r);
          return { r: [r.left, r.top, r.right, r.bottom, r.height], ty: t.y, pb: L.plate.y + L.plate.h }; });
        check('portrait card compact, in lower plate, clear of target', cr.r[4] <= 232 && cr.r[0] >= 0 && cr.r[2] <= 390 && cr.r[3] <= cr.pb && cr.r[1] > cr.ty + 20, JSON.stringify(cr));
        await shot(page, 'feel-success.png');
      }
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('perihelion.v1')));
    check('progress saved', saved && saved.stars[0] === 3 && saved.unlocked >= Math.min(levels + 1, 90), JSON.stringify(saved && { s: saved.stars.slice(0, 4), u: saved.unlocked }));

    await page.evaluate(() => { __peri.loadLevel(0); __peri.solveCurrent(); });
    await cardOn(page);
    await page.tap('#card [data-act="next"]');
    await page.waitForTimeout(200);
    check('Next plate button', await page.evaluate(() => __peri.state.levelIndex === 1 && __peri.state.phase === 'aim'));

    // ---- fail flow
    await page.evaluate(() => __peri.loadLevel(0));
    for (let k = 0; k < 3; k++) await page.evaluate(() => { __peri.launch(0, 640); __peri.fastForward(1300); });
    const fs1 = await page.evaluate(() => ({ ph: __peri.state.phase, l: __peri.state.launches, g: __peri.state.ghosts.length, r: __peri.state.result }));
    check('3 misses -> result fail', fs1.ph === 'result' && fs1.l === 3 && fs1.r && fs1.r.success === false && fs1.g === 2, JSON.stringify({ ph: fs1.ph, l: fs1.l, g: fs1.g }));
    try { await cardOn(page); } catch (e) {}
    check('fail card shown', /Retry plate/i.test(await text(page, '#card')));
    await shot(page, 'feel-fail.png');
    await page.tap('#card [data-act="retry"]'); await page.waitForTimeout(150);
    check('Retry resets attempt', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.phase === 'aim' && __peri.state.ghosts.length === 0));
    await page.evaluate(() => __peri.launch(0, 640));
    await page.waitForFunction(() => __peri.state.phase === 'aim', null, { timeout: 12000 }).catch(() => {});
    check('probe resets after miss', await page.evaluate(() => __peri.state.phase === 'aim' && __peri.state.launches === 1 && __peri.state.ghosts.length === 1));

    // pause / resume / visibility / Reset
    await page.tap('#zone-r .btn'); await page.waitForTimeout(350);
    const st0 = await page.evaluate(() => __peri.state.step);
    await page.waitForTimeout(300);
    check('Menu opens pause sheet; time frozen', await page.evaluate(s => __peri.state.paused && __peri.state.step === s && document.getElementById('sheet').classList.contains('on'), st0));
    await page.tap('#sheet [data-act="resume"]'); await page.waitForTimeout(150);
    check('resume', await page.evaluate(() => !__peri.state.paused));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    check('visibilitychange pauses', await page.evaluate(() => __peri.state.paused));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(450);   // (double-tap-zoom guard swallows a second tap within 350 ms)
    await page.touchscreen.tap(195, 40);
    await page.waitForTimeout(100);
    check('tap-to-resume', await page.evaluate(() => !__peri.state.paused));
    await page.tap('#zone-l .btn'); await page.waitForTimeout(80);
    check('Reset button restarts attempt', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.ghosts.length === 0));

    // ---- endless
    await page.evaluate(() => __peri.screen('title')); await page.waitForTimeout(350);
    await page.tap('[data-act="endless"]'); await page.waitForTimeout(400);
    const en = await page.evaluate(() => ({ m: __peri.state.mode, s: __peri.state.screen, r: __peri.state.endless.round, plate: __peri.state.level.plate }));
    check('endless starts', en.m === 'endless' && en.s === 'play' && en.r === 1 && en.plate === 'I', JSON.stringify(en));
    await page.evaluate(() => __peri.solveCurrent());
    await cardOn(page).catch(() => {});
    const en2 = await page.evaluate(() => ({ sc: __peri.state.endless.score, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
    check('endless round scored', en2.sc === 3 && /Next plate/.test(en2.card), JSON.stringify(en2));
    await page.tap('#card [data-act="next"]'); await page.waitForTimeout(150);
    check('endless round 2', await page.evaluate(() => __peri.state.endless.round === 2 && __peri.state.level.plate === 'II'));
    for (let k = 0; k < 3; k++) await page.evaluate(() => { __peri.launch(0, 640); __peri.fastForward(1300); });
    await cardOn(page).catch(() => {});
    const en3 = await page.evaluate(() => ({ best: JSON.parse(localStorage.getItem('perihelion.v1')).endlessBest, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
    check('endless run ends on failed round, best saved', en3.best === 3 && /Concluded/.test(en3.card), JSON.stringify(en3));

    await page.evaluate(() => __peri.screen('title')); await page.waitForTimeout(300);
    await page.tap('#scr-title [data-act="sound"]');
    const mu = await page.evaluate(() => ({ t: document.querySelector('#scr-title [data-sound]').textContent, s: JSON.parse(localStorage.getItem('perihelion.v1')).muted }));
    check('mute toggle persists', mu.t === 'Sound: Off' && mu.s === true, JSON.stringify(mu));
    await page.tap('#scr-title [data-act="sound"]');

    // Observer's Log button returns to the title
    await page.tap('#scr-title [data-act="log"]'); await page.waitForTimeout(300);
    check('Observer\'s Log button calls LogUI.open and the title stays/returns', await page.evaluate(() => __peri.state.screen === 'title'));

    // reload keeps progress and the seen flags
    await page.reload(); await page.waitForTimeout(1200);
    const rl = await page.evaluate(() => ({ u: __peri.Save.data.unlocked, fps: __peri.fps(), intro: __peri.Save.seen('intro'), fr: __peri.Save.seen('fragments') }));
    check('reload keeps progress and seen flags', rl.u >= 2 && rl.intro && rl.fr, JSON.stringify(rl));
    check('fps hook', rl.fps > 20, rl.fps.toFixed(1));
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(400);
    check('intro does not reappear after reload', await page.evaluate(() => __peri.state.card === null));
    check('no console errors (iPhone run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- hint (Consult the Astronomer) + Log wiring
  {
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url); await page.waitForTimeout(600);
    await page.evaluate(SEEN_ALL);
    await page.evaluate(() => { window.__ev = []; const o = __peri.Log.event; __peri.Log.event = function (n, d) { window.__ev.push({ n, mode: d && d.mode, st: d && (d.status || d.stars), launchNo: d && d.launchNo, hintUsed: d && d.hintUsed, idx: d && d.plateIndex, streak: d && d.streak, round: d && d.round, sim: !!(d && d.sim) }); return o.apply(this, arguments); }; });
    const M = info.moving >= 0 ? info.moving : 0;
    await page.evaluate(i => __peri.loadLevel(i), M); await page.waitForTimeout(500);
    const sBefore = await page.evaluate(() => __peri.state.step);
    check('hint: heavens move before the hint (moving plate ' + (M + 1) + ')', await page.evaluate(() => __peri.state.step > 0) || info.moving < 0, 'step ' + sBefore);
    // enabled during aim
    await page.tap('#zone-r .btn'); await page.waitForTimeout(350);
    check('hint item enabled during aim', await page.evaluate(() => document.getElementById('sheet-hint').getAttribute('aria-disabled') === 'false'));
    await page.tap('#sheet-hint'); await page.waitForTimeout(400);
    const h1 = await page.evaluate(() => { const s = __peri.state, sol = __peri.Levels.clearFor(s.level) || s.level.solution; return { paused: s.paused, on: s.hint.on, used: s.hint.used, frozen: s.frozen, n: s.hint.n, step: s.step, t0: sol.t0Step || 0, ptsLen: s.hint.pts.length, first: [s.hint.pts[0], s.hint.pts[1]], sheet: document.getElementById('sheet').classList.contains('on') }; });
    check('hint used: sheet closed, frozen at t0, line stored', !h1.paused && !h1.sheet && h1.on && h1.used && h1.frozen && h1.step === h1.t0 && h1.n > 20 && h1.n <= 1100 && h1.ptsLen === 2200, JSON.stringify(h1));
    const expectN = await page.evaluate(() => { const s = __peri.state, sol = __peri.Levels.clearFor(s.level) || s.level.solution, P = __peri.Physics, sim = P.createSim(s.level, sol.vx, sol.vy, sol.t0Step | 0); let tot = 0, got = 0, last = 0, w = 0, lw = 0; while (sim.status === 'flying' && sim.step < 1200) { P.stepSim(sim, s.level); tot++; const c = sim.collected.reduce((a, b) => a + b, 0); if (c > got) { got = c; last = tot; } if (sim.warps > w) { w = sim.warps; lw = tot; } } let n = Math.floor(0.55 * tot); if (got) n = Math.max(n, Math.min(last + 24, Math.floor(0.92 * tot))); if (w) n = Math.max(n, Math.min(lw + 24, Math.floor(0.92 * tot))); return Math.min(1100, n); });
    check('hint length = 55% of the course, or on to the last fragment, <= HINT_MAX', h1.n === expectN, h1.n + ' vs ' + expectN);
    await page.waitForTimeout(400);
    check('hint: heavens held while aiming', await page.evaluate(t0 => __peri.state.step === t0, h1.t0));
    const d = await touchDrag(page, 200, 420, 190, 470); await page.waitForTimeout(80);
    check('hint: aiming works while frozen and step stays', await page.evaluate(t0 => __peri.state.aim.active && __peri.state.step === t0, h1.t0));
    await shot(page, 'feel-hint.png');
    await d.end(); await page.waitForTimeout(50);
    // that pull was tiny/possibly a launch; reset the attempt to keep the test deterministic
    await page.evaluate(() => __peri.loadLevel(__peri.state.levelIndex));
    check('Reset/reload clears hint.used, frozen, on', await page.evaluate(() => { const h = __peri.state.hint; return !h.used && !h.on && !__peri.state.frozen; }));

    // full-clear courses: on every plate with fragments, the astronomer's course, flown in the real game loop, gathers every comet and seals the plate
    {
      const res = await page.evaluate(() => {
        const out = [], C = __peri.Levels.CAMPAIGN;
        for (let i = 0; i < C.length; i++) {
          const nf = C[i].frags ? C[i].frags.length : 0; if (!nf) continue;
          __peri.Save.reset(); __peri.loadLevel(i); __peri.useHint();
          const c = __peri.Levels.clearFor(__peri.state.level);
          if (!c) { if (i >= 60) { out.push(['skip', i + 1]); continue; } out.push([i + 1, 'no course']); continue; }   // Volume III courses are baked by the lead's levels-clear run
          __peri.launch(c.vx, c.vy); __peri.fastForward(1500);
          const d = __peri.Save.data; if (d.frags[i] !== nf || d.stars[i] !== 2) out.push([i + 1, 'frags ' + d.frags[i] + '/' + nf + ' stars ' + d.stars[i]]);
        }
        return out;
      });
      const miss = res.filter(r => r[0] === 'skip').map(r => r[1]), bad = res.filter(r => r[0] !== 'skip');
      if (miss.length) console.log('  note: no full-clear course baked yet for ' + miss.length + ' Volume III plates (not checked)');
      check('full-clear course in the live game: every fragment + seal at 2 stars (hint used), every fragment plate that has a baked course', bad.length === 0, JSON.stringify(bad));
      await page.evaluate(i => { __peri.Save.reset(); __peri.loadLevel(i); }, M); await page.waitForTimeout(300);
    }
    // disable rules
    await page.evaluate(() => __peri.useHint());
    await page.tap('#zone-r .btn'); await page.waitForTimeout(350);
    check('hint item disabled once used (one per attempt)', await page.evaluate(() => document.getElementById('sheet-hint').getAttribute('aria-disabled') === 'true'));
    await page.tap('#sheet-hint', { force: true }); await page.waitForTimeout(150);
    check('tapping a disabled hint item keeps the sheet open', await page.evaluate(() => __peri.state.paused));
    await page.tap('#sheet [data-act="resume"]'); await page.waitForTimeout(150);

    // star rule: one-launch hinted win = 2 stars; forfeited line
    await page.evaluate(() => { window.__ev.length = 0; __peri.loadLevel(__peri.state.levelIndex); __peri.useHint(); __peri.solveCurrent(); __peri.fastForward(1500); });
    await cardOn(page);
    const w2 = await page.evaluate(() => ({ st: __peri.state.result.stars, hu: __peri.state.result.hintUsed, card: document.getElementById('card').innerText.replace(/\s+/g, ' '), fz: __peri.state.frozen, on: __peri.state.hint.on, used: __peri.state.hint.used, saved: __peri.Save.data.stars[__peri.state.levelIndex] }));
    check('one-launch hinted win = 2 stars', w2.st === 2 && w2.saved >= 2 && !w2.fz && !w2.on && w2.used, JSON.stringify({ st: w2.st, fz: w2.fz, on: w2.on }));
    check('result card notes the forfeited star', /Astronomer consulted: one star forfeited/.test(w2.card), w2.card);
    await shot(page, 'feel-hint-result.png');
    const ev = await page.evaluate(() => window.__ev);
    const names = ev.map(e => e.n);
    check('Log events: hint, launch, flightEnd, plateSealed in order', JSON.stringify(names) === JSON.stringify(['hint', 'launch', 'flightEnd', 'plateSealed']), JSON.stringify(names));
    const sealed = ev.find(e => e.n === 'plateSealed'), fe = ev.find(e => e.n === 'flightEnd');
    check('Log payloads: plateSealed idx/stars/hintUsed, flightEnd hit + sim', sealed && sealed.idx === M && sealed.st === 2 && sealed.hintUsed === true && sealed.mode === 'campaign' && fe.st === 'hit' && fe.sim, JSON.stringify({ sealed, fe }));
    // Reset clears the star penalty
    await page.tap('#card [data-act="replay"]'); await page.waitForTimeout(150);
    check('Replay (new attempt) clears hint.used', await page.evaluate(() => !__peri.state.hint.used));

    // 3 launches + hint -> 1 star
    await page.evaluate(() => { __peri.loadLevel(__peri.state.levelIndex); __peri.launch(0, 640); const s = __peri.state; while (s.sim && s.sim.status === 'flying') __peri.fastForward(1); __peri.fastForward(80); __peri.launch(0, 640); while (s.sim && s.sim.status === 'flying') __peri.fastForward(1); __peri.fastForward(80); });
    const uh = await page.evaluate(() => __peri.useHint());
    await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); });
    check('third launch + hint = 1 star (floor)', uh && await page.evaluate(() => __peri.state.result && __peri.state.result.success && __peri.state.result.stars === 1), 'hint ok ' + uh);

    // timers keep running while frozen: the "launches remain" note clears itself
    await page.evaluate(() => { __peri.loadLevel(__peri.state.levelIndex); __peri.launch(0, 640); const s = __peri.state; while (s.sim && s.sim.status === 'flying') __peri.fastForward(1); __peri.fastForward(80); __peri.useHint(); });
    const noteOn = await page.evaluate(() => document.getElementById('note').classList.contains('on'));
    await page.waitForTimeout(2600);
    check('step-timers do not stall while frozen (note clears)', noteOn && await page.evaluate(() => __peri.state.frozen && !document.getElementById('note').classList.contains('on')), 'noteOn ' + noteOn);
    // not during flight
    await page.evaluate(() => { __peri.loadLevel(__peri.state.levelIndex); __peri.launch(0, 100); });
    check('hint disabled during flight', await page.evaluate(() => __peri.useHint() === false));

    // Log: launch / flightEnd on a miss
    await page.evaluate(() => { window.__ev.length = 0; __peri.loadLevel(0); __peri.launch(0, 640); __peri.fastForward(1300); });
    const ev2 = (await page.evaluate(() => window.__ev)).map(e => e.n + ':' + (e.st || e.launchNo));
    check('Log: a miss emits launch + flightEnd(status) and no plateSealed', ev2.length === 2 && ev2[0] === 'launch:1' && /^flightEnd:(lost|timeout|crash|captured)$/.test(ev2[1]), JSON.stringify(ev2));
    // endless round events
    await page.evaluate(() => { window.__ev.length = 0; __peri.loadEndless(7); __peri.solveCurrent(); __peri.fastForward(1500); });
    const ev3 = (await page.evaluate(() => window.__ev)).map(e => e.n + (e.n === 'plateSealed' ? ':' + e.idx + ':' + e.mode : ''));
    check('Log: endless emits plateSealed(-1) then endlessRound', JSON.stringify(ev3.slice(-2)) === JSON.stringify(['plateSealed:-1:endless', 'endlessRound']), JSON.stringify(ev3));
    check('no console errors (hint run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- Daily Plate (Date stubbed)
  {
    const { ctx, page, errors } = await newPage(browser, IPHONE, DATE_STUB);
    await page.goto(url); await page.waitForTimeout(600);
    await page.evaluate(SEEN_ALL);
    await page.evaluate(() => { window.__ev = []; const o = __peri.Log.event; __peri.Log.event = function (n, d) { window.__ev.push({ n, d: d && { key: d.key, stars: d.stars, streak: d.streak, first: d.first, mode: d.mode, idx: d.plateIndex } }); return o.apply(this, arguments); }; });
    const key0 = await page.evaluate(() => __peri.Save.dateKey());
    check('daily subline: not sealed', /Today.s plate/.test(await text(page, '#t-daily')), await text(page, '#t-daily'));
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__cachedDaily = __peri.dailyPlate(); });
    check('daily plate precomputed in idle time on the title screen', await page.evaluate(() => !!window.__cachedDaily && window.__cachedDaily.id === 'd' + __peri.Save.dateKey()));
    await page.tap('[data-act="daily"]'); await page.waitForTimeout(500);
    check('tapping Daily Plate uses the cached level object', await page.evaluate(() => __peri.state.level === window.__cachedDaily));
    const dl = await page.evaluate(() => { const s = __peri.state; return { mode: s.mode, daily: s.daily, id: s.level.id, cap: s.level.caption, plate: s.level.plate, sol: !!s.level.solution, screen: s.screen, card: s.card, kick: document.getElementById('sheet-kicker').innerText }; });
    check('Daily Plate loads: mode/daily/level id/caption', dl.mode === 'daily' && dl.daily && dl.daily.key === key0 && dl.id === 'd' + key0 && /^DAILY/.test(dl.cap) && dl.plate === 'DAILY' && dl.screen === 'play', JSON.stringify(dl));
    check('daily label like "30 SEP 2026"', dl.daily && /^\d{1,2} [A-Z]{3} \d{4}$/.test(dl.daily.label) && dl.cap.indexOf(dl.daily.label) >= 0, dl.daily && dl.daily.label + ' / ' + dl.cap);
    await shot(page, 'feel-daily-play.png');
    // fail card first
    for (let k = 0; k < 3; k++) await page.evaluate(() => { __peri.launch(0, 640); __peri.fastForward(1300); });
    await cardOn(page).catch(() => {});
    const dfail = await text(page, '#card');
    check('daily fail card: Retry plate / Menu', /Retry plate/i.test(dfail) && /Menu/i.test(dfail) && !/Next/i.test(dfail), dfail);
    await page.tap('#card [data-act="retry"]'); await page.waitForTimeout(150);
    check('daily retry resets attempt', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.mode === 'daily'));
    await page.evaluate(() => { window.__ev.length = 0; __peri.solveCurrent(); __peri.fastForward(1500); });
    await cardOn(page);
    const dw = await page.evaluate(() => ({ card: document.getElementById('card').innerText.replace(/\s+/g, ' '), btns: [...document.querySelectorAll('#card .btn')].map(b => b.innerText.trim()), st: __peri.state.result.stars, sv: __peri.Save.data.daily, ev: window.__ev.map(e => e.n) }));
    check('daily success card: streak line, engraved tomorrow, Replay/Menu only', /A new plate is engraved tomorrow\./.test(dw.card) && /Streak 1/i.test(dw.card) && JSON.stringify(dw.btns.map(s => s.toLowerCase())) === '["replay","menu"]', dw.card + ' ' + JSON.stringify(dw.btns));
    check('daily recorded (Save.recordDaily) + Log daily event', dw.sv.last === key0 && dw.sv.streak === 1 && dw.sv.done[key0] === dw.st && dw.ev.join() === 'launch,flightEnd,plateSealed,daily', JSON.stringify({ last: dw.sv.last, streak: dw.sv.streak, ev: dw.ev }));
    await shot(page, 'feel-daily-result.png');
    await page.tap('#card [data-act="title"]'); await page.waitForTimeout(400);
    const sub1 = await text(page, '#t-daily');
    check('daily subline sealed: "Sealed <stars> · streak 1"', /^Sealed \d stars? · streak 1$/.test(sub1), sub1);
    await shot(page, 'feel-title-daily.png');
    // replay path keeps best stars
    await page.tap('[data-act="daily"]'); await page.waitForTimeout(300);
    check('daily can be replayed the same day', await page.evaluate(() => __peri.state.mode === 'daily' && __peri.state.launches === 0));
    // next day: subline refreshes on visibilitychange, streak grows
    await page.evaluate(() => __peri.screen('title'));
    await page.evaluate(() => { window.__dayOffset = 1; Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(700);
    check('date change: new day\'s plate precomputed', await page.evaluate(() => { const c = __peri.dailyPlate(); return !!c && c.id === 'd' + __peri.Save.dateKey() && c !== window.__cachedDaily; }));
    check('date change: subline refreshes to "Today\'s plate"', /Today.s plate/.test(await text(page, '#t-daily')), await text(page, '#t-daily'));
    await page.tap('[data-act="daily"]'); await page.waitForTimeout(400);
    const key1 = await page.evaluate(() => __peri.state.daily.key);
    check('new day, new plate key', key1 !== key0 && await page.evaluate(() => __peri.state.level.id === 'd' + __peri.state.daily.key));
    await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page);
    check('second day: streak 2 on the card', /Streak 2/i.test(await text(page, '#card')), await text(page, '#card'));
    await page.tap('#card [data-act="title"]'); await page.waitForTimeout(300);
    check('title subline streak 2', /streak 2$/.test(await text(page, '#t-daily')), await text(page, '#t-daily'));
    // gap of two days resets the streak
    await page.evaluate(() => { window.__dayOffset = 4; document.dispatchEvent(new Event('visibilitychange')); });
    check('lapsed streak: subline back to Today\'s plate', /Today.s plate/.test(await text(page, '#t-daily')));
    await page.evaluate(() => { __peri.loadDaily(); __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page);
    check('streak restarts at 1 after a gap', /Streak 1/i.test(await text(page, '#card')), await text(page, '#card'));
    check('loadDaily(dateKey) hook', await page.evaluate(() => { const l = __peri.loadDaily('2026-12-25'); return l.id === 'd2026-12-25' && __peri.state.daily.key === '2026-12-25'; }));
    check('no console errors (daily run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- atlas: volumes, lazy thumbnails (real build; and, while Volume III is not baked yet, a variant with 90 stand-in plates)
  for (const T of atlasTargets) {
    const tag = T.stub ? ' [stand-in Vol III]' : '';
    const seed = () => { const st = [], fr = []; for (let i = 0; i < 90; i++) { st.push(i < 44 ? (i % 3) + 1 : 0); fr.push(0); }
      try { localStorage.setItem('perihelion.v1', JSON.stringify({ v: 2, stars: st, frags: fr, unlocked: 45, endlessBest: 0, muted: false, seen: { intro: true, fragments: true, wormholes: true } })); } catch (e) {} };
    const { ctx, page, errors } = await newPage(browser, IPHONE, seed);
    await page.goto(T.url); await page.waitForTimeout(500);
    await page.evaluate(() => __peri.screen('select'));
    await page.waitForTimeout(500);
    const at = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.vol-head')].map(h => h.innerText.replace(/\s+/g, ' ').trim());
      const cards = [...document.querySelectorAll('.plate')];
      const drawn = cards.filter(c => c.querySelector('canvas').width !== 300).length;
      const cols = getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length;
      return { heads, n: cards.length, drawn, cols, tally: document.getElementById('tally').innerText.replace(/\s+/g, ' '), grids: document.querySelectorAll('.grid').length, vols: __peri.Levels.VOLUMES.length, N: __peri.Levels.CAMPAIGN.length };
    });
    const N = at.N, V = Math.ceil(N / 30);
    check('atlas' + tag + ': one heading per volume present (' + V + '), each plate once', at.n === N && at.heads.length === V && at.vols === V, JSON.stringify(at.heads));
    check('atlas' + tag + ': heading style "Volume I · Plates I–XXX"', /^Volume I\s*·\s*Plates I–XXX$/i.test(at.heads[0]), at.heads[0]);
    if (N >= 90) check('atlas' + tag + ': Volume III section "Plates LXI–XC", 90 plates in all', /^Volume III\s*·\s*Plates LXI–XC$/i.test(at.heads[2]) && at.n === 90, at.heads[2] + ' / ' + at.n);
    check('atlas' + tag + ': 3 columns portrait', at.cols === 3, 'cols ' + at.cols);
    check('atlas' + tag + ': tally shows stars x/' + (N * 3) + ' and sealed plates x/' + N, new RegExp('Stars \\d+/' + N * 3 + '.*Sealed \\d+/' + N, 'i').test(at.tally), at.tally);
    const stamps = await page.evaluate(() => { const cs = [...document.querySelectorAll('.plate')], vis = c => !c.querySelector('.sealed').hidden, txt = c => c.querySelector('.sealed').innerText.replace(/\s+/g, ' ').trim();
      const lk = cs.filter(c => c.classList.contains('locked')), dn = cs.filter(c => c.classList.contains('done'));
      return { lk: lk.length, lkOk: lk.every(c => vis(c) && /^Locked$/i.test(txt(c))), dn: dn.length, dnOk: dn.every(c => !vis(c)), open: cs.filter(c => !c.classList.contains('locked')).every(c => !vis(c)), nSealedWord: cs.filter(c => /sealed/i.test(c.querySelector('.sealed').textContent)).length }; });
    check('atlas' + tag + ': locked plates are stamped "Locked", beaten and open plates carry no stamp (stars instead), the word Sealed is not on a stamp', stamps.lk > 0 && stamps.lk === N - 45 && stamps.lkOk && stamps.dnOk && stamps.open && stamps.nSealedWord === 0, JSON.stringify(stamps));
    check('atlas' + tag + ': thumbnails lazy (only rows near the viewport drawn)', N <= 30 ? at.drawn > 0 : at.drawn > 6 && at.drawn < N, at.drawn + '/' + at.n + ' drawn');
    await shot(page, T.stub ? 'feel-atlas-stub-vol1.png' : 'feel-atlas-vol1.png');
    // scroll to the last volume
    await page.evaluate(() => { const hs = document.querySelectorAll('.vol-head'); const sc = document.getElementById('s-scroll'); const h = hs[hs.length - 1]; sc.scrollTop = h.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12; });
    await page.waitForTimeout(500);
    await shot(page, T.stub ? 'feel-atlas-stub-vol3.png' : 'feel-atlas-vol2.png');
    await page.evaluate(() => { document.getElementById('s-scroll').scrollTop = 1e6; }); await page.waitForTimeout(500);
    check('atlas' + tag + ': thumbnails drawn on scroll (last plate)', await page.evaluate(() => { const cs = [...document.querySelectorAll('.plate')]; return cs[cs.length - 1].querySelector('canvas').width !== 300; }));
    if (N > 46) {
      await page.evaluate(() => { document.querySelector('.plate[data-i="' + (__peri.Levels.CAMPAIGN.length - 1) + '"]').click(); });
      check('atlas' + tag + ': tapping a locked plate does nothing (unlock stays sequential)', await page.evaluate(() => __peri.state.screen === 'select'));
    }
    check('no console errors (atlas run' + tag + ')', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- localStorage throwing
  {
    const { ctx, page, errors } = await newPage(browser, IPHONE, () => {
      const boom = function () { throw new DOMException('denied', 'SecurityError'); };
      Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom; Storage.prototype.clear = boom;
    });
    await page.goto(url); await page.waitForTimeout(500);
    await page.tap('[data-act="begin"]'); await page.waitForTimeout(400);
    await page.tap('.plate[data-i="0"]'); await page.waitForTimeout(500);
    check('storage throwing: intro card still shows', await page.evaluate(() => __peri.state.card === 'intro'));
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(300);
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(300);
    check('storage throwing: dismissed card stays dismissed (in memory)', await page.evaluate(() => __peri.state.card === null));
    await page.evaluate(() => __peri.solveCurrent());
    await cardOn(page).catch(() => {});
    const r = await page.evaluate(() => ({ ok: __peri.state.result && __peri.state.result.success, u: __peri.Save.data.unlocked, p: __peri.Save.persistent }));
    check('storage throwing: plays & keeps in-memory progress', r.ok && r.u === 2 && r.p === false, JSON.stringify(r));
    await page.evaluate(() => { __peri.loadDaily(); __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page).catch(() => {});
    check('storage throwing: daily works', /engraved tomorrow/.test(await text(page, '#card')));
    check('no console errors (no-storage run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- desktop mouse
  {
    const { ctx, page, errors } = await newPage(browser, { viewport: { width: 1280, height: 800 } });
    await page.goto(url); await page.waitForTimeout(400);
    await page.evaluate(() => { SEEN_ALL_IN_PAGE(); function SEEN_ALL_IN_PAGE() { __peri.Save.markSeen('intro'); __peri.Save.markSeen('fragments'); } __peri.loadLevel(0); }); await page.waitForTimeout(300);
    check('nudge hidden right after load', await page.evaluate(() => !document.getElementById('hint').classList.contains('on')));
    await page.waitForTimeout(7600);
    check('marginal nudge appears after idling on plate I (not with the intro card)', await page.evaluate(() => document.getElementById('hint').classList.contains('on')));
    await page.mouse.move(640, 300); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(640 - 8 * i, 300 + 20 * i); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(60);
    check('desktop mouse drag launches', await page.evaluate(() => __peri.state.launches === 1));
    await page.evaluate(() => __peri.loadLevel(0)); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check('keyboard Escape pauses', await page.evaluate(() => __peri.state.paused));
    check('no console errors (desktop)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- landscape 844x390
  {
    const { ctx, page, errors } = await newPage(browser, LAND);
    await page.goto(url); await page.waitForTimeout(500);
    const tr = await page.evaluate(() => [...document.querySelectorAll('#scr-title button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), Math.round(r.height)]; }));
    const hd = await rectOf(page, '.t-head'), nv = await rectOf(page, '.t-menu');
    check('landscape title: 5 buttons inside 844x390, >=44px, head and menu do not overlap', tr.length === 5 && tr.every(r => r[0] >= 0 && r[2] <= 844 && r[1] >= 0 && r[3] <= 390 && r[4] >= 44) && hd.r <= nv.l + 1 && nv.b <= 390 && hd.b <= 390, JSON.stringify({ tr, hd, nv }));
    await shot(page, 'feel-landscape-title.png');
    for (const vp of [[844, 390], [667, 375], [932, 430], [812, 375]]) {
      await page.setViewportSize({ width: vp[0], height: vp[1] }); await page.waitForTimeout(350);
      const ov = await page.evaluate(() => {
        const R = e => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const rules = [...document.querySelectorAll('.t-head .rule')].map(R), btns = [...document.querySelectorAll('#scr-title button')].map(R), head = R(document.querySelector('.t-head'));
        return { over: rules.some(r => btns.some(b => hit(r, b))), inHead: rules.every(r => r.left >= head.left - 1 && r.right <= head.right + 1), n: rules.length };
      });
      check('landscape title ' + vp.join('x') + ': .rule clear of buttons and inside the header column', !ov.over && ov.inHead && ov.n === 2, JSON.stringify(ov));
    }
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(350);
    await shot(page, 'feel-landscape-title.png');
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(500);
    const li = await rectOf(page, '#pcard'), pl = await page.evaluate(() => { const p = __peri.Render.layout.plate; return { l: p.x, r: p.x + p.w }; });
    check('landscape intro card: wide, inside viewport, clear of HUD corners, no inner scroll', inside(li, 844, 390, 4) && li.t >= 56 && li.b <= 335 && li.l > 90 && li.r < 754 && await page.evaluate(() => { const e = document.getElementById('pcard'); return e.scrollHeight <= e.clientHeight + 1; }), JSON.stringify({ li, pl }));
    const scrolls = await page.evaluate(() => { const e = document.getElementById('pcard'); return [e.scrollHeight, e.clientHeight]; });
    console.log('  intro card scroll', scrolls);
    await shot(page, 'feel-landscape-intro.png');
    await page.evaluate(() => __peri.closeCard());
    await page.evaluate(i => { __peri.Save.markSeen('intro'); __peri.loadLevel(i); }, info.frag); await page.waitForTimeout(500);
    const lf = await rectOf(page, '#pcard');
    check('landscape fragment card inside viewport, beside the plate', await page.evaluate(() => __peri.state.card === 'fragments') && inside(lf, 844, 390, 4) && (lf.l >= pl.r - 1 || lf.r <= pl.l + 1), JSON.stringify(lf));
    await shot(page, 'feel-landscape-fragments.png');
    await page.evaluate(() => __peri.closeCard()); await page.waitForTimeout(300);
    await page.tap('#zone-r .btn'); await page.waitForTimeout(400);
    const sp = await rectOf(page, '#sheet-panel');
    const sb = await page.evaluate(() => { const p = document.getElementById('sheet-panel'); return { sh: p.scrollHeight, ch: p.clientHeight, btns: [...document.querySelectorAll('#sheet button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height), Math.round(r.left), Math.round(r.right)]; }) }; });
    check('landscape menu sheet inside viewport, targets >=44px, buttons visible or scrollable', inside(sp, 844, 390, 2) && sb.btns.every(r => r[2] >= 44) && (sb.sh <= sb.ch + 1 || sb.sh > sb.ch), JSON.stringify({ sp, sh: sb.sh, ch: sb.ch }));
    check('landscape menu sheet fits without scrolling', sb.sh <= sb.ch + 1, sb.sh + ' vs ' + sb.ch);
    await shot(page, 'feel-landscape-menu.png');
    await page.tap('#sheet [data-act="howto"]'); await page.waitForTimeout(400);
    const lh = await rectOf(page, '#pcard');
    check('landscape: card reopened from sheet inside viewport', inside(lh, 844, 390, 4), JSON.stringify(lh));
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(300);
    await page.tap('#sheet [data-act="resume"]'); await page.waitForTimeout(200);
    await page.evaluate(() => { __peri.loadLevel(0); __peri.solveCurrent(); }); await cardOn(page).catch(() => {}); await page.waitForTimeout(400);
    const lc = await page.evaluate(() => { const r = document.getElementById('card').getBoundingClientRect(), p = __peri.Render.layout.plate;
      return { r: [r.left, r.top, r.right, r.bottom], p: [p.x, p.x + p.w] }; });
    check('landscape result card inside viewport, beside plate', lc.r[0] >= 0 && lc.r[1] >= 0 && lc.r[2] <= 844 && lc.r[3] <= 390 && (lc.r[0] >= lc.p[1] || lc.r[2] <= lc.p[0]), JSON.stringify(lc));
    await page.evaluate(() => __peri.screen('select')); await page.waitForTimeout(500);
    check('landscape atlas: 6 columns', await page.evaluate(() => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length === 6));
    await shot(page, 'feel-landscape-select.png');
    check('no console errors (landscape)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- wormholes: card, menu item, live flight, hint, loadCustom (fixtures; real plates too once baked)
  const WTEXT = 'Wormholes come in pairs, marked with the same Greek letter. Fly into one and you leave by its twin at the same speed. A mark such as ↻ 90° means your heading turns that far as you pass through. They pull on nothing and do no harm.';
  const SEEN_IF = () => { try { Save.markSeen('intro'); Save.markSeen('fragments'); } catch (e) {} };      // intro + fragments seen, wormholes still due
  const loadFx = (page, i) => page.evaluate(lv => { __peri.loadCustom(JSON.parse(JSON.stringify(lv))); return __peri.state.card; }, FX[i]);
  // does the card rect touch any spotlight ring (screen px)?
  // how many mouth centres the card covers vs the fewest any position in the plate's clear band could cover (0 when a clear band exists)
  const coverVsBest = page => page.evaluate(() => { const L = __peri.Render.layout, e = document.getElementById('pcard'), r = e.getBoundingClientRect(), ys = (__peri.state.spotlight || []).map(p => __peri.Render.worldToScreen(p.x, p.y).y);
    const minTop = L.top.y + L.top.h + 2, maxBottom = Math.min(L.h - 10, L.bottom.y - 2), h = r.height, cnt = t => ys.filter(y => y >= t - 4 && y <= t + h + 4).length;
    let best = Infinity; for (let t = minTop; t <= maxBottom - h + 0.5; t += 1) best = Math.min(best, cnt(t));
    return { covered: cnt(r.top), best, n: ys.length }; });
  const ringsHit = page => page.evaluate(() => { const r = document.getElementById('pcard').getBoundingClientRect(), sc = __peri.Render.layout.scale, out = [];
    for (const p of (__peri.state.spotlight || [])) { const q = __peri.Render.worldToScreen(p.x, p.y), rad = (p.r || 0) * sc;
      const cx = Math.max(r.left, Math.min(q.x, r.right)), cy = Math.max(r.top, Math.min(q.y, r.bottom)); out.push(Math.hypot(q.x - cx, q.y - cy) < rad); }
    return out; });
  {
    // ---- (a) order on a fresh profile: intro, fragments, wormholes, each once
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url); await page.waitForTimeout(500);
    check('hook loadCustom present', await page.evaluate(() => typeof __peri.loadCustom === 'function'));
    await loadFx(page, 2); await page.waitForTimeout(450);
    const seq = [];
    for (let k = 0; k < 5; k++) {
      const c = await page.evaluate(() => __peri.state.card); if (!c) break;
      seq.push(c); await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(420);
    }
    check('wormhole card queues after intro and fragments on a fresh profile (fw3: intro, fragments, wormholes)', JSON.stringify(seq) === JSON.stringify(['intro', 'fragments', 'wormholes']), JSON.stringify(seq));
    const sv = await page.evaluate(() => ({ seen: JSON.parse(localStorage.getItem('perihelion.v1')).seen, card: __peri.state.card }));
    check('all three seen flags saved, no card left', sv.seen.intro && sv.seen.fragments && sv.seen.wormholes && sv.card === null, JSON.stringify(sv));
    await loadFx(page, 0); await page.waitForTimeout(300);
    check('wormhole card is once-only (does not repeat on the next wormhole plate)', await page.evaluate(() => __peri.state.card === null));
    await page.reload(); await page.waitForTimeout(700);
    await loadFx(page, 1); await page.waitForTimeout(300);
    check('seen flag survives a reload', await page.evaluate(() => __peri.state.card === null && __peri.Save.seen('wormholes')));
    check('no console errors (wormhole card order)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ---- (b) the card itself, portrait
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url); await page.waitForTimeout(500);
    await page.evaluate(SEEN_IF);
    await loadFx(page, 0); await page.waitForTimeout(500);
    const wc = await page.evaluate(() => { const s = __peri.state, e = document.getElementById('pcard');
      return { card: s.card, on: e.classList.contains('on'), kick: e.querySelector('.kicker').innerText.trim(), title: e.querySelector('.c-title').innerText.trim(), body: e.querySelector('.pop-text').innerText.replace(/\s+/g, ' ').trim(),
        btns: [...e.querySelectorAll('.btn')].map(b => b.innerText.trim()), seen: __peri.Save.seen('wormholes'), sp: s.spotlight && s.spotlight.map(p => ({ x: p.x, y: p.y, r: p.r })),
        bodies: s.level.bodies.filter(b => b.kind === 'wormhole').map(b => ({ x: b.x, y: b.y, r: b.r })) }; });
    check('wormholes card opens on first load of a wormhole plate; title "Wormholes", button "Understood"', wc.card === 'wormholes' && wc.on && /^Wormholes$/i.test(wc.title) && JSON.stringify(wc.btns) === '["Understood"]' && !wc.seen, JSON.stringify({ card: wc.card, title: wc.title, btns: wc.btns }));
    check('wormholes card text is the contract text verbatim', wc.body === WTEXT, wc.body);
    check('spotlight holds every mouth as {x, y, r: mouth.r + 14}', wc.sp && wc.sp.length === wc.bodies.length && wc.sp.length === 2 && wc.sp.every((p, i) => p.x === wc.bodies[i].x && p.y === wc.bodies[i].y && p.r === wc.bodies[i].r + 14), JSON.stringify(wc.sp));
    const wr = await rectOf(page, '#pcard'), hit = await ringsHit(page);
    const cb0 = await coverVsBest(page);
    check('wormholes card inside 390x844 and covers as few mouths as any position could (fw1: its mouths sit in both halves, one cannot be spared)', inside(wr, 390, 844, 6) && cb0.covered <= cb0.best, JSON.stringify({ wr, cb0, rings: hit }));
    await shot(page, 'feel-card-wormholes.png');
    const d = await touchDrag(page, 200, 90, 150, 200);
    const ab = await page.evaluate(() => ({ active: __peri.state.aim.active, n: __peri.state.predict.n }));
    await d.end(); await page.waitForTimeout(60);
    check('wormholes card blocks aiming', !ab.active && ab.n === 0 && await page.evaluate(() => __peri.state.launches === 0));
    const s1 = await page.evaluate(() => __peri.state.step); await page.waitForTimeout(400);
    check('clock held while the wormholes card is open', await page.evaluate(s => __peri.state.step === s, s1));
    for (const i of [1, 2]) {      // other layouts: the card never hides a mouth
      await page.evaluate(() => __peri.closeCard()); await page.evaluate(() => { __peri.Save.data.seen.wormholes = false; });
      await page.evaluate(lv => { lv = JSON.parse(JSON.stringify(lv)); __peri.loadCustom(lv); }, FX[i]); await page.waitForTimeout(450);
      const cc = await coverVsBest(page), rc2 = await rectOf(page, '#pcard');
      check('wormholes card on fw' + (i + 1) + ' (' + cc.n + ' mouths): inside the viewport, covers as few mouths as any position could', await page.evaluate(() => __peri.state.card === 'wormholes') && inside(rc2, 390, 844, 6) && cc.covered <= cc.best, JSON.stringify({ rc2, cc }));
      await shot(page, 'feel-card-wormholes-fw' + (i + 1) + '.png');
    }
    await page.evaluate(() => __peri.closeCard()); await page.evaluate(lv => { __peri.Save.data.seen.wormholes = false; __peri.loadCustom(JSON.parse(JSON.stringify(lv))); }, FX[0]); await page.waitForTimeout(450);
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(400);
    const dz = await page.evaluate(() => ({ card: __peri.state.card, sp: __peri.state.spotlight, on: document.getElementById('pcard').classList.contains('on'), saved: JSON.parse(localStorage.getItem('perihelion.v1')).seen.wormholes }));
    check('Understood dismisses, clears the spotlight, persists', dz.card === null && dz.sp === null && !dz.on && dz.saved === true, JSON.stringify(dz));

    // ---- (c) menu item: only on wormhole plates, reopens the card from the sheet
    await page.tap('#zone-r .btn'); await page.waitForTimeout(400);
    const mo = await page.evaluate(() => ({ order: [...document.querySelectorAll('#sheet .c-btns .btn, #sheet [data-sound]')].filter(b => b.offsetParent !== null).map(b => b.innerText.replace(/\s+/g, ' ').trim()),
      h: Math.round(document.getElementById('sheet-worm').getBoundingClientRect().height) }));
    check('menu on a wormhole plate: "About wormholes" after "About comet fragments"', JSON.stringify(mo.order) === JSON.stringify(['Resume', 'Consult the Astronomer', 'How to play', 'About comet fragments', 'About wormholes', 'Restart plate', 'Return to the Atlas', 'Sound: On']) && mo.h >= 44, JSON.stringify(mo));
    const mp = await rectOf(page, '#sheet-panel');
    check('menu sheet with the extra item still inside 390x844', inside(mp, 390, 844, 4), JSON.stringify(mp));
    await shot(page, 'feel-menu-wormholes.png');
    await page.tap('#sheet [data-act="wormholes"]'); await page.waitForTimeout(450);
    const ra = await page.evaluate(() => ({ card: __peri.state.card, paused: __peri.state.paused, sp: __peri.state.spotlight && __peri.state.spotlight.length, t: document.querySelector('#pcard .pop-text').innerText.replace(/\s+/g, ' ') }));
    check('"About wormholes" reopens the card from the sheet (spotlight set)', ra.card === 'wormholes' && ra.paused && ra.sp === 2 && ra.t === WTEXT, JSON.stringify({ card: ra.card, sp: ra.sp }));
    await shot(page, 'feel-card-wormholes-menu.png');
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(350);
    check('dismiss returns to the paused sheet', await page.evaluate(() => __peri.state.card === null && __peri.state.paused && document.getElementById('sheet').classList.contains('on') && !document.getElementById('sheet').classList.contains('sub')));
    await page.tap('#sheet [data-act="resume"]'); await page.waitForTimeout(200);
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(300);
    await page.tap('#zone-r .btn'); await page.waitForTimeout(400);
    check('menu on a plate without wormholes: no "About wormholes"', await page.evaluate(() => { const b = document.getElementById('sheet-worm'); return b.hidden && b.offsetParent === null && ![...document.querySelectorAll('#sheet .btn')].some(x => x.offsetParent !== null && /wormhole/i.test(x.innerText)); }));
    await page.tap('#sheet [data-act="resume"]'); await page.waitForTimeout(200);
    await page.evaluate(() => __peri.loadDaily()); await page.waitForTimeout(300);
    await page.tap('#zone-r .btn'); await page.waitForTimeout(400);
    check('menu on the Daily Plate: no "About wormholes"', await page.evaluate(() => document.getElementById('sheet-worm').offsetParent === null));
    await page.tap('#sheet [data-act="resume"]'); await page.waitForTimeout(200);
    check('no console errors (wormhole card run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ---- (d) a mouth on rails: the ring follows it
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url); await page.waitForTimeout(500);
    await page.evaluate(SEEN_IF);
    await page.evaluate(lv => { lv = JSON.parse(JSON.stringify(lv)); lv.solution.t0Step = 0; __peri.loadCustom(lv); }, FX[2]); await page.waitForTimeout(450);
    const rr = await page.evaluate(() => { const s = __peri.state, P = __peri.Physics, b = s.level.bodies.findIndex(q => q.kind === 'wormhole' && q.orbit), o = {}; P.bodyPos(s.level.bodies[b], s.step * 1 / 120, o);
      return { card: s.card, sp: s.spotlight.map(p => [p.x, p.y, p.r]), want: [o.x, o.y], b, step: s.step }; });
    const orb = rr.sp.find(p => Math.abs(p[0] - rr.want[0]) < 1e-6 && Math.abs(p[1] - rr.want[1]) < 1e-6);
    check('orbiting mouth: spotlight follows its current position, r = r + 14', rr.card === 'wormholes' && orb && orb[2] === 46, JSON.stringify(rr));
    await page.evaluate(() => { __peri.state.step += 37; }); await page.waitForTimeout(120);
    const r2 = await page.evaluate(() => { const s = __peri.state, o = {}; __peri.Physics.bodyPos(s.level.bodies.find(q => q.kind === 'wormhole' && q.orbit), s.step / 120, o); const p = s.spotlight.find(q => q.body === s.level.bodies.findIndex(q2 => q2.orbit)); return { p: [p.x, p.y], want: [o.x, o.y] }; });
    check('spotlight ring refreshes each frame when the mouth moves', Math.abs(r2.p[0] - r2.want[0]) < 1e-6 && Math.abs(r2.p[1] - r2.want[1]) < 1e-6 && Math.hypot(r2.p[0] - rr.want[0], r2.p[1] - rr.want[1]) > 5, JSON.stringify(r2));
    await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(300);
    check('no console errors (orbiting mouth card)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ---- (e) live flights through wormholes in the real game loop, the hint, result and star rule
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url); await page.waitForTimeout(500);
    await page.evaluate(SEEN_ALL);
    await page.evaluate(() => {
      window.__w = { render: [], sound: 0, vib: [] };
      const R = __peri.Render, S = __peri.Sound, or = R.warp, os = S.warp;
      window.__w.realRender = typeof or === 'function'; window.__w.realSound = typeof os === 'function';
      R.warp = function (a, b, c, d) { __w.render.push([a, b, c, d]); if (or) return or.apply(this, arguments); };
      S.warp = function () { __w.sound++; if (os) return os.apply(this, arguments); };
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: v => { __w.vib.push(v); return true; } });
      window.__ev = []; const o = __peri.Log.event; __peri.Log.event = function (n, d) { window.__ev.push(n); return o.apply(this, arguments); };
    });
    console.log('  Render.warp present: ' + await page.evaluate(() => __w.realRender) + ', Sound.warp present: ' + await page.evaluate(() => __w.realSound));
    // aim preview on a wormhole plate: K.PREDICT_STEPS buffer, path with a jump
    await loadFx(page, 0); await page.waitForTimeout(300);
    const sol = FX[0].solution, sc = await page.evaluate(() => __peri.Render.layout.scale);
    const pp = await page.evaluate(() => { const p = __peri.Render.worldToScreen(__peri.state.level.probe.x, __peri.state.level.probe.y); return p; });
    const k = 300 / 640;                                     // world pull per unit of launch speed (DRAG_MAX / VMAX)
    const d = await touchDrag(page, 195, 560, 195 - sol.vx * k * sc, 560 - sol.vy * k * sc, 10); await page.waitForTimeout(80);
    const pr = await page.evaluate(() => { const s = __peri.state, n = s.predict.n, pts = s.predict.pts, J = K.WARP_JUMP; let jumps = 0, at = -1;
      for (let i = 1; i < n; i++) if (Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]) > J) { jumps++; at = i; }
      return { n, jumps, at, len: pts.length, cancel: s.aim.cancel, vx: s.aim.vx, vy: s.aim.vy }; });
    await shot(page, 'feel-aim-wormhole.png');
    await d.end(); await page.waitForTimeout(60);
    check('aim preview on a wormhole plate: <= K.PREDICT_STEPS points, crosses the mouth as one jump', pr.n === 270 && pr.len === 540 && pr.jumps === 1, JSON.stringify(pr));
    await page.evaluate(() => { __w.render.length = 0; __w.sound = 0; __w.vib.length = 0; __ev.length = 0; });
    await page.evaluate(() => __peri.loadCustom ? 0 : 0);
    // real-time flight with the real solution
    await loadFx(page, 0); await page.waitForTimeout(200);
    await page.evaluate(lv => { __w.render.length = 0; __w.sound = 0; __w.vib.length = 0; __ev.length = 0; __peri.launch(lv.solution.vx, lv.solution.vy); }, FX[0]);
    await page.waitForFunction(() => __peri.state.phase === 'result', null, { timeout: 15000 }).catch(() => {});
    await shot(page, 'feel-wormhole-flight-result.png');
    const fl = await page.evaluate(() => { const s = __peri.state, r = s.result, pts = r && r.pts, n = r ? r.n : 0, J = K.WARP_JUMP, js = [];
      for (let i = 1; i < n; i++) if (Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]) > J) js.push(i);
      const b = s.level.bodies; return { res: r && { ok: r.success, st: r.stars }, warps: s.sim.warps, ev: s.sim.events.length, w: window.__w, js, m1: [b[1].x, b[1].y], m2: [b[2].x, b[2].y], logs: window.__ev, sealedCard: document.getElementById('card').innerText.replace(/\s+/g, ' ') }; });
    check('live flight through a wormhole (real loop): hit, 3 stars, one passage', fl.res && fl.res.ok && fl.res.st === 3 && fl.warps === 1, JSON.stringify({ res: fl.res, warps: fl.warps }));
    check('warp event fires once: Render.warp x1 (entry mouth centre, twin centre), Sound.warp x1, one vibrate(14), events cleared', fl.w.render.length === 1 && Math.hypot(fl.w.render[0][0] - fl.m2[0], fl.w.render[0][1] - fl.m2[1]) < 1e-6 && Math.hypot(fl.w.render[0][2] - fl.m1[0], fl.w.render[0][3] - fl.m1[1]) < 1e-6 && fl.w.sound === 1 && fl.w.vib.filter(v => v === 14).length === 1 && fl.ev === 0, JSON.stringify({ r: fl.w.render, s: fl.w.sound, v: fl.w.vib, ev: fl.ev }));
    check('result path holds the jump as one long step (RENDER must not connect it)', fl.js.length === 1, JSON.stringify(fl.js));
    await cardOn(page).catch(() => {});
    const rc = await page.evaluate(() => ({ t: document.getElementById('card').innerText.replace(/\s+/g, ' '), btns: [...document.querySelectorAll('#card .btn')].map(b => b.innerText.trim()), saved: JSON.parse(localStorage.getItem('perihelion.v1')).stars.slice(0, 3), logs: window.__ev }));
    check('result card on a custom plate: Sealed, Replay/Atlas only, no Next plate', /Sealed/.test(rc.t) && JSON.stringify(rc.btns) === '["Replay","Atlas"]', JSON.stringify(rc.btns));
    check('custom plate: no plateSealed / no Log events, nothing saved', !rc.logs.length && rc.saved.every(x => x === 0), JSON.stringify({ logs: rc.logs, saved: rc.saved }));
    // guards: the flight must work when Render.warp / Sound.warp / navigator.vibrate do not exist
    await page.evaluate(() => { __peri.Render.warp = undefined; __peri.Sound.warp = undefined; Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined }); });
    await loadFx(page, 1); await page.waitForTimeout(150);
    const nog = await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); const s = __peri.state; return { ok: s.result && s.result.success, w: s.sim.warps }; });
    check('guards: flight through a wormhole works without Render.warp / Sound.warp / vibrate', nog.ok && nog.w >= 1 && errors.length === 0, JSON.stringify(nog) + errors.join('|'));
    // each fixture through the game loop: warps counted, spies agree
    await page.evaluate(() => {
      const R = __peri.Render, S = __peri.Sound;
      R.warp = function (a, b, c, d) { __w.render.push([a, b, c, d]); }; S.warp = function () { __w.sound++; };
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: v => { __w.vib.push(v); return true; } });
    });
    for (let i = 0; i < 3; i++) {
      await loadFx(page, i); await page.waitForTimeout(100);
      const r = await page.evaluate(() => { __w.render.length = 0; __w.sound = 0; const s0 = __peri.solveCurrent(); __peri.fastForward(1500); const s = __peri.state, sim = s.sim;
        return { t0: s0 && s0.t0Step, ok: s.result && s.result.success, st: s.result && s.result.stars, warps: sim.warps, calls: __w.render.length, snd: __w.sound, ev: sim.events.length, frag: s.collected.reduce((a, b) => a + b, 0) }; });
      check('fixture fw' + (i + 1) + ' in the live loop: hit in one launch (3 stars), ' + [1, 1, 2][i] + ' passage(s), one Render.warp + Sound.warp per passage', r.ok && r.st === 3 && r.warps === [1, 1, 2][i] && r.calls === r.warps && r.snd === r.warps && r.ev === 0, JSON.stringify(r));
    }
    // hint on fixtures
    for (let i = 0; i < 3; i++) {
      await loadFx(page, i); await page.waitForTimeout(100);
      const h = await page.evaluate(() => { const ok = __peri.useHint(), s = __peri.state, h = s.hint, sol = s.level.solution, P = __peri.Physics, J = K.WARP_JUMP, sim = P.createSim(s.level, sol.vx, sol.vy, sol.t0Step | 0);
        let tot = 0, w = 0, lw = 0, got = 0, lf = 0; while (sim.status === 'flying' && sim.step < 1200) { P.stepSim(sim, s.level); tot++; if (sim.warps > w) { w = sim.warps; lw = tot; } const c = sim.collected.reduce((a, b) => a + b, 0); if (c > got) { got = c; lf = tot; } }
        let n = Math.floor(0.55 * tot); if (got) n = Math.max(n, Math.min(lf + 24, Math.floor(0.92 * tot))); if (w) n = Math.max(n, Math.min(lw + 24, Math.floor(0.92 * tot))); n = Math.min(1100, n);
        const js = []; for (let k = 1; k < h.n; k++) if (Math.hypot(h.pts[2 * k] - h.pts[2 * k - 2], h.pts[2 * k + 1] - h.pts[2 * k - 1]) > J) js.push(k);
        return { ok, n: h.n, expect: n, tot, lw, js, used: h.used, on: h.on, frozen: s.frozen, step: s.step, t0: sol.t0Step | 0 }; });
      check('hint (Consult the Astronomer) on wormhole fixture fw' + (i + 1) + ': line runs through the passage and >= 24 steps beyond it, stays under 92% of the course', h.ok && h.on && h.used && h.frozen && h.step === h.t0 && h.n === h.expect && h.js.length >= 1 && h.n >= Math.min(h.lw + 24, Math.floor(.92 * h.tot)) && h.n <= Math.floor(.92 * h.tot) + 1, JSON.stringify(h));
      if (i === 0) await shot(page, 'feel-hint-wormhole.png');
    }
    await loadFx(page, 0); await page.waitForTimeout(100);
    const hs = await page.evaluate(() => { __peri.useHint(); __peri.solveCurrent(); __peri.fastForward(1500); const s = __peri.state; return { ok: s.result && s.result.success, st: s.result && s.result.stars, used: s.result && s.result.hintUsed }; });
    check('star rule on a wormhole plate: one launch + hint = 2 stars', hs.ok && hs.st === 2 && hs.used, JSON.stringify(hs));
    await loadFx(page, 0); await page.waitForTimeout(100);
    const f3 = await page.evaluate(() => { const s = __peri.state; for (let k = 0; k < 3; k++) { __peri.launch(0, 640); while (s.sim && s.sim.status === 'flying') __peri.fastForward(1); __peri.fastForward(100); } return { ph: s.phase, r: s.result && s.result.success, l: s.launches }; });
    check('three misses on a wormhole plate: fail result, Retry works', f3.ph === 'result' && f3.r === false && f3.l === 3);
    check('no console errors (wormhole flight run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ---- (f) loadCustom writes nothing to Save and emits nothing to Log; real plates afterwards behave normally
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url); await page.waitForTimeout(500);
    await page.evaluate(() => { SEEN_ALL_PAGE(); function SEEN_ALL_PAGE() { for (const n of ['intro', 'fragments', 'wormholes']) __peri.Save.markSeen(n); } __peri.Save.recordPlate(0, 2, 0); __peri.Save.bump('launches', 3); });
    const before = await page.evaluate(() => ({ raw: localStorage.getItem('perihelion.v1'), mem: JSON.stringify(__peri.Save.data) }));
    await page.evaluate(() => { window.__ev = []; const o = __peri.Log.event; __peri.Log.event = function (n) { window.__ev.push(n); return o.apply(this, arguments); }; });
    for (let i = 0; i < 3; i++) {
      await loadFx(page, i); await page.waitForTimeout(100);
      await page.evaluate(() => { __peri.useHint(); __peri.solveCurrent(); __peri.fastForward(1500); });
      await page.evaluate(() => { __peri.loadCustom(__peri.state.level); for (let k = 0; k < 3; k++) { __peri.launch(0, 640); const s = __peri.state; while (s.sim && s.sim.status === 'flying') __peri.fastForward(1); __peri.fastForward(100); } __peri.openCard('wormholes'); __peri.closeCard(); });
      await page.tap('#zone-r .btn').catch(() => {}); await page.waitForTimeout(150);
      await page.evaluate(() => __peri.resume());
    }
    const after = await page.evaluate(() => ({ raw: localStorage.getItem('perihelion.v1'), mem: JSON.stringify(__peri.Save.data), ev: window.__ev, idx: __peri.state.levelIndex, mode: __peri.state.mode, custom: __peri.state.custom }));
    check('loadCustom: localStorage string and Save.data unchanged after full plays, hints, fails, cards', before.raw === after.raw && before.mem === after.mem);
    check('loadCustom: levelIndex -1, no Log events (so no plateSealed)', after.idx === -1 && after.ev.length === 0 && after.custom === true, JSON.stringify({ idx: after.idx, ev: after.ev }));
    await page.evaluate(() => { __peri.loadLevel(1); __peri.solveCurrent(); __peri.fastForward(1500); });
    const real = await page.evaluate(() => ({ s: __peri.Save.data.stars[1], ev: window.__ev, custom: __peri.state.custom, idx: __peri.state.levelIndex }));
    check('a baked plate after loadCustom saves and logs as usual', real.s === 3 && real.ev.includes('plateSealed') && !real.custom && real.idx === 1, JSON.stringify(real));
    check('no console errors (loadCustom run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ---- (g) 90 plates: a save that finished 60 plates finds plate 61 unlocked; unlock stays in order; the card shows once on first load
    const T = atlasTargets[atlasTargets.length - 1], tag = T.stub ? ' [stand-in Vol III]' : '';
    const seed = () => { const st = [], fr = []; for (let i = 0; i < 60; i++) { st.push(i % 3 + 1); fr.push(0); }
      try { if (!localStorage.getItem('perihelion.v1')) localStorage.setItem('perihelion.v1', JSON.stringify({ v: 2, stars: st, frags: fr, unlocked: 60, endlessBest: 0, muted: false, seen: { intro: true, fragments: true } })); } catch (e) {} };
    const { ctx, page, errors } = await newPage(browser, IPHONE, seed);
    await page.goto(T.url); await page.waitForTimeout(600);
    const mg = await page.evaluate(() => ({ u: __peri.Save.data.unlocked, n: __peri.Levels.CAMPAIGN.length, N: __peri.Save.N, sealed: __peri.Save.totals().sealed, vols: __peri.Levels.VOLUMES.map(v => v.from + '-' + v.to).join(),
      ed: document.getElementById('t-ed').innerText.replace(/\s+/g, ' ') }));
    check('90-plate build: Save.N is 90 and the last volume ends at the last plate', mg.N === 90 && mg.n <= 90 && +mg.vols.split(',').pop().split('-')[1] === mg.n - 1, JSON.stringify(mg));
    check('title edition line follows the campaign length', mg.ed.indexOf('Plates I–' + (await page.evaluate(n => toRoman(n), mg.n))) === 0, mg.ed);
    if (mg.n > 60) {
      check('existing save with 60 plates finished: plate 61 unlocked (unlocked = 61)', mg.u === 61 && mg.sealed === 60, JSON.stringify({ u: mg.u, sealed: mg.sealed }));
      await page.tap('[data-act="begin"]'); await page.waitForTimeout(500);
      const lk = await page.evaluate(() => ({ p60: document.querySelector('.plate[data-i="60"]').classList.contains('locked'), p61: document.querySelector('.plate[data-i="61"]').classList.contains('locked'), p59: document.querySelector('.plate[data-i="59"]').classList.contains('locked') }));
      check('atlas: plates 1-61 open, plate 62 locked', !lk.p59 && !lk.p60 && lk.p61, JSON.stringify(lk));
      await page.evaluate(() => { document.querySelector('.plate[data-i="61"]').click(); });
      check('atlas: a locked Volume III plate cannot be opened', await page.evaluate(() => __peri.state.screen === 'select'));
      await page.evaluate(() => { const sc = document.getElementById('s-scroll'), e = document.querySelector('.plate[data-i="60"]'); sc.scrollTop = e.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 120; });
      await page.waitForTimeout(450);
      await shot(page, T.stub ? 'feel-atlas-stub-seam.png' : 'feel-atlas-seam.png');
      await page.evaluate(() => { const e = document.querySelector('.plate[data-i="60"]'); e.scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(300);
      await page.tap('.plate[data-i="60"]'); await page.waitForTimeout(550);
      const p61 = await page.evaluate(() => ({ s: __peri.state.screen, i: __peri.state.levelIndex, card: __peri.state.card, w: __peri.state.level.bodies.some(b => b.kind === 'wormhole'), cap: __peri.state.level.plate, sp: __peri.state.spotlight && __peri.state.spotlight.length }));
      check('tapping plate LXI opens it; its wormhole card shows on first load' + tag, p61.s === 'play' && p61.i === 60 && p61.w && p61.card === 'wormholes' && p61.sp >= 2, JSON.stringify(p61));
      await page.tap('#pcard [data-act="pop-ok"]'); await page.waitForTimeout(400);
      await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page);
      const sl = await page.evaluate(() => ({ u: __peri.Save.data.unlocked, st: __peri.Save.data.stars[60], btns: [...document.querySelectorAll('#card .btn')].map(b => b.innerText.trim()) }));
      check('sealing plate LXI unlocks LXII, result card offers Next plate', sl.u === 62 && sl.st >= 1 && sl.btns.indexOf('Next plate') >= 0, JSON.stringify(sl));
      await page.tap('#card [data-act="next"]'); await page.waitForTimeout(450);
      const nx = await page.evaluate(() => ({ i: __peri.state.levelIndex, card: __peri.state.card }));
      check('Next plate from LXI goes to LXII; the wormhole card does not repeat', nx.i === 61 && nx.card === null, JSON.stringify(nx));
    } else {
      console.log('  note: CAMPAIGN has only ' + mg.n + ' plates; Volume III plate flow not tested');
    }
    // last plate of the atlas: "The atlas is complete."
    await page.evaluate(() => { const n = __peri.Levels.CAMPAIGN.length; const d = __peri.Save.data; for (let i = 0; i < n; i++) d.stars[i] = Math.max(d.stars[i], 1); d.unlocked = n; __peri.loadLevel(n - 1); __peri.solveCurrent(); __peri.fastForward(1500); });
    await cardOn(page).catch(() => {});
    const lastc = await page.evaluate(() => ({ t: document.getElementById('card').innerText.replace(/\s+/g, ' '), u: __peri.Save.data.unlocked, n: __peri.Levels.CAMPAIGN.length }));
    check('last plate of the atlas: "The atlas is complete.", Replay/Atlas, unlocked stays <= Save.N', /The atlas is complete\./.test(lastc.t) && !/Next plate/.test(lastc.t) && lastc.u <= 90, lastc.t);
    check('no console errors (90-plate run' + tag + ')', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ---- (i) the wormholes card clears the mouths and their pair labels on every wormhole plate; loadCustom refuses broken pairs
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url3); await page.waitForTimeout(600);
    await page.evaluate(SEEN_IF);
    const plates = await page.evaluate(() => __peri.Levels.CAMPAIGN.map((l, i) => l.bodies.some(b => b.kind === 'wormhole') ? i : -1).filter(i => i >= 0));
    const rep = [];
    for (const src of [...plates.map(i => ({ i })), ...FX.map((f, k) => ({ fx: k }))]) {
      const r = await page.evaluate(src => { __peri.Save.data.seen.wormholes = false; if (src.fx === undefined) __peri.loadLevel(src.i); return true; }, src);
      if (src.fx !== undefined) await page.evaluate(lv => { __peri.Save.data.seen.wormholes = false; __peri.loadCustom(JSON.parse(JSON.stringify(lv))); }, FX[src.fx]);
      await page.waitForTimeout(60);
      const m = await page.evaluate(() => { const L = __peri.Render.layout, sc = L.scale, e = document.getElementById('pcard'), r = { top: e.offsetTop, left: e.offsetLeft, right: e.offsetLeft + e.offsetWidth, bottom: e.offsetTop + e.offsetHeight, height: e.offsetHeight }, sp = __peri.state.spotlight || [];   // layout box: the card is still scaling in (transform) 60 ms after it opens
        const bands = sp.map(p => { const q = __peri.Render.worldToScreen(p.x, p.y), rr = p.r * sc + 34; return [q.y - rr, q.y + rr, q.y]; });
        const ov = (t, h) => bands.reduce((a, b) => a + Math.max(0, Math.min(t + h, b[1]) - Math.max(t, b[0])), 0), hid = (t, h) => bands.filter(b => b[2] >= t - 4 && b[2] <= t + h + 4).length;
        const minTop = L.top.y + L.top.h + 2, maxBottom = Math.min(L.h - 10, L.bottom.y - 2), h = r.height; let bestOv = Infinity, bestHid = Infinity, bestSc = Infinity;
        for (let t = minTop; t <= maxBottom - h + 0.5; t += 1) { bestOv = Math.min(bestOv, ov(t, h)); bestHid = Math.min(bestHid, hid(t, h)); bestSc = Math.min(bestSc, ov(t, h) + 400 * hid(t, h)); }
        return { card: __peri.state.card, n: sp.length, compact: e.classList.contains('compact'), top: r.top, bottom: r.bottom, h, left: r.left, right: r.right, ov: ov(r.top, h), hid: hid(r.top, h), sc: ov(r.top, h) + 400 * hid(r.top, h), bestSc, bestOv, bestHid, minTop, maxBottom, id: __peri.state.level.id }; });
      rep.push(m);
    }
    const bad = rep.filter(m => m.card !== 'wormholes' || m.top < m.minTop - 1 || m.bottom > m.maxBottom + 1 || m.left < 0 || m.right > 390 || m.sc > m.bestSc + 4);
    const clear = rep.filter(m => m.ov === 0).length, comp = rep.filter(m => m.compact).length, hidden = rep.filter(m => m.hid > 0).map(m => m.id);
    console.log('  wormholes card on ' + rep.length + ' plates: clear of mouths+labels on ' + clear + ', compact on ' + comp + ', still covering a mouth centre on ' + JSON.stringify(hidden));
    check('wormholes card on every wormhole plate (' + rep.length + '): inside the plate band, as clear of mouths + labels (ring + 34 px) as any position of its size allows (mouth centres first)', bad.length === 0, JSON.stringify(bad.slice(0, 3)));
    check('wormholes card: never hides a mouth centre where any position of its size would spare them', rep.every(m => m.hid <= m.bestHid), JSON.stringify(rep.filter(m => m.hid > m.bestHid).map(m => m.id)));
    check('wormholes card: the compact form is used where the full card would cover more, and a good share of plates are fully clear', comp > 0 && clear >= rep.length / 4, clear + '/' + rep.length + ' clear; still overlapping: ' + JSON.stringify(rep.filter(m => m.ov > 0).map(m => m.id + ':' + Math.round(m.ov) + (m.compact ? 'c' : ''))));
    // loadCustom refuses broken wormhole pairs
    const before = await page.evaluate(() => ({ id: __peri.state.level.id, idx: __peri.state.levelIndex, custom: __peri.state.custom }));
    const res = await page.evaluate(lv => { const out = {}, W = () => JSON.parse(JSON.stringify(lv)), t = (name, f) => { const l = W(); f(l); try { out[name] = __peri.loadCustom(l); } catch (e) { out[name] = 'threw ' + e.message; } };
      t('missing', l => { delete l.bodies[1].pair; }); t('notMutual', l => { l.bodies[1].pair = 2; l.bodies[2].pair = 0; }); t('self', l => { l.bodies[1].pair = 1; });
      t('range', l => { l.bodies[2].pair = 9; }); t('toPlanet', l => { l.bodies[1].pair = 0; }); t('string', l => { l.bodies[1].pair = '2'; });
      out.nobodies = (() => { try { return __peri.loadCustom({ probe: {}, target: {} }); } catch (e) { return 'threw'; } })();
      out.same = { id: __peri.state.level.id, idx: __peri.state.levelIndex, custom: __peri.state.custom };
      out.good = (() => { try { const r = __peri.loadCustom(W()); return r && r.id; } catch (e) { return 'threw'; } })();
      return out; }, FX[0]);
    check('loadCustom rejects a level whose wormhole pairs are not mutual (returns false, no throw, game state untouched)', ['missing', 'notMutual', 'self', 'range', 'toPlanet', 'string'].every(k => res[k] === false) && res.nobodies === false && res.same.id === before.id && res.same.idx === before.idx && res.same.custom === before.custom, JSON.stringify(res));
    check('loadCustom still accepts a valid pair afterwards', res.good === 'fw1');
    check('no console errors (card clearance + bad pairs)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ---- (h) landscape 844x390: card and menu
    const { ctx, page, errors } = await newPage(browser, LAND);
    await page.goto(url); await page.waitForTimeout(500);
    await page.evaluate(SEEN_IF);
    await loadFx(page, 0); await page.waitForTimeout(500);
    const lf = await rectOf(page, '#pcard'), pl = await page.evaluate(() => { const p = __peri.Render.layout.plate; return { l: p.x, r: p.x + p.w }; });
    const lhit = await ringsHit(page);
    check('landscape wormholes card inside 844x390, beside the plate, clear of the rings, no inner scroll', await page.evaluate(() => __peri.state.card === 'wormholes') && inside(lf, 844, 390, 4) && (lf.l >= pl.r - 1 || lf.r <= pl.l + 1) && lhit.every(h => !h) && await page.evaluate(() => { const e = document.getElementById('pcard'); return e.scrollHeight <= e.clientHeight + 1; }), JSON.stringify({ lf, pl, lhit }));
    await shot(page, 'feel-landscape-wormholes.png');
    await page.evaluate(() => __peri.closeCard()); await page.waitForTimeout(300);
    await page.tap('#zone-r .btn'); await page.waitForTimeout(400);
    const sb = await page.evaluate(() => { const p = document.getElementById('sheet-panel'); const w = document.getElementById('sheet-worm'); w.scrollIntoView({ block: 'nearest' }); const r = w.getBoundingClientRect(), q = p.getBoundingClientRect();
      return { h: r.height, vis: r.top >= q.top - 1 && r.bottom <= q.bottom + 1, sh: p.scrollHeight, ch: p.clientHeight }; });
    check('landscape menu with "About wormholes": >= 44px and reachable (panel scrolls if needed)', sb.h >= 44 && sb.vis, JSON.stringify(sb));
    await shot(page, 'feel-landscape-menu-wormholes.png');
    await page.tap('#sheet [data-act="wormholes"]'); await page.waitForTimeout(400);
    check('landscape: card reopened from the sheet inside viewport', inside(await rectOf(page, '#pcard'), 844, 390, 4));
    check('no console errors (landscape wormholes)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
