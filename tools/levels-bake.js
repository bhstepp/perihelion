#!/usr/bin/env node
/* PERIHELION — campaign baker (owner: LEVEL AGENT).
   Seeded generator (the runtime Levels._gen.build, so Endless and Campaign share one generator) + brute-force
   solver over launch angle (720 x 0.5 deg) x power (0.10..1.00, 0.025) using the frozen Physics.simulate.
   Writes the 30 verified plates as a data literal into src/20-levels.js between the @CAMPAIGN markers.
   usage: node tools/levels-bake.js            bake all 30 (2 worker processes) and write the module
          node tools/levels-bake.js --only 0,5 bake + print only those indices (no write)
          node tools/levels-bake.js --verify    re-verify the baked CAMPAIGN through tools/load.js (vm) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), LEVELS = path.join(ROOT, 'src', '20-levels.js');

// Load modules into THIS context (vm contexts make global lookups ~15x slower; results are bit-identical).
function loadFast() {
  const src = ['00-const.js', '10-physics.js', '20-levels.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  return vm.runInThisContext('(function(){' + src + '\n;return {K:K,Physics:Physics,Levels:Levels,toRoman:toRoman};})()', { filename: 'perihelion-src' });
}

const NA = 720, NP = 37;                                 // grid: angle k*0.5 deg, power 0.1+0.025*j
const PWR = j => 0.1 + 0.025 * j;
const T0S = [0, 90, 200, 333];
// 3-star difficulty curve: target hit ratio m(d), accept within [m/BAND, m*BAND]
// L1-5 (no blocker yet): 3.9% -> 2.9%; from L6 every hit must bend: 2.2% -> 0.7% by L30 (geometric).
// (A 4-8% ratio over the full 360 deg x power grid is not reachable with one r<=85 planet: ~4.3% max found.)
const BAND = 1.22;
const target = d => { const i = Math.round(d * 29); return i < 5 ? 0.039 * Math.pow(2.9 / 3.9, i / 4) : 0.022 * Math.pow(0.7 / 2.2, (i - 5) / 24); };

function makeCtx(G) {
  const g = G.Levels._gen, K = G.K;
  function grid(L, t0, stride) {
    const H = new Uint8Array(NA * NP); let h = 0, n = 0;
    for (let k = 0; k < NA; k += stride || 1) for (let j = 0; j < NP; j++) { n++; if (g.hit(L, k * 0.5, PWR(j), t0)) { H[k * NP + j] = 1; h++; } }
    return { H, ratio: h / n, hits: h };
  }
  const at = (H, k, j) => (j < 0 || j >= NP) ? 0 : H[((k % NA + NA) % NA) * NP + j];
  // neighbourhood score: angle +-1 deg (k+-2), power +-0.025 (j+-1) -> 15 cells
  function hood(H, k, j) { let s = 0; for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++) s += at(H, k + a, Math.min(NP - 1, j + b)); return s; }
  function robustSol(L, H, t0, need, minHood) {
    const c = [];
    for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) if (H[k * NP + j]) { const s = hood(H, k, j); if (s >= minHood) c.push([s, k, j]); }
    c.sort((a, b) => b[0] - a[0] || Math.abs(a[2] - 22) - Math.abs(b[2] - 22));
    for (let q = 0; q < Math.min(c.length, 25); q++) {
      const [s, k, j] = c[q], sc = g.robust(L, k * 0.5, PWR(j), t0);
      if (sc >= need) return { k, j, hood: s, robust: sc };
    }
    return null;
  }
  function runWidth(H, k, j) { let a = 0, b = 0; while (a < NA && at(H, k - a - 1, j)) a++; while (b < NA && at(H, k + b + 1, j)) b++; return (a + b + 1) * 0.5; }
  function components(H) {
    const lab = new Int32Array(NA * NP).fill(-1), sizes = []; let id = 0;
    for (let s = 0; s < NA * NP; s++) if (H[s] && lab[s] < 0) {
      const st = [s]; lab[s] = id; let n = 0;
      while (st.length) {
        const c = st.pop(), k = (c / NP) | 0, j = c % NP; n++;
        for (const [dk, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jj = j + dj; if (jj < 0 || jj >= NP) continue;
          const kk = (k + dk + NA) % NA, q = kk * NP + jj;
          if (H[q] && lab[q] < 0) { lab[q] = id; st.push(q); }
        }
      }
      sizes.push(n); id++;
    }
    return { lab, sizes };
  }
  function straightClear(L, moving) {
    const P = []; for (let j = 0; j < NP; j++) P.push(PWR(j));
    for (const t0 of moving ? T0S : [0]) if (g.straightHits(L, t0, P)) return false;
    return true;
  }
  return { g, K, grid, robustSol, runWidth, components, straightClear, hood };
}

function bakeLevel(C, G, i) {
  const { g, K } = C, d = i / 29, m = target(d), base = 7000 + 131 * i;
  const log = { rejected: { build: 0, straight: 0, band: 0, robust: 0, timing: 0, frags: 0 } };
  for (let r = 0; r < 1500; r++) {
    const seed = base + 1000 * r;
    const L = g.build(seed, d);
    if (!L) { log.rejected.build++; continue; }
    const nf = L._frags, moving = L.bodies.some(b => b.orbit);
    if (i >= 5 && !C.straightClear(L, moving)) { log.rejected.straight++; continue; }
    const quick = C.grid(L, 0, 6); // cheap ratio estimate first
    if (quick.ratio < m / (BAND * 1.3) || quick.ratio > m * BAND * 1.3) { log.rejected.band++; continue; }
    const G0 = C.grid(L, 0);
    if (G0.ratio < m / BAND || G0.ratio > m * BAND) { log.rejected.band++; continue; }
    const s0 = C.robustSol(L, G0.H, 0, 8, 12);
    if (!s0) { log.rejected.robust++; continue; }
    // moving bodies: robust solutions at >= 3 of 4 launch times
    let tOK = 1;
    const tInfo = [0];
    if (moving) {
      for (const t0 of T0S.slice(1)) {
        let s = G.Levels.solve(L, { t0Step: t0, maxSims: 2500, minRobust: 7 });
        if (!s) { const Gt = C.grid(L, t0, 1); s = C.robustSol(L, Gt.H, t0, 7, 11); }
        if (s) { tOK++; tInfo.push(t0); }
        if (tOK + (3 - T0S.indexOf(t0)) < 3) break;
      }
      if (tOK < 3) { log.rejected.timing++; continue; }
    }
    const aDeg = s0.k * 0.5, pw = PWR(s0.j), v = g.launch(aDeg, pw);
    const sol = { vx: v.vx, vy: v.vy, t0Step: 0 };
    if (G.Physics.simulate(L, sol.vx, sol.vy, 0, K.MAX_STEPS).status !== 'hit') { log.rejected.robust++; continue; }
    // fragments on a different hit path
    let frags = [], fragInfo = '-', fragSol;
    if (nf) {
      const { lab, sizes } = C.components(G0.H), home = lab[s0.k * NP + s0.j];
      const alts = [];
      for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) {
        const q = k * NP + j; if (!G0.H[q]) continue;
        const other = lab[q] !== home, far = Math.min(Math.abs(k - s0.k), NA - Math.abs(k - s0.k)) >= 10 || Math.abs(j - s0.j) >= 10;
        if (other && sizes[lab[q]] >= 3) alts.push([0, sizes[lab[q]] + C.hood(G0.H, k, j), k, j]);
        else if (!other && far) alts.push([1, C.hood(G0.H, k, j), k, j]);
      }
      alts.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      const rng = G.Levels.mulberry32(seed ^ 0x2545F491);
      for (let q = 0; q < Math.min(alts.length, 40) && !frags.length; q++) {
        const [kind, , k, j] = alts[q], va = g.launch(k * 0.5, PWR(j));
        const f = g.placeFrags(L, nf, { vx: va.vx, vy: va.vy, t0Step: 0 }, sol, rng);
        if (f) { frags = f; fragSol = { vx: va.vx, vy: va.vy, t0Step: 0 }; fragInfo = (kind ? 'same-cl ' : 'other-cl ') + (k * 0.5).toFixed(1) + '/' + PWR(j).toFixed(3); }
      }
      if (!frags.length) { log.rejected.frags++; continue; }
    }
    L.frags = frags; L.solution = sol;
    // the stored solution must not sweep up the fragments for free
    const sv = G.Physics.simulate(L, sol.vx, sol.vy, 0, K.MAX_STEPS);
    let freeF = 0; for (let q = 0; q < frags.length; q++) freeF += sv.collected[q];
    if (sv.status !== 'hit' || freeF) { log.rejected.frags++; continue; }
    g.finish(L);
    const lv = { id: 'c' + String(i + 1).padStart(2, '0'), index: i, seed, difficulty: g.d3(d), name: G.Levels.NAMES[i], plate: G.toRoman(i + 1),
      probe: L.probe, target: L.target, bodies: L.bodies, frags: L.frags, solution: L.solution };
    if (fragSol) lv.fragSolution = fragSol; // extra (optional): a verified hit that collects every fragment
    return { level: lv, stats: { i, seed, tries: r + 1, ratio: G0.ratio, target: m, hood: s0.hood, robust: s0.robust, angle: aDeg, power: pw,
      width: C.runWidth(G0.H, s0.k, s0.j), frags: frags.length, fragInfo, straight: i >= 5 ? 'blocked' : 'n/a', timing: moving ? tInfo.join('/') : 'static',
      bodies: lv.bodies.map(b => b.pair ? 'b' : ({ planet: 'P', moon: 'M', blackhole: 'H', repulsor: 'R' })[b.kind]).join('') }, log };
  }
  return { level: null, stats: { i }, log };
}

/* ---------- compact literal writer ---------- */
function num(n) {
  let s = String(n);
  if (Number.isInteger(n) && Math.abs(n) >= 1000) { const e = n.toExponential().replace('e+', 'e'); if (Number(e) === n && e.length < s.length) s = e; }
  if (s.startsWith('0.')) s = s.slice(1); else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}
