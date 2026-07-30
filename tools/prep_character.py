#!/usr/bin/env python3
"""
Character sprite prep and validation.

Turns whatever an image generator hands you into a sprite that satisfies this
project's constraints -- and, more usefully, TELLS YOU when it doesn't.

The manual checklist in public/characters/README.md is fine for one asset. For
five party members plus a boss, each possibly regenerated several times, it is
exactly the kind of repetitive eyeballing that gets skipped when you are tired.
This automates it.

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
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# Project constraints. These mirror public/characters/README.md and the
# palette in src/scene/battleScene.ts. Change them in all three or not at all.
# --------------------------------------------------------------------------

TARGET_WIDTH = 512
TARGET_HEIGHT = 1024
MARGIN_FRACTION = 0.04          # empty border kept on every side
FOOT_MARGIN_FRACTION = 0.03     # feet sit this far above the bottom edge

# Brand palette, sampled from the SideQuest Cyber site design.
PALETTE = {
    "void": (0x13, 0x06, 0x0D),
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

# Validation thresholds.
MIN_COVERAGE = 0.08         # subject must occupy at least this much of frame
MAX_COVERAGE = 0.60         # more than this means background wasn't removed
MAX_SPILL_FRACTION = 0.02   # edge pixels still carrying the key colour
MIN_PALETTE_ADHERENCE = 0.70
PALETTE_TOLERANCE = 70      # RGB euclidean distance counted as "on palette"
MIN_BACKGROUND_CONTRAST = 28


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
    rgba: np.ndarray, key: tuple[int, int, int], tolerance: float, softness: float
) -> np.ndarray:
    """
    Mode 'key'. Deterministic distance-based key with a soft ramp, plus
    despill.

    Exact and instant. No model weights, no network, no nondeterminism -- the
    same input always produces the same cutout, which matters when you are
    regenerating assets and comparing results.
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

    # Despill: at partially transparent edges the pixel is a blend of subject
    # and background, so it carries the key hue. Left alone this is the
    # "green halo" that reads as a glowing outline against a dark scene.
    result[..., :3] = despill(result[..., :3], key_norm, alpha)
    return result


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


def reject_isolated_artifacts(
    rgba: np.ndarray, min_ratio: float = 0.05
) -> tuple[np.ndarray, int, int]:
    """
    Erase small disconnected blobs, keeping the character.

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

    Labelling runs on a downsampled mask for speed, then the keep-mask is
    dilated before upsampling so thin features such as a sword blade are not
    clipped at the boundary.

    Returns (cleaned, removed_component_count, removed_pixel_count).
    """
    alpha = rgba[..., 3]
    mask = alpha > 0.5
    if not mask.any():
        return rgba, 0, 0

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
        return rgba, 0, 0

    roots = np.array([find(i) for i in range(next_label)], dtype=np.int32)
    resolved = roots[labels]

    ids, counts = np.unique(resolved[resolved > 0], return_counts=True)
    if ids.size <= 1:
        return rgba, 0, 0

    largest = counts.max()
    keep_ids = ids[counts >= largest * min_ratio]
    drop_ids = ids[counts < largest * min_ratio]

    if drop_ids.size == 0:
        return rgba, 0, 0

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
    return cleaned, int(drop_ids.size), removed_pixels


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


