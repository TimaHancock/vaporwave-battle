# Character generation prompts

Refined from the first Kira generation. Four party members plus the boss.

---

## What changed from v1

Three fixes, all from things the first run actually exposed:

**Portrait output is now requested explicitly.** The first generation came back
1408×768 landscape, and the knight occupied only 290×667 of it. He was then
upscaled 1.43× to fill the sprite frame. Asking for portrait roughly doubles
effective resolution for free.

**Shadow values now have a floor.** 33% of the first character sat within
20/255 of the scene backdrop `#13060D` — the dark armour and legs merge into
it. The prompts now forbid going darker than `#29081E` on any shadow surface.

**Watermarks are called out.** The first image carried a sparkle in the corner
that inflated the bounding box 2.6× and shrank the sprite to a third of its
proper size. The prep script strips isolated artifacts now, but if your
generator lets you disable the mark, do.

---

## How to use these

Everything except the `CHARACTER:` block is **fixed**. Change only that block.
That fixed frame is the entire consistency mechanism — generate all five in one
sitting, same model, same settings.

Blocks appear in this order every time:

```
BACKGROUND → CHARACTER → STYLE → PALETTE → LIGHTING → CAMERA → TECHNICAL
```

---

## The fixed frame

Paste this around every character block below.

### BACKGROUND

```
Solid flat chroma green #00FF00 filling the entire frame behind the subject.
Completely uniform — no gradient, no vignette, no texture, no lighting
variation. The character contains NO green anywhere: not in armour, skin,
hair, clothing, weapons, glow, or shadows. No light spill or colour bleed
onto the green.
```

### STYLE

```
Flat vector illustration. Hard-edged geometric shapes, angular faceting, bold
graphic poster style. Strictly limited palette. Minimal internal detail —
silhouette-forward and highly readable at small size. No painterly texture,
no soft airbrush shading, no gradient mesh inside shapes. Clean crisp vector
edges throughout. Thin cyan circuit-trace lines with small node dots as a
recurring motif, etched into armour, cloth, or equipment.
```

### PALETTE

```
Use only these colours:
  deep plum       #29081E   (darkest permitted value — see below)
  hot magenta     #C61E82
  bright pink     #B02961
  burnt orange    #9D461E
  warm orange     #E8873A
  pale lavender   #D9C7FF
  pure white      #FFFFFF
  cyan            #22E0FF   (thin circuit lines only, never a fill)

CRITICAL: #29081E is the darkest value allowed anywhere on the character,
including deepest shadow. Nothing may be darker. The character will be
composited against a near-black background and must stay clearly lighter
than it, or the silhouette dissolves. Do not use black.
```

### LIGHTING

```
Key light: pale lavender-white, from the upper LEFT of frame, in front of the
subject, about 40 degrees above horizontal. Left-facing surfaces are lit;
right-facing surfaces fall into deep plum shadow — but never darker than
#29081E.

Hot magenta #C61E82 rim light along the RIGHT silhouette edge.
Cyan #22E0FF rim light along the LEFT silhouette edge.

Rim lights are HARD-EDGED bright strokes contained strictly INSIDE the
silhouette. No outward glow, no soft haze, no bloom, no light spill past the
edge.
```

### CAMERA

```
Viewed from directly in front, very slightly above eye level, approximately
8 degrees looking down. Near-frontal, minimal three-quarter rotation.
Full body, head to feet, both feet fully visible and flat on an implied
ground plane.
```

### TECHNICAL

```
PORTRAIT orientation, tall vertical frame, roughly 2:3 or 1:2 aspect. The
character fills most of the frame height. Do not output a landscape or square
image — the subject must use the available pixels.

Generous flat green margin on all sides — do not crop any part of the
character. No ground shadow, no cast shadow, no contact shadow on the green.
No background scenery, no environment, no floor. No particles or floating
effects. No text, no watermark, no signature, no frame or border. Single
static idle pose, not an action pose. Highest available resolution.
```

