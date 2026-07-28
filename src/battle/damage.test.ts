import { describe, it, expect } from 'vitest';
import { calculateDamage, effectiveAttack, effectiveDefense, statusMultiplier } from './damage';
import type { Actor } from './types';
import { createRng } from '../rng';

/** Minimal actor factory so tests stay readable. */
function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'test',
    name: 'Test',
    side: 'party',
    level: 70,
    stats: { maxHp: 4200, maxMp: 450, attack: 300, defense: 120, speed: 100 },
    hp: 4200,
    mp: 450,
    statuses: [],
    ...overrides,
  };
}

describe('statusMultiplier', () => {
  it('returns 1 when no matching status is active', () => {
    expect(statusMultiplier([], 'ATK_UP')).toBe(1);
  });

  it('ignores expired statuses', () => {
    const expired = [{ kind: 'ATK_UP' as const, turnsRemaining: 0, magnitude: 1.5 }];
    expect(statusMultiplier(expired, 'ATK_UP')).toBe(1);
  });

  it('multiplies stacked statuses of the same kind', () => {
    const stacked = [
      { kind: 'ATK_UP' as const, turnsRemaining: 3, magnitude: 1.5 },
      { kind: 'ATK_UP' as const, turnsRemaining: 2, magnitude: 1.2 },
    ];
    expect(statusMultiplier(stacked, 'ATK_UP')).toBeCloseTo(1.8);
  });
});

describe('effective stats', () => {
  it('applies ATK_UP to attack only', () => {
    const buffed = actor({
      statuses: [{ kind: 'ATK_UP', turnsRemaining: 3, magnitude: 1.25 }],
    });
    expect(effectiveAttack(buffed)).toBeCloseTo(375);
    expect(effectiveDefense(buffed)).toBeCloseTo(120);
  });
});

describe('calculateDamage', () => {
  it('is deterministic for a given seed', () => {
    const input = {
      attacker: actor(),
      defender: actor({ side: 'enemy' as const }),
      power: 1,
      critChance: 0.25,
      critMultiplier: 2,
      rng: createRng(42),
    };
    const first = calculateDamage({ ...input, rng: createRng(42) });
    const second = calculateDamage({ ...input, rng: createRng(42) });
    expect(first).toEqual(second);
  });

  it('never deals less than 1 damage even against huge defense', () => {
    const result = calculateDamage({
      attacker: actor({ stats: { ...actor().stats, attack: 1 } }),
      defender: actor({ side: 'enemy', stats: { ...actor().stats, defense: 99999 } }),
      power: 1,
      critChance: 0,
      critMultiplier: 2,
      rng: createRng(1),
    });
    expect(result.amount).toBeGreaterThanOrEqual(1);
  });

  it('scales with skill power', () => {
    const base = {
      attacker: actor(),
      defender: actor({ side: 'enemy' as const }),
      critChance: 0,
      critMultiplier: 2,
    };
    const weak = calculateDamage({ ...base, power: 1, rng: createRng(5) });
    const strong = calculateDamage({ ...base, power: 3, rng: createRng(5) });
    expect(strong.amount).toBeGreaterThan(weak.amount);
  });

  it('never crits at 0 chance and always crits at 1', () => {
    const base = {
      attacker: actor(),
      defender: actor({ side: 'enemy' as const }),
      power: 1,
      critMultiplier: 2,
    };
    for (let seed = 0; seed < 50; seed++) {
      expect(calculateDamage({ ...base, critChance: 0, rng: createRng(seed) }).isCritical).toBe(
        false,
      );
      expect(calculateDamage({ ...base, critChance: 1, rng: createRng(seed) }).isCritical).toBe(
        true,
      );
    }
  });
});
