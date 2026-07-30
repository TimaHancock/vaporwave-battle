import { describe, it, expect } from 'vitest';
import { buildRound, effectiveSpeed, previewUpcoming } from './turnOrder';
import { makeActor, makeParty, makeRoster, makeTiedSpeeds } from './fixtures';
import type { BattleState } from './types';

/** A state positioned at the start of a freshly built round. */
function stateAt(actors = makeRoster(), turnIndex = 0): BattleState {
  return {
    seed: 1337,
    actors,
    turnQueue: buildRound(actors),
    turnIndex,
    round: 1,
    chain: 0,
    phase: 'in_progress',
  };
}

describe('effectiveSpeed', () => {
  it('is the base speed with no statuses', () => {
    expect(effectiveSpeed(makeActor({ stats: { ...makeActor().stats, speed: 100 } }))).toBe(100);
  });

  it('scales with HASTE', () => {
    const hasted = makeActor({
      stats: { ...makeActor().stats, speed: 100 },
      statuses: [{ kind: 'HASTE', turnsRemaining: 2, magnitude: 1.5 }],
    });
    expect(effectiveSpeed(hasted)).toBeCloseTo(150);
  });

  it('ignores statuses that are not HASTE', () => {
    const buffed = makeActor({
      stats: { ...makeActor().stats, speed: 100 },
      statuses: [{ kind: 'ATK_UP', turnsRemaining: 2, magnitude: 3 }],
    });
    expect(effectiveSpeed(buffed)).toBe(100);
  });
});

describe('buildRound', () => {
  it('orders by descending speed', () => {
    expect(buildRound(makeRoster())).toEqual(['kira', 'neo', 'vex', 'lyra', 'apollyon']);
  });

  /* The whole reason ties are broken by id: a queue that depends on where a
     caller happened to push an actor is a queue that changes when unrelated
     code is reordered, and the symptom is a battle replaying differently
     from its own seed. */
  it('does not depend on the order actors were passed in', () => {
    const roster = makeRoster();
    const shuffled = [roster[3]!, roster[0]!, roster[4]!, roster[2]!, roster[1]!];
    expect(buildRound(shuffled)).toEqual(buildRound(roster));
  });

  it('breaks speed ties by ascending actor id', () => {
    expect(buildRound(makeTiedSpeeds(['delta', 'alpha', 'charlie', 'bravo']))).toEqual([
      'alpha',
      'bravo',
      'charlie',
      'delta',
    ]);
  });

  it('omits defeated actors', () => {
    const roster = makeRoster().map((a) => (a.id === 'neo' ? { ...a, hp: 0 } : a));
    expect(buildRound(roster)).not.toContain('neo');
  });

  it('returns an empty queue when everyone is defeated', () => {
    expect(buildRound(makeParty().map((a) => ({ ...a, hp: 0 })))).toEqual([]);
  });

  it('puts a hasted actor ahead of a faster unhasted one', () => {
    const roster = makeRoster().map((a) =>
      a.id === 'lyra'
        ? { ...a, statuses: [{ kind: 'HASTE' as const, turnsRemaining: 2, magnitude: 2 }] }
        : a,
    );
    expect(buildRound(roster)[0]).toBe('lyra');
  });

  it('rejects duplicate actor ids', () => {
    const clashing = [makeActor({ id: 'kira' }), makeActor({ id: 'kira' })];
    expect(() => buildRound(clashing)).toThrow(/kira/);
  });

  it('does not mutate the actors it is given', () => {
    const roster = makeRoster();
    const before = JSON.stringify(roster);
    buildRound(roster);
    expect(JSON.stringify(roster)).toBe(before);
  });
});

describe('previewUpcoming', () => {
  it('starts with whoever is acting now', () => {
    expect(previewUpcoming(stateAt(), 1)).toEqual(['kira']);
  });

  it('returns the rest of the current round', () => {
    expect(previewUpcoming(stateAt(makeRoster(), 2), 3)).toEqual(['vex', 'lyra', 'apollyon']);
  });

  it('rolls past the round boundary into the next round', () => {
    /* Positioned on the last actor of the round, so entries 2..4 can only
       come from a speculatively rebuilt next round. */
    expect(previewUpcoming(stateAt(makeRoster(), 4), 4)).toEqual([
      'apollyon',
      'kira',
      'neo',
      'vex',
    ]);
  });

  it('spans several rounds when asked for more turns than a round holds', () => {
    const preview = previewUpcoming(stateAt(), 12);
    expect(preview).toHaveLength(12);
    expect(preview.slice(0, 5)).toEqual(['kira', 'neo', 'vex', 'lyra', 'apollyon']);
    expect(preview.slice(5, 10)).toEqual(['kira', 'neo', 'vex', 'lyra', 'apollyon']);
  });

  it('returns fewer than asked rather than looping forever on an empty queue', () => {
    const dead = makeRoster().map((a) => ({ ...a, hp: 0 }));
    expect(previewUpcoming({ ...stateAt(dead), turnQueue: [], turnIndex: 0 }, 5)).toEqual([]);
  });

  it('returns nothing for n = 0', () => {
    expect(previewUpcoming(stateAt(), 0)).toEqual([]);
  });

  it('rejects a negative or non-integer count', () => {
    expect(() => previewUpcoming(stateAt(), -1)).toThrow(/-1/);
    expect(() => previewUpcoming(stateAt(), 2.5)).toThrow(/2.5/);
  });
});