---

# The cast

Each character has a deliberately distinct silhouette. At sprite size the
outline is most of what a player reads, so the shapes matter more than the
detail: one tall and heavy, one tall and flowing, one lean and horned, one
small and wide.

---

## 1. Kira — dragonborn knight (male)

```
CHARACTER:
A male dragonborn knight in heavy angular plate armour, standing at rest in a
neutral idle pose, weight even on both feet, arms relaxed at sides. A
longsword held point-down against the ground in his right hand.

Draconic head with a broad blunt snout, a swept crest of backward-curving
horns, and hard faceted scales along the jaw and brow. A short powerful tail
emerges below the backplate and rests against the ground behind him. Broad
shoulders with oversized angular pauldrons — he is the bulkiest silhouette in
the party. Scales rendered as flat geometric plates in bright pink and burnt
orange, not as texture. Circuit traces etched along the breastplate and
pauldrons, glowing cyan.
```

**Scale:** `characterHeight: 2.45` — the tallest of the party.

---

## 2. Neo — human wizard (male)

```
CHARACTER:
A human male wizard standing at rest in a neutral idle pose, weight even on
both feet. A tall staff held vertically in his left hand, its head a floating
faceted polyhedron suspended just above the wood.

Long layered robes in magenta and deep plum that flare outward from the waist,
creating a wide triangular lower silhouette. A high stiff collar frames his
face. Dark hair, sharp features, calm expression, no beard. A pale lavender
sash crosses his chest. Circuit traces run down the robe's front panels and
along the staff in glowing cyan. He is tall and vertical, defined by the line
of the staff and the flare of the robe.
```

**Scale:** `characterHeight: 2.25`

---

## 3. Vex — tiefling rogue (female)

```
CHARACTER:
A female tiefling rogue standing at rest in a neutral idle pose, weight
slightly on one hip, arms relaxed. A slim dagger held reversed in each hand,
blades angled down along her forearms.

Two long ridged horns sweep back and upward from her forehead. A slender
pointed tail curves out behind her and tapers to a spade tip, held clear of
her body so it reads clearly in silhouette. Skin in bright pink with plum
shading. Close-fitting layered leather in deep plum with magenta panelling —
lean and narrow compared to the knight. A short hooded half-cape falls from
her left shoulder only, leaving the right shoulder bare. Dark hair pulled back.
Circuit traces along the bracers and the cape's edge in glowing cyan.
```

**Scale:** `characterHeight: 2.15`

---

## 4. Lyra — halfling artificer (female)

```
CHARACTER:
A female halfling artificer standing at rest in a neutral idle pose, feet
planted apart, one hand resting on a hip. Short and stocky with halfling
proportions: a large head relative to the body, short legs, roughly two-thirds
the height of a human adult.

Brass-and-orange goggles pushed up onto her forehead over a mass of curly hair.
A bulky backpack apparatus rises above her shoulders, bristling with angular
antennae, coiled tubing, and a small faceted power core glowing cyan. A heavy
tool belt with angular pouches at her waist. A wrench-like implement held
loosely in her right hand. Practical layered workwear in burnt orange and deep
plum with a pale lavender apron. Circuit traces across the backpack housing and
along the apron hem in glowing cyan. She is the widest and shortest silhouette
in the party — compact and busy with equipment.
```

**Scale:** `characterHeight: 1.65` — two-thirds of Kira, and the engine holds
her to it whatever her framing does. See the scale note below.

---

## 5. Apollyon — the boss

Generate this one at the highest resolution available and expect several
attempts. It is the hardest asset in the project.

