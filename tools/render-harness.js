// Render harness (owner: RENDER AGENT). Builds a standalone test page from src/00,10,20,30 plus a tiny driver that
// fakes game state, screenshots each scene at iPhone 14 emulation, and measures frame time.
// usage: node tools/render-harness.js [--nofonts] [--only scene,scene]
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), QA = path.join(ROOT, 'qa');
const args = process.argv.slice(2), NOFONTS = args.includes('--nofonts') || args.includes('--nols'), NOLS = args.includes('--nols');
const onlyIx = args.indexOf('--only'), ONLY = onlyIx >= 0 ? args[onlyIx + 1].split(',') : null;
const src = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

const DRIVER = `
(function () {
  var cv = document.getElementById('game'), SAFE = { top: 47, bottom: 34, left: 0, right: 0 };
  Render.init(cv); Render.resize(innerWidth, innerHeight, 2, SAFE);
  // the lead's three sample levels (planet / binary+moon / black hole+repulsor+moon+fragments), embedded so the
  // harness doesn't depend on the level agent's in-progress campaign
  var L = [
    { id: 'c01', index: 0, seed: 1, difficulty: 0, name: 'First Light', plate: 'I',
      probe: { x: 450, y: 1420 }, target: { x: 520, y: 220, r: 44 },
      bodies: [ { kind: 'planet', x: 330, y: 780, r: 70, mu: 2.4e7, orbit: null } ], frags: [], solution: null },
    { id: 'c02', index: 1, seed: 2, difficulty: 0.4, name: 'The Binary', plate: 'II',
      probe: { x: 200, y: 1400 }, target: { x: 700, y: 240, r: 40 },
      bodies: [
        { kind: 'planet', r: 46, mu: 7.5e6, pair: 1, orbit: { cx: 470, cy: 820, rad: 120, omega: 0.9, phase: 0 } },
        { kind: 'planet', r: 40, mu: 5.2e6, pair: 1, orbit: { cx: 470, cy: 820, rad: 120, omega: 0.9, phase: Math.PI } },
        { kind: 'moon', r: 16, mu: 6e5, orbit: { cx: 700, cy: 480, rad: 110, omega: -1.4, phase: 1 } } ],
      frags: [ { x: 640, y: 1050 } ], solution: null },
    { id: 'c03', index: 2, seed: 3, difficulty: 0.9, name: 'Event Horizon', plate: 'III',
      probe: { x: 450, y: 1440 }, target: { x: 450, y: 180, r: 36 },
      bodies: [
        { kind: 'blackhole', x: 450, y: 800, r: 14, capture: 44, mu: 3.2e7, orbit: null },
        { kind: 'repulsor', x: 220, y: 520, r: 26, mu: -1.1e7, orbit: null },
        { kind: 'planet', x: 700, y: 1100, r: 55, mu: 1.1e7, orbit: null },
        { kind: 'moon', r: 14, mu: 4e5, orbit: { cx: 700, cy: 1100, rad: 105, omega: 1.2, phase: 0 } } ],
      frags: [ { x: 300, y: 1000 }, { x: 640, y: 420 } ], solution: null }
  ];
  var THUMBS = (Levels.CAMPAIGN && Levels.CAMPAIGN.length >= 30) ? Levels.CAMPAIGN : L;
  function blank(level) {
    return { screen: 'play', paused: false, mode: 'campaign', level: level, levelIndex: level.index, step: 0, phase: 'aim',
      aim: { active: false, dx: 0, dy: 0, power: 0, vx: 0, vy: 0, cancel: true },
      predict: { pts: new Float32Array(K.PREDICT_STEPS * 2), n: 0 }, sim: null,
      trail: { pts: new Float32Array(K.TRAIL_MAX * 2), head: 0, n: 0 }, ghosts: [], launches: 0,
      collected: new Uint8Array((level.frags || []).length), result: null, hud: { speed: 0, closest: Infinity },
      endless: { round: 0, score: 0, best: 0 } };
  }
  // brute-force search for launches with a given outcome (harness only)
  function find(level, t0, want, minSteps) {
    var best = null, buf = new Float32Array(K.MAX_STEPS * 2);
    for (var ai = 0; ai < 360; ai++) for (var pw = 0.3; pw <= 1.0001; pw += 0.035) {
      var ang = ai * Math.PI / 180, vx = Math.cos(ang) * K.VMAX * pw, vy = Math.sin(ang) * K.VMAX * pw;
      var sim = Physics.simulate(level, vx, vy, t0, K.MAX_STEPS, buf);
      if (sim.status === want && sim.n >= (minSteps || 0)) return { vx: vx, vy: vy, pts: buf.slice(0, sim.n * 2), n: sim.n, sim: sim };
    }
    return null;
  }
  function aimFor(st, vx, vy) {
    var sp = Math.sqrt(vx * vx + vy * vy), power = sp / K.VMAX, L = power * K.DRAG_MAX;
    st.aim = { active: true, dx: -vx / sp * L, dy: -vy / sp * L, power: power, vx: vx, vy: vy, cancel: false };
    var s = Physics.predict(st.level, vx, vy, st.step, st.predict.pts); st.predict.n = s.n;
  }
  function flyTo(st, shot, k) {
    var sim = Physics.createSim(st.level, shot.vx, shot.vy, st.step);
    st.trail.head = 0; st.trail.n = 0;
    for (var i = 0; i < k && sim.status === 'flying'; i++) {
      Physics.stepSim(sim, st.level);
      var h = st.trail.head; st.trail.pts[2 * h] = sim.x; st.trail.pts[2 * h + 1] = sim.y;
      st.trail.head = (h + 1) % K.TRAIL_MAX; st.trail.n = Math.min(K.TRAIL_MAX, st.trail.n + 1);
      for (var j = 0; j < sim.collected.length; j++) if (sim.collected[j]) st.collected[j] = 1;
    }
    st.sim = sim; st.phase = 'flight'; st.step = sim.abs;
    st.hud.speed = Physics.speed(sim); st.hud.closest = sim.minDist;
    return sim;
  }
  function ghost(shot) { var n = Math.floor(shot.n / 3), p = new Float32Array(n * 2); for (var i = 0; i < n; i++) { p[2*i] = shot.pts[6*i]; p[2*i+1] = shot.pts[6*i+1]; } return { pts: p, n: n }; }
  var T = 1000;
  window.H = {
    scene: function (name) {
      Render.fx.reset();
      var st, lv, shot, c;
      if (name === 'aim') {
        lv = L[1]; st = blank(lv); Render.setLevel(lv); st.step = 240; st.launches = 1;
        c = find(lv, 0, 'crash', 80); if (c) st.ghosts.push(ghost(c));
        shot = find(lv, st.step, 'hit') || find(lv, st.step, 'lost', 300);
        aimFor(st, shot.vx * 1.0, shot.vy * 1.0);
        Render.frame(st, T);
      } else if (name === 'cancel') {
        lv = L[0]; st = blank(lv); Render.setLevel(lv);
        st.aim = { active: true, dx: 14, dy: 24, power: 0, vx: 0, vy: 0, cancel: true };
        Render.frame(st, T);
      } else if (name === 'idle') {
        lv = L[0]; st = blank(lv); Render.setLevel(lv); Render.frame(st, T);
      } else if (name === 'flight' || name === 'crash') {
        lv = L[2]; st = blank(lv); Render.setLevel(lv); st.launches = 3;
        var g1 = find(lv, 0, 'crash', 120), g2 = find(lv, 0, 'captured', 60) || find(lv, 0, 'lost', 200);
        if (g1) st.ghosts.push(ghost(g1)); if (g2) st.ghosts.push(ghost(g2));
        shot = find(lv, 0, 'hit') || find(lv, 0, 'timeout') || find(lv, 0, 'lost', 500);
        window.__shot = shot;
        if (name === 'flight') { flyTo(st, shot, Math.floor(shot.n * 0.6)); Render.frame(st, T); }
        else {
          var cr = find(lv, 0, 'crash', 150); flyTo(st, cr, cr.n); st.phase = 'aim'; st.sim = null;
          st.ghosts = [ghost(cr)];
          Render.fx.crash(cr.sim.x, cr.sim.y); Render.frame(st, T); Render.frame(st, T + 60);
        }
      } else if (name === 'success' || name === 'success-mid') {
        lv = L[0]; st = blank(lv); Render.setLevel(lv); st.launches = 2;
        c = find(lv, 0, 'crash', 60); if (c) st.ghosts.push(ghost(c));
        shot = find(lv, 0, 'hit'); flyTo(st, shot, shot.n);
        st.phase = 'result'; st.result = { success: true, stars: 2, status: 'hit', pts: shot.pts, n: shot.n, at: T };
        Render.fx.success(shot.pts, shot.n); Render.frame(st, T);
        Render.frame(st, name === 'success' ? T + 2200 : T + 300);
      } else if (name === 'title') {
        st = { screen: 'title' }; Render.frame(st, 4000);
      } else if (name === 'select') {
        st = { screen: 'select' }; Render.frame(st, 4000);
      } else if (name === 'thumbs') {
        document.getElementById('game').style.display = 'none';
        var grid = document.getElementById('grid'); grid.style.display = 'grid'; grid.innerHTML = '';
        var t0 = performance.now();
        for (var i = 0; i < 30; i++) {
          var cc = document.createElement('canvas'); cc.width = 200; cc.height = 340; cc.style.width = '100px'; cc.style.height = '170px';
          grid.appendChild(cc); var x = cc.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0);
          Render.drawThumbnail(x, THUMBS[i % THUMBS.length], 100, 170);
        }
        return { thumbMs: performance.now() - t0 };
      }
      window.__st = st;
      return { layout: Render.layout };
    },
    perf: function (flush) {
      var cx2 = cv.getContext('2d');
      var lv = L[2], st = blank(lv); Render.setLevel(lv);
      var g1 = find(lv, 0, 'crash', 120); if (g1) st.ghosts.push(ghost(g1)); st.ghosts.push(ghost(find(lv, 0, 'lost', 200)));
      var shot = find(lv, 0, 'timeout') || find(lv, 0, 'lost', 600) || find(lv, 0, 'hit');
      var sim = flyTo(st, shot, 250), times = [], now = 5000;
      for (var f = 0; f < 300; f++) {
        for (var k = 0; k < 2 && sim.status === 'flying'; k++) {
          Physics.stepSim(sim, lv); var h = st.trail.head; st.trail.pts[2*h] = sim.x; st.trail.pts[2*h+1] = sim.y;
          st.trail.head = (h + 1) % K.TRAIL_MAX; st.trail.n = Math.min(K.TRAIL_MAX, st.trail.n + 1); st.step = sim.abs;
        }
        if (sim.status !== 'flying') sim = flyTo(st, shot, 250);
        st.hud.speed = Physics.speed(sim); st.hud.closest = sim.minDist; now += 16.667;
        var t0 = performance.now(); Render.frame(st, now); if (flush) cx2.getImageData(0, 0, 1, 1); times.push(performance.now() - t0);
      }
      var px = cv.getContext('2d').getImageData(0, 0, 1, 1);  // flush
      times.sort(function (a, b) { return a - b; });
      var avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
      return { avg: avg, p50: times[150], p95: times[285], max: times[299], trailN: st.trail.n };
    },
    perfRaf: function () {
      return new Promise(function (res) {
        var lv = L[2], st = blank(lv); Render.setLevel(lv);
        var shot = find(lv, 0, 'timeout') || find(lv, 0, 'lost', 600) || find(lv, 0, 'hit');
        var sim = flyTo(st, shot, 250), n = 0, last = 0, iv = [], cpu = [];
        function tick(now) {
          for (var k = 0; k < 2 && sim.status === 'flying'; k++) {
            Physics.stepSim(sim, lv); var h = st.trail.head; st.trail.pts[2*h] = sim.x; st.trail.pts[2*h+1] = sim.y;
            st.trail.head = (h + 1) % K.TRAIL_MAX; st.trail.n = Math.min(K.TRAIL_MAX, st.trail.n + 1); st.step = sim.abs;
          }
          if (sim.status !== 'flying') sim = flyTo(st, shot, 250);
          var t0 = performance.now(); Render.frame(st, now); cpu.push(performance.now() - t0);
          if (last) iv.push(now - last); last = now;
          if (++n < 300) requestAnimationFrame(tick);
          else { iv.sort(function (a, b) { return a - b; }); cpu.sort(function (a, b) { return a - b; });
            res({ intervalAvg: iv.reduce(function (a, b) { return a + b; }, 0) / iv.length, intervalP95: iv[Math.floor(iv.length * 0.95)],
                  cpuAvg: cpu.reduce(function (a, b) { return a + b; }, 0) / cpu.length, cpuP95: cpu[Math.floor(cpu.length * 0.95)] }); }
        }
        requestAnimationFrame(tick);
      });
    }
  };
})();
`;

