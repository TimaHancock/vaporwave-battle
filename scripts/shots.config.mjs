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
    name: 'full_cast',
    description:
      'The whole cast in final art: four party members left, Apollyon right. ' +
      'The question the validator cannot answer -- could you name each ' +
      'character from its outline alone at this size? Also: does each figure ' +
      'stand ON the platform rather than above it, do the heights read as ' +
      'four different races, and does any silhouette carry a halo or fringe?',
    seed: 1337,
    time: 1.0,
  },
  {
    name: 'boss_closeup',
    description:
      'Apollyon cropped out of the canonical render -- the camera has not ' +
      'moved. At this magnification: is the alphaTest cutoff clean along the ' +
      'tentacles and the halo shards, does the contact shadow sit under the ' +
      'creature rather than under its transparent margin, and does the mass ' +
      'read as threatening rather than merely big?',
    seed: 1337,
    time: 1.0,
    /* Twice the pixels at the same 16:9, so the composition is identical and
       only the sampling improves. */
    viewport: { width: 2560, height: 1440 },
    clip: { x: 0.56, y: 0.08, width: 0.36, height: 0.7 },
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
