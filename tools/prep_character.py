#!/usr/bin/env python3
"""
Character sprite prep and validation.

Turns whatever an image generator hands you into a sprite that satisfies this
project's constraints -- and, more usefully, TELLS YOU when it doesn't.

The manual checklist in public/characters/README.md is fine for one asset. For
four party members plus the boss, each possibly regenerated several times, it
is exactly the kind of repetitive eyeballing that gets skipped when you are
tired. This automates it.

Requires only Pillow and numpy:

    pip install pillow numpy

THREE INPUT MODES
-----------------
  alpha  The generator produced real transparency. Cleanest path.
           python prep_character.py alpha raw.png -o kira

  key    Flat single-colour background (the high-contrast prompt). Removal is
         a deterministic colour key -- exact, no model, no downloads. This
         works well here specifically because the art direction is flat vector
         with hard edges; there is no soft glow for a key to destroy.
           python prep_character.py key raw.png --key "#00FF00" -o kira

         Generators only approximate a hard edge, so the leftover ring of
         background colour -- including the opaque part of it -- is despilled,
         choked and kept out of the resize. See `alpha_from_colour_key`,
         `--erode` and `--despill`.

  pair   Alpha recovery from two renders of the same seed, one on pure white
         and one on pure black. Measures per-pixel alpha rather than guessing
         at it:
             composite over background B:  C = a*F + (1-a)*B
             on white (B=1): Cw = a*F + (1-a)
             on black (B=0): Cb = a*F
             therefore       a  = 1 - (Cw - Cb),  F = Cb / a
         Use when a generator refuses to produce a clean flat background.
           python prep_character.py pair --white w.png --black b.png -o kira

Every mode then trims, pads, resizes, and validates.

PROFILES
--------
The cast in public/characters/CHARACTER_PROMPTS.md is deliberately built out
of DIFFERENT silhouettes -- one tall and heavy, one tall and flowing, one lean
and horned, one short and wide, and a boss that is wider than it is tall. A
single set of thresholds tuned on one armoured humanoid rejects half of that
cast for being exactly what it was designed to be.

So the frame and the tolerances come from a profile, selected automatically by
output name (see CAST). Everything remains overridable per run:

    python prep_character.py key lyra_raw.png -o lyra              # stocky
    python prep_character.py key apollyon_raw.png -o apollyon      # boss
    python prep_character.py key odd_raw.png -o odd --profile boss
    python prep_character.py key odd_raw.png -o odd --width 768

Profiles change the FRAME and the pass/fail bounds. They never change the
art direction: palette, lighting and the shadow floor are the same contract
for every character, boss included.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# Project constraints. These mirror public/characters/README.md and the
# palette in src/scene/battleScene.ts. Change them in all three or not at all.
# --------------------------------------------------------------------------

MARGIN_FRACTION = 0.04          # empty border kept on every side
FOOT_MARGIN_FRACTION = 0.03     # feet sit this far above the bottom edge

# Brand palette, sampled from the SideQuest Cyber site design.
#
# `void` (#13060D) is deliberately ABSENT. It is the scene background, and the
# prompts forbid it on a character: art painted in it dissolves into the
# backdrop once composited. Leaving it in this table would have made palette
# adherence score near-black pixels as on-palette -- the exact failure the
# shadow-floor check below exists to catch.
PALETTE = {
    "plum": (0x29, 0x08, 0x1E),
    "magenta": (0xC6, 0x1E, 0x82),
    "rose": (0xB0, 0x29, 0x61),
    "ember_deep": (0x9D, 0x46, 0x1E),
    "ember": (0xE8, 0x87, 0x3A),
    "chrome": (0xD9, 0xC7, 0xFF),
    "white": (0xFF, 0xFF, 0xFF),
    "signal": (0x22, 0xE0, 0xFF),
}

SCENE_BACKGROUND = (0x13, 0x06, 0x0D)

# Darkest value permitted anywhere on a character, deepest shadow included.
# The prompts state this as a hard rule; this is the same rule, measured.
SHADOW_FLOOR = PALETTE["plum"]
MAX_BELOW_FLOOR = 0.10      # share of the subject allowed under the floor

MAX_SPILL_FRACTION = 0.02   # edge pixels still carrying the key colour
MIN_PALETTE_ADHERENCE = 0.70
PALETTE_TOLERANCE = 70      # RGB euclidean distance counted as "on palette"

# A detached blob this close to the main mass is part of the design -- Neo's
# floating polyhedron, Apollyon's broken halo -- not a watermark. Measured as
# a fraction of the image's longest side, between bounding boxes.
ISLAND_NEAR_FRACTION = 0.06

# What a watermark looks like to this palette: mid-grey.
#
# The generator's sparkle is desaturated, which nothing in the brand palette
# is at mid luminance -- plum sits at 0.13 saturation, chrome at 0.22, and the
# only true greys are white and near-black, both outside this luminance band.
# So colour identifies the mark exactly, and unlike a connected-component rule
# it stays exact when the mark overlaps the art.
WATERMARK_MAX_SATURATION = 0.10
WATERMARK_LUMINANCE_BAND = (0.25, 0.80)
WATERMARK_MIN_PIXELS = 40       # below this it is antialiasing, not a mark
WATERMARK_MAX_FRACTION = 0.015  # above this it is art, not a mark


@dataclass(frozen=True)
class Profile:
    """Frame and tolerances for one class of silhouette."""

    width: int
    height: int
    min_coverage: float
    max_coverage: float
    max_bbox_fill: float
    min_light_bias: float
    light_is_fatal: bool
    min_island: float
    why: str


PROFILES: dict[str, Profile] = {
    # Kira, Neo, Vex. Tall, roughly vertical, feet on the ground.
    "humanoid": Profile(
        width=512,
        height=1024,
        min_coverage=0.06,
        max_coverage=0.55,
        max_bbox_fill=0.90,
        min_light_bias=0.010,
        light_is_fatal=True,
        min_island=0.20,
        why="tall humanoid, portrait frame",
    ),
    # Lyra. Halfling proportions: wide for her height, and busy with kit.
    # A 512-wide frame fits her by WIDTH, leaving dead space above her head
    # and a sprite plane taller than she is. The wider frame recovers most of
    # that; the world-scale line in the report covers the rest.
    "stocky": Profile(
        width=640,
        height=1024,
        min_coverage=0.08,
        max_coverage=0.62,
        max_bbox_fill=0.90,
        min_light_bias=0.010,
        light_is_fatal=True,
        min_island=0.20,
        why="short and wide, needs a wider frame than it is tall",
    ),
    # Apollyon. Wider at the base than it is tall, and partly self-lit --
    # cyan eyes and a glowing halo can outweigh the key light, so the
    # light-direction check reports rather than rejects here.
    "boss": Profile(
        width=1024,
        height=1024,
        min_coverage=0.15,
        max_coverage=0.78,
        max_bbox_fill=0.90,
        min_light_bias=0.004,
        light_is_fatal=False,
        min_island=0.15,
        why="colossal, wide base, square frame",
    ),
}

DEFAULT_PROFILE = "humanoid"

# Name -> (profile, intended visible height in world units).
#
# The height is what `worldHeight` in spawnCast would be IF the character
# filled its frame exactly. It never does, so the report converts it -- see
# `world scale` below. Keep in step with CHARACTER_PROMPTS.md.
CAST: dict[str, tuple[str, float]] = {
    "kira": ("humanoid", 2.45),
    "neo": ("humanoid", 2.25),
    "vex": ("humanoid", 2.15),
    "lyra": ("stocky", 1.65),
    "apollyon": ("boss", 4.20),
}


# --------------------------------------------------------------------------
# Loading and alpha extraction
# --------------------------------------------------------------------------


def load_rgba(path: Path) -> np.ndarray:
    """Load an image as float RGBA in 0..1."""
    image = Image.open(path).convert("RGBA")
    return np.asarray(image, dtype=np.float64) / 255.0


def parse_hex(value: str) -> tuple[int, int, int]:
    text = value.lstrip("#")
    if len(text) != 6:
        raise ValueError(f"Expected a 6-digit hex colour, got {value!r}")
    return tuple(int(text[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def alpha_from_existing(rgba: np.ndarray) -> np.ndarray:
    """Mode 'alpha'. Trust the generator's own alpha channel."""
    if rgba[..., 3].max() >= 0.999 and rgba[..., 3].min() >= 0.999:
        raise SystemExit(
            "This image is fully opaque -- it has no transparency to use.\n"
            "Use 'key' mode if it has a flat background, or 'pair' mode."
        )
    return rgba