def normalise(rgba: np.ndarray) -> np.ndarray:
    """
    Trim to the subject, then place it in a canonical portrait frame with a
    consistent margin and the feet near the bottom edge.

    This is what makes a cast look coherent. Generators frame subjects
    differently every time; without normalisation one character stands taller
    in frame than another and, because the sprite layer derives world width
    from the texture aspect, they end up different heights in the scene for
    no reason anyone can see.
    """
    left, top, right, bottom = content_bbox(rgba[..., 3])
    subject = rgba[top:bottom, left:right]

    sub_h, sub_w = subject.shape[:2]

    usable_h = TARGET_HEIGHT * (1 - MARGIN_FRACTION - FOOT_MARGIN_FRACTION)
    usable_w = TARGET_WIDTH * (1 - 2 * MARGIN_FRACTION)

    scale = min(usable_h / sub_h, usable_w / sub_w)
    new_w = max(1, int(round(sub_w * scale)))
    new_h = max(1, int(round(sub_h * scale)))

    resized = Image.fromarray((np.clip(subject, 0, 1) * 255).astype(np.uint8), "RGBA")
    resized = resized.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (TARGET_WIDTH, TARGET_HEIGHT), (0, 0, 0, 0))
    x = (TARGET_WIDTH - new_w) // 2
    y = TARGET_HEIGHT - int(TARGET_HEIGHT * FOOT_MARGIN_FRACTION) - new_h
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
    source_border_alpha: float | None = None,
) -> Report:
    report = Report()
    alpha = rgba[..., 3]
    rgb = rgba[..., :3]
    height, width = alpha.shape

    solid = alpha > 0.5
    coverage = solid.mean()

    report.check(
        MIN_COVERAGE <= coverage <= MAX_COVERAGE,
        "subject coverage",
        f"{coverage:.1%} of frame (want {MIN_COVERAGE:.0%}-{MAX_COVERAGE:.0%})",
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
        fill < 0.90,
        "silhouette not a block",
        f"{fill:.0%} of bounding box is opaque (want < 90%)",
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

    # Halo / spill: partially transparent edge pixels still carrying the
    # background colour. This is what glows against a dark scene.
    if key is not None:
        edge = (alpha > 0.02) & (alpha < 0.98)
        if edge.any():
            key_norm = np.array(key, dtype=np.float64) / 255.0
            distance = np.sqrt(((rgb[edge] - key_norm) ** 2).sum(axis=-1))
            spill = float((distance < 0.25).mean())
            report.check(
                spill < MAX_SPILL_FRACTION,
                "no key-colour spill",
                f"{spill:.2%} of edge pixels near key (want < {MAX_SPILL_FRACTION:.0%})",
            )

    # Key light must come from the upper FRONT-LEFT. The lit side is brighter,
    # so the luminance centroid should sit left of the geometric centroid.
    if solid.any():
        ys, xs = np.nonzero(solid)
        lum = luminance(rgb)[solid]
        geometric = xs.mean()
        weighted = float((xs * lum).sum() / max(lum.sum(), 1e-6))
        shift = (weighted - geometric) / width
        report.check(
            shift < -0.005,
            "key light on left",
            f"luminance centroid {shift:+.1%} of width vs centre (want negative)",
        )

    # Value separation from the scene background. If the shadow side is as
    # dark as the backdrop the silhouette dissolves once composited -- a
    # failure that only appears in the scene, never in the source PNG.
    if solid.any():
        bg = np.array(SCENE_BACKGROUND, dtype=np.float64) / 255.0
        bg_lum = float(luminance(bg))
        subject_lum = luminance(rgb)[solid]
        darkest = float(np.percentile(subject_lum, 5))
        contrast = abs(darkest - bg_lum) * 255
        report.check(
            contrast >= MIN_BACKGROUND_CONTRAST,
            "contrast vs backdrop",
            f"{contrast:.0f}/255 at 5th percentile (want >= {MIN_BACKGROUND_CONTRAST})",
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

    report.check(
        abs((width / height) - (TARGET_WIDTH / TARGET_HEIGHT)) < 1e-6,
        "canonical size",
        f"{width}x{height}",
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
            "--min-island",
            type=float,
            default=0.05,
            help=(
                "Discard disconnected blobs smaller than this fraction of the "
                "largest one. Removes generator watermarks. Set 0 to keep "
                "everything."
            ),
        )

    args = parser.parse_args()

    key_colour: tuple[int, int, int] | None = None

    if args.mode == "alpha":
        rgba = alpha_from_existing(load_rgba(args.input))
    elif args.mode == "key":
        key_colour = parse_hex(args.key)
        rgba = alpha_from_colour_key(
            load_rgba(args.input), key_colour, args.tolerance, args.softness
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

    # Strip generator watermarks and other isolated specks BEFORE measuring
    # the subject, or they dominate the framing.
    rgba, dropped_count, dropped_pixels = reject_isolated_artifacts(
        rgba, args.min_island
    )

    rgba = normalise(rgba)

    args.outdir.mkdir(parents=True, exist_ok=True)
    out_path = args.outdir / f"{args.name}.png"
    Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").save(out_path)

    report = validate(rgba, key_colour, source_border)

    print(f"\n{args.name} -> {out_path}  ({TARGET_WIDTH}x{TARGET_HEIGHT})\n")
    if dropped_count:
        print(
            f"  removed {dropped_count} isolated artifact"
            f"{'s' if dropped_count != 1 else ''} "
            f"({dropped_pixels} px) -- likely a generator watermark\n"
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
