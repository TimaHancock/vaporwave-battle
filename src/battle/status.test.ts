import { describe, it, expect } from 'vitest';
import {
  applyStatus,
  expireStatuses,
  tickStatuses,
  MAX_STATUS_STACKS,
} from './status';
import { statusMultiplier } from './damage';
import { makeActor } from './fixtures';
import type { Status } from './types';

const atk = (magnitude: number, turnsRemaining = 3): Status => ({
  kind: 'ATK_UP',
  magnitude,
  turnsRemaining,
});

describe('applyStatus', () => {
  it('adds a status to an actor that has none', () => {
    const buffed = applyStatus(makeActor(), atk(1.25));
    expect(buffed.statuses).toEqual([atk(1.25)]);
  });

  it('returns a new actor rather than mutating the original', () => {
    const original = makeActor();
    const buffed = applyStatus(original, atk(1.25));
    expect(original.statuses).toEqual([]);
    expect(buffed).not.toBe(original);
  });

  /* damage.ts multiplies instances of a kind, and damage.test.ts asserts
     1.5 x 1.2 = 1.8. Stacking is therefore the established contract, and
     apply adds an instance rather than refreshing one. */
  it('stacks a second instance of the same kind, multiplicatively', () => {
    let a = makeActor();
    a = applyStatus(a, atk(1.5));
    a = applyStatus(a, atk(1.2));
    expect(a.statuses).toHaveLength(2);
    expect(statusMultiplier(a.statuses, 'ATK_UP')).toBeCloseTo(1.8);
  });

  it('keeps different kinds independent of each other', () => {
    let a = makeActor();
    a = applyStatus(a, atk(1.25));
    a = applyStatus(a, { kind: 'DEF_UP', magnitude: 2, turnsRemaining: 2 });
    a = applyStatus(a, { kind: 'HASTE', magnitude: 1.5, turnsRemaining: 2 });
    expect(a.statuses).toHaveLength(3);
  });

  it('never exceeds the stack cap', () => {
    let a = makeActor();
    for (let i = 0; i < 6; i++) a = applyStatus(a, atk(1.25));
    expect(a.statuses).toHaveLength(MAX_STATUS_STACKS);
  });

  it('lets a stronger status displace the weakest at the cap', () => {
    let a = makeActor();
    a = applyStatus(a, atk(1.5));
    a = applyStatus(a, atk(1.2));
    a = applyStatus(a, atk(1.9));

    const magnitudes = a.statuses.map((s) => s.magnitude).sort();
    expect(magnitudes).toEqual([1.5, 1.9]);
  });

  it('refreshes duration instead of displacing when the newcomer is weaker', () => {
    let a = makeActor();
    a = applyStatus(a, atk(1.5, 1));
    a = applyStatus(a, atk(1.2, 1));
    a = applyStatus(a, atk(1.1, 9));

    expect(a.statuses.map((s) => s.magnitude).sort()).toEqual([1.2, 1.5]);
    /* The weakest instance took the longer of the two durations. */
    const weakest = a.statuses.find((s) => s.magnitude === 1.2);
    expect(weakest?.turnsRemaining).toBe(9);
  });

  it('never shortens an existing duration on a refresh', () => {
    let a = makeActor();
    a = applyStatus(a, atk(1.5, 8));
    a = applyStatus(a, atk(1.2, 8));
    a = applyStatus(a, atk(1.1, 1));

    for (const status of a.statuses) expect(status.turnsRemaining).toBe(8);
  });

  it('rejects a non-positive magnitude', () => {
    expect(() => applyStatus(makeActor(), atk(0))).toThrow(/0/);
    expect(() => applyStatus(makeActor(), atk(-1))).toThrow(/-1/);
  });

  it('rejects a duration that is not a positive integer', () => {
    expect(() => applyStatus(makeActor(), atk(1.25, 0))).toThrow(/0/);
    expect(() => applyStatus(makeActor(), atk(1.25, -2))).toThrow(/-2/);
    expect(() => applyStatus(makeActor(), atk(1.25, 1.5))).toThrow(/1.5/);
  });
});

describe('tickStatuses', () => {
  it('decrements every duration by one', () => {
    const a = tickStatuses(makeActor({ statuses: [atk(1.25, 3)] }));
    expect(a.statuses[0]?.turnsRemaining).toBe(2);
  });

  it('drops a status whose duration reaches zero', () => {
    const a = tickStatuses(makeActor({ statuses: [atk(1.25, 1)] }));
    expect(a.statuses).toEqual([]);
  });

  it('ticks each status independently', () => {
    const a = tickStatuses(
      makeActor({
        statuses: [
          atk(1.25, 1),
          { kind: 'DEF_UP', magnitude: 2, turnsRemaining: 4 },
        ],
      }),
    );
    expect(a.statuses).toHaveLength(1);
    expect(a.statuses[0]?.kind).toBe('DEF_UP');
    expect(a.statuses[0]?.turnsRemaining).toBe(3);
  });

  it('does not mutate the original actor', () => {
    const original = makeActor({ statuses: [atk(1.25, 3)] });
    tickStatuses(original);
    expect(original.statuses[0]?.turnsRemaining).toBe(3);
  });

  it('is a no-op on an actor with no statuses', () => {
    expect(tickStatuses(makeActor()).statuses).toEqual([]);
  });
});

describe('expireStatuses', () => {
  it('drops expired statuses without decrementing the survivors', () => {
    const a = expireStatuses(
      makeActor({
        statuses: [atk(1.25, 0), { kind: 'DEF_UP', magnitude: 2, turnsRemaining: 3 }],
      }),
    );
    expect(a.statuses).toHaveLength(1);
    expect(a.statuses[0]?.turnsRemaining).toBe(3);
  });

  it('drops statuses that have gone negative', () => {
    expect(expireStatuses(makeActor({ statuses: [atk(1.25, -3)] })).statuses).toEqual([]);
  });
});
