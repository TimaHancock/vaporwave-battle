# Project conventions

Turn-based JRPG boss battle. HD-2D: 3D primitive environment, 2D sprite
characters, DOM interface. One arena, one boss, one locked camera.

## Architecture

- All UI is real DOM layered over the canvas. **Never render text or menus
  inside three.js.** The DOM is the primary verification channel.
- Battle logic in `src/battle/` must not import three.js or touch the DOM.
  It is pure functions over state, tested by Vitest in milliseconds.
  `sequencer.ts` is the one thing there that is not pure -- it exists to
  spread a resolved turn out over time -- but it is still DOM-free, and its
  pause is injected so tests run at zero delay.
- The renderer and UI read `BattleState` and never write to it. The only
  writer is the sequencer, and it writes only by calling `takeAction` and
  `advance`.
- Menu cursor state lives in `src/ui/menu.ts`, never in `BattleState`. It is
  pure, so the whole menu is Vitest-testable; Playwright only checks that
  the rendering and the key handler agree with it.

## Non-negotiable rules

- **Renderer:** `WebGLRenderer`. Do not migrate to WebGPU.
- **Camera is locked:** position `(0, 3.2, 11)`, target `(0, 1.6, 0)`,
  fov `32`, perspective. Do not change without explicit instruction.
- **Key light is a contract:** front-left, `(-4, 6, 6)`, ~40 deg elevation.
  Sprites use `MeshBasicMaterial`, so scene lights never touch them --
  lighting is painted into the art. That agreement is authoring discipline,
  not something the renderer enforces. If you change a light, change the
  image-generation prompt in `public/characters/README.md` too.
- **Sprites are `MeshBasicMaterial`.** Do not "fix" this by switching to a lit
  material. A flat plane has uniform normals, so a light produces no shape
  across it -- it would only wash out the authored rim lights.
- **Palette is sampled from the site design, not chosen.** The dark ground is
  warm plum (R > B), not cool indigo. Cyan is a thin line accent only -- it
  is absent from the site's dominant colours.
- **No `Math.random()`.** Use `createRng()` from `src/rng.ts` only.
- **Every GPU resource goes in the `DisposalRegistry`.** Geometries,
  materials and textures leak otherwise, and this game restarts battles.
- **`data-testid` attributes are a contract** with the test suite. Renaming
  one is a breaking change.
- Coordinate convention: Y-up, -Z into the screen.

## Commands

| After changing | Run |
|---|---|
| battle logic | `npm run test` |
| UI / DOM | `npm run e2e` |
| anything visual | `npm run shots`, then read the PNGs |
| asset paths, or anything build-shaped | `npm run build && npm run e2e:dist` |
| before committing | `npm run verify` |

`npm run dev` must be running for `shots`. `e2e` and `e2e:dist` start their
own servers — but `e2e:dist` serves `dist/`, so build first or it tests the
previous build.

## Verification

Four channels, each with one job:

- `npm run test` — Vitest, pure logic. Fast. Most bugs live here.
- `npm run e2e` — Playwright DOM assertions. Exact UI state.
- `npm run shots` — screenshots + `shots/*.json` state dumps. Visual only.
- `npm run e2e:dist` — the **built output**, via `vite preview`. Run in CI
  between build and deploy.

`shots/<name>.json` reports draw calls, triangles and GPU allocations
alongside each PNG. If a PNG is black but draw calls are non-zero, the
problem is lighting or camera, not loading.

**The first three all run against the dev server, and that is a structural
blind spot, not an oversight.** Vite injects the stylesheet as a `<style>`
element inside the document in dev, and bundles it to a real file at
`/assets/index-*.css` in the build — so anything whose behaviour depends on
how a path resolves, or on minification and tree-shaking, is invisible to
them. The HUD portraits shipped blank to Azure with all three green.
`e2e:dist` exists for exactly that gap and should stay small: anything
assertable against the dev server belongs in `e2e/hud.spec.ts`, where it is
faster to run and easier to debug. A test that would pass in dev is not
earning its place in `dist.spec.ts`.

### URL parameters

| Param | Effect |
|---|---|
| `?seed=` | Battle and scene randomness. Default 1337. |
| `?time=` | Render one frame at this simulated time, then halt. |
| `?stepMs=` | Sequencer pause between beats. Default 350. Enemy beats are `ENEMY_BEAT_MULTIPLIER`× this. |
| `?bossHp=` | Override boss max HP **and** HP. For the victory e2e test. |

