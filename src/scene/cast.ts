/**
 * The on-screen cast.
 *
 * Who stands on the platform, which PNG they are, and how tall they are.
 * `main.ts` builds the scene from this and the e2e suite asserts against it,
 * so there is one description of the cast rather than two that can disagree.
 *
 * HEIGHTS ARE NOT CHOSEN HERE.
 * ----------------------------
 * They are a property of the cast -- a dragonborn knight is not a halfling
 * artificer -- and they are authored in public/characters/CHARACTER_PROMPTS.md
 * on a `**Scale:**` line beside the prompt that produced each character. This
 * table mirrors that document. Change them in both or in neither, the same
 * discipline the palette follows in tools/prep_character.py.
 *
 * `characterHeight` is the height of the FIGURE, not of the sprite plane.
 * createCharacterSprite divides out the transparent margin it measures in the
 * texture, so these numbers survive art being re-prepped with different
 * framing -- which is exactly what the scale trap in CHARACTER_PROMPTS.md
 * warns about. Nothing here needs to know how much sky is above Apollyon's
 * halo.
 *
 * `name` doubles as the ActorId in src/battle/roster.ts. That correspondence
 * is the seam damage numbers will join on: an event's targetId resolves to a
 * sprite, and the sprite gives the screen anchor.
 */

import type { Side } from '../battle/types';

export interface CastMember {
  /** ActorId, sprite name, and the stem of the texture filename. */
  name: string;
  side: Side;
  /** Served from the web root -- public/ is copied there by Vite. */
  textureUrl: string;
  /** Visible height in world units. Mirrors CHARACTER_PROMPTS.md. */
  characterHeight: number;
  /** Alpha cutoff override. Undefined means the sprite layer's default. */
  alphaTest?: number;
}

/**
 * Alpha cutoff for the boss.
 *
 * Higher than the party's default 0.15 because the boss is the least-minified
 * sprite on screen -- roughly 0.65 texels per pixel against the party's 0.34 --
 * so the same soft edge in the source shows about twice as wide on it.
 *
 * It costs nothing: only ~1% of Apollyon's pixels sit in the soft band at all,
 * and raising the cutoff from 0.15 all the way to 0.5 moves its opaque
 * coverage by half a percent of the frame without moving its bounding box.
 * 0.4 clears the fringe with headroom left before the halo shards' own
 * antialiasing starts to go.
 */
const BOSS_ALPHA_TEST = 0.4;

export const CAST: readonly CastMember[] = [
  { name: 'kira', side: 'party', textureUrl: './characters/kira.png', characterHeight: 2.45 },
  { name: 'neo', side: 'party', textureUrl: './characters/neo.png', characterHeight: 2.25 },
  { name: 'vex', side: 'party', textureUrl: './characters/vex.png', characterHeight: 2.15 },
  { name: 'lyra', side: 'party', textureUrl: './characters/lyra.png', characterHeight: 1.65 },
  {
    name: 'apollyon',
    side: 'enemy',
    textureUrl: './characters/apollyon.png',
    /* 3.80 rather than the 4.20 the prompts originally carried. The camera is
       locked and the APOLLYON bar owns the top of frame: at 4.20 the boss's
       head projects to screen y 0.079, behind the bar, and the e2e guard that
       keeps damage numbers out of the HUD fails. 3.80 is the largest figure
       that clears it -- 436 px tall against Kira's 276. CHARACTER_PROMPTS.md
       carries the same number and the same reason. */
    characterHeight: 3.8,
    alphaTest: BOSS_ALPHA_TEST,
  },
];

export const PARTY: readonly CastMember[] = CAST.filter((m) => m.side === 'party');
export const BOSS: CastMember = CAST.find((m) => m.side === 'enemy')!;
