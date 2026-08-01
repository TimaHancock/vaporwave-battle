/**
 * Character billboard sprites.
 *
 * A "billboard" here is a flat textured plane standing upright in the 3D
 * scene. The character art is a 2D image; the world around it is real
 * geometry. That combination is what makes HD-2D work, and it is why the
 * expensive part of 3D (modelling, rigging, skinning, animating) never
 * enters this project.
 *
 * Three things in this file are easy to get wrong and produce bugs that a
 * screenshot alone will not explain:
 *
 *   1. Material choice. Lighting is baked into the art, so the sprite must
 *      NOT be re-lit by the scene lights (see MATERIAL note below).
 *   2. Alpha handling. Wrong settings give a rectangular halo or make
 *      sprites punch holes through each other.
 *   3. Draw order. Without explicit renderOrder, sprites at similar depths
 *      flicker past each other intermittently.
 *
 * The arithmetic behind positioning and ordering lives in spriteLayout.ts
 * with no three.js dependency, so it is unit-tested rather than eyeballed.
 */

import * as THREE from 'three';
import {
  spriteDimensions,
  groundedCentreY,
  contactShadowSize,
  SHADOW_RENDER_ORDER,
  type Vec3,
} from './spriteLayout';
import {
  flashStrength,
  recoilOffset,
  RECOIL_BASE,
  RECOIL_MAX,
  RECOIL_SECONDS,
} from './impact';
/* Type-only: erases at build time, so the sprite layer shares battle
   vocabulary without importing any battle logic. */
import type { Side } from '../battle/types';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface CharacterSpriteOptions {
  /** Loaded character texture. Must have transparency already applied. */
  texture: THREE.Texture;
  /**
   * How tall the PLANE is, in world units. Prefer `characterHeight`.
   *
   * The plane is not the character: art is authored with a transparent
   * margin, and how much margin varies per asset, so equal plane heights
   * produce unequal characters. Supply this only when there is no character
   * to measure -- a placeholder texture, or a unit test.
   */
  worldHeight?: number;
  /**
   * How tall the CHARACTER stands, in world units -- the number a person
   * means by "how tall is she". ~2.2 reads as human against this platform.
   *
   * The plane is derived from it by dividing out the empty margin measured
   * in the texture, so the visible figure is this tall whatever the art's
   * framing does. That indirection is the whole point: the prep tool scales
   * every character to fill its own frame, which means relative height is
   * NOT carried by the art. See the scale trap in
   * public/characters/CHARACTER_PROMPTS.md, which is also where these
   * numbers are authored.
   *
   * Takes precedence over `worldHeight` when both are given.
   */
  characterHeight?: number;
  /** Where the character's feet go. y is ignored; feet always sit on ground. */
  position: Vec3;
  /** Draw sequence, from assignRenderOrders(). Furthest sprite gets lowest. */
  renderOrder: number;
  /** Name for debugging and for finding the sprite later. Also the ActorId. */
  name: string;

  /** Which side the character fights for. Reported through the debug channel. */
  side: Side;

  /**
   * Alpha cutoff, 0..1. Fragments below this are discarded outright.
   *
   * This is what lets a transparent sprite write to the depth buffer like
   * opaque geometry, which is what stops sprites from punching rectangular
   * holes through one another.
   *
   * 0.15 keeps soft antialiased edges from AI-generated art while still
   * cutting the empty margin. Raise toward 0.5 if you see a faint
   * rectangular halo (a sign the source PNG has near-zero-but-not-zero
   * alpha across its background). Lower it if fine detail such as a thin
   * sword blade or hair wisps is being eaten.
   */
  alphaTest?: number;

  /**
   * Whether the renderer's ACES tone mapping applies to this sprite.
   *
   * true  (default) — the sprite is tone-mapped along with the environment.
   *                   Integrates better; slightly desaturates hot magenta.
   * false           — colours come through exactly as authored. Preserves
   *                   palette fidelity to the brand hexes, but the sprite
   *                   can read as brighter than its surroundings, which is
   *                   the "sticker pasted on the screen" failure mode.
   *
   * Try both once you have real art. This is a genuine judgement call and
   * it is much easier to answer by looking than by reasoning.
   */
  toneMapped?: boolean;

  /** Opacity of the contact shadow, 0..1. Set 0 to disable. */
  shadowOpacity?: number;

  /**
   * Linear luminance above which the sprite's highlights start compressing.
   * Below this, colours pass through exactly as authored.
   */
  highlightKnee?: number;

  /**
   * Linear luminance the sprite's highlights asymptotically approach.
   *
   * See HIGHLIGHT_CEILING for where the default comes from and why capping
   * here is what stops bloom bleeding past the silhouette.
   */
  highlightCeiling?: number;
}

