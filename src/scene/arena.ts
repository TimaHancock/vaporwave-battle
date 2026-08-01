/**
 * The arena the fight happens on: the dais, and the colonnade behind it.
 *
 * Pure functions and data, no three.js -- the same split `mountains.ts` and
 * `spriteLayout.ts` follow, and for the same reason: the constraints here are
 * the ones worth asserting, and asserting them in Vitest costs milliseconds
 * where asserting them through a browser costs seconds and a screenshot to
 * read. `battleScene.ts` builds meshes from what comes out and does no
 * geometry maths of its own.
 *
 * WHAT THE ARENA IS
 * -----------------
 * A faceted dais of stacked tiers -- deck plate, chamfer, drum, footing --
 * planted in the water rather than resting on it, with columns on an arc
 * behind the line of battle.
 *
 * It was one `CylinderGeometry(6, 6.4, 0.6, 48)` and two cylinders. Every
 * other element in frame had an art pass; this one never did, and it was the
 * weakest thing on screen by the time the valley was finished.
 */

import { PLATFORM_RADIUS, PLATFORM_SAFE_RADIUS, type Vec3 } from './spriteLayout';
import { sunWindowHalfWidth } from './mountains';

/**
 * The waterline, mirrored from `battleScene.ts` and `mountains.ts`.
 *
 * Duplicated rather than imported for the reason those modules give: this one
 * has no three.js dependency and will not start now. The dais reaches below
 * it, which is the point -- see DAIS_TIERS.
 */
export const HORIZON_Y = -0.6;

/**
 * How many sides the dais is cut into.
 *
 * FACETED, NOT SMOOTH. The character art is flat angular vector work and the
 * dice are `flatShading`; a 48-segment cylinder is the one round thing in a
 * scene of cut planes, and it reads as a different piece of software. Facets
 * also break the key light into distinct planes instead of averaging it into
 * one smooth gradient, which is most of what makes the old platform look like
 * painted plastic.
 *
 * THE COST OF FACETING IS THE INSCRIBED RADIUS, and it is easy to miss. A
 * 16-gon of circumradius 6 is only 5.885 across at the middle of a face, so
 * the usable deck is smaller than `PLATFORM_RADIUS` suggests. It still clears
 * `PLATFORM_SAFE_RADIUS` by a long way, and a test says so rather than
 * leaving it to look about right.
 */
export const DAIS_FACETS = 16;

/** Sides on a column. Fewer than the dais: they are much narrower on screen. */
export const COLUMN_FACETS = 8;

/**
 * Distance from the centre of a regular polygon to the middle of a face.
 *
 * The radius that actually matters for standing on something: a sprite placed
 * at the circumradius on a facet boundary is fine, and the same sprite in the
 * middle of a face is over the edge.
 */
export function inscribedRadius(radius: number, facets: number): number {
  if (facets < 3) throw new Error(`A polygon needs at least 3 sides, got ${facets}`);
  return radius * Math.cos(Math.PI / facets);
}

export interface DaisTier {
  /** Identifies the tier for the one piece of code that treats one specially. */
  name: 'deck' | 'chamfer' | 'drum' | 'footing';
  /** Y of this tier's top face. The stack runs downward from 0. */
  topY: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
}

/**
 * The dais, top down.
 *
 * TWO NUMBERS ARE FIXED AND THE REST ARE COMPOSITION. The deck's top face is
 * y 0 and its radius is `PLATFORM_RADIUS`, because sprites are grounded at
 * y 0, contact shadows sit at y 0.012, and `spriteLayout.ts` fits the whole
 * formation against that 6. Those two are a contract; everything else here is
 * free.
 *
 * The footing reaches past `HORIZON_Y` so the arena is PLANTED IN the water
 * rather than resting on it. The old dais bottomed out exactly at the
 * waterline, which is why it read as a coin lying on a surface -- correct as
 * geometry and wrong as architecture. Everything below the waterline is in
 * dark water and costs nothing to be there.
 *
 * The drum tapers INWARD going down and the footing flares back out. A
 * straight-sided drum reads as extruded; the taper plus a flare reads as
 * something built to carry weight.
 */
export const DAIS_TIERS: readonly DaisTier[] = [
  { name: 'deck', topY: 0, height: 0.18, topRadius: 6.0, bottomRadius: 6.0 },
  { name: 'chamfer', topY: -0.18, height: 0.16, topRadius: 6.0, bottomRadius: 6.35 },
  { name: 'drum', topY: -0.34, height: 0.61, topRadius: 6.35, bottomRadius: 5.8 },
  { name: 'footing', topY: -0.95, height: 0.3, topRadius: 5.8, bottomRadius: 6.6 },
];

