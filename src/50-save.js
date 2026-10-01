/* PERIHELION — save.
   localStorage key 'perihelion.v1' (kept so existing saves migrate). Schema v2 adds: plates (60 at first, 90 with Volume III; shorter saved arrays are padded with zeros), `seen` flags for the
   popup cards, the Daily Plate record, lifetime `stats` and unlocked achievements. Every storage access is wrapped in
   try/catch; if storage is unavailable (private mode, sandboxed iframe, quota) the game keeps working from memory. */
var Save = (function () {
  var KEY = 'perihelion.v1', N = 90, VERSION = 2;
  var persistent = false;
  var DAY = 86400000;

  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function fresh() {
    return {
      v: VERSION, stars: zeros(N), frags: zeros(N), unlocked: 1, endlessBest: 0, muted: false,
      seen: {},                                     // { intro: true, fragments: true, ... } popup cards already shown
      daily: { last: '', lastStars: 0, lastLaunches: 0, streak: 0, best: 0, done: {} },   // done: { 'YYYY-MM-DD': stars }
      stats: {},                                    // lifetime counters, name -> number (see bump)
      ach: {}                                       // unlocked achievements, id -> 'YYYY-MM-DD'
    };
  }
  function int(x, lo, hi) {
    x = Number(x);
    if (!isFinite(x)) return lo;
    x = Math.floor(x);
    return x < lo ? lo : x > hi ? hi : x;
  }
  var NAME_OK = /^[A-Za-z0-9_]{1,32}$/, DATE_OK = /^\d{4}-\d{2}-\d{2}$/;

  // Defensive merge of whatever JSON we find: unknown/garbage fields are dropped, ranges clamped. v1 saves (30 plates,
  // no extras) are upgraded in place: arrays are padded with zeros, everything else defaults.
  function merge(raw) {
    var d = fresh(), k, i, n;
    if (!raw || typeof raw !== 'object') return d;
    if (Array.isArray(raw.stars)) for (i = 0; i < N; i++) d.stars[i] = int(raw.stars[i], 0, 3);
    if (Array.isArray(raw.frags)) for (i = 0; i < N; i++) d.frags[i] = int(raw.frags[i], 0, 9);
    d.unlocked = int(raw.unlocked, 1, N);
    for (i = 0; i < N; i++) if (d.stars[i] > 0) d.unlocked = Math.max(d.unlocked, Math.min(N, i + 2));
    d.endlessBest = int(raw.endlessBest, 0, 1e6);
    d.muted = raw.muted === true;
    if (raw.seen && typeof raw.seen === 'object') for (k in raw.seen) if (NAME_OK.test(k) && raw.seen[k] === true) d.seen[k] = true;
    var rd = raw.daily;
    if (rd && typeof rd === 'object') {
      d.daily.last = typeof rd.last === 'string' && DATE_OK.test(rd.last) ? rd.last : '';
      d.daily.lastStars = int(rd.lastStars, 0, 3);
      d.daily.lastLaunches = int(rd.lastLaunches, 0, 3);
      d.daily.streak = int(rd.streak, 0, 100000);
      d.daily.best = Math.max(d.daily.streak, int(rd.best, 0, 100000));
      if (rd.done && typeof rd.done === 'object') {
        var keys = Object.keys(rd.done).filter(function (x) { return DATE_OK.test(x); }).sort().slice(-90);
        for (i = 0; i < keys.length; i++) d.daily.done[keys[i]] = int(rd.done[keys[i]], 0, 3);
      }
    }
    if (raw.stats && typeof raw.stats === 'object') for (k in raw.stats) {
      if (!NAME_OK.test(k)) continue;
      n = Number(raw.stats[k]);
      if (isFinite(n) && n >= 0) d.stats[k] = Math.min(n, 1e12);
    }
    if (raw.ach && typeof raw.ach === 'object') for (k in raw.ach) if (NAME_OK.test(k) && DATE_OK.test(String(raw.ach[k]))) d.ach[k] = raw.ach[k];
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

  // ---- campaign ----
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
    var s = 0, f = 0, sealed = 0, three = 0;
    for (var i = 0; i < N; i++) { s += data.stars[i]; f += data.frags[i]; if (data.stars[i] > 0) sealed++; if (data.stars[i] === 3) three++; }
    return { stars: s, frags: f, sealed: sealed, threeStar: three };
  }

  // ---- popup cards ----
  function seen(name) { return data.seen[name] === true; }
  function markSeen(name) { if (NAME_OK.test(name) && !data.seen[name]) { data.seen[name] = true; write(); } }

  // ---- Daily Plate ----
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // Local calendar date as 'YYYY-MM-DD' (what "today" means to the player).
  function dateKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function keyToNoon(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
  function prevKey(k) { return dateKey(new Date(keyToNoon(k).getTime() - DAY)); }
  function dailyDone(k) { return data.daily.done[k || dateKey()] || 0; }      // stars earned that day (0 = not sealed)
  // Record a sealed daily plate. First seal of a day extends (or restarts) the streak; a better retry only improves stars.
  function recordDaily(k, stars, launches) {
    var dl = data.daily, prev = dl.done[k] || 0, first = prev === 0;
    if (first) {
      dl.streak = dl.last === prevKey(k) ? dl.streak + 1 : 1;
      dl.best = Math.max(dl.best, dl.streak);
      dl.last = k;
    }
    if (stars > prev) { dl.done[k] = int(stars, 1, 3); dl.lastStars = dl.done[k]; dl.lastLaunches = int(launches, 1, 3); }
    var keys = Object.keys(dl.done).sort(); while (keys.length > 90) delete dl.done[keys.shift()];
    write();
    return { first: first, streak: dl.streak, best: dl.best, improved: stars > prev };
  }
  // Streak as it should be shown right now: a streak whose last day was before yesterday has lapsed.
  function dailyStreak() {
    var dl = data.daily, t = dateKey();
    return dl.last === t || dl.last === prevKey(t) ? dl.streak : 0;
  }

  // ---- lifetime stats & achievements (used by Log) ----
  function bump(name, n) {
    if (!NAME_OK.test(name)) return 0;
    data.stats[name] = Math.min(1e12, (data.stats[name] || 0) + (n === undefined ? 1 : Number(n) || 0));
    return data.stats[name];
  }
  function stat(name) { return data.stats[name] || 0; }
  function unlockAch(id) { if (!NAME_OK.test(id) || data.ach[id]) return false; data.ach[id] = dateKey(); write(); return true; }
  function hasAch(id) { return !!data.ach[id]; }

  function reset() { data = fresh(); write(); return data; }

  load();

  return {
    KEY: KEY, N: N, VERSION: VERSION,
    get data() { return data; },
    get persistent() { return persistent; },
    load: load, write: write, merge: merge,
    recordPlate: recordPlate, recordEndless: recordEndless, setMuted: setMuted, totals: totals,
    seen: seen, markSeen: markSeen,
    dateKey: dateKey, prevKey: prevKey, dailyDone: dailyDone, recordDaily: recordDaily, dailyStreak: dailyStreak,
    bump: bump, stat: stat, unlockAch: unlockAch, hasAch: hasAch,
    reset: reset
  };
})();
