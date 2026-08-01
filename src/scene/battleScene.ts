/**
 * The battle scene.
 *
 * Phase 0 scope: prove that geometry, materials, the camera rig, the
 * animation loop, and the disposal discipline all work end to end. There
 * are no characters yet -- Phase 4c adds sprite billboards.
 *
 * Everything here is primitive geometry generated in code. That is the
 * central economic argument for the 2.5D direction: the grid horizon, the
 * gradient sun, the chrome columns and the floating polyhedra are the
 * aesthetic, and none of them require an art asset.
 */

import * as THREE from 'three';
import { createRng, type Rng } from '../rng';
import { createCharacterSprite, type CharacterSprite } from './sprite';
import { assignRenderOrders, type Vec3 } from './spriteLayout';
import {
  buildBank,
  frameHalfWidth,
  terrainIndices,
  wireframeIndices,
  type BankOptions,
} from './mountains';
/* Type-only, so it erases at build time -- the scene shares battle
   vocabulary without taking a dependency on battle logic. */
import type { Side } from '../battle/types';

/* ------------------------------------------------------------------ */
/* Camera rig -- CANONICAL. Do not change without updating CLAUDE.md.  */
/* ------------------------------------------------------------------ */

/**
 * Perspective, not orthographic. A vaporwave grid horizon only reads
 * correctly with a real vanishing point, and the reference art clearly has
 * one. The long focal length (narrow fov) keeps perspective distortion off
 * the character sprites that arrive in Phase 4c -- wide-angle would splay
 * the outer party members outward and make flat art look bent.
 */
export const CAMERA = {
  fov: 32,
  position: new THREE.Vector3(0, 3.2, 11),
  target: new THREE.Vector3(0, 1.6, 0),
  near: 0.1,
  far: 200,
} as const;

/* ------------------------------------------------------------------ */
/* Palette -- mirrored in style.css. Change both or neither.           */
/* ------------------------------------------------------------------ */

/**
 * Sampled directly from the SideQuest Cyber site design rather than chosen
 * by eye. Two properties of that sample drive everything here:
 *
 *   1. The dark ground is a WARM plum (R > B), not a cool indigo. An
 *      indigo backdrop reads as a different brand the moment the game sits
 *      next to the site.
 *
 *   2. Cyan does not appear at all in the site's dominant colours -- it
 *      exists only as thin circuit traces on the clouds. It is an accent,
 *      not a co-lead with magenta. Use it for lines, not for fills or
 *      broad lighting.
 */
export const PALETTE = {
  /** Deepest background plum. */
  void: 0x13060d,
  /** Mid plum, the dominant field colour. */
  plum: 0x29081e,
  /**
   * Lit mountain rock. A lighter VALUE of the plum hue, not a new colour.
   *
   * The BRIGHT end of the terrain's ramp; `plum` is the shadowed end. Plum
   * itself is only a few points off the void, so terrain shaded within that
   * range came out as a black sheet with a wireframe on it -- the mass was
   * simply not there. The site's mountains are a clearly readable dark maroon
   * against a near-black sky, and this is that. Same hue family, same warm
   * bias (R > B); only the value moved.
   *
   * It has to carry further than it looks, because the terrain spans the
   * whole fog gradient: by the middle of the visible band fog has already
   * taken half of it back toward the void.
   */
  ridge: 0x7a2450,
  /** Hot magenta -- the brand's primary accent. */
  horizon: 0xc61e82,
  /** Secondary pink, for bands and softer accents. */
  rose: 0xb02961,
  /** Sunset orange, upper half of the sun gradient. */
  ember: 0xe8873a,
  /** Deep burnt orange, where the sun meets the magenta. */
  emberDeep: 0x9d461e,
  /** Pale lavender-white -- chrome surfaces and the key light. */
  chrome: 0xd9c7ff,
  /** Cyan. THIN LINE ACCENTS ONLY. Never a fill, never a broad light. */
  signal: 0x22e0ff,
} as const;

/* ------------------------------------------------------------------ */
/* Disposal registry                                                   */
/* ------------------------------------------------------------------ */

/**
 * three.js allocates geometry and texture memory on the GPU, which
 * JavaScript's garbage collector cannot reclaim. Every such resource must
 * be explicitly disposed.
 *
 * The registry makes this auditable: anything created goes in, teardown
 * walks the list, and the harness asserts that renderer.info.memory
 * returns to baseline. Without this, repeatedly restarting a battle leaks
 * until the tab dies.
 */
