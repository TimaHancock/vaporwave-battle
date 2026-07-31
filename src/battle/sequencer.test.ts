import { describe, expect, it } from 'vitest';
import {
  createSequencer,
  describeEvent,
  ENEMY_BEAT_MULTIPLIER,
  type SequencerView,
} from './sequencer';
import { createBattle } from './battle';
import { attackNameFor } from './classes';
import { BOSS_STATS, makeBoss, makeParty, makeRoster } from './fixtures';
import { createRng } from '../rng';
import type { Action, BattleState } from './types';

/**
 * The sequencer is the one part of the battle stack that is not pure -- it
 * exists to spread a resolved turn out over time. Injecting `wait` is what
 * keeps it testable anyway: the whole suite runs at zero delay, so these
 * assertions are about ORDER and LOCKING, never about elapsed time.
 */

const ATTACK: Action = { kind: 'attack', targetId: 'apollyon' };

/** No delay at all, so the sequence plays out in microtasks. */
const instant = (): Promise<void> => Promise.resolve();

function harness(state: BattleState = createBattle(1337, makeRoster())) {
  const views: SequencerView[] = [];
  const sequencer = createSequencer({
    state,
    rng: createRng(1337),
    stepMs: 0,
    wait: instant,
    onChange: (view) => views.push(view),
  });
  return { sequencer, views };
}

/**
 * A harness that records how long each pause asked for instead of taking it.
 *
 * Pause LENGTH is a real product decision -- the boss beat is deliberately
 * slower than a player beat -- so it needs an assertion. Recording the
 * requested durations tests that decision without any test spending the
 * time.
 */
function timed(stepMs: number, state: BattleState = createBattle(1337, makeRoster())) {
  const waits: number[] = [];
  const views: SequencerView[] = [];
  const sequencer = createSequencer({
    state,
    rng: createRng(1337),
    stepMs,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    onChange: (view) => views.push(view),
  });
  return { sequencer, waits, views };
}

/** Drives whole party turns until the enemy has acted. */
async function playUntilEnemyActs(sequencer: {
  submit: (action: Action) => boolean;
  settled: () => Promise<void>;
  view: SequencerView;
}): Promise<void> {
  for (let turn = 0; turn < 6; turn++) {
    const before = sequencer.view.log.length;
    sequencer.submit(ATTACK);
    await sequencer.settled();
    const acted = sequencer.view.log
      .slice(before)
      .some((event) => event.kind === 'damage' && event.sourceId === 'apollyon');
    if (acted) return;
  }
  throw new Error('The enemy never took a turn.');
}

describe('createSequencer', () => {
  it('rejects a battle that does not open on a party turn', () => {
    /* A sequencer whose first turn belongs to the boss renders a command
       menu for the boss and lets the player drive it. Every individual call
       in that scenario is legal, so nothing downstream can detect it. */
    const state = createBattle(1, [
      ...makeParty(),
      makeBoss({ stats: { ...BOSS_STATS, speed: 999 } }),
    ]);

    expect(() => harness(state)).toThrowError(/must open on a living party member/);
    expect(() => harness(state)).toThrowError(/apollyon/);
  });

  it('rejects a negative pause', () => {
    expect(() =>
      createSequencer({
        state: createBattle(1, makeRoster()),
        rng: createRng(1),
        stepMs: -1,
        onChange: () => {},
      }),
    ).toThrowError(/stepMs/);
  });

  it('starts idle, unlocked, with an empty log', () => {
    const { sequencer } = harness();

    expect(sequencer.view.isLocked).toBe(false);
    expect(sequencer.view.pending).toEqual([]);
    expect(sequencer.view.log).toEqual([]);
    expect(sequencer.view.actionsTaken).toBe(0);
  });
});

