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
const FW = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-wormhole.json'), 'utf8'));   // wormhole plates (v3)
const FV = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-v4.json'), 'utf8'));         // nebula / pulsar plates (v4)

const HARNESS = `
window.H = (function () {
  var cv = document.getElementById('game'), NOW = 5000;
  Render.init(cv);
  Render.resize(390, 844, 2, { top: 47, bottom: 34, left: 0, right: 0 });
  var FW = window.FW, FV = window.FV;
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
    var level = opt.level || (opt.fv !== undefined ? FV[opt.fv] : opt.fw !== undefined ? FW[opt.fw] : lv(opt.i || 0)), st = mkState(level);
    if (opt.caption) { level = Object.assign({}, level, { caption: opt.caption }); st.level = level; }
    if (opt.pull) pullFor(st, opt.pull[0], opt.pull[1]);
    if (opt.pullDir) pullDir(st, opt.pullDir[0], opt.pullDir[1]);
    if (opt.hint) setHint(st, true, opt.hintT0);
    if (opt.hintUsedOnly) { setHint(st, false); }
    if (opt.frozen) st.frozen = true;
    if (opt.spotlight) st.spotlight = level.frags.map(function (f) { return { x: f.x, y: f.y }; });
    if (opt.spotBoth) st.spotlight = level.frags.map(function (f) { return { x: f.x, y: f.y }; }).concat([{ x: level.target.x, y: level.target.y, r: 70 }]);
    if (opt.launches) st.launches = opt.launches;
    st.step = opt.step || 0;
    if (opt.solPull) pullFor(st, level.solution.vx, level.solution.vy);
    if (opt.hintSol) { st.step = level.solution.t0Step || 0; setHint(st, true, opt.hintT0); }
    if (opt.spotNeb) st.spotlight = level.bodies.filter(function (b) { return b.kind === 'nebula'; }).map(function (b) { var q = {}; Physics.bodyPos(b, st.step * K.DT, q); return { x: q.x, y: q.y, r: b.r + 10 }; });
    if (opt.spotPulsar) st.spotlight = level.bodies.filter(function (b) { return b.kind === 'pulsar'; }).map(function (b) { return { x: b.x, y: b.y, r: 60 }; });
    if (opt.spotMouths) st.spotlight = level.bodies.filter(function (b) { return b.kind === 'wormhole'; }).map(function (b) { var q = {}; Physics.bodyPos(b, st.step * K.DT, q); return { x: q.x, y: q.y, r: b.r + 14 }; });
    Render.setLevel(level);
    draw(st); draw(st, NOW + 16);
    return st;
  }
  // a live flight that has just warped: step the real sim until its first passage (+ a few steps), then flash
  function flightScene(fw, extra, dtMs) {
    var level = FW[fw], st = mkState(level), sol = level.solution;
    Render.setLevel(level);
    st.phase = 'flight'; st.launches = 1; st.sim = Physics.createSim(level, sol.vx, sol.vy, sol.t0Step || 0); st.step = sol.t0Step || 0;
    var tr = st.trail, cap = tr.pts.length >> 1, px = st.sim.x, py = st.sim.y, seen = 0, done = -1, flashed = false, now = NOW;
    for (var k = 0; k < 1200 && st.sim.status === 'flying'; k++) {
      px = st.sim.x; py = st.sim.y;
      Physics.stepSim(st.sim, level); st.step++;
      tr.pts[2 * tr.head] = st.sim.x; tr.pts[2 * tr.head + 1] = st.sim.y; tr.head = (tr.head + 1) % cap; tr.n = Math.min(cap, tr.n + 1);
      st.hud.speed = Physics.speed(st.sim);
      if (st.sim.events.length) { st.sim.events.length = 0; seen++; if (seen === 1) { Render.warp(px, py, st.sim.x, st.sim.y); flashed = true; done = k + extra; } }
      if (k % 4 === 0) { draw(st, now); now += 16; }
      if (k === done) break;
    }
    draw(st, now); draw(st, now + (dtMs || 120));
    return st;
  }
  // v4: a live flight through a fixture; every event is fed to Render as the game does (warp / fog / beam); the scene stops
  // "extra" steps after the first event of type evType (or after "atStep" steps), then draws dtMs later
  function v4Flight(fv, evType, extra, dtMs, atStep, launch) {
    var level = FV[fv], st = mkState(level), sol = launch || level.solution;
    Render.setLevel(level);
    st.phase = 'flight'; st.launches = 1; st.sim = Physics.createSim(level, sol.vx, sol.vy, sol.t0Step || 0); st.step = sol.t0Step || 0;
    var tr = st.trail, cap = tr.pts.length >> 1, px, py, done = atStep || -1, now = NOW, log = [];
    for (var k = 0; k < 1200 && st.sim.status === 'flying'; k++) {
      px = st.sim.x; py = st.sim.y;
      Physics.stepSim(st.sim, level); st.step++;
      tr.pts[2 * tr.head] = st.sim.x; tr.pts[2 * tr.head + 1] = st.sim.y; tr.head = (tr.head + 1) % cap; tr.n = Math.min(cap, tr.n + 1);
      st.hud.speed = Physics.speed(st.sim);
      var ev = st.sim.events;
      for (var e = 0; e < ev.length; e++) {
        var E = ev[e]; log.push(E.type + '@' + k);
        if (E.type === 'frag') st.collected[E.i] = 1;
        else if (E.type === 'warp') { var qa = {}, qb = {}; Physics.bodyPos(level.bodies[E.from], st.sim.abs * K.DT, qa); Physics.bodyPos(level.bodies[E.to], st.sim.abs * K.DT, qb); Render.warp(qa.x, qa.y, qb.x, qb.y); }
        else if (E.type === 'fog') Render.fog(st.sim.x, st.sim.y);
        else if (E.type === 'beam') Render.beam(st.sim.x, st.sim.y);
        if (E.type === evType && done < 0) done = k + extra;
      }
      ev.length = 0;
      if (k % 2 === 0) { draw(st, now); now += 16.7; }
      if (k === done) break;
    }
    draw(st, now); draw(st, now + (dtMs || 120));
    st.log = log;
    return st;
  }
  // the replay after a hit (the brass re-inking is over unless dtMs is small)
  function resultScene(fw, dtMs, set) {
    var level = (set || FW)[fw], st = mkState(level), sol = level.solution, buf = new Float32Array(K.MAX_STEPS * 2 + 4);
    var sim = Physics.simulate(level, sol.vx, sol.vy, sol.t0Step || 0, K.MAX_STEPS, buf);
    Render.setLevel(level);
    st.phase = 'result'; st.launches = 1; st.step = sim.step + (sol.t0Step || 0);
    st.result = { success: true, stars: 3, status: 'hit', pts: buf, n: sim.n, at: NOW };
    st.collected = new Uint8Array(8); for (var i = 0; i < sim.collected.length; i++) st.collected[i] = sim.collected[i];
    Render.fx.success(buf, sim.n);
    draw(st, NOW); draw(st, NOW + 1); draw(st, NOW + (dtMs || 2500));
    return st;
  }
  // thumbnails on an overlay grid, at the size the atlas uses (plus a magnified row)
  function thumbGrid(specs, w, h, dpr, cols) {
    var ov = document.getElementById('ov') || document.body.appendChild(document.createElement('div'));
    ov.id = 'ov'; ov.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;background:#0E0D0B;z-index:9;overflow:hidden';
    ov.innerHTML = '';
    specs.forEach(function (sp, i) {
      var c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr; c.style.cssText = 'position:absolute;width:' + w + 'px;height:' + h + 'px;left:' + (8 + (i % cols) * (w + 6)) + 'px;top:' + (8 + Math.floor(i / cols) * (h + 6)) + 'px';
      var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); Render.drawThumbnail(g, sp, w, h); ov.appendChild(c);
    });
  }
  // stress plate for the label placement: mouths hard against the edges, beside the target, in a planet's shadow and on rails near the border
  function crowd() {
    var W = function (x, y, pair, turn, orbit) { return { kind: 'wormhole', r: 34, mu: 0, x: x, y: y, orbit: orbit || null, pair: pair, turn: turn || 0 }; };
    return { id: 'fwc', index: 0, seed: 5, difficulty: 1.7, name: 'Crowd', plate: 'FWC', probe: { x: 450, y: 1450 }, target: { x: 450, y: 150, r: 38 },
      bodies: [ { kind: 'planet', r: 70, mu: 2.4e7, x: 300, y: 700, orbit: null }, { kind: 'repulsor', r: 26, mu: -1.1e7, x: 640, y: 900, orbit: null },
        W(50, 820, 5, Math.PI / 4), W(430, 260, 4, -Math.PI / 4), W(330, 920, 3, 0), W(860, 1500, 2, 3 * Math.PI / 4), W(0, 0, 7, -3 * Math.PI / 4, { cx: 450, cy: 700, rad: 400, omega: 0.5, phase: 0.2 }),
        W(120, 1500, 6, Math.PI / 2) ],
      frags: [{ x: 150, y: 820 }], solution: null };
  }
  function clearOverlay() { var ov = document.getElementById('ov'); if (ov) ov.remove(); }
  // 300 frames with prediction + hint + spotlight all on, moving bodies advancing 2 steps per frame
  function timeFrames(opt) {
    var level = opt.fv !== undefined ? FV[opt.fv] : opt.fw !== undefined ? FW[opt.fw] : lv(opt.i), st = mkState(level);
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
        for (var e = 0; e < st.sim.events.length; e++) {
          var E = st.sim.events[e];
          if (E.type === 'warp') Render.warp(st.sim.x - 20, st.sim.y, st.sim.x, st.sim.y);
          else if (E.type === 'fog') Render.fog(st.sim.x, st.sim.y);
          else if (E.type === 'beam') Render.beam(st.sim.x, st.sim.y);
        }
        st.sim.events.length = 0;
        if (st.sim.status !== 'flying') { st.sim = Physics.createSim(level, level.solution.vx, level.solution.vy, 0); tr.n = 0; }
      } else st.step += 2;
    }
    ts.sort(function (a, b) { return a - b; });
    var sum = 0; for (var i = 0; i < ts.length; i++) sum += ts[i];
    return { avg: sum / ts.length, p95: ts[Math.floor(ts.length * 0.95)], max: ts[ts.length - 1] };
  }
  // thumbnails: 90 plates (the campaign cycled; with wormhole plates mixed in when mixWorm)
  function thumbTime(w, h, dpr, mixWorm, N) {
    N = N || 90;
    var list = [], cs = [];
    for (var q = 0; q < N; q++) list.push(Levels.CAMPAIGN[q % Levels.CAMPAIGN.length]);
    if (mixWorm) for (q = 0; q < list.length; q++) if (q % 3 === 0) list[q] = q >= 90 ? FV[(q / 3) % FV.length | 0] : FW[(q / 3) % FW.length | 0];
    for (var i = 0; i < N; i++) { var c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr; cs.push(c); }
    function run() {
      var t = performance.now();
      for (var i = 0; i < N; i++) { var g = cs[i].getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); Render.drawThumbnail(g, list[i % list.length], w, h); }
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
  return { scene: scene, flightScene: flightScene, v4Flight: v4Flight, FV: FV, resultScene: resultScene, thumbGrid: thumbGrid, clearOverlay: clearOverlay, crowd: crowd, FW: FW, timeFrames: timeFrames, thumbTime: thumbTime, captions: captions, draw: draw, mkState: mkState, lv: lv };
})();
`;

