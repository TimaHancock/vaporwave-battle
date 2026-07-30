import { describe, it, expect } from 'vitest';
import {
  spriteDimensions,
  groundedCentreY,
  layoutParty,
  assignRenderOrders,
  contactShadowSize,
  formationExtent,
  bossPosition,
  SPRITE_RENDER_ORDER_BASE,
  DEFAULT_PARTY_LAYOUT,
  DEFAULT_BOSS_PLACEMENT,
  PLATFORM_RADIUS,
  PLATFORM_SAFE_RADIUS,
  CANONICAL_ASPECT,
} from './spriteLayout';

/**
 * Minimal perspective projection, replicating what three.js does to a world
 * point, without importing three.js.
 *
 * REGRESSION GUARD. A formation that overflows the camera frustum used to be
 * caught only by an end-to-end test -- which meant a five-minute CI round
 * trip to learn something that is pure arithmetic. These run in
 * milliseconds.
 *
 * Camera values mirror CAMERA in battleScene.ts.
 */
function projectedScreenX(worldX: number, worldZ: number, aspect: number): number {
  const camY = 3.2;
  const camZ = 11;
  const targetY = 1.6;
  const fovDeg = 32;

  // Camera pitches down slightly to frame the target.
  const pitch = Math.atan2(camY - targetY, camZ);

  // Depth along the camera's view axis.
  const dz = camZ - worldZ;
  const dy = camY - 2.2; // sprite head height
  const depth = dz * Math.cos(pitch) + dy * Math.sin(pitch);

  const halfHeight = Math.tan((fovDeg * Math.PI) / 360) * depth;
  const halfWidth = halfHeight * aspect;

  // Normalised device x, then remapped to 0..1 screen space.
  return (worldX / halfWidth + 1) / 2;
}

describe('bossPosition', () => {
  it('grounds the boss at the placement coordinates', () => {
    expect(bossPosition()).toEqual({ x: 2.6, y: 0, z: 0.2 });
  });

  it('keeps the default placement on the platform', () => {
    const { x, z } = DEFAULT_BOSS_PLACEMENT;
    expect(Math.hypot(x, z)).toBeLessThan(PLATFORM_SAFE_RADIUS);
  });

  /* The composition contract: party left, boss right. The party half is
     asserted separately against a four-member formation. */
  it('places the boss in the right half of a 16:9 frame', () => {
    const { x, z } = DEFAULT_BOSS_PLACEMENT;
    expect(projectedScreenX(x, z, CANONICAL_ASPECT)).toBeGreaterThan(0.6);
  });

  it('stands clear of the rightmost party member', () => {
    const party = layoutParty(4);
    const rightmostParty = Math.max(
      ...party.map((p) => projectedScreenX(p.x, p.z, CANONICAL_ASPECT)),
    );
    const boss = projectedScreenX(
      DEFAULT_BOSS_PLACEMENT.x,
      DEFAULT_BOSS_PLACEMENT.z,
      CANONICAL_ASPECT,
    );
    expect(boss).toBeGreaterThan(rightmostParty + 0.15);
  });

  /* The two sides face off across one rank rather than the boss looming
     from a second row behind the party. */
  it('stands on the same line as the party front rank', () => {
    const partyDepths = layoutParty(4).map((p) => p.z);
    expect(DEFAULT_BOSS_PLACEMENT.z).toBe(Math.max(...partyDepths));
  });

  it('is separated from the party by distance across, not depth', () => {
    const rightmostParty = Math.max(...layoutParty(4).map((p) => p.x));
    expect(DEFAULT_BOSS_PLACEMENT.x - rightmostParty).toBeGreaterThan(2);
  });

  it('rejects a placement past the platform lip', () => {
    expect(() => bossPosition({ x: 5, z: -3, worldHeight: 3.6 })).toThrow(
      /PLATFORM_SAFE_RADIUS/,
    );
  });

  it('rejects a non-positive height', () => {
    expect(() => bossPosition({ x: 0, z: 0, worldHeight: 0 })).toThrow(/0/);
  });
});

describe('a four-member party leaves room for the boss', () => {
  it('fits on the platform', () => {
    expect(formationExtent(layoutParty(4))).toBeLessThan(PLATFORM_SAFE_RADIUS);
  });

  /* Dropping from five to four is what opens the right half of frame; the
     formation shrinks rather than being re-centred. */
  it('pulls the rightmost member further left than a party of five did', () => {
    const rightmost = (count: number): number =>
      Math.max(...layoutParty(count).map((p) => projectedScreenX(p.x, p.z, CANONICAL_ASPECT)));
    expect(rightmost(4)).toBeLessThan(rightmost(5));
    expect(rightmost(4)).toBeLessThan(0.6);
  });
});

