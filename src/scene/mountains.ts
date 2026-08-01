/**
 * Ridge geometry for the mountain valley.
 *
 * Pure functions over numbers, no three.js -- the same split spriteLayout.ts
 * follows, and for the same reason: the constraints here are the ones worth
 * asserting, and asserting them in Vitest costs milliseconds where asserting
 * them through a browser costs seconds and a screenshot to read.
 *
 * battleScene.ts turns what comes out of here into meshes and does no
 * geometry maths of its own.
 *
 * WHAT THE VALLEY IS
 * ------------------
 * Ranges of flat silhouette cutouts at several depths, flanking left and
 * right, with a gap at centre so the sun still shows through. Layering them
 * in depth is what makes a valley rather than a backdrop: fog carries the far
 * ranges toward the void colour on its own, so the recession costs no
 * per-range tuning.
 */

import type { Rng } from '../rng';
import { CANONICAL_ASPECT } from './spriteLayout';

/**
 * The locked camera, mirrored as plain numbers.
 *
 * Duplicated from battleScene.ts rather than imported, for the same reason
 * spriteLayout.ts duplicates PLATFORM_RADIUS: that module owns a
 * THREE.Vector3 and this one deliberately has no three.js dependency. The
 * camera is a documented contract that does not move without an explicit
 * instruction, so the duplication is cheap -- and if it ever does move, the
 * window test here fails rather than the mountains quietly drifting off the
 * frame they were composed against.
 */
const CAMERA_FOV = 32;
const CAMERA_Z = 11;

/**
 * Fraction of the frame's half-width kept clear of ridge crests, so the sun
 * is seen through a window rather than over a wall.
 *
 * A COMPOSITION CONSTRAINT, in the same family as PLATFORM_SAFE_RADIUS and
 * --card-strip: the camera is locked, the sun is centred, and this is the
 * share of frame the mountains may not close over.
 *
 * MEASURED AGAINST THE SUN, not picked. The disc spans about 0.11 of the
 * frame's width either side of centre, which is 0.22 of the half-width. A
 * window at 0.34 cleared the sun entirely and the ridges read as unrelated
 * shapes off in the corners; at 0.20 they climb into its lower corners and
 * it becomes a sun seen THROUGH something, which is the whole request. Most
 * of the disc is still open sky.
 */
export const SUN_WINDOW_FRACTION = 0.2;

/**
 * World-space half-width of the visible frame at a given depth.
 *
 * Straight frustum maths, but worth having by name: everything below is
 * expressed as a fraction of it rather than in world units, which is what
 * makes a constraint hold at every depth instead of at the one it was
 * measured at.
 */
export function frameHalfWidth(z: number, aspect = CANONICAL_ASPECT): number {
  const distance = Math.abs(CAMERA_Z - z);
  return distance * Math.tan((CAMERA_FOV * Math.PI) / 360) * aspect;
}

/**
 * How wide the sun's window is, in world units, at a given depth.
 *
 * THE WINDOW IS AN ANGLE, NOT A DISTANCE, and this is the function that says
 * so. Ranges sit at different depths; a gap of a fixed number of world units
 * would subtend a wide angle up close and a narrow one far away, so the near
 * ranges would gape while the far ones closed over the sun. Scaling the gap
 * with depth keeps every range clear of the same part of the FRAME, which is
 * the only place the constraint actually means anything.
 */
export function sunWindowHalfWidth(z: number, aspect = CANONICAL_ASPECT): number {
  return frameHalfWidth(z, aspect) * SUN_WINDOW_FRACTION;
}

export interface RidgeOptions {
  /** Depth of the range. Negative is further from the camera. */
  z: number;
  /** Number of samples across the ridge. More is smoother and costs more. */
  samples: number;
  /** Crest height at the frame edge, in world units above the horizon plane. */
  peakHeight: number;
  /** Crest height where the ridge meets the window, as a share of peakHeight. */
  shoulderFraction: number;
  /** How much the profile is allowed to wander, as a share of peakHeight. */
  jitter: number;
  /** Y the curtain hangs down to. Must be below the horizon or it floats. */
  baseY: number;
  aspect?: number;
}

export interface RidgeSample {
  x: number;
  /** Crest height. At or below `baseY` means "no mountain here". */
  y: number;
}