def alpha_from_colour_key(
    rgba: np.ndarray,
    key: tuple[int, int, int],
    tolerance: float,
    softness: float,
    erode: float = 1.0,
    despill_strength: float = 1.0,
) -> tuple[np.ndarray, float]:
    """
    Mode 'key'. Deterministic distance-based key with a soft ramp, then three
    passes that between them remove the contaminated edge.

    Exact and instant. No model weights, no network, no nondeterminism -- the
    same input always produces the same cutout, which matters when you are
    regenerating assets and comparing results.

    THE SOFT EDGE PROBLEM
    ---------------------
    The art direction asks for hard vector edges, and generators mostly refuse:
    what actually arrives is a one-to-three pixel ramp where the subject blends
    into the background. Every pixel in that ramp is part key colour, and the
    ramp is wider than the alpha transition, so a good deal of it comes out
    fully OPAQUE and green. Against #13060D that is a lit outline -- it reads
    as a deliberate rim light, which is worse than an obvious mistake, because
    it looks like a choice.

    Raising --tolerance does not fix it. Tolerance decides where the matte
    ends; it cannot decide what colour the pixels inside the matte are. Past a
    point it just eats the character.

    So, in order:

      1. Un-premultiply the partial pixels, which is exact where alpha is
         known (see `despill`).
      2. Remove the key's colour cast from EVERY visible pixel, opaque ones
         included (`suppress_key_cast`). This is the pass that kills the
         opaque fringe.
      3. Choke the matte inward by `erode` pixels, discarding the outermost
         ring entirely rather than trying to correct it.

    Returns (rgba, share_of_visible_pixels_that_were_carrying_key_colour).
    """
    rgb = rgba[..., :3]
    key_norm = np.array(key, dtype=np.float64) / 255.0

    distance = np.sqrt(((rgb - key_norm) ** 2).sum(axis=-1))

    inner = tolerance / 255.0
    outer = (tolerance + softness) / 255.0

    # 0 where the pixel matches the key, 1 well away from it, ramped between.
    alpha = np.clip((distance - inner) / max(outer - inner, 1e-6), 0.0, 1.0)

    result = rgba.copy()
    result[..., 3] = alpha

    # How much contamination was there to begin with? Measured before any
    # correction, because afterwards there is by construction none left.
    visible = alpha > 0.02
    contaminated = 0.0
    if visible.any():
        cast = key_cast(result[..., :3], key_norm)
        contaminated = float((cast[visible] > 8 / 255).mean())

    # Despill: at partially transparent edges the pixel is a blend of subject
    # and background, so it carries the key hue. Left alone this is the
    # "green halo" that reads as a glowing outline against a dark scene.
    result[..., :3] = despill(result[..., :3], key_norm, alpha)
    result[..., :3] = suppress_key_cast(result[..., :3], key_norm, despill_strength)
    result[..., 3] = erode_alpha(result[..., 3], erode)

    return result, contaminated


