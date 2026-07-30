/**
 * Status effect lifecycle: apply, tick, expire.
 *
 * Every function here takes an actor and returns a new one. Statuses are the
 * most tempting thing in a battle system to mutate in place -- they are
 * small, they change constantly, and the array is right there -- which is
 * exactly why the discipline is enforced by returning new objects rather
 * than trusted to callers.
 *
 * WHAT COUNTS AS "A TURN"
 * -----------------------
 * Durations decrement at the end of the BEARER's turn, not at the end of a
 * round. An actor with a 2-turn buff gets it for their own next action and
 * everything that happens before it, regardless of where they sit in the
 * order. The tick is issued from takeAction, so it fires for party and enemy
 * alike without any caller having to remember.
 */

import type { Actor, Status, StatusKind } from './types';

/**
 * How many instances of one kind an actor may carry.
 *
 * WHY THERE IS A CAP AT ALL
 * -------------------------
 * statusMultiplier multiplies instances of a kind together, and
 * damage.test.ts pins that behaviour. Stacking is therefore the contract --
 * but unbounded stacking makes "buff instead of attacking" strictly
 * dominant, because two ATK_UPs at 1.25 already beat a turn of damage and
 * five would beat anything. Two is enough for stacking to feel real and few
 * enough that it cannot run away.
 *
 * Enforced in applyStatus rather than written down as a caller's duty --
 * the same reasoning as fitSpacingToPlatform in spriteLayout.ts. A rule a
 * caller can break is a rule that will be broken.
 */
export const MAX_STATUS_STACKS = 2;

/**
 * Adds a status, respecting the stack cap.
 *
 * Below the cap the status is simply appended, so it stacks multiplicatively
 * with what is already there. At the cap the rule is deterministic:
 *
 *   - stronger than the weakest instance -> it replaces that instance
 *   - otherwise                          -> the weakest instance's duration
 *                                           becomes the longer of the two,
 *                                           and no magnitude changes
 *
 * The second branch is what makes re-applying a buff useful rather than
 * wasted, without letting repetition inflate the multiplier. Duration is
 * taken as a maximum, never overwritten, so a short re-application can never
 * cut an existing buff short.
 */
export function applyStatus(actor: Actor, status: Status): Actor {
  if (!(status.magnitude > 0)) {
    throw new Error(
      `Status ${status.kind} magnitude must be greater than 0, got ${status.magnitude}`,
    );
  }
  if (!Number.isInteger(status.turnsRemaining) || status.turnsRemaining <= 0) {
    throw new Error(
      `Status ${status.kind} turnsRemaining must be a positive integer, ` +
        `got ${status.turnsRemaining}`,
    );
  }

  const sameKind = actor.statuses.filter((s) => s.kind === status.kind);

  if (sameKind.length < MAX_STATUS_STACKS) {
    return { ...actor, statuses: [...actor.statuses, { ...status }] };
  }

  const weakest = weakestOf(sameKind);

  const statuses = actor.statuses.map((s) => {
    if (s !== weakest) return s;
    return status.magnitude > weakest.magnitude
      ? { ...status }
      : { ...s, turnsRemaining: Math.max(s.turnsRemaining, status.turnsRemaining) };
  });

  return { ...actor, statuses };
}

/**
 * Lowest-magnitude instance, ties going to the shorter duration.
 *
 * Deterministic by construction: displacing "some" instance would make the
 * result depend on array order, which is the same reproducibility problem
 * buildRound solves with its id tie-break.
 */
function weakestOf(statuses: readonly Status[]): Status {
  return statuses.reduce((weakest, candidate) => {
    if (candidate.magnitude !== weakest.magnitude) {
      return candidate.magnitude < weakest.magnitude ? candidate : weakest;
    }
    return candidate.turnsRemaining < weakest.turnsRemaining ? candidate : weakest;
  });
}

/** Advance every status one turn and drop whatever ran out. */
export function tickStatuses(actor: Actor): Actor {
  const decremented = actor.statuses.map((status) => ({
    ...status,
    turnsRemaining: status.turnsRemaining - 1,
  }));

  return expireStatuses({ ...actor, statuses: decremented });
}

/**
 * Drop statuses that have run out, without advancing anything.
 *
 * Separate from tickStatuses so the drop rule can be tested on its own, and
 * so a future effect that removes a buff early (a dispel) has something to
 * call that does not also cost the target a turn of every other status.
 */
export function expireStatuses(actor: Actor): Actor {
  return { ...actor, statuses: actor.statuses.filter((s) => s.turnsRemaining > 0) };
}

/** Whether a given kind is currently active on an actor. */
export function hasStatus(actor: Actor, kind: StatusKind): boolean {
  return actor.statuses.some((s) => s.kind === kind && s.turnsRemaining > 0);
}
