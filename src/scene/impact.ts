/**
 * Impact feel: hit-stop, recoil, the flash, the shake and how much a blow
 * throws off the character.
 *
 * Pure functions over numbers, no three.js and no DOM -- the same split
 * `arena.ts` and `mountains.ts` follow. `sprite.ts` and `battleScene.ts` apply
 * what comes out; `main.ts` owns the freeze itself, and `ui/screenEffects.ts`
 * turns the shake's numbers into keyframes.
 *
 * TWO CLOCKS RUN THROUGH THIS FILE, and which one an effect is on decides
 * which verification channel can see it. The recoil, the flash and the shard
 * burst are functions of age against the SCENE clock, so hit-stop freezes them
 * for free and `?time=` pins them at age 0 for a screenshot -- but they are
 * inert under the e2e suite, which halts that clock. The shake is a DOM
 * animation on real timers, so it is the opposite: unphotographable, and the
 * only one of the four an assertion can watch start and finish. Both facts are
 * used deliberately; see the notes on `shakeOffsets` and `shardCountFor`.
 *
 * WHAT HIT-STOP IS
 * ----------------
 * Freeze everything for a few frames at the moment a blow lands. The eye reads
 * the pause as force, and it is the cheapest piece of game feel there is --
 * every fighting game and most action games do it, and almost nothing else
 * gives that much weight for that little code.
 *
 * It is the TIMING half of impact, which is why it does not ship alone: a
 * freeze needs something to freeze. The recoil and the flash here are the
 * other half.
 *
 * EVERY CURVE IS A FUNCTION OF AGE, deliberately. The caller holds nothing but
 * "when did this start", which is what lets the freeze work by simply holding
 * the clock still -- see the note on `flashStrength`.
 */

import type { BattleEvent } from '../battle/types';
import type { Rng } from '../rng';
import type { Vec3 } from './spriteLayout';

/**
 * How long a normal hit freezes for, in milliseconds.
 *
 * SHORT. Hit-stop is measured in frames, not in beats: four frames at 60Hz is
 * about 66ms, and that is the range where a freeze reads as impact rather than
 * as the game having hitched. Overridable through `?hitStop=` for the same
 * reason `?floatMs=` exists -- so the harness can turn it off -- and because
 * this is the one number the whole feature turns on and it can only really be
 * judged by playing it.
 */
export const HIT_STOP_MS = 70;

/**
 * How much longer a critical holds, and how much harder it hits.
 *
 * This is most of why a critical READS as a critical in games that do this
 * well. The number on screen is already bigger and already a different colour;
 * what makes it land is that the game stops for longer to look at it.
 */
export const CRITICAL_MULTIPLIER = 2;

/** How long the recoil takes to play out and settle, in seconds. */
export const RECOIL_SECONDS = 0.26;

/** How long the flash lasts, in seconds. */
export const FLASH_SECONDS = 0.12;

/**
 * Furthest a recoil may throw a sprite, in world units.
 *
 * BOUNDED, and asserted against the deck rather than picked. `layoutParty`
 * works to keep every character inside `PLATFORM_SAFE_RADIUS`; a recoil that
 * could shove one past the lip would undo that at the only moment anybody is
 * looking at them. A test checks the sum against the deck's inscribed radius.
 *
 * Small in absolute terms. A flinch is a flinch -- at more than this the
 * character separates from the contact shadow it is standing on and reads as
 * sliding rather than reacting.
 */
export const RECOIL_MAX = 0.34;

/** Recoil distance for an ordinary hit. Criticals scale up toward RECOIL_MAX. */
export const RECOIL_BASE = RECOIL_MAX / CRITICAL_MULTIPLIER;

/**
 * How long a commit's worth of events should freeze the game for.
 *
 * TAKES THE WHOLE COMMIT, NOT ONE EVENT, and that is the point of the
 * signature. A single turn can land two damaging hits, and freezing once per
 * event stacks the pauses into a stutter -- which reads as a performance
 * problem, the exact opposite of the intended effect. One blow, one freeze,
 * for the longest of whatever landed.
 *
 * `baseMs` is threaded rather than read from the constant so `?hitStop=0`
 * genuinely disables the feature instead of merely shortening it.
 */
export function hitStopFor(
  events: readonly BattleEvent[],
  baseMs: number = HIT_STOP_MS,
): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;

  let longest = 0;
  for (const event of events) {
    if (event.kind !== 'damage') continue;
    const ms = event.isCritical ? baseMs * CRITICAL_MULTIPLIER : baseMs;
    longest = Math.max(longest, ms);
  }
  return longest;
}

