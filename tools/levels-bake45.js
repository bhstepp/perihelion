#!/usr/bin/env node
/* PERIHELION — Volumes IV and V baker (owner: LEAD; not shipped in the game).
   Bakes plates c91..c120 (index 90..119, XCI..CXX: nebulae) and c121..c150 (index 120..149, CXXI..CL: pulsars), CONTRACT-v4 section 7.
   Each plate has a row in PLAN (which mechanic bodies, which other bodies, target size, rails). A seeded layout builder places the probe
   low and the target high (bands vary plate to plate), a blocker across the direct line (so the straight shot misses), the volume's
   mechanic beside the corridor, and the extra bodies; then a brute-force search (angle 720 x 0.5 deg, power 0.10..1.00 step 0.025, the
   frozen Physics.simulate) accepts a candidate only if
     - a robust solution exists (>= 8 of 9 neighbouring shots hit, every one of them USING the mechanic: Volume IV >= FOG_MIN steps (0.1 s) inside
       a nebula, Volume V caught by a pulsar beam at least once; on plates that also carry a wormhole pair the solution warps as well),
     - the mechanic matters: Volume IV: with the drag taken away the stored solution misses; Volume V: a beam catch is a timed kick that
       every robust route meets (see the next rule), so a solution need not depend on one particular catch,
     - no strong shot avoids the mechanic (a hit that never touches it has fewer than AVLIM of 9 hit neighbours, and such hits are under
       AVSHARE of all hits), at t0 = 0 and, for time-dependent plates, at the solution's launch time and one more (AV_T0S),
     - the straight shot misses at every launch time (Volume V: at t = 0 and >= 85% of launch times), the hit ratio sits in a band that falls through the volume,
     - time-dependent plates (anything on rails, every pulsar: its beams turn) keep the launch-time window rule of Volume III: a robust
       winning shot (any route: this rule is about playability) exists at >= 70% of the 0.5 s launch times over max(12 s, the longest
       period), no closed gap longer than 2.5 s,
     - 2-3 fragments sit on a different hit path and the full-clear search of tools/levels-clear.js finds several launches.
   usage: node tools/levels-bake45.js                 bake the missing plates (LEVELS_JOBS workers, default 3; resumable cache
                                                      tools/levels-cache/v45-cNNN.json), then write the module when all 60 exist
          node tools/levels-bake45.js --only 90,91    bake + print only those indices (no write, no cache)
          node tools/levels-bake45.js --force 90,91   rebake those indices into the cache
          node tools/levels-bake45.js --try 90 [n]    evaluate n seeds of one plate and print the rejection counts
          node tools/levels-bake45.js --assemble      write the module from the cache only
          node tools/levels-bake45.js --verify        verify the 60 baked plates (also run by  node tools/levels-bake.js --verify)   */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), LEVELS = path.join(ROOT, 'src', '20-levels.js'), CACHE = path.join(__dirname, 'levels-cache');
const GOLDEN = path.join(__dirname, 'levels-golden.json');
const V4 = 90, V5 = 120, NALL = 150, NOLD = 90, PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
const rnd3 = x => Math.round(x * 1000) / 1000, r3s = x => Number(x.toPrecision(3)), ri = Math.round;
const volOf = i => i < V5 ? 4 : 5;

// Plate names: Volume IV the nebulae of the old catalogues; Volume V lighthouses, lamps and clocks (a pulsar is a lighthouse that keeps time).
const NAMES4 = ['The Veil', 'The Great Nebula in Orion', 'Messier\'s Catalogue', 'The Lagoon', 'The Trifid', 'The Ring in Lyra',
  'The Dumbbell', 'The Owl', 'The Crab', 'The Cat\'s Eye', 'Herschel\'s Garden', 'The Planetary Nebula',
  'The Coalsack', 'The Horsehead', 'The Keyhole', 'Eta Carinae', 'The Omega', 'The Eagle',
  'The Rosette', 'The Drifting Veil', 'The Cocoon', 'The Flame', 'The Pelican', 'Barnard\'s Dark Lanes',
  'The North America', 'Huggins\'s Spectroscope', 'The Bubble', 'The Pillars', 'The Gegenschein', 'The Great Nebula in Andromeda'];
const NAMES5 = ['The Lighthouse', 'The Lamp Room', 'Fresnel\'s Lens', 'The Beacon', 'The Revolving Light', 'The Signal Lamp',
  'The Pharos', 'The Eddystone', 'Bell Rock', 'The Lantern Gallery', 'The Occulting Light', 'The Flashing Light',
  'The Leading Lights', 'The Keeper\'s Watch', 'The Clockwork Lamp', 'The Metronome', 'The Escapement', 'The Chronometer',
  'Harrison\'s Clock', 'The Time Ball', 'The Transit Clock', 'The Regulator', 'Two Beacons', 'The Neutron Star',
  'The Crab Pulsar', 'The Vela Pulsar', 'Little Green Men', 'The Pulse of the Sky', 'The Greenwich Signal', 'The Last Lighthouse'];
const nameOf = i => i < V5 ? NAMES4[i - V4] : NAMES5[i - V5];

/* ---------- the plan: one row per plate ----------
   blk: blocker across the direct line (R repulsor, P planet, H black hole); tr: target radius;
   neb: nebulae [{mode, r:[lo,hi], d:[drag lo,hi], rails}] (mode 'side' beside the corridor, 'wrap' round a planet (a planetary nebula),
        'across' straddling the corridor, 'probe' across the way out, 'target' across the way in, 'any' one of these but 'wrap'); pul: pulsars [{w:[|omega| lo,hi], push:[lo,hi], reach:[lo,hi]}];
   ex: extra bodies (P planet, M moon, H black hole, R repulsor, W a wormhole pair the route must use); pf: planet mass factor (mu = f r^3). */
