/* PERIHELION — main loop, input, flow & menus (owner: INPUT & FEEL AGENT).
   Fixed-step accumulator at K.DT; state.step advances by exactly one per physics step while the play screen is
   live, in lockstep with Physics.stepSim, so moving bodies drawn at state.step are where physics has them. */
(function () {
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  var cv = $('game'), ui = $('ui');
  var elTitle = $('scr-title'), elSelect = $('scr-select'), elPlay = $('play-ui'), elSheet = $('sheet');
  var elCard = $('card'), elHint = $('hint'), elNote = $('note'), elGrid = $('grid'), elTally = $('tally');
  var elZoneL = $('zone-l'), elZoneR = $('zone-r'), elProbe = $('safe-probe');

  var CAMP = Levels.CAMPAIGN || [];
  var NPL = Math.min(Save.N, CAMP.length);
  var STEP_HZ = Math.round(1 / K.DT);
  var FAIL_TEXT = {
    crash: 'Struck a body.', captured: 'Taken by the dark star.', lost: 'Lost beyond the plate.', timeout: 'Drifted past the hour.'
  };

  Sound.setMuted(Save.data.muted, true);

  // ------------------------------------------------------------------ state (contract §6)
  var state = {
    screen: 'title',
    paused: false,
    mode: 'campaign',
    level: CAMP[0] || null, levelIndex: 0,
    step: 0,
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
  var hintShown = false, hintDone = false;
  var timers = [];          // step-based timers: {at: step, fn} — pause with the game, advance under fastForward
  var safe = { top: 0, right: 0, bottom: 0, left: 0 };
  var L = null;             // last Render.layout
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function hasMoving(lv) { for (var i = 0; i < lv.bodies.length; i++) if (lv.bodies[i].orbit) return true; return false; }

  // ------------------------------------------------------------------ timers (in physics steps)
  function after(steps, fn) { timers.push({ at: state.step + Math.max(1, Math.round(steps)), fn: fn }); }
  function afterMs(ms, fn) { after(ms / 1000 * STEP_HZ, fn); }
  function runTimers() {
    for (var i = 0; i < timers.length; i++) {
      if (state.step >= timers[i].at) { var t = timers[i]; timers.splice(i, 1); i--; t.fn(); }
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

  function resetAttempt() {
    timers.length = 0;
    state.step = 0;
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
    updateHint();
  }

  function resetProbe() {
    if (state.phase === 'result') return;
    state.phase = 'aim';
    state.sim = null;
    clearTrail();
    clearAim();
    state.hud.speed = 0; state.hud.closest = Infinity;
  }

  function doLaunch(vx, vy, power) {
    var lv = state.level;
    if (!lv || state.phase !== 'aim' || state.launches >= K.MAX_LAUNCHES) return false;
    state.launches++;
    var sim = Physics.createSim(lv, vx, vy, state.step);
    if (sim.collected && sim.collected.length === state.collected.length) sim.collected.set(state.collected);
    state.sim = sim;
    state.phase = 'flight';
    clearAim();
    clearTrail();
    path.n = 0;
    pushTrail(sim.x, sim.y); pushPath(sim.x, sim.y);
    state.hud.speed = Physics.speed(sim); state.hud.closest = Infinity;
    if (power == null) power = Math.min(1, Math.sqrt(vx * vx + vy * vy) / K.VMAX);
    Sound.launch(power);
    Sound.droneStart();
    vibrate(12);
    if (!hintDone && hintShown) { hintDone = true; updateHint(); }
    showNote('');
    return true;
  }

  function onFrag(i) {
    if (i < 0 || i >= state.collected.length || state.collected[i]) return;
    state.collected[i] = 1;
    var c = 0; for (var k = 0; k < state.collected.length; k++) c += state.collected[k];
    Sound.pluck(c - 1);
    vibrate(10);
  }

  function countFrags() { var c = 0; for (var k = 0; k < state.collected.length; k++) c += state.collected[k]; return c; }

  function endFlight(status) {
    var sim = state.sim;
    Sound.droneStop();
    if (status === 'hit') {
      var stars = Math.max(1, 4 - state.launches);
      state.phase = 'result';
      state.result = { success: true, stars: stars, status: status, pts: path.pts, n: path.n, at: nowMs() };
      state.hud.closest = 0;
      try { Render.fx.success(path.pts, path.n); } catch (e) {}
      Sound.chime();
      vibrate([12, 60, 24]);
      if (state.mode === 'campaign') {
        state.result.record = Save.recordPlate(state.levelIndex, stars, countFrags());
      } else {
        state.endless.score += stars;
        if (Save.recordEndless(state.endless.score)) state.endless.best = state.endless.score;
      }
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
    state.step++;
    var s = state.sim;
    if (state.phase === 'flight' && s && s.status === 'flying') {
      var st = Physics.stepSim(s, state.level);
      pushTrail(s.x, s.y); pushPath(s.x, s.y);
      if (s.events.length) {
        for (var i = 0; i < s.events.length; i++) if (s.events[i].type === 'frag') onFrag(s.events[i].i);
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
    state.levelIndex = i;
    state.level = CAMP[i];
    Render.setLevel(state.level);
    resetAttempt();
    setScreen('play');
    return state.level;
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
    setTimeout(function () {
      if (state.mode !== 'endless' || runSeed !== run || state.endless.round !== r - 1) return;
      try { preGen = { seed: seed, d: d, run: run, lv: Levels.generate(seed, d) }; } catch (e) { preGen = null; }
    }, reduceMotion ? 0 : 380);
  }
  function endlessRound() {
    var r = state.endless.round;
    var lv = genRound(r);
    lv.plate = toRoman(r);
    lv.caption = 'ENDLESS · PLATE ' + lv.plate;
    state.mode = 'endless';
    state.levelIndex = r - 1;
    state.level = lv;
    Render.setLevel(lv);
    resetAttempt();
    setScreen('play');
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
      showNote('');
      timers.length = 0;
      if (state.phase === 'flight') state.phase = 'aim';
    }
    hideSheet();
    state.paused = false;
    if (name === 'title') refreshTitle();
    if (name === 'select') refreshSelect(prev !== 'select');
    if (name === 'play') placeDom();
    updateHint();
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

  // ---- level select
  var cards = [], thumbW = 0, thumbsDrawn = false;
  function buildGrid() {
    var html = '';
    for (var i = 0; i < CAMP.length; i++) {
      var lv = CAMP[i];
      html += '<button class="plate" data-i="' + i + '" aria-label="Plate ' + toRoman(i + 1) + '">' +
        '<span class="thumb-wrap"><canvas class="thumb"></canvas><span class="sealed" hidden><span>Sealed</span></span></span>' +
        '<span class="pl-num">' + toRoman(i + 1) + '</span>' +
        '<span class="pl-name">' + escapeHtml(lv.name || '') + '</span>' +
        '<span class="pl-meta"></span></button>';
    }
    elGrid.innerHTML = html;
    cards = [];
    var bs = elGrid.querySelectorAll('.plate');
    for (var j = 0; j < bs.length; j++) cards.push({ el: bs[j], cv: bs[j].querySelector('canvas'), sealed: bs[j].querySelector('.sealed'), meta: bs[j].querySelector('.pl-meta') });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function drawThumbs(force) {
    if (!cards.length) return;
    var r = cards[0].cv.parentNode.getBoundingClientRect();
    var w = Math.round(r.width) - 2, h = Math.round(w * 16 / 9);
    if (w <= 0) return;
    if (!force && thumbsDrawn && w === thumbW) return;
    thumbW = w; thumbsDrawn = true;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i].cv;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.height = h + 'px';
      var g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = PAL.ink; g.fillRect(0, 0, c.width, c.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { Render.drawThumbnail(g, CAMP[i], w, h); } catch (e) { if (!drawThumbs.err) { drawThumbs.err = 1; console.warn('drawThumbnail failed', e); } }
    }
  }
  function refreshSelect(entering) {
    if (!cards.length) buildGrid();
    var d = Save.data, tot = Save.totals(), fragTotal = 0;
    for (var i = 0; i < cards.length; i++) {
      var lv = CAMP[i], nf = lv.frags ? lv.frags.length : 0, locked = i >= d.unlocked;
      fragTotal += nf;
      var c = cards[i];
      c.el.classList.toggle('locked', locked);
      c.el.classList.toggle('done', d.stars[i] > 0);
      c.el.setAttribute('aria-disabled', String(locked));
      c.sealed.hidden = !locked;
      var meta = starsRow(d.stars[i], 12);
      if (nf) meta += cometSvg(d.frags[i] >= nf) + '<span class="fr">' + Math.min(d.frags[i], nf) + '/' + nf + '</span>';
      c.meta.innerHTML = meta;
    }
    elTally.innerHTML = 'Stars <b>' + tot.stars + '</b>/<b>' + (cards.length * 3) + '</b><span class="sep">&middot;</span>' +
      'Fragments <b>' + tot.frags + '</b>/<b>' + fragTotal + '</b>';
    // draw after the page is laid out
    requestAnimationFrame(function () { drawThumbs(false); });
    if (entering) {
      var sc = $('s-scroll'), cur = cards[Math.max(0, Math.min(cards.length - 1, d.unlocked - 1))];
      if (sc && cur && state.mode === 'campaign' && state.levelIndex > 5) {
        requestAnimationFrame(function () { try { sc.scrollTop = Math.max(0, cards[state.levelIndex].el.offsetTop - 80); } catch (e) {} });
      }
    }
  }

  // ---- hint & marginal notes (positioned in world coords via Render)
  function updateHint() {
    var want = state.screen === 'play' && state.mode === 'campaign' && state.levelIndex === 0 &&
      !hintDone && state.launches === 0 && !(Save.data.stars[0] > 0);
    if (want) hintShown = true;
    elHint.classList.toggle('on', !!want);
  }
  var noteTimer = 0;
  function showNote(text) {
    if (text) { elNote.textContent = text; elNote.classList.add('on'); }
    else elNote.classList.remove('on');
  }

  // ---- result cards
  var cardShownAt = 0;
  function showCard(html) {
    elCard.innerHTML = html;
    placeCard();
    elCard.classList.add('on');
    cardShownAt = nowMs();
    showNote('');
  }
  function hideCard() { elCard.classList.remove('on'); }
  function cardVisible() { return elCard.classList.contains('on'); }
  function kicker() { return state.mode === 'endless' ? 'Endless &middot; Plate ' + toRoman(state.endless.round) : 'Plate ' + toRoman(state.levelIndex + 1); }
  function statsLine() {
    var nf = state.level.frags ? state.level.frags.length : 0;
    var s = 'Launches <b>' + state.launches + '</b>/<b>' + K.MAX_LAUNCHES + '</b>';
    if (nf) s += '<span class="sep"> &middot; </span>Fragments <b>' + countFrags() + '</b>/<b>' + nf + '</b>';
    return s;
  }
  function showSuccessCard() {
    if (state.screen !== 'play' || !state.result || !state.result.success) return;
    var r = state.result, h;
    if (state.mode === 'campaign') {
      var last = state.levelIndex >= CAMP.length - 1;
      var rec = r.record || {};
      var note = last ? 'The atlas is complete.' : (r.stars === 3 ? 'A clean passage, in a single launch.' : (rec.improved && !rec.first ? 'A finer record than before.' : escapeHtml(state.level.name || '')));
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title win">Sealed</h3>' +
        '<p class="note">' + note + '</p>' +
        '<div class="c-stars">' + starsRow(r.stars, 20) + '</div>' +
        '<p class="c-stats">' + statsLine() + '</p>' +
        (last ? '<div class="c-btns"><button class="btn" data-act="replay">Replay</button>' +
                '<button class="btn primary" data-act="atlas">Atlas</button></div>'
              : '<div class="c-btns three"><button class="btn" data-act="replay">Replay</button>' +
                '<button class="btn" data-act="atlas">Atlas</button>' +
                '<button class="btn primary" data-act="next">Next plate</button></div>');
    } else {
      h = '<p class="kicker">' + kicker() + '</p><h3 class="c-title win">Surveyed</h3>' +
        '<div class="c-stars">' + starsRow(r.stars, 20) + '</div>' +
        '<p class="c-stats">Score <b>' + state.endless.score + '</b><span class="sep"> &middot; </span>Best <b>' + Math.max(state.endless.best, state.endless.score) + '</b></p>' +
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

  // ---- pause sheet
  function showSheet() {
    $('sheet-kicker').innerHTML = kicker();
    $('sheet-exit').textContent = state.mode === 'endless' ? 'End survey' : 'Return to the Atlas';
    refreshSoundButtons();
    elSheet.classList.add('on');
  }
  function hideSheet() { elSheet.classList.remove('on'); }
  function pause() {
    if (state.screen !== 'play' || state.paused) return;
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
      case 'sound': Sound.setMuted(!Sound.isMuted()); if (!Sound.isMuted()) { Sound.unlock(function () { Sound.chime(); }); } refreshSoundButtons(); break;
      case 'title': setScreen('title'); break;
      case 'plate':
        var i = +el.getAttribute('data-i');
        if (i >= Save.data.unlocked) { vibrate(6); return; }
        loadCampaign(i); break;
      case 'reset': if (state.screen === 'play') { if (state.mode === 'endless' && state.phase === 'result' && !state.result.success) startEndless(); else resetAttempt(); } break;
      case 'menu': pause(); break;
      case 'resume': resume(); break;
      case 'restart': resume(); resetAttempt(); break;
      case 'atlas': setScreen(state.mode === 'endless' ? 'title' : 'select'); break;
      case 'next':
        if (state.mode === 'endless') nextEndless();
        else if (state.levelIndex + 1 < CAMP.length) loadCampaign(state.levelIndex + 1);
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
    return state.screen === 'play' && !state.paused && state.phase === 'aim' && !cardVisible() &&
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
    var inScroll = e.target && e.target.closest && e.target.closest('.scroll');
    if (e.touches.length > 1 || !inScroll) pd(e);
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu', 'selectstart'].forEach(function (t) {
    doc.addEventListener(t, pd, { passive: false });
  });
  var lastTouchEnd = 0;
  doc.addEventListener('touchend', function (e) {   // stop double-tap zoom outside controls
    var n = Date.now();
    var ctl = e.target && e.target.closest && e.target.closest('button, .scroll');
    if (!ctl && n - lastTouchEnd < 350) pd(e);
    lastTouchEnd = n;
  }, { passive: false });

  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) {
      if (state.screen === 'play') pause();
      Sound.suspend();
    } else {
      last = 0; acc = 0;
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
    if (state.screen === 'play' && !state.paused) {
      acc += dt;
      var n = 0;
      while (acc >= K.DT && n < K.MAX_STEPS_PER_FRAME) { physStep(); acc -= K.DT; n++; }
      if (n >= K.MAX_STEPS_PER_FRAME && acc > K.DT) acc = 0;    // drop the backlog rather than spiral
      if (state.phase === 'aim') updatePrediction();
      else if (state.phase === 'flight' && state.sim && state.sim.status === 'flying') Sound.droneSpeed(Physics.speed(state.sim) / K.VMAX / 1.4);
    } else acc = 0;
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
      if (name === 'play' && state.screen !== 'play') { if (state.mode === 'endless' && state.endless.round > 0) setScreen('play'); else loadCampaign(state.levelIndex); }
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
      if (thumbsDrawn) drawThumbs(true);
      placeDom();
    });
  } catch (e) {}
  requestAnimationFrame(loop);
})();