export interface CharacterSprite {
  /** Add this to the scene. Contains the sprite plane and its shadow. */
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh | null;
  readonly name: string;
  readonly side: Side;
  /** Sprite dimensions in world units, derived from the texture aspect. */
  readonly size: { width: number; height: number };
  /**
   * Fraction of the texture's height that is empty below the feet, measured
   * from the art. Non-zero is normal -- the contract asks for a transparent
   * margin. Exposed so the harness can prove grounding numerically rather
   * than by squinting at whether a character floats.
   */
  readonly feetInset: number;
  /** World height of the visible character, excluding transparent margins. */
  readonly contentHeight: number;
  /**
   * Project the sprite's head position into normalised screen coordinates.
   * Use this to place DOM damage numbers over the character: crisp text,
   * full CSS animation, and still readable in the DOM by the test harness.
   */
  headScreenPosition(camera: THREE.Camera): { x: number; y: number };
  /**
   * Start a hit reaction: a flash, and a stagger away from the attacker.
   *
   * `at` is a scene-clock time in seconds, not a wall clock. Everything the
   * reaction does is derived from age against that clock, which is what lets
   * hit-stop work by simply holding it still.
   */
  react(kind: 'hit' | 'critical', direction: -1 | 1, at: number): void;
  /**
   * Advance whatever reaction is live. Cheap and safe to call every frame.
   *
   * `motion` false is reduced motion: the flash still fires, the stagger does
   * not.
   */
  updateReaction(now: number, motion?: boolean): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Sprite construction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Reads a texture's pixel dimensions.
 *
 * three.js types `Texture.image` loosely because it can hold an
 * HTMLImageElement, a canvas, an ImageBitmap, or raw data. Narrowing it
 * here keeps the rest of the file honest under `strict`, and throws a
 * useful message if a texture arrives before its image has decoded --
 * which otherwise produces a 1x1 aspect ratio and a sliver of a sprite
 * that looks like a geometry bug rather than a loading race.
 */
function texturePixelSize(
  texture: THREE.Texture,
  name: string,
): { width: number; height: number } {
  const image: unknown = texture.image;

  if (
    typeof image === 'object' &&
    image !== null &&
    'width' in image &&
    'height' in image &&
    typeof (image as { width: unknown }).width === 'number' &&
    typeof (image as { height: unknown }).height === 'number'
  ) {
    const { width, height } = image as { width: number; height: number };
    if (width > 0 && height > 0) return { width, height };
  }

  throw new Error(
    `Texture for sprite "${name}" has no usable dimensions. ` +
      `Await the loader before creating the sprite.`,
  );
}

/* ------------------------------------------------------------------ */
/* Highlight rolloff                                                   */
/* ------------------------------------------------------------------ */

/**
 * Linear luminance the sprite's brightest pixels approach but never pass.
 *
 * This is the sun's gradient at its halfway point, which is the reference
 * the art is judged against: a character should never out-shine the middle
 * of the sunset behind them. Interpolating the sun stops `#ff9a3c` (0.45)
 * and `#ff2d95` (1.0) at t=0.5 gives roughly (255, 144, 68), whose linear
 * luminance is 0.2126*1.0 + 0.7152*0.279 + 0.0722*0.058.
 *
 * It also does the bloom's job for it. UnrealBloomPass thresholds at 0.68
 * (see post.ts); holding every sprite pixel below 0.42 means the pass never
 * picks a character up, so their authored rim lights stay hard-edged
 * instead of smearing glow outside the silhouette. The neon that SHOULD
 * bloom -- sun, dice, grid centre line -- is untouched.
 */
export const HIGHLIGHT_CEILING = 0.416;

/**
 * Linear luminance where compression begins. Everything below passes
 * through untouched.
 *
 * Deliberately well above the art's midtones. A uniform brightness scale
 * would have been one line, but roughly a quarter of a character sits close
 * to the backdrop value already -- dimming the whole figure to tame its
 * highlights is what makes a shadow side dissolve into the background.
 * Compressing only the top of the range leaves that separation intact.
 */
export const HIGHLIGHT_KNEE = 0.25;

/**
 * Where the highlight ceiling is lifted to at the peak of an impact flash.
 *
 * JUST above `post.ts`'s bloom threshold of 0.68, and the "just" is the whole
 * tuning. For the length of a flash the struck character IS allowed to bloom
 * -- `HIGHLIGHT_CEILING` exists to stop authored rim lights smearing every
 * frame of the fight, not to forbid an impact frame -- but at 1.0 the boss's
 * entire upper body went to white and the bloom pass smeared it into a blob
 * with no character left in it. A ceiling a hair over the threshold lets the
 * brightest parts glow and leaves the drawing intact.
 *
 * Returns to HIGHLIGHT_CEILING the moment the flash is out.
 */
export const FLASH_CEILING = 0.72;

/**
 * What a hit tints toward, as a multiplier on the sampled texture.
 *
 * Past 1 deliberately -- `MeshBasicMaterial.color` multiplies the map, so a
 * value of 1 is "unchanged" and anything brighter has to exceed it. Cool white
 * for an ordinary hit, hot ember for a critical, which is the same colour
 * vocabulary the damage numbers already use: red-ward for damage, ember for
 * a critical.
 *
 * MODEST, because these compound with the lifted ceiling rather than being
 * capped by it. The first pass ran to 3.2 and the two together turned the
 * target into a white silhouette -- a strobe, not a flash. A hit should read
 * as the character being LIT, not as the character being deleted.
 */
const FLASH_HIT = new THREE.Color(1.45, 1.45, 1.65);
const FLASH_CRITICAL = new THREE.Color(1.9, 1.2, 0.85);

/**
 * Injects a soft highlight knee into a stock MeshBasicMaterial.
 *
 * The rolloff is exponential rather than a hard clamp: `capped` approaches
 * the ceiling asymptotically, so a broad specular does not flatten into a
 * plateau of one flat value. Chroma is preserved by scaling the whole RGB
 * triple by the luminance ratio rather than clamping channels, which would
 * shift a hot magenta toward white on its way down.
 *
 * This runs in LINEAR space -- the texture is sRGB-decoded at sample time,
 * and the composer's OutputPass applies tone mapping afterwards -- so both
 * constants are linear luminance, not the 0..255 values a screenshot shows.
 */
function applyHighlightRolloff(
  material: THREE.MeshBasicMaterial,
  knee: number,
  ceiling: number,
): { ceiling: THREE.IUniform<number> } {
  /*
   * The ceiling uniform is HANDED BACK, not just set.
   *
   * `onBeforeCompile` runs lazily -- three calls it the first time the
   * material is compiled, which is on the first frame the sprite is drawn --
   * so this object is created up front and its `value` is what the shader
   * reads. The impact flash raises it for a few frames; without a reference
   * out here there is no way to reach it again, and the flash has nothing to
   * work with. See the note on flashing in `react`.
   */
  const ceilingUniform: THREE.IUniform<number> = { value: ceiling };

  material.onBeforeCompile = (shader) => {
    shader.uniforms['uHighlightKnee'] = { value: knee };
    shader.uniforms['uHighlightCeiling'] = ceilingUniform;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uHighlightKnee;\n' +
          'uniform float uHighlightCeiling;\n' +
          'void main() {',
      )
      /* map_fragment is where the sampled texture lands in diffuseColor. */
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float hlLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          if (hlLum > uHighlightKnee) {
            float over = (hlLum - uHighlightKnee) / max(1e-4, 1.0 - uHighlightKnee);
            float capped = uHighlightKnee +
              (uHighlightCeiling - uHighlightKnee) * (1.0 - exp(-over * 2.0));
            diffuseColor.rgb *= capped / max(hlLum, 1e-4);
          }
        }`,
      );
  };

  /* Without a distinct cache key three.js hands back the cached program for
     a stock MeshBasicMaterial and the injected code silently never runs --
     a failure that looks exactly like the constants being wrong. */
  /* The cache key deliberately uses the STARTING ceiling, not the live
     uniform. A key that changed with the flash would recompile the shader on
     every hit -- a stall at exactly the moment the game is meant to feel
     responsive. Uniforms are meant to be varied without recompiling; that is
     the whole point of them. */
  material.customProgramCacheKey = () =>
    `characterHighlightRolloff:${knee}:${ceiling}`;

  return { ceiling: ceilingUniform };
}

/* ------------------------------------------------------------------ */
/* Opaque bounds                                                       */
/* ------------------------------------------------------------------ */

/** Pixel bounds of a texture's opaque content. Inclusive on all edges. */
interface OpaqueBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Finds the bounding box of a texture's opaque pixels.
 *
 * Character art carries a generous transparent margin by contract, which
 * means the image's edges are NOT the character's edges. Grounding, and
 * head placement for DOM damage numbers, both need where the art actually
 * is -- measuring it beats trusting a hand-entered number per character,
 * because a regenerated PNG changes its margins silently.
 *
 * Returns null when nothing clears the alpha cutoff, which callers should
 * treat as "no inset" rather than an error: a fully transparent texture is
 * already invisible and a thrown exception here would be misleading.
 */
function opaqueBounds(
  texture: THREE.Texture,
  width: number,
  height: number,
  alphaTest: number,
): OpaqueBounds | null {
  const source: unknown = texture.image;
  if (!(source instanceof HTMLImageElement ||
        source instanceof HTMLCanvasElement ||
        source instanceof ImageBitmap)) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;

  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  /* Match the cutoff the material uses, so bounds agree with what is
     actually drawn rather than with any faint matte fringe below it. */
  const cutoff = Math.max(1, Math.round(alphaTest * 255));

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < cutoff) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return maxY < 0 ? null : { minX, maxX, minY, maxY };
}

export function createCharacterSprite(
  options: CharacterSpriteOptions,
): CharacterSprite {
  const {
    texture,
    worldHeight,
    characterHeight,
    position,
    renderOrder,
    name,
    side,
    alphaTest = 0.15,
    toneMapped = true,
    shadowOpacity = 0.45,
    highlightKnee = HIGHLIGHT_KNEE,
    highlightCeiling = HIGHLIGHT_CEILING,
  } = options;

  const group = new THREE.Group();
  group.name = `sprite:${name}`;
  group.position.set(position.x, 0, position.z);

  /* --- Texture setup ------------------------------------------------ */

  /* Source art is authored in sRGB. Without this the whole character
     renders washed out and slightly grey, which is easy to misdiagnose as
     a lighting problem. */
  texture.colorSpace = THREE.SRGBColorSpace;

  /* Clamp, don't repeat. A sprite that wraps produces a sliver of the
     opposite edge along the silhouette -- a thin bright line that looks
     like a rendering artefact rather than a texture setting. */
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  /* Mipmaps with linear filtering keep the sprite clean when the browser
     is scaled down. Anisotropy is set by the caller if wanted. */
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;

  const { width: pixelWidth, height: pixelHeight } = texturePixelSize(texture, name);

  /* --- Where the character actually is inside its image -------------- */

  /* The image's edges are not the character's edges. Sizing, grounding and
     head placement all need the content, not the canvas -- so this is
     measured BEFORE the plane exists, and the plane is derived from it. */
  const bounds = opaqueBounds(texture, pixelWidth, pixelHeight, alphaTest);

  /** Fraction of the image height that is empty below the feet. */
  const feetInset = bounds === null ? 0 : (pixelHeight - 1 - bounds.maxY) / pixelHeight;
  /** Fraction of the image height that is empty above the head. */
  const headInset = bounds === null ? 0 : bounds.minY / pixelHeight;

  /* --- Plane height -------------------------------------------------- */

  /* Divide the empty margin back out, so `characterHeight` describes the
     figure and not the canvas it was drawn on. Two assets framed differently
     -- and the prep tool frames every character to fill its own frame, so
     they always are -- still stand at the heights the cast table asks for.

     Without this, a flat worldHeight makes the halfling as tall as the
     wizard, because her art fills 76% of its frame and his fills 76% of his. */
  const planeHeight =
    characterHeight === undefined
      ? worldHeight
      : characterHeight / Math.max(1 - feetInset - headInset, 1e-6);

  if (planeHeight === undefined) {
    throw new Error(
      `Sprite "${name}" needs characterHeight or worldHeight; got neither.`,
    );
  }

  const size = spriteDimensions(pixelWidth, pixelHeight, planeHeight);

  /* --- Geometry ----------------------------------------------------- */

  const geometry = new THREE.PlaneGeometry(size.width, size.height);

  /* --- MATERIAL ------------------------------------------------------
   *
   * MeshBasicMaterial, deliberately -- NOT MeshStandardMaterial.
   *
   * The lighting is painted into the art. A flat plane has every vertex
   * normal pointing the same direction, so a scene light cannot produce
   * any shape across it; it would only multiply the whole sprite up or
   * down uniformly, destroying the authored rim lights and key direction.
   *
   * This is why the art prompt specifies the light direction so precisely:
   * the sprite's lighting is a fixed property of the image, and it has to
   * agree with the 3D environment around it or the character will read as
   * cut out from a different scene.
   *
   * Do not "fix" this by switching to a lit material.
   */
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest,
    /* With alphaTest active, writing depth is both safe and necessary:
       it is what makes sprites occlude each other correctly instead of
       relying on draw order alone. */
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped,
    /* The sprite is a flat cutout; scene fog would tint it as though it
       had depth it does not have. Characters stand at the focal plane, so
       excluding them keeps the art reading as authored. */
    fog: false,
  });

  const rolloff = applyHighlightRolloff(material, highlightKnee, highlightCeiling);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `sprite-mesh:${name}`;

  /* Centre the plane so the character's FEET land on the floor -- not the
     plane's bottom edge, which sits below them by the art's margin. */
  mesh.position.y = groundedCentreY(size.height, 0, feetInset);

  /* Explicit draw sequence. See assignRenderOrders() for why the default
     distance sort is not good enough here. */
  mesh.renderOrder = renderOrder;

  group.add(mesh);

  /* --- Contact shadow ----------------------------------------------- */

  /* The plane's top edge is empty margin; the character's crown is lower.
     For a 2.2-unit sprite with a 4% top margin that is ~17 screen pixels,
     which is the difference between a damage number over the head and one
     floating in the air above it. */
  const contentHeight = size.height * (1 - feetInset - headInset);

  /* Flat art standing in a 3D scene looks pasted on without this. It is
     one mesh and one small texture, and it does more for believability
     than any other single thing in the sprite layer. */
  let shadow: THREE.Mesh | null = null;
  let shadowTexture: THREE.CanvasTexture | null = null;

  if (shadowOpacity > 0) {
    /* Sized from the CHARACTER, not from the plane. A sprite carrying a lot
       of empty margin -- the boss's plane is 5.8 units for a 3.8-unit
       creature -- would otherwise cast a shadow scaled to its transparent
       sky, and a shadow half again too wide reads as the character hovering
       above a pool rather than standing in one. */
    const shadowSize = contactShadowSize(contentHeight);
    shadowTexture = createRadialFalloffTexture();

    const shadowGeometry = new THREE.PlaneGeometry(
      shadowSize.width,
      shadowSize.height,
    );
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: shadowOpacity,
      /* Shadows are pure blending with no alpha cutoff, so they must not
         write depth -- doing so would let a nearer shadow occlude a
         further character's feet. */
      depthWrite: false,
      depthTest: true,
      color: 0x000000,
      toneMapped: false,
      fog: false,
    });

    shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.name = `sprite-shadow:${name}`;
    /* Lay the plane flat on the floor. */
    shadow.rotation.x = -Math.PI / 2;
    /* Lift a hair above the platform surface. Coplanar geometry produces
       z-fighting: a shimmering interference pattern that appears only at
       certain camera distances and looks like a driver bug. */
    shadow.position.y = 0.012;
    shadow.renderOrder = SHADOW_RENDER_ORDER;

    group.add(shadow);
  }

  /* --- Reaction ------------------------------------------------------- */

  /*
   * What being hit looks like.
   *
   * State is a start time and a direction; everything else is derived from
   * `age` by impact.ts, so nothing here accumulates and a reaction cannot
   * drift out of step with the clock driving it.
   */
  let reactionAt: number | null = null;
  let reactionDirection = 1;
  let reactionAmplitude = RECOIL_BASE;
  let reactionCritical = false;

  /* The mesh's authored offset, captured before anything moves it. Recoil is
     added to this rather than replacing it -- the y here is what puts the
     character's FEET on the floor rather than the plane's bottom edge. */
  const restX = mesh.position.x;

  /* Held so the flash can be undone exactly. `MeshBasicMaterial.color`
     multiplies the map, so the resting value is white and returning to it is
     the whole of "stop flashing". */
  const restColour = material.color.clone();

  /* --- Public interface ---------------------------------------------- */

  const headWorld = new THREE.Vector3();

  return {
    group,
    mesh,
    shadow,
    name,
    side,
    size,
    feetInset,
    contentHeight,

    react(kind: 'hit' | 'critical', direction: -1 | 1, at: number) {
      reactionAt = at;
      reactionDirection = direction;
      reactionCritical = kind === 'critical';
      reactionAmplitude = reactionCritical ? RECOIL_MAX : RECOIL_BASE;
    },

    updateReaction(now: number, motion = true) {
      if (reactionAt === null) return;

      const age = now - reactionAt;
      const flash = flashStrength(age);
      /* `motion` off is reduced motion: the flash still fires, the stagger
         does not. A flash is a change of colour in place, which is not what
         anybody means by motion sickness. */
      const offset = motion
        ? recoilOffset(age, RECOIL_SECONDS, reactionAmplitude)
        : 0;

      mesh.position.x = restX + offset * reactionDirection;

      if (flash > 0) {
        /*
         * THE FLASH CANNOT WORK BY BRIGHTENING ALONE, and this is the one
         * genuinely surprising thing in this file.
         *
         * `applyHighlightRolloff` holds every character pixel under
         * HIGHLIGHT_CEILING so the bloom pass never picks a sprite up, and it
         * runs at `#include <map_fragment>` -- AFTER material.color has
         * multiplied in. Scale the colour past 1 and the knee compresses it
         * straight back down; the flash silently does nothing.
         *
         * So it does two things. It TINTS, because the rolloff preserves
         * chroma -- it scales the whole RGB triple by a luminance ratio
         * rather than clamping channels. And it LIFTS THE CEILING for the
         * duration, which is a deliberate, temporary suspension of a rule
         * that exists for a different purpose: the rolloff is there to stop
         * AUTHORED rim lights smearing into bloom, not to forbid an impact
         * frame.
         */
        const tint = reactionCritical ? FLASH_CRITICAL : FLASH_HIT;
        material.color.copy(restColour).lerp(tint, flash);
        rolloff.ceiling.value =
          highlightCeiling + (FLASH_CEILING - highlightCeiling) * flash;
      } else {
        material.color.copy(restColour);
        rolloff.ceiling.value = highlightCeiling;
        /* Settled, in both channels. Dropping the start time is what stops
           every sprite recomputing a finished reaction on every frame for the
           rest of the battle. */
        if (offset === 0) reactionAt = null;
      }
    },

    headScreenPosition(camera: THREE.Camera) {
      /* Top of the CHARACTER, in world space, then projected to clip space. */
      headWorld.set(group.position.x, contentHeight, group.position.z);
      headWorld.project(camera);
      /* Clip space is -1..1 with +Y up; convert to 0..1 with +Y down so it
         maps directly onto CSS percentages. */
      return {
        x: (headWorld.x + 1) / 2,
        y: (-headWorld.y + 1) / 2,
      };
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      if (shadow) {
        shadow.geometry.dispose();
        (shadow.material as THREE.Material).dispose();
      }
      shadowTexture?.dispose();
      group.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Texture loading                                                     */
/* ------------------------------------------------------------------ */

/**
 * Loads a character PNG. Rejects rather than silently substituting a blank
 * texture, because a missing sprite renders as nothing at all and is
 * indistinguishable from a positioning bug in a screenshot.
 */
export function loadCharacterTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => resolve(texture),
      undefined,
      () => reject(new Error(`Failed to load character texture: ${url}`)),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Procedural placeholder                                              */
/* ------------------------------------------------------------------ */

export interface PlaceholderOptions {
  /** Pixel width. Portrait sources are conventional for standing figures. */
  width?: number;
  height?: number;
  /** Body fill. Defaults to the deep plum used across the brand. */
  bodyColour?: string;
  /** Lit-side facet colour. */
  litColour?: string;
  /** Right-edge rim, matching the scene's magenta rim light. */
  rimRightColour?: string;
  /** Left-edge rim, matching the scene's cyan rim light. */
  rimLeftColour?: string;
}

/**
 * Draws a stand-in knight silhouette so the sprite pipeline can be verified
 * before any art exists.
 *
 * This deliberately reproduces the properties that matter for testing:
 *   - a portrait aspect ratio, to prove aspect handling works
 *   - genuinely transparent margins, to prove alpha handling works
 *   - a thin sword blade, which is the hardest alpha edge in the design
 *   - a hard-edged magenta rim right / cyan rim left, matching the scene
 *     lights and the art prompt, so bloom can be tuned against it
 *
 * It is intentionally faceted and flat so it never gets mistaken for
 * finished art. Replace with loadCharacterTexture() once art exists.
 */
export function createPlaceholderCharacterTexture(
  options: PlaceholderOptions = {},
): THREE.CanvasTexture {
  const {
    width = 512,
    height = 1024,
    bodyColour = '#29081E',
    litColour = '#D9C7FF',
    rimRightColour = '#C61E82',
    rimLeftColour = '#22E0FF',
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable -- cannot build placeholder');
  }

  // Work in a normalised 0..1 space so the drawing scales with any size.
  const px = (x: number): number => x * width;
  const py = (y: number): number => y * height;

  const fillPath = (points: readonly [number, number][], colour: string): void => {
    if (points.length === 0) return;
    ctx.beginPath();
    const [first, ...rest] = points as [[number, number], ...[number, number][]];
    ctx.moveTo(px(first[0]), py(first[1]));
    for (const [x, y] of rest) ctx.lineTo(px(x), py(y));
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  };

  /* --- Sword: drawn first so the body overlaps its grip --- */
  fillPath(
    [
      [0.78, 0.30],
      [0.82, 0.30],
      [0.82, 0.88],
      [0.80, 0.92],
      [0.78, 0.88],
    ],
    bodyColour,
  );
  // Blade highlight -- a thin bright edge, the hardest alpha case to matte.
  fillPath(
    [
      [0.805, 0.31],
      [0.818, 0.31],
      [0.818, 0.87],
      [0.805, 0.87],
    ],
    rimRightColour,
  );
  // Crossguard.
  fillPath(
    [
      [0.72, 0.29],
      [0.88, 0.29],
      [0.88, 0.325],
      [0.72, 0.325],
    ],
    bodyColour,
  );

  /* --- Legs --- */
  fillPath([[0.38, 0.60], [0.47, 0.60], [0.46, 0.97], [0.36, 0.97]], bodyColour);
  fillPath([[0.53, 0.60], [0.62, 0.60], [0.64, 0.97], [0.54, 0.97]], bodyColour);

  /* --- Torso: faceted plate --- */
  fillPath(
    [
      [0.34, 0.30],
      [0.66, 0.30],
      [0.70, 0.45],
      [0.64, 0.63],
      [0.36, 0.63],
      [0.30, 0.45],
    ],
    bodyColour,
  );
  // Lit facet, upper left -- key light comes from upper front-left.
  fillPath([[0.34, 0.30], [0.50, 0.30], [0.50, 0.52], [0.33, 0.46]], litColour);

  /* --- Pauldrons --- */
  fillPath([[0.24, 0.30], [0.38, 0.27], [0.40, 0.38], [0.26, 0.40]], litColour);
  fillPath([[0.62, 0.27], [0.76, 0.30], [0.74, 0.40], [0.60, 0.38]], bodyColour);

  /* --- Head and helm --- */
  fillPath(
    [
      [0.42, 0.13],
      [0.58, 0.13],
      [0.60, 0.22],
      [0.50, 0.27],
      [0.40, 0.22],
    ],
    bodyColour,
  );
  fillPath([[0.42, 0.13], [0.50, 0.13], [0.50, 0.26], [0.41, 0.21]], litColour);

  /* --- Rim lights: hard-edged strokes INSIDE the silhouette ---
   *
   * Deliberately not a soft glow. Soft outward glow is what breaks matte
   * extraction on real art, and the scene's bloom pass is what should be
   * creating the visible halo. Keeping the rim hard here means the
   * placeholder behaves like correctly-prepared art will.
   */
  ctx.lineWidth = Math.max(3, width * 0.012);
  ctx.lineJoin = 'miter';

  ctx.strokeStyle = rimRightColour;
  ctx.beginPath();
  ctx.moveTo(px(0.66), py(0.30));
  ctx.lineTo(px(0.70), py(0.45));
  ctx.lineTo(px(0.64), py(0.63));
  ctx.lineTo(px(0.64), py(0.97));
  ctx.stroke();

  ctx.strokeStyle = rimLeftColour;
  ctx.beginPath();
  ctx.moveTo(px(0.34), py(0.30));
  ctx.lineTo(px(0.30), py(0.45));
  ctx.lineTo(px(0.36), py(0.63));
  ctx.lineTo(px(0.36), py(0.97));
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Draws a stand-in boss silhouette.
 *
 * A SEPARATE SHAPE, NOT A SCALED KNIGHT
 * -------------------------------------
 * The placeholder's job is to be unmistakably a placeholder AND
 * unmistakably the opponent. Reusing the party silhouette at 1.64x reads as
 * a party member standing closer to the camera, which is precisely the
 * misreading the composition has to avoid -- and it would make the shot
 * useless for judging whether party-left / boss-right actually works.
 *
 * 768x1024 rather than the party's 512x1024. At worldHeight 3.6 that is 2.7
 * units across: a low, broad stance the taller-than-wide party art cannot
 * produce at any scale.
 *
 * It obeys the same authoring contract as the party placeholder and
 * public/characters/README.md -- hard-edged rims inside the silhouette,
 * magenta right and cyan left, a generous transparent margin, key light
 * from the upper front-left -- so it doubles as the spec real boss art will
 * be measured against.
 */
export function createPlaceholderBossTexture(
  options: PlaceholderOptions = {},
): THREE.CanvasTexture {
  const {
    width = 768,
    height = 1024,
    /* Deliberately lighter than it looks like it should be. The first
       version used #1B0714, only 1.3x the #13060D backdrop's luminance, and
       the whole body dissolved into the sky -- the exact failure
       public/characters/README.md warns about under "value separation".
       This sits at ~2.4x, still menacing, still readable. */
    bodyColour = '#330C26',
    /* Rose rather than the party's pale lavender-white. Same key direction,
       different temperature: the antagonist should not be lit like a hero. */
    litColour = '#B02961',
    rimRightColour = '#C61E82',
    rimLeftColour = '#22E0FF',
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable -- cannot build boss placeholder');
  }

  const px = (x: number): number => x * width;
  const py = (y: number): number => y * height;

  type Point = readonly [number, number];

  const trace = (points: readonly Point[]): void => {
    const [first, ...rest] = points as [Point, ...Point[]];
    ctx.moveTo(px(first[0]), py(first[1]));
    for (const [x, y] of rest) ctx.lineTo(px(x), py(y));
  };

  const fillPath = (points: readonly Point[], colour: string): void => {
    if (points.length === 0) return;
    ctx.beginPath();
    trace(points);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  };

  /* --- ONE CONNECTED SILHOUETTE ------------------------------------
   *
   * Drawn as a single closed outline rather than assembled from separate
   * limb shapes, for one reason: the rim lights are strokes along THIS
   * path. The first version drew limbs independently and then placed rim
   * strokes at hand-picked coordinates, which put them somewhere in the
   * middle of the body instead of on its edge -- a rim light that does not
   * trace the silhouette reads as a crack, not as light.
   *
   * Clockwise from the left horn. Indices into this array are used below to
   * slice out the left and right edges, so inserting a point means checking
   * the two slice ranges.
   */
  const OUTLINE: readonly Point[] = [
    [0.42, 0.14], // 0  left horn root
    [0.34, 0.03], // 1  left horn tip
    [0.46, 0.11], // 2
    [0.54, 0.11], // 3
    [0.66, 0.03], // 4  right horn tip
    [0.58, 0.14], // 5  right horn root
    [0.61, 0.23], // 6  jaw right
    [0.71, 0.27], // 7  shoulder right
    [0.93, 0.15], // 8  right wing tip
    [0.87, 0.42], // 9  right wing lower
    [0.74, 0.47], // 10 right wing root
    [0.73, 0.62], // 11 hip right
    [0.81, 0.96], // 12 right foot outer
    [0.61, 0.96], // 13 right foot inner
    [0.56, 0.74], // 14
    [0.50, 0.82], // 15 crotch
    [0.44, 0.74], // 16
    [0.39, 0.96], // 17 left foot inner
    [0.19, 0.96], // 18 left foot outer
    [0.27, 0.62], // 19 hip left
    [0.26, 0.47], // 20 left wing root
    [0.13, 0.42], // 21 left wing lower
    [0.07, 0.15], // 22 left wing tip
    [0.29, 0.27], // 23 shoulder left
    [0.39, 0.23], // 24 jaw left
  ];

  fillPath(OUTLINE, bodyColour);

  /* --- Lit facets: upper LEFT, matching the scene key ---------------
   * Kept inside the silhouette and off the head, so the crown stays a
   * readable shape rather than merging into one bright mass. */
  fillPath(
    [
      [0.29, 0.27],
      [0.50, 0.30],
      [0.50, 0.66],
      [0.36, 0.60],
      [0.28, 0.44],
    ],
    litColour,
  );
  // Left wing, catching the same light.
  fillPath([[0.26, 0.47], [0.13, 0.42], [0.09, 0.22], [0.24, 0.34]], litColour);
  // Left horn.
  fillPath([[0.42, 0.14], [0.34, 0.03], [0.46, 0.11], [0.44, 0.19]], litColour);

  /* --- Rim lights: hard-edged strokes ALONG the outline -------------
   *
   * Sliced straight out of OUTLINE so they cannot drift off the edge.
   * Right side magenta, left side cyan -- the same agreement with the
   * scene's rim lights that the party art follows. */
  ctx.lineWidth = Math.max(3, width * 0.012);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';

  ctx.strokeStyle = rimRightColour;
  ctx.beginPath();
  trace(OUTLINE.slice(5, 14)); // jaw right -> right foot inner
  ctx.stroke();

  ctx.strokeStyle = rimLeftColour;
  ctx.beginPath();
  trace(OUTLINE.slice(18, 25)); // left foot outer -> jaw left
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Soft radial falloff used as the contact shadow's alpha map.
 * Opaque at the centre, fading to nothing at the edge.
 */
function createRadialFalloffTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable -- cannot build shadow');
  }

  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
