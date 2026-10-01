#!/usr/bin/env node
/* PERIHELION — contact sheet of Volume III (owner: LEVEL AGENT; not shipped).
   Builds nothing itself: run  node tools/build.js  first. Opens dist/perihelion.html in Playwright (iPhone 14 emulation), draws plates 61..90
   with Render.drawThumbnail, and writes  qa/volume3-sheet.png  (as players see them) and  qa/volume3-routes.png  (the same plates with the stored
   solution in vermilion and the full-clear course in brass; wormhole jumps are not joined).
   usage: NODE_PATH=/home/claude/.npm-global/lib/node_modules node tools/levels-sheet.js [from=60 to=89] */
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), QA = path.join(ROOT, 'qa'); fs.mkdirSync(QA, { recursive: true });
const FROM = +(process.argv[2] || 60), TO = +(process.argv[3] || 89);
(async () => {
  const br = await chromium.launch(), ctx = await br.newContext({ ...devices['iPhone 14'] }), page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('file://' + path.join(ROOT, 'dist', 'perihelion.html')); await page.waitForFunction(() => window.__peri && window.__peri.Render);
  await page.evaluate(() => document.fonts.ready);
  for (const routes of [false, true]) {
    const url = await page.evaluate(([from, to, routes]) => {
      const P = window.__peri, Lv = P.Levels, R = P.Render, K = window.K || (P.state && null), cols = 6, cw = 150, ch = 300, n = to - from + 1, rows = Math.ceil(n / cols), dpr = 2;
      const cv = document.createElement('canvas'); cv.width = cols * cw * dpr; cv.height = (rows * ch + 40) * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
      c.fillStyle = '#0E0D0B'; c.fillRect(0, 0, cols * cw, rows * ch + 40);
      c.fillStyle = '#EDE6D6'; c.font = '14px "Cormorant SC", Georgia, serif'; c.textAlign = 'center';
      c.fillText('PERIHELION · VOLUME III · PLATES ' + (from + 1) + '–' + (to + 1) + (routes ? ' · solution (vermilion) and full clear (brass)' : ''), cols * cw / 2, 24);
      const buf = new Float32Array(2 * 1300);
      const path = (L, sol, col, w, dash, ox, oy, s) => {
        const sim = P.Physics.simulate(L, sol.vx, sol.vy, sol.t0Step | 0, 1200, buf); c.save(); c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash); c.beginPath();
        for (let i = 0; i < sim.n; i++) { const x = ox + buf[2 * i] * s, y = oy + buf[2 * i + 1] * s, jump = i && Math.hypot(buf[2 * i] - buf[2 * i - 2], buf[2 * i + 1] - buf[2 * i - 1]) > 40; if (!i || jump) c.moveTo(x, y); else c.lineTo(x, y); }
        c.stroke(); c.restore();
      };
      for (let i = from; i <= to; i++) {
        const L = Lv.CAMPAIGN[i], q = i - from, x0 = (q % cols) * cw, y0 = Math.floor(q / cols) * ch + 40;
        c.save(); c.translate(x0, y0); c.beginPath(); c.rect(0, 0, cw, ch); c.clip();
        R.drawThumbnail(c, L, cw, ch - 22);
        if (routes) {
          const s = Math.min((cw - 6) / 900, (ch - 22 - 6) / 1600), ox = (cw - 900 * s) / 2, oy = (ch - 22 - 1600 * s) / 2;
          path(L, L.solution, '#E4572E', 1.1, [], ox, oy, s); if (L.fragSolution) path(L, L.fragSolution, '#C9A45C', 0.9, [3, 2], ox, oy, s);
          c.fillStyle = '#C9A45C'; for (const f of L.frags) { c.beginPath(); c.arc(ox + f.x * s, oy + f.y * s, 2.2, 0, 7); c.fill(); }
        }
        c.fillStyle = '#EDE6D6'; c.textAlign = 'center'; const cap = L.plate + ' · ' + L.name.toUpperCase(); let fs = 13; do { c.font = fs-- + 'px "Cormorant SC", Georgia, serif'; } while (c.measureText(cap).width > cw - 6 && fs > 6); c.fillText(cap, cw / 2, ch - 6);
        c.restore();
      }
      return cv.toDataURL('image/png');
    }, [FROM, TO, routes]);
    const f = path.join(QA, routes ? 'volume3-routes.png' : 'volume3-sheet.png'); fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); console.log('wrote', f);
  }
  await br.close();
})().catch(e => { console.error(e); process.exit(1); });