/**
 * Which way a blow throws its target: -1 for screen-left, +1 for right.
 *
 * Away from whoever swung. The composition is party-left and boss-right, so in
 * practice the party staggers left and the boss staggers right -- but it is
 * derived from the two positions rather than from the sides, because deriving
 * it means a layout change cannot silently invert it.
 *
 * RETURNS A DIRECTION EVEN WHEN THE TWO COINCIDE. Normalising a zero vector
 * gives NaN, and a NaN offset does not throw -- it moves the sprite to nowhere
 * and the character simply disappears, which looks like a texture bug.
 */
export function recoilDirection(source: Vec3, target: Vec3): -1 | 1 {
  const dx = target.x - source.x;
  /* Ties break away from centre, so a self-inflicted or perfectly-stacked hit
     still pushes outward rather than picking a side by floating-point luck. */
  if (dx === 0) return target.x < 0 ? -1 : 1;
  return dx < 0 ? -1 : 1;
}

/**
 * How far a recoil has thrown the sprite, at a given age in seconds.
 *
 * Peaks instantly and eases home: a blow lands in one frame and the recovery
 * is what takes time. Ramping up would read as the character leaning into the
 * hit rather than being moved by it.
 *
 * Eased with a cubic so the return decelerates into rest -- a linear return
 * arrives and stops dead, which reads as a slide.
 */
export function recoilOffset(
  age: number,
  duration: number = RECOIL_SECONDS,
  amplitude: number = RECOIL_BASE,
): number {
  if (!Number.isFinite(age) || !Number.isFinite(duration) || duration <= 0) return 0;
  if (age <= 0) return amplitude;
  if (age >= duration) return 0;

  const remaining = 1 - age / duration;
  return amplitude * remaining * remaining * remaining;
}

/**
 * How hard the flash is burning, 0..1, at a given age in seconds.
 *
 * WHY THIS BEING A FUNCTION OF AGE MATTERS, and it is the neatest part of the
 * whole feature: hit-stop is implemented by holding the scene clock still. So
 * during a freeze `age` does not advance, which pins the flash at full
 * strength for exactly as long as the game is stopped and keeps the recoil
 * from starting until it releases. Freeze first, then move -- the order
 * hit-stop wants -- falls out of the clock with no sequencing at all.
 */
export function flashStrength(age: number, duration: number = FLASH_SECONDS): number {
  if (!Number.isFinite(age) || !Number.isFinite(duration) || duration <= 0) return 0;
  if (age <= 0) return 1;
  if (age >= duration) return 0;
  return 1 - age / duration;
}

/* ------------------------------------------------------------------ */
/* Screen shake                                                        */
/* ------------------------------------------------------------------ */

/**
 * How long a shake lasts, in milliseconds.
 *
 * Longer than the freeze and shorter than the recoil, which is the order the
 * three want: the game stops, the frame kicks, and the character is still
 * easing back to its mark after both have finished.
 */
export const SHAKE_MS = 180;

/**
 * Peak displacement for an ordinary hit, as a fraction of the VIEWPORT'S
 * HEIGHT rather than a pixel count.
 *
 * The composition is authored for 16:9 and the same fight is played at 720p
 * and at 4K; a shake fixed in pixels is a different-sized shake at each of
 * them. Height rather than width because the camera's fov is vertical, so
 * height is the axis the whole composition is already scaled against.
 *
 * SMALL. A screen shake is felt rather than seen, and past about 1.5% it stops
 * reading as impact and starts reading as the page having been dropped.
 */
export const SHAKE_FRACTION = 0.009;

/**
 * How many keyframes a shake is cut into.
 *
 * Few enough that each step is a distinct kick rather than a smooth wobble --
 * a shake interpolated finely is a pan, and a pan is what a camera move looks
 * like. Six steps over 180ms is one every 30ms, which is around two frames at
 * 60Hz.
 */
export const SHAKE_STEPS = 6;

/** One keyframe of a shake: a translation in px, plus the zoom that covers it. */
export interface ShakeStep {
  /** Horizontal displacement, in pixels. */
  x: number;
  /** Vertical displacement, in pixels. */
  y: number;
  /**
   * Uniform scale for this step, >= 1.
   *
   * NOT DECORATION, though it does read as punch. See `shakeOffsets`.
   */
  scale: number;
}

/**
 * How hard a commit's worth of events should shake the frame, in pixels.
 *
 * TAKES THE WHOLE COMMIT for the same reason `hitStopFor` does: two blows in
 * one turn are one shake at the strength of the larger, not two shakes in a
 * row, which reads as a stutter rather than as force.
 *
 * `viewportHeight` is what turns the fraction into pixels; `scale` is the
 * `?shake=` multiplier, so zero genuinely disables the effect rather than
 * merely shrinking it.
 */
