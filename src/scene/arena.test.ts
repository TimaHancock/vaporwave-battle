import { describe, expect, it } from 'vitest';
import {
  COLONNADE_PER_SIDE,
  COLONNADE_RADIUS,
  COLUMN_CAST_CLEARANCE,
  colonnadePositions,
  columnIsClear,
  DAIS_FACETS,
  DAIS_TIERS,
  daisBottomY,
  daisMaxRadius,
  DECK_RINGS,
  DEFAULT_DECK,
  HORIZON_Y,
  inscribedRadius,
  routeDeck,
} from './arena';
import { createRng } from '../rng';
import { sunWindowHalfWidth } from './mountains';
import {
  DEFAULT_BOSS_LAYOUT,
  layoutBoss,
  layoutParty,
  PLATFORM_RADIUS,
  PLATFORM_SAFE_RADIUS,
  type Vec3,
} from './spriteLayout';

/**
 * The arena's constraints, asserted where they are cheap.
 *
 * Two of these are contracts with other modules -- the deck's height and
 * radius are what `spriteLayout.ts` grounds sprites against -- and the rest
 * are composition rules that a screenshot answers slowly and one seed at a
 * time.
 */

/** Everyone who stands on the deck, at the shipped layout. */
function castPositions(): Vec3[] {
  return [...layoutParty(4), layoutBoss(DEFAULT_BOSS_LAYOUT)];
}

describe('inscribedRadius', () => {
  it('is smaller than the circumradius, and approaches it with more sides', () => {
    expect(inscribedRadius(6, 16)).toBeLessThan(6);
    expect(inscribedRadius(6, 64)).toBeGreaterThan(inscribedRadius(6, 16));
  });

  it('rejects a shape that is not a polygon', () => {
    expect(() => inscribedRadius(6, 2)).toThrow(/at least 3 sides/);
  });
});

describe('DAIS_TIERS', () => {
  it('puts the deck face at exactly y 0', () => {
    /* A CONTRACT, not a preference. Sprites are grounded at y 0 and contact
       shadows sit at y 0.012; a deck at y -0.01 puts every character's feet
       through the floor and every shadow inside it. */
    expect(DAIS_TIERS[0]!.topY).toBe(0);
  });

  it('makes the deck exactly PLATFORM_RADIUS across', () => {
    /* The other contract. spriteLayout.ts fits the whole formation against
       this number and duplicates it as a constant of its own. */
    expect(DAIS_TIERS[0]!.topRadius).toBe(PLATFORM_RADIUS);
  });

  it('leaves the standing area clear even at the middle of a facet', () => {
    /* THE ONE NON-OBVIOUS COST OF FACETING. A 16-gon of circumradius 6 is
       only 5.885 across at the middle of a face, so the usable deck is
       smaller than PLATFORM_RADIUS suggests. Cut it fine enough and a sprite
       at the safe radius stands over a notch in the polygon. */
    expect(inscribedRadius(DAIS_TIERS[0]!.topRadius, DAIS_FACETS)).toBeGreaterThan(
      PLATFORM_SAFE_RADIUS,
    );
  });

  it('stacks contiguously, with no gap or overlap', () => {
    /* A gap is a band of sky through the middle of the dais; an overlap is
       z-fighting on two coincident faces. Both look like a rendering bug. */
    for (let i = 1; i < DAIS_TIERS.length; i++) {
      const above = DAIS_TIERS[i - 1]!;
      expect(DAIS_TIERS[i]!.topY, `tier ${i}`).toBeCloseTo(
        above.topY - above.height,
        10,
      );
    }
  });

  it('runs downward, every tier with real height', () => {
    for (const tier of DAIS_TIERS) {
      expect(tier.height, tier.name).toBeGreaterThan(0);
      expect(tier.topRadius, tier.name).toBeGreaterThan(0);
      expect(tier.bottomRadius, tier.name).toBeGreaterThan(0);
    }
  });

  it('meets its neighbours without a step in the silhouette', () => {
    /* Each tier's top radius is the one above it's bottom radius. A mismatch
       is a visible ledge, which may be wanted -- but only on purpose, and the
       chamfer is where this design puts one. */
    for (let i = 1; i < DAIS_TIERS.length; i++) {
      expect(DAIS_TIERS[i]!.topRadius, `tier ${i}`).toBeCloseTo(
        DAIS_TIERS[i - 1]!.bottomRadius,
        10,
      );
    }
  });

  it('is PLANTED in the water rather than resting on it', () => {
    /* The old dais bottomed out exactly at the waterline, which is why it
       read as a coin lying on a surface. Everything below costs nothing --
       it is in dark water -- and it is what makes the arena architecture. */
    expect(daisBottomY()).toBeLessThan(HORIZON_Y);
  });

  it('is widest below the deck, so the lip overhangs nothing', () => {
    /* A dais wider at the top than anywhere below is a table, and its edge
       casts the eye off into space. The mass has to sit under the deck. */
    expect(daisMaxRadius()).toBeGreaterThan(DAIS_TIERS[0]!.topRadius);
  });
});