def key_channel_split(key_norm: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Split RGB into the channels the key is made of and the channels it is not.

    For #00FF00 that is {G} against {R, B}. Written generally so a magenta or
    blue screen works the same way, and so nothing here assumes green.
    """
    strong = key_norm >= max(key_norm.max(), 1e-6) * 0.5
    return strong, ~strong


def key_cast(rgb: np.ndarray, key_norm: np.ndarray) -> np.ndarray:
    """
    How far each pixel leans toward the key colour, in 0..1.

    The measure is `key channel - brightest non-key channel`, positive when a
    pixel carries more of the key's colour than anything else in it can
    account for. It is a CAST measure, not a distance measure, and the
    difference matters: deep plum sits closer to pure green in RGB distance
    than cyan does, so any threshold on distance either keeps green fringes or
    eats the palette. Cast separates them cleanly -- every colour in the brand
    palette has G below max(R, B), cyan #22E0FF included, so none of them can
    be mistaken for spill.
    """
    strong, weak = key_channel_split(key_norm)
    if not weak.any():
        return np.zeros(rgb.shape[:-1], dtype=np.float64)
    return rgb[..., strong].min(axis=-1) - rgb[..., weak].max(axis=-1)


def suppress_key_cast(
    rgb: np.ndarray, key_norm: np.ndarray, strength: float = 1.0
) -> np.ndarray:
    """
    Clamp the key's channels down to what the rest of the pixel supports.

    A green fringe pixel (0.30, 0.90, 0.30) becomes (0.30, 0.30, 0.30) -- a
    dark neutral that disappears against the backdrop instead of glowing on
    it. A cyan rim pixel (0.13, 0.88, 1.00) is untouched, because its blue is
    already brighter than its green.

    Applied to every visible pixel, not just the partial ones. The opaque
    fringe is the whole problem; `despill` cannot reach it, because
    un-premultiplying by alpha=1 is the identity.
    """
    if strength <= 0:
        return rgb
    strong, weak = key_channel_split(key_norm)
    if not weak.any():
        return rgb
    ceiling = rgb[..., weak].max(axis=-1)[..., None]
    out = rgb.copy()
    clamped = np.minimum(rgb[..., strong], ceiling)
    out[..., strong] = rgb[..., strong] * (1 - strength) + clamped * strength
    return out


def _min_filter3(a: np.ndarray) -> np.ndarray:
    """One pixel of greyscale erosion, plus-shaped. No scipy needed."""
    p = np.pad(a, 1, mode="edge")
    return np.minimum.reduce(
        [p[1:-1, 1:-1], p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]]
    )


def erode_alpha(alpha: np.ndarray, radius: float) -> np.ndarray:
    """
    Choke the matte inward by `radius` source pixels.

    The last resort for a soft edge, and the only one that does not care what
    colour the contamination is: throw the outermost ring away. Fractional
    radii are blended, so 1.5 is halfway between one and two pixels of choke.

    Kept modest by default. Erosion is measured on the SOURCE image, before
    the resize to the sprite frame, so a pixel here is usually well under a
    pixel there -- but it still eats thin detail like a blade edge if pushed.
    """
    if radius <= 0:
        return alpha
    out = alpha
    for _ in range(int(radius)):
        out = _min_filter3(out)
    frac = radius - int(radius)
    if frac > 1e-3:
        out = out * (1 - frac) + _min_filter3(out) * frac
    return out


def despill(
    rgb: np.ndarray, key_norm: np.ndarray, alpha: np.ndarray
) -> np.ndarray:
    """
    Pull the background colour back out of edge pixels.

    Un-premultiplies against the key colour: the observed edge pixel is
    C = a*F + (1-a)*key, so F = (C - (1-a)*key) / a.
    """
    a = alpha[..., None]
    safe = np.maximum(a, 1e-3)
    recovered = (rgb - (1.0 - a) * key_norm) / safe
    # Only correct genuinely partial pixels; leave the solid interior alone.
    partial = (alpha > 0.01) & (alpha < 0.99)
    out = rgb.copy()
    out[partial] = np.clip(recovered[partial], 0.0, 1.0)
    return out


def alpha_from_pair(white: np.ndarray, black: np.ndarray) -> np.ndarray:
    """
    Mode 'pair'. Recover true per-pixel alpha by measurement.

    A fully opaque pixel looks identical on both backgrounds; a fully
    transparent one differs by the full range. Everything between reveals its
    exact opacity.
    """
    if white.shape != black.shape:
        raise SystemExit(
            f"White render is {white.shape[1]}x{white.shape[0]} but black is "
            f"{black.shape[1]}x{black.shape[0]}. Both must be the same size "
            f"and the same seed."
        )

    cw = white[..., :3]
    cb = black[..., :3]

    alpha = np.clip(1.0 - (cw - cb).mean(axis=-1), 0.0, 1.0)

    safe = np.maximum(alpha, 1e-3)[..., None]
    colour = np.clip(cb / safe, 0.0, 1.0)

    out = np.zeros_like(white)
    out[..., :3] = colour
    out[..., 3] = alpha
    return out


# --------------------------------------------------------------------------
# Geometry: trim, pad, resize
# --------------------------------------------------------------------------


def _shift_or(mask: np.ndarray) -> np.ndarray:
    """One step of binary dilation using shifted copies. No scipy needed."""
    out = mask.copy()
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def _bbox_gap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Shortest distance between two (top, left, bottom, right) boxes, in cells."""
    a_top, a_left, a_bottom, a_right = a
    b_top, b_left, b_bottom, b_right = b
    dx = max(0, max(a_left - b_right, b_left - a_right))
    dy = max(0, max(a_top - b_bottom, b_top - a_bottom))
    return float(np.hypot(dx, dy))


def reject_isolated_artifacts(
    rgba: np.ndarray,
    min_ratio: float = 0.20,
    near_fraction: float = ISLAND_NEAR_FRACTION,
) -> tuple[np.ndarray, int, int, int]:
    """
    Erase small DISTANT blobs, keeping the character and anything designed to
    float beside it.

    WHY THIS EXISTS
    ---------------
    Several free generators stamp a small watermark -- typically a sparkle or
    logo in a corner. It survives the colour key, because it is not the key
    colour, and then it silently wrecks the framing: `content_bbox` spans
    everything opaque, so a 48x48 mark 400px from the subject can widen the
    bounding box by 2.6x. Scale-to-fit then shrinks the character to a third
    of the frame it should fill.

    The failure is quiet. The sprite is valid, correctly cut out, correctly
    grounded -- just tiny, in the corner, for no visible reason.

    WHY SIZE ALONE IS NOT ENOUGH
    ----------------------------
    Half this cast has small detached pieces ON PURPOSE: the polyhedron above
    Neo's staff, and every shard of Apollyon's broken halo. A pure size rule
    deletes them, and deletes them silently -- the boss loses the single
    feature that makes its silhouette unmistakable, and nothing in the report
    says so.

    So proximity decides first: a blob near the main mass is kept whatever its
    size, and only DISTANT blobs face the size bar. Watermarks sit in a
    corner; halo shards orbit the subject.

    That bar is then deliberately high (`min_island` ~0.2, where a size-only
    rule used 0.05). Size was fragile in the other direction too: it is
    measured against the largest component, so an aggressive key that
    fragments the subject shrinks the yardstick and a watermark quietly
    clears it. Proximity does not care how the subject fragmented -- the
    fragments are all still beside each other.

    Labelling runs on a downsampled mask for speed, then the keep-mask is
    dilated before upsampling so thin features such as a sword blade are not
    clipped at the boundary.

    Returns (cleaned, removed_components, removed_pixels, kept_detached).
    """
    alpha = rgba[..., 3]
    mask = alpha > 0.5
    if not mask.any():
        return rgba, 0, 0, 0

    height, width = mask.shape
    step = max(1, int(np.ceil(max(height, width) / 320)))
    small = mask[::step, ::step]
    sh, sw = small.shape

    # Two-pass connected components with union-find.
    labels = np.zeros((sh, sw), dtype=np.int32)
    parent = [0]

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    next_label = 1
    for y in range(sh):
        for x in range(sw):
            if not small[y, x]:
                continue
            up = labels[y - 1, x] if y > 0 else 0
            left = labels[y, x - 1] if x > 0 else 0
            if up and left:
                labels[y, x] = min(up, left)
                if up != left:
                    union(int(up), int(left))
            elif up:
                labels[y, x] = up
            elif left:
                labels[y, x] = left
            else:
                parent.append(next_label)
                labels[y, x] = next_label
                next_label += 1

    if next_label == 1:
        return rgba, 0, 0, 0

    roots = np.array([find(i) for i in range(next_label)], dtype=np.int32)
    resolved = roots[labels]

    ids, counts = np.unique(resolved[resolved > 0], return_counts=True)
    if ids.size <= 1:
        return rgba, 0, 0, 0

    def component_bbox(component_id: int) -> tuple[int, int, int, int]:
        ys, xs = np.nonzero(resolved == component_id)
        return int(ys.min()), int(xs.min()), int(ys.max()), int(xs.max())

    main_id = int(ids[int(np.argmax(counts))])
    main_box = component_bbox(main_id)
    largest = int(counts.max())

    # Distance budget in downsampled cells.
    near_cells = near_fraction * max(height, width) / step

    keep_ids: list[int] = []
    drop_ids: list[int] = []
    kept_detached = 0

    for component_id, count in zip(ids.tolist(), counts.tolist()):
        if component_id == main_id:
            keep_ids.append(component_id)
            continue
        big_enough = count >= largest * min_ratio
        near = _bbox_gap(component_bbox(component_id), main_box) <= near_cells
        if big_enough or near:
            keep_ids.append(component_id)
            kept_detached += 1
        else:
            drop_ids.append(component_id)

    if not drop_ids:
        return rgba, 0, 0, kept_detached

    keep_small = np.isin(resolved, keep_ids)
    # Dilate so upsampling does not eat thin edges of what we are keeping.
    keep_small = _shift_or(_shift_or(keep_small))

    keep_full = np.repeat(np.repeat(keep_small, step, axis=0), step, axis=1)
    keep_full = keep_full[:height, :width]
    if keep_full.shape != mask.shape:
        padded = np.zeros(mask.shape, dtype=bool)
        padded[: keep_full.shape[0], : keep_full.shape[1]] = keep_full
        keep_full = padded

    removed_pixels = int((mask & ~keep_full).sum())

    cleaned = rgba.copy()
    cleaned[..., 3] = np.where(keep_full, alpha, 0.0)
    return cleaned, len(drop_ids), removed_pixels, kept_detached


def _sparse_components(mask: np.ndarray) -> list[np.ndarray]:
    """
    Connected components of a SPARSE mask, as arrays of flat indices.

    Flood fill over the set pixels rather than a raster scan of the frame. The
    watermark mask is a few hundred pixels out of half a million, so walking
    only what is set is both faster and exact -- no downsampling, which
    matters when the thing being measured is 30 pixels across.
    """
    height, width = mask.shape
    remaining = set(np.flatnonzero(mask).tolist())
    components: list[np.ndarray] = []

    while remaining:
        seed = remaining.pop()
        stack = [seed]
        found = [seed]
        while stack:
            index = stack.pop()
            y, x = divmod(index, width)
            for ny, nx in (
                (y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1),
                (y - 1, x - 1), (y - 1, x + 1), (y + 1, x - 1), (y + 1, x + 1),
            ):
                if not (0 <= ny < height and 0 <= nx < width):
                    continue
                neighbour = ny * width + nx
                if neighbour in remaining:
                    remaining.discard(neighbour)
                    stack.append(neighbour)
                    found.append(neighbour)
        components.append(np.array(found, dtype=np.int64))

    return components


def scrub_watermark(rgba: np.ndarray) -> tuple[np.ndarray, int, int]:
    """
    Erase the generator's watermark by colour.

    WHY NOT reject_isolated_artifacts
    ---------------------------------
    That one removes marks stamped in a corner, away from the subject. This
    generator puts its sparkle at the character's feet, close enough that the
    proximity rule protecting Apollyon's halo shards protects the watermark
    too -- and on Apollyon it actually overlaps a tentacle, so no
    component-based rule can take it without taking the tentacle.

    Colour can. The mark is mid-grey; the palette has no mid-grey. Selecting
    on saturation and luminance therefore lifts the sparkle off the tentacle
    and leaves the tentacle behind, because the tentacle is magenta.

    Small components only. A size floor keeps scattered antialiasing pixels
    between white and dark art from being punched into pinholes, and a ceiling
    means a character that legitimately wore a grey panel would keep it -- and
    would show up as a surprising pixel count in the report rather than
    silently losing the panel.

    Returns (cleaned, blob_count, pixel_count).
    """
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]

    saturation = rgb.max(axis=-1) - rgb.min(axis=-1)
    lum = luminance(rgb)
    low, high = WATERMARK_LUMINANCE_BAND

    grey = (
        (alpha > 0.5)
        & (saturation < WATERMARK_MAX_SATURATION)
        & (lum > low)
        & (lum < high)
    )
    if not grey.any():
        return rgba, 0, 0

    subject_pixels = int((alpha > 0.5).sum())
    max_pixels = max(
        WATERMARK_MIN_PIXELS, int(subject_pixels * WATERMARK_MAX_FRACTION)
    )

    doomed = np.zeros(grey.shape, dtype=bool)
    blobs = 0
    for component in _sparse_components(grey):
        if WATERMARK_MIN_PIXELS <= component.size <= max_pixels:
            doomed.flat[component] = True
            blobs += 1

    if blobs == 0:
        return rgba, 0, 0

    # Take the mark's own antialiased edge with it. Left behind it is a faint
    # grey outline of the shape that was just removed, which is more obviously
    # wrong than the sparkle was.
    doomed = _shift_or(doomed)

    cleaned = rgba.copy()
    cleaned[..., 3] = np.where(doomed, 0.0, alpha)
    return cleaned, blobs, int(doomed.sum())


