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
- **Key light is a contract:** front-left, `(-4, 6, 6)`. Character art is
  drawn to match it. Do not move it.
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

- **Sprite transparency sorting** (from Phase 4c): alpha-blended planes
  need `alphaTest` and explicit `renderOrder`, or they sort wrongly.
- **Grounding:** every sprite needs a soft contact shadow or it looks
  pasted on.
- Azure free tier caps the site at 250 MB. Compress textures (KTX2) and
  meshes (Draco). Check bundle size when adding assets.

## Current phase

**Phase 0 complete.** Next: Phase 1 — battle logic with no UI at all.
Actors, turn order, `takeAction()`. Verify entirely with Vitest; a full
battle should be simulable in a test with zero pixels rendered.

Use plan mode before: the battle sequencer, turn-order system, the menu
state machine, and the status-effect system.