```
CHARACTER:
A colossal eldritch entity looming upright, facing forward, motionless and
watchful.

Its upper mass is a fractured classical marble bust — a serene faceless head
and shoulders in pale lavender stone, cracked open down the centre. From the
fracture pours a dense tangle of angular tentacles in deep plum and hot
magenta, geometric and faceted rather than organic, each segment a hard plane.
Too many eyes are set irregularly across the marble and among the tendrils,
each a flat bright cyan lens with no pupil, all open, none aligned.

Behind and above the head floats a broken halo of geometric solids —
icosahedra, cubes, and tetrahedra in magenta and orange, suspended in a ring,
some fractured, hanging in impossible arrangement.

The lower mass resolves into thick coiling tendrils that spread outward and
press flat against the ground, forming a wide stable base — it is planted, not
floating. The base is the widest part of the silhouette.

Enormous and imposing. Its bulk should read as several times the mass of an
armoured human. Circuit traces run through the marble fractures and along the
tendril segments in glowing cyan.
```

```
TECHNICAL OVERRIDE for the boss only:
Replace the PORTRAIT instruction with:
  SQUARE or slightly tall frame, roughly 1:1 to 4:5 aspect. The entity is
  wide at the base and fills the frame. Highest available resolution.
```

**Scale:** `characterHeight: 3.8` — capped by the HUD, not by taste. See
"Why Apollyon is 3.80 and not 4.20" below.

---

# Prepping each one

```bash
python tools/prep_character.py key kira_raw.png     --key "#00FF00" -o kira
python tools/prep_character.py key neo_raw.png      --key "#00FF00" -o neo
python tools/prep_character.py key vex_raw.png      --key "#00FF00" -o vex
python tools/prep_character.py key lyra_raw.png     --key "#00FF00" -o lyra
python tools/prep_character.py key apollyon_raw.png --key "#00FF00" -o apollyon
```

No frame arguments. The output name selects a **profile** from the `CAST`
table in the script, and the profile carries the frame and the tolerances:

| Name | Profile | Frame | Why |
|---|---|---|---|
| kira, neo, vex | `humanoid` | 512×1024 | tall, roughly vertical |
| lyra | `stocky` | 640×1024 | wide for her height; a 512 frame fits her by width and wastes the top third |
| apollyon | `boss` | 1024×1024 | wider at the base than it is tall; a portrait frame would letterbox it and throw away resolution |

An unlisted name gets `humanoid`. Override anything per run with `--profile`,
`--width`, `--height`.

Coverage bounds differ per profile, because they measure silhouette and these
silhouettes are deliberately unlike each other. A ceiling that fits a lean
rogue would reject the boss for being colossal, which is the one thing the
boss is required to be.

Check every report. Regenerate on any FAIL. Then open each `.check.png` and
look at the **right-hand panel** — the one over the scene backdrop.

Two report lines are worth reading even when everything passes:

- **`shadow floor`** — how much of the character is darker than `#29081E`.
  This is the darkest-value rule from the PALETTE block, measured. It warns
  rather than fails, because the fix is a regeneration and you may reasonably
  decide a given asset is close enough. The first Kira scores ~21%.
- **`world scale`** — how much of the frame the character actually fills, and
  the `worldHeight` that follows from it. See the scale trap below.

## Floating pieces are safe

Neo's staff polyhedron and every shard of Apollyon's halo are *disconnected*
from the main mass, which is exactly what the watermark filter used to delete.
It is now proximity-first: anything near the subject is kept whatever its
size, and only distant blobs face a size bar. The report says what it dropped
and what it kept, so neither decision is silent.

If a generator does stamp a mark right beside the character, lower
`--island-distance` (default `0.06` of the longest side).

## The green outline

The prompts ask for hard vector edges. Generators mostly refuse: what arrives
is a one-to-three pixel ramp where the subject blends into the chroma green,
and because that ramp is wider than the alpha transition, much of it comes out
fully **opaque and green**. Against `#13060D` it reads as a deliberate rim
light — worse than an obvious mistake, because it looks like a choice.

