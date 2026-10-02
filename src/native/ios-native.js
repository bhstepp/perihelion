/* PERIHELION — native iOS layer (owner: iOS APP). Built into the App Store build only (tools/build-ios.js); the web build
   never contains this file, so index.html and the Pages site are unchanged by it.

   It runs before every other module and touches the game through four seams, without editing game code:
   - navigator.vibrate   iOS Safari has none, so the game's existing vibrate() calls do nothing on the web. Here they
                         are mapped onto the Taptic Engine (Capacitor Haptics).
   - localStorage        every write of the save is mirrored into UserDefaults (Capacitor Preferences). iOS may purge a
                         web view's storage when the phone is short of space; if the save is ever missing at launch it
                         is restored from that copy.
   - the save itself     stars, Endless best, Daily streak and honours are reported to Game Center after each write
                         (GameCenterPlugin.swift). The Observer's Log stays the source of truth; Game Center mirrors it.
   - the DOM             a Game Center button in the Observer's Log and a Share button on the Daily result card.
   It also asks for every bundled font face at launch, so canvas text never draws once in a fallback face.

   In a plain browser (no Capacitor bridge) the whole module is inert, so the iOS page can still be opened on a desktop.
   Nothing here throws, and nothing here makes a network request. */
var Native = (function () {
  var KEY = 'perihelion.v1';            // must equal Save.KEY (this module runs before Save is defined)
  var GC_KEY = 'perihelion.gc.v1';      // what has already been reported to Game Center

  // ---- configuration -------------------------------------------------------------------------------------------------
  // Game Center identifiers are PREFIX + the names below; they must match App Store Connect exactly (docs/IOS.md lists
  // them all). Set gameCenter to false to ship without Game Center: no sign-in, no button, nothing reported.
  var CONFIG = {
    gameCenter: true,
    prefix: 'perihelion.',
    leaderboards: { stars: 'lb.stars', endless: 'lb.endless', streak: 'lb.daily_streak' },
    achievements: 'ach.',               // + the honour id from src/55-log.js, e.g. perihelion.ach.first_light
    shareUrl: ''                        // the App Store link, once the app has one; appended to shared results
  };

  var win = window, doc = document, cap = win.Capacitor;
  var active = false;
  try { active = !!(cap && typeof cap.nativePromise === 'function' && (typeof cap.isNativePlatform !== 'function' || cap.isNativePlatform())); } catch (e) {}

  function call(plugin, method, opts) {
    if (!active) return Promise.reject(new Error('no native bridge'));
    try { return cap.nativePromise(plugin, method, opts || {}); } catch (e) { return Promise.reject(e); }
  }
  // Resolves with the result, or null on any failure. Native features are extras: a failure never reaches the game.
  function quiet(p) { return p.then(function (r) { return r === undefined ? {} : r; }, function () { return null; }); }

  // ---- haptics -------------------------------------------------------------------------------------------------------
  // The game speaks in navigator.vibrate durations (see vibrate() calls in 60-main.js). Map them by weight:
  //   [12, 60, 24]  plate sealed          success notification
  //   30            crash / capture       heavy impact
  //   12, 14        launch, wormhole      medium impact
  //   8, 10         lost probe, fragment  light impact
  //   4, 6          aim tick, locked      selection tick
  var selectionReady = false;
  function buzz(p) {
    if (Array.isArray(p)) return call('Haptics', 'notification', { type: 'SUCCESS' });
    var n = Number(p) || 0;
    if (n >= 25) return call('Haptics', 'impact', { style: 'HEAVY' });
    if (n >= 12) return call('Haptics', 'impact', { style: 'MEDIUM' });
    if (n >= 7) return call('Haptics', 'impact', { style: 'LIGHT' });
    if (!selectionReady) { selectionReady = true; quiet(call('Haptics', 'selectionStart')); }
    return call('Haptics', 'selectionChanged');
  }
  function vibrate(p) { try { quiet(buzz(p)); } catch (e) {} return true; }

  // ---- durable save --------------------------------------------------------------------------------------------------
  var storageOk = true, hadSave = false, rawSetItem = null;
  try { hadSave = !!win.localStorage.getItem(KEY); } catch (e) { storageOk = false; }

  var mirrorOn = false, mirrorTimer = 0, lastMirrored = null;
  function readSave() { try { return win.localStorage.getItem(KEY); } catch (e) { return null; } }
  function mirrorNow() {
    if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = 0; }
    if (!mirrorOn) return;
    var v = readSave();
    if (!v || v === lastMirrored) return;
    lastMirrored = v;
    quiet(call('Preferences', 'set', { key: KEY, value: v }));
  }
  function onSaved() {
    if (mirrorOn && !mirrorTimer) mirrorTimer = setTimeout(mirrorNow, 400);
    scheduleSync();
  }
  function hookStorage() {
    try {
      var proto = win.Storage && win.Storage.prototype;
      if (!proto || typeof proto.setItem !== 'function') return;
      rawSetItem = proto.setItem;
      proto.setItem = function (k) {
        var r = rawSetItem.apply(this, arguments);
        if (k === KEY) { try { onSaved(); } catch (e) {} }
        return r;
      };
    } catch (e) {}
  }
  function rawWrite(k, v) {
    try { if (rawSetItem) rawSetItem.call(win.localStorage, k, v); else win.localStorage.setItem(k, v); return true; }
    catch (e) { return false; }
  }
  // Runs once at launch. Mirroring stays off until this has finished, so a fresh game can never overwrite the copy.
  function restore() {
    return quiet(call('Preferences', 'get', { key: KEY })).then(function (r) {
      var v = r && typeof r.value === 'string' && r.value ? r.value : null;
      if (!hadSave && storageOk && v) {
        var valid = false, already = false;
        try { var o = JSON.parse(v); valid = !!o && typeof o === 'object'; } catch (e) {}
        try { already = win.sessionStorage.getItem('perihelion.restored') === '1'; } catch (e) { already = true; }
        if (valid && !already) {
          try { win.sessionStorage.setItem('perihelion.restored', '1'); } catch (e) {}
          if (rawWrite(KEY, v)) { win.location.reload(); return true; }
        }
      }
      lastMirrored = v;
      mirrorOn = true;
      mirrorNow();
      return false;
    });
  }

  // ---- Game Center ---------------------------------------------------------------------------------------------------
  var gc = { authed: false, sent: { lb: {}, ach: {} }, timer: 0, fullSyncDone: false, asked: 0 };
  try {
    var s0 = JSON.parse(win.localStorage.getItem(GC_KEY) || '{}');
    if (s0 && typeof s0 === 'object') {
      if (s0.lb && typeof s0.lb === 'object') gc.sent.lb = s0.lb;
      if (s0.ach && typeof s0.ach === 'object') gc.sent.ach = s0.ach;
    }
  } catch (e) {}
  function saveSent() { try { rawWrite(GC_KEY, JSON.stringify(gc.sent)); } catch (e) {} }
  function lbId(name) { return CONFIG.prefix + CONFIG.leaderboards[name]; }
  function achId(id) { return CONFIG.prefix + CONFIG.achievements + id; }

  // What the save says should be on Game Center right now.
  function standing() {
    var out = { lb: { stars: 0, endless: 0, streak: 0 }, ach: [] };
    try {
      var d = Save.data, dl = d.daily || {};
      out.lb.stars = Save.totals().stars | 0;
      out.lb.endless = d.endlessBest | 0;
      out.lb.streak = Math.max(dl.best | 0, dl.streak | 0);
      for (var id in d.ach) if (Object.prototype.hasOwnProperty.call(d.ach, id)) out.ach.push(id);
    } catch (e) {}
    return out;
  }
  // Report anything not yet reported. `all` re-sends everything once per launch, which also repairs a new phone or a
  // reinstall (Game Center ignores scores and achievements it already has).
  function sync(all) {
    if (!CONFIG.gameCenter || !gc.authed) return;
    var now = standing(), name;
    for (name in now.lb) {
      if (now.lb[name] > 0 && (all || now.lb[name] > (gc.sent.lb[name] || 0))) submit(name, now.lb[name]);
    }
    var ids = [], keys = [];
    for (var i = 0; i < now.ach.length; i++) {
      if (all || !gc.sent.ach[now.ach[i]]) { ids.push(achId(now.ach[i])); keys.push(now.ach[i]); }
    }
    if (ids.length) {
      quiet(call('GameCenter', 'reportAchievements', { ids: ids })).then(function (r) {
        if (!r) return;
        for (var j = 0; j < keys.length; j++) gc.sent.ach[keys[j]] = 1;
        saveSent();
      });
    }
  }
  function submit(name, value) {
    quiet(call('GameCenter', 'submitScore', { id: lbId(name), value: value })).then(function (r) {
      if (!r) return;
      gc.sent.lb[name] = Math.max(gc.sent.lb[name] || 0, value);
      saveSent();
    });
  }
  function scheduleSync() {
    if (!CONFIG.gameCenter || gc.timer) return;
    if (!gc.authed) {
      // Game Center may have finished signing in since we last asked (it answers late after a visit to Settings).
      // Asking is cheap; at most once every 20 s. A yes sends everything earned so far.
      var t = Date.now();
      if (t - gc.asked > 20000) signIn();
      return;
    }
    gc.timer = setTimeout(function () { gc.timer = 0; sync(false); }, 600);
  }
  function setAuthed(r) {
    gc.authed = !!(r && r.authenticated);
    if (gc.authed && !gc.fullSyncDone) { gc.fullSyncDone = true; sync(true); }
    else if (gc.authed) sync(false);
  }
  function signIn() {
    if (!CONFIG.gameCenter) return Promise.resolve(false);
    gc.asked = Date.now();
    return quiet(call('GameCenter', 'signIn')).then(function (r) { setAuthed(r); return gc.authed; });
  }
  function openGameCenter() {
    if (!CONFIG.gameCenter) return;
    quiet(call('GameCenter', 'showDashboard')).then(setAuthed);
  }

  // ---- share ---------------------------------------------------------------------------------------------------------
  function dailyResult() {
    try {
      var st = win.__peri && win.__peri.state;
      if (!st || st.mode !== 'daily' || !st.result || !st.result.success) return null;
      return { label: st.daily && st.daily.label ? String(st.daily.label) : '', stars: st.result.stars | 0,
        launches: st.launches | 0, hint: !!st.result.hintUsed, streak: Save.dailyStreak() | 0 };
    } catch (e) { return null; }
  }
  function shareText(r) {
    var stars = '★★★'.slice(0, r.stars) + '☆☆☆'.slice(0, 3 - r.stars);
    var s = 'Perihelion · Daily Plate' + (r.label ? ' · ' + r.label : '') + '\n' +
      stars + '  Sealed in ' + (r.launches === 1 ? 'one launch' : r.launches + ' launches') +
      (r.hint ? ', with the Astronomer’s help' : '');
    if (r.streak > 1) s += '\nStreak: ' + r.streak + ' days';
    return s;
  }
  function shareDaily() {
    var r = dailyResult();
    if (!r) return;
    var opts = { text: shareText(r), dialogTitle: 'Share your Daily Plate' };
    if (CONFIG.shareUrl) opts.url = CONFIG.shareUrl;
    quiet(call('Share', 'share', opts));
  }

  // ---- DOM -----------------------------------------------------------------------------------------------------------
  function button(cls, act, text) {
    var b = doc.createElement('button');
    b.className = cls; b.setAttribute('data-act', act); b.textContent = text;
    return b;
  }
  // The Observer's Log builds its page the first time it opens. Game Center sits in its header, top right, as the
  // twin of the "< Title" button on the left (same class, so it inherits that button's look and landscape rule).
  function addLogButton() {
    if (!CONFIG.gameCenter) return true;
    var head = doc.querySelector('#logui .lg-head');
    if (!head) return false;
    if (!head.querySelector('[data-act="gamecenter"]')) {
      var b = button('lg-back', 'gamecenter', 'Game Center');
      b.type = 'button';
      b.style.left = 'auto';
      b.style.right = 'calc(var(--lg-sar) + 4px)';
      head.appendChild(b);
    }
    return true;
  }
  function watchLog() {
    if (addLogButton() || typeof MutationObserver === 'undefined' || !doc.body) return;
    var mo = new MutationObserver(function () { try { if (addLogButton()) mo.disconnect(); } catch (e) {} });
    mo.observe(doc.body, { childList: true });
  }
  // The game rebuilds the result card's markup each time it shows. A sealed Daily Plate gets Share between Replay and
  // Menu, in the same three-button row the Atlas card uses, so the card keeps its height.
  function decorateCard() {
    var card = doc.getElementById('card');
    if (!card || !dailyResult()) return;
    var btns = card.querySelector('.c-btns');
    if (!btns || btns.querySelector('[data-act="share"]')) return;
    btns.classList.add('three');
    btns.insertBefore(button('btn', 'share', 'Share'), btns.querySelector('.primary'));
  }
  function watchCard() {
    var card = doc.getElementById('card');
    if (!card || typeof MutationObserver === 'undefined') return;
    new MutationObserver(function () { try { decorateCard(); } catch (e) {} }).observe(card, { childList: true });
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-act="gamecenter"], [data-act="share"]') : null;
    if (!t) return;
    if (t.getAttribute('data-act') === 'share') { shareDaily(); return; }
    try { Sound.tick(); } catch (err) {}      // the Log is outside the game's own button handler
    openGameCenter();
  }

  // ---- boot ----------------------------------------------------------------------------------------------------------
  function start() {
    try { watchLog(); watchCard(); doc.addEventListener('click', onClick); } catch (e) {}
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) mirrorNow();        // leaving the app: flush the copy now
      else signIn();                      // back again: the player may have signed in to Game Center in Settings
    });
    restore().then(function (reloading) { if (!reloading) signIn(); });
  }

  // ---- fonts ---------------------------------------------------------------------------------------------------------
  // The files are in the app bundle, but a browser only reads a face when some text first needs it, and the canvas
  // would draw that first text in a fallback. Ask for all of them now; the game redraws once document.fonts is ready.
  try {
    if (doc.fonts && doc.fonts.load) {
      ['500 16px "Cormorant Garamond"', '600 16px "Cormorant Garamond"', 'italic 500 16px "Cormorant Garamond"',
        '500 16px "Cormorant SC"', '600 16px "Cormorant SC"', '700 16px "Cormorant SC"',
        '400 16px "JetBrains Mono"', '500 16px "JetBrains Mono"'].forEach(function (f) {
        doc.fonts.load(f, 'A\u03B1').then(null, function () {});      // Latin, and Greek where the face has it
      });
    }
  } catch (e) {}

  if (active) {
    try { Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true }); } catch (e) {}
    hookStorage();
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
  }

  return { active: active, CONFIG: CONFIG, shareText: shareText, standing: standing };
})();
