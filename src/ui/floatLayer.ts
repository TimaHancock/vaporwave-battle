/**
 * Floating combat numbers, and the chain counter.
 *
 * A hit used to move an HP bar and write a line in the action log, and do
 * nothing at all where the character actually is -- which is the half of the
 * screen the player is looking at. This is the layer that puts the number on
 * the character.
 *
 * WHY THIS IS NOT PART OF renderHud
 * ---------------------------------
 * `renderHud` is a pure function of `HudModel`: render the same model twice
 * and you get the same HUD, which is exactly the property that makes it safe
 * to call on every keypress. A damage number is the opposite kind of thing.
 * It fires once, on a transition, and there is no state to re-derive it from
 * -- 145 damage having been dealt is not visible in the state afterwards,
 * only in the event that caused it. Driving it from the model would re-spawn
 * every number on every refresh.
 *
 * So this layer is fed by EVENTS (`spawn`) and, for the one piece that really
 * is state, by a value (`setChain`). `BattleEvent` exists for precisely this;
 * see the comment above it in battle/types.ts.
 *
 * NO three.js IN HERE. It takes anchors already projected to normalised
 * screen coordinates, which keeps `ui/` free of the scene the same way
 * `ui/portraits.ts` is. `main.ts` owns the projection because `main.ts` is
 * the only place that has both a sprite and a camera.
 */

import type { BattleEvent, StatusKind } from '../battle/types';

/**
 * Normalised screen position, 0..1, +Y DOWN.
 *
 * The same convention `CharacterSprite.headScreenPosition` returns, chosen
 * there so it maps straight onto a CSS percentage with no arithmetic in
 * between.
 */
export interface Anchor {
  x: number;
  y: number;
}

/** How a float presents itself. Pure data, so Vitest can check it. */
export interface FloatPresentation {
  /** The testid this element carries. */
  testid: string;
  /** Exactly what lands in textContent -- what a test asserts on. */
  text: string;
  /** Drives the CSS. */
  kind: 'damage' | 'critical' | 'heal' | 'status';
  /** Only set for a status pop-up, which picks its glyph from it. */
  status?: StatusKind;
}

/**
 * What a `BattleEvent` looks like on screen, or null for events that have no
 * number to show.
 *
 * PURE, AND EXPORTED, so the table lives under Vitest rather than only under
 * a browser. `defeated` and `battleEnded` return null: they are narrated in
 * the action log and a floating "DEFEATED" over a sprite that is about to
 * stop existing is noise.
 *
 * `damage-number` is spelled out rather than derived because it is a contract
 * with the test suite -- see the testid note in CLAUDE.md. Heals and statuses
 * get honest names of their own instead of pretending to be damage.
 */
export function presentEvent(event: BattleEvent): FloatPresentation | null {
  switch (event.kind) {
    case 'damage':
      return {
        testid: 'damage-number',
        text: String(event.amount),
        kind: event.isCritical ? 'critical' : 'damage',
      };
    case 'heal':
      /* The sign is the whole difference between "you lost 90" and "you
         gained 90" at a glance, and colour alone cannot carry it. */
      return { testid: 'heal-number', text: `+${event.amount}`, kind: 'heal' };
    case 'statusApplied':
      return {
        testid: 'status-popup',
        text: event.status.kind,
        kind: 'status',
        status: event.status.kind,
      };
    default:
      return null;
  }
}

/**
 * Which actor a float belongs to, or null when it belongs to nobody.
 *
 * Split out so `main.ts` does not have to switch on event kinds a second time
 * just to know whose head to project.
 */
export function floatTargetOf(event: BattleEvent): string | null {
  switch (event.kind) {
    case 'damage':
    case 'heal':
    case 'statusApplied':
      return event.targetId;
    default:
      return null;
  }
}

/**
 * A chain of one is just a hit.
 *
 * The counter appears at two, which is also the first point at which the word
 * "chain" means anything to the player.
 */
export const CHAIN_VISIBLE_FROM = 2;

/**
 * The fan offset lives in CSS, not here.
 *
 * It used to be a fraction of the viewport added to the anchor, which was
 * quietly wrong: the offset was in viewport units and the glyphs are in rem,
 * so doubling the font size did not widen the gap and two numbers on one
 * target overlapped. Publishing the index and letting the stylesheet multiply
 * it by a rem step keeps the spacing in the same units as the thing being
 * spaced -- change --float-size and the fan follows.
 *
 * Deterministic from a count rather than jittered: `Math.random()` is banned
 * project-wide, and a random offset would also move the numbers between two
 * runs of one seed and break the screenshot baseline.
 */
const STACK_PROPERTY = '--float-stack';

/**
 * The short fade-in, by keyframe name. Must match `@keyframes hud-float-in`
 * in style.css.
 *
 * Named here only so it can be IGNORED -- see `retire`. A float's arrival and
 * its departure are separate animations so that holding a number on screen
 * for a screenshot does not also stretch the moment it takes to appear.
 */
const ARRIVAL_ANIMATION = 'hud-float-in';

