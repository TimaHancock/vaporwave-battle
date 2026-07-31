/**
 * Resolving a single action.
 *
 * takeAction is the one place a battle changes as a result of a decision.
 * Turn advancement is deliberately NOT here -- see battle.ts -- so that
 * "what does this action do" and "who goes next" stay independently
 * testable.
 *
 * INVALID ACTIONS THROW
 * ---------------------
 * Every rejection below could instead return the state unchanged. It would
 * be a mistake. A silent no-op turns a UI bug (offering a skill the actor
 * cannot afford) into a battle that quietly stops responding, and the
 * report that comes back is "sometimes clicking does nothing" -- the least
 * actionable bug there is. Throwing names the violated rule and the value
 * that violated it, at the moment it happens.
 */

import { calculateDamage } from './damage';
import { SKILLS } from './skills';
import { applyStatus, tickStatuses } from './status';
import {
  isDefeated,
  type Action,
  type Actor,
  type ActorId,
  type BattleEvent,
  type BattleState,
  type Resolution,
  type Side,
  type SkillId,
  type Status,
} from './types';
import type { Rng } from '../rng';

/* ------------------------------------------------------------------ */
/* Defend                                                              */
/* ------------------------------------------------------------------ */

/** Halves incoming damage, by doubling effective defense. */
export const DEFEND_MAGNITUDE = 2;

/**
 * Two turns, and the second one is not generosity -- it is arithmetic.
 *
 * Durations tick down at the end of the bearer's turn, and defending IS the
 * bearer's turn, so a 1-turn guard would be decremented to zero and expire
 * before a single enemy acted. Two ticks to 1 immediately, covers the rest
 * of the round, then expires at the end of the defender's next turn. That
 * is exactly one full round of protection.
 */
export const DEFEND_TURNS = 2;

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

/* The table moved to skills.ts once characters got individual lists -- see
   the note there. Re-exported so `Skill` stays reachable from the module that
   resolves it. */
export type { Skill } from './skills';

const BASIC_ATTACK = {
  power: 1,
  critChance: 0.15,
  critMultiplier: 2,
} as const;

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export function takeAction(state: BattleState, action: Action, rng: Rng): Resolution {
  if (state.phase !== 'in_progress') {
    throw new Error(`Cannot act: the battle already ended in ${state.phase}.`);
  }

  const actor = requireActiveActor(state);
  const events: BattleEvent[] = [];

  let actors: Actor[];

  switch (action.kind) {
    case 'attack': {
      const target = requireTarget(state, actor, action.targetId, 'enemy');
      actors = resolveDamage(state, actor, target, BASIC_ATTACK, rng, events);
      break;
    }
    case 'skill': {
      actors = resolveSkill(state, actor, action.skillId, action.targetId, rng, events);
      break;
    }
    case 'defend': {
      const guard: Status = {
        kind: 'DEF_UP',
        magnitude: DEFEND_MAGNITUDE,
        turnsRemaining: DEFEND_TURNS,
      };
      actors = replace(state.actors, applyStatus(actor, guard));
      events.push({
        kind: 'statusApplied',
        sourceId: actor.id,
        targetId: actor.id,
        status: guard,
      });
      break;
    }
  }

  /* End of the bearer's turn. Issued here rather than from advance() so it
     fires identically for party and enemy, and so a caller cannot skip it
     by driving takeAction without advancing. */
  actors = replace(actors, tickStatuses(byId(actors, actor.id)));

  return {
    state: { ...state, actors, chain: nextChain(state, events) },
    events,
  };
}

/* ------------------------------------------------------------------ */
/* Action bodies                                                       */
/* ------------------------------------------------------------------ */

function resolveSkill(
  state: BattleState,
  actor: Actor,
  skillId: SkillId,
  targetId: ActorId,
  rng: Rng,
  events: BattleEvent[],
): Actor[] {
  const skill = SKILLS[skillId];
  if (skill === undefined) {
    throw new Error(
      `Unknown skill "${skillId}". Known skills: ${Object.keys(SKILLS).join(', ')}.`,
    );
  }
  if (actor.mp < skill.mpCost) {
    throw new Error(
      `${actor.id} cannot afford ${skill.name}: needs ${skill.mpCost} mp, has ${actor.mp}.`,
    );
  }

  const target = requireTarget(state, actor, targetId, skill.target);
  const spender = { ...actor, mp: actor.mp - skill.mpCost };
  let actors = replace(state.actors, spender);

  if (skill.power !== undefined) {
    actors = resolveDamage(
      { ...state, actors },
      spender,
      byId(actors, target.id),
      {
        power: skill.power,
        critChance: skill.critChance ?? 0,
        critMultiplier: skill.critMultiplier ?? 1,
      },
      rng,
      events,
    );
  }

  if (skill.heal !== undefined) {
    const healed = byId(actors, target.id);
    /* Clamped to maxHp: an actor above their maximum breaks every hp bar
       that assumes hp/maxHp is a 0..1 fraction. */
    const amount = Math.min(
      Math.round(healed.stats.maxHp * skill.heal),
      healed.stats.maxHp - healed.hp,
    );
    actors = replace(actors, { ...healed, hp: healed.hp + amount });
    events.push({ kind: 'heal', sourceId: actor.id, targetId: healed.id, amount });
  }

  if (skill.status !== undefined) {
    const receiver = byId(actors, target.id);
    actors = replace(actors, applyStatus(receiver, skill.status));
    events.push({
      kind: 'statusApplied',
      sourceId: actor.id,
      targetId: receiver.id,
      status: { ...skill.status },
    });
  }

  return actors;
}

