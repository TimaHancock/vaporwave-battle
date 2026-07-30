/**
 * Battle lifecycle: construction, turn advancement, and the ending.
 *
 * The split with actions.ts is deliberate. takeAction answers "what does
 * this decision do"; this file answers "whose turn is it, and is the fight
 * over". Keeping them apart means the damage rules can be tested without a
 * queue and the queue can be tested without rolling any dice.
 *
 * advance() resolves enemy turns on the way past and stops on party ones.
 * That is the shape the UI needs: the interface is idle exactly when it is
 * waiting for a human, and never has to know that a boss took three swings
 * in between. The seeded rng makes those swings reproducible.
 */

import { SKILLS, takeAction } from './actions';
import { buildRound } from './turnOrder';
import {
  isDefeated,
  type Action,
  type Actor,
  type BattleEvent,
  type BattleState,
  type Resolution,
  type Side,
} from './types';
import type { Rng } from '../rng';

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build a battle at round 1 with the queue already sorted.
 *
 * Everything rejected below would otherwise produce a battle that is broken
 * in a way no later function can detect. A roster missing a side is the
 * sharpest example: victory and defeat are both true immediately, so the
 * fight ends on its first outcome check and the bug surfaces as "the battle
 * closes instantly" with nothing in the logic to point at.
 */
export function createBattle(seed: number, actors: readonly Actor[]): BattleState {
  if (actors.length === 0) {
    throw new Error('Cannot create a battle with an empty roster.');
  }

  for (const actor of actors) {
    if (actor.hp > actor.stats.maxHp || actor.hp < 0) {
      throw new Error(
        `${actor.id} hp ${actor.hp} is outside 0..${actor.stats.maxHp}.`,
      );
    }
    if (actor.mp > actor.stats.maxMp || actor.mp < 0) {
      throw new Error(
        `${actor.id} mp ${actor.mp} is outside 0..${actor.stats.maxMp}.`,
      );
    }
  }

  requireSide(actors, 'party');
  requireSide(actors, 'enemy');

  /* buildRound owns the duplicate-id check, so calling it here means
     construction rejects a clashing roster rather than deferring the
     failure to the first turn. */
  const turnQueue = buildRound(actors);

  return {
    seed,
    actors: actors.map(cloneActor),
    turnQueue,
    turnIndex: 0,
    round: 1,
    chain: 0,
    phase: 'in_progress',
  };
}

function requireSide(actors: readonly Actor[], side: Side): void {
  if (!actors.some((actor) => actor.side === side && !isDefeated(actor))) {
    throw new Error(
      `A battle needs at least one living ${side} member; the roster has none. ` +
        `Without both sides, victory and defeat are both true on turn one.`,
    );
  }
}

/** Defensive copy so a caller's fixture cannot be aliased into battle state. */
function cloneActor(actor: Actor): Actor {
  return { ...actor, stats: { ...actor.stats }, statuses: actor.statuses.map((s) => ({ ...s })) };
}

/* ------------------------------------------------------------------ */
/* Outcome                                                             */
/* ------------------------------------------------------------------ */

/**
 * Settle victory or defeat, emitting `battleEnded` on the transition only.
 *
 * VICTORY TAKES PRECEDENCE IN A MUTUAL KNOCKOUT. If the last party member
 * and the last enemy fall on the same action, the party landed the blow
 * that ended the fight and the fight is won. The alternative -- defeat
 * winning ties -- turns a successful final attack into a loss, which reads
 * as a bug to a player no matter how it is justified.
 */
export function checkOutcome(state: BattleState): Resolution {
  if (state.phase !== 'in_progress') return { state, events: [] };

  const enemiesDown = state.actors
    .filter((a) => a.side === 'enemy')
    .every(isDefeated);
  const partyDown = state.actors.filter((a) => a.side === 'party').every(isDefeated);

  if (!enemiesDown && !partyDown) return { state, events: [] };

  const outcome = enemiesDown ? 'victory' : 'defeat';
  return {
    state: { ...state, phase: outcome },
    events: [{ kind: 'battleEnded', outcome }],
  };
}

