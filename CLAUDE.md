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
- **Coplanar geometry z-fights.** The contact shadow sits at `y = 0.012`,
  not `0`, for this reason.
- Azure free tier caps the site at 250 MB. Compress textures (KTX2) and
  meshes (Draco). Check bundle size when adding assets.

## Current phase

**Phase 0 complete, plus the sprite billboard layer.** Placeholder cast of 5
renders with contact shadows; real art drops into `public/characters/`.

Next: Phase 1 — battle logic with no UI at all. Actors, turn order,
`takeAction()`. Verify entirely with Vitest; a full battle should be
simulable in a test with zero pixels rendered.

Before committing further to the visual direction: generate one real
character, drop it in, and turn on bloom. That answers the highest
-uncertainty question in the project and costs an evening.

Use plan mode before: the battle sequencer, turn-order system, the menu
state machine, and the status-effect system.
