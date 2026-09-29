# PERIHELION — Shared Contract (v1)

> **Historical design document.** This is the contract the lead agent wrote so that four sub-agents (physics, levels,
> render, input & feel) could build their modules in parallel, plus a QA agent afterwards. It is kept because it is
> still the most compact description of the module interfaces, the state shape and the visual spec. Where the
> shipped code differs (for example `Sound.unlock(cb)` now takes an optional callback, and `Levels` exports a few
> extra helpers), the code wins. Ignore the parts about agents, ownership and "LEAD STUBS".

A gravity-slingshot puzzle game for iPhone Safari, shipped as ONE self-contained HTML file.


## 1. File layout & ownership

One HTML file is assembled by `node tools/build.js` from `src/` in this exact order. Every JS module is a plain
script (no ES modules, no imports). Each module exposes ONE global declared with `var` (so node tests can load it via `vm`).

| File | Global | Owner |
|---|---|---|
| `src/00-const.js` | `K`, `PAL`, `FONT`, `toRoman()` | LEAD (frozen) |
| `src/10-physics.js` | `Physics` | PHYSICS AGENT (core numeric code frozen, see §4) |
| `src/20-levels.js` | `Levels` | LEVEL AGENT |
| `src/30-render.js` | `Render` | RENDER AGENT |
| `src/40-audio.js` | `Sound` | INPUT & FEEL AGENT |
| `src/50-save.js` | `Save` | INPUT & FEEL AGENT |
| `src/60-main.js` | (IIFE; exposes `window.__peri` test hooks) | INPUT & FEEL AGENT |
| `src/shell.head.html` | `<title>`, font links, `<style>` | INPUT & FEEL AGENT |
| `src/shell.body.html` | DOM markup (canvas + menus) | INPUT & FEEL AGENT |
| `tools/*` | build/test tooling | anyone may ADD files; don't edit others' |

Rules: edit ONLY files you own. Other modules currently hold LEAD STUBS with the correct interface — code against
the interface, not the stub internals. If you need an interface change, don't make it: note it in your final report.
Build outputs: `dist/perihelion.html` (standalone full doc) and `dist/perihelion.artifact.html` (host-wrapped variant:
no doctype/html/head/body; the host adds charset + `viewport-fit=cover` viewport and pads `:root` by safe-area insets —
our CSS must neutralise that padding: `:root{padding:0!important}` and position the game `fixed; inset:0`).
Node: `const G = require('./tools/load.js')` gives `G.K, G.PAL, G.Physics, G.Levels` (isolated vm context).
Browser QA uses Playwright (`npm install`, then `npx playwright install chromium`). Google Fonts may not load in
headless runs, so the fallback fonts must look good too.

Hard budgets: total file < 300 KB. No external assets except the Google Fonts stylesheet already in the shell head.
No `alert/confirm/prompt`, no `window.open`, no downloads. Everything must work with localStorage throwing.

## 2. World & coordinates

- World is a fixed portrait plate `K.WORLD_W × K.WORLD_H` = 900 × 1600 units, origin top-left, y down.
- Probe start is near the bottom (y ≈ 1350–1480), target near the top (y ≈ 140–420). Bodies in between.
- The probe is lost when it leaves the world rect expanded by `K.BOUNDS_MARGIN` (220).
- Screen mapping is owned by Render: `Render.worldToScreen`, `Render.screenToWorld` (CSS px).

## 3. Data schemas

