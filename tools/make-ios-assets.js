#!/usr/bin/env node
// Generates the artwork the iOS project needs, from the same SVG as the web icons (icons/icon.svg):
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024 x 1024, no transparency (App Store rule)
//   ios/App/App/Assets.xcassets/Splash.imageset/*.png                   plain ink, so launch fades into the title screen
// The PNGs are committed; run this only if the icon artwork changes. Needs `sharp` (devDependency).
// usage: node tools/make-ios-assets.js
const fs = require('fs'), path = require('path');
const sharp = require('sharp');
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');
const INK = '#0E0D0B';

(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'icons', 'icon.svg'));
  await sharp(svg, { density: 144 }).resize(1024, 1024).flatten({ background: INK }).removeAlpha()
    .png({ compressionLevel: 9 }).toFile(path.join(ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'));

  const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: INK } })
    .png({ compressionLevel: 9, palette: true }).toBuffer();
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    fs.writeFileSync(path.join(ASSETS, 'Splash.imageset', f), splash);
  }
  const meta = await sharp(path.join(ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png')).metadata();
  console.log(`app icon ${meta.width}x${meta.height}, alpha: ${meta.hasAlpha}; splash ${(splash.length / 1024).toFixed(1)} KB x 3`);
})().catch(e => { console.error(e); process.exit(1); });