def content_bbox(alpha: np.ndarray, threshold: float = 0.05):
    """Tight bounding box of everything meaningfully opaque."""
    mask = alpha > threshold
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any() or not cols.any():
        raise SystemExit(
            "No subject found -- the whole image was treated as background.\n"
            "Try raising --tolerance, or check that the key colour matches."
        )
    top, bottom = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]
    return int(left), int(top), int(right) + 1, int(bottom) + 1


def resample_premultiplied(rgba: np.ndarray, width: int, height: int) -> Image.Image:
    """
    Resize RGBA without dragging the background back in.

    A fully transparent pixel still HOLDS a colour, and after a colour key
    that colour is the background we just removed. LANCZOS mixes neighbours,
    so resampling straight RGBA pulls green out of the invisible pixels and
    back into the visible edge -- reconstituting, at output resolution, the
    exact fringe that erode and despill removed at source resolution.

    Multiplying colour by alpha first makes those pixels contribute nothing,
    which is the only correct way to filter an image with transparency. Then
    divide back out to restore straight alpha, which is what PNG stores.
    """
    a = rgba[..., 3:4]
    premultiplied = np.concatenate([np.clip(rgba[..., :3], 0, 1) * a, a], axis=-1)

    image = Image.fromarray((premultiplied * 255).astype(np.uint8), "RGBA")
    image = image.resize((width, height), Image.LANCZOS)

    out = np.asarray(image, dtype=np.float64) / 255.0
    alpha = out[..., 3:4]
    straight = np.divide(out[..., :3], alpha, out=np.zeros_like(out[..., :3]), where=alpha > 1e-4)
    out[..., :3] = np.clip(straight, 0.0, 1.0)

    return Image.fromarray((out * 255).astype(np.uint8), "RGBA")


