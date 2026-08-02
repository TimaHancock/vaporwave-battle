import { describe, expect, it } from 'vitest';
import {
  CRITICAL_MULTIPLIER,
  FLASH_SECONDS,
  flashStrength,
  hasCritical,
  HIT_STOP_MS,
  hitStopFor,
  RECOIL_BASE,
  RECOIL_MAX,
  RECOIL_SECONDS,
  recoilDirection,
  recoilOffset,
  SHARDS_PER_HIT,
  shardCountFor,
} from './impact';
import { DAIS_FACETS, inscribedRadius } from './arena';
import { PLATFORM_RADIUS, PLATFORM_SAFE_RADIUS } from './spriteLayout';
import type { BattleEvent } from '../battle/types';

/**
 * Impact feel, asserted where it is cheap.
 *
 * Most of hit-stop can only be judged by playing it -- 70ms is either impact
 * or a dropped frame and no test can tell you which. What CAN be pinned down
 * is that the curves are shaped the way they claim, that nothing produces a
 * NaN, and that a recoil cannot throw a character somewhere the layout maths
 * spent effort keeping them out of.
 */

function damage(amount: number, isCritical = false): BattleEvent {
  return {
    kind: 'damage',
    sourceId: 'kira',
    targetId: 'apollyon',
    amount,
    isCritical,
  };
}

describe('hitStopFor', () => {
  it('does not freeze on a commit that landed nothing', () => {
    expect(hitStopFor([])).toBe(0);
    expect(
      hitStopFor([{ kind: 'heal', sourceId: 'lyra', targetId: 'kira', amount: 90 }]),
    ).toBe(0);
  });

  it('freezes ONCE for a commit that landed twice', () => {
    /* THE REASON IT TAKES A COMMIT. A freeze per event stacks the pauses into
       a stutter, which reads as the game hitching -- the exact opposite of
       what hit-stop is for. */
    expect(hitStopFor([damage(120), damage(140)])).toBe(HIT_STOP_MS);
  });

  it('holds longer when any hit in the commit was critical', () => {
    expect(hitStopFor([damage(120)])).toBe(HIT_STOP_MS);
    expect(hitStopFor([damage(300, true)])).toBe(HIT_STOP_MS * CRITICAL_MULTIPLIER);
    /* The longest wins, whatever order they landed in. */
    expect(hitStopFor([damage(120), damage(300, true)])).toBe(
      HIT_STOP_MS * CRITICAL_MULTIPLIER,
    );
    expect(hitStopFor([damage(300, true), damage(120)])).toBe(
      HIT_STOP_MS * CRITICAL_MULTIPLIER,
    );
  });

  it('is genuinely disabled at zero, not merely shortened', () => {
    /* `?hitStop=0` is what the screenshot harness and anyone who dislikes the
       effect will reach for. It has to mean off. */
    expect(hitStopFor([damage(300, true)], 0)).toBe(0);
  });

  it('refuses a nonsense duration rather than freezing forever', () => {
    /* This arrives from a URL parameter. A freeze of NaN milliseconds is a
       deadline that never passes and an interface that never resumes. */
    expect(hitStopFor([damage(120)], Number.NaN)).toBe(0);
    expect(hitStopFor([damage(120)], -50)).toBe(0);
  });
});

