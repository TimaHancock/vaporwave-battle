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
- **One scoped exception: the `--fx-*` effect palette.** Damage red, heal
  green, defend blue, haste yellow are *chosen*, because a number on screen
  for 900ms has to be understood instantly and the brand palette has no
  vocabulary for "healed". The fence is what keeps it from becoming a second
  palette: `.hud-float` **only** -- no surface, border, gauge or rule may
  reference one -- and it is mirrored into **neither** `battleScene.ts` nor
  `PALETTE` in `tools/prep_character.py`. That second one matters: that table
  is what the character-art adherence check scores against, so adding these
  would make off-brand pixels score as on-brand, the exact failure the check
  exists to catch. Card status badges keep the brand colours; the pop-up and
  the badge are tied by a shared glyph, not a shared hue, because one is an
  event and the other is state.
- **Display typeface: decided.** Orbitron (numbers) and Rajdhani (status
  words), latin subsets via Fontsource, in `--font-display` / `--font-label`.
  The split is numbers-versus-words, not one face per effect -- which effect
  it is comes from colour. **Both are SIL OFL, and that is a requirement:**
  ART_WORKFLOW.md records this as a commercial asset, so anything bundled
  must permit commercial use. Check the licence before swapping either.
- **No `Math.random()`.** Use `createRng()` from `src/rng.ts` only.
- **Every GPU resource goes in the `DisposalRegistry`.** Geometries,
  materials and textures leak otherwise, and this game restarts battles.
- **`data-testid` attributes are a contract** with the test suite. Renaming
  one is a breaking change. A float's testid says what it IS —
  `damage-number`, `heal-number`, `status-popup` — and they share the
  `.hud-float` class so one selector still finds every one of them, which is
  what the no-orphans assertion needs.
- **A value a test asserts on lives in `textContent`, and decoration is a
  `::before`.** Status badges, status pop-ups and the chain counter all follow
  this: the counter reads exactly `4`, not `CHAIN × 4`.
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

### Git

**`main` is the deploy branch.** A push to it runs
`.github/workflows/azure-static-web-apps.yml` and deploys to Azure, so work on
a branch and merge deliberately. The gates catch broken code; they cannot
catch half-finished code, which passes everything and still ships a
wrong-looking HUD.

Commit at verified checkpoints rather than per edit — the table above says
which gates apply to what, and a commit that has not passed them is not a
checkpoint. Pushing is the deploy decision and stays manual.

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
| `?floatMs=` | How long a damage number lives. Default 900. |
| `?hitStop=` | Freeze on a landed hit, ms. Default 70, **0 under `?time=`**; 0 disables. |

`?floatMs=` exists so the effect can be photographed at all: a number is gone
900ms after the hit, and `shoot.mjs` captures after the turn has settled. It
holds the element open without touching the timing of anything else — only how
long a number persists, never how long it takes to arrive.

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
- **The corridor is one expression doing three jobs.**
  `corridorHalfWidth(z) = max(sunWindowHalfWidth(z), ARENA_CLEARANCE)` in
  `scene/mountains.ts` is the channel the banks may not enter. **Near, the
  arena binds** — no seed can put rock behind a party member's shoulder.
  **Far, the sun binds** — the window overtakes the clearance around z −60.
  **In between the banks converge**, because a corridor constant in world
  units closes from 94% of the half-frame to 20%, and that convergence is
  the depth cue the old flat cutouts could not produce. Written as one `max`
  so it cannot be half-changed; a Vitest case walks 250 seeds to say the
  channel stays clear.
- **The sun's window is an ANGLE, not a distance.** `SUN_WINDOW_FRACTION` is
  the share of the frame's half-width the terrain may not close over, and
  `sunWindowHalfWidth(z)` converts it per depth. The terrain spans −4 to −85,
  so a gap fixed in world units would gape at the near end and shut over the
  sun at the far one. The value is measured against the disc, which spans
  ~0.22 of the half-width: at 0.34 the ridges cleared the sun entirely and
  read as unrelated shapes in the corners.