/**
 * The horizon plane's height, which a crest is measured against.
 *
 * The grid ocean sits here, so a crest below it is hidden by the water and a
 * crest above it is a mountain. Mirrored from battleScene.ts rather than
 * imported, exactly as PLATFORM_RADIUS is in spriteLayout.ts -- this module
 * does not depend on three.js and will not start now. If the grid moves,
 * move this, and the test asserting the window stays open will tell you if
 * you forgot.
 */
export const HORIZON_Y = -0.6;

/**
 * One range's crest, sampled left to right.
 *
 * The profile rises from the window toward the frame edges, which is what
 * produces a valley rather than a row of hills. Inside the window every
 * sample is pinned to `baseY` -- not merely lowered, PINNED -- so no seed can
 * produce a peak in front of the sun. That is the fitSpacingToPlatform move:
 * a composition rule the geometry enforces rather than one the caller is
 * trusted to respect.
 *
 * Seeded rather than random. `Math.random()` is banned project-wide, and the
 * screenshot baseline needs the same seed to build the same mountains.
 */
export function ridgeProfile(rng: Rng, options: RidgeOptions): RidgeSample[] {
  const {
    z,
    samples,
    peakHeight,
    shoulderFraction,
    jitter,
    baseY,
    aspect = CANONICAL_ASPECT,
  } = options;

  if (samples < 2) {
    throw new Error(`A ridge needs at least 2 samples, got ${samples}`);
  }

  /* Wider than the frame on purpose. A ridge that stops exactly at the edge
     shows its end as a vertical cut the moment the window is anything but
     16:9, and the composition is authored for 16:9 but must not fall apart
     off it. */
  const halfWidth = frameHalfWidth(z, aspect) * 1.25;
  const windowHalf = sunWindowHalfWidth(z, aspect);

  const profile: RidgeSample[] = [];

  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const x = -halfWidth + t * 2 * halfWidth;
    const distanceFromCentre = Math.abs(x);

    if (distanceFromCentre <= windowHalf) {
      /* The window. Flat and below the waterline, so the sun is unobstructed
         and the curtain still has geometry to hang from. */
      profile.push({ x, y: baseY });
      continue;
    }

    /* Ramp from the window's edge out to the frame edge. Squared so the
       ridge leaves the window low and gathers height as it goes -- a linear
       ramp reads as a wedge, not as terrain. */
    const reach = Math.max(halfWidth - windowHalf, 1e-6);
    const outward = Math.min((distanceFromCentre - windowHalf) / reach, 1);
    const shoulder = peakHeight * shoulderFraction;
    const base = shoulder + (peakHeight - shoulder) * outward * outward;

    /* Jitter scaled by how far out we are, so the profile is smooth where it
       meets the window and rugged at the peaks. Without that taper a single
       unlucky draw puts a spike at the window's lip. */
    const wobble = (rng.next() * 2 - 1) * jitter * peakHeight * outward;

    profile.push({ x, y: HORIZON_Y + Math.max(base + wobble, 0) });
  }

  return profile;
}

/**
 * The stretches of a profile that are actually mountain, left to right.
 *
 * A ridge is pinned to `baseY` across the window, so a crest line drawn over
 * the whole profile dives to the hem, runs across the middle of the frame and
 * climbs back -- a bright cyan diagonal through the sun's window, which is
 * both wrong and the most visible thing on screen. Splitting the profile into
 * the runs that rise above the horizon gives the crest exactly the geometry it
 * should trace and nothing else.
 *
 * Returned as separate runs rather than a filtered list, because a single
 * `Line` through both sides would just reintroduce the connecting segment.
 */
export function crestRuns(profile: readonly RidgeSample[]): RidgeSample[][] {
  const runs: RidgeSample[][] = [];
  let current: RidgeSample[] = [];

  for (const sample of profile) {
    if (sample.y > HORIZON_Y) {
      current.push(sample);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);

  /* A run of one is a single vertex: no line to draw, and a Line built from
     it renders nothing while still costing a draw call. */
  return runs.filter((run) => run.length > 1);
}

/**
 * True when a profile leaves the sun's window genuinely open.
 *
 * The check the composition depends on, exported so it can be asserted
 * directly rather than inferred from a screenshot. A crest at or below the
 * horizon inside the window is fine -- the water hides it.
 */
export function windowIsOpen(
  profile: readonly RidgeSample[],
  z: number,
  aspect = CANONICAL_ASPECT,
): boolean {
  const windowHalf = sunWindowHalfWidth(z, aspect);
  return profile.every(
    (sample) => Math.abs(sample.x) > windowHalf || sample.y <= HORIZON_Y,
  );
}
