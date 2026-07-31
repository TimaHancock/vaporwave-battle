import { describe, expect, it } from 'vitest';
import { LOW_HP_FRACTION, toHudModel, TURN_PREVIEW_LENGTH } from './hud';
import { INITIAL_MENU } from './menu';
import { createBattle } from '../battle/battle';
import { makeActor, makeBoss, makeParty, makeRoster } from '../battle/fixtures';
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

  /* ---------------------------------------------------------------- */
  /* Card derivations                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * A party card shows a level and two bars, and the bars are coloured by a
   * threshold. All three are derivations, so all three live here rather than
   * in renderHud -- which is the whole reason this file can test them without
   * a browser.
   */
  describe('the numbers a party card renders', () => {
    /** One actor at chosen HP/MP, wrapped in a legal battle state. */
    const at = (hp: number, mp = 120, maxHp = 1500) => {
      const base = createBattle(1, makeRoster());
      const state: BattleState = {
        ...base,
        actors: base.actors.map((actor) =>
          actor.id === 'kira'
            ? { ...actor, hp, mp, stats: { ...actor.stats, maxHp } }
            : actor,
        ),
      };
      return model(state).actors.find((actor) => actor.id === 'kira')!;
    };

    it('carries each actor level, which the bare rows never needed', () => {
      const actors = model().actors;
      expect(actors.find((a) => a.id === 'kira')?.level).toBe(70);
      expect(actors.find((a) => a.id === 'apollyon')?.level).toBe(95);
    });

    it('reports HP and MP as fractions of their maximum', () => {
      expect(at(1500).hpFraction).toBe(1);
      expect(at(750).hpFraction).toBe(0.5);
      expect(at(0).hpFraction).toBe(0);
      expect(at(1500, 30).mpFraction).toBe(0.25);
    });

    it('clamps a fraction into 0..1 rather than overflowing the track', () => {
      /* Overheal and negative HP are both states the battle layer may hold
         transiently. Neither should push a fill past its track or invert it. */
      expect(at(-400).hpFraction).toBe(0);
      expect(at(9000).hpFraction).toBe(1);
    });

    it('returns 0, not NaN, when a maximum is zero', () => {
      /* `width: NaN%` is not a rendering. An empty bar is. */
      const actor = makeActor({
        id: 'hollow',
        stats: { maxHp: 0, maxMp: 0, attack: 1, defense: 1, speed: 1 },
        hp: 0,
        mp: 0,
      });
      const state: BattleState = {
        ...createBattle(1, makeRoster()),
        actors: [actor, makeBoss()],
      };

      const derived = model(state).actors[0]!;
      expect(derived.hpFraction).toBe(0);
      expect(derived.mpFraction).toBe(0);
    });

    it('flags a low bar at the threshold, not merely below it', () => {
      /* Asserted AT the boundary as well as either side: `<` and `<=` differ
         by exactly one HP value, and that is the kind of thing a rebalance
         silently flips. */
      expect(at(1500 * LOW_HP_FRACTION).isHpLow).toBe(true);
      expect(at(1500 * LOW_HP_FRACTION - 1).isHpLow).toBe(true);
      expect(at(1500 * LOW_HP_FRACTION + 1).isHpLow).toBe(false);
      expect(at(1500).isHpLow).toBe(false);
    });

    it('flags a felled actor as low rather than leaving the bar healthy', () => {
      expect(at(0).isHpLow).toBe(true);
      expect(at(0).isDefeated).toBe(true);
    });
  });

  it('refuses a roster with no enemy to put in the bar', () => {
    const partyOnly: BattleState = {
      ...createBattle(1, makeRoster()),
      actors: makeParty(),
    };

    expect(() => model(partyOnly)).toThrowError(/needs an enemy/);
  });
});
