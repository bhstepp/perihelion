#!/usr/bin/env node
/* PERIHELION — Volume III baker (owner: LEVEL AGENT; not shipped in the game).
   Bakes plates c61..c90 (index 60..89, LXI..XC): every plate has wormhole pairs (CONTRACT-v3 section 1 and 7).
   The plates are DESIGNED, not dumped from the Endless generator: for each plate a plan (tools table PLAN below) says how many pairs, which
   turns, which mouth rides rails, which extra bodies and how small the target is. A seeded layout builder lays the route out by construction
   (probe -> entry mouth A, exit mouth B placed so that the heading it leaves with points at the target, chains for two pairs) and then a
   planet blocks the direct line so the straight shot misses. A brute-force solver (angle 720 x 0.5 deg, power 0.10..1.00 step 0.025, the frozen
   Physics.simulate) accepts a candidate only if
     - a robust solution (>= 8 of 9 neighbouring shots, all of which warp the required number of times) exists,
     - no robust shot that never warps exists (at t0 = 0 and, for moving plates, at every tested launch time),
     - the straight shot at the target misses, moving plates stay solvable at >= 3 of 4 launch times,
     - author rules hold (mouth r 24-38, twin centres >= 150 apart, exit points >= 30 clear of bodies and the world edge),
     - the fragments (2-3) sit on a different hit path (fragSolution), sometimes after a wormhole exit, and the same search the lead uses in
       tools/levels-clear.js (angle x power x launch times) finds several launches that hit and collect everything.
   usage: node tools/levels-bake3.js                 bake the missing plates (<= 2 worker processes, resumable: tools/levels-cache/v3-cNN.json),
                                                     then write the module when all 30 exist
          node tools/levels-bake3.js --only 60,61    bake + print only those indices (no write, no cache)
          node tools/levels-bake3.js --force 60,61   rebake those indices into the cache
          node tools/levels-bake3.js --assemble      write the module from the cache only
          node tools/levels-bake3.js --refrag [i,j]  re-choose the stored full-clear course of baked plates (cache only); then --assemble
          node tools/levels-bake3.js --verify        verify the 30 baked plates (also run by  node tools/levels-bake.js --verify)   */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), LEVELS = path.join(ROOT, 'src', '20-levels.js'), CACHE = path.join(__dirname, 'levels-cache');
const V3 = 60, NALL = 90, PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
const rnd3 = x => Math.round(x * 1000) / 1000, r3s = x => Number(x.toPrecision(3)), ri = Math.round;

// Plate names: optics, apertures, doors and passages of the 19th-century observatory (none reused from Levels.NAMES / Volume II).
const NAMES3 = ['The Looking-Glass', 'The Aperture', 'Camera Obscura', 'The Speculum', 'The Postern Gate', 'The Mirror Door',
  'The Periscope', 'The Kaleidoscope', 'The Heliostat', 'Newton\'s Prism', 'The Diagonal Mirror', 'The Turning Door',
  'The Revolving Door', 'The Zoetrope', 'The Magic Lantern', 'The Stereoscope', 'The Phantasmagoria', 'Foucault\'s Pendulum',
  'The Enfilade', 'The Gallery of Mirrors', 'The Antechamber', 'The Colonnade', 'The Vestibule', 'The Twin Portals',
  'The Anamorphosis', 'Daguerre\'s Diorama', 'The Panopticon', 'The Hall of Mirrors', 'The Labyrinth', 'The Leviathan of Parsonstown'];

/* ---------- the plan: one row per plate (index 60..89) ----------
   tr: target radius; mr: mouth radius range; turn: [theta per pair] (entering the main route's first mouth of the pair turns by +theta,
   the twin by -theta; 0 = none); rails: null | [pairIndex, 'A'|'B'] (that mouth rides an orbit); chain: two pairs, the route uses both;
   (non-chain with two pairs: two independent routes, the second one carries the fragments);
   ex: extra bodies (P planet, M moon, H black hole, R repulsor; 'h'/'r' = black hole / repulsor placed near a mouth);
   pf: planet mass factor range (mu = f r^3); fa: put a fragment after the wormhole exit; side: which side of the direct line the route takes. */
const Q = PI / 4, H2 = PI / 2;
const PLAN = [
  // LXI-LXVI: one stationary pair, no turn (the lesson)
  { blk: 'P', tr: 38, mr: [32, 38], turn: [0], ex: [], pf: [14, 30], fa: 1 },
  { blk: 'H', tr: 38, mr: [32, 38], turn: [0], ex: [], pf: [14, 30] },
  { blk: 'R', tr: 37, mr: [30, 36], turn: [0], ex: [], pf: [18, 38], fa: 1 },
  { blk: 'R', tr: 36, mr: [30, 36], turn: [0], ex: ['P'], pf: [14, 34] },
  { blk: 'H', tr: 36, mr: [28, 34], turn: [0], ex: ['R'], pf: [16, 38], fa: 1 },
  { blk: 'R', tr: 35, mr: [28, 34], turn: [0], ex: ['P'], pf: [16, 40] },
  // LXVII-LXXII: one pair, a planet or moon, turns of +-90 / +-45 degrees
  { blk: 'R', tr: 34, mr: [28, 34], turn: [H2], ex: ['M'], pf: [20, 50], fa: 1 },
  { blk: 'P', tr: 34, mr: [28, 34], turn: [-H2], ex: ['P'], pf: [20, 46] },
  { blk: 'H', tr: 33, mr: [28, 34], turn: [Q], ex: ['M'], pf: [20, 50], fa: 1 },
  { blk: 'R', tr: 33, mr: [26, 32], turn: [-Q], ex: ['P'], pf: [20, 46] },
  { blk: 'P', tr: 32, mr: [26, 32], turn: [H2], ex: ['M'], pf: [24, 54], fa: 1 },
  { blk: 'R', tr: 32, mr: [26, 32], turn: [-Q], ex: ['P'], pf: [24, 54] },
  // LXXIII-LXXVIII: one mouth on rails; black holes or repulsors near a mouth
  { blk: 'R', tr: 32, mr: [28, 34], turn: [0], rails: [0, 'B'], ex: ['r'], pf: [20, 50], fa: 1 },
  { blk: 'P', tr: 31, mr: [28, 34], turn: [0], rails: [0, 'A'], ex: ['h'], pf: [20, 50] },
  { blk: 'R', tr: 31, mr: [26, 32], turn: [Q], rails: [0, 'B'], ex: ['r'], pf: [24, 54], fa: 1 },
  { blk: 'R', tr: 30, mr: [26, 32], turn: [-H2], rails: [0, 'A'], ex: ['h'], pf: [24, 54] },
  { blk: 'R', tr: 30, mr: [26, 32], turn: [-Q], rails: [0, 'B'], ex: ['r', 'M'], pf: [24, 54], fa: 1 },
  { blk: 'P', tr: 30, mr: [26, 32], turn: [H2], rails: [0, 'A'], ex: ['h', 'r'], pf: [24, 54] },
  // LXXIX-LXXXIV: two pairs; chains (the solution uses both) on most
  { blk: 'R', tr: 30, mr: [26, 32], turn: [0, 0], chain: 1, ex: ['M'], pf: [20, 50], fa: 1 },
  { blk: 'P', tr: 29, mr: [26, 32], turn: [Q, -Q], chain: 1, ex: ['P'], pf: [20, 50] },
  { blk: 'R', tr: 29, mr: [24, 30], turn: [H2, 0], chain: 1, rails: [1, 'B'], ex: ['M'], pf: [24, 54], fa: 1 },
  { blk: 'H', tr: 29, mr: [24, 30], turn: [-H2, Q], chain: 1, ex: ['R'], pf: [24, 54] },
  { blk: 'R', tr: 28, mr: [24, 30], turn: [0, Q], ex: ['M'], pf: [24, 54], fa: 1 },
  { blk: 'P', tr: 28, mr: [24, 30], turn: [H2, -H2], ex: ['R'], pf: [24, 54] },
  // LXXXV-XC: two pairs plus moons, black holes and repulsors; small targets
  { blk: 'R', tr: 28, mr: [24, 30], turn: [Q, -H2], chain: 1, ex: ['M', 'R'], pf: [26, 58], fa: 1 },
  { blk: 'R', tr: 28, mr: [24, 30], turn: [0, H2], ex: ['M', 'H'], pf: [26, 58] },
  { blk: 'H', tr: 27, mr: [24, 30], turn: [-Q, Q], chain: 1, rails: [0, 'A'], ex: ['h', 'M'], pf: [26, 58], fa: 1 },
  { blk: 'P', tr: 27, mr: [24, 30], turn: [H2, Q], ex: ['H', 'M', 'r'], pf: [26, 58] },
  { blk: 'R', tr: 26, mr: [24, 30], turn: [-H2, -Q], chain: 1, rails: [1, 'A'], ex: ['H', 'M', 'R'], pf: [26, 58], fa: 1 },
  { blk: 'R', tr: 26, mr: [24, 30], turn: [Q, H2], chain: 1, rails: [0, 'B'], ex: ['h', 'M', 'r'], pf: [26, 58] },
];

