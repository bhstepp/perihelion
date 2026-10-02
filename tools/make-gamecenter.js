#!/usr/bin/env node
// Everything App Store Connect asks for when you set up Game Center, generated from the game itself so the two can
// never drift apart:
//   ios/game-center/SETUP.md               the 3 leaderboards and every achievement: ID, title, descriptions, points
//   ios/game-center/achievements/<id>.png  one 1024 x 1024 image per achievement (App Store Connect requires one each)
//   ios/game-center/leaderboards/<id>.png  optional leaderboard images
// Titles and descriptions are the honours of the Observer's Log (src/55-log.js); IDs use the prefix in
// src/native/ios-native.js. Re-run after adding an honour. Needs playwright (devDependency) and `npm run build:ios`
// (for the bundled fonts).
// usage: node tools/make-gamecenter.js
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && require('fs').existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'ios', 'game-center');
const { load } = require('./load.js');

// ---- IDs: read the prefix and names out of the native layer, so this file has no second copy of them ----
const nativeSrc = fs.readFileSync(path.join(ROOT, 'src', 'native', 'ios-native.js'), 'utf8');
const cfgText = (nativeSrc.match(/var CONFIG = (\{[\s\S]*?\n {2}\});/) || [])[1];
if (!cfgText) throw new Error('make-gamecenter: CONFIG not found in src/native/ios-native.js');
const CONFIG = vm.runInNewContext('(' + cfgText + ')');

const honours = load(['55-log.js']).Log.ACHIEVEMENTS;

// Game Center allows 1000 points per game and 100 per achievement.
const POINTS = {
  first_light: 10, thread_needle: 25, near_ten: 25, dead_center: 25, clean_sweep: 25, one_shot_ten: 25,
  cartographer_10: 10, cartographer_30: 25, cartographer_60: 50, cartographer_90: 100,
  volume_one: 25, volume_two: 50, volume_three: 50, perfectionist: 100,
  event_horizon: 25, contrary_star: 25, binary_star: 25, first_gate: 10, double_gate: 25, gate_keeper: 25,
  persistence: 10, long_way_round: 25, comet_hunter: 25, apprentice: 10, self_reliant: 25,
  daily_3: 10, daily_7: 25, daily_30: 90, daily_perfect: 25, endless_5: 25, endless_10: 50
};
const missing = honours.filter(h => !(h.id in POINTS)).map(h => h.id);
if (missing.length) throw new Error('make-gamecenter: give these honours a points value: ' + missing.join(', '));
const total = honours.reduce((s, h) => s + POINTS[h.id], 0);
if (total > 1000 || honours.some(h => POINTS[h.id] > 100)) throw new Error('make-gamecenter: points exceed Game Center limits (total ' + total + ')');

const LEADERBOARDS = [
  { key: 'stars', name: 'Atlas Stars', unit: 'star / stars', range: '0 to 270', what: 'Total stars across the 90 plates of the Atlas.' },
  { key: 'endless', name: 'Endless Survey', unit: 'star / stars', range: '0 to 1,000,000', what: 'Best score in a single Endless Survey.' },
  { key: 'streak', name: 'Daily Streak', unit: 'day / days', range: '0 to 100,000', what: 'Longest run of consecutive Daily Plates.' }
];
const achId = id => CONFIG.prefix + CONFIG.achievements + id;
const lbId = key => CONFIG.prefix + CONFIG.leaderboards[key];

function roman(n) {
  const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = '';
  for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
  return s;
}

