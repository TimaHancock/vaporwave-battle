/**
 * Damage calculation.
 *
 * This is a deliberately small first version. Its job in Phase 0 is to
 * prove the fast-feedback channel end to end: a pure function, a test
 * file, a sub-second `npm run test`. Balance comes much later.
 *
 * The important structural property: this function takes numbers and a
 * seeded Rng and returns numbers. No DOM, no three.js, no global state.
 * Keep it that way -- everything expensive to verify lives elsewhere.
 */

import type { Actor, Status, StatusKind } from './types';
import type { Rng } from '../rng';

export interface DamageInput {
  attacker: Actor;
  defender: Actor;
  /** Skill multiplier. 1.0 is a basic attack. */
  power: number;
  /** Probability of a critical hit, 0..1. */
  critChance: number;
  /** Damage multiplier applied on a critical hit. */
  critMultiplier: number;
  rng: Rng;
}

export interface DamageResult {
  amount: number;
  isCritical: boolean;
}

/** Total multiplier from all active statuses of a given kind. */
export function statusMultiplier(statuses: readonly Status[], kind: StatusKind): number {
  return statuses
    .filter((s) => s.kind === kind && s.turnsRemaining > 0)
    .reduce((product, s) => product * s.magnitude, 1);
}

/**
 * Effective attack and defense after buffs.
 * Split out so tests can assert buff maths independently of the roll.
 */
export function effectiveAttack(actor: Actor): number {
  return actor.stats.attack * statusMultiplier(actor.statuses, 'ATK_UP');
}

export function effectiveDefense(actor: Actor): number {
  return actor.stats.defense * statusMultiplier(actor.statuses, 'DEF_UP');
}

/**
 * Random variance band applied to every hit, so repeated identical attacks
 * do not print identical numbers. +/- 5%.
 */
const VARIANCE = 0.05;

export function calculateDamage(input: DamageInput): DamageResult {
  const { attacker, defender, power, critChance, critMultiplier, rng } = input;

  const attack = effectiveAttack(attacker);
  const defense = effectiveDefense(defender);

  /* Subtractive-with-floor rather than a ratio: it keeps big numbers
     readable (a 23,450 damage pop like the reference art) without a high
     defense value reducing damage to nothing. The 0.15 floor guarantees a
     hit always does *something*, which matters for the chain counter. */
  const raw = Math.max(attack * power - defense * 0.5, attack * power * 0.15);

  // Draw the crit roll before variance so the sequence is stable if the
  // variance band is later re-tuned.
  const isCritical = rng.chance(critChance);
  const variance = 1 + (rng.next() * 2 - 1) * VARIANCE;

  const total = raw * variance * (isCritical ? critMultiplier : 1);

  return {
    // Always at least 1: a hit that displays "0" reads as a bug to players.
    amount: Math.max(1, Math.round(total)),
    isCritical,
  };
}