function page(fonts) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${fonts ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Cormorant+SC:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">' : ''}
<style>html,body{margin:0;background:#0E0D0B;overflow:hidden;height:100%}#game{position:fixed;inset:0}
#grid{display:none;grid-template-columns:repeat(3,100px);gap:12px;padding:16px;justify-content:center}</style></head>
<body><canvas id="game"></canvas><div id="grid"></div>
<script>"use strict";
${NOLS ? "delete CanvasRenderingContext2D.prototype.letterSpacing;" : ""}
${['00-const.js', '10-physics.js', '20-levels.js', '30-render.js'].map(src).join('\n')}
${DRIVER}
</script></body></html>`;
}

(async () => {
  fs.mkdirSync(QA, { recursive: true });
  const file = path.join(QA, NOFONTS ? 'render-harness-nofonts.html' : 'render-harness.html');
  fs.writeFileSync(file, page(!NOFONTS));
  const browser = await chromium.launch();
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const pg = await ctxB.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + file);
  if (!NOFONTS) { try { await pg.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 4000))])); } catch (e) {} await pg.waitForTimeout(600); }
  const fontInfo = await pg.evaluate(() => ['Cormorant SC', 'JetBrains Mono', 'Cormorant Garamond'].map(f => f + ':' + document.fonts.check('12px "' + f + '"')).join(' '));
  console.log('fonts', fontInfo);
  const suffix = NOLS ? '-nols' : NOFONTS ? '-nofonts' : '';
  const scenes = ['title', 'idle', 'aim', 'cancel', 'flight', 'crash', 'success-mid', 'success', 'select', 'thumbs'];
  for (const sc of scenes) {
    if (ONLY && !ONLY.includes(sc)) continue;
    const info = await pg.evaluate(n => window.H.scene(n), sc);
    const out = path.join(QA, `render-${sc}${suffix}.png`);
    await pg.screenshot({ path: out });
    console.log(sc, JSON.stringify(info && info.thumbMs !== undefined ? info : ''), '->', path.relative(ROOT, out));
    if (sc === 'flight' || sc === 'success' || sc === 'aim') {
      // zoomed detail crops
      await pg.screenshot({ path: path.join(QA, `render-${sc}-zoom${suffix}.png`), clip: { x: 0, y: 100, width: 390, height: 420 } });
    }
  }
  if (!ONLY || ONLY.includes('perf')) {
    const perf = await pg.evaluate(() => window.H.perf());
    console.log('perf (300 sync frames, ms):', JSON.stringify(perf));
    const perfF = await pg.evaluate(() => window.H.perf(true));
    console.log('perf (300 sync frames + forced raster/readback, ms):', JSON.stringify(perfF));
    const raf = await pg.evaluate(() => window.H.perfRaf());
    console.log('perf (300 rAF frames, ms):', JSON.stringify(raf));
  }
  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
  await browser.close();
})();