function lit(v) {
  if (v === null) return 'null';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(lit).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).map(k => k + ':' + lit(v[k])).join(',') + '}';
}

function writeModule(levels) {
  const src = fs.readFileSync(LEVELS, 'utf8');
  const a = src.indexOf('/*@CAMPAIGN*/'), b = src.indexOf('/*@END*/');
  if (a < 0 || b < 0) throw new Error('markers missing');
  const body = '/*@CAMPAIGN*/var CAMPAIGN = [\n' + levels.map(l => '    ' + lit(l)).join(',\n') + '\n  ];/*@END*/';
  fs.writeFileSync(LEVELS, src.slice(0, a) + body + src.slice(b + 8));
}

function table(rows) {
  console.log('idx name                      seed   try bodies  hit%   tgt%  width  rob hood  sol(a/p)       frags  timing       straight');
  for (const s of rows) {
    if (!s.seed) { console.log(String(s.i).padStart(3), 'FAILED'); continue; }
    console.log(String(s.i).padStart(3), (s.name || '').padEnd(25), String(s.seed).padEnd(6), String(s.tries).padStart(4), s.bodies.padEnd(7),
      (100 * s.ratio).toFixed(2).padStart(5), (100 * s.target).toFixed(2).padStart(6), (s.width.toFixed(1) + '°').padStart(6),
      String(s.robust).padStart(4), String(s.hood).padStart(4), ('  ' + s.angle.toFixed(1) + '/' + s.power.toFixed(3)).padEnd(15),
      String(s.frags).padStart(5), ' ' + s.timing.padEnd(12), s.straight, s.fragInfo !== '-' ? ' frag-path ' + s.fragInfo : '');
  }
}

