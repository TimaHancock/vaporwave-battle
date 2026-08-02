/**
 * The two impact effects that live on the page rather than in the scene: the
 * screen shake, and the frame wash a critical throws.
 *
 * WHY THESE ARE DOM ANIMATIONS AND THE OTHERS ARE NOT
 * ---------------------------------------------------
 * The recoil, the sprite flash and the shard burst are functions of age
 * against the SCENE clock, which is what lets hit-stop freeze all three by
 * simply holding that clock still. These two could have been written the same
 * way and deliberately are not, because the scene clock has a second property:
 * `?time=` halts it, and every one of the ninety-odd e2e specs loads with
 * `?time=0`. An effect on that clock is unobservable to the whole suite.
 *
 * A Web Animations object runs on real timers regardless, so a shake can be
 * watched starting and -- far more importantly -- watched FINISHING. It also
 * costs nothing to freeze: `main.ts` already pauses everything under its
 * effect roots during hit-stop, so adding the canvas and this layer to that
 * walk gives freeze-then-shake with no sequencing at all.
 *
 * The trade is that neither is photographable. That is the right way round:
 * a still of a shaken frame is a displaced crop, which shows nothing a still
 * of an un-shaken frame does not.
 *
 * NO three.js AND NO BATTLE VOCABULARY IN HERE, the same fence `floatLayer.ts`
 * keeps. It takes numbers and elements.
 */

import type { ShakeStep } from '../scene/impact';

/* ------------------------------------------------------------------ */
/* Screen shake                                                        */
/* ------------------------------------------------------------------ */

/**
 * Kick an element and let it settle.
 *
 * THE CANVAS, AND NOTHING ELSE. The HUD and the float layer are the frame the
 * game is seen through, and the frame does not shake -- a player reading a
 * damage number should not have to track it. It also means no measurement in
 * the e2e suite moves: the float clearance specs measure `#floats` against
 * `#hud`, and a seven-pixel displacement of either would land inside those
 * assertions rather than beside them.
 *
 * THE LAST STEP IS THE RESTING STYLE, which is why `shakeOffsets` guarantees
 * it is exactly zero. `fill` is left at its default of `none`, so the element
 * returns to its stylesheet transform when the animation finishes -- there is
 * nothing to clean up and nothing that can leave the scene permanently off its
 * mark if a frame is dropped.
 *
 * A second hit REPLACES the shake rather than layering onto it. Two decaying
 * walks composited together produce a bigger displacement than either asked
 * for, which is how a shake escapes the bound its own zoom was sized to cover.
 */
export function shakeElement(
  element: Element,
  steps: readonly ShakeStep[],
  durationMs: number,
): Animation | null {
  if (steps.length === 0 || durationMs <= 0) return null;
  if (element.animate === undefined) return null;

  /* Cancel rather than let them stack. `getAnimations` on the element finds
     only what we put there -- the canvas has no other animations -- so this
     cannot cancel something else's work. */
  for (const existing of element.getAnimations()) existing.cancel();

  const keyframes = steps.map((step) => ({
    transform:
      `translate(${step.x.toFixed(3)}px, ${step.y.toFixed(3)}px) ` +
      `scale(${step.scale.toFixed(5)})`,
  }));

  return element.animate(keyframes, {
    duration: durationMs,
    /* Stepped rather than eased. Interpolating smoothly between the keyframes
       turns a series of kicks into a pan, and a pan is what a camera MOVE
       looks like -- the one thing this scene's locked camera never does. */
    easing: 'steps(1, end)',
    fill: 'none',
  });
}

/* ------------------------------------------------------------------ */
/* Frame wash                                                          */
/* ------------------------------------------------------------------ */

/**
 * How long a critical washes the frame, in milliseconds.
 *
 * Shorter than the shake and much shorter than a shard's life. It is the first
 * thing to arrive and the first thing gone -- a wash that outlasts the freeze
 * reads as the screen having been recoloured rather than as a blow landing.
 */
export const FLASH_MS = 90;

/**
 * Wash the frame.
 *
 * CRITICALS ONLY, and that is a tuning decision rather than a technical one.
 * A turn-based fight lands several blows a turn; a full-frame flash on each
 * one is exhausting within a minute. A critical is roughly one hit in six,
 * which is rare enough that the frame reacting to it stays an event.
 *
 * The element it runs on sits BETWEEN the canvas and the HUD -- see the note
 * on `#flash` in index.html. Over the scene, so the wash is part of the
 * picture; under the interface, so it never makes a card unreadable at the
 * moment the player is reading one.
 */
export function flashFrame(element: Element, durationMs = FLASH_MS): Animation | null {
  if (durationMs <= 0) return null;
  if (element.animate === undefined) return null;

  for (const existing of element.getAnimations()) existing.cancel();

  return element.animate(
    [
      /*
       * FULL STRENGTH ON THE FIRST FRAME, and this is the one thing here that
       * was got wrong first time round. Ramping in over the opening fifth
       * looks reasonable written down and is wrong in a game with hit-stop:
       * the freeze starts on the same tick as the wash and pauses it, so a
       * wash that has not arrived yet is held at nothing for the whole stop
       * and only appears as the game resumes -- an accent on the release
       * rather than on the blow.
       *
       * Peaking immediately means the freeze holds the frame LIT, which is
       * what the frozen frame is for. It is also the only reason the effect
       * can be photographed at all; see the `critical` shot.
       */
      { opacity: 1 },
      { opacity: 0 },
    ],
    {
      duration: durationMs,
      easing: 'ease-out',
      fill: 'none',
    },
  );
}