interface Disposable {
  dispose(): void;
}

export class DisposalRegistry {
  private readonly items: Disposable[] = [];

  track<T extends Disposable>(item: T): T {
    this.items.push(item);
    return item;
  }

  disposeAll(): void {
    for (const item of this.items) item.dispose();
    this.items.length = 0;
  }

  get size(): number {
    return this.items.length;
  }
}

/* ------------------------------------------------------------------ */
/* Scene construction                                                  */
/* ------------------------------------------------------------------ */

/** One character to place on the platform. */
export interface CastEntry {
  /**
   * Identifies the sprite, and doubles as the ActorId it corresponds to in
   * BattleState. That correspondence is what will let a `damage` event's
   * targetId resolve to a sprite and get a screen anchor from
   * headScreenPosition() when damage numbers arrive.
   */
  name: string;
  /**
   * Which side this character fights for. The scene uses it only to report
   * through the debug channel -- no rendering decision depends on it -- but
   * without it the harness cannot tell a party member from the boss, and
   * "the party stays left of frame" becomes unassertable.
   */
  side: Side;
  texture: THREE.Texture;
  /**
   * How tall the CHARACTER stands, in world units. ~2.2 reads as an adult
   * human against this platform. The sprite layer derives the plane from it
   * by dividing out the art's transparent margin -- see
   * CharacterSpriteOptions.
   */
  characterHeight?: number;
  /** Plane height, for art with no character to measure (placeholders). */
  worldHeight?: number;
  /** Feet position. y is ignored; sprites are always grounded. */
  position: Vec3;
  /** Override the default alpha cutoff for tricky art. */
  alphaTest?: number;
}

export interface BattleScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  registry: DisposalRegistry;
  /** Every character sprite currently on the platform. */
  readonly sprites: readonly CharacterSprite[];
  /**
   * Place a cast on the platform, replacing any existing one.
   *
   * Draw order is computed across the whole cast at once rather than per
   * sprite -- render order is a property of the group, and assigning it
   * incrementally is how sprites end up flickering past each other.
   */
  spawnCast(entries: readonly CastEntry[]): readonly CharacterSprite[];
  /** Remove and dispose the current cast. Leaves the environment intact. */
  clearCast(): void;
  /** Advance ambient animation to an absolute time, in seconds. */
  update(elapsedSeconds: number): void;
  dispose(): void;
}

