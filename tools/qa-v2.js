// PERIHELION — QA v2 feature blocks part 1 (owner: QA AGENT): save migration, popup cards, Consult the Astronomer.
const L = require('./qa-lib.js');
const { check, note, sleep, newPage, tapEl, cdpTap, touchDrag, touchHold, cardOn, frames, shot, text, rectOf, solutionPull, layoutAudit, SEED_SEEN, seedScript, zeros } = L;

// ================================================================= (a) v1 -> v2/v3 migration  [section 10] (Save.N is now 90: v1/v2 saves are padded with zeros)
async function migrate(browser, STD) {
  const S = '10';
  const v1 = { v: 1, stars: [3, 2, 1, 3, 2, 1, 3, 2, 1, 3, 2].concat(zeros(19)), frags: [1, 0, 2, 0, 1, 0, 0, 3, 0, 1, 0].concat(zeros(19)), unlocked: 12, endlessBest: 7, muted: false };
  {
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'migrate-a', init: [seedScript(v1)] });
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => { const D = __peri.Save.data; return { n: __peri.Save.N, sl: D.stars.length, fl: D.frags.length, s: D.stars.slice(0, 12), sTail: D.stars.slice(11).every(v => v === 0), f: D.frags.slice(0, 11), u: D.unlocked, e: D.endlessBest, m: D.muted, seen: D.seen, hasDaily: !!D.daily && D.daily.streak === 0, stats: Object.keys(D.stats).length, ach: Object.keys(D.ach).length, best: document.getElementById('t-best').innerText }; });
    check(S, 'v1 save: arrays padded to 90 (stars, frags)', r.n === 90 && r.sl === 90 && r.fl === 90, JSON.stringify({ n: r.n, sl: r.sl, fl: r.fl }));
    check(S, 'v1 save: stars / frags / unlocked / endlessBest / muted preserved', JSON.stringify(r.s.slice(0, 11)) === JSON.stringify(v1.stars.slice(0, 11)) && r.s[11] === 0 && r.sTail && JSON.stringify(r.f) === JSON.stringify(v1.frags.slice(0, 11)) && r.u === 12 && r.e === 7 && r.m === false, JSON.stringify({ s: r.s, u: r.u, e: r.e, m: r.m }));
    check(S, 'v1 save: v2 fields default (seen {}, daily empty, stats {}, ach {}) and title shows best survey 7', JSON.stringify(r.seen) === '{}' && r.hasDaily && r.stats === 0 && r.ach === 0 && /7/.test(r.best), JSON.stringify(r));
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
    const at = await page.evaluate(() => { const lk = i => document.querySelector('.plate[data-i="' + i + '"]').classList.contains('locked'); return { p12: lk(11), p13: lk(12), p31: lk(30), p60: lk(59), locked: document.querySelectorAll('.plate.locked').length, n: document.querySelectorAll('.plate').length }; });
    check(S, 'v1 save: atlas shows plates I–XII open, XIII onward and XXXI locked', !at.p12 && at.p13 && at.p31 && at.p60 && at.locked === 78 && at.n === 90, JSON.stringify(at));
    await page.evaluate(() => document.querySelector('.plate[data-i="30"]').click()); await page.waitForTimeout(150);
    check(S, 'v1 save: tapping locked plate XXXI does nothing', await page.evaluate(() => __peri.state.screen === 'select'));
    await tapEl(page, cdp, '.plate[data-i="11"]'); await page.waitForTimeout(600);
    const ic = await page.evaluate(() => ({ card: __peri.state.card, scr: __peri.state.screen }));
    check(S, 'migrated player (no seen flags) gets the intro card once on the first plate', ic.scr === 'play' && ic.card === 'intro', JSON.stringify(ic));
    check(S, 'no console errors (v1 migration A)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {   // plate 31 unlocks only after plate 30 is sealed
    const v1b = { v: 1, stars: zeros(30).map((_, i) => (i < 29 ? [3, 2, 1][i % 3] : 0)), frags: zeros(30), unlocked: 30, endlessBest: 2, muted: true };
    const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'migrate-b', init: [seedScript(v1b)] });
    await page.waitForTimeout(900);
    await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
    const a0 = await page.evaluate(() => { const lk = i => document.querySelector('.plate[data-i="' + i + '"]').classList.contains('locked'); return { p30: lk(29), p31: lk(30), u: __peri.Save.data.unlocked, muted: __peri.Save.data.muted }; });
    check(S, 'v1 save with 29 plates sealed: plate XXX open, plate XXXI locked, muted kept', !a0.p30 && a0.p31 && a0.u === 30 && a0.muted === true, JSON.stringify(a0));
    await page.evaluate(() => { __peri.loadLevel(29); __peri.solveCurrent(); __peri.fastForward(1400); });
    await page.evaluate(() => __peri.screen('select')); await page.waitForTimeout(500);
    const a1 = await page.evaluate(() => { const lk = i => document.querySelector('.plate[data-i="' + i + '"]').classList.contains('locked'); const raw = JSON.parse(localStorage.getItem('perihelion.v1')); return { p31: lk(30), p32: lk(31), u: __peri.Save.data.unlocked, s30: __peri.Save.data.stars[29], v: raw.v, sl: raw.stars.length, fl: raw.frags.length, prevOk: raw.stars.slice(0, 5).join() === '3,2,1,3,2' }; });
    check(S, 'sealing plate XXX unlocks XXXI (not XXXII); storage rewritten as v2 with 90-entry arrays, old stars intact', !a1.p31 && a1.p32 && a1.u === 31 && a1.s30 === 3 && a1.v === 2 && a1.sl === 90 && a1.fl === 90 && a1.prevOk, JSON.stringify(a1));
    await tapEl(page, cdp, '.plate[data-i="30"]'); await page.waitForTimeout(500);
    check(S, 'plate XXXI playable through the atlas after XXX is sealed', await page.evaluate(() => __peri.state.screen === 'play' && __peri.state.levelIndex === 30));
    check(S, 'no console errors (v1 migration B)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {   // garbage
    const bad = "{\"v\":1,\"stars\":[9,-1,\"x\",null,2],\"frags\":\"no\",\"unlocked\":\"lots\",\"endlessBest\":-5}";
    const { ctx, page, errors } = await newPage(browser, { url: STD, label: 'migrate-c', init: [`try { localStorage.setItem('perihelion.v1', ${JSON.stringify(bad)}); } catch (e) {}`] });
    await page.waitForTimeout(800);
    const g = await page.evaluate(() => { const D = __peri.Save.data; return { s: D.stars.slice(0, 6), sl: D.stars.length, u: D.unlocked, e: D.endlessBest }; });
    check(S, 'garbage v1 save is clamped (stars 0–3, arrays 90, unlocked from progress)', g.sl === 90 && g.s.join() === '3,0,0,0,2,0' && g.u === 6 && g.e === 0, JSON.stringify(g));
    await ctx.close();
    const c2 = await newPage(browser, { url: STD, label: 'migrate-d', init: [`try { localStorage.setItem('perihelion.v1', '{not json'); } catch (e) {}`] });
    await c2.page.waitForTimeout(800);
    check(S, 'unparseable save boots to a fresh v2 save', await c2.page.evaluate(() => __peri.state.screen === 'title' && __peri.Save.data.unlocked === 1 && __peri.Save.data.stars.length === 90) && c2.errors.length === 0, c2.errors.join(' | '));
    await c2.ctx.close();
    check(S, 'no console errors (garbage save)', errors.length === 0, errors.join(' | '));
  }
}

