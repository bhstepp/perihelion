// Render-agent harness: node tools/render-harness.js
// Builds a tiny page (K, Physics, Levels, Render + a canvas), drives `state` by hand (the new v2 fields: hint, frozen,
// spotlight, daily caption, hint-used stars), screenshots the scenes to qa/render-*.png and prints timings.
// Runs at iPhone 14 emulation (390x844, DPR 3) with Render at dpr 2 (the game caps dpr at 2).
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), QA = path.join(ROOT, 'qa');
fs.mkdirSync(QA, { recursive: true });
const S = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const SCENES = process.argv.slice(2);           // optional filter: scene names

const HARNESS = `
window.H = (function () {
  var cv = document.getElementById('game'), NOW = 5000;
  Render.init(cv);
  Render.resize(390, 844, 2, { top: 47, bottom: 34, left: 0, right: 0 });
  function lv(i) { return Levels.CAMPAIGN[i]; }
  function mkState(level) {
    return { screen: 'play', paused: false, mode: 'campaign', level: level, levelIndex: level.index, step: 0, phase: 'aim',
      aim: { active: false, dx: 0, dy: 0, power: 0, vx: 0, vy: 0, cancel: true },
      predict: { pts: new Float32Array(K.PREDICT_STEPS * 2), n: 0 }, sim: null,
      trail: { pts: new Float32Array(K.TRAIL_MAX * 2), head: 0, n: 0 }, ghosts: [], launches: 0,
      collected: new Uint8Array(8), result: null, hud: { speed: 0, closest: Infinity },
      endless: { round: 0, score: 0, best: 0 } };
  }
  // pull the sling so the launch velocity is (vx, vy) (world units of pull = -v / VMAX * DRAG_MAX)
  function pullFor(st, vx, vy) {
    var dx = -vx / K.VMAX * K.DRAG_MAX, dy = -vy / K.VMAX * K.DRAG_MAX;
    setPull(st, dx, dy);
  }
  function setPull(st, dx, dy) {
    var a = st.aim, v = Physics.launchVelocity(dx, dy);
    a.active = true; a.dx = dx; a.dy = dy; a.cancel = !!v.cancel; a.vx = v.vx || 0; a.vy = v.vy || 0; a.power = v.power || 0;
    if (!a.cancel) { var sim = Physics.predict(st.level, a.vx, a.vy, st.step, st.predict.pts); st.predict.n = sim.n; } else st.predict.n = 0;
  }
  function pullDir(st, ang, len) { setPull(st, Math.cos(ang) * len, Math.sin(ang) * len); }
  var hbuf = new Float32Array(K.HINT_MAX * 2 + 4);
  function setHint(st, on, t0) {
    var sol = st.level.solution, sim = Physics.simulate(st.level, sol.vx, sol.vy, sol.t0Step || 0, K.MAX_STEPS, hbuf);
    var n = Math.min(K.HINT_MAX, Math.floor(0.55 * sim.n));
    var pts = new Float32Array(K.HINT_MAX * 2); for (var i = 0; i < n * 2; i++) pts[i] = hbuf[i];
    st.hint = { on: on !== false, used: true, pts: pts, n: n, t0: t0 === undefined ? NOW - 1000 : t0 };
  }
  function draw(st, now) { Render.frame(st, now === undefined ? NOW : now); }
  function scene(name, opt) {
    opt = opt || {};
    var level = opt.level || lv(opt.i || 0), st = mkState(level);
    if (opt.caption) { level = Object.assign({}, level, { caption: opt.caption }); st.level = level; }
    if (opt.pull) pullFor(st, opt.pull[0], opt.pull[1]);
    if (opt.pullDir) pullDir(st, opt.pullDir[0], opt.pullDir[1]);
    if (opt.hint) setHint(st, true, opt.hintT0);
    if (opt.hintUsedOnly) { setHint(st, false); }
    if (opt.frozen) st.frozen = true;
    if (opt.spotlight) st.spotlight = level.frags.map(function (f) { return { x: f.x, y: f.y }; });
    if (opt.launches) st.launches = opt.launches;
    st.step = opt.step || 0;
    Render.setLevel(level);
    draw(st); draw(st, NOW + 16);
    return st;
  }
  // 300 frames with prediction + hint + spotlight all on, moving bodies advancing 2 steps per frame
  function timeFrames(opt) {
    var level = lv(opt.i), st = mkState(level);
    pullFor(st, level.solution.vx, level.solution.vy); setHint(st, true);
    st.spotlight = (level.frags || []).map(function (f) { return { x: f.x, y: f.y }; });
    st.frozen = !!opt.frozen; st.level = level;
    if (opt.flight) {    // real mid-flight: live sim stepping + trail (hint/predict are aim-phase items and drop out)
      st.phase = 'flight'; st.launches = 1; st.hint.on = false;
      st.sim = Physics.createSim(level, level.solution.vx, level.solution.vy, 0);
    }
    Render.setLevel(level);
    for (var w = 0; w < 30; w++) { advance(st); draw(st, NOW + w * 16.7); }
    var ts = [], t, now = NOW + 600;
    for (var f = 0; f < 300; f++) {
      advance(st); now += 16.7;
      if (!opt.flight) setPull(st, st.aim.dx, st.aim.dy);
      t = performance.now(); draw(st, now); ts.push(performance.now() - t);
    }
    function advance(st) {
      if (opt.flight) {
        for (var k = 0; k < 2 && st.sim.status === 'flying'; k++) Physics.stepSim(st.sim, level);
        var tr = st.trail, cap = tr.pts.length >> 1;
        tr.pts[2 * tr.head] = st.sim.x; tr.pts[2 * tr.head + 1] = st.sim.y; tr.head = (tr.head + 1) % cap; tr.n = Math.min(cap, tr.n + 1);
        st.step = st.sim.step;
        if (st.sim.status !== 'flying') { st.sim = Physics.createSim(level, level.solution.vx, level.solution.vy, 0); tr.n = 0; }
      } else st.step += 2;
    }
    ts.sort(function (a, b) { return a - b; });
    var sum = 0; for (var i = 0; i < ts.length; i++) sum += ts[i];
    return { avg: sum / ts.length, p95: ts[Math.floor(ts.length * 0.95)], max: ts[ts.length - 1] };
  }
  // thumbnails: 60 plates (the campaign cycled until the LEVEL agent's plates 31-60 exist)
  function thumbTime(w, h, dpr) {
    var list = Levels.CAMPAIGN, cs = [];
    for (var i = 0; i < 60; i++) { var c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr; cs.push(c); }
    function run() {
      var t = performance.now();
      for (var i = 0; i < 60; i++) { var g = cs[i].getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); Render.drawThumbnail(g, list[i % list.length], w, h); }
      return performance.now() - t;
    }
    var first = run(), best = 1e9; for (var r = 0; r < 3; r++) best = Math.min(best, run());
    return { first: first, warm: best, levels: list.length };
  }
  // caption fit for plate numbers 1..60 (roman numerals) with a set of names, incl. worst-case long ones
  function captions() {
    var names = ['First Light', 'The Retinue', 'A Wandering Moon', 'The Grand Procession of Moons', 'Two Lanterns'];
    var out = [], worst = { size: 99 }, twoRows = 0, squeezed = 0, base = lv(0), n = 0;
    Levels.CAMPAIGN.forEach(function (l) { names.push(l.name); });
    for (var i = 1; i <= 60; i++) {
      for (var j = 0; j < names.length; j++) {
        var L = Object.assign({}, base, { index: i - 1, plate: toRoman(i), name: names[j], caption: undefined, seed: 100 + i * 7 + j });
        var st = mkState(L); Render.setLevel(L); draw(st);
        var c = Render.caption; n++;
        if (c.two) twoRows++; if (c.squeeze < 0.999) squeezed++;
        if (c.size < worst.size || (c.size === worst.size && c.squeeze < (worst.squeeze || 1))) worst = { text: c.text, size: c.size, two: c.two, squeeze: c.squeeze };
      }
    }
    var daily = Object.assign({}, base, { caption: 'DAILY \\u00b7 30 SEP 2026', plate: 'DAILY' });
    Render.setLevel(daily); draw(mkState(daily));
    var d = Render.caption;
    return { tested: n, twoRows: twoRows, squeezed: squeezed, worst: worst, daily: { text: d.text, size: d.size, two: d.two, squeeze: d.squeeze } };
  }
  return { scene: scene, timeFrames: timeFrames, thumbTime: thumbTime, captions: captions, draw: draw, mkState: mkState, lv: lv };
})();
`;

