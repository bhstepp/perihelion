/* PERIHELION — Observer's Log: lifetime statistics and honours (owner: LOG AGENT).
   Log.event(name, data) is called by the game (see docs/CONTRACT-v2.md §4). It never throws: every step is wrapped, and
   it works if Save is memory-only. Counters live in Save.data.stats (via Save.bump); unlocked honours in Save.data.ach.
   Honours are idempotent (Save.unlockAch returns true once) and are re-evaluated after every event, so cumulative ones
   also unlock retroactively for saves that predate this module.

   Interface notes:
   - flightEnd is the one place fragments and flight statistics are counted, so each is counted exactly once per flight.
     Fragments are counted from the delta of fragsThisAttempt since the previous event of the same attempt (the counter
     persists across the launches of one attempt; a 'launch' with launchNo 1, a different plate, or a smaller value
     starts a new attempt). plateSealed only tops up if a pickup was somehow not seen by flightEnd.
   - "clean sweep" compares fragsThisAttempt with the number of fragments on the plate (level.frags.length; falls back to
     data.fragsTotal when no level is given).
   - Campaign-only counts (cartographer, volumes, perfectionist, self_reliant) use plateIndex >= 0 and treat the plate being
     sealed as sealed even if Save.recordPlate has not run yet.
   - Volume ranges come from Levels.VOLUMES (Volumes I and II fall back to 0-29 / 30-59 if Levels is missing); a volume that
     does not exist never unlocks its honour. Plate counts come from Save.N. Honours are only ever added, never revoked.
   - Wormholes: flightEnd counts sim.warps (stat 'warps') and remembers whether the winning flight warped; plateSealed uses
     that for the gate honours (stat 'gateSeals' counts sealed flights that warped).
   - Nebulae and pulsars (CONTRACT-v4 §6) work the same way: flightEnd counts sim.fog (stat 'fog', steps inside nebulae)
     and sim.beams (stat 'beams', beam catches) on every flight, and plateSealed judges the veil/beam honours on the
     sealing flight only.
   - Nothing assumes a plate count. The campaign size is Levels.CAMPAIGN.length (Save.N without Levels); the later
     cartographers ask for every plate up to the end of their volume (cartographer_90 = Volume III's last plate + 1, so
     still ninety plates) and, like the volume honours, never unlock while that volume's plates do not exist. */