export function createBattleScene(rng: Rng): BattleScene {
  const registry = new DisposalRegistry();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.void);

  /*
   * Distance fog. Three jobs, and the third one is new:
   *   1. sells depth on the flat grid
   *   2. hides the far edge of the plane, so the horizon reads as infinite
   *      rather than as a plane that stops
   *   3. recedes the mountain ranges -- their entire colour treatment is
   *      where they sit in this gradient
   *
   * far was 70 and is now 96. The grid was dissolving so early that the
   * "neon grid ocean" was three faint lines either side of the platform,
   * and the ranges had nowhere to sit between visible and gone. Moving it
   * re-tunes the ridges as much as the water: one decision, not two.
   *
   * WATCH THE SUN WHEN CHANGING THIS. The sun sets cleanly because the
   * water overtakes the disc ABOVE where the grid fades out; push the fade
   * far enough and the order flips, leaving the sun's cut edge hanging over
   * live grid lines. That is a screenshot check, not an assertion.
   */
  scene.fog = new THREE.Fog(PALETTE.void, 22, 96);

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    // Aspect is corrected on first resize; 16/9 is only a starting value.
    16 / 9,
    CAMERA.near,
    CAMERA.far,
  );
  camera.position.copy(CAMERA.position);
  camera.lookAt(CAMERA.target);

  /* --- Ocean surface ----------------------------------------------- */
  /*
   * An invisible occluder, not a visible surface.
   *
   * The grid below is bare LineSegments -- lines have no interior, so
   * without this the ocean does not block anything and the sun's lower half
   * hangs BELOW the horizon it should be setting behind. This plane is the
   * void colour against a void background and void fog, so it never reads
   * as a surface; its entire job is writing depth so the horizon cuts the
   * sun cleanly.
   *
   * It sits below the grid rather than level with it. Coplanar would just
   * trade one z-fight for another, and depth precision is worst out at the
   * grid's far edge where the two would be hardest to separate.
   */
  const oceanGeometry = registry.track(new THREE.PlaneGeometry(400, 400));
  const oceanMaterial = registry.track(
    new THREE.MeshBasicMaterial({ color: PALETTE.void }),
  );
  const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.9, -20);
  scene.add(ocean);

  /* --- Grid ocean ------------------------------------------------- */
  /* THREE.GridHelper is a LineSegments, so it renders as pure emissive
     colour with no lighting -- exactly the look wanted, and free. */
  /* Centre line magenta, minor lines rose. Cyan was previously the minor
     colour here and it over-weighted the palette -- the site uses cyan
     only for thin circuit traces, never as a structural colour. */
  const grid = new THREE.GridHelper(160, 80, PALETTE.horizon, PALETTE.rose);
  /*
   * y = -0.6 is the platform's underside, so the dais rests ON the ocean
   * and reads as raised above it.
   *
   * At y = 0 the grid was exactly coplanar with the platform's top face,
   * and three.js defaults to LessEqualDepth -- equal depth PASSES -- so
   * every grid line drew straight across the platform surface and the
   * arena looked painted onto the ocean rather than standing on it.
   * Separating them in depth is what lets the opaque platform occlude the
   * grid; it is not a cosmetic offset.
   *
   * The horizon does not move: a horizontal plane's vanishing line depends
   * on the camera's height, not the plane's, so only the near lines shift
   * down and the sun still sets at the same place.
   */
  grid.position.set(0, -0.6, -20);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of gridMaterials) {
    material.transparent = true;
    /* 0.55 -> 0.85. At the old value the ocean was a suggestion: a few lines
       either side of the platform and nothing further out, so the valley had
       no floor. It is the surface the whole composition stands on and it
       should read as one. Still short of 1.0 -- the grid is neon on water,
       not a wireframe drawn on top of the scene. */
    material.opacity = 0.85;
    registry.track(material);
  }
  registry.track(grid.geometry);
  scene.add(grid);

  /* --- Sun -------------------------------------------------------- */
  /* A vertical gradient painted into a canvas texture, on a circle. A
     shader would be marginally cheaper but far less legible to edit. */
  /*
   * DISTANCE IS LOAD-BEARING, not just scale.
   *
   * The ocean can only hide the sun where the ocean is NEARER to the camera
   * than the sun is. Every screen row below the horizon corresponds to a
   * further point on the water, running out to infinity at the horizon
   * itself -- so a close sun pokes out below it no matter how big the ocean
   * plane is. At the original 42 units the water only overtook it near the
   * very bottom of the disc, which is why it hung below the horizon looking
   * like it was floating in front of the sea rather than setting into it.
   *
   * At 100 units the water overtakes the disc at screen y ~224, above where
   * the grid fades into the fog (~246), so the sun sets cleanly behind the
   * horizon. Radius and height are scaled with the distance to hold exactly
   * the same apparent size and position in frame -- this is a depth change,
   * not a composition change. Keep the three values in step if you move it.
   *
   * Fog would swallow it at this range (fog ends at 70), hence fog: false.
   */
  const sunGeometry = registry.track(new THREE.CircleGeometry(12.57, 64));
  const sunTexture = registry.track(createGradientTexture());
  const sunMaterial = registry.track(
    new THREE.MeshBasicMaterial({ map: sunTexture, transparent: true, fog: false }),
  );
  const sun = new THREE.Mesh(sunGeometry, sunMaterial);
  sun.position.set(0, 5.31, -100);
  scene.add(sun);

  /* --- Mountain valley -------------------------------------------- */
  /*
   * Two banks of terrain flanking a corridor of water, beginning just past
   * the arena and running back until the fog takes them.
   *
   * REAL HEIGHTFIELD, NOT CUTOUTS. This was three flat silhouette curtains at
   * fixed depths, on the argument that a locked camera never moves to reveal
   * they are flat. True and beside the point: flat was not a problem because
   * it could be seen through, it was a problem because three parallel cutouts
   * read as painted flats in a theatre. Land that runs continuously away from
   * the viewer is a different image, and no number of layers gets you there.
   *
   * The corridor is the composition. mountains.ts owns it, and owns the one
   * constraint that matters: no vertex may enter the channel at its own
   * depth, at any seed -- the arena binds it near, the sun's window binds it
   * far, and in between it converges hard in frame, which is the depth cue
   * the cutouts could not produce.
   *
   * Fog is doing MORE work than before, not less. The terrain now spans from
   * inside fog.near out to fog.far, so fog is the entire near-to-far value
   * range rather than the separation between three chosen depths. Move it and
   * you have re-tuned the mountains whether you meant to or not.
   */
  const BANKS: readonly BankOptions[] = [
    /* Same seed draws both, so the two banks are mirror images. That is
       deliberate: an asymmetric valley reads as one bank being wrong rather
       than as variety, at a locked camera that always frames both. */
    { side: -1, columns: 40, rows: 56, roughness: 0.75, octaveCells: 7 },
    { side: 1, columns: 40, rows: 56, roughness: 0.75, octaveCells: 7 },
  ];

  const terrainMaterial = registry.track(
    /* Unlit, and vertex-coloured. The shading is BAKED by mountains.ts from
       the sun's position -- the only light source actually in frame -- rather
       than lit by the scene rig. That rig is a contract with the CHARACTER
       ART, where lighting is painted into the image; pulling the backdrop
       into it would mean every future light change had to be judged against
       mountains as well as faces. */
    new THREE.MeshBasicMaterial({ vertexColors: true }),
  );

  const latticeMaterial = registry.track(
    /* Cyan, and this is the one place the palette rule allows it: "a thin
       line accent, never a fill". A lattice is thin lines, and it is the SAME
       material language as the grid ocean -- neon lines over dark mass -- so
       the land and the water read as one world rather than two treatments.
       If it ever over-weights the composition, PALETTE.horizon is the
       fallback, not a wider cyan.

       Fog ON. Without it a lattice at z = -85 blazes at full strength while
       the mass under it has already dissolved to void. */
    new THREE.LineBasicMaterial({
      color: PALETTE.signal,
      transparent: true,
      /* Low. The lattice is a HIGHLIGHT on rock, not the drawing of it -- at
         0.28 the near banks read as a net thrown over the corners of the
         frame and competed with the grid ocean for the same job. */
      opacity: 0.16,
    }),
  );

  /* The value ramp the baked shade indexes into. Both ends are existing
     palette entries in the same hue family: shadowed ground sits at plum,
     lit rock at the lighter ridge value. A shade is a VALUE, not a colour --
     mountains.ts hands back 0..1 and this is the only place that decides
     what those two ends are. */
  const terrainShadow = new THREE.Color(PALETTE.plum);
  const terrainLit = new THREE.Color(PALETTE.ridge);
  const terrainColor = new THREE.Color();

  for (const options of BANKS) {
    /* A fresh generator per bank, from the same seed, rather than draws off
       the shared stream. Two reasons: both banks then come out as mirror
       images of each other, and changing the terrain's resolution cannot
       reroll the battle sitting downstream of it. */
    const bank = buildBank(createRng(rng.seed), options);

    const positions = new Float32Array(bank.vertices.length * 3);
    const colors = new Float32Array(bank.vertices.length * 3);
    for (let i = 0; i < bank.vertices.length; i++) {
      const vertex = bank.vertices[i]!;
      positions.set([vertex.x, vertex.y, vertex.z], i * 3);
      terrainColor.copy(terrainShadow).lerp(terrainLit, vertex.shade);
      colors.set([terrainColor.r, terrainColor.g, terrainColor.b], i * 3);
    }

    const positionAttribute = new THREE.BufferAttribute(positions, 3);

    const bodyGeometry = registry.track(new THREE.BufferGeometry());
    bodyGeometry.setAttribute('position', positionAttribute);
    bodyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    /* The side decides the winding. A bank's columns run outward, so the two
       banks wind opposite ways and one index order would cull one of them
       entirely -- see terrainIndices. */
    bodyGeometry.setIndex(terrainIndices(bank.columns, bank.rows, options.side));
    scene.add(new THREE.Mesh(bodyGeometry, terrainMaterial));

    /* The lattice shares the body's position buffer -- one upload, and the
       lines cannot drift off the surface they are drawn on. Every 4th row and
       column: at step 1 it is a mesh on screen rather than a grid over rock. */
    const latticeGeometry = registry.track(new THREE.BufferGeometry());
    latticeGeometry.setAttribute('position', positionAttribute);
    latticeGeometry.setIndex(wireframeIndices(bank.columns, bank.rows, 4));
    scene.add(new THREE.LineSegments(latticeGeometry, latticeMaterial));
  }

  /* --- Stars ------------------------------------------------------- */
  /*
   * Behind the sun, so the disc occludes them rather than letting a starfield
   * show through it. `fog: false` for the same reason the sun sets it: at
   * this range fog would erase them completely.
   *
   * Seeded, so the sky is the same sky every run -- a drifting starfield
   * would break the screenshot baseline for no gain.
   */
  const STAR_Z = -120;
  /* Scattered across the frame at that depth, not across an arbitrary span.
     The first version used +/-160 where the frame is only about +/-67 wide
     there, so four stars in five were thrown outside the view and the sky
     came out nearly empty. Deriving the bound from the frustum means the
     count is the number of stars you actually SEE. */
  const starSpread = Math.round(frameHalfWidth(STAR_Z));
  const starCount = 140;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPositions.set(
      [
        rng.int(-starSpread, starSpread),
        /* Upper sky only. Below this the mountains and the sun own the
           frame, and a star behind a silhouette is wasted geometry. */
        rng.int(12, 40),
        STAR_Z,
      ],
      i * 3,
    );
  }
  const starGeometry = registry.track(new THREE.BufferGeometry());
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = registry.track(
    new THREE.PointsMaterial({
      color: PALETTE.chrome,
      /*
       * PIXELS, not world units -- sizeAttenuation off.
       *
       * With attenuation on, a star 130 units away is drawn at whatever
       * fraction of a pixel its world size projects to, which is to say it
       * is not drawn at all. That is not a size to be tuned upward either:
       * a star large enough to survive the projection would be a boulder if
       * it ever came close. Stars are infinitely distant by definition, so
       * a fixed screen size is the honest model.
       */
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.75,
      fog: false,
    }),
  );
  scene.add(new THREE.Points(starGeometry, starMaterial));

  /* --- Combat platform -------------------------------------------- */
  const platformGeometry = registry.track(new THREE.CylinderGeometry(6, 6.4, 0.6, 48));
  const platformMaterial = registry.track(
    new THREE.MeshStandardMaterial({
      color: PALETTE.chrome,
      roughness: 0.25,
      metalness: 0.8,
    }),
  );
  const platform = new THREE.Mesh(platformGeometry, platformMaterial);
  platform.position.set(0, -0.3, 0);
  scene.add(platform);

  /* --- Chrome columns --------------------------------------------- */
  const columnGeometry = registry.track(new THREE.CylinderGeometry(0.35, 0.42, 6, 24));
  const columnMaterial = registry.track(
    new THREE.MeshStandardMaterial({
      color: PALETTE.chrome,
      /* Roughness broadens and dims the key-light glint. At 0.15 the highlight
         was a pinpoint that clipped to white and bloomed into a harsh star;
         0.5 spreads it into a soft sheen the bloom pass no longer blows out.
         Emissive neon is unaffected, so grid/sun/edge glow is unchanged. */
      roughness: 0.5,
      metalness: 0.9,
    }),
  );
  for (const x of [-5.2, 5.2]) {
    const column = new THREE.Mesh(columnGeometry, columnMaterial);
    column.position.set(x, 2.7, -1.5);
    scene.add(column);
  }

  /* --- Floating polyhedra ----------------------------------------- */
  /* The d20s and cubes from the reference art. An icosahedron is one line
     of code and zero art budget -- this is why 2.5D is cheaper than 2D for
     this specific aesthetic. */
  const dieGeometry = registry.track(new THREE.IcosahedronGeometry(0.5, 0));
  const dieMaterial = registry.track(
    new THREE.MeshStandardMaterial({
      color: PALETTE.signal,
      emissive: PALETTE.horizon,
      /* Emissive drives the magenta neon glow -- left untouched so the dice
         keep blooming the same. The specular facets read too bright against
         the scene, so roughness is raised (-> 0.7, broadens/dims the glint)
         and metalness lowered (-> 0.35, shifts more of the key light into
         soft diffuse rather than a hot mirror highlight). */
      emissiveIntensity: 0.35,
      roughness: 0.7,
      metalness: 0.35,
      flatShading: true,
    }),
  );

  const dice: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const die = new THREE.Mesh(dieGeometry, dieMaterial);
    die.position.set(
      rng.int(-70, 70) / 10,
      rng.int(15, 55) / 10,
      rng.int(-90, 10) / 10,
    );
    die.userData['spin'] = rng.int(3, 9) / 10;
    die.userData['bobPhase'] = rng.next() * Math.PI * 2;
    die.userData['baseY'] = die.position.y;
    dice.push(die);
    scene.add(die);
  }

  /* --- Lighting ----------------------------------------------------
   *
   * THIS RIG IS A CONTRACT WITH THE CHARACTER ART.
   *
   * Sprites use MeshBasicMaterial, so these lights never touch them --
   * the lighting is painted into the image. That makes the agreement
   * between this rig and the art a matter of authoring discipline rather
   * than something the renderer can enforce, which is exactly why it is
   * written down in three places: here, in CLAUDE.md, and in the image
   * generation prompt.
   *
   * The rig in words, which is what the art prompt encodes:
   *   Key    -- pale lavender-white, upper FRONT-LEFT of frame, ~40 deg
   *             elevation. Left-facing surfaces lit, right side in shadow.
   *   Rim R  -- hot magenta along the RIGHT silhouette edge.
   *   Rim L  -- cyan along the LEFT silhouette edge, thin.
   *
   * If you change a light here, change the prompt. Otherwise every
   * character generated afterwards will disagree with the environment.
   */
  const key = new THREE.DirectionalLight(PALETTE.chrome, 2.2);
  key.position.set(-4, 6, 6);
  scene.add(key);

  const rimMagenta = new THREE.DirectionalLight(PALETTE.horizon, 1.6);
  rimMagenta.position.set(6, 2, -4);
  scene.add(rimMagenta);

  /* Cyan is an accent, not a co-lead -- dimmed to match how sparingly the
     site design uses it. It should catch an edge, not tint the scene. */
  const rimCyan = new THREE.DirectionalLight(PALETTE.signal, 0.55);
  rimCyan.position.set(-6, 1, -5);
  scene.add(rimCyan);

  scene.add(new THREE.AmbientLight(PALETTE.ember, 0.25));

  /* --- Character cast ----------------------------------------------- */

  /* Sprites are tracked separately from the environment registry because
     they have a different lifetime: the cast is replaced when a battle
     restarts, while the arena persists. Mixing the two is how a teardown
     ends up either leaking sprite textures or destroying the platform. */
  const cast: CharacterSprite[] = [];

  const clearCast = (): void => {
    for (const sprite of cast) {
      scene.remove(sprite.group);
      sprite.dispose();
    }
    cast.length = 0;
  };

  return {
    scene,
    camera,
    registry,

    get sprites(): readonly CharacterSprite[] {
      return cast;
    },

    spawnCast(entries: readonly CastEntry[]) {
      clearCast();

      /* One pass over the whole cast so draw order is globally consistent. */
      const orders = assignRenderOrders(entries.map((entry) => entry.position));

      entries.forEach((entry, index) => {
        const sprite = createCharacterSprite({
          texture: entry.texture,
          position: entry.position,
          renderOrder: orders[index] ?? 0,
          name: entry.name,
          side: entry.side,
          ...(entry.characterHeight === undefined
            ? {}
            : { characterHeight: entry.characterHeight }),
          ...(entry.worldHeight === undefined ? {} : { worldHeight: entry.worldHeight }),
          ...(entry.alphaTest === undefined ? {} : { alphaTest: entry.alphaTest }),
        });
        cast.push(sprite);
        scene.add(sprite.group);
      });

      return cast;
    },

    clearCast,

    update(elapsedSeconds: number) {
      for (const die of dice) {
        const spin = die.userData['spin'] as number;
        const phase = die.userData['bobPhase'] as number;
        const baseY = die.userData['baseY'] as number;
        die.rotation.x = elapsedSeconds * spin;
        die.rotation.y = elapsedSeconds * spin * 0.7;
        die.position.y = baseY + Math.sin(elapsedSeconds * 0.8 + phase) * 0.25;
      }
    },

    dispose() {
      /* Cast first: its textures are not in the environment registry, so
         disposing the registry alone would leak every character texture. */
      clearCast();
      scene.clear();
      registry.disposeAll();
    },
  };
}

/**
 * Paints the sunset gradient into a 2D canvas and wraps it as a texture.
 * Kept here rather than as an image file so the palette lives in one place
 * and can be tuned without round-tripping through an art tool.
 */
function createGradientTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable -- cannot build sun texture');
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, '#ffe66d');
  gradient.addColorStop(0.45, '#ff9a3c');
  gradient.addColorStop(1, '#ff2d95');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