describe('colonnadePositions', () => {
  it('places every column behind the line of battle', () => {
    /* A column level with or in front of the cast crosses a silhouette. The
       arc is deliberately narrower than a half-circle for this reason. */
    for (const column of colonnadePositions()) {
      expect(column.z, `x ${column.x.toFixed(2)}`).toBeLessThan(0);
    }
  });

  it('stands every column on the deck, outside where anyone else does', () => {
    for (const column of colonnadePositions()) {
      const distance = Math.hypot(column.x, column.z);
      expect(distance).toBeGreaterThan(PLATFORM_SAFE_RADIUS);
      /* Inscribed, not circumscribed -- a column at 5.95 on the middle of a
         facet is standing past the edge just as surely as a sprite would be. */
      expect(distance).toBeLessThanOrEqual(
        inscribedRadius(PLATFORM_RADIUS, DAIS_FACETS),
      );
    }
  });

  it('is symmetric about the centre line', () => {
    /* The camera is locked and always frames the whole arc, so an asymmetric
       colonnade reads as a mistake rather than as variety. */
    const columns = colonnadePositions();
    for (let i = 0; i < columns.length; i++) {
      const mirror = columns[columns.length - 1 - i]!;
      expect(columns[i]!.x).toBeCloseTo(-mirror.x, 10);
      expect(columns[i]!.z).toBeCloseTo(mirror.z, 10);
    }
  });

  it('clears every character standing on the deck', () => {
    /* THE ONE THAT MATTERS, and the one a screenshot answers badly: a column
       directly behind a head is invisible in the numbers and obvious in the
       frame. Asserted against the REAL layout, so re-laying out the party is
       what fails here rather than in a shot three changes later. */
    const cast = castPositions();
    for (const column of colonnadePositions()) {
      expect(columnIsClear(column, cast), `column at x ${column.x.toFixed(2)}`).toBe(
        true,
      );
    }
  });

  it('leaves the centre open, so nothing stands in front of the sun', () => {
    /* THE FIRST VERSION GOT THIS WRONG. An odd count spread evenly across the
       whole arc puts one column dead centre, standing in front of the sun and
       splitting the disc in half -- which is the exact failure the mountains'
       window rule exists to prevent, so this borrows that rule rather than
       restating it. */
    for (const column of colonnadePositions()) {
      expect(Math.abs(column.x), `column at z ${column.z.toFixed(2)}`)
        .toBeGreaterThan(sunWindowHalfWidth(column.z));
    }
  });

  it('places a column a side, both sides, at every count', () => {
    expect(colonnadePositions()).toHaveLength(COLONNADE_PER_SIDE * 2);
    expect(colonnadePositions(1)).toHaveLength(2);
    for (const perSide of [1, 2, 3, 4]) {
      const left = colonnadePositions(perSide).filter((c) => c.x < 0);
      expect(left, `${perSide} a side`).toHaveLength(perSide);
    }
  });

  it('rejects an empty colonnade', () => {
    expect(() => colonnadePositions(0)).toThrow(/at least 1 column/);
  });
});