def normalise(rgba: np.ndarray, target_width: int, target_height: int) -> np.ndarray:
    """
    Trim to the subject, then place it in the profile's frame with a
    consistent margin and the feet near the bottom edge.

    This is what makes a cast look coherent. Generators frame subjects
    differently every time; without normalisation one character stands taller
    in frame than another and, because the sprite layer derives world width
    from the texture aspect, they end up different heights in the scene for
    no reason anyone can see.

    Note what this does NOT do: it does not preserve relative height between
    characters. Everyone is scaled to fill their own frame, so the halfling
    and the dragonborn come out the same pixel height. Real scale is carried
    entirely by `worldHeight` in spawnCast -- which is why the report prints
    the number to use.
    """
    left, top, right, bottom = content_bbox(rgba[..., 3])
    subject = rgba[top:bottom, left:right]

    sub_h, sub_w = subject.shape[:2]

    usable_h = target_height * (1 - MARGIN_FRACTION - FOOT_MARGIN_FRACTION)
    usable_w = target_width * (1 - 2 * MARGIN_FRACTION)

    scale = min(usable_h / sub_h, usable_w / sub_w)
    new_w = max(1, int(round(sub_w * scale)))
    new_h = max(1, int(round(sub_h * scale)))

    resized = resample_premultiplied(subject, new_w, new_h)

    canvas = Image.new("RGBA", (target_width, target_height), (0, 0, 0, 0))
    x = (target_width - new_w) // 2
    y = target_height - int(target_height * FOOT_MARGIN_FRACTION) - new_h
    canvas.paste(resized, (x, max(0, y)))

    return np.asarray(canvas, dtype=np.float64) / 255.0


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