describe('spriteDimensions', () => {
  it('preserves the source image aspect ratio', () => {
    // A 512x1024 portrait image at 2.4 world units tall must be 1.2 wide.
    expect(spriteDimensions(512, 1024, 2.4)).toEqual({ width: 1.2, height: 2.4 });
  });

  it('handles landscape sources', () => {
    const size = spriteDimensions(1600, 800, 3);
    expect(size.width).toBeCloseTo(6);
    expect(size.height).toBe(3);
  });

  it('rejects non-positive inputs rather than producing NaN geometry', () => {
    // A NaN width silently produces an invisible plane with no error, which
    // is exactly the kind of bug the screenshot harness cannot diagnose.
    expect(() => spriteDimensions(0, 100, 2)).toThrow();
    expect(() => spriteDimensions(100, 0, 2)).toThrow();
    expect(() => spriteDimensions(100, 100, 0)).toThrow();
    expect(() => spriteDimensions(-10, 100, 2)).toThrow();
  });
});

describe('groundedCentreY', () => {
  it('places the sprite bottom edge on the ground plane', () => {
    expect(groundedCentreY(2.4)).toBe(1.2);
  });

  it('respects a raised ground plane', () => {
    expect(groundedCentreY(2.4, 0.5)).toBe(1.7);
  });

  it('leaves the plane alone when the art has no margin below the feet', () => {
    expect(groundedCentreY(2.4, 0, 0)).toBe(1.2);
  });

  it('sinks the empty margin below the floor so the feet land on it', () => {
    /* 5% of 2.4 is 0.12, so the plane drops by that much and the lowest
       opaque pixel -- not the plane's bottom edge -- ends up at y=0. */
    expect(groundedCentreY(2.4, 0, 0.05)).toBeCloseTo(1.08, 10);
  });

  it('combines a feet inset with a raised ground plane', () => {
    expect(groundedCentreY(2.4, 0.5, 0.05)).toBeCloseTo(1.58, 10);
  });
});

describe('layoutParty', () => {
  it('returns nothing for an empty party', () => {
    expect(layoutParty(0)).toEqual([]);
  });

  it('places a lone member exactly at the formation centre', () => {
    const [only] = layoutParty(1);
    expect(only?.x).toBe(DEFAULT_PARTY_LAYOUT.centreX);
    expect(only?.z).toBe(DEFAULT_PARTY_LAYOUT.centreZ);
  });

  it('is symmetric about the centre for any count', () => {
    for (const count of [2, 3, 4, 5, 6, 7]) {
      const positions = layoutParty(count);
      for (let i = 0; i < count; i++) {
        const left = positions[i]!;
        const right = positions[count - 1 - i]!;
        const leftOffset = left.x - DEFAULT_PARTY_LAYOUT.centreX;
        const rightOffset = right.x - DEFAULT_PARTY_LAYOUT.centreX;
        expect(leftOffset).toBeCloseTo(-rightOffset, 10);
        // Mirrored members must also share a depth.
        expect(left.z).toBeCloseTo(right.z, 10);
      }
    }
  });

  it('honours the requested spacing when it fits on the platform', () => {
    // 1.4 keeps a 5-member party inside PLATFORM_SAFE_RADIUS, so it is
    // passed through untouched. A request of 2.0 would be auto-fitted down
    // instead -- covered in the 'spacing auto-fit' block below.
    const positions = layoutParty(5, { ...DEFAULT_PARTY_LAYOUT, spacing: 1.4 });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!.x - positions[i - 1]!.x).toBeCloseTo(1.4);
    }
  });

  it('bows the flanks toward the camera and leaves the centre alone', () => {
    const positions = layoutParty(5);
    const centre = positions[2]!;
    const flank = positions[0]!;
    expect(centre.z).toBeCloseTo(DEFAULT_PARTY_LAYOUT.centreZ);
    // Larger z is nearer the camera in this scene.
    expect(flank.z).toBeGreaterThan(centre.z);
  });

  it('produces a straight rank when arcDepth is zero', () => {
    const positions = layoutParty(5, { ...DEFAULT_PARTY_LAYOUT, arcDepth: 0 });
    for (const position of positions) {
      expect(position.z).toBeCloseTo(DEFAULT_PARTY_LAYOUT.centreZ);
    }
  });

  it('keeps every member standing on the ground plane', () => {
    for (const position of layoutParty(5)) expect(position.y).toBe(0);
  });

  it('rejects nonsense counts', () => {
    expect(() => layoutParty(-1)).toThrow();
    expect(() => layoutParty(2.5)).toThrow();
  });
});