- **Terrain shading is BAKED VERTEX COLOUR, never a scene light.**
  `mountains.ts` hands back a 0..1 `shade` per vertex; `battleScene.ts` lerps
  `plum` → `ridge` across it. Lighting the backdrop with the rig would mean
  every future light change had to be judged against mountains as well as
  faces, and the rig is a contract with the *character art*.
- **The shading sun is LIFTED, and that is deliberate.** The real disc sits
  ~5° above a horizon 100 units out, which is grazing incidence on a
  heightfield: the dot against a near-vertical normal is ≈0 everywhere, the
  middle half of the field spanned 0.08 of the ramp, and the terrain came out
  as one flat value. `SUN_SHADING_POSITION` keeps the sun's **azimuth** — so
  "toward the light" is still "toward the corridor" on both banks without
  either knowing which side it is — and raises only its height. `SHADE_GAIN`
  then spends the ramp on the range gentle slopes actually produce.
- **Winding is side-dependent, and getting it wrong is SILENT.** A bank's
  columns run outward, so x increases along a row on the right bank and
  decreases on the left; one index order gives upward faces on one and
  downward on the other, and downward is backface-culled by a camera looking
  down at it. The triangles still submit and still count in `renderer.info`,
  so the shot looks like a shading bug — a wireframe hanging in the air with
  no rock under it. `terrainIndices` takes the side; a Vitest case asserts
  every triangle's normal points up on both banks.
- **The height envelope must top out INSIDE the frame.** A bank runs to 1.3×
  the frame half-width so it has no visible end, and ramping across that whole
  span put the tallest land 30% off screen — the valley read as two smooth
  berms with the peaks cropped off. `RAMP_FRACTION` reaches full height at 80%
  of the way to the frame edge and holds it from there.
- **Relief MULTIPLIES the envelope and is ridged, not additive and smooth.**
  Multiplying means the envelope decides how tall a place may be and the noise
  only decides where within that it lands, so no draw can spike a peak at the
  waterline or dig through the shore. Folding the value noise (`ridged()`)
  puts a crease at every midpoint crossing; plain value noise gives rolling
  dunes, and the crest is the whole silhouette against the brightest thing in
  frame.
- **Terrain depth and fog are one decision, more than before.** The banks run
  from inside `fog.near` out to `fog.far`, so fog is their entire near-to-far
  value range rather than the separation between three chosen depths. Move
  `scene.fog` and you have re-tuned the mountains whether you meant to or
  not. **And watch the sun** — it sets cleanly only because the water
  overtakes the disc above where the grid fades out, and fog moves the second
  of those. That is a screenshot check, not an assertion.
- **`PALETTE.ridge` is a value, not a new hue.** It is the LIT end of the
  terrain ramp; `plum` is the shadowed end. Rock shaded within plum alone was
  invisible — plum sits a few points off `void` and fog took what little was
  left — so the lattice floated with no mass under it. Same hue family, same
  warm bias; only the value moved, and it has to carry further than it looks
  because fog has taken half of it back by mid-frame.
- **There is NO neon lattice over the rock, and that was tried.** A
  `LineSegments` in `signal` built from `wireframeIndices` — which is still in
  `mountains.ts` and still tested. The argument for it was material continuity
  with the grid ocean; the argument against is what the shots showed, which is
  that the water already carries that language and a second net competing for
  it made the near banks read as mesh rather than rock. The baked shading
  does the form on its own. If it comes back: share the body's position
  attribute so the lines cannot drift off the surface, keep the opacity near
  0.16, and build it from `wireframeIndices`, never `WireframeGeometry` —
  that draws every triangle diagonal, tripling the line count and putting the
  triangulation on screen.