class Report:
    def __init__(self) -> None:
        self.lines: list[tuple[str, str, str]] = []
        self.failed = False

    def check(self, ok: bool, name: str, detail: str, fatal: bool = True) -> None:
        if ok:
            status = "PASS"
        elif fatal:
            status = "FAIL"
            self.failed = True
        else:
            status = "WARN"
        self.lines.append((status, name, detail))

    def note(self, name: str, detail: str) -> None:
        """A measurement worth reading that has no pass/fail answer."""
        self.lines.append(("INFO", name, detail))

    def render(self) -> str:
        width = max(len(name) for _, name, _ in self.lines)
        out = []
        for status, name, detail in self.lines:
            out.append(f"  [{status}] {name.ljust(width)}  {detail}")
        return "\n".join(out)


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def validate(
    rgba: np.ndarray,
    key: tuple[int, int, int] | None,
    profile: Profile,
    profile_name: str,
    source_border_alpha: float | None = None,
    character_height: float | None = None,
    notes: tuple[tuple[str, str], ...] = (),
) -> Report:
    report = Report()
    alpha = rgba[..., 3]
    rgb = rgba[..., :3]
    height, width = alpha.shape

    solid = alpha > 0.5
    coverage = solid.mean()

    # Coverage bounds are per-profile because they measure silhouette, and
    # the silhouettes are deliberately different. A lean rogue and a colossal
    # tentacled bust cannot share a ceiling without the ceiling being so high
    # it stops catching anything.
    report.check(
        profile.min_coverage <= coverage <= profile.max_coverage,
        "subject coverage",
        f"{coverage:.1%} of frame "
        f"(want {profile.min_coverage:.0%}-{profile.max_coverage:.0%} "
        f"for {profile_name})",
    )

    # A fully opaque border means the background survived the cutout.
    #
    # Measured on the SOURCE image, before normalisation. normalise() pads
    # with transparent pixels to reach the canonical aspect, so a frame that
    # still has its background baked in comes out with a clean transparent
    # border anyway -- the check would pass on an image that is entirely
    # wrong. Caught by a deliberate bad-input test.
    if source_border_alpha is not None:
        report.check(
            source_border_alpha < 0.1,
            "transparent border",
            f"max source border alpha {source_border_alpha:.2f} (want < 0.10)",
        )

    # Silhouette must not fill its own bounding box. A real character occupies
    # roughly 30-70% of its bbox; anything near 100% is a rectangle, which
    # means the background was never removed.
    left, top, right, bottom = content_bbox(alpha, threshold=0.5)
    bbox_area = max((right - left) * (bottom - top), 1)
    fill = solid.sum() / bbox_area
    report.check(
        fill < profile.max_bbox_fill,
        "silhouette not a block",
        f"{fill:.0%} of bounding box is opaque "
        f"(want < {profile.max_bbox_fill:.0%})",
    )

    # Feet near the bottom: the sprite layer grounds the plane by its bottom
    # edge, so trapped empty space below the feet makes the character hover.
    rows = np.where(np.any(solid, axis=1))[0]
    if rows.size:
        gap = (height - 1 - rows[-1]) / height
        report.check(
            gap < 0.10,
            "feet at bottom",
            f"{gap:.1%} empty below feet (want < 10%)",
        )

    # How much of the frame the character actually occupies, and therefore
    # what worldHeight makes it the intended size in the scene.
    #
    # A wide subject -- Lyra, Apollyon -- is fitted by WIDTH, so it does not
    # reach the top of its frame. The sprite plane is then taller than the
    # character, and the character renders shorter than worldHeight suggests.
    # createCharacterSprite measures the same empty margins as headInset and
    # feetInset, so this arithmetic matches what the engine will do.
    used_h = (bottom - top) / height
    used_w = (right - left) / width
    detail = f"fills {used_h:.0%} of frame height, {used_w:.0%} of width"
    if character_height is not None and used_h > 0:
        detail += f" -> worldHeight {character_height / used_h:.2f}"
        detail += f" for a {character_height:.2f}-unit character"
    report.note("world scale", detail)

    # Halo / spill: pixels still leaning toward the background colour. This is
    # what glows against a dark scene.
    #
    # Every visible pixel is measured, not just the partial ones -- a soft
    # generator leaves an OPAQUE contaminated ring, and a partial-alpha-only
    # check cannot see it. Measured as cast rather than distance for the
    # reason given on `key_cast`: distance cannot tell a green fringe from the
    # palette's own plum.
    #
    # This should read 0.00% on any run that did not disable --despill. It is
    # here to prove that, and to catch a source that arrived pre-cut with a
    # fringe already baked in.
    if key is not None:
        visible = alpha > 0.02
        if visible.any():
            key_norm = np.array(key, dtype=np.float64) / 255.0
            cast = key_cast(rgb, key_norm)[visible]
            spill = float((cast > 8 / 255).mean())
            report.check(
                spill < MAX_SPILL_FRACTION,
                "no key-colour spill",
                f"{spill:.2%} of visible pixels lean toward the key "
                f"(want < {MAX_SPILL_FRACTION:.0%})",
            )

    for name, detail in notes:
        report.note(name, detail)

    # Key light must come from the upper FRONT-LEFT. Compare the MEAN
    # brightness of the lit half against the shadow half.
    #
    # This used to be a luminance centroid, which conflates lighting with
    # mass: it asks "where is the bright stuff", so a character holding a
    # pale sword out to the right, or wearing a bulky pack on one side, fails
    # a check about light direction for a reason that is purely silhouette.
    # Per-side means normalise that away -- they ask "is the left side of
    # this character brighter than the right side", which is the actual
    # contract, and it holds for a lean rogue and a tentacled bust alike.
    if solid.any():
        ys, xs = np.nonzero(solid)
        lum = luminance(rgb)[solid]
        midline = (left + right) / 2
        left_side = xs < midline
        right_side = ~left_side
        if left_side.any() and right_side.any():
            lit = float(lum[left_side].mean())
            shade = float(lum[right_side].mean())
            bias = (lit - shade) / max(lit + shade, 1e-6)
            report.check(
                bias > profile.min_light_bias,
                "key light on left",
                f"left half {bias:+.1%} brighter than right "
                f"(want > {profile.min_light_bias:+.1%})",
                fatal=profile.light_is_fatal,
            )

    # Shadow floor. #29081E is the darkest value the prompts permit anywhere
    # on a character; below it the shadow side merges with the #13060D
    # backdrop and the silhouette dissolves once composited. That failure
    # never shows up in the source PNG, only in the scene.
    #
    # Stated as "how much of the character is under the floor" rather than as
    # a contrast number, because the floor IS the contrast number: plum sits
    # only 7/255 above the backdrop, so any threshold much above that would
    # reject art that obeyed the brief exactly.
    if solid.any():
        floor_lum = float(luminance(np.array(SHADOW_FLOOR, dtype=np.float64) / 255.0))
        bg_lum = float(luminance(np.array(SCENE_BACKGROUND, dtype=np.float64) / 255.0))
        subject_lum = luminance(rgb)[solid]
        below = float((subject_lum < floor_lum - 2 / 255).mean())
        darkest = float(np.percentile(subject_lum, 5))
        report.check(
            below < MAX_BELOW_FLOOR,
            "shadow floor",
            f"{below:.1%} darker than #29081E "
            f"(want < {MAX_BELOW_FLOOR:.0%}); 5th pct sits "
            f"{(darkest - bg_lum) * 255:+.0f}/255 from the backdrop",
            fatal=False,
        )

    # Palette adherence. Generators drift; this catches a character that came
    # back in teal and orange instead of plum and magenta.
    if solid.any():
        swatches = np.array(list(PALETTE.values()), dtype=np.float64) / 255.0
        sample = rgb[solid]
        if sample.shape[0] > 40000:
            idx = np.random.default_rng(0).choice(sample.shape[0], 40000, replace=False)
            sample = sample[idx]
        distances = np.sqrt(
            ((sample[:, None, :] - swatches[None, :, :]) ** 2).sum(axis=-1)
        )
        nearest = distances.min(axis=1) * 255
        adherence = float((nearest < PALETTE_TOLERANCE).mean())
        report.check(
            adherence >= MIN_PALETTE_ADHERENCE,
            "palette adherence",
            f"{adherence:.0%} within tolerance (want >= {MIN_PALETTE_ADHERENCE:.0%})",
            fatal=False,
        )

    # The frame is whatever the profile asked for -- portrait for the party,
    # square for the boss. What must hold is that the output IS that frame:
    # the sprite layer derives world width from the texture aspect, so a
    # letterboxed or mis-sized image is a silently wrong-shaped character.
    report.check(
        (width, height) == (profile.width, profile.height),
        "frame as requested",
        f"{width}x{height} (want {profile.width}x{profile.height}, {profile_name})",
    )

    return report