describe('assignRenderOrders', () => {
  it('orders furthest-first so nearer sprites paint over further ones', () => {
    const positions = [
      { x: 0, y: 0, z: 1 }, // nearest
      { x: 0, y: 0, z: -5 }, // furthest
      { x: 0, y: 0, z: -2 }, // middle
    ];
    const orders = assignRenderOrders(positions);

    expect(orders[1]).toBe(SPRITE_RENDER_ORDER_BASE + 0);
    expect(orders[2]).toBe(SPRITE_RENDER_ORDER_BASE + 1);
    expect(orders[0]).toBe(SPRITE_RENDER_ORDER_BASE + 2);
  });

  it('returns one order per sprite, parallel to the input', () => {
    const orders = assignRenderOrders(layoutParty(5));
    expect(orders).toHaveLength(5);
    expect(orders.every((order) => Number.isInteger(order))).toBe(true);
  });

  it('assigns strictly unique orders so the sequence is deterministic', () => {
    // Ties in z must still resolve to distinct orders, or the unstable sort
    // this function exists to replace comes straight back.
    const tied = [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];
    const orders = assignRenderOrders(tied);
    expect(new Set(orders).size).toBe(3);
  });

  /* A whole rank shares one z -- the party's outer members and the boss all
     stand at z 0.2 -- so the tie-break decides their draw sequence. It must
     not be "whatever order main.ts happened to build the cast in". */
  it('breaks a z tie left to right, not by input order', () => {
    const left = { x: -1, y: 0, z: 0 };
    const middle = { x: 0, y: 0, z: 0 };
    const right = { x: 1, y: 0, z: 0 };

    expect(assignRenderOrders([left, middle, right])).toEqual([10, 11, 12]);
    // Same three positions, shuffled: each keeps the order it had before.
    expect(assignRenderOrders([right, left, middle])).toEqual([12, 10, 11]);
  });

  it('gives the on-screen cast a stable sequence regardless of cast order', () => {
    const cast = [...layoutParty(4), bossPosition()];
    const shuffled = [cast[4]!, cast[1]!, cast[3]!, cast[0]!, cast[2]!];

    const byPosition = new Map(
      assignRenderOrders(cast).map((order, i) => [`${cast[i]!.x},${cast[i]!.z}`, order]),
    );
    const shuffledByPosition = new Map(
      assignRenderOrders(shuffled).map((order, i) => [
        `${shuffled[i]!.x},${shuffled[i]!.z}`,
        order,
      ]),
    );

    expect(shuffledByPosition).toEqual(byPosition);
  });

  it('handles an empty scene', () => {
    expect(assignRenderOrders([])).toEqual([]);
  });
});

describe('contactShadowSize', () => {
  it('is wider than it is deep, reading as a shadow rather than a disc', () => {
    const size = contactShadowSize(2.4);
    expect(size.width).toBeGreaterThan(size.height);
  });

  it('scales with the sprite', () => {
    const small = contactShadowSize(1);
    const large = contactShadowSize(2);
    expect(large.width).toBeCloseTo(small.width * 2);
  });
});


