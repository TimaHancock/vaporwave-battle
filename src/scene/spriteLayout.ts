/**
 * Sprite layout mathematics.
 *
 * Deliberately contains NO three.js import. Everything here is arithmetic
 * over plain numbers, which means it runs in Vitest in milliseconds instead
 * of needing a browser and a screenshot.
 *
 * This is the same split used for combat logic: the parts that are easy to
 * get subtly wrong live where feedback is fastest.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpriteSize {
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Aspect-correct sizing                                               */
/* ------------------------------------------------------------------ */

/**
 * Derives a plane's world dimensions from the source image's pixel
 * dimensions and a desired world height.
 *
 * Getting this wrong is the single most common billboard bug: a plane
 * created with a hardcoded 1:1 aspect stretches or squashes the art, and
 * because the distortion is uniform it often reads as "the character looks
 * a bit off" rather than as an obvious defect. Always derive width from
 * the texture.
 */
export function spriteDimensions(
  texturePixelWidth: number,
  texturePixelHeight: number,
  worldHeight: number,
): SpriteSize {
  if (texturePixelWidth <= 0 || texturePixelHeight <= 0) {
    throw new Error(
      `Texture dimensions must be positive, got ` +
        `${texturePixelWidth}x${texturePixelHeight}`,
    );
  }
  if (worldHeight <= 0) {
    throw new Error(`worldHeight must be positive, got ${worldHeight}`);
  }

  return {
    width: worldHeight * (texturePixelWidth / texturePixelHeight),
    height: worldHeight,
  };
}

/**
 * PlaneGeometry is built centred on its origin, so a plane placed at y=0
 * is half-buried in the floor. This returns the centre Y that puts the
 * sprite's bottom edge exactly on the ground plane.
 *
 * The platform top surface in this scene sits at y=0, so groundY defaults
 * to 0. If the platform height ever changes, change it here rather than
 * scattering offsets through the scene code.
 */
export function groundedCentreY(spriteWorldHeight: number, groundY = 0): number {
  return groundY + spriteWorldHeight / 2;
}

/* ------------------------------------------------------------------ */
/* Party formation                                                     */
/* ------------------------------------------------------------------ */

export interface PartyLayoutOptions {
  /** Centre of the formation on the X axis. */
  centreX: number;
  /** Centre of the formation on the Z axis. Negative is further from camera. */
  centreZ: number;
  /** World units between adjacent members. */
  spacing: number;
  /**
   * How far the outer members bow toward the camera, in world units.
   * A shallow arc reads far better than a flat rank: it separates the
   * silhouettes and gives the formation depth without moving the camera.
   * Zero produces a straight line.
   */
  arcDepth: number;
}

export const DEFAULT_PARTY_LAYOUT: PartyLayoutOptions = {
  centreX: -2.6,
  centreZ: -0.4,
  spacing: 1.75,
  arcDepth: 0.9,
};

/**
 * Positions N party members in a shallow forward-bowing arc.
 *
 * Symmetric by construction: member i and member (count-1-i) are mirror
 * images about centreX. That property is asserted in the tests, because an
 * off-by-one in the centring maths produces a formation that looks almost
 * right and drifts a little further off-centre with every added member.
 */
export function layoutParty(
  count: number,
  options: PartyLayoutOptions = DEFAULT_PARTY_LAYOUT,
): Vec3[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Party count must be a non-negative integer, got ${count}`);
  }
  if (count === 0) return [];

  const { centreX, centreZ, spacing, arcDepth } = options;
  const halfSpan = (count - 1) / 2;

  return Array.from({ length: count }, (_unused, index) => {
    const offset = index - halfSpan;

    // Normalised distance from the centre of the formation, 0..1.
    // A single member sits dead centre and gets no arc displacement.
    const normalised = halfSpan === 0 ? 0 : offset / halfSpan;

    return {
      x: centreX + offset * spacing,
      y: 0,
      // Squared falloff: the middle stays put, the flanks step forward.
      z: centreZ + arcDepth * normalised * normalised,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Draw ordering                                                       */
/* ------------------------------------------------------------------ */

/**
 * Base renderOrder for character sprites. Contact shadows use a lower
 * value so they always draw after the opaque platform but before the
 * sprites standing on them.
 */
export const SHADOW_RENDER_ORDER = 1;
export const SPRITE_RENDER_ORDER_BASE = 10;

/**
 * THE TRANSPARENCY SORTING TRAP.
 *
 * three.js sorts transparent objects by the distance from the camera to
 * each object's bounding-sphere centre. For billboards standing at similar
 * depths that ordering is unstable: a fraction of a world unit of movement
 * can flip two sprites, and the visible symptom is one character's
 * transparent margin punching a rectangular hole through the character
 * behind them, intermittently.
 *
 * Alpha testing removes most of this by letting sprites write depth like
 * opaque geometry, but the draw sequence is still decided by that unstable
 * sort. Assigning explicit renderOrder makes it deterministic: furthest
 * first, nearest last, painter's algorithm, no flicker ever.
 *
 * Returns render orders parallel to the input array (input index i maps to
 * output index i), so callers can apply them without re-sorting.
 */
export function assignRenderOrders(positions: readonly Vec3[]): number[] {
  // Pair each position with its original index, sort back-to-front, then
  // scatter the resulting ranks back into original-index order.
  const ranked = positions
    .map((position, index) => ({ index, z: position.z }))
    .sort((a, b) => a.z - b.z); // most negative (furthest) first

  const orders = new Array<number>(positions.length);
  ranked.forEach((entry, rank) => {
    orders[entry.index] = SPRITE_RENDER_ORDER_BASE + rank;
  });

  return orders;
}

/* ------------------------------------------------------------------ */
/* Contact shadow                                                      */
/* ------------------------------------------------------------------ */

/**
 * Contact shadow radius for a sprite of a given world height.
 *
 * Flat art standing in a 3D scene looks pasted on without a shadow anchoring
 * it to the floor. The ellipse is deliberately wider than it is deep, which
 * reads as a shadow cast by a light above and in front rather than a disc
 * lying on the ground.
 */
export function contactShadowSize(spriteWorldHeight: number): SpriteSize {
  return {
    width: spriteWorldHeight * 0.55,
    height: spriteWorldHeight * 0.28,
  };
}
