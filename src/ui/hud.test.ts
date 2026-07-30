import { describe, expect, it } from 'vitest';
import { toHudModel, TURN_PREVIEW_LENGTH } from './hud';
import { INITIAL_MENU } from './menu';
import { createBattle } from '../battle/battle';
import { makeBoss, makeParty, makeRoster } from '../battle/fixtures';
import type { BattleState } from '../battle/types';

/**
 * toHudModel only. The vitest environment is 'node', and renderHud is
 * deliberately the half that makes no decisions -- Playwright verifies it
 * against these same values through a real browser.
 */

const IDLE = { narration: 'Awaiting orders.', isLocked: false };

const model = (state: BattleState = createBattle(1337, makeRoster())) =>
  toHudModel(state, INITIAL_MENU, IDLE);

describe('toHudModel', () => {
  it('puts the enemy in the boss bar with its real numbers', () => {
    expect(model().boss).toEqual({
      id: 'apollyon',
      name: 'APOLLYON',
      level: 95,
      hp: 4200,
      maxHp: 4200,
    });
  });

  it('keeps the boss bar after the boss falls, showing zero', () => {
    /* A bar that vanishes on the killing blow denies the player the one
       frame they actually want to see. */
    const felled = createBattle(1, [...makeParty(), makeBoss({ hp: 1 })]);
    const dead: BattleState = {
      ...felled,
      phase: 'victory',
      actors: felled.actors.map((a) => (a.id === 'apollyon' ? { ...a, hp: 0 } : a)),
    };

    expect(model(dead).boss.hp).toBe(0);
    expect(model(dead).boss.maxHp).toBe(4200);
  });

  it('reports every actor, party and enemy alike', () => {
    const actors = model().actors;

    expect(actors.map((actor) => actor.id)).toEqual([
      'kira',
      'neo',
      'vex',
      'lyra',
      'apollyon',
    ]);
    expect(actors[0]).toMatchObject({
      name: 'KIRA',
      side: 'party',
      hp: 1500,
      maxHp: 1500,
      mp: 120,
      maxMp: 120,
      isActive: true,
      isDefeated: false,
    });
  });

  it('marks exactly one actor active', () => {
    expect(model().actors.filter((actor) => actor.isActive)).toHaveLength(1);
    expect(model().activeActorId).toBe('kira');
  });

  it('previews the turn order with the current actor first', () => {
    const turnOrder = model().turnOrder;

    expect(turnOrder).toHaveLength(TURN_PREVIEW_LENGTH);
    expect(turnOrder[0]?.id).toBe('kira');
    /* Descending speed: the party leads, the boss brings up the rear, then
       the next round begins. */
    expect(turnOrder.map((entry) => entry.id)).toEqual([
      'kira',
      'neo',
      'vex',
      'lyra',
      'apollyon',
      'kira',
    ]);
  });

  it('resolves turn-order names as well as ids', () => {
    expect(model().turnOrder[0]).toEqual({ id: 'kira', name: 'KIRA' });
  });

  it('empties the turn order once the battle has ended', () => {
    /* There is no next turn to forecast, and showing one implies the fight
       is still running. */
    expect(model({ ...createBattle(1, makeRoster()), phase: 'victory' }).turnOrder).toEqual([]);
  });

  it('carries the counters and the sequencer view straight through', () => {
    const view = { narration: 'KIRA attacks APOLLYON!', isLocked: true };
    const hud = toHudModel(createBattle(1, makeRoster()), INITIAL_MENU, view);

    expect(hud.round).toBe(1);
    expect(hud.chain).toBe(0);
    expect(hud.phase).toBe('in_progress');
    expect(hud.narration).toBe('KIRA attacks APOLLYON!');
    expect(hud.isLocked).toBe(true);
  });

  it('renders the command level by default', () => {
    expect(model().menuTitle).toBe('Command');
    expect(model().options.map((option) => option.id)).toEqual([
      'attack',
      'skill',
      'defend',
    ]);
    expect(model().cursor).toBe(0);
  });

  it('refuses a roster with no enemy to put in the bar', () => {
    const partyOnly: BattleState = {
      ...createBattle(1, makeRoster()),
      actors: makeParty(),
    };

    expect(() => model(partyOnly)).toThrowError(/needs an enemy/);
  });
});
