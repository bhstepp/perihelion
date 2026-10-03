/* PERIHELION — main loop, input, flow & menus (owner: INPUT & FEEL AGENT).
   Fixed-step accumulator at K.DT; state.step advances by exactly one per physics step while the play screen is
   live, in lockstep with Physics.stepSim, so moving bodies drawn at state.step are where physics has them. */
(function () {
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  var cv = $('game'), ui = $('ui');
  var elTitle = $('scr-title'), elSelect = $('scr-select'), elPlay = $('play-ui'), elSheet = $('sheet');
  var elCard = $('card'), elPop = $('pcard'), elHint = $('hint'), elNote = $('note'), elGrid = $('grid'), elTally = $('tally');
  var elZoneL = $('zone-l'), elZoneR = $('zone-r'), elProbe = $('safe-probe');

  var CAMP = Levels.CAMPAIGN || [];
  var VOLS = (Levels.VOLUMES && Levels.VOLUMES.length) ? Levels.VOLUMES : (function () {   // fallback: thirty plates a volume, sized from the campaign
    var v = [], n = Math.max(1, Math.ceil(CAMP.length / 30)), names = ['Volume I', 'Volume II', 'Volume III', 'Volume IV', 'Volume V'];
    for (var i = 0; i < n; i++) v.push({ name: names[i] || 'Volume ' + toRoman(i + 1), from: i * 30, to: i * 30 + 29 });
    return v;
  })();
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var STEP_HZ = Math.round(1 / K.DT);
  var FAIL_TEXT = {
    crash: 'Struck a body.', captured: 'Taken by the dark star.', lost: 'Lost beyond the plate.', timeout: 'Drifted past the hour.'
  };

  Sound.setMuted(Save.data.muted, true);

  // ------------------------------------------------------------------ state (contract §6)
  var state = {
    screen: 'title',
    paused: false,
    mode: 'campaign',                 // 'campaign' | 'endless' | 'daily'
    custom: false,                    // a test plate from __peri.loadCustom: campaign-like play, levelIndex -1, nothing saved or logged
    daily: null,                      // { key, label } while mode === 'daily'
    level: CAMP[0] || null, levelIndex: 0,
    step: 0,
    frozen: false,                    // the astronomer holds the heavens: step does not advance while aiming
    hint: { on: false, used: false, pts: new Float32Array(K.HINT_MAX * 2), n: 0, t0: 0 },
    spotlight: null,                  // [{x, y, r?}] world points ringed while a fragment / wormhole / nebula / pulsar card is open
    card: null,                       // null | 'intro' | 'fragments' | 'wormholes' | 'nebulae' | 'pulsars': a popup card is open (aim blocked, clock held)
    phase: 'aim',
    aim: { active: false, dx: 0, dy: 0, power: 0, vx: 0, vy: 0, cancel: true },
    predict: { pts: new Float32Array(K.PREDICT_STEPS * 2), n: 0 },
    sim: null,
    trail: { pts: new Float32Array(K.TRAIL_MAX * 2), head: 0, n: 0 },
    ghosts: [],
    launches: 0,
    collected: new Uint8Array(0),
    result: null,
    hud: { speed: 0, closest: Infinity },
    endless: { round: 0, score: 0, best: Save.data.endlessBest }
  };
  // full path of the current flight (pooled). result.pts points at it until the next launch.
  var path = { pts: new Float32Array((K.MAX_STEPS + 1) * 2), n: 0 };
  var runSeed = 0;
  var hintBuf = new Float32Array((K.MAX_STEPS + 2) * 2);   // scratch for the astronomer's course (allocated once)
  var nudgeShown = false, nudgeDone = false, nudgeIdle = 0;
  var tick = 0;             // physics ticks: advances every physStep, even while the heavens are frozen
  var timers = [];          // tick-based timers: {at: tick, fn} — pause with the game, advance under fastForward
  var popQueue = [], popFromSheet = false;
  var safe = { top: 0, right: 0, bottom: 0, left: 0 };
  var L = null;             // last Render.layout
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function hasKind(lv, kind) { if (lv && lv.bodies) for (var i = 0; i < lv.bodies.length; i++) if (lv.bodies[i] && lv.bodies[i].kind === kind) return true; return false; }
  function hasWormhole(lv) { return hasKind(lv, 'wormhole'); }
  // popup cards that point at bodies of one kind (shown once, the first time a plate holds one), in queue order
  var BODY_CARDS = { wormholes: 'wormhole', nebulae: 'nebula', pulsars: 'pulsar' };
  var POP_NAMES = ['intro', 'fragments', 'wormholes', 'nebulae', 'pulsars'];
  // every wormhole mouth names a twin that is a different mouth naming it back (Physics.stepSim would throw otherwise)
  function wormholesMutual(lv) {
    var bs = lv.bodies;
    if (!Array.isArray(bs)) return false;
    for (var i = 0; i < bs.length; i++) {
      if (!bs[i] || bs[i].kind !== 'wormhole') continue;
      var j = bs[i].pair;
      if (typeof j !== 'number' || j !== (j | 0) || j < 0 || j >= bs.length || j === i || !bs[j] || bs[j].kind !== 'wormhole' || bs[j].pair !== i) return false;
    }
    return true;
  }
  // anything that changes with time: bodies on rails, and pulsar beams (they turn even though the star stands still)
  function hasMoving(lv) { for (var i = 0; i < lv.bodies.length; i++) if (lv.bodies[i].orbit || lv.bodies[i].beam) return true; return false; }

  // ------------------------------------------------------------------ timers (in physics steps)
  function logEvent(name, data) { if (state.custom) return; try { if (typeof Log !== 'undefined' && Log && typeof Log.event === 'function') Log.event(name, data); } catch (e) {} }
  function after(steps, fn) { timers.push({ at: tick + Math.max(1, Math.round(steps)), fn: fn }); }
  function afterMs(ms, fn) { after(ms / 1000 * STEP_HZ, fn); }
  function runTimers() {
    for (var i = 0; i < timers.length; i++) {
      if (tick >= timers[i].at) { var t = timers[i]; timers.splice(i, 1); i--; t.fn(); }
    }
  }

  // ------------------------------------------------------------------ attempt / flight
  function clearAim() {
    var a = state.aim;
    a.active = false; a.dx = 0; a.dy = 0; a.power = 0; a.vx = 0; a.vy = 0; a.cancel = true;
    state.predict.n = 0;
    ptr.id = null;
  }
  function clearTrail() { state.trail.head = 0; state.trail.n = 0; }
  function pushTrail(x, y) {
    var t = state.trail, h = t.head;
    t.pts[2 * h] = x; t.pts[2 * h + 1] = y;
    t.head = (h + 1) % K.TRAIL_MAX;
    if (t.n < K.TRAIL_MAX) t.n++;
  }
  function pushPath(x, y) {
    if (path.n > K.MAX_STEPS) return;
    path.pts[2 * path.n] = x; path.pts[2 * path.n + 1] = y; path.n++;
  }

  function hintClear() { var h = state.hint; h.on = false; h.used = false; h.n = 0; state.frozen = false; }
  function resetAttempt() {
    timers.length = 0;
    state.step = 0;
    hintClear();
    dropPopup();
    state.phase = 'aim';
    clearAim();
    state.sim = null;
    clearTrail();
    path.n = 0;
    state.ghosts.length = 0;
    state.launches = 0;
    state.collected = new Uint8Array(state.level && state.level.frags ? state.level.frags.length : 0);
    state.result = null;
    state.hud.speed = 0; state.hud.closest = Infinity;
    try { Render.fx.reset(); } catch (e) {}
    Sound.droneStop();
    hideCard();
    showNote('');
    nudgeIdle = 0; setNudge(false);
    flushPopups();
  }

  function resetProbe() {
    if (state.phase === 'result') return;
    state.phase = 'aim';
    state.sim = null;
    clearTrail();
    clearAim();
    state.hud.speed = 0; state.hud.closest = Infinity;
    flushPopups();
  }

  function doLaunch(vx, vy, power) {
    var lv = state.level;
    if (!lv || state.phase !== 'aim' || state.launches >= K.MAX_LAUNCHES) return false;
    state.launches++;
    var sim = Physics.createSim(lv, vx, vy, state.step);
    if (sim.collected && sim.collected.length === state.collected.length) sim.collected.set(state.collected);
    state.sim = sim;
    state.phase = 'flight';
    state.frozen = false; state.hint.on = false;      // the astronomer releases the heavens; hint.used stays true
    clearAim();
    clearTrail();
    path.n = 0;
    pushTrail(sim.x, sim.y); pushPath(sim.x, sim.y);
    state.hud.speed = Physics.speed(sim); state.hud.closest = Infinity;
    if (power == null) power = Math.min(1, Math.sqrt(vx * vx + vy * vy) / K.VMAX);
    Sound.launch(power);
    Sound.droneStart();
    vibrate(12);
    nudgeDone = true; setNudge(false);
    showNote('');
    logEvent('launch', { mode: state.mode, launchNo: state.launches, power: power, hintUsed: state.hint.used });
    return true;
  }

  function onFrag(i) {
    if (i < 0 || i >= state.collected.length || state.collected[i]) return;
    state.collected[i] = 1;
    var c = 0; for (var k = 0; k < state.collected.length; k++) c += state.collected[k];
    Sound.pluck(c - 1);
    vibrate(10);
  }

  // A wormhole passage: flash at both mouths, a soft sweep, a short buzz. Every call is guarded (RENDER / AUDIO own those functions).
  var _wa = { x: 0, y: 0 }, _wb = { x: 0, y: 0 };
  function onWarp(ev, s) {
    var bs = state.level && state.level.bodies, a = bs && bs[ev.from], b = bs && bs[ev.to];
    try {
      if (a && b && typeof Render !== 'undefined' && typeof Render.warp === 'function') {
        var t = s.abs * K.DT;
        Physics.bodyPos(a, t, _wa); Physics.bodyPos(b, t, _wb);
        Render.warp(_wa.x, _wa.y, _wb.x, _wb.y);
      }
    } catch (e) {}
    try { if (typeof Sound !== 'undefined' && typeof Sound.warp === 'function') Sound.warp(); } catch (e) {}
    vibrate(14);
  }
  // Entering a nebula: a puff of dust where the probe went in and a soft hush. A pulsar beam catch: a flash and a click, a short buzz.
  // Both mark the probe's position (the event is pushed by the step that ends there). Every call is guarded.
  function onFog(ev, s) {
    try { if (typeof Render !== 'undefined' && typeof Render.fog === 'function') Render.fog(s.x, s.y); } catch (e) {}
    try { if (typeof Sound !== 'undefined' && typeof Sound.fog === 'function') Sound.fog(); } catch (e) {}
  }
  function onBeam(ev, s) {
    try { if (typeof Render !== 'undefined' && typeof Render.beam === 'function') Render.beam(s.x, s.y); } catch (e) {}
    try { if (typeof Sound !== 'undefined' && typeof Sound.beam === 'function') Sound.beam(); } catch (e) {}
    vibrate([6, 40, 6]);                                     // a double pulse, like the star
  }

  function countFrags() { var c = 0; for (var k = 0; k < state.collected.length; k++) c += state.collected[k]; return c; }

  function endFlight(status) {
    var sim = state.sim, mode = state.mode, lv = state.level, hu = state.hint.used;
    Sound.droneStop();
    logEvent('flightEnd', { mode: mode, level: lv, launchNo: state.launches, status: status, sim: sim, hintUsed: hu, fragsThisAttempt: countFrags() });
    if (status === 'hit') {
      var stars = Math.max(1, 4 - state.launches - (hu ? 1 : 0));
      state.phase = 'result';
      state.result = { success: true, stars: stars, status: status, pts: path.pts, n: path.n, at: nowMs(), hintUsed: hu };
      state.hud.closest = 0;
      try { Render.fx.success(path.pts, path.n); } catch (e) {}
      Sound.chime();
      vibrate([12, 60, 24]);
      var rec = null, plateIndex = -1;
      if (state.custom) {
        rec = { improved: false, first: true };                      // a test plate: never written to Save
      } else if (mode === 'campaign') {
        plateIndex = state.levelIndex;
        rec = Save.recordPlate(plateIndex, stars, countFrags());
      } else if (mode === 'daily') {
        rec = Save.recordDaily(state.daily.key, stars, state.launches);
      } else {
        state.endless.score += stars;
        if (Save.recordEndless(state.endless.score)) state.endless.best = state.endless.score;
      }
      state.result.record = rec;
      logEvent('plateSealed', { mode: mode, level: lv, plateIndex: plateIndex, stars: stars, launches: state.launches, hintUsed: hu,
        fragsThisAttempt: countFrags(), fragsTotal: lv.frags ? lv.frags.length : 0, endlessRound: mode === 'endless' ? state.endless.round : 0 });
      if (mode === 'daily') logEvent('daily', { key: state.daily.key, stars: stars, launches: state.launches, streak: rec.streak, best: rec.best, first: rec.first });
      if (mode === 'endless') logEvent('endlessRound', { round: state.endless.round, score: state.endless.score });
      afterMs(1200, showSuccessCard);
      return;
    }
    // failure: crash/captured get the hatched burst; lost/timeout a softer cue
    if (status === 'crash' || status === 'captured') {
      try { Render.fx.crash(sim.x, sim.y); } catch (e) {}
      Sound.thump(1);
      vibrate(30);
    } else {
      Sound.thump(0.35);
      vibrate(8);
    }
    // ghost of this launch: every 3rd point, keep the 2 most recent
    var gn = Math.ceil(path.n / 3), g = new Float32Array(gn * 2), j = 0;
    for (var i = 0; i < path.n; i += 3) { g[2 * j] = path.pts[2 * i]; g[2 * j + 1] = path.pts[2 * i + 1]; j++; }
    state.ghosts.push({ pts: g, n: j });
    while (state.ghosts.length > 2) state.ghosts.shift();

    if (state.launches >= K.MAX_LAUNCHES) {
      state.phase = 'result';
      state.result = { success: false, stars: 0, status: status, pts: path.pts, n: path.n, at: nowMs() };
      afterMs(900, showFailCard);
    } else {
      var left = K.MAX_LAUNCHES - state.launches;
      showNote(FAIL_TEXT[status] + ' ' + (left === 1 ? 'One launch remains.' : 'Two launches remain.'));
      afterMs(600, resetProbe);
      afterMs(2600, function () { if (state.phase === 'aim') showNote(''); });
    }
  }

  // one fixed physics step
  function physStep() {
    tick++;
    if (!state.frozen) state.step++;
    var s = state.sim;
    if (state.phase === 'flight' && s && s.status === 'flying') {
      var st = Physics.stepSim(s, state.level);
      pushTrail(s.x, s.y); pushPath(s.x, s.y);
      if (s.events.length) {
        for (var i = 0; i < s.events.length; i++) {
          var ev = s.events[i];
          if (ev.type === 'frag') onFrag(ev.i);
          else if (ev.type === 'warp') onWarp(ev, s);
          else if (ev.type === 'fog') onFog(ev, s);
          else if (ev.type === 'beam') onBeam(ev, s);
        }
        s.events.length = 0;
      }
      state.hud.speed = Physics.speed(s);
      state.hud.closest = s.minDist;
      if (st !== 'flying') endFlight(st);
    }
    if (timers.length) runTimers();
  }

  function updatePrediction() {
    var a = state.aim;
    if (state.phase !== 'aim' || !a.active || a.cancel) { state.predict.n = 0; if (state.phase === 'aim') { state.hud.speed = 0; state.hud.closest = Infinity; } return; }
    var sim = Physics.predict(state.level, a.vx, a.vy, state.step, state.predict.pts);
    state.predict.n = sim.n;
    state.hud.speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
    state.hud.closest = sim.minDist;
  }

  // ------------------------------------------------------------------ loading levels
  function loadCampaign(i) {
    i = Math.max(0, Math.min(CAMP.length - 1, i | 0));
    state.mode = 'campaign';
    state.custom = false;
    state.daily = null;
    state.levelIndex = i;
    state.level = CAMP[i];
    Render.setLevel(state.level);
    resetAttempt();
    setScreen('play');
    autoCards();
    return state.level;
  }

  // Test hook: any Level object as a plate in campaign-like play. levelIndex is -1; no stars, stats, honours or log events are written.
  function loadCustom(lv) {
    if (!lv || !lv.bodies || !lv.probe || !lv.target || !wormholesMutual(lv)) return false;
    if (!lv.frags) lv.frags = [];
    state.mode = 'campaign';
    state.custom = true;
    state.daily = null;
    state.levelIndex = -1;
    state.level = lv;
    Render.setLevel(lv);
    resetAttempt();
    setScreen('play');
    autoCards();
    return lv;
  }

  // ---- Daily Plate
  function hashKey(k) { var h = 2166136261 >>> 0; for (var i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0; return h >>> 0; }
  function dayLabel(k) { var p = k.split('-'); return (+p[2]) + ' ' + MONTHS[(+p[1] - 1) | 0] + ' ' + p[0]; }
  // Levels.daily is the LEVEL agent's; until it lands a weekday-graded Levels.generate stands in.
  function idle(fn, timeout) {
    try { if (window.requestIdleCallback) { window.requestIdleCallback(fn, { timeout: timeout || 3000 }); return; } } catch (e) {}
    setTimeout(fn, 250);
  }
  // today's plate is engraved in idle time while the title shows (Levels.daily can cost ~100+ ms on a phone); one entry,
  // keyed by date, recomputed when the date rolls over. The level object is deterministic, so reusing it is safe.
  var dailyCache = null;
  function makeDaily(k) {
    if (dailyCache && dailyCache.key === k) return dailyCache.lv;
    var lv = buildDaily(k);
    dailyCache = { key: k, lv: lv };
    return lv;
  }
  function prepDaily() {
    if (dailyCache && dailyCache.key === Save.dateKey()) return;
    idle(function () {
      var k = Save.dateKey();
      if (dailyCache && dailyCache.key === k) return;
      try { makeDaily(k); } catch (e) {}
    });
  }
  function buildDaily(k) {
    if (typeof Levels.daily === 'function') return Levels.daily(k);
    var p = k.split('-'), wd = new Date(+p[0], +p[1] - 1, +p[2], 12).getDay();
    var lv = Levels.generate(hashKey('perihelion-' + k), [0.85, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78][wd]);
    lv.id = 'd' + k; lv.plate = 'DAILY'; lv.caption = 'DAILY \u00b7 ' + dayLabel(k); lv.name = lv.name || 'Daily Plate';
    return lv;
  }
  function loadDaily(k) {
    k = (typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k)) ? k : Save.dateKey();
    var lv = makeDaily(k), m = /^DAILY\s*[·:|\-–—]\s*(.+)$/.exec(lv.caption || '');
    state.mode = 'daily';
    state.custom = false;
    state.daily = { key: k, label: m ? m[1] : dayLabel(k) };
    state.levelIndex = -1;
    state.level = lv;
    Render.setLevel(lv);
    resetAttempt();
    setScreen('play');
    autoCards();
    return lv;
  }
  function roundSeed(r) { return (runSeed + Math.imul(r, 0x9E3779B1)) >>> 0; }
  // Next Endless round is generated while the success card shows (same seed & difficulty => same level).
  var preGen = null;
  function genRound(r) {
    var seed = roundSeed(r), d = Math.min(1, r / 25);
    if (preGen && preGen.seed === seed && preGen.d === d && preGen.run === runSeed) { var l = preGen.lv; preGen = null; return l; }
    return Levels.generate(seed, d);
  }
  function preGenerate(r) {
    var seed = roundSeed(r), d = Math.min(1, r / 25), run = runSeed;
    if (preGen && preGen.seed === seed && preGen.run === run) return;
    // start only once the success card has settled (seal + card animation done), and in idle time; a quick tap on
    // "Next plate" before this runs just generates synchronously in genRound
    setTimeout(function () {
      idle(function () {
        if (state.mode !== 'endless' || runSeed !== run || state.endless.round !== r - 1 || (preGen && preGen.seed === seed && preGen.run === run)) return;
        try { preGen = { seed: seed, d: d, run: run, lv: Levels.generate(seed, d) }; } catch (e) { preGen = null; }
      }, 2000);
    }, reduceMotion ? 0 : 500);
  }
  function endlessRound() {
    var r = state.endless.round;
    var lv = genRound(r);
    lv.plate = toRoman(r);
    lv.caption = 'ENDLESS · PLATE ' + lv.plate;
    state.mode = 'endless';
    state.custom = false;
    state.daily = null;
    state.levelIndex = r - 1;
    state.level = lv;
    Render.setLevel(lv);
    resetAttempt();
    setScreen('play');
    autoCards();
    return lv;
  }
  function startEndless(seed) {
    runSeed = (seed == null || !isFinite(seed)) ? ((Math.random() * 4294967296) >>> 0) : (seed >>> 0);
    state.endless.round = 1; state.endless.score = 0; state.endless.best = Save.data.endlessBest;
    return endlessRound();
  }
  function nextEndless() { state.endless.round++; return endlessRound(); }

  // ------------------------------------------------------------------ screens
  function setScreen(name) {
    if (name === 'play' && !state.level) name = 'title';
    var prev = state.screen;
    state.screen = name;
    elTitle.classList.toggle('on', name === 'title');
    elSelect.classList.toggle('on', name === 'select');
    elPlay.classList.toggle('on', name === 'play');
    elTitle.setAttribute('aria-hidden', name !== 'title');
    elSelect.setAttribute('aria-hidden', name !== 'select');
    if (name !== 'play') {
      Sound.droneStop();
      clearAim();
      hideCard();
      dropPopup();
      popQueue.length = 0;
      showNote('');
      setNudge(false);
      timers.length = 0;
      hintClear();
      if (state.phase === 'flight') state.phase = 'aim';
    }
    hideSheet();
    state.paused = false;
    if (name === 'title') { refreshTitle(); prepDaily(); }
    if (name === 'select') refreshSelect(prev !== 'select');
    if (name === 'play') placeDom();
    acc = 0;
    snapshot();
  }

  function soundLabel() { return 'Sound: ' + (Sound.isMuted() ? 'Off' : 'On'); }
  function refreshSoundButtons() {
    var bs = ui.querySelectorAll('[data-sound]');
    for (var i = 0; i < bs.length; i++) { bs[i].textContent = soundLabel(); bs[i].setAttribute('aria-pressed', String(!Sound.isMuted())); }
  }
  function refreshTitle() {
    var b = Save.data.endlessBest;
    $('t-best').innerHTML = b > 0 ? 'Best survey &middot; <b>' + b + '</b> stars' : '';
    var ed = $('t-ed');
    if (ed && CAMP.length) ed.innerHTML = 'Plates I&ndash;' + toRoman(CAMP.length) + ' &middot; Engraved MMXXVI';
    var dl = $('t-daily');
    if (dl) {
      var st = Save.dailyDone(Save.dateKey());
      if (st > 0) {
        dl.innerHTML = 'Sealed <span class="vh">' + st + (st === 1 ? ' star' : ' stars') + '</span>' + starsRow(st, 11) +
          '<span class="sep">&middot;</span>streak ' + Math.max(1, Save.dailyStreak());
      } else dl.innerHTML = 'Today&rsquo;s plate';
    }
    refreshSoundButtons();
  }

  // ---- inline svg glyphs
  var STAR_D = (function () {
    var s = 'M', i, a, r;
    for (i = 0; i < 10; i++) {
      a = -Math.PI / 2 + i * Math.PI / 5; r = i % 2 ? 3.9 : 9;
      s += (i ? ' L' : '') + (r * Math.cos(a)).toFixed(2) + ',' + (r * Math.sin(a)).toFixed(2);
    }
    return s + 'Z';
  })();
  function starSvg(on, size) {
    return '<svg class="star' + (on ? ' on' : '') + '" viewBox="-10.5 -10.5 21 21" width="' + size + '" height="' + size +
      '" aria-hidden="true"><path d="' + STAR_D + '"/></svg>';
  }
  function starsRow(n, size) { return starSvg(n >= 1, size) + starSvg(n >= 2, size) + starSvg(n >= 3, size); }
  function cometSvg(on) {
    return '<svg class="comet' + (on ? '' : ' off') + '" viewBox="0 0 14 10" width="14" height="10" aria-hidden="true">' +
      '<circle cx="10.5" cy="3.5" r="1.8"/><path d="M9 4.6 L1.5 9 M9.6 5.3 L4.5 9.6 M8.4 3.9 L1 6.6"/></svg>';
  }

  // ---- level select: two volumes, thumbnails drawn lazily (only rows near the viewport)
  var cards = [], thumbW = 0, thumbsDrawn = false, thumbRaf = 0;
  function volHead(v, from, to) {
    return '<h3 class="vol-head">' + escapeHtml(v.name || 'Volume') + '<span class="vs"> &middot; </span><i>Plates ' + toRoman(from + 1) + '&ndash;' + toRoman(to + 1) + '</i></h3><div class="vol-rule"></div>';
  }
  function plateHtml(i) {
    var lv = CAMP[i];
    return '<button class="plate" data-i="' + i + '" aria-label="Plate ' + toRoman(i + 1) + '">' +
      '<span class="thumb-wrap"><canvas class="thumb"></canvas><span class="sealed" hidden><span>Locked</span></span></span>' +
      '<span class="pl-num">' + toRoman(i + 1) + '</span>' +
      '<span class="pl-name">' + escapeHtml(lv.name || '') + '</span>' +
      '<span class="pl-meta"></span></button>';
  }
  function buildGrid() {
    var html = '', used = [], v, i, from, to;
    for (var vi = 0; vi < VOLS.length; vi++) {
      v = VOLS[vi];
      from = Math.max(0, v.from | 0); to = Math.min(CAMP.length - 1, v.to | 0);
      var list = [];
      for (i = from; i <= to; i++) if (!used[i]) { used[i] = 1; list.push(i); }
      if (!list.length) continue;
      html += volHead(v, list[0], list[list.length - 1]) + '<div class="grid">';
      for (i = 0; i < list.length; i++) html += plateHtml(list[i]);
      html += '</div>';
    }
    var rest = [];
    for (i = 0; i < CAMP.length; i++) if (!used[i]) rest.push(i);
    // plates no volume names (a campaign longer than Levels.VOLUMES): thirty to a volume, numbered by position
    for (i = 0; i < rest.length;) {
      var g = Math.floor(rest[i] / 30), grp = [];
      while (i < rest.length && Math.floor(rest[i] / 30) === g) grp.push(rest[i++]);
      html += volHead({ name: 'Volume ' + toRoman(g + 1) }, grp[0], grp[grp.length - 1]) + '<div class="grid">';
      for (var gi = 0; gi < grp.length; gi++) html += plateHtml(grp[gi]);
      html += '</div>';
    }
    elGrid.innerHTML = html;
    cards = [];
    var bs = elGrid.querySelectorAll('.plate');
    for (var j = 0; j < bs.length; j++) {
      var idx = +bs[j].getAttribute('data-i');
      cards[idx] = { el: bs[j], cv: bs[j].querySelector('canvas'), sealed: bs[j].querySelector('.sealed'), meta: bs[j].querySelector('.pl-meta'), done: false };
    }
    thumbsDrawn = false; thumbW = 0;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function drawCard(i, w, h, dpr) {
    var c = cards[i].cv;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = PAL.ink; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { Render.drawThumbnail(g, CAMP[i], w, h); } catch (e) { if (!drawCard.err) { drawCard.err = 1; console.warn('drawThumbnail failed', e); } }
    cards[i].done = true;
  }
  // Draw the thumbnails of plates within ~600 px of the scroll viewport that are not drawn yet (at the current width).
  function drawThumbs(force) {
    if (!cards.length) return;
    var sc = $('s-scroll'), first = cards[0] || cards.filter(Boolean)[0];
    if (!sc || !first) return;
    var w = Math.round(first.cv.parentNode.getBoundingClientRect().width) - 2, h = Math.round(w * 16 / 9);
    if (w <= 0) return;
    var i;
    if (force || w !== thumbW) { thumbW = w; for (i = 0; i < cards.length; i++) if (cards[i]) cards[i].done = false; }
    thumbsDrawn = true;
    var sr = sc.getBoundingClientRect(), lo = sr.top - 600, hi = sr.bottom + 600, todo = [];
    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c || c.done) continue;
      var r = c.el.getBoundingClientRect();
      if (r.bottom >= lo && r.top <= hi) todo.push(i);
    }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    for (i = 0; i < todo.length; i++) drawCard(todo[i], w, h, dpr);
  }
  function scheduleThumbs() {
    if (thumbRaf) return;
    thumbRaf = requestAnimationFrame(function () { thumbRaf = 0; if (state.screen === 'select') drawThumbs(false); });
  }
  (function () { var sc = $('s-scroll'); if (sc) sc.addEventListener('scroll', scheduleThumbs, { passive: true }); })();
  function refreshSelect(entering) {
    if (!cards.length) buildGrid();
    var d = Save.data, tot = Save.totals();
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c) continue;
      var lv = CAMP[i], nf = lv.frags ? lv.frags.length : 0, locked = i >= d.unlocked;
      c.el.classList.toggle('locked', locked);
      c.el.classList.toggle('done', d.stars[i] > 0);
      c.el.setAttribute('aria-disabled', String(locked));
      c.sealed.hidden = !locked;
      var meta = starsRow(d.stars[i], 12);
      if (nf) meta += cometSvg(d.frags[i] >= nf) + '<span class="fr">' + Math.min(d.frags[i], nf) + '/' + nf + '</span>';
      c.meta.innerHTML = meta;
    }
    elTally.innerHTML = 'Stars <b>' + tot.stars + '</b>/<b>' + (cards.length * 3) + '</b><span class="sep">&middot;</span>' +
      'Sealed <b>' + tot.sealed + '</b>/<b>' + cards.length + '</b>';
    if (entering) {
      var sc = $('s-scroll'), idx = state.mode === 'campaign' && state.levelIndex >= 0 ? state.levelIndex : Math.max(0, d.unlocked - 1);
      idx = Math.max(0, Math.min(cards.length - 1, idx));
      if (sc && cards[idx]) {
        requestAnimationFrame(function () {
          try {
            sc.scrollTop = idx > 5 ? Math.max(0, cards[idx].el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 90) : 0;
          } catch (e) {}
          drawThumbs(false);
        });
        return;
      }
    }
    // draw after the page is laid out
    requestAnimationFrame(function () { drawThumbs(false); });
  }

  // ---- first-run nudge: the marginal note on plate I appears only if the player idles (the intro card says it first)
  function setNudge(on) { if (on !== nudgeShown) { nudgeShown = on; elHint.classList.toggle('on', on); } }
  function nudgeEligible() {
    return state.screen === 'play' && state.mode === 'campaign' && state.levelIndex === 0 && !nudgeDone && state.launches === 0 &&
      !(Save.data.stars[0] > 0) && state.phase === 'aim' && !state.card && !state.paused && !state.aim.active && !cardVisible();
  }
  var noteTimer = 0;
  function showNote(text) {
    if (text) { elNote.textContent = text; elNote.classList.add('on'); }
    else elNote.classList.remove('on');
  }

  // ---- popup cards (To Observe / Comet Fragments / Wormholes / Nebulae / Pulsars): atlas plates that hold the clock while open
  function levelFrags() { return (state.level && state.level.frags && state.level.frags.length) || 0; }
  function popupSafe() { return state.screen === 'play' && state.phase !== 'flight' && !cardVisible(); }
  function autoNext() {
    if (!Save.seen('intro')) return 'intro';
    if (levelFrags() && !Save.seen('fragments')) return 'fragments';
    for (var k in BODY_CARDS) if (hasKind(state.level, BODY_CARDS[k]) && !Save.seen(k)) return k;
    return null;
  }
  function autoCards() { var n = autoNext(); if (n) requestPopup(n); }
  function flushPopups() {
    if (state.card || !popupSafe()) return;
    var n = popQueue.shift();
    if (n) showPopup(n, false);
  }
  function requestPopup(name) {
    if (POP_NAMES.indexOf(name) < 0) return null;
    if (state.card || !popupSafe()) {
      if (state.card !== name && popQueue.indexOf(name) < 0) popQueue.push(name);
      return 'queued';
    }
    showPopup(name, false);
    return 'open';
  }
  function popHtml(name) {
    if (name === 'intro') {
      return '<p class="kicker">Instructions</p><h3 class="c-title">To Observe</h3><div class="rule"></div>' +
        '<ol class="steps">' +
        '<li>Touch anywhere and pull back, as if drawing a sling.</li>' +
        '<li>Release to launch. The probe flies opposite your pull; a longer pull is faster.</li>' +
        '<li>Gravity bends every course, and only the first moments of yours are drawn. Judge the rest.</li>' +
        '<li>Reach the brass ring. Fewer launches earn more stars: one launch, three stars.</li></ol>' +
        '<div class="c-btns"><button class="btn primary" data-act="pop-ok">Begin</button></div>';
    }
    if (name === 'wormholes') {
      return '<p class="kicker">Notice</p><h3 class="c-title">Wormholes</h3><div class="rule"></div>' +
        '<p class="pop-text">Wormholes come in pairs, marked with the same Greek letter. Fly into one and you leave by its twin at the same speed. A mark such as <span class="m">\u21bb 90\u00b0</span> means your heading turns that far as you pass through. They pull on nothing and do no harm.</p>' +
        '<div class="c-btns"><button class="btn primary" data-act="pop-ok">Understood</button></div>';
    }
    if (name === 'nebulae') {
      return '<p class="kicker">Notice</p><h3 class="c-title">Nebulae</h3><div class="rule"></div>' +
        '<p class="pop-text">Nebulae are clouds of dust and gas. They pull on nothing and do no harm, but while you are inside one you lose speed, and a slower probe bends more sharply round everything else.</p>' +
        '<div class="c-btns"><button class="btn primary" data-act="pop-ok">Understood</button></div>';
    }
    if (name === 'pulsars') {
      return '<p class="kicker">Notice</p><h3 class="c-title">Pulsars</h3><div class="rule"></div>' +
        '<p class="pop-text">A pulsar is a spinning neutron star. It pulls like a small planet and is just as solid. Two beams sweep round it, and a beam that catches the probe pushes it straight away from the star, so when you launch matters as much as where.</p>' +
        '<div class="c-btns"><button class="btn primary" data-act="pop-ok">Understood</button></div>';
    }
    return '<p class="kicker">Notice</p><h3 class="c-title">Comet Fragments</h3><div class="rule"></div>' +
      '<p class="pop-text">Small brass comets drift on this plate. Fly through one to collect it. They are optional, but a course that gathers them is a harder one. Fragments you collect stay collected across your launches on this plate.</p>' +
      '<div class="c-btns"><button class="btn primary" data-act="pop-ok">Understood</button></div>';
  }
  // world points a card rings while it is open; bodies carry their ring radius (mouth.r + 14, nebula.r + 10, 60 round a pulsar) and follow their rails
  var _mp = { x: 0, y: 0 };
  function spotlightFor(name) {
    var lv = state.level, out = [], i;
    if (name === 'fragments') {
      var f = lv && lv.frags;
      if (f && f.length) for (i = 0; i < f.length; i++) out.push({ x: f[i].x, y: f[i].y });
    } else if (BODY_CARDS[name] && lv) {
      var kind = BODY_CARDS[name];
      for (i = 0; i < lv.bodies.length; i++) {
        var b = lv.bodies[i];
        if (!b || b.kind !== kind) continue;
        Physics.bodyPos(b, state.step * K.DT, _mp);
        out.push({ x: _mp.x, y: _mp.y, r: kind === 'wormhole' ? b.r + 14 : kind === 'nebula' ? b.r + 10 : 60, body: i });
      }
    }
    return out.length ? out : null;
  }
  // mouths and clouds on rails move with state.step (held while a card is open, but keep the rings honest anyway)
  function refreshSpotlight() {
    var sp = state.spotlight, lv = state.level;
    if (!BODY_CARDS[state.card] || !sp || !lv) return;
    for (var i = 0; i < sp.length; i++) {
      var b = lv.bodies[sp[i].body];
      if (!b || !b.orbit) continue;
      Physics.bodyPos(b, state.step * K.DT, _mp);
      sp[i].x = _mp.x; sp[i].y = _mp.y;
    }
  }
  function fragCentroid() {
    var f = state.spotlight;
    if (!f || !f.length) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < f.length; i++) { var p = Render.worldToScreen(f[i].x, f[i].y); sx += p.x; sy += p.y; }
    return { x: sx / f.length, y: sy / f.length };
  }
  // Card top (CSS px) that hides the least of the ringed points. Each mouth claims a band around it: its ring plus ~34 px, which takes in
  // the pair label beside it (the card is full width, so only the vertical extent matters). Covering a mouth's centre costs most; among
  // equal positions the one farthest from the points' centre wins, which is the "half away from them" rule when a clear half exists.
  // Returns { top, cov }: cov = px of claimed bands the card covers (0 = clear).
  function quietTop(ch, minTop, maxBottom, cy) {
    var sp = state.spotlight, sc = (Render.layout && Render.layout.scale) || 1, best = minTop, bs = Infinity, bc = 0, rings = [], i, t;
    for (i = 0; sp && i < sp.length; i++) { var q = Render.worldToScreen(sp[i].x, sp[i].y), r = (sp[i].r || 0) * sc + 34; rings.push([q.y - r, q.y + r, q.y]); }
    for (t = minTop; t <= maxBottom - ch + 0.5; t += 2) {
      var cov = 0, hid = 0;
      for (i = 0; i < rings.length; i++) {
        cov += Math.max(0, Math.min(t + ch, rings[i][1]) - Math.max(t, rings[i][0]));
        if (rings[i][2] >= t - 4 && rings[i][2] <= t + ch + 4) hid++;
      }
      var sc2 = (cov + hid * 400) * 1000 - Math.abs(t + ch / 2 - cy);
      if (sc2 < bs) { bs = sc2; best = t; bc = cov + hid * 400; }
    }
    return { top: best, cov: bc };
  }
  // Two wormhole cards of the same text: the full one, and a compact one (no kicker or rule, smaller type) for plates where no band clears the mouths.
  function placeWormCard(ch, minTop, maxBottom, cy) {
    var full = quietTop(ch, minTop, maxBottom, cy);
    if (full.cov === 0) return full.top;
    elPop.classList.add('compact');
    var ch2 = Math.min(maxBottom - minTop, elPop.offsetHeight || ch), cmp = quietTop(ch2, minTop, maxBottom, cy);
    if (cmp.cov < full.cov) return cmp.top;
    elPop.classList.remove('compact');
    return full.top;
  }

  function showPopup(name, fromSheet) {
    state.card = name;
    popFromSheet = !!fromSheet;
    clearAim();
    state.spotlight = spotlightFor(name);
    elPop.innerHTML = popHtml(name);
    ui.classList.add('card-open');
    if (fromSheet) { elSheet.classList.add('sub'); elCard.classList.add('held'); }
    elPop.scrollTop = 0;
    placePop();
    elPop.classList.remove('on');
    void elPop.offsetWidth;
    elPop.classList.add('on');
    showNote('');
    setNudge(false);
  }
  function hidePopEl() {
    elPop.classList.remove('on');
    ui.classList.remove('card-open');
    elCard.classList.remove('held');
    state.card = null; state.spotlight = null;
    if (popFromSheet) { elSheet.classList.remove('sub'); popFromSheet = false; }
  }
  // dismissed by the player (or a test hook): remembered, and the next queued / unseen card follows
  function closePopup() {
    var name = state.card;
    if (!name) return null;
    var fromSheet = popFromSheet;
    Save.markSeen(name);
    hidePopEl();
    last = 0; acc = 0;
    if (!fromSheet) {
      var nx = popQueue.shift() || autoNext();
      if (nx && popupSafe()) showPopup(nx, false);
    }
    return state.card;
  }
  // silently removed (level change / reset): not remembered
  function dropPopup() { if (state.card) hidePopEl(); }

  // ---- result cards
  var cardShownAt = 0;
  function showCard(html) {
    elCard.innerHTML = html;
    placeCard();
    elCard.classList.add('on');
    cardShownAt = nowMs();
    showNote('');
  }
  function hideCard() { elCard.classList.remove('on'); elCard.classList.remove('held'); }
  function cardVisible() { return elCard.classList.contains('on'); }
  function kicker() {
    if (state.mode === 'endless') return 'Endless &middot; Plate ' + toRoman(state.endless.round);
    if (state.mode === 'daily') return 'Daily Plate' + (state.daily ? ' &middot; ' + escapeHtml(state.daily.label) : '');
    if (state.custom) return 'Plate &middot; ' + escapeHtml((state.level && (state.level.plate || state.level.name)) || 'Test');
    return 'Plate ' + toRoman(state.levelIndex + 1);
  }
  function statsLine() {
    var nf = state.level.frags ? state.level.frags.length : 0;
    var s = 'Launches <b>' + state.launches + '</b>/<b>' + K.MAX_LAUNCHES + '</b>';
    if (nf) s += '<span class="sep"> &middot; </span>Fragments <b>' + countFrags() + '</b>/<b>' + nf + '</b>';
    return s;
  }
  function hintLine() { return state.hint.used ? '<p class="note sm">Astronomer consulted: one star forfeited</p>' : ''; }
  function showSuccessCard() {
    if (state.screen !== 'play' || !state.result || !state.result.success) return;
    var r = state.result, h;
    if (state.mode === 'campaign') {
      var last = state.custom || state.levelIndex >= CAMP.length - 1;
      var rec = r.record || {};
      var note = state.custom ? escapeHtml(state.level.name || '') : last ? 'The atlas is complete.' : (r.stars === 3 ? 'A clean passage, in a single launch.' : (rec.improved && !rec.first ? 'A finer record than before.' : escapeHtml(state.level.name || '')));
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title win">Sealed</h3>' +
        '<p class="note">' + note + '</p>' +
        '<div class="c-stars">' + starsRow(r.stars, 20) + '</div>' +
        '<p class="c-stats">' + statsLine() + '</p>' + hintLine() +
        (last ? '<div class="c-btns"><button class="btn" data-act="replay">Replay</button>' +
                '<button class="btn primary" data-act="atlas">Atlas</button></div>'
              : '<div class="c-btns three"><button class="btn" data-act="replay">Replay</button>' +
                '<button class="btn" data-act="atlas">Atlas</button>' +
                '<button class="btn primary" data-act="next">Next plate</button></div>');
    } else if (state.mode === 'daily') {
      var dr = r.record || {}, streak = dr.streak || Save.dailyStreak();
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title win">Sealed</h3>' +
        '<p class="note">A new plate is engraved tomorrow.</p>' +
        '<div class="c-stars">' + starsRow(r.stars, 20) + '</div>' +
        '<p class="c-stats">Launches <b>' + state.launches + '</b>/<b>' + K.MAX_LAUNCHES + '</b><span class="sep"> &middot; </span>Streak <b>' + streak + '</b>' +
        (dr.best > streak ? '<span class="sep"> &middot; </span>Best <b>' + dr.best + '</b>' : '') + '</p>' + hintLine() +
        '<div class="c-btns"><button class="btn" data-act="replay">Replay</button>' +
        '<button class="btn primary" data-act="title">Menu</button></div>';
    } else {
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title win">Surveyed</h3>' +
        '<div class="c-stars">' + starsRow(r.stars, 20) + '</div>' +
        '<p class="c-stats">Score <b>' + state.endless.score + '</b><span class="sep"> &middot; </span>Best <b>' + Math.max(state.endless.best, state.endless.score) + '</b></p>' + hintLine() +
        '<div class="c-btns"><button class="btn" data-act="end">End survey</button>' +
        '<button class="btn primary" data-act="next">Next plate</button></div>';
    }
    showCard(h);
    if (state.mode === 'endless') preGenerate(state.endless.round + 1);
  }
  function showFailCard() {
    if (state.screen !== 'play' || !state.result || state.result.success) return;
    var h, why = FAIL_TEXT[state.result.status] || '';
    if (state.mode === 'campaign') {
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title">Unsealed</h3>' +
        '<p class="note">' + why + ' Three launches spent.</p>' +
        '<div class="c-stars">' + starsRow(0, 20) + '</div>' +
        '<div class="c-btns"><button class="btn" data-act="atlas">Atlas</button>' +
        '<button class="btn primary" data-act="retry">Retry plate</button></div>';
    } else if (state.mode === 'daily') {
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title">Unsealed</h3>' +
        '<p class="note">' + why + ' Three launches spent.</p>' +
        '<div class="c-stars">' + starsRow(0, 20) + '</div>' +
        '<div class="c-btns"><button class="btn" data-act="title">Menu</button>' +
        '<button class="btn primary" data-act="retry">Retry plate</button></div>';
    } else {
      var rounds = state.endless.round - 1;
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title">Survey Concluded</h3>' +
        '<p class="note">' + why + ' ' + (rounds === 1 ? 'One plate' : (rounds ? toRoman(rounds) + ' plates' : 'No plates')) + ' surveyed.</p>' +
        '<p class="c-stats">Score <b>' + state.endless.score + '</b><span class="sep"> &middot; </span>Best <b>' + Math.max(state.endless.best, state.endless.score) + '</b></p>' +
        '<div class="c-btns"><button class="btn" data-act="title">Title</button>' +
        '<button class="btn primary" data-act="newrun">New survey</button></div>';
    }
    showCard(h);
  }

  // ---- Consult the Astronomer
  // The astronomer draws the plate's full-clear course (every fragment, then the target) when one is engraved, else the plain winning one.
  function hintSol(lv) { var c = lv && typeof Levels !== 'undefined' && Levels.clearFor ? Levels.clearFor(lv) : null; return c || (lv && lv.solution) || null; }
  function canHint() {
    var lv = state.level;
    return state.screen === 'play' && state.phase === 'aim' && !!hintSol(lv) && !state.hint.used && !state.card &&
      state.launches < K.MAX_LAUNCHES && !cardVisible();
  }
  function hintWhy() {
    if (state.hint.used) return 'Already consulted on this attempt.';
    if (!hintSol(state.level)) return 'No course is engraved for this plate.';
    if (state.phase !== 'aim' || cardVisible()) return 'Only while a launch is being aimed.';
    return '';
  }
  function useHint() {
    if (!canHint()) return false;
    var lv = state.level, sol = hintSol(lv), t0 = sol.t0Step | 0, h = state.hint;
    // Fly the course once, noting the step at which the last fragment is gathered.
    var sim = Physics.createSim(lv, sol.vx, sol.vy, t0), got = 0, lastFrag = 0, total = 0, warps = 0, lastWarp = 0, beams = 0, lastBeam = 0, i;
    while (sim.status === 'flying' && sim.step < K.MAX_STEPS) {
      Physics.stepSim(sim, lv);
      hintBuf[2 * total] = sim.x; hintBuf[2 * total + 1] = sim.y; total++;      // a wormhole passage is one long jump between two consecutive points
      var c = 0; for (i = 0; i < sim.collected.length; i++) c += sim.collected[i];
      if (c > got) { got = c; lastFrag = total; }
      if (sim.warps > warps) { warps = sim.warps; lastWarp = total; }
      if (sim.beams > beams) { beams = sim.beams; lastBeam = total; }       // undefined on an older physics: never true
    }
    // The line is the first 55% of the course; on a full-clear course it runs on to just past the last fragment, and on a course through
    // wormholes (or pushed by pulsar beams) to just past the last passage / catch, so the new heading is shown (never the final approach:
    // at most 92%). Nebulae and beams never jump, so their paths need nothing else; sim.events piles up here unread and is dropped.
    var n = Math.floor(0.55 * total);
    if (got) n = Math.max(n, Math.min(lastFrag + 24, Math.floor(0.92 * total)));
    if (warps) n = Math.max(n, Math.min(lastWarp + 24, Math.floor(0.92 * total)));
    if (beams) n = Math.max(n, Math.min(lastBeam + 24, Math.floor(0.92 * total)));
    n = Math.min(K.HINT_MAX, n);
    h.pts.set(hintBuf.subarray(0, 2 * n));
    h.n = n; h.on = true; h.used = true; h.t0 = nowMs();
    state.step = t0; state.frozen = true;
    clearAim();
    setNudge(false);
    logEvent('hint', { mode: state.mode, level: lv });
    return true;
  }

  // ---- pause sheet
  function showSheet() {
    $('sheet-kicker').innerHTML = kicker();
    $('sheet-exit').textContent = state.mode === 'endless' ? 'End survey' : (state.mode === 'daily' ? 'Return to the Title' : 'Return to the Atlas');
    var ok = canHint(), hb = $('sheet-hint'), why = $('sheet-hint-why'), wt = ok ? '' : hintWhy();
    var wb = $('sheet-worm'); if (wb) wb.hidden = !hasWormhole(state.level);       // "About wormholes" only on plates that have one
    var nb = $('sheet-neb'); if (nb) nb.hidden = !hasKind(state.level, 'nebula');   // likewise "About nebulae" / "About pulsars"
    var pb = $('sheet-pul'); if (pb) pb.hidden = !hasKind(state.level, 'pulsar');
    hb.setAttribute('aria-disabled', String(!ok));
    why.textContent = wt; why.hidden = !wt;
    refreshSoundButtons();
    elSheet.classList.add('on');
    var pn = $('sheet-panel'); if (pn) pn.scrollTop = 0;
  }
  function hideSheet() { elSheet.classList.remove('on'); elSheet.classList.remove('sub'); }
  function pause() {
    if (state.screen !== 'play' || state.paused || state.card) return;
    state.paused = true;
    clearAim();
    Sound.droneStop();
    showSheet();
    snapshot();
  }
  function resume() {
    if (!state.paused) return;
    state.paused = false;
    hideSheet();
    Sound.resume();
    last = 0; acc = 0;
    if (state.phase === 'flight' && state.sim && state.sim.status === 'flying') Sound.droneStart();
  }

  // ------------------------------------------------------------------ actions (buttons)
  function act(name, el) {
    Sound.tick();
    switch (name) {
      case 'begin': setScreen('select'); break;
      case 'endless': startEndless(); break;
      case 'daily': loadDaily(); break;
      case 'log':
        try { if (typeof LogUI !== 'undefined' && LogUI && LogUI.open) LogUI.open(function () { if (state.screen !== 'title') setScreen('title'); else refreshTitle(); }); } catch (e) {}
        break;
      case 'sound': Sound.setMuted(!Sound.isMuted()); if (!Sound.isMuted()) { Sound.unlock(function () { Sound.chime(); }); } refreshSoundButtons(); break;
      case 'title': setScreen('title'); break;
      case 'plate':
        var i = +el.getAttribute('data-i');
        if (i >= Save.data.unlocked) { vibrate(6); return; }
        loadCampaign(i); break;
      case 'reset':
        if (state.screen === 'play' && !state.card) { if (state.mode === 'endless' && state.phase === 'result' && !state.result.success) startEndless(); else resetAttempt(); }
        break;
      case 'menu': pause(); break;
      case 'resume': resume(); break;
      case 'restart': resume(); resetAttempt(); break;
      case 'hint':
        if (!canHint()) { vibrate(6); return; }
        if (state.paused) resume();
        useHint();
        break;
      case 'howto': if (state.paused) showPopup('intro', true); break;
      case 'fragments': if (state.paused) showPopup('fragments', true); break;
      case 'wormholes': case 'nebulae': case 'pulsars': if (state.paused) showPopup(name, true); break;
      case 'pop-ok': closePopup(); break;
      case 'atlas': setScreen(state.mode === 'campaign' ? 'select' : 'title'); break;
      case 'next':
        if (state.mode === 'endless') nextEndless();
        else if (!state.custom && state.levelIndex + 1 < CAMP.length) loadCampaign(state.levelIndex + 1);
        else setScreen('select');
        break;
      case 'replay': case 'retry': resetAttempt(); break;
      case 'end': setScreen('title'); break;
      case 'newrun': startEndless(); break;
    }
  }
  ui.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act], .plate') : null;
    if (!t) {
      if (state.paused && elSheet.contains(e.target)) { Sound.tick(); resume(); }
      return;
    }
    if (t.classList.contains('plate')) act('plate', t);
    else act(t.getAttribute('data-act'), t);
  });

  // ------------------------------------------------------------------ input: aiming
  var ptr = { id: null, sx: 0, sy: 0 };
  function canAim() {
    return state.screen === 'play' && !state.paused && state.phase === 'aim' && !cardVisible() && !state.card &&
      state.launches < K.MAX_LAUNCHES && !!state.level;
  }
  function aimStart(id, x, y) {
    if (ptr.id !== null || !canAim()) return false;
    ptr.id = id; ptr.sx = x; ptr.sy = y;
    var a = state.aim;
    a.active = true; a.dx = 0; a.dy = 0; a.power = 0; a.vx = 0; a.vy = 0; a.cancel = true;
    return true;
  }
  function aimMove(x, y) {
    var a = state.aim;
    if (!a.active) return;
    var sc = (Render.layout && Render.layout.scale) || 1;
    var dx = (x - ptr.sx) / sc, dy = (y - ptr.sy) / sc;
    var lv = Physics.launchVelocity(dx, dy);
    var wasCancel = a.cancel;
    a.dx = dx; a.dy = dy; a.power = lv.power; a.vx = lv.vx; a.vy = lv.vy; a.cancel = lv.cancel;
    if (wasCancel !== lv.cancel) { Sound.tick(); if (!lv.cancel) vibrate(4); }
  }
  function aimEnd(x, y, cancelled) {
    var a = state.aim;
    if (!a.active) { ptr.id = null; return; }
    if (!cancelled && x != null) aimMove(x, y);
    var go = !cancelled && !a.cancel && canAim();
    var vx = a.vx, vy = a.vy, p = a.power;
    clearAim();
    if (go) doLaunch(vx, vy, p);
  }

  if (window.PointerEvent) {
    cv.addEventListener('pointerdown', function (e) {
      gesture();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!e.isPrimary && ptr.id !== null) return;          // ignore extra fingers
      if (aimStart(e.pointerId, e.clientX, e.clientY)) {
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (e.pointerId !== ptr.id) return;
      e.preventDefault();
      aimMove(e.clientX, e.clientY);
    });
    cv.addEventListener('pointerup', function (e) {
      gesture();
      if (e.pointerId !== ptr.id) return;
      aimEnd(e.clientX, e.clientY, false);
    });
    cv.addEventListener('pointercancel', function (e) { if (e.pointerId === ptr.id) aimEnd(null, null, true); });
    cv.addEventListener('lostpointercapture', function (e) { if (e.pointerId === ptr.id && state.aim.active) aimEnd(null, null, true); });
  } else {
    // legacy touch fallback
    cv.addEventListener('touchstart', function (e) {
      gesture();
      var t = e.changedTouches[0];
      if (e.touches.length > 1) return;
      if (aimStart(t.identifier, t.clientX, t.clientY)) e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === ptr.id) { e.preventDefault(); aimMove(t.clientX, t.clientY); }
      }
    }, { passive: false });
    cv.addEventListener('touchend', function (e) {
      gesture();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === ptr.id) aimEnd(t.clientX, t.clientY, false);
      }
    });
    cv.addEventListener('touchcancel', function () { aimEnd(null, null, true); });
    cv.addEventListener('mousedown', function (e) { gesture(); if (aimStart('m', e.clientX, e.clientY)) e.preventDefault(); });
    window.addEventListener('mousemove', function (e) { if (ptr.id === 'm') aimMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', function (e) { if (ptr.id === 'm') aimEnd(e.clientX, e.clientY, false); });
  }

  // audio unlock on any gesture (iOS: touchend/pointerup/click count as activation, pointerdown for mouse)
  function gesture() { if (!state.paused) Sound.resume(); Sound.unlock(); }
  ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(function (t) {
    window.addEventListener(t, gesture, { capture: true, passive: true });
  });

  // keyboard (desktop QA)
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (state.card) {
      if (k === 'Escape' || k === 'Enter' || k === ' ') { e.preventDefault(); closePopup(); }
      return;
    }
    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (state.screen === 'play') { if (state.paused) resume(); else pause(); e.preventDefault(); }
      else if (state.screen === 'select') setScreen('title');
    } else if ((k === 'r' || k === 'R') && state.screen === 'play' && !state.paused) {
      resetAttempt();
    } else if ((k === 'Enter' || k === ' ') && cardVisible() && doc.activeElement === doc.body) {
      var p = elCard.querySelector('.primary'); if (p) { e.preventDefault(); p.click(); }
    }
  });

  // ------------------------------------------------------------------ iOS hardening
  function pd(e) { if (e.cancelable) e.preventDefault(); }
  doc.addEventListener('touchmove', function (e) {
    var inScroll = e.target && e.target.closest && e.target.closest('.scroll, .panel, .card');
    if (e.touches.length > 1 || !inScroll) pd(e);
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu', 'selectstart'].forEach(function (t) {
    doc.addEventListener(t, pd, { passive: false });
  });
  var lastTouchEnd = 0;
  doc.addEventListener('touchend', function (e) {   // stop double-tap zoom outside controls
    var n = Date.now();
    var ctl = e.target && e.target.closest && e.target.closest('button, .scroll, .panel, .card');
    if (!ctl && n - lastTouchEnd < 350) pd(e);
    lastTouchEnd = n;
  }, { passive: false });

  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) {
      if (state.screen === 'play') pause();
      Sound.suspend();
    } else {
      last = 0; acc = 0;
      refreshTitle(); prepDaily();          // the date may have changed while the app slept: refresh the Daily Plate subline
    }
  });
  window.addEventListener('pagehide', function () { if (state.screen === 'play') pause(); Sound.suspend(); });

  // ------------------------------------------------------------------ layout
  function readSafe() {
    var s = { top: 0, right: 0, bottom: 0, left: 0 };
    try {
      var cs = getComputedStyle(elProbe);
      s.top = parseFloat(cs.paddingTop) || 0; s.right = parseFloat(cs.paddingRight) || 0;
      s.bottom = parseFloat(cs.paddingBottom) || 0; s.left = parseFloat(cs.paddingLeft) || 0;
    } catch (e) {}
    return s;
  }
  var lastSize = '';
  function doResize(force) {
    var w = Math.round(window.innerWidth || doc.documentElement.clientWidth || 0);
    var h = Math.round(window.innerHeight || doc.documentElement.clientHeight || 0);
    if (w < 2 || h < 2) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    safe = readSafe();
    var key = w + 'x' + h + '@' + dpr + ':' + safe.top + ',' + safe.right + ',' + safe.bottom + ',' + safe.left;
    if (!force && key === lastSize) return;
    lastSize = key;
    Render.resize(w, h, dpr, safe);
    L = Render.layout;
    placeDom();
    if (state.screen === 'select') requestAnimationFrame(function () { drawThumbs(false); });
  }
  function px(v) { return Math.round(v) + 'px'; }
  function placeDom() {
    L = Render.layout;
    if (!L || !L.bottom || !L.plate) return;
    var b = L.bottom, p = L.plate, zw = b.w * 0.25;
    var zl = Math.max(b.x, safe.left), zr = Math.min(b.x + b.w, L.w - safe.right);
    elZoneL.style.left = px(zl); elZoneL.style.top = px(b.y); elZoneL.style.width = px(b.x + zw - zl); elZoneL.style.height = px(Math.max(44, b.h));
    elZoneR.style.left = px(b.x + b.w - zw); elZoneR.style.top = px(b.y); elZoneR.style.width = px(zr - (b.x + b.w - zw)); elZoneR.style.height = px(Math.max(44, b.h));
    // hint: marginal note on the wider side of the probe, anchored from the bottom so it grows upward
    var lv = state.level, sc = L.scale;
    if (lv) {
      var pr = Render.worldToScreen(lv.probe.x, lv.probe.y);
      var spaceR = p.x + p.w - 14 - (pr.x + 24), spaceL = pr.x - 24 - (p.x + 14);
      var onRight = spaceR >= spaceL, hw = Math.min(p.w - 28, Math.max(180, Math.min(260, onRight ? spaceR : spaceL)));
      elHint.classList.toggle('right', onRight); elHint.classList.toggle('left', !onRight);
      elHint.style.width = px(hw);
      if (onRight) { elHint.style.left = 'auto'; elHint.style.right = px(L.w - (p.x + p.w - 14)); }
      else { elHint.style.right = 'auto'; elHint.style.left = px(p.x + 14); }
      elHint.style.top = 'auto';
      elHint.style.bottom = px(Math.max(L.h - (pr.y - 18), L.h - b.y + 6));
      elNote.style.left = px(p.x + 16); elNote.style.width = px(p.w - 32);
      elNote.style.top = px(Math.min(pr.y + 30 * sc + 14, p.y + p.h - 34));
    }
    placeCard();
    placePop();
  }
  // result card: sized from the viewport & safe areas; beside the plate in landscape, otherwise in the lower
  // part of the plate (the target and seal sit near the top). Never extends past the viewport.
  function placeCard() {
    L = Render.layout;
    if (!L || !L.plate) return;
    var p = L.plate, W = L.w, H = L.h;
    var minTop = safe.top + 10, maxBottom = H - safe.bottom - 10, availH = Math.max(120, maxBottom - minTop);
    var spR = W - safe.right - (p.x + p.w) - 32, spL = p.x - safe.left - 32;
    var side = W > H && Math.max(spR, spL) >= 200;
    var cw = side ? Math.min(340, Math.max(spR, spL)) : Math.min(340, W - 24 - safe.left - safe.right);
    elCard.style.width = px(cw);
    elCard.classList.toggle('narrow', cw < 320);
    elCard.style.maxHeight = px(availH);
    elCard.style.bottom = 'auto';
    var ch = elCard.offsetHeight || 230, top, left;
    if (side) {
      left = spR >= spL ? p.x + p.w + 16 : p.x - 16 - cw;
      top = (H - ch) / 2;
    } else {
      left = safe.left + (W - safe.left - safe.right - cw) / 2;
      top = Math.min(p.y + p.h - 10, maxBottom) - ch;
    }
    top = Math.max(minTop, Math.min(top, maxBottom - ch));
    elCard.style.left = px(left);
    elCard.style.top = px(top);
  }
  // popup card: beside the plate in landscape; in portrait centred (intro) or on the half of the screen away from the
  // comet fragments (fragment card), so the ringed comets stay in view.
  function placePop() {
    L = Render.layout;
    if (!L || !L.plate || !state.card) return;
    var p = L.plate, W = L.w, H = L.h, short = H <= 520 && W > H;
    // keep clear of the HUD bands (caption/stars above, Reset/Menu below) where the viewport allows
    var minTop = Math.max(safe.top + 10, L.top ? L.top.y + L.top.h + 2 : 0);
    var maxBottom = Math.min(H - safe.bottom - 10, L.bottom ? L.bottom.y - 2 : H);
    if (maxBottom - minTop < 200) { minTop = safe.top + 10; maxBottom = H - safe.bottom - 10; }
    var availH = Math.max(120, maxBottom - minTop);
    var spR = W - safe.right - (p.x + p.w) - 24, spL = p.x - safe.left - 24;
    var wide = short && state.card === 'intro';                  // landscape intro: a wide plate over the middle, 2 x 2 steps
    var side = !wide && W > H && Math.max(spR, spL) >= 230;
    var cw = wide ? Math.min(600, W - 24 - safe.left - safe.right) : side ? Math.min(360, Math.max(spR, spL)) : Math.min(360, W - 24 - safe.left - safe.right);
    elPop.classList.toggle('wide', wide);
    elPop.classList.remove('compact');
    elPop.style.width = px(cw);
    elPop.style.maxHeight = px(availH);
    elPop.style.bottom = 'auto';
    var ch = Math.min(availH, elPop.offsetHeight || 300), top, left;
    if (side) {
      left = spR >= spL ? p.x + p.w + 12 + (spR - cw) / 2 : p.x - 12 - cw - (spL - cw) / 2;
      top = (minTop + maxBottom - ch) / 2;
    } else {
      left = safe.left + (W - safe.left - safe.right - cw) / 2;
      top = (minTop + maxBottom - ch) / 2;
      var c = (state.card === 'fragments' || BODY_CARDS[state.card]) ? fragCentroid() : null;
      if (c) {
        var mid = (minTop + maxBottom) / 2;
        if (BODY_CARDS[state.card]) top = placeWormCard(ch, minTop, maxBottom, c.y);   // mouths, clouds and pulsars can sit anywhere: the clearest band, away from them
        else if (c.y < mid) top = Math.max(mid, mid + (maxBottom - mid - ch) / 2);     // comets above: card in the lower half
        else top = Math.min(mid - ch, minTop + (mid - minTop - ch) / 2);               // comets below: card in the upper half
      }
    }
    if (elPop.classList.contains('compact')) ch = Math.min(availH, elPop.offsetHeight || ch);
    top = Math.max(minTop, Math.min(top, maxBottom - ch));
    elPop.style.left = px(left);
    elPop.style.top = px(top);
  }
  window.addEventListener('resize', function () { doResize(false); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { doResize(true); }, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { doResize(false); });

  // ------------------------------------------------------------------ main loop
  var last = 0, acc = 0;
  var ft = new Float32Array(60), ftI = 0, ftN = 0, renderErr = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (dt > 0 && dt < 1) { ft[ftI] = dt; ftI = (ftI + 1) % 60; if (ftN < 60) ftN++; }
    if (dt > 0.25 || dt < 0) dt = K.DT;                        // tab switch / clock jump: don't catch up
    if (state.screen === 'play' && !state.paused && !state.card) {
      acc += dt;
      var n = 0;
      while (acc >= K.DT && n < K.MAX_STEPS_PER_FRAME) { physStep(); acc -= K.DT; n++; }
      if (n >= K.MAX_STEPS_PER_FRAME && acc > K.DT) acc = 0;    // drop the backlog rather than spiral
      if (state.phase === 'aim') updatePrediction();
      else if (state.phase === 'flight' && state.sim && state.sim.status === 'flying') Sound.droneSpeed(Physics.speed(state.sim) / K.VMAX / 1.4);
      if (!nudgeDone) {
        if (nudgeEligible()) { nudgeIdle += dt; if (nudgeIdle > 7) setNudge(true); }
        else { nudgeIdle = 0; setNudge(false); }
      }
    } else acc = 0;
    if (BODY_CARDS[state.card]) refreshSpotlight();
    try { Render.frame(state, t); }
    catch (e) { if (renderErr++ < 3) console.error('Render.frame', e); }
  }

  // ------------------------------------------------------------------ QA hooks (§10)
  function findSolution(lv, step) {
    function hits(v) { return v && Physics.simulate(lv, v.vx, v.vy, step, K.MAX_STEPS).status === 'hit'; }
    var s = null;
    try { s = Levels.solve(lv, { t0Step: step }); } catch (e) { s = null; }
    if (hits(s)) return { vx: s.vx, vy: s.vy, t0Step: step };
    // coarse → fine brute force (QA only; never used in normal play)
    var powers = [1, 0.85, 0.7, 0.92, 0.78, 0.62, 0.55, 0.48, 0.4, 0.34, 0.97, 0.66, 0.74, 0.82, 0.58, 0.88, 0.52, 0.44];
    for (var pi = 0; pi < powers.length; pi++) {
      for (var a = 0; a < 720; a++) {
        var ang = a * Math.PI / 360, v = K.VMAX * powers[pi];
        var c = { vx: Math.cos(ang) * v, vy: Math.sin(ang) * v };
        if (hits(c)) return { vx: c.vx, vy: c.vy, t0Step: step };
      }
    }
    return null;
  }
  function hookPrepare() {
    if (state.screen !== 'play') return false;
    if (state.paused) resume();
    if (state.phase === 'result') resetAttempt();
    else if (state.phase === 'flight') { timers.length = 0; state.sim = null; state.phase = 'aim'; }
    hideCard();
    popQueue.length = 0;
    while (state.card) closePopup();
    return true;
  }
  function fastForward(n) {
    n = Math.max(0, n | 0);
    for (var i = 0; i < n; i++) {
      if (state.screen !== 'play') break;
      physStep();
    }
    if (state.phase === 'aim') updatePrediction();
    return state.step;
  }
  function fps() {
    if (!ftN) return 0;
    var s = 0; for (var i = 0; i < ftN; i++) s += ft[i];
    return s > 0 ? ftN / s : 0;
  }
  window.__peri = {
    state: state, Physics: Physics, Levels: Levels, Render: Render, Sound: Sound, Save: Save,
    loadLevel: function (i) { return loadCampaign(i); },
    loadEndless: function (seed) { return startEndless(seed); },
    loadDaily: function (k) { return loadDaily(k); },
    loadCustom: function (lv) { return loadCustom(lv); },
    dailyPlate: function () { return dailyCache && dailyCache.key === Save.dateKey() ? dailyCache.lv : null; },
    openCard: function (name) { return requestPopup(name); },
    closeCard: function () { return closePopup(); },
    useHint: function () {
      if (state.screen !== 'play') return false;
      if (state.paused) resume();
      popQueue.length = 0;
      while (state.card) closePopup();
      return useHint();
    },
    Log: typeof Log !== 'undefined' ? Log : null, LogUI: typeof LogUI !== 'undefined' ? LogUI : null,
    launch: function (vx, vy) {
      if (!hookPrepare()) return false;
      if (state.launches >= K.MAX_LAUNCHES) resetAttempt();
      return doLaunch(+vx, +vy);
    },
    fastForward: fastForward,
    solveCurrent: function () {
      if (!hookPrepare()) return null;
      if (state.launches >= K.MAX_LAUNCHES) resetAttempt();
      var lv = state.level, sol = lv.solution;
      if (sol) {
        var t0 = sol.t0Step | 0;
        if (hasMoving(lv) && t0 !== state.step) { timers.length = 0; state.step = t0; }
      } else {
        sol = findSolution(lv, state.step);
      }
      if (!sol) return null;
      doLaunch(sol.vx, sol.vy);
      return { vx: sol.vx, vy: sol.vy, t0Step: state.step };
    },
    fps: fps,
    screen: function (name) {
      if (name == null) return state.screen;
      if (name === 'play' && state.screen !== 'play') {
        if ((state.mode === 'endless' && state.endless.round > 0) || (state.mode === 'daily' && state.level) || (state.custom && state.level)) setScreen('play');
        else loadCampaign(Math.max(0, state.levelIndex));
      }
      else setScreen(name);
      return state.screen;
    },
    pause: pause, resume: resume
  };

  function snapshot() {
    try {
      var hot = window.claude && window.claude.hot;
      if (hot && typeof hot.snapshot === 'function' && !snapshot.done) {
        snapshot.done = true;
        hot.snapshot(function () { return { screen: state.screen, levelIndex: state.levelIndex, mode: state.mode }; });
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------ boot
  Render.init(cv);
  doResize(true);
  if (state.level) { try { Render.setLevel(state.level); } catch (e) { console.error('Render.setLevel', e); } }
  buildGrid();
  refreshTitle();
  setScreen('title');
  try {
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () {
      if (thumbsDrawn && state.screen === 'select') drawThumbs(true);
      else if (thumbsDrawn) for (var i = 0; i < cards.length; i++) if (cards[i]) cards[i].done = false;
      placeDom();
    });
  } catch (e) {}
  requestAnimationFrame(loop);
})();
