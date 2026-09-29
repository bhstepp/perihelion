/* PERIHELION — audio (owner: INPUT & FEEL AGENT).
   Web Audio synthesis only. Nothing is created or played before the first user gesture calls Sound.unlock().
   Graph: voices -> master gain -> compressor -> destination. */
var Sound = (function () {
  var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  var ctx = null, master = null, comp = null, noiseBuf = null;
  var muted = false, unlocked = false, suspendedByApp = false;
  var drone = null, droneLast = -1;
  var ksCache = {};
  var MASTER = 0.8;
  var PLUCK_NOTES = [659.26, 783.99, 880.0, 987.77, 1174.66];   // E5 G5 A5 B5 D6 (pentatonic, ascending pickups)

  function now() { return ctx.currentTime; }

  function ensure() {
    if (ctx) return ctx;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; return null; } }
    try {
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(comp); comp.connect(ctx.destination);
      // 1.5 s of white noise shared by thump / launch
      var n = Math.floor(ctx.sampleRate * 1.5);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }

  // iOS routes Web Audio through the "ambient" session, which the ringer/silent switch mutes. Playing a silent
  // HTML <audio> element (and asking for a 'playback' session where supported) makes Web Audio audible even
  // with the switch on silent. The element is paused whenever the app is suspended.
  var keepEl = null;
  function silentWavUri() {
    var n = 8000, s = '', i;   // 1 s, 8-bit mono, 8 kHz, value 128 = silence
    function u32(v) { return String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
    function u16(v) { return String.fromCharCode(v & 255, (v >> 8) & 255); }
    s += 'RIFF' + u32(36 + n) + 'WAVEfmt ' + u32(16) + u16(1) + u16(1) + u32(8000) + u32(8000) + u16(1) + u16(8) + 'data' + u32(n);
    for (i = 0; i < n; i++) s += '\x80';
    return 'data:audio/wav;base64,' + btoa(s);
  }
  function primeSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try {
      if (!keepEl) {
        keepEl = new Audio();
        keepEl.src = silentWavUri();
        keepEl.loop = true; keepEl.preload = 'auto';
        keepEl.setAttribute('playsinline', ''); keepEl.setAttribute('webkit-playsinline', '');
      }
      if (keepEl.paused && !suspendedByApp) { var p = keepEl.play(); if (p && p.catch) p.catch(function () {}); }
    } catch (e) { keepEl = null; }
  }

  function silentBlip(c) {   // a silent buffer started inside the gesture fully unlocks output on older iOS
    try { var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) {}
  }

  // Call from inside user-gesture handlers (pointerup/touchend/click/keydown; iOS ignores pointerdown/touchstart).
  // Safe to call on every gesture: it does work until the context is actually running. Optional cb fires once audio runs.
  function unlock(cb) {
    var c = ensure();
    if (!c) return;
    primeSession();
    if (c.state !== 'running' && !suspendedByApp) {
      silentBlip(c);
      try {
        var p = c.resume();
        if (p && p.then) p.then(function () { unlocked = true; if (cb) cb(); }, function () {});
      } catch (e) {}
    } else if (c.state === 'running') {
      unlocked = true;
      if (cb) cb();
    }
  }

  function ready() { return !!(ctx && !muted && ctx.state === 'running'); }

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function setMuted(b, noPersist) {
    muted = !!b;
    if (master) {
      try { master.gain.cancelScheduledValues(now()); master.gain.setTargetAtTime(muted ? 0 : MASTER, now(), 0.04); } catch (e) {}
    }
    if (muted) droneStop();
    if (!noPersist && typeof Save !== 'undefined' && Save.setMuted) Save.setMuted(muted);
  }
  function isMuted() { return muted; }

  // App-level suspend (tab hidden / paused). resume() must come from a gesture on iOS.
  function suspend() {
    suspendedByApp = true;
    droneStop();
    if (keepEl) { try { keepEl.pause(); } catch (e) {} }
    if (ctx && ctx.state === 'running') { try { var p = ctx.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  }
  function resume() {
    suspendedByApp = false;
    if (keepEl && keepEl.paused) { try { var k = keepEl.play(); if (k && k.catch) k.catch(function () {}); } catch (e) {} }
    if (ctx && ctx.state !== 'running') { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  }

  // ---- drone: two detuned sines + a lowpassed fifth; pitch glides with speed ----
  var DRONE_F = 110;
  function droneStart() {
    if (!ready() || drone) return;
    try {
      var t = now();
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.5);
      g.connect(master);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
      var g5 = ctx.createGain(); g5.gain.value = 0.35;
      lp.connect(g5); g5.connect(g);
      var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
      o1.type = 'sine'; o2.type = 'sine'; o3.type = 'triangle';
      o1.frequency.value = DRONE_F; o2.frequency.value = DRONE_F * 1.0065; o3.frequency.value = DRONE_F * 1.5;
      o1.connect(g); o2.connect(g); o3.connect(lp);
      o1.start(t); o2.start(t); o3.start(t);
      drone = { g: g, lp: lp, o: [o1, o2, o3], r: [1, 1.0065, 1.5] };
      droneLast = -1;
    } catch (e) { drone = null; }
  }
  function droneSpeed(s01) {
    if (!drone || !ctx) return;
    var s = s01 < 0 ? 0 : s01 > 1 ? 1 : s01;
    if (droneLast >= 0 && Math.abs(s - droneLast) < 0.015) return;   // throttle automation events
    droneLast = s;
    var t = now(), f = DRONE_F * (1 + 0.9 * s);
    for (var i = 0; i < 3; i++) {
      var p = drone.o[i].frequency;
      p.cancelScheduledValues(t); p.setTargetAtTime(f * drone.r[i], t, 0.12);
    }
    drone.lp.frequency.cancelScheduledValues(t);
    drone.lp.frequency.setTargetAtTime(380 + 900 * s, t, 0.15);
  }
  function droneStop() {
    if (!drone) return;
    var d = drone; drone = null;
    try {
      var t = now();
      d.g.gain.cancelScheduledValues(t);
      d.g.gain.setValueAtTime(Math.max(0.0001, d.g.gain.value), t);
      d.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      for (var i = 0; i < 3; i++) d.o[i].stop(t + 0.5);
      d.o[0].onended = function () { try { d.g.disconnect(); } catch (e) {} };
    } catch (e) {}
  }

  // ---- chime: brass bell, additive inharmonic partials ----
  function bell(t, f0, level) {
    var ratios = [1, 2.76, 5.4, 8.93], amps = [0.55, 0.3, 0.14, 0.07], decs = [1.8, 1.15, 0.6, 0.32];
    for (var i = 0; i < 4; i++) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f0 * ratios[i];
      o.connect(g); g.connect(master);
      env(g, t, amps[i] * level, 0.004, decs[i]);
      o.start(t); o.stop(t + decs[i] + 0.05);
    }
  }
  function chime() {
    if (!ready()) return;
    try { var t = now() + 0.01; bell(t, 392, 0.5); bell(t + 0.14, 587.33, 0.3); } catch (e) {}
  }

  // ---- thump: filtered noise burst + low sine drop. soft (0..1] scales it for lost/timeout ----
  function thump(soft) {
    if (!ready()) return;
    var k = soft == null ? 1 : Math.max(0.1, Math.min(1, soft));
    try {
      var t = now() + 0.005;
      var src = ctx.createBufferSource(); src.buffer = noiseBuf;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300 + 900 * k, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 0.25);
      var gn = ctx.createGain(); env(gn, t, 0.5 * k, 0.004, 0.26);
      src.connect(lp); lp.connect(gn); gn.connect(master);
      src.start(t, Math.random() * 1.0); src.stop(t + 0.32);
      var o = ctx.createOscillator(), go = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
      env(go, t, 0.7 * k, 0.006, 0.34);
      o.connect(go); go.connect(master); o.start(t); o.stop(t + 0.4);
    } catch (e) {}
  }

  // ---- pluck: Karplus-Strong, rendered once per pitch and cached ----
  function ksBuffer(f) {
    var key = Math.round(f);
    if (ksCache[key]) return ksCache[key];
    var sr = ctx.sampleRate, len = Math.floor(sr * 0.8), N = Math.max(2, Math.round(sr / f));
    var buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    var line = new Float32Array(N), prev = 0, i;
    for (i = 0; i < N; i++) { var r = Math.random() * 2 - 1; prev = prev * 0.5 + r * 0.5; line[i] = prev; }
    var p = 0;
    for (i = 0; i < len; i++) {
      var a = line[p], b = line[(p + 1) % N];
      d[i] = a;
      line[p] = 0.4985 * (a + b);
      p = (p + 1) % N;
    }
    ksCache[key] = buf;
    return buf;
  }
  function pluck(n) {
    if (!ready()) return;
    try {
      var f = PLUCK_NOTES[Math.max(0, Math.min(PLUCK_NOTES.length - 1, n | 0))];
      var t = now() + 0.005;
      var s = ctx.createBufferSource(); s.buffer = ksBuffer(f);
      var g = ctx.createGain(); g.gain.setValueAtTime(0.42, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      s.connect(g); g.connect(master); s.start(t); s.stop(t + 0.75);
    } catch (e) {}
  }

  // ---- tick: tiny UI click ----
  function tick() {
    if (!ready()) return;
    try {
      var t = now() + 0.002;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(2100, t); o.frequency.exponentialRampToValueAtTime(1200, t + 0.03);
      env(g, t, 0.07, 0.002, 0.035);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.05);
    } catch (e) {}
  }

  // ---- launch: soft whoosh, bandpassed noise sweep ----
  function launch(power) {
    if (!ready()) return;
    var p = Math.max(0, Math.min(1, power || 0));
    try {
      var t = now() + 0.005;
      var src = ctx.createBufferSource(); src.buffer = noiseBuf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.3;
      bp.frequency.setValueAtTime(320, t);
      bp.frequency.exponentialRampToValueAtTime(700 + 1700 * p, t + 0.32);
      bp.frequency.exponentialRampToValueAtTime(420, t + 0.7);
      var g = ctx.createGain(); env(g, t, 0.18 + 0.32 * p, 0.07, 0.6);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.6); src.stop(t + 0.75);
    } catch (e) {}
  }

  return {
    unlock: unlock, setMuted: setMuted, isMuted: isMuted, suspend: suspend, resume: resume,
    droneStart: droneStart, droneSpeed: droneSpeed, droneStop: droneStop,
    chime: chime, thump: thump, pluck: pluck, tick: tick, launch: launch,
    get state() { return ctx ? ctx.state : 'none'; }
  };
})();
