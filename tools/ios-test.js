#!/usr/bin/env node
// PERIHELION — checks for the iOS app's page (ios-www/index.html) and its native layer (src/native/ios-native.js).
//
// There is no iPhone here, so the Capacitor bridge is replaced by a stand-in that records every native call and keeps
// its own "UserDefaults". That exercises all of the JavaScript side: what is sent to Haptics, Preferences, Game Center
// and Share, and when. The Swift side (ios/App/App/*.swift) can only be compiled by Xcode.
//
// usage: node tools/build-ios.js && node tools/ios-test.js        (npm run test:ios after npm run build:ios)
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && require('fs').existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), WWW = path.join(ROOT, 'ios-www'), QA = path.join(ROOT, 'qa');
fs.mkdirSync(QA, { recursive: true });

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' };
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
const KEY = 'perihelion.v1';

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && (!ok || detail) ? '  — ' + String(detail).slice(0, 400) : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- static server for ios-www (the app serves the same files from capacitor://localhost) ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(WWW, rel);
      if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ---- the stand-in for the native side ----
function makeNative() {
  const n = { calls: [], prefs: new Map(), authed: true, shown: 0 };
  n.handle = (plugin, method, opts) => {
    n.calls.push({ plugin, method, opts: opts || {} });
    if (plugin === 'Preferences') {
      if (method === 'get') return { value: n.prefs.has(opts.key) ? n.prefs.get(opts.key) : null };
      if (method === 'set') { n.prefs.set(opts.key, opts.value); return {}; }
    }
    if (plugin === 'GameCenter') {
      if (method === 'signIn') return { authenticated: n.authed };
      if (method === 'showDashboard') { n.shown++; return { authenticated: n.authed }; }
      if (!n.authed) throw new Error('Not signed in to Game Center');
      return {};
    }
    return {};
  };
  n.of = (plugin, method) => n.calls.filter(c => c.plugin === plugin && (!method || c.method === method));
  n.clear = () => { n.calls.length = 0; };
  return n;
}
const BRIDGE = `window.Capacitor = { isNativePlatform: function () { return true; }, getPlatform: function () { return 'ios'; },
  nativePromise: function (p, m, o) { return window.__native({ p: p, m: m, o: o || {} }); } };`;

async function open(browser, base, { native, viewport } = {}) {
  const ctx = await browser.newContext({ ...IPHONE, ...(viewport ? { viewport } : {}) });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS });
  const errors = [], requests = [], loads = { n: 0 };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob|about):/.test(u)) requests.push(u); });
  page.on('load', () => { loads.n++; });
  if (native) {
    await page.exposeBinding('__native', (src, c) => native.handle(c.p, c.m, c.o));
    await ctx.addInitScript(BRIDGE);
  }
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__peri && document.fonts.status === 'loaded');
  await sleep(250);
  return { ctx, page, errors, requests, loads };
}
// Seal the plate that is on screen with its engraved solution, and wait for the result card.
async function seal(page) {
  await page.evaluate(() => {
    const p = window.__peri;
    p.solveCurrent();
    for (let i = 0; i < 40 && p.state.phase === 'flight'; i++) p.fastForward(60);
    p.fastForward(200);                                       // the result card appears 1.2 s after the hit
  });
  await page.waitForFunction(() => document.getElementById('card').classList.contains('on'), null, { timeout: 5000 });
}

