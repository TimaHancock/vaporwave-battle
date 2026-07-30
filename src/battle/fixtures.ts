/**
 * Actor factories for tests.
 *
 * Not a test file itself -- vitest collects `src/**\/*.test.ts` only, so this
 * is imported by suites rather than run as one.
 *
 * The cast itself moved to roster.ts, which is production data: main.ts
 * builds the real battle from the same numbers the tests assert against, so
 * there is exactly one place where the party's HP lives. This file re-exports
 * those factories so existing suites import unchanged, and adds the helpers
 * that only a test would want.
 */

import { makeActor, PARTY_STATS } from './roster';
import type { Actor, ActorId, Side } from './types';

export {
  makeActor,
  makeParty,
  makeBoss,
  makeRoster,
  PARTY_STATS,
  BOSS_STATS,
} from './roster';

/** Actors sharing a speed, to exercise the id tie-break in buildRound. */
export function makeTiedSpeeds(ids: readonly ActorId[], side: Side = 'party'): Actor[] {
  return ids.map((id) =>
    makeActor({ id, name: id, side, stats: { ...PARTY_STATS, speed: 100 } }),
  );
}