function resolveDamage(
  state: BattleState,
  attacker: Actor,
  defender: Actor,
  profile: { power: number; critChance: number; critMultiplier: number },
  rng: Rng,
  events: BattleEvent[],
): Actor[] {
  const result = calculateDamage({ attacker, defender, ...profile, rng });

  /* Floored at zero. Negative hp would make isDefeated true but every
     display of it wrong, and "-40 / 900" in a health bar reads as a bug. */
  const hp = Math.max(0, defender.hp - result.amount);
  const actors = replace(state.actors, { ...defender, hp });

  events.push({
    kind: 'damage',
    sourceId: attacker.id,
    targetId: defender.id,
    amount: result.amount,
    isCritical: result.isCritical,
  });

  if (hp === 0) events.push({ kind: 'defeated', actorId: defender.id });

  return actors;
}

/* ------------------------------------------------------------------ */
/* Chain                                                               */
/* ------------------------------------------------------------------ */

/**
 * The CHAIN counter from the reference HUD.
 *
 * Counts damaging hits the party lands in a row, and breaks the moment the
 * party takes damage. Nothing in calculateDamage can miss, so an enemy
 * connecting is the only thing that can break it -- which also makes it a
 * legible reward for defending and healing rather than pure aggression.
 */
function nextChain(state: BattleState, events: readonly BattleEvent[]): number {
  let chain = state.chain;

  for (const event of events) {
    if (event.kind !== 'damage') continue;
    const target = state.actors.find((a) => a.id === event.targetId);
    if (target?.side === 'party') {
      chain = 0;
    } else {
      chain += 1;
    }
  }

  return chain;
}

/* ------------------------------------------------------------------ */
/* Guards and helpers                                                  */
/* ------------------------------------------------------------------ */

function requireActiveActor(state: BattleState): Actor {
  const id = state.turnQueue[state.turnIndex];
  if (id === undefined) {
    throw new Error(
      `turnIndex ${state.turnIndex} is out of range (queue has ` +
        `${state.turnQueue.length} entries).`,
    );
  }

  const actor = state.actors.find((a) => a.id === id);
  if (actor === undefined) {
    throw new Error(`turnQueue holds unknown actor id "${id}".`);
  }
  if (isDefeated(actor)) {
    throw new Error(`${actor.id} is defeated and cannot act.`);
  }
  return actor;
}

/**
 * Resolves a target id and checks it is a legal one.
 *
 * `expected` is relative to the actor: 'enemy' means the opposing side,
 * 'ally' means the actor's own. Expressing it that way rather than as a
 * literal Side means a skill definition reads the same whether a party
 * member or the boss uses it.
 */
function requireTarget(
  state: BattleState,
  actor: Actor,
  targetId: ActorId,
  expected: 'enemy' | 'ally',
): Actor {
  const target = state.actors.find((a) => a.id === targetId);
  if (target === undefined) {
    throw new Error(
      `Unknown target "${targetId}". Actors in this battle: ` +
        `${state.actors.map((a) => a.id).join(', ')}.`,
    );
  }
  if (isDefeated(target)) {
    throw new Error(`Cannot target "${targetId}": already defeated.`);
  }

  const wantedSide: Side = expected === 'ally' ? actor.side : opposing(actor.side);
  if (target.side !== wantedSide) {
    throw new Error(
      `${actor.id} cannot use an ${expected}-targeted action on "${targetId}" ` +
        `(${actor.id} is ${actor.side}, ${targetId} is ${target.side}).`,
    );
  }

  return target;
}

function opposing(side: Side): Side {
  return side === 'party' ? 'enemy' : 'party';
}

/** Replace one actor by id, preserving array order. */
function replace(actors: readonly Actor[], updated: Actor): Actor[] {
  return actors.map((actor) => (actor.id === updated.id ? updated : actor));
}

function byId(actors: readonly Actor[], id: ActorId): Actor {
  const actor = actors.find((a) => a.id === id);
  if (actor === undefined) throw new Error(`No actor with id "${id}".`);
  return actor;
}
