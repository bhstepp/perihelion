/* PERIHELION — Observer's Log screen and toasts (owner: LOG AGENT).
   LogUI.open(onClose)  full-screen page, like the Atlas: totals, the Daily Plate strip, honours. onClose runs when the
                        player leaves with the back button (or Escape); LogUI.close() hides it silently.
   LogUI.close()
   LogUI.toast(title, subtitle, opts)  small engraved banner at top centre, queued, ~3 s each, pointer-events: none.
                        opts: { kicker: 'Observation recorded', ach: true } — ach plays Sound.ach() as the banner appears.
   The DOM and the single <style id="logui-css"> are built lazily on first use. Nothing here throws. */
var LogUI = (function () {
  var doc = (typeof document !== 'undefined') ? document : null;
  var root = null, scroller = null, backBtn = null, onCloseCb = null, isOpen = false;
  var tHost = null, tQueue = [], tBusy = false;
  var SHOW_MS = 3000, FADE_MS = 250;

  var CSS = [
    '#logui, #logui-toasts {',
    '  --lg-ink: var(--ink, #0E0D0B); --lg-paper: var(--paper, #EDE6D6); --lg-graphite: var(--graphite, #2A2620);',
    '  --lg-brass: var(--brass, #C9A45C); --lg-vermilion: var(--vermilion, #E4572E);',
    '  --lg-p90: var(--paper-90, rgba(237,230,214,.9)); --lg-p75: var(--paper-75, rgba(237,230,214,.75));',
    '  --lg-p60: var(--paper-60, rgba(237,230,214,.6)); --lg-p45: var(--paper-45, rgba(237,230,214,.45));',
    '  --lg-hair: var(--hair, rgba(237,230,214,.42)); --lg-hairf: var(--hair-faint, rgba(237,230,214,.17));',
    '  --lg-press: var(--press, rgba(237,230,214,.08)); --lg-bh: var(--brass-hair, rgba(201,164,92,.72));',
    '  --lg-bf: var(--brass-faint, rgba(201,164,92,.3));',
    '  --lg-sc: var(--sc, "Cormorant SC", "Cormorant Garamond", Georgia, "Times New Roman", serif);',
    '  --lg-serif: var(--serif, "Cormorant Garamond", Georgia, "Times New Roman", serif);',
    '  --lg-mono: var(--mono, "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace);',
    '  --lg-ease: var(--ease, cubic-bezier(.22,.8,.26,1));',
    '  --lg-sat: env(safe-area-inset-top, 0px); --lg-sar: env(safe-area-inset-right, 0px);',
    '  --lg-sab: env(safe-area-inset-bottom, 0px); --lg-sal: env(safe-area-inset-left, 0px);',
    '  box-sizing: border-box; font-family: var(--lg-serif); -webkit-font-smoothing: antialiased;',
    '  -webkit-text-size-adjust: 100%; text-size-adjust: 100%;',
    '}',
    '#logui *, #logui-toasts * { box-sizing: border-box; }',
    '#logui { position: fixed; inset: 0; z-index: 60; background: var(--lg-ink); color: var(--lg-paper);',
    '  display: flex; flex-direction: column; opacity: 0; visibility: hidden; transform: translateY(8px); pointer-events: none;',
    '  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;',
    '  transition: opacity 250ms var(--lg-ease), transform 250ms var(--lg-ease), visibility 0s linear 250ms; }',
    '#logui.on { opacity: 1; visibility: visible; transform: none; pointer-events: auto;',
    '  transition: opacity 250ms var(--lg-ease), transform 250ms var(--lg-ease), visibility 0s linear 0s; }',
    '#logui .lg-caps { font-variant-caps: small-caps; }',

    /* header, as the Atlas */
    '#logui .lg-head { flex: none; position: relative; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px;',
    '  padding: calc(var(--lg-sat) + 50px) calc(var(--lg-sar) + 16px) 12px calc(var(--lg-sal) + 16px);',
    '  border-bottom: 3px double var(--lg-hairf); }',
    '#logui .lg-back { -webkit-appearance: none; appearance: none; position: absolute; left: calc(var(--lg-sal) + 4px); top: calc(var(--lg-sat) + 6px);',
    '  background: none; border: 0; border-radius: 0; color: var(--lg-p60); font: 600 14px/1 var(--lg-sc); font-variant-caps: small-caps;',
    '  letter-spacing: .18em; min-height: 44px; min-width: 44px; padding: 0 12px 2px; cursor: pointer; touch-action: manipulation;',
    '  transition: color 200ms var(--lg-ease); }',
    '#logui .lg-back:active { color: var(--lg-paper); }',
    '#logui .lg-back:focus { outline: none; }',
    '#logui .lg-scroll:focus { outline: none; }',
    '#logui .lg-back:focus-visible { outline: 1px solid var(--lg-brass); outline-offset: 3px; }',
    '#logui .lg-title { font: 600 25px/1.1 var(--lg-sc); font-variant-caps: small-caps; letter-spacing: .14em; padding-left: .14em;',
    '  margin: 0; color: var(--lg-paper); text-wrap: balance; }',
    '#logui .lg-rule { width: min(46vw, 220px); height: 4px; border-top: 1px solid var(--lg-hairf); border-bottom: 1px solid var(--lg-hairf); }',
    '#logui .lg-sub { margin: 0; font: italic 500 15px/1.2 var(--lg-serif); color: var(--lg-p60); }',

    /* scroll body */
    '#logui .lg-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; touch-action: pan-y;',
    '  overscroll-behavior: contain; padding: 4px calc(var(--lg-sar) + 16px) calc(var(--lg-sab) + 32px) calc(var(--lg-sal) + 16px); }',
    '#logui .lg-page { max-width: 600px; margin: 0 auto; }',
    '#logui .lg-sec { margin-top: 26px; }',
    '#logui .lg-h { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; font: 600 15px/1 var(--lg-sc); font-variant-caps: small-caps;',
    '  letter-spacing: .24em; color: var(--lg-p90); }',
    '#logui .lg-h::before, #logui .lg-h::after { content: ""; flex: 1; height: 4px; border-top: 1px solid var(--lg-hairf); border-bottom: 1px solid var(--lg-hairf); }',
    '#logui .lg-h span { padding: 0 0 2px .24em; }',
    '#logui .lg-note { margin: 12px 0 0; text-align: center; font: italic 500 16px/1.25 var(--lg-serif); color: var(--lg-p60); }',

    /* observations */
    '#logui .lg-figs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
    '#logui .lg-fig { border: 1px solid var(--lg-hairf); padding: 12px 8px 10px; text-align: center; display: flex; flex-direction: column; gap: 7px; align-items: center; }',
    '#logui .lg-fig b { font: 400 26px/1 var(--lg-mono); font-variant-numeric: tabular-nums; color: var(--lg-paper); letter-spacing: -.02em; }',
    '#logui .lg-fig b i { font-style: normal; font-size: 14px; color: var(--lg-p45); letter-spacing: 0; }',
    '#logui .lg-fig span { font: 600 12px/1.1 var(--lg-sc); font-variant-caps: small-caps; letter-spacing: .18em; color: var(--lg-p60); padding-left: .18em; }',
    '#logui .lg-fig.brass { border-color: var(--lg-bf); }',
    '#logui .lg-fig.brass b { color: var(--lg-brass); }',
    '#logui .lg-ledger { list-style: none; margin: 14px 0 0; padding: 0; }',
    '#logui .lg-ledger li { display: flex; align-items: baseline; gap: 8px; min-height: 32px; padding: 6px 2px 4px; border-bottom: 1px solid var(--lg-hairf); }',
    '#logui .lg-ledger li:last-child { border-bottom: 0; }',
    '#logui .lg-ledger span { font: 600 14px/1.1 var(--lg-sc); font-variant-caps: small-caps; letter-spacing: .16em; color: var(--lg-p75); }',
    '#logui .lg-ledger em { flex: 1; align-self: flex-end; height: 0; margin-bottom: 5px; border-bottom: 1px dotted var(--lg-hairf); }',
    '#logui .lg-ledger b { font: 400 14px/1.1 var(--lg-mono); font-variant-numeric: tabular-nums; color: var(--lg-paper); }',
    '#logui .lg-ledger b i { font-style: normal; color: var(--lg-p45); font-size: 11px; margin-left: 3px; }',

    /* daily plate */
    '#logui .lg-dfigs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
    '#logui .lg-strip { list-style: none; margin: 12px 0 0; padding: 0 0 0; display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); }',
    '#logui .lg-day { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 66px;',
    '  border-bottom: 1px solid var(--lg-hair); }',
    '#logui .lg-day .lg-tick { display: block; width: 1px; height: 9px; background: var(--lg-graphite); }',
    '#logui .lg-day.got .lg-tick { width: 5px; height: 22px; background: var(--lg-brass); }',
    '#logui .lg-day.today:not(.got) .lg-tick { width: 1px; height: 14px; background: var(--lg-p60); }',
    '#logui .lg-pips { display: flex; flex-direction: column-reverse; align-items: center; gap: 1px; margin-bottom: 4px; min-height: 0; }',
    '#logui .lg-pips svg { display: block; width: 8px; height: 8px; fill: var(--lg-brass); }',
    '#logui .lg-day .lg-d { position: absolute; top: 100%; left: 0; right: 0; margin-top: 5px; text-align: center; font: 400 9.5px/1 var(--lg-mono); color: var(--lg-p45); }',
    '#logui .lg-day.got .lg-d { color: var(--lg-p75); }',
    '#logui .lg-day.today .lg-d { color: var(--lg-paper); }',
    '#logui .lg-day .lg-w { position: absolute; top: 100%; left: 0; right: 0; margin-top: 18px; text-align: center; font: 600 10px/1 var(--lg-sc); font-variant-caps: small-caps; color: var(--lg-p45); }',
    '#logui .lg-strip-wrap { padding-bottom: 34px; }',
    '#logui .lg-legend { margin: 0; text-align: center; font: italic 500 14px/1.2 var(--lg-serif); color: var(--lg-p60); }',

    /* honours */
    '#logui .lg-count { margin: -4px 0 14px; text-align: center; font: italic 500 16px/1.2 var(--lg-serif); color: var(--lg-p75); }',
    '#logui .lg-count b { font: 400 13px/1 var(--lg-mono); font-style: normal; color: var(--lg-brass); }',
    '#logui .lg-honours { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
    '#logui .lg-hon { border: 1px solid var(--lg-hairf); padding: 9px 10px 10px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
    '#logui .lg-hon .lg-top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }',
    '#logui .lg-hon .lg-n { font: 400 12px/1 var(--lg-mono); color: var(--lg-p45); }',
    '#logui .lg-hon .lg-dt { font: 400 9.5px/1 var(--lg-mono); color: var(--lg-brass); opacity: .85; }',
    '#logui .lg-hon .lg-nm { font: 600 16px/1.1 var(--lg-sc); font-variant-caps: small-caps; letter-spacing: .08em; color: var(--lg-p60); overflow-wrap: anywhere; }',
    '#logui .lg-hon .lg-bl { margin: 0; font: italic 500 14px/1.2 var(--lg-serif); color: var(--lg-p60); }',
    '#logui .lg-hon.got { border-color: var(--lg-bf); outline: 1px solid var(--lg-hairf); outline-offset: -4px; }',
    '#logui .lg-hon.got .lg-n { color: var(--lg-brass); }',
    '#logui .lg-hon.got .lg-nm { color: var(--lg-paper); }',
    '#logui .lg-hon.got .lg-bl { color: var(--lg-p75); }',
    '#logui .lg-colophon { margin: 26px auto 0; text-align: center; font: italic 500 15px/1.25 var(--lg-serif); color: var(--lg-p45); max-width: 20em; }',

    /* short landscape screens */
    '@media (max-height: 520px) {',
    '  #logui .lg-head { padding-top: calc(var(--lg-sat) + 8px); padding-bottom: 8px; gap: 5px; }',
    '  #logui .lg-back { top: calc(var(--lg-sat) + 2px); }',
    '  #logui .lg-title { font-size: 21px; margin-top: 2px; }',
    '  #logui .lg-sub { display: none; }',
    '  #logui .lg-figs { grid-template-columns: repeat(4, 1fr); }',
    '  #logui .lg-fig { padding: 10px 4px 8px; }',
    '  #logui .lg-fig b { font-size: 22px; }',
    '  #logui .lg-page { max-width: 700px; }',
    '}',
    '@media (max-width: 340px) { #logui .lg-honours { grid-template-columns: 1fr; } }',

    /* toasts */
    '#logui-toasts { position: fixed; left: 0; right: 0; top: calc(var(--lg-sat) + 8px); z-index: 1000; display: flex; justify-content: center;',
    '  padding: 0 calc(var(--lg-sar) + 12px) 0 calc(var(--lg-sal) + 12px); pointer-events: none; }',
    '#logui-toasts .lg-toast { width: min(340px, 100%); padding: 9px 14px 11px; text-align: center; pointer-events: none; background: var(--lg-ink);',
    '  border: 1px solid var(--lg-bh); outline: 1px solid var(--lg-bf); outline-offset: -5px;',
    '  display: flex; flex-direction: column; align-items: center; gap: 3px;',
    '  opacity: 0; transform: translateY(-8px); transition: opacity 250ms var(--lg-ease), transform 250ms var(--lg-ease); }',
    '#logui-toasts .lg-toast.on { opacity: 1; transform: none; }',
    /* compact form (whenever the Log page is not open): ONE line, kicker + name, ~32 px */
    '#logui-toasts .lg-toast.compact { width: auto; max-width: 100%; flex-direction: row; align-items: baseline; justify-content: center; gap: 9px; padding: 5px 13px 6px; outline-offset: -3px; }',
    '#logui-toasts .lg-toast.compact .lg-tk { flex: none; font-size: 8.5px; letter-spacing: .2em; padding-left: 0; }',
    '#logui-toasts .lg-toast.compact .lg-tt { font-size: 15px; letter-spacing: .07em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }',
    '#logui-toasts .lg-tk { margin: 0; font: 600 10px/1 var(--lg-sc); font-variant-caps: small-caps; letter-spacing: .26em; padding-left: .26em; color: var(--lg-brass); }',
    '#logui-toasts .lg-tt { margin: 0; font: 600 19px/1.1 var(--lg-sc); font-variant-caps: small-caps; letter-spacing: .1em; color: var(--lg-paper); }',
    '#logui-toasts .lg-ts { margin: 0; font: italic 500 15px/1.2 var(--lg-serif); color: var(--lg-p75); }',

    '@media (prefers-reduced-motion: reduce) {',
    '  #logui, #logui.on, #logui-toasts .lg-toast, #logui-toasts .lg-toast.on { transition-duration: 1ms !important; transition-delay: 0s !important; }',
    '  #logui, #logui-toasts .lg-toast { transform: none !important; }',
    '}'
  ].join('\n');

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function fmt(n) {
    n = Math.round(Number(n) || 0);
    var s = String(Math.abs(n)), out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (n < 0 ? '-' : '') + s + out;
  }

  // physics steps -> seconds: one decimal under a minute, whole seconds after
  function secs(steps) {
    var dt = 1 / 120; try { if (K.DT > 0) dt = K.DT; } catch (e) {}
    var v = Math.max(0, Number(steps) || 0) * dt;
    return v < 60 ? (Math.round(v * 10) / 10).toFixed(1) : fmt(v);
  }
  // plates in the Atlas as it stands (the campaign may still be shorter than the save)
  function plates() {
    var n = 0;
    try { if (Levels.CAMPAIGN && Levels.CAMPAIGN.length > 0) n = Levels.CAMPAIGN.length; } catch (e) {}
    if (!n) { try { n = Save.N | 0; } catch (e) {} }
    return n;
  }

  function injectCss() {
    if (!doc || doc.getElementById('logui-css')) return;
    var st = doc.createElement('style');
    st.id = 'logui-css';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  // ---------------------------------------------------------------- the Log screen
  var STAR = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .4l1.5 3.2 3.5.4-2.6 2.4.7 3.5L5 8.1 1.9 9.9l.7-3.5L0 4l3.5-.4z"/></svg>';
  var DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  function lastDays(n) {
    var keys = [], k = Save.dateKey();
    for (var i = 0; i < n; i++) { keys.unshift(k); k = Save.prevKey(k); }
    return keys;
  }
  function dailyStrip(snap) {
    var keys = lastDays(14), done = (snap.daily && snap.daily.done) || {}, h = '', today = keys[keys.length - 1];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], st = done[k] || 0, p = k.split('-'), dow = new Date(+p[0], +p[1] - 1, +p[2], 12).getDay();
      var pips = '';
      for (var s = 0; s < st; s++) pips += STAR;
      h += '<li class="lg-day' + (st > 0 ? ' got' : '') + (k === today ? ' today' : '') + '" aria-label="' + esc(k) + (st > 0 ? ', sealed, ' + st + (st === 1 ? ' star' : ' stars') : k === today ? ', not yet sealed' : ', missed') + '">' +
        (st > 0 ? '<span class="lg-pips">' + pips + '</span>' : '') + '<i class="lg-tick"></i>' +
        '<span class="lg-d">' + (+p[2]) + '</span><span class="lg-w">' + DOW[dow] + '</span></li>';
    }
    return '<ol class="lg-strip">' + h + '</ol>';
  }

  function fig(label, value, unit, cls) {
    return '<div class="lg-fig' + (cls ? ' ' + cls : '') + '"><b>' + value + (unit ? '<i>' + unit + '</i>' : '') + '</b><span>' + esc(label) + '</span></div>';
  }
  function row(label, value, unit) {
    return '<li><span>' + esc(label) + '</span><em></em><b>' + value + (unit ? '<i>' + unit + '</i>' : '') + '</b></li>';
  }

  function render(snap) {
    var t = snap.totals || {}, st = snap.stats || {}, dl = snap.daily || {}, ach = snap.achievements || [];
    var N = plates();
    var got = 0, i;
    for (i = 0; i < ach.length; i++) if (ach[i].unlocked) got++;
    var hit = st.launches > 0 ? Math.round(100 * (st.hitRate || 0)) + '<i>%</i>' : '&mdash;';
    var frags = Math.max(st.frags || 0, t.frags || 0);
    var h = '<div class="lg-page">';

    h += '<section class="lg-sec" style="margin-top:18px"><h3 class="lg-h"><span>Observations</span></h3>';
    h += '<div class="lg-figs">' +
      fig('Plates sealed', fmt(t.sealed || 0) + '<i>/' + N + '</i>', '', 'brass') +
      fig('Stars', fmt(t.stars || 0) + '<i>/' + (3 * N) + '</i>', '', 'brass') +
      fig('Fragments', fmt(frags)) +
      fig('Launches', fmt(st.launches || 0)) + '</div>';
    h += '<ul class="lg-ledger">' +
      row('Hit rate', hit) +
      row('Distance flown', fmt(st.distance || 0), 'u') +
      row('Near misses', fmt(st.nearMiss || 0)) +
      row('Needles threaded', fmt(st.threads || 0)) +
      row('Gates passed', fmt(st.warps || 0)) +
      row('Time in nebulae', secs(st.fog), 's') +
      row('Beam catches', fmt(st.beams || 0)) + '</ul>';
    if (!(st.launches > 0)) h += '<p class="lg-note">Nothing observed as yet. The log fills as you fly.</p>';
    h += '</section>';

    h += '<section class="lg-sec"><h3 class="lg-h"><span>The Daily Plate</span></h3>';
    h += '<div class="lg-dfigs">' + fig('Current streak', fmt(dl.streak || 0), '', (dl.streak > 0) ? 'brass' : '') + fig('Best streak', fmt(dl.best || 0)) + '</div>';
    h += '<div class="lg-strip-wrap">' + dailyStrip(snap) + '</div>';
    h += '<p class="lg-legend">The last fortnight: a brass mark for each plate sealed, and a star for each earned.</p></section>';

    h += '<section class="lg-sec"><h3 class="lg-h"><span>Instruments &amp; Honours</span></h3>';
    h += '<p class="lg-count"><b>' + got + '</b> of <b>' + ach.length + '</b> honours recorded</p><ul class="lg-honours">';
    for (i = 0; i < ach.length; i++) {
      var a = ach[i], n = (i + 1 < 10 ? '0' : '') + (i + 1);
      h += '<li class="lg-hon' + (a.unlocked ? ' got' : '') + '" data-id="' + esc(a.id) + '"><div class="lg-top"><span class="lg-n">' + n + '</span>' +
        (a.unlocked && a.date ? '<span class="lg-dt">' + esc(a.date) + '</span>' : '') + '</div>' +
        '<div class="lg-nm">' + esc(a.name) + '</div><p class="lg-bl">' + esc(a.blurb) + '</p></li>';
    }
    h += '</ul></section>';
    h += '<p class="lg-colophon">Set down by the observer, for the record of the Atlas.</p></div>';
    scroller.innerHTML = h;
  }

  function build() {
    if (root || !doc) return;
    injectCss();
    root = doc.createElement('div');
    root.id = 'logui';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'The Observer’s Log');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<header class="lg-head"><button class="lg-back" type="button">&lsaquo; Title</button>' +
      '<h2 class="lg-title">The Observer’s Log</h2><div class="lg-rule"></div>' +
      '<p class="lg-sub">Observations, honours and the daily plate</p></header>' +
      '<div class="lg-scroll scroll" tabindex="-1"></div>';
    backBtn = root.querySelector('.lg-back');
    scroller = root.querySelector('.lg-scroll');
    backBtn.addEventListener('click', function (e) { e.preventDefault(); back(); });
    // keep the game beneath from seeing any gesture, and let the page's own touchmove guard (which blocks scrolling
    // outside .scroll) stand aside so this page scrolls on iOS
    ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'wheel'].forEach(function (t) {
      root.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
    });
    (doc.body || doc.documentElement).appendChild(root);
  }

  function onKey(e) {
    if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopPropagation(); back(); }
  }

  function open(onClose) {
    try {
      if (!doc) { if (onClose) onClose(); return; }
      build();
      onCloseCb = typeof onClose === 'function' ? onClose : null;
      var snap = null;
      try { snap = (typeof Log !== 'undefined' && Log.snapshot) ? Log.snapshot() : null; } catch (e) {}
      if (!snap) snap = { totals: {}, stats: {}, daily: {}, achievements: [] };
      render(snap);
      scroller.scrollTop = 0;
      root.setAttribute('aria-hidden', 'false');
      void root.offsetWidth;
      root.classList.add('on');
      isOpen = true;
      window.addEventListener('keydown', onKey, true);
      try { scroller.focus({ preventScroll: true }); } catch (e) {}
    } catch (e) { if (onClose) { try { onClose(); } catch (e2) {} } }
  }

  function close() {
    try {
      if (!root) return;
      isOpen = false;
      root.classList.remove('on');
      root.setAttribute('aria-hidden', 'true');
      window.removeEventListener('keydown', onKey, true);
    } catch (e) {}
  }

  function back() {
    var cb = onCloseCb;
    onCloseCb = null;
    close();
    if (cb) { try { cb(); } catch (e) {} }
  }

  // ---------------------------------------------------------------- toasts
  function toast(title, subtitle, opts) {
    try {
      if (!doc) return;
      tQueue.push({ title: title, sub: subtitle, o: opts || {} });
      if (!tBusy) nextToast();
    } catch (e) {}
  }

  // On the play screen the banner sits just inside the top edge of the plate (below the HUD row, whose position moves with the
  // device's safe inset); everywhere else it keeps the CSS default (just under the safe inset). Read at show time; all guarded.
  function placeHost() {
    if (!tHost) return;
    var top = '';
    try {
      var pl = doc.getElementById('play-ui');
      if (!isOpen && pl && pl.classList.contains('on') && typeof Render !== 'undefined' && Render.layout && Render.layout.plate) {
        var y = Render.layout.plate.y;
        if (y > 0 && y < 400) top = (y + 4) + 'px';
      }
    } catch (e) {}
    tHost.style.top = top;
  }

  function nextToast() {
    var item = tQueue.shift();
    if (!item) { tBusy = false; return; }
    tBusy = true;
    try {
      injectCss();
      if (!tHost) {
        tHost = doc.createElement('div');
        tHost.id = 'logui-toasts';
        tHost.setAttribute('aria-live', 'polite');
        (doc.body || doc.documentElement).appendChild(tHost);
      }
      var el = doc.createElement('div');
      var compact = !isOpen;      // over the game: one short line; over the Log page: the full banner with the blurb
      placeHost();
      el.className = 'lg-toast' + (compact ? ' compact' : '');
      if (compact && item.sub) el.setAttribute('title', String(item.sub));
      el.innerHTML = '<p class="lg-tk">' + esc(item.o.kicker || (compact ? 'Recorded' : 'Observation recorded')) + '</p>' +
        '<p class="lg-tt">' + esc(item.title) + '</p>' + (!compact && item.sub ? '<p class="lg-ts">' + esc(item.sub) + '</p>' : '');
      tHost.appendChild(el);
      void el.offsetWidth;
      el.classList.add('on');
      if (item.o.ach) { try { if (typeof Sound !== 'undefined' && Sound.ach) Sound.ach(); } catch (e) {} }
      setTimeout(function () {
        el.classList.remove('on');
        setTimeout(function () {
          try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
          nextToast();
        }, FADE_MS + 30);
      }, SHOW_MS);
    } catch (e) { tBusy = false; }
  }

  return { open: open, close: close, toast: toast };
})();