const PLAN = [
  // ---- Volume IV: nebulae ----
  // XCI-XCVI: one static cloud (the lesson)
  { blk: 'P', tr: 38, neb: [{ mode: 'any', r: [110, 150], d: [0.5, 0.8] }], ex: [], pf: [14, 30] },
  { blk: 'P', tr: 37, neb: [{ mode: 'any', r: [100, 140], d: [0.6, 0.9] }], ex: [], pf: [14, 30] },
  { blk: 'P', tr: 37, neb: [{ mode: 'wrap', r: [110, 150], d: [0.5, 0.8] }], ex: [], pf: [16, 34] },
  { blk: 'P', tr: 36, neb: [{ mode: 'any', r: [100, 140], d: [0.6, 1.0] }], ex: ['P'], pf: [16, 34] },
  { blk: 'P', tr: 36, neb: [{ mode: 'any', r: [100, 140], d: [0.6, 1.0] }], ex: ['P'], pf: [16, 36] },
  { blk: 'P', tr: 35, neb: [{ mode: 'wrap', r: [100, 140], d: [0.6, 1.0] }], ex: ['P'], pf: [16, 38] },
  // XCVII-CII: clouds that tighten a slingshot (planets, moons)
  { blk: 'P', tr: 35, neb: [{ mode: 'wrap', r: [90, 130], d: [0.7, 1.1] }], ex: ['P', 'M'], pf: [20, 46] },
  { blk: 'P', tr: 34, neb: [{ mode: 'any', r: [90, 130], d: [0.7, 1.1] }], ex: ['P', 'P'], pf: [20, 46] },
  { blk: 'P', tr: 34, neb: [{ mode: 'any', r: [90, 130], d: [0.8, 1.2] }], ex: ['M'], pf: [20, 50] },
  { blk: 'P', tr: 33, neb: [{ mode: 'wrap', r: [90, 130], d: [0.7, 1.1] }, { mode: 'any', r: [70, 100], d: [0.5, 0.9] }], ex: ['P'], pf: [20, 50] },
  { blk: 'P', tr: 33, neb: [{ mode: 'any', r: [90, 130], d: [0.8, 1.2] }], ex: ['P', 'M'], pf: [24, 54] },
  { blk: 'P', tr: 32, neb: [{ mode: 'any', r: [80, 120], d: [0.8, 1.2] }, { mode: 'any', r: [70, 100], d: [0.6, 1.0] }], ex: ['P', 'M'], pf: [24, 54] },
  // CIII-CVIII: clouds near black holes and repulsors
  { blk: 'H', tr: 32, neb: [{ mode: 'any', r: [90, 130], d: [0.7, 1.1] }], ex: ['R'], pf: [20, 50] },
  { blk: 'R', tr: 32, neb: [{ mode: 'wrap', r: [90, 130], d: [0.8, 1.2] }], ex: ['H'], pf: [20, 50] },
  { blk: 'H', tr: 31, neb: [{ mode: 'any', r: [90, 120], d: [0.8, 1.2] }], ex: ['R', 'P'], pf: [24, 54] },
  { blk: 'R', tr: 31, neb: [{ mode: 'any', r: [80, 120], d: [0.9, 1.3] }], ex: ['H', 'M'], pf: [24, 54] },
  { blk: 'H', tr: 30, neb: [{ mode: 'any', r: [80, 120], d: [0.8, 1.2] }, { mode: 'any', r: [70, 100], d: [0.6, 1.0] }], ex: ['R'], pf: [24, 54] },
  { blk: 'R', tr: 30, neb: [{ mode: 'wrap', r: [80, 120], d: [0.9, 1.3] }], ex: ['H', 'R'], pf: [24, 54] },
  // CIX-CXIV: drifting clouds on rails
  { blk: 'P', tr: 30, neb: [{ mode: 'any', r: [90, 120], d: [0.7, 1.1], rails: 1 }], ex: ['P'], pf: [20, 50] },
  { blk: 'P', tr: 30, neb: [{ mode: 'any', r: [100, 130], d: [1.0, 1.4], rails: 1 }], ex: ['P'], pf: [20, 50] },
  { blk: 'P', tr: 29, neb: [{ mode: 'any', r: [100, 130], d: [1.0, 1.4], rails: 1 }], ex: ['P'], pf: [24, 54] },
  { blk: 'P', tr: 29, neb: [{ mode: 'any', r: [80, 110], d: [0.8, 1.2], rails: 1 }, { mode: 'any', r: [70, 100], d: [0.6, 1.0] }], ex: ['P'], pf: [24, 54] },
  { blk: 'P', tr: 28, neb: [{ mode: 'any', r: [80, 110], d: [0.8, 1.2], rails: 1 }], ex: ['H', 'M'], pf: [24, 54] },
  { blk: 'P', tr: 28, neb: [{ mode: 'any', r: [80, 110], d: [0.9, 1.3], rails: 1 }], ex: ['P', 'M', 'R'], pf: [26, 58] },
  // CXV-CXX: clouds with wormholes, small targets
  { blk: 'P', tr: 30, neb: [{ mode: 'any', r: [90, 120], d: [0.7, 1.1] }], ex: ['W'], pf: [20, 50] },
  { blk: 'P', tr: 29, neb: [{ mode: 'any', r: [80, 110], d: [0.8, 1.2] }], ex: ['W', 'P'], pf: [24, 54] },
  { blk: 'R', tr: 28, neb: [{ mode: 'any', r: [80, 110], d: [0.8, 1.2] }], ex: ['W', 'H'], pf: [24, 54] },
  { blk: 'H', tr: 28, neb: [{ mode: 'any', r: [80, 110], d: [0.8, 1.2], rails: 1 }], ex: ['W', 'P'], pf: [24, 54] },
  { blk: 'P', tr: 27, neb: [{ mode: 'any', r: [80, 110], d: [0.9, 1.3] }, { mode: 'any', r: [70, 100], d: [0.6, 1.0] }], ex: ['W', 'M'], pf: [26, 58] },
  { blk: 'P', tr: 27, neb: [{ mode: 'any', r: [100, 140], d: [1.0, 1.4] }], ex: ['W', 'P'], pf: [26, 58] },
  // ---- Volume V: pulsars ----
  // CXXI-CXXVI: one slow pulsar (the lesson)
  { blk: 'P', tr: 38, pul: [{ w: [0.3, 0.42], push: [700, 1000], reach: [380, 520] }], ex: [], pf: [14, 30] },
  { blk: 'P', tr: 37, pul: [{ w: [0.3, 0.45], push: [700, 1000], reach: [380, 520] }], ex: [], pf: [14, 30] },
  { blk: 'P', tr: 37, pul: [{ w: [0.32, 0.48], push: [800, 1100], reach: [360, 500] }], ex: [], pf: [16, 34] },
  { blk: 'P', tr: 36, pul: [{ w: [0.32, 0.5], push: [800, 1100], reach: [360, 500] }], ex: ['P'], pf: [16, 34] },
  { blk: 'P', tr: 36, pul: [{ w: [0.35, 0.5], push: [800, 1200], reach: [340, 480] }], ex: ['P'], pf: [16, 38] },
  { blk: 'H', tr: 35, pul: [{ w: [0.35, 0.55], push: [800, 1200], reach: [340, 480] }], ex: [], pf: [16, 38] },
  // CXXVII-CXXXII: faster beams and planets
  { blk: 'P', tr: 35, pul: [{ w: [0.5, 0.75], push: [900, 1300], reach: [340, 480] }], ex: ['P'], pf: [20, 46] },
  { blk: 'P', tr: 34, pul: [{ w: [0.5, 0.8], push: [900, 1300], reach: [320, 460] }], ex: ['P', 'P'], pf: [20, 46] },
  { blk: 'P', tr: 35, pul: [{ w: [0.4, 0.65], push: [900, 1300], reach: [320, 460] }], ex: ['P'], pf: [20, 50] },
  { blk: 'P', tr: 33, pul: [{ w: [0.55, 0.9], push: [1000, 1400], reach: [320, 460] }], ex: ['P', 'P'], pf: [20, 50] },
  { blk: 'P', tr: 33, pul: [{ w: [0.6, 0.95], push: [1000, 1400], reach: [300, 440] }], ex: ['P'], pf: [24, 54] },
  { blk: 'P', tr: 32, pul: [{ w: [0.6, 1.0], push: [1000, 1400], reach: [300, 440] }], ex: ['P', 'P'], pf: [24, 54] },
  // CXXXIII-CXXXVIII: pulsars with moons and black holes
  { blk: 'P', tr: 32, pul: [{ w: [0.45, 0.8], push: [900, 1300], reach: [320, 460] }], ex: ['P', 'M'], pf: [20, 50] },
  { blk: 'H', tr: 32, pul: [{ w: [0.45, 0.8], push: [900, 1300], reach: [320, 460] }], ex: ['M'], pf: [20, 50] },
  { blk: 'R', tr: 31, pul: [{ w: [0.5, 0.85], push: [1000, 1400], reach: [300, 440] }], ex: ['H'], pf: [24, 54] },
  { blk: 'P', tr: 31, pul: [{ w: [0.5, 0.85], push: [1000, 1400], reach: [300, 440] }], ex: ['H', 'M'], pf: [24, 54] },
  { blk: 'H', tr: 30, pul: [{ w: [0.55, 0.9], push: [1000, 1400], reach: [300, 440] }], ex: ['R', 'M'], pf: [24, 54] },
  { blk: 'R', tr: 30, pul: [{ w: [0.55, 0.95], push: [1000, 1500], reach: [300, 420] }], ex: ['H', 'P', 'M'], pf: [24, 54] },
  // CXXXIX-CXLIV: two pulsars
  { blk: 'P', tr: 30, pul: [{ w: [0.35, 0.6], push: [800, 1200], reach: [300, 420] }, { w: [0.35, 0.6], push: [800, 1200], reach: [280, 400] }], ex: [], pf: [20, 50] },
  { blk: 'P', tr: 30, pul: [{ w: [0.4, 0.7], push: [800, 1200], reach: [300, 420] }, { w: [0.4, 0.7], push: [800, 1200], reach: [280, 400] }], ex: [], pf: [20, 50] },
  { blk: 'P', tr: 29, pul: [{ w: [0.45, 0.75], push: [900, 1300], reach: [280, 400] }, { w: [0.45, 0.75], push: [900, 1300], reach: [280, 400] }], ex: ['P'], pf: [24, 54] },
  { blk: 'H', tr: 29, pul: [{ w: [0.45, 0.8], push: [900, 1300], reach: [280, 400] }, { w: [0.45, 0.8], push: [900, 1300], reach: [280, 400] }], ex: ['P'], pf: [24, 54] },
  { blk: 'P', tr: 30, pul: [{ w: [0.5, 0.85], push: [1000, 1400], reach: [280, 400] }, { w: [0.5, 0.85], push: [1000, 1400], reach: [260, 380] }], ex: [], pf: [24, 54] },
  { blk: 'P', tr: 28, pul: [{ w: [0.5, 0.9], push: [1000, 1400], reach: [280, 400] }, { w: [0.5, 0.9], push: [1000, 1400], reach: [260, 380] }], ex: ['H'], pf: [26, 58] },
  // CXLV-CL: pulsars with nebulae and wormholes, small targets
  { blk: 'P', tr: 30, pul: [{ w: [0.45, 0.8], push: [900, 1300], reach: [300, 440] }], neb: [{ mode: 'side', r: [80, 120], d: [0.7, 1.1] }], ex: ['P'], pf: [24, 54] },
  { blk: 'P', tr: 29, pul: [{ w: [0.45, 0.8], push: [900, 1300], reach: [300, 440] }], ex: ['W'], pf: [24, 54] },
  { blk: 'P', tr: 28, pul: [{ w: [0.5, 0.85], push: [1000, 1400], reach: [300, 420] }], neb: [{ mode: 'wrap', r: [80, 110], d: [0.8, 1.2] }], ex: ['P', 'M'], pf: [24, 54] },
  { blk: 'H', tr: 28, pul: [{ w: [0.5, 0.85], push: [1000, 1400], reach: [300, 420] }], ex: ['W', 'P'], pf: [26, 58] },
  { blk: 'P', tr: 27, pul: [{ w: [0.5, 0.9], push: [1000, 1400], reach: [280, 400] }], neb: [{ mode: 'side', r: [80, 110], d: [0.8, 1.2] }], ex: ['W'], pf: [26, 58] },
  { blk: 'P', tr: 26, pul: [{ w: [0.5, 0.9], push: [1000, 1500], reach: [280, 400] }, { w: [0.4, 0.7], push: [900, 1300], reach: [260, 380] }], neb: [{ mode: 'side', r: [80, 110], d: [0.8, 1.2] }], ex: ['W', 'M'], pf: [26, 58] },
];

// Variety: probe x band / target x band / target y band per plate (0 left/high, 1 centre/middle, 2 right/low); the probe always sits low.
const PXB = [0,2,1,0,1,2, 1,2,0,2,1,0, 2,1,0,1,2,0, 0,1,2,0,2,1, 1,0,2,1,0,2,  2,0,1,2,1,0, 0,1,2,1,0,2, 1,2,0,2,1,0, 2,0,1,0,2,1, 1,2,0,2,0,1];
const TXB = [2,0,1,2,0,1, 0,1,2,0,2,1, 0,2,1,2,0,1, 2,1,0,2,1,0, 0,2,1,0,1,2,  0,2,1,0,2,1, 2,1,0,2,0,1, 0,1,2,0,1,2, 1,0,2,1,2,0, 2,0,1,2,1,0];
const TYB = [0,1,0,1,2,0, 1,0,2,1,0,2, 0,1,2,0,1,0, 2,0,1,2,1,0, 1,2,0,1,0,2,  0,1,0,2,1,0, 1,2,0,1,0,2, 0,1,2,0,2,1, 1,0,2,1,0,2, 0,2,1,0,1,2];
const XR = [[150, 300], [330, 570], [600, 750]], TYR = [[180, 330], [330, 520], [520, 700]];
const diffOf = i => i < V5 ? rnd3(2.22 + 0.58 * (i - V4) / 29) : rnd3(2.82 + 0.58 * (i - V5) / 29);       // 2.22..2.80, 2.82..3.40
const ratioTarget = i => { const q = (i < V5 ? i - V4 : i - V5) / 29; return 0.011 * Math.pow(0.4, q); };   // 1.1% -> 0.44% of the grid hits
const BAND = 3.0;
const USE_NEED = 6;            // ... and at least this many of a robust solution's 9 neighbours use the mechanic too
const FOG_MIN = 12;            // a Volume IV solution spends at least 0.2 s inside a nebula (and so does each robust neighbour)
const AVLIM = 7, AVPRE = 5;    // reject a plate with a hit that avoids the mechanic and has >= AVLIM of 9 hit neighbours
// time-dependent plates: the mechanic must also be unavoidable at the solution's own launch time (t = 0 is always checked). Beams turn
// and clouds drift, so waiting for a moment when the way round is open is a fair way to play such a plate.
const AV_T0S = t0 => t0 ? [t0] : [];
const AVSHARE = 0.8;           // ... or where such hits are more than this share of all hits

