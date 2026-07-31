import { describe, it, expect } from 'vitest';
import { takeAction, DEFEND_MAGNITUDE, DEFEND_TURNS } from './actions';
import { SKILLS } from './skills';
import { buildRound } from './turnOrder';
import { statusMultiplier } from './damage';
import { makeRoster } from './fixtures';
import { createRng } from '../rng';
import type { Action, Actor, BattleState } from './types';

function stateOf(actors: Actor[] = makeRoster(), turnIndex = 0): BattleState {
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

/** Position the queue on the boss so enemy-side behaviour can be tested. */
function bossTurn(actors: Actor[] = makeRoster()): BattleState {
  const state = stateOf(actors);
  return { ...state, turnIndex: state.turnQueue.indexOf('apollyon') };
}

const attack = (targetId: string): Action => ({ kind: 'attack', targetId });
const actorNamed = (state: BattleState, id: string): Actor =>
  state.actors.find((a) => a.id === id)!;

describe('takeAction — attack', () => {
  it('reduces the target hp and reports a damage event', () => {
    const before = stateOf();
    const { state, events } = takeAction(before, attack('apollyon'), createRng(1));

    const boss = actorNamed(state, 'apollyon');
    expect(boss.hp).toBeLessThan(actorNamed(before, 'apollyon').hp);

    const damage = events.find((e) => e.kind === 'damage');
    expect(damage).toMatchObject({ kind: 'damage', sourceId: 'kira', targetId: 'apollyon' });
  });

  it('is deterministic for a given seed', () => {
    const a = takeAction(stateOf(), attack('apollyon'), createRng(7));
    const b = takeAction(stateOf(), attack('apollyon'), createRng(7));
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it('does not mutate the state it is given', () => {
    const before = stateOf();
    const frozen = JSON.stringify(before);
    takeAction(before, attack('apollyon'), createRng(1));
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('survives a deep-frozen input state', () => {
    const before = stateOf();
    before.actors.forEach((a) => {
      Object.freeze(a.statuses);
      Object.freeze(a.stats);
      Object.freeze(a);
    });
    Object.freeze(before.actors);
    Object.freeze(before);

    expect(() => takeAction(before, attack('apollyon'), createRng(1))).not.toThrow();
  });

  it('clamps a lethal hit to zero hp and reports the defeat', () => {
    const roster = makeRoster().map((a) => (a.id === 'apollyon' ? { ...a, hp: 1 } : a));
    const { state, events } = takeAction(stateOf(roster), attack('apollyon'), createRng(1));

    expect(actorNamed(state, 'apollyon').hp).toBe(0);
    expect(events).toContainEqual({ kind: 'defeated', actorId: 'apollyon' });
  });

  it('ticks the acting actor statuses at the end of their turn', () => {
    const roster = makeRoster().map((a) =>
      a.id === 'kira'
        ? { ...a, statuses: [{ kind: 'ATK_UP' as const, magnitude: 1.5, turnsRemaining: 2 }] }
        : a,
    );
    const { state } = takeAction(stateOf(roster), attack('apollyon'), createRng(1));
    expect(actorNamed(state, 'kira').statuses[0]?.turnsRemaining).toBe(1);
  });

  it('does not tick anyone else statuses', () => {
    const roster = makeRoster().map((a) =>
      a.id === 'neo'
        ? { ...a, statuses: [{ kind: 'ATK_UP' as const, magnitude: 1.5, turnsRemaining: 2 }] }
        : a,
    );
    const { state } = takeAction(stateOf(roster), attack('apollyon'), createRng(1));
    expect(actorNamed(state, 'neo').statuses[0]?.turnsRemaining).toBe(2);
  });
});

describe('takeAction — chain counter', () => {
  it('increments on a party hit', () => {
    const { state } = takeAction(stateOf(), attack('apollyon'), createRng(1));
    expect(state.chain).toBe(1);
  });

  it('resets when a party member takes damage', () => {
    const start = { ...bossTurn(), chain: 5 };
    const { state } = takeAction(start, attack('kira'), createRng(1));
    expect(state.chain).toBe(0);
  });

  it('does not increment on defend', () => {
    const start = { ...stateOf(), chain: 3 };
    const { state } = takeAction(start, { kind: 'defend' }, createRng(1));
    expect(state.chain).toBe(3);
  });
});

describe('takeAction — defend', () => {
  it('applies DEF_UP to the actor', () => {
    const { state, events } = takeAction(stateOf(), { kind: 'defend' }, createRng(1));
    const kira = actorNamed(state, 'kira');
    expect(statusMultiplier(kira.statuses, 'DEF_UP')).toBeCloseTo(DEFEND_MAGNITUDE);
    expect(events.some((e) => e.kind === 'statusApplied')).toBe(true);
  });

  /* The whole point of the 2-turn duration: a 1-turn buff would be ticked
     away by the defender's own end-of-turn and never mitigate anything. */
  it('survives its own end-of-turn tick', () => {
    const { state } = takeAction(stateOf(), { kind: 'defend' }, createRng(1));
    const kira = actorNamed(state, 'kira');
    expect(kira.statuses[0]?.turnsRemaining).toBe(DEFEND_TURNS - 1);
    expect(kira.statuses[0]?.turnsRemaining).toBeGreaterThan(0);
  });

  it('actually mitigates the incoming hit', () => {
    const plain = takeAction(bossTurn(), attack('kira'), createRng(3));
    const guardedRoster = takeAction(stateOf(), { kind: 'defend' }, createRng(1)).state.actors;
    const guarded = takeAction(bossTurn(guardedRoster), attack('kira'), createRng(3));

    const hp = (r: typeof plain) => r.state.actors.find((a) => a.id === 'kira')!.hp;
    expect(hp(guarded)).toBeGreaterThan(hp(plain));
  });

  it('expires after the defender next turn', () => {
    let state = takeAction(stateOf(), { kind: 'defend' }, createRng(1)).state;
    state = takeAction(state, attack('apollyon'), createRng(1)).state;
    expect(actorNamed(state, 'kira').statuses).toEqual([]);
  });
});

describe('takeAction — skill', () => {
  const offensive = Object.values(SKILLS).find((s) => s.target === 'enemy')!;
  const buff = Object.values(SKILLS).find((s) => s.target === 'ally')!;
  const heal = Object.values(SKILLS).find((s) => s.heal !== undefined)!;

  it('spends mp', () => {
    const { state } = takeAction(
      stateOf(),
      { kind: 'skill', skillId: offensive.id, targetId: 'apollyon' },
      createRng(1),
    );
    expect(actorNamed(state, 'kira').mp).toBe(
      actorNamed(stateOf(), 'kira').mp - offensive.mpCost,
    );
  });

  it('hits harder than a basic attack', () => {
    const basic = takeAction(stateOf(), attack('apollyon'), createRng(11));
    const skilled = takeAction(
      stateOf(),
      { kind: 'skill', skillId: offensive.id, targetId: 'apollyon' },
      createRng(11),
    );
    const hp = (r: typeof basic) => r.state.actors.find((a) => a.id === 'apollyon')!.hp;
    expect(hp(skilled)).toBeLessThan(hp(basic));
  });

  it('applies a status for a buff skill and reports it', () => {
    const { state, events } = takeAction(
      stateOf(),
      { kind: 'skill', skillId: buff.id, targetId: 'neo' },
      createRng(1),
    );
    expect(actorNamed(state, 'neo').statuses).toHaveLength(1);
    expect(events.some((e) => e.kind === 'statusApplied' && e.targetId === 'neo')).toBe(true);
  });

  it('restores hp for a heal skill without exceeding maxHp', () => {
    const roster = makeRoster().map((a) => (a.id === 'neo' ? { ...a, hp: 10 } : a));
    const { state, events } = takeAction(
      stateOf(roster),
      { kind: 'skill', skillId: heal.id, targetId: 'neo' },
      createRng(1),
    );
    const neo = actorNamed(state, 'neo');
    expect(neo.hp).toBeGreaterThan(10);
    expect(neo.hp).toBeLessThanOrEqual(neo.stats.maxHp);
    expect(events.some((e) => e.kind === 'heal')).toBe(true);
  });

  it('caps a heal at maxHp rather than overflowing', () => {
    const { state } = takeAction(
      stateOf(),
      { kind: 'skill', skillId: heal.id, targetId: 'neo' },
      createRng(1),
    );
    const neo = actorNamed(state, 'neo');
    expect(neo.hp).toBe(neo.stats.maxHp);
  });
});

describe('takeAction — rejections', () => {
  it('rejects an unknown target id', () => {
    expect(() => takeAction(stateOf(), attack('nobody'), createRng(1))).toThrow(/nobody/);
  });

  it('rejects attacking a target that is already defeated', () => {
    const roster = makeRoster().map((a) => (a.id === 'apollyon' ? { ...a, hp: 0 } : a));
    expect(() => takeAction(stateOf(roster), attack('apollyon'), createRng(1))).toThrow(
      /apollyon/,
    );
  });

  it('rejects attacking your own side', () => {
    expect(() => takeAction(stateOf(), attack('neo'), createRng(1))).toThrow(/neo/);
  });

  it('rejects an unknown skill id', () => {
    expect(() =>
      takeAction(
        stateOf(),
        { kind: 'skill', skillId: 'no_such_skill', targetId: 'apollyon' },
        createRng(1),
      ),
    ).toThrow(/no_such_skill/);
  });

  it('rejects a skill the actor cannot afford', () => {
    const skill = Object.values(SKILLS)[0]!;
    const roster = makeRoster().map((a) => (a.id === 'kira' ? { ...a, mp: 0 } : a));
    expect(() =>
      takeAction(
        stateOf(roster),
        { kind: 'skill', skillId: skill.id, targetId: 'apollyon' },
        createRng(1),
      ),
    ).toThrow(/mp/i);
  });

  it('rejects an ally skill aimed at an enemy', () => {
    const buff = Object.values(SKILLS).find((s) => s.target === 'ally')!;
    expect(() =>
      takeAction(
        stateOf(),
        { kind: 'skill', skillId: buff.id, targetId: 'apollyon' },
        createRng(1),
      ),
    ).toThrow(/apollyon/);
  });

  it('rejects acting once the battle has ended', () => {
    const ended: BattleState = { ...stateOf(), phase: 'victory' };
    expect(() => takeAction(ended, attack('apollyon'), createRng(1))).toThrow(/victory/);
  });

  it('rejects an action from a defeated actor', () => {
    const roster = makeRoster().map((a) => (a.id === 'kira' ? { ...a, hp: 0 } : a));
    /* Build the queue from the living roster, then point it at the corpse. */
    const state: BattleState = { ...stateOf(roster), turnQueue: ['kira'], turnIndex: 0 };
    expect(() => takeAction(state, attack('apollyon'), createRng(1))).toThrow(/kira/);
  });
});
