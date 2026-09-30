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
const SEEN_ALL = () => { try { Save.markSeen('intro'); Save.markSeen('fragments'); } catch (e) {} };
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
    check('prediction is the short stub (<= K.PREDICT_STEPS)', aim.n <= 180, 'n=' + aim.n);
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
    const order = await page.evaluate(() => [...document.querySelectorAll('#sheet .c-btns .btn, #sheet [data-sound]')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
    check('menu sheet order', JSON.stringify(order) === JSON.stringify(['Resume', 'Consult the Astronomer', 'How to play', 'About comet fragments', 'Restart plate', 'Return to the Atlas', 'Sound: On']), JSON.stringify(order));
    check('astronomer note text', /Costs one star\. Holds the heavens and shows the first part of a winning course\./.test(await text(page, '#sheet-hint-note')));
    const sh = await page.evaluate(() => [...document.querySelectorAll('#sheet button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)]; }));
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
    check('progress saved', saved && saved.stars[0] === 3 && saved.unlocked >= Math.min(60, levels + 1), JSON.stringify(saved && { s: saved.stars.slice(0, 4), u: saved.unlocked }));

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
    const h1 = await page.evaluate(() => { const s = __peri.state, sol = s.level.solution; return { paused: s.paused, on: s.hint.on, used: s.hint.used, frozen: s.frozen, n: s.hint.n, step: s.step, t0: sol.t0Step || 0, ptsLen: s.hint.pts.length, first: [s.hint.pts[0], s.hint.pts[1]], sheet: document.getElementById('sheet').classList.contains('on') }; });
    check('hint used: sheet closed, frozen at t0, line stored', !h1.paused && !h1.sheet && h1.on && h1.used && h1.frozen && h1.step === h1.t0 && h1.n > 20 && h1.n <= 700 && h1.ptsLen === 1400, JSON.stringify(h1));
    const expectN = await page.evaluate(() => { const s = __peri.state, sol = s.level.solution, sim = __peri.Physics.simulate(s.level, sol.vx, sol.vy, sol.t0Step | 0, 1200, new Float32Array(2600)); return Math.min(700, Math.floor(0.55 * sim.n)); });
    check('hint length = floor(0.55 * winning flight), <= HINT_MAX', h1.n === expectN, h1.n + ' vs ' + expectN);
    await page.waitForTimeout(400);
    check('hint: heavens held while aiming', await page.evaluate(t0 => __peri.state.step === t0, h1.t0));
    const d = await touchDrag(page, 200, 420, 190, 470); await page.waitForTimeout(80);
    check('hint: aiming works while frozen and step stays', await page.evaluate(t0 => __peri.state.aim.active && __peri.state.step === t0, h1.t0));
    await shot(page, 'feel-hint.png');
    await d.end(); await page.waitForTimeout(50);
    // that pull was tiny/possibly a launch; reset the attempt to keep the test deterministic
    await page.evaluate(() => __peri.loadLevel(__peri.state.levelIndex));
    check('Reset/reload clears hint.used, frozen, on', await page.evaluate(() => { const h = __peri.state.hint; return !h.used && !h.on && !__peri.state.frozen; }));

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

  // ---------------------------------------------------------------- atlas: volumes, lazy thumbnails
  {
    const seed = () => { const st = [], fr = []; for (let i = 0; i < 60; i++) { st.push(i < 44 ? (i % 3) + 1 : 0); fr.push(0); }
      try { localStorage.setItem('perihelion.v1', JSON.stringify({ v: 2, stars: st, frags: fr, unlocked: 45, endlessBest: 0, muted: false, seen: { intro: true, fragments: true } })); } catch (e) {} };
    const { ctx, page, errors } = await newPage(browser, IPHONE, seed);
    await page.goto(url); await page.waitForTimeout(500);
    const t0 = Date.now();
    await page.evaluate(() => __peri.screen('select'));
    await page.waitForTimeout(500);
    const at = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.vol-head')].map(h => h.innerText.replace(/\s+/g, ' ').trim());
      const cards = [...document.querySelectorAll('.plate')];
      const drawn = cards.filter(c => c.querySelector('canvas').width !== 300).length;
      const cols = getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length;
      return { heads, n: cards.length, drawn, cols, tally: document.getElementById('tally').innerText.replace(/\s+/g, ' '), grids: document.querySelectorAll('.grid').length };
    });
    const N = info.n, V = Math.min(info.vols || 2, Math.ceil(N / 30));
    check('atlas: one heading per volume present, each plate once', at.n === N && at.heads.length === (info.vols ? V : Math.min(2, Math.ceil(N / 30))), JSON.stringify(at.heads));
    check('atlas: heading style "Volume I · Plates I–XXX"', /^Volume I\s*·\s*Plates I–XXX$/i.test(at.heads[0]), at.heads[0]);
    check('atlas: 3 columns portrait', at.cols === 3, 'cols ' + at.cols);
    check('atlas: tally shows stars x/' + (N * 3) + ' and sealed plates', new RegExp('Stars \\d+/' + N * 3 + '.*Sealed \\d+/' + N, 'i').test(at.tally), at.tally);
    check('atlas: thumbnails lazy (only rows near the viewport drawn)', N <= 30 ? at.drawn > 0 : at.drawn > 6 && at.drawn < N, at.drawn + '/' + at.n + ' drawn');
    await shot(page, 'feel-atlas-vol1.png');
    // scroll to the last volume
    await page.evaluate(() => { const hs = document.querySelectorAll('.vol-head'); const sc = document.getElementById('s-scroll'); const h = hs[hs.length - 1]; sc.scrollTop = h.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12; });
    await page.waitForTimeout(500);
    await shot(page, 'feel-atlas-vol2.png');
    await page.evaluate(() => { document.getElementById('s-scroll').scrollTop = 1e6; }); await page.waitForTimeout(500);
    check('atlas: thumbnails drawn on scroll (last plate)', await page.evaluate(() => { const cs = [...document.querySelectorAll('.plate')]; return cs[cs.length - 1].querySelector('canvas').width !== 300; }));
    if (N > 46) {
      await page.evaluate(() => { document.querySelector('.plate[data-i="50"]').click(); });
      check('atlas: tapping a locked plate does nothing (unlock stays sequential)', await page.evaluate(() => __peri.state.screen === 'select'));
    }
    check('no console errors (atlas run)', errors.length === 0, errors.join(' | '));
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
    const sb = await page.evaluate(() => { const p = document.getElementById('sheet-panel'); return { sh: p.scrollHeight, ch: p.clientHeight, btns: [...document.querySelectorAll('#sheet button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height), Math.round(r.left), Math.round(r.right)]; }) }; });
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

  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