function loadFast() {
  const src = ['00-const.js', '10-physics.js', '20-levels.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  return vm.runInThisContext('(function(){' + src + '\n;return {K:K,Physics:Physics,Levels:Levels,toRoman:toRoman};})()', { filename: 'perihelion-src' });
}

const NA = 720, NP = 37, PWR = j => 0.1 + 0.025 * j, CLEAR_T0S = [0, 120, 260, 450, 700];
const clampP = p => p > 1 ? 1 : p;
const PWRS = Array.from({ length: NP }, (_, j) => PWR(j));
const hasKind = (L, k) => L.bodies.some(b => b.kind === k);
const timeDep = L => L.bodies.some(b => b.orbit || b.beam);

function makeCtx(G) {
  const g = G.Levels._gen, K = G.K, P = G.Physics, DT = K.DT, pos = { x: 0, y: 0 };
  const reff = b => b.kind === 'blackhole' ? b.capture : b.r;
  const sweep = b => { const o = b.orbit; return o ? { x: o.cx, y: o.cy, R: o.rad + reff(b) } : { x: b.x, y: b.y, R: reff(b) }; };
  const inWorld = b => { const s = sweep(b); return s.x - s.R >= 40 && s.x + s.R <= 860 && s.y - s.R >= 40 && s.y + s.R <= 1560; };
  const at = (b, t) => { P.bodyPos(b, t, pos); return pos; };
  const fly = (L, a, p, t0) => { const v = g.launch(a, p); return P.simulate(L, v.vx, v.vy, t0, K.MAX_STEPS); };
  // the mechanic use of a flight: 0 = never touched it; Volume IV: fog >= FOG_MIN steps; Volume V: >= 1 beam catch; plates with a
  // wormhole pair the plan asks for (ex 'W') must warp too
  const mech = L => L._vol === 4 ? (s => s.fog >= FOG_MIN) : (s => s.beams >= 1);
  const touch = L => L._vol === 4 ? (s => s.fog > 0) : (s => s.beams > 0);
  const usesOf = L => mech(L);   // plates that also carry a wormhole pair: only the stored solution must warp as well (see evaluate)

  function scan(L, t0, stride) {
    const H = new Uint8Array(NA * NP), U = new Uint8Array(NA * NP), T = new Uint8Array(NA * NP), use = usesOf(L), tc = touch(L); let n = 0, h = 0, av = 0;
    for (let k = 0; k < NA; k += stride) for (let j = 0; j < NP; j++) {
      n++; const s = fly(L, k * 0.5, PWR(j), t0);
      if (s.status === 'hit') { const q = k * NP + j; H[q] = 1; h++; if (use(s)) U[q] = 1; if (tc(s)) T[q] = 1; else av++; }
    }
    return { H, U, T, hits: h, ratio: h / n, avoid: av };
  }
  const cell = (M, k, j) => (j < 0 || j >= NP) ? 0 : M[((k % NA + NA) % NA) * NP + j];
  function hood(M, k, j) { let s = 0; for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++) s += cell(M, k + a, Math.min(NP - 1, j + b)); return s; }
  // finger test at (a, p): hits among the 3x3 neighbourhood (+-1 deg, +-0.03 power); the centre must use the mechanic and so must at
  // least USE_NEED of the 9 (a beam is narrow: a neighbour may slip past it and still hit), else 0
  function robustU(L, a, p, t0, need) {
    const use = usesOf(L); let n = 0, u = 0, miss = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const s = fly(L, a + i, clampP(p + 0.03 * j), t0), h = s.status === 'hit';
      if (h) { n++; if (use(s)) u++; } else if (++miss > 9 - need) return 0;
      if (!i && !j && (!h || !use(s))) return 0;
    }
    return u >= USE_NEED ? n : 0;
  }
  // the strongest hit that never touches the mechanic: its 3x3 neighbourhood (any hit counts)
  function worstAvoid(L, G0, t0, lim, pre) {
    let worst = 0;
    for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) {
      const q = k * NP + j; if (!G0.H[q] || G0.T[q]) continue;
      if (hood(G0.H, k, j) < (pre || 9)) continue;
      const a = k * 0.5, p = PWR(j); let n = 0;
      for (let i = -1; i <= 1; i++) for (let jj = -1; jj <= 1; jj++) if (fly(L, a + i, clampP(p + 0.03 * jj), t0).status === 'hit') n++;
      if (n > worst) worst = n; if (worst >= (lim || 8)) return worst;
    }
    return worst;
  }
  // the plate with its mechanic taken away (nebula drag 0, beam push 0): the stored solution must miss there
  function ablate(L) {
    return Object.assign({}, L, { bodies: L.bodies.map(b => b.kind === 'nebula' && L._vol === 4 ? Object.assign({}, b, { drag: 0 })
      : b.beam && L._vol === 5 ? Object.assign({}, b, { beam: Object.assign({}, b.beam, { push: 0 }) }) : b) });
  }
  // wormhole exits of a flight and their clearance (Volume III rules), for plates that carry a pair
  function exitsOf(L, a, p, t0) {
    const v = g.launch(a, p), s = P.createSim(L, v.vx, v.vy, t0), out = []; let w = 0;
    for (;;) {
      const st = P.stepSim(s, L);
      if (s.warps > w) { w = s.warps; const sp = Math.hypot(s.vx, s.vy); out.push({ to: s.events.filter(e => e.type === 'warp').pop().to, ux: s.vx / sp, uy: s.vy / sp, t: s.abs * DT }); }
      if (st !== 'flying' || s.step >= K.MAX_STEPS) break;
    }
    return out;
  }
  function exitClear(L, e) {
    const tw = L.bodies[e.to], moving = L.bodies.some(b => b.orbit), ts = []; let m = 1e9;
    if (moving) for (let t = 0; t < 60; t += 0.05) ts.push(t); else ts.push(0);
    for (const t of ts) {
      const c = at(tw, t), ex = c.x + e.ux * (tw.r + K.WARP_GAP), ey = c.y + e.uy * (tw.r + K.WARP_GAP);
      m = Math.min(m, ex, 900 - ex, ey, 1600 - ey);
      for (let q = 0; q < L.bodies.length; q++) if (L.bodies[q] !== tw && L.bodies[q].kind !== 'nebula') { const b = L.bodies[q], pb = at(b, t); m = Math.min(m, Math.hypot(pb.x - ex, pb.y - ey) - reff(b)); }
    }
    return m;
  }
  function exitsClear(L, a, p, t0) {
    if (!hasKind(L, 'wormhole')) return 1e9;
    let clear = 1e9; for (let i = -1; i <= 1; i++) for (let jj = -1; jj <= 1; jj++) for (const e of exitsOf(L, a + i, clampP(p + 0.03 * jj), t0)) clear = Math.min(clear, exitClear(L, e));
    return clear;
  }
  // the lead's full-clear search (tools/levels-clear.js): shots that hit and collect every fragment, angle x power x launch times
  function clearSearch(L) {
    const t0s = timeDep(L) ? CLEAR_T0S : [0], hits = new Map(), key = (t, a, j) => (t * 1000 + ((a % NA) + NA) % NA) * 100 + j, use = usesOf(L);
    t0s.forEach((t0, ti) => { for (let a = 0; a < NA; a++) for (let j = 0; j < NP; j++) {
      const v = g.launch(a * 0.5, PWR(j)), s = P.simulate(L, v.vx, v.vy, t0, K.MAX_STEPS, null);
      if (s.status === 'hit' && s.collected.every(x => x)) hits.set(key(ti, a, j), [ti, a, j, use(s) ? 1 : 0]); } });
    const scored = [];
    hits.forEach(([ti, a, j]) => { let n = 0;
      for (let da = -2; da <= 2; da++) for (let dj = -2; dj <= 2; dj++) if (j + dj >= 0 && j + dj < NP && hits.has(key(ti, a + da, j + dj))) n++;
      scored.push({ ti, a, j, n }); });
    scored.sort((x, y) => y.n - x.n);
    let best = null, avBest = 0; for (const c of scored) if (!hits.get(key(c.ti, c.a, c.j))[3]) avBest = Math.max(avBest, c.n);
    for (const c of scored.slice(0, 30)) {
      let n = 0; const a0 = c.a * 0.5, p0 = PWR(c.j);
      for (let da = -1; da <= 1.001; da += 0.25) for (let dp = -0.05; dp <= 0.0501; dp += 0.0125) {
        const v = g.launch(a0 + da, Math.min(1, p0 + dp)), s = P.simulate(L, v.vx, v.vy, t0s[c.ti], K.MAX_STEPS, null); if (s.status === 'hit' && s.collected.every(x => x)) n++; }
      if (!best || n > best.n) best = { n, t0: t0s[c.ti], use: hits.get(key(c.ti, c.a, c.j))[3] };
    }
    return { fullHits: hits.size, bestUse: best ? best.use : 0, avBest, top: scored.length ? scored[0].n : 0, robust: best ? best.n : 0, t0: best ? best.t0 : -1, at0: [...hits.values()].filter(h => h[0] === 0).length };
  }
  // the stored full-clear course (t0 = 0): the most forgiving grid shot that hits and collects every fragment
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
      if (!best || nbr > best.nbr || (nbr === best.nbr && n81 > best.n81)) best = { vx, vy, nbr, n81 };
    }
    return { full: hits.size, best };
  }
  // ---- launch-time windows (Volume III rule): sampled every 0.5 s over max(12 s, the longest period) ----
  // periods: a body on rails 2 pi / |omega|; a pulsar's two opposite beams repeat every pi / |omega|
  const periodOf = L => Math.max(0, ...L.bodies.map(b => b.orbit ? TAU / Math.abs(b.orbit.omega) : b.beam ? PI / Math.abs(b.beam.omega) : 0));
  const spanOf = L => Math.max(12, periodOf(L));
  const TSTEP = 60;
  // the window rule is about playability (no frame-perfect timing), so any robust winning shot opens a launch time; the stored solution
  // itself is held to the mechanic rules separately
  function robustH(L, a, p, t0) {
    let n = 0, miss = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (fly(L, a + i, clampP(p + 0.03 * j), t0).status === 'hit') n++; else if (++miss > 1 || (!i && !j)) return 0;
    }
    return n;
  }
  function scan1(L, t0) {
    const H = new Uint8Array(360 * NP);
    for (let m = 0; m < 360; m++) for (let j = 0; j < NP; j++) { const s = fly(L, m, PWR(j), t0); if (s.status === 'hit') H[m * NP + j] = 1; }
    return H;
  }
  function openAt(L, t0, warm) {
    for (const c of warm) for (const da of [0, -1, 1, -2, 2, -4, 4, -7, 7]) for (const dp of [0, -0.05, 0.05, -0.1, 0.1]) {
      const a = c.a + da, p = clampP(c.p + dp); if (p < 0.1) continue;
      const s0 = fly(L, a, p, t0); if (s0.status !== 'hit') continue;
      if (robustH(L, a, p, t0) >= 8) return { a, p };
    }
    const H = scan1(L, t0), cand = [];
    for (let m = 0; m < 360; m++) for (let j = 1; j < NP - 1; j++) if (H[m * NP + j]) {
      let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += H[((m + a + 360) % 360) * NP + j + b];
      if (n >= 7) cand.push([n, m, j]);
    }
    cand.sort((x, y) => y[0] - x[0]);
    for (let q = 0; q < Math.min(cand.length, 40); q++) { const a = cand[q][1], p = PWR(cand[q][2]); if (robustH(L, a, p, t0) >= 8) return { a, p }; }
    return null;
  }
  function timing(L, seed, bail) {
    const n = Math.floor(spanOf(L) / 0.5) + 1, open = [], shots = []; let warm = seed.slice(), run = 0, gap = 0, closed = 0;
    for (let k = 0; k < n; k++) {
      const r = openAt(L, k * TSTEP, warm);
      if (r) { open.push(1); shots.push(r); warm.unshift(r); if (warm.length > 8) warm.pop(); run = 0; }
      else { open.push(0); shots.push(null); closed++; run++; gap = Math.max(gap, (run + 1) * 0.5); }
      if (bail && (gap > 2.5 || closed > 0.3 * n)) break;
    }
    const frac = open.filter(x => x).length / n;
    return { open, shots, n, frac, gap, ok: open.length === n && frac >= 0.7 && gap <= 2.5 };
  }
  // the straight shot at the target misses at every launch time; Volume V (beams turn): at t = 0 and at >= 85% of the 0.5 s launch times
  function straightAll(L) {
    const ts = []; if (timeDep(L)) for (let t = 0.5; t <= spanOf(L); t += 0.5) ts.push(Math.round(t * 120));
    if (g.straightHits(L, 0, PWRS)) return false;
    if (L._vol !== 5) return ts.every(t0 => !g.straightHits(L, t0, PWRS));
    let bad = 0; for (const t0 of ts) if (g.straightHits(L, t0, PWRS) && ++bad > 0.15 * ts.length) return false;
    return true;
  }
  function twinDist(L, a) {
    const A = L.bodies[a], B = L.bodies[A.pair], moving = A.orbit || B.orbit; let m = 1e9;
    for (let t = 0; t < (moving ? 60 : 1); t += 0.05) { const pa = at(A, t), ax = pa.x, ay = pa.y, pb = at(B, t); m = Math.min(m, Math.hypot(ax - pb.x, ay - pb.y)); }
    return m;
  }
  const why = {};
  return { why, G, g, K, P, reff, sweep, inWorld, at, fly, scan, cell, hood, robustU, worstAvoid, ablate, usesOf, touch, exitsOf, exitClear, exitsClear,
    clearSearch, bestFull0, periodOf, spanOf, timing, openAt, straightAll, twinDist };
}

