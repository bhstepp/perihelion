#!/usr/bin/env node
/* PERIHELION — "full clear" courses (owner: LEAD).
   For every campaign plate that has comet fragments, finds ONE launch that collects every fragment AND hits the target
   (the only way to earn three stars with the full set), and stores it in src/20-levels.js between the @CLEAR and @ENDCLEAR markers.
   The astronomer's hint draws this course instead of the plain winning one. The CAMPAIGN lines are never touched (Volume I is
   byte-frozen), so the table lives beside them: Levels.CLEAR[i] = {vx, vy, t0Step} | null (plates without fragments).
   Search: angle (720 x 0.5 deg) x power (0.10..1.00 step 0.025) x a few launch times (moving plates only), using the frozen
   Physics.simulate. Every full-clear shot is scored by how many of its grid neighbours also fully clear (finger precision), the
   best 30 are re-scored on a finer grid (+-1 deg, +-5% power), and the most forgiving one wins.
   usage: node tools/levels-clear.js             compute missing plates (2 worker processes, resumable cache in tools/levels-cache/), then write the block
          node tools/levels-clear.js --verify    check every stored course with the frozen physics (hit + all fragments)  */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), LEVELS = path.join(ROOT, 'src', '20-levels.js'), CACHE = path.join(__dirname, 'levels-cache');
