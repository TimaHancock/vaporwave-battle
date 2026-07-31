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
    name: 'turn_order',
    description:
      'The turn-order bar in the top-left: six portrait tiles, next up ' +
      'first, the leading one wearing the same cyan rule and glow as the ' +
      'active party card. The questions no assertion can answer -- is each ' +
      'face identifiable at 36px, does the leading tile read as "up now", ' +
      'and does a row of small bright squares compete with the boss bar?',
    seed: 1337,
    time: 1.0,
    /* scale, NOT a bigger viewport. The tiles are sized in rem, so a 2x
       viewport would render the same 36px tile into twice as much frame and
       make it relatively smaller. This keeps the layout at the size a player
       sees and renders those pixels at 2x. */
    scale: 2,
    clip: { x: 0, y: 0, width: 0.34, height: 0.16 },
  },
  {
    name: 'party_cards',
    description:
      'The bottom of the frame: four party cards, the command menu lifted ' +
      'above them, and the party standing on the platform. The questions no ' +
      'assertion can answer -- is each portrait cropped to a FACE rather ' +
      'than a chestplate, does each tile read as the right character, does ' +
      'the strip sit against the plum platform without muddying it, and are ' +
      'the contact shadows still visible above its top edge?',
    seed: 1337,
    time: 1.0,
    /* scale rather than a bigger viewport, for the same reason as turn_order:
       the cards are sized in rem, so enlarging the frame shrinks them within
       it. This is the strip at the size a player sees, at 2x resolution. */
    scale: 2,
    clip: { x: 0, y: 0.58, width: 1, height: 0.42 },
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
