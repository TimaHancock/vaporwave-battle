import { describe, expect, it } from 'vitest';
import {
  ARENA_CLEARANCE,
  buildBank,
  corridorHalfWidth,
  corridorIsClear,
  frameHalfWidth,
  HORIZON_Y,
  peakHeightAt,
  SUN_WINDOW_FRACTION,
  sunWindowHalfWidth,
  terrainIndices,
  TERRAIN_FAR_Z,
  TERRAIN_NEAR_Z,
  triangleUpwardNormal,
  wireframeIndices,
  type BankOptions,
} from './mountains';
import { createRng } from '../rng';
import { PLATFORM_RADIUS } from './spriteLayout';

/**
 * The composition rules, asserted where they are cheap.
 *
 * "Is the sun visible between the mountains" is a question a screenshot
 * answers slowly and badly -- you have to look, and you only see the one seed
 * you happened to render. These are the same question asked as arithmetic,
 * across every seed worth trying.
 */

const BANK: BankOptions = {
  side: 1,
  columns: 24,
  rows: 32,
  roughness: 0.45,
  octaveCells: 4,
};

/** Depths spread across the terrain, for sweeping a rule over the whole span. */
function depths(count = 60): number[] {
  return Array.from({ length: count }, (_, i) =>
    TERRAIN_NEAR_Z + ((TERRAIN_FAR_Z - TERRAIN_NEAR_Z) * i) / (count - 1),
  );
}

describe('frameHalfWidth', () => {
  it('grows with distance from the camera', () => {
    /* The whole reason the corridor is expressed as a fraction. */
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
    /* The property the whole module turns on. Two rows at different depths
       must leave the same share of the FRAME clear -- a gap fixed in world
       units would gape up close and close over the sun far away. */
    const near = sunWindowHalfWidth(-20) / frameHalfWidth(-20);
    const far = sunWindowHalfWidth(-55) / frameHalfWidth(-55);

    expect(near).toBeCloseTo(far, 10);
    /* And in world units they are genuinely different numbers, so the test
       above is not comparing a constant to itself. */
    expect(sunWindowHalfWidth(-55)).toBeGreaterThan(sunWindowHalfWidth(-20) * 1.5);
  });
});

describe('corridorHalfWidth', () => {
  it('is never narrower than the sun window, at any depth', () => {
    /* THE GENERALISED WINDOW GUARANTEE. The banks may sit further out than
       the sun needs, never closer. */
    for (const z of depths()) {
      expect(corridorHalfWidth(z), `z ${z}`).toBeGreaterThanOrEqual(
        sunWindowHalfWidth(z),
      );
    }
  });

  it('always clears the arena', () => {
    /* The other half of the max(). A bank inside this would put rock behind
       the outermost party member's shoulder. */
    for (const z of depths()) {
      expect(corridorHalfWidth(z), `z ${z}`).toBeGreaterThan(PLATFORM_RADIUS);
    }
  });

  it('is bound by the arena near and by the sun far', () => {
    /* Both branches of the max() are live. If one never won, the expression
       would be a constant wearing a max() as a disguise. */
    expect(corridorHalfWidth(TERRAIN_NEAR_Z)).toBe(ARENA_CLEARANCE);
    expect(corridorHalfWidth(TERRAIN_FAR_Z)).toBeGreaterThan(ARENA_CLEARANCE);
    expect(corridorHalfWidth(TERRAIN_FAR_Z)).toBeCloseTo(
      sunWindowHalfWidth(TERRAIN_FAR_Z),
      10,
    );
  });

  it('converges in frame as it recedes', () => {
    /* The depth cue. The corridor is constant in world units over most of its
       length, so its SHARE OF THE FRAME falls away hard -- which is what makes
       the banks read as running to a vanishing point. */
    const shares = depths(12).map((z) => corridorHalfWidth(z) / frameHalfWidth(z));

    for (let i = 1; i < shares.length; i++) {
      /* Epsilon because the tail is a plateau at exactly SUN_WINDOW_FRACTION,
         and two floating-point routes to the same number need not agree on
         the last bit. */
      expect(shares[i]!, `step ${i}`).toBeLessThanOrEqual(shares[i - 1]! + 1e-12);
    }
    expect(shares[0]!).toBeGreaterThan(0.9);
    /* And it bottoms out at exactly the sun's window rather than continuing
       to close, which is the whole reason the max() is there. */
    expect(shares[shares.length - 1]!).toBeCloseTo(SUN_WINDOW_FRACTION, 6);
  });
});