// ---- artwork: a brass observation seal on ink, in the manner of the game's "Observed" stamp ----
function seal(label, small) {
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const a = i * Math.PI * 2 / 72, r1 = 372, r2 = i % 6 === 0 ? 404 : 390;
    ticks.push(`M${(512 + Math.cos(a) * r1).toFixed(1)} ${(512 + Math.sin(a) * r1).toFixed(1)}L${(512 + Math.cos(a) * r2).toFixed(1)} ${(512 + Math.sin(a) * r2).toFixed(1)}`);
  }
  const size = label.length >= 6 ? 150 : label.length >= 4 ? 190 : 240;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#0E0D0B"/>
  <g fill="none" stroke="#C9A45C">
    <circle cx="512" cy="512" r="356" stroke-width="9"/>
    <circle cx="512" cy="512" r="328" stroke-width="3" stroke-opacity=".8"/>
    <circle cx="512" cy="512" r="226" stroke-width="2" stroke-opacity=".45" stroke-dasharray="2 12" stroke-linecap="round"/>
    <path d="${ticks.join('')}" stroke-width="4"/>
    <path d="M362 628H662M392 396H632" stroke-width="2.5" stroke-opacity=".7"/>
  </g>
  <text x="512" y="${512 + size * 0.32}" text-anchor="middle" font-family="Cormorant SC" font-weight="600" font-size="${size}" letter-spacing="${label.length > 1 ? 8 : 0}" fill="#EDE6D6">${label}</text>
  <text x="512" y="372" text-anchor="middle" font-family="Cormorant SC" font-weight="600" font-size="44" letter-spacing="14" fill="#C9A45C">${small}</text>
  <g fill="#C9A45C">${[-70, 0, 70].map(dx => `<path transform="translate(${512 + dx} 676) scale(1.5)" d="M0 -14L3.3 -4.5L13.3 -4.3L5.3 1.7L8.2 11.3L0 5.6L-8.2 11.3L-5.3 1.7L-13.3 -4.3L-3.3 -4.5Z"/>`).join('')}</g>
</svg>`;
}

(async () => {
  const { chromium } = require('playwright');
  const fonts = path.join(ROOT, 'ios-www', 'fonts');
  if (!fs.existsSync(fonts)) throw new Error('make-gamecenter: run `npm run build:ios` first (bundled fonts are needed)');
  const face = fs.readFileSync(path.join(fonts, 'cormorant-sc-latin-600-normal.woff2')).toString('base64');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'achievements'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'leaderboards'), { recursive: true });

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })).newPage();
  async function render(svg, file) {
    await page.setContent(`<style>@font-face{font-family:"Cormorant SC";font-weight:600;src:url(data:font/woff2;base64,${face}) format("woff2")}
      html,body{margin:0;background:#0E0D0B}svg{display:block}</style>${svg}`);
    await page.evaluate(() => document.fonts.load('600 100px "Cormorant SC"', 'HONOUR XIV'));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, omitBackground: false, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  }
  for (let i = 0; i < honours.length; i++) await render(seal(roman(i + 1), 'Honour'), path.join(OUT, 'achievements', honours[i].id + '.png'));
  const LB_MARK = { stars: 'XC', endless: '∞', streak: 'XXX' }, LB_SMALL = { stars: 'Atlas', endless: 'Survey', streak: 'Daily' };
  for (const lb of LEADERBOARDS) await render(seal(LB_MARK[lb.key], LB_SMALL[lb.key]), path.join(OUT, 'leaderboards', lb.key + '.png'));
  await browser.close();

  // ---- the setup sheet ----
  const esc = s => String(s).replace(/\|/g, '\\|');
  let md = `# Game Center setup for Perihelion

Generated by \`tools/make-gamecenter.js\` from the game's own honours list. Do not edit by hand.

Enter these in the Game Center section of your app in App Store Connect, then attach them to the app version before
you submit it. The IDs must match exactly: the app reports to these and nothing else. If you change the prefix
(\`CONFIG.prefix\` in \`src/native/ios-native.js\`), re-run the script and use the new IDs.

## Leaderboards (${LEADERBOARDS.length})

All three: **Classic** leaderboard, score format **Integer**, submission type **Best Score**, sort order **High to Low**.

| Leaderboard ID | Name | Score range | Unit (singular / plural) | What it ranks | Image (optional) |
|---|---|---|---|---|---|
`;
  for (const lb of LEADERBOARDS) md += `| \`${lbId(lb.key)}\` | ${lb.name} | ${lb.range} | ${lb.unit} | ${lb.what} | \`leaderboards/${lb.key}.png\` |\n`;
  md += `
## Achievements (${honours.length}, ${total} of 1000 points)

All: **Hidden: No**, **Achievable more than once: No**. Use the title for both the pre-earned and earned title. The
description works for both states too; the earned one can simply repeat it.

| # | Achievement ID | Title | Description | Points | Image |
|---|---|---|---|---|---|
`;
  honours.forEach((h, i) => { md += `| ${roman(i + 1)} | \`${achId(h.id)}\` | ${esc(h.name)} | ${esc(h.blurb)} | ${POINTS[h.id]} | \`achievements/${h.id}.png\` |\n`; });
  fs.writeFileSync(path.join(OUT, 'SETUP.md'), md);
  console.log(`wrote ios/game-center/SETUP.md, ${honours.length} achievement images, ${LEADERBOARDS.length} leaderboard images (${total} points)`);
})().catch(e => { console.error(e); process.exit(1); });
