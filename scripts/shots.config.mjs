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
    name: 'command_menu',
    description:
      'The command menu two levels deep: COMMAND with SKILL chosen, the ' +
      'knight skill list live beside it, and a target list open. Does the ' +
      'cascade read left-to-right as a path? Is the dimmed parent legible ' +
      'without competing with the active panel? And does the selected row ' +
      'still read as selected now that cyan is a rule rather than a fill?',
    seed: 1337,
    time: 1.0,
    /* ArrowDown to SKILL, Enter to open it, ArrowDown to the knight's
       ally-targeted guard, Enter to open its target list. Stops short of
       submitting, so the battle state is still the one the seed produced. */
    keys: ['ArrowDown', 'Enter', 'ArrowDown', 'Enter'],
    scale: 2,
    clip: { x: 0, y: 0.55, width: 0.62, height: 0.45 },
  },
  {
    name: 'turn_order',
    description:
      'The turn-order carousel one turn in: the round as a ring, four ' +
      'portraits whole and a fifth split across the seam. The questions no ' +
      'assertion can answer -- do the two half-portraits read as ONE ' +
      'character wrapping round, or as two unrelated crops? Does the fade ' +
      'look like a shadowed edge rather than a hard cut? And does the cursor ' +
      'sit convincingly over the face whose turn it is?',
    seed: 1337,
    time: 1.0,
    /* Deliberately NOT driven with keys. A keypress starts a sequence that
       takes several beats to resolve, and the capture happens immediately --
       so it would photograph a turn mid-flight, differently each run. The
       opening rest state is the one worth judging anyway: APOLLYON is the
       split portrait, and the seam is the whole question.

       scale, NOT a bigger viewport. The tiles are sized in rem, so a larger
       viewport would render the same 36px tile into more frame and make it
       relatively smaller. 3x because a half-portrait dissolving into shadow
       cannot be judged at native size. */
    scale: 3,
    clip: { x: 0, y: 0, width: 0.2, height: 0.1 },
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
