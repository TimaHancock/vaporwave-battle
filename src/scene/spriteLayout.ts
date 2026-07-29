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

/* ------------------------------------------------------------------ */
/* Stage bounds                                                        */
/* ------------------------------------------------------------------ */

/**
 * Top radius of the combat platform, from battleScene.ts.
 *
 * Duplicated here rather than imported because this module deliberately
 * has no three.js dependency. If the platform geometry changes, change
 * this too -- the test suite asserts the default formation fits inside it,
 * so a mismatch fails fast rather than producing characters standing in
 * mid air.
 */
export const PLATFORM_RADIUS = 6;

/**
 * Usable radius for character placement.
 *
 * Deliberately well inside PLATFORM_RADIUS. A sprite whose feet are exactly
 * on the lip reads as balancing on the edge, and its contact shadow spills
 * over into empty space.
 */
export const PLATFORM_SAFE_RADIUS = 5.2;

/**
 * The aspect ratio the composition is authored for.
 *
 * The camera has a fixed vertical fov, so horizontal coverage shrinks as
 * the window narrows. A formation that fits at 16:9 can extend past the
 * left edge at 4:3 or in portrait. Layout changes must be checked against
 * this, and the e2e suite pins its viewport to match.
 */
export const CANONICAL_ASPECT = 16 / 9;

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

/**
 * Default five-member formation.
 *
 * These numbers are constrained, not chosen by eye. The previous values
 * (centreX -2.6, spacing 1.75, arcDepth 0.9) put the outermost member at
 * x = -6.10, which was 6.12 from the platform centre -- outside the
 * radius-6 platform, standing on nothing -- and projected to screen x
 * -0.068, past the left edge of a 16:9 frame.
 *
 * Both failures came from the same cause: a formation 7.0 units wide on a
 * stage that can only show about 10.7 units at that depth, offset left.
 * The span is now 5.0 units.
 *
 * The formation occupies roughly the left half of frame (screen x 0.07 to
 * 0.53), which leaves the right half for the boss -- matching the
 * reference composition.
 *
 * Verified by unit test against both PLATFORM_SAFE_RADIUS and the
 * projected frustum at CANONICAL_ASPECT. Change these and the tests will
 * tell you immediately if the formation no longer fits.
 */
export const DEFAULT_PARTY_LAYOUT: PartyLayoutOptions = {
  centreX: -2.2,
  centreZ: -0.3,
  spacing: 1.25,
  arcDepth: 0.5,
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

  const { centreX, centreZ, arcDepth } = options;
  const halfSpan = (count - 1) / 2;

  const offsets = Array.from({ length: count }, (_unused, index) => index - halfSpan);

  // Normalised distance from the formation centre, -1..1. A lone member
  // sits dead centre and gets no arc displacement.
  const normalised = offsets.map((offset) => (halfSpan === 0 ? 0 : offset / halfSpan));

  // Depth is independent of spacing, so it can be resolved first.
  const depths = normalised.map((n) => centreZ + arcDepth * n * n);

  const spacing = fitSpacingToPlatform(centreX, offsets, depths, options.spacing);

  return offsets.map((offset, index) => ({
    x: centreX + offset * spacing,
    y: 0,
    z: depths[index] ?? centreZ,
  }));
}

/**
 * Largest spacing not exceeding the requested value that keeps every member
 * inside PLATFORM_SAFE_RADIUS.
 *
 * WHY THIS IS AUTOMATIC RATHER THAN A CALLER'S RESPONSIBILITY
 * -----------------------------------------------------------
 * The original defaults overflowed the platform, and the only thing that
 * caught it was an end-to-end test in CI. Tuning the numbers fixes that one
 * case; it does not stop the next one. Adding a sixth party member with the
 * corrected defaults overflows again -- which the unit tests caught
 * immediately once they existed.
 *
 * So the constraint is enforced here, where it cannot be forgotten. Callers
 * express intent ("about this far apart") and the formation is guaranteed to
 * fit whatever they ask for.
 *
 * Solved directly rather than by iteration. Each member needs
 * |centreX + offset*s| <= sqrt(R^2 - z^2), which is linear in s, so the
 * binding member gives the answer in one pass.
 */
function fitSpacingToPlatform(
  centreX: number,
  offsets: readonly number[],
  depths: readonly number[],
  requestedSpacing: number,
): number {
  let allowed = requestedSpacing;

  offsets.forEach((offset, index) => {
    const depth = depths[index] ?? 0;
    const halfChord = PLATFORM_SAFE_RADIUS ** 2 - depth ** 2;

    if (halfChord <= 0) {
      throw new Error(
        `Formation depth ${depth.toFixed(2)} exceeds the platform radius ` +
          `${PLATFORM_SAFE_RADIUS}; no spacing can make this fit.`,
      );
    }

    const limit = Math.sqrt(halfChord);

    if (offset === 0) {
      // Spacing cannot help a centre member that is already off-platform.
      if (Math.abs(centreX) > limit) {
        throw new Error(
          `centreX ${centreX} places the formation centre off the platform ` +
            `(limit ${limit.toFixed(2)}).`,
        );
      }
      return;
    }

    const maxForMember =
      offset > 0 ? (limit - centreX) / offset : (limit + centreX) / -offset;

    allowed = Math.min(allowed, maxForMember);
  });

  return Math.max(0, allowed);
}

/**
 * Furthest any position sits from the platform centre, on the ground plane.
 *
 * The check that would have caught the original bug in 15 milliseconds
 * instead of a five-minute CI round trip. Any layout change should be
 * asserted against PLATFORM_SAFE_RADIUS using this.
 */
export function formationExtent(positions: readonly Vec3[]): number {
  return positions.reduce(
    (furthest, position) => Math.max(furthest, Math.hypot(position.x, position.z)),
    0,
  );
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