`?bossHp=` shortens the boss rather than the pauses, so the e2e victory run
still exercises real turn timing. The two lock tests go the other way and
*lengthen* `stepMs`: browser round-trip latency under a parallel run can
otherwise outlast a default-length turn, and the third keypress would land
on a legitimately unlocked battle.

## Known traps

- **Sprite transparency sorting.** three.js sorts transparent objects by
  bounding-sphere distance, which is unstable for billboards at similar
  depths -- sprites intermittently punch rectangular holes through each
  other. Handled by `alphaTest` (restores depth writes) plus explicit
  `renderOrder` from `assignRenderOrders()` (deterministic sequence).
  Do not create a sprite without a render order.
- **Rectangular halo around a sprite** means the source PNG has
  near-zero-but-not-zero alpha across its background. Raise `alphaTest`
  toward 0.5. If fine detail is being eaten instead, lower it.
- **Never put a relative `url()` inside a CSS custom property.** A `url()`
  that reaches CSS through `var()` has two candidate bases -- the document,
  and the stylesheet the `var()` is *used* in -- and browsers disagree about
  which wins. Chromium picks the stylesheet. In dev both are the document, so
  it looks fine; in the build `./characters/kira.png` becomes
  `/assets/characters/kira.png` and every portrait goes blank. Resolve with
  `new URL(path, document.baseURI).href` before writing the property, which
  is the base `THREE.TextureLoader` already uses for the same string.
  `applyPortrait` in `src/ui/hud.ts` is the one place this happens.
- **A missing asset can arrive as a cheerful 200.** A host with a navigation
  fallback -- `vite preview`, and Azure for any path not covered by the
  `exclude` list in `staticwebapp.config.json` -- answers a bad path with
  `index.html`. An `<img>` or a `background-image` pointed at HTML fails
  exactly like a 404, silently. Assert `content-type`, not just status;
  `e2e/dist.spec.ts` does, and a status-only check would have shipped this.
- **A 1:1 sprite size** in `__debugState.sprites` means the texture had not
  decoded when the sprite was built. Await the loader first.
- **Grounding:** every sprite gets a contact shadow, or flat art reads as
  pasted onto the scene. Shadows use `depthWrite: false` and a lower
  `renderOrder` than sprites.
- **The stage has hard bounds.** Platform top radius is 6;
  `PLATFORM_SAFE_RADIUS` is 5.2. `layoutParty()` auto-fits spacing so no
  party size can overflow, and `bossPosition()` rejects a boss past the lip
  -- do not bypass either by positioning sprites by hand. A sprite past the
  lip stands on nothing and its shadow floats.
- **Composition is party-left, boss-right.** Party of 4 via `layoutParty`,
  boss via `DEFAULT_BOSS_PLACEMENT`. The e2e suite asserts both halves; a
  scene with no boss used to pass the left-half check on its own.
- **Composition is authored for 16:9.** The camera's fov is vertical, so
  horizontal coverage shrinks as the window narrows. Check any layout change
  against `CANONICAL_ASPECT`; the e2e suite pins its viewport to match.
  Narrower aspects clip the outermost party member -- known, tracked as the
  mobile layout question.
- **Coplanar geometry z-fights.** The contact shadow sits at `y = 0.012`,
  not `0`, for this reason.
- **The input lock must be set synchronously.** `Sequencer.submit` sets it
  before any `await`. Move that behind a yield and three keypresses in one
  task all pass the check, queueing three attacks. A rejected submit is
  dropped, never deferred -- a replayed keypress fires against a state the
  player never saw.
- **`takeAction` throws on an illegal action**, so `src/ui/menu.ts` is
  responsible for never producing one. `menuOptions` disables anything
  illegal and `moveCursor` skips disabled entries, so the cursor cannot get
  somewhere `confirm` would have to refuse. A closure test walks every
  reachable path and asserts `takeAction` accepts the result.
- **Debug state is published off the render loop too.** In `?time=` step
  mode `drawFrame` runs once, so a snapshot built only there would freeze
  `isLocked` at its boot value while the UI carried on.
