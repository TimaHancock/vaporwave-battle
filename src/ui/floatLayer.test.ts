import { describe, expect, it } from 'vitest';
import { CHAIN_VISIBLE_FROM, floatTargetOf, presentEvent } from './floatLayer';
import type { BattleEvent } from '../battle/types';

/**
 * The presentation table only. `createFloatLayer` needs a DOM and Vitest runs
 * in `node` here, so the browser half is Playwright's -- which is the same
 * split `toHudModel` and `renderHud` already follow.
 *
 * These assertions are the contract the e2e suite reads through: a testid, a
 * textContent, and a data-kind. Getting them wrong is not a rendering bug, it
 * is a bug in what the number SAYS.
 */

const damage = (amount: number, isCritical = false): BattleEvent => ({
  kind: 'damage',
  sourceId: 'kira',
  targetId: 'apollyon',
  amount,
  isCritical,
});

describe('presentEvent', () => {
  it('shows a damage amount as a bare number', () => {
    expect(presentEvent(damage(145))).toEqual({
      testid: 'damage-number',
      text: '145',
      kind: 'damage',
    });
  });

  it('marks a critical without changing what it says', () => {
    const shown = presentEvent(damage(312, true));

    /* Same testid and same text -- a crit is still the damage it dealt. Only
       the kind differs, and the CSS reads that. A test asserting on the
       number must not have to know whether it crit. */
    expect(shown?.testid).toBe('damage-number');
    expect(shown?.text).toBe('312');
    expect(shown?.kind).toBe('critical');
  });

  it('signs a heal, because colour alone cannot carry the direction', () => {
    const event: BattleEvent = {
      kind: 'heal',
      sourceId: 'lyra',
      targetId: 'kira',
      amount: 90,
    };

    expect(presentEvent(event)).toEqual({
      testid: 'heal-number',
      text: '+90',
      kind: 'heal',
    });
  });

  it('names a status and carries its kind for the glyph', () => {
    const event: BattleEvent = {
      kind: 'statusApplied',
      sourceId: 'kira',
      targetId: 'kira',
      status: { kind: 'DEF_UP', turnsRemaining: 2, magnitude: 1.5 },
    };

    /* textContent is exactly the status name. The glyph is a ::before in the
       stylesheet, the same arrangement the card badges use, so this stays
       assertable as `DEF_UP`. */
    expect(presentEvent(event)).toEqual({
      testid: 'status-popup',
      text: 'DEF_UP',
      kind: 'status',
      status: 'DEF_UP',
    });
  });

  it('shows nothing for events with no number', () => {
    /* Both are narrated in the action log. A "DEFEATED" flying off a sprite
       that is in the act of falling over is noise on top of noise. */
    expect(presentEvent({ kind: 'defeated', actorId: 'apollyon' })).toBeNull();
    expect(
      presentEvent({ kind: 'battleEnded', outcome: 'victory' }),
    ).toBeNull();
  });
});

describe('floatTargetOf', () => {
  it('points at whoever the event happened to', () => {
    expect(floatTargetOf(damage(10))).toBe('apollyon');
    expect(
      floatTargetOf({ kind: 'heal', sourceId: 'lyra', targetId: 'vex', amount: 5 }),
    ).toBe('vex');
    expect(
      floatTargetOf({
        kind: 'statusApplied',
        sourceId: 'neo',
        targetId: 'neo',
        status: { kind: 'HASTE', turnsRemaining: 3, magnitude: 1.3 },
      }),
    ).toBe('neo');
  });

  it('returns null for events that belong to nobody on screen', () => {
    expect(floatTargetOf({ kind: 'battleEnded', outcome: 'defeat' })).toBeNull();
  });

  it('agrees with presentEvent about which events are shown', () => {
    /* The two switches must not drift: an event that presents but has no
       target would be spawned at the wrong place, and one that has a target
       but does not present is a silent no-op. `defeated` is deliberately in
       neither. */
    const events: BattleEvent[] = [
      damage(1),
      { kind: 'heal', sourceId: 'lyra', targetId: 'kira', amount: 1 },
      {
        kind: 'statusApplied',
        sourceId: 'kira',
        targetId: 'kira',
        status: { kind: 'ATK_UP', turnsRemaining: 1, magnitude: 1.25 },
      },
      { kind: 'defeated', actorId: 'vex' },
      { kind: 'battleEnded', outcome: 'victory' },
    ];

    for (const event of events) {
      expect(
        presentEvent(event) === null,
        `${event.kind} presents and targets together`,
      ).toBe(floatTargetOf(event) === null);
    }
  });
});

describe('the chain counter threshold', () => {
  it('starts at two, because a chain of one is just a hit', () => {
    expect(CHAIN_VISIBLE_FROM).toBe(2);
  });
});
