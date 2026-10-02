#!/usr/bin/env node
// Build the page that ships inside the iOS app:  ios-www/index.html  (+ ios-www/fonts/).
//
// It is the same game as the web build (it runs tools/build.js first and starts from dist/perihelion.html), with three
// differences that matter for an App Store app:
//   1. Fonts are bundled. The Google Fonts <link>s are replaced by local @font-face rules, so the app makes no network
//      request at all and looks right on its very first launch with no connection.
//   2. No service worker and no web manifest. The files live in the app bundle; there is nothing to cache.
//   3. src/native/ios-native.js is added ahead of the game modules (haptics, save backup, Game Center, share).
//
// The web build is untouched: index.html and sw.js come out byte-for-byte the same with or without this script.
//
// usage: node tools/build-ios.js        then: npx cap sync ios     (npm run ios:sync does both)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'ios-www');

require('./build.js');                                           // refreshes dist/perihelion.html from src/
let html = fs.readFileSync(path.join(ROOT, 'dist', 'perihelion.html'), 'utf8');

function replaceOnce(s, find, put, what) {
  const parts = s.split(find);
  if (parts.length !== 2) throw new Error(`build-ios: expected exactly one ${what}, found ${parts.length - 1}`);
  return parts[0] + put + parts[1];
}

// ---- 1. fonts ------------------------------------------------------------------------------------------------------
// Exactly the faces the Google Fonts URL in src/shell.head.html asks for. Subsets: Latin and Latin Extended, plus Greek
// for the monospace (wormhole pair letters). The @font-face rules, with their unicode-ranges, come from the Fontsource
// packages, which repackage the same files Google serves.
const FACES = [
  { pkg: 'cormorant-garamond', files: ['500', '600', '500-italic'] },
  { pkg: 'cormorant-sc', files: ['500', '600', '700'] },
  { pkg: 'jetbrains-mono', files: ['400', '500'] }
];
const SUBSETS = ['latin', 'latin-ext', 'greek'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });

let fontCss = '', fontCount = 0, fontBytes = 0;
const licences = [];
for (const face of FACES) {
  const dir = path.join(ROOT, 'node_modules', '@fontsource', face.pkg);
  if (!fs.existsSync(dir)) throw new Error(`build-ios: @fontsource/${face.pkg} is not installed (run npm install)`);
  licences.push(`===== ${face.pkg} =====\n` + fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8').trim());
  for (const f of face.files) {
    const css = fs.readFileSync(path.join(dir, f + '.css'), 'utf8');
    const rules = css.match(/@font-face\s*\{[^}]*\}/g) || [];
    let kept = 0;
    for (const rule of rules) {
      const m = rule.match(/url\(\.\/files\/([a-z0-9-]+\.woff2)\)/);
      if (!m) throw new Error(`build-ios: no woff2 in a rule of ${face.pkg}/${f}.css`);
      const file = m[1];
      const subset = SUBSETS.find(s => file === `${face.pkg}-${s}-${f.includes('italic') ? f : f + '-normal'}.woff2`);
      if (!subset) continue;
      const src = path.join(dir, 'files', file);
      fs.copyFileSync(src, path.join(OUT, 'fonts', file));
      fontBytes += fs.statSync(src).size; fontCount++; kept++;
      fontCss += rule
        .replace(/src:[^;]*;/, `src: url(fonts/${file}) format('woff2');`)
        .replace(/font-display:\s*swap;/, 'font-display: block;')      // local files: no fallback flash
        .replace(/\s*\n\s*/g, ' ') + '\n';
    }
    if (!kept) throw new Error(`build-ios: no usable subset in ${face.pkg}/${f}.css`);
  }
}
fs.writeFileSync(path.join(OUT, 'fonts', 'LICENSES.txt'),
  'The fonts in this folder are distributed under the SIL Open Font License 1.1.\n\n' + licences.join('\n\n') + '\n');

const GOOGLE = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\n<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*">\n/;
if (!GOOGLE.test(html)) throw new Error('build-ios: the Google Fonts links in src/shell.head.html have changed; update tools/build-ios.js');
html = html.replace(GOOGLE, `<style>\n/* bundled fonts (tools/build-ios.js) */\n${fontCss}</style>\n`);

// ---- 2. web-app metadata that means nothing inside an app -----------------------------------------------------------
html = html.replace(/<meta name="(apple-mobile-web-app-capable|mobile-web-app-capable|apple-mobile-web-app-status-bar-style|apple-mobile-web-app-title)"[^>]*>\n/g, '');

// ---- 3. the native layer, ahead of the game modules ----------------------------------------------------------------
const native = fs.readFileSync(path.join(ROOT, 'src', 'native', 'ios-native.js'), 'utf8');
const OPEN = '<script>\n"use strict";\n';
html = replaceOnce(html, OPEN, `${OPEN}// ===================== MODULE: native/ios-native.js =====================\n${native}\n`, 'game <script>');

// ---- checks --------------------------------------------------------------------------------------------------------
const remote = html.match(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\/[^"'\s>]+/gi) || [];
if (remote.length) throw new Error('build-ios: the page still references a remote resource: ' + remote.join(', '));
if (/serviceWorker/.test(html)) throw new Error('build-ios: the page must not register a service worker');

fs.writeFileSync(path.join(OUT, 'index.html'), html);
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`built ios-www/index.html ${kb(Buffer.byteLength(html))}, ${fontCount} font files ${kb(fontBytes)}`);
