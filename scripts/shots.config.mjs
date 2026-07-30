/**
 * The named shot manifest.
 *
 * Each entry is a canonical moment worth looking at. Because the camera is
 * locked and randomness is seeded, every entry produces a byte-comparable
 * composition on every run -- which turns "take a screenshot" into
 * something close to a real regression test.
 *
 * Rules for adding entries:
 *   - Every shot needs an explicit seed and time. No defaults, no drift.
 *   - Keep the list short. Six shots you actually look at beat thirty you
 *     scroll past.
 *   - Name the moment, not the feature ("boss_windup", not "test_3").
 */

export const VIEWPORT = { width: 1280, height: 720 };

export const SHOTS = [
  {
    name: 'scene_settled',
    description: 'Ambient scene after the dice have drifted into position.',
    seed: 1337,
    time: 4.0,
  },
  {
    name: 'scene_open',
    description: 'First moment of the battle, before ambient motion.',
    seed: 1337,
    time: 0.0,
  },
  {
    name: 'hud_menu_open',
    description: 'Command menu with the cursor on SKILL.',
    seed: 1337,
    time: 2.0,
  },
  {
    name: 'cast_grounded',
    description:
      'Five placeholder billboards with contact shadows. Check the silhouette ' +
      'edges for halo, and that each figure reads as standing ON the platform ' +
      'rather than floating above it.',
    seed: 1337,
    time: 1.0,
  },
  {
    name: 'bloom_off',
    description: 'Neon with bloom disabled -- baseline for the on/off diff.',
    seed: 1337,
    time: 4.0,
    query: 'bloom=0',
  },
  {
    name: 'bloom_on',
    description: 'Neon with default bloom -- soft cohesive glow, no hot spots.',
    seed: 1337,
    time: 4.0,
  },
];
