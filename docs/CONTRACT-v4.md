# PERIHELION — Contract v4 (addendum to CONTRACT.md, CONTRACT-v2.md and CONTRACT-v3.md)

Adds two natural phenomena, the **nebula** (Volume IV, plates XCI–CXX) and the **pulsar** (Volume V, plates CXXI–CL), 60 new
plates, and a larger page budget. Read the earlier contracts first; this file lists only what changes. Build with `node tools/build.js`.

## 0. Already done by the lead (do not redo, do not edit)

- `src/10-physics.js` implements both bodies (sections 1 and 2) with selfTest checks. `tools/physics-golden.json` is unchanged and green:
  every flight without a nebula or pulsar is bit-identical to before. **Never edit physics.**
- `Save.N` is **150** (shorter saved arrays are padded with zeros on load). `Save.totals()` covers 150 plates.
- The QA page budget is now **480 KiB** (was 400 KiB).
- `tools/fixtures-v4.json` (written by `tools/make-v4-fixtures.js`): four complete Level objects with verified solutions:
  `fn1` (a static nebula, planet, two fragments), `fn2` (a nebula on rails and a static one), `fp1` (a pulsar, two fragments),
  `fp2` (a pulsar, a nebula and a wormhole pair). Use them for development and tests until the baked plates exist.
- Volumes IV and V are baked by the lead (`tools/levels-bake45.js`); `Levels.VOLUMES` will gain
  `{name:'Volume IV', from:90, to:119}` and `{name:'Volume V', from:120, to:149}`. Until then CAMPAIGN has 90 plates. **Nothing may assume 90
  or 150**: read `Levels.CAMPAIGN.length`, `Levels.VOLUMES` and `Save.N`.

## 1. The nebula body (PHYSICS, implemented)

```js
{ kind: 'nebula', r: 60..170, mu: 0, x, y, orbit: null | {cx, cy, rad, omega, phase},   // may drift on rails like a moon
  drag: 0.3..1.4 }                                                                      // per second
```
- A cloud of dust and gas. Inert to gravity (`mu` 0), never crashes the probe, not a near miss (`sim.minGap` ignores it).
- While the probe centre is inside the disk (radius `r`, positions at the start of the step) its velocity is multiplied by
  `1 - drag * K.DT` every step: it bleeds speed (about `exp(-drag)` per second inside). A slower probe bends harder round everything.
- Nebulae may overlap other bodies' areas (a planet can sit inside a cloud); bodies are drawn over the cloud.
- `sim.fog` counts steps spent inside any nebula; `sim.inFog` is the index of the nebula the probe is in now (-1 = none);
  `sim.events` gets `{type:'fog', i, step}` each time the probe ENTERS a nebula (from outside every nebula).

## 2. The pulsar body (PHYSICS, implemented)

```js
{ kind: 'pulsar', r: 10..16, mu: 0.8e7..3e7, x, y, orbit: null,
  beam: { omega: <rad/s, +-0.3..1.1>, phase: <rad>, half: <half-width, rad, 0.06..0.16>, reach: 260..560, push: 500..1600 } }
```
- A spinning neutron star: it pulls like a planet (ordinary softened gravity with `mu`), and touching it crashes the probe like a planet
  (`r + K.PROBE_R`; it IS a near miss body).
- Two opposite beams sweep round it: axis angle `phase + omega * t` (t = absolute time, `abs * DT`, like moons; positive omega =
  clockwise on screen because y points down) and the opposite direction. A probe whose centre is within `reach` of the pulsar centre and
  within `half` radians of either beam axis is pushed straight away from the pulsar with acceleration `push` (units/s^2), added in
  `Physics.accel`. Outside the beams, a pulsar is just a small heavy planet.
- `sim.beams` counts beam entries; `sim.inBeam` is the index of the pulsar whose beam holds the probe now (-1 = none);
  `sim.events` gets `{type:'beam', i, step}` on each entry.
- The beam axis at time t: `a = beam.phase + beam.omega * t; ux = cos(a), uy = sin(a)`; the two beams run from the centre along
  `(ux, uy)` and `(-ux, -uy)` to `reach`, as wedges of half-angle `half`.

## 3. Ownership (edit ONLY your files)

