/**
 * Core battle vocabulary.
 *
 * These types are the contract every later phase builds against. Getting
 * them right early is worth more than any other single decision in the
 * project -- they are what stop forty interacting mechanics from turning
 * into a pile of loosely-related numbers.
 *
 * Nothing in this file imports from three.js or touches the DOM. Battle
 * logic must stay renderable-agnostic so it can be tested in milliseconds.
 */

/** Stable identifier for an actor in the battle. */
export type ActorId = string;

/** Which side an actor fights for. Drives targeting and win/lose checks. */
export type Side = 'party' | 'enemy';

/**
 * Status effects. Phase 0 defines only the three visible in the reference
 * art. Expand deliberately -- each addition needs stacking rules, a
 * duration policy, and a damage-formula hook.
 */
export type StatusKind = 'ATK_UP' | 'DEF_UP' | 'HASTE';

export interface Status {
  kind: StatusKind;
  /** Turns remaining. Decremented at the end of the bearer's turn. */
  turnsRemaining: number;
  /** Multiplier applied by this status, e.g. 1.25 for a 25% attack buff. */
  magnitude: number;
}

/** Base numeric stats. Buffs are applied on top, never written back here. */
export interface Stats {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  /** Drives turn order. Higher acts sooner. */
  speed: number;
}

export interface Actor {
  id: ActorId;
  name: string;
  side: Side;
  level: number;
  stats: Stats;
  hp: number;
  mp: number;
  statuses: Status[];
}

/** An actor is out of the fight at zero HP. Centralised so the rule has one home. */
export function isDefeated(actor: Actor): boolean {
  return actor.hp <= 0;
}

/**
 * The complete battle state.
 *
 * This object is the single source of truth. The renderer and the UI are
 * both pure functions of it -- they read it and never write to it. All
 * mutation happens through battle logic functions, which makes the whole
 * system testable without a browser.
 */
export interface BattleState {
  /** The seed this battle was created with. Logged for reproducibility. */
  seed: number;
  /** Every actor, party and enemy, keyed by turn-order position. */
  actors: Actor[];
  /** Index into `actors` of whoever is currently acting. */
  activeActorIndex: number;
  /** Completed rounds. Useful for status expiry and boss phase gating. */
  round: number;
  /** Consecutive successful hits without a miss. Drives the CHAIN counter. */
  chain: number;
  phase: 'in_progress' | 'victory' | 'defeat';
}

export function activeActor(state: BattleState): Actor {
  const actor = state.actors[state.activeActorIndex];
  if (actor === undefined) {
    throw new Error(
      `activeActorIndex ${state.activeActorIndex} is out of range ` +
        `(${state.actors.length} actors)`,
    );
  }
  return actor;
}