/* ---------- geometry helpers that know about the new kinds ---------- */
// Solid bodies keep the Volume I-III spacing rules. Nebulae are clouds: they may hold a planet (a planetary nebula) and sit near the
// route; they only keep clear of the probe, the target, wormhole mouths and each other.
const isNeb = b => b.kind === 'nebula';
function placeOk(C, L, b, others) {
  const g = C.g, Pr = L.probe, T = L.target;
  if (!C.inWorld(b)) return 'inworld';
  if (isNeb(b)) {
    if (g.pointGap(b, Pr.x, Pr.y) < 70) return 'probeclr';
    if (g.pointGap(b, T.x, T.y) - T.r < 30) return 'targetclr';
    for (const o of others) if (o !== b && (isNeb(o) ? g.bodyGap(b, o) < 30 : o.kind === 'wormhole' ? g.bodyGap(b, o) < 24 : false)) return 'nebgap';
    return '';
  }
  if (g.pointGap(b, Pr.x, Pr.y) < 140) return 'probeclr';
  const gt = g.pointGap(b, T.x, T.y); if (gt < 110 || gt - T.r < 70) return 'targetclr';
  for (const o of others) if (o !== b && !isNeb(o) && g.bodyGap(b, o) < 34) return 'gap';
  for (const o of others) if (o !== b && isNeb(o) && b.kind === 'wormhole' && g.bodyGap(b, o) < 24) return 'nebgap';
  return '';
}

