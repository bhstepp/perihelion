/* PERIHELION — physics (owner: PHYSICS AGENT; reference core written by LEAD).
   Integrator: semi-implicit (symplectic) Euler at a fixed DT = K.DT (120 Hz):
     a = accel(bodies at t = abs*DT);  v += a*DT;  x += v*DT;  abs++;
   then, against body positions at the END of the step (t = abs*DT), in this order: fragment pickups ->
   body collisions (per body: blackhole capture, then crash) -> target -> bounds -> timeout (K.MAX_STEPS).
   Gravity is softened Newtonian: a = mu*d / (|d|^2 + EPS2)^1.5 (mu < 0 = repulsor).
   DETERMINISM RULE: numeric behaviour is FROZEN (baked levels + solutions depend on it; see
   tools/physics-golden.json). Wormholes (kind 'wormhole', added in v3), nebulae (kind 'nebula') and pulsars (kind 'pulsar', both v4)
   are pure additions: separate branches that never run for the older kinds, so every older flight is bit-identical.
   Nebula: inert to gravity (mu 0) and harmless; while the probe centre is inside (start-of-step positions, like gravity) the velocity
   just updated by gravity is multiplied by (1 - drag*DT) before the position update: a dust cloud that bleeds speed.
   Pulsar: a crashable body with ordinary gravity plus two opposite beams at angle beam.phase + beam.omega*t; a probe within beam.reach
   of the centre and inside a beam (half-width beam.half radians) is pushed straight outward by beam.push (units/s^2), in accel(). Time is ALWAYS abs*DT from an integer step counter, never accumulated.
   predict/simulate and the live flight run the very same createSim + stepSim, so a predicted point is
   bit-identical (===) to the live probe at that step. Never reorder float ops here; `node tools/physics-test.js`
   must stay green. Guards for bad input (NaN/Infinity) only change results for non-finite values. */
