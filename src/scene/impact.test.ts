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
  SHAKE_FRACTION,
  SHAKE_STEPS,
  shakeFor,
  shakeOffsets,
  SHARDS_PER_HIT,
  shardCountFor,
} from './impact';
import { DAIS_FACETS, inscribedRadius } from './arena';
import { PLATFORM_RADIUS, PLATFORM_SAFE_RADIUS } from './spriteLayout';
import { createRng } from '../rng';
import type { BattleEvent } from '../battle/types';

/** The frame the composition is authored for, and the one the e2e suite pins. */
const FRAME = { width: 1280, height: 720 };

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

describe('shakeFor', () => {
  it('does not shake on a commit that landed nothing', () => {
    expect(shakeFor([], FRAME.height)).toBe(0);
    expect(
      shakeFor(
        [{ kind: 'heal', sourceId: 'lyra', targetId: 'kira', amount: 90 }],
        FRAME.height,
      ),
    ).toBe(0);
  });

  it('shakes ONCE for a commit that landed twice', () => {
    /* Same argument as hitStopFor. Two kicks back to back read as a stutter,
       which is the frame rate dropping, not a blow landing. */
    const one = shakeFor([damage(120)], FRAME.height);
    expect(shakeFor([damage(120), damage(140)], FRAME.height)).toBe(one);
  });

  it('kicks harder when any hit in the commit was critical', () => {
    const ordinary = shakeFor([damage(120)], FRAME.height);
    expect(shakeFor([damage(300, true)], FRAME.height)).toBe(
      ordinary * CRITICAL_MULTIPLIER,
    );
    /* Whichever order they landed in. */
    expect(shakeFor([damage(120), damage(300, true)], FRAME.height)).toBe(
      ordinary * CRITICAL_MULTIPLIER,
    );
    expect(shakeFor([damage(300, true), damage(120)], FRAME.height)).toBe(
      ordinary * CRITICAL_MULTIPLIER,
    );
  });

  it('scales with the viewport rather than being a pixel count', () => {
    /* The same fight is played at 720p and at 4K, and a shake fixed in pixels
       is a different shake at each. */
    expect(shakeFor([damage(120)], 720)).toBeCloseTo(720 * SHAKE_FRACTION, 10);
    expect(shakeFor([damage(120)], 1440)).toBeCloseTo(1440 * SHAKE_FRACTION, 10);
  });

  it('is genuinely disabled at zero, not merely shrunk', () => {
    /* `?shake=0` is what anyone who dislikes the effect will reach for. */
    expect(shakeFor([damage(300, true)], FRAME.height, 0)).toBe(0);
  });

  it('refuses a nonsense scale or viewport rather than producing NaN', () => {
    /* The scale arrives from a URL parameter and the height from the window.
       A NaN here becomes a `translate(NaNpx)`, which the browser drops
       silently -- so the shake would simply stop working with no error. */
    expect(shakeFor([damage(120)], FRAME.height, Number.NaN)).toBe(0);
    expect(shakeFor([damage(120)], Number.NaN)).toBe(0);
    expect(shakeFor([damage(120)], 0)).toBe(0);
    expect(shakeFor([damage(120)], FRAME.height, -2)).toBe(0);
  });
});

describe('shakeOffsets', () => {
  const amplitude = shakeFor([damage(300, true)], FRAME.height);

  function steps() {
    return shakeOffsets(
      createRng(1337),
      amplitude,
      SHAKE_STEPS,
      FRAME.width,
      FRAME.height,
    );
  }

  it('ends at rest', () => {
    /* THE ONE THAT MATTERS. A shake that ends anywhere but zero leaves the
       scene permanently off its mark -- and because the last keyframe becomes
       the resting style, nothing afterwards would ever put it back. Every
       frame of the rest of the fight would be shifted, and no other channel
       would call it a bug. */
    const last = steps().at(-1);
    expect(last).toBeDefined();
    expect(last!.x).toBe(0);
    expect(last!.y).toBe(0);
    expect(last!.scale).toBe(1);
  });

  it('kicks hardest first and decays without turning back', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const [index, step] of steps().entries()) {
      const reach = Math.hypot(step.x, step.y);
      expect(reach, `step ${index}`).toBeLessThanOrEqual(previous + 1e-9);
      previous = reach;
    }
    expect(Math.hypot(steps()[0]!.x, steps()[0]!.y)).toBeCloseTo(amplitude, 6);
  });

  it('never exceeds the amplitude it was given', () => {
    for (const step of steps()) {
      expect(Math.hypot(step.x, step.y)).toBeLessThanOrEqual(amplitude + 1e-9);
    }
  });

  it('always zooms enough to cover its own displacement', () => {
    /* THE ASSERTION THAT SAYS NO FRAME EDGE CAN BE EXPOSED. #stage is
       `position: fixed; inset: 0`, so it is exactly the viewport -- translate
       it without growing it and a strip of page background shows along one
       edge. A black band flickering at the edge of frame for a fifth of a
       second reads as a rendering fault, not as impact. */
    for (const step of steps()) {
      const grownWidth = FRAME.width * step.scale;
      const grownHeight = FRAME.height * step.scale;
      const spareX = (grownWidth - FRAME.width) / 2;
      const spareY = (grownHeight - FRAME.height) / 2;
      expect(Math.abs(step.x)).toBeLessThanOrEqual(spareX + 1e-9);
      expect(Math.abs(step.y)).toBeLessThanOrEqual(spareY + 1e-9);
    }
  });

  it('is the same shake for the same seed', () => {
    expect(steps()).toEqual(steps());
    expect(
      shakeOffsets(createRng(9), amplitude, SHAKE_STEPS, FRAME.width, FRAME.height),
    ).not.toEqual(steps());
  });

  it('produces nothing rather than a broken animation for nonsense input', () => {
    expect(shakeOffsets(createRng(1), 0)).toEqual([]);
    expect(shakeOffsets(createRng(1), Number.NaN)).toEqual([]);
    expect(shakeOffsets(createRng(1), 10, 1)).toEqual([]);
  });
});

describe('shardCountFor', () => {
  it('throws more debris off a critical', () => {
    /* A critical should differ in KIND, not only in degree: it freezes longer,
       kicks the frame harder, washes the screen and comes apart more. */
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