export interface FloatLayer {
  /** The container, exposed for teardown. */
  el: HTMLElement;
  /**
   * Show one event at an anchor.
   *
   * `key` identifies what the float is attached to -- the target's ActorId.
   * The layer counts how many floats are ALIVE on that key and fans them
   * apart, so it does not matter whether two numbers arrived in one commit
   * or in two turns close together: what matters is whether they would be
   * on screen at the same time, and only the layer knows that.
   */
  spawn(event: BattleEvent, at: Anchor, key: string): void;
  /** Point the chain counter at a value. Hidden below CHAIN_VISIBLE_FROM. */
  setChain(count: number, at: Anchor | null): void;
  /** Drop every live float immediately. */
  clear(): void;
}

export function createFloatLayer(root: HTMLElement, durationMs: number): FloatLayer {
  const el = document.createElement('div');
  el.className = 'hud-floats';
  el.dataset['testid'] = 'float-layer';
  /* Transient decoration, and it sits over the sprites. Announcing it would
     double up on the action log, which is already a polite live region
     carrying the same events in words. */
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--float-ms', `${durationMs}ms`);

  root.append(el);

  /* Held so clear() can empty the layer without walking the DOM, and so a
     leak is observable from here rather than only by counting elements. */
  const live = new Set<HTMLElement>();

  /* How many floats are currently alive per target, which is what decides
     the fan offset. Counted rather than derived from the batch, because two
     numbers overlap when they SHARE SCREEN TIME -- and a turn taken while
     the previous turn's number is still fading shares screen time just as
     much as two hits in one commit. */
  const liveByKey = new Map<string, number>();

  let chainEl: HTMLElement | null = null;
  let chainShown = 0;

  function place(node: HTMLElement, at: Anchor): void {
    node.style.left = `${(at.x * 100).toFixed(3)}%`;
    node.style.top = `${(at.y * 100).toFixed(3)}%`;
  }

  /**
   * Remove once, whichever fires first.
   *
   * `animationend` is the honest signal, but it never fires if the animation
   * does not start -- a display:none ancestor, a zero-duration override, a
   * browser that declines to run it. "Do not accumulate orphans" is a stated
   * requirement of this feature, so it gets a backstop as well as a signal.
   * `remove()` on a detached node is a no-op, so both firing is harmless.
   */
  function retire(node: HTMLElement, key: string, after: number): void {
    const drop = (): void => {
      if (!live.has(node)) return;
      node.remove();
      live.delete(node);
      const remaining = (liveByKey.get(key) ?? 1) - 1;
      if (remaining <= 0) liveByKey.delete(key);
      else liveByKey.set(key, remaining);
    };

    node.addEventListener('animationend', (event) => {
      /* NOT `{ once: true }`, and not every animationend.
         A float runs TWO animations: a fixed 140ms arrival and the
         duration-long rise. The arrival finishes first, so a listener that
         fires on the first event it sees deletes every number 140ms after
         it appears. Only the long one means the float is over -- and it is
         named by exclusion because reduced motion swaps it for a different
         keyframe (hud-float-fade) that ends the float just the same. */
      if (event.animationName === ARRIVAL_ANIMATION) return;
      drop();
    });

    window.setTimeout(drop, after * 2);
  }

  return {
    el,

    spawn(event, at, key): void {
      const shown = presentEvent(event);
      if (shown === null) return;

      const index = liveByKey.get(key) ?? 0;
      liveByKey.set(key, index + 1);

      const node = document.createElement('div');
      node.className = 'hud-float';
      node.dataset['testid'] = shown.testid;
      node.dataset['kind'] = shown.kind;
      if (shown.status !== undefined) node.dataset['status'] = shown.status;
      node.textContent = shown.text;

      /* The anchor is exactly the target's head; the stylesheet fans the
         second and later numbers off it so overlapping floats on one target
         read as two numbers rather than one bolder one. */
      place(node, at);
      node.style.setProperty(STACK_PROPERTY, String(index));

      el.append(node);
      live.add(node);
      retire(node, key, durationMs);
    },

    setChain(count, at): void {
      if (count < CHAIN_VISIBLE_FROM || at === null) {
        chainEl?.remove();
        chainEl = null;
        chainShown = 0;
        return;
      }

      if (chainEl === null) {
        chainEl = document.createElement('div');
        chainEl.className = 'hud-chain';
        chainEl.dataset['testid'] = 'chain-counter';
        el.append(chainEl);
      }

      place(chainEl, at);

      /* Only on a CHANGE. Re-triggering the pulse on every refresh -- and
         refresh runs on each keypress -- would leave it permanently
         throbbing. Removing and re-adding the class is what restarts a CSS
         animation; setting it again does nothing. */
      if (count !== chainShown) {
        chainEl.textContent = String(count);
        chainEl.classList.remove('is-hit');
        /* Read a layout property to flush the removal, so the re-add is seen
           as a change rather than coalesced away with it. */
        void chainEl.offsetWidth;
        chainEl.classList.add('is-hit');
        chainShown = count;
      }
    },

    clear(): void {
      for (const node of live) node.remove();
      live.clear();
      liveByKey.clear();
      chainEl?.remove();
      chainEl = null;
      chainShown = 0;
    },
  };
}