/** Widest point of the dais, for anything that needs to clear it. */
export function daisMaxRadius(): number {
  return DAIS_TIERS.reduce(
    (widest, tier) => Math.max(widest, tier.topRadius, tier.bottomRadius),
    0,
  );
}

/** Y the dais bottoms out at. Below the waterline, deliberately. */
export function daisBottomY(): number {
  const last = DAIS_TIERS[DAIS_TIERS.length - 1]!;
  return last.topY - last.height;
}

/**
 * Where the columns stand.
 *
 * AN ARC, NOT A PAIR. Two columns at the extreme left and right read as a
 * doorway the fight happens in front of; an arc across the back reads as a
 * room the fight happens inside, which is what a final boss stage wants.
 *
 * Every column is behind the line of battle (z < 0) and sits between
 * `PLATFORM_SAFE_RADIUS` and `PLATFORM_RADIUS` -- outside where anybody
 * stands, inside the lip so none is planted on air. Symmetric about x = 0,
 * because the camera is locked and always frames the whole arc.
 *
 * The arc deliberately stops short of the sides: a column at 90 degrees would
 * sit level with the outermost party member and cut its silhouette in half.
 */
export const COLONNADE_RADIUS = 5.7;
/** Columns PER SIDE. The centre is deliberately empty -- see below. */
export const COLONNADE_PER_SIDE = 2;

/**
 * The angular band the columns occupy, in radians from straight back.
 *
 * THE CENTRE IS LEFT OPEN ON PURPOSE, and this is the same constraint the
 * mountains obey: the sun is centred, and nothing may close over it. The
 * first version spread the columns evenly across the whole arc, which at an
 * odd count put one dead centre, standing in front of the sun and splitting
 * the disc in half. `columnIsClear` checks it against `sunWindowHalfWidth`
 * rather than against these numbers, so the rule survives re-spacing.
 *
 * The far end stops short of 90 degrees for the other reason: a column at the
 * side sits level with the outermost party member and cuts its silhouette.
 */
const COLONNADE_INNER_ANGLE = (34 * Math.PI) / 180;
const COLONNADE_OUTER_ANGLE = (62 * Math.PI) / 180;

export function colonnadePositions(
  perSide: number = COLONNADE_PER_SIDE,
  radius: number = COLONNADE_RADIUS,
): Vec3[] {
  if (perSide < 1) {
    throw new Error(`A colonnade needs at least 1 column a side, got ${perSide}`);
  }

  const positions: Vec3[] = [];
  for (let i = 0; i < perSide; i++) {
    /* One column a side lands at the inner angle, which is where a single
       pair reads best -- flanking rather than cornering. */
    const t = perSide === 1 ? 0 : i / (perSide - 1);
    const angle =
      COLONNADE_INNER_ANGLE + t * (COLONNADE_OUTER_ANGLE - COLONNADE_INNER_ANGLE);
    for (const side of [-1, 1]) {
      positions.push({
        x: side * radius * Math.sin(angle),
        y: 0,
        z: -radius * Math.cos(angle),
      });
    }
  }
  /* Left to right, so the array reads the way the arc looks. */
  return positions.sort((a, b) => a.x - b.x);
}

/**
 * Closest a column may come to anyone standing on the deck, in world units.
 *
 * Asserted against the real cast layout rather than trusted: a column behind
 * a character's head is invisible in the numbers and obvious in a screenshot,
 * and re-laying out the party is exactly the change that would cause it.
 */
export const COLUMN_CAST_CLEARANCE = 1.2;

/**
 * True when a column position is legal: on the deck, behind the fight, and
 * clear of everyone standing there.
 *
 * Exported so the constraint is assertable directly rather than inferred.
 */
export function columnIsClear(
  position: Vec3,
  castPositions: readonly Vec3[],
): boolean {
  const distance = Math.hypot(position.x, position.z);
  if (distance <= PLATFORM_SAFE_RADIUS) return false;
  if (distance > inscribedRadius(PLATFORM_RADIUS, DAIS_FACETS)) return false;
  if (position.z >= 0) return false;

  /* The sun's window, borrowed from mountains.ts rather than restated. One
     rule about what may stand in front of the sun, obeyed by the terrain and
     by the arena, and moving SUN_WINDOW_FRACTION moves both. */
  if (Math.abs(position.x) <= sunWindowHalfWidth(position.z)) return false;

  return castPositions.every(
    (cast) =>
      Math.hypot(position.x - cast.x, position.z - cast.z) >= COLUMN_CAST_CLEARANCE,
  );
}
