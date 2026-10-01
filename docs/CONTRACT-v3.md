# PERIHELION — Contract v3 (addendum to CONTRACT.md and CONTRACT-v2.md)

Adds: the **wormhole** body, Volume III (plates LXI–XC, 30 new plates that use it), a longer aiming line, and the silent-switch revert.
Read `docs/CONTRACT.md` and `docs/CONTRACT-v2.md` first; this file only lists what changes. Build with `node tools/build.js`.

## 0. Already done by the lead (do not redo, do not edit)

- `K.PREDICT_STEPS` is now **270** (2.25 s, 22.5% of a flight; it was 420, then 180). Preview only; nothing baked depends on it.
- New constants in `src/00-const.js`: `K.WARP_GAP = 4`, `K.WARP_JUMP = 40`.
- `src/10-physics.js` implements wormholes (see section 1) with selfTest checks. `tools/physics-golden.json` is unchanged and
  green: every flight that has no wormhole is bit-identical to before. **Never edit physics.**
- `Save.N` is **90** (shorter saved arrays are padded with zeros on load, so existing saves migrate). `Save.totals()` covers 90 plates.
- `tools/fixtures-wormhole.json` (written by `tools/make-wormhole-fixtures.js`): three complete Level objects with verified solutions
  that pass through wormholes: `fw1` (one pair, no turn), `fw2` (two pairs, turns of +-90 degrees), `fw3` (black hole, a pair whose
  second mouth orbits, two fragments). Use them for development and tests until the baked plates exist.

## 1. The wormhole body (PHYSICS, implemented)

```js
{ kind: 'wormhole', r: 32, mu: 0, x, y, orbit: null | {cx, cy, rad, omega, phase},   // a mouth may ride rails like a moon
  pair: <index of the twin in level.bodies>,                                        // mutual: bodies[a].pair === b && bodies[b].pair === a
  turn: <radians> }                                                                  // applied when ENTERING this mouth (default 0)
```
- Mouths are inert: `mu` is 0 (no gravity), they never crash the probe, they are not a "near miss" (`sim.minGap` ignores them).
- When the probe centre comes within `r` of a mouth at the end of a step it leaves by the twin: speed is kept, the velocity is rotated
  by `turn` (positive = clockwise ON SCREEN, because y points down), and the probe appears at
  `twinCentre(t) + heading * (twin.r + K.WARP_GAP)`, so it cannot re-enter at once. A twin on rails is evaluated at the current time.
- `sim.warps` counts passages; `sim.events` gets `{type:'warp', from, to, step}` (`from`/`to` are body indices, `step` is `sim.step`).
  Consumers clear `sim.events` as they already do for fragments.
- **Path discontinuity rule:** two consecutive points of any path (`Physics.simulate/predict` output, `state.hint.pts`, the live trail,
  `state.result.pts`) that are farther apart than `K.WARP_JUMP` (40 units; a real step is at most about 12) are a wormhole jump.
  Renderers must not connect them.
- Author rules for plates: `r` 24-38; the twin's centre at least 150 units from the entry mouth; `turn` values are 0 or multiples of
  pi/4, opposite signs on the two mouths of a pair so a round trip is the identity; keep every mouth's exit point (twin centre +
  (r + 4) in any direction the solution uses) at least 30 units clear of other bodies and the world edge.
- Pair labels (shown by RENDER): pairs are numbered in order of the lower body index of each pair: alpha, beta, gamma, delta.

## 2. Ownership (edit ONLY your files)

| Agent | Files |
|---|---|
| LEVEL | `src/20-levels.js` (only: add 30 CAMPAIGN lines, extend `VOLUMES`, nothing else), `tools/levels-*.js` except `tools/levels-clear.js`, new `tools/levels-bake3.js` |
| RENDER | `src/30-render.js`, `tools/render-*.js` |
| FEEL | `src/60-main.js`, `src/shell.head.html`, `src/shell.body.html`, `tools/feel-*.js` |
| LOG | `src/55-log.js`, `src/56-logui.js`, `tools/log-test.js` |
| AUDIO | `src/40-audio.js` only (report any test lines that need changing; do not edit tools/) |
| LEAD | everything else (`00-const.js`, `10-physics.js`, `50-save.js`, `tools/build.js`, `tools/levels-clear.js`, `tools/qa-*.js`, docs, README, packaging) |

