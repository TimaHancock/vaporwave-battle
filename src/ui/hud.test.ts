import { describe, expect, it } from 'vitest';
import { LOW_HP_FRACTION, toHudModel } from './hud';
import { INITIAL_MENU } from './menu';
import { createBattle } from '../battle/battle';
import { makeActor, makeBoss, makeParty, makeRoster } from '../battle/fixtures';
import type { BattleState } from '../battle/types';

/**
 * toHudModel only. The vitest environment is 'node', and renderHud is
 * deliberately the half that makes no decisions -- Playwright verifies it
 * against these same values through a real browser.
 */

const IDLE = {
  narration: 'Awaiting orders.',
  history: ['Awaiting orders.'],
  isLocked: false,
};

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

  it('gives the round as a ring, leading with whoever is up', () => {
    const turnOrder = model().turnOrder;

    /* Descending speed: the party leads, the boss brings up the rear. Each
       actor ONCE -- it is a cycle, not a lookahead. */
    expect(turnOrder.map((entry) => entry.id)).toEqual([
      'kira',
      'neo',
      'vex',
      'lyra',
      'apollyon',
    ]);
    expect(turnOrder[0]?.id).toBe(model().activeActorId);
  });

  it('holds every living actor exactly once', () => {
    /* The carousel splits ONE portrait across the seam, showing its two
       halves at opposite edges. A ring that repeated an actor would put the
       same face in two places at once and the split would stop reading as a
       wrap. */
    const ids = model().turnOrder.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it('resolves turn-order names and sides as well as ids', () => {
    expect(model().turnOrder[0]).toEqual({
      id: 'kira',
      name: 'KIRA',
      side: 'party',
    });
    /* The side is what lets the bar answer "is the boss up next" without
       anything downstream having to recognise a portrait. */
    expect(model().turnOrder[4]).toEqual({
      id: 'apollyon',
      name: 'APOLLYON',
      side: 'enemy',
    });
  });

  it('ends on the actor who went immediately before the leader', () => {
    /* THE PROPERTY THE SPLIT PORTRAIT RESTS ON. The carousel shows the last
       ring entry twice -- half-dissolving off the left edge as "just went"
       and half-dissolving in at the right as "next loop". Those can only be
       one portrait if the tail is genuinely the previous actor, which is what
       rotating (rather than forecasting) buys. */
    const battle = createBattle(1337, makeRoster());

    /* VEX is up, so NEO went last. */
    const midRound = model({ ...battle, turnIndex: 2 }).turnOrder;
    expect(midRound[0]?.id).toBe('vex');
    expect(midRound.at(-1)?.id).toBe('neo');

    /* And at the top of a round it wraps: KIRA is up, APOLLYON closed the
       previous round and will close this one too. */
    const roundStart = model(battle).turnOrder;
    expect(roundStart[0]?.id).toBe('kira');
    expect(roundStart.at(-1)?.id).toBe('apollyon');
  });

  it('rotates by exactly one per turn and comes back round', () => {
    const battle = createBattle(1337, makeRoster());
    const ringAt = (turnIndex: number) =>
      model({ ...battle, turnIndex }).turnOrder.map((entry) => entry.id);

    const start = ringAt(0);
    expect(start).toEqual(['kira', 'neo', 'vex', 'lyra', 'apollyon']);

    /* Every index is the start rotated left by exactly that many places --
       one step per turn, no skipping and no doubling back. */
    for (let turn = 1; turn < start.length; turn++) {
      expect(ringAt(turn), `turn ${turn}`).toEqual([
        ...start.slice(turn),
        ...start.slice(0, turn),
      ]);
    }

    /* And a full lap of N rotations lands back on the order it started in --
       which is what makes this a loop rather than a queue that runs out. */
    const lap = start.reduce((order) => [...order.slice(1), order[0]!], start);
    expect(lap).toEqual(start);
  });

  it('drops a defeated actor rather than promising a turn that is skipped', () => {
    /* advance() walks past a fallen actor when it picks the next turn, but the
       queue is built once per round and never edited. So without this filter
       VEX would keep a place on the carousel for the rest of the round,
       advertising a turn she will not take. */
    const base = createBattle(1, makeRoster());
    const felled: BattleState = {
      ...base,
      actors: base.actors.map((a) => (a.id === 'vex' ? { ...a, hp: 0 } : a)),
    };

    const ids = model(felled).turnOrder.map((entry) => entry.id);

    expect(ids).not.toContain('vex');
    /* The ring SHORTENS rather than padding itself back to five. Four
       remaining turns honestly shown beats a duplicate keeping the count. */
    expect(ids).toEqual(['kira', 'neo', 'lyra', 'apollyon']);
  });

  it('empties the turn order once the battle has ended', () => {
    /* There is no next turn to forecast, and showing one implies the fight
       is still running. */
    expect(model({ ...createBattle(1, makeRoster()), phase: 'victory' }).turnOrder).toEqual([]);
  });

  it('carries the counters and the sequencer view straight through', () => {
    const view = {
      narration: 'KIRA attacks APOLLYON!',
      history: ['Awaiting orders.', 'KIRA attacks APOLLYON!'],
      isLocked: true,
    };
    const hud = toHudModel(createBattle(1, makeRoster()), INITIAL_MENU, view);

    expect(hud.round).toBe(1);
    expect(hud.chain).toBe(0);
    expect(hud.phase).toBe('in_progress');
    expect(hud.narration).toBe('KIRA attacks APOLLYON!');
    expect(hud.isLocked).toBe(true);

    /* The action log renders the tail of this, and hangs the `narration`
       testid on its last entry. The two describing the same moment is the
       sequencer's invariant, and this is where the HUD depends on it. */
    expect(hud.history).toEqual(['Awaiting orders.', 'KIRA attacks APOLLYON!']);
    expect(hud.history.at(-1)).toBe(hud.narration);
  });

  it('renders the command level as a single active panel by default', () => {
    const panels = model().panels;

    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({
      level: 'command',
      title: 'Command',
      cursor: 0,
      isActive: true,
    });
    expect(panels[0]?.options.map((option) => option.id)).toEqual([
      'attack',
      'skill',
      'defend',
    ]);
  });

  it('labels ATTACK with the acting character own attack', () => {
    /* KIRA is a knight, so the first command reads Scale Cleave. The id stays
       'attack' -- only what the player reads changes. */
    const attack = model().panels[0]?.options[0];
    expect(attack?.id).toBe('attack');
    expect(attack?.label).toBe('Scale Cleave');
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