describe('peakHeightAt', () => {
  it('rises with depth so the ranges layer rather than hide', () => {
    /* At a constant apparent height every far ridge sits exactly behind a
       near one and is occluded -- a valley with one visible ridge a side. */
    let previous = 0;
    for (const z of depths(20)) {
      const height = peakHeightAt(z);
      expect(height, `z ${z}`).toBeGreaterThan(previous);
      previous = height;
    }
  });

  it('rises in FRAME as well as in world units', () => {
    /* The world-unit growth is mostly the frustum widening. This is the part
       that is a decision: distant ridges take up more of the frame. */
    const near = peakHeightAt(TERRAIN_NEAR_Z) / frameHalfWidth(TERRAIN_NEAR_Z);
    const far = peakHeightAt(TERRAIN_FAR_Z) / frameHalfWidth(TERRAIN_FAR_Z);
    expect(far).toBeGreaterThan(near);
  });
});

describe('buildBank', () => {
  it('keeps the corridor clear at every seed', () => {
    /* THE ONE THAT MATTERS. Terrain is seeded, so "it looked fine" is a
       statement about one seed. `?seed=` is a documented parameter and a
       player can pass any of these. */
    for (let seed = 1; seed <= 250; seed++) {
      for (const side of [-1, 1] as const) {
        const bank = buildBank(createRng(seed), { ...BANK, side });
        expect(corridorIsClear(bank), `seed ${seed} side ${side}`).toBe(true);
      }
    }
  });

  it('meets the waterline at the shore', () => {
    /* The banks rise OUT of the water. A non-zero height at column 0 is a
       cliff wall down the side of the channel, which is a corridor rather
       than a valley. */
    const bank = buildBank(createRng(1337), BANK);
    for (let row = 0; row < bank.rows; row++) {
      const shore = bank.vertices[row * bank.columns]!;
      expect(shore.y, `row ${row}`).toBeCloseTo(HORIZON_Y, 10);
    }
  });

  it('rises as it goes outward', () => {
    /* A valley, not a plain: the land has to climb away from the water or the
       arena does not read as sitting down inside anything. */
    const bank = buildBank(createRng(1337), BANK);
    const row = Math.floor(bank.rows / 2);
    const shore = bank.vertices[row * bank.columns]!;
    const edge = bank.vertices[row * bank.columns + bank.columns - 1]!;

    expect(edge.y).toBeGreaterThan(shore.y + 1);
  });

  it('never digs below the waterline', () => {
    /* Noise is centred on zero, so an unclamped trough would punch the shore
       open and show void through the land. */
    for (let seed = 1; seed <= 50; seed++) {
      /* Reduced to one number and asserted once. A per-vertex expect() over
         50 seeds of a 24x32 field is 38k assertions and seconds of runtime,
         for a report no more useful than the seed and the lowest point. */
      const lowest = Math.min(
        ...buildBank(createRng(seed), BANK).vertices.map((v) => v.y),
      );
      expect(lowest, `seed ${seed}`).toBeGreaterThanOrEqual(HORIZON_Y);
    }
  });

  it('always points OUTWARD, at every row', () => {
    /* The root cause of a whole family of failures, worth naming directly.
       The outer edge is normally a multiple of the frame half-width, and in
       front of the arena the frame is narrower than the corridor -- so that
       multiple lands inside the channel and the bank is built inside out.
       Everything downstream goes with it: the corridor stops being clear and
       the triangles wind backwards and are culled. Read as a winding bug when
       it is a bounds bug. */
    for (const side of [-1, 1] as const) {
      const bank = buildBank(createRng(1337), { ...BANK, side });
      for (let row = 0; row < bank.rows; row++) {
        const shore = bank.vertices[row * bank.columns]!;
        const edge = bank.vertices[row * bank.columns + bank.columns - 1]!;
        expect(Math.abs(edge.x), `side ${side} row ${row}`).toBeGreaterThan(
          Math.abs(shore.x),
        );
      }
    }
  });

  it('reaches past the frame edge so the bank has no visible end', () => {
    const bank = buildBank(createRng(1337), BANK);
    const row = Math.floor(bank.rows / 2);
    const edge = bank.vertices[row * bank.columns + bank.columns - 1]!;

    expect(Math.abs(edge.x)).toBeGreaterThan(frameHalfWidth(edge.z));
  });

  it('mirrors to the other side of the frame', () => {
    const right = buildBank(createRng(1337), BANK);
    const left = buildBank(createRng(1337), { ...BANK, side: -1 });

    for (let i = 0; i < right.vertices.length; i++) {
      expect(left.vertices[i]!.x).toBeCloseTo(-right.vertices[i]!.x, 10);
      /* Same seed, same shape -- only the sign of x differs. The sun is at
         x = 0, so the shading mirrors too. */
      expect(left.vertices[i]!.y).toBeCloseTo(right.vertices[i]!.y, 10);
      expect(left.vertices[i]!.shade).toBeCloseTo(right.vertices[i]!.shade, 10);
    }
  });

  it('spans near to far, nearest row first', () => {
    const bank = buildBank(createRng(1337), BANK);
    expect(bank.vertices[0]!.z).toBeCloseTo(TERRAIN_NEAR_Z, 10);
    expect(bank.vertices[bank.vertices.length - 1]!.z).toBeCloseTo(
      TERRAIN_FAR_Z,
      10,
    );
  });

  it('is deterministic for a seed', () => {
    /* The screenshot baseline depends on this, and so does the harness test
       that two reads of the same frame agree. */
    expect(buildBank(createRng(1337), BANK)).toEqual(
      buildBank(createRng(1337), BANK),
    );
  });

  it('produces different mountains for different seeds', () => {
    expect(buildBank(createRng(1), BANK)).not.toEqual(buildBank(createRng(2), BANK));
  });

  it('is finite everywhere', () => {
    /* A single NaN vertex collapses a whole BufferGeometry into nothing, and
       the symptom is an invisible mountain rather than an error. */
    for (let seed = 1; seed <= 50; seed++) {
      const bad = buildBank(createRng(seed), BANK).vertices.filter(
        (v) =>
          !Number.isFinite(v.x) ||
          !Number.isFinite(v.y) ||
          !Number.isFinite(v.z) ||
          !Number.isFinite(v.shade),
      );
      expect(bad, `seed ${seed}`).toEqual([]);
    }
  });

  it('rejects a bank too coarse to be a surface', () => {
    expect(() => buildBank(createRng(1), { ...BANK, columns: 1 })).toThrow(
      /at least 2 columns/,
    );
  });
});