```js
Body = {
  kind: 'planet' | 'moon' | 'blackhole' | 'repulsor',
  r: Number,              // collision/visual radius (world units)
  mu: Number,             // gravitational parameter; NEGATIVE for repulsor
  x: Number, y: Number,   // fixed position (ignored if orbit != null)
  orbit: null | { cx, cy, rad, omega, phase },   // on-rails motion: angle = phase + omega*t (t in seconds)
  capture: Number,        // blackhole only: capture radius (> r)
  pair: Number | undefined// binary pairs share a pair id (render may draw a faint barycentre mark)
}
// A moon orbiting a fixed planet uses orbit.cx/cy = that planet's x/y. A binary = two bodies with
// the same orbit centre & rad-ratio, phases differing by PI (kind 'planet', same pair id).

Level = {
  id: 'c01'..'c30' | 'e<seed>', index: Number, seed: Number, difficulty: 0..1,
  name: 'The Binary',     // title-case; caption is `PLATE ${toRoman(index+1)} · ${name.toUpperCase()}`
  plate: 'XIV',           // roman numeral string (campaign index+1; endless: round number)
  probe: { x, y },
  target: { x, y, r },    // success when probe centre is within r
  bodies: Body[],
  frags: [{ x, y }],      // optional comet fragments (0–3)
  solution: { vx, vy, t0Step } | null   // a verified 1-launch hit (for QA & hints); t0Step usually 0
}
```

## 4. Physics (frozen numeric core — `src/10-physics.js`)

Semi-implicit Euler at 120 Hz. Forces use body positions at `abs*DT` (start of step); collision tests use positions
at the end of the step. Softening `EPS2 = 400`. Absolute step counter `abs` (integer) drives all moving bodies:
`t = abs * K.DT` — never accumulate floating time. A flight launched at level step `S` uses `createSim(level,vx,vy,S)`.
The live game advances `state.step` by exactly one per physics step, in lockstep with `stepSim`, so moons drawn at
`state.step` are where physics thinks they are.

Interface (already implemented; PHYSICS AGENT hardens/tests, must keep results bit-identical):
- `Physics.bodyPos(body, t, out)`
- `Physics.accel(level, x, y, t, out)`
- `Physics.launchVelocity(dragDx, dragDy)` → `{cancel, vx, vy, power}`; drag = pull vector (finger − touchStart) in WORLD units.
  Slingshot: velocity is opposite the drag. `|drag| < K.DRAG_CANCEL` ⇒ cancel. Power linear up to `K.DRAG_MAX`.
- `Physics.createSim(level, vx, vy, t0Step)` → sim `{x,y,vx,vy,t0Step,abs,step,status,hitBody,collected,minDist,events}`
- `Physics.stepSim(sim, level)` → status: `'flying'|'hit'|'crash'|'captured'|'lost'|'timeout'`.
  Order per step: fragments → body collisions (blackhole capture first) → target → bounds → timeout (`K.MAX_STEPS`=1200).
  Fragment pickups push `{type:'frag', i}` onto `sim.events` (consumer clears it).
- `Physics.simulate(level, vx, vy, t0Step, maxSteps, outPts?)` → sim with `.n`
- `Physics.predict(level, vx, vy, t0Step, outPts)` → first `K.PREDICT_STEPS` (420 = 35%) of the SAME flight.
- `Physics.speed(sim)`
- `Physics.selfTest()` → `{ok:Boolean, checks:[{name, ok, detail}]}` — runs in browser and node; must prove
  predicted points === live-stepped points (exact float equality) on several levels incl. moving bodies and t0Step≠0.

## 5. Levels (`src/20-levels.js`)

- `Levels.mulberry32(seed)` → rng() in [0,1)
- `Levels.CAMPAIGN` — 30 BAKED level objects (data literal, generated offline by the level agent's node tool from
  fixed seeds, each with a verified `solution`). Baking avoids running solvers on the phone at startup.
- `Levels.generate(seed, difficulty)` → Level (used by Endless at runtime). Must internally verify solvability with a
  FAST solver (budget ≤ 150 ms on a phone ≈ ≤ 40 ms in node; coarse grid, early exit on first hit) and retry with
  derived seeds if unsolvable. Deterministic for a given (seed, difficulty).
- `Levels.solve(level, opts)` → `{vx, vy, angle, power}` | null.
- Introduce mechanics: planets (1–), fragments (~4–), moons (~6–), binaries (~10–), black hole (~14–), repulsor (20–).

