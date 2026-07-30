/**
 * Turn order.
 *
 * A discrete queue, not an ATB gauge: everyone alive acts exactly once per
 * round, fastest first. That is the model the reference art implies -- a
 * turn-order bar showing a readable sequence of portraits -- and it is far
 * easier to reason about than continuous time.
 *
 * The queue is rebuilt at the start of each round rather than maintained
 * incrementally. Rebuilding is O(n log n) on a cast of five and removes an
 * entire category of bug: a speed change mid-round cannot corrupt an order
 * already part-consumed, because the order in flight is never edited.
 */

import { statusMultiplier } from './damage';
import { isDefeated, type Actor, type ActorId, type BattleState } from './types';

/**
 * Speed after buffs. HASTE is the only status that moves turn order.
 *
 * Lives here rather than beside effectiveAttack/effectiveDefense in
 * damage.ts because that module is scoped to the damage formula, and turn
 * order is this one's entire subject.
 */
export function effectiveSpeed(actor: Actor): number {
  return actor.stats.speed * statusMultiplier(actor.statuses, 'HASTE');
}

/**
 * The order of play for one round: living actors, fastest first.
 *
 * TIES ARE BROKEN BY ACTOR ID, NOT BY ARRAY POSITION
 * ---------------------------------------------------
 * Array.prototype.sort is stable, so ties would otherwise resolve to
 * whatever order the caller happened to build `actors` in. That is a
 * dependency on something no one thinks of as significant -- appending a
 * character, or reordering a roster literal, would silently change the
 * sequence of play. Since the seed is supposed to make a battle
 * reproducible, sorting by a total order is what makes that promise true.
 *
 * Duplicate ids are rejected rather than tolerated: the queue holds ids, so
 * two actors sharing one makes every later lookup ambiguous, and the
 * symptom (the wrong character taking damage) surfaces far from the cause.
 */
export function buildRound(actors: readonly Actor[]): ActorId[] {
  const seen = new Set<ActorId>();
  for (const actor of actors) {
    if (seen.has(actor.id)) {
      throw new Error(
        `Duplicate actor id "${actor.id}". Ids must be unique -- the turn ` +
          `queue holds ids, so a repeat makes every lookup ambiguous.`,
      );
    }
    seen.add(actor.id);
  }

  return actors
    .filter((actor) => !isDefeated(actor))
    .map((actor) => ({ id: actor.id, speed: effectiveSpeed(actor) }))
    .sort((a, b) => (b.speed - a.speed) || a.id.localeCompare(b.id))
    .map((entry) => entry.id);
}

/**
 * The next `count` actors due to act, for the turn-order bar.
 *
 * Walks out the current round, then speculatively builds subsequent rounds
 * until it has enough entries.
 *
 * TWO LIMITS WORTH KNOWING, both inherent rather than fixable here:
 *
 *   1. Speculation uses CURRENT speeds and statuses. A HASTE landing later
 *      this round changes the real next round, so anything past the current
 *      round is a forecast, not a promise. That is the correct behaviour
 *      for a UI bar -- it should show what would happen if nothing changed.
 *   2. Statuses are not simulated forward. A HASTE expiring next round is
 *      still counted, for the same reason.
 *
 * Returns fewer than `count` when the battle cannot produce that many turns,
 * rather than padding or looping.
 */
export function previewUpcoming(state: BattleState, count: number): ActorId[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`previewUpcoming count must be a non-negative integer, got ${count}`);
  }

  const upcoming = state.turnQueue.slice(state.turnIndex, state.turnIndex + count);
  if (upcoming.length >= count) return upcoming;

  /* A round that would be empty means nobody can act at all. Returning what
     we have beats spinning forever building empty rounds. */
  const nextRound = buildRound(state.actors);
  if (nextRound.length === 0) return upcoming;

  while (upcoming.length < count) {
    upcoming.push(...nextRound.slice(0, count - upcoming.length));
  }

  return upcoming;
}