// Variety (review): where the probe and the target sit. Bands: probe x / target x 0 left (150-300), 1 centre (330-570), 2 right (600-750);
// target y 0 high (180-330), 1 middle (330-520), 2 low (520-700); the probe always sits low (y 1280..1480).
const PXB = [1,2,0,1,0,2, 2,0,1,0,2,1, 0,2,1,2,0,1, 1,0,2,1,2,0, 2,1,0,2,1,0];
const TXB = [2,0,1,0,2,1, 0,2,0,1,0,2, 1,0,2,1,2,0, 2,1,0,2,0,1, 0,2,1,0,2,1];
const TYB = [0,1,0,2,1,0, 1,0,2,1,0,1, 2,1,0,2,1,0, 1,2,0,1,2,1, 0,1,2,0,1,2];
const XR = [[150, 300], [330, 570], [600, 750]], TYR = [[180, 330], [330, 520], [520, 700]];
const diffOf = i => rnd3(1.62 + 0.58 * (i - V3) / 29);                 // 1.62 .. 2.20
const ratioTarget = i => 0.02 * Math.pow(0.006 / 0.02, (i - V3) / 29);   // total hit ratio target: 2.0% falling to 0.6% (soft, see BAND)
const BAND = 2.0;

// Load modules into THIS context (vm contexts make global lookups ~15x slower; results are bit-identical).
function loadFast() {
  const src = ['00-const.js', '10-physics.js', '20-levels.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  return vm.runInThisContext('(function(){' + src + '\n;return {K:K,Physics:Physics,Levels:Levels,toRoman:toRoman};})()', { filename: 'perihelion-src' });
}

const NA = 720, NP = 37, PWR = j => 0.1 + 0.025 * j, T0S = [0, 90, 200, 333], CLEAR_T0S = [0, 120, 260, 450, 700];
const clampP = p => p > 1 ? 1 : p;
const PWRS = Array.from({ length: NP }, (_, j) => PWR(j));

function makeCtx(G) {
  const g = G.Levels._gen, K = G.K, P = G.Physics, DT = K.DT, pos = { x: 0, y: 0 }, pos2 = { x: 0, y: 0 };
  const reff = b => b.kind === 'blackhole' ? b.capture : b.r;
  const sweep = b => { const o = b.orbit; return o ? { x: o.cx, y: o.cy, R: o.rad + reff(b) } : { x: b.x, y: b.y, R: reff(b) }; };
  const inWorld = b => { const s = sweep(b); return s.x - s.R >= 40 && s.x + s.R <= 860 && s.y - s.R >= 40 && s.y + s.R <= 1560; };
  const at = (b, t) => { P.bodyPos(b, t, pos); return pos; };
  const fly = (L, a, p, t0) => { const v = g.launch(a, p); return P.simulate(L, v.vx, v.vy, t0, K.MAX_STEPS); };

  function scan(L, t0, stride) {
    const H = new Uint8Array(NA * NP), Wp = new Uint8Array(NA * NP); let n = 0, h = 0;
    for (let k = 0; k < NA; k += stride) for (let j = 0; j < NP; j++) {
      n++; const s = fly(L, k * 0.5, PWR(j), t0);
      if (s.status === 'hit') { H[k * NP + j] = 1; Wp[k * NP + j] = Math.min(250, s.warps); h++; }
    }
    return { H, Wp, hits: h, ratio: h / n };
  }
  const cell = (M, k, j) => (j < 0 || j >= NP) ? 0 : M[((k % NA + NA) % NA) * NP + j];
  function hood(M, k, j) { let s = 0; for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++) s += cell(M, k + a, Math.min(NP - 1, j + b)); return s; }
  // finger test at (a, p): hits among the 3x3 neighbourhood (+-1 deg, +-0.03 power) whose flight warps at least minW times
  function robustW(L, a, p, t0, need, minW) {
    let n = 0, miss = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const s = fly(L, a + i, clampP(p + 0.03 * j), t0);
      if (s.status === 'hit' && s.warps >= minW) n++; else if (++miss > 9 - need) return 0;
      if (!i && !j && n === 0) return 0;
    }
    return n;
  }
  // the strongest hit that never warps: its 3x3 neighbourhood (any hit counts) — a plate must not have one with >= 8
  function worstNoWarp(L, G0, t0, lim, pre) {
    let worst = 0;
    for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) {
      const q = k * NP + j; if (!G0.H[q] || G0.Wp[q]) continue;
      if (hood(G0.H, k, j) < (pre || 9)) continue;
      const a = k * 0.5, p = PWR(j); let n = 0;
      for (let i = -1; i <= 1; i++) for (let jj = -1; jj <= 1; jj++) if (fly(L, a + i, clampP(p + 0.03 * jj), t0).status === 'hit') n++;
      if (n > worst) worst = n; if (worst >= (lim || 8)) return worst;
    }
    return worst;
  }
  // wormhole exits of a flight: [{to, ux, uy, t}] (t = seconds of the exit step)
  function exitsOf(L, a, p, t0) {
    const v = g.launch(a, p), s = P.createSim(L, v.vx, v.vy, t0), out = []; let w = 0;
    for (;;) {
      const st = P.stepSim(s, L);
      if (s.warps > w) { w = s.warps; const sp = Math.hypot(s.vx, s.vy); out.push({ to: s.events[s.events.length - 1].to, ux: s.vx / sp, uy: s.vy / sp, t: s.abs * DT }); }
      if (st !== 'flying' || s.step >= K.MAX_STEPS) break;
    }
    return out;
  }
  // smallest clearance of an exit point (twin centre + (r + WARP_GAP) along the heading) from bodies and the world edge, over all times a
  // mouth on rails (or another moving body) could be there
  function exitClear(L, e) {
    const tw = L.bodies[e.to], moving = L.bodies.some(b => b.orbit), ts = []; let m = 1e9;
    if (moving) for (let t = 0; t < 60; t += 0.05) ts.push(t); else ts.push(0);
    for (const t of ts) {
      const c = at(tw, t), ex = c.x + e.ux * (tw.r + K.WARP_GAP), ey = c.y + e.uy * (tw.r + K.WARP_GAP);
      m = Math.min(m, ex, 900 - ex, ey, 1600 - ey);
      for (let q = 0; q < L.bodies.length; q++) if (L.bodies[q] !== tw) { const b = L.bodies[q], pb = at(b, t); m = Math.min(m, Math.hypot(pb.x - ex, pb.y - ey) - reff(b)); }
    }
    return m;
  }
  // centre distance of the two mouths of a pair, minimum over 60 s
  function twinDist(L, a) {
    const A = L.bodies[a], B = L.bodies[A.pair], moving = A.orbit || B.orbit; let m = 1e9;
    for (let t = 0; t < (moving ? 60 : 1); t += 0.05) { const pa = at(A, t), ax = pa.x, ay = pa.y, pb = at(B, t); m = Math.min(m, Math.hypot(ax - pb.x, ay - pb.y)); }
    return m;
  }
  // the lead's full-clear search (tools/levels-clear.js): shots that hit and collect every fragment, angle x power x launch times
  function clearSearch(L) {
    const t0s = L.bodies.some(b => b.orbit) ? CLEAR_T0S : [0], hits = new Map(), key = (t, a, j) => (t * 1000 + ((a % NA) + NA) % NA) * 100 + j;
    t0s.forEach((t0, ti) => { for (let a = 0; a < NA; a++) for (let j = 0; j < NP; j++) {
      const v = g.launch(a * 0.5, PWR(j)), s = P.simulate(L, v.vx, v.vy, t0, K.MAX_STEPS, null);
      if (s.status === 'hit' && s.collected.every(x => x)) hits.set(key(ti, a, j), [ti, a, j, s.warps]); } });
    const scored = [];
    hits.forEach(([ti, a, j]) => { let n = 0;
      for (let da = -2; da <= 2; da++) for (let dj = -2; dj <= 2; dj++) if (j + dj >= 0 && j + dj < NP && hits.has(key(ti, a + da, j + dj))) n++;
      scored.push({ ti, a, j, n }); });
    scored.sort((x, y) => y.n - x.n);
    let best = null, nwBest = 0; for (const c of scored) if (!hits.get(key(c.ti, c.a, c.j))[3]) nwBest = Math.max(nwBest, c.n);   // best cluster score among full-clear shots that never warp
    for (const c of scored.slice(0, 30)) {
      let n = 0; const a0 = c.a * 0.5, p0 = PWR(c.j);
      for (let da = -1; da <= 1.001; da += 0.25) for (let dp = -0.05; dp <= 0.0501; dp += 0.0125) {
        const v = g.launch(a0 + da, Math.min(1, p0 + dp)), s = P.simulate(L, v.vx, v.vy, t0s[c.ti], K.MAX_STEPS, null); if (s.status === 'hit' && s.collected.every(x => x)) n++; }
      if (!best || n > best.n) best = { n, t0: t0s[c.ti], warps: hits.get(key(c.ti, c.a, c.j))[3] };
    }
    return { fullHits: hits.size, bestWarps: best ? best.warps : 0, nwBest, top: scored.length ? scored[0].n : 0, robust: best ? best.n : 0, t0: best ? best.t0 : -1, at0: [...hits.values()].filter(h => h[0] === 0).length };
  }
  // the stored full-clear course of a plate (t0 = 0 only, as t0Step is 0): every shot of the grid that hits and collects all fragments, scored by
  // its neighbours like the lead's search, then the 40 best re-scored on the +-1 deg / +-0.03 power 3x3 finger test that --verify applies.
  function bestFull0(L) {
    const hits = new Set(), key = (a, j) => (((a % NA) + NA) % NA) * 100 + j;
    for (let a = 0; a < NA; a++) for (let j = 0; j < NP; j++) { const s = fly(L, a * 0.5, PWR(j), 0); if (s.status === 'hit' && s.collected.every(x => x)) hits.add(key(a, j)); }
    const scored = [];
    hits.forEach(k => { const a = Math.floor(k / 100), j = k % 100; let n = 0;
      for (let da = -2; da <= 2; da++) for (let dj = -2; dj <= 2; dj++) if (j + dj >= 0 && j + dj < NP && hits.has(key(a + da, j + dj))) n++;
      scored.push({ a, j, n }); });
    scored.sort((x, y) => y.n - x.n);
    let best = null; const okShot = (a, p) => { const s = fly(L, a, clampP(p), 0); return s.status === 'hit' && s.collected.every(x => x); };
    for (const c of scored.slice(0, 40)) {
      const a0 = c.a * 0.5, p0 = PWR(c.j), v = g.launch(a0, p0), vx = rnd3(v.vx), vy = rnd3(v.vy), ra = Math.atan2(vy, vx) / DEG, rp = Math.hypot(vx, vy) / K.VMAX;
      const s0 = P.simulate(L, vx, vy, 0, K.MAX_STEPS); if (s0.status !== 'hit' || !s0.collected.every(x => x)) continue;
      let nbr = 0, n81 = 0;
      for (let da = -1; da <= 1; da++) for (let dj = -1; dj <= 1; dj++) if (okShot(ra + da, rp + 0.03 * dj)) nbr++;
      for (let da = -1; da <= 1.001; da += 0.25) for (let dp = -0.05; dp <= 0.0501; dp += 0.0125) if (okShot(ra + da, rp + dp)) n81++;
      if (!best || nbr > best.nbr || (nbr === best.nbr && n81 > best.n81)) best = { vx, vy, nbr, n81, warps: s0.warps };
    }
    return { full: hits.size, best };
  }
  function straightClear(L, moving) {
    const Pw = []; for (let j = 0; j < NP; j++) Pw.push(PWR(j));
    for (const t0 of moving ? T0S : [0]) if (g.straightHits(L, t0, Pw)) return false;
    return true;
  }
  // ---- launch-time windows (review rule): the aiming clock keeps running, so the launch time is whatever the clock reads at release ----
  // A plate with anything on rails is sampled every 0.5 s over max(12 s, the longest rail period); a sample is OPEN when a robust (>= 8 of 9
  // neighbours) winning shot that warps exists at that launch time. Rule: >= 70% open and no closed gap longer than 2.5 s.
  const periodOf = L => Math.max(0, ...L.bodies.filter(b => b.orbit).map(b => TAU / Math.abs(b.orbit.omega)));
  const spanOf = L => Math.max(12, periodOf(L));
  const TSTEP = 60;   // 0.5 s in physics steps
  // a coarse scan in 1-degree steps: cells (deg, power index) that hit and warp at least minW times
  function scan1(L, t0, minW) {
    const H = new Uint8Array(360 * NP);
    for (let m = 0; m < 360; m++) for (let j = 0; j < NP; j++) { const s = fly(L, m, PWR(j), t0); if (s.status === 'hit' && s.warps >= minW) H[m * NP + j] = 1; }
    return H;
  }
  function openAt(L, t0, warm, minW) {
    // 1. neighbourhoods of shots that were open a moment ago
    for (const c of warm) for (const da of [0, -1, 1, -2, 2, -4, 4, -7, 7]) for (const dp of [0, -0.05, 0.05, -0.1, 0.1]) {
      const a = c.a + da, p = clampP(c.p + dp); if (p < 0.1) continue;
      const s0 = fly(L, a, p, t0); if (s0.status !== 'hit' || s0.warps < minW) continue;
      if (robustW(L, a, p, t0, 8, minW) >= 8) return { a, p };
    }
    // 2. the whole grid
    const H = scan1(L, t0, minW), cand = [];
    for (let m = 0; m < 360; m++) for (let j = 1; j < NP - 1; j++) if (H[m * NP + j]) {
      let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += H[((m + a + 360) % 360) * NP + j + b];
      if (n >= 7) cand.push([n, m, j]);
    }
    cand.sort((x, y) => y[0] - x[0]);
    for (let q = 0; q < Math.min(cand.length, 40); q++) { const a = cand[q][1], p = PWR(cand[q][2]); if (robustW(L, a, p, t0, 8, minW) >= 8) return { a, p }; }
    return null;
  }
  // profile: { open: [0/1 per sample], shots, frac, gap (longest closed stretch in seconds), ok }; `seed` = shots known to win at t0 = 0
  function timing(L, seed, minW, bail) {
    const n = Math.floor(spanOf(L) / 0.5) + 1, open = [], shots = []; let warm = seed.slice(), run = 0, gap = 0, closed = 0;
    for (let k = 0; k < n; k++) {
      const r = openAt(L, k * TSTEP, warm, minW);
      if (r) { open.push(1); shots.push(r); warm.unshift(r); if (warm.length > 8) warm.pop(); run = 0; }
      else { open.push(0); shots.push(null); closed++; run++; gap = Math.max(gap, (run + 1) * 0.5); }
      if (bail && (gap > 2.5 || closed > 0.3 * n)) break;
    }
    const frac = open.filter(x => x).length / n;
    return { open, shots, n, frac, gap, ok: open.length === n && frac >= 0.7 && gap <= 2.5 };
  }
  function straightAll(L) { const ts = [0]; if (L.bodies.some(b => b.orbit)) for (let t = 0; t <= spanOf(L); t += 0.5) ts.push(Math.round(t * 120)); return ts.every(t0 => !g.straightHits(L, t0, PWRS)); }
  const why = {};
  return { why, periodOf, spanOf, timing, openAt, straightAll, G, g, K, P, reff, sweep, inWorld, at, fly, scan, cell, hood, robustW, worstNoWarp, exitsOf, exitClear, twinDist, clearSearch, bestFull0, straightClear };
}

