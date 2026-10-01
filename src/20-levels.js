/* PERIHELION — levels (owner: LEVEL AGENT).
   CAMPAIGN is baked offline by tools/levels-bake.js (same generator as generate() below, plus a brute-force
   angle x power solver); every baked number was verified AFTER rounding against the frozen Physics core.
   generate(seed, difficulty) builds Endless plates at runtime with a fast, budgeted solver; daily(dateKey) is a seeded generate().
   Plates 1-30 (Volume I) are frozen: players hold stars against them (tools/levels-golden.json pins their text).
   Plates 31-60 (Volume II) are baked the same way at difficulty 1.02..1.6 (recipe/build have a d > 1 branch; Endless never gets there). */
var Levels = (function () {
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  var NAMES = ['First Light', 'The Solitary Mass', 'Two Lanterns', 'Comet Dust', 'The Narrow Pass',
    'A Wandering Moon', 'Tidal Reach', 'The Retinue', 'Perturbation', 'The Binary',
    'Syzygy', 'The Dioscuri', 'Roche Limit', 'Event Horizon', 'The Dark Well',
    'Accretion', 'Hill Sphere', 'The Lagrange Gate', 'Precession', 'The Contrary Star',
    'Aphelion', 'Occultation', 'The Ecliptic', 'Libration', 'Conjunction',
    'The Orrery', 'Eccentric Anomaly', 'The Ascending Node', 'Harmony of the Spheres', 'Perihelion'];
  var SUFFIX = ['Minor', 'Major', 'Borealis', 'Australis', 'Secunda', 'Tertia', 'Nova', 'Obscura'];

  var TAU = Math.PI * 2, DEG = Math.PI / 180;
  var W = K.WORLD_W, H = K.WORLD_H, MARGIN = 40;
  function r3(x) { return Number(x.toPrecision(3)); }          // mu: 3 significant figures
  function d3(x) { return Math.round(x * 1000) / 1000; }        // phases / omegas: 3 decimals
  function ri(x) { return Math.round(x); }                      // coordinates, radii

  /* ---------- geometry: every body sweeps a disk (fixed) or an annulus (on rails) ---------- */
  function reff(b) { return b.kind === 'blackhole' ? b.capture : b.r; }
  // smallest distance between point (x,y) and the surface of anything body b can ever occupy
  function pointGap(b, x, y) {
    var o = b.orbit, e = reff(b);
    if (!o) return Math.sqrt((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y)) - e;
    var d = Math.sqrt((o.cx - x) * (o.cx - x) + (o.cy - y) * (o.cy - y));
    return Math.abs(d - o.rad) - e;
  }
  function sweep(b) { // outer swept disk {x,y,R}
    var o = b.orbit;
    return o ? { x: o.cx, y: o.cy, R: o.rad + reff(b) } : { x: b.x, y: b.y, R: reff(b) };
  }
  // conservative smallest surface gap between two bodies over all time
  function bodyGap(a, b) {
    var oa = a.orbit, ob = b.orbit, ea = reff(a), eb = reff(b);
    if (!oa && !ob) return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) - ea - eb;
    if (!oa) return pointGap(b, a.x, a.y) - ea;
    if (!ob) return pointGap(a, b.x, b.y) - eb;
    if (oa.cx === ob.cx && oa.cy === ob.cy) {
      if (oa.omega === ob.omega) { // rigid pair: constant separation
        var dx = oa.rad * Math.cos(oa.phase) - ob.rad * Math.cos(ob.phase), dy = oa.rad * Math.sin(oa.phase) - ob.rad * Math.sin(ob.phase);
        return Math.sqrt(dx * dx + dy * dy) - ea - eb;
      }
      return Math.abs(oa.rad - ob.rad) - ea - eb;
    }
    var sa = sweep(a), sb = sweep(b);
    return Math.sqrt((sa.x - sb.x) * (sa.x - sb.x) + (sa.y - sb.y) * (sa.y - sb.y)) - sa.R - sb.R;
  }
  function inWorld(b) { var s = sweep(b); return s.x - s.R >= MARGIN && s.x + s.R <= W - MARGIN && s.y - s.R >= MARGIN && s.y + s.R <= H - MARGIN; }

  /* ---------- recipe: which mechanics appear at a given difficulty ---------- */
  // tokens: P planet, M moon (rides a planet / black hole), B binary pair, H black hole, R repulsor
  function recipe(rng, d) {
    var i = Math.round(d * 29), t = [], j, n, pick;
    if (i >= 30) { // Volume II (difficulty > 1, campaign bake only): a blocking planet, a repulsor, then 2..5 more systems, moving ones favoured
      t = ['P', 'R']; n = 2 + Math.min(3, Math.floor((i - 30) / 5));
      var pool2 = ['M', 'B', 'H', 'M', 'B', 'P', 'M'];
      for (j = 0; j < n; j++) { pick = pool2[Math.floor(rng() * pool2.length)]; t.push(pick === 'H' && t.indexOf('H') >= 0 ? 'M' : pick); }
    } else if (i <= 1) t = ['P'];
    else if (i <= 4) t = (i === 3 && rng() < 0.5) ? ['P'] : ['P', 'P'];
    else if (i <= 8) { t = ['P', 'M']; if (i >= 7) t.push(rng() < 0.5 ? 'P' : 'M'); }
    else if (i <= 12) { t = ['B']; if (i >= 10) t.push('P'); if (i >= 12 || (i === 11 && rng() < 0.5)) t.push('M'); }
    else if (i <= 18) {
      t = ['H', 'P']; n = i >= 16 ? 2 : (i >= 14 ? 1 : 0);
      for (j = 0; j < n; j++) { pick = rng(); t.push(pick < 0.4 ? 'M' : pick < 0.7 ? 'P' : 'B'); }
    } else {
      t = ['P', 'R']; n = 1 + Math.floor((i - 19) / 3); // 3..6 bodies by the end; a planet blocks (a repulsor on the line casts a shadow no path escapes)
      var pool = ['P', 'M', 'B', 'H', 'M', 'P'];
      for (j = 0; j < n; j++) { pick = pool[Math.floor(rng() * pool.length)]; t.push(pick === 'H' && t.indexOf('H') >= 0 ? 'P' : pick); } // one black hole at most
      if (i === 19) t = ['P', 'R'];
    }
    var cnt = 0; for (j = 0; j < t.length; j++) cnt += t[j] === 'B' ? 2 : 1;
    while (cnt > (i >= 30 ? 7 : 6)) { t.pop(); cnt--; } // (only 'B' can overshoot by one; trimming the tail keeps it simple)
    var frags = i >= 30 ? 2 + (rng() < 0.6 ? 1 : 0) : i < 3 ? 0 : i < 10 ? 1 : i < 20 ? 1 + (rng() < 0.5 ? 1 : 0) : 2 + (rng() < 0.5 ? 1 : 0);
    return { tokens: t, frags: frags, index: i };
  }

  /* ---------- placement ---------- */
  function planet(rng, big) { var r = ri(big ? 55 + rng() * 30 : 40 + rng() * 30); return { kind: 'planet', r: r, mu: r3((55 + rng() * 30) * r * r * r), x: 0, y: 0, orbit: null }; }
  function makeSystem(rng, tok, pairId, d) {
    var b, b2, r1, r2, rad, om, ph;
    if (tok === 'P') return [planet(rng, rng() < 1 - d * 0.7)];
    if (tok === 'H') { b = { kind: 'blackhole', r: ri(12 + rng() * 4), capture: ri(38 + rng() * 12), mu: r3(2.5e7 + rng() * 1.5e7), x: 0, y: 0, orbit: null }; return [b]; }
    if (tok === 'R') { b = { kind: 'repulsor', r: ri(22 + rng() * 8), mu: r3(-(0.8e7 + rng() * 0.6e7)), x: 0, y: 0, orbit: null }; return [b]; }
    // binary: two planets on one circle, opposite phases
    r1 = ri(30 + rng() * 20); r2 = ri(30 + rng() * 20); rad = ri(80 + rng() * 60);
    om = d3((rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6)); ph = d3(rng() * TAU);
    b = { kind: 'planet', r: r1, mu: r3((55 + rng() * 30) * r1 * r1 * r1), orbit: { cx: 0, cy: 0, rad: rad, omega: om, phase: ph }, pair: pairId };
    b2 = { kind: 'planet', r: r2, mu: r3((55 + rng() * 30) * r2 * r2 * r2), orbit: { cx: 0, cy: 0, rad: rad, omega: om, phase: d3(ph + Math.PI) }, pair: pairId };
    return [b, b2];
  }
  function setCentre(sys, x, y) {
    for (var i = 0; i < sys.length; i++) { var b = sys[i]; if (b.orbit) { b.orbit.cx = x; b.orbit.cy = y; } else { b.x = x; b.y = y; } }
  }
  function moonFor(rng, parent, shrink) {
    var r = ri(12 + rng() * 10);
    return { kind: 'moon', r: r, mu: r3(60 * r * r * r),
      orbit: { cx: parent.x, cy: parent.y, rad: ri(reff(parent) + Math.max(50, r + 34) + rng() * 60 * shrink), omega: d3((rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 1.1)), phase: d3(rng() * TAU) } };
  }
  function clearOf(L, b, others, gap) {
    if (!inWorld(b)) return false;
    if (pointGap(b, L.probe.x, L.probe.y) < 140) return false;
    var g = pointGap(b, L.target.x, L.target.y);
    if (g < 110 || g - L.target.r < 70) return false;
    for (var i = 0; i < others.length; i++) if (others[i] !== b && bodyGap(b, others[i]) < (gap || 36)) return false;
    return true;
  }

  // endless=true (runtime only; the campaign bake calls build(seed, d)): a plain planet takes the blocking slot when the
  // recipe has one — a black hole or binary straddling the line leaves few finger-robust routes, which costs solver time.
  function build(seed, d, endless) {
    var rng = mulberry32(seed), rc = recipe(rng, d), i, k, tries;
    if (endless && rc.tokens[0] !== 'P') { var pi = rc.tokens.indexOf('P'); if (pi > 0) { rc.tokens.splice(pi, 1); rc.tokens.unshift('P'); } }
    var L = { id: 'e' + seed, index: -1, seed: seed, difficulty: d3(d), name: '', plate: '∞',
      probe: { x: ri(180 + rng() * 540), y: ri(1350 + rng() * 130) },
      target: { x: ri(140 + rng() * 620), y: ri(140 + rng() * 280), r: ri(46 - 12 * d) },
      bodies: [], frags: [], solution: null, _frags: rc.frags };
    var P = L.probe, T = L.target, blocker = rc.index >= 5, pair = 1, parents = [], lane = null, cl = null, gap = d > 1 ? 32 : 36;
    // lane: probe -> a waypoint beside the blocker -> target. Later bodies keep clear of it, so a bending
    // route stays open (moons may still sweep across it, and attractors near the target sit on it on purpose).
    function laneGap(b) {
      var g = 1e9;
      for (var q = 0; q < lane.length - 2; q += 2) for (var u = 0; u <= 1; u += 0.05) g = Math.min(g, pointGap(b, lane[q] + (lane[q + 2] - lane[q]) * u, lane[q + 1] + (lane[q + 3] - lane[q + 1]) * u));
      return g;
    }
    var toks = rc.tokens.filter(function (t) { return t !== 'M'; }), moons = rc.tokens.length - toks.length;
    for (k = 0; k < toks.length; k++) {
      var sys = makeSystem(rng, toks[k], pair, d), ok = false;
      if (toks[k] === 'B') pair++;
      for (tries = 0; tries < 60 && !ok; tries++) {
        var x, y, s = sweep(sys[0]).R, free = false;
        if (k === 0 && blocker) { // the principal body sits across the direct line: every hit must bend
          var f = 0.35 + rng() * 0.3, off = (rng() * 2 - 1) * 0.6 * s;
          var lx = P.x + (T.x - P.x) * f, ly = P.y + (T.y - P.y) * f, len = Math.sqrt((T.x - P.x) * (T.x - P.x) + (T.y - P.y) * (T.y - P.y));
          x = lx - (T.y - P.y) / len * off; y = ly + (T.x - P.x) / len * off;
        } else if ((k === 0 && !blocker) || (k === 1 && toks[1] !== 'R' && rng() < 0.7 * (1 - d))) {
          // an attractor just below the target: gravity funnels near-misses into the bezel (gentler plates)
          var an = Math.atan2(P.y - T.y, P.x - T.x) + (rng() * 2 - 1) * 1.3, dd = s + 115 + rng() * 120;
          x = T.x + Math.cos(an) * dd; y = T.y + Math.sin(an) * dd;
        } else {
          x = MARGIN + rng() * (W - 2 * MARGIN); y = T.y + 60 + rng() * (P.y - T.y - 120); free = true;
          if (d > 1 && cl) { x = Math.max(MARGIN, Math.min(W - MARGIN, cl.x + (rng() * 2 - 1) * 240)); y = Math.max(T.y + 60, Math.min(P.y - 60, cl.y + (rng() * 2 - 1) * 300)); } // Volume II: tighter clusters round the blocker
        }
        setCentre(sys, ri(x), ri(y));
        ok = true;
        for (i = 0; i < sys.length && ok; i++) ok = clearOf(L, sys[i], L.bodies, gap) && (!lane || !free || laneGap(sys[i]) >= 80);
      }
      if (!ok) return null;
      if (k === 0) cl = sweep(sys[0]);
      if (k === 0 && blocker) {
        var nx = -(T.y - P.y), ny = T.x - P.x, nl = Math.sqrt(nx * nx + ny * ny), sd = rng() < 0.5 ? -1 : 1, wd = sweep(sys[0]).R + 70 + rng() * 80, c = sweep(sys[0]);
        lane = [P.x, P.y, Math.max(80, Math.min(W - 80, c.x + nx / nl * sd * wd)), c.y + ny / nl * sd * wd, T.x, T.y];
      }
      for (i = 0; i < sys.length; i++) { L.bodies.push(sys[i]); if (!sys[i].orbit && sys[i].kind !== 'repulsor') parents.push(sys[i]); }
    }
    for (k = 0; k < moons; k++) {
      var placed = false;
      for (tries = 0; tries < 40 && !placed; tries++) {
        var par = parents[Math.floor(rng() * parents.length)];
        if (!par) return null;
        var m = moonFor(rng, par, 1 - tries / 40);
        if (clearOf(L, m, L.bodies, gap)) { L.bodies.push(m); placed = true; } // moons may cross the lane: a timing puzzle
      }
      if (!placed) return null;
    }
    return L;
  }

  /* ---------- solver ---------- */
  function launch(aDeg, p) { var a = aDeg * DEG, v = K.VMAX * p; return { vx: Math.cos(a) * v, vy: Math.sin(a) * v }; }
  var nSims = 0, hardCap = Infinity, fast = false, FAST_STEPS = 720; // hardCap: daily() only; past it every flight counts as a miss (no further simulation)
  // solver ignores routes longer than 6 s (rare, and hard to aim)
  // Exact flight (Physics.simulate). Inside solve() `fast` also drops flights that are >80 u outside the plate and
  // still heading out, and flights past FAST_STEPS: this can only turn a rare late hit into a miss, so every hit the solver reports is genuine.
  function shoot(L, aDeg, p, t0) {
    if (nSims >= hardCap) return { status: 'timeout', minDist: Infinity };
    var v = launch(aDeg, p); nSims++;
    if (!fast) return Physics.simulate(L, v.vx, v.vy, t0, K.MAX_STEPS);
    var s = Physics.createSim(L, v.vx, v.vy, t0);
    while (Physics.stepSim(s, L) === 'flying') {
      if (s.step & 7) continue;
      if (s.step >= FAST_STEPS) { s.status = 'timeout'; break; }
      var ox = s.x < -80 ? s.x + 80 : s.x > W + 80 ? s.x - W - 80 : 0, oy = s.y < -80 ? s.y + 80 : s.y > H + 80 ? s.y - H - 80 : 0;
      if ((ox || oy) && ox * s.vx + oy * s.vy > 0) { s.status = 'lost'; break; }
    }
    return s;
  }
  function hit(L, aDeg, p, t0) { return shoot(L, aDeg, p, t0).status === 'hit'; }
  function clampP(p) { return p > 1 ? 1 : p; } // pulling past DRAG_MAX gives full power
  // Finger tolerance: 3x3 neighbourhood at +-1 deg / +-0.03 power. Returns hits out of 9 (0 if the centre misses).
  // With `need`, bails out as soon as `need` can no longer be reached.
  function robust(L, a, p, t0, need) {
    if (!hit(L, a, p, t0)) return 0;
    var n = 1, miss = 0;
    for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) if (i || j) {
      if (hit(L, a + i, clampP(p + 0.03 * j), t0)) n++; else if (need && ++miss > 9 - need) return 0;
    }
    return n;
  }
  function result(a, p, sc) { var v = launch(a, p); return { vx: v.vx, vy: v.vy, angle: a, power: p, robust: sc }; }
  // From a hit, find the widest part of its cluster: centre the angle, walk the power run, then pick the power
  // whose angle run is widest (clusters are often thin at one end) and return the middle of that run.
  function centre(L, a, p, t0) {
    function arun(a0, pp) { // [centre, width] of the angle run through a0 at power pp (0.5 deg steps)
      var lo = 0, hi = 0;
      while (lo < 12 && hit(L, a0 - (lo + 1) * 0.5, pp, t0)) lo++;
      while (hi < 12 && hit(L, a0 + (hi + 1) * 0.5, pp, t0)) hi++;
      return [a0 + (hi - lo) * 0.25, lo + hi];
    }
    var c = arun(a, p), best = [c[0], p, c[1]], plo = p, phi = p;
    a = c[0];
    while (plo - 0.03 >= 0.17 && p - plo < 0.3 && hit(L, a, plo - 0.03, t0)) plo -= 0.03;
    while (phi < 1 && phi - p < 0.3 && hit(L, a, clampP(phi + 0.03), t0)) phi = clampP(phi + 0.03);
    for (var pp = plo; pp <= phi + 1e-9; pp += 0.03) {
      if (Math.abs(pp - p) < 1e-9) continue;
      var r = arun(a, pp);
      if (r[1] > best[2] || (r[1] === best[2] && Math.abs(pp - (plo + phi) / 2) < Math.abs(best[1] - (plo + phi) / 2))) best = [r[0], pp, r[1]];
    }
    return [best[0], best[1]];
  }

  // Fast budgeted solver: coarse fan around the direct line (closest-approach recorded for every shot), then
  // pattern search on closest approach from the most promising shots; each hit is centred and finger-tested.
  // opts: {t0Step, maxSims (default 3000), minRobust (default 7 of 9)}. Returns {vx, vy, angle, power, robust} | null.
  function solve(L, opts) {
    fast = true;
    try { return solveFast(L, opts || {}); } finally { fast = false; }
  }
  function solveFast(L, opts) {
    var t0 = opts.t0Step | 0, budget = opts.maxSims || 3000, need = opts.minRobust || 7, start = nSims, tried = [];
    var th = Math.atan2(L.target.y - L.probe.y, L.target.x - L.probe.x) / DEG, seeds = [], i, r;
    function fresh(a, p) { for (var q = 0; q < tried.length; q++) if (Math.abs(tried[q][0] - a) < 2 && Math.abs(tried[q][1] - p) < 0.08) return false; return true; }
    function onHit(a, p) {
      if (!fresh(a, p)) return null;
      var c = centre(L, a, p, t0); tried.push([a, p], c);
      var sc = robust(L, c[0], c[1], t0, need);
      if (sc >= need) return result(c[0], c[1], sc);
      if (budget - (nSims - start) < 400) return null;
      // generous budget: map the neighbourhood (13 angles x 7 powers) and take its most tolerant cell
      var G = [], bi = -1, bs = 0, u, w;
      for (u = 0; u < 13; u++) for (w = 0; w < 7; w++) G.push(hit(L, c[0] - 3 + u * 0.5, clampP(c[1] - 0.09 + w * 0.03), t0) && c[1] - 0.09 + w * 0.03 >= 0.17 ? 1 : 0);
      for (u = 2; u < 11; u++) for (w = 1; w < 6; w++) if (G[u * 7 + w]) {
        var n = 0; for (var du = -2; du <= 2; du += 2) for (var dw = -1; dw <= 1; dw++) n += G[(u + du) * 7 + w + dw];
        if (n > bs) { bs = n; bi = u * 7 + w; }
      }
      if (bs < need) return null;
      var ba = c[0] - 3 + Math.floor(bi / 7) * 0.5, bp = clampP(c[1] - 0.09 + (bi % 7) * 0.03);
      tried.push([ba, bp]);
      sc = robust(L, ba, bp, t0, need);
      return sc >= need ? result(ba, bp, sc) : null;
    }
    // two interleaved fans: 5 deg apart, the second offset by 2.5 deg and between the first one's powers
    var PWS = [[1, 0.8, 0.62, 0.46, 0.32, 0.22], [0.9, 0.71, 0.54, 0.39, 0.27, 1]];
    for (var pass = 0; pass < 2; pass++) for (var ring = 0; ring <= 36; ring++) for (var sg = -1; sg <= 1; sg += 2) {
      if (ring === 0 && sg > 0 && !pass) continue;
      var a = th + sg * (ring * 5 + pass * 2.5), PW = PWS[pass];
      for (var q = 0; q < PW.length; q++) {
        if (nSims - start > budget) return null;
        var s = shoot(L, a, PW[q], t0);
        if (s.status === 'hit') { if ((r = onHit(a, PW[q]))) return r; }
        else seeds.push([s.minDist, a, PW[q]]);
      }
      if (sg > 0 && (ring === 5 || ring === 12 || ring === 22 || ring === 36)) { // descend from the closest near-misses so far
        seeds.sort(function (x, y) { return x[0] - y[0]; });
        for (i = 0; i < 4 && i < seeds.length; i++) {
          var ca = seeds[i][1], cp = seeds[i][2], best = seeds[i][0], da = 2.5, dp = 0.08;
          if (best > 400) break;
          while (da >= 0.3 && nSims - start < budget) {
            var moved = false, cand = [[ca + da, cp], [ca - da, cp], [ca, clampP(cp + dp)], [ca, cp - dp]];
            for (var k = 0; k < 4 && !moved; k++) {
              if (cand[k][1] < 0.17) continue;
              var z = shoot(L, cand[k][0], cand[k][1], t0);
              if (z.status === 'hit') { if ((r = onHit(cand[k][0], cand[k][1]))) return r; da = 0; moved = true; break; }
              if (z.minDist < best) { best = z.minDist; ca = cand[k][0]; cp = cand[k][1]; moved = true; }
            }
            if (!moved) { da /= 2; dp /= 2; }
          }
        }
        seeds.length = 0;
      }
    }
    return null;
  }

  /* ---------- comet fragments: on a DIFFERENT hit path, away from the stored solution ---------- */
  var _A = new Float32Array(2 * K.MAX_STEPS), _S = new Float32Array(2 * K.MAX_STEPS);
  function placeFrags(L, n, alt, sol, rng) {
    if (!n) return [];
    var sa = Physics.simulate(L, alt.vx, alt.vy, alt.t0Step | 0, K.MAX_STEPS, _A);
    var ss = Physics.simulate(L, sol.vx, sol.vy, sol.t0Step | 0, K.MAX_STEPS, _S);
    if (sa.status !== 'hit') return null;
    var out = [], lo = Math.floor(sa.n * 0.15), hi = Math.floor(sa.n * 0.85), seg = (hi - lo) / n;
    for (var f = 0; f < n; f++) {
      var found = null;
      for (var tries = 0; tries < 40 && !found; tries++) {
        var s = Math.floor(lo + seg * (f + rng())), x = _A[2 * s], y = _A[2 * s + 1];
        var ang = rng() * TAU, rr = rng() * 8;
        x = ri(x + Math.cos(ang) * rr); y = ri(y + Math.sin(ang) * rr);
        if (x < MARGIN || x > W - MARGIN || y < MARGIN || y > H - MARGIN) continue;
        var ok = true, i;
        for (i = 0; i < L.bodies.length && ok; i++) if (pointGap(L.bodies[i], x, y) < 22) ok = false;
        if (!ok) continue;
        if (Math.hypot(x - L.probe.x, y - L.probe.y) < 120 || Math.hypot(x - L.target.x, y - L.target.y) < L.target.r + 60) continue;
        for (i = 0; i < out.length && ok; i++) if (Math.hypot(x - out[i].x, y - out[i].y) < 130) ok = false;
        for (i = 0; i < ss.n && ok; i += 2) { var dx = _S[2 * i] - x, dy = _S[2 * i + 1] - y; if (dx * dx + dy * dy < 70 * 70) ok = false; }
        if (ok) found = { x: x, y: y };
      }
      if (!found) return null;
      out.push(found);
    }
    var keep = L.frags; L.frags = out;
    var v = Physics.simulate(L, alt.vx, alt.vy, alt.t0Step | 0, K.MAX_STEPS), all = v.status === 'hit';
    for (i = 0; i < out.length; i++) if (!v.collected[i]) all = false;
    L.frags = keep;
    return all ? out : null;
  }

  function straightHits(L, t0, powers) {
    var a = Math.atan2(L.target.y - L.probe.y, L.target.x - L.probe.x) / DEG;
    for (var i = 0; i < powers.length; i++) if (hit(L, a, powers[i], t0)) return true;
    return false;
  }

  function finish(L) { delete L._frags; return L; }

  // Endless: deterministic for (seed, difficulty); never returns an unsolvable plate.
  var SP = [0.4, 0.6, 0.8, 1];
  // Endless budget, counted in simulated flights (not ms) so results stay deterministic across devices.
  var CAND_SIMS = 90, STAGE_CAPS = [330, 150, 150, 100];
  function attempt(seed, s, d, maxSims, cap) {
    var L = build(s, d, true), sol, rng;
    if (!L) return null;
    if (d >= 0.17 && straightHits(L, 0, SP)) return null;
    sol = solve(L, { maxSims: Math.min(maxSims, cap - nSims) });
    if (!sol) return null;
    rng = mulberry32(s ^ 0x5bd1e995);
    L.solution = { vx: sol.vx, vy: sol.vy, t0Step: 0 };
    // a second, different hit for comet fragments (cheap and optional in Endless; skipped when the budget is spent)
    var fr = null;
    for (var j = 0; j < 12 && !fr && L._frags && nSims < cap; j++) {
      var a = sol.angle + (j % 2 ? 1 : -1) * (4 + 3 * (j >> 1)), p = [1, 0.7, 0.45][j % 3];
      if (hit(L, a, p, 0)) { var v = launch(a, p); fr = placeFrags(L, Math.min(2, L._frags), { vx: v.vx, vy: v.vy, t0Step: 0 }, L.solution, rng); }
    }
    L.frags = fr || [];
    L.seed = seed; L.id = 'e' + seed; L.difficulty = d3(d);
    L.name = NAMES[s % 30] + ' ' + SUFFIX[(s >>> 5) % SUFFIX.length];
    return finish(L);
  }
  var genStats = { fallback: 0, empty: 0, stage: [0, 0, 0, 0, 0, 0] };
  // Endless: deterministic for (seed, difficulty); never returns an unsolvable plate. Work is capped in simulated
  // flights (not ms) so results are identical on every device: candidates at the asked difficulty get CAND_SIMS each
  // within STAGE_CAPS[0]; if none proves finger-robust, cheaper archetypes follow (3-body repulsor plate at 0.69,
  // planet + moon at 0.2, two planets at 0.1), each with its own small cap. Worst case ~730 flights.
  // Candidate seed n for a plate seed. Candidate 0 is the seed itself. Later candidates are HASHED from (seed, n): the old linear rule
  // seed + n*golden made round r's candidate n identical to round (r+n)'s first candidate, so at high difficulty (many failed
  // candidates) consecutive Endless rounds converged on the very same plate.
  function candSeed(seed, n) {
    if (!n) return seed >>> 0;
    var h = (seed ^ Math.imul(n, 0x85EBCA6B)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D); h = Math.imul(h ^ (h >>> 15), 0x846CA68B);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function generate(seed, difficulty) {
    var d = Math.max(0, Math.min(1, +difficulty || 0)), k, L, s, cap, fb = false;
    var ds = [d, Math.min(d, 0.69), Math.min(d, 0.2), Math.min(d, 0.1)];
    for (var g = 0; g < ds.length; g++) {
      if (g && ds[g] === ds[g - 1]) continue;
      if (g && !fb) { fb = true; genStats.fallback++; }
      cap = nSims + STAGE_CAPS[g];
      for (k = 0; k < 48 && nSims < cap; k++) {
        s = candSeed(seed, k + 101 * g);
        if ((L = attempt(seed, s, ds[g], CAND_SIMS, cap))) return L;
      }
    }
    // Last resort (not seen in 1000s of seeds): an empty plate — the straight shot is a guaranteed hit.
    genStats.empty++;
    L = { id: 'e' + seed, index: -1, seed: seed, difficulty: d3(d), name: 'Quiet Sky', plate: '\u221E',
      probe: { x: 450, y: 1420 }, target: { x: 450, y: 260, r: 44 }, bodies: [], frags: [], solution: { vx: 0, vy: -K.VMAX * 0.8, t0Step: 0 } };
    return L;
  }

  /* ---------- Daily Plate: 'YYYY-MM-DD' -> the same Level for everyone, every call, every process ---------- */
  var DOW_D = [0.85, 0.30, 0.38, 0.46, 0.55, 0.65, 0.75]; // Sun..Mon..Sat
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function fnv1a(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function weekday(y, m, d) { var t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]; if (m < 3) y--; return (y + ((y / 4) | 0) - ((y / 100) | 0) + ((y / 400) | 0) + t[m - 1] + d) % 7; } // Sakamoto: 0 = Sunday
  // Daily plates use the Endless generator (deterministic per (seed, difficulty), budgeted in flights) with a gentler fallback ladder:
  // a day that misses at its own difficulty d retries at 0.75 d and 0.5 d before the easy archetype (0.2), so it lands close to the
  // asked difficulty instead of on a trivial plate. `hardCap` stops the last candidate from overrunning a stage budget.
  var DAILY_CAPS = [280, 110, 90, 80];
  function dailyGen(seed, d) {
    var ds = [d, d * 0.75, d * 0.5, Math.min(d, 0.2)], g, k, s, L, cap;
    for (g = 0; g < ds.length; g++) {
      if (g && ds[g] >= ds[g - 1]) continue;
      cap = nSims + DAILY_CAPS[g]; hardCap = cap + 20;
      try {
        for (k = 0; k < 48 && nSims < cap; k++) {
          s = candSeed(seed, k + 101 * g);
          if ((L = attempt(seed, s, ds[g], CAND_SIMS, cap))) { genStats.stage[g]++; return L; }
        }
      } finally { hardCap = Infinity; }
    }
    genStats.stage[5]++; // last resort: an empty plate, the straight shot is a guaranteed hit
    return { id: 'e' + seed, index: -1, seed: seed, difficulty: d3(d), name: 'Quiet Sky', plate: '∞',
      probe: { x: 450, y: 1420 }, target: { x: 450, y: 260, r: 44 }, bodies: [], frags: [], solution: { vx: 0, vy: -K.VMAX * 0.8, t0Step: 0 } };
  }
  function daily(dateKey) {
    var key = String(dateKey), p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key), h = fnv1a(key), cap = key, dow = 1, L;
    if (p && +p[2] >= 1 && +p[2] <= 12 && +p[3] >= 1 && +p[3] <= 31) { dow = weekday(+p[1], +p[2], +p[3]); cap = p[3] + ' ' + MON[p[2] - 1] + ' ' + p[1]; }
    L = dailyGen(h, DOW_D[dow]);
    L.id = 'd' + key; L.plate = 'DAILY'; L.caption = 'DAILY \u00b7 ' + cap; L.index = -1;
    L.name = NAMES[h % 30] + ' ' + SUFFIX[(h >>> 5) % SUFFIX.length];
    return L;
  }

  /*@CAMPAIGN*/var CAMPAIGN = [
    {id:"c01",index:0,seed:21000,difficulty:0,name:"First Light",plate:"I",probe:{x:498,y:1469},target:{x:376,y:396,r:46},bodies:[{kind:"planet",r:81,mu:4.19e7,x:375,y:661,orbit:null}],frags:[],solution:{vx:104.15808168664763,vy:-402.7494183972928,t0Step:0}},
    {id:"c02",index:1,seed:7131,difficulty:.034,name:"The Solitary Mass",plate:"II",probe:{x:368,y:1371},target:{x:183,y:367,r:46},bodies:[{kind:"planet",r:85,mu:4e7,x:367,y:535,orbit:null}],frags:[],solution:{vx:-182.36239706425633,vy:-373.89832326045337,t0Step:0}},
    {id:"c03",index:2,seed:9262,difficulty:.069,name:"Two Lanterns",plate:"III",probe:{x:302,y:1460},target:{x:364,y:177,r:45},bodies:[{kind:"planet",r:79,mu:3.41e7,x:612,y:298,orbit:null},{kind:"planet",r:83,mu:3.18e7,x:271,y:476,orbit:null}],frags:[],solution:{vx:78.72574701260768,vy:-424.7661200676284,t0Step:0}},
    {id:"c04",index:3,seed:8393,difficulty:.103,name:"Comet Dust",plate:"IV",probe:{x:705,y:1425},target:{x:313,y:385,r:45},bodies:[{kind:"planet",r:76,mu:3.31e7,x:521,y:484,orbit:null}],frags:[{x:685,y:574}],solution:{vx:-220.4464139210133,vy:-352.7880080010732,t0Step:0},fragSolution:{vx:27.60357672582453,vy:-286.67410512974755,t0Step:0}},
    {id:"c05",index:4,seed:8524,difficulty:.138,name:"The Narrow Pass",plate:"V",probe:{x:275,y:1358},target:{x:636,y:409,r:44},bodies:[{kind:"planet",r:58,mu:1.26e7,x:364,y:499,orbit:null},{kind:"planet",r:72,mu:2.52e7,x:738,y:598,orbit:null}],frags:[{x:790,y:1008}],solution:{vx:121.62662916465847,vy:-397.82277848062273,t0Step:0},fragSolution:{vx:127.98050498001808,vy:2.2339080239722895,t0Step:0}},
    {id:"c06",index:5,seed:16655,difficulty:.172,name:"A Wandering Moon",plate:"VI",probe:{x:346,y:1456},target:{x:661,y:397,r:44},bodies:[{kind:"planet",r:82,mu:3.43e7,x:549,y:801,orbit:null},{kind:"moon",r:15,mu:203000,orbit:{cx:549,cy:801,rad:134,omega:-1.241,phase:2.754}}],frags:[{x:696,y:619}],solution:{vx:-11.169540119861438,vy:-639.9025249000904,t0Step:0},fragSolution:{vx:362.4999916318928,vy:-527.4407607180901,t0Step:0}},
    {id:"c07",index:6,seed:64786,difficulty:.207,name:"Tidal Reach",plate:"VII",probe:{x:273,y:1381},target:{x:284,y:401,r:44},bodies:[{kind:"planet",r:78,mu:3.57e7,x:275,y:773,orbit:null},{kind:"moon",r:13,mu:132000,orbit:{cx:275,cy:773,rad:185,omega:-1.203,phase:2.757}}],frags:[{x:379,y:578}],solution:{vx:-208.36361885258026,vy:-605.1318883835628,t0Step:0},fragSolution:{vx:218.89289172842814,vy:-601.4032773029813,t0Step:0}},
    {id:"c08",index:7,seed:14917,difficulty:.241,name:"The Retinue",plate:"VIII",probe:{x:525,y:1444},target:{x:506,y:332,r:43},bodies:[{kind:"planet",r:83,mu:3.35e7,x:532,y:906,orbit:null},{kind:"planet",r:67,mu:2.41e7,x:719,y:415,orbit:null},{kind:"moon",r:14,mu:165000,orbit:{cx:532,cy:906,rad:138,omega:.904,phase:2.066}}],frags:[{x:595,y:611}],solution:{vx:-265.4036752999931,vy:-582.3752133609876,t0Step:0},fragSolution:{vx:229.35548770899226,vy:-597.4914729582091,t0Step:0}},
    {id:"c09",index:8,seed:9048,difficulty:.276,name:"Perturbation",plate:"IX",probe:{x:612,y:1421},target:{x:240,y:261,r:43},bodies:[{kind:"planet",r:79,mu:2.97e7,x:386,y:867,orbit:null},{kind:"planet",r:77,mu:3.18e7,x:126,y:420,orbit:null},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:386,cy:867,rad:135,omega:-.676,phase:2.417}}],frags:[{x:273,y:539}],solution:{vx:27.91640791381489,vy:-639.390861812389,t0Step:0},fragSolution:{vx:-370.24566317944675,vy:-441.2415992365313,t0Step:0}},
    {id:"c10",index:9,seed:38179,difficulty:.31,name:"The Binary",plate:"X",probe:{x:616,y:1353},target:{x:753,y:241,r:42},bodies:[{kind:"planet",r:47,mu:7.17e6,orbit:{cx:637,cy:636,rad:87,omega:-.881,phase:2.429},pair:1},{kind:"planet",r:44,mu:6.22e6,orbit:{cx:637,cy:636,rad:87,omega:-.881,phase:5.571},pair:1}],frags:[{x:539,y:1113}],solution:{vx:171.03256069008432,vy:-616.7234900535187,t0Step:0},fragSolution:{vx:-104.18180942629013,vy:-302.5659441917814,t0Step:0}},
    {id:"c11",index:10,seed:84310,difficulty:.345,name:"Syzygy",plate:"XI",probe:{x:291,y:1382},target:{x:178,y:352,r:42},bodies:[{kind:"planet",r:34,mu:2.49e6,orbit:{cx:201,cy:724,rad:116,omega:.58,phase:1.002},pair:1},{kind:"planet",r:45,mu:7.27e6,orbit:{cx:201,cy:724,rad:116,omega:.58,phase:4.144},pair:1},{kind:"planet",r:56,mu:1.47e7,x:731,y:524,orbit:null}],frags:[{x:302,y:1131},{x:260,y:531}],solution:{vx:-181.7698206105105,vy:-613.6446303156436,t0Step:0},fragSolution:{vx:18.985326206160696,vy:-543.6686098983881,t0Step:0}},
    {id:"c12",index:11,seed:21441,difficulty:.379,name:"The Dioscuri",plate:"XII",probe:{x:204,y:1460},target:{x:154,y:174,r:41},bodies:[{kind:"planet",r:32,mu:2.6e6,orbit:{cx:255,cy:909,rad:114,omega:.599,phase:4.176},pair:1},{kind:"planet",r:41,mu:4.35e6,orbit:{cx:255,cy:909,rad:114,omega:.599,phase:7.318},pair:1},{kind:"planet",r:60,mu:1.79e7,x:366,y:274,orbit:null}],frags:[{x:282,y:1149}],solution:{vx:-127.59547802700627,vy:-627.1518109573309,t0Step:0},fragSolution:{vx:45.44245515262757,vy:-153.41115757891092,t0Step:0}},
    {id:"c13",index:12,seed:22572,difficulty:.414,name:"Roche Limit",plate:"XIII",probe:{x:370,y:1396},target:{x:614,y:316,r:41},bodies:[{kind:"planet",r:34,mu:2.78e6,orbit:{cx:569,cy:909,rad:140,omega:.769,phase:3.779},pair:1},{kind:"planet",r:36,mu:3.04e6,orbit:{cx:569,cy:909,rad:140,omega:.769,phase:6.921},pair:1},{kind:"planet",r:58,mu:1.3e7,x:313,y:424,orbit:null},{kind:"moon",r:14,mu:165000,orbit:{cx:313,cy:424,rad:127,omega:-1.093,phase:4.625}}],frags:[{x:553,y:1146},{x:588,y:862}],solution:{vx:56.387315039062145,vy:-428.30418011348615,t0Step:0},fragSolution:{vx:142.48152134221905,vy:-172.84390667884932,t0Step:0}},
    {id:"c14",index:13,seed:20703,difficulty:.448,name:"Event Horizon",plate:"XIV",probe:{x:303,y:1395},target:{x:640,y:242,r:41},bodies:[{kind:"blackhole",r:14,capture:45,mu:3.1e7,x:514,y:732,orbit:null},{kind:"planet",r:50,mu:8.03e6,x:172,y:354,orbit:null}],frags:[{x:511,y:1089},{x:680,y:549}],solution:{vx:5.584982718959422,vy:-639.9756307610696,t0Step:0},fragSolution:{vx:367.08891926466947,vy:-524.2573083449547,t0Step:0}},
    {id:"c15",index:14,seed:27834,difficulty:.483,name:"The Dark Well",plate:"XV",probe:{x:437,y:1442},target:{x:231,y:366,r:40},bodies:[{kind:"blackhole",r:14,capture:50,mu:3.99e7,x:326,y:920,orbit:null},{kind:"planet",r:65,mu:2.2e7,x:205,y:605,orbit:null},{kind:"planet",r:74,mu:2.74e7,x:647,y:1276,orbit:null}],frags:[{x:711,y:1407},{x:273,y:1015}],solution:{vx:-3.7698633352973845,vy:-431.983550763722,t0Step:0},fragSolution:{vx:218.67929930294997,vy:211.17614461953517,t0Step:0}},
    {id:"c16",index:15,seed:10965,difficulty:.517,name:"Accretion",plate:"XVI",probe:{x:276,y:1393},target:{x:690,y:265,r:40},bodies:[{kind:"blackhole",r:13,capture:48,mu:4e7,x:471,y:880,orbit:null},{kind:"planet",r:70,mu:2.86e7,x:493,y:268,orbit:null},{kind:"moon",r:21,mu:556000,orbit:{cx:471,cy:880,rad:107,omega:-1.147,phase:.003}}],frags:[{x:282,y:879}],solution:{vx:471.8574955584793,vy:-432.3777328740227,t0Step:0},fragSolution:{vx:-51.59619970661368,vy:-589.7472612703134,t0Step:0}},
    {id:"c17",index:16,seed:63096,difficulty:.552,name:"Hill Sphere",plate:"XVII",probe:{x:534,y:1372},target:{x:498,y:246,r:39},bodies:[{kind:"blackhole",r:14,capture:42,mu:3.99e7,x:534,y:771,orbit:null},{kind:"planet",r:41,mu:4.01e6,x:258,y:382,orbit:null},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:534,cy:771,rad:115,omega:-1.226,phase:6.072}},{kind:"moon",r:18,mu:3.5e5,orbit:{cx:258,cy:382,rad:125,omega:-.564,phase:4.783}}],frags:[{x:397,y:539}],solution:{vx:239.74821978618365,vy:-593.397666922744,t0Step:0},fragSolution:{vx:-255.19940411215782,vy:-586.9184476064793,t0Step:0}},
    {id:"c18",index:17,seed:18227,difficulty:.586,name:"The Lagrange Gate",plate:"XVIII",probe:{x:371,y:1356},target:{x:162,y:246,r:39},bodies:[{kind:"blackhole",r:14,capture:49,mu:3.57e7,x:289,y:830,orbit:null},{kind:"planet",r:53,mu:1.02e7,x:397,y:394,orbit:null},{kind:"planet",r:41,mu:5.57e6,x:672,y:888,orbit:null},{kind:"moon",r:13,mu:132000,orbit:{cx:289,cy:830,rad:139,omega:-.575,phase:5.958}}],frags:[{x:446,y:962},{x:298,y:521}],solution:{vx:-376.1825614671829,vy:-517.7708763999663,t0Step:0},fragSolution:{vx:132.2006421407451,vy:-511.18195411964086,t0Step:0}},
    {id:"c19",index:18,seed:60358,difficulty:.621,name:"Precession",plate:"XIX",probe:{x:674,y:1366},target:{x:179,y:210,r:39},bodies:[{kind:"blackhole",r:16,capture:43,mu:2.79e7,x:463,y:820,orbit:null},{kind:"planet",r:41,mu:4.25e6,x:809,y:1186,orbit:null},{kind:"planet",r:65,mu:1.7e7,x:676,y:611,orbit:null},{kind:"moon",r:21,mu:556000,orbit:{cx:676,cy:611,rad:157,omega:.663,phase:4.15}}],frags:[{x:636,y:1143}],solution:{vx:-475.6126883055323,vy:-428.2435880696693,t0Step:0},fragSolution:{vx:-116.01186918893913,vy:-596.8293275361797,t0Step:0}},
    {id:"c20",index:19,seed:17489,difficulty:.655,name:"The Contrary Star",plate:"XX",probe:{x:532,y:1475},target:{x:349,y:416,r:38},bodies:[{kind:"planet",r:56,mu:1.2e7,x:483,y:1079,orbit:null},{kind:"repulsor",r:27,mu:-1.12e7,x:176,y:1217,orbit:null}],frags:[{x:558,y:1262},{x:497,y:846}],solution:{vx:-353.23967059971733,vy:-533.6869261229876,t0Step:0},fragSolution:{vx:66.89821649129792,vy:-636.4940130356949,t0Step:0}},
    {id:"c21",index:20,seed:19620,difficulty:.69,name:"Aphelion",plate:"XXI",probe:{x:700,y:1450},target:{x:640,y:389,r:38},bodies:[{kind:"planet",r:43,mu:4.77e6,x:692,y:1066,orbit:null},{kind:"repulsor",r:29,mu:-9.58e6,x:222,y:1366,orbit:null},{kind:"moon",r:17,mu:295000,orbit:{cx:692,cy:1066,rad:113,omega:.711,phase:4.522}}],frags:[{x:790,y:925},{x:695,y:577}],solution:{vx:-171.03256069008452,vy:-616.7234900535187,t0Step:0},fragSolution:{vx:88.88099823571196,vy:-290.71664581276275,t0Step:0}},
    {id:"c22",index:21,seed:9751,difficulty:.724,name:"Occultation",plate:"XXII",probe:{x:587,y:1363},target:{x:566,y:344,r:37},bodies:[{kind:"planet",r:63,mu:2e7,x:582,y:902,orbit:null},{kind:"repulsor",r:30,mu:-1.08e7,x:150,y:452,orbit:null},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:582,cy:902,rad:140,omega:1.134,phase:3.611}}],frags:[{x:668,y:1088},{x:685,y:751},{x:634,y:569}],solution:{vx:-267.65224254354325,vy:-297.2579301909577,t0Step:0},fragSolution:{vx:203.07498009925905,vy:-606.9271393319675,t0Step:0}},
    {id:"c23",index:22,seed:17882,difficulty:.759,name:"The Ecliptic",plate:"XXIII",probe:{x:302,y:1377},target:{x:275,y:400,r:37},bodies:[{kind:"planet",r:77,mu:3.86e7,x:310,y:935,orbit:null},{kind:"repulsor",r:30,mu:-9.46e6,x:582,y:903,orbit:null},{kind:"planet",r:38,mu:3.27e6,orbit:{cx:660,cy:474,rad:119,omega:.627,phase:2.098},pair:1},{kind:"planet",r:30,mu:2.09e6,orbit:{cx:660,cy:474,rad:119,omega:.627,phase:5.24},pair:1},{kind:"planet",r:41,mu:5.72e6,x:625,y:1261,orbit:null}],frags:[{x:63,y:1318},{x:50,y:474}],solution:{vx:-315.151078466219,vy:-557.0276454015358,t0Step:0},fragSolution:{vx:-319.9512624500452,vy:-5.584770059930763,t0Step:0}},
    {id:"c24",index:23,seed:30013,difficulty:.793,name:"Libration",plate:"XXIV",probe:{x:308,y:1480},target:{x:529,y:181,r:36},bodies:[{kind:"planet",r:53,mu:1.11e7,x:385,y:998,orbit:null},{kind:"repulsor",r:26,mu:-1.38e7,x:740,y:1108,orbit:null},{kind:"planet",r:47,mu:7.91e6,orbit:{cx:181,cy:412,rad:88,omega:-.851,phase:3.617},pair:1},{kind:"planet",r:50,mu:8.64e6,orbit:{cx:181,cy:412,rad:88,omega:-.851,phase:6.759},pair:1},{kind:"moon",r:18,mu:3.5e5,orbit:{cx:385,cy:998,rad:128,omega:-1.147,phase:5.832}}],frags:[{x:281,y:1286},{x:319,y:829}],solution:{vx:367.08891926466947,vy:-524.2573083449547,t0Step:0},fragSolution:{vx:-40.13892989477889,vy:-381.896407821417,t0Step:0}},
    {id:"c25",index:24,seed:43144,difficulty:.828,name:"Conjunction",plate:"XXV",probe:{x:287,y:1389},target:{x:245,y:337,r:36},bodies:[{kind:"planet",r:64,mu:2.01e7,x:264,y:980,orbit:null},{kind:"repulsor",r:28,mu:-8.46e6,x:459,y:621,orbit:null},{kind:"planet",r:83,mu:3.39e7,x:771,y:673,orbit:null},{kind:"moon",r:16,mu:246000,orbit:{cx:264,cy:980,rad:160,omega:1.447,phase:3.066}}],frags:[{x:185,y:1164},{x:147,y:790},{x:172,y:656}],solution:{vx:208.29548016187303,vy:-588.2082904415194,t0Step:0},fragSolution:{vx:-285.56660039027753,vy:-572.757991425296,t0Step:0}},
    {id:"c26",index:25,seed:12275,difficulty:.862,name:"The Orrery",plate:"XXVI",probe:{x:620,y:1447},target:{x:600,y:419,r:36},bodies:[{kind:"planet",r:81,mu:4.42e7,x:582,y:1058,orbit:null},{kind:"repulsor",r:24,mu:-1.11e7,x:423,y:1170,orbit:null},{kind:"planet",r:55,mu:1.15e7,x:369,y:551,orbit:null},{kind:"planet",r:31,mu:2.4e6,orbit:{cx:213,cy:892,rad:120,omega:.786,phase:4.125},pair:1},{kind:"planet",r:45,mu:6.85e6,orbit:{cx:213,cy:892,rad:120,omega:.786,phase:7.267},pair:1},{kind:"moon",r:18,mu:3.5e5,orbit:{cx:369,cy:551,rad:137,omega:1.107,phase:3.586}}],frags:[{x:215,y:1423},{x:45,y:1285},{x:138,y:483}],solution:{vx:320.00000000000006,vy:-554.2562584220407,t0Step:0},fragSolution:{vx:-300.70163865149067,vy:109.44644586421404,t0Step:0}},
    {id:"c27",index:26,seed:11406,difficulty:.897,name:"Eccentric Anomaly",plate:"XXVII",probe:{x:462,y:1397},target:{x:296,y:283,r:35},bodies:[{kind:"planet",r:41,mu:5.71e6,x:392,y:838,orbit:null},{kind:"repulsor",r:24,mu:-1.18e7,x:625,y:873,orbit:null},{kind:"planet",r:43,mu:5.41e6,orbit:{cx:622,cy:1141,rad:88,omega:.884,phase:3.313},pair:1},{kind:"planet",r:32,mu:2.47e6,orbit:{cx:622,cy:1141,rad:88,omega:.884,phase:6.455},pair:1},{kind:"blackhole",r:13,capture:48,mu:2.54e7,x:536,y:488,orbit:null}],frags:[{x:468,y:1013},{x:393,y:665}],solution:{vx:-239.74821978618388,vy:-593.3976669227438,t0Step:0},fragSolution:{vx:-38.03627982601673,vy:-333.8401435073334,t0Step:0}},
    {id:"c28",index:27,seed:124537,difficulty:.931,name:"The Ascending Node",plate:"XXVIII",probe:{x:564,y:1370},target:{x:258,y:141,r:35},bodies:[{kind:"planet",r:70,mu:2.49e7,x:388,y:746,orbit:null},{kind:"repulsor",r:26,mu:-1.23e7,x:582,y:343,orbit:null},{kind:"blackhole",r:14,capture:45,mu:2.98e7,x:771,y:876,orbit:null},{kind:"planet",r:63,mu:1.41e7,x:673,y:502,orbit:null},{kind:"moon",r:16,mu:246000,orbit:{cx:388,cy:746,rad:131,omega:1.277,phase:6.061}}],frags:[{x:402,y:1160},{x:198,y:560}],solution:{vx:-77.59149465995459,vy:-489.89341693518827,t0Step:0},fragSolution:{vx:-415.6467509313174,vy:-486.6598179840199,t0Step:0}},
    {id:"c29",index:28,seed:42668,difficulty:.966,name:"Harmony of the Spheres",plate:"XXIX",probe:{x:493,y:1416},target:{x:439,y:186,r:34},bodies:[{kind:"planet",r:82,mu:3.61e7,x:481,y:944,orbit:null},{kind:"repulsor",r:27,mu:-1.09e7,x:254,y:415,orbit:null},{kind:"blackhole",r:13,capture:39,mu:3.23e7,x:150,y:555,orbit:null},{kind:"planet",r:52,mu:9.52e6,x:690,y:1283,orbit:null},{kind:"planet",r:58,mu:1.49e7,x:781,y:735,orbit:null}],frags:[{x:543,y:1227},{x:545,y:597},{x:476,y:374}],solution:{vx:-357.8834582212778,vy:-530.5840464352268,t0Step:0},fragSolution:{vx:157.36197942233235,vy:-587.2829023837536,t0Step:0}},
    {id:"c30",index:29,seed:50799,difficulty:1,name:"Perihelion",plate:"XXX",probe:{x:430,y:1369},target:{x:689,y:314,r:34},bodies:[{kind:"planet",r:68,mu:1.87e7,x:554,y:791,orbit:null},{kind:"repulsor",r:29,mu:-9.45e6,x:245,y:479,orbit:null},{kind:"planet",r:45,mu:6.24e6,orbit:{cx:232,cy:1054,rad:122,omega:.667,phase:.471},pair:1},{kind:"planet",r:37,mu:2.79e6,orbit:{cx:232,cy:1054,rad:122,omega:.667,phase:3.613},pair:1},{kind:"moon",r:13,mu:132000,orbit:{cx:554,cy:791,rad:128,omega:1.257,phase:5.964}}],frags:[{x:566,y:1142},{x:705,y:524}],solution:{vx:18.84357534182505,vy:-431.58883172336255,t0Step:0},fragSolution:{vx:348.56898240961704,vy:-536.7491634850716,t0Step:0}}
  ].concat([
    {id:"c31",index:30,seed:59930,difficulty:1.02,name:"Argo Navis",plate:"XXXI",probe:{x:238,y:1396},target:{x:647,y:230,r:34},bodies:[{kind:"planet",r:49,mu:8.57e6,x:437,y:910,orbit:null},{kind:"repulsor",r:29,mu:-8.93e6,x:368,y:1172,orbit:null},{kind:"planet",r:64,mu:1.47e7,x:669,y:1011,orbit:null},{kind:"blackhole",r:14,capture:47,mu:2.77e7,x:541,y:1164,orbit:null}],frags:[{x:201,y:976},{x:243,y:571},{x:370,y:395}],solution:{vx:66.898,vy:-636.494,t0Step:0},fragSolution:{vx:55.4,vy:-298.909,t0Step:0}},
    {id:"c32",index:31,seed:67061,difficulty:1.04,name:"Quadrans Muralis",plate:"XXXII",probe:{x:544,y:1353},target:{x:228,y:250,r:34},bodies:[{kind:"planet",r:72,mu:2.55e7,x:378,y:707,orbit:null},{kind:"repulsor",r:24,mu:-1.18e7,x:392,y:419,orbit:null},{kind:"planet",r:49,mu:9.79e6,x:533,y:659,orbit:null},{kind:"planet",r:37,mu:3.26e6,orbit:{cx:615,cy:940,rad:99,omega:-.638,phase:2.284},pair:1},{kind:"planet",r:36,mu:3.29e6,orbit:{cx:615,cy:940,rad:99,omega:-.638,phase:5.426},pair:1}],frags:[{x:174,y:1205},{x:51,y:395}],solution:{vx:-305.47,vy:-305.47,t0Step:0},fragSolution:{vx:-255.523,vy:-15.628,t0Step:0}},
    {id:"c33",index:32,seed:43192,difficulty:1.06,name:"Custos Messium",plate:"XXXIII",probe:{x:552,y:1383},target:{x:205,y:242,r:33},bodies:[{kind:"planet",r:59,mu:1.41e7,x:388,y:898,orbit:null},{kind:"repulsor",r:29,mu:-1.21e7,x:582,y:851,orbit:null},{kind:"planet",r:84,mu:4.39e7,x:543,y:682,orbit:null},{kind:"blackhole",r:12,capture:40,mu:3.95e7,x:257,y:1174,orbit:null}],frags:[{x:560,y:1129},{x:355,y:664},{x:295,y:531}],solution:{vx:270.416,vy:-508.578,t0Step:0},fragSolution:{vx:94.598,vy:-632.97,t0Step:0}},
    {id:"c34",index:33,seed:61323,difficulty:1.08,name:"Honores Frederici",plate:"XXXIV",probe:{x:338,y:1438},target:{x:422,y:342,r:33},bodies:[{kind:"planet",r:57,mu:1.12e7,x:405,y:889,orbit:null},{kind:"repulsor",r:28,mu:-1.25e7,x:487,y:785,orbit:null},{kind:"planet",r:41,mu:4.64e6,orbit:{cx:644,cy:1015,rad:128,omega:.562,phase:3.949},pair:1},{kind:"planet",r:32,mu:2.42e6,orbit:{cx:644,cy:1015,rad:128,omega:.562,phase:7.091},pair:1},{kind:"planet",r:48,mu:6.57e6,x:609,y:711,orbit:null}],frags:[{x:135,y:1291},{x:42,y:670},{x:204,y:474}],solution:{vx:-66.898,vy:-636.494,t0Step:0},fragSolution:{vx:-147.281,vy:-62.517,t0Step:0}},
    {id:"c35",index:34,seed:36454,difficulty:1.1,name:"Globus Aerostaticus",plate:"XXXV",probe:{x:423,y:1457},target:{x:713,y:349,r:33},bodies:[{kind:"planet",r:41,mu:5.84e6,x:591,y:869,orbit:null},{kind:"repulsor",r:29,mu:-9.06e6,x:530,y:705,orbit:null},{kind:"planet",r:59,mu:1.43e7,x:361,y:839,orbit:null},{kind:"moon",r:13,mu:132000,orbit:{cx:361,cy:839,rad:117,omega:-.589,phase:2.095}}],frags:[{x:719,y:1269},{x:852,y:774},{x:772,y:616}],solution:{vx:209.438,vy:-377.836,t0Step:0},fragSolution:{vx:152.595,vy:-48.113,t0Step:0}},
    {id:"c36",index:35,seed:93585,difficulty:1.12,name:"Brandenburg Sceptre",plate:"XXXVI",probe:{x:582,y:1433},target:{x:320,y:419,r:33},bodies:[{kind:"planet",r:54,mu:9.71e6,x:459,y:931,orbit:null},{kind:"repulsor",r:29,mu:-9.51e6,x:598,y:991,orbit:null},{kind:"blackhole",r:15,capture:38,mu:2.98e7,x:696,y:1065,orbit:null},{kind:"planet",r:40,mu:3.9e6,orbit:{cx:666,cy:799,rad:96,omega:-.537,phase:2.088},pair:1},{kind:"planet",r:40,mu:4.77e6,orbit:{cx:666,cy:799,rad:96,omega:-.537,phase:5.23},pair:1}],frags:[{x:365,y:1027},{x:324,y:891}],solution:{vx:-135.058,vy:-609.209,t0Step:0},fragSolution:{vx:-380.687,vy:-514.468,t0Step:0}},
    {id:"c37",index:36,seed:129716,difficulty:1.14,name:"Mons Maenalus",plate:"XXXVII",probe:{x:301,y:1395},target:{x:685,y:403,r:32},bodies:[{kind:"planet",r:77,mu:3.72e7,x:462,y:1049,orbit:null},{kind:"repulsor",r:26,mu:-1.23e7,x:400,y:1175,orbit:null},{kind:"blackhole",r:14,capture:40,mu:2.99e7,x:632,y:1299,orbit:null},{kind:"moon",r:15,mu:203000,orbit:{cx:632,cy:1299,rad:110,omega:.91,phase:.442}}],frags:[{x:716,y:1477},{x:854,y:566}],solution:{vx:-55.78,vy:-637.565,t0Step:0},fragSolution:{vx:336.551,vy:244.519,t0Step:0}},
    {id:"c38",index:37,seed:118847,difficulty:1.16,name:"Telescopium Herschelii",plate:"XXXVIII",probe:{x:470,y:1458},target:{x:440,y:338,r:32},bodies:[{kind:"planet",r:45,mu:7.15e6,x:481,y:957,orbit:null},{kind:"repulsor",r:30,mu:-1.38e7,x:596,y:803,orbit:null},{kind:"blackhole",r:15,capture:46,mu:3.55e7,x:692,y:1076,orbit:null},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:692,cy:1076,rad:132,omega:-1.214,phase:.315}}],frags:[{x:76,y:844},{x:117,y:671}],solution:{vx:-218.893,vy:-601.403,t0Step:0},fragSolution:{vx:-300.702,vy:-109.446,t0Step:0}},
    {id:"c39",index:38,seed:195478,difficulty:1.18,name:"Officina Typographica",plate:"XXXIX",probe:{x:477,y:1453},target:{x:282,y:220,r:32},bodies:[{kind:"planet",r:68,mu:2.25e7,x:332,y:743,orbit:null},{kind:"repulsor",r:23,mu:-1.12e7,x:420,y:499,orbit:null},{kind:"planet",r:36,mu:2.63e6,orbit:{cx:546,cy:1018,rad:131,omega:.506,phase:3.956},pair:1},{kind:"planet",r:39,mu:3.8e6,orbit:{cx:546,cy:1018,rad:131,omega:.506,phase:7.098},pair:1},{kind:"moon",r:15,mu:203000,orbit:{cx:332,cy:743,rad:123,omega:-1.56,phase:4.026}}],frags:[{x:73,y:1235},{x:66,y:366}],solution:{vx:-247.785,vy:-353.874,t0Step:0},fragSolution:{vx:-219.884,vy:-42.741,t0Step:0}},
    {id:"c40",index:39,seed:144109,difficulty:1.2,name:"Machina Electrica",plate:"XL",probe:{x:609,y:1373},target:{x:597,y:283,r:32},bodies:[{kind:"planet",r:61,mu:1.82e7,x:572,y:962,orbit:null},{kind:"repulsor",r:23,mu:-1.14e7,x:610,y:1089,orbit:null},{kind:"planet",r:69,mu:2.56e7,x:335,y:1210,orbit:null},{kind:"planet",r:51,mu:8.79e6,x:725,y:873,orbit:null},{kind:"moon",r:13,mu:132000,orbit:{cx:335,cy:1210,rad:153,omega:-1.366,phase:.086}}],frags:[{x:56,y:1357},{x:122,y:335}],solution:{vx:195.934,vy:-473.026,t0Step:0},fragSolution:{vx:-297.718,vy:216.305,t0Step:0}},
    {id:"c41",index:40,seed:373240,difficulty:1.22,name:"Lochium Funis",plate:"XLI",probe:{x:676,y:1414},target:{x:438,y:224,r:31},bodies:[{kind:"planet",r:58,mu:1.42e7,x:588,y:979,orbit:null},{kind:"repulsor",r:29,mu:-1.18e7,x:415,y:917,orbit:null},{kind:"planet",r:39,mu:4.54e6,orbit:{cx:371,cy:1145,rad:128,omega:.95,phase:1.806},pair:1},{kind:"planet",r:40,mu:4.94e6,orbit:{cx:371,cy:1145,rad:128,omega:.95,phase:4.948},pair:1},{kind:"blackhole",r:12,capture:40,mu:2.74e7,x:388,y:727,orbit:null},{kind:"moon",r:15,mu:203000,orbit:{cx:388,cy:727,rad:105,omega:.683,phase:4.806}}],frags:[{x:727,y:1084},{x:667,y:677}],solution:{vx:-218.809,vy:-515.483,t0Step:0},fragSolution:{vx:133.063,vy:-626.014,t0Step:0}},
    {id:"c42",index:41,seed:250371,difficulty:1.24,name:"Tarandus",plate:"XLII",probe:{x:448,y:1461},target:{x:326,y:244,r:31},bodies:[{kind:"planet",r:60,mu:1.29e7,x:360,y:814,orbit:null},{kind:"repulsor",r:25,mu:-1.18e7,x:424,y:606,orbit:null},{kind:"planet",r:58,mu:1.56e7,x:492,y:1025,orbit:null},{kind:"planet",r:51,mu:1.05e7,x:547,y:800,orbit:null},{kind:"moon",r:15,mu:203000,orbit:{cx:492,cy:1025,rad:112,omega:1.114,phase:4.111}}],frags:[{x:87,y:1249},{x:81,y:451}],solution:{vx:-285.567,vy:-572.758,t0Step:0},fragSolution:{vx:-267.868,vy:-47.232,t0Step:0}},
    {id:"c43",index:42,seed:653502,difficulty:1.26,name:"Cerberus",plate:"XLIII",probe:{x:262,y:1467},target:{x:505,y:146,r:31},bodies:[{kind:"planet",r:78,mu:3.38e7,x:322,y:945,orbit:null},{kind:"repulsor",r:22,mu:-9.9e6,x:402,y:782,orbit:null},{kind:"planet",r:42,mu:4.58e6,x:166,y:1171,orbit:null},{kind:"blackhole",r:14,capture:40,mu:2.8e7,x:82,y:954,orbit:null},{kind:"moon",r:13,mu:132000,orbit:{cx:166,cy:1171,rad:110,omega:1.393,phase:3.591}}],frags:[{x:586,y:1296},{x:780,y:819},{x:675,y:367}],solution:{vx:388.449,vy:-488.347,t0Step:0},fragSolution:{vx:390.518,vy:-86.576,t0Step:0}},
    {id:"c44",index:43,seed:425633,difficulty:1.28,name:"Antinous",plate:"XLIV",probe:{x:333,y:1371},target:{x:646,y:261,r:31},bodies:[{kind:"planet",r:48,mu:7.11e6,x:497,y:731,orbit:null},{kind:"repulsor",r:29,mu:-1.2e7,x:481,y:565,orbit:null},{kind:"planet",r:55,mu:1.29e7,x:277,y:869,orbit:null},{kind:"planet",r:44,mu:6.46e6,orbit:{cx:272,cy:488,rad:96,omega:.942,phase:5.297},pair:1},{kind:"planet",r:49,mu:8.83e6,orbit:{cx:272,cy:488,rad:96,omega:.942,phase:8.439},pair:1},{kind:"moon",r:15,mu:203000,orbit:{cx:277,cy:869,rad:121,omega:-.895,phase:.186}}],frags:[{x:714,y:1032},{x:748,y:734},{x:678,y:530}],solution:{vx:290.554,vy:-570.244,t0Step:0},fragSolution:{vx:197.82,vy:-64.276,t0Step:0}},
    {id:"c45",index:44,seed:341764,difficulty:1.3,name:"Noctua",plate:"XLV",probe:{x:504,y:1351},target:{x:248,y:189,r:30},bodies:[{kind:"planet",r:42,mu:5.76e6,x:385,y:795,orbit:null},{kind:"repulsor",r:23,mu:-8.38e6,x:412,y:617,orbit:null},{kind:"blackhole",r:13,capture:39,mu:3.81e7,x:496,y:1056,orbit:null},{kind:"moon",r:18,mu:3.5e5,orbit:{cx:496,cy:1056,rad:107,omega:1.187,phase:5.653}},{kind:"moon",r:19,mu:412000,orbit:{cx:385,cy:795,rad:98,omega:-.796,phase:.494}}],frags:[{x:64,y:1081},{x:41,y:455},{x:97,y:332}],solution:{vx:-490.268,vy:-411.384,t0Step:0},fragSolution:{vx:-447.983,vy:3.909,t0Step:0}},
    {id:"c46",index:45,seed:3002395,difficulty:1.32,name:"The Transit of Venus",plate:"XLVI",probe:{x:336,y:1429},target:{x:527,y:165,r:30},bodies:[{kind:"planet",r:50,mu:9.84e6,x:430,y:916,orbit:null},{kind:"repulsor",r:23,mu:-8.79e6,x:415,y:1066,orbit:null},{kind:"planet",r:40,mu:3.57e6,x:578,y:876,orbit:null},{kind:"planet",r:45,mu:7.58e6,x:464,y:1212,orbit:null},{kind:"planet",r:38,mu:3.05e6,orbit:{cx:658,cy:623,rad:88,omega:-.638,phase:2.156},pair:1},{kind:"planet",r:47,mu:8.5e6,orbit:{cx:658,cy:623,rad:88,omega:-.638,phase:5.298},pair:1}],frags:[{x:44,y:948},{x:118,y:492}],solution:{vx:-81.642,vy:-440.498,t0Step:0},fragSolution:{vx:-201.281,vy:-130.713,t0Step:0}},
    {id:"c47",index:46,seed:3460526,difficulty:1.34,name:"The Zenith Sector",plate:"XLVII",probe:{x:235,y:1382},target:{x:710,y:191,r:30},bodies:[{kind:"planet",r:42,mu:6.21e6,x:451,y:888,orbit:null},{kind:"repulsor",r:23,mu:-1.27e7,x:668,y:829,orbit:null},{kind:"planet",r:51,mu:9.77e6,x:492,y:1155,orbit:null},{kind:"planet",r:39,mu:3.79e6,orbit:{cx:217,cy:619,rad:88,omega:-.57,phase:2.829},pair:1},{kind:"planet",r:38,mu:3.36e6,orbit:{cx:217,cy:619,rad:88,omega:-.57,phase:5.971},pair:1},{kind:"planet",r:59,mu:1.57e7,x:668,y:592,orbit:null}],frags:[{x:271,y:1058},{x:373,y:759},{x:458,y:552}],solution:{vx:247.974,vy:-519.889,t0Step:0},fragSolution:{vx:25.959,vy:-495.32,t0Step:0}},
    {id:"c48",index:47,seed:613157,difficulty:1.36,name:"Georgium Sidus",plate:"XLVIII",probe:{x:600,y:1430},target:{x:358,y:400,r:30},bodies:[{kind:"planet",r:50,mu:8.34e6,x:467,y:770,orbit:null},{kind:"repulsor",r:22,mu:-1.07e7,x:507,y:574,orbit:null},{kind:"planet",r:42,mu:4.59e6,orbit:{cx:699,cy:982,rad:115,omega:-.967,phase:1.359},pair:1},{kind:"planet",r:42,mu:6.2e6,orbit:{cx:699,cy:982,rad:115,omega:-.967,phase:4.501},pair:1},{kind:"planet",r:37,mu:3.99e6,orbit:{cx:678,cy:489,rad:94,omega:.789,phase:1.074},pair:2},{kind:"planet",r:36,mu:2.77e6,orbit:{cx:678,cy:489,rad:94,omega:.789,phase:4.216},pair:2},{kind:"moon",r:18,mu:3.5e5,orbit:{cx:467,cy:770,rad:103,omega:-.665,phase:.875}}],frags:[{x:354,y:1037},{x:306,y:835}],solution:{vx:-242.732,vy:-486.844,t0Step:0},fragSolution:{vx:-212.038,vy:-239.666,t0Step:0}},
    {id:"c49",index:48,seed:2402288,difficulty:1.38,name:"Leverrier's Planet",plate:"XLIX",probe:{x:266,y:1449},target:{x:536,y:196,r:29},bodies:[{kind:"planet",r:45,mu:5.58e6,x:424,y:636,orbit:null},{kind:"repulsor",r:27,mu:-9.23e6,x:197,y:439,orbit:null},{kind:"planet",r:48,mu:8.25e6,x:420,y:895,orbit:null},{kind:"planet",r:42,mu:4.7e6,orbit:{cx:608,cy:514,rad:85,omega:-.797,phase:1.583},pair:1},{kind:"planet",r:42,mu:5.34e6,orbit:{cx:608,cy:514,rad:85,omega:-.797,phase:4.725},pair:1},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:420,cy:895,rad:148,omega:-.957,phase:1.626}}],frags:[{x:452,y:1360},{x:765,y:346}],solution:{vx:-66.898,vy:-636.494,t0Step:0},fragSolution:{vx:179.841,vy:-67.24,t0Step:0}},
    {id:"c50",index:49,seed:179919,difficulty:1.4,name:"The Zodiacal Light",plate:"L",probe:{x:306,y:1479},target:{x:205,y:319,r:29},bodies:[{kind:"planet",r:40,mu:4.02e6,x:277,y:924,orbit:null},{kind:"repulsor",r:26,mu:-9.25e6,x:474,y:864,orbit:null},{kind:"planet",r:35,mu:3.61e6,orbit:{cx:510,cy:1202,rad:128,omega:-.529,phase:2.524},pair:1},{kind:"planet",r:47,mu:7.4e6,orbit:{cx:510,cy:1202,rad:128,omega:-.529,phase:5.666},pair:1},{kind:"planet",r:32,mu:2.35e6,orbit:{cx:506,cy:646,rad:109,omega:-.944,phase:6.044},pair:2},{kind:"planet",r:35,mu:2.93e6,orbit:{cx:506,cy:646,rad:109,omega:-.944,phase:9.186},pair:2},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:277,cy:924,rad:122,omega:-.641,phase:5.649}}],frags:[{x:213,y:1143},{x:183,y:767}],solution:{vx:5.166,vy:-591.977,t0Step:0},fragSolution:{vx:-181.591,vy:-512.797,t0Step:0}},
    {id:"c51",index:50,seed:463550,difficulty:1.42,name:"Encke's Comet",plate:"LI",probe:{x:387,y:1399},target:{x:670,y:181,r:29},bodies:[{kind:"planet",r:59,mu:1.31e7,x:531,y:890,orbit:null},{kind:"repulsor",r:30,mu:-1.33e7,x:333,y:915,orbit:null},{kind:"planet",r:49,mu:7.32e6,orbit:{cx:294,cy:654,rad:98,omega:.944,phase:.355},pair:1},{kind:"planet",r:48,mu:7.74e6,orbit:{cx:294,cy:654,rad:98,omega:.944,phase:3.497},pair:1},{kind:"blackhole",r:12,capture:50,mu:2.98e7,x:309,y:1120,orbit:null},{kind:"moon",r:22,mu:639000,orbit:{cx:309,cy:1120,rad:113,omega:1.484,phase:3.825}},{kind:"moon",r:14,mu:165000,orbit:{cx:531,cy:890,rad:111,omega:1.557,phase:3.914}}],frags:[{x:787,y:1242},{x:838,y:323}],solution:{vx:218.893,vy:-601.403,t0Step:0},fragSolution:{vx:415.747,vy:14.518,t0Step:0}},
    {id:"c52",index:51,seed:1137681,difficulty:1.44,name:"Piazzi's Ceres",plate:"LII",probe:{x:270,y:1381},target:{x:511,y:315,r:29},bodies:[{kind:"planet",r:40,mu:5.38e6,x:427,y:745,orbit:null},{kind:"repulsor",r:25,mu:-1.4e7,x:611,y:453,orbit:null},{kind:"planet",r:66,mu:1.78e7,x:653,y:638,orbit:null},{kind:"planet",r:35,mu:2.83e6,orbit:{cx:593,cy:1022,rad:123,omega:.871,phase:1.62},pair:1},{kind:"planet",r:44,mu:5.65e6,orbit:{cx:593,cy:1022,rad:123,omega:.871,phase:4.762},pair:1},{kind:"planet",r:51,mu:8.14e6,x:221,y:483,orbit:null},{kind:"moon",r:17,mu:295000,orbit:{cx:221,cy:483,rad:127,omega:.71,phase:1.01}}],frags:[{x:50,y:1240},{x:291,y:227}],solution:{vx:36.141,vy:-590.896,t0Step:0},fragSolution:{vx:-193.527,vy:-76.232,t0Step:0}},
    {id:"c53",index:52,seed:3388812,difficulty:1.46,name:"Olbers' Paradox",plate:"LIII",probe:{x:316,y:1369},target:{x:268,y:375,r:28},bodies:[{kind:"planet",r:51,mu:9.81e6,x:317,y:804,orbit:null},{kind:"repulsor",r:25,mu:-1.27e7,x:431,y:530,orbit:null},{kind:"planet",r:58,mu:1.38e7,x:502,y:738,orbit:null},{kind:"planet",r:35,mu:3.41e6,orbit:{cx:513,cy:1064,rad:137,omega:.93,phase:3.724},pair:1},{kind:"planet",r:43,mu:6.02e6,orbit:{cx:513,cy:1064,rad:137,omega:.93,phase:6.866},pair:1}],frags:[{x:139,y:998},{x:121,y:836},{x:145,y:678}],solution:{vx:-187.118,vy:-612.035,t0Step:0},fragSolution:{vx:-202.21,vy:-268.342,t0Step:0}},
    {id:"c54",index:53,seed:536943,difficulty:1.48,name:"Struve's Doubles",plate:"LIV",probe:{x:670,y:1457},target:{x:258,y:149,r:28},bodies:[{kind:"planet",r:69,mu:2.05e7,x:461,y:881,orbit:null},{kind:"repulsor",r:23,mu:-1.01e7,x:321,y:741,orbit:null},{kind:"planet",r:31,mu:2.25e6,orbit:{cx:266,cy:1064,rad:131,omega:.752,phase:4.596},pair:1},{kind:"planet",r:31,mu:1.9e6,orbit:{cx:266,cy:1064,rad:131,omega:.752,phase:7.738},pair:1},{kind:"planet",r:67,mu:2.39e7,x:661,y:590,orbit:null},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:661,cy:590,rad:130,omega:1.321,phase:5.751}}],frags:[{x:322,y:1427},{x:57,y:418}],solution:{vx:-78.043,vy:-522.2,t0Step:0},fragSolution:{vx:-218.69,vy:48.482,t0Step:0}},
    {id:"c55",index:54,seed:841324,difficulty:1.5,name:"The Meridian Circle",plate:"LV",probe:{x:389,y:1392},target:{x:400,y:334,r:28},bodies:[{kind:"planet",r:62,mu:1.74e7,x:357,y:1016,orbit:null},{kind:"repulsor",r:30,mu:-8.12e6,x:487,y:792,orbit:null},{kind:"planet",r:48,mu:9.33e6,orbit:{cx:581,cy:1142,rad:91,omega:-.911,phase:4.413},pair:1},{kind:"planet",r:39,mu:3.85e6,orbit:{cx:581,cy:1142,rad:91,omega:-.911,phase:7.555},pair:1},{kind:"planet",r:53,mu:9.22e6,x:152,y:1244,orbit:null}],frags:[{x:821,y:905},{x:662,y:593},{x:571,y:418}],solution:{vx:-202.857,vy:-435.028,t0Step:0},fragSolution:{vx:366.866,vy:28.873,t0Step:0}},
    {id:"c56",index:55,seed:1297205,difficulty:1.52,name:"The Heliometer",plate:"LVI",probe:{x:298,y:1382},target:{x:443,y:278,r:28},bodies:[{kind:"planet",r:46,mu:7.26e6,x:356,y:912,orbit:null},{kind:"repulsor",r:28,mu:-1.29e7,x:582,y:894,orbit:null},{kind:"planet",r:35,mu:3.31e6,orbit:{cx:565,cy:1137,rad:116,omega:-.763,phase:5.394},pair:1},{kind:"planet",r:42,mu:4.08e6,orbit:{cx:565,cy:1137,rad:116,omega:-.763,phase:8.536},pair:1},{kind:"planet",r:50,mu:9.62e6,x:535,y:622,orbit:null}],frags:[{x:252,y:882},{x:323,y:578}],solution:{vx:203.155,vy:-590.004,t0Step:0},fragSolution:{vx:-91.686,vy:-519.978,t0Step:0}},
    {id:"c57",index:56,seed:776336,difficulty:1.54,name:"Cassini's Division",plate:"LVII",probe:{x:537,y:1353},target:{x:639,y:246,r:28},bodies:[{kind:"planet",r:45,mu:5.71e6,x:612,y:660,orbit:null},{kind:"repulsor",r:23,mu:-9.31e6,x:697,y:388,orbit:null},{kind:"planet",r:41,mu:4.29e6,x:734,y:926,orbit:null},{kind:"blackhole",r:12,capture:50,mu:3.85e7,x:791,y:670,orbit:null},{kind:"planet",r:43,mu:4.55e6,x:390,y:406,orbit:null},{kind:"moon",r:17,mu:295000,orbit:{cx:390,cy:406,rad:118,omega:1.54,phase:4.131}},{kind:"moon",r:15,mu:203000,orbit:{cx:734,cy:926,rad:97,omega:-.544,phase:1.164}}],frags:[{x:241,y:1006},{x:200,y:729},{x:342,y:356}],solution:{vx:-94.598,vy:-632.97,t0Step:0},fragSolution:{vx:-221.703,vy:-128,t0Step:0}},
    {id:"c58",index:57,seed:521967,difficulty:1.56,name:"The Nautical Almanac",plate:"LVIII",probe:{x:488,y:1351},target:{x:702,y:387,r:27},bodies:[{kind:"planet",r:52,mu:1.12e7,x:554,y:917,orbit:null},{kind:"repulsor",r:23,mu:-9.46e6,x:555,y:680,orbit:null},{kind:"planet",r:52,mu:9.93e6,x:711,y:1216,orbit:null},{kind:"blackhole",r:14,capture:42,mu:3.69e7,x:411,y:1056,orbit:null},{kind:"planet",r:47,mu:7.9e6,orbit:{cx:329,cy:860,rad:91,omega:.672,phase:.103},pair:1},{kind:"planet",r:39,mu:4.04e6,orbit:{cx:329,cy:860,rad:91,omega:.672,phase:3.245},pair:1},{kind:"moon",r:14,mu:165000,orbit:{cx:711,cy:1216,rad:106,omega:1.103,phase:.633}}],frags:[{x:167,y:790},{x:424,y:582},{x:559,y:519}],solution:{vx:367.089,vy:-524.257,t0Step:0},fragSolution:{vx:-504.978,vy:-84.504,t0Step:0}},
    {id:"c59",index:58,seed:598598,difficulty:1.58,name:"The Great Comet",plate:"LIX",probe:{x:642,y:1473},target:{x:315,y:261,r:27},bodies:[{kind:"planet",r:46,mu:8.02e6,x:417,y:738,orbit:null},{kind:"repulsor",r:29,mu:-1.07e7,x:263,y:463,orbit:null},{kind:"planet",r:37,mu:3.02e6,orbit:{cx:245,cy:976,rad:98,omega:-.771,phase:.309},pair:1},{kind:"planet",r:37,mu:3.51e6,orbit:{cx:245,cy:976,rad:98,omega:-.771,phase:3.451},pair:1},{kind:"blackhole",r:14,capture:46,mu:3.84e7,x:487,y:940,orbit:null},{kind:"moon",r:18,mu:3.5e5,orbit:{cx:417,cy:738,rad:100,omega:-1.02,phase:4.053}}],frags:[{x:786,y:1014},{x:656,y:627},{x:544,y:499}],solution:{vx:122.118,vy:-628.241,t0Step:0},fragSolution:{vx:201.681,vy:-363.842,t0Step:0}},
    {id:"c60",index:59,seed:1170229,difficulty:1.6,name:"Halley's Return",plate:"LX",probe:{x:246,y:1427},target:{x:656,y:363,r:27},bodies:[{kind:"planet",r:59,mu:1.45e7,x:489,y:870,orbit:null},{kind:"repulsor",r:30,mu:-1.34e7,x:469,y:704,orbit:null},{kind:"planet",r:35,mu:3.54e6,orbit:{cx:286,cy:977,rad:86,omega:-.658,phase:3.694},pair:1},{kind:"planet",r:41,mu:5.65e6,orbit:{cx:286,cy:977,rad:86,omega:-.658,phase:6.836},pair:1},{kind:"planet",r:33,mu:2.17e6,orbit:{cx:250,cy:664,rad:117,omega:-.603,phase:2.654},pair:2},{kind:"planet",r:37,mu:4.27e6,orbit:{cx:250,cy:664,rad:117,omega:-.603,phase:5.796},pair:2}],frags:[{x:858,y:860},{x:812,y:697}],solution:{vx:385.162,vy:-511.127,t0Step:0},fragSolution:{vx:189.891,vy:28.379,t0Step:0}}
  ]).concat([
    {id:"c61",index:60,seed:739820,difficulty:1.62,name:"The Looking-Glass",plate:"LXI",probe:{x:377,y:1343},target:{x:700,y:237,r:38},bodies:[{kind:"repulsor",r:25,mu:-1.05e7,x:570,y:609,orbit:null},{kind:"wormhole",r:36,mu:0,x:234,y:693,orbit:null,pair:2,turn:0},{kind:"wormhole",r:37,mu:0,x:746,y:446,orbit:null,pair:1,turn:0}],frags:[{x:343,y:932},{x:312,y:802}],solution:{vx:-89.317,vy:-439.006,t0Step:0},fragSolution:{vx:-29.284,vy:-334.721,t0Step:0}},
    {id:"c62",index:61,seed:668917,difficulty:1.64,name:"The Aperture",plate:"LXII",probe:{x:723,y:1362},target:{x:229,y:417,r:38},bodies:[{kind:"repulsor",r:28,mu:-1.15e7,x:398,y:725,orbit:null},{kind:"wormhole",r:34,mu:0,x:192,y:708,orbit:null,pair:2,turn:0},{kind:"wormhole",r:36,mu:0,x:809,y:678,orbit:null,pair:1,turn:0}],frags:[{x:779,y:971},{x:806,y:808}],solution:{vx:-5.864,vy:-335.949,t0Step:0},fragSolution:{vx:44.472,vy:-461.864,t0Step:0}},
    {id:"c63",index:62,seed:77014,difficulty:1.66,name:"Camera Obscura",plate:"LXIII",probe:{x:238,y:1468},target:{x:483,y:203,r:37},bodies:[{kind:"repulsor",r:26,mu:-1.04e7,x:377,y:836,orbit:null},{kind:"wormhole",r:34,mu:0,x:645,y:945,orbit:null,pair:2,turn:0},{kind:"wormhole",r:34,mu:0,x:95,y:702,orbit:null,pair:1,turn:0}],frags:[{x:176,y:1063},{x:570,y:676}],solution:{vx:200.639,vy:-327.414,t0Step:0},fragSolution:{vx:-82.39,vy:-586.239,t0Step:0}},
    {id:"c64",index:63,seed:84111,difficulty:1.68,name:"The Speculum",plate:"LXIV",probe:{x:479,y:1415},target:{x:299,y:595,r:36},bodies:[{kind:"repulsor",r:25,mu:-1.22e7,x:373,y:999,orbit:null},{kind:"planet",r:57,mu:4.55e6,x:288,y:879,orbit:null},{kind:"wormhole",r:35,mu:0,x:649,y:1147,orbit:null,pair:3,turn:0},{kind:"wormhole",r:31,mu:0,x:79,y:942,orbit:null,pair:2,turn:0}],frags:[{x:359,y:1221},{x:207,y:1041},{x:459,y:957}],solution:{vx:153.12,vy:-352.151,t0Step:0},fragSolution:{vx:-339.148,vy:-542.751,t0Step:0}},
    {id:"c65",index:64,seed:256208,difficulty:1.7,name:"The Postern Gate",plate:"LXV",probe:{x:270,y:1319},target:{x:736,y:479,r:36},bodies:[{kind:"blackhole",r:16,capture:44,mu:2.77e7,x:510,y:913,orbit:null},{kind:"repulsor",r:23,mu:-1.39e7,x:416,y:1043,orbit:null},{kind:"wormhole",r:31,mu:0,x:156,y:392,orbit:null,pair:3,turn:0},{kind:"wormhole",r:32,mu:0,x:774,y:789,orbit:null,pair:2,turn:0}],frags:[{x:315,y:1074},{x:231,y:761}],solution:{vx:0,vy:-336,t0Step:0},fragSolution:{vx:112.17,vy:-433.73,t0Step:0}},
    {id:"c66",index:65,seed:80305,difficulty:1.72,name:"The Mirror Door",plate:"LXVI",probe:{x:636,y:1448},target:{x:342,y:286,r:35},bodies:[{kind:"repulsor",r:25,mu:-9.75e6,x:453,y:806,orbit:null},{kind:"planet",r:41,mu:1.34e6,x:561,y:493,orbit:null},{kind:"wormhole",r:32,mu:0,x:786,y:750,orbit:null,pair:3,turn:0},{kind:"wormhole",r:30,mu:0,x:222,y:844,orbit:null,pair:2,turn:0}],frags:[{x:551,y:1256},{x:534,y:614}],solution:{vx:56.547,vy:-460.541,t0Step:0},fragSolution:{vx:-185.783,vy:-407.663,t0Step:0}},
    {id:"c67",index:66,seed:317402,difficulty:1.74,name:"The Periscope",plate:"LXVII",probe:{x:662,y:1317},target:{x:231,y:331,r:34},bodies:[{kind:"repulsor",r:30,mu:-1.27e7,x:438,y:824,orbit:null},{kind:"planet",r:60,mu:9.44e6,x:504,y:1037,orbit:null},{kind:"moon",r:15,mu:203000,orbit:{cx:504,cy:1037,rad:112,omega:-1.325,phase:5.096}},{kind:"wormhole",r:30,mu:0,x:347,y:1191,orbit:null,pair:4,turn:1.5707963267948966},{kind:"wormhole",r:32,mu:0,x:77,y:715,orbit:null,pair:3,turn:-1.5707963267948966}],frags:[{x:473,y:1305},{x:187,y:619}],solution:{vx:-488.303,vy:-153.961,t0Step:380},fragSolution:{vx:-125.857,vy:23.326,t0Step:0}},
    {id:"c68",index:67,seed:831499,difficulty:1.76,name:"The Kaleidoscope",plate:"LXVIII",probe:{x:230,y:1407},target:{x:713,y:274,r:34},bodies:[{kind:"repulsor",r:26,mu:-1.49e7,x:497,y:822,orbit:null},{kind:"planet",r:59,mu:5.78e6,x:510,y:1112,orbit:null},{kind:"wormhole",r:31,mu:0,x:767,y:1200,orbit:null,pair:3,turn:-1.5707963267948966},{kind:"wormhole",r:28,mu:0,x:812,y:531,orbit:null,pair:2,turn:1.5707963267948966}],frags:[{x:525,y:1356},{x:653,y:1302}],solution:{vx:449.603,vy:-168.1,t0Step:0},fragSolution:{vx:187.449,vy:-41.556,t0Step:0}},
    {id:"c69",index:68,seed:2338596,difficulty:1.78,name:"The Heliostat",plate:"LXIX",probe:{x:516,y:1379},target:{x:280,y:634,r:33},bodies:[{kind:"repulsor",r:25,mu:-1.22e7,x:355,y:886,orbit:null},{kind:"planet",r:63,mu:1.08e7,x:373,y:1092,orbit:null},{kind:"moon",r:18,mu:3.5e5,orbit:{cx:373,cy:1092,rad:127,omega:1.297,phase:3.195}},{kind:"wormhole",r:34,mu:0,x:644,y:850,orbit:null,pair:4,turn:.7853981633974483},{kind:"wormhole",r:34,mu:0,x:87,y:752,orbit:null,pair:3,turn:-.7853981633974483}],frags:[{x:407,y:1275},{x:145,y:856},{x:460,y:814}],solution:{vx:149.843,vy:-370.874,t0Step:1445},fragSolution:{vx:-412.875,vy:-378.331,t0Step:0}},
    {id:"c70",index:69,seed:384693,difficulty:1.8,name:"Newton's Prism",plate:"LXX",probe:{x:261,y:1368},target:{x:351,y:455,r:33},bodies:[{kind:"repulsor",r:28,mu:-1.3e7,x:302,y:791,orbit:null},{kind:"planet",r:52,mu:4.72e6,x:553,y:418,orbit:null},{kind:"wormhole",r:28,mu:0,x:738,y:744,orbit:null,pair:3,turn:.7853981633974483},{kind:"wormhole",r:26,mu:0,x:127,y:440,orbit:null,pair:2,turn:-.7853981633974483}],frags:[{x:416,y:1157},{x:590,y:934},{x:682,y:832}],solution:{vx:159.196,vy:-384.334,t0Step:0},fragSolution:{vx:348.936,vy:-517.319,t0Step:0}},
    {id:"c71",index:70,seed:1021790,difficulty:1.82,name:"The Diagonal Mirror",plate:"LXXI",probe:{x:667,y:1463},target:{x:232,y:216,r:32},bodies:[{kind:"repulsor",r:25,mu:-1.01e7,x:419,y:750,orbit:null},{kind:"planet",r:39,mu:3.15e6,x:417,y:1145,orbit:null},{kind:"moon",r:13,mu:132000,orbit:{cx:417,cy:1145,rad:90,omega:-.621,phase:.006}},{kind:"wormhole",r:29,mu:0,x:102,y:468,orbit:null,pair:4,turn:-1.5707963267948966},{kind:"wormhole",r:31,mu:0,x:186,y:1215,orbit:null,pair:3,turn:1.5707963267948966}],frags:[{x:431,y:1402},{x:290,y:1327}],solution:{vx:-373.898,vy:-182.362,t0Step:1305},fragSolution:{vx:-166.905,vy:-55.846,t0Step:0}},
    {id:"c72",index:71,seed:500887,difficulty:1.84,name:"The Turning Door",plate:"LXXII",probe:{x:493,y:1292},target:{x:665,y:376,r:32},bodies:[{kind:"repulsor",r:27,mu:-1.01e7,x:555,y:857,orbit:null},{kind:"planet",r:54,mu:7.16e6,x:475,y:501,orbit:null},{kind:"wormhole",r:27,mu:0,x:615,y:634,orbit:null,pair:3,turn:.7853981633974483},{kind:"wormhole",r:26,mu:0,x:794,y:1089,orbit:null,pair:2,turn:-.7853981633974483}],frags:[{x:641,y:1124},{x:691,y:492}],solution:{vx:355.422,vy:-272.725,t0Step:0},fragSolution:{vx:125.178,vy:-166.116,t0Step:0}},
    {id:"c73",index:72,seed:122984,difficulty:1.86,name:"The Revolving Door",plate:"LXXIII",probe:{x:205,y:1358},target:{x:563,y:679,r:32},bodies:[{kind:"repulsor",r:24,mu:-1.03e7,x:353,y:1093,orbit:null},{kind:"repulsor",r:24,mu:-9.97e6,x:291,y:960,orbit:null},{kind:"wormhole",r:34,mu:0,x:119,y:862,orbit:null,pair:3,turn:0},{kind:"wormhole",r:31,mu:0,x:643,y:1229,orbit:{cx:665,cy:1265,rad:42,omega:.855,phase:4.166},pair:2,turn:0}],frags:[{x:352,y:1203},{x:594,y:1188}],solution:{vx:476.374,vy:-187.649,t0Step:357},fragSolution:{vx:358.568,vy:-450.782,t0Step:0}},
    {id:"c74",index:73,seed:806081,difficulty:1.88,name:"The Zoetrope",plate:"LXXIV",probe:{x:629,y:1281},target:{x:246,y:442,r:31},bodies:[{kind:"repulsor",r:28,mu:-1.38e7,x:492,y:1006,orbit:null},{kind:"blackhole",r:13,capture:38,mu:2.58e7,x:492,y:806,orbit:null},{kind:"wormhole",r:30,mu:0,x:727,y:633,orbit:{cx:707,cy:685,rad:56,omega:.465,phase:5.074},pair:3,turn:0},{kind:"wormhole",r:28,mu:0,x:208,y:731,orbit:null,pair:2,turn:0}],frags:[{x:718,y:937},{x:749,y:803}],solution:{vx:33.495,vy:-639.123,t0Step:806},fragSolution:{vx:-2.792,vy:-319.988,t0Step:0}},
    {id:"c75",index:74,seed:336178,difficulty:1.9,name:"The Magic Lantern",plate:"LXXV",probe:{x:437,y:1326},target:{x:693,y:307,r:31},bodies:[{kind:"repulsor",r:26,mu:-1.44e7,x:616,y:695,orbit:null},{kind:"repulsor",r:28,mu:-1.16e7,x:218,y:229,orbit:null},{kind:"wormhole",r:28,mu:0,x:646,y:988,orbit:null,pair:3,turn:.7853981633974483},{kind:"wormhole",r:30,mu:0,x:438,y:327,orbit:{cx:404,cy:375,rad:59,omega:.573,phase:5.32},pair:2,turn:-.7853981633974483}],frags:[{x:593,y:1112},{x:550,y:324}],solution:{vx:117.14,vy:-263.101,t0Step:394},fragSolution:{vx:225.719,vy:-368.341,t0Step:0}},
    {id:"c76",index:75,seed:83275,difficulty:1.92,name:"The Stereoscope",plate:"LXXVI",probe:{x:691,y:1287},target:{x:553,y:560,r:30},bodies:[{kind:"repulsor",r:25,mu:-1.05e7,x:650,y:989,orbit:null},{kind:"blackhole",r:14,capture:43,mu:3.63e7,x:663,y:284,orbit:null},{kind:"wormhole",r:31,mu:0,x:372,y:911,orbit:{cx:358,cy:965,rad:56,omega:-.659,phase:4.963},pair:3,turn:-1.5707963267948966},{kind:"wormhole",r:31,mu:0,x:710,y:398,orbit:null,pair:2,turn:1.5707963267948966}],frags:[{x:426,y:473},{x:650,y:176}],solution:{vx:-309.485,vy:-485.793,t0Step:1186},fragSolution:{vx:-255.979,vy:-461.799,t0Step:0}},
    {id:"c77",index:76,seed:270372,difficulty:1.94,name:"The Phantasmagoria",plate:"LXXVII",probe:{x:231,y:1303},target:{x:742,y:408,r:30},bodies:[{kind:"repulsor",r:29,mu:-1.29e7,x:425,y:924,orbit:null},{kind:"planet",r:56,mu:4.96e6,x:314,y:582,orbit:null},{kind:"repulsor",r:27,mu:-9.3e6,x:818,y:638,orbit:null},{kind:"moon",r:20,mu:4.8e5,orbit:{cx:314,cy:582,rad:138,omega:-1.479,phase:4.979}},{kind:"wormhole",r:29,mu:0,x:734,y:1088,orbit:null,pair:5,turn:-.7853981633974483},{kind:"wormhole",r:31,mu:0,x:581,y:680,orbit:{cx:617,cy:719,rad:53,omega:.85,phase:3.977},pair:4,turn:.7853981633974483}],frags:[{x:420,y:1094},{x:587,y:1052},{x:739,y:612}],solution:{vx:330.035,vy:-253.245,t0Step:734},fragSolution:{vx:305.535,vy:-327.646,t0Step:0}},
    {id:"c78",index:77,seed:1738469,difficulty:1.96,name:"Foucault's Pendulum",plate:"LXXVIII",probe:{x:399,y:1415},target:{x:296,y:320,r:30},bodies:[{kind:"planet",r:74,mu:1.41e7,x:360,y:725,orbit:null},{kind:"blackhole",r:13,capture:49,mu:2.88e7,x:152,y:759,orbit:null},{kind:"repulsor",r:26,mu:-8.14e6,x:396,y:1148,orbit:null},{kind:"wormhole",r:26,mu:0,x:119,y:1105,orbit:{cx:153,cy:1029,rad:83,omega:.909,phase:1.992},pair:4,turn:1.5707963267948966},{kind:"wormhole",r:27,mu:0,x:114,y:436,orbit:null,pair:3,turn:-1.5707963267948966}],frags:[{x:288,y:1290},{x:194,y:1187}],solution:{vx:-171.033,vy:-616.723,t0Step:503},fragSolution:{vx:-374.322,vy:-479.111,t0Step:0}},
    {id:"c79",index:78,seed:5655566,difficulty:1.98,name:"The Enfilade",plate:"LXXIX",probe:{x:343,y:1382},target:{x:749,y:412,r:30},bodies:[{kind:"repulsor",r:26,mu:-1.12e7,x:545,y:942,orbit:null},{kind:"planet",r:45,mu:3.14e6,x:680,y:754,orbit:null},{kind:"moon",r:16,mu:246000,orbit:{cx:680,cy:754,rad:97,omega:1.164,phase:1.696}},{kind:"wormhole",r:30,mu:0,x:129,y:640,orbit:null,pair:4,turn:0},{kind:"wormhole",r:31,mu:0,x:813,y:606,orbit:null,pair:3,turn:0},{kind:"wormhole",r:30,mu:0,x:264,y:1117,orbit:null,pair:6,turn:0},{kind:"wormhole",r:28,mu:0,x:231,y:950,orbit:null,pair:5,turn:0}],frags:[{x:293,y:1041},{x:218,y:780}],solution:{vx:-107.669,vy:-401.825,t0Step:397},fragSolution:{vx:-42.939,vy:-445.937,t0Step:0}},
    {id:"c80",index:79,seed:9152663,difficulty:2,name:"The Gallery of Mirrors",plate:"LXXX",probe:{x:164,y:1398},target:{x:519,y:577,r:29},bodies:[{kind:"planet",r:75,mu:1.3e7,x:348,y:984,orbit:null},{kind:"planet",r:41,mu:3.41e6,x:549,y:742,orbit:null},{kind:"wormhole",r:27,mu:0,x:489,y:844,orbit:null,pair:3,turn:-.7853981633974483},{kind:"wormhole",r:29,mu:0,x:356,y:722,orbit:null,pair:2,turn:.7853981633974483},{kind:"wormhole",r:31,mu:0,x:484,y:1106,orbit:null,pair:5,turn:.7853981633974483},{kind:"wormhole",r:29,mu:0,x:164,y:825,orbit:null,pair:4,turn:-.7853981633974483}],frags:[{x:158,y:1165},{x:261,y:924}],solution:{vx:425.827,vy:-363.691,t0Step:0},fragSolution:{vx:-30.744,vy:-205.715,t0Step:0}},
    {id:"c81",index:80,seed:7264760,difficulty:2.02,name:"The Antechamber",plate:"LXXXI",probe:{x:716,y:1405},target:{x:268,y:254,r:29},bodies:[{kind:"repulsor",r:29,mu:-1e7,x:488,y:781,orbit:null},{kind:"planet",r:42,mu:3.44e6,x:520,y:954,orbit:null},{kind:"moon",r:14,mu:165000,orbit:{cx:520,cy:954,rad:94,omega:1.349,phase:4.614}},{kind:"wormhole",r:29,mu:0,x:218,y:475,orbit:{cx:153,cy:477,rad:65,omega:-.627,phase:6.253},pair:4,turn:0},{kind:"wormhole",r:26,mu:0,x:765,y:450,orbit:null,pair:3,turn:0},{kind:"wormhole",r:30,mu:0,x:315,y:1184,orbit:null,pair:6,turn:1.5707963267948966},{kind:"wormhole",r:27,mu:0,x:614,y:740,orbit:null,pair:5,turn:-1.5707963267948966}],frags:[{x:495,y:1296},{x:644,y:679}],solution:{vx:-22.609,vy:-431.408,t0Step:785},fragSolution:{vx:-458.206,vy:-228.453,t0Step:0}},
    {id:"c82",index:81,seed:1829857,difficulty:2.04,name:"The Colonnade",plate:"LXXXII",probe:{x:375,y:1451},target:{x:703,y:414,r:29},bodies:[{kind:"blackhole",r:14,capture:46,mu:3.87e7,x:500,y:1087,orbit:null},{kind:"repulsor",r:30,mu:-1.09e7,x:235,y:837,orbit:null},{kind:"wormhole",r:27,mu:0,x:98,y:583,orbit:null,pair:3,turn:.7853981633974483},{kind:"wormhole",r:27,mu:0,x:731,y:803,orbit:null,pair:2,turn:-.7853981633974483},{kind:"wormhole",r:30,mu:0,x:719,y:1070,orbit:null,pair:5,turn:-1.5707963267948966},{kind:"wormhole",r:27,mu:0,x:358,y:809,orbit:null,pair:4,turn:1.5707963267948966}],frags:[{x:348,y:1300},{x:430,y:714}],solution:{vx:512.782,vy:-326.678,t0Step:0},fragSolution:{vx:-92.898,vy:-372.594,t0Step:0}},
    {id:"c83",index:82,seed:176954,difficulty:2.06,name:"The Vestibule",plate:"LXXXIII",probe:{x:634,y:1461},target:{x:161,y:623,r:28},bodies:[{kind:"repulsor",r:30,mu:-1.03e7,x:404,y:1080,orbit:null},{kind:"planet",r:43,mu:4.11e6,x:378,y:713,orbit:null},{kind:"moon",r:21,mu:556000,orbit:{cx:378,cy:713,rad:100,omega:1.379,phase:.945}},{kind:"wormhole",r:29,mu:0,x:199,y:1228,orbit:null,pair:4,turn:.7853981633974483},{kind:"wormhole",r:25,mu:0,x:252,y:923,orbit:null,pair:3,turn:-.7853981633974483},{kind:"wormhole",r:27,mu:0,x:735,y:568,orbit:null,pair:6,turn:0},{kind:"wormhole",r:29,mu:0,x:126,y:929,orbit:null,pair:5,turn:0}],frags:[{x:344,y:1306},{x:208,y:815}],solution:{vx:-14.24,vy:-543.814,t0Step:1128},fragSolution:{vx:-518.405,vy:-317.679,t0Step:0}},
    {id:"c84",index:83,seed:72051,difficulty:2.08,name:"The Twin Portals",plate:"LXXXIV",probe:{x:162,y:1361},target:{x:477,y:485,r:28},bodies:[{kind:"planet",r:75,mu:1.8e7,x:319,y:976,orbit:null},{kind:"repulsor",r:29,mu:-1.1e7,x:361,y:708,orbit:null},{kind:"wormhole",r:26,mu:0,x:115,y:872,orbit:null,pair:3,turn:1.5707963267948966},{kind:"wormhole",r:25,mu:0,x:252,y:507,orbit:null,pair:2,turn:-1.5707963267948966},{kind:"wormhole",r:24,mu:0,x:515,y:1140,orbit:null,pair:5,turn:-1.5707963267948966},{kind:"wormhole",r:24,mu:0,x:640,y:745,orbit:null,pair:4,turn:1.5707963267948966}],frags:[{x:131,y:1195},{x:102,y:1043},{x:349,y:507}],solution:{vx:396.17,vy:-172.26,t0Step:0},fragSolution:{vx:-129.737,vy:-610.364,t0Step:0}},
    {id:"c85",index:84,seed:546148,difficulty:2.1,name:"The Anamorphosis",plate:"LXXXV",probe:{x:696,y:1289},target:{x:259,y:184,r:28},bodies:[{kind:"repulsor",r:25,mu:-1.46e7,x:496,y:830,orbit:null},{kind:"planet",r:44,mu:3.03e6,x:524,y:235,orbit:null},{kind:"repulsor",r:23,mu:-8.34e6,x:651,y:383,orbit:null},{kind:"moon",r:21,mu:556000,orbit:{cx:524,cy:235,rad:106,omega:-1.369,phase:1.779}},{kind:"wormhole",r:25,mu:0,x:722,y:473,orbit:null,pair:5,turn:-1.5707963267948966},{kind:"wormhole",r:28,mu:0,x:460,y:484,orbit:null,pair:4,turn:1.5707963267948966},{kind:"wormhole",r:26,mu:0,x:788,y:759,orbit:null,pair:7,turn:.7853981633974483},{kind:"wormhole",r:27,mu:0,x:377,y:705,orbit:null,pair:6,turn:-.7853981633974483}],frags:[{x:657,y:1069},{x:479,y:712}],solution:{vx:12.984,vy:-495.83,t0Step:765},fragSolution:{vx:-65.077,vy:-410.878,t0Step:0}},
    {id:"c86",index:85,seed:145245,difficulty:2.12,name:"Daguerre's Diorama",plate:"LXXXVI",probe:{x:566,y:1310},target:{x:613,y:454,r:28},bodies:[{kind:"repulsor",r:29,mu:-1.21e7,x:571,y:860,orbit:null},{kind:"blackhole",r:15,capture:44,mu:2.69e7,x:206,y:709,orbit:null},{kind:"moon",r:19,mu:412000,orbit:{cx:206,cy:709,rad:117,omega:.593,phase:5.019}},{kind:"wormhole",r:27,mu:0,x:471,y:958,orbit:null,pair:4,turn:0},{kind:"wormhole",r:26,mu:0,x:692,y:746,orbit:null,pair:3,turn:0},{kind:"wormhole",r:29,mu:0,x:772,y:1062,orbit:null,pair:6,turn:1.5707963267948966},{kind:"wormhole",r:29,mu:0,x:258,y:160,orbit:null,pair:5,turn:-1.5707963267948966}],frags:[{x:523,y:1119},{x:672,y:690},{x:635,y:564}],solution:{vx:306.611,vy:-429.853,t0Step:1044},fragSolution:{vx:-116.012,vy:-596.829,t0Step:0}},
    {id:"c87",index:86,seed:4815342,difficulty:2.14,name:"The Panopticon",plate:"LXXXVII",probe:{x:242,y:1477},target:{x:461,y:535,r:27},bodies:[{kind:"repulsor",r:30,mu:-1.13e7,x:375,y:987,orbit:null},{kind:"blackhole",r:14,capture:38,mu:3.35e7,x:425,y:1239,orbit:null},{kind:"moon",r:17,mu:295000,orbit:{cx:425,cy:1239,rad:97,omega:-1.487,phase:2.068}},{kind:"wormhole",r:26,mu:0,x:126,y:1237,orbit:{cx:182,cy:1217,rad:59,omega:.481,phase:2.799},pair:4,turn:-.7853981633974483},{kind:"wormhole",r:26,mu:0,x:676,y:851,orbit:null,pair:3,turn:.7853981633974483},{kind:"wormhole",r:27,mu:0,x:393,y:668,orbit:null,pair:6,turn:.7853981633974483},{kind:"wormhole",r:26,mu:0,x:541,y:908,orbit:null,pair:5,turn:-.7853981633974483}],frags:[{x:129,y:1374},{x:606,y:742},{x:537,y:622}],solution:{vx:-286.307,vy:-424.467,t0Step:1500},fragSolution:{vx:-257.741,vy:-128.505,t0Step:0}},
    {id:"c88",index:87,seed:2315439,difficulty:2.16,name:"The Hall of Mirrors",plate:"LXXXVIII",probe:{x:735,y:1417},target:{x:242,y:299,r:27},bodies:[{kind:"planet",r:51,mu:7.61e6,x:535,y:978,orbit:null},{kind:"blackhole",r:12,capture:40,mu:3.64e7,x:341,y:871,orbit:null},{kind:"repulsor",r:24,mu:-1.14e7,x:615,y:1186,orbit:null},{kind:"moon",r:17,mu:295000,orbit:{cx:341,cy:871,rad:97,omega:-.61,phase:5.276}},{kind:"wormhole",r:25,mu:0,x:771,y:1080,orbit:null,pair:5,turn:.7853981633974483},{kind:"wormhole",r:25,mu:0,x:77,y:432,orbit:null,pair:4,turn:-.7853981633974483},{kind:"wormhole",r:29,mu:0,x:107,y:573,orbit:null,pair:7,turn:-1.5707963267948966},{kind:"wormhole",r:25,mu:0,x:463,y:1283,orbit:null,pair:6,turn:1.5707963267948966}],frags:[{x:737,y:1274},{x:750,y:1136},{x:122,y:394}],solution:{vx:-520.26,vy:-282.478,t0Step:200},fragSolution:{vx:-33.495,vy:-639.123,t0Step:0}},
    {id:"c89",index:88,seed:5786536,difficulty:2.18,name:"The Labyrinth",plate:"LXXXIX",probe:{x:364,y:1359},target:{x:604,y:358,r:26},bodies:[{kind:"repulsor",r:25,mu:-9.89e6,x:524,y:737,orbit:null},{kind:"blackhole",r:14,capture:42,mu:3.6e7,x:751,y:537,orbit:null},{kind:"repulsor",r:28,mu:-1.2e7,x:802,y:1008,orbit:null},{kind:"moon",r:15,mu:203000,orbit:{cx:751,cy:537,rad:92,omega:-1.381,phase:2.154}},{kind:"wormhole",r:29,mu:0,x:728,y:898,orbit:null,pair:5,turn:1.5707963267948966},{kind:"wormhole",r:26,mu:0,x:294,y:757,orbit:null,pair:4,turn:-1.5707963267948966},{kind:"wormhole",r:28,mu:0,x:418,y:970,orbit:{cx:457,cy:938,rad:50,omega:.578,phase:2.451},pair:7,turn:-.7853981633974483},{kind:"wormhole",r:27,mu:0,x:804,y:86,orbit:null,pair:6,turn:.7853981633974483}],frags:[{x:440,y:1172},{x:645,y:117}],solution:{vx:-16.052,vy:-367.65,t0Step:459},fragSolution:{vx:82.658,vy:-173.296,t0Step:0}},
    {id:"c90",index:89,seed:5562633,difficulty:2.2,name:"The Leviathan of Parsonstown",plate:"XC",probe:{x:178,y:1355},target:{x:517,y:676,r:26},bodies:[{kind:"repulsor",r:29,mu:-1.04e7,x:411,y:932,orbit:null},{kind:"blackhole",r:14,capture:44,mu:3.96e7,x:525,y:360,orbit:null},{kind:"repulsor",r:25,mu:-1.38e7,x:296,y:360,orbit:null},{kind:"moon",r:22,mu:639000,orbit:{cx:525,cy:360,rad:100,omega:.848,phase:3.085}},{kind:"wormhole",r:26,mu:0,x:483,y:1193,orbit:{cx:399,cy:1150,rad:94,omega:.651,phase:.477},pair:5,turn:-.7853981633974483},{kind:"wormhole",r:24,mu:0,x:196,y:740,orbit:null,pair:4,turn:.7853981633974483},{kind:"wormhole",r:27,mu:0,x:627,y:945,orbit:null,pair:7,turn:1.5707963267948966},{kind:"wormhole",r:30,mu:0,x:333,y:470,orbit:null,pair:6,turn:-1.5707963267948966}],frags:[{x:309,y:1291},{x:264,y:600},{x:582,y:886}],solution:{vx:406.831,vy:-451.832,t0Step:1211},fragSolution:{vx:233.15,vy:-140.09,t0Step:0}}
  ]);/*@END*/

  // Full-clear courses (tools/levels-clear.js): one launch that gathers every fragment and hits the target. Drawn by the hint.
  /*@CLEAR*/var CLEAR = [
    null,
    null,
    null,
    {vx:30.104,vy:-286.422,t0Step:0},
    {vx:143.211,vy:-15.052,t0Step:0},
    {vx:357.912,vy:-511.151,t0Step:260},
    {vx:212.926,vy:-569.497,t0Step:0},
    {vx:228.697,vy:-580.581,t0Step:0},
    {vx:-363.691,vy:-425.827,t0Step:0},
    {vx:-100.64,vy:-403.643,t0Step:700},
    {vx:15.497,vy:-591.797,t0Step:0},
    {vx:45.442,vy:-153.411,t0Step:0},
    {vx:143.984,vy:-171.594,t0Step:0},
    {vx:367.089,vy:-524.257,t0Step:0},
    {vx:225.916,vy:203.416,t0Step:0},
    {vx:-43.528,vy:-622.48,t0Step:260},
    {vx:-253.804,vy:-570.052,t0Step:120},
    {vx:121.216,vy:-595.794,t0Step:120},
    {vx:-116.012,vy:-596.829,t0Step:450},
    {vx:66.898,vy:-636.494,t0Step:0},
    {vx:86.963,vy:-324.551,t0Step:700},
    {vx:208.364,vy:-605.132,t0Step:450},
    {vx:-319.89,vy:8.377,t0Step:0},
    {vx:-36.257,vy:-414.417,t0Step:450},
    {vx:-283.29,vy:-555.988,t0Step:260},
    {vx:-297.734,vy:117.28,t0Step:0},
    {vx:-66.829,vy:-507.62,t0Step:700},
    {vx:-415.647,vy:-486.66,t0Step:0},
    {vx:157.362,vy:-587.283,t0Step:0},
    {vx:339.855,vy:-523.33,t0Step:120},
    {vx:55.4,vy:-298.909,t0Step:0},
    {vx:-255.523,vy:-15.628,t0Step:0},
    {vx:127.595,vy:-627.152,t0Step:0},
    {vx:-147.281,vy:-62.517,t0Step:0},
    {vx:152.595,vy:-48.113,t0Step:0},
    {vx:-379.867,vy:-495.052,t0Step:0},
    {vx:336.551,vy:244.519,t0Step:0},
    {vx:-300.702,vy:-109.446,t0Step:0},
    {vx:-219.884,vy:-42.741,t0Step:0},
    {vx:-295.819,vy:218.895,t0Step:0},
    {vx:140.369,vy:-608.007,t0Step:450},
    {vx:-267.868,vy:-47.232,t0Step:0},
    {vx:390.518,vy:-86.576,t0Step:0},
    {vx:197.82,vy:-64.276,t0Step:0},
    {vx:-447.932,vy:7.819,t0Step:700},
    {vx:-201.281,vy:-130.713,t0Step:0},
    {vx:47.413,vy:-541.93,t0Step:120},
    {vx:-216.713,vy:-277.38,t0Step:0},
    {vx:179.841,vy:-67.24,t0Step:450},
    {vx:-182.44,vy:-596.734,t0Step:0},
    {vx:415.747,vy:14.518,t0Step:0},
    {vx:-193.527,vy:-76.232,t0Step:0},
    {vx:-229.151,vy:-245.735,t0Step:260},
    {vx:-218.69,vy:48.482,t0Step:0},
    {vx:366.866,vy:28.873,t0Step:0},
    {vx:-85.138,vy:-569.673,t0Step:0},
    {vx:-224.162,vy:-154.062,t0Step:260},
    {vx:-493.283,vy:-51.846,t0Step:700},
    {vx:192.757,vy:-386.612,t0Step:450},
    {vx:207.873,vy:7.259,t0Step:260},
    {vx:-29.284,vy:-334.721,t0Step:0},
    {vx:44.472,vy:-461.864,t0Step:0},
    {vx:-82.39,vy:-586.239,t0Step:0},
    {vx:-339.148,vy:-542.751,t0Step:0},
    {vx:108.381,vy:-434.692,t0Step:0},
    {vx:-185.783,vy:-407.663,t0Step:0},
    {vx:-126.055,vy:22.227,t0Step:450},
    {vx:187.449,vy:-41.556,t0Step:0},
    {vx:-412.875,vy:-378.331,t0Step:0},
    {vx:348.936,vy:-517.319,t0Step:0},
    {vx:-166.905,vy:-55.846,t0Step:0},
    {vx:125.178,vy:-166.116,t0Step:0},
    {vx:352.419,vy:-435.202,t0Step:0},
    {vx:-2.792,vy:-319.988,t0Step:0},
    {vx:225.719,vy:-368.341,t0Step:0},
    {vx:-255.979,vy:-461.799,t0Step:0},
    {vx:294.623,vy:-315.945,t0Step:0},
    {vx:-374.322,vy:-479.111,t0Step:0},
    {vx:-42.939,vy:-445.937,t0Step:0},
    {vx:-27.299,vy:-222.33,t0Step:0},
    {vx:-458.206,vy:-228.453,t0Step:0},
    {vx:-92.898,vy:-372.594,t0Step:0},
    {vx:-518.405,vy:-317.679,t0Step:0},
    {vx:-129.737,vy:-610.364,t0Step:0},
    {vx:-65.077,vy:-410.878,t0Step:260},
    {vx:-116.012,vy:-596.829,t0Step:0},
    {vx:-258.853,vy:-126.251,t0Step:0},
    {vx:-33.495,vy:-639.123,t0Step:700},
    {vx:94.43,vy:-185.329,t0Step:120},
    {vx:233.15,vy:-140.09,t0Step:0}
  ];/*@ENDCLEAR*/

  // Full-clear course for a baked campaign plate (or null): used by the hint. Generated plates (Daily, Endless) have none.
  var CLEAR_BY_ID = {}; CAMPAIGN.forEach(function (l, i) { if (CLEAR[i]) CLEAR_BY_ID[l.id] = CLEAR[i]; });
  function clearFor(level) { return level && level.id && CLEAR_BY_ID[level.id] || null; }

  var VOLUMES = [{ name: 'Volume I', from: 0, to: 29 }, { name: 'Volume II', from: 30, to: 59 }, { name: 'Volume III', from: 60, to: 89 }];

  return { mulberry32: mulberry32, CAMPAIGN: CAMPAIGN, CLEAR: CLEAR, clearFor: clearFor, VOLUMES: VOLUMES, generate: generate, daily: daily, solve: solve, NAMES: NAMES,
    // internal: shared with tools/levels-bake.js so the bake uses exactly the runtime generator
    _gen: { sims: function () { return nSims; }, genStats: genStats, build: build, recipe: recipe, robust: robust, hit: hit, launch: launch, placeFrags: placeFrags,
      pointGap: pointGap, bodyGap: bodyGap, straightHits: straightHits, finish: finish, d3: d3 } };
})();
