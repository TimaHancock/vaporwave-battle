/**
 * The battle sequencer: an explicit queue of awaited steps.
 *
 * WHY A QUEUE AND NOT NESTED TIMEOUTS
 * -----------------------------------
 * The obvious way to play a turn out over time is setTimeout calling
 * setTimeout calling setTimeout. It works and it is unmaintainable. A
 * timeout chain has no answer to "what is left to do" -- the remaining work
 * exists only as closures the browser is holding -- so it cannot be
 * inspected from __debugState, cannot be tested without fake timers, and its
 * cancellation story is a pile of stored handles that must all be cleared in
 * the right order.
 *
 * A queue of labelled steps answers all three. The pending labels are a
 * plain string array, the pause is an injectable function, and cancelling is
 * emptying an array.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It is not battle logic. Every rule decision goes through takeAction,
 * advance and checkOutcome; this only decides the ORDER things are revealed
 * in and how long the player looks at each one. It also touches no DOM --
 * it produces strings and state, and the caller decides where they land.
 */

import { advance, checkOutcome } from './battle';
import {
  isDefeated,
  type Action,
  type Actor,
  type BattleEvent,
  type BattleState,
} from './types';
import { takeAction } from './actions';
import { attackNameFor } from './classes';
import { SKILLS } from './skills';
import type { Rng } from '../rng';

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

export interface Step {
  /**
   * Names the beat. Surfaces in __debugState so a stalled sequence reports
   * WHERE it stalled rather than just that nothing is happening.
   */
  readonly label: string;
  /**
   * Returned steps are spliced in immediately after this one.
   *
   * This is what handles the parts of a turn whose length is not knowable
   * when the plan is built: an advance that resolves two boss attacks
   * produces more beats than one that resolves none. The queue stays
   * explicit and inspectable either way, which a `for` loop inside a single
   * step would not.
   */
  run(): void | Step[] | Promise<void | Step[]>;
}

export interface SequencerView {
  state: BattleState;
  /** The line currently on screen. */
  narration: string;
  /**
   * Every narration line, oldest first. The last is ALWAYS `narration`.
   *
   * That invariant is load-bearing outside this file: the HUD renders the
   * tail of this array as the action log and hangs the `narration` testid on
   * the newest line, so the suite's assertions about "the current line" and
   * the log's bottom row are the same element. Break it and they silently
   * describe different moments.
   *
   * Recorded here rather than derived from `log`, because the lines that
   * announce an action -- "KIRA uses Scale Cleave on APOLLYON!", "APOLLYON
   * moves." -- are not events and never will be.
   *
   * UNCAPPED on purpose. A full fight is a few hundred short strings, and an
   * uncapped array means an index into it stays valid forever -- which is
   * what lets the HUD append only what it has not yet rendered instead of
   * diffing strings that legitimately repeat. Capping here would shift the
   * array out from under that index. The DOM is capped instead.
   */
  history: readonly string[];
  /** True while a sequence is playing. Input must be ignored. */
  isLocked: boolean;
  /** Labels of steps not yet run. Empty when idle. */
  pending: readonly string[];
  /** Every event the battle has produced, oldest first. */
  log: readonly BattleEvent[];
  /** Player actions ACCEPTED. Input rejected by the lock does not count. */
  actionsTaken: number;
}

export interface Sequencer {
  readonly view: SequencerView;
  /**
   * Offer an action. Returns false when input is locked or the battle has
   * ended, in which case nothing at all changed.
   */
  submit(action: Action): boolean;
  /** Resolves once nothing is playing. */
  settled(): Promise<void>;
}

export interface SequencerOptions {
  state: BattleState;
  rng: Rng;
  /** Pause between beats, in milliseconds. */
  stepMs: number;
  /**
   * Pause between beats of an ENEMY turn. Defaults to
   * `stepMs * ENEMY_BEAT_MULTIPLIER`.
   *
   * See the multiplier for why these are not the same number.
   */
  enemyStepMs?: number;
  onChange: (view: SequencerView) => void;
  /** Injected so tests run instantly instead of in real time. */
  wait?: (ms: number) => Promise<void>;
}

