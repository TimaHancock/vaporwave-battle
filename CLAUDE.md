# Project conventions

Turn-based JRPG boss battle. HD-2D: 3D primitive environment, 2D sprite
characters, DOM interface. One arena, one boss, one locked camera.

## Architecture

- All UI is real DOM layered over the canvas. **Never render text or menus
  inside three.js.** The DOM is the primary verification channel.
- Battle logic in `src/battle/` must not import three.js or touch the DOM.
  It is pure functions over state, tested by Vitest in milliseconds.
- The renderer and UI read `BattleState` and never write to it.

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
| before committing | `npm run verify` |

`npm run dev` must be running for `shots`. `e2e` starts its own server.

## Verification

Three channels, each with one job:

- `npm run test` — Vitest, pure logic. Fast. Most bugs live here.
- `npm run e2e` — Playwright DOM assertions. Exact UI state.
- `npm run shots` — screenshots + `shots/*.json` state dumps. Visual only.

`shots/<name>.json` reports draw calls, triangles and GPU allocations
alongside each PNG. If a PNG is black but draw calls are non-zero, the
problem is lighting or camera, not loading.

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
- Azure free tier caps the site at 250 MB. Compress textures (KTX2) and
  meshes (Draco). Check bundle size when adding assets.

## Current phase

**Phase 1 complete: battle logic with no UI.** `src/battle/` holds the whole
rules engine -- `turnOrder.ts`, `status.ts`, `actions.ts`, `battle.ts` -- and
a full battle runs to victory in a Vitest test with zero pixels rendered.

The scene shows the finished composition: `kira` in real art, three
placeholder party members, and a placeholder boss on the right.

Nothing connects the two yet. `main.ts` still publishes `battle: null` and
the HUD reads a static `HudModel`.

Next: wire `BattleState` into the renderer and the HUD. A sprite's `name` is
its `ActorId`, so a `damage` event's `targetId` resolves to a sprite and
`headScreenPosition()` gives the anchor for a DOM damage number.

Use plan mode before: the battle sequencer, the menu state machine, and the
damage-number/animation layer.
