# Free character art workflow

How to get six sprites that satisfy this project's constraints, without paying
for anything.

---

## Read this first: the free tiers have a licensing trap

This game is attached to **SideQuest Cyber**, a business site. That makes the
art a commercial asset, not a hobby project, and several free tiers do not
allow that.

The clearest example: **Recraft's free plan explicitly prohibits professional
use** and Recraft retains ownership — you get a personal-use licence only. It
is otherwise the most attractive option, being the one major generator with
reliable native transparency. It is still the wrong choice here.

Also worth knowing: **Recraft, Leonardo, and Ideogram all publish free-tier
output publicly by default.** Paying is the upgrade that makes work private.
For a business asset that may or may not matter to you, but decide knowingly.

**Verify the terms yourself for whichever you pick.** Free tiers change often
and I would not rely on a summary — including this one — for a licensing
decision on a business asset.

The option with no licensing ambiguity is self-hosting (see below).

---

## Choosing a generator

Rough state of the free tiers as of mid-2026. Confirm before committing.

| Option | Free allowance | Transparency | Notes |
|---|---|---|---|
| **Leonardo AI** | ~150 tokens/day | Has a transparency option | No watermark. Public by default on free. |
| **Microsoft Designer** | ~15 fast/day, then slow queue | No | Zero setup, no watermark |
| **Krea** | 100 compute units/day | No | Many models behind one interface |
| **Bing Image Creator** | 15 fast/day | No | Unlimited slow queue |
| **Adobe Firefly** | 25 credits/month | Yes | Watermarked on free |
| **Recraft** | 30 credits/day | **Yes, native** | ⚠️ Commercial use prohibited on free |
| **Self-hosted SD/Flux** | Unlimited | Via LayerDiffuse | Needs a GPU. Full rights, fully private. |

**Recommendation for your situation:** start with **Leonardo AI**. 150/day is
enough to iterate a six-character cast in one sitting, there is no watermark,
and it has seed control — which the `pair` mode below depends on.

**If you have a discrete GPU**, self-hosting Stable Diffusion or Flux via
ComfyUI removes every constraint at once: unlimited generations, private, and
unambiguous rights. It costs an evening of setup. Given that you will likely
regenerate the boss a dozen times, that evening may pay for itself — but it is
an evening you could spend on Phase 1 instead. Your call.

---

## Transparency does not have to come from the generator

Most generators cannot output alpha. That is fine, and it does not mean
compromising, because **the art direction was written to make cutout easy**.

The prompts in `public/characters/README.md` specify hard-edged rim lights
contained inside the silhouette, with no outward glow. That was partly an
aesthetic choice — the bloom pass creates the halo in-engine — but it also
means the thing that normally breaks background removal, soft translucent
edges, does not exist in this art. A flat-vector character on a flat
background keys cleanly and exactly.

So you have three routes, in order of preference:

**1. `key` — flat background, deterministic colour key.** Use the
high-contrast prompt. Chroma green works because there is no green anywhere in
the brand palette, which makes the separation exact and makes spill removal
reliable. No model, no downloads, no nondeterminism: the same input always
produces the same cutout.

**2. `alpha` — the generator produced real transparency.** Leonardo's
transparency option, or Firefly. Simplest when available.

**3. `pair` — recover alpha by measurement.** Generate the same seed twice,
once on pure white and once on pure black. Alpha is then arithmetic rather
than a guess:

```
composite over background B:   C  = a*F + (1-a)*B
on white (B = 1):              Cw = a*F + (1-a)
on black (B = 0):              Cb = a*F
therefore                      a  = 1 - (Cw - Cb)
                               F  = Cb / a
```

A fully opaque pixel looks identical on both; a fully transparent one differs
by the full range; everything between reveals its exact opacity. This is a
compositing technique that predates AI generation by decades, and it is exact.
Use it when a generator will not give you a clean flat background.

