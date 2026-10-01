# PERIHELION — Contract v2 (addendum to CONTRACT.md)

Adds: 60 plates in two volumes, Daily Plate, Consult the Astronomer (hint), Observer's Log (stats and achievements),
two popup cards, and a shorter aiming line. Read `docs/CONTRACT.md` first; this file only lists what changes.
Build with `node tools/build.js`; bundle order is in `tools/build.js`.

## 0. Already done by the lead (do not redo)

- `K.PREDICT_STEPS` is now **180** (1.5 s, 15% of the 10 s flight; it was 420). Only the aiming preview changed.
  Baked plates and solutions are unaffected because they use full flights.
- `Physics.stepSim` now also tracks `sim.minGap` (closest distance to any non-repulsor body SURFACE, tracked only
  within 60 u, else Infinity) and `sim.dist` (path length in units). Flight numbers are bit-identical (golden test green).
- `src/50-save.js` is schema v2 (60 plates, `seen`, `daily`, `stats`, `ach`) with v1 migration. Read its header and
  return object for the API: `Save.seen/markSeen`, `Save.dateKey/dailyDone/recordDaily/dailyStreak`, `Save.bump/stat`,
  `Save.unlockAch/hasAch`, `Save.totals()` (now also `sealed`, `threeStar`). `Save.N` is 60.
- `src/55-log.js` (`Log`) and `src/56-logui.js` (`LogUI`) exist as no-op stubs and are in the build order.

## 1. Ownership (edit ONLY your files)

| Agent | Files |
|---|---|
| LEVEL | `src/20-levels.js`, `tools/levels-*.js` |
| RENDER | `src/30-render.js`, `tools/render-*.js` |
| FEEL | `src/60-main.js`, `src/shell.head.html`, `src/shell.body.html`, `tools/feel-*.js` |
| LOG | `src/55-log.js`, `src/56-logui.js`, `src/40-audio.js` (only to add `Sound.ach()`) |
| LEAD | everything else (`00-const.js`, `10-physics.js`, `50-save.js`, `tools/build.js`, docs, README, packaging) |

Other agents' files may be mid-edit when you build. If the build breaks in a file you don't own, wait a minute and
retry; never fix it yourself. Do not run `tools/qa-run.js` (the QA agent does, later).

## 2. State additions (`state` is owned by main.js, READ-ONLY for Render and Log)

```js
state.mode      // 'campaign' | 'endless' | 'daily'
state.daily     // null | { key: '2026-09-30', label: '30 SEP 2026' }   (mode === 'daily')
state.frozen    // bool: the astronomer holds the heavens: state.step does NOT advance while aiming
state.hint      // { on: bool, used: bool, pts: Float32Array(K.HINT_MAX * 2), n: Number, t0: ms }
                //   on: the brass line is shown (aim phase only); used: hint spent in this attempt;
                //   pts/n: the first part of the stored winning path, in world units
state.spotlight // null | [{x, y}]  world points to ring while a popup card is open (fragment card)
state.card      // null | 'intro' | 'fragments'   a popup card is open: aiming is blocked and the clock is held
```
`K.HINT_MAX = 700` (new constant in `00-const.js`). The hint reveals `floor(0.55 * n)` steps of the solution flight
(`n` = steps of the full winning flight), at most `K.HINT_MAX`.

Star rule: `stars = max(1, 4 - launchesUsed - (state.hint.used ? 1 : 0))`. One hint per attempt; Reset starts a new attempt.

## 3. Levels (LEVEL agent)

- `Levels.CAMPAIGN.length === 60`. **Plates 1–30 must stay byte-identical** (players have stars saved against them).
  Plates 31–60 (`c31`…`c60`, roman plates XXXI–LX) are baked the same way, verified the same way, and each has
  `solution: {vx, vy, t0Step: 0}`. Difficulty continues upward; they combine the EXISTING mechanics (planets, moons,
  binaries, black holes, repulsors, fragments) with more bodies, smaller targets and harder routes. No new body kinds.
- `Levels.VOLUMES = [{name:'Volume I', from:0, to:29}, {name:'Volume II', from:30, to:59}]`.
- `Levels.daily(dateKey)` → Level for a `'YYYY-MM-DD'` key. Deterministic; difficulty by weekday
  (Mon 0.30 → Sun 0.85 or similar); always has a verified `solution` with `t0Step: 0`;
  `level.id = 'd' + key`, `level.caption = 'DAILY · 30 SEP 2026'`, `level.plate = 'DAILY'`, `level.name` from the name pool.
  Budget as for `generate` (≤ 40 ms node, mean ≤ 12 ms).
- `Levels.generate` and the baked levels keep working as before.

## 4. Log hooks (LOG agent implements, FEEL calls)

```js
Log.event(name, data)    // never throws; may show a toast through LogUI. Names and payloads:
 'launch'      { mode, launchNo, power, hintUsed }
 'flightEnd'   { mode, level, launchNo, status, sim, hintUsed, fragsThisAttempt }
                 // status: 'hit'|'crash'|'captured'|'lost'|'timeout'; sim: the finished Sim (sim.minGap, sim.minDist,
                 // sim.step, sim.dist, sim.collected); called for EVERY flight, hit or not, before 'plateSealed'
 'plateSealed' { mode, level, plateIndex /* campaign index, else -1 */, stars, launches, hintUsed, fragsThisAttempt,
                 fragsTotal, endlessRound /* endless only */ }
 'hint'        { mode, level }
 'daily'       { key, stars, launches, streak, best, first }   // after Save.recordDaily
 'endlessRound'{ round, score }
```
`Log` also exposes `Log.snapshot()` → `{ totals, daily, achievements: [{id, name, blurb, unlocked, date}], stats }` and
`Log.ACHIEVEMENTS` (the list). `LogUI.open(onClose)` / `LogUI.close()` show and hide the full-screen Observer's Log;
`LogUI.toast(title, subtitle)` shows a small engraved banner (queued, auto-dismiss ~3 s, `pointer-events: none`).
LogUI builds its own DOM and injects its own `<style>`; it uses the CSS variables from `shell.head.html`
(`--ink --paper --graphite --vermilion --brass --sc --serif --mono --ease`). New sound: `Sound.ach()` (soft two-note
bell, quieter than `chime`). FEEL must guard every call with `typeof Log !== 'undefined'` style checks so a missing
module never breaks the game.