function verify() {
  // Through the real runtime loader (vm context), on the parsed literal — i.e. the exact baked numbers.
  const G = require('./load.js').load(), C = G.Levels.CAMPAIGN, K = G.K;
  let ok = true; const ids = new Set(), names = new Set();
  if (C.length !== 30) { console.log('CAMPAIGN length', C.length); ok = false; }
  C.forEach((L, i) => {
    const s = L.solution, sim = G.Physics.simulate(L, s.vx, s.vy, s.t0Step, K.MAX_STEPS);
    const probs = [];
    if (sim.status !== 'hit') probs.push('solution ' + sim.status);
    for (let q = 0; q < L.frags.length; q++) if (sim.collected[q]) probs.push('solution collects frag ' + q);
    if (L.index !== i || L.plate !== G.toRoman(i + 1)) probs.push('index/plate');
    if (ids.has(L.id) || names.has(L.name)) probs.push('duplicate id/name'); ids.add(L.id); names.add(L.name);
    const g = G.Levels._gen;
    if (L.frags.length) {
      const fs2 = L.fragSolution, fsim = fs2 && G.Physics.simulate(L, fs2.vx, fs2.vy, 0, K.MAX_STEPS);
      if (!fsim || fsim.status !== 'hit' || Array.from(fsim.collected).some(c => !c)) probs.push('fragSolution does not collect all fragments');
    }
    const moving = L.bodies.some(b => b.orbit), sa = Math.atan2(s.vy, s.vx) / Math.PI * 180, sp = Math.hypot(s.vx, s.vy) / K.VMAX;
    if (g.robust(L, sa, sp, 0) < 8) probs.push('solution not robust');
    if (i >= 5) { const P = []; for (let j = 0; j < 37; j++) P.push(0.1 + 0.025 * j); for (const t0 of moving ? [0, 90, 200, 333] : [0]) if (g.straightHits(L, t0, P)) probs.push('straight shot hits at t0=' + t0); }
    for (let a = 0; a < L.bodies.length; a++) {
      if (g.pointGap(L.bodies[a], L.probe.x, L.probe.y) < 140) probs.push('probe clearance');
      if (g.pointGap(L.bodies[a], L.target.x, L.target.y) < 110) probs.push('target clearance');
      for (let b = a + 1; b < L.bodies.length; b++) if (g.bodyGap(L.bodies[a], L.bodies[b]) < 30) probs.push('body overlap');
    }
    // time-sampled overlap check over 60 s (belt and braces for moving bodies)
    const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
    for (let t = 0; t < 60 && L.bodies.some(b => b.orbit); t += 0.02)
      for (let a = 0; a < L.bodies.length; a++) {
        const A = L.bodies[a]; G.Physics.bodyPos(A, t, pa);
        const ea = A.kind === 'blackhole' ? A.capture : A.r;
        if (pa.x - ea < 40 || pa.x + ea > 860 || pa.y - ea < 40 || pa.y + ea > 1560) { probs.push('out of world t=' + t.toFixed(2)); t = 99; break; }
        for (let b = a + 1; b < L.bodies.length; b++) {
          const B = L.bodies[b]; G.Physics.bodyPos(B, t, pb);
          if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < ea + (B.kind === 'blackhole' ? B.capture : B.r)) { probs.push('overlap t=' + t.toFixed(2)); t = 99; break; }
        }
      }
    if (probs.length) { ok = false; console.log('L' + (i + 1), L.name, probs.join('; ')); }
  });
  console.log(ok ? 'verify: all 30 baked plates OK (solutions hit & robust >= 8/9, straight shots miss from L6, fragment paths collect all, clearances hold, solutions collect no fragments)' : 'verify: FAILED');
  return ok;
}