When generating the pair: keep the prompt identical except for the background
colour, use the same seed, say "pure white" and "pure black" explicitly, and
avoid the word "transparent" — it confuses most models.

---

## The prep script

`tools/prep_character.py`. Needs only Pillow and numpy:

```bash
pip install pillow numpy
```

It handles all three routes, normalises the result, and — the part that
matters most — **validates against this project's constraints and refuses
assets that violate them**.

```bash
# flat green background
python tools/prep_character.py key raw.png --key "#00FF00" -o kira

# generator gave you real transparency
python tools/prep_character.py alpha raw.png -o kira

# white/black pair
python tools/prep_character.py pair --white w.png --black b.png -o kira
```

Output lands in `public/characters/kira.png` at 512×1024, ready to load.

### What it does

**Cutout** by the chosen method, then **despill** — un-premultiplying the
background colour out of partially transparent edge pixels. Skipping this is
what leaves a green-tinted rim that reads as a glowing outline against a dark
scene.

**Normalisation** is the underrated part. Generators frame subjects
differently every time. Because the sprite layer derives world width from the
texture aspect ratio, two characters framed differently end up different
heights in the scene for no visible reason. The script trims to the subject,
scales it into a canonical 512×1024 frame with consistent margins, and seats
the feet near the bottom edge. Every character comes out comparable.

**Validation** runs eight checks:

| Check | Catches |
|---|---|
| subject coverage | Empty frame, or background not removed |
| transparent border | Background survived the cutout (measured pre-normalisation) |
| silhouette not a block | Subject fills its bounding box → it's a rectangle, not a character |
| feet at bottom | Trapped space below the feet → character hovers in the scene |
| no key-colour spill | Green halo that will glow against the backdrop |
| **key light on left** | Art generated with reversed lighting |
| contrast vs backdrop | Silhouette will dissolve into `#13060D` |
| palette adherence | Generator drifted off-brand |

The light-direction check compares the luminance-weighted horizontal centroid
against the geometric one. With the key light upper-front-left, the lit side
is brighter, so the luminance centroid sits left of centre. Mirrored art comes
back positive and fails. This matters because **you must not fix reversed
lighting by flipping the image** — flipping swaps the weapon hand and reverses
any circuit detailing. Regenerate instead.

Hard failures exit non-zero. Contrast and palette are warnings, because both
are sometimes a deliberate choice.

### The contact sheet

Every run also writes `<name>.check.png`: the sprite on a checkerboard beside
the sprite over the actual scene backdrop.

Look at the right half. A cutout can be flawless on a checkerboard and still
be unusable, because the dark side of the character is the same value as
`#13060D` and the silhouette dissolves. That failure is invisible in every
other view and only appears once the sprite is in the scene — which is why
this is the panel worth checking.

---

## The full loop

1. Generate one character. Use the prompt from `public/characters/README.md`,
   changing only the `CHARACTER:` block.
2. Run the prep script.
3. Read the report. Regenerate on any FAIL.
4. Open the contact sheet and look at the right-hand panel.
5. Add it to `src/scene/cast.ts`, run `npm run shots`, look at
   `full_cast.png` — and `boss_closeup.png` if it was the boss.

Once one character passes cleanly, **generate the remaining five in the same
sitting** with the same model and settings. Consistency degrades across
sessions and model versions. The prep script makes the mechanical part fast,
but it cannot make two characters generated a fortnight apart look like the
same artist drew them.

The boss is the hardest asset. Budget more attempts, and generate it at higher
resolution — it stands at roughly twice the party's world height, so it needs
the pixels.

---

## Two things the script cannot check

**"No ground shadow."** Automatable only unreliably. Check it by eye: the
engine draws the contact shadow, so a shadow baked into the art gives you two.

**Whether it looks good.** The validator confirms an asset is *usable*. It has
no opinion about whether the character reads as a knight, whether the five
look like they belong to the same world, or whether the boss is threatening.
That is the part that stays yours.
