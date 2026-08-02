/**
 * Impact feel: hit-stop, recoil, the flash and how much a blow throws off the
 * character.
 *
 * Pure functions over numbers, no three.js and no DOM -- the same split
 * `arena.ts` and `mountains.ts` follow. `sprite.ts` and `battleScene.ts` apply
 * what comes out; `main.ts` owns the freeze itself.
 *
 * A SCREEN SHAKE LIVED HERE AND WAS REMOVED. It worked, it was bounded, and it
 * was tested; it simply did not feel right in play, which is the one verdict
 * none of the four channels can return and the only one that decides a
 * question like this. If it ever comes back, the thing that made it awkward
 * was structural rather than a number: the canvas is `position: fixed; inset:
 * 0`, so any displacement exposes page background at the frame edge and has to
 * be paid for with a zoom, and a zoom under a locked camera is a second camera
 * move nobody asked for.
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
/* Shard burst                                                         */
/* ------------------------------------------------------------------ */

/** Shards thrown by an ordinary hit. Criticals scale up from here. */
export const SHARDS_PER_HIT = 14;

/**
 * How many shards a blow throws off its target.
 *
 * A critical differs in KIND rather than only in degree -- it freezes longer,
 * washes the frame and throws more debris -- which is the whole argument for
 * hit-stop's `CRITICAL_MULTIPLIER` applied to one more thing.
 */
export function shardCountFor(isCritical: boolean): number {
  return isCritical ? SHARDS_PER_HIT * CRITICAL_MULTIPLIER : SHARDS_PER_HIT;
}

/** Whether a commit landed a critical -- what the frame wash keys off. */
export function hasCritical(events: readonly BattleEvent[]): boolean {
  return events.some((event) => event.kind === 'damage' && event.isCritical);
}