- **Both ends of the terrain are placed so the EDGE is not visible, by
  opposite means.** `TERRAIN_FAR_Z` sits at `fog.far`, so the last row has
  already dissolved to void. `TERRAIN_NEAR_Z` is in FRONT of the arena at
  z +4, where the frame is ~±3.6 and the corridor is 7.2 — the near rows are
  outside the view entirely and the bank appears to run off the bottom of the
  frame. Starting it at the first depth that shows any frame is the obvious
  choice and the wrong one: the row where land begins is then a straight
  diagonal out of the corner, and it reads as exactly what it is.
- **A bank must point OUTWARD at every row, and near the camera that is not
  automatic.** The outer edge is a multiple of the frame half-width, which
  shrinks toward the camera — and in front of the arena the frame is narrower
  than the corridor, so that multiple lands *inside* the channel and the bank
  is built inside out. Everything downstream follows: the corridor stops being
  clear and the triangles wind backwards and are culled. `MIN_BANK_WIDTH`
  floors it. Reads as a winding bug; is a bounds bug.
- **Stars are sized in pixels** (`sizeAttenuation: false`) and scattered
  across `frameHalfWidth(z)`, not an arbitrary span. With attenuation on, a
  star 130 units out projects to a fraction of a pixel and is simply not
  drawn; scattered over ±160 where the frame is ±67, four in five land off
  screen and the sky comes out empty.
- **The stage has hard bounds.** Platform top radius is 6;
  `PLATFORM_SAFE_RADIUS` is 5.2. `layoutParty()` auto-fits spacing so no
  party size can overflow, and `bossPosition()` rejects a boss past the lip
  -- do not bypass either by positioning sprites by hand. A sprite past the
  lip stands on nothing and its shadow floats.
- **A METAL WITH NO ENVIRONMENT MAP HAS NO DIFFUSE.** The single most useful
  thing learnt about this scene. A metallic surface shows you what it
  reflects; with nothing to reflect, `metalness: 0.8` means 80% of the
  material is inert and what you see is the 20% dielectric remainder catching
  the key light. That is why the old platform read as painted plastic, and it
  is not fixable by tuning `metalness` or `roughness` — those were being
  tuned against a different problem. `scene.environment` in `battleScene.ts`
  carries an equirect painted from the palette by `createEnvironmentTexture`.
- **`scene.environment` reaches EVERY `MeshStandardMaterial`** — dais,
  columns *and dice*. It is a scene-wide decision wearing a platform-shaped
  hat, and `envMapIntensity` per material is where each surface says how much
  of it it wants. The dice hold theirs low because they were tuned against
  the bloom threshold with no environment at all.
- **A metal's reflection is tinted by its own colour.** The deck at
  `PALETTE.chrome` could only ever be bright, whatever the environment did —
  it came out a cream sheet that outshone the cast. The deck is dark and the
  columns stayed chrome: a large field that should recede and a narrow
  vertical that can carry a highlight are different problems.
- **The deck is flat, so facets do nothing for it.** Every pixel of a
  horizontal plane reflects nearly the same direction under a locked camera,
  which is one value however it is lit. The circuit traces are what give it
  structure — *and* what the contact shadows darken. On an unmarked dark deck
  a dark shadow lands on nothing, which is how stage 1 briefly lost the
  grounding that stops flat art reading as pasted on.
- **Circuitry reads by being FINE.** The first trace pass was heavy enough to
  become the subject of the frame and made cyan its dominant colour — the
  exact thing the palette rule forbids. Density carries the motif, not
  weight.
- **Faceting costs you the inscribed radius.** A 16-gon of circumradius 6 is
  5.885 across at the middle of a face, so the usable deck is smaller than
  `PLATFORM_RADIUS` suggests. Cut it fine enough and a sprite at the safe
  radius stands over a notch in the polygon. `arena.test.ts` asserts the
  clearance rather than leaving it to look about right.
- **The dais is planted in the water, not resting on it.** It used to bottom
  out exactly at `HORIZON_Y`, which is why it read as a coin lying on a
  surface. The footing goes below; everything under the waterline is in dark
  water and costs nothing to be there.
