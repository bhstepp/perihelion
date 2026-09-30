#!/usr/bin/env node
/* PERIHELION — Levels.daily(dateKey) test (owner: LEVEL AGENT).
   usage: node tools/levels-daily-test.js [days=400] [start=2026-09-01]
   Checks, for `days` consecutive dates: solvable (stored solution hits from t0Step 0, robust >= 7/9), key fields
   (id/plate/caption/name), weekday difficulty (independent Date.UTC weekday as the oracle), same key -> identical object on
   a second call, timing (mean <= 12 ms, max <= 60 ms; timed in this JIT'd context), the share of dates that needed a
   fallback archetype ("trivially easy layout"), and determinism across two fresh node processes (sha256 of the JSON of 60 dates). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
function load() {
  const src = ['00-const.js', '10-physics.js', '20-levels.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  return vm.runInThisContext('(function(){' + src + '\n;return {K:K,Physics:Physics,Levels:Levels};})()');
}
function keyOf(startMs, n) { return new Date(startMs + n * 86400000).toISOString().slice(0, 10); }
const START = process.argv[3] && /^\d{4}-\d\d-\d\d$/.test(process.argv[3]) ? process.argv[3] : '2026-09-01', T0 = Date.parse(START + 'T00:00:00Z');

if (process.argv[2] === '--hash') { // child mode: hash of 60 dates
  const G = load(), h = crypto.createHash('sha256');
  for (let n = 0; n < 60; n++) h.update(JSON.stringify(G.Levels.daily(keyOf(T0, n))));
  process.stdout.write(h.digest('hex'));
  process.exit(0);
}

const N = +process.argv[2] || 400, G = load(), g = G.Levels._gen, K = G.K, gs = g.genStats;
const MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WD = [0.85, 0.30, 0.38, 0.46, 0.55, 0.65, 0.75]; // by getUTCDay(): Sun..Sat
const bad = [], times = [], names = new Set(); let frags = 0, bodies = 0, fbDates = [], easedN = 0, trivN = 0, withFrags = 0;
const byDow = Array.from({ length: 7 }, () => ({ n: 0, ms: 0, fb: 0 }));
for (let n = 0; n < N; n++) {
  const key = keyOf(T0, n), dow = new Date(key + 'T00:00:00Z').getUTCDay(), st0 = gs.stage.slice();
  const t = process.hrtime.bigint(), L = G.Levels.daily(key), ms = Number(process.hrtime.bigint() - t) / 1e6;
  times.push(ms); byDow[dow].n++; byDow[dow].ms += ms;
  const stg = gs.stage.findIndex((v, q) => v > st0[q]), fell = stg > 0, triv = stg >= 5 || (stg > 0 && G.Levels.daily(key).difficulty <= 0.2); if (fell) easedN++; if (triv) { trivN++; fbDates.push(key + '(s' + stg + ')'); byDow[dow].fb++; }
  const p = [], s = L.solution, cap = 'DAILY · ' + key.slice(8) + ' ' + MONS[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4);
  if (L.id !== 'd' + key) p.push('id ' + L.id);
  if (L.plate !== 'DAILY') p.push('plate');
  if (L.caption !== cap) p.push('caption ' + L.caption);
  if (!L.name || names.size > 1e9) p.push('name');
  if (Math.abs(L.difficulty - WD[dow]) > 0.0006 && !fell) p.push('difficulty ' + L.difficulty + ' want ' + WD[dow]);
  if (!s || s.t0Step !== 0) p.push('solution/t0Step');
  else {
    const sim = G.Physics.simulate(L, s.vx, s.vy, 0, K.MAX_STEPS);
    if (sim.status !== 'hit') p.push('solution ' + sim.status);
    else if (L.bodies.length && g.robust(L, Math.atan2(s.vy, s.vx) * 180 / Math.PI, Math.hypot(s.vx, s.vy) / K.VMAX, 0, 7) < 7) p.push('not robust');
  }
  if (JSON.stringify(G.Levels.daily(key)) !== JSON.stringify(L)) p.push('nondeterministic (same process)');
  frags += L.frags.length; if (L.frags.length) withFrags++; bodies += L.bodies.length; names.add(L.name);
  if (p.length) bad.push(key + ': ' + p.join(', '));
}
const mean = times.reduce((a, b) => a + b, 0) / N, sorted = times.slice().sort((a, b) => a - b), max = sorted[N - 1];
const rate = trivN / N;
console.log(`daily x${N} from ${START}: mean ${mean.toFixed(1)} ms  median ${sorted[N >> 1].toFixed(1)}  p90 ${sorted[Math.floor(N * .9)].toFixed(1)}  p99 ${sorted[Math.floor(N * .99)].toFixed(1)}  max ${max.toFixed(1)} ms` +
  ` | avg bodies ${(bodies / N).toFixed(1)}, frags ${(frags / N).toFixed(1)}, distinct names ${names.size}`);
console.log(`ladder stage reached (0 = asked difficulty): ${gs.stage.slice(0, 6).join(' / ')}  | eased below the asked difficulty on ${easedN} of ${N} dates (${(100 * easedN / N).toFixed(1)}%), TRIVIAL fallback (landed on difficulty <= 0.2 or an empty plate) on ${trivN} (${(100 * rate).toFixed(1)}%)` + (fbDates.length ? '  e.g. ' + fbDates.slice(0, 5).join(' ') : ''));
console.log(`plates with comet fragments: ${withFrags} of ${N}`);
console.log('by weekday (Sun..Sat): mean ms / trivial fallbacks: ' + byDow.map(d => `${(d.ms / (d.n || 1)).toFixed(1)}/${d.fb}`).join('  '));
// weekday oracle for the keys the app is likely to see (year edges, leap day)
const edge = ['2024-02-29', '2026-12-31', '2027-01-01', '2100-03-01', '2000-01-01', '1999-12-31'], eb = [];
for (const k of edge) { const want = WD[new Date(k + 'T00:00:00Z').getUTCDay()], got = G.Levels.daily(k).difficulty; if (Math.abs(got - want) > 0.0006) eb.push(k + ' d=' + got + ' want ' + want); }
// cross-process determinism
const hs = [0, 1].map(() => cp.execFileSync(process.execPath, [__filename, '--hash', START], { encoding: 'utf8' }));
const h = crypto.createHash('sha256'); for (let n = 0; n < 60; n++) h.update(JSON.stringify(G.Levels.daily(keyOf(T0, n))));
const same = hs[0] === hs[1] && hs[0] === h.digest('hex');
console.log('determinism across 2 fresh processes + this one (60 dates): ' + (same ? 'identical ' + hs[0].slice(0, 16) : 'MISMATCH ' + hs.join(' ')));
const fails = [];
if (bad.length) fails.push(bad.length + ' bad plates:\n  ' + bad.slice(0, 10).join('\n  '));
if (mean > 12) fails.push('mean ' + mean.toFixed(1) + ' ms > 12');
if (max > 60) fails.push("max " + max.toFixed(1) + " ms > 60");
if (rate > 0.15) fails.push('trivial fallback rate ' + (100 * rate).toFixed(1) + '% > 15%');
if (!same) fails.push('cross-process determinism');
if (eb.length) fails.push('weekday edge: ' + eb.join('; '));
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
process.exit(fails.length ? 1 : 0);