## 6. Game state (owned by main.js; READ-ONLY for Render)

```js
state = {
  screen: 'title' | 'select' | 'play',
  paused: false,
  mode: 'campaign' | 'endless',
  level: Level, levelIndex: Number,
  step: 0,                          // absolute fixed-step counter since level start (moons: t = step*K.DT)
  phase: 'aim' | 'flight' | 'result',
  aim: { active:false, dx:0, dy:0, power:0, vx:0, vy:0, cancel:true },  // dx,dy = pull vector finger − touchStart (world units)
  predict: { pts: Float32Array(K.PREDICT_STEPS*2), n: 0 },               // recomputed each frame while aiming
  sim: null | Sim,                  // live flight
  trail: { pts: Float32Array(K.TRAIL_MAX*2), head: 0, n: 0 },            // pooled ring; newest at head-1
  ghosts: [ {pts: Float32Array, n} ],    // earlier failed launches this attempt (every 3rd point), max 2
  launches: 0,                      // launches used this attempt (0..3)
  collected: Uint8Array,            // fragments collected this attempt (persist across launches)
  result: null | { success, stars, status, pts: Float32Array, n, at: ms },   // pts = full winning/losing path
  hud: { speed: 0, closest: Infinity },   // units/s ; closest approach to target (units)
  endless: { round: 0, score: 0, best: 0 }
}
```

## 7. Render (`src/30-render.js`)

- `Render.init(canvas)`; `Render.resize(cssW, cssH, dpr, safe{top,right,bottom,left})` (dpr already capped at 2).
- `Render.layout` → `{w,h,dpr,scale, plate:{x,y,w,h}, top:{x,y,w,h}, bottom:{x,y,w,h}}` in CSS px.
  Plate = world fitted with `scale = min((w−24)/900, (h−safe.top−safe.bottom−112)/1600)`, centred horizontally,
  a 56 px band above (top HUD) and below (bottom HUD).
- `Render.setLevel(level)` — pre-render all static layers to offscreen canvases (grid, star crosses, contour wells,
  hatched fixed bodies; moving bodies as pre-rendered sprites blitted each frame).
- `Render.frame(state, nowMs)` — draws the whole canvas incl. canvas HUD. Must not allocate per frame in hot paths.
- `Render.drawThumbnail(ctx2d, level, w, h)` — miniature plate for the level-select grid (static, t=0).
- `Render.fx.crash(x, y)`, `Render.fx.success(pts, n)`, `Render.fx.reset()` — effects (hatched burst + ~4 px shake;
  brass re-inking of the winning path, then a brass seal that stamps in with overshoot).
- `Render.worldToScreen(x,y)`, `Render.screenToWorld(px,py)` → `{x,y}`.
- HUD zones: TOP band — left: `LAUNCH 2 / 3` (small caps), centre: plate caption, right: stars (3 small engraved
  stars, brass when earned). BOTTOM band — centre 50%: mono readouts `v 412 u/s · closest 38 u`. The bottom-left
  and bottom-right 25% are reserved for DOM buttons (main.js). Nothing on the canvas may sit under those buttons.

## 8. Visual style — "Observatory Plate" (strict)

A 19th-century astronomical engraving printed on dark paper, drawn with modern precision.
- Palette ONLY: ink `#0E0D0B` bg, paper `#EDE6D6` line work, graphite `#2A2620` grid/faint marks,
  vermilion `#E4572E` probe/trajectory/danger, brass `#C9A45C` target/stars/success. Tone variation only via alpha of
  these hues (`PAL.a(name, alpha)`). No gradients except a very subtle paper-grain noise. No glow, no bloom, no shadows.