(async () => {
  if (!fs.existsSync(path.join(WWW, 'index.html'))) { console.error('ios-www/index.html is missing: run node tools/build-ios.js first'); process.exit(2); }
  const srv = await serve(), base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();

  // ================================================================ 1. the page on its own
  {
    const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
    check('page has no remote URL in src/href', !/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i.test(html));
    check('page does not register a service worker', !/serviceWorker/.test(html));
    check('page does not link a web manifest', !/rel="manifest"/.test(html));
    const web = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('web build does not contain the native layer', !/ios-native|GameCenter|Capacitor/.test(web));

    const t = await open(browser, base);
    const info = await t.page.evaluate(() => ({
      active: Native.active,
      fonts: ['500 20px "Cormorant Garamond"', 'italic 500 20px "Cormorant Garamond"', '600 20px "Cormorant Garamond"',
        '500 20px "Cormorant SC"', '600 20px "Cormorant SC"', '700 20px "Cormorant SC"', '400 12px "JetBrains Mono"', '500 12px "JetBrains Mono"']
        .map(f => [f, document.fonts.check(f, 'A')]),
      loaded: Array.from(document.fonts).filter(f => f.status === 'loaded').length,
      screen: window.__peri.screen(), title: document.querySelector('.t-name').textContent
    }));
    await t.page.click('[data-act="log"]');
    await sleep(350);
    const gc = await t.page.evaluate(() => !!document.querySelector('[data-act="gamecenter"]'));
    check('without a bridge the native layer is inert', info.active === false && gc === false);
    check('game boots to the title screen', info.screen === 'title' && info.title === 'Perihelion');
    check('every bundled face is available', info.fonts.every(f => f[1]), JSON.stringify(info.fonts.filter(f => !f[1])));
    check('bundled font files actually loaded', info.loaded >= 8, info.loaded + ' faces loaded');
    check('no request leaves the app bundle', t.requests.length === 0, t.requests.join(', '));
    check('no console or page errors', t.errors.length === 0, t.errors.join(' | '));
    await t.ctx.close();
  }

  // ================================================================ 2. inside the app (stand-in bridge)
  const native = makeNative();
  const app = await open(browser, base, { native });
  const { page } = app;
  {
    const boot = await page.evaluate(() => ({ active: Native.active, foot: Array.from(document.querySelectorAll('.t-foot button')).map(b => b.getAttribute('data-act')) }));
    check('native layer is active with a bridge', boot.active === true);
    check('title screen is unchanged', JSON.stringify(boot.foot) === '["log","sound"]', JSON.stringify(boot.foot));
    const first = native.calls.map(c => c.plugin + '.' + c.method);
    check('launch reads the saved copy, then signs in', first[0] === 'Preferences.get' && first.includes('GameCenter.signIn'), first.join(', '));
    check('a fresh install writes nothing to the saved copy', native.of('Preferences', 'set').length === 0);
    check('a fresh install reports nothing to Game Center', native.of('GameCenter', 'submitScore').length === 0 && native.of('GameCenter', 'reportAchievements').length === 0);
    await page.screenshot({ path: path.join(QA, 'ios-title.png') });
  }

  // ---- haptics mapping
  {
    native.clear();
    await page.evaluate(() => { [4, 6, 8, 10, 12, 14, 30].forEach(v => navigator.vibrate(v)); navigator.vibrate([12, 60, 24]); });
    await sleep(150);
    const h = native.of('Haptics').map(c => c.method + (c.opts.style ? ':' + c.opts.style : '') + (c.opts.type ? ':' + c.opts.type : ''));
    const want = ['selectionStart', 'selectionChanged', 'selectionChanged', 'impact:LIGHT', 'impact:LIGHT', 'impact:MEDIUM', 'impact:MEDIUM', 'impact:HEAVY', 'notification:SUCCESS'];
    check('vibrate durations map to the right haptics', JSON.stringify(h) === JSON.stringify(want), h.join(', '));
  }

  // ---- play plate I: haptics, saved copy, Game Center
  {
    native.clear();
    await page.evaluate(() => { window.__peri.loadLevel(0); });
    await seal(page);
    await sleep(1300);                                          // debounced mirror (400 ms) and sync (600 ms)
    const st = await page.evaluate(() => ({ stars: Save.data.stars[0], ach: Object.keys(Save.data.ach), raw: localStorage.getItem('perihelion.v1') }));
    const h = native.of('Haptics').map(c => c.method + ':' + (c.opts.style || c.opts.type || ''));
    check('plate I sealed with three stars', st.stars === 3);
    check('launch gives a medium impact', h.includes('impact:MEDIUM'), h.join(', '));
    check('sealing gives a success notification', h.includes('notification:SUCCESS'), h.join(', '));
    const sets = native.of('Preferences', 'set');
    check('the save is copied to UserDefaults', sets.length >= 1 && native.prefs.get(KEY) === st.raw, sets.length + ' writes');
    check('the copy is debounced (not one write per save)', sets.length <= 3, sets.length + ' writes');
    const scores = native.of('GameCenter', 'submitScore').map(c => c.opts.id + '=' + c.opts.value);
    check('total stars go to the stars leaderboard', scores.includes('perihelion.lb.stars=3'), scores.join(', '));
    check('scores of zero are not submitted', !scores.some(s => /=0$/.test(s)), scores.join(', '));
    const ach = [].concat(...native.of('GameCenter', 'reportAchievements').map(c => c.opts.ids));
    check('unlocked honours are reported as achievements', st.ach.length > 0 && st.ach.every(id => ach.includes('perihelion.ach.' + id)), 'save: ' + st.ach.join(',') + ' | reported: ' + ach.join(','));
    check('each honour is reported once', new Set(ach).size === ach.length, ach.join(', '));
    const share = await page.evaluate(() => !!document.querySelector('#card [data-act="share"]'));
    check('no Share button on an Atlas result card', share === false);

    // nothing new to say: replaying the same plate must not re-send
    native.clear();
    await page.evaluate(() => { window.__peri.loadLevel(0); });
    await seal(page);
    await sleep(1300);
    const again = native.of('GameCenter', 'submitScore').concat(native.of('GameCenter', 'reportAchievements'));
    check('an unchanged standing is not re-sent', again.every(c => c.method === 'reportAchievements' ? !c.opts.ids.includes('perihelion.ach.first_light') : c.opts.id !== 'perihelion.lb.stars'),
      again.map(c => c.method + ' ' + JSON.stringify(c.opts)).join(' | '));
  }

  // ---- Daily Plate: streak leaderboard and the Share button
  {
    native.clear();
    await page.evaluate(() => { window.__peri.loadDaily(); });
    await seal(page);
    await sleep(1300);
    const d = await page.evaluate(() => ({ btn: (document.querySelector('#card .c-btns [data-act="share"]') || {}).textContent, n: document.querySelectorAll('#card [data-act="share"]').length,
      streak: Save.data.daily.best, label: window.__peri.state.daily.label, stars: window.__peri.state.result.stars, launches: window.__peri.state.launches,
      order: Array.from(document.querySelectorAll('#card .c-btns button')).map(b => b.getAttribute('data-act')),
      oneRow: new Set(Array.from(document.querySelectorAll('#card .c-btns button')).map(b => Math.round(b.getBoundingClientRect().top))).size === 1,
      fits: (() => { const c = document.getElementById('card').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight && c.left >= 0 && c.right <= innerWidth; })(),
      rects: { card: Math.round(document.getElementById('card').getBoundingClientRect().bottom), hud: Math.round(document.querySelector('[data-act="reset"]').getBoundingClientRect().top) },
      clearOfHud: document.getElementById('card').getBoundingClientRect().bottom <= document.querySelector('[data-act="reset"]').getBoundingClientRect().top + 1 }));
    check('sealed Daily Plate card has one Share button', d.btn === 'Share' && d.n === 1, JSON.stringify(d));
    check('Share sits between Replay and Menu', JSON.stringify(d.order) === '["replay","share","title"]' && d.oneRow, JSON.stringify(d.order));
    check('the card with Share does not cover the Reset / Menu buttons', d.fits && d.clearOfHud, JSON.stringify(d.rects));
    const scores = native.of('GameCenter', 'submitScore').map(c => c.opts.id + '=' + c.opts.value);
    check('best Daily streak goes to its leaderboard', scores.includes('perihelion.lb.daily_streak=' + d.streak), scores.join(', '));
    await page.screenshot({ path: path.join(QA, 'ios-daily-card.png') });
    await page.click('#card [data-act="share"]');
    await sleep(150);
    const sh = native.of('Share', 'share');
    const text = sh.length ? sh[0].opts.text : '';
    check('Share opens the share sheet once', sh.length === 1);
    check('shared text names the plate and the result', text.includes('Perihelion') && text.includes('Daily Plate') && text.includes(d.label) &&
      text.includes('★'.repeat(d.stars)) && /Sealed in (one launch|\d launches)/.test(text) && !/undefined|null|NaN/.test(text), JSON.stringify(text));
    check('shared text carries no link until one is configured', !/https?:/.test(text) && sh[0] && sh[0].opts.url === undefined);
    await page.evaluate(() => { window.__peri.screen('title'); });
  }

  // ---- Endless: best score leaderboard
  {
    native.clear();
    await page.evaluate(() => { window.__peri.loadEndless(12345); });
    await seal(page);
    await sleep(1300);
    const best = await page.evaluate(() => Save.data.endlessBest);
    const scores = native.of('GameCenter', 'submitScore').map(c => c.opts.id + '=' + c.opts.value);
    check('Endless best goes to its leaderboard', best > 0 && scores.includes('perihelion.lb.endless=' + best), 'best ' + best + ' | ' + scores.join(', '));
    await page.evaluate(() => { window.__peri.screen('title'); });
  }

  // ---- Game Center button (in the Observer's Log header)
  {
    native.clear();
    await page.click('[data-act="log"]');
    await sleep(400);
    const b = await page.evaluate(() => { const els = document.querySelectorAll('#logui [data-act="gamecenter"]'), back = document.querySelector('#logui .lg-back:not([data-act])');
      const r = els[0] && els[0].getBoundingClientRect(), k = back.getBoundingClientRect();
      return { n: els.length, text: els[0] && els[0].textContent, right: r && Math.round(innerWidth - r.right), top: r && Math.round(r.top), backTop: Math.round(k.top), h: r && Math.round(r.height), clear: r && r.left > k.right }; });
    check('the Observer\u2019s Log has one Game Center button', b.n === 1 && b.text === 'Game Center', JSON.stringify(b));
    check('it mirrors the Title button (same row, 44pt tall, no overlap)', b.top === b.backTop && b.h >= 44 && b.clear && b.right >= 0, JSON.stringify(b));
    await page.screenshot({ path: path.join(QA, 'ios-log.png') });
    await page.click('#logui [data-act="gamecenter"]');
    await sleep(150);
    check('Game Center button opens the dashboard', native.shown === 1 && native.of('GameCenter', 'showDashboard').length === 1);
    const open = await page.evaluate(() => document.getElementById('logui').classList.contains('on'));
    check('the Log stays open behind it', open === true);
    await page.click('#logui .lg-back:not([data-act])');
    await sleep(400);
    await page.click('[data-act="log"]');
    await sleep(400);
    const n2 = await page.evaluate(() => document.querySelectorAll('#logui [data-act="gamecenter"]').length);
    check('reopening the Log does not add a second button', n2 === 1);
    await page.click('#logui .lg-back:not([data-act])');
    await sleep(400);
    const scr = await page.evaluate(() => window.__peri.screen());
    check('Title button still closes the Log', scr === 'title' && !(await page.evaluate(() => document.getElementById('logui').classList.contains('on'))));
  }

  // ---- leaving the app flushes the copy at once
  {
    await page.evaluate(() => { Save.setMuted(true); });
    native.clear();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(100);
    const raw = await page.evaluate(() => localStorage.getItem('perihelion.v1'));
    check('going to the background flushes the copy immediately', native.of('Preferences', 'set').length === 1 && native.prefs.get(KEY) === raw);
    await page.evaluate(() => { delete document.hidden; Save.setMuted(false); });
    await sleep(600);
  }

  // ---- iOS purged the web view's storage: the save comes back from the copy
  {
    const before = await page.evaluate(() => JSON.stringify(Save.data));
    const copy = native.prefs.get(KEY);
    native.clear();
    const loads0 = app.loads.n;
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await page.waitForFunction(() => window.__peri && Save.data.stars[0] === 3, null, { timeout: 8000 }).catch(() => {});
    await sleep(900);
    const after = await page.evaluate(() => ({ data: JSON.stringify(Save.data), raw: localStorage.getItem('perihelion.v1'), screen: window.__peri.screen() }));
    check('a purged save is restored from UserDefaults', after.data === before, 'stars[0] after: ' + JSON.parse(after.data).stars[0]);
    check('restore reloads the page exactly once', app.loads.n - loads0 === 2, (app.loads.n - loads0) + ' loads');
    check('the copy is never overwritten by the empty game', native.prefs.get(KEY) === copy && native.of('Preferences', 'set').every(c => c.opts.value === copy), native.of('Preferences', 'set').length + ' writes');
    check('the game is back on the title screen', after.screen === 'title');
    const ach = [].concat(...native.of('GameCenter', 'reportAchievements').map(c => c.opts.ids));
    check('a launch re-sends the full standing to Game Center', native.of('GameCenter', 'submitScore').some(c => c.opts.id === 'perihelion.lb.stars') && ach.includes('perihelion.ach.first_light'),
      native.of('GameCenter').map(c => c.method).join(', '));
  }

  // ---- not signed in: nothing is sent, and the game is unaffected
  {
    native.authed = false;
    native.clear();
    await page.reload();
    await page.waitForFunction(() => window.__peri && document.fonts.status === 'loaded');
    await sleep(500);
    await page.evaluate(() => { window.__peri.loadLevel(1); });
    await seal(page);
    await sleep(1300);
    const sent = native.of('GameCenter', 'submitScore').length + native.of('GameCenter', 'reportAchievements').length;
    const st = await page.evaluate(() => Save.data.stars[1]);
    check('signed out: plate II still seals and saves', st >= 1 && native.of('Preferences', 'set').length >= 1);
    check('signed out: nothing is sent to Game Center', sent === 0, sent + ' calls');
    // the player signs in from the dashboard prompt
    native.authed = true;
    native.clear();
    await page.evaluate(() => { window.__peri.screen('title'); });
    await page.click('[data-act="log"]');
    await sleep(400);
    await page.click('#logui [data-act="gamecenter"]');
    await sleep(400);
    const scores = native.of('GameCenter', 'submitScore').map(c => c.opts.id + '=' + c.opts.value);
    const total = await page.evaluate(() => Save.totals().stars);
    check('signing in later sends everything earned so far', scores.includes('perihelion.lb.stars=' + total), scores.join(', '));
  }

  // ---- a failing bridge never reaches the game
  {
    const broken = makeNative();
    broken.handle = () => { throw new Error('bridge down'); };
    const b = await open(browser, base, { native: broken });
    await b.page.evaluate(() => { window.__peri.loadLevel(0); });
    await seal(b.page);
    await sleep(800);
    const ok = await b.page.evaluate(() => Save.data.stars[0] === 3 && !!localStorage.getItem('perihelion.v1'));
    check('with every native call failing, the game still plays and saves', ok && b.errors.length === 0, b.errors.join(' | '));
    await b.ctx.close();
  }

  check('inside the app: no request leaves the bundle', app.requests.length === 0, app.requests.join(', '));
  check('inside the app: no console or page errors', app.errors.length === 0, app.errors.join(' | '));
  await app.ctx.close();

  // ================================================================ 3. the added buttons on small and large phones
  for (const vp of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 430, height: 932 }]) {
    const t = await open(browser, base, { native: makeNative(), viewport: vp });
    await t.page.click('[data-act="log"]');
    await sleep(400);
    const lg = await t.page.evaluate(() => { const g = document.querySelector('#logui [data-act="gamecenter"]').getBoundingClientRect(), k = document.querySelector('#logui .lg-back:not([data-act])').getBoundingClientRect(),
      ti = document.querySelector('#logui .lg-title').getBoundingClientRect();
      return { ok: g.right <= innerWidth && g.left > k.right && g.bottom <= ti.top + 1, gap: Math.round(g.left - k.right), toTitle: Math.round(ti.top - g.bottom) }; });
    check(`Log header fits at ${vp.width}x${vp.height}`, lg.ok, JSON.stringify(lg));
    await t.page.screenshot({ path: path.join(QA, `ios-log-${vp.width}.png`) });
    await t.page.click('#logui .lg-back:not([data-act])');
    await sleep(350);
    await t.page.evaluate(() => { window.__peri.loadDaily(); });
    await seal(t.page);
    await sleep(300);
    const c = await t.page.evaluate(() => { const bs = Array.from(document.querySelectorAll('#card .c-btns button')), card = document.getElementById('card').getBoundingClientRect();
      const fit = bs.every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height >= 40);
      return { n: bs.length, fit, oneRow: new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size === 1, inside: card.left >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
        widths: bs.map(b => Math.round(b.getBoundingClientRect().width)) }; });
    check(`Daily card with Share fits at ${vp.width}x${vp.height}`, c.n === 3 && c.fit && c.oneRow && c.inside, JSON.stringify(c));
    await t.page.screenshot({ path: path.join(QA, `ios-daily-${vp.width}.png`) });
    await t.ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