# --------------------------------------------------------------------------
# Contact sheet
# --------------------------------------------------------------------------


def write_contact_sheet(rgba: np.ndarray, path: Path) -> None:
    """
    Composite the sprite over the real scene backdrop, beside a checkerboard.

    The checkerboard shows the cutout; the backdrop shows what actually
    matters -- whether the silhouette survives against #13060D. A sprite can
    look perfect on white and vanish in the scene.
    """
    height, width = rgba.shape[:2]
    sprite = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")

    checker = Image.new("RGB", (width, height), (210, 210, 210))
    pixels = checker.load()
    for y in range(0, height, 16):
        for x in range(0, width, 16):
            if ((x // 16) + (y // 16)) % 2 == 0:
                for dy in range(min(16, height - y)):
                    for dx in range(min(16, width - x)):
                        pixels[x + dx, y + dy] = (170, 170, 170)
    checker.paste(sprite, (0, 0), sprite)

    backdrop = Image.new("RGB", (width, height), SCENE_BACKGROUND)
    backdrop.paste(sprite, (0, 0), sprite)

    sheet = Image.new("RGB", (width * 2 + 12, height), (24, 24, 24))
    sheet.paste(checker, (0, 0))
    sheet.paste(backdrop, (width + 12, 0))
    sheet.save(path)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def resolve_profile(args: argparse.Namespace) -> tuple[Profile, str, float | None]:
    """
    Pick the profile, then apply any explicit overrides on top of it.

    Selection order: --profile, then the CAST table by output name, then
    humanoid. Naming the output `apollyon` is enough to get the boss frame;
    nobody has to remember --width 1024 at 1am.
    """
    character_height: float | None = None

    if args.profile:
        name = args.profile
    elif args.name in CAST:
        name, character_height = CAST[args.name]
    else:
        name = DEFAULT_PROFILE

    if name not in PROFILES:
        raise SystemExit(
            f"Unknown profile {name!r}. Choose one of: "
            f"{', '.join(sorted(PROFILES))}."
        )

    if args.character_height is not None:
        character_height = args.character_height

    profile = PROFILES[name]
    overrides: dict[str, object] = {}
    if args.width is not None:
        overrides["width"] = args.width
    if args.height is not None:
        overrides["height"] = args.height
    if args.min_island is not None:
        overrides["min_island"] = args.min_island
    if overrides:
        profile = Profile(**{**profile.__dict__, **overrides})

    return profile, name, character_height


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare and validate an AI-generated character sprite.",
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    p_alpha = sub.add_parser("alpha", help="source already has transparency")
    p_alpha.add_argument("input", type=Path)

    p_key = sub.add_parser("key", help="flat colour background, chroma key")
    p_key.add_argument("input", type=Path)
    p_key.add_argument("--key", default="#00FF00", help="background hex")
    p_key.add_argument("--tolerance", type=float, default=60.0)
    p_key.add_argument("--softness", type=float, default=40.0)
    p_key.add_argument(
        "--erode",
        type=float,
        default=1.0,
        help=(
            "Choke the matte inward by this many source pixels, discarding "
            "the contaminated outer ring. Raise to 2-3 for a generator with a "
            "soft edge; drop to 0 if thin detail such as a blade is being "
            "eaten. Default 1."
        ),
    )
    p_key.add_argument(
        "--despill",
        type=float,
        default=1.0,
        metavar="STRENGTH",
        help=(
            "0..1. Removes the key's colour cast from every visible pixel, "
            "which is what clears an opaque green fringe. Default 1 (full). "
            "0 disables it, which is only useful for seeing what the source "
            "actually looked like."
        ),
    )

    p_pair = sub.add_parser("pair", help="recover alpha from white/black renders")
    p_pair.add_argument("--white", type=Path, required=True)
    p_pair.add_argument("--black", type=Path, required=True)

    for p in (p_alpha, p_key, p_pair):
        p.add_argument("-o", "--name", required=True, help="output name, e.g. kira")
        p.add_argument(
            "--outdir", type=Path, default=Path("public/characters"),
        )
        p.add_argument(
            "--no-sheet", action="store_true", help="skip the contact sheet"
        )
        p.add_argument(
            "--profile",
            choices=sorted(PROFILES),
            help=(
                "Silhouette class. Defaults to the one this name is listed "
                "with in CAST, or 'humanoid' for an unknown name."
            ),
        )
        p.add_argument(
            "--width",
            type=int,
            help=(
                "Override the profile's frame width. The portrait frame suits "
                "humanoids; a wide subject needs a wider frame or it "
                "letterboxes and loses resolution."
            ),
        )
        p.add_argument("--height", type=int, help="Override the frame height.")
        p.add_argument(
            "--character-height",
            type=float,
            help=(
                "Intended visible height in world units. Only used to print "
                "the worldHeight to put in spawnCast."
            ),
        )
        p.add_argument(
            "--min-island",
            type=float,
            help=(
                "Discard DISTANT disconnected blobs smaller than this fraction "
                "of the largest one. Removes generator watermarks. Blobs near "
                "the subject -- halo shards, a floating staff gem -- are kept "
                "whatever their size. Set 0 to keep everything."
            ),
        )
        p.add_argument(
            "--keep-watermark",
            action="store_true",
            help=(
                "Keep mid-grey specks that would otherwise be scrubbed as a "
                "generator watermark. Use if a character legitimately wears "
                "grey -- and check the report's pixel count first."
            ),
        )
        p.add_argument(
            "--island-distance",
            type=float,
            default=ISLAND_NEAR_FRACTION,
            help=(
                "How close a detached blob must be to the subject to count as "
                "part of it, as a fraction of the longest side."
            ),
        )

    args = parser.parse_args()

    profile, profile_name, character_height = resolve_profile(args)

    key_colour: tuple[int, int, int] | None = None
    notes: list[tuple[str, str]] = []

    if args.mode == "alpha":
        rgba = alpha_from_existing(load_rgba(args.input))
    elif args.mode == "key":
        key_colour = parse_hex(args.key)
        rgba, contaminated = alpha_from_colour_key(
            load_rgba(args.input),
            key_colour,
            args.tolerance,
            args.softness,
            args.erode,
            args.despill,
        )
        notes.append(
            (
                "edge treatment",
                f"{contaminated:.1%} of visible pixels arrived carrying key "
                f"colour; despill {args.despill:.2f}, matte choked "
                f"{args.erode:g}px",
            )
        )
    else:
        rgba = alpha_from_pair(load_rgba(args.white), load_rgba(args.black))

    # Sample the border before normalisation pads the frame.
    source_alpha = rgba[..., 3]
    source_border = float(
        np.concatenate(
            [
                source_alpha[0, :],
                source_alpha[-1, :],
                source_alpha[:, 0],
                source_alpha[:, -1],
            ]
        ).max()
    )

    # Both watermark passes run BEFORE the subject is measured, or the mark
    # widens the bounding box and the character is scaled down to make room
    # for it. Colour first, because the sparkle this generator stamps sits
    # close enough to the feet that the proximity rule below protects it.
    if not args.keep_watermark:
        rgba, mark_blobs, mark_pixels = scrub_watermark(rgba)
        if mark_blobs:
            notes.append(
                (
                    "watermark",
                    f"scrubbed {mark_pixels} px in {mark_blobs} grey blob"
                    f"{'s' if mark_blobs != 1 else ''}",
                )
            )

    rgba, dropped_count, dropped_pixels, kept_detached = reject_isolated_artifacts(
        rgba, profile.min_island, args.island_distance
    )

    rgba = normalise(rgba, profile.width, profile.height)

    if key_colour is not None and args.despill > 0:
        # Again, after the resize. LANCZOS filters each channel on its own, so
        # it does not preserve the "key channel stays under the others"
        # relation that suppression established -- its overshoot at a hard
        # edge puts a little of the cast back. Sub-pixel amounts, but they sit
        # exactly on the silhouette, which is where they show.
        rgba[..., :3] = suppress_key_cast(
            rgba[..., :3], np.array(key_colour, dtype=np.float64) / 255.0, args.despill
        )

    args.outdir.mkdir(parents=True, exist_ok=True)
    out_path = args.outdir / f"{args.name}.png"
    Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").save(out_path)

    report = validate(
        rgba,
        key_colour,
        profile,
        profile_name,
        source_border,
        character_height,
        tuple(notes),
    )

    print(
        f"\n{args.name} -> {out_path}  "
        f"({profile.width}x{profile.height}, {profile_name}: {profile.why})\n"
    )
    if dropped_count:
        print(
            f"  removed {dropped_count} distant artifact"
            f"{'s' if dropped_count != 1 else ''} "
            f"({dropped_pixels} px) -- likely a generator watermark\n"
        )
    if kept_detached:
        print(
            f"  kept {kept_detached} detached piece"
            f"{'s' if kept_detached != 1 else ''} near the subject -- "
            f"halo shards and floating props are part of the silhouette.\n"
            f"  If one of them is a watermark, lower --island-distance.\n"
        )
    print(report.render())

    if not args.no_sheet:
        sheet_path = args.outdir / f"{args.name}.check.png"
        write_contact_sheet(rgba, sheet_path)
        print(f"\n  contact sheet: {sheet_path}")
        print("  left = cutout on checkerboard, right = over the scene backdrop")

    if report.failed:
        print("\n  Constraints violated. Fix or regenerate before using this asset.\n")
        return 1

    print("\n  All hard constraints met.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
