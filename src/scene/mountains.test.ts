import { describe, expect, it } from 'vitest';
import {
  crestRuns,
  frameHalfWidth,
  HORIZON_Y,
  ridgeProfile,
  SUN_WINDOW_FRACTION,
  sunWindowHalfWidth,
  windowIsOpen,
  type RidgeOptions,
} from './mountains';
import { createRng } from '../rng';

/**
 * The composition rules, asserted where they are cheap.
 *
 * "Is the sun visible between the mountains" is a question a screenshot
 * answers slowly and badly -- you have to look, and you only see the one seed
 * you happened to render. These are the same question asked as arithmetic,
 * across every seed worth trying.
 */

const RANGE: RidgeOptions = {
  z: -30,
  samples: 64,
  peakHeight: 9,
  shoulderFraction: 0.25,
  jitter: 0.35,
  baseY: HORIZON_Y - 12,
};

describe('frameHalfWidth', () => {
  it('grows with distance from the camera', () => {
    /* The whole reason the window is expressed as a fraction. */
    expect(frameHalfWidth(-50)).toBeGreaterThan(frameHalfWidth(-20));
  });

  it('narrows as the window does, which is the mobile trap', () => {
    /* The camera's fov is VERTICAL, so a narrower window shows less width at
       the same depth -- the constraint CANONICAL_ASPECT exists to record. */
    expect(frameHalfWidth(-30, 4 / 3)).toBeLessThan(frameHalfWidth(-30, 16 / 9));
  });
});

describe('sunWindowHalfWidth', () => {
  it('is the stated fraction of the frame', () => {
    for (const z of [-15, -30, -60]) {
      expect(sunWindowHalfWidth(z) / frameHalfWidth(z)).toBeCloseTo(
        SUN_WINDOW_FRACTION,
        6,
      );
    }
  });

  it('subtends the SAME ANGLE at every depth', () => {
    /* The property the whole module turns on. Two ranges at different
       depths must leave the same share of the FRAME clear -- a gap fixed in
       world units would gape up close and close over the sun far away. */
    const near = sunWindowHalfWidth(-20) / frameHalfWidth(-20);
    const far = sunWindowHalfWidth(-55) / frameHalfWidth(-55);

    expect(near).toBeCloseTo(far, 10);
    /* And in world units they are genuinely different numbers, so the test
       above is not comparing a constant to itself. */
    expect(sunWindowHalfWidth(-55)).toBeGreaterThan(sunWindowHalfWidth(-20) * 1.5);
  });
});