// ================================================================= (b) popup cards  [section 11]
async function cards(browser, STD, info) {
  const S = '11';
  const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'cards' });   // fresh: intro NOT seen
  await page.waitForTimeout(1000);
  const titleNoCard = await page.evaluate(() => __peri.state.card === null);
  await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
  await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(700);
  const ic = await page.evaluate(() => { const p = document.getElementById('pcard'); return { card: __peri.state.card, on: p.classList.contains('on'), t: p.innerText.replace(/\s+/g, ' '), li: p.querySelectorAll('.steps li').length, seen: __peri.Save.seen('intro'), phase: __peri.state.phase }; });
  check(S, 'intro card: not on the title, appears on first plate load (To Observe, 4 steps, Begin)', titleNoCard && ic.card === 'intro' && ic.on && /To Observe/i.test(ic.t) && ic.li === 4 && /Begin/.test(ic.t) && !ic.seen, JSON.stringify({ card: ic.card, li: ic.li }));
  const ia = await layoutAudit(page, 'intro card');
  metrics_set('introCard', ia.info.pcard);
  check(S, 'layout: intro card (portrait) — inside safe area, clear of HUD, ≥ 44 px buttons, no inner scroll', !ia.issues.length, ia.issues.join(' | '));
  await shot(page, 'qa-intro.png');
  // aiming blocked: a real drag starting on the canvas outside the card
  const pr = await rectOf(page, '#pcard');
  const y0 = pr.t > 150 ? pr.t - 50 : pr.b + 50;
  const hold = await touchHold(cdp, 195, y0, 150, y0 + 70, 8);
  const ab = await page.evaluate(() => ({ active: __peri.state.aim.active, n: __peri.state.predict.n }));
  await hold.end(); await page.waitForTimeout(120);
  const ab2 = await page.evaluate(() => ({ l: __peri.state.launches, ph: __peri.state.phase, n: __peri.state.predict.n }));
  check(S, 'intro card blocks aiming: a real touch drag on the canvas starts no aim and launches nothing', !ab.active && ab.n === 0 && ab2.l === 0 && ab2.ph === 'aim', JSON.stringify({ ab, ab2, y0 }));
  const s1 = await page.evaluate(() => __peri.state.step); await frames(page, 60);
  check(S, 'clock held while the intro card is open (60 frames)', await page.evaluate(s => __peri.state.step === s, s1), 'step ' + s1);
  await tapEl(page, cdp, '#pcard [data-act="pop-ok"]'); await page.waitForTimeout(450);
  const dz = await page.evaluate(() => ({ card: __peri.state.card, on: document.getElementById('pcard').classList.contains('on'), seen: __peri.Save.seen('intro'), raw: JSON.parse(localStorage.getItem('perihelion.v1')).seen }));
  check(S, 'Begin dismisses the intro card and stores seen.intro', dz.card === null && !dz.on && dz.seen && dz.raw.intro === true, JSON.stringify(dz));
  const s2 = await page.evaluate(() => __peri.state.step); await frames(page, 30);
  check(S, 'clock runs again after dismiss', await page.evaluate(s => __peri.state.step > s, s2));
  const hold2 = await touchHold(cdp, 195, 420, 170, 500, 8); const ab3 = await page.evaluate(() => ({ active: __peri.state.aim.active, n: __peri.state.predict.n })); await hold2.move(195, 420); await hold2.end();
  check(S, 'aiming works after the card is dismissed (prediction ≤ 270 points)', ab3.active && ab3.n > 5 && ab3.n <= 270, JSON.stringify(ab3));
  await page.reload(); await page.waitForTimeout(1000);
  await tapEl(page, cdp, '[data-act="begin"]'); await page.waitForTimeout(600);
  await tapEl(page, cdp, '.plate[data-i="0"]'); await page.waitForTimeout(700);
  check(S, 'intro card does not return after a reload', await page.evaluate(() => __peri.state.card === null && !document.getElementById('pcard').classList.contains('on') && __peri.Save.seen('intro')));

  // ---- fragments card on the first plate with fragments
  const F = info.fragPlate;
  await page.evaluate(i => __peri.loadLevel(i), F); await page.waitForTimeout(700);
  const fc = await page.evaluate(() => { const s = __peri.state; return { card: s.card, sp: s.spotlight && s.spotlight.map(p => [p.x, p.y]), fr: s.level.frags.map(p => [p.x, p.y]), t: document.getElementById('pcard').innerText.replace(/\s+/g, ' '), on: document.getElementById('pcard').classList.contains('on') }; });
  check(S, 'fragments card opens on the first plate with fragments (plate ' + (F + 1) + ') with the specified text', fc.card === 'fragments' && fc.on && /Comet Fragments/i.test(fc.t) && /Small brass comets drift on this plate/.test(fc.t) && /Understood/.test(fc.t), fc.t.slice(0, 120));
  check(S, 'spotlight = fragment world positions', fc.sp && JSON.stringify(fc.sp) === JSON.stringify(fc.fr), JSON.stringify(fc.sp));
  // rings actually drawn: bright pixels in the ring annulus with vs. without the spotlight
  const ringCount = () => page.evaluate(async () => {
    const P = __peri, S = P.state, Lo = P.Render.layout, cv = document.getElementById('game'), g = cv.getContext('2d'), d = cv.width / Lo.w; let tot = 0;
    for (const f of S.level.frags) {
      const p = P.Render.worldToScreen(f.x, f.y), R = 2.2 * K.FRAG_R * Lo.scale, x0 = Math.max(0, Math.floor((p.x - R - 4) * d)), y0 = Math.max(0, Math.floor((p.y - R - 4) * d)), w = Math.min(cv.width - x0, Math.ceil((R * 2 + 8) * d)), h = Math.min(cv.height - y0, Math.ceil((R * 2 + 8) * d));
      const im = g.getImageData(x0, y0, w, h).data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dist = Math.hypot((x0 + x) / d - p.x, (y0 + y) / d - p.y); if (Math.abs(dist - R) <= 2.5) { const k = (y * w + x) * 4; if (im[k] + im[k + 1] + im[k + 2] > 150) tot++; } }
    }
    return tot;
  });
  await frames(page, 4);
  const withRing = await ringCount();
  await page.evaluate(() => { window.__sp = __peri.state.spotlight; __peri.state.spotlight = null; }); await frames(page, 4);
  const withoutRing = await ringCount();
  await page.evaluate(() => { __peri.state.spotlight = window.__sp; }); await frames(page, 3);
  check(S, 'spotlight rings are drawn around the fragments (bright ring pixels on vs off)', withRing - withoutRing >= 25, 'on ' + withRing + ' / off ' + withoutRing);
  const fa = await layoutAudit(page, 'fragments card');
  check(S, 'layout: fragments card — clear of spotlight rings, HUD and notch; buttons ≥ 44', !fa.issues.length, fa.issues.join(' | ') + ' rings ' + fa.info.rings);
  const fr = await rectOf(page, '#pcard');
  const cy = await page.evaluate(() => { const f = __peri.state.level.frags; let y = 0; f.forEach(p => y += __peri.Render.worldToScreen(p.x, p.y).y); return y / f.length; });
  check(S, 'fragments card sits on the half of the screen away from the comets', cy < 422 ? fr.t >= 420 : fr.b <= 424, JSON.stringify({ card: [fr.t, fr.b], cy }));
  await shot(page, 'qa-fragments.png');
  await tapEl(page, cdp, '#pcard [data-act="pop-ok"]'); await page.waitForTimeout(450);
  check(S, 'Understood clears the spotlight and stores seen.fragments', await page.evaluate(() => __peri.state.card === null && __peri.state.spotlight === null && JSON.parse(localStorage.getItem('perihelion.v1')).seen.fragments === true));
  await page.reload(); await page.waitForTimeout(1000);
  await page.evaluate(i => __peri.loadLevel(i), F); await page.waitForTimeout(500);
  check(S, 'fragments card does not return after a reload', await page.evaluate(() => __peri.state.card === null && __peri.state.spotlight === null));

  // ---- reopen from the Menu sheet
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  const order = await page.evaluate(() => [...document.querySelectorAll('#sheet .c-btns .btn, #sheet [data-sound]')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
  check(S, 'Menu sheet lists Consult the Astronomer, How to play, About comet fragments', ['Consult the Astronomer', 'How to play', 'About comet fragments'].every(t => order.includes(t)), JSON.stringify(order));
  const ma = await layoutAudit(page, 'menu sheet');
  check(S, 'layout: Menu sheet (portrait) — targets ≥ 44, inside safe area', !ma.issues.length, ma.issues.join(' | '));
  await shot(page, 'qa-menu.png');
  await tapEl(page, cdp, '#sheet [data-act="howto"]'); await page.waitForTimeout(450);
  check(S, 'Menu → How to play reopens the intro card', await page.evaluate(() => __peri.state.card === 'intro' && document.getElementById('pcard').classList.contains('on')));
  await tapEl(page, cdp, '#pcard [data-act="pop-ok"]'); await page.waitForTimeout(400);
  await tapEl(page, cdp, '#sheet [data-act="fragments"]'); await page.waitForTimeout(450);
  check(S, 'Menu → About comet fragments reopens the fragments card with the spotlight', await page.evaluate(() => __peri.state.card === 'fragments' && !!__peri.state.spotlight));
  await tapEl(page, cdp, '#pcard [data-act="pop-ok"]'); await page.waitForTimeout(400);
  await tapEl(page, cdp, '#sheet [data-act="resume"]'); await page.waitForTimeout(250);
  check(S, 'resume after the reopened cards: game live, no card', await page.evaluate(() => !__peri.state.paused && !__peri.state.card));
  check(S, 'no console errors (cards)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
function metrics_set(k, v) { L.metrics[k] = v; }

// ================================================================= (c) Consult the Astronomer  [section 12]
async function hint(browser, STD, info) {
  const S = '12';
  const { ctx, page, cdp, errors } = await newPage(browser, { url: STD, label: 'hint', init: [SEED_SEEN] });
  await page.waitForTimeout(1000);
  // ---- invariants on all 90 plates through the hooks
  const all = await page.evaluate(() => {
    const P = __peri, S = P.state, out = [], buf = new Float32Array(2600);
    for (let i = 0; i < P.Levels.CAMPAIGN.length; i++) {
      P.loadLevel(i); P.fastForward(137);
      const lv = S.level, sol = P.Levels.clearFor(lv) || lv.solution, t0 = sol.t0Step | 0, stepBefore = S.step;
      const ok = P.useHint();
      const sim = P.Physics.simulate(lv, sol.vx, sol.vy, t0, 1200, buf);
      const h = S.hint;
      let expN; { const q = P.Physics.createSim(lv, sol.vx, sol.vy, t0); let tot = 0, got = 0, last = 0, wp = 0, lastW = 0; while (q.status === 'flying' && q.step < 1200) { P.Physics.stepSim(q, lv); tot++; const c = q.collected.reduce((a, b) => a + b, 0); if (c > got) { got = c; last = tot; } if (q.warps > wp) { wp = q.warps; lastW = tot; } }
        // rule (CONTRACT-v2 §10): 55%, or on to the last fragment + 24 steps (cap 92%), cap K.HINT_MAX. FEEL additionally runs the line on to the last warp passage + 24 steps (cap 92%) on wormhole courses (src/60-main.js useHint; feel-test covers it)
        expN = Math.floor(0.55 * tot); if (got) expN = Math.max(expN, Math.min(last + 24, Math.floor(0.92 * tot))); if (wp) expN = Math.max(expN, Math.min(lastW + 24, Math.floor(0.92 * tot))); expN = Math.min(1100, expN); }
      let prefix = h.n === expN;
      for (let k = 0; k < 2 * h.n && prefix; k++) if (h.pts[k] !== buf[k]) prefix = false;
      const copy = h.pts.slice(0, 2 * h.n);
      const fr = { frozen: S.frozen, step: S.step, on: h.on, used: h.used };
      const again = P.useHint();
      P.launch(sol.vx, sol.vy);
      const launchedStep = S.sim ? S.sim.t0Step : -1, hintOffAtLaunch = !S.hint.on && !S.frozen;
      P.fastForward(1400);
      const r = S.result;
      let live = !!r && r.n > h.n;   // live path holds the launch point first, Physics.simulate starts after step 1
      if (live) for (let k = 0; k < 2 * h.n; k++) if (r.pts[k + 2] !== copy[k]) { live = false; break; }
      out.push({ i, name: lv.name, ok, again, stepBefore, t0, fr, n: h.n, expN, simN: sim.n, prefix, launchedStep, hintOffAtLaunch, success: !!(r && r.success), stars: r && r.stars, card: /Astronomer consulted: one star forfeited/.test(document.getElementById('card').innerText), live, moving: lv.bodies.some(b => b.orbit), warps: S.sim ? S.sim.warps : -1 });
    }
    return out;
  });
  metrics_set('hintAll', all.map(a => ({ i: a.i, n: a.n, simN: a.simN })));
  check(S, 'useHint() succeeds on all ' + all.length + ' plates and freezes at solution t0Step (step nonzero before)', all.length === 90 && all.every(a => a.ok && a.fr.frozen && a.fr.on && a.fr.used && a.fr.step === a.t0), all.filter(a => !(a.ok && a.fr.frozen && a.fr.step === a.t0)).map(a => a.i + 1).join(','));
  check(S, 'hint length = 55% of the course (or on to the last fragment / last warp passage + 24 steps, ≤ 92%) ≤ 1100 on every plate; ' + all.filter(a => a.n === 1100).length + ' plates hit the cap', all.every(a => a.n === a.expN && a.n > 20 && a.n <= 1100), all.filter(a => a.n !== a.expN).map(a => a.i + 1).join(','));
  check(S, 'hint path is exactly the prefix of Physics.simulate(hint course) on every plate (float-exact)', all.every(a => a.prefix), all.filter(a => !a.prefix).map(a => a.i + 1).join(','));
  check(S, 'hint path is also the exact prefix of the live game flight when the hint course is launched (every plate)', all.every(a => a.live), all.filter(a => !a.live).map(a => a.i + 1).join(','));
  check(S, 'launching the hint course after the hint hits on all 90 plates with 2 stars; card says the astronomer line', all.every(a => a.success && a.stars === 2 && a.card && a.launchedStep === a.t0 && a.hintOffAtLaunch), all.filter(a => !(a.success && a.stars === 2 && a.card)).map(a => a.i + 1 + ':' + a.stars).join(','));
  check(S, 'hint unavailable once used (useHint() returns false the second time) on every plate', all.every(a => a.again === false));
  // ---- frozen for 60 real frames on a moving plate of each volume
  for (const i of [info.moving1, info.moving2, info.moving3]) {
    await page.evaluate(i => { __peri.loadLevel(i); __peri.fastForward(200); __peri.useHint(); }, i);
    const st = await page.evaluate(() => __peri.state.step); await frames(page, 60);
    const r = await page.evaluate(() => ({ step: __peri.state.step, fz: __peri.state.frozen, sim: __peri.Physics }));
    check(S, 'state.step does not advance over 60 frames while frozen (plate ' + (i + 1) + ', moving bodies)', r.step === st && r.fz, 'step ' + st + ' -> ' + r.step);
    const pv = await page.evaluate(() => {   // prediction uses the frozen step
      const P = __peri, S = P.state, sol = P.Levels.clearFor(S.level) || S.level.solution, dx = -sol.vx / 640 * 300 * 0.9, dy = -sol.vy / 640 * 300 * 0.9, v = P.Physics.launchVelocity(dx, dy);
      Object.assign(S.aim, { active: true, cancel: false, dx, dy, power: v.power, vx: v.vx, vy: v.vy }); P.fastForward(0);
      const ref = P.Physics.predict(S.level, v.vx, v.vy, S.step, new Float32Array(K.PREDICT_STEPS * 2 + 4));
      let same = ref.n === S.predict.n;
      const buf = new Float32Array(K.PREDICT_STEPS * 2 + 4); P.Physics.predict(S.level, v.vx, v.vy, S.step, buf);
      for (let k = 0; k < 2 * ref.n && same; k++) if (S.predict.pts[k] !== buf[k]) same = false;
      S.aim.active = false; S.aim.cancel = true; S.predict.n = 0; return { n: ref.n, same, step: S.step, t0: sol.t0Step | 0 };
    });
    check(S, 'prediction while frozen is computed at the frozen step (plate ' + (i + 1) + ')', pv.same && pv.step === pv.t0 && pv.n <= 270, JSON.stringify(pv));
  }
  // ---- UI flow through the Menu sheet on plate I with a real-touch win
  await page.evaluate(() => __peri.loadLevel(0)); await page.waitForTimeout(500);
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  const en = await page.evaluate(() => ({ dis: document.getElementById('sheet-hint').getAttribute('aria-disabled'), note: document.getElementById('sheet-hint-note').innerText }));
  check(S, 'Menu: Consult the Astronomer enabled while aiming, note says it costs one star', en.dis === 'false' && /Costs one star\./.test(en.note), JSON.stringify(en));
  await tapEl(page, cdp, '#sheet-hint'); await page.waitForTimeout(500);
  const u1 = await page.evaluate(() => { const s = __peri.state; return { paused: s.paused, sheet: document.getElementById('sheet').classList.contains('on'), on: s.hint.on, used: s.hint.used, fz: s.frozen, n: s.hint.n }; });
  check(S, 'tapping the item closes the sheet, resumes, shows the brass line and holds the heavens', !u1.paused && !u1.sheet && u1.on && u1.used && u1.fz && u1.n > 20, JSON.stringify(u1));
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  const un = await page.evaluate(() => ({ dis: document.getElementById('sheet-hint').getAttribute('aria-disabled'), why: document.getElementById('sheet-hint-why').innerText, hidden: document.getElementById('sheet-hint-why').hidden }));
  check(S, 'hint unavailable when already used: item aria-disabled and says why', un.dis === 'true' && !un.hidden && /Already consulted/.test(un.why), JSON.stringify(un));
  await tapEl(page, cdp, '#sheet-hint'); await page.waitForTimeout(200);
  check(S, 'tapping the disabled item does nothing (sheet stays open, hint unchanged)', await page.evaluate(() => __peri.state.paused && __peri.state.hint.used));
  await tapEl(page, cdp, '#sheet [data-act="resume"]'); await page.waitForTimeout(250);
  await tapEl(page, cdp, '#zone-l .btn'); await page.waitForTimeout(250);
  const rs = await page.evaluate(() => ({ used: __peri.state.hint.used, on: __peri.state.hint.on, fz: __peri.state.frozen, launches: __peri.state.launches }));
  check(S, 'Reset starts a new attempt: hint cleared, heavens released', !rs.used && !rs.on && !rs.fz && rs.launches === 0, JSON.stringify(rs));
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  check(S, 'Reset re-enables the hint in the Menu', await page.evaluate(() => document.getElementById('sheet-hint').getAttribute('aria-disabled') === 'false'));
  await tapEl(page, cdp, '#sheet-hint'); await page.waitForTimeout(500);
  const pull = await solutionPull(page);
  await touchDrag(cdp, 195, 420, 195 + pull.dx, 420 + pull.dy, 12, 150);
  await page.waitForTimeout(60);
  const l1 = await page.evaluate(() => ({ l: __peri.state.launches, fz: __peri.state.frozen, on: __peri.state.hint.on }));
  check(S, 'real-touch launch releases the heavens and drops the brass line', l1.l === 1 && !l1.fz && !l1.on, JSON.stringify(l1));
  let ok = true; try { await cardOn(page, 15000); } catch (e) { ok = false; }
  await page.waitForTimeout(1400);
  const w = await page.evaluate(() => ({ st: __peri.state.result && __peri.state.result.stars, saved: __peri.Save.data.stars[0], card: document.getElementById('card').innerText.replace(/\s+/g, ' ') }));
  check(S, 'one-launch hinted win by real touch = 2 stars; success card says "Astronomer consulted: one star forfeited"', ok && w.st === 2 && /Astronomer consulted: one star forfeited/.test(w.card), JSON.stringify(w));
  await shot(page, 'qa-hint-success.png');
  const wa = await layoutAudit(page, 'hinted success card');
  check(S, 'layout: hinted success card (extra line) fits', !wa.issues.length, wa.issues.join(' | '));
  // ---- hint state screenshot on a Volume II plate: brass line + vermilion prediction, real touch
  await page.evaluate(i => __peri.loadLevel(i), 44); await page.waitForTimeout(500);
  await tapEl(page, cdp, '#zone-r .btn'); await page.waitForTimeout(450);
  await tapEl(page, cdp, '#sheet-hint'); await page.waitForTimeout(600);
  await shot(page, 'qa-hint-held.png');
  const np = await solutionPull(page, 7, 0.97);
  const hd = await touchHold(cdp, 195, 420, 195 + np.dx, 420 + np.dy, 10); await page.waitForTimeout(350);
  const hs = await page.evaluate(() => ({ n: __peri.state.predict.n, hn: __peri.state.hint.n, fz: __peri.state.frozen, step: __peri.state.step, ro: null }));
  await shot(page, 'qa-hint.png');
  const ha = await layoutAudit(page, 'hint state');
  await hd.move(195, 420); await hd.end(); await page.waitForTimeout(100);
  check(S, 'hint state on plate 45: brass line (n=' + hs.hn + ') and the vermilion prediction (n=' + hs.n + ') are drawn together, heavens held', hs.hn > 20 && hs.n > 5 && hs.n <= 270 && hs.fz, JSON.stringify(hs));
  check(S, 'layout: hint state (label / note vs HUD)', !ha.issues.length, ha.issues.join(' | '));
  check(S, 'no console errors (astronomer)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

module.exports = { migrate, cards, hint };
