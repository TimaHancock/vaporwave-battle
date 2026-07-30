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

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface CharacterSpriteOptions {
  /** Loaded character texture. Must have transparency already applied. */
  texture: THREE.Texture;
  /** How tall the character stands, in world units. ~2.2 reads as human. */
  worldHeight: number;
  /** Where the character's feet go. y is ignored; feet always sit on ground. */
  position: Vec3;
  /** Draw sequence, from assignRenderOrders(). Furthest sprite gets lowest. */
  renderOrder: number;
  /** Name for debugging and for finding the sprite later. */
  name: string;

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
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uHighlightKnee'] = { value: knee };
    shader.uniforms['uHighlightCeiling'] = { value: ceiling };

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
  material.customProgramCacheKey = () =>
    `characterHighlightRolloff:${knee}:${ceiling}`;
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
    position,
    renderOrder,
    name,
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
  const size = spriteDimensions(pixelWidth, pixelHeight, worldHeight);

  /* --- Where the character actually is inside its image -------------- */

  /* The image's edges are not the character's edges. Both grounding and
     head placement need the content, not the canvas. */
  const bounds = opaqueBounds(texture, pixelWidth, pixelHeight, alphaTest);

  /** Fraction of the image height that is empty below the feet. */
  const feetInset = bounds === null ? 0 : (pixelHeight - 1 - bounds.maxY) / pixelHeight;
  /** Fraction of the image height that is empty above the head. */
  const headInset = bounds === null ? 0 : bounds.minY / pixelHeight;

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

  applyHighlightRolloff(material, highlightKnee, highlightCeiling);

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

  /* Flat art standing in a 3D scene looks pasted on without this. It is
     one mesh and one small texture, and it does more for believability
     than any other single thing in the sprite layer. */
  let shadow: THREE.Mesh | null = null;
  let shadowTexture: THREE.CanvasTexture | null = null;

  if (shadowOpacity > 0) {
    const shadowSize = contactShadowSize(size.height);
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

  /* --- Public interface ---------------------------------------------- */

  const headWorld = new THREE.Vector3();

  /* The plane's top edge is empty margin; the character's crown is lower.
     For a 2.2-unit sprite with a 4% top margin that is ~17 screen pixels,
     which is the difference between a damage number over the head and one
     floating in the air above it. */
  const contentHeight = size.height * (1 - feetInset - headInset);

  return {
    group,
    mesh,
    shadow,
    name,
    size,
    feetInset,
    contentHeight,

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