/* ---------- layout ---------- */
function layout(C, plan, idx, seed) {
  const { K } = C, rng = C.G.Levels.mulberry32(seed), toRoman = C.G.toRoman;
  const R = (a, b) => a + rng() * (b - a), RI = (a, b) => ri(R(a, b)), pick = a => a[Math.floor(rng() * a.length)], sgn = () => rng() < 0.5 ? -1 : 1;
  const q60 = idx - V4, Pr = { x: RI(XR[PXB[q60]][0], XR[PXB[q60]][1]), y: RI(1280, 1480) }, T = { x: RI(XR[TXB[q60]][0], XR[TXB[q60]][1]), y: RI(TYR[TYB[q60]][0], TYR[TYB[q60]][1]), r: plan.tr };
  const L = { id: 'c' + String(idx + 1).padStart(2, '0'), index: idx, seed, difficulty: diffOf(idx), name: nameOf(idx), plate: toRoman(idx + 1),
    probe: Pr, target: T, bodies: [], frags: [], solution: null };
  Object.defineProperty(L, '_vol', { value: volOf(idx), enumerable: false, writable: true });
  Object.defineProperty(L, '_needWarp', { value: plan.ex.includes('W'), enumerable: false, writable: true });
  const bodies = [], fail = w => (C.why[w] = (C.why[w] || 0) + 1, null);
  const len = Math.hypot(T.x - Pr.x, T.y - Pr.y), ux = (T.x - Pr.x) / len, uy = (T.y - Pr.y) / len, nx = -uy, ny = ux;
  const along = (u, off) => [Pr.x + (T.x - Pr.x) * u + nx * off, Pr.y + (T.y - Pr.y) * u + ny * off];
  const place = (b, tries, setPos) => { for (let t = 0; t < tries; t++) { setPos(b, t); if (!placeOk(C, L, b, bodies)) return true; } return false; };
  // 1. blocker across the direct line
  const bk = plan.blk, br = bk === 'R' ? RI(24, 30) : bk === 'H' ? RI(12, 16) : RI(50, 80);
  const blocker = bk === 'R' ? { kind: 'repulsor', r: br, mu: r3s(-R(0.9e7, 1.5e7)), x: 0, y: 0, orbit: null }
    : bk === 'H' ? { kind: 'blackhole', r: br, capture: RI(40, 50), mu: r3s(R(2.5e7, 4e7)), x: 0, y: 0, orbit: null }
    : { kind: 'planet', r: br, mu: r3s(R(plan.pf[0], plan.pf[1]) * br * br * br), x: 0, y: 0, orbit: null };
  if (!place(blocker, 60, b => { const [x, y] = along(R(0.32, 0.66), R(-0.35, 0.35) * (bk === 'P' ? br : 60)); b.x = ri(x); b.y = ri(y); })) return fail('blocker');
  bodies.push(blocker);
  // 2. extra solid bodies (moons and wormholes later)
  const exTok = plan.ex.filter(t => t !== 'M' && t !== 'W'), nMoons = plan.ex.filter(t => t === 'M').length;
  for (const tok of exTok) {
    let b;
    if (tok === 'P') { const r = RI(38, 64); b = { kind: 'planet', r, mu: r3s(R(plan.pf[0], plan.pf[1]) * r * r * r), x: 0, y: 0, orbit: null }; }
    else if (tok === 'R') { const r = RI(22, 30); b = { kind: 'repulsor', r, mu: r3s(-R(0.8e7, 1.4e7)), x: 0, y: 0, orbit: null }; }
    else { b = { kind: 'blackhole', r: RI(12, 16), capture: RI(38, 50), mu: r3s(R(2.5e7, 4e7)), x: 0, y: 0, orbit: null }; }
    if (!place(b, 120, (q, t) => { if (t < 80) { const [x, y] = along(R(0.2, 0.8), sgn() * R(110, 330)); q.x = ri(x); q.y = ri(y); } else { q.x = RI(90, 810); q.y = RI(T.y + 80, Pr.y - 180); } })) return fail('extra');
    bodies.push(b);
  }
  // 3. pulsars beside the corridor
  for (const pp of plan.pul || []) {
    const r = RI(10, 15), b = { kind: 'pulsar', r, mu: r3s(R(0.8e7, 2.2e7)), x: 0, y: 0, orbit: null,
      beam: { omega: rnd3(sgn() * R(pp.w[0], pp.w[1])), phase: rnd3(R(0, TAU)), half: rnd3(R(0.07, 0.12)), reach: RI(pp.reach[0], pp.reach[1]), push: RI(pp.push[0], pp.push[1]) } };
    if (!place(b, 120, (q, t) => { const [x, y] = along(R(0.25, 0.75), sgn() * R(70, 260)); q.x = ri(x); q.y = ri(y); })) return fail('pulsar');
    if (Math.hypot(b.x - Pr.x, b.y - Pr.y) < 230) return fail('pulsarprobe');
    bodies.push(b);
  }
  // 4. moons round planets / black holes / pulsars
  for (let q = 0; q < nMoons; q++) {
    const pars = bodies.filter(o => !o.orbit && (o.kind === 'planet' || o.kind === 'blackhole' || o.kind === 'pulsar'));
    if (!pars.length) return fail('moonpar');
    let ok = false;
    for (let t = 0; t < 80 && !ok; t++) {
      const par = pick(pars), r = RI(12, 22);
      const b = { kind: 'moon', r, mu: r3s(60 * r * r * r), orbit: { cx: par.x, cy: par.y, rad: ri(C.reff(par) + Math.max(50, r + 34) + R(0, 60)), omega: rnd3(sgn() * R(0.5, 1.4)), phase: rnd3(R(0, TAU)) } };
      if (!placeOk(C, L, b, bodies)) { bodies.push(b); ok = true; }
    }
    if (!ok) return fail('moon');
  }
  // 5. nebulae
  for (const nb of plan.neb || []) {
    const r = RI(nb.r[0], nb.r[1]), b = { kind: 'nebula', r, mu: 0, x: 0, y: 0, orbit: null, drag: rnd3(R(nb.d[0], nb.d[1])) };
    const planets = bodies.filter(o => o.kind === 'planet' && !o.orbit);
    const setPos = (q, t) => {
      let x, y;
      const mode = nb.mode === 'any' ? pick(['across', 'probe', 'target', 'probe', 'target', 'side']) : nb.mode;
      if (mode === 'wrap' && planets.length) { const p = pick(planets), an = R(0, TAU), d = R(0, 0.45) * r; x = p.x + Math.cos(an) * d; y = p.y + Math.sin(an) * d; }
      else if (mode === 'across') [x, y] = along(R(0.3, 0.7), R(-0.5, 0.5) * r);
      else if (mode === 'probe') { const d = r + R(75, 140), an = Math.atan2(uy, ux) + R(-0.5, 0.5); x = Pr.x + Math.cos(an) * d; y = Pr.y + Math.sin(an) * d; }   // the way out
      else if (mode === 'target') { const d = T.r + r + R(35, 110), an = Math.atan2(-uy, -ux) + R(-0.9, 0.9); x = T.x + Math.cos(an) * d; y = T.y + Math.sin(an) * d; }   // the way in
      else [x, y] = along(R(0.22, 0.78), sgn() * (r + R(-20, 160)));
      if (nb.rails) { const rad = RI(32, 56), om = rnd3(sgn() * R(0.2, 0.45)), ph = rnd3(R(0, TAU)); q.orbit = { cx: ri(x), cy: ri(y), rad, omega: om, phase: ph }; q.x = ri(x + rad * Math.cos(ph)); q.y = ri(y + rad * Math.sin(ph)); }
      else { q.x = ri(x); q.y = ri(y); }
    };
    if (!place(b, 80, setPos)) return fail('nebula');
    bodies.push(b);
  }
  // 6. a wormhole pair (Volumes IV/V tier E): mouth A low on the plate, mouth B high, no turn or +-45/90, Volume III author rules
  if (plan.ex.includes('W')) {
    const turn = pick([0, 0, PI / 4, -PI / 4, PI / 2, -PI / 2]);
    const A = { kind: 'wormhole', r: RI(26, 32), mu: 0, x: 0, y: 0, orbit: null, pair: -1, turn }, B = { kind: 'wormhole', r: RI(26, 32), mu: 0, x: 0, y: 0, orbit: null, pair: -1, turn: -turn };
    if (!place(A, 80, q => { q.x = RI(100, 800); q.y = RI((Pr.y + T.y) / 2, Pr.y - 150); })) return fail('mouthA');
    bodies.push(A);
    if (!place(B, 80, q => { q.x = RI(100, 800); q.y = RI(T.y - 80, (Pr.y + T.y) / 2 + 60); })) return fail('mouthB');
    bodies.push(B);
    if (Math.hypot(A.x - B.x, A.y - B.y) < 220) return fail('twin');
    for (const m of [A, B]) if (m.x < 76 || m.x > 824 || m.y < 76 || m.y > 1524) return fail('mouthbox');
  }
  // body order: nebulae first (drawn under everything), then the rest; wormhole pair links by final index
  const order = bodies.filter(isNeb).concat(bodies.filter(b => !isNeb(b)));
  const wi = []; order.forEach((b, q) => { if (b.kind === 'wormhole') wi.push(q); });
  if (wi.length === 2) { order[wi[0]].pair = wi[1]; order[wi[1]].pair = wi[0]; }
  L.bodies = order;
  if (L.bodies.length > 11) return fail('count');
  return L;
}