/* ---------- layout: a route built by construction ---------- */
function layout(C, plan, idx, seed) {
  const { g, K, P } = C, rng = C.G.Levels.mulberry32(seed), toRoman = C.G.toRoman;
  const R = (a, b) => a + rng() * (b - a), RI = (a, b) => ri(R(a, b)), pick = a => a[Math.floor(rng() * a.length)];
  const q30 = idx - V3, Pr = { x: RI(XR[PXB[q30]][0], XR[PXB[q30]][1]), y: RI(1280, 1480) }, T = { x: RI(XR[TXB[q30]][0], XR[TXB[q30]][1]), y: RI(TYR[TYB[q30]][0], TYR[TYB[q30]][1]), r: plan.tr };
  const L = { id: 'c' + String(idx + 1).padStart(2, '0'), index: idx, seed, difficulty: diffOf(idx), name: NAMES3[idx - V3], plate: toRoman(idx + 1),
    probe: Pr, target: T, bodies: [], frags: [], solution: null };
  const dPT = Math.atan2(T.y - Pr.y, T.x - Pr.x), legs = [], mouths = [], npair = plan.turn.length;
  const U = a => [Math.cos(a), Math.sin(a)];
  const inBox = (x, y, m) => x >= m && x <= 900 - m && y >= m && y <= 1600 - m;
  let sideSign = rng() < 0.5 ? -1 : 1;
  function mouth(r, turn) { return { kind: 'wormhole', r, mu: 0, x: 0, y: 0, orbit: null, pair: -1, turn }; }
  const tn = p => { const t = plan.turn[p]; return t; };
  // route from S through pair p (A entered first), returns {A, B, exit: [x,y], h}
  const okBox = (m, p, w) => inBox(m.x, m.y, plan.rails && plan.rails[0] === p && plan.rails[1] === w ? 150 : 76);
  function simple(p, S, Dmin, Dmax, side) {
    for (let t = 0; t < 40; t++) {
      const rA = RI(plan.mr[0], plan.mr[1]), rB = RI(plan.mr[0], plan.mr[1]), a = mouth(rA, tn(p)), b = mouth(rB, -tn(p));
      const dirS = Math.atan2(T.y - S.y, T.x - S.x), ang = dirS + side * R(9, 46) * DEG, dA = R(300, 960);
      a.x = ri(S.x + Math.cos(ang) * dA); a.y = ri(S.y + Math.sin(ang) * dA);
      const hout = Math.atan2(a.y - S.y, a.x - S.x) + a.turn, [ux, uy] = U(hout);
      let D = R(Dmin, Dmax);
      b.x = ri(T.x - ux * D); b.y = ri(T.y - uy * D);
      if (okBox(a, p, 'A') && okBox(b, p, 'B')) return { A: a, B: b, h: hout };
    }
    return { A: mouth(30, 0), B: mouth(30, 0), h: 0, bad: true };
  }
  const routes = [];
  if (npair === 1) routes.push(simple(0, Pr, 210, 640, sideSign));
  else if (plan.chain) {
    // P -> A1 => B1 -> A2 => B2 -> T
    let done = false;
    for (let t = 0; t < 80 && !done; t++) {
      const rA1 = RI(plan.mr[0], plan.mr[1]), rB1 = RI(plan.mr[0], plan.mr[1]), a1 = mouth(rA1, tn(0)), b1 = mouth(rB1, -tn(0));
      const ang = dPT + sideSign * R(8, 40) * DEG, dA = R(260, 800);
      a1.x = ri(Pr.x + Math.cos(ang) * dA); a1.y = ri(Pr.y + Math.sin(ang) * dA);
      const h1 = Math.atan2(a1.y - Pr.y, a1.x - Pr.x) + a1.turn;
      // B1: anywhere sensible; A2 is straight ahead of its exit
      const dyPT = Pr.y - T.y; b1.x = ri(R(110, 790)); b1.y = ri(R(T.y + 0.3 * dyPT, Pr.y - 0.3 * dyPT));
      const rA2 = RI(plan.mr[0], plan.mr[1]), rB2 = RI(plan.mr[0], plan.mr[1]), a2 = mouth(rA2, tn(1)), b2 = mouth(rB2, -tn(1)), L2 = R(240, 520);
      const [u1x, u1y] = U(h1), lat = R(-14, 14);
      a2.x = ri(b1.x + u1x * (rB1 + K.WARP_GAP + L2) - u1y * lat); a2.y = ri(b1.y + u1y * (rB1 + K.WARP_GAP + L2) + u1x * lat);
      const h2 = Math.atan2(a2.y - (b1.y + u1y * (rB1 + K.WARP_GAP)), a2.x - (b1.x + u1x * (rB1 + K.WARP_GAP))) + a2.turn, [u2x, u2y] = U(h2), D2 = R(200, 520);
      b2.x = ri(T.x - u2x * D2); b2.y = ri(T.y - u2y * D2);
      if (okBox(a1, 0, 'A') && okBox(b1, 0, 'B') && okBox(a2, 1, 'A') && okBox(b2, 1, 'B')) { done = true; routes.push({ A: a1, B: b1, h: h1 }, { A: a2, B: b2, h: h2, chained: true }); }
    }
    if (!done) return (C.why.inworld = (C.why.inworld || 0) + 1, null);
  } else {
    routes.push(simple(0, Pr, 210, 640, sideSign), simple(1, Pr, 210, 640, -sideSign));
  }
  if (routes.some(r => r.bad)) return (C.why.inworld = (C.why.inworld || 0) + 1, null);
  // legs (for lane clearance) and mouth list
  routes.forEach(r => { mouths.push(r.A, r.B); });
  if (plan.chain && npair === 2) {
    const [r1, r2] = routes, e1 = [r1.B.x + Math.cos(r1.h) * (r1.B.r + K.WARP_GAP), r1.B.y + Math.sin(r1.h) * (r1.B.r + K.WARP_GAP)], e2 = [r2.B.x + Math.cos(r2.h) * (r2.B.r + K.WARP_GAP), r2.B.y + Math.sin(r2.h) * (r2.B.r + K.WARP_GAP)];
    legs.push({ s: [Pr.x, Pr.y, r1.A.x, r1.A.y], skip: [r1.A] }, { s: [e1[0], e1[1], r2.A.x, r2.A.y], skip: [r1.B, r2.A] }, { s: [e2[0], e2[1], T.x, T.y], skip: [r2.B] });
  } else routes.forEach(r => {
    const e = [r.B.x + Math.cos(r.h) * (r.B.r + K.WARP_GAP), r.B.y + Math.sin(r.h) * (r.B.r + K.WARP_GAP)];
    legs.push({ s: [Pr.x, Pr.y, r.A.x, r.A.y], skip: [r.A] }, { s: [e[0], e[1], T.x, T.y], skip: [r.B] });
  });
  // rails: the chosen mouth rides a circle round its nominal place
  if (plan.rails) {
    const [pi, which] = plan.rails, r = routes[pi], m = which === 'A' ? r.A : r.B;
    const rad = RI(38, 62), om = rnd3((rng() < 0.5 ? -1 : 1) * R(0.42, 0.95)), ph = rnd3(R(0, TAU));
    m.orbit = { cx: m.x, cy: m.y, rad, omega: om, phase: ph };
    m.x = ri(m.x + rad * Math.cos(ph)); m.y = ri(m.y + rad * Math.sin(ph));
  }
  // pair links; bodies are appended after the solid ones
  // --- solid bodies -----------------------------------------------------------------------------------------------------------
  const bodies = [];
  const pg = (b, x, y) => g.pointGap(b, x, y);
  function legGap(b, skipMouths) {
    let m = 1e9;
    for (const lg of legs) { if (skipMouths && lg.skip.includes(b)) continue;
      const [x0, y0, x1, y1] = lg.s; for (let u = 0; u <= 1.0001; u += 0.04) m = Math.min(m, pg(b, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u)); }
    return m;
  }
  function okPlace(b, all, gap, lane) {
    if (!C.inWorld(b)) return false;
    if (pg(b, Pr.x, Pr.y) < 140) return false;
    const gt = pg(b, T.x, T.y); if (gt < 110 || gt - T.r < 70) return false;
    for (const o of all) if (o !== b && g.bodyGap(b, o) < (gap || 34)) return false;
    return legGap(b, true) >= lane;
  }
  // mouths first (they carry the route), then check them against each other and the rules
  for (const m of mouths) {
    if (!C.inWorld(m)) return (C.why['inworld'] = (C.why['inworld'] || 0) + 1, null);
    if (pg(m, Pr.x, Pr.y) < 140) return (C.why['probeclr'] = (C.why['probeclr'] || 0) + 1, null);
    const gt = pg(m, T.x, T.y); if (gt < 110) return (C.why['targetclr'] = (C.why['targetclr'] || 0) + 1, null);
    if (legGap(m, true) < 45) return (C.why['leg'] = (C.why['leg'] || 0) + 1, null);
  }
  for (let a = 0; a < mouths.length; a++) for (let b = a + 1; b < mouths.length; b++) if (g.bodyGap(mouths[a], mouths[b]) < 34) return (C.why['mouthgap'] = (C.why['mouthgap'] || 0) + 1, null);
  // blocker across the direct line (the straight shot must miss). A repulsor by default: it leaves no sling-shot route round itself, so the
  // wormholes stay the way through; plates may ask for a planet ('P') or a black hole ('H') instead.
  const bk = plan.blk || 'R', br = bk === 'R' ? RI(24, 30) : bk === 'H' ? RI(12, 16) : RI(50, 84);
  const blocker = bk === 'R' ? { kind: 'repulsor', r: br, mu: r3s(-R(0.9e7, 1.5e7)), x: 0, y: 0, orbit: null }
    : bk === 'H' ? { kind: 'blackhole', r: br, capture: RI(40, 50), mu: r3s(R(2.5e7, 4e7)), x: 0, y: 0, orbit: null }
    : { kind: 'planet', r: br, mu: r3s(R(plan.pf[0], plan.pf[1]) * br * br * br), x: 0, y: 0, orbit: null };
  { let ok = false;
    for (let t = 0; t < 60 && !ok; t++) {
      const f = R(0.3, 0.68), off = R(-0.35, 0.35) * (bk === 'P' ? br : 60), len = Math.hypot(T.x - Pr.x, T.y - Pr.y);
      blocker.x = ri(Pr.x + (T.x - Pr.x) * f - (T.y - Pr.y) / len * off); blocker.y = ri(Pr.y + (T.y - Pr.y) * f + (T.x - Pr.x) / len * off);
      ok = okPlace(blocker, mouths, 34, 48);
    }
    if (!ok) return (C.why.blocker = (C.why.blocker || 0) + 1, null); }
  bodies.push(blocker);
  const all = () => bodies.concat(mouths);
  const exTok = plan.ex.filter(t => t !== 'M'), nMoons = plan.ex.length - exTok.length;   // moons last: they need a parent
  if (nMoons && !exTok.some(t => 'PHh'.includes(t))) exTok.unshift('P');
  for (let q = 0; q < nMoons; q++) exTok.push('M');
  for (const tok of exTok) {
    let placed = false;
    for (let t = 0; t < 120 && !placed; t++) {
      let b;
      if (tok === 'P') {
        const r = RI(38, 66); b = { kind: 'planet', r, mu: r3s(R(plan.pf[0], plan.pf[1]) * r * r * r), x: RI(90, 810), y: 0, orbit: null }; b.y = RI(T.y + 100, Pr.y - 200);
        if (rng() < 0.75) { // beside one of the route's legs: its pull shapes the path (slow and fast shots part company), which gives the fragments a second course
          const lg = pick(legs).s, u = R(0.25, 0.75), nx = -(lg[3] - lg[1]), ny = lg[2] - lg[0], nl = Math.hypot(nx, ny), off = (rng() < 0.5 ? -1 : 1) * (r + R(75, 150));
          b.x = ri(lg[0] + (lg[2] - lg[0]) * u + nx / nl * off); b.y = ri(lg[1] + (lg[3] - lg[1]) * u + ny / nl * off);
        }
      }
      else if (tok === 'R' || tok === 'r') { const r = RI(22, 30); b = { kind: 'repulsor', r, mu: r3s(-R(0.8e7, 1.4e7)), x: RI(90, 810), y: 0, orbit: null }; b.y = RI(T.y + 100, Pr.y - 200); }
      else if (tok === 'H' || tok === 'h') { b = { kind: 'blackhole', r: RI(12, 16), capture: RI(38, 50), mu: r3s(R(2.5e7, 4e7)), x: RI(90, 810), y: 0, orbit: null }; b.y = RI(T.y + 100, Pr.y - 200); }
      else { // moon round a planet / black hole
        const pars = bodies.filter(q => !q.orbit && q.kind !== 'repulsor'); if (!pars.length) continue;
        const par = pick(pars), r = RI(12, 22);
        b = { kind: 'moon', r, mu: r3s(60 * r * r * r), orbit: { cx: par.x, cy: par.y, rad: ri(reffOf(par) + Math.max(50, r + 34) + R(0, 60)), omega: rnd3((rng() < 0.5 ? -1 : 1) * R(0.5, 1.5)), phase: rnd3(R(0, TAU)) } };
      }
      if (tok === 'h' || tok === 'r') { // near a mouth (clear of it by 40..150 beyond the swept edge)
        const m = pick(mouths), s = C.sweep(m), d = s.R + reffOf(b) + R(36, 150), an = R(0, TAU);
        b.x = ri(s.x + Math.cos(an) * d); b.y = ri(s.y + Math.sin(an) * d);
      }
      if (okPlace(b, all(), 34, tok === 'h' || tok === 'r' ? 40 : 60)) { bodies.push(b); placed = true; }
    }
    if (!placed) return (C.why['extra'] = (C.why['extra'] || 0) + 1, null);
  }
  function reffOf(b) { return b.kind === 'blackhole' ? b.capture : b.r; }
  // shuffle pair order a little (Greek letters go by lowest body index)
  const prs = []; for (let q = 0; q < mouths.length; q += 2) prs.push([mouths[q], mouths[q + 1]]);
  if (prs.length > 1 && rng() < 0.5) prs.reverse();
  const flat = []; prs.forEach(pr => { if (rng() < 0.3) pr.reverse(); flat.push(pr[0], pr[1]); });
  const base = bodies.length;
  flat.forEach((m, q) => { m.pair = base + (q ^ 1); });
  L.bodies = bodies.concat(flat);
  // twin centres >= 150 apart, always
  for (let q = base; q < L.bodies.length; q += 2) if (C.twinDist(L, q) < 150) return (C.why['twin'] = (C.why['twin'] || 0) + 1, null);
  L._route = routes.map(r => ({ h: r.h }));
  return L;
}