- **Nothing may stand in front of the sun — including a column.** Columns
  spread evenly across the back arc put one dead centre at an odd count,
  splitting the disc. `columnIsClear` checks against `sunWindowHalfWidth`
  from `mountains.ts`, so the terrain and the arena obey one rule and moving
  `SUN_WINDOW_FRACTION` moves both.
- **Anything meant to be seen on a column has to be below about y 4.5.** The
  columns are 6.4 tall and run off the top of frame; a detail at 5.5 is about
  half a degree outside the fov and simply invisible.
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
- **A brightness flash on a sprite CANNOT work through `material.color`.**
  `applyHighlightRolloff` injects a luminance knee that holds every character
  pixel under `HIGHLIGHT_CEILING`, so the bloom pass never picks a character
  up — and it runs at `#include <map_fragment>`, *after* `material.color` has
  multiplied in. Scale the colour past 1 and the knee compresses it straight
  back down and the flash silently does nothing. The impact flash therefore
  tints (chroma survives the rolloff, which scales the RGB triple rather than
  clamping channels) **and** lifts `uHighlightCeiling` for its duration — a
  deliberate, temporary suspension of a rule that exists to stop *authored*
  rim lights smearing, not to forbid an impact frame. The uniform is handed
  back out of `applyHighlightRolloff` for exactly this.
- **Keep the flash's ceiling a hair over the bloom threshold**, not far over.
  At 1.0 against a 0.68 threshold the boss's whole upper body went white and
  the bloom pass smeared it into a blob with no drawing left in it. The tint
  multipliers compound with the ceiling rather than being capped by it.
- **Recoil moves `mesh.position`, NEVER `group.position`.** Four separate
  things read the group: `headScreenPosition`, `__debugState.sprites`, the
  "every sprite stands on the platform" test, and `assignRenderOrders`.
  Offsetting the group would make all four describe a character mid-flinch.
  It is also the truer model — a flinch is the character reacting, not the
  character's place on the stage changing — and the contact shadow, a sibling
  of the mesh, stays put and keeps the figure grounded while it staggers. The
  offset is published as `sprites[].recoil` because it is otherwise
  unverifiable: state and DOM are both right, and a screenshot of a 0.2-unit
  shift is a matter of opinion.
- **Hit-stop works by holding the scene clock still**, and every curve in
  `scene/impact.ts` is a function of age against that clock. So a freeze pins
  the flash at full strength for exactly as long as the game is stopped and
  keeps the stagger from starting until it releases. Freeze first, then move —
  the order hit-stop wants — with no sequencing anywhere. It is also why
  `?time=` can photograph the impact frame at all: a stepped clock leaves a
  reaction at age 0 forever.
- **A PAUSED ANIMATION NEVER RESUMES ITSELF.** Hit-stop pauses everything
  under `#hud` and `#floats` via `getAnimations({ subtree: true })`, and a
  freeze that fails to release leaves the interface stopped permanently —
  bars frozen mid-drain, numbers stuck, no way back but a reload. Strictly
  worse than not having the feature. Hence one owned timer rather than one
  per hit, a second hit that EXTENDS the deadline instead of nesting, and a
  resume in a `finally`. `e2e/hud.spec.ts` asserts nothing stays paused.
- **Hit-stop is OFF BY DEFAULT under `?time=`**, and that is a rule rather
  than a convenience. `?time=` means "render one frame and halt the clock",
  and hit-stop is a clock effect — on a halted clock its scene half does
  nothing at all and only the DOM half survives, freezing an interface nobody
  is animating. Leaving it on TRIPLED the e2e suite, because sixty-odd specs
  load with `?time=0` and every landed hit was paying for a pause with no
  visible half. An explicit `?hitStop=` still wins, which is how the specs
  that are about hit-stop reach it.
- **Hit-stop lengthens a CSS transition's wall-clock time**, because pausing
  is exactly what it does. Any test that waited a fixed duration for a bar to
  settle is now guessing; wait on `getAnimations()` reaching `finished`
  instead. One test had to change for this and it was the right change
  anyway.
