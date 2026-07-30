import { describe, it, expect } from 'vitest';
import { advance, checkOutcome, createBattle } from './battle';
import { takeAction } from './actions';
import { makeActor, makeBoss, makeParty, makeRoster } from './fixtures';
import { activeActor, type BattleEvent, type BattleState } from './types';
import { createRng } from '../rng';

const roster = () => makeRoster();

describe('createBattle', () => {
  it('opens on round 1 with the fastest actor up', () => {
    const state = createBattle(1337, roster());
    expect(state.round).toBe(1);
    expect(state.turnIndex).toBe(0);
    expect(state.phase).toBe('in_progress');
    expect(activeActor(state).id).toBe('kira');
  });

  it('records the seed and keeps actors in insertion order', () => {
    const state = createBattle(99, roster());
    expect(state.seed).toBe(99);
    expect(state.actors.map((a) => a.id)).toEqual([
      'kira',
      'neo',
      'vex',
      'lyra',
      'apollyon',
    ]);
  });

  it('builds a turn queue covering every living actor', () => {
    expect(createBattle(1, roster()).turnQueue).toHaveLength(5);
  });

  it('rejects an empty roster', () => {
    expect(() => createBattle(1, [])).toThrow(/empty/i);
  });

  it('rejects duplicate actor ids', () => {
    expect(() => createBattle(1, [makeActor({ id: 'x' }), makeBoss({ id: 'x' })])).toThrow(
      /x/,
    );
  });

  /* Without both sides present, victory and defeat are both true on turn
     one and the battle is over before it starts. */
  it('rejects a roster with no enemies', () => {
    expect(() => createBattle(1, makeParty())).toThrow(/enemy/i);
  });

  it('rejects a roster with no party members', () => {
    expect(() => createBattle(1, [makeBoss()])).toThrow(/party/i);
  });

  it('rejects hp above maxHp', () => {
    expect(() => createBattle(1, [makeActor({ hp: 99999 }), makeBoss()])).toThrow(/hp/i);
  });

  it('rejects negative mp', () => {
    expect(() => createBattle(1, [makeActor({ mp: -1 }), makeBoss()])).toThrow(/mp/i);
  });
});

describe('checkOutcome', () => {
  /* Built by hand rather than through createBattle, which correctly refuses
     a roster with a side already wiped -- that is the state a battle
     REACHES, not one it can start from. */
  const downed = (side: 'party' | 'enemy' | 'both'): BattleState => {
    const start = createBattle(1, roster());
    return {
      ...start,
      actors: start.actors.map((a) =>
        side === 'both' || a.side === side ? { ...a, hp: 0 } : a,
      ),
    };
  };

  it('leaves a live battle in progress and reports nothing', () => {
    const { state, events } = checkOutcome(createBattle(1, roster()));
    expect(state.phase).toBe('in_progress');
    expect(events).toEqual([]);
  });

  it('declares victory when every enemy is down', () => {
    const { state, events } = checkOutcome(downed('enemy'));
    expect(state.phase).toBe('victory');
    expect(events).toContainEqual({ kind: 'battleEnded', outcome: 'victory' });
  });

  it('declares defeat when every party member is down', () => {
    expect(checkOutcome(downed('party')).state.phase).toBe('defeat');
  });

  it('gives victory precedence when both sides fall together', () => {
    expect(checkOutcome(downed('both')).state.phase).toBe('victory');
  });

  it('does not re-announce an ending it already declared', () => {
    const ended: BattleState = { ...createBattle(1, roster()), phase: 'victory' };
    expect(checkOutcome(ended).events).toEqual([]);
  });
});