| Agent | Files |
|---|---|
| LEAD | everything not listed below (`00-const.js`, `10-physics.js`, `20-levels.js`, `50-save.js`, `tools/levels-*.js`, `tools/build.js`, `tools/qa-*.js`, docs, README, packaging) |
| RENDER | `src/30-render.js`, `tools/render-*.js` |
| FEEL | `src/60-main.js`, `src/shell.head.html`, `src/shell.body.html`, `src/40-audio.js`, `tools/feel-*.js` |
| LOG | `src/55-log.js`, `src/56-logui.js`, `tools/log-test.js`, `src/native/ios-native.js`, `tools/make-gamecenter.js`, `tools/ios-test.js`, `ios/` Game Center sheet/docs |

Other agents' files may be mid-edit when you build; if the build breaks in a file you do not own, wait a minute and retry, never fix it.
Do not run `tools/qa-run.js` or the level bakers. Keep CPU-heavy work small: the lead is baking levels on the same machine.
Do not commit; the lead commits.

## 4. RENDER

- **Nebula** (`kind === 'nebula'`), engraved in the five colours only, no fills beyond hatching/stipple, no glow: a cloud of fine stipple
  dots (paper at low alpha, denser toward the centre, a few wisps of curved hatching) inside radius `r`, with an irregular soft edge,
  plus the true boundary as a fine dotted hairline circle at exactly `r` so the player can read where the drag begins. Static nebulae
  belong in the static layer; one on rails is pre-rendered once to an offscreen sprite and blitted on the animated layer (cheap at 4x
  CPU throttle). Draw nebulae BEFORE (under) every other body, the target and fragments. No gravity contours (mu is 0).
- **Pulsar** (`kind === 'pulsar'`): a small dense hatched sphere (like a tiny planet, a bright paper core ring), ordinary gravity contours
  (it has mu), and its two beams on the animated layer: each a long narrow wedge from the star out to `reach` with half-angle `half`,
  drawn as two paper hairlines with sparse cross-hatching between them fading toward the tip, at the angle given by section 2 at the
  current time. A faint dotted graphite circle at `reach` shows how far the beams carry. The beams must rotate smoothly and match
  physics exactly at `state.step` (use `beam.phase + beam.omega * t` with the same t the moons use).
- **Effects:** `Render.fog(x, y)` (a soft puff of stipple dots that drift and fade in about 500 ms) and `Render.beam(x, y)` (a brief
  paper flash with a few radial sparks, about 250 ms), world units, consistent with `Render.warp`. No-ops if effects are off.
- **Hint / spotlight:** unchanged; spotlight entries may carry `r` (used by the cards for big nebulae).
- **Thumbnails** (`Render.drawThumbnail`): a nebula as a dotted circle with a few dots; a pulsar as a dot with two short beam strokes
  at its t=0 angle. Stay fast with 150 plates.
- Test with `tools/fixtures-v4.json` through `tools/render-harness.js`, including a live flight through a nebula and a beam, at 4x CPU
  throttle; check light/dark look matches the plate style.

## 5. FEEL (+ AUDIO)

- **Card `nebulae`**, same look as the wormholes card, shown once the first time a plate with a nebula loads (`Save.seen('nebulae')`;
  queued after the other cards if those are due; any mode). Title "Nebulae". Text: "Nebulae are clouds of dust and gas. They pull on
  nothing and do no harm, but while you are inside one you lose speed, and a slower probe bends more sharply round everything else."
  Button "Understood". Spotlight: every nebula as `{x, y, r: nebula.r + 10}` (current position).
- **Card `pulsars`**, likewise for the first plate with a pulsar (`Save.seen('pulsars')`). Title "Pulsars". Text: "A pulsar is a
  spinning neutron star. It pulls like a small planet and is just as solid. Two beams sweep round it, and a beam that catches the probe
  pushes it straight away from the star, so when you launch matters as much as where." Spotlight: every pulsar as `{x, y, r: 60}`.
- Menu sheet: "About nebulae" / "About pulsars", shown only when the current plate has one (like "About wormholes").
- Atlas: Volume IV and Volume V sections from `Levels.VOLUMES`, unlocked in order like the rest; thumbnails stay lazy; works with 90
  or 150 plates in CAMPAIGN. Review every place that assumes 90 (or 60) plates.
