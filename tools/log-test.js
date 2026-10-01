// Log agent QA: node tools/log-test.js
//   (a) pure-logic tests of src/55-log.js (+ Sound.ach) in a vm with a fake window / localStorage / LogUI
//   (b) Chromium (iPhone 14 emulation) screenshots of the Observer's Log and a toast -> qa/log-*.png
// Run with NODE_PATH=/home/claude/.npm-global/lib/node_modules for playwright. Never installs browsers.
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const QA = path.join(ROOT, 'qa'); fs.mkdirSync(QA, { recursive: true });

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  -- ' + detail : '')); }
function eq(name, a, b) { check(name, a === b, a === b ? '' : 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

// ------------------------------------------------------------------------------------------------ (a) logic
function world(opts) {
  opts = opts || {};
  const store = {};
  const ls = opts.brokenStorage
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const toasts = [], sounds = [];
  const ctx = vm.createContext({
    window: { localStorage: ls }, console, setTimeout, clearTimeout, Math, Date, JSON, Object, Array, Number, String, isFinite, Infinity,
    Sound: { ach() { sounds.push(1); } },
    LogUI: { toast(t, s, o) { toasts.push({ t, s, o }); } }
  });
  if (opts.volumes) ctx.Levels = { VOLUMES: opts.volumes };
  vm.runInContext(SRC('50-save.js') + '\n' + SRC('55-log.js') + '\n', ctx, { filename: 'save+log' });
  const W = { ctx, Save: ctx.Save, Log: ctx.Log, toasts, sounds, store };
  W.ev = (n, d) => ctx.Log.event(n, d);
  W.has = id => ctx.Save.hasAch(id);
  W.got = () => Object.keys(ctx.Save.data.ach).sort();
  W.stat = n => ctx.Save.stat(n);
  W.seedStars = (arr) => { arr.forEach((s, i) => { ctx.Save.data.stars[i] = s; }); };
  return W;
}
const TGT = { x: 400, y: 300, r: 42 };
const L = (o) => Object.assign({ id: 'c1', target: TGT, bodies: [{ kind: 'planet', r: 40, mu: 1 }], frags: [] }, o || {});
// a finished sim that ended on the ring edge, heading `off` degrees away from its centre
function simHit(o) {
  o = o || {};
  const off = (o.off || 0) * Math.PI / 180;
  return Object.assign({ minGap: Infinity, minDist: 41, step: 300, dist: 500, x: TGT.x - 41, y: TGT.y, vx: 640 * Math.cos(off), vy: 640 * Math.sin(off), collected: null }, o.sim || {});
}
function flight(W, status, sim, level, extra) {
  W.ev('flightEnd', Object.assign({ mode: 'campaign', level: level || L(), launchNo: 1, status, sim, hintUsed: false, fragsThisAttempt: 0 }, extra || {}));
}
function seal(W, o) {
  o = o || {};
  W.ev('plateSealed', Object.assign({ mode: 'campaign', level: L(), plateIndex: 0, stars: 3, launches: 1, hintUsed: false, fragsThisAttempt: 0, fragsTotal: 0 }, o));
}

let NH = 0;
function logicTests() {
  let W;
  NH = world().Log.ACHIEVEMENTS.length;

  // first_light
  W = world(); flight(W, 'hit', simHit()); check('first_light: not from a bare flightEnd', !W.has('first_light'));
  seal(W); check('first_light: on plateSealed', W.has('first_light'));
  W = world(); seal(W, { mode: 'endless', plateIndex: -1 }); check('first_light: endless seal counts', W.has('first_light'));

  // thread_needle
  W = world(); flight(W, 'hit', simHit({ sim: { minGap: 12 } })); check('thread_needle: win, gap 12', W.has('thread_needle'));
  W = world(); flight(W, 'hit', simHit({ sim: { minGap: 12.5 } })); check('thread_needle: gap 12.5 no', !W.has('thread_needle'));
  W = world(); flight(W, 'crash', simHit({ sim: { minGap: 0 } })); check('thread_needle: crash no', !W.has('thread_needle'));
  W = world(); flight(W, 'lost', simHit({ sim: { minGap: 4 } })); check('thread_needle: lost no', !W.has('thread_needle'));
  W = world(); flight(W, 'hit', simHit({ sim: { minGap: 4 } })); eq('threads stat', W.stat('threads'), 1); eq('nearMiss stat counts a winning graze', W.stat('nearMiss'), 1);

  // near_ten
  W = world(); for (let i = 0; i < 9; i++) flight(W, 'lost', simHit({ sim: { minGap: 20 } }));
  check('near_ten: nine no', !W.has('near_ten')); flight(W, 'timeout', simHit({ sim: { minGap: 19.9 } })); check('near_ten: tenth', W.has('near_ten'));
  W = world(); for (let i = 0; i < 12; i++) flight(W, 'crash', simHit({ sim: { minGap: 0 } })); check('near_ten: crashes never count', !W.has('near_ten')); eq('nearMiss after crashes', W.stat('nearMiss'), 0);
  W = world(); for (let i = 0; i < 12; i++) flight(W, 'lost', simHit({ sim: { minGap: 20.5 } })); eq('nearMiss: 20.5 is not a near miss', W.stat('nearMiss'), 0);
  W = world(); for (let i = 0; i < 12; i++) flight(W, 'lost', simHit({ sim: { minGap: Infinity } })); eq('nearMiss: Infinity', W.stat('nearMiss'), 0);

  // dead_center
  W = world(); flight(W, 'hit', simHit({ off: 0 })); check('dead_center: straight in', W.has('dead_center'));
  W = world(); flight(W, 'hit', simHit({ off: 7.5 })); check('dead_center: 7.5 deg', W.has('dead_center'));
  W = world(); flight(W, 'hit', simHit({ off: 20 })); check('dead_center: 20 deg no', !W.has('dead_center'));
  W = world(); flight(W, 'hit', simHit({ off: 20, sim: { minDist: 8 } })); check('dead_center: minDist 8 qualifies', W.has('dead_center'));
  W = world(); flight(W, 'lost', simHit({ off: 0 })); check('dead_center: only on wins', !W.has('dead_center'));

  // clean_sweep
  const L2 = L({ frags: [{ x: 1, y: 1 }, { x: 2, y: 2 }] });
  W = world(); seal(W, { level: L2, fragsThisAttempt: 2, fragsTotal: 2 }); check('clean_sweep: all two', W.has('clean_sweep'));
  W = world(); seal(W, { level: L2, fragsThisAttempt: 1, fragsTotal: 2 }); check('clean_sweep: one of two no', !W.has('clean_sweep'));
  W = world(); seal(W, { level: L({ frags: [{ x: 1, y: 1 }] }), fragsThisAttempt: 1, fragsTotal: 1 }); check('clean_sweep: single fragment plate no', !W.has('clean_sweep'));
  W = world(); seal(W, { level: L(), fragsThisAttempt: 0, fragsTotal: 0 }); check('clean_sweep: no fragments no', !W.has('clean_sweep'));
  W = world(); seal(W, { level: null, fragsThisAttempt: 3, fragsTotal: 3 }); check('clean_sweep: no level falls back to fragsTotal', W.has('clean_sweep'));

  // one_shot_ten / cartographer
  W = world(); W.seedStars([3, 3, 3, 3, 3, 3, 3, 3, 3]); seal(W, { plateIndex: 9, stars: 3 }); check('one_shot_ten: tenth three-star plate (before recordPlate)', W.has('one_shot_ten'));
  W = world(); W.seedStars([3, 3, 3, 3, 3, 3, 3, 3, 2]); seal(W, { plateIndex: 9, stars: 3 }); check('one_shot_ten: nine no', !W.has('one_shot_ten'));
  W = world(); W.seedStars([1, 1, 1, 1, 1, 1, 1, 1, 1]); seal(W, { plateIndex: 9, stars: 1 }); check('cartographer_10 on tenth distinct plate', W.has('cartographer_10'));
  W = world(); W.seedStars([1, 1, 1, 1, 1, 1, 1, 1, 1]); seal(W, { plateIndex: 3, stars: 3 }); check('cartographer_10: replay of a sealed plate no', !W.has('cartographer_10'));
  W = world(); W.seedStars([1, 1, 1, 1, 1, 1, 1, 1, 1]); seal(W, { mode: 'endless', plateIndex: -1, stars: 1 }); check('cartographer_10: endless seal no', !W.has('cartographer_10'));
  W = world(); W.seedStars(new Array(29).fill(1)); seal(W, { plateIndex: 29 }); check('cartographer_30', W.has('cartographer_30') && W.has('cartographer_10') && !W.has('cartographer_60'));
  W = world(); W.seedStars(new Array(59).fill(1)); seal(W, { plateIndex: 59 }); check('cartographer_60', W.has('cartographer_60'));
  W = world(); W.seedStars(new Array(58).fill(1)); seal(W, { plateIndex: 59 }); check('cartographer_60: 59 no', !W.has('cartographer_60'));

  // volumes / perfectionist
  W = world(); W.seedStars(new Array(29).fill(1)); seal(W, { plateIndex: 29, stars: 1 }); check('volume_one', W.has('volume_one') && !W.has('volume_two') && !W.has('perfectionist'));
  W = world(); W.seedStars(new Array(28).fill(1)); seal(W, { plateIndex: 29, stars: 1 }); check('volume_one: gap at plate 29 no', !W.has('volume_one'));
  W = world(); const s2 = new Array(60).fill(0); for (let i = 30; i < 59; i++) s2[i] = 1; W.seedStars(s2); seal(W, { plateIndex: 59, stars: 1 }); check('volume_two', W.has('volume_two') && !W.has('volume_one'));
  W = world(); W.seedStars(new Array(29).fill(3)); seal(W, { plateIndex: 29, stars: 3 }); check('perfectionist', W.has('perfectionist') && W.has('volume_one'));
  W = world(); const s3 = new Array(29).fill(3); s3[4] = 2; W.seedStars(s3); seal(W, { plateIndex: 29, stars: 3 }); check('perfectionist: one two-star plate no', !W.has('perfectionist') && W.has('volume_one'));

  // cartographer_60 keeps its condition (sixty plates sealed); cartographer_90 needs all ninety
  check('Save.N is 90', world().Save.N === 90);
  W = world(); W.seedStars(new Array(89).fill(1)); seal(W, { plateIndex: 89, stars: 1 });
  check('cartographer_90: all ninety', W.has('cartographer_90') && W.has('cartographer_60') && W.has('cartographer_30'));
  W = world(); W.seedStars(new Array(88).fill(1)); seal(W, { plateIndex: 89, stars: 1 }); check('cartographer_90: 89 of 90 no', !W.has('cartographer_90') && W.has('cartographer_60'));
  W = world(); W.seedStars(new Array(60).fill(1)); W.ev('launch', { launchNo: 1 }); check('cartographer_60: retro for a 60-plate veteran, 90 needs more', W.has('cartographer_60') && !W.has('cartographer_90'));
  W = world(); W.seedStars(new Array(59).fill(1)); seal(W, { plateIndex: 75, stars: 1 }); check('cartographer_60: sixty sealed anywhere counts', W.has('cartographer_60'));
  W = world(); W.Save.data.ach.cartographer_60 = '2026-01-01'; W.Save.data.ach.volume_two = '2026-01-02'; W.Save.data.ach.perfectionist = '2026-01-03';
  W.ev('launch', { launchNo: 1 }); W.ev('flightEnd', { status: 'lost', sim: {}, level: L() }); seal(W, { plateIndex: 0, stars: 1 });
  check('held honours are never revoked (nothing sealed now)', W.has('cartographer_60') && W.has('volume_two') && W.has('perfectionist') && W.Save.data.ach.cartographer_60 === '2026-01-01');
  W = world(); W.Save.data.ach.cartographer_60 = '2026-01-01'; W.ev('launch', { launchNo: 1 });
  check('a held honour keeps its date', W.Save.data.ach.cartographer_60 === '2026-01-01');

  // volumes from Levels.VOLUMES: two volumes (as shipped before Volume III) and three
  const V2 = [{ name: 'Volume I', from: 0, to: 29 }, { name: 'Volume II', from: 30, to: 59 }], V3 = V2.concat([{ name: 'Volume III', from: 60, to: 89 }]);
  const vs = (from, to, n) => { const a = new Array(90).fill(0); for (let i = from; i <= to; i++) a[i] = n || 1; return a; };
  W = world({ volumes: V2 }); W.seedStars(vs(0, 89).map((x, i) => i < 89 ? 3 : 0)); seal(W, { plateIndex: 89, stars: 3 });
  check('volume_three never unlocks while the volume does not exist', !W.has('volume_three') && W.has('volume_two') && W.has('volume_one'));
  W = world(); W.seedStars(vs(0, 89).map((x, i) => i < 89 ? 3 : 0)); seal(W, { plateIndex: 89, stars: 3 });
  check('volume_three never unlocks with no Levels at all (and Volumes I/II still use their defaults)', !W.has('volume_three') && W.has('volume_two') && W.has('volume_one') && W.has('cartographer_90'));
  W = world({ volumes: V3 }); W.seedStars(vs(60, 88)); seal(W, { plateIndex: 89, stars: 1 });
  check('volume_three: Volume III sealed (plates 60-89)', W.has('volume_three') && !W.has('volume_one') && !W.has('volume_two') && !W.has('cartographer_90'));
  W = world({ volumes: V3 }); W.seedStars(vs(60, 87)); seal(W, { plateIndex: 89, stars: 1 }); check('volume_three: one plate missing no', !W.has('volume_three'));
  W = world({ volumes: V3 }); W.seedStars(vs(0, 88, 3)); seal(W, { plateIndex: 89, stars: 3 });
  check('all three volumes: volume_one/two/three, perfectionist, cartographer_90', ['volume_one', 'volume_two', 'volume_three', 'perfectionist', 'cartographer_90'].every(i => W.has(i)));
  W = world({ volumes: V3 }); W.seedStars(vs(60, 88, 1)); seal(W, { plateIndex: 89, stars: 1 }); check('perfectionist stays Volume I only (Volume III at one star no)', !W.has('perfectionist'));
  W = world({ volumes: [{ name: 'Volume I', from: 0, to: 29 }, { name: 'Volume II', from: 30, to: 59 }, { name: 'Volume III', from: 60, to: 119 }] }); W.seedStars(vs(60, 89)); seal(W, { plateIndex: 89, stars: 1 });
  check('volume_three: a range beyond Save.N never unlocks', !W.has('volume_three'));
  W = world({ volumes: [{}, null, 7] }); let th = false; try { W.seedStars(vs(0, 88)); seal(W, { plateIndex: 89, stars: 1 }); } catch (e) { th = true; }
  check('malformed Levels.VOLUMES never throws or unlocks volumes', !th && !W.has('volume_three') && !W.has('volume_one'));

  // gates: wormhole plates carry `pair` on their mouths, which must not read as a binary star
  const LW = L({ bodies: [{ kind: 'wormhole', r: 32, mu: 0, pair: 1 }, { kind: 'wormhole', r: 32, mu: 0, pair: 0 }] });
  const hitW = (W, lv, warps, extra) => flight(W, 'hit', simHit({ sim: { warps } }), lv, extra);
  W = world(); hitW(W, LW, 1); seal(W, { level: LW, launches: 1 });
  check('first_gate: sealed with a flight that warped once', W.has('first_gate') && !W.has('double_gate'));
  check('a wormhole plate is not a binary star', !W.has('binary_star'));
  W = world(); hitW(W, LW, 2); seal(W, { level: LW });
  check('double_gate: one flight, two passages (also first_gate)', W.has('double_gate') && W.has('first_gate'));
  W = world(); hitW(W, LW, 0); seal(W, { level: LW }); check('first_gate: a plate with a wormhole but no passage no', !W.has('first_gate'));
  W = world(); flight(W, 'lost', simHit({ sim: { warps: 3 } }), LW); hitW(W, LW, 0); seal(W, { level: LW, launches: 2, stars: 2 });
  check('first_gate: only the sealing flight counts (an earlier warp that missed does not)', !W.has('first_gate') && !W.has('double_gate') && W.stat('warps') === 3);
  W = world(); hitW(W, LW, 1); hitW(W, LW, 1); seal(W, { level: LW }); check('double_gate: passages of two separate flights do not add up', !W.has('double_gate'));
  W = world(); hitW(W, LW, 1); seal(W, { level: L() }); check('first_gate: a flight of another plate does not count', !W.has('first_gate'));
  W = world(); hitW(W, LW, 1); seal(W, { level: LW, mode: 'daily', plateIndex: -1 }); check('first_gate: any mode counts', W.has('first_gate'));
  W = world(); hitW(W, LW, 2); seal(W, { level: LW }); seal(W, { level: LW }); eq('gateSeals: a seal without a fresh flight is not counted twice', W.stat('gateSeals'), 1);
  check('binary_star stays honest for real pairs alongside a wormhole', (() => { const W2 = world(), LP2 = L({ bodies: [{ kind: 'planet', r: 40, mu: 1, pair: 1 }, { kind: 'planet', r: 40, mu: 1, pair: 0 }, LW.bodies[0], LW.bodies[1]] }); hitW(W2, LP2, 1); seal(W2, { level: LP2, launches: 1 }); return W2.has('binary_star') && W2.has('first_gate'); })());

  // gate_keeper and the warps stat
  W = world(); for (let i = 0; i < 9; i++) { hitW(W, LW, 1); seal(W, { level: LW, plateIndex: i }); }
  check('gate_keeper: nine no', !W.has('gate_keeper')); eq('gateSeals nine', W.stat('gateSeals'), 9);
  hitW(W, LW, 3); seal(W, { level: LW, plateIndex: 9 }); check('gate_keeper: tenth sealed warping flight', W.has('gate_keeper')); eq('warps counts every passage', W.stat('warps'), 12);
  W = world(); for (let i = 0; i < 12; i++) flight(W, 'hit', simHit({ sim: { warps: 2 } }), LW); check('gate_keeper: winning flights that were not sealed do not count', !W.has('gate_keeper') && W.stat('warps') === 24);
  W = world(); flight(W, 'crash', simHit({ sim: { warps: 2 } })); flight(W, 'lost', simHit({ sim: { warps: 1 } })); flight(W, 'timeout', simHit({ sim: { warps: 4 } }));
  eq('warps counted on every flightEnd, hit or not', W.stat('warps'), 7);
  W = world(); flight(W, 'hit', simHit({ sim: { warps: -2 } })); flight(W, 'hit', simHit({ sim: { warps: NaN } })); flight(W, 'hit', simHit({ sim: { warps: 1.9 } })); flight(W, 'hit', simHit({ sim: { warps: 'x' } }));
  eq('warps: garbage and negatives ignored, fractions floored', W.stat('warps'), 1);
  W = world(); flight(W, 'hit', simHit()); eq('warps: a sim with no warps field adds nothing', W.stat('warps'), 0);
  eq('snapshot carries warps', W.Log.snapshot().stats.warps, 0);
  W = world(); hitW(W, LW, 2); eq('snapshot stats.warps', W.Log.snapshot().stats.warps, 2);
  W = world({ brokenStorage: true }); hitW(W, LW, 2); seal(W, { level: LW }); check('memory-only Save: gate honours still unlock', W.has('first_gate') && W.has('double_gate'));

  // event_horizon / contrary_star / binary_star
  const LB = L({ bodies: [{ kind: 'blackhole', r: 12, capture: 40, mu: 1 }] }), LR = L({ bodies: [{ kind: 'repulsor', r: 20, mu: -1 }] });
  const LP = L({ bodies: [{ kind: 'planet', r: 40, mu: 1, pair: 1 }, { kind: 'planet', r: 40, mu: 1, pair: 1 }] });
  W = world(); seal(W, { level: LB, launches: 1 }); check('event_horizon: one launch', W.has('event_horizon') && !W.has('contrary_star') && !W.has('binary_star'));
  W = world(); seal(W, { level: LB, launches: 2, stars: 2 }); check('event_horizon: two launches no', !W.has('event_horizon'));
  W = world(); seal(W, { level: LR, launches: 1 }); check('contrary_star: one launch', W.has('contrary_star') && !W.has('event_horizon'));
  W = world(); seal(W, { level: LR, launches: 3, stars: 1 }); check('contrary_star: three launches no', !W.has('contrary_star'));
  W = world(); seal(W, { level: LP, launches: 1 }); check('binary_star: one launch', W.has('binary_star'));
  W = world(); seal(W, { level: L(), launches: 1 }); check('binary_star/event_horizon/contrary_star: plain plate no', !W.has('binary_star') && !W.has('event_horizon') && !W.has('contrary_star'));
  W = world(); seal(W, { level: LB, launches: 1, mode: 'daily', plateIndex: -1 }); check('event_horizon: a daily plate counts', W.has('event_horizon'));

  // persistence
  W = world(); seal(W, { launches: 3, stars: 1 }); check('persistence: third launch', W.has('persistence'));
  W = world(); seal(W, { launches: 2, stars: 2 }); check('persistence: second no', !W.has('persistence'));

  // long_way_round
  W = world(); flight(W, 'hit', simHit({ sim: { step: 960 } })); check('long_way_round: 960', W.has('long_way_round'));
  W = world(); flight(W, 'hit', simHit({ sim: { step: 959 } })); check('long_way_round: 959 no', !W.has('long_way_round'));
  W = world(); flight(W, 'timeout', simHit({ sim: { step: 1200 } })); check('long_way_round: timeout no', !W.has('long_way_round'));

  // fragments: counted once via deltas; comet_hunter
  W = world();
  W.ev('launch', { mode: 'campaign', launchNo: 1, power: 1, hintUsed: false });
  flight(W, 'lost', simHit(), L2, { fragsThisAttempt: 1, launchNo: 1 });
  W.ev('launch', { mode: 'campaign', launchNo: 2, power: 1, hintUsed: false });
  flight(W, 'hit', simHit(), L2, { fragsThisAttempt: 2, launchNo: 2 });
  seal(W, { level: L2, fragsThisAttempt: 2, fragsTotal: 2, launches: 2, stars: 2 });
  eq('frags counted once across launches and seal', W.stat('frags'), 2);
  W.ev('launch', { mode: 'campaign', launchNo: 1, power: 1, hintUsed: false });     // Reset: new attempt on same plate
  flight(W, 'hit', simHit(), L2, { fragsThisAttempt: 2, launchNo: 1 });
  eq('frags recounted in a fresh attempt', W.stat('frags'), 4);
  W = world();
  for (let a = 0; a < 12; a++) { W.ev('launch', { launchNo: 1 }); flight(W, 'hit', simHit(), L2, { fragsThisAttempt: 2 }); }
  check('comet_hunter at 25', W.stat('frags') === 24 && !W.has('comet_hunter'), 'frags ' + W.stat('frags'));
  W.ev('launch', { launchNo: 1 }); flight(W, 'hit', simHit(), L2, { fragsThisAttempt: 1 }); check('comet_hunter unlocked', W.has('comet_hunter') && W.stat('frags') === 25);

  // apprentice
  W = world(); W.ev('hint', { mode: 'campaign', level: L() }); check('apprentice', W.has('apprentice')); eq('hints stat', W.stat('hints'), 1);

  // self_reliant
  W = world(); for (let i = 0; i < 19; i++) seal(W, { plateIndex: i, hintUsed: false, stars: 3 });
  check('self_reliant: 19 no', !W.has('self_reliant')); seal(W, { plateIndex: 19, hintUsed: false, stars: 3 }); check('self_reliant: 20', W.has('self_reliant'));
  W = world(); for (let i = 0; i < 25; i++) seal(W, { plateIndex: i, hintUsed: true, stars: 2 }); check('self_reliant: hinted seals never count', !W.has('self_reliant')); eq('platesNoHint (hinted)', W.stat('platesNoHint'), 0);
  W = world(); for (let i = 0; i < 25; i++) seal(W, { mode: 'endless', plateIndex: -1, hintUsed: false }); check('self_reliant: endless seals do not count', !W.has('self_reliant'));

  // daily
  W = world(); W.ev('daily', { key: '2026-09-30', stars: 1, launches: 3, streak: 2, best: 2, first: true }); check('daily_3: streak 2 no', !W.has('daily_3')); eq('dailyWins', W.stat('dailyWins'), 1);
  W.ev('daily', { key: '2026-10-01', stars: 2, launches: 2, streak: 3, best: 3, first: true }); check('daily_3', W.has('daily_3') && !W.has('daily_7') && !W.has('daily_perfect'));
  W = world(); W.ev('daily', { key: 'k', stars: 2, launches: 2, streak: 1, best: 7, first: true }); check('daily_7 via best', W.has('daily_7') && W.has('daily_3'));
  W = world(); W.ev('daily', { key: 'k', stars: 2, launches: 2, streak: 30, best: 30, first: true }); check('daily_30', W.has('daily_30') && W.has('daily_7') && W.has('daily_3'));
  W = world(); W.ev('daily', { key: 'k', stars: 3, launches: 1, streak: 1, best: 1, first: true }); check('daily_perfect', W.has('daily_perfect'));
  W = world(); W.ev('daily', { key: 'k', stars: 3, launches: 1, streak: 1, best: 1, first: false }); eq('dailyWins: a retry is not another win', W.stat('dailyWins'), 0);
  W = world(); W.ev('daily', { key: 'k', stars: 2, launches: 2, streak: 1, best: 1, first: true }); check('daily_perfect: two launches no', !W.has('daily_perfect'));
  W = world(); W.Save.data.daily.best = 7; W.ev('launch', { launchNo: 1 }); check('daily_7 retro-unlocks from an existing save', W.has('daily_7'));

  // endless
  W = world(); W.ev('endlessRound', { round: 4, score: 3 }); check('endless_5: round 4 no', !W.has('endless_5'));
  W.ev('endlessRound', { round: 5, score: 4 }); check('endless_5', W.has('endless_5') && !W.has('endless_10'));
  W.ev('endlessRound', { round: 10, score: 9 }); check('endless_10', W.has('endless_10')); eq('endlessRounds stat', W.stat('endlessRounds'), 3);

  // idempotence, sound, queueing
  W = world(); seal(W); seal(W); seal(W);
  eq('idempotent: first_light toasted once', W.toasts.filter(t => t.t === 'First Light').length, 1);
  eq('idempotent: one Save.ach entry', Object.keys(W.Save.data.ach).length, W.toasts.length);
  check('toast passes {ach:true} (LogUI plays Sound.ach)', W.toasts[0] && W.toasts[0].o && W.toasts[0].o.ach === true && !!W.toasts[0].s);
  W = world(); seal(W, { level: LB, launches: 1 });
  eq('two honours in one event are two toasts', W.toasts.length, 2);
  check('the toasts are first_light and event_horizon', W.toasts.map(t => t.t).sort().join('|') === ['Event Horizon', 'First Light'].sort().join('|'));
  W = world(); const rich = new Array(60).fill(3); W.seedStars(rich); W.ev('launch', { launchNo: 1 });
  check('veteran save: retro unlocks capped with a summary toast', W.toasts.length === 6 && /further honours/.test(W.toasts[5].t), 'toasts ' + W.toasts.length);
  // persisted
  W = world(); seal(W); const raw = JSON.parse(W.store['perihelion.v1']); check('achievement persisted in localStorage', !!raw.ach.first_light);

  // stats
  W = world();
  W.ev('launch', { mode: 'campaign', launchNo: 1, power: 0.5, hintUsed: false });
  flight(W, 'crash', simHit({ sim: { dist: 100, minGap: 0 } })); flight(W, 'captured', simHit({ sim: { dist: 50 } }));
  flight(W, 'lost', simHit({ sim: { dist: 200 } })); flight(W, 'timeout', simHit({ sim: { dist: 300 } }));
  flight(W, 'hit', simHit({ sim: { dist: 400, minGap: 30 } }));
  eq('stat launches', W.stat('launches'), 1); eq('stat wins', W.stat('wins'), 1); eq('stat losses', W.stat('losses'), 4);
  eq('stat crashes', W.stat('crashes'), 2); eq('stat lost', W.stat('lost'), 2); eq('stat distance', W.stat('distance'), 1050);
  eq('snapshot hitRate = wins/launches', W.Log.snapshot().stats.hitRate, 1);
  W.ev('launch', { launchNo: 2 }); W.ev('launch', { launchNo: 3 }); W.ev('launch', { launchNo: 1 });
  eq('snapshot hitRate 1/4', W.Log.snapshot().stats.hitRate, 0.25);
  const snap = world().Log.snapshot();
  check('snapshot shape', snap.totals && typeof snap.totals.sealed === 'number' && typeof snap.daily.streak === 'number' && 'best' in snap.daily && 'last' in snap.daily && 'done' in snap.daily &&
    snap.achievements.length === W.Log.ACHIEVEMENTS.length && snap.achievements.every(a => a.id && a.name && a.blurb && a.unlocked === false && a.date === null));
  W = world(); seal(W); const a0 = W.Log.snapshot().achievements.find(a => a.id === 'first_light');
  check('snapshot: unlocked entry has a date', a0.unlocked && /^\d{4}-\d{2}-\d{2}$/.test(a0.date));
  check('ACHIEVEMENTS: unique ids, valid names, blurbs', (() => { const ids = W.Log.ACHIEVEMENTS.map(a => a.id); return new Set(ids).size === ids.length && ids.every(i => /^[A-Za-z0-9_]{1,32}$/.test(i)); })(), W.Log.ACHIEVEMENTS.length + ' honours');
  eq('snapshot: no launches means hitRate 0', world().Log.snapshot().stats.hitRate, 0);

  // robustness
  W = world({ brokenStorage: true });
  let threw = false;
  try {
    W.ev('launch', { launchNo: 1 }); flight(W, 'hit', simHit()); seal(W); W.ev('hint', {}); W.ev('daily', {}); W.ev('endlessRound', {});
  } catch (e) { threw = true; }
  check('memory-only Save: never throws, still unlocks', !threw && W.has('first_light'));
  W = world(); threw = false;
  try {
    W.ev(); W.ev('nope'); W.ev('flightEnd'); W.ev('flightEnd', null); W.ev('flightEnd', { sim: null, level: null, status: 'hit' }); W.ev('plateSealed', 7);
    W.ev('plateSealed', { level: { bodies: 5, frags: 'x' }, plateIndex: 'NaN', stars: {}, launches: 'z' }); W.ev('launch', 'x'); W.ev('daily', { streak: 'x' });
    W.ev('endlessRound', { round: {} }); W.ev('flightEnd', { status: 'hit', sim: { minGap: 'a', dist: NaN, step: {} }, level: { target: null }, fragsThisAttempt: -4 });
  } catch (e) { threw = true; }
  check('garbage payloads never throw', !threw);
  W = world(); W.ctx.LogUI = { toast() { throw new Error('ui down'); } }; threw = false;
  try { seal(W); } catch (e) { threw = true; } check('a throwing LogUI does not break Log', !threw && W.has('first_light'));
  W = world(); delete W.ctx.LogUI; W.ctx.LogUI = undefined; threw = false;
  try { seal(W); } catch (e) { threw = true; } check('missing LogUI falls back to Sound.ach()', !threw && W.has('first_light') && W.sounds.length === 1);

  // Sound.ach exists and is safe with no AudioContext
  const sctx = vm.createContext({ window: {}, Audio: function () {}, navigator: {}, btoa: s => Buffer.from(s, 'binary').toString('base64'), setTimeout });
  vm.runInContext(SRC('40-audio.js'), sctx);
  check('Sound.ach is exported and silent-safe', typeof sctx.Sound.ach === 'function' && (sctx.Sound.ach(), true));
}

// ------------------------------------------------------------------------------------------------ (b) browser
async function browserTests() {
  cp.execFileSync('node', [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
  const { chromium } = require('playwright');
  const file = path.join(ROOT, 'dist', 'perihelion.html');
  const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
  const browser = await chromium.launch();

  // seeding runs in the page before the bundle: dates are relative to the page's "today"
  const seedHalf = () => {
    const pad = n => (n < 10 ? '0' : '') + n, key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const now = new Date(), done = {};
    // sealed on days ago: 0..3 (streak 4), 5, 6, 9, 12
    [[0, 3], [1, 2], [2, 3], [3, 1], [5, 2], [6, 3], [9, 1], [12, 2]].forEach(([ago, st]) => { done[key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 12))] = st; });
    const stars = [], frags = [];
    for (let i = 0; i < 60; i++) { stars.push(i < 27 ? [3, 2, 3, 1, 3, 2][i % 6] : 0); frags.push(i < 27 ? (i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0) : 0); }
    const t = key(now);
    const ach = {}; ['first_light', 'thread_needle', 'cartographer_10', 'apprentice', 'daily_3', 'near_ten', 'persistence', 'event_horizon', 'comet_hunter', 'one_shot_ten', 'long_way_round'].forEach((id, i) => { ach[id] = '2026-09-' + pad(10 + i); });
    localStorage.setItem('perihelion.v1', JSON.stringify({ v: 2, stars, frags, unlocked: 28, endlessBest: 7, muted: true, seen: { intro: true, fragments: true },
      daily: { last: t, lastStars: 3, lastLaunches: 1, streak: 4, best: 6, done },
      stats: { launches: 143, wins: 61, losses: 82, crashes: 40, lost: 42, distance: 184230, frags: 31, hints: 3, nearMiss: 17, threads: 5, platesNoHint: 22, dailyWins: 8, endlessRounds: 12 }, ach }));
  };
  const seedFull = () => {
    const stars = [], frags = []; for (let i = 0; i < 90; i++) { stars.push(3); frags.push(1); }
    localStorage.setItem('perihelion.v1', JSON.stringify({ v: 2, stars, frags, unlocked: 90, muted: true, seen: { intro: true, fragments: true },
      stats: { launches: 1234567, wins: 999999, distance: 98765432, nearMiss: 1500, threads: 250, warps: 1234567 } }));
  };

  async function open(opts, seed) {
    const ctx = await browser.newContext(opts);
    if (seed) await ctx.addInitScript(seed);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_|net::|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => { if (/dropPopup/.test(e.message)) { if (!global.__warned) { global.__warned = 1; console.log('NOTE ignoring FEEL-owned page error: ' + e.message); } } else errors.push('pageerror: ' + e.message); });
    await page.goto('file://' + file, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    return { ctx, page, errors };
  }
  const shot = async (page, name) => { const p = path.join(QA, name); await page.screenshot({ path: p }); return p; };
  const openLog = async page => { await page.evaluate(() => { if (window.__closed === undefined) window.__closed = 0; LogUI.open(() => { window.__closed++; }); }); await page.waitForTimeout(450); };

  // ---- portrait, empty state
  let s = await open(IPHONE, null);
  const has = await s.page.evaluate(() => ({ log: typeof Log, ui: typeof LogUI, ach: typeof Sound.ach }));
  check('page globals Log / LogUI / Sound.ach present', has.log === 'object' && has.ui === 'object' && has.ach === 'function', JSON.stringify(has));
  await openLog(s.page);
  await shot(s.page, 'log-empty.png');
  let m = await s.page.evaluate(() => {
    const r = document.getElementById('logui'), sc = r.querySelector('.lg-scroll'), b = r.querySelector('.lg-back').getBoundingClientRect();
    return { on: r.classList.contains('on'), z: getComputedStyle(r).zIndex, uiZ: getComputedStyle(document.getElementById('ui')).zIndex, style: document.querySelectorAll('#logui-css').length,
      overflowX: sc.scrollWidth > sc.clientWidth, bodyScroll: [document.body.scrollTop, document.documentElement.scrollTop, window.scrollY], backW: b.width, backH: b.height,
      overscroll: getComputedStyle(sc).overscrollBehaviorY, honours: r.querySelectorAll('.lg-hon').length, locked: r.querySelectorAll('.lg-hon:not(.got)').length, count: r.querySelector('.lg-count').textContent };
  });
  check('log opens above #ui (z-index), one <style id=logui-css>', m.on && +m.z > +m.uiZ && m.style === 1, JSON.stringify({ z: m.z, uiZ: m.uiZ }));
  check('no horizontal overflow, overscroll contained', !m.overflowX && m.overscroll === 'contain');
  check('back button >= 44 px', m.backW >= 44 && m.backH >= 44, m.backW + 'x' + m.backH);
  check('empty state: all honours listed and locked', m.honours === NH && m.locked === NH && new RegExp('0 of ' + NH).test(m.count), m.count);

  // scroll by touch swipe: the game's document-level touchmove guard must not swallow it
  const cdp = await s.ctx.newCDPSession(s.page);
  const swipe = async (y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0, id: 1 }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / 10, id: 1 }] }); await s.page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await s.page.waitForTimeout(400);
  };
  await swipe(650, 150);
  m = await s.page.evaluate(() => ({ top: document.querySelector('.lg-scroll').scrollTop, body: [document.body.scrollTop, document.documentElement.scrollTop, window.scrollY] }));
  check('touch swipe scrolls the log, the body stays put', m.top > 100 && m.body.every(v => v === 0), 'scrollTop ' + m.top);
  await shot(s.page, 'log-empty-scrolled.png');
  // back button
  await s.page.evaluate(() => { document.querySelector('.lg-back').click(); }); await s.page.waitForTimeout(400);
  m = await s.page.evaluate(() => ({ on: document.getElementById('logui').classList.contains('on'), vis: getComputedStyle(document.getElementById('logui')).visibility, closed: window.__closed }));
  check('back button closes and calls onClose once', !m.on && m.vis === 'hidden' && m.closed === 1, JSON.stringify(m));
  await openLog(s.page); await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(400);
  m = await s.page.evaluate(() => ({ on: document.getElementById('logui').classList.contains('on'), closed: window.__closed }));
  check('Escape closes and calls onClose', !m.on && m.closed === 2, JSON.stringify(m));
  await s.page.evaluate(() => { LogUI.open(() => { window.__closed++; }); LogUI.close(); }); await s.page.waitForTimeout(400);
  m = await s.page.evaluate(() => ({ on: document.getElementById('logui').classList.contains('on'), closed: window.__closed }));
  check('LogUI.close() hides silently', !m.on && m.closed === 2);
  check('no console errors (empty)', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  // ---- portrait, half-full state, toast
  s = await open(IPHONE, seedHalf);
  await openLog(s.page);
  await shot(s.page, 'log-half.png');
  await s.page.evaluate(() => { document.querySelector('.lg-scroll').scrollTop = 470; }); await s.page.waitForTimeout(200);
  await shot(s.page, 'log-half-daily.png');
  await s.page.evaluate(() => { document.querySelector('.lg-scroll').scrollTop = 1e6; }); await s.page.waitForTimeout(200);
  await shot(s.page, 'log-half-end.png');
  m = await s.page.evaluate(() => { const sc = document.querySelector('.lg-scroll'); return { count: document.querySelector('.lg-count').textContent, got: document.querySelectorAll('.lg-hon.got').length, sealedDays: document.querySelectorAll('.lg-day.got').length, days: document.querySelectorAll('.lg-day').length, overflowX: sc.scrollWidth > sc.clientWidth, txt: document.querySelector('.lg-figs').textContent }; });
  check('half-full: 11 honours, 8 sealed days of 14', m.got === 11 && new RegExp('11 of ' + NH).test(m.count) && m.sealedDays === 8 && m.days === 14 && !m.overflowX, JSON.stringify(m));
  // toast
  await s.page.evaluate(() => { LogUI.toast('Threading the Needle', 'Win a flight that passes within 12 units of a body.', { ach: true }); });
  await s.page.waitForTimeout(500);
  await shot(s.page, 'log-toast.png');
  m = await s.page.evaluate(() => { const t = document.querySelector('#logui-toasts .lg-toast'), r = t.getBoundingClientRect(); return { pe: getComputedStyle(t).pointerEvents, hostPe: getComputedStyle(document.getElementById('logui-toasts')).pointerEvents, z: getComputedStyle(document.getElementById('logui-toasts')).zIndex, top: r.top, cx: r.left + r.width / 2, on: t.classList.contains('on') }; });
  check('toast: top centre, pointer-events none, z above the log', m.on && m.pe === 'none' && m.hostPe === 'none' && +m.z > 60 && m.top >= 8 && Math.abs(m.cx - 195) < 2, JSON.stringify(m));
  // queue: three toasts run one after another
  await s.page.evaluate(() => { LogUI.toast('Second', 'two'); LogUI.toast('Third', 'three'); });
  await s.page.waitForTimeout(400);
  let n = await s.page.evaluate(() => document.querySelectorAll('#logui-toasts .lg-toast').length);
  check('toast queue shows one banner at a time', n === 1, 'banners ' + n);
  await s.page.waitForTimeout(3300);
  const titles = await s.page.evaluate(() => Array.from(document.querySelectorAll('#logui-toasts .lg-tt')).map(e => e.textContent));
  check('toast queue advances after ~3 s', titles.length === 1 && titles[0] === 'Second', JSON.stringify(titles));
  await s.page.waitForTimeout(6800);
  n = await s.page.evaluate(() => document.querySelectorAll('#logui-toasts .lg-toast').length);
  check('toasts remove themselves', n === 0, 'banners ' + n);
  // a toast over the game's own card: fire while the title menu is showing (log closed)
  await s.page.evaluate(() => LogUI.close());
  await s.page.evaluate(() => { LogUI.toast('First Light', 'Seal any plate.', { ach: true }); }); await s.page.waitForTimeout(500);
  await shot(s.page, 'log-toast-title.png');
  m = await s.page.evaluate(() => { const t = document.querySelector('#logui-toasts .lg-toast').getBoundingClientRect(), w = document.querySelector('.t-name').getBoundingClientRect(); return { toastBottom: t.bottom, wordTop: w.top, h: t.height }; });
  check('title toast: compact and clear of the wordmark', m.toastBottom < m.wordTop - 4 && m.h <= 48, JSON.stringify(m));
  await s.page.waitForTimeout(3600);
  // ---- play screen, iPhone with a notch (safe top 47 / bottom 34): the banner sits just inside the plate top, clear of every target
  const NOTCH = { top: 47, right: 0, bottom: 34, left: 0 };
  const playToast = async (idx, name, file) => {
    await s.page.evaluate(([i, sf]) => { __peri.loadLevel(i); Render.resize(innerWidth, innerHeight, 3, sf); }, [idx, NOTCH]);
    await s.page.waitForTimeout(700);
    await s.page.evaluate(([t, sf]) => { Render.resize(innerWidth, innerHeight, 3, sf); LogUI.toast(t, 'blurb', { ach: true }); }, [name, NOTCH]);
    await s.page.waitForTimeout(500);
    const r = await s.page.evaluate(() => { const t = document.querySelector('#logui-toasts .lg-toast').getBoundingClientRect(), L = Render.layout; return { l: t.left, r: t.right, t: t.top, b: t.bottom, plateY: L.plate.y, h: t.height, scr: __peri.state.screen, pe: getComputedStyle(document.querySelector('#logui-toasts .lg-toast')).pointerEvents }; });
    if (file) await shot(s.page, file);
    await s.page.waitForTimeout(3600);
    return r;
  };
  const longest = 'The Astronomer\u2019s Apprentice';
  const r1 = await playToast(0, 'First Light', 'log-toast-play.png');
  check('play toast: one line <= 38 px, top = plate top + 4, pointer-events none', r1.scr === 'play' && r1.h <= 38 && Math.abs(r1.t - (r1.plateY + 4)) < 1 && r1.pe === 'none', JSON.stringify(r1));
  const r2 = await playToast(27, longest, 'log-toast-play-high.png');
  check('play toast (longest honour name): still one line, inside the screen', r2.h <= 38 && r2.l >= 12 - 1 && r2.r <= 390 - 12 + 1, JSON.stringify(r2));
  const hit = await s.page.evaluate(([R2, sf]) => {
    Render.resize(innerWidth, innerHeight, 3, sf);
    const out = [], L = Render.layout, k = L.scale;
    const check = (lv, tag) => {
      const p = Render.worldToScreen(lv.target.x, lv.target.y), r = lv.target.r * k;
      const clash = !(R2.r < p.x - r || R2.l > p.x + r || R2.b < p.y - r || R2.t > p.y + r);
      out.push({ tag, top: +(p.y - r).toFixed(1), clash });
    };
    Levels.CAMPAIGN.forEach((lv, i) => check(lv, 'c' + (i + 1)));
    for (let d = 1; d <= 28; d++) { const key = '2026-10-' + (d < 10 ? '0' : '') + d; try { check(Levels.daily(key), 'd' + key); } catch (e) { out.push({ tag: 'd' + key, err: String(e) }); } }
    return { n: out.length, clashes: out.filter(o => o.clash), errs: out.filter(o => o.err), highest: out.filter(o => o.top !== undefined).sort((a, b) => a.top - b.top).slice(0, 3), toastBottom: R2.b };
  }, [{ l: 0, r: 390, t: r1.t, b: r1.b }, NOTCH]);
  // (the full-width rect is the worst case: any target that clears it clears the real, narrower banner)
  check('no target of the 90 plates + 28 daily plates reaches the banner band', hit.n === 118 && hit.clashes.length === 0 && hit.errs.length === 0, JSON.stringify({ n: hit.n, clashes: hit.clashes, errs: hit.errs, highest: hit.highest, toastBottom: hit.toastBottom }));
  check('no console errors (half-full)', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  // ---- portrait, everything full, extreme numbers
  s = await open(IPHONE, seedFull);
  await s.page.evaluate(() => { Save.data.ach.first_light = '2026-09-30'; Log.ACHIEVEMENTS.forEach(a => { Save.data.ach[a.id] = '2026-09-30'; }); });
  await openLog(s.page);
  await shot(s.page, 'log-full.png');
  m = await s.page.evaluate(() => { const sc = document.querySelector('.lg-scroll'); return { overflowX: sc.scrollWidth > sc.clientWidth, count: document.querySelector('.lg-count').textContent, figs: Array.from(document.querySelectorAll('.lg-fig b')).map(e => e.scrollWidth <= e.parentElement.clientWidth) }; });
  check('full state: no overflow, figures fit their boxes', !m.overflowX && m.figs.every(Boolean) && new RegExp(NH + ' of ' + NH).test(m.count), JSON.stringify(m));
  m = await s.page.evaluate(() => {
    const sc = document.querySelector('.lg-scroll'), W = sc.clientWidth; sc.scrollTop = sc.scrollHeight; const cards = Array.from(document.querySelectorAll('.lg-hon')), last = cards[cards.length - 1].getBoundingClientRect(), box = sc.getBoundingClientRect();
    const rows = Array.from(document.querySelectorAll('.lg-ledger li')), figs = Array.from(document.querySelectorAll('.lg-fig b')).map(e => e.textContent);
    return { n: cards.length, clipped: cards.filter(c => c.scrollWidth > c.clientWidth || Array.from(c.children).some(k => k.scrollWidth > k.clientWidth + 1)).length, offscreen: cards.filter(c => { const r = c.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).length,
      lastVisible: last.bottom <= box.bottom + 1, rowsFit: rows.every(r => r.scrollWidth <= r.clientWidth), rows: rows.map(r => r.textContent), figs, pageW: document.documentElement.scrollWidth <= innerWidth, W };
  });
  check('full state, 390x844: all ' + NH + ' honours fit and the last is reachable', m.n === NH && m.clipped === 0 && m.offscreen === 0 && m.lastVisible && m.rowsFit && m.pageW, JSON.stringify(m));
  check('full state: totals read x/90 and x/270; gates passed is shown', m.figs[0] === '90/90' && m.figs[1] === '270/270' && m.rows.some(r => /Gates passed/.test(r) && /1,234,567/.test(r)), JSON.stringify(m.figs) + ' ' + JSON.stringify(m.rows));
  await shot(s.page, 'log-full-end.png');
  check('no console errors (full)', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  // ---- landscape 844x390
  const LAND = Object.assign({}, IPHONE, { viewport: { width: 844, height: 390 } });
  s = await open(LAND, seedHalf);
  await openLog(s.page);
  await shot(s.page, 'log-landscape.png');
  await s.page.evaluate(() => { document.querySelector('.lg-scroll').scrollTop = 330; }); await s.page.waitForTimeout(200);
  await shot(s.page, 'log-landscape-2.png');
  m = await s.page.evaluate(() => { const sc = document.querySelector('.lg-scroll'), b = document.querySelector('.lg-back').getBoundingClientRect(), h = document.querySelector('.lg-head').getBoundingClientRect(); return { overflowX: sc.scrollWidth > sc.clientWidth, backH: b.height, backW: b.width, headH: h.height, scrollH: sc.clientHeight }; });
  check('landscape: no overflow, back >= 44, header leaves room to scroll', !m.overflowX && m.backH >= 44 && m.backW >= 44 && m.scrollH > 200, JSON.stringify(m));
  check('no console errors (landscape)', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  // ---- reduced motion + safe-area sanity (emulated media)
  const RM = await browser.newContext(Object.assign({}, IPHONE, { reducedMotion: 'reduce' }));
  const rp = await RM.newPage(); await rp.goto('file://' + file); await rp.waitForTimeout(400);
  await rp.evaluate(() => LogUI.open()); await rp.waitForTimeout(60);
  const rm = await rp.evaluate(() => { const r = document.getElementById('logui'); return { d: getComputedStyle(r).transitionDuration, on: r.classList.contains('on'), op: getComputedStyle(r).opacity }; });
  check('reduced motion: transitions collapse to 1 ms', /0\.001s/.test(rm.d) && rm.on && +rm.op === 1, JSON.stringify(rm));
  await RM.close();

  await browser.close();
}

(async () => {
  logicTests();
  try { await browserTests(); } catch (e) { check('browser tests ran', false, e && e.stack || String(e)); }
  const bad = results.filter(r => !r.ok);
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
  if (bad.length) { console.log('FAILED:\n  ' + bad.map(b => b.name).join('\n  ')); process.exit(1); }
})();