describe('advance', () => {
  it('moves to the next actor in the queue', () => {
    const state = advance(createBattle(1337, roster()), createRng(1)).state;
    expect(activeActor(state).id).toBe('neo');
  });

  it('does not mutate the state it is given', () => {
    const before = createBattle(1337, roster());
    const frozen = JSON.stringify(before);
    advance(before, createRng(1));
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('skips an actor defeated mid-round', () => {
    const start = createBattle(1337, roster());
    const withNeoDown = {
      ...start,
      actors: start.actors.map((a) => (a.id === 'neo' ? { ...a, hp: 0 } : a)),
    };
    expect(activeActor(advance(withNeoDown, createRng(1)).state).id).toBe('vex');
  });

  /* The boss is slowest, so reaching it means running out the party's turns.
     advance resolves its action rather than handing control back. */
  it('resolves an enemy turn instead of stopping on it', () => {
    let state = createBattle(1337, roster());
    const events: BattleEvent[] = [];

    for (let i = 0; i < 4; i++) {
      state = takeAction(state, { kind: 'attack', targetId: 'apollyon' }, createRng(i)).state;
      const step = advance(state, createRng(100 + i));
      state = step.state;
      events.push(...step.events);
    }

    /* Control came back to a party member, and the boss acted on the way. */
    expect(activeActor(state).side).toBe('party');
    expect(events.some((e) => e.kind === 'damage' && e.sourceId === 'apollyon')).toBe(true);
  });

  it('starts a new round once the queue is exhausted', () => {
    let state = createBattle(1337, roster());
    for (let i = 0; i < 4; i++) {
      state = takeAction(state, { kind: 'attack', targetId: 'apollyon' }, createRng(i)).state;
      state = advance(state, createRng(100 + i)).state;
    }
    expect(state.round).toBe(2);
    expect(activeActor(state).id).toBe('kira');
  });

  /* HASTE landing mid-round must not reorder a round already under way --
     the queue in flight is never edited, only rebuilt at a round boundary. */
  it('applies a mid-round speed change only from the next round', () => {
    let state = createBattle(1337, roster());
    const queueBefore = [...state.turnQueue];

    state = takeAction(
      state,
      { kind: 'attack', targetId: 'apollyon' },
      createRng(1),
    ).state;
    state = {
      ...state,
      actors: state.actors.map((a) =>
        a.id === 'lyra'
          ? { ...a, statuses: [{ kind: 'HASTE' as const, magnitude: 3, turnsRemaining: 5 }] }
          : a,
      ),
    };

    expect(state.turnQueue).toEqual(queueBefore);

    for (let i = 0; i < 4; i++) {
      state = takeAction(state, { kind: 'attack', targetId: 'apollyon' }, createRng(i)).state;
      state = advance(state, createRng(200 + i)).state;
      if (state.round === 2) break;
    }

    expect(state.turnQueue[0]).toBe('lyra');
  });

  it('returns an ended battle unchanged', () => {
    const ended: BattleState = { ...createBattle(1, roster()), phase: 'victory' };
    const { state, events } = advance(ended, createRng(1));
    expect(state).toEqual(ended);
    expect(events).toEqual([]);
  });

  it('ends the battle rather than advancing past a wipe', () => {
    const start = createBattle(1337, roster());
    const wiped = {
      ...start,
      actors: start.actors.map((a) => (a.side === 'party' ? { ...a, hp: 0 } : a)),
    };
    const { state, events } = advance(wiped, createRng(1));
    expect(state.phase).toBe('defeat');
    expect(events).toContainEqual({ kind: 'battleEnded', outcome: 'defeat' });
  });
});

describe('a whole battle, end to end', () => {
  /**
   * The point of this suite: a full fight, decided by real damage rolls, in
   * a few milliseconds and with no pixels rendered. The party of four
   * mirrors the on-screen formation and the boss is the same actor id as
   * the boss sprite.
   *
   * The round count is emergent rather than designed, but it is not
   * arbitrary. Party attack 220 against boss defense 140 gives
   * max(220 - 70, 33) = 150 base, about 172 after the 15% crit rate, so
   * four attackers deal roughly 690 a round into 4200 hp -- six to seven
   * rounds. A number far outside that band would mean the damage path, not
   * the expectation, is what changed.
   */
  it('reaches victory at seed 1337 in a predictable number of rounds', () => {
    const rng = createRng(1337);
    let state = createBattle(1337, roster());
    const events: BattleEvent[] = [];

    /* Generous ceiling: this is a stuck-loop tripwire, not a turn limit. */
    for (let guard = 0; guard < 500 && state.phase === 'in_progress'; guard++) {
      const step = takeAction(state, { kind: 'attack', targetId: 'apollyon' }, rng);
      state = step.state;
      events.push(...step.events);

      const advanced = advance(state, rng);
      state = advanced.state;
      events.push(...advanced.events);
    }

    expect(state.phase).toBe('victory');
    expect(state.round).toBe(7);
    expect(state.actors.find((a) => a.id === 'apollyon')?.hp).toBe(0);
    expect(events.at(-1)).toEqual({ kind: 'battleEnded', outcome: 'victory' });
    expect(events.filter((e) => e.kind === 'defeated')).toEqual([
      { kind: 'defeated', actorId: 'apollyon' },
    ]);
  });

  it('replays identically from the same seed', () => {
    const run = (): BattleState => {
      const rng = createRng(4242);
      let state = createBattle(4242, roster());
      for (let guard = 0; guard < 500 && state.phase === 'in_progress'; guard++) {
        state = takeAction(state, { kind: 'attack', targetId: 'apollyon' }, rng).state;
        state = advance(state, rng).state;
      }
      return state;
    };
    expect(run()).toEqual(run());
  });

  it('ends in defeat when the party cannot out-damage the boss', () => {
    const glassParty = makeParty().map((a) => ({
      ...a,
      hp: 60,
      stats: { ...a.stats, maxHp: 60, attack: 5 },
    }));
    const rng = createRng(1337);
    let state = createBattle(1337, [...glassParty, makeBoss()]);

    for (let guard = 0; guard < 500 && state.phase === 'in_progress'; guard++) {
      state = takeAction(state, { kind: 'attack', targetId: 'apollyon' }, rng).state;
      state = advance(state, rng).state;
    }

    expect(state.phase).toBe('defeat');
  });
});