Other agents' files may be mid-edit when you build; if the build breaks in a file you do not own, wait a minute and retry, never fix it.
Do not run `tools/qa-run.js`. The machine has 2 cores: keep CPU-heavy work to what you need.

## 3. RENDER

- **Mouths** (`kind === 'wormhole'`), engraved in the existing five colours only. Each is an aperture of radius `r`: an outer hairline ring
  in paper, two or three inner broken concentric rings rotating in opposite directions, fine spiral hatching toward the centre in
  graphite/paper, light from the upper left like everything else. No fills beyond hatching, no glow. No gravity contours (mu is 0).
  The static part (outer ring, hatching) may sit in the static layer; the rotation is on the animated layer, cheap at 4x CPU throttle.
- **Pair mark:** the same small italic serif Greek letter (alpha, beta, ...) beside both mouths of a pair, placed where it never
  collides with the ring, the target, the plate border or the HUD. When `turn !== 0` also print, under the letter, a tiny mono note:
  a clockwise arrow glyph and the angle, e.g. `↻ 90°` (positive turn) or `↺ 90°` (negative), meaning "entering this mouth turns your
  heading by this much". Both mouths show their own turn.
- **Warp effect:** `Render.warp(x0, y0, x1, y1)` (new; world units, entry and exit points) starts a short flash at both ends: expanding
  paper rings that fade in about 350 ms plus a few sparks, consistent with the existing burst effects. No-op if effects are off.
- **Path breaking:** the aiming prediction, the astronomer's line, the live trail and the post-flight replay must all stop at a jump
  (section 1) and start again after it, including the dot spacing state. A fade toward the end of a path still fades the last segment.
- **Spotlight:** entries of `state.spotlight` may carry `r` (world units) to set the ring radius; default stays `2.2 * K.FRAG_R`.
- **Thumbnails** (`Render.drawThumbnail`) draw mouths simply (ring plus the letter) and stay fast with 90 plates.
- Test with `tools/fixtures-wormhole.json` through `tools/render-harness.js`, including a live flight that warps, at 4x CPU throttle.

## 4. FEEL

- **Card `wormholes`** (DOM, same look as the fragments card), shown once the first time a plate that contains a wormhole loads
  (`Save.seen('wormholes')`; queued after `intro`/`fragments` if those are also due; any mode). Title "Wormholes". Text: "Wormholes come in
  pairs, marked with the same Greek letter. Fly into one and you leave by its twin at the same speed. A mark such as ↻ 90° means your
  heading turns that far as you pass through. They pull on nothing and do no harm." Button "Understood". While open `state.spotlight`
  holds every mouth as `{x, y, r: mouth.r + 14}` (current position: mouths on rails move, so refresh it each frame or use the start pose).
  The card sits on the half of the screen away from the mouths, like the fragments card.
- Menu sheet: "About wormholes" (reopens the card), shown only when the current plate has a wormhole.
- Atlas: Volume III section (`Levels.VOLUMES`), 90 plates, unlocked in order like the rest; thumbnails stay lazy. Nothing may assume 60.
- Live flight: for each `sim.events` entry of type `warp` call `Render.warp(...)` (guard `typeof Render.warp === 'function'`),
  `Sound.warp()` (guard), a short `navigator.vibrate` where available; then clear the events like fragment events.
- Test hook `window.__peri.loadCustom(level)`: loads any Level object as a plate in campaign-like play (aiming, launching, result card,
  hint if `level.solution`, cards) with `state.levelIndex = -1`; it must not write to `Save` and must not emit `plateSealed`.
- Star rule, hint, Daily and Endless are unchanged. `level.solution` and `Levels.clearFor(level)` work the same for wormhole plates.

## 5. LOG

