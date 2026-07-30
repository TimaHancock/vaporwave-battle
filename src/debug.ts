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
  }>;

  /** Populated from Phase 1 onward. Empty in Phase 0. */
  battle: {
    phase: string;
    round: number;
    chain: number;
    activeActor: string | null;
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
