#!/usr/bin/env node
/* PERIHELION — campaign baker (owner: LEVEL AGENT).
   Seeded generator (the runtime Levels._gen.build, so Endless and Campaign share one generator) + brute-force
   solver over launch angle (720 x 0.5 deg) x power (0.10..1.00, 0.025) using the frozen Physics.simulate.
   Volume I (plates 1-30, index 0..29) is FROZEN: its 30 literal lines in src/20-levels.js are never rewritten (players hold
   stars against them; tools/levels-golden.json pins their sha256). This tool bakes Volume II (index 30..59, plates XXXI..LX)
   and writes the module as  [30 frozen lines].concat([30 new lines])  between the @CAMPAIGN markers.
   usage: node tools/levels-bake.js               bake the missing Volume II plates (2 worker processes, resumable: each finished
                                                  plate is cached in tools/levels-cache/), then write the module when all 30 exist
          node tools/levels-bake.js --only 30,31  bake + print only those indices (no write, no cache; works for 0..59)
          node tools/levels-bake.js --assemble    write the module from the cache only (no baking)
          node tools/levels-bake.js --verify      verify all 60 plates + the Volume I hashes (tools/load.js, vm context) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), LEVELS = path.join(ROOT, 'src', '20-levels.js'), CACHE = path.join(__dirname, 'levels-cache');
const GOLDEN = path.join(__dirname, 'levels-golden.json');
const V2 = 30, NTOTAL = 60;
// Volume II names: obsolete constellations and 19th-century observatory matters (none reused from Levels.NAMES).
const NAMES2 = ['Argo Navis', 'Quadrans Muralis', 'Custos Messium', 'Honores Frederici', 'Globus Aerostaticus',
  'Brandenburg Sceptre', 'Mons Maenalus', 'Telescopium Herschelii', 'Officina Typographica', 'Machina Electrica',
  'Lochium Funis', 'Tarandus', 'Cerberus', 'Antinous', 'Noctua',
  'The Transit of Venus', 'The Zenith Sector', 'Georgium Sidus', 'Leverrier\'s Planet', 'The Zodiacal Light',
  'Encke\'s Comet', 'Piazzi\'s Ceres', 'Olbers\' Paradox', 'Struve\'s Doubles', 'The Meridian Circle',
  'The Heliometer', 'Cassini\'s Division', 'The Nautical Almanac', 'The Great Comet', 'Halley\'s Return'];
const DEG = Math.PI / 180, rnd3 = x => Math.round(x * 1000) / 1000;
// difficulty field: Volume I i/29 (0..1); Volume II 1.02 .. 1.6 (Levels.build/recipe have a d > 1 branch for it)
// Volume II shape rules (index): 4..7 bodies; from plate 41 at least 5, from plate 58 at least 6; moving bodies (moons, binaries):
// none required before plate 36, at least 1 to plate 45, at least 2 after.
const minBodies = i => i >= 57 ? 6 : i >= 40 ? 5 : 4, minMoving = i => i >= 45 ? 2 : i >= 35 ? 1 : 0;
const diffOf = i => i < V2 ? i / 29 : 1 + 0.6 * (i - 29) / 30;

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
// Volume II: 0.9% at plate 31 falling geometrically to 0.32% at plate 60.
const BAND = 1.22, BAND2 = 1.25;
const target = i => i >= V2 ? 0.009 * Math.pow(0.32 / 0.9, (i - V2) / 29) : i < 5 ? 0.039 * Math.pow(2.9 / 3.9, i / 4) : 0.022 * Math.pow(0.7 / 2.2, (i - 5) / 24);

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
  const { g, K } = C, vol2 = i >= V2, d = diffOf(i), m = target(i), base = (vol2 ? 31000 : 7000) + 131 * i + (+process.env.LEVELS_SALT || 0), BND = vol2 ? BAND2 : BAND;
  const log = { rejected: { build: 0, shape: 0, straight: 0, band: 0, robust: 0, timing: 0, frags: 0 } };
  for (let r = 0; r < 4000; r++) {
    const seed = base + 1000 * r;
    if (vol2 && r % 40 === 39) process.stderr.write('  [' + (i + 1) + '] ' + (r + 1) + ' seeds  ' + JSON.stringify(log.rejected) + '\n');
    const L = g.build(seed, d);
    if (!L) { log.rejected.build++; continue; }
    const nf = L._frags, moving = L.bodies.some(b => b.orbit);
    if (vol2 && (L.bodies.length < minBodies(i) || L.bodies.filter(b => b.orbit).length < minMoving(i))) { log.rejected.shape++; continue; }
    if (i >= 5 && !C.straightClear(L, moving)) { log.rejected.straight++; continue; }
    const quick = C.grid(L, 0, 6); // cheap ratio estimate first
    if (quick.ratio < m / (BND * 1.3) || quick.ratio > m * BND * 1.3) { log.rejected.band++; continue; }
    const G0 = C.grid(L, 0);
    if (G0.ratio < m / BND || G0.ratio > m * BND) { log.rejected.band++; continue; }
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
    const sol = vol2 ? { vx: rnd3(v.vx), vy: rnd3(v.vy), t0Step: 0 } : { vx: v.vx, vy: v.vy, t0Step: 0 }; // Volume II: 3 decimals (module size), re-verified below
    if (G.Physics.simulate(L, sol.vx, sol.vy, 0, K.MAX_STEPS).status !== 'hit') { log.rejected.robust++; continue; }
    if (vol2 && g.robust(L, Math.atan2(sol.vy, sol.vx) / DEG, Math.hypot(sol.vx, sol.vy) / K.VMAX, 0) < 8) { log.rejected.robust++; continue; }
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
        if (f) { frags = f; fragSol = vol2 ? { vx: rnd3(va.vx), vy: rnd3(va.vy), t0Step: 0 } : { vx: va.vx, vy: va.vy, t0Step: 0 };
          if (vol2) { L.frags = f; const fv = G.Physics.simulate(L, fragSol.vx, fragSol.vy, 0, K.MAX_STEPS); if (fv.status !== 'hit' || Array.from(fv.collected).some(c => !c)) { frags = []; fragSol = null; continue; } } fragInfo = (kind ? 'same-cl ' : 'other-cl ') + (k * 0.5).toFixed(1) + '/' + PWR(j).toFixed(3); }
      }
      if (!frags.length) { log.rejected.frags++; continue; }
    }
    L.frags = frags; L.solution = sol;
    // the stored solution must not sweep up the fragments for free
    const sv = G.Physics.simulate(L, sol.vx, sol.vy, 0, K.MAX_STEPS);
    let freeF = 0; for (let q = 0; q < frags.length; q++) freeF += sv.collected[q];
    if (sv.status !== 'hit' || freeF) { log.rejected.frags++; continue; }
    g.finish(L);
    const lv = { id: 'c' + String(i + 1).padStart(2, '0'), index: i, seed, difficulty: g.d3(d), name: (G.Levels.NAMES.slice(0, 30).concat(NAMES2))[i], plate: G.toRoman(i + 1),
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

const sha = t => require('crypto').createHash('sha256').update(t).digest('hex');
const LINE_RE = /^    \{id:"c(\d\d)"/;
// The CAMPAIGN literal lines currently in the module, by index (text exactly as stored).
function campaignLines(src) {
  const a = src.indexOf('/*@CAMPAIGN*/'), b = src.indexOf('/*@END*/');
  if (a < 0 || b < 0) throw new Error('markers missing');
  return src.slice(a, b).split('\n').filter(l => LINE_RE.test(l));
}
// Volume I lines are carried over verbatim (never re-serialised); Volume II lines come from the cache / bake.
function writeModule(v2levels) {
  const src = fs.readFileSync(LEVELS, 'utf8'), a = src.indexOf('/*@CAMPAIGN*/'), b = src.indexOf('/*@END*/');
  const v1 = campaignLines(src).slice(0, V2);
  if (v1.length !== V2 || v2levels.length !== NTOTAL - V2) throw new Error('need 30 + 30 plates');
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).lines;
  v1.forEach((l, i) => { if (sha(l) !== gold[i]) throw new Error('Volume I plate ' + (i + 1) + ' differs from tools/levels-golden.json; refusing to write'); });
  const body = '/*@CAMPAIGN*/var CAMPAIGN = [\n' + v1.join('\n') + '\n  ].concat([\n' + v2levels.map(l => '    ' + lit(l)).join(',\n') + '\n  ]);/*@END*/';
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
  const G = require('./load.js').load(), C = G.Levels.CAMPAIGN, K = G.K, g = G.Levels._gen;
  let ok = true; const ids = new Set(), names = new Set();
  // Volume I is frozen: same text as when players started earning stars
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).lines, lines = campaignLines(fs.readFileSync(LEVELS, 'utf8'));
  if (lines.length !== NTOTAL) { console.log('CAMPAIGN literal lines', lines.length); ok = false; }
  for (let i = 0; i < V2; i++) if (!lines[i] || sha(lines[i]) !== gold[i]) { console.log('L' + (i + 1), 'FROZEN PLATE CHANGED'); ok = false; }
  if (C.length !== NTOTAL) { console.log('CAMPAIGN length', C.length); ok = false; }
  { const eh = require('./levels-endless-hash.js')(LEVELS), want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).endless.hash; if (eh !== want) { console.log('Endless generate() output changed vs golden'); ok = false; } }
  const V = G.Levels.VOLUMES; if (!V || V.length !== 2 || V[0].from !== 0 || V[0].to !== 29 || V[1].from !== 30 || V[1].to !== 59 || V[0].name !== 'Volume I' || V[1].name !== 'Volume II') { console.log('VOLUMES wrong'); ok = false; }
  const rows = [], PW = []; for (let j = 0; j < NP; j++) PW.push(PWR(j));
  C.forEach((L, i) => {
    const s = L.solution, sim = G.Physics.simulate(L, s.vx, s.vy, s.t0Step, K.MAX_STEPS), vol2 = i >= V2, moving = L.bodies.some(b => b.orbit);
    const probs = [];
    if (s.t0Step !== 0) probs.push('t0Step');
    if (sim.status !== 'hit') probs.push('solution ' + sim.status);
    for (let q = 0; q < L.frags.length; q++) if (sim.collected[q]) probs.push('solution collects frag ' + q);
    if (L.index !== i || L.plate !== G.toRoman(i + 1) || L.id !== 'c' + String(i + 1).padStart(2, '0')) probs.push('index/plate/id');
    if (ids.has(L.id) || names.has(L.name)) probs.push('duplicate id/name'); ids.add(L.id); names.add(L.name);
    if (L.frags.length) {
      const fs2 = L.fragSolution, fsim = fs2 && G.Physics.simulate(L, fs2.vx, fs2.vy, 0, K.MAX_STEPS);
      if (!fsim || fsim.status !== 'hit' || Array.from(fsim.collected).some(c => !c)) probs.push('fragSolution does not collect all fragments');
      else if (fs2.vx === s.vx && fs2.vy === s.vy) probs.push('fragSolution === solution');
    }
    const sa = Math.atan2(s.vy, s.vx) / Math.PI * 180, sp = Math.hypot(s.vx, s.vy) / K.VMAX;
    if (g.robust(L, sa, sp, 0) < 8) probs.push('solution not robust');
    if (i >= 5) for (const t0 of moving ? [0, 90, 200, 333] : [0]) if (g.straightHits(L, t0, PW)) probs.push('straight shot hits at t0=' + t0);
    for (let a = 0; a < L.bodies.length; a++) {
      if (g.pointGap(L.bodies[a], L.probe.x, L.probe.y) < 140) probs.push('probe clearance');
      if (g.pointGap(L.bodies[a], L.target.x, L.target.y) < 110) probs.push('target clearance');
      for (let b = a + 1; b < L.bodies.length; b++) if (g.bodyGap(L.bodies[a], L.bodies[b]) < 30) probs.push('body overlap');
    }
    // time-sampled overlap check over 60 s (belt and braces for moving bodies)
    const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
    for (let t = 0; t < 60 && moving; t += 0.02)
      for (let a = 0; a < L.bodies.length; a++) {
        const A = L.bodies[a]; G.Physics.bodyPos(A, t, pa);
        const ea = A.kind === 'blackhole' ? A.capture : A.r;
        if (pa.x - ea < 40 || pa.x + ea > 860 || pa.y - ea < 40 || pa.y + ea > 1560) { probs.push('out of world t=' + t.toFixed(2)); t = 99; break; }
        for (let b = a + 1; b < L.bodies.length; b++) {
          const B = L.bodies[b]; G.Physics.bodyPos(B, t, pb);
          if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < ea + (B.kind === 'blackhole' ? B.capture : B.r)) { probs.push('overlap t=' + t.toFixed(2)); t = 99; break; }
        }
      }
    if (vol2) { // Volume II extras: shape, hit ratio band, robust launch times
      const nb = L.bodies.length, m = target(i);
      if (nb < minBodies(i) || nb > 7) probs.push(nb + ' bodies');
      if (L.bodies.filter(b => b.orbit).length < minMoving(i)) probs.push('too few moving bodies');
      if (L.target.r < 26 || L.target.r > 38) probs.push('target r ' + L.target.r);
      if (L.frags.length < 2 || L.frags.length > 3) probs.push(L.frags.length + ' frags');
      if (Math.abs(L.difficulty - diffOf(i)) > 0.0006) probs.push('difficulty field');
      let h = 0; for (let k = 0; k < NA; k++) for (let j = 0; j < NP; j++) if (g.hit(L, k * 0.5, PWR(j), 0)) h++;
      const ratio = h / (NA * NP);
      if (ratio < m / 1.3 || ratio > m * 1.3) probs.push('hit ratio ' + (100 * ratio).toFixed(2) + '% vs target ' + (100 * m).toFixed(2) + '%');
      let tOK = 1; const tt = [0];
      if (moving) {
        for (const t0 of T0S.slice(1)) {
          let r = G.Levels.solve(L, { t0Step: t0, maxSims: 2500, minRobust: 7 });
          if (!r) { const C2 = makeCtx({ Levels: G.Levels, K, Physics: G.Physics }), Gt = C2.grid(L, t0, 1); r = C2.robustSol(L, Gt.H, t0, 7, 11); }
          if (r) { tOK++; tt.push(t0); }
        }
        if (tOK < 3) probs.push('robust at only ' + tOK + ' of 4 launch times');
      }
      rows.push([i + 1, L.name, nb, (100 * ratio).toFixed(2) + '%', L.frags.length, L.target.r, moving ? tt.join('/') : 'static']);
    }
    if (probs.length) { ok = false; console.log('L' + (i + 1), L.name, probs.join('; ')); }
  });
  if (rows.length) { console.log('plate name                    bodies hit%   frags r  timing'); for (const r of rows) console.log(String(r[0]).padStart(5), String(r[1]).padEnd(24), String(r[2]).padStart(5), String(r[3]).padStart(7), String(r[4]).padStart(5), String(r[5]).padStart(3), ' ' + r[6]); }
  console.log(ok ? 'verify: all ' + C.length + ' baked plates OK (Volume I text unchanged vs levels-golden.json; solutions hit & robust >= 8/9, straight shots miss from L6, fragment paths collect all, clearances hold, solutions collect no fragments; Volume II: 4-7 bodies, r 26-38, 2-3 frags, hit ratio in band, robust at >= 3 of 4 launch times)' : 'verify: FAILED');
  return ok;
}