function loadFast() {
  const src = ['00-const.js', '10-physics.js', '20-levels.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  return vm.runInThisContext('(function(){' + src + '\n;return {K:K,Physics:Physics,Levels:Levels};})()', { filename: 'perihelion-src' });
}
const DEG = Math.PI / 180, NA = 720, NP = 37, PWR = j => 0.1 + 0.025 * j, T0S = [0, 120, 260, 450, 700];
const hasMoving = lv => lv.bodies.some(b => b.orbit);

function isClear(G, lv, vx, vy, t0) {
  const s = G.Physics.simulate(lv, vx, vy, t0, G.K.MAX_STEPS, null);
  return s.status === 'hit' && s.collected.every(x => x);
}
function shot(G, a, p) { const v = G.K.VMAX * Math.min(1, p); return { vx: Math.cos(a * DEG) * v, vy: Math.sin(a * DEG) * v }; }

function solvePlate(G, i) {
  const lv = G.Levels.CAMPAIGN[i];
  if (!lv.frags || !lv.frags.length) return { i, course: null };
  const t0s = hasMoving(lv) ? T0S : [0], hits = new Map();          // key t*1e6 + a*100 + j
  const key = (t, a, j) => (t * 1000 + ((a % NA) + NA) % NA) * 100 + j;
  t0s.forEach((t0, ti) => { for (let a = 0; a < NA; a++) for (let j = 0; j < NP; j++) {
    const v = shot(G, a * 0.5, PWR(j)); if (isClear(G, lv, v.vx, v.vy, t0)) hits.set(key(ti, a, j), [ti, a, j]); } });
  if (!hits.size) return { i, course: null, error: 'no full-clear shot found' };
  const scored = [];
  hits.forEach(([ti, a, j]) => { let n = 0;
    for (let da = -2; da <= 2; da++) for (let dj = -2; dj <= 2; dj++) if (j + dj >= 0 && j + dj < NP && hits.has(key(ti, a + da, j + dj))) n++;
    scored.push({ ti, a, j, n }); });
  scored.sort((x, y) => y.n - x.n);
  let best = null;
  for (const c of scored.slice(0, 30)) {
    let n = 0; const a0 = c.a * 0.5, p0 = PWR(c.j);
    for (let da = -1; da <= 1.001; da += 0.25) for (let dp = -0.05; dp <= 0.0501; dp += 0.0125) {
      const v = shot(G, a0 + da, p0 + dp); if (isClear(G, lv, v.vx, v.vy, t0s[c.ti])) n++; }
    if (!best || n > best.n) best = { n, a0, p0, t0: t0s[c.ti] };
  }
  let v = shot(G, best.a0, best.p0);
  const r3 = x => Math.round(x * 1000) / 1000;
  if (isClear(G, lv, r3(v.vx), r3(v.vy), best.t0)) v = { vx: r3(v.vx), vy: r3(v.vy) };
  if (!isClear(G, lv, v.vx, v.vy, best.t0)) return { i, course: null, error: 'chosen shot failed re-check' };
  return { i, course: { vx: v.vx, vy: v.vy, t0Step: best.t0 }, robust: best.n + '/81', fullHits: hits.size };
}

function verify() {
  const G = loadFast(), L = G.Levels.CAMPAIGN, C = G.Levels.CLEAR; let bad = 0, n = 0;
  if (!C || C.length !== L.length) { console.log('FAIL Levels.CLEAR missing or wrong length'); process.exit(1); }
  L.forEach((lv, i) => {
    const has = lv.frags && lv.frags.length;
    if (!has) { if (C[i] !== null) { bad++; console.log('FAIL plate', i + 1, 'has no fragments but a course is stored'); } return; }
    if (!C[i]) { bad++; console.log('FAIL plate', i + 1, 'no full-clear course'); return; }
    n++; if (!isClear(G, lv, C[i].vx, C[i].vy, C[i].t0Step | 0)) { bad++; console.log('FAIL plate', i + 1, 'course does not hit + collect all'); }
  });
  console.log(bad ? 'FAIL: ' + bad : 'levels-clear OK: ' + n + ' full-clear courses verified (hit + every fragment), ' + (L.length - n) + ' plates without fragments');
  process.exit(bad ? 1 : 0);
}

function writeBlock(rows) {
  const src = fs.readFileSync(LEVELS, 'utf8');
  const body = '/*@CLEAR*/var CLEAR = [\n' + rows.map((r, i) => '    ' + (r ? JSON.stringify({ vx: r.vx, vy: r.vy, t0Step: r.t0Step }).replace(/"/g, '') : 'null') + (i < rows.length - 1 ? ',' : '')).join('\n') + '\n  ];/*@ENDCLEAR*/';
  let out;
  if (src.includes('/*@CLEAR*/')) out = src.replace(/\/\*@CLEAR\*\/[\s\S]*?\/\*@ENDCLEAR\*\//, () => body);
  else out = src.replace('/*@END*/\n', () => '/*@END*/\n\n  // Full-clear courses (tools/levels-clear.js): one launch that gathers every fragment and hits the target. Drawn by the hint.\n  ' + body + '\n');
  if (out === src) throw new Error('could not place the CLEAR block');
  fs.writeFileSync(LEVELS, out);
}

if (process.argv[2] === '--verify') verify();
else if (process.argv[2] === '--worker') {
  const G = loadFast(); fs.mkdirSync(CACHE, { recursive: true });
  for (const i of process.argv[3].split(',').map(Number)) {
    const f = path.join(CACHE, 'clear-' + i + '.json'); if (fs.existsSync(f)) continue;
    const r = solvePlate(G, i); fs.writeFileSync(f, JSON.stringify(r)); console.log('plate', i + 1, r.course ? r.robust + ' fullHits ' + r.fullHits : r.error || 'no fragments');
  }
} else {
  fs.mkdirSync(CACHE, { recursive: true });
  const NT = loadFast().Levels.CAMPAIGN.length, N = +(process.env.LEVELS_JOBS || 2), groups = Array.from({ length: N }, () => []); for (let i = 0; i < NT; i++) groups[i % N].push(i);
  let done = 0;
  groups.forEach(g => { const c = cp.spawn('node', [__filename, '--worker', g.join(',')], { stdio: 'inherit' });
    c.on('close', () => { if (++done < N) return;
      const rows = []; for (let i = 0; i < NT; i++) { const f = path.join(CACHE, 'clear-' + i + '.json');
        if (!fs.existsSync(f)) { console.log('missing plate', i + 1); process.exit(1); }
        const r = JSON.parse(fs.readFileSync(f, 'utf8')); if (r.error) { console.log('plate', i + 1, r.error); process.exit(1); } rows.push(r.course); }
      writeBlock(rows); console.log('wrote CLEAR block'); }); });
}
