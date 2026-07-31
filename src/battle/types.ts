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
 * What an actor is, which decides what it can do.
 *
 * Declared here rather than in classes.ts so that Actor can carry it without
 * types.ts importing the class table -- classes.ts needs SkillId from this
 * file, and the two would form a cycle.
 *
 * The four party classes are the characters as authored in
 * public/characters/CHARACTER_PROMPTS.md. Change one there and change it here.
 */
export type ClassName =
  | 'knight'
  | 'wizard'
  | 'rogue'
  | 'artificer'
  | 'aberration';

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
  /** Decides this actor's attack name and skill list. See classes.ts. */
  className: ClassName;
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
  /**
   * Every actor, party and enemy, in stable insertion order.
   *
   * Deliberately NOT the turn order. Speed order changes whenever HASTE
   * lands or an actor falls, and an array that reshuffles under callers is
   * how stale indices end up pointing at the wrong character. The order of
   * play lives in `turnQueue`; this array only has to be findable.
   */
  actors: Actor[];
  /**
   * Actor ids in the order they act this round, from `buildRound`.
   * Rebuilt at the start of each round, so a mid-round speed change takes
   * effect next round rather than reordering a round already under way.
   */
  turnQueue: ActorId[];
  /** Position within `turnQueue` of whoever is currently acting. */
  turnIndex: number;
  /** Completed rounds. Useful for status expiry and boss phase gating. */
  round: number;
  /**
   * Consecutive damaging hits landed by the party. Drives the CHAIN counter.
   *
   * Increments on every damaging hit a party member lands, and resets to
   * zero the moment a party member takes damage. The enemy landing a hit is
   * what breaks a chain -- not the party missing, since nothing in the
   * damage formula can currently miss.
   */
  chain: number;
  phase: 'in_progress' | 'victory' | 'defeat';
}

/** Find an actor by id. Returns undefined rather than throwing. */
export function findActor(
  state: BattleState,
  id: ActorId,
): Actor | undefined {
  return state.actors.find((actor) => actor.id === id);
}

export function activeActor(state: BattleState): Actor {
  const id = state.turnQueue[state.turnIndex];
  if (id === undefined) {
    throw new Error(
      `turnIndex ${state.turnIndex} is out of range ` +
        `(queue has ${state.turnQueue.length} entries)`,
    );
  }

  const actor = findActor(state, id);
  if (actor === undefined) {
    throw new Error(
      `turnQueue holds unknown actor id "${id}"; ` +
        `known ids are ${state.actors.map((a) => a.id).join(', ')}`,
    );
  }
  return actor;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Identifier for an entry in the skill table (see actions.ts). */
export type SkillId = string;

/**
 * What an actor does on its turn.
 *
 * A discriminated union rather than a class hierarchy: it is exhaustively
 * checkable by the compiler, trivially serialisable into a replay log, and
 * the UI can construct one without importing any battle logic.
 */
export type Action =
  | { kind: 'attack'; targetId: ActorId }
  | { kind: 'skill'; skillId: SkillId; targetId: ActorId }
  | { kind: 'defend' };

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * What actually happened when an action resolved.
 *
 * State says what is true now; events say what changed. The UI needs the
 * second one -- a damage number, a status icon flying in, a death animation
 * are all responses to a transition, and diffing two states to recover them
 * is both harder and lossier than being told directly.
 */
export type BattleEvent =
  | {
      kind: 'damage';
      sourceId: ActorId;
      targetId: ActorId;
      amount: number;
      isCritical: boolean;
    }
  | { kind: 'heal'; sourceId: ActorId; targetId: ActorId; amount: number }
  | { kind: 'statusApplied'; sourceId: ActorId; targetId: ActorId; status: Status }
  | { kind: 'defeated'; actorId: ActorId }
  | { kind: 'battleEnded'; outcome: 'victory' | 'defeat' };

/** Every state transition returns the new state alongside what it caused. */
export interface Resolution {
  state: BattleState;
  events: BattleEvent[];
}
