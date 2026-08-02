/**
 * The frame wash a critical throws.
 *
 * WHY THIS IS A DOM ANIMATION AND THE REST OF THE IMPACT LAYER IS NOT
 * -------------------------------------------------------------------
 * The recoil, the sprite flash and the shard burst are functions of age
 * against the SCENE clock, which is what lets hit-stop freeze all three by
 * simply holding that clock still. This one could have been written the same
 * way and deliberately is not, because the scene clock has a second property:
 * `?time=` halts it, and every one of the ninety-odd e2e specs loads with
 * `?time=0`. An effect on that clock is unobservable to the whole suite.
 *
 * A Web Animations object runs on real timers regardless, so the wash can be
 * watched starting and -- far more importantly -- watched FINISHING. It also
 * costs nothing to freeze: `main.ts` already pauses everything under its
 * effect roots during hit-stop, so listing this layer there gives a wash held
 * lit for the length of the stop, with no sequencing written anywhere.
 *
 * A SCREEN SHAKE ALSO LIVED HERE AND WAS REMOVED. It is worth knowing it was
 * tried: it worked, it was bounded and it was tested, and it still did not
 * feel right in play -- the one verdict no channel here can return. See the
 * note at the top of scene/impact.ts for what made it structurally awkward.
 *
 * NO three.js AND NO BATTLE VOCABULARY IN HERE, the same fence `floatLayer.ts`
 * keeps. It takes numbers and elements.
 */

/**
 * How long a critical washes the frame, in milliseconds.
 *
 * Shorter than a shard's life and only a little longer than the freeze. It is
 * the first thing to arrive and the first thing gone -- a wash that outlasts
 * the stop reads as the screen having been recoloured rather than as a blow
 * landing.
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

  /* Cancel rather than let them stack. Two washes compositing produce an
     opacity neither asked for, and a second critical should restart the
     effect, not deepen it. */
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
      /* No fill, so a dropped frame cannot leave a permanent tint over the
         game -- the element returns to its stylesheet opacity of 0. */
      fill: 'none',
    },
  );
}