- Live flight: for each `sim.events` entry of type `fog` call `Render.fog(x, y)` and `Sound.fog()`, for `beam` call `Render.beam(x, y)`
  and `Sound.beam()` (guard every call with `typeof ... === 'function'`), a short `navigator.vibrate` for `beam`; then clear the events.
  The hint replay / any code that re-simulates flights handles the new kinds (no special path breaks: nebulae and beams never jump).
- `window.__peri.loadCustom(level)` must work for the fixtures (cards, aiming, launching, result).
- **AUDIO** (`src/40-audio.js`): `Sound.fog()`: a soft filtered-noise hush (about 0.5 s, low-passed, quieter than `warp`).
  `Sound.beam()`: a short bright tick with a quick decay (about 0.12 s, like a distant pulsar click). Both safe before unlock and while
  muted (no-ops), no clicks, the public shape otherwise unchanged.
- Update `tools/feel-test.js` to cover the cards, menu items, events and Atlas sections; keep it green.

## 6. LOG

- `flightEnd` already carries the finished `sim` (`sim.fog`, `sim.beams`). Add stats and honours in the existing engraved voice:
  - `into_the_veil` "Into the Veil": seal a plate with a flight that passed through a nebula (`sim.fog > 0`).
  - `becalmed` "Becalmed": seal a plate with a single flight that spent at least 2 s inside nebulae (`sim.fog >= 240`).
  - `lighthouse` "By the Lighthouse": seal a plate with a flight that a pulsar beam pushed (`sim.beams > 0`).
  - `beam_rider` "Riding the Beam": seal a plate with a single flight caught by pulsar beams at least twice (`sim.beams >= 2`).
  - `volume_four`, `volume_five` (seal every plate of that volume; same rule as `volume_three`),
    `cartographer_120` "Cartographer of the Fourth Volume" and `cartographer_150` "Cartographer of the Fifth Volume" (seal that many
    plates). Read `Levels.VOLUMES`/`Save.N`, never hard-code; review `perfectionist` and other plate-count honours for 150 plates and
    keep their meaning for players who already hold them (never lock a held honour). A volume or cartographer honour whose plates do
    not exist yet (CAMPAIGN shorter) must not unlock.
  - Stats `fog` (total steps in nebulae; shown as seconds) and `beams` (total beam catches), counted on every `flightEnd`, hit or not;
    show them in the log totals if the layout has room.
- Game Center: add the new honours to `tools/make-gamecenter.js` and the iOS native mapping, keep `tools/ios-test.js` green.
- Update `tools/log-test.js` and keep it green.

## 7. LEVEL (lead): Volumes IV and V

- 30 plates `c91`..`c120` (index 90..119, XCI..CXX) with at least one nebula each, and 30 plates `c121`..`c150` (index 120..149,
  CXXI..CL) with at least one pulsar each, appended after Volume III (whose lines are then pinned in `tools/levels-golden.json`).
- As baked (`tools/levels-bake45.js`, verified by `--verify`, which `npm test` runs): every stored solution hits and uses its volume's
  mechanic (Volume IV: >= 0.1 s inside a nebula; Volume V: caught by a beam at least once), as do >= 6 of its 9 robust neighbours; it
  is robust (8 of 9 neighbours hit); Volume IV solutions miss with the drag taken away; no strong shot (>= 7 of 9 neighbours hitting)
  avoids the mechanic at t = 0 or at the solution's launch time (beams turn and clouds drift, so waiting for an opening is fair play);
  straight shots miss (Volume V: at t = 0 and at >= 85% of launch times); time-dependent plates (rails, every pulsar) pass the Volume III
  launch-time window rule with any robust winning shot (>= 70% of 0.5 s launch times open, no closed gap over 2.5 s); 2-3 fragments
  with a full-clear course. Plates on the plate rows that resisted these rules were simplified (fewer moons, a planet instead of a
  black hole, slower beams) rather than the rules loosened further.
- Progression IV: one static cloud (the lesson) -> clouds that make a slingshot tighter -> clouds near black holes and repulsors ->
  drifting clouds on rails -> clouds with wormholes. V: one slow pulsar -> faster beams and planets -> pulsars with moons/black holes ->
  two pulsars -> pulsars with nebulae and wormholes, small targets.