/* ---------- candidate evaluation ---------- */
const movingOf = L => L.bodies.some(b => b.orbit);
const NWLIM = 4, NWPRE = 5;   // reject a plate that has a no-warp hit with >= NWLIM of 9 hit neighbours (LOW review: prefer none at all)
function evaluate(C, idx, seed, log) {
  const { g, K, P } = C, plan = PLAN[idx - V3], need = plan.chain ? 2 : 1, m = ratioTarget(idx), rej = log.rejected;
  const L = layout(C, plan, idx, seed);
  if (!L) { rej.layout++; return null; }
  const moving = movingOf(L);
  if (!C.straightAll(L)) { rej.straight++; return null; }
  const quick = C.scan(L, 0, 6);
  if (quick.ratio < m / (BAND * 1.6) || quick.ratio > m * BAND * 1.6) { rej.band++; return null; }
  const G0 = C.scan(L, 0, 1);
  if (G0.ratio < m / BAND || G0.ratio > m * BAND) { rej.band++; return null; }
  const W2 = new Uint8Array(NA * NP); for (let q = 0; q < W2.length; q++) W2[q] = G0.H[q] && G0.Wp[q] >= need ? 1 : 0;
  const cand = [];
  for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) if (W2[k * NP + j]) { const s = C.hood(W2, k, j); if (s >= 11) cand.push([s, k, j]); }
  if (!cand.length) { rej.robust++; return null; }
  const j0 = 14 + Math.floor(C.G.Levels.mulberry32(seed ^ 0x51ed)() * 18);
  cand.sort((a, b) => b[0] - a[0] || Math.abs(a[2] - j0) - Math.abs(b[2] - j0));
  if (C.worstNoWarp(L, G0, 0, NWLIM, NWPRE) >= NWLIM) { rej.nowarp++; return null; }
  // solution candidates at t0 = 0: rounded to 3 decimals, re-verified, robust with every neighbour warping, exits clear
  const sols = [];
  for (let q = 0; q < Math.min(cand.length, 60) && sols.length < 5; q++) {
    const [hd, k, j] = cand[q], a = k * 0.5, p = PWR(j), v = g.launch(a, p), vx = rnd3(v.vx), vy = rnd3(v.vy);
    if (sols.some(s => Math.abs(s.a - a) < 2 && Math.abs(s.p - p) < 0.1)) continue;
    const ra = Math.atan2(vy, vx) / DEG, rp = Math.hypot(vx, vy) / K.VMAX;
    const sc = C.robustW(L, ra, rp, 0, 8, need); if (sc < 8) continue;
    const s0 = P.simulate(L, vx, vy, 0, K.MAX_STEPS); if (s0.status !== 'hit' || s0.warps < need) continue;
    let clear = 1e9; for (let i = -1; i <= 1; i++) for (let jj = -1; jj <= 1; jj++) for (const e of C.exitsOf(L, ra + i, clampP(rp + 0.03 * jj), 0)) clear = Math.min(clear, C.exitClear(L, e));
    if (clear < 31) continue;
    sols.push({ k, j, a, p, vx, vy, hood: hd, robust: sc, warps: s0.warps, clear, t0: 0 });
  }
  if (!sols.length) { rej.exit++; return null; }
  // fragments: a different hit path (any hit, other cluster first), 2-3 of them, sometimes after a wormhole exit
  const nf = 2 + (seed % 3 === 0 ? 1 : 0), fr2 = log.fr || (log.fr = { nosol: 0, alts: 0, place: 0, verify: 0 });
  const rngF = C.G.Levels.mulberry32(seed ^ 0x2545F491), rngS = C.G.Levels.mulberry32(seed ^ 0x7f4a7c15);
  const comp = components(G0.H);
  let tProf = null;
  for (const sol0 of sols) {
    let sol = sol0, tInfo = 'static';
    if (moving) {
      // launch-time windows: robust warping shot open at >= 70% of the 0.5 s samples over max(12 s, longest rail period), no gap over 2.5 s
      const tp = C.timing(L, [{ a: sol0.a, p: sol0.p }], 1, true);
      if (!tp.ok) { rej.timing++; log.tfrac = Math.max(log.tfrac || 0, tp.frac); continue; }
      // the stored solution launches at a non-zero, non-round time: pick one at random among the open samples from 1 s on
      const ks = []; tp.open.forEach((o, k) => { if (o && k >= 2) ks.push(k); });
      let chosen = null;
      for (let tries = 0; tries < 12 && !chosen; tries++) {
        const k = ks[Math.floor(rngS() * ks.length)], sh = tp.shots[k], off = tries < 8 ? Math.floor(rngS() * 60) : 0, t0 = k * 60 + off;
        const v = g.launch(sh.a, sh.p), vx = rnd3(v.vx), vy = rnd3(v.vy), ra = Math.atan2(vy, vx) / DEG, rp = Math.hypot(vx, vy) / K.VMAX;
        const sc = C.robustW(L, ra, rp, t0, 8, 1); if (sc < 8) continue;
        const s0 = P.simulate(L, vx, vy, t0, K.MAX_STEPS); if (s0.status !== 'hit' || s0.warps < 1) continue;
        let clear = 1e9; for (let i = -1; i <= 1; i++) for (let jj = -1; jj <= 1; jj++) for (const e of C.exitsOf(L, ra + i, clampP(rp + 0.03 * jj), t0)) clear = Math.min(clear, C.exitClear(L, e));
        if (clear < 31) continue;
        chosen = { k: sol0.k, j: sol0.j, a: sh.a, p: sh.p, vx, vy, hood: sol0.hood, robust: sc, warps: s0.warps, clear, t0 };
      }
      if (!chosen) { rej.timing++; continue; }
      // no robust non-warping shot at the chosen time and at a few others
      let nwBad = false;
      for (const t0 of [chosen.t0, 240, 600, 1000]) { const Gt = C.scan(L, t0, 1); if (C.worstNoWarp(L, Gt, t0, NWLIM, NWPRE) >= NWLIM) { nwBad = true; break; } }
      if (nwBad) { rej.nowarp++; continue; }
      sol = chosen; tInfo = 'open ' + (100 * tp.frac).toFixed(0) + '% gap ' + tp.gap + 's @' + chosen.t0;
    }
    L.solution = { vx: sol.vx, vy: sol.vy, t0Step: sol.t0 };
    const alts = [];
    for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) {
      const q = k * NP + j; if (!G0.H[q] || !G0.Wp[q]) continue;   // the fragment route must use a wormhole too
      const other = comp.lab[q] !== comp.lab[sol0.k * NP + sol0.j], far = Math.min(Math.abs(k - sol0.k), NA - Math.abs(k - sol0.k)) >= 10 || Math.abs(j - sol0.j) >= 10;
      const h = C.hood(G0.H, k, j); if (h < 7) continue;
      if (other && comp.sizes[comp.lab[q]] >= 3) alts.push([0, comp.sizes[comp.lab[q]] + h, k, j]); else if (!other && far) alts.push([1, h, k, j]);
    }
    alts.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const fa = plan.fa;
    let tried = 0; const triedAlts = [];
    fr2.alts += alts.length ? 1 : 0; fr2.nosol++;
    for (let q = 0; q < alts.length && tried < 25; q++) {
      const [kind, , k, j] = alts[q], a = k * 0.5, p = PWR(j), va = g.launch(a, p), vax = rnd3(va.vx), vay = rnd3(va.vy);
      if (triedAlts.some(t => Math.min(Math.abs(t[0] - k), NA - Math.abs(t[0] - k)) < 6 && Math.abs(t[1] - j) < 3)) continue;   // a different shot each time
      triedAlts.push([k, j]); tried++;
      const fr = placeFrags(C, L, nf, { vx: vax, vy: vay }, L.solution, rngF, fa);
      if (!fr) { fr2.place++; continue; }
      L.frags = fr;
      const fs2 = P.simulate(L, vax, vay, 0, K.MAX_STEPS), ss = P.simulate(L, sol.vx, sol.vy, sol.t0, K.MAX_STEPS);
      if (fs2.status !== 'hit' || Array.from(fs2.collected).some(c => !c) || ss.status !== 'hit' || Array.from(ss.collected).some(c => c)) { fr2.verify++; continue; }
      // the lead's search must find several full-clear launches
      const cs = C.clearSearch(L);
      if (cs.fullHits < 6 || cs.robust < 12 || cs.at0 < 3 || cs.bestWarps < 1 || cs.nwBest * 2 > cs.top) { log.clearFail = (log.clearFail || 0) + 1; continue; }
      const bf = C.bestFull0(L);
      if (!bf.best || bf.best.nbr < 4 || bf.best.n81 < 12) { log.clearFail = (log.clearFail || 0) + 1; continue; }
      L.fragSolution = { vx: bf.best.vx, vy: bf.best.vy, t0Step: 0 };
      return { L, stats: { idx, seed, ratio: G0.ratio, target: m, hood: sol.hood, robust: sol.robust, warps: sol.warps, clear: Math.round(sol.clear), timing: tInfo,
        fragInfo: (kind ? 'same-cl ' : 'other-cl ') + a.toFixed(1) + '/' + p.toFixed(3), clearSearch: cs, frags: nf, angle: sol.a, power: sol.p, steps: ss.step } };
    }
  }
  rej.frags++;
  return null;
}
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
// fragments on the alt path (the old placeFrags rules) with the option of one fragment after the first wormhole exit
const SEP = 48;   // a fragment lies at least this far (frag radius 24 + margin) from every point of the stored solution's path
const _A = new Float32Array(2 * 1200), _S = new Float32Array(2 * 1200);
const PF = { nohit: 0, box: 0, body: 0, pt: 0, space: 0, solpath: 0, ok: 0 };
function placeFrags(C, L, n, alt, sol, rng, after) {
  const { K, P, g } = C, sa = P.simulate(L, alt.vx, alt.vy, 0, K.MAX_STEPS, _A), ss = P.simulate(L, sol.vx, sol.vy, sol.t0Step | 0, K.MAX_STEPS, _S);
  if (sa.status !== 'hit') { PF.nohit++; return null; }
  // first warp step of the alt flight
  let ws = -1; { const s = P.createSim(L, alt.vx, alt.vy, 0); while (P.stepSim(s, L) === 'flying' && s.step < K.MAX_STEPS) if (s.warps && ws < 0) { ws = s.step; break; } if (s.warps && ws < 0) ws = s.step; }
  const lo = Math.floor(sa.n * 0.12), hi = Math.floor(sa.n * 0.88), seg = (hi - lo) / n, out = [];
  const wantAfter = after && ws >= 0 && ws + 25 < hi;
  for (let f = 0; f < n; f++) {
    let found = null;
    for (let tries = 0; tries < 50 && !found; tries++) {
      let s = Math.floor(lo + seg * (f + rng()));
      if (wantAfter && f === n - 1 && tries < 30) s = Math.floor(ws + 14 + rng() * (hi - ws - 14));   // the last fragment rides the route after the exit
      if (s >= sa.n) continue;
      const ang = rng() * 2 * PI, rr = rng() * 8, x = ri(_A[2 * s] + Math.cos(ang) * rr), y = ri(_A[2 * s + 1] + Math.sin(ang) * rr);
      if (x < 40 || x > 860 || y < 40 || y > 1560) { PF.box++; continue; }
      let ok = true, i;
      for (i = 0; i < L.bodies.length && ok; i++) if (g.pointGap(L.bodies[i], x, y) < (L.bodies[i].kind === 'wormhole' ? 30 : 22)) ok = false;
      if (!ok) { PF.body++; continue; }
      if (Math.hypot(x - L.probe.x, y - L.probe.y) < 120 || Math.hypot(x - L.target.x, y - L.target.y) < L.target.r + 60) { PF.pt++; continue; }
      for (i = 0; i < out.length && ok; i++) if (Math.hypot(x - out[i].x, y - out[i].y) < 130) ok = false;
      if (!ok) PF.space++;
      for (i = 0; i < ss.n && ok; i += 2) { const dx = _S[2 * i] - x, dy = _S[2 * i + 1] - y; if (dx * dx + dy * dy < SEP * SEP) ok = false; }
      if (!ok && !PF.lastSp) PF.solpath++;
      if (ok) found = { x, y };
    }
    if (!found) return null;
    out.push(found);
  }
  return out;
}