- **Reduced motion switches hit-stop and the recoil OFF, and that is safe** —
  the opposite of the float layer, where `animation: none` would be a bug
  because removal rides on `animationend`. Nothing in hit-stop waits on an
  animation to finish. The flash stays: a colour changing in place is not what
  anybody means by motion.
- **Debug state is published off the render loop too.** In `?time=` step
  mode `drawFrame` runs once, so a snapshot built only there would freeze
  `isLocked` at its boot value while the UI carried on.
- **And so is the FRAME, now that the scene reacts to state.** `refresh()`
  redraws in step mode, at `currentTime` rather than a fresh clock read — so
  materials driven by `setMood` reach the screen while ambient animation
  stays frozen and a stepped frame stays reproducible. Without it every
  screenshot showed the arena at its opening value however the fight had
  gone, and the reactive layer looked broken when it was only unrendered.
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
  `stepMs=0` so the wait costs nothing. `settle` waits BETWEEN keypresses as
  well as after the last: the input lock drops a rejected keypress rather than
  queueing it, so two Enters fired back to back are one action and one
  discarded, and a two-turn shot silently becomes a one-turn shot.
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

**Phase 5 finished: floating combat numbers.** `src/ui/floatLayer.ts` renders
damage, criticals, heals and status pop-ups over the character they happened
to, plus the chain counter over the boss. What it rests on:

- **It is EVENT-driven, and deliberately not part of `renderHud`.** `renderHud`
  is a pure function of `HudModel` — render it twice, get the same HUD — which
  is what makes it safe to call on every keypress. A number is the opposite: it
  fires once, and "145 damage was dealt" is not recoverable from the state
  afterwards, only from the event. So `main.ts` diffs `view.log` by count (the
  same append-only trick the action log uses) and feeds `spawn`.
- **`#floats` is a SIBLING of `#hud`, and that is load-bearing.** `renderHud`
  calls `replaceChildren()` on its root to build the skeleton once, so a layer
  parked inside `#hud` is detached on the first render — and detached is worse
  than broken, because spawning carries on appending to a node nobody can see.
- **A float runs TWO animations.** A fixed 140ms arrival and the
  `--float-ms`-long rise. One keyframe ramping in over the first 15% is fine
  at 900ms and nonsense at `?floatMs=60000`, where the number spends nine
  seconds fading in. How long a number is *readable* and how long it takes to
  *arrive* are different questions and only the first should scale. Removal
  therefore ignores `animationend` for `hud-float-in` — a listener that fires
  on the first event it sees deletes every number 140ms after it appears.
- **Reduced motion must NOT switch the animation off.** Removal is driven by
  `animationend`, so `animation: none` means every number ever spawned stays
  in the DOM forever. The fade and the duration stay; only the travel goes.
  This is the one entry in that media block where `none` would be a bug.
- **`--float-rise` + `--float-drop` are bounded by the boss bar.** The boss's
  head projects to y 0.147 with the APOLLYON bar bottoming out near 0.09 —
  about 41px for the glyphs *and* the travel, which a 2.6rem critical
  overruns on its own. `--float-drop` starts the number below the head, over
  the chest, which is where the genre puts it anyway. The e2e test seeks the
  animation to 99% and measures there, because a resting box that clears the
  bar proves nothing.
- **Spacing is in the same units as the thing being spaced.** The fan offset
  for a second float on one target is `--float-stack-*` in **rem**, published
  as an index from the layer. It was once a fraction of the viewport added to
  the anchor, which silently stopped working when the glyphs doubled in size
  — the offset did not scale and two numbers landed on top of each other.
- **Web fonts must be `load()`ed, not merely awaited.** A browser fetches a
  face only when something on screen uses one, and at boot nothing does — so
  `document.fonts.ready` alone resolves instantly with nothing pending, and
  the first damage number renders in the fallback and reflows. `main.ts`
  calls `document.fonts.load()` for each face in `DISPLAY_FACES` first. That
  matters because the clearance test and every shot *measure*, and Orbitron's
  metrics are nothing like the monospace fallback's. `e2e/dist.spec.ts`
  asserts `document.fonts.check(...)` for the same reason: every other test
  passes happily against the fallback.