/* ---------- main ---------- */
const argv = process.argv.slice(2);
function cacheFile(i) { return path.join(CACHE, 'c' + String(i + 1).padStart(2, '0') + '.json'); }
if (argv[0] === '--worker') {
  const G = loadFast(), C = makeCtx(G);
  const out = argv[1].split(',').map(Number).map(i => { const r = bakeLevel(C, G, i); if (r.stats.seed) r.stats.name = (G.Levels.NAMES.slice(0, 30).concat(NAMES2))[i]; return r; });
  process.stdout.write(JSON.stringify(out));
} else if (argv[0] === '--verify') {
  process.exit(verify() ? 0 : 1);
} else if (argv[0] === '--assemble') {
  const lv = []; for (let i = V2; i < NTOTAL; i++) { if (!fs.existsSync(cacheFile(i))) { console.log('missing cache for index', i); process.exit(1); } lv.push(JSON.parse(fs.readFileSync(cacheFile(i), 'utf8')).level); }
  writeModule(lv); console.log('wrote', path.relative(ROOT, LEVELS), (fs.statSync(LEVELS).size / 1024).toFixed(1) + ' KB'); process.exit(verify() ? 0 : 1);
} else {
  const only = argv[0] === '--only' ? argv[1].split(',').map(Number) : null;
  fs.mkdirSync(CACHE, { recursive: true });
  const queue = (only || Array.from({ length: NTOTAL - V2 }, (_, q) => q + V2)).filter(i => only || !fs.existsSync(cacheFile(i)));
  if (!only && queue.length) console.log('baking', queue.length, 'plates:', queue.join(','));
  const t = Date.now(), NW = +(process.env.LEVELS_JOBS || 2), results = [];
  // dynamic queue: each worker process bakes one plate at a time (plates differ a lot in cost); harder (later) plates first
  queue.sort((a, b) => b - a);
  const runOne = i => new Promise((res, rej) => {
    cp.execFile(process.execPath, [__filename, '--worker', String(i)], { maxBuffer: 1 << 26 }, (e, so, se) => {
      if (se) process.stderr.write(se.split('\n').slice(-3).join('\n'));
      if (e) return rej(new Error(se || e.message));
      const r = JSON.parse(so)[0];
      if (!only && r.level) fs.writeFileSync(cacheFile(i), JSON.stringify(r));
      console.log('plate', i + 1, r.level ? 'baked' : 'FAILED', 'after', ((Date.now() - t) / 1000).toFixed(0) + ' s', r.level ? '' : JSON.stringify(r.log.rejected));
      res(r);
    });
  });
  const lane = async () => { while (queue.length) results.push(await runOne(queue.shift())); };
  Promise.all(Array.from({ length: NW }, lane)).then(() => {
    const all = results.sort((a, b) => a.stats.i - b.stats.i);
    if (all.length) table(all.map(r => r.stats));
    all.forEach(r => { if (!r.level) console.log('L' + (r.stats.i + 1), 'rejections', JSON.stringify(r.log.rejected)); });
    console.log('bake time', ((Date.now() - t) / 1000).toFixed(1) + ' s');
    if (only) return;
    const lv = []; for (let i = V2; i < NTOTAL; i++) { if (!fs.existsSync(cacheFile(i))) { console.log('NOT writing: plate', i + 1, 'has no bake yet'); process.exit(1); } lv.push(JSON.parse(fs.readFileSync(cacheFile(i), 'utf8')).level); }
    writeModule(lv);
    console.log('wrote', path.relative(ROOT, LEVELS), (fs.statSync(LEVELS).size / 1024).toFixed(1) + ' KB');
    process.exit(verify() ? 0 : 1);
  }).catch(e => { console.error(e); process.exit(1); });
}
