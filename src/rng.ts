/**
 * Seeded pseudo-random number generator.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Math.random()` is forbidden in this project. Every random decision a
 * battle makes -- crit rolls, damage variance, which attack the boss
 * chooses -- must be reproducible, for two reasons:
 *
 *   1. Screenshots. The verification harness captures the battle at a
 *      specific moment. If randomness differs between runs, two captures
 *      of "the same" moment will not match, and a real visual regression
 *      becomes indistinguishable from a coin flip.
 *
 *   2. Bug reports. "Seed 8871 turn 4 crashes" is a reproducible bug.
 *      "Sometimes it crashes" is not.
 *
 * Algorithm is mulberry32: small, fast, and statistically fine for a game.
 * It is NOT cryptographically secure and must never be used as if it were.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number;
  /** True with the given probability (0..1). */
  chance(probability: number): boolean;
  /** Uniformly pick one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** The seed this generator was created with, for logging and replay. */
  readonly seed: number;
}

export function createRng(seed: number): Rng {
  // Internal state. Kept in a closure so it cannot be mutated from outside.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error('rng.pick called with an empty array');
      }
      // noUncheckedIndexedAccess means TS types this as T | undefined, so
      // the length check above does not satisfy it. The assertion is safe.
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}

/**
 * Reads `?seed=` from the URL, falling back to a fixed default.
 *
 * The default is deliberately constant rather than time-based: opening the
 * page with no parameters should always produce the same battle. Fresh
 * randomness is an explicit choice (`?seed=<something new>`), never an
 * accident.
 */
export const DEFAULT_SEED = 1337;

export function seedFromLocation(search: string): number {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null) return DEFAULT_SEED;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}