/* ---------- main ---------- */
const argv = process.argv.slice(2);
if (argv[0] === '--worker') {
  const G = loadFast(), C = makeCtx(G);
  const out = argv[1].split(',').map(Number).map(i => { const r = bakeLevel(C, G, i); if (r.stats.seed) r.stats.name = G.Levels.NAMES[i]; return r; });
  process.stdout.write(JSON.stringify(out));
} else if (argv[0] === '--verify') {
  process.exit(verify() ? 0 : 1);
} else {
  const only = argv[0] === '--only' ? argv[1].split(',').map(Number) : null;
  const idx = only || Array.from({ length: 30 }, (_, i) => i);
  const t = Date.now(), NW = 2;
  // interleave heavy and light levels across workers
  const parts = Array.from({ length: NW }, () => []);
  idx.slice().sort((a, b) => b - a).forEach((i, q) => parts[q % NW].push(i));
  Promise.all(parts.filter(p => p.length).map(p => new Promise((res, rej) => {
    cp.execFile(process.execPath, [__filename, '--worker', p.join(',')], { maxBuffer: 1 << 26 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(JSON.parse(so)));
  }))).then(rs => {
    const all = [].concat(...rs).sort((a, b) => a.stats.i - b.stats.i);
    table(all.map(r => r.stats));
    all.forEach(r => { if (!r.level) console.log('L' + (r.stats.i + 1), 'rejections', JSON.stringify(r.log.rejected)); });
    console.log('rejections by reason:', JSON.stringify(all.reduce((acc, r) => { for (const k in r.log.rejected) acc[k] = (acc[k] || 0) + r.log.rejected[k]; return acc; }, {})));
    console.log('bake time', ((Date.now() - t) / 1000).toFixed(1) + ' s');
    if (only) return;
    if (all.some(r => !r.level)) { console.log('NOT writing: some levels failed'); process.exit(1); }
    writeModule(all.map(r => r.level));
    console.log('wrote', path.relative(ROOT, LEVELS), (fs.statSync(LEVELS).size / 1024).toFixed(1) + ' KB');
    process.exit(verify() ? 0 : 1);
  }).catch(e => { console.error(e); process.exit(1); });
}