/* ---------- candidate evaluation ---------- */
function evaluate(C, idx, seed, log) {
  const { g, K, P } = C, plan = PLAN[idx - V4], m = ratioTarget(idx), rej = log.rejected;
  const L = layout(C, plan, idx, seed);
  if (!L) { rej.layout++; return null; }
  const td = timeDep(L), use = C.usesOf(L);
  if (!C.straightAll(L)) { rej.straight++; return null; }
  const quick = C.scan(L, 0, 6);
  if (quick.ratio < m / (BAND * 1.6) || quick.ratio > m * BAND * 1.6) { rej.band++; return null; }
  if (quick.hits && quick.avoid / quick.hits > AVSHARE * 1.5) { rej.avoid++; log.avShare = (log.avShare || 0) + 1; return null; }
  const G0 = C.scan(L, 0, 1);
  if (G0.ratio < m / BAND || G0.ratio > m * BAND) { rej.band++; return null; }
  if (G0.avoid / G0.hits > AVSHARE) { rej.avoid++; log.avShare = (log.avShare || 0) + 1; return null; }
  const cand = [];
  for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) if (G0.U[k * NP + j]) { const s = C.hood(G0.U, k, j); if (s >= 9) cand.push([s, k, j]); }
  if (!cand.length) { rej.robust++; return null; }
  const j0 = 12 + Math.floor(C.G.Levels.mulberry32(seed ^ 0x51ed)() * 20);
  cand.sort((a, b) => b[0] - a[0] || Math.abs(a[2] - j0) - Math.abs(b[2] - j0));
  if (C.worstAvoid(L, G0, 0, AVLIM, AVPRE) >= AVLIM) { rej.avoid++; log.avRobust = (log.avRobust || 0) + 1; return null; }
  const abl = C.ablate(L);
  // solution candidates at t0 = 0: rounded to 3 decimals, re-verified, robust with every neighbour using the mechanic, needs the mechanic
  const sols = [];
  for (let q = 0; q < Math.min(cand.length, 200) && sols.length < 5; q++) {
    const [hd, k, j] = cand[q], a = k * 0.5, p = PWR(j), v = g.launch(a, p), vx = rnd3(v.vx), vy = rnd3(v.vy);
    if (sols.some(s => Math.abs(s.a - a) < 2 && Math.abs(s.p - p) < 0.1)) continue;
    const ra = Math.atan2(vy, vx) / DEG, rp = Math.hypot(vx, vy) / K.VMAX;
    const s0 = P.simulate(L, vx, vy, 0, K.MAX_STEPS); if (s0.status !== 'hit' || !use(s0) || (L._needWarp && s0.warps < 1)) continue;
    if (L._vol === 4 && P.simulate(abl, vx, vy, 0, K.MAX_STEPS).status === 'hit') { rej.ablate = (rej.ablate || 0) + 1; continue; }
    if (C.robustU(L, ra, rp, 0, 8) < 8) { log.solRob = (log.solRob || 0) + 1; continue; }
    const clear = C.exitsClear(L, ra, rp, 0); if (clear < 31) continue;
    sols.push({ k, j, a, p, vx, vy, hood: hd, fog: s0.fog, beams: s0.beams, warps: s0.warps, t0: 0 });
  }
  if (!sols.length) { rej.sol++; return null; }
  const nf = 2 + (seed % 3 === 0 ? 1 : 0), fr2 = log.fr || (log.fr = { alts: 0, place: 0, verify: 0 });
  const rngF = C.G.Levels.mulberry32(seed ^ 0x2545F491), rngS = C.G.Levels.mulberry32(seed ^ 0x7f4a7c15);
  const comp = components(G0.H);
  for (const sol0 of sols) {
    let sol = sol0, tInfo = 'static';
    if (td) {
      const tp = C.timing(L, [{ a: sol0.a, p: sol0.p }], true);
      if (process.env.BAKE_DEBUG) console.error('timing', tp.frac.toFixed(2), tp.gap, tp.open.join(''));
      if (!tp.ok) { rej.timing++; continue; }
      const ks = []; tp.open.forEach((o, k) => { if (o && k >= 2) ks.push(k); });
      let chosen = null;
      for (let tries = 0; tries < 12 && !chosen; tries++) {
        const k = ks[Math.floor(rngS() * ks.length)], sh = tp.shots[k], off = tries < 8 ? Math.floor(rngS() * 60) : 0, t0 = k * 60 + off;
        const v = g.launch(sh.a, sh.p), vx = rnd3(v.vx), vy = rnd3(v.vy), ra = Math.atan2(vy, vx) / DEG, rp = Math.hypot(vx, vy) / K.VMAX;
        if (C.robustU(L, ra, rp, t0, 8) < 8) continue;
        const s0 = P.simulate(L, vx, vy, t0, K.MAX_STEPS); if (s0.status !== 'hit' || !use(s0) || (L._needWarp && s0.warps < 1)) continue;
        if (L._vol === 4 && P.simulate(abl, vx, vy, t0, K.MAX_STEPS).status === 'hit') continue;
        if (C.exitsClear(L, ra, rp, t0) < 31) continue;
        chosen = { k: sol0.k, j: sol0.j, a: sh.a, p: sh.p, vx, vy, hood: sol0.hood, fog: s0.fog, beams: s0.beams, warps: s0.warps, t0 };
      }
      if (!chosen) chosen = Object.assign({}, sol0, { t0: 0 });   // the t = 0 solution already passed every rule
      let avBad = false;
      for (const t0 of AV_T0S(chosen.t0, L._vol)) { const Gt = C.scan(L, t0, 1); if (Gt.avoid / Math.max(1, Gt.hits) > AVSHARE || C.worstAvoid(L, Gt, t0, AVLIM, AVPRE) >= AVLIM) { avBad = true; break; } }
      if (avBad) { rej.avoid++; continue; }
      sol = chosen; tInfo = (100 * tp.frac).toFixed(0) + '% gap ' + tp.gap + 's @' + chosen.t0;
    }
    L.solution = { vx: sol.vx, vy: sol.vy, t0Step: sol.t0 };
    // fragments on a different hit path, preferably one that also uses the mechanic (the full-clear search below insists that the most
    // forgiving full-clear launch uses it)
    const alts = [];
    for (let k = 0; k < NA; k++) for (let j = 3; j < NP; j++) {
      const q = k * NP + j; if (!G0.H[q]) continue;
      const other = comp.lab[q] !== comp.lab[sol0.k * NP + sol0.j], far = Math.min(Math.abs(k - sol0.k), NA - Math.abs(k - sol0.k)) >= (td ? 4 : 8) || Math.abs(j - sol0.j) >= (td ? 4 : 7);
      const h = C.hood(G0.H, k, j); if (h < 7) continue;
      const u = G0.U[q] ? 0 : 2;
      if (other && comp.sizes[comp.lab[q]] >= 3) alts.push([u, comp.sizes[comp.lab[q]] + h, k, j]); else if (!other && far) alts.push([u + 1, h, k, j]);
    }
    alts.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    if (process.env.BAKE_DEBUG) console.error('alts', alts.length, 'hits', G0.hits, 'comps', comp.sizes.length, 'sol0', sol0.k, sol0.j, 'td', td);
    let tried = 0; const triedAlts = [];
    fr2.alts += alts.length ? 1 : 0;
    for (let q = 0; q < alts.length && tried < 25; q++) {
      const [kind, , k, j] = alts[q], a = k * 0.5, p = PWR(j), va = g.launch(a, p), vax = rnd3(va.vx), vay = rnd3(va.vy);
      if (triedAlts.some(t => Math.min(Math.abs(t[0] - k), NA - Math.abs(t[0] - k)) < 6 && Math.abs(t[1] - j) < 3)) continue;
      triedAlts.push([k, j]); tried++;
      const fr = placeFrags(C, L, nf, { vx: vax, vy: vay }, L.solution, rngF);
      if (!fr) { fr2.place++; continue; }
      L.frags = fr;
      const fs2 = P.simulate(L, vax, vay, 0, K.MAX_STEPS), ss = P.simulate(L, sol.vx, sol.vy, sol.t0, K.MAX_STEPS);
      if (fs2.status !== 'hit' || Array.from(fs2.collected).some(c => !c) || ss.status !== 'hit' || Array.from(ss.collected).some(c => c)) { fr2.verify++; continue; }
      const cs = C.clearSearch(L);
      if (cs.fullHits < 6 || cs.robust < 12 || cs.at0 < 3 || !cs.bestUse || cs.avBest * 2 > cs.top) { log.clearFail = (log.clearFail || 0) + 1; continue; }
      const bf = C.bestFull0(L);
      if (!bf.best || bf.best.nbr < 4 || bf.best.n81 < 12) { log.clearFail = (log.clearFail || 0) + 1; continue; }
      L.fragSolution = { vx: bf.best.vx, vy: bf.best.vy, t0Step: 0 };
      return { L, stats: { idx, seed, ratio: G0.ratio, target: m, avoid: G0.avoid / G0.hits, hood: sol.hood, fog: sol.fog, beams: sol.beams, warps: sol.warps, timing: tInfo,
        fragInfo: (kind ? 'same-cl ' : 'other-cl ') + a.toFixed(1) + '/' + p.toFixed(3), clearSearch: cs, frags: nf } };
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
// fragments on the alternative path, at least SEP from every point of the stored solution's path (it must collect none)
const SEP = 48;
const _A = new Float32Array(2 * 1200), _S = new Float32Array(2 * 1200);
function placeFrags(C, L, n, alt, sol, rng) {
  const { K, P, g } = C, sa = P.simulate(L, alt.vx, alt.vy, 0, K.MAX_STEPS, _A), ss = P.simulate(L, sol.vx, sol.vy, sol.t0Step | 0, K.MAX_STEPS, _S);
  if (sa.status !== 'hit') return null;
  const lo = Math.floor(sa.n * 0.12), hi = Math.floor(sa.n * 0.88), seg = (hi - lo) / n, out = [];
  for (let f = 0; f < n; f++) {
    let found = null;
    for (let tries = 0; tries < 50 && !found; tries++) {
      const s = Math.floor(lo + seg * (f + rng())); if (s >= sa.n) continue;
      const ang = rng() * 2 * PI, rr = rng() * 8, x = ri(_A[2 * s] + Math.cos(ang) * rr), y = ri(_A[2 * s + 1] + Math.sin(ang) * rr);
      if (x < 40 || x > 860 || y < 40 || y > 1560) continue;
      let ok = true, i;
      for (i = 0; i < L.bodies.length && ok; i++) { const b = L.bodies[i]; if (!isNeb(b) && g.pointGap(b, x, y) < (b.kind === 'wormhole' ? 30 : 22)) ok = false; }
      if (!ok) continue;
      if (Math.hypot(x - L.probe.x, y - L.probe.y) < 120 || Math.hypot(x - L.target.x, y - L.target.y) < L.target.r + 60) continue;
      for (i = 0; i < out.length && ok; i++) if (Math.hypot(x - out[i].x, y - out[i].y) < 130) ok = false;
      for (i = 0; i < ss.n && ok; i += 2) { const dx = _S[2 * i] - x, dy = _S[2 * i + 1] - y; if (dx * dx + dy * dy < SEP * SEP) ok = false; }
      if (ok) found = { x, y };
    }
    if (!found) return null;
    out.push(found);
  }
  return out;
}

const newLog = () => ({ rejected: { layout: 0, straight: 0, band: 0, avoid: 0, robust: 0, sol: 0, timing: 0, frags: 0 } });
function bakeOne(G, C, idx, maxTries) {
  const log = newLog(), base = 91000 + 97 * idx + (+process.env.LEVELS_SALT || 0);
  for (let r = 0; r < (maxTries || +(process.env.LEVELS_TRIES || 3000)); r++) {
    const seed = base + 1000 * r;
    if (r % 100 === 99) { try { fs.appendFileSync(path.join(CACHE, 'v45-progress.log'), '[' + (idx + 1) + '] ' + (r + 1) + ' seeds ' + JSON.stringify(log.rejected) + ' why ' + JSON.stringify(C.why) + ' clearFail ' + (log.clearFail || 0) + '\n'); } catch (e) {} }
    const res = evaluate(C, idx, seed, log);
    if (res) { res.stats.tries = r + 1; res.L.seed = seed; return { level: res.L, stats: res.stats, log }; }
  }
  return { level: null, stats: { idx }, log };
}

/* ---------- module writing (same literal format as the other bakers) ---------- */
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
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const LINE_RE = /^    \{id:"c(\d{2,3})"/;
function campaignLines(src) {
  const a = src.indexOf('/*@CAMPAIGN*/'), b = src.indexOf('/*@END*/');
  if (a < 0 || b < 0) throw new Error('markers missing');
  return src.slice(a, b).split('\n').filter(l => LINE_RE.test(l));
}
// pins for Volume III (lines3); written once, then only checked
function pins() {
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')), lines = campaignLines(fs.readFileSync(LEVELS, 'utf8'));
  if (!gold.lines3) {
    if (lines.length < NOLD) throw new Error('need the 90 older lines to pin Volume III');
    const out = {}; for (const k of Object.keys(gold)) { out[k] = gold[k]; if (k === 'lines2') { out.lines3_about = 'sha256 of the exact text of CAMPAIGN lines 61-90 (Volume III) in src/20-levels.js, pinned when Volumes IV and V were added. Never change them.'; out.lines3 = lines.slice(60, 90).map(sha); } }
    fs.writeFileSync(GOLDEN, JSON.stringify(out, null, 1)); return out;
  }
  return gold;
}
// Appends Volume IV and Volume V (two .concat blocks) after the 90 older lines, which stay byte-identical (checked against the pins).
function writeModule(levels) {
  const src = fs.readFileSync(LEVELS, 'utf8'), a = src.indexOf('/*@CAMPAIGN*/'), b = src.indexOf('/*@END*/'), gold = pins();
  const lines = campaignLines(src);
  if (lines.length < NOLD || levels.length !== NALL - NOLD) throw new Error('need the 90 older lines + 60 new plates');
  lines.slice(0, 30).forEach((l, i) => { if (sha(l) !== gold.lines[i]) throw new Error('Volume I plate ' + (i + 1) + ' differs from the pin; refusing to write'); });
  lines.slice(30, 60).forEach((l, i) => { if (sha(l) !== gold.lines2[i]) throw new Error('Volume II plate ' + (i + 31) + ' differs from the pin; refusing to write'); });
  lines.slice(60, 90).forEach((l, i) => { if (sha(l) !== gold.lines3[i]) throw new Error('Volume III plate ' + (i + 61) + ' differs from the pin; refusing to write'); });
  const sec = src.slice(a, b).split('\n'); let n = 0, cut = -1;
  sec.forEach((l, i) => { if (LINE_RE.test(l) && ++n === NOLD) cut = i; });
  const block = arr => '.concat([\n' + arr.map(l => '    ' + lit(l)).join(',\n') + '\n  ])';
  const head = sec.slice(0, cut + 1).join('\n') + '\n  ])' + block(levels.slice(0, 30)) + block(levels.slice(30)) + ';';
  let out = src.slice(0, a) + head + src.slice(b);
  const old3 = "{ name: 'Volume III', from: 60, to: 89 }]", new5 = "{ name: 'Volume III', from: 60, to: 89 },\n    { name: 'Volume IV', from: 90, to: 119 }, { name: 'Volume V', from: 120, to: 149 }]";
  if (!out.includes("'Volume IV'")) { if (!out.includes(old3)) throw new Error('VOLUMES literal not found'); out = out.replace(old3, new5); }
  fs.writeFileSync(LEVELS, out);
}

/* ---------- verification ---------- */
const tierOf = i => 'ABCDE'[Math.floor(((i < V5 ? i - V4 : i - V5)) / 6)];
function verifyPlates(G, C, list) {
  const { g, K, P } = C, CAMP = G.Levels.CAMPAIGN, rows = [], msgs = []; let ok = true;
  const allNames = new Set(); CAMP.forEach((l, i) => { if (!list.includes(i)) allNames.add(l.name); });
  for (const i of list) {
    const L = CAMP[i], plan = PLAN[i - V4], probs = [], s = L.solution, td = timeDep(L), m = ratioTarget(i), vol = volOf(i);
    Object.defineProperty(L, '_vol', { value: vol, enumerable: false, writable: true, configurable: true });
    Object.defineProperty(L, '_needWarp', { value: plan.ex.includes('W'), enumerable: false, writable: true, configurable: true });
    const use = C.usesOf(L), nebs = L.bodies.filter(isNeb), puls = L.bodies.filter(b => b.kind === 'pulsar'), whs = L.bodies.map((b, q) => b.kind === 'wormhole' ? q : -1).filter(q => q >= 0);
    if (!s || !Number.isInteger(s.t0Step) || s.t0Step < 0 || (!td && s.t0Step !== 0)) probs.push('solution t0Step ' + (s && s.t0Step));
    if (L.index !== i || L.plate !== G.toRoman(i + 1) || L.id !== 'c' + String(i + 1).padStart(2, '0')) probs.push('index/plate/id');
    if (allNames.has(L.name) || L.name !== nameOf(i)) probs.push('name'); allNames.add(L.name);
    if (Math.abs(L.difficulty - diffOf(i)) > 0.0006) probs.push('difficulty field');
    if (L.target.r !== plan.tr) probs.push('target r ' + L.target.r);
    if (L.frags.length < 2 || L.frags.length > 3) probs.push(L.frags.length + ' frags');
    if (L.bodies.length > 11) probs.push(L.bodies.length + ' bodies');
    // the volume's mechanic and the plan's shape
    if (nebs.length !== (plan.neb || []).length) probs.push('nebula count ' + nebs.length);
    if (puls.length !== (plan.pul || []).length) probs.push('pulsar count ' + puls.length);
    for (const b of nebs) if (b.mu !== 0 || b.r < 60 || b.r > 170 || !(b.drag >= 0.3 && b.drag <= 1.4)) probs.push('nebula fields');
    for (const b of puls) { const bm = b.beam; if (!bm || b.r < 10 || b.r > 16 || !(b.mu > 0) || b.orbit || !(Math.abs(bm.omega) >= 0.3 && Math.abs(bm.omega) <= 1.1) || !(bm.half >= 0.06 && bm.half <= 0.16) || bm.reach < 260 || bm.reach > 560 || bm.push < 500 || bm.push > 1600) probs.push('pulsar fields'); }
    if (whs.length !== (plan.ex.includes('W') ? 2 : 0)) probs.push('wormhole count ' + whs.length);
    for (const q of whs) { const b = L.bodies[q], tw = L.bodies[b.pair];
      if (!tw || tw.kind !== 'wormhole' || tw.pair !== q) probs.push('pair link ' + q);
      else { if (b.r < 24 || b.r > 38 || b.mu !== 0) probs.push('mouth r/mu'); if (Math.abs(b.turn / (PI / 4) - Math.round(b.turn / (PI / 4))) > 1e-9 || Math.abs(b.turn + tw.turn) > 1e-9) probs.push('turn'); if (q < b.pair && C.twinDist(L, q) < 150) probs.push('twin distance'); } }
    if (vol === 4 && tierOf(i) === 'D' && !nebs.some(b => b.orbit)) probs.push('tier D: a nebula on rails');
    // solution: hits, uses the mechanic (with every robust neighbour), needs it, collects no fragment
    const t0s = s.t0Step | 0, sim = P.simulate(L, s.vx, s.vy, t0s, K.MAX_STEPS), sa = Math.atan2(s.vy, s.vx) / DEG, sp = Math.hypot(s.vx, s.vy) / K.VMAX;
    if (sim.status !== 'hit') probs.push('solution ' + sim.status);
    if (L._needWarp && sim.warps < 1) probs.push('solution does not warp');
    if (!use(sim)) probs.push('solution does not use the mechanic (fog ' + sim.fog + ', beams ' + sim.beams + ', warps ' + sim.warps + ')');
    if (vol === 4 && P.simulate(C.ablate(L), s.vx, s.vy, t0s, K.MAX_STEPS).status === 'hit') probs.push('solution still hits without the nebula');
    for (let q = 0; q < L.frags.length; q++) if (sim.collected[q]) probs.push('solution collects frag ' + q);
    const rob = C.robustU(L, sa, sp, t0s, 8); if (rob < 8) probs.push('solution not robust (' + rob + ')');
    if (g.robust(L, sa, sp, t0s) < 8) probs.push('g.robust < 8');
    if (!C.straightAll(L)) probs.push('straight shot hits (some launch time)');
    const clear = C.exitsClear(L, sa, sp, t0s); if (clear < 30) probs.push('exit clearance ' + clear.toFixed(1));
    // clearances and overlaps
    for (let a = 0; a < L.bodies.length; a++) { const w = placeOk(C, L, L.bodies[a], L.bodies.slice(0, a)); if (w) probs.push('placement ' + a + ' ' + w); }
    { const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
      for (let t = 0; t < 60 && td; t += 0.02) for (let a = 0; a < L.bodies.length; a++) {
        const A = L.bodies[a]; P.bodyPos(A, t, pa); const ea = C.reff(A);
        if (pa.x - ea < 40 || pa.x + ea > 860 || pa.y - ea < 40 || pa.y + ea > 1560) { probs.push('out of world t=' + t.toFixed(2)); t = 99; break; }
        for (let b = a + 1; b < L.bodies.length; b++) { const B = L.bodies[b]; if (isNeb(A) !== isNeb(B) && A.kind !== 'wormhole' && B.kind !== 'wormhole') continue; P.bodyPos(B, t, pb); if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < ea + C.reff(B)) { probs.push('overlap t=' + t.toFixed(2)); t = 99; break; } }
      } }
    for (const f of L.frags) { if (f.x < 40 || f.x > 860 || f.y < 40 || f.y > 1560) probs.push('fragment outside'); for (const b of L.bodies) if (!isNeb(b) && g.pointGap(b, f.x, f.y) < 22) probs.push('fragment too close to a body'); }
    // full grid at t0 = 0: hit ratio, the mechanic cannot be avoided, full-clear shots
    const G0 = C.scan(L, 0, 1); let full = 0, fullNear = 0;
    const fsol = L.fragSolution, fsim = fsol && P.simulate(L, fsol.vx, fsol.vy, 0, K.MAX_STEPS);
    if (!fsim || fsim.status !== 'hit' || Array.from(fsim.collected).some(c => !c)) probs.push('fragSolution does not hit and collect every fragment');
    else {
      const fa = Math.atan2(fsol.vy, fsol.vx) / DEG, fp = Math.hypot(fsol.vx, fsol.vy) / K.VMAX; let n81 = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const q = C.fly(L, fa + a, clampP(fp + 0.03 * b), 0); if (q.status === 'hit' && q.collected.every(c => c)) fullNear++; }
      for (let da = -1; da <= 1.001; da += 0.25) for (let dp = -0.05; dp <= 0.0501; dp += 0.0125) { const q = C.fly(L, fa + da, clampP(fp + dp), 0); if (q.status === 'hit' && q.collected.every(c => c)) n81++; }
      if (n81 < 12) probs.push('fragSolution tolerance ' + n81 + '/81');
      for (let k = 0; k < NA; k++) for (let j = 0; j < NP; j++) if (G0.H[k * NP + j]) { const q = C.fly(L, k * 0.5, PWR(j), 0); if (q.collected.every(c => c)) full++; }
      if (full < 6) probs.push('only ' + full + ' full-clear shots at t0 = 0');
    }
    const av = C.worstAvoid(L, G0, 0, AVLIM, AVPRE); if (av >= AVLIM) probs.push('a shot that avoids the mechanic has ' + av + '/9 hit neighbours');
    if (G0.avoid / G0.hits > AVSHARE) probs.push('avoiding hits are ' + (100 * G0.avoid / G0.hits).toFixed(0) + '% of hits');
    if (G0.ratio < m / (BAND * 1.1) || G0.ratio > m * BAND * 1.1) probs.push('hit ratio ' + (100 * G0.ratio).toFixed(2) + '% vs target ' + (100 * m).toFixed(2) + '%');
    let tt = 'static', frac = 1, gap = 0;
    if (td) {
      const tp = C.timing(L, [{ a: sa, p: sp }], false); frac = tp.frac; gap = tp.gap;
      if (tp.frac < 0.7) probs.push('open at only ' + (100 * tp.frac).toFixed(0) + '% of launch times');
      if (tp.gap > 2.5) probs.push('launch-time gap ' + tp.gap + ' s');
      for (const t0 of AV_T0S(t0s, vol)) { const Gt = C.scan(L, t0, 1), w = C.worstAvoid(L, Gt, t0, AVLIM, AVPRE); if (w >= AVLIM || Gt.avoid / Math.max(1, Gt.hits) > AVSHARE) probs.push('the mechanic can be avoided at t0=' + t0); }
      tt = (100 * tp.frac).toFixed(0) + '% gap ' + tp.gap + 's @' + t0s;
    }
    if (probs.length) { ok = false; msgs.push('L' + (i + 1) + ' ' + L.name + ': ' + probs.join('; ')); }
    rows.push({ i: i + 1, name: L.name, d: L.difficulty, kinds: L.bodies.map(b => b.kind[0] + (b.orbit ? '~' : '')).join(''), timing: tt, open: frac, gap,
      use: vol === 4 ? 'fog ' + (sim.fog / 120).toFixed(2) + 's' : 'beams ' + sim.beams, warps: sim.warps, robust: rob, frags: L.frags.length, full, fullNear,
      ratio: (100 * G0.ratio).toFixed(2) + '%', avoid: (100 * G0.avoid / G0.hits).toFixed(0) + '%', r: L.target.r });
  }
  return { ok, rows, msgs };
}
function printRows(rows) {
  console.log('plate name                          d     bodies       timing                use         warps rob frags fullclear        ratio avoid  r');
  for (const r of rows.sort((a, b) => a.i - b.i)) console.log(String(r.i).padStart(5), r.name.padEnd(30), String(r.d).padEnd(5), r.kinds.padEnd(12), r.timing.padEnd(21), r.use.padEnd(11), String(r.warps).padStart(5), String(r.robust).padStart(4), String(r.frags).padStart(5), (' ' + r.full + ' (nbr ' + r.fullNear + '/9)').padEnd(17), r.ratio.padStart(6), r.avoid.padStart(5), String(r.r).padStart(3));
}
// Pins + structure (cheap), then the plates in worker processes; returns a Promise<boolean>. Used by levels-bake.js --verify.
function verify45(nWorkers) {
  const G = loadFast(), CAMP = G.Levels.CAMPAIGN; let ok = true;
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')), lines = campaignLines(fs.readFileSync(LEVELS, 'utf8'));
  if (lines.length !== NALL || CAMP.length !== NALL) { console.log('CAMPAIGN has', lines.length, 'literal lines /', CAMP.length, 'plates (want 150)'); ok = false; }
  if (!gold.lines3 || gold.lines3.length !== 30) { console.log('tools/levels-golden.json has no lines3 pins'); ok = false; }
  else for (let i = 60; i < 90; i++) if (!lines[i] || sha(lines[i]) !== gold.lines3[i - 60]) { console.log('L' + (i + 1), 'FROZEN PLATE CHANGED (Volume III)'); ok = false; }
  const V = G.Levels.VOLUMES;
  if (!V || V.length !== 5 || V[3].name !== 'Volume IV' || V[3].from !== 90 || V[3].to !== 119 || V[4].name !== 'Volume V' || V[4].from !== 120 || V[4].to !== 149) { console.log('VOLUMES wrong'); ok = false; }
  if (!ok) return Promise.resolve(false);
  const idx = Array.from({ length: NALL - NOLD }, (_, q) => q + NOLD), nw = nWorkers || 3, groups = Array.from({ length: nw }, () => []);
  idx.forEach((i, q) => groups[q % nw].push(i));
  return Promise.all(groups.map(gr => new Promise((res, rej) => cp.execFile(process.execPath, [__filename, '--verify-worker', gr.join(',')], { maxBuffer: 1 << 26 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(JSON.parse(so)))))).then(rs => {
    const rows = [].concat(...rs.map(r => r.rows)), msgs = [].concat(...rs.map(r => r.msgs)); msgs.sort().forEach(m => console.log(m));
    printRows(rows);
    const mv = rows.filter(r => r.timing !== 'static');
    if (mv.length) console.log('launch-time windows: ' + mv.length + ' time-dependent plates; worst open fraction ' + (100 * Math.min(...mv.map(r => r.open))).toFixed(0) + '%, longest closed gap ' + Math.max(...mv.map(r => r.gap)) + ' s');
    const okAll = rs.every(r => r.ok);
    console.log(okAll ? 'verify45: all 60 Volume IV and V plates OK (solutions hit, use their nebula / pulsar beam with every robust neighbour, miss without it, robust 8/9, the mechanic cannot be avoided by a strong shot (all tested launch times), straight shots miss, clearances hold, 2-3 fragments with a full-clear course, time-dependent plates keep the launch-time window rule)' : 'verify45: FAILED');
    return okAll;
  });
}

/* ---------- main ---------- */
const cacheFile = i => path.join(CACHE, 'v45-c' + String(i + 1).padStart(3, '0') + '.json');
function table(rows) {
  console.log('idx name                           seed     try  ratio  tgt%  avoid  use          timing                frag-path        full-clear(hits/robust81/at0)');
  for (const s of rows) {
    if (!s.seed) { console.log(String(s.idx).padStart(3), 'FAILED'); continue; }
    console.log(String(s.idx).padStart(3), (s.name || '').padEnd(30), String(s.seed).padEnd(8), String(s.tries).padStart(4), (100 * s.ratio).toFixed(2).padStart(6), (100 * s.target).toFixed(2).padStart(5), (100 * s.avoid).toFixed(0).padStart(5) + '%', ('fog ' + s.fog + ' b ' + s.beams + ' w ' + s.warps).padEnd(12), (s.timing || '').padEnd(21), ('  ' + s.fragInfo).padEnd(16), s.clearSearch.fullHits + '/' + s.clearSearch.robust + '/' + s.clearSearch.at0);
  }
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--worker') {
    const G = loadFast(), C = makeCtx(G);
    const out = argv[1].split(',').map(Number).map(i => { const r = bakeOne(G, C, i); if (r.stats.seed) r.stats.name = r.level.name; r.why = C.why; return r; });
    process.stdout.write(JSON.stringify(out));
  } else if (argv[0] === '--verify-worker') {
    const G = loadFast(), C = makeCtx(G); process.stdout.write(JSON.stringify(verifyPlates(G, C, argv[1].split(',').map(Number))));
  } else if (argv[0] === '--verify') {
    verify45(+(process.env.LEVELS_JOBS || 3)).then(ok => process.exit(ok ? 0 : 1)).catch(e => { console.error(e); process.exit(1); });
  } else if (argv[0] === '--try') {
    const G = loadFast(), C = makeCtx(G), idx = +argv[1], n = +argv[2] || 100, log = newLog(), t = Date.now(); let got = 0;
    for (let r = 0; r < n; r++) { const res = evaluate(C, idx, 91000 + 97 * idx + 1000 * r, log); if (res) { got++; if (got <= 3) console.log('ok seed', res.L.seed, JSON.stringify(res.stats)); } }
    console.log('plate', idx + 1, JSON.stringify(log), 'why', JSON.stringify(C.why), got, 'found', ((Date.now() - t) / 1000).toFixed(1) + 's');
  } else if (argv[0] === '--assemble') {
    const lv = []; for (let i = NOLD; i < NALL; i++) { if (!fs.existsSync(cacheFile(i))) { console.log('missing cache for index', i); process.exit(1); } lv.push(JSON.parse(fs.readFileSync(cacheFile(i), 'utf8')).level); }
    writeModule(lv); console.log('wrote', path.relative(ROOT, LEVELS), (fs.statSync(LEVELS).size / 1024).toFixed(1) + ' KB');
  } else {
    const only = argv[0] === '--only' ? argv[1].split(',').map(Number) : argv[0] === '--force' ? argv[1].split(',').map(Number) : null, force = argv[0] === '--force';
    fs.mkdirSync(CACHE, { recursive: true });
    const queue = (only || Array.from({ length: NALL - NOLD }, (_, q) => q + NOLD)).filter(i => (only && !force) || force || !fs.existsSync(cacheFile(i)));
    if (process.env.LEVELS_ORDER === 'desc') queue.reverse();
    if (queue.length) console.log('baking', queue.length, 'plates:', queue.join(','));
    const t = Date.now(), NW = Math.max(1, +(process.env.LEVELS_JOBS || 3)), results = [];
    const runOne = i => new Promise((res, rej) => {
      cp.execFile(process.execPath, [__filename, '--worker', String(i)], { maxBuffer: 1 << 26 }, (e, so, se) => {
        if (se) process.stderr.write(se.split('\n').slice(-3).join('\n'));
        if (e) return rej(new Error(se || e.message));
        const r = JSON.parse(so)[0];
        if ((!only || force) && r.level) fs.writeFileSync(cacheFile(i), JSON.stringify(r));
        console.log('plate', i + 1, r.level ? 'baked' : 'FAILED', 'after', ((Date.now() - t) / 1000).toFixed(0) + ' s', r.level ? 'try ' + r.stats.tries : JSON.stringify(r.log.rejected) + ' ' + JSON.stringify(r.why));
        res(r);
      });
    });
    const lane = async () => { while (queue.length) results.push(await runOne(queue.shift())); };
    Promise.all(Array.from({ length: NW }, lane)).then(() => {
      const all = results.sort((a, b) => a.stats.idx - b.stats.idx);
      if (all.length) table(all.map(r => r.stats));
      console.log('bake time', ((Date.now() - t) / 1000).toFixed(1) + ' s');
      if (only && !force) return;
      const lv = []; for (let i = NOLD; i < NALL; i++) { if (!fs.existsSync(cacheFile(i))) { console.log('NOT writing: plate', i + 1, 'has no bake yet'); process.exit(1); } lv.push(JSON.parse(fs.readFileSync(cacheFile(i), 'utf8')).level); }
      writeModule(lv); console.log('wrote', path.relative(ROOT, LEVELS), (fs.statSync(LEVELS).size / 1024).toFixed(1) + ' KB');
    }).catch(e => { console.error(e); process.exit(1); });
  }
}
module.exports = { PLAN, NAMES4, NAMES5, makeCtx, loadFast, layout, evaluate, bakeOne, verify45, verifyPlates, writeModule, lit, pins, placeOk };
