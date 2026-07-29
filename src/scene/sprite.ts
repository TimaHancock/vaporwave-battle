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

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `sprite-mesh:${name}`;

  /* Centre the plane so its bottom edge lands exactly on the floor. */
  mesh.position.y = groundedCentreY(size.height);

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

  return {
    group,
    mesh,
    shadow,
    name,
    size,

    headScreenPosition(camera: THREE.Camera) {
      /* Top of the sprite, in world space, then projected to clip space. */
      headWorld.set(group.position.x, size.height, group.position.z);
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