- **Enemy beats are slower than player beats**, by
  `ENEMY_BEAT_MULTIPLIER` (3×), and an enemy turn opens with a line naming
  who is acting. A player beat confirms something they chose and were
  watching for; an enemy beat is the first they hear of it, arriving at the
  tail of their own turn's narration. At an equal pause and with no
  announcement, the boss's attack reads as a flicker and the player sees
  their HP has dropped without seeing it drop. It is a multiplier, not a
  fixed duration, so `?stepMs=0` still means instant everywhere.
- Azure free tier caps the site at 250 MB. Compress textures (KTX2) and
  meshes (Draco). Check bundle size when adding assets.

## Current phase

**Phase 3 complete: the battle is playable through the DOM.** A full fight
runs end to end on the keyboard -- arrows move the cursor, Enter confirms,
Escape backs out -- and reaches victory.

The chain is `keydown` → `ui/menu.ts` (pure) → `Action` →
`battle/sequencer.ts` → `takeAction`/`advance` → `toHudModel` → `renderHud`,
with `publishDebugState` fed from the same view so the DOM and
`__debugState.battle` can never describe different moments.

**Phase 5 complete: the HUD is built.** Party cards along the bottom, a
portrait turn-order bar top-left with the action log beneath it, and a
cascading command menu bottom-left. Only the round/chain/phase strip is
still bare.

**Characters play differently now.** `battle/classes.ts` maps a `ClassName` to
an attack name and a skill list; `battle/skills.ts` is the flat table those ids
resolve against. The classes mirror the art in `CHARACTER_PROMPTS.md` -- kira
knight, neo wizard, vex rogue, lyra artificer, apollyon aberration -- so
changing one there means changing it here. Facts worth knowing:

- **Skills compose the resolver's three primitives** (`power`+crit, `heal`,
  `status`) and nothing else. A skill needing a fourth is a change to
  `actions.ts` first and a table entry second.
- **The menu is where a class boundary is enforced.** `takeAction` will happily
  resolve any skill for any actor; `menuOptions` is what stops a knight
  casting Repair Field.
- **The boss has exactly one skill on purpose.** `chooseEnemyAction` takes two
  rng draws, and a pick over a longer list would add a third and reroll every
  seeded fight, screenshot baselines included.
- **The current command is `panels[n].cursor`, and the menu cascades.**
  `menuPanels` derives the parent panels from `MenuState` rather than storing
  a stack. Only the active panel gets `aria-current`; a parent's chosen row is
  `data-chosen`, or the menu reports being in two places at once.

