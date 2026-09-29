// Feel-agent browser QA: node tools/feel-test.js   (screens -> qa/feel-*.png)
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('playwright');
const path = require('path');
const build = require('./feel-build.js');
const QA = path.join(__dirname, '..', 'qa'); require('fs').mkdirSync(QA, { recursive: true });
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); }

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

(async () => {
  const { file, levels, stub } = build();
  const url = 'file://' + file;
  console.log('testing', url, 'levels', levels, stub ? '(stub levels swapped in)' : '');
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- main iPhone run
  {
    const { ctx, page, errors } = await newPage(browser, IPHONE);
    await page.goto(url);
    await page.waitForTimeout(700);
    check('hooks present', await page.evaluate(() => !!(window.__peri && __peri.state && __peri.loadLevel && __peri.solveCurrent)));
    check('title screen', await page.evaluate(() => __peri.state.screen === 'title'));
    await page.screenshot({ path: path.join(QA, 'feel-title.png') });

    await page.tap('[data-act="begin"]');
    await page.waitForTimeout(450);
    check('select via tap', await page.evaluate(() => __peri.state.screen === 'select'));
    const nCards = await page.$$eval('.plate', b => b.length);
    check('plate cards = campaign length', nCards === levels, nCards + ' cards');
    await page.screenshot({ path: path.join(QA, 'feel-select.png') });
    // tapping a sealed plate does nothing
    if (nCards > 1) { await page.tap('.plate[data-i="1"]', { force: true }); await page.waitForTimeout(100); check('locked plate ignored', await page.evaluate(() => __peri.state.screen === 'select')); }

    await page.tap('.plate[data-i="0"]');
    await page.waitForTimeout(450);
    check('play plate I via tap', await page.evaluate(() => __peri.state.screen === 'play' && __peri.state.levelIndex === 0 && __peri.state.phase === 'aim'));
    check('first-run hint visible', await page.evaluate(() => document.getElementById('hint').classList.contains('on')));
    const hr = await page.evaluate(() => { const h = document.getElementById('hint').getBoundingClientRect(); return { b: h.bottom, l: h.left, r: h.right, by: __peri.Render.layout.bottom.y }; });
    check('hint clear of bottom band', hr.b < hr.by - 6 && hr.l >= 0 && hr.r <= 390, JSON.stringify(hr));
    const lay = await page.evaluate(() => { const L = __peri.Render.layout; const r = document.querySelector('#zone-l .btn').getBoundingClientRect(), q = document.querySelector('#zone-r .btn').getBoundingClientRect();
      return { b: L.bottom, l: [r.left, r.top, r.width, r.height], r: [q.left, q.top, q.width, q.height], w: L.w }; });
    const inZone = (e, left) => e[1] >= lay.b.y - 1 && e[1] + e[3] <= lay.b.y + lay.b.h + 1 && e[3] >= 44 &&
      (left ? e[0] >= 0 && e[0] + e[2] <= lay.b.x + lay.b.w * 0.25 + 1 : e[0] >= lay.b.x + lay.b.w * 0.75 - 1 && e[0] + e[2] <= lay.w);
    check('HUD buttons inside bottom 25% zones, >=44px', inZone(lay.l, true) && inZone(lay.r, false), JSON.stringify(lay));

    // drag-launch with real touch events: start mid-screen, pull down-left (launch up-right)
    const d = await touchDrag(page, 200, 420, 150, 560);
    await page.waitForTimeout(60);
    const aim = await page.evaluate(() => ({ ...__peri.state.aim, n: __peri.state.predict.n }));
    check('aiming via touch drag', aim.active && !aim.cancel && aim.n > 10 && aim.dy > 0, JSON.stringify(aim));
    await page.screenshot({ path: path.join(QA, 'feel-aim.png') });
    await d.end();
    await page.waitForTimeout(80);
    const fl = await page.evaluate(() => ({ phase: __peri.state.phase, launches: __peri.state.launches, vy: __peri.state.sim && __peri.state.sim.vy }));
    check('touch release launches', fl.launches === 1 && (fl.phase === 'flight' || fl.phase === 'result') && fl.vy < 0, JSON.stringify(fl));
    await page.waitForTimeout(700);
    check('hint faded after first launch', await page.evaluate(() => !document.getElementById('hint').classList.contains('on')));
    await page.screenshot({ path: path.join(QA, 'feel-flight.png') });

    // cancel: tiny pull does nothing
    await page.evaluate(() => __peri.loadLevel(0));
    const d2 = await touchDrag(page, 200, 400, 205, 410, 3); await d2.end(); await page.waitForTimeout(50);
    check('short pull cancels', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.phase === 'aim'));

    // multi-touch: second finger ignored
    {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400, id: 1 }, { x: 300, y: 300, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400, id: 1 }, { x: 330, y: 500, id: 2 }] });
      const a = await page.evaluate(() => ({ ...__peri.state.aim }));
      check('second finger ignored', a.active && Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1, JSON.stringify(a));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }

    // solveCurrent on every level
    for (let i = 0; i < levels; i++) {
      await page.evaluate(i => { __peri.loadLevel(i); }, i);
      const t0 = Date.now();
      const sol = await page.evaluate(() => __peri.solveCurrent());
      if (!sol) { check('solveCurrent plate ' + (i + 1), false, 'no solution'); continue; }
      try { await cardOn(page); } catch (e) {}
      const r = await page.evaluate(() => ({ res: __peri.state.result && { s: __peri.state.result.success, st: __peri.state.result.stars }, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
      check('solveCurrent plate ' + (i + 1) + ' -> success card', r.res && r.res.s && /Sealed|Surveyed/.test(r.card), (Date.now() - t0) + 'ms ' + r.card);
      if (i === 0) {
        await page.waitForTimeout(400);
        const cr = await page.evaluate(() => { const r = document.getElementById('card').getBoundingClientRect(), L = __peri.Render.layout, lv = __peri.state.level;
          const t = __peri.Render.worldToScreen(lv.target.x, lv.target.y + lv.target.r);
          return { r: [r.left, r.top, r.right, r.bottom, r.height], ty: t.y, pb: L.plate.y + L.plate.h }; });
        check('portrait card compact, in lower plate, clear of target', cr.r[4] <= 232 && cr.r[0] >= 0 && cr.r[2] <= 390 && cr.r[3] <= cr.pb && cr.r[1] > cr.ty + 20, JSON.stringify(cr));
        await page.screenshot({ path: path.join(QA, 'feel-success.png') });
      }
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('perihelion.v1')));
    check('progress saved', saved && saved.stars[0] === 3 && saved.unlocked >= Math.min(30, levels + 1), JSON.stringify(saved && { s: saved.stars.slice(0, 4), u: saved.unlocked }));

    // "Next plate" button from card
    await page.evaluate(() => { __peri.loadLevel(0); __peri.solveCurrent(); });
    await cardOn(page);
    await page.tap('#card [data-act="next"]');
    await page.waitForTimeout(200);
    check('Next plate button', await page.evaluate(() => __peri.state.levelIndex === 1 && __peri.state.phase === 'aim'));

    // fail flow: 3 launches straight down (lost)
    await page.evaluate(() => __peri.loadLevel(0));
    for (let k = 0; k < 3; k++) {
      await page.evaluate(() => { __peri.launch(0, 640); __peri.fastForward(1300); });
    }
    const fs1 = await page.evaluate(() => ({ ph: __peri.state.phase, l: __peri.state.launches, g: __peri.state.ghosts.length, r: __peri.state.result }));
    check('3 misses -> result fail', fs1.ph === 'result' && fs1.l === 3 && fs1.r && fs1.r.success === false && fs1.g === 2, JSON.stringify({ ph: fs1.ph, l: fs1.l, g: fs1.g }));
    try { await cardOn(page); } catch (e) {}
    const failTxt = await page.evaluate(() => document.getElementById('card').innerText.replace(/\s+/g, ' '));
    check('fail card shown', /Retry plate/i.test(failTxt), failTxt);
    await page.screenshot({ path: path.join(QA, 'feel-fail.png') });
    await page.tap('#card [data-act="retry"]');
    await page.waitForTimeout(150);
    check('Retry resets attempt', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.phase === 'aim' && __peri.state.ghosts.length === 0));

    // real-time miss -> probe resets to aim after ~600 ms
    await page.evaluate(() => __peri.launch(0, 640));
    await page.waitForFunction(() => __peri.state.phase === 'aim', null, { timeout: 8000 }).catch(() => {});
    check('probe resets after miss', await page.evaluate(() => __peri.state.phase === 'aim' && __peri.state.launches === 1 && __peri.state.ghosts.length === 1));
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(QA, 'feel-miss.png') });

    // pause sheet via Atlas button, then resume
    await page.tap('#zone-r .btn');
    await page.waitForTimeout(350);
    const st0 = await page.evaluate(() => __peri.state.step);
    await page.waitForTimeout(300);
    check('Atlas opens pause sheet; time frozen', await page.evaluate(s => __peri.state.paused && __peri.state.step === s && document.getElementById('sheet').classList.contains('on'), st0));
    await page.screenshot({ path: path.join(QA, 'feel-pause.png') });
    await page.tap('#sheet [data-act="resume"]');
    await page.waitForTimeout(150);
    check('resume', await page.evaluate(() => !__peri.state.paused));
    // visibilitychange pause
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    check('visibilitychange pauses', await page.evaluate(() => __peri.state.paused));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.mouse.click(195, 120); // tap on veil (outside panel) resumes
    await page.touchscreen.tap(195, 120);
    await page.waitForTimeout(100);
    check('tap-to-resume', await page.evaluate(() => !__peri.state.paused));

    // Reset button
    await page.tap('#zone-l .btn'); await page.waitForTimeout(80);
    check('Reset button restarts attempt', await page.evaluate(() => __peri.state.launches === 0 && __peri.state.ghosts.length === 0));

    // endless from title
    await page.evaluate(() => __peri.screen('title'));
    await page.waitForTimeout(350);
    await page.tap('[data-act="endless"]');
    await page.waitForTimeout(400);
    const en = await page.evaluate(() => ({ m: __peri.state.mode, s: __peri.state.screen, r: __peri.state.endless.round, cap: __peri.state.level.caption, plate: __peri.state.level.plate }));
    check('endless starts', en.m === 'endless' && en.s === 'play' && en.r === 1 && en.plate === 'I', JSON.stringify(en));
    await page.evaluate(() => __peri.solveCurrent());
    await cardOn(page).catch(() => {});
    const en2 = await page.evaluate(() => ({ sc: __peri.state.endless.score, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
    check('endless round scored', en2.sc === 3 && /Next plate/.test(en2.card), JSON.stringify(en2));
    await page.screenshot({ path: path.join(QA, 'feel-endless-card.png') });
    await page.tap('#card [data-act="next"]'); await page.waitForTimeout(150);
    check('endless round 2', await page.evaluate(() => __peri.state.endless.round === 2 && __peri.state.level.plate === 'II'));
    for (let k = 0; k < 3; k++) await page.evaluate(() => { __peri.launch(0, 640); __peri.fastForward(1300); });
    await cardOn(page).catch(() => {});
    const en3 = await page.evaluate(() => ({ best: JSON.parse(localStorage.getItem('perihelion.v1')).endlessBest, card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
    check('endless run ends on failed round, best saved', en3.best === 3 && /Concluded/.test(en3.card), JSON.stringify(en3));
    await page.screenshot({ path: path.join(QA, 'feel-endless-over.png') });

    // mute toggle persists
    await page.evaluate(() => __peri.screen('title')); await page.waitForTimeout(300);
    await page.tap('#scr-title [data-act="sound"]');
    const mu = await page.evaluate(() => ({ t: document.querySelector('#scr-title [data-sound]').textContent, s: JSON.parse(localStorage.getItem('perihelion.v1')).muted, a: __peri.Sound.state }));
    check('mute toggle persists', mu.t === 'Sound: Off' && mu.s === true, JSON.stringify(mu));
    await page.tap('#scr-title [data-act="sound"]');

    // reload keeps progress; fps sane
    await page.reload(); await page.waitForTimeout(1200);
    const rl = await page.evaluate(() => ({ u: __peri.Save.data.unlocked, fps: __peri.fps() }));
    check('reload keeps progress', rl.u >= 2, JSON.stringify(rl));
    check('fps hook', rl.fps > 20, rl.fps.toFixed(1));
    await page.tap('[data-act="begin"]'); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(QA, 'feel-select-progress.png') });

    check('no console errors (iPhone run)', errors.length === 0, errors.join(' | '));
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
    await page.tap('.plate[data-i="0"]'); await page.waitForTimeout(300);
    await page.evaluate(() => __peri.solveCurrent());
    await cardOn(page).catch(() => {});
    const r = await page.evaluate(() => ({ ok: __peri.state.result && __peri.state.result.success, u: __peri.Save.data.unlocked, p: __peri.Save.persistent }));
    check('storage throwing: plays & keeps in-memory progress', r.ok && r.u === 2 && r.p === false, JSON.stringify(r));
    check('no console errors (no-storage run)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- desktop mouse + landscape
  {
    const { ctx, page, errors } = await newPage(browser, { viewport: { width: 1280, height: 800 } });
    await page.goto(url); await page.waitForTimeout(400);
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(300);
    await page.mouse.move(640, 300); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(640 - 8 * i, 300 + 20 * i); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(60);
    check('desktop mouse drag launches', await page.evaluate(() => __peri.state.launches === 1));
    await page.screenshot({ path: path.join(QA, 'feel-desktop.png') });
    check('no console errors (desktop)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await newPage(browser, { ...IPHONE, viewport: { width: 844, height: 390 } });
    await page.goto(url); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(QA, 'feel-landscape-title.png') });
    await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(QA, 'feel-landscape-play.png') });
    await page.evaluate(() => __peri.solveCurrent()); await cardOn(page).catch(() => {}); await page.waitForTimeout(400);
    const lc = await page.evaluate(() => { const r = document.getElementById('card').getBoundingClientRect(), p = __peri.Render.layout.plate;
      return { r: [r.left, r.top, r.right, r.bottom], p: [p.x, p.x + p.w] }; });
    check('landscape card inside viewport, beside plate', lc.r[0] >= 0 && lc.r[1] >= 0 && lc.r[2] <= 844 && lc.r[3] <= 390 && (lc.r[0] >= lc.p[1] || lc.r[2] <= lc.p[0]), JSON.stringify(lc));
    await page.screenshot({ path: path.join(QA, 'feel-landscape-card.png') });
    check('no console errors (landscape)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