var Log = (function () {
  var ROM_VOL = [{ from: 0, to: 29 }, { from: 30, to: 59 }];

  // ---- honours -------------------------------------------------------------------------------------------------------
  // Each: id, name, blurb, test(c) -> bool. `c` is the evaluation context (see ctx()). `ev` limits event-driven tests.
  function sealedAll(c, from, to, min) {
    for (var i = from; i <= to; i++) if ((c.stars[i] || 0) < min) return false;
    return true;
  }
  function hasKind(level, kind) {
    var b = level && level.bodies;
    if (!b) return false;
    for (var i = 0; i < b.length; i++) if (b[i] && b[i].kind === kind) return true;
    return false;
  }
  function hasPair(level) {
    var b = level && level.bodies;
    if (!b) return false;
    for (var i = 0; i < b.length; i++) if (b[i] && b[i].kind !== 'wormhole' && b[i].pair !== undefined && b[i].pair !== null) return true;
    return false;
  }
  function vol(i) {
    var v = null, have = false;
    try { have = Levels.VOLUMES && typeof Levels.VOLUMES.length === 'number'; if (have) v = Levels.VOLUMES[i]; } catch (e) {}
    if (!have) v = ROM_VOL[i];
    if (!v || typeof v !== 'object') return null;
    var from = Math.floor(Number(v.from)), to = Math.floor(Number(v.to));
    return isFinite(from) && isFinite(to) && from >= 0 && to >= from ? { from: from, to: to } : null;
  }
  // plates that exist now: the campaign as loaded (it may still be shorter than the save), never more than the save holds
  function platesNow() {
    var n = 0; try { n = Save.N | 0; } catch (e) {}
    try { if (Levels.CAMPAIGN && typeof Levels.CAMPAIGN.length === 'number') n = n > 0 ? Math.min(n, Levels.CAMPAIGN.length) : Levels.CAMPAIGN.length; } catch (e) {}
    return n;
  }
  function volDone(c, i, min) { var v = vol(i); return !!v && v.to < platesNow() && sealedAll(c, v.from, v.to, min); }
  // seal as many plates as there are up to the end of volume i (and those plates exist)
  function volCount(c, i) { var v = vol(i); return !!v && v.to < platesNow() && c.totals.sealed >= v.to + 1; }
  function sealedNow(c) { return c.ev === 'plateSealed'; }
  function oneShot(c) { return sealedNow(c) && c.data.launches === 1; }
  // physics steps in two seconds (240 at the 120 Hz step)
  var FOG_LONG = 240; try { if (K.DT > 0) FOG_LONG = Math.round(2 / K.DT); } catch (e) {}

  var LIST = [
    { id: 'first_light', name: 'First Light', blurb: 'Seal any plate.',
      test: function (c) { return sealedNow(c); } },
    { id: 'thread_needle', name: 'Threading the Needle', blurb: 'Win a flight that passes within 12 units of a body.',
      test: function (c) { return c.ev === 'flightEnd' && c.win && c.minGap <= 12; } },
    { id: 'near_ten', name: 'Ten Near Misses', blurb: 'Graze a body within 20 units, ten times over.',
      test: function (c) { return c.stat('nearMiss') >= 10; } },
    // A flight ends the instant it crosses the ring's edge, so minDist is about the ring radius on every win and
    // "within 8 units of the centre" could never be met. The honour is judged on the heading at entry instead (within
    // 8 degrees of the ring's centre); minDist <= 8 also qualifies (only possible for a tiny ring).
    { id: 'dead_center', name: 'Dead Centre', blurb: 'Win with the probe heading straight for the ring’s centre.',
      test: function (c) { return c.ev === 'flightEnd' && c.win && (c.aimOff <= 8 || c.minDist <= 8); } },
    { id: 'clean_sweep', name: 'The Clean Sweep', blurb: 'Gather every fragment of a plate in one attempt, and seal it.',
      test: function (c) { return sealedNow(c) && c.fragsPlate >= 2 && c.fragsAttempt >= c.fragsPlate; } },
    { id: 'one_shot_ten', name: 'Ten True Shots', blurb: 'Earn three stars on ten plates.',
      test: function (c) { return c.totals.threeStar >= 10; } },
    { id: 'cartographer_10', name: 'Apprentice Cartographer', blurb: 'Seal ten plates of the Atlas.',
      test: function (c) { return c.totals.sealed >= 10; } },
    { id: 'cartographer_30', name: 'Journeyman Cartographer', blurb: 'Seal thirty plates of the Atlas.',
      test: function (c) { return c.totals.sealed >= 30; } },
    { id: 'cartographer_60', name: 'Master Cartographer', blurb: 'Seal sixty plates of the Atlas.',
      test: function (c) { return c.totals.sealed >= 60; } },
    { id: 'cartographer_90', name: 'Cartographer of the Third Volume', blurb: 'Seal ninety plates of the Atlas.',
      test: function (c) { return volCount(c, 2); } },
    { id: 'cartographer_120', name: 'Cartographer of the Fourth Volume', blurb: 'Seal one hundred and twenty plates of the Atlas.',
      test: function (c) { return volCount(c, 3); } },
    { id: 'cartographer_150', name: 'Cartographer of the Fifth Volume', blurb: 'Seal one hundred and fifty plates of the Atlas.',
      test: function (c) { return volCount(c, 4); } },
    { id: 'volume_one', name: 'Volume I, Complete', blurb: 'Seal every plate of Volume I.',
      test: function (c) { return volDone(c, 0, 1); } },
    { id: 'volume_two', name: 'Volume II, Complete', blurb: 'Seal every plate of Volume II.',
      test: function (c) { return volDone(c, 1, 1); } },
    { id: 'volume_three', name: 'Volume III, Complete', blurb: 'Seal every plate of Volume III.',
      test: function (c) { return volDone(c, 2, 1); } },
    { id: 'volume_four', name: 'Volume IV, Complete', blurb: 'Seal every plate of Volume IV.',
      test: function (c) { return volDone(c, 3, 1); } },
    { id: 'volume_five', name: 'Volume V, Complete', blurb: 'Seal every plate of Volume V.',
      test: function (c) { return volDone(c, 4, 1); } },
    { id: 'perfectionist', name: 'The Perfectionist', blurb: 'Three stars on every plate of Volume I.',
      test: function (c) { return volDone(c, 0, 3); } },
    { id: 'event_horizon', name: 'Event Horizon', blurb: 'Seal a plate holding a black hole with a single launch.',
      test: function (c) { return oneShot(c) && hasKind(c.level, 'blackhole'); } },
    { id: 'contrary_star', name: 'Contrary Star', blurb: 'Seal a plate holding a repulsor with a single launch.',
      test: function (c) { return oneShot(c) && hasKind(c.level, 'repulsor'); } },
    { id: 'binary_star', name: 'Binary Star', blurb: 'Seal a plate holding a binary pair with a single launch.',
      test: function (c) { return oneShot(c) && hasPair(c.level); } },
    { id: 'first_gate', name: 'Through the Gate', blurb: 'Seal a plate with a flight that passed a wormhole.',
      test: function (c) { return sealedNow(c) && c.warps >= 1; } },
    { id: 'double_gate', name: 'Twice Through', blurb: 'Seal a plate with one flight that passed two wormholes.',
      test: function (c) { return sealedNow(c) && c.warps >= 2; } },
    { id: 'gate_keeper', name: 'Keeper of the Gates', blurb: 'Seal ten flights that passed a wormhole.',
      test: function (c) { return c.stat('gateSeals') >= 10; } },
    { id: 'into_the_veil', name: 'Into the Veil', blurb: 'Seal a plate with a flight that passed through a nebula.',
      test: function (c) { return sealedNow(c) && c.fog > 0; } },
    { id: 'becalmed', name: 'Becalmed', blurb: 'Seal a plate with one flight that spent two seconds in nebulae.',
      test: function (c) { return sealedNow(c) && c.fog >= FOG_LONG; } },
    { id: 'lighthouse', name: 'By the Lighthouse', blurb: 'Seal a plate with a flight that a pulsar’s beam pushed.',
      test: function (c) { return sealedNow(c) && c.beams > 0; } },
    { id: 'beam_rider', name: 'Riding the Beam', blurb: 'Seal a plate with one flight caught twice by pulsar beams.',
      test: function (c) { return sealedNow(c) && c.beams >= 2; } },
    { id: 'persistence', name: 'Persistence of Vision', blurb: 'Seal a plate on your third and final launch.',
      test: function (c) { return sealedNow(c) && c.data.launches === 3; } },
    { id: 'long_way_round', name: 'The Long Way Round', blurb: 'Win with a flight of 960 steps or more.',
      test: function (c) { return c.ev === 'flightEnd' && c.win && c.steps >= 960; } },
    { id: 'comet_hunter', name: 'Comet Hunter', blurb: 'Gather twenty-five comet fragments.',
      test: function (c) { return c.stat('frags') >= 25; } },
    { id: 'apprentice', name: 'The Astronomer’s Apprentice', blurb: 'Consult the Astronomer for the first time.',
      test: function (c) { return c.stat('hints') >= 1; } },
    { id: 'self_reliant', name: 'Self-Reliant', blurb: 'Seal twenty plates without consulting the Astronomer.',
      test: function (c) { return c.stat('platesNoHint') >= 20; } },
    { id: 'daily_3', name: 'Three Nights Running', blurb: 'Seal the Daily Plate three days in a row.',
      test: function (c) { return c.dailyBest >= 3; } },
    { id: 'daily_7', name: 'A Week at the Eyepiece', blurb: 'Seal the Daily Plate seven days in a row.',
      test: function (c) { return c.dailyBest >= 7; } },
    { id: 'daily_30', name: 'A Month of Nights', blurb: 'Seal the Daily Plate thirty days in a row.',
      test: function (c) { return c.dailyBest >= 30; } },
    { id: 'daily_perfect', name: 'Plate of the Day', blurb: 'Seal a Daily Plate with a single launch.',
      test: function (c) { return c.ev === 'daily' && c.data.launches === 1; } },
    { id: 'endless_5', name: 'Deep Survey', blurb: 'Reach round five of the Endless Survey.',
      test: function (c) { return c.endlessRound >= 5; } },
    { id: 'endless_10', name: 'Uncharted Waters', blurb: 'Reach round ten of the Endless Survey.',
      test: function (c) { return c.endlessRound >= 10; } }
  ];

  var ACHIEVEMENTS = LIST.map(function (a) { return { id: a.id, name: a.name, blurb: a.blurb }; });

  // ---- helpers -------------------------------------------------------------------------------------------------------
  var STAT_NAMES = ['launches', 'wins', 'losses', 'crashes', 'lost', 'distance', 'frags', 'hints', 'nearMiss', 'threads',
    'platesNoHint', 'dailyWins', 'endlessRounds', 'warps', 'fog', 'beams'];

  function num(x, dflt) { x = Number(x); return isFinite(x) ? x : dflt; }
  function stat(n) { try { return Save.stat(n) || 0; } catch (e) { return 0; } }
  function bump(n, v) { try { Save.bump(n, v); } catch (e) {} }

  // angle in degrees between the probe's velocity and the direction to the ring's centre (Infinity if unknown)
  function aimOffset(sim, level) {
    try {
      var t = level.target, hx = t.x - sim.x, hy = t.y - sim.y, vx = sim.vx, vy = sim.vy;
      var a = Math.sqrt(hx * hx + hy * hy), b = Math.sqrt(vx * vx + vy * vy);
      if (!(a > 0 && b > 0)) return Infinity;
      var c = (hx * vx + hy * vy) / (a * b);
      return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
    } catch (e) { return Infinity; }
  }

  // attempt tracking for fragment deltas
  var att = { level: null, frags: 0 };
  function attemptFor(level) {
    var id = level && level.id !== undefined ? level.id : null;
    if (att.level !== id) { att.level = id; att.frags = 0; }
  }
  function fragDelta(level, fragsNow) {
    attemptFor(level);
    fragsNow = Math.max(0, Math.floor(num(fragsNow, 0)));
    if (fragsNow < att.frags) att.frags = 0;
    var d = fragsNow - att.frags;
    att.frags = fragsNow;
    return d;
  }

  // stars as the achievements should see them (the plate being sealed counts even if Save.recordPlate has not run yet)
  function starsNow(pending) {
    var a = [], i, src = null;
    try { src = Save.data.stars; } catch (e) {}
    var n = 0; try { n = Save.N | 0; } catch (e) {}
    if (!(n > 0)) n = src && src.length ? src.length : 0;
    for (i = 0; i < n; i++) a.push(src && src[i] ? src[i] : 0);
    if (pending && pending.idx >= 0 && pending.idx < n) a[pending.idx] = Math.max(a[pending.idx], pending.stars > 0 ? pending.stars : 1);
    return a;
  }
  function totalsOf(stars) {
    var s = 0, sealed = 0, three = 0, f = 0;
    for (var i = 0; i < stars.length; i++) { s += stars[i]; if (stars[i] > 0) sealed++; if (stars[i] === 3) three++; }
    try { f = Save.totals().frags; } catch (e) {}
    return { stars: s, frags: f, sealed: sealed, threeStar: three };
  }

  // ---- evaluation ----------------------------------------------------------------------------------------------------
  function announce(a) {
    var shown = false;
    try {
      if (typeof LogUI !== 'undefined' && LogUI.toast) { LogUI.toast(a.name, a.blurb, { ach: true }); shown = true; }
    } catch (e) {}
    if (!shown) { try { if (typeof Sound !== 'undefined' && Sound.ach) Sound.ach(); } catch (e) {} }
  }

  // ctx: { ev, data, level, win, minGap, minDist, steps, ... } (event-specific fields default to non-triggering values)
  function evaluate(c) {
    var unlocked = [];
    var stars = c.stars || starsNow(null);
    var full = {
      ev: c.ev, data: c.data || {}, level: c.level || null, win: !!c.win,
      minGap: c.minGap === undefined ? Infinity : c.minGap, minDist: c.minDist === undefined ? Infinity : c.minDist,
      steps: c.steps || 0, warps: c.warps || 0, fog: c.fog || 0, beams: c.beams || 0, aimOff: c.aimOff === undefined ? Infinity : c.aimOff, fragsPlate: c.fragsPlate || 0, fragsAttempt: c.fragsAttempt || 0,
      endlessRound: c.endlessRound || 0,
      stars: stars, totals: c.totals || totalsOf(stars), stat: stat, dailyBest: 0
    };
    try { var dl = Save.data.daily; full.dailyBest = Math.max(dl.best || 0, dl.streak || 0, c.dailyStreak || 0, c.dailyBest || 0); } catch (e) {}
    if (c.dailyBest) full.dailyBest = Math.max(full.dailyBest, c.dailyBest);
    try { full.endlessRound = Math.max(full.endlessRound, Save.data.stats.endlessBestRound || 0); } catch (e) {}
    for (var i = 0; i < LIST.length; i++) {
      var a = LIST[i];
      try {
        if (Save.hasAch(a.id)) continue;
        if (a.test(full) && Save.unlockAch(a.id)) unlocked.push(a);
      } catch (e) {}
    }
    var MAXT = 5;
    for (var j = 0; j < unlocked.length; j++) {
      if (j < MAXT) announce(unlocked[j]);
      else if (j === MAXT) {
        try {
          if (typeof LogUI !== 'undefined' && LogUI.toast) LogUI.toast((unlocked.length - MAXT) + ' further honours', 'See the Observer’s Log.', { ach: true });
        } catch (e) {}
      }
    }
    return unlocked;
  }

  // ---- events --------------------------------------------------------------------------------------------------------
  function isWin(status) { return status === 'hit'; }

  // the latest flightEnd: its plate and (if it hit) how many times it warped, its steps in nebulae and its beam catches
  var last = { lv: null, w: 0, f: 0, b: 0 };
  function count(x) { return Math.max(0, Math.floor(num(x, 0))); }
  var handlers = {
    launch: function (d) {
      bump('launches');
      if (num(d.launchNo, 1) <= 1) { att.frags = 0; }
      return { ev: 'launch', data: d };
    },

    flightEnd: function (d) {
      var sim = d.sim || {}, status = d.status, win = isWin(status);
      bump(win ? 'wins' : 'losses');
      if (status === 'crash' || status === 'captured') bump('crashes');
      else if (status === 'lost' || status === 'timeout') bump('lost');
      var dist = num(sim.dist, 0); if (dist > 0) bump('distance', Math.round(dist));
      var gap = num(sim.minGap, Infinity);
      var wrecked = status === 'crash' || status === 'captured';
      if (gap <= 20 && !wrecked) bump('nearMiss');
      if (win && gap <= 12) bump('threads');
      var fd = fragDelta(d.level, d.fragsThisAttempt);
      if (fd > 0) bump('frags', fd);
      var wp = count(sim.warps), fg = count(sim.fog), bm = count(sim.beams);
      if (wp > 0) bump('warps', wp);
      if (fg > 0) bump('fog', fg);
      if (bm > 0) bump('beams', bm);
      last = { lv: d.level, w: win ? wp : 0, f: win ? fg : 0, b: win ? bm : 0 };
      return { ev: 'flightEnd', data: d, level: d.level, win: win, minGap: gap, minDist: num(sim.minDist, Infinity),
        steps: num(sim.step, 0), aimOff: win ? aimOffset(sim, d.level) : Infinity };
    },

    plateSealed: function (d) {
      var level = d.level || null;
      var fd = fragDelta(level, d.fragsThisAttempt);          // top-up only; normally already counted by flightEnd
      if (fd > 0) bump('frags', fd);
      var idx = num(d.plateIndex, -1);
      if (idx >= 0 && !d.hintUsed) bump('platesNoHint');
      var same = (last.lv || null) === level;
      var wp = same ? last.w : 0, fg = same ? last.f : 0, bm = same ? last.b : 0;
      last = { lv: null, w: 0, f: 0, b: 0 };
      if (wp > 0) bump('gateSeals');
      var stars = starsNow({ idx: idx, stars: num(d.stars, 1) });
      var plateFrags = level && level.frags ? level.frags.length : num(d.fragsTotal, 0);
      return { ev: 'plateSealed', data: d, level: level, stars: stars, totals: totalsOf(stars),
        fragsPlate: plateFrags, fragsAttempt: Math.max(0, num(d.fragsThisAttempt, 0)), warps: wp, fog: fg, beams: bm };
    },

    hint: function (d) {
      bump('hints');
      return { ev: 'hint', data: d, level: d.level };
    },

    daily: function (d) {
      if (d.first !== false) bump('dailyWins');
      return { ev: 'daily', data: d, dailyStreak: num(d.streak, 0), dailyBest: Math.max(num(d.best, 0), num(d.streak, 0)) };
    },

    endlessRound: function (d) {
      bump('endlessRounds');
      var r = Math.floor(num(d.round, 0));
      try { if (r > (Save.data.stats.endlessBestRound || 0)) Save.data.stats.endlessBestRound = Math.min(r, 1e6); } catch (e) {}
      return { ev: 'endlessRound', data: d, endlessRound: r };
    }
  };

  function event(name, data) {
    try {
      var h = handlers[name];
      if (!h) return;
      var d = data && typeof data === 'object' ? data : {};
      var c = null;
      try { c = h(d); } catch (e) { c = { ev: name, data: d }; }
      try { evaluate(c); } catch (e) {}
      try { Save.write(); } catch (e) {}
    } catch (e) { /* never throws */ }
  }

  // ---- snapshot ------------------------------------------------------------------------------------------------------
  function snapshot() {
    var out = { totals: { stars: 0, frags: 0, sealed: 0, threeStar: 0 }, daily: { streak: 0, best: 0, last: '', done: {} },
      achievements: [], stats: {} };
    try { out.totals = Save.totals(); } catch (e) {}
    try {
      var dl = Save.data.daily, done = {}, k;
      for (k in dl.done) done[k] = dl.done[k];
      out.daily = { streak: Save.dailyStreak(), best: Math.max(dl.best || 0, Save.dailyStreak()), last: dl.last || '', done: done };
    } catch (e) {}
    var i, id;
    for (i = 0; i < LIST.length; i++) {
      id = LIST[i].id;
      var date = null;
      try { date = Save.data.ach[id] || null; } catch (e) {}
      out.achievements.push({ id: id, name: LIST[i].name, blurb: LIST[i].blurb, unlocked: !!date, date: date });
    }
    for (i = 0; i < STAT_NAMES.length; i++) out.stats[STAT_NAMES[i]] = stat(STAT_NAMES[i]);
    try { for (var s in Save.data.stats) if (out.stats[s] === undefined) out.stats[s] = Save.data.stats[s]; } catch (e) {}
    out.stats.hitRate = out.stats.launches > 0 ? Math.min(1, out.stats.wins / out.stats.launches) : 0;
    return out;
  }

  return { ACHIEVEMENTS: ACHIEVEMENTS, event: event, snapshot: snapshot };
})();