function buildPage() {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Cormorant+SC:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>html,body{margin:0;background:#0E0D0B;overflow:hidden}#game{position:fixed;left:0;top:0;display:block}</style></head>
<body><canvas id="game"></canvas>
<script>
"use strict";
${['00-const.js', '10-physics.js', '20-levels.js', '30-render.js'].map(S).join('\n')}
${HARNESS}
</script></body></html>`;
  const f = path.join(QA, 'render-harness.html');
  fs.writeFileSync(f, html);
  return f;
}

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

// name, options for H.scene, clip (CSS px) or null for the full screen
const PLATE = { x: 0, y: 40, width: 390, height: 700 };
const BOTTOM = { x: 0, y: 540, width: 390, height: 300 };
const LIST = [
  ['aim-mid',        { i: 7, pull: null, pullDir: [Math.PI * 0.62, 140] }, null],
  ['aim-low',        { i: 7, pullDir: [Math.PI * 0.62, 52] }, PLATE],
  ['aim-max',        { i: 7, pullDir: [Math.PI * 0.62, 300] }, PLATE],
  ['hint',           { i: 7, hint: true, frozen: true }, null],
  ['hint-aim',       { i: 7, hint: true, frozen: true, pull: 'sol' }, null],
  ['hint-fadein',    { i: 7, hint: true, frozen: true, hintT0: 'fade' }, PLATE],
  ['frozen-note',    { i: 7, hintUsedOnly: true, frozen: true }, null],
  ['spotlight',      { i: 5, spotlight: true }, null],
  ['spotlight-multi',{ i: 11, spotlight: true }, null],
  ['daily',          { i: 7, caption: 'DAILY · 30 SEP 2026' }, null],
  ['pull-dl',        { i: 7, pullDir: [Math.PI * 0.75, 300] }, BOTTOM],
  ['pull-dr',        { i: 7, pullDir: [Math.PI * 0.25, 300] }, BOTTOM],
  ['pull-ul',        { i: 7, pullDir: [Math.PI * 1.25, 300] }, BOTTOM],
  ['pull-ur',        { i: 7, pullDir: [Math.PI * 1.75, 300] }, BOTTOM],
  ['pull-d',         { i: 7, pullDir: [Math.PI * 0.5, 300] }, BOTTOM],
  ['pull-dl-edge',   { i: 2, pullDir: [Math.PI * 0.85, 300] }, BOTTOM],
  ['pull-dr-edge',   { i: 3, pullDir: [Math.PI * 0.15, 300] }, BOTTOM],
  ['pull-dr-mid',    { i: 3, pullDir: [Math.PI * 0.3, 170] }, BOTTOM],
  ['hint-i1',        { i: 1, hint: true, frozen: true }, PLATE],
  ['hint-i2',        { i: 2, hint: true, frozen: true }, PLATE],
  ['hint-i6',        { i: 6, hint: true, frozen: true }, PLATE],
  ['hint-i10',       { i: 10, hint: true, frozen: true }, PLATE],
  ['hint-i3-aim',    { i: 3, hint: true, frozen: true, pull: 'sol' }, PLATE],
  ['hint-i9-aim',    { i: 9, hint: true, frozen: true, pull: 'sol' }, PLATE],
  ['hint-used-stars',{ i: 7, hintUsedOnly: true }, null],
];

(async () => {
  const file = buildPage();
  const browser = await chromium.launch();
  const ctx = await browser.newContext(IPHONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_|net::/i.test(m.text())) errors.push(m.text()); });
  await page.goto('file://' + file);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  console.log('fonts:', await page.evaluate(() => ['italic 500 11px "Cormorant Garamond"', '600 12px "Cormorant SC"', '400 10px "JetBrains Mono"'].map(f => document.fonts.check(f)).join(',')));

  for (const [name, opt, clip] of LIST) {
    if (SCENES.length && !SCENES.includes(name)) continue;
    await page.evaluate(([o]) => {
      const level = H.lv(o.i);
      if (o.pull === 'sol') { o.pull = [level.solution.vx, level.solution.vy]; }
      if (o.hintT0 === 'fade') o.hintT0 = 5000 + 16 - 130;        // 130 ms into the 300 ms fade-in
      // hint-used-stars: two failed launches so the potential row is visibly short
      window.__st = H.scene('x', Object.assign({}, o));
    }, [opt]);
    await page.waitForTimeout(60);
    const out = path.join(QA, 'render-' + name + '.png');
    await page.screenshot(clip ? { path: out, clip } : { path: out });
    console.log('shot', out);
  }
  if (!SCENES.length || SCENES.includes('perf')) {
    const t1 = await page.evaluate(() => H.timeFrames({ i: 7 }));
    const t2 = await page.evaluate(() => H.timeFrames({ i: 7, frozen: true }));
    const t3 = await page.evaluate(() => H.timeFrames({ i: 7, flight: true }));
    const f = x => 'avg ' + x.avg.toFixed(3) + ' ms, p95 ' + x.p95.toFixed(3) + ', max ' + x.max.toFixed(3);
    console.log('frames aim+predict+hint+spotlight (moving bodies): ' + f(t1));
    console.log('frames aim+predict+hint+spotlight (frozen)       : ' + f(t2));
    console.log('frames flight (live sim + trail)                 : ' + f(t3));
    const th = await page.evaluate(() => H.thumbTime(72, 128, 2));
    console.log('thumbnails x60 (72x128, dpr2, ' + th.levels + ' distinct levels): first ' + th.first.toFixed(1) + ' ms, warm ' + th.warm.toFixed(1) + ' ms');
    console.log('captions:', JSON.stringify(await page.evaluate(() => H.captions())));
  }
  if (errors.length) console.log('ERRORS:', errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