`renderHud` **builds its skeleton once and updates in place.** It used to
`innerHTML = ''` and rebuild, which is why the boss bar's `transition: width
400ms` never animated -- a new element has no previous width to transition
from. Regions are created on first call and cached against the root in a
`WeakMap`; only lists whose length varies with state (turn order, menu options)
still rebuild their children. If you add a region, follow that shape or its
bars will not animate either.

Card facts worth knowing before changing them:

- **Portraits are CSS crops of the sprite PNGs**, not separate art. The focus
  numbers are in `src/ui/portraits.ts`, derived from measured alpha bounds --
  the prep tool normalises feet-to-bottom but not head-to-top, so they cannot
  be one shared rule. Re-prepped art silently invalidates them; the
  `party_cards` shot is how you notice.
- **`--card-strip` is not free to grow.** Party feet project to screen y 0.743
  at 16:9, and a taller strip covers the contact shadows.
- **Cyan marks the active card, magenta the idle ones.** Deliberately that way
  round: the scene is magenta-dominant, so a magenta highlight vanishes into
  it. Cyan is still only a rule plus its bloom, never a fill.
- **The cards and the turn tiles SHARE their state rules**, via grouped
  selectors (`.hud-card, .hud-turn`). One question, one visual language --
  splitting them apart is how the two regions drift.
- **`turnOrder` is a RING, not a preview.** The round's queue rotated so the
  active actor leads, each living actor once. That makes the last entry the
  actor who went immediately before the leader — which is what lets the
  carousel show one portrait split across the seam, half-dissolving off the
  left edge as "just went" and half-dissolving in at the right as "next loop".
- **The carousel's geometry is load-bearing.** Window is `N × pitch`, the
  track is `N + 2` tiles where tile `i` shows ring position `(i - 2) mod N`,
  and the resting offset is `-(tile/2 + pitch)`. The two extra tiles sit off
  the left edge so the slide has something to bring in. Get the width wrong
  and the split portrait becomes two unrelated crops.
- **The slide never snaps back.** The track always renders the current ring
  already at rest; `track.animate` only makes it *arrive*, running from
  `rest + pitch` to `rest` with `composite: 'add'`. It finishes at the resting
  style, so there is nothing to undo. Pitch is **measured** off two tiles —
  an unregistered custom property computes to its literal `calc()`, so
  reading `--turn-pitch` back would give `NaN` and silently skip the animation.
- **The turn highlight is a fixed cursor**, not a state on a tile. It frames
  the "now" slot and the portraits rotate underneath it. The window is grown
  by `--turn-bleed` top and bottom or `overflow: hidden` shaves the reticle
  down to two vertical bars.
- **A HUD shot wants `scale`, not a bigger `viewport`.** The DOM is sized in
  rem, so enlarging the frame renders the same tile into more pixels of frame
  and makes it *smaller*. `viewport` is for scene shots like `boss_closeup`.
  A shot can also carry `keys: [...]`, played after ready and before capture,
  which is how `command_menu` gets a menu two levels deep. Keys that SUBMIT
  an action need `settle: true` as well, or the capture photographs the turn
  mid-flight at a different beat every run — `action_log` pairs it with
  `stepMs=0` so the wait costs nothing.
- **DOM-only e2e specs load with `?time=0`.** That renders one frame and halts
  the animation loop. Headless Chromium has no GPU, so the scene rasterises in
  software at 135-200ms a frame, and leaving the loop running made the suite
  three times slower and intermittently timeout. The HUD stays fully live --
  `publishDebugState` is fed from `refresh()` as well as from the loop.
- **`--card-scale-active` is bounded by the strip's gap.** The active card
  grows by `transform`, so half the extra width crosses into its neighbour.
  At 1280 the 16px gap leaves 8.5px of clearance; raising the scale without
  raising the gap makes the cards overlap, and an e2e test says so.
- **A status badge's glyph is a `::before`**, so it stays out of `textContent`
  and `actor-<id>-statuses` still reads exactly `DEF_UP`.
- The **boss's** `actor-apollyon*` testids live in a screen-reader-only strip.
  They cannot go under the boss bar: the head-clearance test measures that
  element's box and there is ~20px of headroom.

**The narration is the action log now.** The single-line box above the
command menu is gone; `buildLog` renders the history top-left, under the
carousel and the status strip, newest at the bottom. A line held for one beat
was survivable for a player action they chose and were watching for, and not
for an enemy turn — the boss acts three beats deep into narration the
player's attention has already left. What the log rests on:

- **`SequencerView.history` ends on `narration`, always.** That invariant is
  why the `narration` testid can ride the log's newest line and every
  assertion in `e2e/battle.spec.ts` still means what it did. `narrate()`
  writes both in one statement, and `sequencer.test.ts` checks it on every
  emitted view.
- **`history` is uncapped so an index into it stays valid**, which is what
  lets `buildLog` append only what it has not yet rendered rather than
  rebuild — a rebuilt list has no previous opacity, so the age ramp would
  snap. The DOM is capped instead, at `LOG_LINES`.
- **The fade is an age ramp, not a mask.** `mask-image` on the container
  would make it a *backdrop root*, and every `backdrop-filter` inside would
  have nothing left to blur. A per-line `data-age` fades a whole line rather
  than cutting through the middle of one. The per-line right-edge mask is
  fine — an element's own `backdrop-filter` still samples the page.
- **`--log-height` is bounded by Kira's head** at screen y 0.369, the mirror
  of the `--card-strip` / 0.743 rule. The stack is bottom-anchored so that
  edge is a constant; an e2e test reads the head from `__debugState.sprites`
  rather than hardcoding it, so re-laying out the party fails loudly.

Not done, and the obvious next steps:

- **The round/chain/phase strip.** The last unstyled region. The display
  typeface is still an open decision.
- **The damage-number layer.** The seam is ready: a sprite's `name` is its
  `ActorId`, so a `damage` event's `targetId` resolves to a sprite and
  `headScreenPosition()` gives the anchor.
- **Per-enemy-turn granularity.** `advance` resolves every enemy turn in one
  call, so a boss turn narrates beat by beat but its HP change lands in a
  single commit. Splitting it needs a new entry point in `battle.ts`.
- **Sprite reactions.** Nothing on the canvas moves when an actor is hit.

Use plan mode before: the damage-number/animation layer and the remaining
Phase 5 region passes.