const OPENING_NARRATION = 'Awaiting orders.';

/**
 * An enemy beat holds for longer than a player one.
 *
 * The two are not symmetrical from where the player sits. A player beat
 * confirms something they just chose and were already watching for; an
 * enemy beat is the first they hear of it, and it arrives at the tail of
 * their own turn's narration, when their attention has moved on. At an
 * equal pause the boss's attack reads as a flicker between two lines the
 * player was reading -- they see their HP has dropped without seeing it
 * drop.
 *
 * Three is enough to register a line, look at whose HP moved, and look
 * back. It is a multiplier rather than a fixed duration so that `?stepMs=`
 * still scales the whole fight uniformly.
 */
export const ENEMY_BEAT_MULTIPLIER = 3;

function realWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/* ------------------------------------------------------------------ */
/* Sequencer                                                           */
/* ------------------------------------------------------------------ */

export function createSequencer(options: SequencerOptions): Sequencer {
  const { rng, stepMs, onChange } = options;
  const wait = options.wait ?? realWait;

  if (!Number.isFinite(stepMs) || stepMs < 0) {
    throw new Error(`stepMs must be a non-negative finite number, got ${stepMs}`);
  }

  const enemyStepMs = options.enemyStepMs ?? stepMs * ENEMY_BEAT_MULTIPLIER;
  if (!Number.isFinite(enemyStepMs) || enemyStepMs < 0) {
    throw new Error(
      `enemyStepMs must be a non-negative finite number, got ${enemyStepMs}`,
    );
  }

  /* The whole menu-driven UI assumes the player is being asked for a
     decision the moment the battle opens. If the queue hands the first turn
     to an enemy, the command menu renders for the boss and the player drives
     it -- a bug no later function can detect, because every individual call
     is legal. Reject it here, in the fitSpacingToPlatform spirit. */
  const opener = options.state.actors.find(
    (a) => a.id === options.state.turnQueue[options.state.turnIndex],
  );
  if (opener === undefined || opener.side !== 'party' || isDefeated(opener)) {
    throw new Error(
      `The battle must open on a living party member's turn, but the queue ` +
        `starts with "${opener?.id ?? options.state.turnQueue[options.state.turnIndex]}". ` +
        `Give at least one party member a speed above every enemy's.`,
    );
  }

  let state = options.state;
  let narration = OPENING_NARRATION;
  /* Seeded, not empty. The log is on screen from the first frame, and the
     last-entry-is-narration invariant has to hold at boot too. */
  const history: string[] = [OPENING_NARRATION];
  let locked = false;
  let actionsTaken = 0;
  const log: BattleEvent[] = [];
  let queue: Step[] = [];
  let running: Promise<void> = Promise.resolve();

  function view(): SequencerView {
    return {
      state,
      narration,
      history: [...history],
      isLocked: locked,
      pending: queue.map((step) => step.label),
      log: [...log],
      actionsTaken,
    };
  }

  function emit(): void {
    onChange(view());
  }

  /** A pause, as a step so it shows up in `pending` like everything else. */
  function pause(ms: number = stepMs): Step {
    return {
      label: 'pause',
      run: () => wait(ms),
    };
  }

  function narrate(text: string): Step {
    return {
      label: 'narrate',
      run: () => {
        /* One statement, so `history` and `narration` cannot disagree --
           the same reason `commit` writes the state and the event log
           together. */
        narration = text;
        history.push(text);
        emit();
      },
    };
  }

  /**
   * Publish a new battle state and record what produced it.
   *
   * Every HP change the player sees goes through here, which is why the
   * event log and the displayed state can never drift apart: they are
   * written in the same statement.
   */
  function commit(next: BattleState, events: readonly BattleEvent[]): void {
    state = next;
    log.push(...events);
    emit();
  }

  /**
   * Run the queue to exhaustion.
   *
   * The `finally` is load-bearing. If a step throws -- which in practice
   * means the menu offered an action takeAction rejects -- the lock must
   * still clear, or one bug takes the whole game with it and the player is
   * left staring at a menu that no longer responds. The error still
   * propagates out through settled(), so it fails loudly rather than
   * silently.
   */
  async function drain(): Promise<void> {
    try {
      while (queue.length > 0) {
        const step = queue[0];
        if (step === undefined) break;
        queue = queue.slice(1);

        const spliced = await step.run();
        if (Array.isArray(spliced)) queue = [...spliced, ...queue];
      }
    } finally {
      queue = [];
      locked = false;
      emit();
    }
  }

  /* ---------------------------------------------------------------- */
  /* The plan for one player action                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Steps close over `ctx`, a mutable scratchpad local to one turn.
   *
   * That is not a mutation of BattleState -- each step replaces the
   * reference with the new value takeAction returned. The scratchpad exists
   * because a step needs the output of the one before it, and a queue built
   * up front cannot pass values along any other way.
   */
  function planTurn(actor: Actor, action: Action): Step[] {
    const ctx: { pendingEvents: BattleEvent[] } = { pendingEvents: [] };

    return [
      narrate(describeAction(actor, action, state)),
      pause(),

      {
        label: 'resolve',
        run: () => {
          const resolved = takeAction(state, action, rng);
          ctx.pendingEvents = resolved.events;
          /* The state lands here, in one commit, so the HP bar and the log
             move together. Narration for each event follows. */
          commit(resolved.state, resolved.events);
        },
      },

      {
        label: 'report',
        run: () => beatsFor(ctx.pendingEvents, state.actors),
      },

      {
        label: 'check-outcome',
        run: () => {
          const settled = checkOutcome(state);
          if (settled.events.length === 0) return;

          commit(settled.state, settled.events);
          /* Ending the battle empties the rest of the plan: there is no
             turn to advance to, and `advance` would only no-op. Returning
             the ending beats replaces everything queued behind this. */
          queue = [];
          return beatsFor(settled.events, state.actors);
        },
      },

      {
        label: 'advance',
        run: () => {
          if (state.phase !== 'in_progress') return;

          /* KNOWN LIMITATION, deliberate for this phase: advance resolves
             every enemy turn in one call and hands back their events as a
             batch, so a boss attack narrates beat by beat but its HP change
             lands in a single commit. Splitting it would need a per-turn
             entry point in battle.ts. */
          const stepped = advance(state, rng);
          commit(stepped.state, stepped.events);
          return enemyBeats(stepped.events, state.actors);
        },
      },
    ];
  }

  /** One narrate+pause pair per event worth showing. */
  function beatsFor(
    events: readonly BattleEvent[],
    actors: readonly Actor[],
    ms: number = stepMs,
  ): Step[] {
    return events.flatMap((event) => {
      const text = describeEvent(event, actors);
      return text === null ? [] : [narrate(text), pause(ms)];
    });
  }

  /**
   * Beats for whatever the enemies did on the way back to the player.
   *
   * Two differences from a player's own beats, both for the same reason --
   * this is the half of the fight the player did not choose and is not
   * already watching for:
   *
   *   1. A longer pause. See ENEMY_BEAT_MULTIPLIER.
   *   2. A line announcing WHOSE turn it is before its consequences.
   *      Without it the narration jumps from "APOLLYON takes 180 damage."
   *      to "VEX takes 210 damage." and the player is left to infer from a
   *      falling HP bar that the boss ever acted.
   *
   * The announcement is driven off each event's source, so a second enemy
   * would announce itself too rather than having its hits folded into the
   * first one's turn.
   */
  function enemyBeats(events: readonly BattleEvent[], actors: readonly Actor[]): Step[] {
    const steps: Step[] = [];
    let announced: string | null = null;

    for (const event of events) {
      const source = sourceOf(event);
      if (source !== null && source !== announced) {
        announced = source;
        const actor = actors.find((a) => a.id === source);
        if (actor !== undefined && actor.side === 'enemy') {
          steps.push(narrate(`${actor.name} moves.`), pause(enemyStepMs));
        }
      }

      steps.push(...beatsFor([event], actors, enemyStepMs));
    }

    return steps;
  }

  /* ---------------------------------------------------------------- */
  /* Public surface                                                    */
  /* ---------------------------------------------------------------- */

  return {
    get view() {
      return view();
    },

    submit(action: Action): boolean {
      /* THE LOCK IS SET SYNCHRONOUSLY, BEFORE ANY AWAIT.
         That is the entire mechanism behind "mashing Enter must not queue
         three attacks", and it only holds if nothing yields between the
         check and the set. A rejected submit is dropped, not deferred: a
         keypress replayed later fires against a battle state the player
         never saw. */
      if (locked) return false;
      if (state.phase !== 'in_progress') return false;

      const active = state.actors.find(
        (a) => a.id === state.turnQueue[state.turnIndex],
      );
      if (active === undefined || active.side !== 'party' || isDefeated(active)) {
        return false;
      }

      locked = true;
      actionsTaken += 1;
      queue = planTurn(active, action);
      emit();

      running = drain();
      /* Attaching a handler here stops a failed sequence from surfacing as
         a bare "unhandled promise rejection" with no context. settled()
         still hands the rejection to anyone awaiting it. */
      void running.catch((error: unknown) => {
        console.error('Battle sequence failed mid-turn.', error);
      });

      return true;
    },

    settled(): Promise<void> {
      return running;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Narration                                                           */
/* ------------------------------------------------------------------ */

/**
 * Plain strings, never markup.
 *
 * Narration lives beside the sequencer because it is a description of what
 * the battle did, and the battle is what knows. It stays a string so the
 * src/battle rule holds: the UI decides where the line goes and what it
 * looks like.
 */
export function describeAction(actor: Actor, action: Action, state: BattleState): string {
  switch (action.kind) {
    case 'attack': {
      const target = state.actors.find((a) => a.id === action.targetId);
      /* The actor's own attack, not the word "attacks" -- the knight cleaves
         and the rogue shivs. Same shape as the skill line below, so the two
         read as one grammar. */
      return `${actor.name} uses ${attackNameFor(actor)} on ${
        target?.name ?? action.targetId
      }!`;
    }
    case 'skill': {
      const skill = SKILLS[action.skillId];
      return `${actor.name} uses ${skill?.name ?? action.skillId}!`;
    }
    case 'defend':
      return `${actor.name} braces for impact.`;
  }
}

/**
 * Who caused an event, where the event names one.
 *
 * `defeated` and `battleEnded` are consequences rather than acts, so they
 * carry no source and inherit the announcement already on screen.
 */
function sourceOf(event: BattleEvent): string | null {
  switch (event.kind) {
    case 'damage':
    case 'heal':
    case 'statusApplied':
      return event.sourceId;
    case 'defeated':
    case 'battleEnded':
      return null;
  }
}

/** Returns null for an event with nothing worth putting on screen. */
export function describeEvent(
  event: BattleEvent,
  actors: readonly Actor[],
): string | null {
  const nameOf = (id: string): string =>
    actors.find((a) => a.id === id)?.name ?? id;

  switch (event.kind) {
    case 'damage':
      return event.isCritical
        ? `CRITICAL! ${nameOf(event.targetId)} takes ${event.amount} damage!`
        : `${nameOf(event.targetId)} takes ${event.amount} damage.`;
    case 'heal':
      return `${nameOf(event.targetId)} recovers ${event.amount} HP.`;
    case 'statusApplied':
      return `${nameOf(event.targetId)} gains ${event.status.kind}.`;
    case 'defeated':
      return `${nameOf(event.actorId)} is defeated!`;
    case 'battleEnded':
      return event.outcome === 'victory' ? 'VICTORY' : 'DEFEAT';
  }
}
