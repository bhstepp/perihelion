#!/usr/bin/env node
/* PERIHELION — Endless generator benchmark & checks (owner: LEVEL AGENT).
   usage: node tools/levels-endless-bench.js [nSeeds=50]
   Times Levels.generate over n seeds x difficulties, checks determinism and that every returned plate's
   `solution` hits. Timed in this context (JIT'd, like a browser) and, for reference, in the vm loader. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const src = ['00-const.js', '10-physics.js', '20-levels.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
const G = vm.runInThisContext('(function(){' + src + '\n;return {K:K,Physics:Physics,Levels:Levels};})()');
const N = +process.argv[2] || 100;

function run(Gx, label) {
  const times = [], fails = [];
  let frags = 0, bodies = 0, fallback = 0; const gs = Gx.Levels._gen.genStats, fb0 = gs.fallback, em0 = gs.empty;
  for (let q = 0; q < N; q++) {
    const seed = 1 + q * 7919, d = (q % 26) / 25;
    const t = process.hrtime.bigint();
    const L = Gx.Levels.generate(seed, d);
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
    const s = L.solution, sim = Gx.Physics.simulate(L, s.vx, s.vy, s.t0Step, Gx.K.MAX_STEPS);
    if (sim.status !== 'hit') fails.push(seed + ':' + sim.status);
    const fbNow = gs.fallback;
    if (JSON.stringify(Gx.Levels.generate(seed, d)) !== JSON.stringify(L)) fails.push(seed + ':nondeterministic');
    gs.fallback = fbNow; // don't double-count the determinism re-run
    const rs = Gx.Levels._gen.robust(L, Math.atan2(s.vy, s.vx) * 180 / Math.PI, Math.hypot(s.vx, s.vy) / Gx.K.VMAX, 0, 7);
    if (L.bodies.length && rs < 7) fails.push(seed + ':not-robust');
    frags += L.frags.length; bodies += L.bodies.length;
  }
  const mean = times.reduce((a, b) => a + b, 0) / N, sorted = times.slice().sort((a, b) => a - b);
  console.log(`${label}: ${N} plates  mean ${mean.toFixed(1)} ms  median ${sorted[N >> 1].toFixed(1)} ms  p90 ${sorted[Math.floor(N * 0.9)].toFixed(1)} ms  max ${sorted[N - 1].toFixed(1)} ms` +
    `  | avg bodies ${(bodies / N).toFixed(1)}, avg frags ${(frags / N).toFixed(1)}, fallbacks ${gs.fallback - fb0} (empty ${gs.empty - em0}), failures ${fails.length ? fails.join(' ') : 0}`);
  return fails.length === 0;
}
let ok = run(G, 'node (main ctx)');
if (process.argv.includes('--vm')) ok = run(require('./load.js').load(), 'node (vm ctx, slow globals)') && ok;
process.exit(ok ? 0 : 1);