Raising `--tolerance` does not fix it. Tolerance decides where the matte ends;
it cannot decide what colour the pixels inside it are. Past a point it just
eats the character.

Three passes handle it, all on by default:

| Flag | Default | Does |
|---|---|---|
| `--despill` | `1.0` | Clamps green down to what the rest of the pixel supports, on **every** visible pixel — the pass that clears the opaque fringe |
| `--erode` | `1.0` | Chokes the matte inward by that many source pixels, discarding the outer ring rather than correcting it |
| — | — | Resampling is premultiplied, so the resize cannot pull green back out of the transparent pixels it filters across |

Despill is safe for this palette specifically: every brand colour has green
below its own max of red and blue, cyan `#22E0FF` included, so nothing on the
character can be mistaken for spill. That is a property of the palette, not a
general truth — a green-armoured character would need a magenta screen.

Two report lines tell you what happened:

```
  [PASS] no key-colour spill  0.00% of visible pixels lean toward the key
  [INFO] edge treatment       6.8% of visible pixels arrived carrying key
                              colour; despill 1.00, matte choked 1px
```

The INFO line is how contaminated the source was; the PASS line is what is
left. If the fringe survives, raise `--erode` to 2 or 3. If thin detail like a
blade edge is being eaten, drop it to 0 and lean on despill alone. To see what
the generator actually handed you, run once with `--erode 0 --despill 0` — the
spill check then fails, which is the point.

---

# The scale trap

**`normalise()` scales every character to fill the same frame.** That is what
makes the cast consistent, but it also means the halfling and the dragonborn
come out of the prep script the same pixel height. Relative scale is *not*
carried by the art — it comes entirely from the `**Scale:**` line on each
character above.

Those numbers are the **visible height of the figure**, in world units. Not
the height of the sprite plane: the plane also contains whatever transparent
margin the art was framed with, and that varies between these five by a third
(Kira fills 80% of his frame, Apollyon 66%). Sizing by the plane would make
the halfling as tall as the wizard.

So the engine divides the margin back out. `createCharacterSprite` measures
`headInset` and `feetInset` from the texture, then derives

```
planeHeight = characterHeight / (1 - feetInset - headInset)
```

which means **the numbers here need no compensation and no re-measuring when
art is re-prepped.** `src/scene/cast.ts` mirrors this table and nothing else in
the code knows how much sky is above Apollyon's halo. The prep report's `world
scale` line still prints the arithmetic, but now as a cross-check rather than a
step you have to perform.

Check the result in the scene, not in the PNG: `npm run shots` and look at
whether the party reads as four people of believably different heights.

## Why Apollyon is 3.80 and not 4.20

The camera is locked and the `APOLLYON LV95` bar owns the top of frame. At
4.20 the boss's head projects to screen y 0.079 — behind the bar, and past the
0.03 frame margin — and the e2e guard that keeps damage numbers clear of the
HUD fails. 3.80 is the largest figure that clears it: 436 px tall against
Kira's 276, and a sprite plane of ~5.8 against the party's ~2.9–3.1, so the
boss is still twice the party by the measure `spawnCast` works in.

Pushing it back in z does not buy height, either: at z −2.5 it renders 429 px,
the same as it does standing on the party's line. If the HUD moves in the
Phase 4 styling pass, this number can be revisited.

---

# Silhouette check

The one thing the validator cannot test. Once all five are in the scene,
capture `full_cast` and ask yourself whether you could identify each character
from outline alone at a glance.

The shapes were chosen to make that possible:

| Character | Silhouette signature |
|---|---|
| Kira | Widest shoulders, horned crest, tail, sword line down-right |
| Neo | Tall vertical staff, wide triangular robe flare |
| Vex | Lean, swept horns, spade-tipped tail held clear of the body |
| Lyra | Short and wide, backpack antennae breaking the head outline |
| Apollyon | Massive, broken halo ring, wide tendril base |

If two read the same, that is a regeneration, not a tuning problem.