describe('shading', () => {
  it('stays within the range battleScene lerps over', () => {
    /* A shade outside 0..1 does not throw; it produces a colour outside the
       palette, which is exactly the failure the palette rule exists to
       prevent and is invisible until someone looks at a screenshot. */
    for (let seed = 1; seed <= 50; seed++) {
      const shades = buildBank(createRng(seed), BANK).vertices.map((v) => v.shade);
      expect(Math.min(...shades), `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...shades), `seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });

  it('lights slopes facing the corridor more than slopes facing away', () => {
    /* THE LIGHT DECISION, asserted rather than eyeballed. The sun is centred,
       so the inward faces catch it and the outer flanks fall away -- which is
       what frames the corridor with brightness. */
    const bank = buildBank(createRng(1337), BANK);
    let inward = 0;
    let inwardCount = 0;
    let outward = 0;
    let outwardCount = 0;

    for (let row = 0; row < bank.rows; row++) {
      for (let column = 1; column < bank.columns - 1; column++) {
        const here = bank.vertices[row * bank.columns + column]!;
        const next = bank.vertices[row * bank.columns + column + 1]!;
        /* On the right bank x grows outward, so a face whose height RISES
           with x is the near flank of a peak -- it is turned back toward
           centre, and toward the sun sitting there. The far flank, falling
           away as x grows, faces the frame edge. */
        if (next.y > here.y) {
          inward += here.shade;
          inwardCount++;
        } else if (next.y < here.y) {
          outward += here.shade;
          outwardCount++;
        }
      }
    }

    expect(inwardCount).toBeGreaterThan(0);
    expect(outwardCount).toBeGreaterThan(0);
    expect(inward / inwardCount).toBeGreaterThan(outward / outwardCount);
  });

  it('varies enough to read as form', () => {
    /* A field that shades to a near-constant is a flat cutout with extra
       triangles, which is the thing this replaces. */
    const shades = buildBank(createRng(1337), BANK).vertices.map((v) => v.shade);
    expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(0.15);
  });
});

describe('terrainIndices', () => {
  it('makes two triangles per quad', () => {
    expect(terrainIndices(4, 3)).toHaveLength((4 - 1) * (3 - 1) * 6);
  });

  it('never points past the end of the vertex buffer', () => {
    /* An out-of-range index is a black mesh or a GL warning, never a useful
       error message. */
    const columns = 7;
    const rows = 5;
    for (const index of terrainIndices(columns, rows)) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(columns * rows);
    }
  });

  it('produces nothing for a degenerate lattice', () => {
    expect(terrainIndices(1, 5)).toEqual([]);
  });

  it('winds every triangle to face UPWARD, on both banks', () => {
    /* THE ONE THAT COST AN AFTERNOON. A bank's columns run outward, so x
       increases along a row on the right bank and decreases on the left --
       one index order gives upward faces on one and downward faces on the
       other. Downward is backface-culled by a camera looking down at it, and
       the failure is silent in every channel: the triangles are submitted,
       they count in renderer.info, and nothing is drawn. On screen it looks
       like a shading bug, and it is not one. */
    for (const side of [-1, 1] as const) {
      const bank = buildBank(createRng(1337), { ...BANK, side });
      const indices = terrainIndices(bank.columns, bank.rows, side);

      for (let i = 0; i < indices.length; i += 3) {
        const up = triangleUpwardNormal(
          bank.vertices[indices[i]!]!,
          bank.vertices[indices[i + 1]!]!,
          bank.vertices[indices[i + 2]!]!,
        );
        expect(up, `side ${side} triangle ${i / 3}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('wireframeIndices', () => {
  it('never points past the end of the vertex buffer', () => {
    const columns = 9;
    const rows = 6;
    for (const index of wireframeIndices(columns, rows, 2)) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(columns * rows);
    }
  });

  it('emits whole line segments', () => {
    expect(wireframeIndices(9, 6, 2).length % 2).toBe(0);
  });

  it('thins out as the step grows', () => {
    /* The whole point of the step. A lattice at step 1 is every edge, which
       is a mesh on screen rather than a grid over rock. */
    expect(wireframeIndices(16, 16, 4).length).toBeLessThan(
      wireframeIndices(16, 16, 2).length,
    );
  });

  it('rejects a step that would not advance', () => {
    expect(() => wireframeIndices(8, 8, 0)).toThrow(/at least 1/);
  });
});