- Line art, not fills: planets = ivory outline + parallel hatching clipped to the circle, denser on the shadow side;
  one light direction for the whole game: light comes from the UPPER-LEFT (shadow toward lower-right).
  Gravity wells = faint concentric contour rings (topographic) spaced by mass. Black hole = dense spiral hatching.
  Repulsor = dashed outward rings. Moons = small hatched discs + faint dotted orbit path. Binary = two hatched bodies
  + faint shared orbit + tiny barycentre cross.
- Probe = small vermilion diamond with a fading ink trail. Prediction = dotted vermilion line, one dot every few steps
  so dot spacing grows with speed. Target = brass ring with engraved tick marks (compass bezel), slowly rotating.
  Fragments = tiny brass comet glyphs (a dot with 3 fine tail strokes).
- Background: faint graphite coordinate grid with tiny degree labels at the plate edges (mono, graphite/paper at low
  alpha), sparse star field of tiny crosses (+). A thin double-rule plate border like an engraved plate mark.
- Type: `FONT.sc` (Cormorant SC) for titles/captions with letter-spacing ~0.12em; `FONT.serif` italic for notes;
  `FONT.mono` (JetBrains Mono) for numbers. Wait for `document.fonts.ready` before pre-rendering text.
- Motion: ease everything (easeOutCubic/easeOutBack). Crash: short hatched burst + ~4 px screen shake (≤ 250 ms).
  Success: path re-inked in brass over ~600 ms, then brass seal stamps in with slight overshoot.
- Menus (DOM, owned by feel agent) use the SAME tokens/fonts and read like pages of the same printed atlas:
  hairline double rules, small-caps headings, roman numerals, italic marginal notes. No rounded "app" buttons,
  no emoji, no drop shadows — buttons are small-caps text inside hairline rectangles.

## 9. Input, flow, audio, save (feel agent)

- Aim: touch/pointer down ANYWHERE on the screen (outside DOM buttons) starts aiming; the pull vector is
  `finger − touchStart` converted to world units (so the thumb never covers the probe). Render draws the affordance
  AT THE PROBE: a thin paper line from the probe along the pull (length = pull, clamped to `K.DRAG_MAX`), a power arc,
  and a dashed cancel ring of radius `K.DRAG_CANCEL` around the probe. Release with pull < `K.DRAG_CANCEL` ⇒ cancel. Prediction updates every frame while aiming (moons move).
- Launch → flight; on end: 'hit' ⇒ result success, stars = 4 − launchesUsed; otherwise crash fx, a ghost path is
  kept, probe resets; after 3 failed launches ⇒ result fail (Retry). Fragments collected persist within an attempt.
- Endless: rounds of `Levels.generate(randomSeed, min(1, round/25))`; score = sum of stars; run ends on a failed
  round; best saved.
- Sound (`Sound.*`): unlock(), setMuted(b), droneStart(), droneSpeed(s01), droneStop(), chime(), thump(), pluck(),
  tick(), launch(power). All Web Audio synthesis; nothing plays before the first user gesture.
- Save (`Save.*`): localStorage key `perihelion.v1`, every access in try/catch, in-memory fallback.
  `{ v:1, stars:[30], frags:[30], unlocked:Number, endlessBest, muted }`.
- iOS: no scroll/zoom/selection (`touch-action:none`, `user-select:none`, `-webkit-touch-callout:none`, prevent
  `gesturestart` and multi-touch), respect safe areas via `env(safe-area-inset-*)`, handle resize/rotation,
  pause on `visibilitychange`, dpr capped at 2, 60 fps (fixed-step accumulator, ≤ `K.MAX_STEPS_PER_FRAME` per frame).
- `navigator.vibrate` guarded (feature-detect, try/catch).

## 10. Test hooks (REQUIRED, main.js) — `window.__peri`

`{ state, Physics, Levels, Render, loadLevel(i), loadEndless(seed), launch(vx, vy), fastForward(nSteps),
   solveCurrent() /* uses level.solution */, fps() /* rolling avg */, screen(name) }`
QA will drive the game only through these hooks and real touch events.