describe('recoilDirection', () => {
  it('throws the target away from whoever swung', () => {
    const attacker = { x: -2, y: 0, z: 0 };
    const victim = { x: 2.6, y: 0, z: 0 };
    expect(recoilDirection(attacker, victim)).toBe(1);
    expect(recoilDirection(victim, attacker)).toBe(-1);
  });

  it('derives the side from the positions, not from who is who', () => {
    /* The composition is party-left and boss-right, so in practice the party
       staggers left. Deriving it means re-laying out the cast cannot silently
       invert every recoil in the game. */
    expect(recoilDirection({ x: 3, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBe(-1);
  });

  it('still picks a side when the two coincide', () => {
    /* Normalising a zero vector gives NaN, and a NaN offset does not throw --
       it puts the sprite at nowhere and the character vanishes, which reads
       as a texture bug. */
    expect(recoilDirection({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(1);
    expect(recoilDirection({ x: -3, y: 0, z: 0 }, { x: -3, y: 0, z: 0 })).toBe(-1);
  });
});

describe('recoilOffset', () => {
  it('peaks the instant the blow lands', () => {
    /* A blow lands in one frame; the recovery is what takes time. Ramping up
       would read as leaning into the hit rather than being moved by it. */
    expect(recoilOffset(0)).toBe(RECOIL_BASE);
  });

  it('is home by the end, and stays there', () => {
    expect(recoilOffset(RECOIL_SECONDS)).toBe(0);
    expect(recoilOffset(RECOIL_SECONDS * 4)).toBe(0);
  });

  it('decays without ever turning back', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let age = 0; age <= RECOIL_SECONDS; age += RECOIL_SECONDS / 40) {
      const offset = recoilOffset(age);
      expect(offset, `age ${age.toFixed(3)}`).toBeLessThanOrEqual(previous);
      expect(offset).toBeGreaterThanOrEqual(0);
      previous = offset;
    }
  });

  it('never exceeds the amplitude it was given', () => {
    for (let age = -1; age <= RECOIL_SECONDS * 2; age += 0.01) {
      expect(recoilOffset(age, RECOIL_SECONDS, RECOIL_MAX)).toBeLessThanOrEqual(
        RECOIL_MAX,
      );
    }
  });

  it('returns a number for nonsense input', () => {
    expect(recoilOffset(Number.NaN)).toBe(0);
    expect(recoilOffset(0.1, 0)).toBe(0);
    expect(recoilOffset(0.1, Number.NaN)).toBe(0);
  });

  it('cannot throw a character off the deck', () => {
    /* THE ONE THAT MATTERS HERE. layoutParty and layoutBoss work to keep every
       character inside PLATFORM_SAFE_RADIUS, and bossPosition REJECTS a
       placement past the lip rather than clamping it. A recoil able to shove
       someone over the edge would undo all of that at the one moment anybody
       is looking at them -- and it would do it while their contact shadow
       stayed behind, which is the tell for a sprite standing on nothing. */
    expect(PLATFORM_SAFE_RADIUS + RECOIL_MAX).toBeLessThan(
      inscribedRadius(PLATFORM_RADIUS, DAIS_FACETS),
    );
  });
});

describe('flashStrength', () => {
  it('burns hardest at the moment of impact', () => {
    expect(flashStrength(0)).toBe(1);
  });

  it('is out by the end of its duration', () => {
    expect(flashStrength(FLASH_SECONDS)).toBe(0);
    expect(flashStrength(FLASH_SECONDS * 3)).toBe(0);
  });

  it('stays inside 0..1 throughout', () => {
    for (let age = -0.5; age <= FLASH_SECONDS * 2; age += 0.005) {
      const strength = flashStrength(age);
      expect(strength, `age ${age.toFixed(3)}`).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
    }
  });

  it('holds at full strength while the clock is held', () => {
    /* The neatest part of the feature. Hit-stop freezes the scene clock, so
       during a freeze `age` does not advance -- which pins the flash at full
       strength for exactly as long as the game is stopped and keeps the recoil
       from starting until it releases. Freeze first then move, with no
       sequencing anywhere. */
    expect(flashStrength(0)).toBe(1);
    expect(recoilOffset(0)).toBe(RECOIL_BASE);
  });

  it('returns a number for nonsense input', () => {
    expect(flashStrength(Number.NaN)).toBe(0);
    expect(flashStrength(0.05, 0)).toBe(0);
  });
});

describe('shardCountFor', () => {
  it('throws more debris off a critical', () => {
    /* A critical should differ in KIND, not only in degree: it freezes longer,
       washes the screen and comes apart more. */
    expect(shardCountFor(false)).toBe(SHARDS_PER_HIT);
    expect(shardCountFor(true)).toBe(SHARDS_PER_HIT * CRITICAL_MULTIPLIER);
  });
});

describe('hasCritical', () => {
  it('finds a critical anywhere in the commit', () => {
    expect(hasCritical([])).toBe(false);
    expect(hasCritical([damage(120)])).toBe(false);
    expect(hasCritical([damage(120), damage(300, true)])).toBe(true);
  });

  it('ignores everything that is not a landed blow', () => {
    /* The frame wash keys off this, and a wash on a heal would be nonsense. */
    expect(
      hasCritical([{ kind: 'heal', sourceId: 'lyra', targetId: 'kira', amount: 90 }]),
    ).toBe(false);
  });
});