- `flightEnd` already carries the finished `sim` (`sim.warps`). Add stats and honours (follow the existing style, names in the same
  engraved voice, blurbs one line):
  - `first_gate` "Through the Gate": seal a plate with a flight that warped at least once.
  - `double_gate` "Twice Through": seal a plate with a single flight that warped at least twice.
  - `gate_keeper` "Keeper of the Gates": ten sealed flights that warped (counted lifetime).
  - `cartographer_90` "Cartographer of the Third Volume" (seal all 90 plates), `volume_three` (seal every plate of Volume III; same rule as
    `volume_two`). Read `Levels.VOLUMES`/`Save.N` instead of hard-coding 60, and review `perfectionist` and the other plate-count
    honours for the new size; keep their meaning for players who already own them (never lock a held honour).
  - Stat `warps` (total passages): count them on every `flightEnd`, hit or not; show it in the log totals if the layout has room.
- Update `tools/log-test.js` and keep it green.

## 6. AUDIO

- **Revert the silent-switch workaround.** Remove the keep-alive silent `<audio>` element, the silent WAV data URI, `primeSession()` and the
  `navigator.audioSession = 'playback'` assignment, and anything else that exists only to make sound play while the iPhone ringer switch
  is on silent. The game must behave like a normal Web Audio page: with the ringer switch on silent, iPhone plays nothing. Keep: unlock on
  the first real gesture (touchend/click, never pointerdown), `resume()` retries per gesture, `suspend/resume` on visibility, the in-game
  mute toggle, and `Sound.ach()`. Sound must still work on iPhone with the switch off, and in desktop Chromium.
- Add `Sound.warp()`: a short soft sweep (about 0.35 s, a falling then rising tone with a faint filtered noise breath), quieter than
  `bell`, no clicks, safe to call before unlock and while muted (no-ops).
- Keep the module's public shape otherwise unchanged. Report which lines of `tools/*.js` tests mention the keep-alive / audioSession.

## 7. LEVEL: Volume III

- 30 new plates `c61`..`c90` (`index` 60..89, `plate` LXI..XC), appended to `CAMPAIGN` after Volume II, same line format, each
  with `solution: {vx, vy, t0Step}` and 2-3 fragments. `Levels.VOLUMES` gets `{name:'Volume III', from:60, to:89}`. The 60 existing
  lines stay byte-identical (Volume I is pinned by `tools/levels-golden.json`; also pin Volume II there). `Levels.daily`, `generate`
  and Endless are untouched (their hashes stay the same). Generator code for Volume III lives in `tools/` only and is not shipped.
- Every plate has at least one wormhole pair, and the stored solution must pass through a wormhole (`sim.warps >= 1`). Progression:
  LXI-LXVI one stationary pair, no turn, few other bodies (the lesson); LXVII-LXXII one pair with a planet or moon and turns of
  +-90 or +-45 degrees; LXXIII-LXXVIII a mouth on rails, black holes or repulsors near a mouth; LXXIX-LXXXIV two pairs (chains: the
  solution uses both on some plates); LXXXV-XC two pairs plus moons, black holes and repulsors, small targets. The difficulty field
  continues upward from Volume II (d > 1.6). Plates must be interesting: the route should make the player think about where the
  exit leads, not just "aim at the mouth".
- Verification rules (extend `levels-bake.js --verify`, or a new verify in `levels-bake3.js` wired into it so one command checks all 90):
  solution hits in one launch and is robust (at least 8 of 9 neighbouring shots hit, as for the older plates); a straight shot at the
  target misses; moving-mouth plates stay solvable at several launch times; the plate cannot be beaten by a robust shot that never
  warps; author rules of section 1; clearances hold; 2-3 fragments, positioned so that a launch collecting all of them and hitting the
  target exists (the lead runs `tools/levels-clear.js` afterwards and will send back any plate that has none).
- Plate names: new, none reused, in the register of the earlier ones (observatory, optics, 19th-century astronomy and engraving).
- Bake with at most 2 worker processes (2 cores), resumable cache in `tools/levels-cache/`.