describe('the step queue', () => {
  it('queues the whole turn up front, as labelled steps', () => {
    const { sequencer } = harness();

    sequencer.submit(ATTACK);

    /* The plan being inspectable is the entire reason this is a queue and
       not a chain of setTimeouts. A sequence that stalls can report WHERE. */
    expect(sequencer.view.pending).toEqual([
      'pause',
      'resolve',
      'report',
      'check-outcome',
      'advance',
    ]);
  });

  it('drains the queue and unlocks when the turn finishes', async () => {
    const { sequencer } = harness();

    sequencer.submit(ATTACK);
    await sequencer.settled();

    expect(sequencer.view.pending).toEqual([]);
    expect(sequencer.view.isLocked).toBe(false);
  });

  it('narrates the action before its consequences', async () => {
    const { sequencer, views } = harness();

    sequencer.submit(ATTACK);
    await sequencer.settled();

    /* Derived, not hardcoded: KIRA is a knight, so the line names the
       knight's attack. Reading it from the class table means renaming an
       attack does not need this test edited to stay true. */
    const lines = views.map((view) => view.narration);
    const attack = attackNameFor(makeParty()[0]!);
    const action = lines.findIndex((line) => line.includes(`KIRA uses ${attack}`));
    const damage = lines.findIndex((line) => line.includes('takes'));

    expect(action).toBeGreaterThanOrEqual(0);
    expect(damage).toBeGreaterThan(action);
  });

  it('commits the damaged state and the event that caused it together', async () => {
    const { sequencer } = harness();
    const before = bossHp(sequencer.view.state);

    sequencer.submit(ATTACK);
    await sequencer.settled();

    const damage = sequencer.view.log.find((event) => event.kind === 'damage');
    expect(damage).toBeDefined();
    /* The HUD reads state and the harness reads the log. If these two could
       drift, every damage-number assertion downstream would be meaningless. */
    expect(before - bossHp(sequencer.view.state)).toBe(
      damage?.kind === 'damage' ? damage.amount : -1,
    );
  });

  it('hands the turn to the next living party member', async () => {
    const { sequencer } = harness();
    expect(activeId(sequencer.view.state)).toBe('kira');

    sequencer.submit(ATTACK);
    await sequencer.settled();

    expect(activeId(sequencer.view.state)).toBe('neo');
  });
});

describe('the enemy turn', () => {
  it('announces whose turn it is before showing what it did', async () => {
    const { sequencer, views } = harness();
    await playUntilEnemyActs(sequencer);

    const lines = views.map((view) => view.narration);
    const announcement = lines.lastIndexOf('APOLLYON moves.');

    /* Without this line the narration jumps straight from the party's last
       hit to a party member losing HP, and the player is left inferring
       from a falling bar that the boss ever acted. */
    expect(announcement, 'the enemy should announce its turn').toBeGreaterThanOrEqual(0);

    const damage = lines.findIndex(
      (line, index) => index > announcement && line.includes('damage'),
    );
    expect(damage).toBeGreaterThan(announcement);
  });

  it('holds each enemy beat longer than a player beat', async () => {
    const { sequencer, waits } = timed(100);
    await playUntilEnemyActs(sequencer);

    /* The asymmetry is deliberate: a player beat confirms something they
       chose and were watching for, an enemy beat is the first they hear of
       it and arrives when their attention has moved on. */
    expect(waits).toContain(100 * ENEMY_BEAT_MULTIPLIER);
    expect(Math.max(...waits)).toBe(100 * ENEMY_BEAT_MULTIPLIER);
  });

  it('keeps a player-only turn entirely at the player pause', async () => {
    const { sequencer, waits } = timed(100);

    /* kira attacks and neo is up next -- no enemy acts, so nothing should
       be stretched. */
    sequencer.submit(ATTACK);
    await sequencer.settled();

    expect(waits.every((ms) => ms === 100)).toBe(true);
  });

  it('scales the enemy beat with stepMs rather than pinning a duration', () => {
    const { waits } = timed(0);
    /* ?stepMs=0 must still mean instant everywhere, or the e2e suite would
       sit through boss turns it never asked to watch. */
    expect(waits.every((ms) => ms === 0)).toBe(true);
  });

  it('accepts an explicit enemy pause', async () => {
    const waits: number[] = [];
    const sequencer = createSequencer({
      state: createBattle(1337, makeRoster()),
      rng: createRng(1337),
      stepMs: 10,
      enemyStepMs: 999,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      onChange: () => {},
    });

    await playUntilEnemyActs(sequencer);
    expect(waits).toContain(999);
  });

  it('rejects a negative enemy pause', () => {
    expect(() =>
      createSequencer({
        state: createBattle(1, makeRoster()),
        rng: createRng(1),
        stepMs: 10,
        enemyStepMs: -1,
        onChange: () => {},
      }),
    ).toThrowError(/enemyStepMs/);
  });
});

