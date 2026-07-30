/**
 * Actor factories for tests.
 *
 * Not a test file itself -- vitest collects `src/**\/*.test.ts` only, so this
 * is imported by suites rather than run as one. It exists because five test
 * files each carrying their own copy of an actor literal is five places to
 * update when `Stats` gains a field, and four of them will be missed.
 *
 * The rosters here deliberately mirror the on-screen cast: four party
 * members against one boss, with the sprite `name` and the `ActorId` being
 * the same string. That is the seam the UI phase will join on.
 */

import type { Actor, ActorId, Side, Stats } from './types';

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
const PARTY_STATS: Stats = {
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
 * prove victory is testing patience, not logic. The HUD's 1,200,000 is a
 * display placeholder and deliberately not used here.
 */
const BOSS_STATS: Stats = {
  maxHp: 4200,
  maxMp: 200,
  attack: 260,
  defense: 140,
  /* Below every party member, so the boss acts last in an untouched round.
     That makes turn-order assertions read in a stable, obvious sequence. */
  speed: 70,
};

export function makeActor(overrides: Partial<Actor> = {}): Actor {
  const stats = overrides.stats ?? PARTY_STATS;
  return {
    id: 'test',
    name: 'Test',
    side: 'party',
    level: 70,
    stats,
    hp: stats.maxHp,
    mp: stats.maxMp,
    statuses: [],
    ...overrides,
  };
}

/**
 * The four party members, in the same order as the on-screen formation.
 *
 * Speeds are distinct and descending so the default turn order is
 * unambiguous; the tie-break rule gets its own dedicated fixtures rather
 * than being smuggled in here.
 */
export function makeParty(): Actor[] {
  const speeds: Record<string, number> = {
    kira: 130,
    neo: 120,
    vex: 110,
    lyra: 100,
  };

  return Object.entries(speeds).map(([id, speed]) =>
    makeActor({
      id,
      name: id.toUpperCase(),
      side: 'party',
      stats: { ...PARTY_STATS, speed },
    }),
  );
}

export function makeBoss(overrides: Partial<Actor> = {}): Actor {
  return makeActor({
    id: 'apollyon',
    name: 'APOLLYON',
    side: 'enemy',
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

/** Actors sharing a speed, to exercise the id tie-break in buildRound. */
export function makeTiedSpeeds(ids: readonly ActorId[], side: Side = 'party'): Actor[] {
  return ids.map((id) =>
    makeActor({ id, name: id, side, stats: { ...PARTY_STATS, speed: 100 } }),
  );
}