/* ------------------------------------------------------------------ */
/* Advancement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Hand the turn to the next actor, resolving any enemy turns on the way.
 *
 * Returns as soon as a living party member is up, or the battle ends.
 * Advancing a finished battle is a no-op rather than an error: a caller
 * loop that checks the phase is the normal shape, and failing there would
 * punish correct code for being defensive.
 */
export function advance(state: BattleState, rng: Rng): Resolution {
  const events: BattleEvent[] = [];
  let current = state;

  /* Something may have ended the fight since the last advance -- most
     obviously the action the caller just resolved. */
  const settled = checkOutcome(current);
  current = settled.state;
  events.push(...settled.events);
  if (current.phase !== 'in_progress') return { state: current, events };

  /* Bounded to make a logic error surface as a named failure rather than a
     hung test. A single advance can legitimately resolve one enemy turn per
     living enemy, plus round rollovers; anything beyond that is a bug. */
  const limit = (current.actors.length + 1) * 4;

  for (let step = 0; step < limit; step++) {
    current = nextLivingTurn(current);

    if (current.turnQueue.length === 0) {
      const wiped = checkOutcome(current);
      return { state: wiped.state, events: [...events, ...wiped.events] };
    }

    const actor = current.actors.find((a) => a.id === current.turnQueue[current.turnIndex]);
    if (actor === undefined || isDefeated(actor)) continue;

    if (actor.side === 'party') return { state: current, events };

    const resolved = takeAction(current, chooseEnemyAction(current, actor, rng), rng);
    current = resolved.state;
    events.push(...resolved.events);

    const after = checkOutcome(current);
    current = after.state;
    events.push(...after.events);
    if (current.phase !== 'in_progress') return { state: current, events };
  }

  throw new Error(
    `advance did not reach a party turn within ${limit} steps. ` +
      `Round ${current.round}, queue [${current.turnQueue.join(', ')}], ` +
      `index ${current.turnIndex}.`,
  );
}

/**
 * Step the queue forward one living actor, rolling into a new round when it
 * runs out.
 *
 * The round boundary is the ONLY place the queue is rebuilt. A speed change
 * landing mid-round therefore cannot reorder a round already part-consumed,
 * which is what stops an actor from acting twice or being skipped when
 * HASTE lands on them halfway through.
 */
function nextLivingTurn(state: BattleState): BattleState {
  let turnIndex = state.turnIndex + 1;

  while (turnIndex < state.turnQueue.length) {
    const id = state.turnQueue[turnIndex];
    const actor = state.actors.find((a) => a.id === id);
    if (actor !== undefined && !isDefeated(actor)) return { ...state, turnIndex };
    turnIndex += 1;
  }

  return {
    ...state,
    round: state.round + 1,
    turnQueue: buildRound(state.actors),
    turnIndex: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Enemy policy                                                        */
/* ------------------------------------------------------------------ */

/**
 * What an enemy does on its turn.
 *
 * Deliberately plain: this is a placeholder policy, not a boss design. It
 * exists so a battle can run end to end in a test, and so the UI has
 * something to react to. Every decision goes through the seeded rng, so the
 * same seed replays the same fight.
 *
 * Skill use is gated on affordability first and the roll second, so an
 * enemy that cannot pay never burns its roll pretending to consider it --
 * which keeps the rng sequence stable as skills are re-costed.
 */
const ENEMY_SKILL_CHANCE = 0.3;
const ENEMY_SKILL_ID = 'pulse_strike';

function chooseEnemyAction(state: BattleState, actor: Actor, rng: Rng): Action {
  const targets = state.actors.filter((a) => a.side === 'party' && !isDefeated(a));
  if (targets.length === 0) {
    throw new Error(
      `${actor.id} has no living target, but the battle is still in progress. ` +
        `checkOutcome should have ended it first.`,
    );
  }

  const skill = SKILLS[ENEMY_SKILL_ID];
  const canAfford = skill !== undefined && actor.mp >= skill.mpCost;
  const useSkill = canAfford && rng.chance(ENEMY_SKILL_CHANCE);
  const target = rng.pick(targets);

  return useSkill
    ? { kind: 'skill', skillId: ENEMY_SKILL_ID, targetId: target.id }
    : { kind: 'attack', targetId: target.id };
}