// The installed Playwright may expect a newer browser build than the one preinstalled: fall back to any headless shell /
// Chromium found under PLAYWRIGHT_BROWSERS_PATH (never run `playwright install`).
function launchOpts() {
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

function buildPage() {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Cormorant+SC:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>html,body{margin:0;background:#0E0D0B;overflow:hidden}#game{position:fixed;left:0;top:0;display:block}</style></head>
<body><canvas id="game"></canvas>
<script>
"use strict";
${['00-const.js', '10-physics.js', '20-levels.js', '30-render.js'].map(S).join('\n')}
window.FW = ${JSON.stringify(FW)};
window.FV = ${JSON.stringify(FV)};
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

// wormhole scenes (v3): name, JS expression run in the page, clip. Fixtures fw1..fw3 = indices 0..2.
const FULL = null;
const WLIST = [
  ['wh-aim-fw1',       'H.scene("x", { fw: 0, solPull: true })', null],
  ['wh-aim-fw2',       'H.scene("x", { fw: 1, solPull: true })', null],
  ['wh-aim-fw3',       'H.scene("x", { fw: 2, solPull: true })', null],
  ['wh-aim-idle-fw2',  'H.scene("x", { fw: 1 })', null],
  ['wh-hint-fw1',      'H.scene("x", { fw: 0, hintSol: true, frozen: true })', null],
  ['wh-hint-fw2',      'H.scene("x", { fw: 1, hintSol: true, frozen: true })', null],
  ['wh-hint-fw3',      'H.scene("x", { fw: 2, hintSol: true, frozen: true, solPull: true })', null],
  ['wh-flight-fw1',    'H.flightScene(0, 6, 90)', null],
  ['wh-flight-fw2',    'H.flightScene(1, 10, 140)', null],
  ['wh-flight-fw3',    'H.flightScene(2, 8, 100)', null],
  ['wh-result-fw1',    'H.resultScene(0, 2500)', null],
  ['wh-result-fw2',    'H.resultScene(1, 2500)', null],
  ['wh-result-fw3',    'H.resultScene(2, 2500)', null],
  ['wh-result-fw2-mid','H.resultScene(1, 300)', null],
  ['wh-spot-fw2',      'H.scene("x", { fw: 1, spotMouths: true })', null],
  ['wh-spot-fw3',      'H.scene("x", { fw: 2, spotMouths: true, spotlight: true })', null],
  ['wh-spot-fw3-t2',   'H.scene("x", { fw: 2, spotMouths: true, step: 420 })', null],
  ['wh-fw3-t0',        'H.scene("x", { fw: 2, step: 0 })', null],
  ['wh-fw3-t1',        'H.scene("x", { fw: 2, step: 300 })', null],
  ['wh-fw3-t2',        'H.scene("x", { fw: 2, step: 600 })', null],
  ['wh-fw3-t3',        'H.scene("x", { fw: 2, step: 900 })', null],
  ['wh-p60-aim',       'H.scene("x", { i: 60, solPull: true })', null],
  ['wh-p66-aim',       'H.scene("x", { i: 66, solPull: true })', null],
  ['wh-p72-aim',       'H.scene("x", { i: 72, solPull: true })', null],
  ['wh-p81-hint',      'H.scene("x", { i: 81, hintSol: true, frozen: true })', null],
  ['wh-p81-aim',       'H.scene("x", { i: 81, solPull: true })', null],
  ['wh-p88-idle',      'H.scene("x", { i: 88 })', null],
  ['wh-p88-hint',      'H.scene("x", { i: 88, hintSol: true, frozen: true })', null],
  ['wh-p89-idle',      'H.scene("x", { i: 89 })', null],
  ['wh-p89-aim',       'H.scene("x", { i: 89, solPull: true })', null],
  ['wh-crowd',         'H.scene("x", { level: H.crowd(), solPull: false, pullDir: [4.3, 120] })', null],
  ['wh-thumbs',        'H.thumbGrid(H.FW.concat([H.lv(0), H.lv(9), H.lv(20), H.lv(33), H.lv(40), H.lv(50)]), 72, 128, 3, 5)', null],
  ['wh-thumbs-big',    'H.thumbGrid(H.FW, 120, 213, 3, 3)', null],
];

// nebula / pulsar scenes (v4): fixtures fn1, fn2, fp1, fp2 = indices 0..3
const VLIST = [
  ['v4-idle-fn1',      'H.scene("x", { fv: 0 })', null],
  ['v4-aim-fn1',       'H.scene("x", { fv: 0, solPull: true })', null],
  ['v4-hint-fn1',      'H.scene("x", { fv: 0, hintSol: true, frozen: true })', null],
  ['v4-aim-fn2',       'H.scene("x", { fv: 1, solPull: true })', null],
  ['v4-fn2-t300',      'H.scene("x", { fv: 1, step: 300 })', null],
  ['v4-fn2-t700',      'H.scene("x", { fv: 1, step: 700 })', null],
  ['v4-aim-fp1',       'H.scene("x", { fv: 2, solPull: true })', null],
  ['v4-fp1-t200',      'H.scene("x", { fv: 2, step: 200 })', null],
  ['v4-aim-fp2',       'H.scene("x", { fv: 3, solPull: true })', null],
  ['v4-hint-fp2',      'H.scene("x", { fv: 3, hintSol: true, frozen: true })', null],
  ['v4-spot-fn1',      'H.scene("x", { fv: 0, spotNeb: true })', null],
  ['v4-spot-fp1',      'H.scene("x", { fv: 2, spotPulsar: true })', null],
  ['v4-flight-fog',    'H.v4Flight(0, "fog", 6, 90)', null],
  ['v4-flight-fog-in', 'H.v4Flight(0, "fog", 40, 400)', null],
  ['v4-flight-fn2',    'H.v4Flight(1, "fog", 8, 120)', null],
  ['v4-flight-beam',   'H.v4Flight(2, "beam", 3, 60)', null],
  ['v4-flight-beam2',  'H.v4Flight(2, "beam", 14, 150)', null],
  ['v4-flight-fp2',    'H.v4Flight(3, "beam", 4, 70)', null],
  ['v4-result-fp2',    'H.resultScene(3, 2500, H.FV)', null],
  ['v4-zoom-fn1',      'H.scene("x", { fv: 0 })', { x: 40, y: 400, width: 200, height: 200 }],
  ['v4-zoom-fp1',      'H.scene("x", { fv: 2, step: 200 })', { x: 95, y: 320, width: 200, height: 200 }],
  ['v4-zoom-fog',      'H.v4Flight(0, "fog", 4, 70)', { x: 40, y: 400, width: 200, height: 200 }],
  ['v4-zoom-beam',     'H.v4Flight(2, "beam", 2, 40)', { x: 95, y: 120, width: 200, height: 360 }],
  ['v4-over',          'H.scene("x", { level: Object.assign({}, H.FV[1], { bodies: [H.FV[1].bodies[0], Object.assign({}, H.FV[1].bodies[1], { orbit: { cx: 520, cy: 820, rad: 90, omega: 0.6, phase: 1 } }), { kind: "pulsar", r: 12, mu: 1.4e7, x: 600, y: 1150, orbit: null, beam: { omega: 0.5, phase: 1, half: 0.14, reach: 300, push: 1000 } }] }), step: 0 })', { x: 120, y: 260, width: 260, height: 360 }],
  ['v4-thumbs',        'H.thumbGrid(H.FV.concat(H.FW, [H.lv(0), H.lv(20), H.lv(40), H.lv(70), H.lv(89)]), 72, 128, 3, 5)', null],
  ['v4-thumbs-big',    'H.thumbGrid(H.FV, 120, 213, 3, 3)', null],
];

(async () => {
  const file = buildPage();
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext(IPHONE);
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());      // no network in the sandbox: fail fast, use the fallback stack
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
  for (const [name, expr, clip] of WLIST) {
    if (SCENES.length && !SCENES.includes(name)) continue;
    await page.evaluate(e => { H.clearOverlay(); window.__st = eval(e); }, expr);
    await page.waitForTimeout(60);
    const out = path.join(QA, 'render-' + name + '.png');
    await page.screenshot(clip ? { path: out, clip } : { path: out });
    console.log('shot', out);
    await page.evaluate(() => H.clearOverlay());
  }
  for (const [name, expr, clip] of VLIST) {
    if (SCENES.length && !SCENES.includes(name) && !SCENES.includes('v4')) continue;
    await page.evaluate(e => { H.clearOverlay(); window.__st = eval(e); }, expr);
    await page.waitForTimeout(60);
    const out = path.join(QA, 'render-' + name + '.png');
    await page.screenshot(clip ? { path: out, clip } : { path: out });
    console.log('shot', out, await page.evaluate(() => (window.__st && window.__st.log) ? window.__st.log.join(' ') : ''));
    await page.evaluate(() => H.clearOverlay());
  }
  if (SCENES.includes('perfv4')) {     // nebula / pulsar plates at 4x CPU throttle
    const cdp = await ctx.newCDPSession(page);
    const f = x => 'avg ' + x.avg.toFixed(3) + ' ms, p95 ' + x.p95.toFixed(3) + ', max ' + x.max.toFixed(3);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (const fv of [0, 1, 2, 3]) {
      const a = await page.evaluate(n => H.timeFrames({ fv: n }), fv), fl = await page.evaluate(n => H.timeFrames({ fv: n, flight: true }), fv);
      console.log('fv' + fv + ' aim+predict+hint : ' + f(a));
      console.log('fv' + fv + ' flight (fx, trail): ' + f(fl));
    }
    const t1 = await page.evaluate(() => H.timeFrames({ i: 7 }));
    console.log('plate 8 aim (reference)  : ' + f(t1));
    const th = await page.evaluate(() => H.thumbTime(72, 128, 2, true, 150));
    console.log('thumbnails x150 (72x128, dpr2, v3+v4 fixtures mixed): first ' + th.first.toFixed(1) + ' ms, warm ' + th.warm.toFixed(1));
    const sb = await page.evaluate(() => { var t = performance.now(); for (var i = 0; i < 4; i++) { Render.setLevel(H.FV[i]); H.draw(H.mkState(H.FV[i])); } return performance.now() - t; });
    console.log('setLevel+first frame x4 v4 fixtures: ' + sb.toFixed(1) + ' ms');
    const sr = await page.evaluate(() => { var t = performance.now(); for (var i = 0; i < 4; i++) { var L = H.lv([7, 20, 40, 70][i]); Render.setLevel(L); H.draw(H.mkState(L)); } return performance.now() - t; });
    console.log('setLevel+first frame x4 campaign plates (reference): ' + sr.toFixed(1) + ' ms');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  if (SCENES.includes('perfw')) {      // repeat the warp flights at 4x to look for spikes
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (let r = 0; r < 4; r++) for (const fw of [0, 1, 2]) { const x = await page.evaluate(n => H.timeFrames({ fw: n, flight: true }), fw); console.log('fw' + (fw + 1) + ' flight avg ' + x.avg.toFixed(3) + ' p95 ' + x.p95.toFixed(3) + ' max ' + x.max.toFixed(3)); }
  }
  if (!SCENES.length || SCENES.includes('perf')) {
    const cdp = await ctx.newCDPSession(page);
    const f = x => 'avg ' + x.avg.toFixed(3) + ' ms, p95 ' + x.p95.toFixed(3) + ', max ' + x.max.toFixed(3);
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      console.log('--- CPU throttle ' + rate + 'x');
      const t1 = await page.evaluate(() => H.timeFrames({ i: 7 }));
      const t3 = await page.evaluate(() => H.timeFrames({ i: 7, flight: true }));
      console.log('frames aim+predict+hint+spotlight (moving bodies): ' + f(t1));
      console.log('frames flight (live sim + trail)                 : ' + f(t3));
      for (const fw of [0, 1, 2]) {
        const a = await page.evaluate(n => H.timeFrames({ fw: n }), fw), fl = await page.evaluate(n => H.timeFrames({ fw: n, flight: true }), fw);
        console.log('fw' + (fw + 1) + ' aim+predict+hint (mouths, warps)         : ' + f(a));
        console.log('fw' + (fw + 1) + ' flight (mouths, warp flashes, trail)     : ' + f(fl));
      }
      const th = await page.evaluate(() => H.thumbTime(72, 128, 2, false)), thw = await page.evaluate(() => H.thumbTime(72, 128, 2, true));
      console.log('thumbnails x90 (72x128, dpr2): plain first ' + th.first.toFixed(1) + ' ms, warm ' + th.warm.toFixed(1) + ' | with wormhole plates first ' + thw.first.toFixed(1) + ' ms, warm ' + thw.warm.toFixed(1));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('captions:', JSON.stringify(await page.evaluate(() => H.captions())));
  }
  if (errors.length) console.log('ERRORS:', errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
