/* PERIHELION — save (owner: INPUT & FEEL AGENT).
   localStorage key 'perihelion.v1'. Every storage access is wrapped in try/catch; if storage is unavailable
   (private mode, sandboxed iframe, quota) the game keeps working from the in-memory copy. */
var Save = (function () {
  var KEY = 'perihelion.v1', N = 30;
  var persistent = false;

  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function fresh() { return { v: 1, stars: zeros(N), frags: zeros(N), unlocked: 1, endlessBest: 0, muted: false }; }
  function int(x, lo, hi) {
    x = Number(x);
    if (!isFinite(x)) return lo;
    x = Math.floor(x);
    return x < lo ? lo : x > hi ? hi : x;
  }
  // Defensive merge of whatever JSON we find: unknown/garbage fields are dropped, ranges clamped.
  function merge(raw) {
    var d = fresh();
    if (!raw || typeof raw !== 'object') return d;
    var i;
    if (Array.isArray(raw.stars)) for (i = 0; i < N; i++) d.stars[i] = int(raw.stars[i], 0, 3);
    if (Array.isArray(raw.frags)) for (i = 0; i < N; i++) d.frags[i] = int(raw.frags[i], 0, 9);
    d.unlocked = int(raw.unlocked, 1, N);
    // a plate with stars implies the next is open, even if 'unlocked' was lost
    for (i = 0; i < N; i++) if (d.stars[i] > 0) d.unlocked = Math.max(d.unlocked, Math.min(N, i + 2));
    d.endlessBest = int(raw.endlessBest, 0, 1e6);
    d.muted = raw.muted === true;
    return d;
  }

  var data = fresh();

  function load() {
    var s = null;
    try { s = window.localStorage.getItem(KEY); persistent = true; } catch (e) { persistent = false; }
    if (s) { try { data = merge(JSON.parse(s)); } catch (e) { data = fresh(); } }
    return data;
  }
  function write() {
    try { window.localStorage.setItem(KEY, JSON.stringify(data)); persistent = true; return true; }
    catch (e) { persistent = false; return false; }
  }

  // Record a sealed plate; keeps the best stars / fragments and opens the next plate.
  function recordPlate(i, stars, frags) {
    if (!(i >= 0 && i < N)) return { improved: false };
    var prev = data.stars[i];
    data.stars[i] = Math.max(prev, int(stars, 0, 3));
    data.frags[i] = Math.max(data.frags[i], int(frags, 0, 9));
    data.unlocked = Math.min(N, Math.max(data.unlocked, i + 2));
    write();
    return { improved: data.stars[i] > prev, first: prev === 0 };
  }
  function recordEndless(score) {
    if (score > data.endlessBest) { data.endlessBest = int(score, 0, 1e6); write(); return true; }
    return false;
  }
  function setMuted(b) { data.muted = !!b; write(); }
  function totals() {
    var s = 0, f = 0;
    for (var i = 0; i < N; i++) { s += data.stars[i]; f += data.frags[i]; }
    return { stars: s, frags: f };
  }
  function reset() { data = fresh(); write(); return data; }

  load();

  return {
    KEY: KEY, N: N,
    get data() { return data; },
    get persistent() { return persistent; },
    load: load, write: write, merge: merge,
    recordPlate: recordPlate, recordEndless: recordEndless, setMuted: setMuted, totals: totals, reset: reset
  };
})();