export function shakeFor(
  events: readonly BattleEvent[],
  viewportHeight: number,
  scale = 1,
): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  if (!Number.isFinite(scale) || scale <= 0) return 0;

  let hardest = 0;
  for (const event of events) {
    if (event.kind !== 'damage') continue;
    hardest = Math.max(hardest, event.isCritical ? CRITICAL_MULTIPLIER : 1);
  }

  return hardest * SHAKE_FRACTION * viewportHeight * scale;
}

/**
 * The steps of one shake: a decaying random walk that ends at rest.
 *
 * RETURNS NUMBERS, NOT CSS. Keyframe strings are DOM vocabulary and this
 * module has none; `ui/screenEffects.ts` assembles them. That is also what
 * makes the bound below assertable in Vitest rather than in a browser.
 *
 * THE SCALE IS LOAD-BEARING, and it is the only non-obvious thing here.
 * `#stage` is `position: fixed; inset: 0`, so it is exactly the viewport --
 * translate it and a strip of page background is exposed along one edge, which
 * is a black band flickering at the edge of frame for a fifth of a second and
 * reads as a rendering fault rather than as impact. Zooming by enough to cover
 * the largest displacement means there is always bleed to move into. It
 * happens to be good juice as well; that is a bonus, not the reason.
 *
 * The step is seeded so a shake has variety between hits without reaching for
 * `Math.random()`, and the caller passes a generator off its OWN stream --
 * never the battle's, or adding a shake would reroll every seeded fight.
 */
export function shakeOffsets(
  rng: Rng,
  amplitude: number,
  steps: number = SHAKE_STEPS,
  viewportWidth = 1,
  viewportHeight = 1,
): readonly ShakeStep[] {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return [];
  if (!Number.isFinite(steps) || steps < 2) return [];

  const out: ShakeStep[] = [];

  for (let i = 0; i < steps; i++) {
    /* Linear decay to exactly zero on the last step. A shake that ends
       anywhere else leaves the scene permanently off its mark, which no test
       would catch and every subsequent frame would show. */
    const remaining = 1 - i / (steps - 1);
    const reach = amplitude * remaining;

    /* Full amplitude on the first step, in a random direction: a blow lands in
       one frame, so the kick is instant and everything after it is recovery --
       the same shape as `recoilOffset`. */
    const angle = rng.next() * Math.PI * 2;
    /* Zeroed explicitly on the final step rather than multiplied out to it:
       `Math.cos(angle) * 0` is -0 for half of all angles, and "the shake ends
       at exactly rest" is the one property here worth being able to assert
       without an epsilon. */
    const x = reach === 0 ? 0 : Math.cos(angle) * reach;
    const y = reach === 0 ? 0 : Math.sin(angle) * reach;

    out.push({ x, y, scale: coveringScale(x, y, viewportWidth, viewportHeight) });
  }

  return out;
}

/**
 * The smallest uniform scale that keeps a displaced fullscreen layer covering
 * the frame.
 *
 * Displacing by `x` uncovers `x` on one side, so the layer has to grow by `2x`
 * across to have that much to give -- hence the doubling. Taking the larger of
 * the two axes because the scale is uniform: a zoom that covers the vertical
 * displacement but not the horizontal one still shows an edge.
 */
function coveringScale(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const horizontal = viewportWidth > 0 ? (2 * Math.abs(x)) / viewportWidth : 0;
  const vertical = viewportHeight > 0 ? (2 * Math.abs(y)) / viewportHeight : 0;
  return 1 + Math.max(horizontal, vertical);
}

/* ------------------------------------------------------------------ */
/* Shard burst                                                         */
/* ------------------------------------------------------------------ */

/** Shards thrown by an ordinary hit. Criticals scale up from here. */
export const SHARDS_PER_HIT = 14;

/**
 * How many shards a blow throws off its target.
 *
 * A critical differs in KIND rather than only in degree -- it freezes longer,
 * shakes harder, washes the frame and throws more debris -- which is the whole
 * argument for hit-stop's `CRITICAL_MULTIPLIER` applied to one more thing.
 */
export function shardCountFor(isCritical: boolean): number {
  return isCritical ? SHARDS_PER_HIT * CRITICAL_MULTIPLIER : SHARDS_PER_HIT;
}

/** Whether a commit landed a critical -- what the frame wash keys off. */
export function hasCritical(events: readonly BattleEvent[]): boolean {
  return events.some((event) => event.kind === 'damage' && event.isCritical);
}