## 5. Popup cards (FEEL agent)

Two atlas-style cards (DOM, same look as the existing result card; buttons are small-caps hairline rectangles).
While one is open: `state.card` is set, aiming is blocked, the physics clock and any timers are held.
- **Intro** ("How to play"), shown once, the first time any plate loads (`Save.seen('intro')`):
  title "To Observe"; four numbered lines: (1) "Touch anywhere and pull back, as if drawing a sling." (2) "Release to launch. The probe flies opposite your pull; a longer pull is faster." (3) "Gravity bends every course, and only the first moments of yours are drawn. Judge the rest." (4) "Reach the brass ring. Fewer launches earn more stars: one launch, three stars." Button "Begin".
- **Fragments**, shown once, the first time a plate with fragments loads (`Save.seen('fragments')`; any mode):
  title "Comet Fragments"; text "Small brass comets drift on this plate. Fly through one to collect it. They are optional, but a course that gathers them is a harder one. Fragments you collect stay collected across your launches on this plate." Button "Understood".
  While it is open `state.spotlight` holds the fragment positions so Render rings them; the card sits on the half of the
  screen away from the fragments.
- Both can be reopened later from the Menu sheet ("How to play", "About comet fragments").

## 6. Daily Plate (FEEL agent)

Title menu gets **Daily Plate** with a small italic subline: not sealed today → "Today's plate"; sealed →
"Sealed ★★★ · streak 4". `state.mode = 'daily'`, `Levels.daily(Save.dateKey())`, three launches, same star rule.
On success: `Save.recordDaily`, `Log.event('daily', …)`; the result card shows the streak and "A new plate is engraved
tomorrow." with Replay / Menu (no Next). On a fail card: Retry plate / Menu. Retrying is allowed; stars keep the best.

## 7. Consult the Astronomer (FEEL agent, Render draws)

Menu sheet item "Consult the Astronomer" with the note "Costs one star. Holds the heavens and shows the first part of a
winning course." Enabled only during `aim` on a plate with `level.solution`, when `!state.hint.used`. On use:
close the sheet, `state.step = solution.t0Step || 0`, `state.frozen = true`, compute the hint path with
`Physics.simulate(level, sol.vx, sol.vy, sol.t0Step || 0, K.MAX_STEPS, buf)`, keep the first 55% (≤ `K.HINT_MAX`),
`state.hint = {on: true, used: true, …}`, `Log.event('hint')`. Frozen means moving bodies stand still and the prediction
uses the frozen step. On launch: `state.frozen = false`, `state.hint.on = false`. The result card notes "Astronomer
consulted: one star forfeited". Timers driven by `state.step` must not stall while frozen (use a separate tick).

## 8. Render additions (RENDER agent)

- Prediction: only 180 steps now; retune dot spacing and the end fade so it still reads as a short, elegant dotted stub.
- Astronomer's line: when `state.hint.on`, a dotted BRASS line along `state.hint.pts[0..n)` (brass, not vermilion;
  slightly larger dots than the prediction), fading toward its end, with a tiny italic label near its start:
  "the astronomer's line". While `state.frozen`, show a small italic note in the bottom readout band instead of the
  speed readout: "the heavens are held". (While a pull is being held, the speed/power readout takes priority.)
- Spotlight: when `state.spotlight`, draw an engraved dashed ring (paper, low alpha, slow rotation) around each point,
  radius ~ 2.2 × `K.FRAG_R`, with a fine leader tick, so the fragment card can point at the comets.
- Caption: `level.caption` already wins over the built caption; keep it working for `DAILY · …`. Daily plates and the
  Astronomer note must fit on one row or the existing two-row HUD.
- HUD stars: when `state.hint.used`, the top-right potential stars drop by one (as for a failed launch).
- Thumbnails must stay fast with 60 plates (`Render.drawThumbnail`).

## 9. Test hooks added to `window.__peri` (FEEL)

`openCard(name)`, `closeCard()`, `useHint()`, `loadDaily(dateKey?)`, `Log`, `LogUI`, `Save`. All 60 plates load
through `loadLevel(i)`. Nothing may be hard-coded to 30 plates: use `Levels.CAMPAIGN.length` and `Save.N`.

## 10. Addendum: full-clear courses

`Levels.CLEAR[i]` (baked by `tools/levels-clear.js`, verified by `--verify` and `npm test`) holds `{vx, vy, t0Step}` for every campaign plate with fragments: one launch that hits the target and collects every fragment (`null` for plates I-III). `Levels.clearFor(level)` returns it for a baked plate, else `null`. The hint draws `clearFor(level) || level.solution`; on a full-clear course it reveals `max(55%, last fragment + 24 steps)`, capped at 92% of the flight and `K.HINT_MAX` (now 1100). The CAMPAIGN lines and `level.solution` are unchanged, so the golden hashes still hold.
