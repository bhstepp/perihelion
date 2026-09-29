/* PERIHELION — levels (owner: LEVEL AGENT).
   CAMPAIGN is baked offline by tools/levels-bake.js (same generator as generate() below, plus a brute-force
   angle x power solver); every baked number was verified AFTER rounding against the frozen Physics core.
   generate(seed, difficulty) builds Endless plates at runtime with a fast, budgeted solver. */
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
    if (i <= 1) t = ['P'];
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
    while (cnt > 6) { t.pop(); cnt--; } // (only 'B' can overshoot by one; trimming the tail keeps it simple)
    var frags = i < 3 ? 0 : i < 10 ? 1 : i < 20 ? 1 + (rng() < 0.5 ? 1 : 0) : 2 + (rng() < 0.5 ? 1 : 0);
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
  function clearOf(L, b, others) {
    if (!inWorld(b)) return false;
    if (pointGap(b, L.probe.x, L.probe.y) < 140) return false;
    var g = pointGap(b, L.target.x, L.target.y);
    if (g < 110 || g - L.target.r < 70) return false;
    for (var i = 0; i < others.length; i++) if (others[i] !== b && bodyGap(b, others[i]) < 36) return false;
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
    var P = L.probe, T = L.target, blocker = rc.index >= 5, pair = 1, parents = [], lane = null;
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
        } else { x = MARGIN + rng() * (W - 2 * MARGIN); y = T.y + 60 + rng() * (P.y - T.y - 120); free = true; }
        setCentre(sys, ri(x), ri(y));
        ok = true;
        for (i = 0; i < sys.length && ok; i++) ok = clearOf(L, sys[i], L.bodies) && (!lane || !free || laneGap(sys[i]) >= 80);
      }
      if (!ok) return null;
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
        if (clearOf(L, m, L.bodies)) { L.bodies.push(m); placed = true; } // moons may cross the lane: a timing puzzle
      }
      if (!placed) return null;
    }
    return L;
  }

  /* ---------- solver ---------- */
  function launch(aDeg, p) { var a = aDeg * DEG, v = K.VMAX * p; return { vx: Math.cos(a) * v, vy: Math.sin(a) * v }; }
  var nSims = 0, fast = false, FAST_STEPS = 720; // solver ignores routes longer than 6 s (rare, and hard to aim)
  // Exact flight (Physics.simulate). Inside solve() `fast` also drops flights that are >80 u outside the plate and
  // still heading out, and flights past FAST_STEPS: this can only turn a rare late hit into a miss, so every hit the solver reports is genuine.
  function shoot(L, aDeg, p, t0) {
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
  var genStats = { fallback: 0, empty: 0 };
  // Endless: deterministic for (seed, difficulty); never returns an unsolvable plate. Work is capped in simulated
  // flights (not ms) so results are identical on every device: candidates at the asked difficulty get CAND_SIMS each
  // within STAGE_CAPS[0]; if none proves finger-robust, cheaper archetypes follow (3-body repulsor plate at 0.69,
  // planet + moon at 0.2, two planets at 0.1), each with its own small cap. Worst case ~730 flights.
  function generate(seed, difficulty) {
    var d = Math.max(0, Math.min(1, +difficulty || 0)), k, L, s, cap, fb = false;
    var ds = [d, Math.min(d, 0.69), Math.min(d, 0.2), Math.min(d, 0.1)];
    for (var g = 0; g < ds.length; g++) {
      if (g && ds[g] === ds[g - 1]) continue;
      if (g && !fb) { fb = true; genStats.fallback++; }
      cap = nSims + STAGE_CAPS[g];
      for (k = 0; k < 48 && nSims < cap; k++) {
        s = (seed + Math.imul(k + 101 * g, 0x9E3779B1)) >>> 0;
        if ((L = attempt(seed, s, ds[g], CAND_SIMS, cap))) return L;
      }
    }
    // Last resort (not seen in 1000s of seeds): an empty plate — the straight shot is a guaranteed hit.
    genStats.empty++;
    L = { id: 'e' + seed, index: -1, seed: seed, difficulty: d3(d), name: 'Quiet Sky', plate: '\u221E',
      probe: { x: 450, y: 1420 }, target: { x: 450, y: 260, r: 44 }, bodies: [], frags: [], solution: { vx: 0, vy: -K.VMAX * 0.8, t0Step: 0 } };
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
  ];/*@END*/

  return { mulberry32: mulberry32, CAMPAIGN: CAMPAIGN, generate: generate, solve: solve, NAMES: NAMES,
    // internal: shared with tools/levels-bake.js so the bake uses exactly the runtime generator
    _gen: { sims: function () { return nSims; }, genStats: genStats, build: build, recipe: recipe, robust: robust, hit: hit, launch: launch, placeFrags: placeFrags,
      pointGap: pointGap, bodyGap: bodyGap, straightHits: straightHits, finish: finish, d3: d3 } };
})();
