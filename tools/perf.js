#!/usr/bin/env node
// Frame-cost check: renders 150 mid-flight frames of a busy late plate with the CPU throttled 4x (a rough stand-in for
// an iPhone 12) and forces a pixel readback each frame so canvas raster time is included. Needs `npm install` and
// `npx playwright install chromium`. usage: node tools/perf.js
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(require('./qa-lib.js').launchOpts(chromium));
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'perihelion.html'));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (let run = 0; run < 3; run++) {
    const r = await p.evaluate(async () => {
      const P = window.__peri; P.loadLevel(26); P.solveCurrent();
      const g = document.getElementById('game').getContext('2d');
      const ts = [];
      for (let i = 0; i < 150; i++) {
        await new Promise(r => requestAnimationFrame(r));
        if (P.state.phase !== 'flight') { P.loadLevel(26); P.solveCurrent(); }
        const t0 = performance.now(); P.Render.frame(P.state, performance.now()); g.getImageData(0, 0, 1, 1); ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      return { avg: +(ts.reduce((a, b) => a + b) / ts.length).toFixed(2), p95: +ts[142].toFixed(2), max: +ts[149].toFixed(2) };
    });
    console.log('run', run + 1, 'ms per frame:', JSON.stringify(r));
  }
  await b.close();
})();