var Physics = (function () {
  var C = K, DT = K.DT, sqrt = Math.sqrt, cos = Math.cos, sin = Math.sin; // locals: fast in vm and browser

  // Body position at absolute time t (seconds). Bodies with `orbit` move on rails: angle = phase + omega*t.
  function bodyPos(b, t, out) {
    var o = b.orbit;
    if (o) {
      var a = o.phase + o.omega * t;
      out.x = o.cx + o.rad * cos(a);
      out.y = o.cy + o.rad * sin(a);
    } else {
      out.x = b.x; out.y = b.y;
    }
    return out;
  }

  // Pulsar beams: is the offset (dx, dy) from the pulsar centre inside one of its two opposite beams at time t? No atan2: the beam axis
  // u = (cos, sin)(phase + omega*t); inside when |d x u| < |d . u| * tan(half) and |d| < reach.
  function inBeam(bm, dx, dy, t) {
    var d2 = dx * dx + dy * dy;
    if (!(d2 < bm.reach * bm.reach) || d2 < 1e-9) return false;
    var a = bm.phase + bm.omega * t, ux = cos(a), uy = sin(a), al = dx * ux + dy * uy, pe = dx * uy - dy * ux;
    return (pe < 0 ? -pe : pe) < (al < 0 ? -al : al) * Math.tan(bm.half);
  }

  var _p = { x: 0, y: 0 };
  // Softened Newtonian gravity: a = mu * d / (|d|^2 + eps^2)^(3/2). Negative mu = repulsor, mu = 0 = inert.
  function accel(level, x, y, t, out) {
    var ax = 0, ay = 0, bs = level.bodies, e2 = C.EPS2;
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      bodyPos(b, t, _p);
      var dx = _p.x - x, dy = _p.y - y;
      var d2 = dx * dx + dy * dy + e2;
      var inv = b.mu / (d2 * sqrt(d2));
      ax += dx * inv; ay += dy * inv;
      if (b.beam && inBeam(b.beam, -dx, -dy, t)) { var bl = sqrt(dx * dx + dy * dy), bp = b.beam.push / bl; ax -= dx * bp; ay -= dy * bp; }
    }
    out.x = ax; out.y = ay;
    return out;
  }

  // Pull vector (finger - touchStart) in world units -> launch velocity (slingshot: opposite direction).
  // Non-finite or overflowing input cancels instead of producing NaN velocities.
  function launchVelocity(dx, dy) {
    var len = sqrt(dx * dx + dy * dy);
    if (!(len >= C.DRAG_CANCEL) || len === Infinity) return { cancel: true, vx: 0, vy: 0, power: 0 };
    var L = Math.min(len, C.DRAG_MAX);
    var power = L / C.DRAG_MAX;
    var s = -C.VMAX * power / len;
    return { cancel: false, vx: dx * s, vy: dy * s, power: power };
  }

  function hasFx(level) {
    for (var i = 0, bs = level.bodies; i < bs.length; i++) if (bs[i].kind === 'nebula' || bs[i].beam) return true;
    return false;
  }

  function createSim(level, vx, vy, t0Step) {
    return {
      x: level.probe.x, y: level.probe.y, vx: vx, vy: vy,
      t0Step: t0Step | 0, abs: t0Step | 0, step: 0,
      status: 'flying',                 // 'flying'|'hit'|'crash'|'captured'|'lost'|'timeout'
      hitBody: -1,
      collected: new Uint8Array(level.frags ? level.frags.length : 0),
      minDist: Infinity,                // closest approach to target centre
      dist: 0,                          // path length travelled so far, in units
      warps: 0,                         // wormhole passages so far
      fog: 0,                           // steps spent inside a nebula
      beams: 0,                         // pulsar beam crossings (entries) so far
      inFog: -1, inBeam: -1,            // body index of the nebula / pulsar beam the probe is in now (-1 = none)
      fx: hasFx(level),                 // the level has a nebula or a pulsar beam (else stepSim skips that loop entirely)
      minGap: Infinity,                 // closest approach to any non-repulsor body SURFACE (within 60 u), for 'near miss' stats
      events: []                        // {type:'frag', i} / {type:'warp', from, to, step} / {type:'fog', i, step} / {type:'beam', i, step}
                                        // pushed as they happen (fog/beam on entering); consumer may clear
    };
  }

  var _a = { x: 0, y: 0 }, _q = { x: 0, y: 0 };
  // One fixed step. Once status leaves 'flying' it is terminal: further calls change nothing.
  function stepSim(sim, level) {
    if (sim.status !== 'flying') return sim.status;
    accel(level, sim.x, sim.y, sim.abs * DT, _a);
    sim.vx += _a.x * DT; sim.vy += _a.y * DT;
    // v4: nebula drag and beam bookkeeping (start-of-step positions, like gravity). Only nebulae and pulsars do anything here.
    var bs0 = level.bodies, fog = -1, beam = -1, t0 = sim.abs * DT;
    if (sim.fx) for (var k = 0; k < bs0.length; k++) {
      var c = bs0[k];
      if (c.kind === 'nebula') {
        bodyPos(c, t0, _q);
        var nx = sim.x - _q.x, ny = sim.y - _q.y;
        if (nx * nx + ny * ny < c.r * c.r) { var f = 1 - c.drag * DT; sim.vx *= f; sim.vy *= f; if (fog < 0) fog = k; }
      } else if (c.beam && beam < 0) {
        bodyPos(c, t0, _q);
        if (inBeam(c.beam, sim.x - _q.x, sim.y - _q.y, t0)) beam = k;
      }
    }
    sim.x += sim.vx * DT; sim.y += sim.vy * DT;
    sim.abs++; sim.step++;
    sim.dist += sqrt(sim.vx * sim.vx + sim.vy * sim.vy) * DT;
    var t = sim.abs * DT, x = sim.x, y = sim.y, i, dx, dy, pr = C.PROBE_R, fr2 = C.FRAG_R * C.FRAG_R;
    if (fog >= 0) { sim.fog++; if (sim.inFog < 0) sim.events.push({ type: 'fog', i: fog, step: sim.step }); }
    if (beam >= 0 && sim.inBeam < 0) { sim.beams++; sim.events.push({ type: 'beam', i: beam, step: sim.step }); }
    sim.inFog = fog; sim.inBeam = beam;

    var fr = level.frags, got = sim.collected;
    if (fr) for (i = 0; i < fr.length; i++) {
      if (got[i]) continue;
      dx = fr[i].x - x; dy = fr[i].y - y;
      if (dx * dx + dy * dy < fr2) { got[i] = 1; sim.events.push({ type: 'frag', i: i }); }
    }

    var bs = level.bodies;
    for (i = 0; i < bs.length; i++) {
      var b = bs[i];
      bodyPos(b, t, _q);
      dx = _q.x - x; dy = _q.y - y;
      var d2 = dx * dx + dy * dy;
      if (b.kind === 'nebula') continue;   // a dust cloud: no surface, no harm, not a near miss
      if (b.kind === 'wormhole') {
        // Mouth: inert to gravity (mu 0) and harmless. Entering it (centre within r) leaves by the twin b.pair, speed kept, velocity
        // turned by b.turn (radians), placed just outside the twin's mouth along the new heading so it cannot re-enter at once.
        if (d2 < b.r * b.r) {
          var tw = bs[b.pair], th = b.turn || 0, wc = cos(th), ws = sin(th), wvx = sim.vx * wc - sim.vy * ws, wvy = sim.vx * ws + sim.vy * wc;
          var wl = sqrt(wvx * wvx + wvy * wvy), ux = wl > 1e-9 ? wvx / wl : 0, uy = wl > 1e-9 ? wvy / wl : -1, wo = tw.r + C.WARP_GAP;
          bodyPos(tw, t, _q);
          sim.vx = wvx; sim.vy = wvy;
          sim.x = x = _q.x + ux * wo; sim.y = y = _q.y + uy * wo;
          sim.warps++; sim.events.push({ type: 'warp', from: i, to: b.pair, step: sim.step });
        }
        continue;
      }
      if (b.kind !== 'repulsor') { var gl = b.r + 60; if (d2 < gl * gl) { var gp = sqrt(d2) - b.r; if (gp < sim.minGap) sim.minGap = gp; } }
      if (b.kind === 'blackhole' && b.capture && d2 < b.capture * b.capture) { sim.status = 'captured'; sim.hitBody = i; return sim.status; }
      var rr = b.r + pr;
      if (d2 < rr * rr) { sim.status = 'crash'; sim.hitBody = i; return sim.status; }
    }

    var tg = level.target;
    dx = tg.x - x; dy = tg.y - y;
    var dt2 = sqrt(dx * dx + dy * dy);
    if (dt2 < sim.minDist) sim.minDist = dt2;
    if (dt2 < tg.r) { sim.status = 'hit'; return sim.status; }

    var M = C.BOUNDS_MARGIN;  // negated form so a NaN position counts as lost (identical for finite x,y)
    if (!(x >= -M && x <= C.WORLD_W + M && y >= -M && y <= C.WORLD_H + M)) { sim.status = 'lost'; return sim.status; }
    if (sim.step >= C.MAX_STEPS) { sim.status = 'timeout'; return sim.status; }
    return sim.status;
  }

  // Runs a flight headlessly. If outPts (Float32Array/Float64Array, length >= 2*maxSteps) is given, writes x,y
  // per step. Returns the sim (with .n = number of points written).
  function simulate(level, vx, vy, t0Step, maxSteps, outPts) {
    var sim = createSim(level, vx, vy, t0Step);
    var n = 0, lim = maxSteps || C.MAX_STEPS;
    while (sim.status === 'flying' && sim.step < lim) {
      stepSim(sim, level);
      if (outPts) { outPts[2 * n] = sim.x; outPts[2 * n + 1] = sim.y; }
      n++;
    }
    sim.n = n;
    return sim;
  }

  // Aiming preview: first K.PREDICT_STEPS of the exact same flight.
  function predict(level, vx, vy, t0Step, outPts) {
    return simulate(level, vx, vy, t0Step, C.PREDICT_STEPS, outPts);
  }

  function speed(sim) { return sqrt(sim.vx * sim.vx + sim.vy * sim.vy); }

  // selfTest (browser + node, no DOM, own inline levels) -> {ok, checks:[{name, ok, detail}]}
  function selfTest() {
    var cks = [], N = C.MAX_STEPS, Q = C.PREDICT_STEPS, V = launchVelocity, S = simulate, KS = 'x y vx vy status abs minDist hitBody'.split(' ');
    function chk(name, fn) {
      var r; try { r = fn(); } catch (e) { r = 'threw ' + e; }
      cks.push({ name: name, ok: r === true, detail: r === true ? '' : String(r) });
    }
    function B(x, y, r, mu, k, cap) { return { kind: k || 'planet', x: x, y: y, r: r, mu: mu, orbit: null, capture: cap }; }
    function O(r, mu, cx, cy, rad, om, ph, k) { return { kind: k || 'moon', r: r, mu: mu, orbit: { cx: cx, cy: cy, rad: rad, omega: om, phase: ph } }; }
    function L(py, bs, fr, tr) { var l = { probe: { x: 450, y: py }, target: { x: 450, y: 200, r: tr || 40 }, bodies: bs }; if (fr) l.frags = fr; return l; }
    var fr3 = [{ x: 450, y: 1200 }, { x: 450, y: 1000 }, { x: 450, y: 800 }], lv = [
      L(1420, [B(330, 780, 70, 2.4e7)]),                 // no frags field
      L(1440, [B(450, 820, 60, 1.6e7), O(16, 8e5, 450, 820, 150, 1.3, .4)], []), // moon
      L(1400, [O(46, 7.5e6, 470, 820, 120, .9, 0, 'planet'), O(40, 5.2e6, 470, 820, 120, .9, Math.PI, 'planet')]),
      L(1440, [B(450, 800, 14, 3.2e7, 'blackhole', 44), B(220, 520, 26, -1.1e7, 'repulsor')]),
      L(1450, [B(250, 700, 40, 6e6)], fr3)];
    function same(a, b) { return KS.every(function (k) { return a[k] === b[k]; }); }
    chk('predict/simulate === live steps (t0 0/37/1234)', function () {
      var p = new Float64Array(2 * N), f = new Float32Array(2 * Q);
      for (var j = 0; j < 15; j++) {
        var l = lv[j % 5], t0 = [0, 37, 1234][j % 3], v = V(20 - 9 * j, 110 + 9 * j);
        var s = S(l, v.vx, v.vy, t0, N, p), q = predict(l, v.vx, v.vy, t0, f), m = createSim(l, v.vx, v.vy, t0);
        for (var i = 0; m.status === 'flying'; i++) {
          stepSim(m, l);
          if (i % 64 === 0) predict(lv[(j + 1) % 5], 50, -300, 9); // interleave
          if (p[2 * i] !== m.x || p[2 * i + 1] !== m.y || i < q.n && (f[2 * i] !== Math.fround(m.x) || f[2 * i + 1] !== Math.fround(m.y))) return 'f' + j + '@' + i;
        }
        if (i !== s.n || !same(s, m) || m.abs !== t0 + i || q.n !== Math.min(i, Q)) return 'f' + j + ' end';
      }
      return true;
    });
    chk('determinism; mu=0 body inert', function () {
      for (var j = 0; j < 5; j++) if (!same(S(lv[j], 90, -400, 5), S(lv[j], 90, -400, 5))) return 'L' + j;
      return same(S(lv[0], 90, -400), S(L(1420, lv[0].bodies.concat(B(0, 0, 5, 0))), 90, -400)) || 'mu=0';
    });
    chk('launchVelocity', function () {
      var c = C.DRAG_CANCEL, D = C.DRAG_MAX, h = V(D * 9, 0), u = V(-D * .6, D * .8), w = V(D * .3, D * .4);
      if (!V(0, 0).cancel || !V(c - 1e-9, 0).cancel || V(c, 0).cancel || !V(NaN, 1).cancel || !V(1 / 0, 0).cancel) return 'cancel';
      if (h.power !== 1 || h.vx !== -C.VMAX || u.power !== 1 || Math.abs(speed(u) - C.VMAX) > 1e-9) return 'clamp';
      if (w.power !== .5 || Math.abs(speed(w) - C.VMAX / 2) > 1e-9) return 'linear';
      return u.vx > 0 && u.vy < 0 && Math.abs(u.vx * .8 + u.vy * .6) < 1e-9 || 'direction';
    });
    chk('terminal statuses (end-of-step bodies)', function () {
      var cs = [['hit', L(290, []), -300], ['crash', L(800, [O(50, 1e5, 450, 500, 100, .5, Math.PI / 2)]), -200],
        ['captured', L(800, [B(450, 600, 14, 1e6, 'blackhole', 60)]), -200], ['lost', L(800, []), 0, 640], ['timeout', L(800, []), 0], ['lost', L(800, []), NaN]];
      for (var j = 0; j < 6; j++) {
        var c = cs[j], s = S(c[1], c[3] || 0, c[2], 3), x = s.x, n = s.step, b = c[1].bodies[0], g = { x: 0, y: 0 };
        if (s.status !== c[0] || stepSim(s, c[1]) !== c[0] || s.x !== x || s.step !== n || c[0] === 'timeout' && n !== N) return c[0] + ' got ' + s.status;
        if (b && (s.hitBody || (bodyPos(b, s.abs * DT, g), speed({ vx: g.x - s.x, vy: g.y - s.y }) >= (b.capture || b.r + C.PROBE_R)))) return c[0] + ' body';
      }
      return true;
    });
    chk('fragment events once', function () {
      var l = L(1450, [], fr3), s = createSim(l, 0, -100), e = [];
      while (stepSim(s, l) === 'flying') { e = e.concat(s.events); s.events.length = 0; }
      return e.length === 3 && e[0].i === 0 && e[1].i === 1 && e[2].i === 2 && s.collected.join() === '1,1,1' || 'ev ' + e.length;
    });
    chk('rails + integrator order', function () {
      var l = lv[2], b = l.bodies[1], o = b.orbit, p = { x: 0, y: 0 }, a = { x: 0, y: 0 };
      for (var s = 0; s < 3000; s += 37) {
        var g = o.phase + o.omega * (s * DT); bodyPos(b, s * DT, p);
        if (p.x !== o.cx + o.rad * Math.cos(g) || p.y !== o.cy + o.rad * Math.sin(g)) return 'step ' + s;
      }
      for (var m = createSim(l, 10, -300, 1234); m.status === 'flying';) {
        var x = m.x, vx = m.vx; accel(l, x, m.y, m.abs * DT, a); stepSim(m, l);
        if (m.vx !== vx + a.x * DT || m.x !== x + m.vx * DT) return 'int@' + m.abs;
      }
      return m.step > 99 || 'short';
    });
    function W(x, y, r, pair, turn, orb) { return { kind: 'wormhole', x: x, y: y, r: r, mu: 0, orbit: orb || null, pair: pair, turn: turn || 0 }; }
    chk('wormhole: twin exit, speed kept, turn applied, events, no re-entry, predict === simulate', function () {
      var l = L(1400, [W(450, 1100, 30, 1), W(650, 500, 30, 0)]), s = createSim(l, 0, -300, 0), sp = 300, n = 0, prev = null, ev = null;
      while (stepSim(s, l) === 'flying' && n++ < 400) { if (s.events.length && !ev) ev = s.events[0]; if (s.warps > 1) return 'reentered'; }
      if (s.warps !== 1 || !ev || ev.type !== 'warp' || ev.from !== 0 || ev.to !== 1) return 'event ' + JSON.stringify(ev);
      var q = createSim(l, 0, -300, 0); while (q.warps === 0) stepSim(q, l);
      if (Math.abs(speed(q) - sp) > 1e-9 || q.vx !== 0 && Math.abs(q.vx) > 1e-9) return 'speed/dir ' + q.vx + ',' + q.vy;
      if (Math.abs(q.x - 650) > 1e-9 || Math.abs(q.y - (500 - 30 - C.WARP_GAP)) > 1e-9) return 'exit ' + q.x + ',' + q.y;
      var lt = L(1400, [W(450, 1100, 30, 1, Math.PI / 2), W(650, 500, 30, 0, -Math.PI / 2)]), t = createSim(lt, 0, -300, 0); while (t.warps === 0) stepSim(t, lt);
      if (Math.abs(speed(t) - sp) > 1e-9 || Math.abs(t.vx - 300) > 1e-9 && Math.abs(t.vx + 300) > 1e-9) return 'turn ' + t.vx + ',' + t.vy;
      var pp = new Float64Array(2 * N), f2 = new Float32Array(2 * Q), a2 = S(lt, 0, -300, 0, N, pp), b2 = predict(lt, 0, -300, 0, f2);
      for (var i = 0; i < b2.n; i++) if (f2[2 * i] !== Math.fround(pp[2 * i]) || f2[2 * i + 1] !== Math.fround(pp[2 * i + 1])) return 'pred@' + i;
      return a2.warps >= 1 || 'no warp in simulate';
    });
    chk('wormhole: harmless and not a near-miss; moving mouth; older kinds unaffected', function () {
      var l = L(1400, [W(450, 1100, 30, 1), W(650, 500, 30, 0)]), s = S(l, 0, -300, 0, N);
      if (s.status === 'crash' || s.hitBody !== -1 || s.minGap !== Infinity) return 'wormhole treated as a hazard ' + s.status + ' ' + s.minGap;
      var lm = L(1400, [W(450, 1100, 30, 1), W(650, 500, 30, 0, 0, { cx: 650, cy: 600, rad: 100, omega: 1.1, phase: 0.3 })]), q = createSim(lm, 0, -300, 0);
      while (q.warps === 0 && q.step < 400) stepSim(q, lm);
      var g = { x: 0, y: 0 }; bodyPos(lm.bodies[1], q.abs * DT, g);
      if (q.warps !== 1 || Math.abs(Math.hypot(q.x - g.x, q.y - g.y) - (30 + C.WARP_GAP)) > 1e-9) return 'moving mouth exit';
      var plain = L(1420, [B(330, 780, 70, 2.4e7)]), withW = L(1420, [B(330, 780, 70, 2.4e7), W(100, 100, 30, 2), W(800, 100, 30, 1)]);
      return same(S(plain, 90, -400), S(withW, 90, -400)) || 'an unrelated wormhole pair changed a flight';
    });
    function Nb(x, y, r, drag, orb) { return { kind: 'nebula', x: x, y: y, r: r, mu: 0, orbit: orb || null, drag: drag }; }
    function Pu(x, y, r, mu, om, ph, half, reach, push) { return { kind: 'pulsar', x: x, y: y, r: r, mu: mu, orbit: null, beam: { omega: om, phase: ph, half: half, reach: reach, push: push } }; }
    chk('nebula: drag factor inside only, harmless, fog count + one event, predict === simulate, far nebula inert', function () {
      var l = L(1400, [Nb(450, 1000, 120, 0.5)]), s = createSim(l, 0, -300, 0), was = 0, ev = [];
      while (stepSim(s, l) === 'flying') {
        var sp = speed(s); ev = ev.concat(s.events); s.events.length = 0;
        if (s.inFog >= 0 && was && Math.abs(sp - was * (1 - 0.5 * DT)) > 1e-9) return 'factor @' + s.step;
        if (s.inFog < 0 && was && Math.abs(sp - was) > 1e-9) return 'drag outside @' + s.step;
        was = sp;
      }
      if (s.status !== 'hit' || s.minGap !== Infinity || s.hitBody !== -1) return 'status ' + s.status + ' ' + s.minGap;
      if (ev.length !== 1 || ev[0].type !== 'fog' || ev[0].i !== 0 || s.fog < 50 || s.fog > 200) return 'fog ' + s.fog + ' ev ' + ev.length;
      var pp = new Float64Array(2 * N), f2 = new Float32Array(2 * Q), a2 = S(l, 0, -300, 0, N, pp), b2 = predict(l, 0, -300, 0, f2);
      for (var i = 0; i < b2.n; i++) if (f2[2 * i] !== Math.fround(pp[2 * i])) return 'pred@' + i;
      var mv = L(1400, [Nb(450, 1000, 90, 0.6, { cx: 450, cy: 1000, rad: 60, omega: 1, phase: 0 })]), m2 = S(mv, 0, -300, 0);
      if (m2.fog < 1 || m2.status !== 'hit') return 'moving nebula';
      var plain = L(1420, [B(330, 780, 70, 2.4e7)]), withN = L(1420, [B(330, 780, 70, 2.4e7), Nb(800, 100, 60, 3)]);
      return same(S(plain, 90, -400), S(withN, 90, -400)) || 'a far nebula changed a flight';
    });
    chk('pulsar: gravity like a planet, beams push outward, crash on contact, beam events, predict === simulate', function () {
      var pl = L(1420, [B(330, 780, 14, 2e7)]), pu = L(1420, [Pu(330, 780, 14, 2e7, 1, 0, 0.15, 500, 0)]);
      if (!same(S(pl, 90, -400, 3), S(pu, 90, -400, 3))) return 'push 0 is not a planet';
      // a beam fixed along +y (phase pi/2, omega 0) under the probe's straight path from (450,1400) up: pushed along -y? no: the probe flies
      // up the beam axis away from the pulsar at (450,1500) -> it speeds up while inside the beam, then coasts
      var up = L(1400, [Pu(450, 1560, 10, 0, 0, Math.PI / 2, 0.2, 400, 900)]), q = createSim(up, 0, -200, 0);
      stepSim(q, up); if (!(q.vy < -200) || q.beams !== 1 || q.events[0].type !== 'beam') return 'push ' + q.vy + ' beams ' + q.beams;
      while (stepSim(q, up) === 'flying' && q.inBeam >= 0);
      var v1 = q.vy; stepSim(q, up); if (q.vy !== v1 || q.beams !== 1) return 'outside the reach ' + q.vy;
      var side = L(1400, [Pu(450, 1560, 10, 0, 0, 0, 0.2, 400, 900)]), r = S(side, 0, -200, 0); if (r.beams !== 0) return 'beam off-axis';
      var sw = L(1400, [Pu(700, 1000, 12, 1e6, 2.5, 0, 0.12, 600, 1200)]), p1 = new Float64Array(2 * N), f1 = new Float32Array(2 * Q), a1 = S(sw, 20, -350, 77, N, p1), b1 = predict(sw, 20, -350, 77, f1);
      for (var i = 0; i < b1.n; i++) if (f1[2 * i] !== Math.fround(p1[2 * i])) return 'pred@' + i;
      if (a1.beams < 1) return 'no sweep crossing';
      var hitP = S(L(1400, [Pu(450, 1000, 20, 1e6, 0, 0, 0.1, 300, 500)]), 0, -300, 0);
      return hitP.status === 'crash' && hitP.hitBody === 0 && hitP.minGap < C.PROBE_R || 'crash ' + hitP.status;
    });
    for (var i = 0, ok = true; i < cks.length; i++) ok = ok && cks[i].ok;
    return { ok: ok, checks: cks };
  } /* selfTest end */

  return {
    bodyPos: bodyPos, accel: accel, launchVelocity: launchVelocity,
    createSim: createSim, stepSim: stepSim, simulate: simulate, predict: predict, speed: speed,
    selfTest: selfTest
  };
})();
