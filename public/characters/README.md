# Character art

Drop generated character PNGs here. They are served from `./characters/<name>.png`.

## Requirements

Every file must satisfy the contract the sprite layer and the 3D scene assume.
Art that violates these will render, but it will look wrong in ways a
screenshot alone will not explain.

| Property | Requirement |
|---|---|
| Format | PNG with a real alpha channel |
| Aspect | Portrait. 512x1024 or larger. Never square-padded |
| Framing | Full body, both feet visible, generous transparent margin |
| Camera | Near-frontal, viewed ~8 degrees from above (matches the locked camera) |
| Key light | Pale lavender-white, upper FRONT-LEFT, ~40 degrees elevation |
| Rim right | Hot magenta `#C61E82` along the right silhouette edge |
| Rim left | Cyan `#22E0FF` along the left silhouette edge, thin |
| Rim style | HARD-EDGED, inside the silhouette. No outward glow |
| Shadow | None. The engine draws the contact shadow |
| Background | Fully transparent. No scenery, no floor, no cast shadow |

## Why the rim light must be hard-edged

Soft outward glow is what breaks matte extraction — the haze bleeds past the
silhouette and there is no clean edge to key against. Keep the rim a crisp
stroke inside the shape and let the bloom pass create the halo in-engine.
Cleaner cutout, better result.

## Checking a new asset

1. Zoom to 400% on the silhouette edge, especially thin details like a blade.
   A faint rectangular halo means the source has near-zero-but-not-zero alpha
   across its background — raise `alphaTest` toward 0.5.
2. Confirm the light lands on the LEFT. If reversed, regenerate rather than
   mirroring — flipping swaps the weapon hand and reverses any circuit
   detailing.
3. Check value separation against `#13060D`. If the shadow side is as dark as
   the background, the silhouette dissolves into it. This failure only shows
   up once the sprite is in the scene.

## Swapping placeholders for real art

`src/main.ts` bootstraps inside `async function main()` precisely so art can
be awaited. `kira` is already wired up; adding the next character means
loading its texture beside hers and handing it to the same `spawnCast()` call:

```ts
const kira = await loadCharacterTexture('./characters/kira.png');
const neo = await loadCharacterTexture('./characters/neo.png');
```

Two rules the structure exists to protect:

- **Await before spawning.** `createCharacterSprite()` derives the plane's
  dimensions from the texture's pixel aspect and throws if the image has not
  decoded. It does not guess.
- **One `spawnCast()` call for the whole party.** `assignRenderOrders()` ranks
  the cast in a single pass; two calls produce two independent draw sequences
  that collide.

`loadCharacterTexture` rejects on failure rather than substituting a blank,
because a silently missing sprite is indistinguishable from a positioning bug
in a screenshot. A rejection leaves `__debugState.ready` false, so the shot
harness fails loudly instead of capturing a wrong scene.
