#!/usr/bin/env node
// Writes tools/fixtures-wormhole.json: three hand-built plates that use wormholes, each with a verified one-launch solution
// that goes through a wormhole. For RENDER / FEEL / LOG development and tests before (and alongside) the baked Volume III.
'use strict';
const fs = require('fs'), path = require('path'), G = require('./load.js'), P = G.Physics, K = G.K;
const W = (x, y, pair, turn, orbit) => ({ kind: 'wormhole', r: 32, mu: 0, x, y, orbit: orbit || null, pair, turn: turn || 0 });
const PL = (x, y, r, mu) => ({ kind: 'planet', r, mu, x, y, orbit: null });
const base = (id, name, plate, bodies, frags, target) => ({ id, index: 0, seed: 1, difficulty: 1.7, name, plate, probe: { x: 450, y: 1450 }, target: target || { x: 450, y: 220, r: 38 }, bodies, frags: frags || [], solution: null });
const F = [
  base('fw1', 'Fixture: One Gate', 'FW1', [PL(450, 800, 80, 3e7), W(230, 1120, 2, 0), W(690, 430, 1, 0)]),
  base('fw2', 'Fixture: Two Gates, Turned', 'FW2', [PL(300, 650, 70, 2.4e7), W(640, 1150, 2, Math.PI / 2), W(200, 1000, 1, -Math.PI / 2), W(700, 700, 4, 0), W(180, 350, 3, 0)], [], { x: 450, y: 220, r: 60 }),
  base('fw3', 'Fixture: Orbiting Mouth', 'FW3', [{ kind: 'blackhole', r: 14, capture: 46, mu: 3.6e7, x: 450, y: 760, orbit: null }, W(200, 1150, 2, 0), W(0, 0, 1, 0, { cx: 660, cy: 520, rad: 90, omega: 0.9, phase: 0.4 })], [{ x: 560, y: 1000 }, { x: 260, y: 520 }]),
];
const D = Math.PI / 180;
for (const lv of F) {
  let best = null;
  for (const t0 of [0, 60, 150]) for (let a = 0; a < 360; a += 0.5) for (let p = 0.15; p <= 1.0001; p += 0.025) {
    const v = K.VMAX * p, vx = Math.cos(a * D) * v, vy = Math.sin(a * D) * v, s = P.simulate(lv, vx, vy, t0, K.MAX_STEPS, null);
    if (s.status !== 'hit' || !s.warps) continue;
    let ok = 0; for (const [da, dp] of [[-.5, 0], [.5, 0], [0, -.025], [0, .025]]) { const v2 = K.VMAX * (p + dp), q = P.simulate(lv, Math.cos((a + da) * D) * v2, Math.sin((a + da) * D) * v2, t0, K.MAX_STEPS, null); if (q.status === 'hit') ok++; }
    if (ok >= 2 && (!best || s.collected.reduce((x, y) => x + y, 0) > best.c)) best = { vx, vy, t0Step: t0, c: s.collected.reduce((x, y) => x + y, 0), warps: s.warps };
    if (best && best.c === (lv.frags.length)) break;
  }
  if (!best) throw new Error('no solution for ' + lv.id);
  lv.solution = { vx: best.vx, vy: best.vy, t0Step: best.t0Step };
  console.log(lv.id, 'solution warps', best.warps, 'frags', best.c + '/' + lv.frags.length);
}
fs.writeFileSync(path.join(__dirname, 'fixtures-wormhole.json'), JSON.stringify(F, null, 1));
