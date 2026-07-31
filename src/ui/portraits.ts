/**
 * Portrait crops for the party cards.
 *
 * There is no bust art. A card's portrait is a zoomed crop of the character's
 * full-body sprite PNG -- the same file the scene already loaded, so this costs
 * no new asset, no new request, and nothing to keep in sync when art changes
 * except the numbers below.
 *
 * WHY THIS CANNOT BE ONE SHARED RULE
 * ----------------------------------
 * tools/prep_character.py normalises every sprite feet-to-bottom, but not
 * head-to-top: a character's head lands wherever its proportions put it. The
 * first opaque row ranges from 0.041 of the frame (Lyra, who is short and
 * whose art is framed tight) to 0.313 (Apollyon, whose halo sits in a lot of
 * sky). A single crop that found Lyra's face would find Apollyon's chest.
 *
 * HOW THESE NUMBERS WERE DERIVED
 * ------------------------------
 * Measured off the alpha channel of each PNG at a 38/255 threshold:
 *
 *   top   = first row containing an opaque pixel, as a fraction of height
 *   bot   = last such row
 *   cx    = horizontal centre of the opaque span within the top 22% of the
 *           subject -- the head band, before the silhouette widens into
 *           shoulders
 *
 *   crop  = the top 26% of the subject (bot - top), padded 0.02 above
 *   zoom  = 1 / cropHeight
 *   y     = the crop's vertical centre
 *   x     = cx
 *
 * | id       | frame    |  top  |  bot  |  cx   |
 * |----------|----------|-------|-------|-------|
 * | kira     |  512x1024| 0.169 | 0.970 | 0.469 |
 * | neo      |  512x1024| 0.206 | 0.967 | 0.405 |
 * | vex      |  512x1024| 0.312 | 0.970 | 0.474 |
 * | lyra     |  640x1024| 0.041 | 0.970 | 0.418 |
 * | apollyon |  512x1024| 0.313 | 0.970 | 0.502 |
 *
 * Re-derive rather than re-guess if art is re-prepped: the recipe above is the
 * whole of it. This is the one table in the HUD that rots silently when a PNG
 * changes, which is why `party_cards` is a named shot.
 */

import { CAST } from '../scene/cast';

/**
 * A crop, expressed as CSS background properties.
 *
 * `zoom` is a multiple of the TILE's height, applied as
 * `background-size: auto calc(zoom * 100%)`. Height-relative deliberately:
 * Lyra's frame is 640 wide where the rest are 512, and a width-relative zoom
 * would need her to be a special case.
 *
 * `x`/`y` are percentage `background-position` values. A percentage aligns
 * that point of the IMAGE with the same point of the BOX, which for an image
 * zoomed well past the box lands the focus near the tile centre. `y` is the
 * crop's centre, so heads sit a little high in the tile -- which is what
 * head-and-shoulders framing wants anyway.
 */
export interface PortraitFocus {
  zoom: number;
  x: string;
  y: string;
}

/**
 * Centred and barely zoomed.
 *
 * Used for any id with no entry. A new character should show a bad crop --
 * visible, obvious, fixable -- rather than throw and take the HUD down with
 * it. The cards are not worth a crash.
 */
const DEFAULT_FOCUS: PortraitFocus = { zoom: 1, x: '50%', y: '50%' };

const FOCUS: Readonly<Record<string, PortraitFocus>> = {
  kira: { zoom: 4.4, x: '47%', y: '26%' },
  neo: { zoom: 4.6, x: '41%', y: '30%' },
  vex: { zoom: 5.2, x: '47%', y: '39%' },
  lyra: { zoom: 3.8, x: '42%', y: '15%' },
  apollyon: { zoom: 5.2, x: '50%', y: '39%' },
};

/**
 * Texture URLs come from the cast table, not from a second list here.
 *
 * scene/cast.ts is pure data -- it imports a type from battle/types and
 * nothing else -- so reading it costs the UI no dependency on three.js. What
 * it buys is that a renamed PNG breaks in one place instead of silently
 * showing the wrong face on a card.
 */
const TEXTURE_URL: ReadonlyMap<string, string> = new Map(
  CAST.map((member) => [member.name, member.textureUrl]),
);

export interface Portrait extends PortraitFocus {
  /** Ready for `background-image`, or null when the id has no art. */
  url: string | null;
}

export function portraitFor(actorId: string): Portrait {
  return {
    ...(FOCUS[actorId] ?? DEFAULT_FOCUS),
    url: TEXTURE_URL.get(actorId) ?? null,
  };
}
