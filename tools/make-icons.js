#!/usr/bin/env node
// Generates icons/icon-{180,192,512}.png from one SVG, in the game's palette (line art only, no fills except the
// probe). The PNGs are committed, so you only need this if you change the artwork. Needs `sharp` (devDependency).
// usage: node tools/make-icons.js
const fs = require('fs'), path = require('path');
const sharp = require('sharp');
const OUT = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const INK = '#0E0D0B', PAPER = '#EDE6D6', BRASS = '#C9A45C', VERM = '#E4572E';
// Everything sits inside a radius-190 circle around the centre so the artwork survives a maskable crop.
const ticks = [];
for (let i = 0; i < 40; i++) {
  const a = i * Math.PI * 2 / 40, r1 = 58, r2 = i % 5 === 0 ? 70 : 65;
  ticks.push(`M${(336 + Math.cos(a) * r1).toFixed(1)} ${(176 + Math.sin(a) * r1).toFixed(1)}L${(336 + Math.cos(a) * r2).toFixed(1)} ${(176 + Math.sin(a) * r2).toFixed(1)}`);
}
const hatchA = [], hatchB = [];
for (let k = -80; k <= 80; k += 11) hatchA.push(`M${210 - 80} ${310 + k + 80}L${210 + 80} ${310 + k - 80}`);
for (let k = -80; k <= 80; k += 11) hatchB.push(`M${210 - 80} ${310 + k + 85.5}L${210 + 80} ${310 + k - 74.5}`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${INK}"/>
  <g fill="none" stroke="${PAPER}">
    <circle cx="210" cy="310" r="104" stroke-opacity=".16" stroke-width="1.5"/>
    <circle cx="210" cy="310" r="142" stroke-opacity=".09" stroke-width="1.5"/>
  </g>
  <defs>
    <clipPath id="pl"><circle cx="210" cy="310" r="62"/></clipPath>
    <clipPath id="shade"><polygon points="130,420 300,220 300,420"/></clipPath>
  </defs>
  <g clip-path="url(#pl)" stroke="${PAPER}" stroke-width="2.2" fill="none">
    <path d="${hatchA.join('')}" stroke-opacity=".5"/>
    <g clip-path="url(#shade)"><path d="${hatchB.join('')}" stroke-opacity=".55"/></g>
  </g>
  <circle cx="210" cy="310" r="62" fill="none" stroke="${PAPER}" stroke-width="3.5"/>
  <g fill="none" stroke="${BRASS}">
    <circle cx="336" cy="176" r="54" stroke-width="3.5"/>
    <circle cx="336" cy="176" r="42" stroke-width="1.4" stroke-opacity=".8"/>
    <path d="${ticks.join('')}" stroke-width="1.8"/>
    <path d="M336 156V196M316 176H356" stroke-width="1.6" stroke-opacity=".9"/>
  </g>
  <path d="M132 392C248 420 370 352 330 232" fill="none" stroke="${VERM}" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="0.1 11"/>
  <polygon points="132,376 146,392 132,408 118,392" fill="${VERM}"/>
</svg>`;

(async () => {
  fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);
  for (const n of [180, 192, 512]) {
    await sharp(Buffer.from(svg)).resize(n, n).png({ compressionLevel: 9 }).toFile(path.join(OUT, `icon-${n}.png`));
    console.log('wrote icons/icon-' + n + '.png');
  }
})();
