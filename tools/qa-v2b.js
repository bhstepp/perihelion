// PERIHELION — QA v2 feature blocks part 2 (owner: QA AGENT): Daily Plate, Observer's Log, Atlas, service worker.
const L = require('./qa-lib.js');
const { fs, path, ROOT, check, note, sleep, newPage, tapEl, cdpTap, touchDrag, touchHold, cardOn, frames, shot, text, rectOf, solutionPull, layoutAudit, SEED_SEEN, SEED_HALF, DATE_STUB, metrics, FINAL, volHead } = L;
const cp = require('child_process'), http = require('http'), os = require('os');

// ================================================================= (d) Daily Plate  [section 13]
async function daily(browser, STD) {
  const S = '13';
  // ---- pure logic in a fresh page (no UI)
  {
    const { ctx, page, errors } = await newPage(browser, { url: STD, label: 'daily-logic', init: [SEED_SEEN] });
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const Lv = __peri.Levels, out = {};
      const A = JSON.stringify(Lv.daily('2026-10-01')), B = JSON.stringify(Lv.daily('2026-10-01'));
      out.same = A === B;
      const keys = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-15', '2027-01-01'], sigs = keys.map(k => { const l = Lv.daily(k); return JSON.stringify([l.bodies, l.target, l.probe, l.name]); });
      out.distinct = new Set(sigs).size;
      out.fmt = []; const bad = [];
      for (let d = 0; d < 21; d++) {
        const dt = new Date(2026, 8, 25 + d, 12), k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        const l = Lv.daily(k), s = l.solution, hit = s && __peri.Physics.simulate(l, s.vx, s.vy, s.t0Step | 0, 1200).status === 'hit';
        if (!(l.id === 'd' + k && l.plate === 'DAILY' && /^DAILY · \d{1,2} [A-Z]{3} \d{4}$/.test(l.caption) && s && s.t0Step === 0 && hit && l.name)) bad.push(k);
      }
      out.bad = bad;
      // Save.recordDaily streaks (direct calls; fake consecutive days incl. month, year and leap-day boundaries)
      const Sv = __peri.Save; Sv.reset();
      const seq = k => Sv.recordDaily(k, 3, 1);
      const a = [seq('2026-09-29'), seq('2026-09-30'), seq('2026-10-01')];
      out.streak123 = a.map(x => x.streak).join(',') + '|best ' + a[2].best + '|first ' + a.map(x => x.first).join(',');
      const g = seq('2026-10-04'); out.gap = g.streak + '|best ' + g.best;
      const y = [seq('2026-12-31'), seq('2027-01-01')]; out.year = y.map(x => x.streak).join(',');
      const lp = [seq('2028-02-28'), seq('2028-02-29'), seq('2028-03-01')]; out.leap = lp.map(x => x.streak).join(',');
      const dst = [seq('2026-11-01'), seq('2026-11-02'), seq('2026-03-08'), seq('2026-03-09')]; out.dst = dst.map(x => x.streak).join(',');
      Sv.reset();
      const r1 = Sv.recordDaily('2026-10-10', 3, 1), r2 = Sv.recordDaily('2026-10-10', 1, 3), r3 = Sv.recordDaily('2026-10-10', 2, 2);
      out.retry = { first: [r1.first, r2.first, r3.first].join(), stars: Sv.data.daily.done['2026-10-10'], streak: Sv.data.daily.streak, improved: [r1.improved, r2.improved, r3.improved].join() };
      Sv.reset();
      return out;
    });
    check(S, 'Levels.daily(key) twice → identical level', r.same);
    check(S, 'five different keys → five different plates', r.distinct === 5, 'distinct ' + r.distinct);
    check(S, 'Levels.daily × 21 consecutive dates: id/plate/caption format, t0Step 0, stored solution hits', r.bad.length === 0, r.bad.join(','));
    check(S, 'Save.recordDaily: consecutive days → streak 1,2,3; best 3; only first seal counts as first', r.streak123 === '1,2,3|best 3|first true,true,true', r.streak123);
    check(S, 'Save.recordDaily: a skipped day resets the streak to 1, best stays 3', r.gap === '1|best 3', r.gap);
    check(S, 'Save.recordDaily: streak continues across year end, leap day 2028-02-29 and DST changes', r.year === '1,2' && r.leap === '1,2,3' && r.dst === '1,2,1,2', JSON.stringify({ year: r.year, leap: r.leap, dst: r.dst }));
    check(S, 'Save.recordDaily: a retry the same day is not "first", keeps the best stars (3 → stays 3), streak unchanged', r.retry.first === 'true,false,false' && r.retry.stars === 3 && r.retry.streak === 1 && r.retry.improved === 'true,false,false', JSON.stringify(r.retry));
    check(S, 'no console errors (daily logic)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // ---- UI with a stubbed Date
  const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'daily-ui', init: [DATE_STUB, SEED_SEEN] });
  await page.waitForTimeout(900);
  const sub0 = await text(page, '#t-daily');
  check(S, 'title subline before sealing: "Today’s plate"', /^Today.s plate$/.test(sub0), sub0);
  await shot(page, 'qa-title.png');
  await tapEl(page, cdp, '[data-act="daily"]'); await page.waitForTimeout(600);
  const d0 = await page.evaluate(() => ({ mode: __peri.state.mode, key: __peri.state.daily && __peri.state.daily.key, cap: __peri.state.level.caption, cs: __peri.Render.caption }));
  const dk = await page.evaluate(() => __peri.Save.dateKey());
  check(S, 'Daily Plate (real tap) loads today’s plate in daily mode with the DAILY caption', d0.mode === 'daily' && d0.key === dk && /^DAILY/.test(d0.cap), JSON.stringify(d0.cap));
  check(S, 'DAILY caption ≥ 10 px, unsqueezed (' + d0.cs.size + ' px, ' + (d0.cs.two ? 'two rows' : 'one row') + ')', d0.cs.size >= 10 && d0.cs.squeeze === 1, JSON.stringify(d0.cs));
  const da = await layoutAudit(page, 'daily play');
  check(S, 'layout: Daily plate (portrait, aiming)', !da.issues.length, da.issues.join(' | '));
  // fail first, then retry keeps working
  for (let k = 0; k < 3; k++) await page.evaluate(() => { __peri.launch(0, 640); __peri.fastForward(1300); });
  try { await cardOn(page); } catch (e) {}
  const ft = await text(page, '#card');
  check(S, 'daily fail card: Retry plate / Menu, no Next', /Retry plate/i.test(ft) && /Menu/i.test(ft) && !/Next/i.test(ft), ft);
  await tapEl(page, cdp, '#card [data-act="retry"]'); await page.waitForTimeout(200);
  // 3-star win
  await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page); await page.waitForTimeout(1500);
  const w1 = await page.evaluate(() => ({ card: document.getElementById('card').innerText.replace(/\s+/g, ' '), btns: [...document.querySelectorAll('#card .btn')].map(b => b.innerText.trim().toLowerCase()), st: __peri.state.result.stars, sv: JSON.parse(JSON.stringify(__peri.Save.data.daily)) }));
  check(S, 'daily result card: Sealed, ★★★, "A new plate is engraved tomorrow.", Streak 1, Replay / Menu only', w1.st === 3 && /A new plate is engraved tomorrow\./.test(w1.card) && /Streak 1/.test(w1.card) && JSON.stringify(w1.btns) === '["replay","menu"]', w1.card + ' ' + JSON.stringify(w1.btns));
  await shot(page, 'qa-daily-result.png');
  const wa = await layoutAudit(page, 'daily result');
  check(S, 'layout: daily result card', !wa.issues.length, wa.issues.join(' | '));
  // retry with a worse result keeps the best stars
  await tapEl(page, cdp, '#card [data-act="replay"]'); await page.waitForTimeout(250);
  await page.evaluate(() => { __peri.useHint(); __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page);
  const w2 = await page.evaluate(() => ({ st: __peri.state.result.stars, best: __peri.Save.data.daily.done[__peri.state.daily.key], streak: __peri.Save.data.daily.streak }));
  check(S, 'daily retry that earns only 2 stars keeps the best (3) and the streak (1)', w2.st === 2 && w2.best === 3 && w2.streak === 1, JSON.stringify(w2));
  await tapEl(page, cdp, '#card [data-act="title"]'); await page.waitForTimeout(500);
  const sub1 = await page.evaluate(() => ({ t: document.getElementById('t-daily').innerText.replace(/\s+/g, ' ').trim(), on: document.querySelectorAll('#t-daily svg.star.on').length }));
  check(S, 'title subline after sealing: "Sealed 3 stars · streak 1" with three lit stars', /^Sealed 3 stars · streak 1$/.test(sub1.t) && sub1.on === 3, JSON.stringify(sub1));
  await shot(page, 'qa-title-daily.png');
  const ta = await layoutAudit(page, 'title daily sealed');
  check(S, 'layout: title with the sealed Daily subline', !ta.issues.length, ta.issues.join(' | '));
  // next day, then a two-day gap
  const nextDay = async (off) => { await page.evaluate(o => { window.__dayOffset = o; Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }, off); await page.waitForTimeout(200); };
  await nextDay(1);
  check(S, 'next day: subline refreshes to "Today’s plate"', /^Today.s plate$/.test(await text(page, '#t-daily')));
  await tapEl(page, cdp, '[data-act="daily"]'); await page.waitForTimeout(500);
  const k1 = await page.evaluate(() => __peri.state.daily.key);
  await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page);
  check(S, 'new day: a different plate key, Streak 2 on the card', k1 !== dk && /Streak 2/.test(await text(page, '#card')), k1 + ' ' + await text(page, '#card'));
  await tapEl(page, cdp, '#card [data-act="title"]'); await page.waitForTimeout(400);
  check(S, 'title subline streak 2', /streak 2$/.test(await text(page, '#t-daily')), await text(page, '#t-daily'));
  await nextDay(4);
  check(S, 'after a two-day gap the subline is "Today’s plate" again', /^Today.s plate$/.test(await text(page, '#t-daily')));
  await tapEl(page, cdp, '[data-act="daily"]'); await page.waitForTimeout(500);
  await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); }); await cardOn(page);
  const gp = await page.evaluate(() => ({ card: document.getElementById('card').innerText.replace(/\s+/g, ' '), best: __peri.Save.data.daily.best }));
  check(S, 'streak restarts at 1 after the gap; Best 2 shown on the card', /Streak 1/.test(gp.card) && gp.best === 2 && /Best 2/.test(gp.card), JSON.stringify(gp));
  check(S, 'no console errors (daily UI)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================= (e) Observer's Log  [section 14]
async function log(browser, STD) {
  const S = '14';
  // ---- real play: seal plate I → First Light toast, touches pass through it
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'log-play', init: [SEED_SEEN] });
    await page.waitForTimeout(900);
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
    await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(600);
    const pull = await solutionPull(page);
    await touchDrag(cdp, 195, 380, 195 + pull.dx, 380 + pull.dy, 12, 150);
    let seen = null;
    try { await page.waitForFunction(() => { const t = document.querySelector('#logui-toasts .lg-toast.on .lg-tt'); return t && /First Light/i.test(t.textContent); }, null, { timeout: 15000, polling: 40 }); seen = true; } catch (e) { seen = false; }
    const tg = await page.evaluate(() => { const t = document.querySelector('#logui-toasts .lg-toast'), r = t && t.getBoundingClientRect(), Lo = __peri.Render.layout;
      return t && { txt: t.innerText.replace(/\s+/g, ' '), rect: [r.left, r.top, r.right, r.bottom], pe: getComputedStyle(t).pointerEvents, ach: Object.keys(__peri.Save.data.ach), hudBand: [Lo.plate.y - 41, Lo.plate.y - 14], scr: __peri.state.phase }; });
    check(S, 'real play: sealing plate I shows the First Light toast', seen && tg && /First Light/i.test(tg.txt) && tg.ach.includes('first_light'), JSON.stringify(tg));
    if (tg) {
      const ov = tg.rect[1] < tg.hudBand[1] && tg.rect[3] > tg.hudBand[0];
      metrics.toastVsHud = { toast: tg.rect.map(Math.round), hudBand: tg.hudBand.map(Math.round), overlapsHud: ov };
      check(S, 'toast does not cover the top HUD row (LAUNCH / caption / stars)', !ov, 'toast y ' + Math.round(tg.rect[1]) + '..' + Math.round(tg.rect[3]) + ' vs HUD text rows ' + tg.hudBand.map(Math.round).join('..'));
    }
    await page.waitForTimeout(1300);
    await shot(page, 'qa-toast.png');
    await page.waitForTimeout(400);
    // toast is transparent to touches: put a fresh one up over the canvas, drag starting under it
    await tapEl(page, cdp, '#card [data-act="replay"]'); await page.waitForTimeout(400);
    await page.waitForFunction(() => !document.querySelector('#logui-toasts .lg-toast'), null, { timeout: 20000, polling: 100 }).catch(() => {});
    await page.evaluate(() => { LogUI.toast('Threading the Needle', 'Win a flight that passes within 12 units of a body.', { ach: true }); });
    await page.waitForTimeout(500);
    const under = await page.evaluate(() => { const t = document.querySelector('#logui-toasts .lg-toast.on'), r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, e = document.elementFromPoint(x, y); return { x, y, hit: e && (e.id || e.tagName), inToast: !!(e && e.closest('#logui-toasts')) }; });
    const hd = await touchHold(cdp, under.x, under.y, under.x - 20, under.y + 90, 8);
    const ab = await page.evaluate(() => ({ active: __peri.state.aim.active, dy: __peri.state.aim.dy }));
    await hd.end(); await page.waitForTimeout(80);
    const l1 = await page.evaluate(() => __peri.state.launches);
    check(S, 'toast does not block touches: a drag starting under the banner aims and launches (pointer-events none)', !under.inToast && ab.active && ab.dy > 10 && l1 === 1, JSON.stringify({ under, ab, l1 }));
    // Observer's Log now lists First Light as recorded
    await page.evaluate(() => __peri.screen('title')); await page.waitForTimeout(4000);
    await tapEl(page, cdp, '[data-act="log"]'); await page.waitForTimeout(600);
    const lg = await page.evaluate(() => ({ on: document.getElementById('logui').classList.contains('on'), got: [...document.querySelectorAll('.lg-hon.got')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 40)), n: document.querySelectorAll('.lg-hon').length, total: __peri.Log.ACHIEVEMENTS.length, cnt: document.querySelector('.lg-count').textContent }));
    check(S, 'Observer’s Log opens from the title by touch; First Light is recorded, all ' + FINAL.HONOURS + ' honours listed (Log.ACHIEVEMENTS)', lg.on && lg.total === FINAL.HONOURS && lg.n === lg.total && lg.got.some(t => /First Light/i.test(t)), JSON.stringify(lg));
    check(S, 'no console errors (log play)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // ---- portrait & landscape screen behaviour, half-full save
  for (const land of [false, true]) {
    const tag = land ? 'landscape' : 'portrait';
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, landscape: land, label: 'log-screen-' + tag, init: [SEED_HALF] });
    await page.waitForTimeout(1000);
    await tapEl(page, cdp, '[data-act="log"]'); await page.waitForTimeout(600);
    const o = await page.evaluate(() => { const r = document.getElementById('logui'), sc = r.querySelector('.lg-scroll'), b = r.querySelector('.lg-back').getBoundingClientRect();
      return { on: r.classList.contains('on'), backW: b.width, backH: b.height, ovx: sc.scrollWidth > sc.clientWidth, sh: sc.scrollHeight, ch: sc.clientHeight, got: r.querySelectorAll('.lg-hon.got').length, n: r.querySelectorAll('.lg-hon').length, total: __peri.Log.ACHIEVEMENTS.length, cnt: r.querySelector('.lg-count').textContent, scr: __peri.state.screen }; });
    check(S, 'Observer’s Log opens from the title by touch (' + tag + '), 11 of ' + FINAL.HONOURS + ' honours, no horizontal overflow', o.on && o.got === 11 && o.n === o.total && o.total === FINAL.HONOURS && !o.ovx, JSON.stringify(o));
    check(S, 'log back button ≥ 44 px (' + tag + ')', o.backW >= 44 && o.backH >= 44, o.backW.toFixed(0) + '×' + o.backH.toFixed(0));
    await shot(page, land ? 'qa-landscape-log.png' : 'qa-log.png');
    const x = land ? 422 : 200, y0 = land ? 330 : 650, y1 = land ? 100 : 150;
    await touchDrag(cdp, x, y0, x, y1, 10); await page.waitForTimeout(500);
    const sc = await page.evaluate(() => ({ top: document.querySelector('.lg-scroll').scrollTop, body: [document.body.scrollTop, document.documentElement.scrollTop, window.scrollY] }));
    check(S, 'log scrolls by real touch swipe, page does not move (' + tag + ')', sc.top > 60 && sc.body.every(v => v === 0), JSON.stringify(sc));
    if (!land) await shot(page, 'qa-log-2.png');
    await page.evaluate(() => { document.querySelector('.lg-scroll').scrollTop = 1e6; }); await page.waitForTimeout(250);
    if (!land) await shot(page, 'qa-log-end.png');
    await tapEl(page, cdp, '.lg-back'); await page.waitForTimeout(500);
    const b = await page.evaluate(() => ({ on: document.getElementById('logui').classList.contains('on'), scr: __peri.state.screen, titleOn: document.getElementById('scr-title').classList.contains('on') }));
    check(S, 'back button returns to the title (' + tag + ')', !b.on && b.scr === 'title' && b.titleOn, JSON.stringify(b));
    check(S, 'no console errors (log screen ' + tag + ')', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ================================================================= (f) Atlas  [section 15]
async function atlas(browser, STD) {
  const S = '15';
  {   // fresh save: structure, locked, thumbnails, open time at 4x
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'atlas-fresh', init: [SEED_SEEN] });
    await page.waitForTimeout(1200);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // cold open: click Begin, time until the visible thumbnails are drawn and one frame has passed
    const t = await page.evaluate(async () => {
      const t0 = performance.now(), btn = document.querySelector('[data-act="begin"]'); btn.click();
      const vis = () => { const sc = document.getElementById('s-scroll').getBoundingClientRect(); return [...document.querySelectorAll('.plate')].filter(c => { const r = c.getBoundingClientRect(); return r.bottom > sc.top && r.top < sc.bottom; }); };
      let tScreen = performance.now() - t0, ready = null;
      for (let k = 0; k < 120; k++) { await new Promise(r => requestAnimationFrame(r)); const v = vis(); if (v.length && v.every(c => c.querySelector('canvas').width !== 300)) { ready = performance.now() - t0; break; } }
      await new Promise(r => requestAnimationFrame(r)); const frame = performance.now() - t0;
      return { tScreen, ready, frame, visible: vis().length };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    metrics.atlasOpen4x = t;
    check(S, 'opening the Atlas (cold, 4× CPU throttle) takes < 550 ms until visible thumbnails are drawn + a frame', t.ready != null && t.frame < 550, JSON.stringify(t));
    await page.waitForTimeout(400);
    // warm re-opens, also at 4x
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const warm = [];
    for (let k = 0; k < 4; k++) {
      await page.evaluate(() => __peri.screen('title')); await page.waitForTimeout(300);
      warm.push(await page.evaluate(async () => { const t0 = performance.now(); document.querySelector('[data-act="begin"]').click(); await new Promise(r => requestAnimationFrame(r)); await new Promise(r => requestAnimationFrame(r)); return +(performance.now() - t0).toFixed(1); }));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    metrics.atlasWarm4x = warm;
    check(S, 'warm re-opens of the Atlas at 4× throttle all < 400 ms', warm.every(v => v < 400), warm.join(', ') + ' ms');
    await page.waitForTimeout(500);
    const a = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.vol-head')].map(h => h.innerText.replace(/\s+/g, ' ').trim());
      const cards = [...document.querySelectorAll('.plate')], lk = cards.filter(c => c.classList.contains('locked'));
      const op = e => +getComputedStyle(e).opacity;
      const dim = c => Math.min(op(c), op(c.querySelector('.thumb')) * op(c)); const unl = cards[0], lkd = lk[0];
      const cols = getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length;
      const N = __peri.Levels.CAMPAIGN.length, idxLocked = lk.map(c => +c.dataset.i), okLocked = idxLocked.length === N - 1 && idxLocked[0] === 1;
      return { N, vols: __peri.Levels.VOLUMES, heads, n: cards.length, nLocked: lk.length, okLocked, plate31: cards[30].classList.contains('locked'), dimLocked: +dim(lkd).toFixed(2), dimOpen: +dim(unl).toFixed(2), cols, tally: document.getElementById('tally').innerText.replace(/\s+/g, ' '), grids: document.querySelectorAll('.grid').length,
        names: cards.slice(28, 34).map(c => c.querySelector('.pl-name').innerText) };
    });
    check(S, 'Atlas lists ' + FINAL.N + ' plates in ' + FINAL.VOLS + ' volumes with headings ' + FINAL.HEADS.map(h => '"' + h + '"').join(' / ') + ' (one per Levels.VOLUMES entry)', a.n === a.N && a.N === FINAL.N && a.grids === a.vols.length && a.vols.length === FINAL.VOLS && a.heads.length === FINAL.VOLS && a.heads.every((h, k) => h === FINAL.HEADS[k] && h === volHead(a.vols[k])), JSON.stringify(a.heads));
    check(S, 'fresh save: every plate but I locked (' + (FINAL.N - 1) + '), including all of Volumes II–V; only plate I open', a.nLocked === FINAL.N - 1 && a.okLocked && a.plate31, JSON.stringify({ nLocked: a.nLocked, plate31: a.plate31 }));
    check(S, 'locked plates are dimmed (thumb opacity ≤ .25 vs open plate 1)', a.dimLocked <= 0.25 && a.dimOpen >= 0.99, JSON.stringify({ locked: a.dimLocked, open: a.dimOpen }));
    check(S, 'Atlas is 3 columns in portrait; tally shows "Stars 0/' + 3 * FINAL.N + ' · Sealed 0/' + FINAL.N + '"', a.cols === 3 && new RegExp('Stars 0/' + 3 * FINAL.N + '.*Sealed 0/' + FINAL.N, 'i').test(a.tally), JSON.stringify({ cols: a.cols, tally: a.tally }));
    const th = await page.evaluate(() => {
      const sc = document.getElementById('s-scroll').getBoundingClientRect(), out = { vis: 0, drawn: 0, blank: 0, total: document.querySelectorAll('.plate').length, allDrawn: 0 };
      for (const c of document.querySelectorAll('.plate')) {
        const cv = c.querySelector('canvas'), drawn = cv.width !== 300; if (drawn) out.allDrawn++;
        const r = c.getBoundingClientRect(); if (r.bottom > sc.top && r.top < sc.bottom) { out.vis++; if (drawn) { out.drawn++; const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; if (n < 40) out.blank++; } }
      }
      return out;
    });
    check(S, 'thumbnails are drawn for every visible row and none is blank', th.vis >= 9 && th.drawn === th.vis && th.blank === 0, JSON.stringify(th));
    check(S, 'thumbnails are lazy: fewer than all ' + FINAL.N + ' canvases drawn before scrolling', th.allDrawn < th.total, th.allDrawn + '/' + th.total + ' drawn');
    // scroll to volume II by touch (real swipes), thumbnails follow
    for (let k = 0; k < 6; k++) { await touchDrag(cdp, 195, 700, 195, 250, 8); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => { const sc = document.getElementById('s-scroll').getBoundingClientRect(), v = [...document.querySelectorAll('.plate')].filter(c => { const r = c.getBoundingClientRect(); return r.bottom > sc.top && r.top < sc.bottom; }); return { first: +v[0].dataset.i, last: +v[v.length - 1].dataset.i, drawn: v.every(c => c.querySelector('canvas').width !== 300), top: document.getElementById('s-scroll').scrollTop }; });
    check(S, 'after touch-scrolling, the newly visible plates’ thumbnails are drawn', t2.drawn && t2.top > 500, JSON.stringify(t2));
    check(S, 'no console errors (atlas fresh)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {   // seeded mid-progress: Volume II-V screenshots
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'atlas-half', init: [SEED_HALF] });
    await page.waitForTimeout(1000);
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
    const toVol = k => page.evaluate(k => { const hs = document.querySelectorAll('.vol-head'), sc = document.getElementById('s-scroll'), h = hs[k]; sc.scrollTop = h.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12; }, k);
    await toVol(1); await page.waitForTimeout(700);
    await shot(page, 'qa-atlas-vol2.png');
    const au = await layoutAudit(page, 'atlas vol II');
    check(S, 'layout: Atlas Volume II (portrait)', !au.issues.length, au.issues.join(' | '));
    await toVol(2); await page.waitForTimeout(700);
    await shot(page, 'qa-atlas-vol3.png');
    const au3 = await layoutAudit(page, 'atlas vol III');
    check(S, 'layout: Atlas Volume III (portrait)', !au3.issues.length, au3.issues.join(' | '));
    for (const [k, nm] of [[3, 'IV'], [4, 'V']]) {
      await toVol(k); await page.waitForTimeout(700);
      await shot(page, 'qa-atlas-vol' + (k + 1) + '.png');
      const auk = await layoutAudit(page, 'atlas vol ' + nm);
      const th = await page.evaluate(k => { const g = document.querySelectorAll('.grid')[k], sc = document.getElementById('s-scroll').getBoundingClientRect(), v = g ? [...g.querySelectorAll('.plate')].filter(c => { const r = c.getBoundingClientRect(); return r.bottom > sc.top && r.top < sc.bottom; }) : [];
        return { vis: v.length, drawn: v.filter(c => c.querySelector('canvas').width !== 300).length, locked: v.filter(c => c.classList.contains('locked')).length }; }, k);
      check(S, 'Atlas Volume ' + nm + ' (portrait): layout audit clean; visible thumbnails drawn, all locked on this save', !auk.issues.length && th.vis >= 3 && th.drawn === th.vis && th.locked === th.vis, auk.issues.join(' | ') + ' ' + JSON.stringify(th));
    }
    const vs = await page.evaluate(() => { const lk = i => document.querySelector('.plate[data-i="' + i + '"]').classList.contains('locked'); return { p44: lk(44), p45: lk(45), tally: document.getElementById('tally').innerText.replace(/\s+/g, ' ') }; });
    check(S, 'seeded save (unlocked 45): plate XLV open, XLVI locked; tally counts ' + FINAL.N + ' plates (/' + 3 * FINAL.N + ' stars)', !vs.p44 && vs.p45 && new RegExp('/' + 3 * FINAL.N + '\\b').test(vs.tally) && new RegExp('/' + FINAL.N + '\\b').test(vs.tally), JSON.stringify(vs));
    check(S, 'no console errors (atlas seeded)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ================================================================= (i) service worker  [section 16]
function freePort() { return new Promise((res, rej) => { const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
function waitHttp(port, tries = 40) { return new Promise((res, rej) => { const go = n => { http.get({ host: '127.0.0.1', port, path: '/' }, r => { r.resume(); res(); }).on('error', () => n <= 0 ? rej(new Error('server did not start')) : setTimeout(() => go(n - 1), 150)); }; go(tries); }); }
async function serviceWorker(browser) {
  const S = '16', servers = [];
  const serve = async dir => { const port = await freePort(); const p = cp.spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' }); servers.push(p); await waitHttp(port); return port; };
  try {
    const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ver = (swSrc.match(/VERSION = '([0-9a-f]+)'/) || [])[1];
    const port = await serve(ROOT), base = 'http://127.0.0.1:' + port + '/';
    const { ctx, page, cdp, errors } = await newPage(browser, { url: base, label: 'sw', init: [SEED_SEEN], track: false });
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); const keys = await caches.keys(); return { scope: r && r.scope, active: !!(r && r.active), scriptURL: r && r.active && r.active.scriptURL, keys, ctl: !!navigator.serviceWorker.controller }; });
    check(S, 'service worker registers on http://127.0.0.1 and activates (scope ' + base + ')', reg.active && reg.scope === base && /\/sw\.js$/.test(reg.scriptURL || ''), JSON.stringify(reg));
    check(S, 'app cache is named perihelion-app-<build hash> (' + ver + ')', ver && reg.keys.includes('perihelion-app-' + ver), JSON.stringify(reg.keys));
    const pc = await page.evaluate(async v => { const c = await caches.open('perihelion-app-' + v); return (await c.keys()).map(r => new URL(r.url).pathname); }, ver);
    const need = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png'];
    check(S, 'precache holds index.html, manifest and the three icons', need.every(n => pc.includes(n)), JSON.stringify(pc));
    await page.reload(); await page.waitForTimeout(1200);
    check(S, 'after a reload the page is controlled by the worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
    await ctx.setOffline(true);
    await page.reload(); await page.waitForTimeout(1500);
    const off = await page.evaluate(() => ({ has: !!window.__peri, scr: window.__peri && __peri.state.screen, n: window.__peri && __peri.Levels.CAMPAIGN.length }));
    check(S, 'offline reload boots the game to the title from the cache', off.has && off.scr === 'title' && off.n === FINAL.N, JSON.stringify(off));
    await page.evaluate(() => { __peri.loadLevel(0); __peri.solveCurrent(); __peri.fastForward(1500); });
    let ok = true; try { await cardOn(page, 10000); } catch (e) { ok = false; }
    check(S, 'offline: plate I plays and seals (success card, 3 stars)', ok && await page.evaluate(() => __peri.state.result && __peri.state.result.stars === 3));
    const dl = await page.evaluate(async () => { try { __peri.loadDaily('2026-10-05'); return __peri.state.mode === 'daily'; } catch (e) { return false; } });
    check(S, 'offline: the Daily Plate loads (generated on device)', dl);
    await ctx.setOffline(false);
    check(S, 'no console errors (service worker, offline)', errors.length === 0, errors.join(' | '));
    await ctx.close();
    // ---- version bump in a scratch copy: new hash, old cache dropped, new content served
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peri-sw-'));
    for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
    fs.cpSync(path.join(ROOT, 'icons'), path.join(tmp, 'icons'), { recursive: true }); fs.cpSync(path.join(ROOT, 'src'), path.join(tmp, 'src'), { recursive: true }); fs.cpSync(path.join(ROOT, 'tools'), path.join(tmp, 'tools'), { recursive: true });
    cp.execSync('node tools/build.js', { cwd: tmp, stdio: 'ignore' });
    const vSame = (fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').match(/VERSION = '([0-9a-f]+)'/) || [])[1];
    check(S, 'rebuilding unchanged sources gives the same cache hash (deterministic build)', vSame === ver, vSame + ' vs ' + ver);
    const port2 = await serve(tmp), base2 = 'http://127.0.0.1:' + port2 + '/';
    const c2 = await newPage(browser, { url: base2, label: 'sw2', init: [SEED_SEEN], track: false });
    await c2.page.waitForTimeout(2000);
    const k0 = await c2.page.evaluate(() => caches.keys());
    fs.appendFileSync(path.join(tmp, 'src', '60-main.js'), '\n// qa-hash-probe\n');
    cp.execSync('node tools/build.js', { cwd: tmp, stdio: 'ignore' });
    const vNew = (fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').match(/VERSION = '([0-9a-f]+)'/) || [])[1];
    check(S, 'a source change gives a new cache name in sw.js (' + vSame + ' → ' + vNew + ')', vNew && vNew !== vSame);
    await c2.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    let k1 = null;
    for (let i = 0; i < 60; i++) { await sleep(250); k1 = await c2.page.evaluate(() => caches.keys()); if (k1.includes('perihelion-app-' + vNew) && !k1.includes('perihelion-app-' + vSame)) break; }
    await sleep(300); k1 = await c2.page.evaluate(() => caches.keys());
    check(S, 'update installs the new cache and the activate step deletes the old one', k1.includes('perihelion-app-' + vNew) && !k1.includes('perihelion-app-' + vSame), JSON.stringify({ before: k0, after: k1 }));
    const fresh = await c2.page.evaluate(async () => (await (await fetch('./index.html')).text()).includes('qa-hash-probe'));
    check(S, 'after the update index.html is served from the new cache', fresh);
    await c2.ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    check(S, 'service worker block ran', false, e && e.stack || String(e));
  } finally {
    for (const p of servers) { try { p.kill('SIGKILL'); } catch (e) {} }
  }
}

// ================================================================= persistence over a real http origin  [section 6]
// (file:// pages in headless Chromium lose localStorage on ~30% of immediate reloads — a harness quirk, 10/10 kept over http)
async function persist(browser) {
  const S = '6', servers = [];
  try {
    const port = await freePort(); servers.push(cp.spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' })); await waitHttp(port);
    const url = 'http://127.0.0.1:' + port + '/dist/perihelion.html';
    const { ctx, page, cdp, errors } = await newPage(browser, { url, label: 'persist', track: false });
    await page.waitForTimeout(900);
    await tapEl(page, cdp, '[data-act="sound"]'); await sleep(200);
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(500);
    await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(600);
    const intro = await page.evaluate(() => __peri.state.card);
    await tapEl(page, cdp, '#pcard [data-act="pop-ok"]'); await page.waitForTimeout(300);
    await page.evaluate(() => { __peri.solveCurrent(); __peri.fastForward(1500); });
    await page.evaluate(() => { __peri.loadDaily('2026-10-05'); __peri.solveCurrent(); __peri.fastForward(1500); });
    await page.reload(); await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({ muted: __peri.Save.data.muted, lbl: document.querySelector('#scr-title [data-sound]').textContent, u: __peri.Save.data.unlocked, s0: __peri.Save.data.stars[0], seen: __peri.Save.seen('intro'), day: __peri.Save.data.daily.done['2026-10-05'], ach: Object.keys(__peri.Save.data.ach).length, st: __peri.Save.stat('launches'), persistent: __peri.Save.persistent }));
    check(S, 'http origin: intro card shown on first plate, then mute, progress (plate I ★3 → unlocked 2), seen.intro, daily record and log stats all survive a reload', intro === 'intro' && r.muted && /Off/.test(r.lbl) && r.u === 2 && r.s0 === 3 && r.seen && r.day === 3 && r.ach >= 1 && r.st >= 2 && r.persistent, JSON.stringify(r));
    check(S, 'no console errors (http persistence)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  } catch (e) { check(S, 'persistence block ran', false, e && e.stack || String(e)); }
  finally { for (const p of servers) { try { p.kill('SIGKILL'); } catch (e) {} } }
}

module.exports = { daily, log, atlas, serviceWorker, persist };
