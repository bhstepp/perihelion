/* PERIHELION — shared constants & palette (owner: LEAD). FROZEN: do not change numeric values
   without the lead's approval; the baked campaign levels and their verified solutions depend on them. */
var K = {
  WORLD_W: 900,          // logical world units (portrait plate)
  WORLD_H: 1600,
  BOUNDS_MARGIN: 220,    // probe is "lost" once it is this far outside the world rect
  DT: 1 / 120,           // fixed physics step (120 Hz)
  MAX_STEPS: 1200,       // 10 s of simulated flight
  PREDICT_STEPS: 270,    // 22.5% of the flight (2.25 s) shown while aiming; was 420 (35%), then 180 (too little), now 270
  EPS2: 400,             // gravity softening, eps = 20 units
  PROBE_R: 6,            // probe collision radius
  FRAG_R: 24,            // comet fragment pickup radius
  DRAG_MAX: 300,         // world units of pull for full power (~120 CSS px on an iPhone)
  DRAG_CANCEL: 40,       // release with a pull shorter than this = cancel
  VMAX: 640,             // launch speed at full power (units/s)
  MAX_LAUNCHES: 3,
  TRAIL_MAX: 720,        // pooled trail ring size (points)
  WARP_GAP: 4,           // a probe leaving a wormhole appears this far outside the twin mouth's radius
  WARP_JUMP: 40,         // RENDER: two consecutive path points farther apart than this are a wormhole jump: never connect them
  HINT_MAX: 1100,        // max points of the astronomer's line (55% of a winning flight, or up to the last fragment on a full-clear course)
  MAX_STEPS_PER_FRAME: 16
};

var PAL = {
  ink: '#0E0D0B',        // background
  paper: '#EDE6D6',      // all line work
  graphite: '#2A2620',   // grid, faint marks
  vermilion: '#E4572E',  // probe, trajectory, danger
  brass: '#C9A45C',      // target, stars, success
  // same hues at an alpha — the ONLY way to vary tone. No other hues.
  a: function (name, alpha) {
    var h = PAL[name].slice(1);
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
};

var FONT = {
  sc: '"Cormorant SC", "Cormorant Garamond", Georgia, "Times New Roman", serif',   // small-caps titles
  serif: '"Cormorant Garamond", Georgia, "Times New Roman", serif',                // italic notes
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace'              // numbers
};

function toRoman(n) {
  var m = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  var s = '';
  for (var i = 0; i < m.length; i++) while (n >= m[i][0]) { s += m[i][1]; n -= m[i][0]; }
  return s;
}