describe('stage bounds', () => {
  it('keeps the whole default party on the platform', () => {
    // The bug this exists to prevent: the previous defaults put the
    // outermost member 6.12 from centre on a radius-6 platform, standing
    // on empty space with its contact shadow spilling over the edge.
    const extent = formationExtent(layoutParty(5));
    expect(extent).toBeLessThan(PLATFORM_SAFE_RADIUS);
    expect(extent).toBeLessThan(PLATFORM_RADIUS);
  });

  it('keeps larger parties on the platform too', () => {
    for (const count of [1, 2, 3, 4, 5, 6]) {
      expect(formationExtent(layoutParty(count))).toBeLessThan(PLATFORM_SAFE_RADIUS);
    }
  });

  it('keeps every party member inside the camera frustum at 16:9', () => {
    // The exact assertion that failed in CI, moved to where feedback is
    // measured in milliseconds rather than minutes.
    for (const position of layoutParty(5)) {
      const screenX = projectedScreenX(position.x, position.z, CANONICAL_ASPECT);
      expect(screenX).toBeGreaterThan(0.03);
      expect(screenX).toBeLessThan(0.97);
    }
  });

  it('leaves the right half of frame clear for the boss', () => {
    // Composition contract, matching the reference art: party occupies the
    // left of frame, boss the right.
    const screenXs = layoutParty(5).map((position) =>
      projectedScreenX(position.x, position.z, CANONICAL_ASPECT),
    );
    expect(Math.max(...screenXs)).toBeLessThan(0.6);
  });

  it('would have overflowed with the parameters that broke CI', () => {
    // A guard that cannot fail on any input is not a guard. This computes
    // the raw formula the way it worked before auto-fitting existed, and
    // confirms it really did put a sprite off the platform and off screen.
    const centreX = -2.6;
    const centreZ = -0.4;
    const spacing = 1.75;
    const arcDepth = 0.9;
    const raw = [0, 1, 2, 3, 4].map((index) => {
      const offset = index - 2;
      const n = offset / 2;
      return { x: centreX + offset * spacing, y: 0, z: centreZ + arcDepth * n * n };
    });

    expect(formationExtent(raw)).toBeGreaterThan(PLATFORM_RADIUS);

    const outermost = raw[0]!;
    // The exact value CI reported: -0.0679.
    expect(projectedScreenX(outermost.x, outermost.z, CANONICAL_ASPECT)).toBeLessThan(0);
  });

  it('auto-fits those same parameters back onto the platform', () => {
    // Passing the old broken options in today must produce a valid layout,
    // because the constraint is enforced inside layoutParty rather than
    // relying on the defaults being correct.
    const fitted = layoutParty(5, {
      centreX: -2.6,
      centreZ: -0.4,
      spacing: 1.75,
      arcDepth: 0.9,
    });
    expect(formationExtent(fitted)).toBeLessThanOrEqual(PLATFORM_SAFE_RADIUS + 1e-9);
    for (const position of fitted) {
      expect(projectedScreenX(position.x, position.z, CANONICAL_ASPECT)).toBeGreaterThan(0);
    }
  });
});

describe('formationExtent', () => {
  it('is zero for an empty formation', () => {
    expect(formationExtent([])).toBe(0);
  });

  it('measures from the platform centre, not the formation centre', () => {
    expect(formationExtent([{ x: 3, y: 0, z: 4 }])).toBeCloseTo(5);
  });
});

describe('spacing auto-fit', () => {
  it('honours the requested spacing when it already fits', () => {
    const positions = layoutParty(5);
    const gap = positions[1]!.x - positions[0]!.x;
    expect(gap).toBeCloseTo(DEFAULT_PARTY_LAYOUT.spacing, 6);
  });

  it('shrinks spacing rather than letting a large party overflow', () => {
    // Eight members at the default 1.25 spacing would span 8.75 units and
    // walk straight off the platform. The formation must compress instead.
    const positions = layoutParty(8);
    expect(formationExtent(positions)).toBeLessThanOrEqual(PLATFORM_SAFE_RADIUS + 1e-9);

    const gap = positions[1]!.x - positions[0]!.x;
    expect(gap).toBeLessThan(DEFAULT_PARTY_LAYOUT.spacing);
    expect(gap).toBeGreaterThan(0);
  });

  it('keeps any plausible party size on the platform', () => {
    for (let count = 1; count <= 12; count++) {
      expect(formationExtent(layoutParty(count))).toBeLessThanOrEqual(
        PLATFORM_SAFE_RADIUS + 1e-9,
      );
    }
  });

  it('stays symmetric after auto-fitting', () => {
    const positions = layoutParty(8);
    for (let i = 0; i < 8; i++) {
      const left = positions[i]!.x - DEFAULT_PARTY_LAYOUT.centreX;
      const right = positions[7 - i]!.x - DEFAULT_PARTY_LAYOUT.centreX;
      expect(left).toBeCloseTo(-right, 10);
    }
  });

  it('refuses a formation centre that is off the platform', () => {
    expect(() =>
      layoutParty(3, { ...DEFAULT_PARTY_LAYOUT, centreX: -12 }),
    ).toThrow(/off the platform/);
  });
});
