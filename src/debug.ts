/**
 * The debug state bridge.
 *
 * WHY THIS EXISTS
 * ---------------
 * Claude Code cannot see the rendered canvas. A screenshot tells it what
 * something *looks like*; this tells it what the game *believes*. When
 * those two disagree, that gap is the bug.
 *
 * This is the single most important file for the agentic workflow. Keep it
 * flat, keep it JSON-serialisable, and add to it whenever a new system
 * gains state worth asserting on.
 *
 * The UI layer is deliberately NOT mirrored here -- the UI is real DOM, so
 * the harness reads it directly with selectors, which is more accurate than
 * anything this file could report.
 */

export interface DebugState {
  /** Seconds of simulated game time elapsed. Set by the fixed step-to. */
  time: number;
  /** Seed the current battle was created with. */
  seed: number;
  /** Set true once the scene has finished its first render. */
  ready: boolean;

  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };

  /** three.js renderer statistics. Sudden jumps here signal regressions. */
  renderer: {
    drawCalls: number;
    triangles: number;
    /** GPU allocations. Must return to baseline after a battle teardown. */
    geometries: number;
    textures: number;
  };

  /** Bloom post-processing parameters, mirrored so shots can assert them. */
  post: { strength: number; radius: number; threshold: number };

  /**
   * Impact effects, as counters.
   *
   * REPORTED BECAUSE THEY ARE OTHERWISE UNASSERTABLE. The shard burst is
   * driven by the scene clock, and `?time=0` -- which every e2e spec loads
   * with -- halts that clock, so a burst there is spawned and then sits at age
   * 0 forever. A screenshot can show it; nothing else can, and "a hit throws
   * debris, and reduced motion throws none" is worth being able to say.
   *
   * The counter is the only durable trace a burst leaves.
   */
  effects: {
    /** Shard bursts fired since boot. */
    bursts: number;
    /** Shards currently in the air. Recomputed on each rendered frame. */
    shardsAlive: number;
    /**
     * Frame washes started since boot -- one per commit that landed a
     * critical.
     *
     * Counted rather than looked for in the DOM because the wash is 90ms long
     * and does not fill: by the time an assertion could poll for it, the
     * browser has already dropped the finished animation off the element.
     */
    washes: number;
  };

  /**
   * Character sprites currently on the platform.
   *
   * This is the channel that makes the sprite layer verifiable without
   * looking at a picture. A screenshot can show you a missing character;
   * only this can tell you whether it is missing because the texture
   * failed to load, because the aspect ratio collapsed, or because the
   * draw order put it behind the platform.
   */
  sprites: Array<{
    name: string;
    /** Which side the character fights for. Also its ActorId's side. */
    side: 'party' | 'enemy';
    /** Feet position in world space. */
    position: [number, number, number];
    /** Derived from the texture aspect -- a 1:1 ratio usually means the
        texture had not decoded when the sprite was built. */
    size: [number, number];
    /** Fraction of the texture height that is empty below the feet. The
        plane is lowered by this much so the art's feet, rather than the
        image's bottom edge, meet the floor. A character that reads as
        floating above its contact shadow is this value being ignored. */
    feetInset: number;
    /** World height of the visible character, excluding transparent
        margins. Always <= size[1]. */
    contentHeight: number;
    renderOrder: number;
    /** Normalised 0..1 screen position of the sprite's head, for placing
        DOM damage numbers. Outside 0..1 means off-screen. */
    headScreen: [number, number];
    hasShadow: boolean;
    /**
     * How far the sprite is currently staggered from its mark, in world
     * units. Signed: negative is screen-left.
     *
     * Reported because a recoil is otherwise UNVERIFIABLE. It lives on the
     * mesh inside the group -- deliberately, so `position` above keeps
     * meaning the character's place on the stage -- which puts it out of
     * reach of every other channel: the state is right, the DOM is right,
     * and a screenshot of a 0.2-unit shift is a matter of opinion.
     */
    recoil: number;
  }>;

  /**
   * The live battle.
   *
   * Null only before the bootstrap has built one. Everything here is battle
   * or sequencer state -- deliberately NOT a mirror of the interface. The
   * HUD is read from the DOM with selectors, which is more accurate than a
   * copy could be, and a copy that drifted would be worse than nothing.
   *
   * `actors` is the exception that proves the rule: it is not a UI mirror,
   * it is the state the UI claims to be showing. Having both means a
   * disagreement between them is visible, which is the bug this whole file
   * exists to catch.
   */
  battle: {
    phase: string;
    round: number;
    chain: number;
    activeActor: string | null;
    /** True while the sequencer is playing a turn. All input is ignored. */
    isLocked: boolean;
    /** Player actions ACCEPTED. Input rejected by the lock does not count. */
    actionsTaken: number;
    /** Labels of sequencer steps not yet run. Empty when idle. A sequence
        that stalls reports where it stalled, not merely that it did. */
    pending: string[];
    /** Upcoming turn order, current actor first. */
    upcoming: string[];
    actors: Array<{
      id: string;
      name: string;
      side: 'party' | 'enemy';
      hp: number;
      maxHp: number;
      mp: number;
      maxMp: number;
      statuses: Array<{ kind: string; magnitude: number; turnsRemaining: number }>;
    }>;
    /** Every battle event so far, oldest first. */
    log: Array<Record<string, unknown>>;
  } | null;
}

declare global {
  interface Window {
    __debugState?: DebugState;
  }
}

/**
 * Publish state onto `window`. Called once per frame from the render loop.
 * Cheap enough at 60fps; if it ever is not, throttle it rather than
 * removing it.
 */
export function publishDebugState(state: DebugState): void {
  window.__debugState = state;
}