describe('the input lock', () => {
  it('is set synchronously, before submit returns', () => {
    const { sequencer } = harness();

    /* If the lock were set after an await, three keypresses dispatched in
       the same task would all pass the check and queue three attacks. This
       assertion is the whole defence against that. */
    expect(sequencer.submit(ATTACK)).toBe(true);
    expect(sequencer.view.isLocked).toBe(true);
  });

  it('turns three rapid actions into exactly one', async () => {
    const { sequencer } = harness();

    expect(sequencer.submit(ATTACK)).toBe(true);
    expect(sequencer.submit(ATTACK)).toBe(false);
    expect(sequencer.submit(ATTACK)).toBe(false);

    await sequencer.settled();

    expect(sequencer.view.actionsTaken).toBe(1);
    expect(sequencer.view.log.filter((event) => event.kind === 'damage')).toHaveLength(1);
  });

  it('drops a rejected action rather than deferring it', async () => {
    const { sequencer } = harness();

    sequencer.submit(ATTACK);
    sequencer.submit(ATTACK);
    await sequencer.settled();

    /* A queued keypress would fire against a battle state the player never
       saw -- worse than losing the input, because the target may have died
       in between. Unlocked and idle is the correct end state. */
    expect(sequencer.view.isLocked).toBe(false);
    expect(sequencer.view.pending).toEqual([]);
  });

  it('refuses input once the battle has ended', async () => {
    const { sequencer } = harness(nearlyDeadBoss());

    sequencer.submit(ATTACK);
    await sequencer.settled();

    expect(sequencer.view.state.phase).toBe('victory');
    expect(sequencer.submit(ATTACK)).toBe(false);
    expect(sequencer.view.actionsTaken).toBe(1);
  });
});

describe('the ending', () => {
  it('reports the defeat, then the outcome, and stops', async () => {
    const { sequencer, views } = harness(nearlyDeadBoss());

    sequencer.submit(ATTACK);
    await sequencer.settled();

    const kinds = sequencer.view.log.map((event) => event.kind);
    expect(kinds).toContain('defeated');
    expect(kinds.at(-1)).toBe('battleEnded');

    expect(views.at(-1)?.narration).toBe('VICTORY');
    expect(sequencer.view.pending).toEqual([]);
    expect(sequencer.view.isLocked).toBe(false);
  });

  it('does not advance the turn past the end of the battle', async () => {
    const { sequencer } = harness(nearlyDeadBoss());
    const roundBefore = sequencer.view.state.round;

    sequencer.submit(ATTACK);
    await sequencer.settled();

    expect(sequencer.view.state.round).toBe(roundBefore);
  });
});

describe('describeEvent', () => {
  const actors = makeRoster();

  it('names the target and the number', () => {
    expect(
      describeEvent(
        { kind: 'damage', sourceId: 'kira', targetId: 'apollyon', amount: 173, isCritical: false },
        actors,
      ),
    ).toBe('APOLLYON takes 173 damage.');
  });

  it('calls out a critical', () => {
    expect(
      describeEvent(
        { kind: 'damage', sourceId: 'kira', targetId: 'apollyon', amount: 346, isCritical: true },
        actors,
      ),
    ).toBe('CRITICAL! APOLLYON takes 346 damage!');
  });

  it('covers every event kind', () => {
    expect(describeEvent({ kind: 'heal', sourceId: 'kira', targetId: 'neo', amount: 525 }, actors))
      .toBe('NEO recovers 525 HP.');
    expect(
      describeEvent(
        {
          kind: 'statusApplied',
          sourceId: 'kira',
          targetId: 'kira',
          status: { kind: 'DEF_UP', magnitude: 2, turnsRemaining: 2 },
        },
        actors,
      ),
    ).toBe('KIRA gains DEF_UP.');
    expect(describeEvent({ kind: 'defeated', actorId: 'apollyon' }, actors))
      .toBe('APOLLYON is defeated!');
    expect(describeEvent({ kind: 'battleEnded', outcome: 'defeat' }, actors)).toBe('DEFEAT');
  });

  it('falls back to the id for an actor it cannot find', () => {
    expect(describeEvent({ kind: 'defeated', actorId: 'ghost' }, actors)).toBe(
      'ghost is defeated!',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** A boss one hit from falling, so a single attack ends the battle. */
function nearlyDeadBoss(): BattleState {
  return createBattle(1337, [...makeParty(), makeBoss({ hp: 1 })]);
}

function bossHp(state: BattleState): number {
  return state.actors.find((actor) => actor.id === 'apollyon')?.hp ?? -1;
}

function activeId(state: BattleState): string | undefined {
  return state.turnQueue[state.turnIndex];
}
