/* PERIHELION — render (owner: RENDER AGENT).
   "Observatory Plate": a 19th-century engraved star-atlas plate on dark paper, drawn with modern precision.
   Canvas 2D only. Everything static is pre-rendered per level into device-resolution offscreen canvases
   (plate base, contour wells, orbit paths, hatched fixed bodies, caption); moving bodies and the target bezel are
   pre-rendered sprites. frame() = one layer blit + a few sprites + the dynamic line work + a small HUD.
   Palette: PAL tokens only (tone via alpha). No gradients except the paper grain; no glow, no shadows. */
var Render = (function () {
  var TAU = Math.PI * 2;
  // One light for the whole game: from the UPPER-LEFT, slightly toward the viewer.
  var LX = -0.5, LY = -0.62, LZ = 0.6;
  (function () { var m = Math.sqrt(LX * LX + LY * LY + LZ * LZ); LX /= m; LY /= m; LZ /= m; })();
  var SHADOW_ANG = Math.atan2(-LY, -LX);                       // screen angle of the shadow limb
  var HATCH_ANG = Math.atan2(LY, LX) + Math.PI / 2 + 0.3;       // main hatch direction (≈ across the light)
  var TH1 = [-1, 0.46, -1, 0.7, -1, 0.58, -1, 0.82];            // per-line threshold: half always drawn, rest add density in shadow
  var TH2 = [0.83, 0.91];                                       // cross-hatching: deepest shadow only
  var PHI0 = 50000;       // contour interval of the softened potential mu/sqrt(d²+eps²) — same for every level
  var SEAL_R = 34;        // CSS px

  var cv = null, ctx = null, LSP = false;
  // Layered mode: the static plate lives on a background canvas inserted behind the game canvas and is only
  // redrawn when the level / screen / size changes; the game canvas is cleared and carries only dynamic work.
  var bgCv = null, bgCtx = null, bgKey = '', bgShift = '', playGen = 0, titleGen = 0;
  var layout = { w: 1, h: 1, dpr: 1, scale: 1, plate: { x: 0, y: 0, w: 1, h: 1 },
                 top: { x: 0, y: 0, w: 1, h: 1 }, bottom: { x: 0, y: 0, w: 1, h: 1 },
                 safe: { top: 0, right: 0, bottom: 0, left: 0 } };
  var level = null;
  var fontsReady = false;
  var dirtyPlay = true, dirtyTitle = true, dirtyHud = true;
  var Lplate = null, Lplay = null, Ltitle = null, grainTile = null;
  var moving = [];                 // [{b, spr}] bodies on rails (sprites)
  var repulsors = [];              // fixed repulsors [{x,y,r}] (animated rings)
  var tgtSpr = null;
  var hudSpr = { launch: [null, null, null, null], star: [null, null, null], launchW: 70 };
  var titleSpr = [], titleMoonSpr = null;
  var fragTail = new Float32Array(8 * 2);     // per fragment: tail direction (cos, sin)
  var P = { x: 0, y: 0 };                      // scratch
  var DASH_NONE = [], DASH_A = [0, 0], DASH_B = [0, 0], DASH_C = [0, 0];
  var PCT = []; for (var pi = 0; pi <= 100; pi++) PCT.push(pi + '%');

  // ---------------------------------------------------------------- utilities
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function rng(seed) {
    var a = seed | 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutCubic(p) { p = clamp01(p); var q = 1 - p; return 1 - q * q * q; }
  function easeOutBack(p) { p = clamp01(p); var c1 = 1.70158, c3 = c1 + 1, q = p - 1; return 1 + c3 * q * q * q + c1 * q * q; }
  function fnt(style, px, fam) { return style + ' ' + px + 'px ' + fam; }
  function snap(v) { var d = layout.dpr; return (Math.round(v * d) + 0.5) / d; }   // crisp 1-device-px lines

  // Text with letter-spacing (canvas letterSpacing where supported, manual per-glyph otherwise). Pre-render only.
  function spacedWidth(g, str, sp) {
    if (LSP) { g.letterSpacing = sp + 'px'; var w = g.measureText(str).width - sp; g.letterSpacing = '0px'; return w; }
    var t = 0; for (var i = 0; i < str.length; i++) t += g.measureText(str[i]).width;
    return t + sp * (str.length - 1);
  }
  function spacedText(g, str, x, y, sp, align) {
    var w = spacedWidth(g, str, sp);
    var x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    g.textAlign = 'left';
    if (LSP) { g.letterSpacing = sp + 'px'; g.fillText(str, x0, y); g.letterSpacing = '0px'; return w; }
    for (var i = 0; i < str.length; i++) { g.fillText(str[i], x0, y); x0 += g.measureText(str[i]).width + sp; }
    return w;
  }

  function grain() {
    if (grainTile) return grainTile;
    var N = 192; grainTile = mk(N, N);
    var g = grainTile.getContext('2d'), im = g.createImageData(N, N), d = im.data, r = rng(1832);
    for (var i = 0; i < N * N; i++) {
      var v = r(), a = v * v * v * 20;                  // mostly nothing, occasional fibre speck
      if (r() < 0.012) a += 14;
      d[4 * i] = 237; d[4 * i + 1] = 230; d[4 * i + 2] = 214; d[4 * i + 3] = a | 0;
    }
    g.putImageData(im, 0, 0);
    return grainTile;
  }

  // ---------------------------------------------------------------- engraved line art (CSS-px units)
  // Lambert tone of a sphere, 0 = lit … 1 = full shadow; optional latitude bands for gas giants.
  function tone(nx, ny, o) {
    var r2 = nx * nx + ny * ny; if (r2 >= 1) return 1;
    var nz = Math.sqrt(1 - r2), lam = nx * LX + ny * LY + nz * LZ;
    var D = 1 - (lam > 0 ? lam : 0);
    if (o.bands) {
      var lat = ny + 0.12 * nx;
      D += o.bands * Math.sin(lat * o.bf + o.bp) * (0.55 + 0.45 * Math.sin(lat * o.bf * 0.37 + 1.1));
    }
    return D;
  }
  // Tonal hatching. On dark paper an ivory line ADDS light, so density and brightness are decoupled:
  // the shadow side gets denser (and cross-hatched) lines drawn progressively dimmer, the lit side sparse bright
  // ones — it reads as an engraving and still shows the light coming from the upper-left.
  var HB_A = [0.95, 0.62, 0.36, 0.2], hb = [[], [], [], []];
  function hatchSet(g, cx, cy, R, ang, sp, TH, o, cross) {
    var dx = Math.cos(ang), dy = Math.sin(ang), qx = -dy, qy = dx;
    var st = Math.max(0.3, Math.min(0.6, R / 24)), i = 0;
    hb[0].length = hb[1].length = hb[2].length = hb[3].length = 0;
    for (var off = -R + sp * 0.5; off < R; off += sp, i++) {
      var t = TH[i % TH.length], h = Math.sqrt(R * R - off * off) - 0.25;
      if (h <= 0) continue;
      var cur = -1, sx = 0, sy = 0;
      for (var u = -h; ; u += st) {
        var last = u >= h; if (last) u = h;
        var px = qx * off + dx * u, py = qy * off + dy * u, D = tone(px / R, py / R, o);
        var bk = D > t ? (D < 0.36 ? 0 : D < 0.6 ? 1 : D < 0.82 ? 2 : 3) : -1;
        if (bk !== cur || last) {
          if (cur >= 0) hb[cur].push(cx + sx, cy + sy, cx + px, cy + py);
          cur = bk; sx = px; sy = py;
        }
        if (last) break;
      }
    }
    for (var b = 0; b < 4; b++) {
      var a = hb[b]; if (!a.length) continue;
      g.globalAlpha = HB_A[b] * (cross ? 0.8 : 1); g.beginPath();
      for (var k = 0; k < a.length; k += 4) { g.moveTo(a[k], a[k + 1]); g.lineTo(a[k + 2], a[k + 3]); }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Hatched planet/moon: ink occluder, tonal hatching (+cross-hatch in deep shadow), hairline limb,
  // swelling bright rim on the lit (upper-left) limb.
  function hatchSphere(g, cx, cy, R, o) {
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(cx, cy, R + 0.6, 0, TAU); g.fill();
    g.strokeStyle = PAL.paper; g.lineCap = 'round';
    g.lineWidth = o.lw;
    hatchSet(g, cx, cy, R, HATCH_ANG + (o.rot || 0), o.sp, TH1, o, false);
    if (R > 3) { g.lineWidth = o.lw * 0.85; hatchSet(g, cx, cy, R, HATCH_ANG + (o.rot || 0) + 1.2, o.sp * 1.15, TH2, o, true); }
    g.globalAlpha = 0.55; g.lineWidth = Math.min(0.7, 0.35 + R * 0.03);
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    var LA = SHADOW_ANG + Math.PI, wmax = Math.min(1.9, 0.7 + R * 0.045), spans = [1.45, 1.0, 0.55];
    g.globalAlpha = 0.95;
    for (var k = 0; k < 3; k++) {
      var lw = g.lineWidth = 0.55 + (wmax - 0.55) * (k + 1) / 3;
      g.beginPath(); g.arc(cx, cy, R - lw / 2 + 0.3, LA - spans[k], LA + spans[k]); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
  }
  function sphereOpts(R, planet, seed) {
    var r = rng(seed * 7919 + 13), o = { sp: 1.45, lw: 0.55, bands: 0, bf: 0, bp: 0 };
    if (R < 9) { o.sp = 1.15; o.lw = 0.45; }
    else if (R < 16) { o.sp = 1.3; o.lw = 0.5; }
    o.rot = (r() - 0.5) * 0.5;
    if (planet && R >= 22 && r() < 0.5) { o.bands = 0.07; o.bf = 9 + 4 * r(); o.bp = r() * TAU; }
    return o;
  }
  // Black hole: converging logarithmic spiral hatching around a void; dashed vermilion capture circle.
  function drawBlackHole(g, x, y, R, C) {
    var O = C * 1.75, lnr = Math.log(O / (R * 1.28)), k = 1.35;
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(x, y, O + 1, 0, TAU); g.fill();
    var N = Math.max(12, Math.min(44, Math.round(O * 1.4)));
    var F = [0, 0.34, 0.7, 1], A = [0.22, 0.45, 0.62], W = [0.4, 0.45, 0.42];
    g.strokeStyle = PAL.paper; g.lineCap = 'round';
    for (var band = 0; band < 3; band++) {
      g.beginPath();
      for (var j = 0; j < N; j++) {
        if (band !== 1 && (j & 1)) continue;          // sparser at the rim and where the arms converge
        var th0 = j * TAU / N;
        for (var q = 0; q <= 10; q++) {
          var f = F[band] + (F[band + 1] - F[band]) * q / 10;
          var rho = O * Math.exp(-f * lnr), th = th0 + k * f * lnr;
          if (q === 0) g.moveTo(x + rho * Math.cos(th), y + rho * Math.sin(th));
          else g.lineTo(x + rho * Math.cos(th), y + rho * Math.sin(th));
        }
      }
      g.globalAlpha = A[band]; g.lineWidth = W[band]; g.stroke();
    }
    g.globalAlpha = 1; g.fillStyle = PAL.ink; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
    g.strokeStyle = PAL.paper; g.lineWidth = 0.9; g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
    g.globalAlpha = 0.45; g.lineWidth = 0.45; g.beginPath(); g.arc(x, y, R * 1.28, 0, TAU); g.stroke(); g.globalAlpha = 1;
    g.strokeStyle = PAL.a('vermilion', 0.5); g.lineWidth = 0.75; g.setLineDash([2.2, 2.4]);
    g.beginPath(); g.arc(x, y, C, 0, TAU); g.stroke(); g.setLineDash(DASH_NONE);
    g.lineCap = 'butt';
  }
  // Repulsor core: radiant engraved disc (the dashed outward rings are animated per frame).
  function drawRepulsor(g, x, y, R) {
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(x, y, R * 1.4, 0, TAU); g.fill();
    g.strokeStyle = PAL.paper; g.lineCap = 'round';
    var n = Math.max(12, Math.round(R * 2.2)), i, a;
    g.globalAlpha = 0.5; g.lineWidth = 0.45; g.beginPath();
    for (i = 0; i < n; i++) { a = i * TAU / n; g.moveTo(x + Math.cos(a) * R * 0.42, y + Math.sin(a) * R * 0.42); g.lineTo(x + Math.cos(a) * R * 0.93, y + Math.sin(a) * R * 0.93); }
    g.stroke();
    g.globalAlpha = 0.65; g.lineWidth = 0.55; g.beginPath();
    for (i = 0; i < 16; i++) { a = i * TAU / 16 + 0.1; var l = i & 1 ? 1.22 : 1.36; g.moveTo(x + Math.cos(a) * R * 1.1, y + Math.sin(a) * R * 1.1); g.lineTo(x + Math.cos(a) * R * l, y + Math.sin(a) * R * l); }
    g.stroke();
    g.globalAlpha = 0.95; g.lineWidth = 0.9; g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
    g.lineWidth = 0.6; g.beginPath(); g.arc(x, y, R * 0.36, 0, TAU); g.stroke();
    g.fillStyle = PAL.paper; g.beginPath(); g.arc(x, y, 0.9, 0, TAU); g.fill();
    g.globalAlpha = 1; g.lineCap = 'butt';
  }

  // ---------------------------------------------------------------- wormhole mouths
  // An engraved aperture of radius r (the real capture radius): hairline ring with a swelling rim on the lit limb, a dotted
  // halo, iris arms spiralling inward (counter-clockwise, unlike the black hole's dense clockwise funnel) and a small pupil.
  // Two knock-out broken rings turn in opposite directions above it (animated sprites). Pairs carry a Greek letter; the
  // twins also share the number of segments in their outer ring. Everything is paper on ink: no fill beyond hatching.
  var GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ'];
  var mouthPN = [];                 // body index -> pair number (0 = alpha), undefined for other bodies
  var wm = [];                      // the level's mouths: {i,b,moving,pn,letter,turn,bw,bh,lx,ly,sA,sB,lbl,kx,kd,kt0,kPend}
  var LIGHT_A = Math.atan2(LY, LX);
  var LBL_FONT = 'italic 600 17px ' + FONT.serif, NOTE_FONT = '600 8.6px ' + FONT.mono;
  function pairNumbers(lv) {
    var bs = lv.bodies, no = [], n = 0, i, j;
    for (i = 0; i < bs.length; i++) {
      if (bs[i].kind !== 'wormhole' || no[i] !== undefined) continue;
      no[i] = n; j = bs[i].pair;
      if (j >= 0 && j < bs.length && j !== i && bs[j] && bs[j].kind === 'wormhole' && no[j] === undefined) no[j] = n;
      n++;
    }
    return no;
  }
  function hasWormhole(lv) { var bs = lv && lv.bodies; if (bs) for (var i = 0; i < bs.length; i++) if (bs[i].kind === 'wormhole') return true; return false; }
  function drawMouth(g, x, y, R, pn) {
    var i, j, q, a, n;
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(x, y, R * 1.42, 0, TAU); g.fill();
    g.strokeStyle = PAL.paper; g.lineCap = 'round';
    // dotted halo
    n = Math.max(20, Math.round(TAU * R * 1.26 / 3.1));
    g.fillStyle = PAL.a('paper', 0.36); g.beginPath();
    for (i = 0; i < n; i++) { a = i * TAU / n; g.rect(x + R * 1.26 * Math.cos(a) - 0.3, y + R * 1.26 * Math.sin(a) - 0.3, 0.6, 0.6); }
    g.fill();
    var nb = (pn % 4) + 1;                                                            // pair signature: one to four beads on the halo
    g.fillStyle = PAL.ink; g.beginPath();
    for (i = 0; i < nb; i++) { a = -Math.PI / 2 + i * TAU / nb; g.moveTo(x + Math.cos(a) * R * 1.26 + 2.6, y + Math.sin(a) * R * 1.26); g.arc(x + Math.cos(a) * R * 1.26, y + Math.sin(a) * R * 1.26, 2.6, 0, TAU); }
    g.fill();
    g.fillStyle = PAL.paper; g.globalAlpha = 0.98; g.beginPath();
    for (i = 0; i < nb; i++) { a = -Math.PI / 2 + i * TAU / nb; g.moveTo(x + Math.cos(a) * R * 1.26 + 1.45, y + Math.sin(a) * R * 1.26); g.arc(x + Math.cos(a) * R * 1.26, y + Math.sin(a) * R * 1.26, 1.45, 0, TAU); }
    g.fill();
    g.globalAlpha = 0.55; g.lineWidth = 0.5; g.beginPath();                          // four bearing notches on the halo
    for (i = 0; i < 4; i++) { a = i * Math.PI / 2 + Math.PI / 4; g.moveTo(x + Math.cos(a) * R * 1.16, y + Math.sin(a) * R * 1.16); g.lineTo(x + Math.cos(a) * R * 1.36, y + Math.sin(a) * R * 1.36); }
    g.stroke();
    // iris arms: logarithmic spiral from 0.88R to 0.1R, turning counter-clockwise inward; tone by the light from the upper left
    var N = Math.max(10, Math.min(20, Math.round(R * 0.95))), SEG = 9, k = 1.75, r1 = R * 0.88, r0 = R * 0.1, ratio = r0 / r1;
    hb[0].length = hb[1].length = hb[2].length = hb[3].length = 0;
    for (j = 0; j < N; j++) {
      var th0 = j * TAU / N, px = 0, py = 0;
      for (q = 0; q <= SEG; q++) {
        var f = q / SEG, rho = r1 * Math.pow(ratio, f), th = th0 - k * f, cx = x + rho * Math.cos(th), cy = y + rho * Math.sin(th);
        if (q) {
          var m = th + k / SEG * 0.5, lit = 0.5 + 0.5 * Math.cos(m - LIGHT_A);             // 1 toward the light
          var bk = lit > 0.8 ? 0 : lit > 0.55 ? 1 : lit > 0.3 ? 2 : 3;
          hb[bk].push(px, py, cx, cy);
        }
        px = cx; py = cy;
      }
    }
    var HA = [0.85, 0.6, 0.4, 0.26];
    g.lineWidth = Math.max(0.35, Math.min(0.5, R * 0.03));
    for (q = 0; q < 4; q++) {
      var ar = hb[q]; if (!ar.length) continue;
      g.globalAlpha = HA[q]; g.beginPath();
      for (i = 0; i < ar.length; i += 4) { g.moveTo(ar[i], ar[i + 1]); g.lineTo(ar[i + 2], ar[i + 3]); }
      g.stroke();
    }
    // pupil
    g.globalAlpha = 1; g.fillStyle = PAL.ink; g.beginPath(); g.arc(x, y, R * 0.17, 0, TAU); g.fill();
    g.globalAlpha = 0.85; g.lineWidth = 0.5; g.beginPath(); g.arc(x, y, R * 0.17, 0, TAU); g.stroke();
    g.globalAlpha = 1; g.fillStyle = PAL.paper; g.beginPath(); g.arc(x, y, 0.7, 0, TAU); g.fill();
    // outer hairline ring, with a swelling bright rim on the lit (upper-left) limb
    g.globalAlpha = 0.95; g.lineWidth = Math.min(0.9, 0.55 + R * 0.02); g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
    var LA = SHADOW_ANG + Math.PI, spans = [1.35, 0.9, 0.45], wmax = Math.min(1.7, 0.8 + R * 0.04);
    for (k = 0; k < 3; k++) {
      g.lineWidth = 0.55 + (wmax - 0.55) * (k + 1) / 3; g.beginPath(); g.arc(x, y, R - g.lineWidth / 2 + 0.3, LA - spans[k], LA + spans[k]); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
  }
  // One of the two turning rings as a sprite (sideA = outer ring, else inner). Arcs are knocked out of the iris with ink.
  function drawMouthRing(g, x, y, R, pn, sideA) {
    var rad = R * (sideA ? 0.7 : 0.44), n = sideA ? 2 + (pn % 4) : 3, i, a0, len, gap = sideA ? 0.5 : 0.62, seg = TAU / n;
    g.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? PAL.paper : PAL.ink; g.lineWidth = pass ? (sideA ? 1 : 0.8) : (sideA ? 3 : 2.4); g.globalAlpha = pass ? (sideA ? 0.92 : 0.78) : 1;
      g.beginPath();
      for (i = 0; i < n; i++) {
        len = sideA ? seg - gap : seg * (i === 0 ? 0.62 : i === 1 ? 0.4 : 0.26);
        a0 = i * seg + (sideA ? 0 : 0.4);
        g.moveTo(x + rad * Math.cos(a0), y + rad * Math.sin(a0)); g.arc(x, y, rad, a0, a0 + len);
      }
      g.stroke();
    }
    g.globalAlpha = 0.85; g.lineWidth = 0.5; g.beginPath();                        // a tick at each arc start so the turning reads
    for (i = 0; i < n; i++) {
      a0 = i * seg + (sideA ? 0 : 0.4);
      g.moveTo(x + (rad - 2.3) * Math.cos(a0), y + (rad - 2.3) * Math.sin(a0)); g.lineTo(x + (rad + 2.3) * Math.cos(a0), y + (rad + 2.3) * Math.sin(a0));
    }
    g.stroke(); g.globalAlpha = 1; g.lineCap = 'butt';
  }
  // Pair mark: italic Greek letter, and under it the turn note (a drawn circular arrow plus the angle) when the mouth turns you.
  function labelBox(turn) { var t = Math.abs(turn) > 0.01; return { w: t ? 14 + 5.3 * (String(turnDeg(turn)).length + 1) : 18, h: t ? 29 : 18 }; }
  function turnDeg(turn) { return Math.round(Math.abs(turn) * 180 / Math.PI); }
  function drawMouthLabel(g, cx, cy, letter, turn) {
    var has = Math.abs(turn) > 0.01, ly = has ? cy - 8 : cy;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.font = LBL_FONT; g.strokeStyle = PAL.ink; g.lineWidth = 3.6; g.strokeText(letter, cx, ly);
    g.fillStyle = PAL.paper; g.fillText(letter, cx, ly);
    if (has) {
      var txt = turnDeg(turn) + '°', ny = cy + 8.6;
      g.font = NOTE_FONT; g.textAlign = 'left';
      var w = g.measureText(txt).width, tot = 12.6 + w, x0 = cx - tot / 2, ax = x0 + 5, sg = turn > 0 ? 1 : -1, r = 4.2;
      var st = -Math.PI / 2 + sg * 0.55, en = st + sg * (TAU - 1.45);
      g.strokeStyle = PAL.ink; g.lineWidth = 3; g.strokeText(txt, x0 + 12.6, ny);
      g.fillStyle = PAL.a('paper', 0.92); g.fillText(txt, x0 + 12.6, ny);
      var ex = ax + r * Math.cos(en), ey = ny + r * Math.sin(en), tx = -sg * Math.sin(en), ty = sg * Math.cos(en);
      g.strokeStyle = PAL.ink; g.lineWidth = 3.4; g.lineCap = 'round'; g.beginPath(); g.arc(ax, ny, r, st, en, sg < 0); g.stroke();
      g.strokeStyle = PAL.paper; g.lineWidth = 1.35; g.beginPath(); g.arc(ax, ny, r, st, en, sg < 0); g.stroke();
      g.fillStyle = PAL.paper; g.beginPath();
      g.moveTo(ex + tx * 4.2, ey + ty * 4.2); g.lineTo(ex - ty * 2.7 - tx * 0.6, ey + tx * 2.7 - ty * 0.6); g.lineTo(ex + ty * 2.7 - tx * 0.6, ey - tx * 2.7 - ty * 0.6); g.closePath(); g.fill();
      g.lineCap = 'butt';
    }
    g.textBaseline = 'alphabetic'; g.lineJoin = 'miter';
  }
  // Label placement (CSS px, plate-local): the box closest to the mouth that clears the ring, every other body (over the
  // whole orbit when the mouth rides rails), the target, the launch station and aim ring, the fragments, earlier labels and
  // the plate border. Returns the offset of the box centre from the mouth centre.
  function placeLabel(lv, bi, bw, bh, done, path) {
    var bs = lv.bodies, b = bs[bi], s = layout.scale, Pl = layout.plate, R = b.r * s, nS = 1, dT = 0, i, k, c;
    if (b.orbit && b.orbit.omega) { nS = 24; dT = TAU / Math.abs(b.orbit.omega) / nS; }
    var pos = [];
    for (k = 0; k < nS; k++) { var row = new Float32Array(bs.length * 2); for (i = 0; i < bs.length; i++) { Physics.bodyPos(bs[i], k * dT, P); row[2 * i] = P.x * s; row[2 * i + 1] = P.y * s; } pos.push(row); }
    var fr = lv.frags || [], tg = lv.target, pw = Pl.w, ph = Pl.h, mg = 9;
    var pr = Math.max(K.DRAG_CANCEL * s + 4, 14), tr = tg.r * s + 8, best = 1e18, bdx = R * 2, bdy = 0, hw = bw / 2, hh = bh / 2;
    function circ(cx, cy, x, y, r, w) {
      var ex = Math.abs(cx - x) - hw, ey = Math.abs(cy - y) - hh; ex = ex > 0 ? ex : 0; ey = ey > 0 ? ey : 0;
      var ov = r - Math.sqrt(ex * ex + ey * ey); return ov > 0 ? w * (ov + 2) : 0;
    }
    for (c = 0; c < 32; c++) {
      var th = (c & 15) * Math.PI / 8, dx = Math.cos(th), dy = Math.sin(th), extra = c < 16 ? 0 : 10;
      var d = R * 1.26 + 4.5 + Math.abs(dx) * hw + Math.abs(dy) * hh + extra;
      var pen = 0.5 * Math.abs(Math.atan2(Math.sin(th + 0.6), Math.cos(th + 0.6))) + extra * 0.3, worst = 0;
      for (k = 0; k < nS; k++) {
        var row2 = pos[k], cx = row2[2 * bi] + dx * d, cy = row2[2 * bi + 1] + dy * d, p = 0, j;
        var ov = Math.max(0, mg - (cx - hw)) + Math.max(0, cx + hw - (pw - mg)) + Math.max(0, mg - (cy - hh)) + Math.max(0, cy + hh - (ph - mg));
        p += ov * 60;
        for (j = 0; j < bs.length; j++) {
          if (j === bi) continue;
          var o = bs[j], ox = row2[2 * j], oy = row2[2 * j + 1];
          if (o.kind === 'blackhole') p += circ(cx, cy, ox, oy, (o.capture || o.r * 3) * s * 1.8, 20);
          else if (o.kind === 'repulsor') { p += circ(cx, cy, ox, oy, o.r * s * 1.5, 20); p += circ(cx, cy, ox, oy, o.r * s * 3.3, 1.5); }
          else if (o.kind === 'wormhole') p += circ(cx, cy, ox, oy, o.r * s * 1.5 + 2, 30);
          else p += circ(cx, cy, ox, oy, o.r * s + 3, 20);
        }
        p += circ(cx, cy, tg.x * s, tg.y * s, tr, 30) + circ(cx, cy, lv.probe.x * s, lv.probe.y * s, pr, 15);
        for (j = 0; j < fr.length; j++) p += circ(cx, cy, fr[j].x * s, fr[j].y * s, 15, 20);
        if (path && !b.orbit) {                          // the stored winning course: keep the box off it
          var hx = hw + 4, hy = hh + 4;
          for (j = 0; j < path.length; j += 2) if (Math.abs(path[j] - cx) < hx && Math.abs(path[j + 1] - cy) < hy) p += 6;
        }
        for (j = 0; j < done.length; j++) {
          var q = done[j], qx = Math.abs(cx - q.x) - bw / 2 - q.w / 2 - 2, qy = Math.abs(cy - q.y) - bh / 2 - q.h / 2 - 2;
          if (qx < 0 && qy < 0) p += 40 * (1 - Math.max(qx, qy));
        }
        if (p > worst) worst = p; pen += p / nS;
      }
      pen += worst;
      if (pen < best - 1e-6) { best = pen; bdx = dx * d; bdy = dy * d; }
    }
    return { x: bdx, y: bdy };
  }
  // Called at the start of paintLevel: pair numbers, label sizes and placements for this level at this scale.
  function prepMouths(lv) {
    var bs = lv.bodies, done = [], i, path = null;
    mouthPN = pairNumbers(lv); wm.length = 0;
    if (lv.solution && hasWormhole(lv)) {
      try {
        var sol = lv.solution, buf = new Float32Array(K.MAX_STEPS * 2 + 4), sm = Physics.simulate(lv, sol.vx, sol.vy, sol.t0Step || 0, K.MAX_STEPS, buf), sc = layout.scale;
        path = []; for (i = 0; i < sm.n; i += 2) path.push(buf[2 * i] * sc, buf[2 * i + 1] * sc);
      } catch (e) { path = null; }
    }
    for (i = 0; i < bs.length; i++) {
      var b = bs[i]; if (b.kind !== 'wormhole') continue;
      var pn = mouthPN[i] | 0, turn = b.turn || 0, bx = labelBox(turn), off = placeLabel(lv, i, bx.w, bx.h, done, path);
      var m = { i: i, b: b, moving: !!b.orbit, pn: pn, letter: GREEK[pn % GREEK.length], turn: turn, bw: bx.w, bh: bx.h, lx: off.x, ly: off.y,
                sA: null, sB: null, lbl: null, kx: 0, kd: 0, kt0: -1e9, kPend: false };
      if (!m.moving) done.push({ x: b.x * layout.scale + off.x, y: b.y * layout.scale + off.y, w: bx.w, h: bx.h });
      wm.push(m);
    }
  }
  function buildMouthSprites(lv) {
    var s = layout.scale, d = layout.dpr;
    for (var i = 0; i < wm.length; i++) {
      (function (m) {
        var R = m.b.r * s;
        m.sA = makeSprite(R * 0.78 + 2, function (g, c) { drawMouthRing(g, c, c, R, m.pn, true); });
        m.sB = makeSprite(R * 0.78 + 2, function (g, c) { drawMouthRing(g, c, c, R, m.pn, false); });
        m.lbl = null;
        if (m.moving) {
          var w = Math.ceil(m.bw + 6), h = Math.ceil(m.bh + 6), c = mk(w * d, h * d), g = c.getContext('2d');
          g.setTransform(d, 0, 0, d, 0, 0); drawMouthLabel(g, w / 2, h / 2, m.letter, m.turn);
          m.lbl = { c: c, w: w, h: h };
        }
      })(wm[i]);
    }
  }

  function drawBodyArt(g, b, bi, x, y, s, seed) {
    var R = b.r * s;
    if (b.kind === 'blackhole') drawBlackHole(g, x, y, R, (b.capture || b.r * 3) * s);
    else if (b.kind === 'repulsor') drawRepulsor(g, x, y, R);
    else if (b.kind === 'wormhole') drawMouth(g, x, y, R, mouthPN[bi] | 0);
    else hatchSphere(g, x, y, R, sphereOpts(R, b.kind !== 'moon', (seed | 0) + bi * 31));
  }
  function bodyExtent(b) { return b.kind === 'blackhole' ? (b.capture || b.r * 3) * 1.8 : b.kind === 'repulsor' ? b.r * 1.45 : b.kind === 'wormhole' ? b.r * 1.4 : b.r + 2; }
  function makeSprite(radCss, fn) {
    var d = layout.dpr, size = Math.ceil((radCss * 2 + 4) * d), c = mk(size, size), g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    fn(g, size / (2 * d));
    return { c: c, h: size / 2 };
  }
  function starPath(g, x, y, R) {
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, r = i & 1 ? R * 0.42 : R;
      if (i) g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else g.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    g.closePath();
  }
  // mode 0 = spent (faint), 1 = potential (paper outline), 2 = earned (brass, engraved fill)
  function drawStar(g, x, y, R, mode) {
    g.lineJoin = 'round';
    if (mode === 2) {
      g.save(); starPath(g, x, y, R); g.clip();
      g.strokeStyle = PAL.brass; g.lineWidth = 0.5; g.globalAlpha = 0.9; g.beginPath();
      for (var o = -R * 1.5; o < R * 1.5; o += 1.25) { g.moveTo(x + o - R, y - R); g.lineTo(x + o + R, y + R); }
      g.stroke(); g.restore();
      g.globalAlpha = 1; g.strokeStyle = PAL.brass; g.lineWidth = 0.85; starPath(g, x, y, R); g.stroke();
    } else {
      g.strokeStyle = mode ? PAL.a('paper', 0.6) : PAL.a('paper', 0.17); g.lineWidth = 0.7;
      starPath(g, x, y, R); g.stroke();
    }
    g.globalAlpha = 1; g.lineJoin = 'miter';
  }

  // ---------------------------------------------------------------- plate base (grain, grid, neatline, stars)
  function ensureLayer(c) {
    var W = cv.width, H = cv.height;
    if (!c) return mk(W, H);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }
  function paintPlateBase(g, seed, lv) {
    var d = layout.dpr, Pl = layout.plate, s = layout.scale, i, x, y;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = PAL.ink; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.fillStyle = g.createPattern(grain(), 'repeat'); g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = PAL.a('paper', 0.014); g.fillRect(Pl.x, Pl.y, Pl.w, Pl.h);      // the plate impression

    // coordinate grid (graphite)
    g.strokeStyle = PAL.graphite; g.lineWidth = 1 / d; g.beginPath();
    for (i = 100; i < K.WORLD_W; i += 100) { x = snap(Pl.x + i * s); g.moveTo(x, Pl.y + 4); g.lineTo(x, Pl.y + Pl.h - 4); }
    for (i = 100; i < K.WORLD_H; i += 100) { y = snap(Pl.y + i * s); g.moveTo(Pl.x + 4, y); g.lineTo(Pl.x + Pl.w - 4, y); }
    g.stroke();
    g.strokeStyle = PAL.a('paper', 0.05); g.beginPath();                      // meridian & equator, a touch stronger
    x = snap(Pl.x + 450 * s); g.moveTo(x, Pl.y + 4); g.lineTo(x, Pl.y + Pl.h - 4);
    y = snap(Pl.y + 800 * s); g.moveTo(Pl.x + 4, y); g.lineTo(Pl.x + Pl.w - 4, y);
    g.stroke();

    // neatline: outer rule = plate edge, inner hairline inset 4 px, graduated ticks between
    var ins = 4;
    g.strokeStyle = PAL.a('paper', 0.6); g.lineWidth = 0.9;
    g.strokeRect(Pl.x + 0.45, Pl.y + 0.45, Pl.w - 0.9, Pl.h - 0.9);
    g.strokeStyle = PAL.a('paper', 0.42); g.lineWidth = 1 / d;
    g.strokeRect(snap(Pl.x + ins), snap(Pl.y + ins), Math.round((Pl.w - 2 * ins) * d) / d, Math.round((Pl.h - 2 * ins) * d) / d);
    g.strokeStyle = PAL.a('paper', 0.38); g.beginPath();
    for (i = 20; i < K.WORLD_W; i += 20) {
      x = snap(Pl.x + i * s); var l = i % 100 === 0 ? ins : 1.7;
      g.moveTo(x, Pl.y); g.lineTo(x, Pl.y + l); g.moveTo(x, Pl.y + Pl.h); g.lineTo(x, Pl.y + Pl.h - l);
    }
    for (i = 20; i < K.WORLD_H; i += 20) {
      y = snap(Pl.y + i * s); var l2 = i % 100 === 0 ? ins : 1.7;
      g.moveTo(Pl.x, y); g.lineTo(Pl.x + l2, y); g.moveTo(Pl.x + Pl.w, y); g.lineTo(Pl.x + Pl.w - l2, y);
    }
    g.stroke();

    // degree labels: right ascension above the plate, declination inside the side margins
    var r = rng(seed * 131 + 7), h0 = Math.floor(r() * 24), m0 = Math.floor(r() * 6) * 10, d0 = Math.floor(8 + r() * 56);
    g.fillStyle = PAL.a('paper', 0.34); g.font = fnt('400', 6, FONT.mono); g.textBaseline = 'alphabetic';
    g.textAlign = 'center';
    var raStep = 100 * Math.max(1, Math.ceil(34 / (100 * s))), decStep = 200 * Math.max(1, Math.ceil(24 / (200 * s)));
    for (i = raStep; i < K.WORLD_W; i += raStep) {
      var mins = h0 * 60 + m0 + (i / 100) * 10, hh = Math.floor(mins / 60) % 24, mm = mins % 60;
      g.fillText(hh + 'h' + (mm < 10 ? '0' : '') + mm + 'm', Pl.x + i * s, Pl.y - 4);
    }
    for (i = decStep; i < K.WORLD_H; i += decStep) {
      var dec = d0 + (8 - i / 100) * 2, lab = (dec >= 0 ? '+' : '−') + Math.abs(dec) + '°';
      y = Pl.y + i * s - 2.5;
      g.textAlign = 'left'; g.fillText(lab, Pl.x + ins + 2.5, y);
      g.textAlign = 'right'; g.fillText(lab, Pl.x + Pl.w - ins - 2.5, y);
    }

    // star field: sparse engraved crosses, deterministic from the seed
    var rs = rng(seed * 9973 + 17), n = 70;
    g.strokeStyle = PAL.paper; g.fillStyle = PAL.paper; g.lineCap = 'butt';
    for (i = 0; i < n; i++) {
      var wx = 14 + rs() * (K.WORLD_W - 28), wy = 14 + rs() * (K.WORLD_H - 28), m = rs(), al = rs();
      if (lv && !clearOfLevel(lv, wx, wy)) continue;
      x = Pl.x + wx * s; y = Pl.y + wy * s;
      var arm, a;
      if (m < 0.7) { arm = 1.2; a = 0.22 + 0.2 * al; g.lineWidth = 0.45; }
      else if (m < 0.93) { arm = 2.1; a = 0.42 + 0.2 * al; g.lineWidth = 0.5; }
      else { arm = 3.4; a = 0.62 + 0.2 * al; g.lineWidth = 0.55; }
      g.globalAlpha = a; g.beginPath();
      g.moveTo(x - arm, y); g.lineTo(x + arm, y); g.moveTo(x, y - arm); g.lineTo(x, y + arm);
      g.stroke();
      if (m >= 0.93) { g.lineWidth = 0.45; g.beginPath(); g.arc(x, y, 1.25, 0, TAU); g.stroke(); }
      else if (m >= 0.7) { g.beginPath(); g.arc(x, y, 0.45, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 0.14; g.beginPath();                                   // faint dust of unresolved stars
    for (i = 0; i < 140; i++) {
      var ux = 10 + rs() * (K.WORLD_W - 20), uy = 10 + rs() * (K.WORLD_H - 20);
      g.rect(Pl.x + ux * s, Pl.y + uy * s, 0.55, 0.55);
    }
    g.fill();
    g.globalAlpha = 1;
  }
  function clearOfLevel(lv, x, y) {
    function far(px, py, r) { var dx = px - x, dy = py - y; return dx * dx + dy * dy > r * r; }
    if (!far(lv.probe.x, lv.probe.y, 70) || !far(lv.target.x, lv.target.y, lv.target.r + 60)) return false;
    var fr = lv.frags || [];
    for (var i = 0; i < fr.length; i++) if (!far(fr[i].x, fr[i].y, 40)) return false;
    return true;
  }

  // ---------------------------------------------------------------- contour wells (marching squares)
  function paintContours(g, lv) {
    var bs = lv.bodies, fixed = [], i, j;
    for (i = 0; i < bs.length; i++) if (!bs[i].orbit) fixed.push(bs[i]);
    var anyAttr = false; for (i = 0; i < fixed.length; i++) if (fixed[i].mu > 0) anyAttr = true;
    if (!anyAttr) return;
    var d = layout.dpr, Pl = layout.plate, s = layout.scale;
    var cell = 5, nx = Math.ceil(K.WORLD_W / cell), ny = Math.ceil(K.WORLD_H / cell), W1 = nx + 1;
    var F = new Float32Array(W1 * (ny + 1));
    for (j = 0; j <= ny; j++) for (i = 0; i <= nx; i++) {
      var x = i * cell, y = j * cell, v = 0;
      for (var b = 0; b < fixed.length; b++) {
        var dx = fixed[b].x - x, dy = fixed[b].y - y;
        v += fixed[b].mu / Math.sqrt(dx * dx + dy * dy + K.EPS2);
      }
      F[j * W1 + i] = v;
    }
    var segs = [[], [], []];      // 0 outer (faint), 1 regular, 2 index contours
    function add(k, x1, y1, x2, y2) { var a = segs[k === 1 ? 0 : k % 4 === 0 ? 2 : 1]; a.push(x1, y1, x2, y2); }
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var ta = F[j * W1 + i], tb = F[j * W1 + i + 1], tc = F[(j + 1) * W1 + i + 1], td = F[(j + 1) * W1 + i];
      var mn = Math.min(ta, tb, tc, td), mx = Math.max(ta, tb, tc, td);
      var k0 = Math.max(1, Math.ceil(mn / PHI0)), k1 = Math.min(60, Math.floor(mx / PHI0));
      if (k0 > k1) continue;
      var x0 = i * cell, y0 = j * cell;
      for (var k = k0; k <= k1; k++) {
        var L = k * PHI0, c = (ta > L ? 8 : 0) | (tb > L ? 4 : 0) | (tc > L ? 2 : 0) | (td > L ? 1 : 0);
        if (c === 0 || c === 15) continue;
        var Tx = x0 + cell * (L - ta) / (tb - ta), Ry = y0 + cell * (L - tb) / (tc - tb);
        var Bx = x0 + cell * (L - td) / (tc - td), Ly = y0 + cell * (L - ta) / (td - ta);
        var X1 = x0 + cell, Y1 = y0 + cell;
        switch (c) {
          case 1: case 14: add(k, x0, Ly, Bx, Y1); break;
          case 2: case 13: add(k, Bx, Y1, X1, Ry); break;
          case 3: case 12: add(k, x0, Ly, X1, Ry); break;
          case 4: case 11: add(k, Tx, y0, X1, Ry); break;
          case 6: case 9: add(k, Tx, y0, Bx, Y1); break;
          case 7: case 8: add(k, x0, Ly, Tx, y0); break;
          case 5: add(k, x0, Ly, Tx, y0); add(k, Bx, Y1, X1, Ry); break;
          case 10: add(k, Tx, y0, X1, Ry); add(k, x0, Ly, Bx, Y1); break;
        }
      }
    }
    // draw into a scratch layer so the halo around each body can be erased cleanly
    var tmp = mk(g.canvas.width, g.canvas.height), t = tmp.getContext('2d');
    t.setTransform(d * s, 0, 0, d * s, d * Pl.x, d * Pl.y);
    t.strokeStyle = PAL.paper; t.lineCap = 'round';
    var AL = [0.075, 0.12, 0.2], LW = [0.5, 0.55, 0.7];
    for (var q = 0; q < 3; q++) {
      var a = segs[q]; if (!a.length) continue;
      t.globalAlpha = AL[q]; t.lineWidth = LW[q] / s; t.beginPath();
      for (i = 0; i < a.length; i += 4) { t.moveTo(a[i], a[i + 1]); t.lineTo(a[i + 2], a[i + 3]); }
      t.stroke();
    }
    t.globalAlpha = 1; t.globalCompositeOperation = 'destination-out'; t.fillStyle = '#000';
    for (i = 0; i < fixed.length; i++) {
      var fb = fixed[i], mr;
      if (fb.mu > 0) {
        mr = Math.max(fb.r * 1.25 + 4 / s, Math.sqrt(3 * fb.mu / (PHI0 * s)));   // keep ring spacing ≥ ~3 px
        if (fb.kind === 'blackhole') mr = Math.max(mr, (fb.capture || fb.r * 3) * 1.85);
      } else mr = fb.r * 1.6;
      t.beginPath(); t.arc(fb.x, fb.y, mr, 0, TAU); t.fill();
    }
    t.globalCompositeOperation = 'source-over';
    // clip to the inner neatline
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'destination-in';
    t.fillRect(Math.round((Pl.x + 5) * d), Math.round((Pl.y + 5) * d), Math.round((Pl.w - 10) * d), Math.round((Pl.h - 10) * d));
    t.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(tmp, 0, 0);
  }

  // ---------------------------------------------------------------- per-level layer & sprites
  function paintLevel(g, lv) {
    var d = layout.dpr, Pl = layout.plate, s = layout.scale, bs = lv.bodies, i, j;
    prepMouths(lv);
    paintContours(g, lv);
    g.setTransform(d, 0, 0, d, 0, 0);
    // orbit paths (dotted) and barycentre crosses
    var seen = [];
    for (i = 0; i < bs.length; i++) {
      var o = bs[i].orbit; if (!o) continue;
      var dup = false;
      for (j = 0; j < seen.length; j++) if (Math.abs(seen[j].cx - o.cx) < 1 && Math.abs(seen[j].cy - o.cy) < 1 && Math.abs(seen[j].rad - o.rad) < 1) dup = true;
      if (dup) continue; seen.push(o);
      var cx = Pl.x + o.cx * s, cy = Pl.y + o.cy * s, R = o.rad * s, n = Math.max(24, Math.round(TAU * R / 3.4));
      g.fillStyle = PAL.a('paper', (bs[i].pair !== undefined && bs[i].kind !== 'wormhole') || bs[i].kind === 'planet' ? 0.34 : 0.3);
      g.beginPath();
      for (j = 0; j < n; j++) { var a = j * TAU / n; g.moveTo(cx + R * Math.cos(a) + 0.55, cy + R * Math.sin(a)); g.arc(cx + R * Math.cos(a), cy + R * Math.sin(a), 0.55, 0, TAU); }
      g.fill();
    }
    for (i = 0; i < bs.length; i++) {
      var ob = bs[i].orbit;
      if (!ob || ((bs[i].pair === undefined || bs[i].kind === 'wormhole') && !isOrbitCentreEmpty(lv, ob))) continue;
      var bx = Pl.x + ob.cx * s, by = Pl.y + ob.cy * s;
      g.strokeStyle = PAL.a('paper', 0.55); g.lineWidth = 0.6; g.beginPath();
      g.moveTo(bx - 3.2, by); g.lineTo(bx + 3.2, by); g.moveTo(bx, by - 3.2); g.lineTo(bx, by + 3.2); g.stroke();
      g.lineWidth = 0.45; g.beginPath(); g.arc(bx, by, 1.4, 0, TAU); g.stroke();
    }
    // fixed bodies (baked)
    for (i = 0; i < bs.length; i++) if (!bs[i].orbit) drawBodyArt(g, bs[i], i, Pl.x + bs[i].x * s, Pl.y + bs[i].y * s, s, lv.seed);
    for (i = 0; i < wm.length; i++) if (!wm[i].moving) drawMouthLabel(g, Pl.x + wm[i].b.x * s + wm[i].lx, Pl.y + wm[i].b.y * s + wm[i].ly, wm[i].letter, wm[i].turn);
    // launch station: a small surveyor's benchmark at the probe start
    var px = Pl.x + lv.probe.x * s, py = Pl.y + lv.probe.y * s;
    g.strokeStyle = PAL.a('paper', 0.32); g.lineWidth = 0.5; g.beginPath();
    g.arc(px, py, 7, 0, TAU);
    for (j = 0; j < 4; j++) { var ta = j * Math.PI / 2; g.moveTo(px + Math.cos(ta) * 9, py + Math.sin(ta) * 9); g.lineTo(px + Math.cos(ta) * 12, py + Math.sin(ta) * 12); }
    g.stroke();
    // target catch circle (faint, dotted brass)
    var tx = Pl.x + lv.target.x * s, ty = Pl.y + lv.target.y * s, tr = lv.target.r * s + 6;
    g.fillStyle = PAL.a('brass', 0.35); g.beginPath();
    var tn = Math.round(TAU * tr / 3);
    for (j = 0; j < tn; j++) { var aa = j * TAU / tn; g.rect(tx + tr * Math.cos(aa) - 0.3, ty + tr * Math.sin(aa) - 0.3, 0.6, 0.6); }
    g.fill();
    // target crosshair (static; the bezel around it rotates)
    var TR = lv.target.r * s;
    g.globalAlpha = 0.85; g.strokeStyle = PAL.brass; g.lineWidth = 0.6; g.lineCap = 'round'; g.beginPath();
    g.moveTo(tx - TR * 0.62, ty); g.lineTo(tx - TR * 0.2, ty); g.moveTo(tx + TR * 0.2, ty); g.lineTo(tx + TR * 0.62, ty);
    g.moveTo(tx, ty - TR * 0.62); g.lineTo(tx, ty - TR * 0.2); g.moveTo(tx, ty + TR * 0.2); g.lineTo(tx, ty + TR * 0.62);
    g.stroke(); g.lineCap = 'butt';
    g.globalAlpha = 1; g.fillStyle = PAL.brass; g.beginPath(); g.arc(tx, ty, 0.8, 0, TAU); g.fill();
    // caption (top band, centre)
    var cap = lv.caption ? String(lv.caption).replace(/ · /g, '  ·  ') : 'PLATE ' + (lv.plate || toRoman((lv.index | 0) + 1)) + '  ·  ' + String(lv.name || '').toUpperCase();
    hudAnchors();
    var cxm = layout.w / 2, size, fit = false, sq = 1;
    var maxW = 2 * Math.min(cxm - (hudGeo.xl + hudSpr.launchW + 12), (hudGeo.xr - STARS_W - 12) - cxm);
    g.fillStyle = PAL.a('paper', 0.86); g.textBaseline = 'middle';
    for (size = 12.5; size >= 10; size -= 0.5) { g.font = fnt('600', size, FONT.sc); if (spacedWidth(g, cap, size * 0.12) <= maxW) { fit = true; break; } }
    hudGeo.two = !fit;
    if (fit) hudGeo.yRow = hudGeo.yCap = Pl.y - 29;
    else {
      hudGeo.yRow = Pl.y - 41; hudGeo.yCap = Pl.y - 20; maxW = (hudGeo.xr - hudGeo.xl) * 0.94;
      for (size = 12; size >= 10; size -= 0.5) { g.font = fnt('600', size, FONT.sc); if (spacedWidth(g, cap, size * 0.12) <= maxW) { fit = true; break; } }
      if (!fit) { size = 10; g.font = fnt('600', size, FONT.sc); sq = maxW / spacedWidth(g, cap, size * 0.12); }
    }
    capInfo.text = cap; capInfo.size = size; capInfo.two = !!hudGeo.two; capInfo.squeeze = sq;
    g.translate(cxm, hudGeo.yCap); g.scale(sq, 1);
    spacedText(g, cap, 0, 0, size * 0.12, 'center');
    g.setTransform(d, 0, 0, d, 0, 0);
    g.textBaseline = 'alphabetic';
  }
  function isOrbitCentreEmpty(lv, o) {
    var bs = lv.bodies;
    for (var i = 0; i < bs.length; i++) if (!bs[i].orbit && Math.abs(bs[i].x - o.cx) < 2 && Math.abs(bs[i].y - o.cy) < 2) return false;
    return true;
  }
  // top band anchors: the plate edges, or the safe screen edges when the plate is narrow (landscape)
  var capInfo = { text: '', size: 0, two: false, squeeze: 1 };      // last caption layout (read by QA)
  var STARS_W = 46, hudGeo = { xl: 0, xr: 0, yRow: 0, yCap: 0, two: false };
  function hudAnchors() {
    var Pl = layout.plate, sf = layout.safe;
    if (Pl.w >= 300) { hudGeo.xl = Pl.x; hudGeo.xr = Pl.x + Pl.w; }
    else { hudGeo.xl = sf.left + 12; hudGeo.xr = layout.w - sf.right - 12; }
    hudGeo.yRow = hudGeo.yCap = Pl.y - 29;
  }
  function readoutY() { return layout.plate.y + layout.plate.h + 29; }

  function buildPlay() {
    if (!cv || !level) return;
    if (dirtyHud) buildHud();
    var lv = level, s = layout.scale, i;
    Lplate = ensureLayer(Lplate);
    paintPlateBase(Lplate.getContext('2d'), lv.seed | 0, lv);
    Lplay = ensureLayer(Lplay);
    var g = Lplay.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(Lplate, 0, 0);
    paintLevel(g, lv);
    // sprites for bodies on rails; fixed repulsors keep animated rings
    moving.length = 0; repulsors.length = 0;
    for (i = 0; i < lv.bodies.length; i++) {
      var b = lv.bodies[i];
      if (b.orbit) {
        (function (b, i) {
          moving.push({ b: b, spr: makeSprite(bodyExtent(b) * s, function (sg, c) { drawBodyArt(sg, b, i, c, c, s, lv.seed); }) });
        })(b, i);
      } else if (b.kind === 'repulsor') repulsors.push({ x: b.x, y: b.y, r: b.r });
    }
    buildMouthSprites(lv);
    // target bezel sprite (rotated each frame)
    var TR = lv.target.r * s;
    tgtSpr = makeSprite(TR + 5, function (sg, c) { drawBezel(sg, c, c, TR); });
    // fragment tails point away from the target, deterministic
    var fr = lv.frags || [], r = rng((lv.seed | 0) + 555);
    for (i = 0; i < fr.length && i < 8; i++) {
      var a = Math.atan2(fr[i].y - lv.target.y, fr[i].x - lv.target.x) + (r() - 0.5) * 0.8;
      fragTail[2 * i] = Math.cos(a); fragTail[2 * i + 1] = Math.sin(a);
    }
    dirtyPlay = false; playGen++;
  }
  function drawBezel(g, x, y, R) {
    g.strokeStyle = PAL.brass; g.lineWidth = 1; g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
    g.lineWidth = 0.55; g.globalAlpha = 0.85; g.beginPath(); g.arc(x, y, R - 3.4, 0, TAU); g.stroke();
    var n = 72;
    g.beginPath();
    for (var i = 0; i < n; i++) {
      var a = i * TAU / n, l = i % 6 === 0 ? 3.4 : i % 3 === 0 ? 2.3 : 1.5;
      g.moveTo(x + Math.cos(a) * (R - 0.5), y + Math.sin(a) * (R - 0.5)); g.lineTo(x + Math.cos(a) * (R - l), y + Math.sin(a) * (R - l));
    }
    g.lineWidth = 0.45; g.stroke();
    g.globalAlpha = 1; g.fillStyle = PAL.brass; g.beginPath();              // cardinal pips outside the ring
    for (var k = 0; k < 4; k++) {
      var b = k * Math.PI / 2, cb = Math.cos(b), sb = Math.sin(b), w = k === 0 ? 1.6 : 1.1;
      g.moveTo(x + cb * (R + 0.8), y + sb * (R + 0.8));
      g.lineTo(x + cb * (R + 4) - sb * w, y + sb * (R + 4) + cb * w);
      g.lineTo(x + cb * (R + 4) + sb * w, y + sb * (R + 4) - cb * w);
      g.closePath();
    }
    g.fill();
  }

  function buildHud() {
    var d = layout.dpr, i;
    for (i = 1; i <= 3; i++) {
      var str = 'LAUNCH  ' + i + ' / ' + K.MAX_LAUNCHES;
      (function (str) {
        var probe = mk(4, 4).getContext('2d'); probe.font = fnt('600', 10, FONT.sc);
        var w = spacedWidth(probe, str, 1.4) + 4, c = mk(w * d, 16 * d), g = c.getContext('2d');
        g.setTransform(d, 0, 0, d, 0, 0); g.font = fnt('600', 10, FONT.sc); g.textBaseline = 'middle';
        g.fillStyle = PAL.a('paper', 0.68); spacedText(g, str, 1, 8.5, 1.4, 'left');
        hudSpr.launch[i] = { c: c, h: c.height / 2 }; hudSpr.launchW = w;
      })(str);
    }
    for (i = 0; i < 3; i++) {
      (function (mode) { hudSpr.star[mode] = makeSprite(6, function (g, c) { drawStar(g, c, c, 5.2, mode); }); })(i);
    }
    (function () {                                   // the astronomer's label, drawn rotated along the hint line
      var str = 'the astronomer\u2019s line', pr = mk(4, 4).getContext('2d');
      pr.font = fnt('italic 500', 11, FONT.serif);
      var w = Math.ceil(pr.measureText(str).width) + 4, h = 15, c = mk(w * d, h * d), g = c.getContext('2d');
      g.setTransform(d, 0, 0, d, 0, 0); g.font = fnt('italic 500', 11, FONT.serif);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = PAL.brass;
      g.fillText(str, w / 2, h / 2 + 0.5);
      hintSpr = { c: c, w: w, hh: h };
    })();
    starRow.length = 0; roCv = null; ro.dirty = true;
    dirtyHud = false;
  }

  // ---------------------------------------------------------------- title plate (orrery)
  var ORR = { cx: 450, cy: 820, sunR: 34, ring0: 386, ring1: 404,
    pl: [ { rad: 104, r: 9, ph: 0.6 }, { rad: 162, r: 15, ph: 2.5 }, { rad: 226, r: 21, ph: 4.2, moon: 1 },
          { rad: 296, r: 27, ph: 1.1, ring: 1 }, { rad: 352, r: 13, ph: 5.4 } ] };
  // Where the orrery goes: between the DOM title header and menu (portrait), or beside the text column (landscape).
  // Reads the title DOM rects read-only when available; falls back to fixed fractions.
  var titleGeo = { cx: 0, cy: 0, k: 0, land: false, on: false, key: '', t: -1e9 };
  function titleRects() {
    var r = { hb: -1, mt: -1, cl: -1, key: '' };
    try {
      var h = document.querySelector('#scr-title .t-head'), m = document.querySelector('#scr-title .t-menu');
      if (h && m) {
        var a = h.getBoundingClientRect(), b = m.getBoundingClientRect();
        if (a.height > 0 && b.height > 0) { r.hb = a.bottom; r.mt = b.top; r.cl = Math.min(a.left, b.left); }
      }
    } catch (e) {}
    r.key = Math.round(r.hb / 4) + ',' + Math.round(r.mt / 4) + ',' + Math.round(r.cl / 4);
    return r;
  }
  function placeTitle() {
    var w = layout.w, h = layout.h, sf = layout.safe, Pl = layout.plate, r = titleRects(), R, cx, cy;
    titleGeo.key = r.key; titleGeo.land = w > h;
    if (!titleGeo.land) {
      var top = (r.hb > 0 ? r.hb : sf.top + h * 0.3) + 14, bot = (r.mt > 0 ? r.mt : h * 0.65) - 14;
      R = Math.min((bot - top) / 2, Pl.w / 2 - 14, 200); cx = w / 2; cy = (top + bot) / 2;
    } else {
      var cl = r.cl > 0 ? r.cl : w / 2 - 210, space = cl - sf.left - 20;
      R = Math.min((h - sf.top - sf.bottom) * 0.42, space / 2 - 4); cx = sf.left + 10 + space / 2; cy = sf.top + (h - sf.top - sf.bottom) / 2;
    }
    titleGeo.on = R >= 36; titleGeo.cx = cx; titleGeo.cy = cy; titleGeo.k = Math.max(0, R) / ORR.ring1;
  }
  function buildTitle() {
    Ltitle = ensureLayer(Ltitle);
    var g = Ltitle.getContext('2d'), d = layout.dpr, i, a;
    placeTitle();
    if (!titleGeo.land) paintPlateBase(g, 1832, null);
    else {
      // landscape: no narrow plate behind the title — a full page of ink, grain and a sparse field of stars
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.fillStyle = PAL.ink; g.fillRect(0, 0, Ltitle.width, Ltitle.height);
      g.fillStyle = g.createPattern(grain(), 'repeat'); g.fillRect(0, 0, Ltitle.width, Ltitle.height);
      g.setTransform(d, 0, 0, d, 0, 0);
      var rs = rng(1832); g.strokeStyle = PAL.paper; g.lineWidth = 0.45;
      for (i = 0; i < 46; i++) {
        var sx = rs() * layout.w, sy = rs() * layout.h, arm = rs() < 0.8 ? 1.2 : 2.2;
        g.globalAlpha = 0.18 + 0.25 * rs(); g.beginPath();
        g.moveTo(sx - arm, sy); g.lineTo(sx + arm, sy); g.moveTo(sx, sy - arm); g.lineTo(sx, sy + arm); g.stroke();
      }
      g.globalAlpha = 1;
    }
    titleSpr.length = 0; titleMoonSpr = null;
    if (!titleGeo.on) { dirtyTitle = false; titleGen++; return; }
    var s = titleGeo.k, cx = titleGeo.cx, cy = titleGeo.cy;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(cx, cy, ORR.ring1 * s + 2, 0, TAU); g.fill();
    // graduated zodiac ring
    var r0 = ORR.ring0 * s, r1 = ORR.ring1 * s;
    g.strokeStyle = PAL.a('paper', 0.55); g.lineWidth = 0.7;
    g.beginPath(); g.arc(cx, cy, r1, 0, TAU); g.stroke();
    g.lineWidth = 0.5; g.beginPath(); g.arc(cx, cy, r0, 0, TAU); g.stroke();
    g.strokeStyle = PAL.a('paper', 0.4); g.beginPath();
    for (i = 0; i < 180; i++) {
      a = i * TAU / 180; var l = i % 15 === 0 ? r1 - r0 : i % 5 === 0 ? (r1 - r0) * 0.6 : (r1 - r0) * 0.3;
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * (r1 - l), cy + Math.sin(a) * (r1 - l));
    }
    g.stroke();
    if (r0 > 90) {
      g.fillStyle = PAL.a('paper', 0.42); g.font = fnt('600', 6.5, FONT.sc); g.textAlign = 'center'; g.textBaseline = 'middle';
      for (i = 0; i < 12; i++) {
        a = -Math.PI / 2 + (i + 0.5) * TAU / 12;
        g.save(); g.translate(cx + Math.cos(a) * (r0 - 6), cy + Math.sin(a) * (r0 - 6)); g.rotate(a + Math.PI / 2);
        g.fillText(toRoman(i + 1), 0, 0); g.restore();
      }
    }
    // orbits
    for (i = 0; i < ORR.pl.length; i++) {
      var R = ORR.pl[i].rad * s;
      if (i & 1) {
        var n = Math.round(TAU * R / 3.2); g.fillStyle = PAL.a('paper', 0.32); g.beginPath();
        for (var j = 0; j < n; j++) { a = j * TAU / n; g.rect(cx + R * Math.cos(a) - 0.3, cy + R * Math.sin(a) - 0.3, 0.6, 0.6); }
        g.fill();
      } else { g.strokeStyle = PAL.a('paper', 0.24); g.lineWidth = 0.55; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke(); }
    }
    // the sun: engraved radiant disc
    var sr = Math.max(4, ORR.sunR * s);
    g.strokeStyle = PAL.paper; g.lineCap = 'round';
    g.globalAlpha = 0.55; g.lineWidth = 0.5; g.beginPath();
    for (i = 0; i < 48; i++) {
      a = i * TAU / 48; var l1 = sr * 1.2, l2 = sr * (i % 4 === 0 ? 1.95 : i % 2 === 0 ? 1.6 : 1.4);
      g.moveTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1); g.lineTo(cx + Math.cos(a) * l2, cy + Math.sin(a) * l2);
    }
    g.stroke();
    g.globalAlpha = 1;
    hatchSphere(g, cx, cy, sr, { sp: 1.6, lw: 0.5, bands: 0, bf: 0, bp: 0 });
    g.lineCap = 'butt';
    // planet sprites
    for (i = 0; i < ORR.pl.length; i++) {
      (function (p, i) {
        var R = Math.max(2.5, p.r * s);
        titleSpr.push(makeSprite(p.ring ? R * 2.3 : R, function (sg, c) {
          if (p.ring) ringedPlanet(sg, c, c, R); else hatchSphere(sg, c, c, R, sphereOpts(R, true, 40 + i));
        }));
      })(ORR.pl[i], i);
    }
    var mr = Math.max(1.6, 4.5 * s);
    titleMoonSpr = makeSprite(mr + 1, function (sg, c) { hatchSphere(sg, c, c, mr, sphereOpts(mr, false, 9)); });
    dirtyTitle = false; titleGen++;
  }
  function ringedPlanet(g, x, y, R) {
    var tilt = -0.32, rx = R * 2.05, ry = R * 0.5, k;
    g.strokeStyle = PAL.paper;
    for (k = 0; k < 3; k++) { g.globalAlpha = 0.75 - k * 0.15; g.lineWidth = k === 1 ? 0.8 : 0.45; g.beginPath(); g.ellipse(x, y, rx * (1 - k * 0.1), ry * (1 - k * 0.1), tilt, Math.PI, TAU); g.stroke(); }
    g.globalAlpha = 1;
    hatchSphere(g, x, y, R, sphereOpts(R, true, 77));
    g.strokeStyle = PAL.ink; g.lineWidth = 2.6; g.beginPath(); g.ellipse(x, y, rx * 0.9, ry * 0.9, tilt, 0, Math.PI); g.stroke();
    g.strokeStyle = PAL.paper;
    for (k = 0; k < 3; k++) { g.globalAlpha = 0.85 - k * 0.15; g.lineWidth = k === 1 ? 0.8 : 0.45; g.beginPath(); g.ellipse(x, y, rx * (1 - k * 0.1), ry * (1 - k * 0.1), tilt, 0, Math.PI); g.stroke(); }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- effects state (preallocated)
  var crashes = [], CR = 2, NRAY = 22, NFRAG = 6;
  for (var ci = 0; ci < CR; ci++) crashes.push({ on: false, t0: -1, x: 0, y: 0, ray: new Float32Array(NRAY * 2), frag: new Float32Array(NFRAG * 5) });
  var crashIdx = 0, shakeT0 = -2, shakePending = false, crashSeed = 1;
  var succ = { on: false, t0: -1, n: 0, pts: null, seal: null, sx: 0, sy: 0, stars: 0 };
  var popT = new Float64Array(8), prevCol = new Uint8Array(8);
  for (var q = 0; q < 8; q++) popT[q] = -1;

  // Wormhole passage flash: two expanding paper rings and a few sparks at each end, ~350 ms; the mouths also spin up.
  var WARP_MS = 350, WN = 3, warps = [], warpIdx = 0, warpsLive = false, lastT = 0;
  for (var wi = 0; wi < WN; wi++) warps.push({ on: false, t0: -1, m: [-1, -1], x: [0, 0], y: [0, 0], r: 32, sp: new Float32Array(2 * 6 * 2) });
  function mouthNear(x, y) {
    var best = -1, bd = 1e18;
    for (var i = 0; i < wm.length; i++) {
      var b = wm[i].b; Physics.bodyPos(b, lastT, P);
      var dx = P.x - x, dy = P.y - y, dd = dx * dx + dy * dy, lim = b.r * 1.7;
      if (dd < lim * lim && dd < bd) { bd = dd; best = i; }
    }
    return best;
  }
  function warp(x0, y0, x1, y1) {
    if (!level || !(x0 === x0 && y0 === y0 && x1 === x1 && y1 === y1)) return;
    var w = warps[warpIdx]; warpIdx = (warpIdx + 1) % WN;
    var r = rng(crashSeed++ * 6271 + 11), i, e;
    w.on = true; w.t0 = -1; w.x[0] = x0; w.y[0] = y0; w.x[1] = x1; w.y[1] = y1; w.r = 32;
    w.m[0] = mouthNear(x0, y0); w.m[1] = mouthNear(x1, y1);
    for (e = 0; e < 2; e++) {
      if (w.m[e] >= 0) { w.r = wm[w.m[e]].b.r; wm[w.m[e]].kPend = true; }
      for (i = 0; i < 6; i++) { w.sp[(e * 6 + i) * 2] = (i + 0.15 + r() * 0.7) * TAU / 6 + e * 0.5; w.sp[(e * 6 + i) * 2 + 1] = 5 + r() * 8; }
    }
    warpsLive = true;
  }
  var fx = {
    warp: warp,
    crash: function (x, y) {
      var c = crashes[crashIdx]; crashIdx = (crashIdx + 1) % CR;
      var r = rng(crashSeed++ * 7717 + 3), i;
      c.on = true; c.t0 = -1; c.x = x; c.y = y;
      for (i = 0; i < NRAY; i++) { c.ray[2 * i] = (i + r() * 0.8) * TAU / NRAY; c.ray[2 * i + 1] = 7 + r() * 11; }
      for (i = 0; i < NFRAG; i++) {
        var f = 5 * i;
        c.frag[f] = r() * TAU; c.frag[f + 1] = 14 + r() * 20; c.frag[f + 2] = r() * TAU; c.frag[f + 3] = (r() - 0.5) * 7; c.frag[f + 4] = 2.2 + r() * 2.2;
      }
      shakePending = true;
    },
    success: function (pts, n) {
      n = Math.max(0, Math.min(n | 0, pts ? (pts.length >> 1) : 0));
      if (!succ.pts || succ.pts.length < n * 2) succ.pts = new Float32Array(Math.max(n * 2, K.MAX_STEPS * 2 + 8));
      for (var i = 0; i < n * 2; i++) succ.pts[i] = pts[i];
      succ.n = n; succ.on = true; succ.t0 = -1; succ.seal = null;
    },
    reset: function () {
      for (var i = 0; i < CR; i++) crashes[i].on = false;
      shakePending = false; shakeT0 = -2; succ.on = false; succ.seal = null; succ.n = 0;
      for (i = 0; i < WN; i++) warps[i].on = false;
      warpsLive = false;
      for (i = 0; i < wm.length; i++) wm[i].kPend = false;
      for (i = 0; i < 8; i++) { popT[i] = -1; prevCol[i] = 0; }
    }
  };

  function buildSeal(state) {
    var lv = level, s = layout.scale, Pl = layout.plate;
    var stars = state && state.result && state.result.stars ? state.result.stars : 3;
    var R = SEAL_R, plate = lv.plate || toRoman((lv.index | 0) + 1);
    var spr = makeSprite(R + 2, function (g, c) {
      g.strokeStyle = PAL.brass; g.fillStyle = PAL.brass;
      g.fillStyle = PAL.ink; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
      g.fillStyle = PAL.brass;
      g.lineWidth = 1.4; g.beginPath(); g.arc(c, c, R - 0.7, 0, TAU); g.stroke();
      g.lineWidth = 0.55; g.beginPath(); g.arc(c, c, R - 3, 0, TAU); g.stroke();
      g.beginPath(); g.arc(c, c, R - 7.5, 0, TAU); g.stroke();
      g.lineWidth = 0.45; g.beginPath();
      for (var i = 0; i < 90; i++) { var a = i * TAU / 90, l = i % 3 === 0 ? 7.1 : 5.6; g.moveTo(c + Math.cos(a) * (R - 3.6), c + Math.sin(a) * (R - 3.6)); g.lineTo(c + Math.cos(a) * (R - l), c + Math.sin(a) * (R - l)); }
      g.stroke();
      g.lineWidth = 0.5; g.beginPath(); g.arc(c, c, R - 19.5, 0, TAU); g.stroke();
      // OBSERVED along the upper arc
      var txt = 'OBSERVED', rr = R - 13.2, fs = 7.2, sp = 1.3;
      g.font = fnt('700', fs, FONT.sc); g.textAlign = 'center'; g.textBaseline = 'middle';
      var ws = [], tot = 0, k;
      for (k = 0; k < txt.length; k++) { ws.push(g.measureText(txt[k]).width); tot += ws[k] + (k ? sp : 0); }
      var ang = -Math.PI / 2 - tot / rr / 2, acc = 0;
      for (k = 0; k < txt.length; k++) {
        var aa = ang + (acc + ws[k] / 2) / rr; acc += ws[k] + sp;
        g.save(); g.translate(c + Math.cos(aa) * rr, c + Math.sin(aa) * rr); g.rotate(aa + Math.PI / 2); g.fillText(txt[k], 0, 0.3); g.restore();
      }
      // stars along the lower arc
      for (k = 0; k < 3; k++) {
        var sa = Math.PI / 2 + (1 - k) * 0.36;
        drawStar(g, c + Math.cos(sa) * rr, c + Math.sin(sa) * rr, 2.9, k < stars ? 2 : 0);
      }
      // side pips
      g.fillStyle = PAL.brass;
      for (k = 0; k < 2; k++) { g.beginPath(); g.arc(c + (k ? 1 : -1) * rr, c, 0.9, 0, TAU); g.fill(); }
      // roman numeral
      var pf = plate.length > 5 ? 9.5 : plate.length > 3 ? 12 : 14;
      g.font = fnt('700', pf, FONT.sc); g.fillStyle = PAL.brass;
      g.fillText(plate, c, c + 0.6);
      g.lineWidth = 0.45; g.beginPath(); g.moveTo(c - 7, c - 8); g.lineTo(c + 7, c - 8); g.moveTo(c - 7, c + 9); g.lineTo(c + 7, c + 9); g.stroke();
    });
    // place near the target where the winning path crosses it least, kept inside the plate
    var t = lv.target, tx = Pl.x + t.x * s, ty = Pl.y + t.y * s, off = t.r * s + R + 14, m = R + 10;
    var best = 1e9, bx = tx, by = ty;
    for (var c = 0; c < 8; c++) {
      var a = c * Math.PI / 4, cx = tx + Math.cos(a) * off, cy = ty + Math.sin(a) * off;
      var ccx = Math.max(Pl.x + m, Math.min(Pl.x + Pl.w - m, cx)), ccy = Math.max(Pl.y + m, Math.min(Pl.y + Pl.h - m, cy));
      var dxt = ccx - tx, dyt = ccy - ty, score = Math.abs(Math.sqrt(dxt * dxt + dyt * dyt) - off) * 0.5 + (Math.sin(a) < -0.1 ? 3 : 0);
      if (Math.sqrt(dxt * dxt + dyt * dyt) < t.r * s + R + 4) score += 100;       // would cover the target
      for (var i = 0; i < succ.n; i += 3) {
        var px = Pl.x + succ.pts[2 * i] * s - ccx, py = Pl.y + succ.pts[2 * i + 1] * s - ccy;
        if (px * px + py * py < (R + 5) * (R + 5)) score += 1;
      }
      if (score < best) { best = score; bx = ccx; by = ccy; }
    }
    succ.sx = bx; succ.sy = by; succ.stars = stars; succ.seal = spr;
  }

  // ---------------------------------------------------------------- public: init / resize / level
  function init(canvas) {
    cv = canvas; ctx = canvas.getContext('2d');
    LSP = 'letterSpacing' in ctx;
    try {
      if (canvas.parentNode && !bgCv) {
        bgCv = document.createElement('canvas'); bgCv.setAttribute('aria-hidden', 'true');
        var st = bgCv.style; st.position = 'fixed'; st.left = '0'; st.top = '0'; st.display = 'block';
        st.pointerEvents = 'none'; st.background = PAL.ink;
        canvas.parentNode.insertBefore(bgCv, canvas);
        bgCtx = bgCv.getContext('2d');
        canvas.style.background = 'transparent';
      }
    } catch (e) { bgCv = bgCtx = null; }
    fontsReady = !(typeof document !== 'undefined' && document.fonts);
    if (!fontsReady) {
      var done = function () { fontsReady = true; dirtyPlay = dirtyTitle = dirtyHud = true; succ.seal = null; };
      try {
        var f = document.fonts, specs = ['600 12px "Cormorant SC"', '700 12px "Cormorant SC"', '400 12px "JetBrains Mono"', 'italic 500 12px "Cormorant Garamond"'];
        var loads = []; for (var i = 0; i < specs.length; i++) loads.push(f.load(specs[i]).catch(function () {}));
        Promise.all(loads).then(function () { return f.ready; }).then(done, done);
        if (f.addEventListener) f.addEventListener('loadingdone', done);
      } catch (e) { fontsReady = true; }
    }
  }
  function resize(w, h, dpr, safe) {
    safe = safe || {}; var st = +safe.top || 0, sb = +safe.bottom || 0;
    dpr = dpr || 1;
    if (cv) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    if (bgCv) { bgCv.width = Math.round(w * dpr); bgCv.height = Math.round(h * dpr); bgCv.style.width = w + 'px'; bgCv.style.height = h + 'px'; bgKey = ''; }
    roCv = null; starRow.length = 0;
    var s = Math.min((w - 24) / K.WORLD_W, (h - st - sb - 112) / K.WORLD_H);
    var pw = K.WORLD_W * s, ph = K.WORLD_H * s;
    layout = { dpr: dpr, w: w, h: h, scale: s,
      plate: { x: (w - pw) / 2, y: st + 56 + ((h - st - sb - 112) - ph) / 2, w: pw, h: ph },
      safe: { top: st, right: +safe.right || 0, bottom: sb, left: +safe.left || 0 } };
    layout.top = { x: 0, y: st, w: w, h: layout.plate.y - st };
    layout.bottom = { x: 0, y: layout.plate.y + ph, w: w, h: h - sb - (layout.plate.y + ph) };
    DASH_A[0] = 1.6 / s; DASH_A[1] = 3.4 / s;     // repulsor rings
    DASH_B[0] = 2.4 / s; DASH_B[1] = 2.6 / s;     // cancel ring
    DASH_C[0] = 0.8 / s; DASH_C[1] = 3.2 / s;     // idle ring
    dirtyPlay = dirtyTitle = dirtyHud = true; succ.seal = null;
  }
  function worldToScreen(x, y) { return { x: layout.plate.x + x * layout.scale, y: layout.plate.y + y * layout.scale }; }
  function screenToWorld(px, py) { return { x: (px - layout.plate.x) / layout.scale, y: (py - layout.plate.y) / layout.scale }; }
  function setLevel(lv) {
    level = lv || null; fx.reset(); dirtyPlay = true;
    if (cv && level && cv.width > 1) { if (dirtyHud) buildHud(); buildPlay(); }
  }

  // ---------------------------------------------------------------- frame
  var ro = { str: '', t: -1e9, phase: '', italic: false, dirty: true };
  function readout(state, now) {
    var ph = state.phase, aim = state.aim, hd = state.hud || {};
    var pulling = ph === 'aim' && aim && aim.active && !aim.cancel, held = !!state.frozen && ph === 'aim' && !pulling;
    var key = ph + (aim && aim.active ? (aim.cancel ? 'c' : 'a') : '') + (held ? 'f' : '');
    if (key === ro.phase && now - ro.t < 100) return;
    var prevS = ro.str, prevI = ro.italic;
    ro.phase = key; ro.t = now; ro.italic = false;
    if (held) { ro.str = 'the heavens are held'; ro.italic = true; }
    else if (ph === 'aim' && aim && aim.active) {
      if (aim.cancel) { ro.str = 'release to cancel'; ro.italic = true; }
      else ro.str = 'v₀ ' + Math.round(Math.sqrt(aim.vx * aim.vx + aim.vy * aim.vy)) + ' u/s  ·  power ' + Math.round((aim.power || 0) * 100) + '%';
    } else if (ph === 'aim' && !state.launches) { ro.str = 'pull back anywhere to aim'; ro.italic = true; }
    else {
      var c = hd.closest;
      ro.str = 'v ' + Math.round(hd.speed || 0) + ' u/s  ·  closest ' + (isFinite(c) ? Math.round(c) : '—') + ' u';
    }
    if (ro.str !== prevS || ro.italic !== prevI) ro.dirty = true;
  }

  function frame(state, nowMs) {
    if (!ctx) return;
    var now = +nowMs || 0;
    if (dirtyHud) buildHud();
    if (!state || state.screen !== 'play' || !state.level) { backdrop(state, now); return; }
    if (state.level !== level) setLevel(state.level);
    if (dirtyPlay) buildPlay();
    var d = layout.dpr, s = layout.scale, Pl = layout.plate, lv = level, u = 1 / s, i;

    // screen shake from the latest crash
    if (shakePending) { shakeT0 = now; shakePending = false; }
    var shx = 0, shy = 0, sp = (now - shakeT0) / 250;
    if (sp >= 0 && sp < 1) { var A = 4 * (1 - sp) * (1 - sp); shx = A * Math.sin(now * 0.11 + 1.3); shy = A * Math.cos(now * 0.137); }

    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    showBg(Lplay, 'p' + playGen, shx, shy);
    var ox = Pl.x + shx, oy = Pl.y + shy;

    // bodies on rails (sprites) at the physics step's time
    var t = (state.step | 0) * K.DT;
    for (i = 0; i < moving.length; i++) {
      Physics.bodyPos(moving[i].b, t, P);
      var spr = moving[i].spr;
      ctx.drawImage(spr.c, (ox + P.x * s) * d - spr.h, (oy + P.y * s) * d - spr.h);
    }
    lastT = t;
    if (wm.length) drawMouths(now, ox, oy, s, d, t);
    // target bezel, slowly rotating
    var tg = lv.target, rot = now * 0.00011, cr = Math.cos(rot), sr = Math.sin(rot);
    ctx.setTransform(cr, sr, -sr, cr, (ox + tg.x * s) * d, (oy + tg.y * s) * d);
    ctx.drawImage(tgtSpr.c, -tgtSpr.h, -tgtSpr.h);

    // ---- world-space line work, clipped to the plate mark
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.beginPath(); ctx.rect(ox + 0.9, oy + 0.9, Pl.w - 1.8, Pl.h - 1.8); ctx.clip();
    ctx.setTransform(d * s, 0, 0, d * s, d * ox, d * oy);
    ctx.lineCap = 'round';
    // repulsor rings drifting outward
    if (repulsors.length) {
      // dashes built by hand (1.6 px on / 3.4 px off, drifting): far cheaper to raster than setLineDash on arcs
      ctx.strokeStyle = PAL.paper; ctx.lineWidth = 0.6 * u; ctx.lineCap = 'butt';
      for (i = 0; i < repulsors.length; i++) {
        var rp = repulsors[i];
        for (var k = 0; k < 3; k++) {
          var ph = (now * 0.00022 + k / 3) % 1, rr = rp.r * (1.5 + 2.6 * ph), rc = rr * s;
          ctx.globalAlpha = 0.42 * (1 - ph) * Math.min(1, ph * 6);
          var nd = Math.max(8, Math.round(TAU * rc / 5)), step = TAU / nd, on = step * 0.32, a0 = ph * 12 / rc;
          ctx.beginPath();
          for (var q = 0; q < nd; q++) {
            var aa = a0 + q * step;
            ctx.moveTo(rp.x + rr * Math.cos(aa), rp.y + rr * Math.sin(aa)); ctx.lineTo(rp.x + rr * Math.cos(aa + on), rp.y + rr * Math.sin(aa + on));
          }
          ctx.stroke();
        }
      }
      ctx.lineCap = 'round';
    }

    drawFrags(state, now, u);
    if (state.spotlight) drawSpotlight(state.spotlight, now, u);
    if (warpsLive) drawWarps(now, u, t);
    drawGhosts(state, u);
    var showTrail = state.phase === 'flight' || state.phase === 'result';
    if (showTrail) drawTrail(state.trail, u, succ.on ? 0.45 : 1);
    if (succ.on || (state.phase === 'result' && state.result && state.result.success)) drawSuccessPath(state, now, u);
    aimLbl.on = false; hintLbl.on = false;
    if (state.phase === 'aim') { drawHint(state, now, u, ox, oy); drawAim(state, now, u, d, ox, oy); }
    drawProbe(state, u);
    drawCrashes(now, u);
    ctx.restore();
    aimLabel(d); hintLabel(d);
    ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
    if (state.phase === 'flight' && state.sim) offPlate(state.sim, d, ox, oy);
    drawSeal(state, now, d, shx, shy);
    drawHud(state, now, d, shx, shy);
  }

  // Put a static layer on screen: once onto the background canvas (then just clear the game canvas),
  // or, without a background canvas, blit it every frame.
  function showBg(layer, key, shx, shy) {
    var d = layout.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!bgCv) {
      if (shx || shy) { ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, cv.width, cv.height); }
      ctx.drawImage(layer, Math.round(shx * d), Math.round(shy * d));
      return;
    }
    if (bgKey !== key) { bgCtx.setTransform(1, 0, 0, 1, 0, 0); bgCtx.drawImage(layer, 0, 0); bgKey = key; }
    var sh = (shx || shy) ? 'translate(' + Math.round(shx * d) / d + 'px,' + Math.round(shy * d) / d + 'px)' : '';
    if (sh !== bgShift) { bgCv.style.transform = sh; bgShift = sh; }
    ctx.clearRect(0, 0, cv.width, cv.height);
  }
  function drawFrags(state, now, u) {
    var fr = level.frags; if (!fr || !fr.length) return;
    var col = state.collected, i;
    for (i = 0; i < fr.length && i < 8; i++) {
      var c = col && col[i] ? 1 : 0;
      if (c && !prevCol[i]) popT[i] = now;
      if (!c) popT[i] = -1;
      prevCol[i] = c;
    }
    ctx.strokeStyle = PAL.brass; ctx.fillStyle = PAL.brass; ctx.lineWidth = 0.55 * u; ctx.globalAlpha = 0.95;
    ctx.beginPath();
    var wob = Math.sin(now * 0.002) * 0.06;
    for (i = 0; i < fr.length && i < 8; i++) {
      if (prevCol[i]) continue;
      var x = fr[i].x, y = fr[i].y, tx = fragTail[2 * i], ty = fragTail[2 * i + 1];
      for (var k = -1; k <= 1; k++) {
        var a = k * (0.2 + wob), ca = Math.cos(a), sa = Math.sin(a), L = (k ? 8 : 11) * u;
        var dx = tx * ca - ty * sa, dy = tx * sa + ty * ca;
        ctx.moveTo(x + dx * 2.6 * u, y + dy * 2.6 * u); ctx.lineTo(x + dx * L, y + dy * L);
      }
    }
    ctx.stroke(); ctx.beginPath();
    for (i = 0; i < fr.length && i < 8; i++) {
      if (prevCol[i]) continue;
      ctx.moveTo(fr[i].x + 1.9 * u, fr[i].y); ctx.arc(fr[i].x, fr[i].y, 1.9 * u, 0, TAU);
    }
    ctx.fill();
    // collection pop: brass ring + radiating ticks
    for (i = 0; i < fr.length && i < 8; i++) {
      if (popT[i] < 0) continue;
      var p = (now - popT[i]) / 480; if (p >= 1) continue;
      var e = easeOutCubic(p), R = (3 + 13 * e) * u;
      ctx.globalAlpha = 1 - p; ctx.lineWidth = 0.7 * u; ctx.beginPath(); ctx.arc(fr[i].x, fr[i].y, R, 0, TAU);
      for (var j = 0; j < 6; j++) { var aj = j * TAU / 6 + 0.3, cj = Math.cos(aj), sj = Math.sin(aj); ctx.moveTo(fr[i].x + cj * (R + 2 * u), fr[i].y + sj * (R + 2 * u)); ctx.lineTo(fr[i].x + cj * (R + 5 * u), fr[i].y + sj * (R + 5 * u)); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }


  // Animated parts of the mouths: two knock-out rings turning against each other (sprites, two blits per mouth), a label sprite
  // for mouths on rails, and a brief spin-up when the probe passes through.
  function drawMouths(now, ox, oy, s, d, t) {
    var a0 = now * 0.0005, b0 = -now * 0.00085;
    for (var i = 0; i < wm.length; i++) {
      var m = wm[i], b = m.b, x = b.x, y = b.y;
      if (m.moving) { Physics.bodyPos(b, t, P); x = P.x; y = P.y; }
      if (m.kPend) { m.kx += m.kd; m.kd = 2.4; m.kt0 = now; m.kPend = false; }
      var kk = m.kx + m.kd * easeOutCubic((now - m.kt0) / 650), cx = (ox + x * s) * d, cy = (oy + y * s) * d;
      var ra = a0 + kk, rb = b0 - kk * 1.35, ca = Math.cos(ra), sa = Math.sin(ra), cb = Math.cos(rb), sb = Math.sin(rb);
      ctx.setTransform(ca, sa, -sa, ca, cx, cy); ctx.drawImage(m.sA.c, -m.sA.h, -m.sA.h);
      ctx.setTransform(cb, sb, -sb, cb, cx, cy); ctx.drawImage(m.sB.c, -m.sB.h, -m.sB.h);
      if (m.lbl) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(m.lbl.c, Math.round(cx + m.lx * d - m.lbl.w * d / 2), Math.round(cy + m.ly * d - m.lbl.h * d / 2));
      }
    }
  }
  function drawWarps(now, u, t) {
    var live = false, e, i, k, w, p, c;
    ctx.lineCap = 'round';
    for (k = 0; k < WN; k++) {
      w = warps[k]; if (!w.on) continue;
      if (w.t0 < 0) w.t0 = now;
      p = (now - w.t0) / WARP_MS; if (p >= 1) { w.on = false; continue; }
      live = true;
      for (e = 0; e < 2; e++) {
        var x = w.x[e], y = w.y[e];
        if (w.m[e] >= 0) { Physics.bodyPos(wm[w.m[e]].b, t, P); x = P.x; y = P.y; }
        for (i = 0; i < 2; i++) {                                   // two rings, the second a beat behind
          var q = (p - i * 0.16) / (1 - i * 0.16); if (q <= 0) continue;
          ctx.strokeStyle = PAL.paper; ctx.globalAlpha = (i ? 0.45 : 0.85) * (1 - q) * Math.min(1, q * 8);
          ctx.lineWidth = (1 - 0.45 * q) * u;
          ctx.beginPath(); ctx.arc(x, y, w.r * (0.85 + (i ? 1.45 : 1.15) * easeOutCubic(q)), 0, TAU); ctx.stroke();
        }
        var ease = easeOutCubic(p), a = 1 - p;
        for (c = 0; c < 2; c++) {                                   // sparks: paper and vermilion, alternating
          ctx.strokeStyle = c ? PAL.vermilion : PAL.paper; ctx.globalAlpha = a * (c ? 0.9 : 0.75); ctx.lineWidth = (c ? 0.8 : 0.6) * u;
          ctx.beginPath();
          for (i = c; i < 6; i += 2) {
            var an = w.sp[(e * 6 + i) * 2], len = w.sp[(e * 6 + i) * 2 + 1], r0 = w.r * (0.95 + 0.75 * ease), r1 = r0 + len * (1 - 0.6 * ease) * u;
            var ca = Math.cos(an), sa = Math.sin(an);
            ctx.moveTo(x + ca * r0, y + sa * r0); ctx.lineTo(x + ca * r1, y + sa * r1);
          }
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1; warpsLive = live;
  }

  function drawGhosts(state, u) {
    var gs = state.ghosts; if (!gs || !gs.length) return;
    ctx.fillStyle = PAL.paper;
    for (var gi = 0; gi < gs.length; gi++) {
      var gp = gs[gi], n = gp.n | 0, pts = gp.pts; if (!pts || n < 2) continue;
      ctx.globalAlpha = gi === gs.length - 1 ? 0.3 : 0.2;
      ctx.beginPath();
      var r = 0.55 * u;
      for (var i = 0; i < n; i += 2) ctx.rect(pts[2 * i] - r, pts[2 * i + 1] - r, 2 * r, 2 * r);
      ctx.fill();
      // "×" where that observation ended
      var ex = pts[2 * (n - 1)], ey = pts[2 * (n - 1) + 1], c = 2.6 * u;
      ctx.strokeStyle = PAL.paper; ctx.lineWidth = 0.6 * u; ctx.beginPath();
      ctx.moveTo(ex - c, ey - c); ctx.lineTo(ex + c, ey + c); ctx.moveTo(ex + c, ey - c); ctx.lineTo(ex - c, ey + c); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  var TRAIL_B = 6, JUMP2 = K.WARP_JUMP * K.WARP_JUMP;
  function drawTrail(tr, u, mul) {
    if (!tr || !tr.pts || tr.n < 2) return;
    var cap = tr.pts.length >> 1, n = Math.min(tr.n, cap), start = ((tr.head - n) % cap + cap) % cap, pts = tr.pts;
    ctx.strokeStyle = PAL.vermilion; ctx.lineJoin = 'round';
    for (var b = 0; b < TRAIL_B; b++) {
      var i0 = Math.floor(b * (n - 1) / TRAIL_B), i1 = Math.floor((b + 1) * (n - 1) / TRAIL_B);
      if (i1 <= i0) continue;
      var f = (b + 1) / TRAIL_B;
      ctx.globalAlpha = mul * (0.06 + 0.84 * f * f);
      ctx.lineWidth = (0.55 + 0.6 * f) * u;
      ctx.beginPath();
      var k = (start + i0) % cap, px = pts[2 * k], py = pts[2 * k + 1]; ctx.moveTo(px, py);
      for (var i = i0 + 1; i <= i1; i++) {
        k = (start + i) % cap; var x = pts[2 * k], y = pts[2 * k + 1], dx = x - px, dy = y - py;
        if (dx * dx + dy * dy > JUMP2) ctx.moveTo(x, y); else ctx.lineTo(x, y);          // a wormhole jump is never connected
        px = x; py = y;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineJoin = 'miter';
  }

  var JMAX = 16, JP = new Float32Array(JMAX * 2 + 4);          // ends of wormhole jumps on the replayed path
  function drawSuccessPath(state, now, u) {
    var pts, n;
    if (succ.on) { pts = succ.pts; n = succ.n; if (succ.t0 < 0) succ.t0 = now; }
    else { pts = state.result.pts; n = state.result.n | 0; }
    if (!pts || n < 2) return;
    var p = succ.on ? (now - succ.t0) / 620 : 1, m = Math.max(1, Math.floor((n - 1) * easeOutCubic(p)));
    ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1.3 * u; ctx.globalAlpha = 0.95; ctx.lineJoin = 'round';
    var px = level.probe.x, py = level.probe.y, jn = 0, i;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (i = 0; i <= m; i++) {
      var x = pts[2 * i], y = pts[2 * i + 1], dx = x - px, dy = y - py;
      if (dx * dx + dy * dy > JUMP2) { ctx.moveTo(x, y); if (jn < JMAX) { JP[2 * jn] = px; JP[2 * jn + 1] = py; JP[2 * jn + 2] = x; JP[2 * jn + 3] = y; } jn += 2; }
      else ctx.lineTo(x, y);
      px = x; py = y;
    }
    ctx.stroke();
    if (jn) {                                               // a small brass ring at each end of a passage: the path re-inked through the gate
      ctx.lineWidth = 0.8 * u; ctx.beginPath();
      for (i = 0; i < jn && i < JMAX; i++) { ctx.moveTo(JP[2 * i] + 2.2 * u, JP[2 * i + 1]); ctx.arc(JP[2 * i], JP[2 * i + 1], 2.2 * u, 0, TAU); }
      ctx.stroke();
    }
    if (p < 1) { ctx.fillStyle = PAL.brass; ctx.beginPath(); ctx.arc(pts[2 * m], pts[2 * m + 1], 1.8 * u, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.lineJoin = 'miter';
  }

  // ---- aiming stub, astronomer's line, spotlight (all allocation-free; dots collected into one scratch buffer)
  var DOT_MAX = 200, DOTS = new Float32Array(DOT_MAX * 3);          // x, y, key per dot
  var DAL = new Float32Array(DOT_MAX), DRD = new Float32Array(DOT_MAX), DSG = new Uint8Array(DOT_MAX), DCL = new Uint8Array(DOT_MAX);
  // paint the first nd dots (x, y in DOTS; alpha in DAL; radius in CSS px in DRD), batched by quantised alpha
  function flushDots(nd, u, mul) {
    var cur = -1, k, b, x, y, r;
    for (k = 0; k < nd; k++) {
      b = (DAL[k] * 24 + 0.5) | 0; if (b < 1) continue;
      if (b !== cur) { if (cur >= 0) ctx.fill(); cur = b; ctx.globalAlpha = b / 24 * mul; ctx.beginPath(); }
      r = DRD[k] * u; x = DOTS[3 * k]; y = DOTS[3 * k + 1];
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
    }
    if (cur >= 0) ctx.fill();
    ctx.globalAlpha = 1;
  }
  var PRED_SP = 7.4, PRED_START = 9.5, PRED_EXIT = 6, NB = 10;                        // CSS px between dots, gap left around the probe
  var BAND_T = []; for (var bq = 0; bq < NB; bq++) BAND_T.push((bq + 0.5) / NB);
  function smooth(a, b, x) { x = (x - a) / (b - a); x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
  // The prediction covers only K.PREDICT_STEPS (2.25 s): a short vermilion stub of dots spaced evenly by ARC LENGTH
  // (so a slow, tight pull is as legible as a full-power one), tapering in size and dissolving smoothly to nothing.
  // Dots are spaced by arc length and never connect across a wormhole jump. The fade belongs to the LAST stretch of the whole
  // path: a stretch that ends in a mouth stays at about half ink right up to it and closes with a clear dot on the aperture;
  // the stretch after a jump restarts near full ink and dissolves to nothing.
  var SL_ = new Float32Array(10), SS_ = new Float32Array(10);
  function drawPredict(pr, u) {
    var n = pr.n, pts = pr.pts, sp = PRED_SP * u, st = PRED_START * u, total = 0, next = st, nd = 0, i, k, lastJ = 0, ns = 0;
    var x0 = level.probe.x, y0 = level.probe.y, x, y, dx, dy, seg, f, d2, t, a, r;
    SS_[0] = st;
    for (i = 0; i < n; i++) {
      x = pts[2 * i]; y = pts[2 * i + 1]; dx = x - x0; dy = y - y0; d2 = dx * dx + dy * dy;
      if (d2 > JUMP2) {                                    // wormhole jump: close the stretch on the mouth, restart the spacing at the exit
        if (nd < DOT_MAX) {
          var lastKey = nd ? DOTS[3 * (nd - 1) + 2] : -1e9;
          if (nd ? total - lastKey > sp * 0.45 : total > st + sp * 0.45) { DOTS[3 * nd] = x0; DOTS[3 * nd + 1] = y0; DOTS[3 * nd + 2] = total; DSG[nd] = ns; DCL[nd] = 1; nd++; }
          else DCL[nd - 1] = 1;                            // the last dot is close enough: it becomes the closing dot
        }
        if (ns < 8) { SL_[ns] = Math.max(total - SS_[ns], sp); ns++; SS_[ns] = total; }
        x0 = x; y0 = y; next = total + PRED_EXIT * u; lastJ = i; continue;
      }
      seg = Math.sqrt(d2);
      while (total + seg >= next && nd < DOT_MAX) {
        f = seg > 0 ? (next - total) / seg : 0;
        DOTS[3 * nd] = x0 + dx * f; DOTS[3 * nd + 1] = y0 + dy * f; DOTS[3 * nd + 2] = next; DSG[nd] = ns; DCL[nd] = 0; nd++; next += sp;
      }
      total += seg; x0 = x; y0 = y;
    }
    if (!nd) return;
    SL_[ns] = Math.max(total - SS_[ns], sp);
    for (k = 0; k < nd; k++) {
      var sg = DSG[k], last = sg === ns;
      t = (DOTS[3 * k + 2] - SS_[sg]) / SL_[sg]; t = t > 1 ? 1 : t < 0 ? 0 : t;
      if (DCL[k] && !last) { a = 0.95; r = 1.55; }
      else if (!last) { a = 0.95 - 0.45 * t; r = 1.2 - 0.2 * t; }
      else { a = (sg ? 0.88 : 0.95) * Math.pow(1 - smooth(0.02, 1.0, t), 1.45); r = 1.2 - 0.68 * t; }
      DAL[k] = a; DRD[k] = r;
    }
    ctx.fillStyle = PAL.vermilion;
    flushDots(nd, u, 1);
    // engraver's end mark: a hair-thin tick across the path where the stub ends (never reaching back across a jump)
    var i5 = Math.max(n - 6, lastJ);
    if (n > 5 && n - 1 - i5 >= 2 && SL_[ns] > 4 * u) {
      var ex = pts[2 * (n - 1)], ey = pts[2 * (n - 1) + 1], tx = ex - pts[2 * i5], ty = ey - pts[2 * i5 + 1];
      var tl = Math.sqrt(tx * tx + ty * ty) || 1, c = 3.2 * u;
      ctx.strokeStyle = PAL.vermilion; ctx.globalAlpha = 0.34; ctx.lineWidth = 0.6 * u; ctx.beginPath();
      ctx.moveTo(ex - ty / tl * c, ey + tx / tl * c); ctx.lineTo(ex + ty / tl * c, ey - tx / tl * c); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Consult the Astronomer: the opening of a winning course as brass dots, a dot every 5 steps, larger than the
  // vermilion prediction and fading toward the far end. The italic label is drawn after the plate clip (hintLabel).
  var HINT_SP = 5, HINT_LBL_PX = 58, hintLbl = { on: false, x: 0, y: 0, ang: 0, a: 0 }, hintSpr = null;
  var SEG_S = new Int32Array(10), SEG_E = new Int32Array(10), SEG_L = new Float32Array(10);
  function drawHint(state, now, u, ox, oy) {
    var h = state.hint; hintLbl.on = false;
    if (!h || !h.on || !h.pts || !(h.n > 4)) return;
    var n = Math.min(h.n | 0, h.pts.length >> 1), pts = h.pts, s = layout.scale;
    var fade = easeOutCubic((now - (+h.t0 || 0)) / 300);
    if (!(fade > 0)) return;
    var px = level.probe.x, py = level.probe.y, skip2 = (K.DRAG_CANCEL + 7) * (K.DRAG_CANCEL + 7), nd = 0, i, dx, dy, d2;
    // segments between wormhole jumps; dots every HINT_SP steps, the count restarting at each exit and a dot closing each entry
    var ns = 0, s0 = 0, lastDot = -99, sl = 0;
    SEG_S[0] = 0;
    for (i = 0; i < n; i++) {
      var jump = false;
      if (i) { dx = pts[2 * i] - pts[2 * i - 2]; dy = pts[2 * i + 1] - pts[2 * i - 1]; d2 = dx * dx + dy * dy; if (d2 > JUMP2) jump = true; else sl += Math.sqrt(d2); }
      if (jump) {
        if (ns < 9) { SEG_E[ns] = i - 1; SEG_L[ns] = sl; ns++; SEG_S[ns] = i; }
        if (lastDot < i - 2 && nd < DOT_MAX) { var cj = i - 1; dx = pts[2 * cj] - px; dy = pts[2 * cj + 1] - py; if (dx * dx + dy * dy >= skip2) { DOTS[3 * nd] = pts[2 * cj]; DOTS[3 * nd + 1] = pts[2 * cj + 1]; DOTS[3 * nd + 2] = cj; DSG[nd] = ns - 1; DCL[nd] = 1; nd++; } }
        else if (nd) DCL[nd - 1] = 1;
        s0 = i; sl = 0; lastDot = -99;
      }
      if (nd >= DOT_MAX) continue;
      if ((i - s0) % HINT_SP === (s0 ? 2 : HINT_SP - 1)) {
        dx = pts[2 * i] - px; dy = pts[2 * i + 1] - py;
        if (dx * dx + dy * dy < skip2) continue;
        DOTS[3 * nd] = pts[2 * i]; DOTS[3 * nd + 1] = pts[2 * i + 1]; DOTS[3 * nd + 2] = i; DSG[nd] = ns; DCL[nd] = 0; nd++; lastDot = i;
      }
    }
    SEG_E[ns] = n - 1; SEG_L[ns] = sl; ns++;
    if (!nd) return;
    var k, f, aa, rr;
    for (k = 0; k < nd; k++) {                      // as the aiming stub: a stretch ending in a mouth holds half ink up to it, the last one fades
      var sg = DSG[k], last = sg === ns - 1, sa = SEG_S[sg], sz = Math.max(1, SEG_E[sg] - sa);
      f = (DOTS[3 * k + 2] - sa) / sz; f = f > 1 ? 1 : f < 0 ? 0 : f;
      if (DCL[k] && !last) { aa = 0.95; rr = 1.9; }
      else if (!last) { aa = 0.95 - 0.4 * f; rr = 1.65 - 0.2 * f; }
      else { aa = (sg ? 0.9 : 0.95) - 0.78 * f; rr = 1.65 - 0.65 * f; }
      DAL[k] = aa; DRD[k] = rr;
    }
    ctx.fillStyle = PAL.brass;
    flushDots(nd, u, fade);
    ctx.globalAlpha = 1;
    // label anchor: ~58 px along the first stretch (clear of the probe and the pull ring), set beside the dots. A stretch
    // too short for the label hands it to the first long one, else the longest (labels never straddle a jump).
    if (!hintSpr) return;
    var sg0 = 0, sgE = SEG_E[0], want = (HINT_LBL_PX + hintSpr.w * 0.5) / s, sgi = -1, longest = 0;
    for (i = 0; i < ns; i++) { if (SEG_L[i] >= want) { sgi = i; break; } if (SEG_L[i] > SEG_L[longest]) longest = i; }
    if (sgi < 0) sgi = longest;
    sg0 = SEG_S[sgi]; sgE = SEG_E[sgi];
    var a = 0, lim = (sgi ? Math.min(HINT_LBL_PX, SEG_L[sgi] * s * 0.3) : HINT_LBL_PX) / s, acc = 0;
    for (i = sg0 + 1; i <= sgE; i++) {
      dx = pts[2 * i] - pts[2 * i - 2]; dy = pts[2 * i + 1] - pts[2 * i - 1]; acc += Math.sqrt(dx * dx + dy * dy);
      if (acc >= lim) { a = i; break; }
    }
    if (!a) return;
    // the label spans sw px of the line from the anchor: use the chord over that span for its angle, and stand it
    // off by the path's own bulge so a curving line never runs through the letters
    var Pl = layout.plate, sw = hintSpr.w, sh = hintSpr.hh, i1 = a, acc2 = 0;
    for (i = a + 1; i <= sgE; i++) {
      dx = pts[2 * i] - pts[2 * i - 2]; dy = pts[2 * i + 1] - pts[2 * i - 1]; acc2 += Math.sqrt(dx * dx + dy * dy);
      i1 = i; if (acc2 * s >= sw) break;
    }
    var i0 = Math.max(sg0, a - 2);
    var tx = pts[2 * i1] - pts[2 * i0], ty = pts[2 * i1 + 1] - pts[2 * i0 + 1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
    tx /= tl; ty /= tl;
    var ang = Math.atan2(ty, tx); if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    var ca = Math.cos(ang), sa = Math.sin(ang), hw = Math.abs(ca) * sw / 2 + Math.abs(sa) * sh / 2 + 6, hh = Math.abs(sa) * sw / 2 + Math.abs(ca) * sh / 2 + 6;
    var ax = ox + pts[2 * a] * s, ay = oy + pts[2 * a + 1] * s, off = 12;
    var xmin = ox + hw, xmax = ox + Pl.w - hw, ymin = oy + hh, ymax = oy + Pl.h - hh;
    var best = 1e9, cx = ax, cy = ay, sg, m;
    for (sg = -1; sg <= 1; sg += 2) {
      var nx = -ty * sg, ny = tx * sg, push = 0;
      for (m = a; m <= i1; m++) {                 // how far the path bulges toward this side within the span
        var dv = ((pts[2 * m] * s + ox - ax) * nx + (pts[2 * m + 1] * s + oy - ay) * ny); if (dv > push) push = dv;
      }
      var qx = ax + tx * sw / 2 + nx * (off + push), qy = ay + ty * sw / 2 + ny * (off + push);
      var kx = qx < xmin ? xmin : qx > xmax ? xmax : qx, ky = qy < ymin ? ymin : qy > ymax ? ymax : qy;
      var sc = Math.abs(kx - qx) + Math.abs(ky - qy) + push * 0.4;
      if (sc < best) { best = sc; cx = kx; cy = ky; }
    }
    hintLbl.on = true; hintLbl.x = cx; hintLbl.y = cy; hintLbl.ang = ang; hintLbl.a = fade * 0.92;
  }
  function hintLabel(d) {
    if (!hintLbl.on || !hintSpr) return;
    hintLbl.on = false;
    var c = Math.cos(hintLbl.ang) * d, s = Math.sin(hintLbl.ang) * d;
    ctx.setTransform(c, s, -s, c, hintLbl.x * d, hintLbl.y * d); ctx.globalAlpha = hintLbl.a;
    ctx.drawImage(hintSpr.c, -hintSpr.w / 2, -hintSpr.hh / 2, hintSpr.w, hintSpr.hh);
    ctx.globalAlpha = 1;
  }

  // Popup-card spotlight: an engraved dashed ring (slowly turning) with four fine leader ticks round each point.
  var DASH_S = [0, 0];
  // Entries are {x, y} or {x, y, r}: r (world units, > 0) sets the ring radius, the default being 2.2 x K.FRAG_R.
  function drawSpotlight(sl, now, u) {
    var n = sl.length | 0; if (n < 1) return;
    if (n > 8) n = 8;
    var a0 = now * 0.00032, i, k, p, x, y, a, ca, sa, R, circ, nd, per;
    ctx.strokeStyle = PAL.paper; ctx.lineCap = 'butt';
    ctx.globalAlpha = 0.55; ctx.lineWidth = 0.85 * u;
    for (i = 0; i < n; i++) {
      p = sl[i]; if (!p) continue; R = spotR(p);
      circ = TAU * R; nd = Math.max(10, Math.round(circ / u / 5.6)); per = circ / nd;
      DASH_S[0] = per * 0.56; DASH_S[1] = per * 0.44; ctx.setLineDash(DASH_S);
      ctx.beginPath(); ctx.moveTo(p.x + R * Math.cos(a0), p.y + R * Math.sin(a0)); ctx.arc(p.x, p.y, R, a0, a0 + TAU); ctx.stroke();
    }
    ctx.setLineDash(DASH_NONE);
    ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6 * u; ctx.beginPath();
    for (i = 0; i < n; i++) {
      p = sl[i]; if (!p) continue; x = p.x; y = p.y; R = spotR(p);
      for (k = 0; k < 4; k++) {
        a = -a0 * 0.5 + k * Math.PI / 2 + Math.PI / 4; ca = Math.cos(a); sa = Math.sin(a);
        ctx.moveTo(x + ca * (R + 3.2 * u), y + sa * (R + 3.2 * u)); ctx.lineTo(x + ca * (R + 9.5 * u), y + sa * (R + 9.5 * u));
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 0.2; ctx.lineWidth = 0.5 * u; ctx.beginPath();          // faint inner hairline
    for (i = 0; i < n; i++) { p = sl[i]; if (!p) continue; R = spotR(p); ctx.moveTo(p.x + R * 0.88, p.y); ctx.arc(p.x, p.y, R * 0.88, 0, TAU); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function spotR(p) { var r = +p.r; return r > 0 && r < 600 ? r : K.FRAG_R * 2.2; }

  var aimLbl = { on: false, x: 0, y: 0, i: 0 };
  // Power label placement (screen px). Preferred: just beyond the ruler's end. If that would touch the plate
  // border, stand beside the ruler (nudged perpendicular to it), fully inside the plate with a margin.
  var PW_HW = 14, PW_HH = 7, PW_M = 8;
  function placePower(ox, oy, px, py, ux, uy, L) {
    var s = layout.scale, Pl = layout.plate;
    var x0 = ox + PW_HW + PW_M, x1 = ox + Pl.w - PW_HW - PW_M, y0 = oy + PW_HH + PW_M, y1 = oy + Pl.h - PW_HH - PW_M;
    var sx = ox + px * s, sy = oy + py * s, Ls = L * s, cs = K.DRAG_CANCEL * s;
    var lx = sx + ux * (Ls + 14), ly = sy + uy * (Ls + 14);
    if (lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1) { aimLbl.on = true; aimLbl.x = lx; aimLbl.y = ly; return; }
    var nx = -uy, ny = ux, need = PW_HW * Math.abs(nx) + PW_HH * Math.abs(ny) + 6;
    var t = Ls + 8, tmin = cs + 4;
    while (t > tmin) { var qx = sx + ux * t, qy = sy + uy * t; if (qx >= x0 && qx <= x1 && qy >= y0 && qy <= y1) break; t -= 3; }
    if (t < tmin) t = tmin;
    var best = 1e9, bx = lx, by = ly;
    for (var sg = -1; sg <= 1; sg += 2) {
      var cx = sx + ux * t + nx * need * sg, cy = sy + uy * t + ny * need * sg;
      var ccx = cx < x0 ? x0 : cx > x1 ? x1 : cx, ccy = cy < y0 ? y0 : cy > y1 ? y1 : cy;
      var tp = (ccx - sx) * ux + (ccy - sy) * uy; tp = tp < cs ? cs : tp > Ls ? Ls : tp;
      var ddx = ccx - (sx + ux * tp), ddy = ccy - (sy + uy * tp), dist = Math.sqrt(ddx * ddx + ddy * ddy);
      var sc = Math.abs(ccx - cx) + Math.abs(ccy - cy) + (dist < need - 1 ? 100 + (need - dist) : 0);
      if (sc < best) { best = sc; bx = ccx; by = ccy; }
    }
    aimLbl.on = true; aimLbl.x = bx; aimLbl.y = by;
  }
  function aimLabel(d) {
    if (!aimLbl.on) return;
    aimLbl.on = false;
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.globalAlpha = 1;
    ctx.font = MONO9; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = PAL.a('paper', 0.8);
    ctx.fillText(PCT[aimLbl.i], aimLbl.x, aimLbl.y);
  }
  function drawAim(state, now, u, d, ox, oy) {
    var aim = state.aim, px = level.probe.x, py = level.probe.y, i;
    if (!aim || !aim.active) {
      // idle: a faint rotating dotted ring invites the pull
      ctx.strokeStyle = PAL.paper; ctx.globalAlpha = 0.28; ctx.lineWidth = 0.9 * u; ctx.setLineDash(DASH_C);
      ctx.lineDashOffset = now * 0.004 * u;
      ctx.beginPath(); ctx.arc(px, py, K.DRAG_CANCEL, 0, TAU); ctx.stroke();
      ctx.setLineDash(DASH_NONE); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
      return;
    }
    var cancel = !!aim.cancel;
    var pr = state.predict;
    if (!cancel && pr && pr.n > 4) drawPredict(pr, u);
    // pull line with engraved graduation, power arcs
    var dx = aim.dx || 0, dy = aim.dy || 0, len = Math.sqrt(dx * dx + dy * dy);
    ctx.strokeStyle = cancel ? PAL.vermilion : PAL.paper;
    if (len > 0.5) {
      var ux = dx / len, uy = dy / len, L = Math.min(len, K.DRAG_MAX), ang = Math.atan2(uy, ux);
      ctx.globalAlpha = cancel ? 0.5 : 0.75; ctx.lineWidth = 0.7 * u; ctx.beginPath();
      ctx.moveTo(px + ux * K.DRAG_CANCEL, py + uy * K.DRAG_CANCEL);
      if (L > K.DRAG_CANCEL) ctx.lineTo(px + ux * L, py + uy * L);
      for (var tk = 30; tk <= L + 0.01; tk += 30) {
        var tl2 = (tk % 150 === 0 ? 4 : 2.2) * u;
        ctx.moveTo(px + ux * tk - uy * tl2, py + uy * tk + ux * tl2); ctx.lineTo(px + ux * tk + uy * tl2, py + uy * tk - ux * tl2);
      }
      ctx.stroke();
      if (!cancel) {
        ctx.globalAlpha = 0.9; ctx.lineWidth = 0.9 * u; ctx.beginPath(); ctx.arc(px, py, L, ang - 0.15, ang + 0.15); ctx.stroke();
        var mx = px + ux * K.DRAG_MAX, my = py + uy * K.DRAG_MAX;
        if (mx > 10 && mx < K.WORLD_W - 10 && my > 10 && my < K.WORLD_H - 10) {
          ctx.globalAlpha = 0.3; ctx.lineWidth = 0.6 * u; ctx.beginPath(); ctx.arc(px, py, K.DRAG_MAX, ang - 0.22, ang + 0.22); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // % label: drawn after the plate clip is released (see aimLabel); placed clear of the border and the ruler
        placePower(ox, oy, px, py, ux, uy, L);
        aimLbl.i = Math.max(0, Math.min(100, Math.round((aim.power || L / K.DRAG_MAX) * 100)));
      }
    }
    // cancel ring
    ctx.strokeStyle = cancel ? PAL.vermilion : PAL.paper; ctx.globalAlpha = cancel ? 0.9 : 0.4; ctx.lineWidth = 0.7 * u;
    ctx.setLineDash(DASH_B); ctx.beginPath(); ctx.arc(px, py, K.DRAG_CANCEL, 0, TAU); ctx.stroke(); ctx.setLineDash(DASH_NONE);
    ctx.globalAlpha = 1;
  }
  var MONO9 = '500 9px ' + FONT.mono, MONO10 = '400 10px ' + FONT.mono, ITAL11 = 'italic 500 11.5px ' + FONT.serif;

  function drawProbe(state, u) {
    var x = level.probe.x, y = level.probe.y, ax = 0, ay = -1, sim = state.sim;
    if (state.phase === 'flight' && sim) {
      x = sim.x; y = sim.y; var vl = Math.sqrt(sim.vx * sim.vx + sim.vy * sim.vy);
      if (vl > 1e-6) { ax = sim.vx / vl; ay = sim.vy / vl; }
    } else if (state.phase === 'result' && state.result && state.result.success) {
      var r = succ.on ? succ : state.result, n = r.n | 0;
      if (r.pts && n > 1) {
        x = r.pts[2 * (n - 1)]; y = r.pts[2 * (n - 1) + 1]; ax = x - r.pts[2 * (n - 2)]; ay = y - r.pts[2 * (n - 2) + 1];
        if (ax * ax + ay * ay > JUMP2) { ax = 0; ay = -1; }       // the last step was a wormhole jump: no heading to show
        var l = Math.sqrt(ax * ax + ay * ay) || 1; ax /= l; ay /= l;
      }
    } else if (state.phase === 'aim' && state.aim && state.aim.active && !state.aim.cancel) {
      var al = Math.sqrt(state.aim.dx * state.aim.dx + state.aim.dy * state.aim.dy) || 1; ax = -state.aim.dx / al; ay = -state.aim.dy / al;
    }
    var f = 5.4 * u, b = 3.4 * u, w = 3.1 * u;
    ctx.fillStyle = PAL.vermilion; ctx.globalAlpha = 1; ctx.beginPath();
    ctx.moveTo(x + ax * f, y + ay * f); ctx.lineTo(x - ay * w, y + ax * w); ctx.lineTo(x - ax * b, y - ay * b); ctx.lineTo(x + ay * w, y - ax * w);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(x, y, 0.7 * u, 0, TAU); ctx.fill();
  }

  // probe beyond the plate mark: a small vermilion pointer on the neatline
  function offPlate(sim, d, ox, oy) {
    var x = sim.x, y = sim.y, W = K.WORLD_W, H = K.WORLD_H;
    if (x >= 0 && x <= W && y >= 0 && y <= H) return;
    var s = layout.scale, cx = Math.max(0, Math.min(W, x)), cy = Math.max(0, Math.min(H, y));
    var dx = x - cx, dy = y - cy, l = Math.sqrt(dx * dx + dy * dy) || 1; dx /= l; dy /= l;
    var X = ox + cx * s, Y = oy + cy * s;
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = PAL.vermilion; ctx.globalAlpha = 0.9; ctx.beginPath();
    ctx.moveTo(X + dx * 1, Y + dy * 1); ctx.lineTo(X - dx * 6 - dy * 3.2, Y - dy * 6 + dx * 3.2); ctx.lineTo(X - dx * 6 + dy * 3.2, Y - dy * 6 - dx * 3.2);
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawCrashes(now, u) {
    for (var ci = 0; ci < CR; ci++) {
      var c = crashes[ci]; if (!c.on) continue;
      if (c.t0 < 0) c.t0 = now;
      var p = (now - c.t0) / 560; if (p >= 1) { c.on = false; continue; }
      var e = easeOutCubic(p), a = 1 - p, i;
      for (var pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? PAL.vermilion : PAL.paper; ctx.globalAlpha = a * (pass ? 0.95 : 0.75);
        ctx.lineWidth = (pass ? 0.8 : 0.6) * u; ctx.beginPath();
        for (i = pass; i < NRAY; i += 2) {
          var an = c.ray[2 * i], len = c.ray[2 * i + 1], r0 = (2.5 + 15 * e) * u, r1 = r0 + len * (1 - 0.7 * e) * u;
          var ca = Math.cos(an), sa = Math.sin(an);
          ctx.moveTo(c.x + ca * r0, c.y + sa * r0); ctx.lineTo(c.x + ca * r1, c.y + sa * r1);
        }
        ctx.stroke();
      }
      // hatched fragments
      ctx.strokeStyle = PAL.paper; ctx.globalAlpha = a * 0.9; ctx.lineWidth = 0.5 * u; ctx.beginPath();
      for (i = 0; i < NFRAG; i++) {
        var f = 5 * i, dist = c.frag[f + 1] * e * u, fx0 = c.x + Math.cos(c.frag[f]) * dist, fy0 = c.y + Math.sin(c.frag[f]) * dist;
        var ro2 = c.frag[f + 2] + c.frag[f + 3] * p, sz = c.frag[f + 4] * u;
        var x0 = fx0 + Math.cos(ro2) * sz, y0 = fy0 + Math.sin(ro2) * sz;
        var x1 = fx0 + Math.cos(ro2 + 2.3) * sz * 0.8, y1 = fy0 + Math.sin(ro2 + 2.3) * sz * 0.8;
        var x2 = fx0 + Math.cos(ro2 + 4.2) * sz * 0.9, y2 = fy0 + Math.sin(ro2 + 4.2) * sz * 0.9;
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x0, y0);
        ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2); ctx.lineTo((x0 + x2) / 2, (y0 + y2) / 2);
        ctx.moveTo(x0 * 0.2 + x1 * 0.8, y0 * 0.2 + y1 * 0.8); ctx.lineTo(x0 * 0.2 + x2 * 0.8, y0 * 0.2 + y2 * 0.8);
      }
      ctx.stroke();
      // impact ring
      ctx.strokeStyle = PAL.vermilion; ctx.globalAlpha = a * 0.6; ctx.lineWidth = 0.6 * u;
      ctx.beginPath(); ctx.arc(c.x, c.y, (2 + 9 * e) * u, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawSeal(state, now, d, shx, shy) {
    if (!succ.on || succ.t0 < 0) return;
    var q = (now - succ.t0 - 700) / 460; if (q <= 0) return;
    if (!succ.seal) buildSeal(state);
    var sc = 1.75 - 0.75 * easeOutBack(q), rot = -0.16 + 0.1 * (1 - easeOutCubic(q)), cr = Math.cos(rot) * sc, sr = Math.sin(rot) * sc;
    ctx.globalAlpha = clamp01(q * 3);
    ctx.setTransform(cr, sr, -sr, cr, (succ.sx + shx) * d, (succ.sy + shy) * d);
    ctx.drawImage(succ.seal.c, -succ.seal.h, -succ.seal.h);
    // impression ripple at the moment of contact
    var rp = (q - 0.3) / 1.1;
    if (rp > 0 && rp < 1) {
      ctx.setTransform(d, 0, 0, d, (succ.sx + shx) * d, (succ.sy + shy) * d);
      ctx.globalAlpha = 0.5 * (1 - rp); ctx.strokeStyle = PAL.brass; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.arc(0, 0, SEAL_R * (1.02 + 0.45 * easeOutCubic(rp)), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHud(state, now, d, shx, shy) {
    var y = hudGeo.yRow + shy, i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // LAUNCH n / 3
    var ln = state.launches | 0;
    if (state.phase === 'aim') ln += 1;
    ln = Math.max(1, Math.min(3, ln));
    var ls = hudSpr.launch[ln];
    if (ls) ctx.drawImage(ls.c, Math.round((hudGeo.xl + shx) * d), Math.round(y * d - ls.h));
    // stars (right)
    var res = state.phase === 'result' ? state.result : null, earned = 0, pot = 0;
    var failed = state.phase === 'flight' && state.sim && state.sim.status !== 'flying' && state.sim.status !== 'hit';
    if (res) earned = res.success ? (res.stars | 0) : 0;
    else pot = Math.max(0, Math.min(3, 4 - ln - (failed ? 1 : 0) - (state.hint && state.hint.used ? 1 : 0)));
    var rk = res ? 4 + Math.min(3, earned) : Math.min(3, pot), row = starRow[rk] || (starRow[rk] = buildStarRow(res, earned, pot));
    ctx.drawImage(row, Math.round((hudGeo.xr - 41 + shx) * d), Math.round((y - 8) * d));
    // bottom readout (centre 50% only), re-rendered only when its text changes
    readout(state, now);
    var rw = layout.w * 0.5 - 12;
    if (!roCv || ro.dirty) paintReadout(rw);
    ctx.drawImage(roCv, Math.round((layout.w / 2 - rw / 2 + shx) * d), Math.round((readoutY() - 10 + shy) * d));
  }
  var starRow = [], roCv = null;
  function buildStarRow(res, earned, pot) {
    var d = layout.dpr, c = mk(44 * d, 15 * d), g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    for (var i = 0; i < 3; i++) drawStar(g, 7 + i * 14, 7.5, 5.2, res ? (i < earned ? 2 : 0) : (i < pot ? 1 : 0));
    return c;
  }
  function paintReadout(rw) {
    var d = layout.dpr;
    if (!roCv) roCv = mk(rw * d, 20 * d);
    var g = roCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, roCv.width, roCv.height);
    g.setTransform(d, 0, 0, d, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = ro.italic ? ITAL11 : MONO10;
    g.fillStyle = ro.italic ? PAL.a('paper', 0.5) : PAL.a('paper', 0.62);
    g.fillText(ro.str, rw / 2, 10, rw);
    ro.dirty = false;
  }

  // ---------------------------------------------------------------- non-play screens
  function backdrop(state, now) {
    var scr = state && state.screen;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (scr === 'select' && level) {
      if (dirtyPlay) buildPlay();
      showBg(Lplate, 'l' + playGen, 0, 0);
      return;
    }
    if (now - titleGeo.t > 500 || now < titleGeo.t) {          // follow the DOM title layout (fonts, rotation)
      titleGeo.t = now;
      if (!dirtyTitle && titleRects().key !== titleGeo.key) dirtyTitle = true;
    }
    if (dirtyTitle) buildTitle();
    showBg(Ltitle, 't' + titleGen, 0, 0);
    if (!titleGeo.on) return;
    var d = layout.dpr, s = titleGeo.k, T = now / 1000;
    var cx = titleGeo.cx, cy = titleGeo.cy;
    for (var i = 0; i < ORR.pl.length; i++) {
      var p = ORR.pl[i], w = 0.16 * Math.pow(104 / p.rad, 1.5), a = p.ph + w * T, R = p.rad * s;
      var x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R, spr = titleSpr[i];
      ctx.drawImage(spr.c, x * d - spr.h, y * d - spr.h);
      if (p.moon) {
        var ma = 1.3 + T * 0.7, mr = (p.r + 16) * s;
        ctx.drawImage(titleMoonSpr.c, (x + Math.cos(ma) * mr) * d - titleMoonSpr.h, (y + Math.sin(ma) * mr) * d - titleMoonSpr.h);
      }
    }
  }

  // ---------------------------------------------------------------- thumbnails (level select)
  // A mouth in miniature: ring, a broken inner ring and a pupil; the pair letters are added once all bodies are down.
  function thumbMouth(c, x, y, R) {
    c.fillStyle = PAL.ink; c.beginPath(); c.arc(x, y, R * 1.3, 0, TAU); c.fill();
    c.strokeStyle = PAL.paper; c.lineCap = 'round';
    c.globalAlpha = 0.95; c.lineWidth = 0.7; c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke();
    c.globalAlpha = 0.65; c.lineWidth = 0.5; c.beginPath();
    for (var k = 0; k < 3; k++) { var a = k * TAU / 3 + 0.3; c.moveTo(x + R * 0.58 * Math.cos(a), y + R * 0.58 * Math.sin(a)); c.arc(x, y, R * 0.58, a, a + 1.35); }
    c.stroke();
    c.globalAlpha = 1; c.fillStyle = PAL.paper; c.beginPath(); c.arc(x, y, Math.min(0.9, R * 0.22), 0, TAU); c.fill();
    c.lineCap = 'butt';
  }
  var TH_DIRS = [0, Math.PI, -Math.PI / 2, Math.PI / 2, -Math.PI / 4, -3 * Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4];
  function thumbLetters(c, lv, ox, oy, s, pw, ph) {
    var bs = lv.bodies, no = pairNumbers(lv), tg = lv.target, i, k;
    c.font = 'italic 500 8px ' + FONT.serif; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = PAL.a('paper', 0.92);
    for (i = 0; i < bs.length; i++) {
      var b = bs[i]; if (b.kind !== 'wormhole') continue;
      Physics.bodyPos(b, 0, P);
      var x = ox + P.x * s, y = oy + P.y * s, R = Math.max(2.6, b.r * s), tx = x + R + 5, ty = y;
      for (k = 0; k < TH_DIRS.length; k++) {
        var qx = x + Math.cos(TH_DIRS[k]) * (R + 5), qy = y + Math.sin(TH_DIRS[k]) * (R + 5);
        var ex = qx - (ox + tg.x * s), ey = qy - (oy + tg.y * s), tr = Math.max(2.5, tg.r * s) + 4;
        if (qx < ox + 6 || qx > ox + pw - 6 || qy < oy + 6 || qy > oy + ph - 6 || ex * ex + ey * ey < tr * tr) continue;
        tx = qx; ty = qy; break;
      }
      c.fillText(GREEK[(no[i] | 0) % GREEK.length], tx, ty);
    }
    c.textAlign = 'start'; c.textBaseline = 'alphabetic';
  }

  function drawThumbnail(c, lv, w, h) {
    if (!c || !lv) return;
    c.save();
    var s = Math.min((w - 6) / K.WORLD_W, (h - 6) / K.WORLD_H), pw = K.WORLD_W * s, ph = K.WORLD_H * s;
    var ox = (w - pw) / 2, oy = (h - ph) / 2, bs = lv.bodies, i, j, o, x, y;
    c.globalAlpha = 1; c.setLineDash(DASH_NONE);
    c.fillStyle = PAL.ink; c.fillRect(0, 0, w, h);
    c.fillStyle = PAL.a('paper', 0.02); c.fillRect(ox, oy, pw, ph);
    c.strokeStyle = PAL.graphite; c.lineWidth = 0.5; c.beginPath();
    for (i = 300; i < K.WORLD_W; i += 300) { c.moveTo(ox + i * s, oy + 2); c.lineTo(ox + i * s, oy + ph - 2); }
    for (i = 400; i < K.WORLD_H; i += 400) { c.moveTo(ox + 2, oy + i * s); c.lineTo(ox + pw - 2, oy + i * s); }
    c.stroke();
    c.strokeStyle = PAL.a('paper', 0.5); c.lineWidth = 0.6; c.strokeRect(ox + 0.3, oy + 0.3, pw - 0.6, ph - 0.6);
    c.strokeStyle = PAL.a('paper', 0.28); c.lineWidth = 0.4; c.strokeRect(ox + 2, oy + 2, pw - 4, ph - 4);
    c.beginPath(); c.rect(ox + 2, oy + 2, pw - 4, ph - 4); c.clip();
    // wells as simple equal-potential circles
    c.strokeStyle = PAL.a('paper', 0.12); c.lineWidth = 0.4; c.beginPath();
    for (i = 0; i < bs.length; i++) {
      var b = bs[i]; if (b.orbit || b.mu <= 0) continue;
      var mr = b.kind === 'blackhole' ? (b.capture || b.r * 3) * 1.85 : b.r * 1.3;
      for (var k = 1; k < 8; k++) { var rr = b.mu / (k * PHI0); if (rr < mr) break; c.moveTo(ox + (b.x + rr) * s, oy + b.y * s); c.arc(ox + b.x * s, oy + b.y * s, rr * s, 0, TAU); }
    }
    c.stroke();
    // orbits
    c.strokeStyle = PAL.a('paper', 0.3); c.lineWidth = 0.4; c.setLineDash([0.6, 1.6]); c.beginPath();
    for (i = 0; i < bs.length; i++) { o = bs[i].orbit; if (!o) continue; c.moveTo(ox + (o.cx + o.rad) * s, oy + o.cy * s); c.arc(ox + o.cx * s, oy + o.cy * s, o.rad * s, 0, TAU); }
    c.stroke(); c.setLineDash(DASH_NONE);
    var nw = 0;
    for (i = 0; i < bs.length; i++) {
      Physics.bodyPos(bs[i], 0, P);
      if (bs[i].kind === 'wormhole') { thumbMouth(c, ox + P.x * s, oy + P.y * s, Math.max(2.6, bs[i].r * s), i); nw++; continue; }
      drawBodyArt(c, bs[i], i, ox + P.x * s, oy + P.y * s, s, lv.seed);
    }
    if (nw) thumbLetters(c, lv, ox, oy, s, pw, ph);
    // fragments, target, probe
    var fr = lv.frags || [];
    c.fillStyle = PAL.brass; c.beginPath();
    for (i = 0; i < fr.length; i++) { c.moveTo(ox + fr[i].x * s + 1, oy + fr[i].y * s); c.arc(ox + fr[i].x * s, oy + fr[i].y * s, 1, 0, TAU); }
    c.fill();
    var t = lv.target, tx = ox + t.x * s, ty = oy + t.y * s, tr = Math.max(2.5, t.r * s);
    c.strokeStyle = PAL.brass; c.lineWidth = 0.7; c.beginPath(); c.arc(tx, ty, tr, 0, TAU); c.stroke();
    c.lineWidth = 0.4; c.beginPath();
    for (j = 0; j < 12; j++) { var a = j * TAU / 12; c.moveTo(tx + Math.cos(a) * tr, ty + Math.sin(a) * tr); c.lineTo(tx + Math.cos(a) * (tr - 1.2), ty + Math.sin(a) * (tr - 1.2)); }
    c.moveTo(tx - tr * 0.5, ty); c.lineTo(tx + tr * 0.5, ty); c.moveTo(tx, ty - tr * 0.5); c.lineTo(tx, ty + tr * 0.5);
    c.stroke();
    x = ox + lv.probe.x * s; y = oy + lv.probe.y * s;
    c.fillStyle = PAL.vermilion; c.beginPath(); c.moveTo(x, y - 2.6); c.lineTo(x + 1.7, y); c.lineTo(x, y + 2); c.lineTo(x - 1.7, y); c.closePath(); c.fill();
    c.restore();
  }

  return { init: init, resize: resize, setLevel: setLevel, frame: frame, drawThumbnail: drawThumbnail, fx: fx, warp: warp,
           worldToScreen: worldToScreen, screenToWorld: screenToWorld, get layout() { return layout; }, get caption() { return capInfo; } };
})();
