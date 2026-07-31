/**
 * The cast.
 *
 * This is production data, not a fixture: `main.ts` builds the real battle
 * from it. It lives here rather than in fixtures.ts because a game importing
 * its roster from a test helper has the dependency arrow pointing the wrong
 * way -- fixtures.ts now re-exports from this file instead.
 *
 * The ids match the sprite `name`s in main.ts exactly. That is the seam the
 * UI joins on: a `damage` event's `targetId` resolves to a sprite, and the
 * sprite gives the screen anchor for a damage number.
 */

import type { Actor, ClassName, Stats } from './types';

/**
 * Baseline party stats. Numbers are small so tests resolve in few rounds.
 *
 * maxHp is set so the party comfortably survives the fight rather than
 * scraping a win. At 900 the roster produced victory with a single member
 * alive on 49 hp and three dead -- a real outcome, but a terrible fixture:
 * the end-to-end test would flip to defeat on any unrelated damage tuning,
 * and the failure would look like a broken engine rather than a rebalance.
 * The knife-edge case is worth testing deliberately, not by accident.
 */
export const PARTY_STATS: Stats = {
  maxHp: 1500,
  maxMp: 120,
  attack: 220,
  defense: 90,
  speed: 100,
};

/**
 * Boss stats.
 *
 * HP is sized so a four-member party attacking every round wins in a
 * handful of rounds rather than hundreds -- a test that takes 400 rounds to
 * prove victory is testing patience, not logic.
 */
export const BOSS_STATS: Stats = {
  maxHp: 4200,
  maxMp: 200,
  attack: 260,
  defense: 140,
  /* Below every party member, so the boss acts last in an untouched round.
     That makes turn-order assertions read in a stable, obvious sequence --
     and it is what lets createSequencer assume the first turn is a party
     one, which the whole menu-driven UI depends on. */
  speed: 70,
};

/**
 * Party speeds and classes, in formation order.
 *
 * The class is what decides a character's attack name and skill list (see
 * classes.ts), and it mirrors the art: kira is the dragonborn knight, neo the
 * human wizard, vex the tiefling rogue, lyra the halfling artificer, exactly
 * as authored in public/characters/CHARACTER_PROMPTS.md.
 *
 * Speeds are distinct and descending so the default turn order is
 * unambiguous.
 */
const PARTY_MEMBERS: readonly {
  id: string;
  speed: number;
  className: ClassName;
}[] = [
  { id: 'kira', speed: 130, className: 'knight' },
  { id: 'neo', speed: 120, className: 'wizard' },
  { id: 'vex', speed: 110, className: 'rogue' },
  { id: 'lyra', speed: 100, className: 'artificer' },
];

export function makeActor(overrides: Partial<Actor> = {}): Actor {
  const stats = overrides.stats ?? PARTY_STATS;
  return {
    id: 'test',
    name: 'Test',
    side: 'party',
    /* A default so the many makeActor() calls in the suite that do not care
       about class keep working. Knight because it is the plainest loadout --
       a damage skill, a buff, a bigger damage skill -- and so a test that
       accidentally depends on the default depends on the least surprising
       one. */
    className: 'knight',
    level: 70,
    stats,
    hp: stats.maxHp,
    mp: stats.maxMp,
    statuses: [],
    ...overrides,
  };
}

/** The four party members, in the same order as the on-screen formation. */
export function makeParty(): Actor[] {
  return PARTY_MEMBERS.map(({ id, speed, className }) =>
    makeActor({
      id,
      name: id.toUpperCase(),
      side: 'party',
      className,
      stats: { ...PARTY_STATS, speed },
    }),
  );
}

export function makeBoss(overrides: Partial<Actor> = {}): Actor {
  return makeActor({
    id: 'apollyon',
    name: 'APOLLYON',
    side: 'enemy',
    className: 'aberration',
    level: 95,
    stats: BOSS_STATS,
    hp: BOSS_STATS.maxHp,
    mp: BOSS_STATS.maxMp,
    ...overrides,
  });
}

/** The full on-screen roster: four party members and the boss. */
export function makeRoster(): Actor[] {
  return [...makeParty(), makeBoss()];
}

export interface RosterOptions {
  /**
   * Override the boss's health.
   *
   * Exists for the e2e suite: a full-strength boss takes roughly 25 player
   * actions to fell, which at a readable pause length is a half-minute
   * Playwright test. Shortening the boss rather than the pauses keeps the
   * timing under test real -- the input lock, the narration beats and the
   * commit order all still happen at the speed a player would see.
   */
  bossMaxHp?: number;
}

/**
 * Build the roster for a real battle.
 *
 * `bossMaxHp` sets both `stats.maxHp` and `hp`, because createBattle rejects
 * an actor whose hp exceeds its maximum -- setting one without the other
 * would fail at construction with a message about the wrong thing.
 */
export function createRoster(options: RosterOptions = {}): Actor[] {
  const { bossMaxHp } = options;
  if (bossMaxHp === undefined) return makeRoster();

  if (!Number.isInteger(bossMaxHp) || bossMaxHp <= 0) {
    throw new Error(
      `bossMaxHp must be a positive integer, got ${bossMaxHp}. ` +
        `A boss at zero hp is defeated before the battle starts.`,
    );
  }

  return [
    ...makeParty(),
    makeBoss({ stats: { ...BOSS_STATS, maxHp: bossMaxHp }, hp: bossMaxHp }),
  ];
}
