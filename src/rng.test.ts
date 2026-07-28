import { describe, it, expect } from 'vitest';
import { createRng, seedFromLocation, DEFAULT_SEED } from './rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(42);
    const b = createRng(43);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() is inclusive on both bounds', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(1, 6));
    expect([...seen].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('pick() throws on an empty array rather than returning undefined', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow();
  });
});

describe('seedFromLocation', () => {
  it('uses the default when no seed is present', () => {
    expect(seedFromLocation('')).toBe(DEFAULT_SEED);
    expect(seedFromLocation('?time=3.5')).toBe(DEFAULT_SEED);
  });

  it('reads an explicit seed', () => {
    expect(seedFromLocation('?seed=8871')).toBe(8871);
  });

  it('falls back to the default on garbage input', () => {
    expect(seedFromLocation('?seed=banana')).toBe(DEFAULT_SEED);
  });
});
