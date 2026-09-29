#!/usr/bin/env node
// Build: concatenates src/ into one self-contained page.
//
//   index.html                     GitHub Pages / installable build: standalone document + web manifest + service worker
//   sw.js                          service worker (cache version = hash of index.html)
//   dist/perihelion.html           plain standalone document (no service worker); what the tests load
//   dist/perihelion.artifact.html  fragment without doctype/html/head/body, for hosts that wrap the page themselves
//
// usage: node tools/build.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const S = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const ORDER = ['00-const.js', '10-physics.js', '20-levels.js', '30-render.js', '40-audio.js', '50-save.js', '60-main.js'];

const js = ORDER.map(f => `// ===================== MODULE: ${f} =====================\n` + S(f)).join('\n');
const head = S('shell.head.html'), body = S('shell.body.html');
const script = `<script>\n"use strict";\n${js}\n</script>\n`;

const artifact = `${head}\n<meta name="theme-color" content="#0E0D0B">\n${body}\n${script}`;
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Perihelion">
<meta name="theme-color" content="#0E0D0B">
${head}
</head>
<body>
${body}
${script}</body>
</html>
`;

// ---- installable site build -------------------------------------------------------------------------------
const headLinks = `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
`;
const register = `<script>
/* Offline support: only on http(s), never inside a host iframe. All URLs are relative so a project site under
   /<repo>/ works. */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.top === window.self) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
}
</script>
`;
const iHead = full.indexOf('</head>'), iBody = full.lastIndexOf('</body>');
if (iHead < 0 || iBody < 0) throw new Error('template markers not found');
const site = full.slice(0, iHead) + headLinks + full.slice(iHead, iBody) + register + full.slice(iBody);
const version = crypto.createHash('sha1').update(site).update(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'))).digest('hex').slice(0, 10);
const swSrc = fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8');
if (swSrc.split('__VERSION__').length !== 2) throw new Error('sw.template.js must contain the __VERSION__ placeholder exactly once');
const sw = swSrc.replace('__VERSION__', version);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'perihelion.html'), full);
fs.writeFileSync(path.join(ROOT, 'dist', 'perihelion.artifact.html'), artifact);
fs.writeFileSync(path.join(ROOT, 'index.html'), site);
fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);
const kb = s => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`built index.html ${kb(site)} (cache ${version}), sw.js, dist/perihelion.html ${kb(full)}, dist/perihelion.artifact.html ${kb(artifact)}`);