describe('ridgeProfile', () => {
  it('leaves the sun window open at every seed', () => {
    /* THE ONE THAT MATTERS. A ridge is seeded, so "it looked fine" is a
       statement about one seed. `?seed=` is a documented parameter and a
       player can pass any of these. */
    for (let seed = 1; seed <= 250; seed++) {
      const profile = ridgeProfile(createRng(seed), RANGE);
      expect(windowIsOpen(profile, RANGE.z), `seed ${seed}`).toBe(true);
    }
  });

  it('pins the window flat rather than merely lowering it', () => {
    const profile = ridgeProfile(createRng(1337), RANGE);
    const windowHalf = sunWindowHalfWidth(RANGE.z);
    const inside = profile.filter((sample) => Math.abs(sample.x) <= windowHalf);

    expect(inside.length).toBeGreaterThan(0);
    for (const sample of inside) {
      expect(sample.y).toBe(RANGE.baseY);
    }
  });

  it('rises toward the frame edges', () => {
    /* A valley, not a row of hills: the silhouette has to climb as it goes
       out or the arena does not read as sitting down inside anything. */
    const profile = ridgeProfile(createRng(1337), RANGE);
    const outermost = profile[profile.length - 1]!;
    const windowHalf = sunWindowHalfWidth(RANGE.z);
    const nearWindow = profile.find(
      (sample) => sample.x > windowHalf && sample.x < windowHalf * 1.3,
    );

    expect(nearWindow).toBeDefined();
    expect(outermost.y).toBeGreaterThan(nearWindow!.y);
  });

  it('reaches past the frame edge so the range has no visible end', () => {
    const profile = ridgeProfile(createRng(1337), RANGE);
    const halfWidth = frameHalfWidth(RANGE.z);

    expect(profile[0]!.x).toBeLessThan(-halfWidth);
    expect(profile[profile.length - 1]!.x).toBeGreaterThan(halfWidth);
  });

  it('is deterministic for a seed', () => {
    /* The screenshot baseline depends on this, and so does the harness test
       that two reads of the same frame agree. */
    const a = ridgeProfile(createRng(1337), RANGE);
    const b = ridgeProfile(createRng(1337), RANGE);
    expect(a).toEqual(b);
  });

  it('produces different mountains for different seeds', () => {
    const a = ridgeProfile(createRng(1), RANGE);
    const b = ridgeProfile(createRng(2), RANGE);
    expect(a).not.toEqual(b);
  });

  it('is finite everywhere', () => {
    /* A single NaN vertex collapses a whole BufferGeometry into nothing, and
       the symptom is an invisible mountain rather than an error. */
    for (let seed = 1; seed <= 50; seed++) {
      for (const sample of ridgeProfile(createRng(seed), RANGE)) {
        expect(Number.isFinite(sample.x), `seed ${seed} x`).toBe(true);
        expect(Number.isFinite(sample.y), `seed ${seed} y`).toBe(true);
      }
    }
  });

  it('never dips below the horizon outside the window', () => {
    /* Jitter is taper-scaled precisely so it cannot punch a hole in the
       ridge and let a gap of sky through where there should be mountain. */
    const profile = ridgeProfile(createRng(1337), RANGE);
    const windowHalf = sunWindowHalfWidth(RANGE.z);

    for (const sample of profile) {
      if (Math.abs(sample.x) <= windowHalf) continue;
      expect(sample.y).toBeGreaterThanOrEqual(HORIZON_Y);
    }
  });

  it('rejects a ridge too coarse to be a ridge', () => {
    expect(() => ridgeProfile(createRng(1), { ...RANGE, samples: 1 })).toThrow(
      /at least 2 samples/,
    );
  });
});

describe('crestRuns', () => {
  it('splits the profile into one run per side', () => {
    /* The crest is drawn per run. A single line across the whole profile
       dives to the hem, crosses the middle of the frame and climbs back --
       a bright cyan diagonal straight through the sun. */
    const runs = crestRuns(ridgeProfile(createRng(1337), RANGE));
    expect(runs).toHaveLength(2);
  });

  it('never includes a sample at or below the horizon', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const run of crestRuns(ridgeProfile(createRng(seed), RANGE))) {
        for (const sample of run) {
          expect(sample.y, `seed ${seed}`).toBeGreaterThan(HORIZON_Y);
        }
      }
    }
  });

  it('keeps each run on one side of the window', () => {
    /* If a run ever straddled centre it would be drawing across the sun,
       which is the whole failure this function exists to prevent. */
    for (const run of crestRuns(ridgeProfile(createRng(1337), RANGE))) {
      const signs = new Set(run.map((sample) => Math.sign(sample.x)));
      expect(signs.size).toBe(1);
    }
  });

  it('drops runs too short to draw', () => {
    /* A one-vertex Line renders nothing and still costs a draw call. */
    const runs = crestRuns([
      { x: -5, y: HORIZON_Y + 1 },
      { x: -4, y: HORIZON_Y - 1 },
      { x: -3, y: HORIZON_Y + 1 },
      { x: -2, y: HORIZON_Y + 1 },
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(2);
  });

  it('returns nothing for a profile that never leaves the water', () => {
    const flat = [
      { x: -1, y: HORIZON_Y },
      { x: 0, y: HORIZON_Y },
      { x: 1, y: HORIZON_Y },
    ];
    expect(crestRuns(flat)).toEqual([]);
  });
});
