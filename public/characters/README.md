# Character art

Drop generated character PNGs here. They are served from `./characters/<name>.png`.

## Requirements

Every file must satisfy the contract the sprite layer and the 3D scene assume.
Art that violates these will render, but it will look wrong in ways a
screenshot alone will not explain.

| Property | Requirement |
|---|---|
| Format | PNG with a real alpha channel |
| Frame | Per silhouette, not one size. 512x1024 humanoid, 640x1024 stocky, 1024x1024 boss |
| Framing | Full body, both feet visible, generous transparent margin |
| Camera | Near-frontal, viewed ~8 degrees from above (matches the locked camera) |
| Key light | Pale lavender-white, upper FRONT-LEFT, ~40 degrees elevation |
| Rim right | Hot magenta `#C61E82` along the right silhouette edge |
| Rim left | Cyan `#22E0FF` along the left silhouette edge, thin |
| Rim style | HARD-EDGED, inside the silhouette. No outward glow |
| Darkest value | `#29081E`. Nothing on a character may be darker, shadows included |
| Shadow | None. The engine draws the contact shadow |
| Background | Fully transparent. No scenery, no floor, no cast shadow |

The frame is per-silhouette because the cast is: one tall and heavy, one tall
and flowing, one lean, one short and wide, and a boss wider at the base than
it is tall. Forcing a portrait frame on a wide subject letterboxes it — the
character is fitted by width, leaves the top third of the frame empty, and
renders shorter in the scene than its `worldHeight` says. `tools/prep_character.py`
picks the frame from the output name; see `CHARACTER_PROMPTS.md`.

`#29081E` is only 7/255 brighter than the `#13060D` backdrop, which is as
close as the palette allows a character to come to disappearing into it. Go
darker and the shadow side dissolves once composited — a failure that never
shows in the source PNG, only in the scene.

## Why the rim light must be hard-edged

Soft outward glow is what breaks matte extraction — the haze bleeds past the
silhouette and there is no clean edge to key against. Keep the rim a crisp
stroke inside the shape and let the bloom pass create the halo in-engine.
Cleaner cutout, better result.

Generators comply only approximately, so expect a one-to-three pixel ramp of
background colour around the subject — much of it fully opaque, which is a
glowing outline once composited. `tools/prep_character.py` removes it in key
mode: full despill on every visible pixel, a one-pixel matte choke, and a
premultiplied resize so the resampler cannot drag the background back in.
`--erode` and `--despill` tune it; the report says how much contamination
arrived and how much is left.

## Checking a new asset

Run it through the prep script — it cuts out, frames, and checks every row of
the table above, and it is the only version of this checklist that does not
get skipped at 1am:

```bash
python tools/prep_character.py key kira_raw.png --key "#00FF00" -o kira
```

Then two things it cannot judge for you:

1. Open the `.check.png` it writes and look at the **right-hand panel**, the
   one over the scene backdrop. A sprite can look perfect on white and vanish
   at `#13060D`.
2. Zoom to 400% on the silhouette edge, especially thin details like a blade.
   A faint rectangular halo means the source has near-zero-but-not-zero alpha
   across its background — raise `alphaTest` toward 0.5.

If the light lands on the RIGHT, regenerate rather than mirroring — flipping
swaps the weapon hand and reverses any circuit detailing.

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