function bakeOne(G, C, idx, maxTries) {
  const log = { rejected: { layout: 0, straight: 0, band: 0, robust: 0, nowarp: 0, exit: 0, timing: 0, frags: 0 } };
  const base = 61000 + 97 * idx + (+process.env.LEVELS_SALT || 0);
  for (let r = 0; r < (maxTries || 30000); r++) {
    const seed = base + 1000 * r;
    if (r === 600 && PLAN[idx - V3].blk !== 'R') PLAN[idx - V3].blk = 'R';   // a plate that resists its planned blocker falls back to the repulsor (this worker process only)
    if (r % 200 === 199) { try { fs.appendFileSync(path.join(CACHE, 'v3-progress.log'), '[' + (idx + 1) + '] ' + (r + 1) + ' seeds ' + JSON.stringify(log.rejected) + ' clearFail ' + (log.clearFail || 0) + ' fr ' + JSON.stringify(log.fr) + '\n'); } catch (e) {} }
    const res = evaluate(C, idx, seed, log);
    if (res) { res.stats.tries = r + 1; res.L.seed = seed; delete res.L._route; return { level: res.L, stats: res.stats, log }; }
  }
  return { level: null, stats: { idx }, log };
}

/* ---------- compact literal writer (same format as levels-bake.js) ---------- */
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
const LINE_RE = /^    \{id:"c(\d{2,3})"/;
const GOLDEN = path.join(__dirname, 'levels-golden.json');
function campaignLines(src) {
  const a = src.indexOf('/*@CAMPAIGN*/'), b = src.indexOf('/*@END*/');
  if (a < 0 || b < 0) throw new Error('markers missing');
  return src.slice(a, b).split('\n').filter(l => LINE_RE.test(l));
}
// pins for Volumes I (lines) and II (lines2); written once, then only checked
function pins() {
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')), lines = campaignLines(fs.readFileSync(LEVELS, 'utf8'));
  if (!gold.lines2) {
    if (lines.length < 60) throw new Error('need the 60 older lines to pin Volume II');
    const out = {}; for (const k of Object.keys(gold)) { out[k] = gold[k]; if (k === 'lines') { out.lines2_about = 'sha256 of the exact text of CAMPAIGN lines 31-60 (Volume II) in src/20-levels.js, pinned when Volume III was added. Never change them.'; out.lines2 = lines.slice(30, 60).map(sha); } }
    fs.writeFileSync(GOLDEN, JSON.stringify(out, null, 1)); return out;
  }
  return gold;
}
// Appends the 30 Volume III lines after the 60 older ones, which stay byte-identical (checked against the pins before writing).
function writeModule(v3levels) {
  const src = fs.readFileSync(LEVELS, 'utf8'), a = src.indexOf('/*@CAMPAIGN*/'), b = src.indexOf('/*@END*/'), gold = pins();
  const lines = campaignLines(src);
  if (lines.length < 60 || v3levels.length !== NALL - V3) throw new Error('need the 60 older lines + 30 new plates');
  if (lines.length > NALL) throw new Error('Volumes IV-V follow Volume III; rewriting Volume III would drop them (and it is pinned): refusing');
  lines.slice(0, 30).forEach((l, i) => { if (sha(l) !== gold.lines[i]) throw new Error('Volume I plate ' + (i + 1) + ' differs from the pin; refusing to write'); });
  lines.slice(30, 60).forEach((l, i) => { if (sha(l) !== gold.lines2[i]) throw new Error('Volume II plate ' + (i + 31) + ' differs from the pin; refusing to write'); });
  const sec = src.slice(a, b).split('\n'); let n = 0, cut = -1;
  sec.forEach((l, i) => { if (LINE_RE.test(l) && ++n === 60) cut = i; });
  const head = sec.slice(0, cut + 1).join('\n') + '\n  ]).concat([\n' + v3levels.map(l => '    ' + lit(l)).join(',\n') + '\n  ]);';
  let out = src.slice(0, a) + head + src.slice(b);
  // Levels.VOLUMES gets Volume III (the only other edit to the module)
  const old2 = "{ name: 'Volume II', from: 30, to: 59 }]", new3 = "{ name: 'Volume II', from: 30, to: 59 }, { name: 'Volume III', from: 60, to: 89 }]";
  if (!out.includes("'Volume III'")) { if (!out.includes(old2)) throw new Error('VOLUMES literal not found'); out = out.replace(old2, new3); }
  fs.writeFileSync(LEVELS, out);
}

/* ---------- verification ---------- */
const tierOf = i => i < 66 ? 'A' : i < 72 ? 'B' : i < 78 ? 'C' : i < 84 ? 'D' : 'E';
function verifyPlates(G, C, list) {
  const { g, K, P } = C, CAMP = G.Levels.CAMPAIGN, rows = [], msgs = []; let ok = true;
  const allNames = new Set(); CAMP.forEach((l, i) => { if (!list.includes(i)) allNames.add(l.name); });
  const Pw = []; for (let j = 0; j < NP; j++) Pw.push(PWR(j));
  for (const i of list) {
    const L = CAMP[i], plan = PLAN[i - V3], probs = [], need = plan.chain ? 2 : 1, s = L.solution, moving = movingOf(L), m = ratioTarget(i);
    const wh = L.bodies.map((b, q) => b.kind === 'wormhole' ? q : -1).filter(q => q >= 0), pairsN = wh.length / 2;
    if (!s || !Number.isInteger(s.t0Step) || s.t0Step < 0 || (moving ? s.t0Step === 0 : s.t0Step !== 0)) probs.push('solution t0Step ' + (s && s.t0Step) + (moving ? ' (moving plates launch at a non-zero time)' : ' (static plates: 0)'));
    if (L.index !== i || L.plate !== G.toRoman(i + 1) || L.id !== 'c' + String(i + 1).padStart(2, '0')) probs.push('index/plate/id');
    if (allNames.has(L.name) || L.name !== NAMES3[i - V3]) probs.push('name'); allNames.add(L.name);
    if (Math.abs(L.difficulty - diffOf(i)) > 0.0006 || L.difficulty <= 1.6) probs.push('difficulty field');
    if (L.target.r < 26 || L.target.r > 38 || L.target.r !== plan.tr) probs.push('target r ' + L.target.r);
    if (L.frags.length < 2 || L.frags.length > 3) probs.push(L.frags.length + ' frags');
    if (L.bodies.length > 11) probs.push(L.bodies.length + ' bodies');
    // wormhole rules (CONTRACT-v3 section 1)
    if (pairsN !== plan.turn.length || wh.length % 2) probs.push('wormhole count ' + wh.length);
    for (const q of wh) {
      const b = L.bodies[q], tw = L.bodies[b.pair];
      if (!tw || tw.kind !== 'wormhole' || tw.pair !== q || b.pair === q) probs.push('pair link ' + q);
      else {
        if (b.r < 24 || b.r > 38 || b.mu !== 0) probs.push('mouth r/mu ' + q);
        if (Math.abs(b.turn / (PI / 4) - Math.round(b.turn / (PI / 4))) > 1e-9 || Math.abs(b.turn + tw.turn) > 1e-9) probs.push('turn ' + q);
        if (q < b.pair && C.twinDist(L, q) < 150) probs.push('twin distance ' + q);
      }
    }
    const turns = wh.filter(q => q < L.bodies[q].pair).map(q => Math.round(L.bodies[q].turn / DEG)), railsN = wh.filter(q => L.bodies[q].orbit).length;
    const tier = tierOf(i), solid = L.bodies.filter(b => b.kind !== 'wormhole');
    if (tier === 'A' && (pairsN !== 1 || turns.some(t => t) || railsN)) probs.push('tier A: one static pair, no turn');
    if (tier === 'B' && (pairsN !== 1 || turns.some(t => Math.abs(Math.abs(t) - 90) > 0.01 && Math.abs(Math.abs(t) - 45) > 0.01) || railsN || !solid.some(b => b.kind === 'planet' || b.kind === 'moon'))) probs.push('tier B: one pair, turns +-90/45, planet or moon');
    if (tier === 'C' && (pairsN !== 1 || railsN !== 1 || !solid.some(b => b.kind === 'blackhole' || b.kind === 'repulsor'))) probs.push('tier C: one pair, one mouth on rails, black hole or repulsor');
    if (tier === 'D' && pairsN !== 2) probs.push('tier D: two pairs');
    if (tier === 'E' && (pairsN !== 2 || !solid.some(b => b.kind === 'moon') || !solid.some(b => b.kind === 'blackhole' || b.kind === 'repulsor') || L.target.r > 30)) probs.push('tier E: two pairs, moon, black hole or repulsor, small target');
    // solution
    const t0s = s.t0Step | 0, wneed = moving ? 1 : need, sim = P.simulate(L, s.vx, s.vy, t0s, K.MAX_STEPS), sa = Math.atan2(s.vy, s.vx) / PI * 180, sp = Math.hypot(s.vx, s.vy) / K.VMAX;
    if (sim.status !== 'hit') probs.push('solution ' + sim.status);
    if (sim.warps < wneed) probs.push('solution warps ' + sim.warps + ' (< ' + wneed + ')');
    for (let q = 0; q < L.frags.length; q++) if (sim.collected[q]) probs.push('solution collects frag ' + q);
    const rob = C.robustW(L, sa, sp, t0s, 8, wneed); if (rob < 8) probs.push('solution not robust (' + rob + ')');
    if (g.robust(L, sa, sp, t0s) < 8) probs.push('g.robust < 8');
    if (!C.straightAll(L)) probs.push('straight shot hits (some launch time)');
    // exits clear
    let clear = 1e9; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const e of C.exitsOf(L, sa + a, clampP(sp + 0.03 * b), t0s)) clear = Math.min(clear, C.exitClear(L, e));
    if (clear < 30) probs.push('exit clearance ' + clear.toFixed(1));
    // clearances and overlaps
    for (let a = 0; a < L.bodies.length; a++) {
      if (g.pointGap(L.bodies[a], L.probe.x, L.probe.y) < 140) probs.push('probe clearance');
      if (g.pointGap(L.bodies[a], L.target.x, L.target.y) < 110) probs.push('target clearance');
      if (!C.inWorld(L.bodies[a])) probs.push('body outside the plate');
      for (let b = a + 1; b < L.bodies.length; b++) if (g.bodyGap(L.bodies[a], L.bodies[b]) < 30) probs.push('body overlap');
    }
    { const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
      for (let t = 0; t < 60 && moving; t += 0.02) for (let a = 0; a < L.bodies.length; a++) {
        const A = L.bodies[a]; P.bodyPos(A, t, pa); const ea = C.reff(A);
        if (pa.x - ea < 40 || pa.x + ea > 860 || pa.y - ea < 40 || pa.y + ea > 1560) { probs.push('out of world t=' + t.toFixed(2)); t = 99; break; }
        for (let b = a + 1; b < L.bodies.length; b++) { const B = L.bodies[b]; P.bodyPos(B, t, pb); if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < ea + C.reff(B)) { probs.push('overlap t=' + t.toFixed(2)); t = 99; break; } }
      } }
    for (const f of L.frags) { if (f.x < 40 || f.x > 860 || f.y < 40 || f.y > 1560) probs.push('fragment outside'); for (const b of L.bodies) if (g.pointGap(b, f.x, f.y) < 22) probs.push('fragment too close to a body'); }
    // full grid at t0 = 0: hit ratio, no robust shot that never warps, full-clear shots (hit + every fragment)
    const G0 = C.scan(L, 0, 1); let full = 0, fullNear = 0;
    const fsol = L.fragSolution, fsim = fsol && P.simulate(L, fsol.vx, fsol.vy, 0, K.MAX_STEPS);
    if (!fsim || fsim.status !== 'hit' || Array.from(fsim.collected).some(c => !c)) probs.push('fragSolution does not hit and collect every fragment');
    else if (fsol.vx === s.vx && fsol.vy === s.vy) probs.push('fragSolution === solution');
    else {
      const fa = Math.atan2(fsol.vy, fsol.vx) / DEG, fp = Math.hypot(fsol.vx, fsol.vy) / K.VMAX; let n = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const q = C.fly(L, fa + a, clampP(fp + 0.03 * b), 0); if (q.status === 'hit' && q.collected.every(c => c)) n++; }
      fullNear = n; let n81 = 0;
      for (let da = -1; da <= 1.001; da += 0.25) for (let dp = -0.05; dp <= 0.0501; dp += 0.0125) { const q = C.fly(L, fa + da, clampP(fp + dp), 0); if (q.status === 'hit' && q.collected.every(c => c)) n81++; }
      if (n81 < 12) probs.push('fragSolution tolerance ' + n81 + '/81 (the lead needs about 5)');
      for (let k = 0; k < NA; k++) for (let j = 0; j < NP; j++) if (G0.H[k * NP + j]) { const q = C.fly(L, k * 0.5, PWR(j), 0); if (q.collected.every(c => c)) full++; }
      if (full < 6) probs.push('only ' + full + ' full-clear shots at t0 = 0');
    }
    const nw = C.worstNoWarp(L, G0, 0, NWLIM, NWPRE); if (nw >= NWLIM) probs.push('a shot that never warps has ' + nw + '/9 hit neighbours at t0 = 0 (limit ' + (NWLIM - 1) + ')');
    if (G0.ratio < m / (BAND * 1.1) || G0.ratio > m * BAND * 1.1) probs.push('hit ratio ' + (100 * G0.ratio).toFixed(2) + '% vs target ' + (100 * m).toFixed(2) + '%');
    let tt = '-', frac = 1, gap = 0;
    if (moving) {
      // launch-time windows: the aiming clock keeps running, so every 0.5 s launch time over max(12 s, longest rail period) must be usable
      const tp = C.timing(L, [{ a: sa, p: sp }], 1, false); frac = tp.frac; gap = tp.gap;
      if (tp.frac < 0.7) probs.push('open at only ' + (100 * tp.frac).toFixed(0) + '% of launch times (need 70%)');
      if (tp.gap > 2.5) probs.push('launch-time gap of ' + tp.gap + ' s (max 2.5 s)');
      for (const t0 of [t0s, 240, 600, 1000]) { const Gt = C.scan(L, t0, 1), w = C.worstNoWarp(L, Gt, t0, NWLIM, NWPRE); if (w >= NWLIM) probs.push('a shot that never warps has ' + w + '/9 hit neighbours at t0=' + t0); }
      tt = (100 * tp.frac).toFixed(0) + '% gap ' + tp.gap + 's @' + t0s;
    }
    if (probs.length) { ok = false; msgs.push('L' + (i + 1) + ' ' + L.name + ': ' + probs.join('; ')); }
    rows.push({ i: i + 1, name: L.name, d: L.difficulty, pairs: pairsN, turns: turns.join('/'), moving: moving ? (railsN ? 'rails ' : 'moon ') + tt : 'static', open: frac, gap, warps: sim.warps, robust: rob, frags: L.frags.length, full, fullNear,
      ratio: (100 * G0.ratio).toFixed(2) + '%', bodies: L.bodies.length, r: L.target.r, clear: Math.round(clear) });
  }
  return { ok, rows, msgs };
}
function printRows(rows) {
  console.log('plate name                          d     pairs turns      moving                      warps rob frags fullclear(t0=0) ratio  bodies r   exit-clear');
  for (const r of rows.sort((a, b) => a.i - b.i)) console.log(String(r.i).padStart(5), r.name.padEnd(28), String(r.d).padEnd(5), String(r.pairs).padStart(4), r.turns.padEnd(10), String(r.moving).padEnd(28), String(r.warps).padStart(4), String(r.robust).padStart(4), String(r.frags).padStart(5), (r.full + ' (nbr ' + r.fullNear + '/9)').padEnd(16), r.ratio.padStart(6), String(r.bodies).padStart(5), String(r.r).padStart(3), String(r.clear).padStart(6));
}
// Pins + structure (cheap), then the plates in `workers` processes; returns a Promise<boolean>. Used by levels-bake.js --verify.
function verify3(nWorkers) {
  const G = loadFast(), C = makeCtx(G), CAMP = G.Levels.CAMPAIGN; let ok = true;
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')), lines = campaignLines(fs.readFileSync(LEVELS, 'utf8'));
  if (lines.length < NALL) { console.log('CAMPAIGN literal lines', lines.length, '(want >= 90)'); ok = false; }   // Volumes IV-V follow (levels-bake45.js)
  if (CAMP.length < NALL) { console.log('CAMPAIGN length', CAMP.length, '(want >= 90)'); ok = false; }
  if (!gold.lines2 || gold.lines2.length !== 30) { console.log('tools/levels-golden.json has no lines2 pins'); ok = false; }
  else for (let i = 30; i < 60; i++) if (!lines[i] || sha(lines[i]) !== gold.lines2[i - 30]) { console.log('L' + (i + 1), 'FROZEN PLATE CHANGED (Volume II)'); ok = false; }
  const V = G.Levels.VOLUMES;
  if (!V || V.length < 3 || V[2].name !== 'Volume III' || V[2].from !== 60 || V[2].to !== 89 || V[0].to !== 29 || V[1].from !== 30 || V[1].to !== 59) { console.log('VOLUMES wrong'); ok = false; }
  if (!ok || CAMP.length < NALL) return Promise.resolve(false);
  const idx = Array.from({ length: 30 }, (_, q) => q + V3), nw = nWorkers || 2, groups = Array.from({ length: nw }, () => []);
  idx.forEach((i, q) => groups[q % nw].push(i));
  return Promise.all(groups.map(gr => new Promise((res, rej) => cp.execFile(process.execPath, [__filename, '--verify-worker', gr.join(',')], { maxBuffer: 1 << 26 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(JSON.parse(so)))))).then(rs => {
    const rows = [].concat(...rs.map(r => r.rows)), msgs = [].concat(...rs.map(r => r.msgs)); msgs.sort().forEach(m => console.log(m));
    printRows(rows);
    { const mv = rows.filter(r => r.moving !== 'static'); if (mv.length) console.log('launch-time windows: ' + mv.length + ' plates on rails; worst open fraction ' + (100 * Math.min(...mv.map(r => r.open))).toFixed(0) + '%, longest closed gap ' + Math.max(...mv.map(r => r.gap)) + ' s'); }
    const okAll = rs.every(r => r.ok) && ok;
    console.log(okAll ? 'verify3: all 30 Volume III plates OK (solutions hit through >= 1 wormhole (chains: 2), robust 8/9 with every neighbour warping, no robust shot that never warps (all tested launch times), straight shots miss, author rules and exit clearances hold, 2-3 fragments with a full-clear shot and several more, moving plates robust at >= 3 of 4 launch times)' : 'verify3: FAILED');
    return okAll;
  });
}

/* ---------- main ---------- */
const cacheFile = i => path.join(CACHE, 'v4-c' + String(i + 1).padStart(2, '0') + '.json');
function table(rows) {
  console.log('idx name                         seed    try  ratio  tgt%  rob warps  exit timing        frag-path       full-clear(hits/robust81/at0)');
  for (const s of rows) {
    if (!s.seed) { console.log(String(s.idx).padStart(3), 'FAILED'); continue; }
    console.log(String(s.idx).padStart(3), (s.name || '').padEnd(28), String(s.seed).padEnd(7), String(s.tries).padStart(4), (100 * s.ratio).toFixed(2).padStart(6), (100 * s.target).toFixed(2).padStart(5), String(s.robust).padStart(3), String(s.warps).padStart(4), String(s.clear).padStart(5), (s.timing || '').padEnd(12), ('  ' + s.fragInfo).padEnd(16), s.clearSearch.fullHits + '/' + s.clearSearch.robust + '/' + s.clearSearch.at0);
  }
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--worker') {
    const G = loadFast(), C = makeCtx(G);
    const out = argv[1].split(',').map(Number).map(i => { const r = bakeOne(G, C, i); if (r.stats.seed) r.stats.name = r.level.name; return r; });
    process.stdout.write(JSON.stringify(out));
  } else if (argv[0] === '--verify-worker') {
    const G = loadFast(), C = makeCtx(G); process.stdout.write(JSON.stringify(verifyPlates(G, C, argv[1].split(',').map(Number))));
  } else if (argv[0] === '--verify') {
    verify3(2).then(ok => process.exit(ok ? 0 : 1)).catch(e => { console.error(e); process.exit(1); });
  } else if (argv[0] === '--try') {
    const G = loadFast(), C = makeCtx(G), idx = +argv[1], n = +argv[2] || 200, log = { rejected: { layout: 0, straight: 0, band: 0, robust: 0, nowarp: 0, exit: 0, timing: 0, frags: 0 } }, t = Date.now();
    let got = 0;
    for (let r = 0; r < n; r++) { const res = evaluate(C, idx, 61000 + 97 * idx + 1000 * r, log); if (res) { got++; if (got <= (+argv[3] || 3)) console.log('ok seed', res.L.seed, JSON.stringify(res.stats)); } }
    console.log(JSON.stringify(log), got, 'found', ((Date.now() - t) / 1000).toFixed(1) + 's');
  } else if (argv[0] === '--refrag') {
    // re-choose the stored full-clear course of already baked plates (most forgiving t0 = 0 shot), in place in the cache; then --assemble
    const G = loadFast(), C = makeCtx(G), list = (argv[1] ? argv[1].split(',').map(Number) : Array.from({ length: NALL - V3 }, (_, q) => q + V3));
    for (const i of list) {
      const f = cacheFile(i), r = JSON.parse(fs.readFileSync(f, 'utf8')), L = r.level; L.fragSolution = undefined;
      const bf = C.bestFull0(L); if (!bf.best) { console.log('plate', i + 1, 'no full-clear shot'); continue; }
      L.fragSolution = { vx: bf.best.vx, vy: bf.best.vy, t0Step: 0 }; r.stats.fragCourse = bf.best.nbr + '/9 ' + bf.best.n81 + '/81';
      fs.writeFileSync(f, JSON.stringify(r)); console.log('plate', i + 1, 'fragSolution', JSON.stringify(L.fragSolution), bf.best.nbr + '/9', bf.best.n81 + '/81', 'full-clear shots', bf.full);
    }
  } else if (argv[0] === '--assemble') {
    const lv = []; for (let i = V3; i < NALL; i++) { if (!fs.existsSync(cacheFile(i))) { console.log('missing cache for index', i); process.exit(1); } lv.push(JSON.parse(fs.readFileSync(cacheFile(i), 'utf8')).level); }
    writeModule(lv); console.log('wrote', path.relative(ROOT, LEVELS), (fs.statSync(LEVELS).size / 1024).toFixed(1) + ' KB');
    verify3(2).then(ok => process.exit(ok ? 0 : 1));
  } else {
    const only = argv[0] === '--only' ? argv[1].split(',').map(Number) : argv[0] === '--force' ? argv[1].split(',').map(Number) : null, force = argv[0] === '--force';
    fs.mkdirSync(CACHE, { recursive: true });
    const queue = (only || Array.from({ length: NALL - V3 }, (_, q) => q + V3)).filter(i => (only && !force) || force || !fs.existsSync(cacheFile(i)));
    if (queue.length) console.log('baking', queue.length, 'plates:', queue.join(','));
    const t = Date.now(), NW = Math.min(2, +(process.env.LEVELS_JOBS || 2)), results = [];
    queue.sort((a, b) => b - a);
    const runOne = i => new Promise((res, rej) => {
      cp.execFile(process.execPath, [__filename, '--worker', String(i)], { maxBuffer: 1 << 26 }, (e, so, se) => {
        if (se) process.stderr.write(se.split('\n').slice(-3).join('\n'));
        if (e) return rej(new Error(se || e.message));
        const r = JSON.parse(so)[0];
        if ((!only || force) && r.level) fs.writeFileSync(cacheFile(i), JSON.stringify(r));
        console.log('plate', i + 1, r.level ? 'baked' : 'FAILED', 'after', ((Date.now() - t) / 1000).toFixed(0) + ' s', r.level ? 'try ' + r.stats.tries : JSON.stringify(r.log.rejected));
        res(r);
      });
    });
    const lane = async () => { while (queue.length) results.push(await runOne(queue.shift())); };
    Promise.all(Array.from({ length: NW }, lane)).then(() => {
      const all = results.sort((a, b) => a.stats.idx - b.stats.idx);
      if (all.length) table(all.map(r => r.stats));
      all.forEach(r => { if (!r.level) console.log('L' + (r.stats.idx + 1), 'rejections', JSON.stringify(r.log.rejected)); });
      console.log('bake time', ((Date.now() - t) / 1000).toFixed(1) + ' s');
      if (only && !force) return;
      const lv = []; for (let i = V3; i < NALL; i++) { if (!fs.existsSync(cacheFile(i))) { console.log('NOT writing: plate', i + 1, 'has no bake yet'); process.exit(1); } lv.push(JSON.parse(fs.readFileSync(cacheFile(i), 'utf8')).level); }
      writeModule(lv); console.log('wrote', path.relative(ROOT, LEVELS), (fs.statSync(LEVELS).size / 1024).toFixed(1) + ' KB');
      verify3(2).then(ok => process.exit(ok ? 0 : 1));
    }).catch(e => { console.error(e); process.exit(1); });
  }
}
module.exports = { PF, PLAN, NAMES3, makeCtx, loadFast, layout, evaluate, bakeOne, verify3, verifyPlates, writeModule, lit, pins };
