// Physics test harness (owner: PHYSICS AGENT).
//   node tools/physics-test.js            -> selfTest + golden check + benchmark
//   node tools/physics-test.js --record   -> (re)record tools/physics-golden.json from the CURRENT core
//   node tools/physics-test.js --ref f.js -> also compare every point against another physics file (e.g. a backup)
// Golden = SHA-256 over the Float64 bits of 20 fixed flights (every x,y per step + final state).
// It was recorded from the lead's original core BEFORE any physics-agent edit: it must never change.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
let G;
try { G = require('./load.js'); }
catch (e) { // 20-levels.js may be mid-edit by another agent: fall back to const + physics only
  console.log('note: load.js failed (' + e.message + '); loading 00-const + 10-physics only');
  G = vm.createContext({ console });
  for (const f of ['00-const.js', '10-physics.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), G, { filename: f });
}
const P = G.Physics, KK = G.K;
const GOLD = path.join(__dirname, 'physics-golden.json');
const args = process.argv.slice(2);
let fail = 0;
const say = (ok, name, detail) => { if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

// ---- fixed golden levels (independent of Levels / selfTest so they can never drift) ----
const O = (cx, cy, rad, omega, phase) => ({ cx, cy, rad, omega, phase });
const LV = [
  { probe: { x: 450, y: 1420 }, target: { x: 520, y: 220, r: 44 },
    bodies: [{ kind: 'planet', x: 330, y: 780, r: 70, mu: 2.4e7, orbit: null }], frags: [] },
  { probe: { x: 450, y: 1440 }, target: { x: 450, y: 200, r: 40 },
    bodies: [{ kind: 'planet', x: 450, y: 820, r: 60, mu: 1.6e7, orbit: null },
             { kind: 'moon', r: 16, mu: 8e5, orbit: O(450, 820, 150, 1.3, 0.4) }] },
  { probe: { x: 200, y: 1400 }, target: { x: 700, y: 240, r: 40 },
    bodies: [{ kind: 'planet', r: 46, mu: 7.5e6, pair: 1, orbit: O(470, 820, 120, 0.9, 0) },
             { kind: 'planet', r: 40, mu: 5.2e6, pair: 1, orbit: O(470, 820, 120, 0.9, Math.PI) },
             { kind: 'moon', r: 16, mu: 6e5, orbit: O(700, 480, 110, -1.4, 1) }], frags: [{ x: 640, y: 1050 }] },
  { probe: { x: 450, y: 1440 }, target: { x: 450, y: 180, r: 36 },
    bodies: [{ kind: 'blackhole', x: 450, y: 800, r: 14, capture: 44, mu: 3.2e7, orbit: null },
             { kind: 'repulsor', x: 220, y: 520, r: 26, mu: -1.1e7, orbit: null },
             { kind: 'planet', x: 700, y: 1100, r: 55, mu: 1.1e7, orbit: null },
             { kind: 'moon', r: 14, mu: 4e5, orbit: O(700, 1100, 105, 1.2, 0) }],
    frags: [{ x: 300, y: 1000 }, { x: 640, y: 420 }] },
  { probe: { x: 450, y: 1450 }, target: { x: 450, y: 160, r: 40 },
    bodies: [{ kind: 'planet', x: 250, y: 700, r: 40, mu: 6e6, orbit: null },
             { kind: 'planet', x: 0, y: 0, r: 30, mu: 0, orbit: null }],
    frags: [{ x: 450, y: 1200 }, { x: 450, y: 1000 }, { x: 450, y: 800 }] }
];
const FL = [ // 20 flights: [level, dragDx, dragDy, t0Step] — hits, timeouts, frag pickups, then a crash/lost/captured sweep
  [0, 93.913, 74.702, 0], [1, 79.121, 90.221, 37], [2, 9.937, 119.588, 1234], [3, -26.105, 198.289, 0], [4, 54.945, 106.682, 37],
  [0, 80, 0, 0], [2, 68.573, 41.203, 0], [3, 130.553, 73.864, 1234], [4, 0, 150, 0], [4, 0.5, 400, 99991]];
[[0, 60], [37, 120]].forEach(([t0, pull], k) =>
  LV.forEach((lv, j) => { const a = Math.PI / 2 + (j - 2) * 0.23 + k * 0.07; FL.push([j, Math.cos(a) * pull * 1.3, Math.sin(a) * pull * 1.3, t0]); }));

function flightBytes(Ph, f) {
  const lv = LV[f[0]], v = Ph.launchVelocity(f[1], f[2]);
  const pts = new Float64Array(2 * KK.MAX_STEPS);
  const s = Ph.simulate(lv, v.vx, v.vy, f[3], KK.MAX_STEPS, pts);
  const tail = new Float64Array([v.vx, v.vy, v.power, s.x, s.y, s.vx, s.vy, s.minDist, s.abs, s.step, s.hitBody, s.n]);
  const meta = Buffer.from(s.status + '|' + Array.from(s.collected).join('') + '|' + s.events.map(e => e.type + e.i).join(','));
  return { buf: Buffer.concat([Buffer.from(pts.buffer, 0, s.n * 16), Buffer.from(tail.buffer), meta]), s };
}
function golden(Ph) {
  const all = crypto.createHash('sha256'), per = [], stat = [];
  for (const f of FL) { const r = flightBytes(Ph, f); all.update(r.buf); per.push(crypto.createHash('sha256').update(r.buf).digest('hex').slice(0, 16)); stat.push(r.s.status + ':' + r.s.n); }
  return { sha256: all.digest('hex'), flights: per, statuses: stat };
}

const cur = golden(P);
if (args.includes('--record')) {
  fs.writeFileSync(GOLD, JSON.stringify(cur, null, 1) + '\n');
  console.log('recorded ' + GOLD + '  ' + cur.sha256 + '\n  ' + cur.statuses.join(' '));
  process.exit(0);
}

// ---- 1. selfTest ----
if (typeof P.selfTest === 'function') {
  const t0 = process.hrtime.bigint(), r = P.selfTest(), ms = Number(process.hrtime.bigint() - t0) / 1e6;
  for (const c of r.checks) say(c.ok, 'selfTest: ' + c.name, c.detail);
  say(r.ok && r.checks.length > 0, 'selfTest overall', r.checks.length + ' checks, ' + ms.toFixed(1) + ' ms');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '10-physics.js'), 'utf8');
  const m = src.indexOf('function selfTest'), e = src.indexOf('/* selfTest end */');
  if (m > 0 && e > m) console.log('     selfTest source size ' + (e - m) + ' bytes');
} else say(false, 'selfTest missing');

// ---- 2. golden ----
if (!fs.existsSync(GOLD)) say(false, 'golden file missing (run with --record on the ORIGINAL core)');
else {
  const g = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  const bad = g.flights.map((h, i) => h === cur.flights[i] ? -1 : i).filter(i => i >= 0);
  say(g.sha256 === cur.sha256, 'golden 20 flights bit-identical', cur.sha256.slice(0, 16) + (bad.length ? ' differing flights: ' + bad : '') + '  [' + cur.statuses.join(' ') + ']');
}

// ---- optional: point-by-point vs a reference physics file, incl. 2000 random flights ----
const ri = args.indexOf('--ref');
if (ri >= 0) {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '00-const.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(args[ri + 1], 'utf8'), ctx);
  let rs = 12345, diff = 0; const rnd = () => ((rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 2000; i++) {
    const f = [i % LV.length, (rnd() - 0.5) * 700, (rnd() - 0.2) * 500, (rnd() * 5000) | 0];
    if (!flightBytes(P, f).buf.equals(flightBytes(ctx.Physics, f).buf)) diff++;
  }
  say(diff === 0 && golden(ctx.Physics).sha256 === cur.sha256, 'reference ' + args[ri + 1], diff + '/2000 random flights differ');
}

// ---- 3. benchmark: 5 bodies, 2 moving (level 3 + one extra fixed planet), full timeouts ----
{
  const lv = { probe: { x: 450, y: 300 }, target: { x: -5000, y: -5000, r: 1 }, frags: [{ x: -900, y: -900 }],
    bodies: LV[3].bodies.concat([{ kind: 'moon', r: 10, mu: 2e5, orbit: O(450, 800, 700, 0.5, 2) }]) };
  lv.bodies = lv.bodies.map(b => Object.assign({}, b, { mu: b.mu * 1e-6 }));   // same work per step, probe drifts -> timeout
  const run = () => { let n = 0; for (let k = 0; k < 40; k++) n += P.simulate(lv, 0, 0.001 * k, k * 7, KK.MAX_STEPS).n; return n; };
  run(); run();
  let steps = 0; const t0 = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - t0) < 1.5e9) steps += run();
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  const st = P.simulate(lv, 0, 0, 0, KK.MAX_STEPS);
  console.log('bench 5 bodies (2 moving): ' + (steps / sec / 1e6).toFixed(2) + ' M steps/s; full 1200-step flight ' +
    (sec / steps * 1200 * 1e3).toFixed(3) + ' ms; predict(420) ' + (sec / steps * 420 * 1e3).toFixed(3) + ' ms  [' + st.status + ']');
}

console.log(fail ? fail + ' FAILED' : 'ALL GREEN');
process.exit(fail ? 1 : 0);
