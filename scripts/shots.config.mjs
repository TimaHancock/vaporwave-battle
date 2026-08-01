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
    name: 'valley',
    description:
      'The valley: two banks of terrain running from beside the arena back ' +
      'to the vanishing point, with the sun in the channel between them and ' +
      'the grid ocean on its floor. The questions no assertion can answer -- ' +
      'does the land read as ONE surface running away from the viewer, or as ' +
      'terraced steps? Is the corridor\'s convergence doing the depth work, ' +
      'or is fog carrying it alone? Does the neon lattice read as light on ' +
      'rock, or as a mesh someone forgot to hide? Are the near banks too ' +
      'bright now they sit inside the fog\'s near plane? And is the sun ' +
      'still seen THROUGH a window rather than over a wall?',
    seed: 1337,
    time: 2.0,
    /* No keys and no HUD subject -- this is a scene shot, so the frame is
       what matters and `viewport` is the right knob rather than `scale`.
       Taller than a horizon band: the subject is now a recession, and the
       near banks that carry it are level with the platform. */
    viewport: { width: 2560, height: 1440 },
    clip: { x: 0, y: 0.02, width: 1, height: 0.62 },
  },
  {
    name: 'damage_numbers',
    description:
      'One turn resolved, with the floating numbers held open. The questions ' +
      'no assertion can answer -- is a number now unmistakably an EVENT ' +
      'rather than HUD text that happens to be nearby? Does Orbitron hold up ' +
      'at 2rem over the boss\'s halo, or does the dark stroke eat the ' +
      'counters? Does the red read as damage without reading as a different ' +
      'brand from the site? Is the critical\'s lean impact or is it just ' +
      'harder to read? And does the chain counter still sit clear of both ' +
      'the boss bar above it and the numbers rising past it?',
    seed: 7,
    time: 1.0,
    /* seed 7 crits on the opening turn, so the shot shows an ordinary hit
       and a critical side by side rather than needing two captures.

       floatMs is the whole trick: a number lives 900ms and the capture
       happens after the turn settles, so at the shipped duration there is
       nothing left to photograph. Holding it open changes only how long the
       element persists -- the seed still decides every number in it. */
    /* TWO turns, so the chain counter is past its threshold of 2 and in
       frame alongside the numbers. `settle` waits between the keypresses as
       well as after them -- the input lock DROPS a rejected keypress rather
       than queueing it, so without that this would silently be one turn. */
    query: 'stepMs=0&floatMs=60000',
    keys: ['Enter', 'Enter'],
    settle: true,
    scale: 2,
    clip: { x: 0.45, y: 0, width: 0.55, height: 0.6 },
  },
  {
    name: 'status_popup',
    description:
      'DEFEND resolved, so a DEF_UP pop-up floats over KIRA while the badge ' +
      'it produced sits on her card below. The questions -- do the pop-up ' +
      'and the card badge read as ONE event seen twice, given they share a ' +
      'glyph but deliberately not a colour? Does the condensed label face ' +
      'separate a buff from a damage number at a glance? And is the blue ' +
      'distinguishable from the interface\'s cyan rules rather than ' +
      'blending into them?',
    seed: 1337,
    time: 1.0,
    /* Down twice to DEFEND, Enter to commit. The only status a party member
       can apply to themselves from the opening menu, so it needs no skill
       navigation and stays legible as a test of the status path. */
    query: 'stepMs=0&floatMs=60000',
    keys: ['ArrowDown', 'ArrowDown', 'Enter'],
    settle: true,
    scale: 2,
    clip: { x: 0, y: 0.25, width: 0.45, height: 0.75 },
  },
  {
    name: 'action_log',
    description:
      'The upper-left action log, one full turn in: the narration history ' +
      'under the carousel, newest at the bottom. The questions no assertion ' +
      'can answer -- do the older lines DISSOLVE as they rise, or do they ' +
      'cut off at an edge? Is the newest line legible against the sky ' +
      'behind it? Does the blurred backing read as a soft shadow under the ' +
      'text rather than as a box? And is there daylight between the last ' +
      'line and the top of KIRA\'s head?',
    seed: 1337,
    time: 1.0,
    /* Enter submits KIRA's attack. stepMs=0 collapses the beats so `settle`
       returns immediately -- the log ends up with the whole turn in it, and
       the seed still decides every number in it. */
    query: 'stepMs=0',
    keys: ['Enter'],
    settle: true,
    /* scale rather than a bigger viewport, for the same reason as
       turn_order: the log is sized in rem. The clip reaches down past the
       log's bottom edge on purpose -- the margin above KIRA is half the
       subject, so her head has to be in frame. */
    scale: 3,
    clip: { x: 0, y: 0, width: 0.28, height: 0.42 },
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