- **Numbers fan down-left; the chain counter hangs down-right.** Every landed
  hit spawns a number *and* bumps the chain, so those two share the screen
  almost permanently — in one column, one of them is always hidden. The fan is
  counted from floats currently ALIVE on that target, not from position within
  a commit: two turns in quick succession collide exactly as much as two hits
  in one turn.

**The scene is a valley now.** Two banks of 3D terrain flank a corridor of
water, starting in front of the arena at z +4 and running back to z −85 where
the fog has taken them; a stronger grid ocean runs down the floor and a
starfield sits above. Solid rock, shaded by baked vertex colour, with no line
work on it. The maths lives in `scene/mountains.ts` — pure, no three.js,
Vitest-covered, the same split `spriteLayout.ts` follows; `battleScene.ts`
only builds buffers from what it returns.

It was flat cutouts first — three silhouette curtains at fixed depths — on the
argument that a locked camera never moves to reveal they are flat. True, and
beside the point: flat was not a problem because it could be seen through, it
was a problem because three parallel cutouts read as painted flats in a
theatre. Land that runs continuously away from the viewer is a different
image, and no number of layers gets you there. What survived the rewrite is
the constraint — the sun's window — generalised from three chosen depths to
every row.

**The arena is a stage now.** A faceted dais of four tiers — deck, chamfer,
drum, footing — planted in the water, with a neon rim, circuit traces engraved
into the deck face, and a colonnade on an arc behind the fight. `scene/arena.ts`
is the pure module behind it, the same split `mountains.ts` follows:
`DAIS_TIERS`, `colonnadePositions`, `routeDeck` and `arenaEmission` are maths
and data; `battleScene.ts` builds meshes and rasterises.

It reacts to the fight. `arenaEmission` maps the chain and the boss's HP onto
how bright the neon runs and how far its colour has travelled from magenta
toward ember; `battleScene.setMood` applies it, fed from `refresh()` in
`main.ts` — the same choke point the HUD and the debug channel come from, so
the deck, the chain counter and the cards cannot describe different moments.
`CHAIN_FULL_BRIGHT` is 5 because that is what the game can actually reach: the
chain breaks the moment the party takes damage and the party is four.

A travelling shockwave ring on each hit was planned and **dropped**. The rim
and deck response already carry "the arena reacts", and they are pure
functions of state, which means every channel can see them. A ring is
time-driven, and step mode renders at a frozen time — so the one channel that
judges this work could not have judged it.

**Blows land now.** `scene/impact.ts` is the pure module: hit-stop duration
from a commit's events, the recoil curve, the flash curve, and which way a blow
throws its target. `sprite.ts` owns the reaction, `battleScene.ts` drives it off
the same clock as the dice, and `main.ts` owns the freeze — fired from the same
`view.log` diff that spawns the damage numbers, so a flinch and its number
cannot disagree about what landed.

The whole effect turns on one number, `HIT_STOP_MS`, and it is the one thing
here no channel can judge: 70ms is either impact or a dropped frame, and only
playing it tells you which. `?hitStop=` exists so that is cheap to try.

Not done, and the obvious next steps:

- **Circuit-trace clouds.** The site header has them; the scene does not. The
  most art-directed element left and the hardest to do procedurally. The deck
  markings are the same motif, so `routeDeck` in `scene/arena.ts` is the
  vocabulary to extend rather than a second one to invent.
- **The round/chain/phase strip.** The last unstyled region. `--font-display`
  and `--font-label` exist now, so it has faces to be styled with.
- **Per-enemy-turn granularity.** `advance` resolves every enemy turn in one
  call, so a boss turn narrates beat by beat but its HP change lands in a
  single commit. Splitting it needs a new entry point in `battle.ts`.

Use plan mode before: the damage-number/animation layer and the remaining
Phase 5 region passes.
