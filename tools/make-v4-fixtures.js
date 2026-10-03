#!/usr/bin/env node
// Writes tools/fixtures-v4.json: hand-built plates that use nebulae (Volume IV) and pulsars (Volume V), each with a verified
// one-launch solution that uses the mechanic (passes through a nebula / is pushed by a pulsar beam). For RENDER / FEEL / LOG
// development and tests before (and alongside) the baked Volumes IV and V.
'use strict';
const fs = require('fs'), path = require('path'), G = require('./load.js'), P = G.Physics, K = G.K;
const PL = (x, y, r, mu) => ({ kind: 'planet', r, mu, x, y, orbit: null });
const NB = (x, y, r, drag, orbit) => ({ kind: 'nebula', r, mu: 0, x, y, orbit: orbit || null, drag });
const PU = (x, y, r, mu, omega, phase, half, reach, push) => ({ kind: 'pulsar', r, mu, x, y, orbit: null, beam: { omega, phase, half, reach, push } });
const W = (x, y, pair, turn) => ({ kind: 'wormhole', r: 32, mu: 0, x, y, orbit: null, pair, turn: turn || 0 });
const base = (id, name, plate, bodies, frags, target) => ({ id, index: 0, seed: 1, difficulty: 2.3, name, plate, probe: { x: 450, y: 1450 }, target: target || { x: 450, y: 260, r: 38 }, bodies, frags: frags || [], solution: null });
const F = [
  base('fn1', 'Fixture: The Veil', 'FN1', [PL(450, 760, 70, 2.6e7), NB(250, 1000, 130, 0.9)], [{ x: 230, y: 1060 }, { x: 300, y: 560 }]),
  base('fn2', 'Fixture: Drifting Dust', 'FN2', [PL(520, 820, 60, 1.8e7), NB(0, 0, 100, 0.7, { cx: 330, cy: 560, rad: 70, omega: 0.6, phase: 1 }), NB(680, 1150, 90, 1.2)], [{ x: 600, y: 1020 }]),
  base('fp1', 'Fixture: The Lighthouse', 'FP1', [PU(450, 820, 13, 1.6e7, 0.55, 0.3, 0.1, 460, 1100)], [{ x: 620, y: 1000 }, { x: 350, y: 560 }]),
  base('fp2', 'Fixture: Beam and Veil', 'FP2', [PU(560, 700, 12, 1.4e7, -0.7, 2, 0.09, 420, 1200), NB(300, 1050, 110, 0.8), W(720, 1180, 3, 0), W(220, 520, 2, 0)], [{ x: 330, y: 1000 }]),
];
const D = Math.PI / 180;
const uses = (lv, s) => (lv.bodies.some(b => b.kind === 'nebula') ? s.fog > 20 : true) && (lv.bodies.some(b => b.beam) ? s.beams > 0 : true);
for (const lv of F) {
  let best = null;
  for (const t0 of [0, 60, 150, 300]) for (let a = 180; a < 360; a += 0.5) for (let p = 0.2; p <= 1.0001; p += 0.025) {
    const v = K.VMAX * p, vx = Math.cos(a * D) * v, vy = Math.sin(a * D) * v, s = P.simulate(lv, vx, vy, t0, K.MAX_STEPS, null);
    if (s.status !== 'hit' || !uses(lv, s)) continue;
    let ok = 0; for (const [da, dp] of [[-.5, 0], [.5, 0], [0, -.025], [0, .025]]) { const v2 = K.VMAX * (p + dp), q = P.simulate(lv, Math.cos((a + da) * D) * v2, Math.sin((a + da) * D) * v2, t0, K.MAX_STEPS, null); if (q.status === 'hit') ok++; }
    const c = s.collected.reduce((x, y) => x + y, 0);
    if (ok >= 2 && (!best || c > best.c)) best = { vx: Math.round(vx * 1000) / 1000, vy: Math.round(vy * 1000) / 1000, t0Step: t0, c, fog: s.fog, beams: s.beams, warps: s.warps };
  }
  if (!best) throw new Error('no solution for ' + lv.id);
  const chk = P.simulate(lv, best.vx, best.vy, best.t0Step, K.MAX_STEPS);
  if (chk.status !== 'hit' || !uses(lv, chk)) throw new Error('rounded solution failed for ' + lv.id);
  lv.solution = { vx: best.vx, vy: best.vy, t0Step: best.t0Step };
  console.log(lv.id, 'solution t0', best.t0Step, 'fog', chk.fog, 'beams', chk.beams, 'warps', chk.warps, 'frags', best.c + '/' + lv.frags.length);
}
fs.writeFileSync(path.join(__dirname, 'fixtures-v4.json'), JSON.stringify(F, null, 1));