describe('routeDeck', () => {
  it('keeps every point on the deck', () => {
    /* A trace that leaves the unit disc is drawn on a part of the texture the
       cap UVs never sample -- so it is not clipped, it simply is not there,
       and the deck quietly loses whatever ran off. */
    for (let seed = 1; seed <= 60; seed++) {
      const art = routeDeck(createRng(seed));
      for (const trace of art.traces) {
        for (const point of trace.points) {
          expect(Math.hypot(point.x, point.y), `seed ${seed}`).toBeLessThanOrEqual(1);
        }
      }
      for (const pad of art.pads) {
        expect(Math.hypot(pad.x, pad.y), `seed ${seed} pad`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('routes every segment at a right angle', () => {
    /* THE PROPERTY THAT MAKES IT A CIRCUIT rather than a scribble, and
       exactly the kind of thing that degrades silently: one loose bit of
       arithmetic and the traces become diagonals, which read as scratches on
       the floor. */
    for (let seed = 1; seed <= 60; seed++) {
      for (const trace of routeDeck(createRng(seed)).traces) {
        for (let i = 1; i < trace.points.length; i++) {
          const from = trace.points[i - 1]!;
          const to = trace.points[i]!;
          const axisAligned =
            Math.abs(to.x - from.x) < 1e-9 || Math.abs(to.y - from.y) < 1e-9;
          expect(axisAligned, `seed ${seed} segment ${i}`).toBe(true);
        }
      }
    }
  });

  it('never emits a zero-length segment', () => {
    /* A repeated point is a corner that does not turn -- invisible, and it
       costs a line join to draw. */
    for (const trace of routeDeck(createRng(1337)).traces) {
      for (let i = 1; i < trace.points.length; i++) {
        const from = trace.points[i - 1]!;
        const to = trace.points[i]!;
        expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeGreaterThan(0);
      }
    }
  });

  it('gives every trace something to draw', () => {
    for (const trace of routeDeck(createRng(1337)).traces) {
      expect(trace.points.length).toBeGreaterThan(1);
      expect(trace.width).toBeGreaterThan(0);
    }
  });

  it('actually routes something at the shipped settings', () => {
    /* A deck that came back empty would pass every rule above. */
    const art = routeDeck(createRng(1337));
    expect(art.traces.length).toBeGreaterThan(10);
    expect(art.pads.length).toBe(DEFAULT_DECK.traceCount);
    expect(art.rings).toEqual([...DECK_RINGS]);
  });

  it('is deterministic for a seed, and different across seeds', () => {
    expect(routeDeck(createRng(1337))).toEqual(routeDeck(createRng(1337)));
    expect(routeDeck(createRng(1))).not.toEqual(routeDeck(createRng(2)));
  });

  it('is finite everywhere', () => {
    /* A NaN coordinate does not throw in a canvas -- it silently drops the
       path, so one bad trace vanishes and the rest look fine. */
    for (let seed = 1; seed <= 30; seed++) {
      const art = routeDeck(createRng(seed));
      const bad = art.traces
        .flatMap((trace) => trace.points)
        .filter((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y));
      expect(bad, `seed ${seed}`).toEqual([]);
    }
  });

  it('rejects a step that would not advance', () => {
    expect(() => routeDeck(createRng(1), { ...DEFAULT_DECK, step: 0 })).toThrow(
      /must be positive/,
    );
  });
});

describe('columnIsClear', () => {
  it('rejects a column standing where a character stands', () => {
    const cast = castPositions();
    const onTopOfSomeone = { x: cast[0]!.x, y: 0, z: cast[0]!.z - 0.1 };
    expect(columnIsClear(onTopOfSomeone, cast)).toBe(false);
  });

  it('rejects a column past the deck edge', () => {
    expect(columnIsClear({ x: 0, y: 0, z: -7 }, [])).toBe(false);
  });

  it('rejects a column in front of the fight', () => {
    expect(columnIsClear({ x: 0, y: 0, z: COLONNADE_RADIUS }, [])).toBe(false);
  });

  it('accepts one that is behind, on the deck and clear', () => {
    expect(columnIsClear({ x: 3.2, y: 0, z: -4.7 }, [])).toBe(true);
  });

  it('rejects a column standing in front of the sun', () => {
    expect(columnIsClear({ x: 0, y: 0, z: -COLONNADE_RADIUS }, [])).toBe(false);
  });

  it('measures clearance in the ground plane, ignoring height', () => {
    /* Columns are tall and characters are not, but a column is a column all
       the way down: what matters is whether its footprint overlaps theirs. */
    const cast = [{ x: 0, y: 0, z: -COLONNADE_RADIUS + COLUMN_CAST_CLEARANCE / 2 }];
    expect(columnIsClear({ x: 0, y: 99, z: -COLONNADE_RADIUS }, cast)).toBe(false);
  });
});
