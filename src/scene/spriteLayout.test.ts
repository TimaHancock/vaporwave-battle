import { describe, it, expect } from 'vitest';
import {
  spriteDimensions,
  groundedCentreY,
  layoutParty,
  assignRenderOrders,
  contactShadowSize,
  SPRITE_RENDER_ORDER_BASE,
  DEFAULT_PARTY_LAYOUT,
} from './spriteLayout';

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

  it('honours the requested spacing between neighbours', () => {
    const positions = layoutParty(5, { ...DEFAULT_PARTY_LAYOUT, spacing: 2 });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!.x - positions[i - 1]!.x).toBeCloseTo(2);
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
