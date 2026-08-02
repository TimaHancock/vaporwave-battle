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
import {
  assignRenderOrders,
  BURST_RENDER_ORDER,
  type Vec3,
} from './spriteLayout';
import {
  buildBank,
  frameHalfWidth,
  terrainIndices,
  type BankOptions,
} from './mountains';
import { recoilDirection, shardCountFor } from './impact';
import { shardAt, spawnShards, type Shard } from './burst';
import {
  arenaEmission,
  colonnadePositions,
  COLUMN_FACETS,
  DAIS_FACETS,
  DAIS_TIERS,
  routeDeck,
  type ArenaMood,
  type DeckArt,
} from './arena';
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

/**
 * The deck's trace emission with the fight at rest.
 *
 * `setMood` scales it. Held as a constant rather than read back off the
 * material, because after one scaling the material no longer knows where it
 * started -- the same reason the rim keeps its rest colour.
 */
const DECK_EMISSIVE_REST = 0.3;

/* ------------------------------------------------------------------ */
/* Impact debris                                                       */
/* ------------------------------------------------------------------ */

/**
 * How many shards the pool can hold at once.
 *
 * A critical throws 28 and the sequencer can commit two blows in a turn, so
 * this is roughly three overlapping criticals' worth. Fixed rather than grown
 * on demand because an InstancedMesh's capacity is baked into its buffers --
 * resizing means new GPU allocations mid-fight, which is exactly what the
 * DisposalRegistry exists to keep countable.
 *
 * Overflowing DROPS the newest shards rather than the oldest. A burst already
 * on screen mid-flight is a thing the player is watching; truncating the tail
 * of a new one is invisible at these counts.
 */
const SHARD_CAPACITY = 96;

/**
 * How far past white a shard burns at the moment of impact.
 *
 * Deliberately past 1 and into HDR, which is what the bloom pass is looking
 * for: magenta at its authored value has a luminance of about 0.29 against a
 * 0.68 threshold, so an unscaled shard is a small dark chip rather than a
 * spark. Scaling it means the burst GLOWS at impact and cools below the
 * threshold as it fades, so the bloom does the work of the fade for free.
 *
 * THE SAME TUNING CAUTION AS THE IMPACT FLASH, and it turned out to matter
 * here too: at 3 the shards clipped to white and, because they are additive
 * and start on top of one another, the overlapping ones summed past that into
 * a single blown-out blob with no pieces in it. A hair over the threshold, not
 * far over -- the colour is the only thing distinguishing a hit from a
 * critical here, and white is neither.
 */
const SHARD_EMISSION = 2.2;

/** One shard in flight, and where it came from. */
interface LiveShard {
  shard: Shard;
  /** Scene-clock time the blow landed, in seconds. */
  at: number;
  /** Impact point in world space. Poses from `burst.ts` are relative to it. */
  origin: Vec3;
  colour: THREE.Color;
}

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
  /**
   * Point the arena's neon at the state of the fight.
   *
   * READ-ONLY on the caller's side of the line: the renderer is handed two
   * numbers already on screen in the HUD and never writes back. Fed from
   * `refresh()` in main.ts, which is the single place the interface is
   * rebuilt from state -- so the arena cannot be describing a moment the
   * cards and the log are not.
   */
  setMood(mood: ArenaMood): void;
  /**
   * Make a character react to being hit.
   *
   * Event-driven, like the float layer and for the same reason: "kira was hit
   * for 145" is not recoverable from the state afterwards, only from the event
   * that caused it. `at` is a scene-clock time in seconds.
   *
   * Unknown ids are ignored rather than throwing. A sprite can legitimately be
   * absent -- the cast is spawned after the first render, and a battle can
   * resolve events for an actor whose art failed to load -- and a missing
   * flinch is not worth taking the frame down for.
   */
  reactToHit(targetId: string, sourceId: string, isCritical: boolean, at: number): void;
  /**
   * How many shard bursts have been fired since the scene was built.
   *
   * Published because the burst is otherwise INVISIBLE to every channel but
   * the screenshot. It is driven by the scene clock, and the e2e suite halts
   * that clock with `?time=0` -- so a burst there is spawned, sits at age 0
   * and never moves. A counter is the only thing an assertion can hold on to,
   * and "a hit fires a burst; reduced motion fires none" is worth holding.
   */
  readonly bursts: number;
  /** How many shards are currently in the air. */
  readonly shardsAlive: number;
  dispose(): void;
}

/**
 * Whether the scene is allowed to move things that do not have to move.
 *
 * Read once at construction rather than per frame: the query is cheap but the
 * answer is a user preference, not a per-frame decision, and reading it in the
 * update loop invites treating it as one.
 *
 * NOTE THE ASYMMETRY WITH THE FLOAT LAYER. There, `animation: none` under
 * reduced motion would be a BUG -- removal is driven by `animationend`, so a
 * number that never animates never leaves. Nothing here waits on an animation
 * to finish, so switching the stagger off is simply switching it off. The
 * flash still fires: a colour changing in place is not what anybody means by
 * motion.
 */
function motionIsWelcome(): boolean {
  if (typeof window === 'undefined' || window.matchMedia === undefined) return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createBattleScene(rng: Rng): BattleScene {
  const allowMotion = motionIsWelcome();
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

  /*
   * What the chrome reflects.
   *
   * THE FINDING THIS WHOLE ARENA PASS RESTS ON: a metal surface has
   * essentially no diffuse term. What it shows you is what it reflects, and
   * until now there was no environment map anywhere in this project -- so
   * ~80% of `metalness: 0.8` was inert and the pale lavender platform was the
   * 20% dielectric remainder catching the key light. The chrome was not
   * reading as chrome because it could not.
   *
   * Painted from the palette rather than shipped as an asset, the same
   * argument as createGradientTexture: it is the aesthetic, and the aesthetic
   * is code. It approximates the real scene -- sunset band behind, plum sky
   * above, magenta waterline, dark below -- rather than capturing it.
   *
   * DELIBERATELY NOT PMREMGenerator, which needs the renderer that
   * createBattleScene has no reference to. Assigning an equirect texture to
   * scene.environment gets it PMREM'd by the renderer on first use anyway, so
   * the signature stays clean and nothing is lost.
   *
   * It reaches EVERY MeshStandardMaterial in the scene, dice included. That
   * is a scene-wide decision wearing a platform-shaped hat; per-material
   * envMapIntensity is where each surface says how much of it it wants.
   */
  const environmentTexture = registry.track(createEnvironmentTexture());
  scene.environment = environmentTexture;

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
    { side: -1, columns: 40, rows: 56, roughness: 0.8, octaveCells: 7 },
    { side: 1, columns: 40, rows: 56, roughness: 0.8, octaveCells: 7 },
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

  /*
   * NO NEON LATTICE OVER THE ROCK, currently.
   *
   * There was one -- a LineSegments in PALETTE.signal built from
   * `wireframeIndices`, which is still in mountains.ts and still tested. The
   * argument for it was material continuity with the grid ocean: neon lines
   * over dark mass, one language for land and water. The argument against is
   * what the shots showed, which is that the water already carries that
   * language and a second net competing for it made the near banks read as
   * mesh rather than rock. The body's baked shading is doing the form on its
   * own.
   *
   * Restoring it is a LineSegments sharing the body's position attribute with
   * `wireframeIndices(columns, rows, 4)` as its index.
   */

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

  /* --- Combat dais -------------------------------------------------- */
  /*
   * Faceted tiers from arena.ts: deck plate, chamfer, drum, footing. Two of
   * those numbers are a contract -- the deck's top face is y 0 and its radius
   * is PLATFORM_RADIUS -- and the module's tests hold them.
   *
   * This was a single CylinderGeometry(6, 6.4, 0.6, 48). Faceting is the
   * bigger half of why that read as painted plastic: 48 segments is the one
   * round thing in a scene of cut planes, and a smooth cylinder averages the
   * key light into a single gradient where facets break it into planes.
   *
   * The other half is the material, and it is fixed above by scene.environment
   * -- see createEnvironmentTexture.
   */
  const daisMaterial = registry.track(
    new THREE.MeshStandardMaterial({
      /* DARK, and not `chrome`, which is where this started and why the deck
         kept coming out as a cream sheet. A metal's reflection is TINTED BY
         ITS OWN COLOUR: at `chrome` (0xd9c7ff, near white) a floor this size
         can only ever be bright, whatever the environment does, and it
         outshone the characters standing on it. At `ridge` it is a dark
         maroon mirror -- the sunset lands on it as a warm sheen instead of a
         wash, and the cast reads against it.

         The columns stay chrome. Deck and columns wanting different values is
         a composition fact, not an inconsistency: one is a large field that
         should recede, the other is a narrow vertical that can carry a
         highlight. */
      color: PALETTE.ridge,
      /* Roughness on a metal BLURS THE REFLECTION; with no env map it only
         broadened a specular dot, so the old 0.25 was tuned against a
         different problem entirely. At 0.18 the deck was a near-perfect
         mirror, and a near-horizontal mirror under this camera reflects one
         direction -- about 8 degrees up, straight down -Z, which is exactly
         where the sun is. The whole deck came out a flat cream sheet. 0.4
         spreads it over enough of the sky to become a gradient. */
      roughness: 0.3,
      metalness: 0.9,
      /* And the reflection is a SUGGESTION of the sky, not a window onto it.
         At 1.0 over a near-white base the deck outshone the characters
         standing on it; the arena is the stage, not the subject. Over a dark
         base it can carry more. */
      envMapIntensity: 0.7,
      /* Facets, so each plane gets one normal and the light steps between
         them rather than sweeping across. */
      flatShading: true,
    }),
  );

  /*
   * The deck face is its own material, darker than the structure under it.
   *
   * Not a stylistic split -- a compositional one. The deck is the largest
   * unbroken surface in the lower half of frame and the characters have to
   * read against it, so it recedes; the drum and chamfer are narrow bands
   * that can carry a highlight without competing.
   *
   * It is also flat and horizontal, which means every pixel reflects nearly
   * the same direction and it can only ever be ONE VALUE. Facets do nothing
   * for it. Breaking it up is what the deck markings are for.
   */
  const deckTexture = registry.track(
    createDeckTexture(routeDeck(createRng(rng.seed))),
  );
  const deckMaterial = registry.track(
    new THREE.MeshStandardMaterial({
      color: PALETTE.plum,
      roughness: 0.45,
      metalness: 0.9,
      envMapIntensity: 0.6,
      /* White, so the canvas carries the colour rather than tinting it a
         second time. Black pixels in the map emit nothing and the metal
         shows through. */
      emissive: 0xffffff,
      emissiveMap: deckTexture,
      /* Low. Emissive on a pure cyan map is neon tubing at anything near 1,
         and this is meant to be line work INLAID in a floor -- lit enough to
         read, not lit enough to light the room. */
      emissiveIntensity: DECK_EMISSIVE_REST,
      flatShading: true,
    }),
  );

  for (const tier of DAIS_TIERS) {
    const geometry = registry.track(
      new THREE.CylinderGeometry(
        tier.topRadius,
        tier.bottomRadius,
        tier.height,
        DAIS_FACETS,
      ),
    );
    const mesh = new THREE.Mesh(
      geometry,
      tier.name === 'deck' ? deckMaterial : daisMaterial,
    );
    /* CylinderGeometry is centred on its own origin, so the tier's top face
       lands at topY by dropping the centre half its height. */
    mesh.position.set(0, tier.topY - tier.height / 2, 0);
    scene.add(mesh);
  }

  /* --- Deck rim ----------------------------------------------------- */
  /*
   * A neon edge on the lip. Cyan is a thin line accent and this is one, but
   * magenta is the right call here: the rim traces the boundary between the
   * arena and the water, and the grid ocean it meets is already magenta.
   *
   * A TorusGeometry rather than a Line, because a line is one pixel wide at
   * any distance and this needs to read as an edge with a glow, not a
   * hairline. Emissive above the bloom threshold so the pass finds it.
   */
  const rimGeometry = registry.track(
    new THREE.TorusGeometry(DAIS_TIERS[0]!.topRadius, 0.045, 6, DAIS_FACETS * 2),
  );
  /* MeshBasicMaterial has no `emissiveIntensity`, so the reactive brightness
     rides on `color` -- scaled past 1 into HDR, which is exactly what the
     bloom pass is looking for. `restColour` is the value it scales from, held
     because a colour that has been scaled cannot be scaled back to where it
     started without knowing where that was. */
  const rimRestColour = new THREE.Color(PALETTE.horizon);
  const rimHotColour = new THREE.Color(PALETTE.ember);
  const rimMaterial = registry.track(
    new THREE.MeshBasicMaterial({ color: PALETTE.horizon }),
  );
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.rotation.x = -Math.PI / 2;
  /* On the deck's own edge, a hair below the face so it cannot z-fight with
     the contact shadows sitting at y 0.012. */
  rim.position.set(0, -0.02, 0);
  scene.add(rim);

  /* --- Colonnade ---------------------------------------------------- */
  /*
   * Five columns on an arc behind the fight, from arena.ts. It was two, at
   * the extreme left and right, which read as a doorway the battle happened
   * in front of rather than a room it happened inside.
   *
   * Positions are constrained rather than placed: behind the line of battle,
   * on the deck, clear of every character. arena.test.ts asserts that against
   * the real cast layout, so re-laying out the party fails there rather than
   * in a screenshot three changes later.
   */
  const COLUMN_HEIGHT = 6.4;
  const columnGeometry = registry.track(
    new THREE.CylinderGeometry(0.26, 0.34, COLUMN_HEIGHT, COLUMN_FACETS),
  );
  const columnMaterial = registry.track(
    new THREE.MeshStandardMaterial({
      color: PALETTE.chrome,
      /* Roughness broadens and dims the key-light glint. At 0.15 the highlight
         was a pinpoint that clipped to white and bloomed into a harsh star;
         0.5 spreads it into a soft sheen the bloom pass no longer blows out.
         Emissive neon is unaffected, so grid/sun/edge glow is unchanged.
         Held at 0.5 while the dais goes to 0.18: a column is a narrow
         near-vertical sliver, so a sharp reflection on one is a hard streak
         rather than a picture of the sky. */
      roughness: 0.5,
      metalness: 0.9,
      envMapIntensity: 0.5,
      flatShading: true,
    }),
  );

  /* A magenta band on each column, the same accent as the deck rim. Shared
     geometry and material across all of them, so it is one more draw call
     each and no more allocations.

     Its height is a FRAMING number, not a decorative one. It started near the
     top of the column, where nothing could see it: the columns are 6.4 tall
     and run off the top of the frame, so a band at 5.5 sits about half a
     degree outside the fov. Anything meant to be seen on a column has to be
     below roughly y 4.5. */
  const collarGeometry = registry.track(
    new THREE.CylinderGeometry(0.3, 0.3, 0.14, COLUMN_FACETS),
  );
  const collarMaterial = registry.track(
    new THREE.MeshBasicMaterial({ color: PALETTE.horizon }),
  );
  const collarRestColour = new THREE.Color(PALETTE.horizon);

  for (const position of colonnadePositions()) {
    const column = new THREE.Mesh(columnGeometry, columnMaterial);
    column.position.set(position.x, COLUMN_HEIGHT / 2, position.z);
    scene.add(column);

    const collar = new THREE.Mesh(collarGeometry, collarMaterial);
    collar.position.set(position.x, 4.2, position.z);
    scene.add(collar);
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
      /* Low. These were tuned against the bloom threshold with no environment
         at all, and scene.environment reaches every MeshStandardMaterial --
         so without this the arena pass would quietly re-light the dice. */
      envMapIntensity: 0.25,
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

  /* --- Impact debris ------------------------------------------------- */
  /*
   * One pooled InstancedMesh for every burst in the game, not one mesh per
   * blow. A hit is a frequent event in a turn-based fight and allocating
   * geometry per hit would put a GPU allocation on the critical path of the
   * one moment that is meant to feel immediate -- and every one of them would
   * have to reach the DisposalRegistry or leak.
   *
   * DOUBLE-SIDED, and that is not a detail. A shard tumbles on all three axes,
   * so a single-sided quad is invisible for half of its own rotation -- which
   * does not read as a lighting bug, it reads as the debris flickering.
   *
   * Frustum culling OFF. An InstancedMesh's bounding sphere is computed from
   * its geometry, not from where the instances have been moved to, so a burst
   * whose shards fly past that sphere is culled wholesale and the effect
   * vanishes for no visible reason. The mesh is one draw call at the centre of
   * frame; there is nothing to save by culling it.
   */
  const shardGeometry = registry.track(new THREE.PlaneGeometry(1, 1));
  const shardMaterial = registry.track(
    new THREE.MeshBasicMaterial({
      /* White, so `instanceColor` carries both the hue and the fade. */
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      /* Additive, so fading a shard's colour to black IS fading it out -- no
         per-instance opacity, and therefore no custom shader. It also means
         the debris adds light to the scene rather than cutting holes in it,
         which is the right model for neon. */
      blending: THREE.AdditiveBlending,
      /* Nothing occludes an additive spark, and writing depth would let one
         shard cut a hole in the character behind it. */
      depthWrite: false,
      depthTest: true,
      fog: false,
    }),
  );

  const shardField = new THREE.InstancedMesh(
    shardGeometry,
    shardMaterial,
    SHARD_CAPACITY,
  );
  shardField.name = 'impact-shards';
  shardField.renderOrder = BURST_RENDER_ORDER;
  shardField.frustumCulled = false;
  shardField.visible = false;
  shardField.count = 0;
  /* Allocate the colour attribute up front. `setColorAt` creates it lazily, so
     a field that is never coloured has no `instanceColor` at all and three
     compiles a program without the instancing-colour define -- after which the
     first coloured shard silently draws white. */
  const shardColour = new THREE.Color();
  for (let i = 0; i < SHARD_CAPACITY; i++) shardField.setColorAt(i, shardColour);
  scene.add(shardField);

  /* A generator of its own, from the same seed -- the pattern the banks and
     the deck already follow. Sharing the scene's stream would make the debris
     depend on how many draws construction happened to take, so adding a
     decorative flicker would change every burst in the game. */
  const burstRng = createRng(rng.seed);

  const shards: LiveShard[] = [];
  let bursts = 0;

  /* Reused rather than allocated per shard per frame: at 96 instances and 60
     frames a second that is 5,760 throwaway objects, and the garbage they make
     lands during the one effect that is supposed to feel smooth. */
  const shardDummy = new THREE.Object3D();

  function updateShards(now: number): void {
    if (shards.length === 0) {
      if (shardField.visible) {
        shardField.visible = false;
        shardField.count = 0;
      }
      return;
    }

    let drawn = 0;

    /* Backwards, so removing a retired shard cannot skip the one after it. */
    for (let i = shards.length - 1; i >= 0; i--) {
      const live = shards[i]!;
      const pose = shardAt(live.shard, now - live.at);

      /* Null is the retirement signal, and it comes from the curve rather than
         from a duration held here -- one copy of "how long a shard lives". */
      if (pose === null) {
        shards.splice(i, 1);
        continue;
      }

      shardDummy.position.set(
        live.origin.x + pose.x,
        live.origin.y + pose.y,
        live.origin.z + pose.z,
      );
      shardDummy.rotation.set(pose.rx, pose.ry, pose.rz);
      shardDummy.scale.setScalar(live.shard.size * 2);
      shardDummy.updateMatrix();
      shardField.setMatrixAt(drawn, shardDummy.matrix);

      shardColour
        .copy(live.colour)
        .multiplyScalar(pose.fade * SHARD_EMISSION);
      shardField.setColorAt(drawn, shardColour);

      drawn++;
    }

    shardField.count = drawn;
    shardField.visible = drawn > 0;
    shardField.instanceMatrix.needsUpdate = true;
    if (shardField.instanceColor !== null) shardField.instanceColor.needsUpdate = true;
  }

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
    /* Debris outliving the character it came off would hang in the air over an
       empty stage when a battle restarts -- the burst is anchored to a world
       position, so nothing else would ever clear it. */
    shards.length = 0;
    shardField.visible = false;
    shardField.count = 0;
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

    setMood(mood: ArenaMood) {
      const { rim, deck, heat } = arenaEmission(mood);

      /* One hue ramp shared by the rim and the collars, so the arena speaks
         with one voice: magenta at full boss HP, running toward ember as the
         fight goes on. Scaling PAST 1 is deliberate -- the values leave the
         displayable range and land in the bloom pass's threshold, which is
         what turns "brighter" into "glowing" rather than "washed out". */
      rimMaterial.color.copy(rimRestColour).lerp(rimHotColour, heat * 0.7);
      rimMaterial.color.multiplyScalar(rim);

      collarMaterial.color.copy(collarRestColour).lerp(rimHotColour, heat * 0.7);
      collarMaterial.color.multiplyScalar(rim);

      /* The deck has a real emissiveIntensity, so it does not need the trick. */
      deckMaterial.emissiveIntensity = DECK_EMISSIVE_REST * deck;
    },

    get bursts() {
      return bursts;
    },

    get shardsAlive() {
      return shards.length;
    },

    reactToHit(targetId, sourceId, isCritical, at) {
      const target = cast.find((sprite) => sprite.name === targetId);
      if (target === undefined) return;

      /* Away from whoever swung. Derived from the two positions rather than
         from sides, so re-laying out the cast cannot silently invert it. The
         attacker being absent is not a reason to skip the flinch -- fall back
         to the target's own side of centre. */
      const source = cast.find((sprite) => sprite.name === sourceId);
      const direction = recoilDirection(
        source?.group.position ?? { x: 0, y: 0, z: 0 },
        target.group.position,
      );

      target.react(isCritical ? 'critical' : 'hit', direction, at);

      /* Debris, off the same event and in the same direction as the stagger.
         Off under reduced motion with the recoil: a cloud of tumbling
         fragments is the most literal motion in the game. */
      if (!allowMotion) return;

      /* At the chest, not the head or the feet. A blow lands on the body, and
         a burst at the head reads as a thought bubble while one at the feet
         reads as the floor giving way. */
      const origin: Vec3 = {
        x: target.group.position.x,
        y: target.contentHeight * 0.55,
        z: target.group.position.z,
      };

      /* Magenta for a hit and ember for a critical -- the arena's own heat
         ramp, and the same pair the rim and the collars travel between. NOT
         the --fx-* effect palette: that is fenced to `.hud-float` precisely so
         off-brand pixels cannot leak into the scene, where the character-art
         adherence check would then score them as on-brand. */
      const colour = new THREE.Color(isCritical ? PALETTE.ember : PALETTE.horizon);

      /* Truncated at capacity rather than evicting: a burst already in flight
         is something the player is watching, and dropping the tail of a new
         one is invisible at these counts. */
      const room = SHARD_CAPACITY - shards.length;
      if (room <= 0) return;

      const spawned = spawnShards(
        burstRng,
        Math.min(shardCountFor(isCritical), room),
        direction,
      );
      for (const shard of spawned) shards.push({ shard, at, origin, colour });
      bursts++;
    },

    update(elapsedSeconds: number) {
      /* Reactions run off the SAME clock as the dice, which is what makes
         hit-stop free: main.ts holds this value still during a freeze, so the
         flash stays lit, the stagger does not start until it releases, and the
         debris hangs in the air for exactly as long as the game is stopped. */
      for (const sprite of cast) sprite.updateReaction(elapsedSeconds, allowMotion);
      updateShards(elapsedSeconds);

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
      /* The InstancedMesh owns per-instance buffers that are NOT its geometry,
         so the registry's hold on the geometry and material does not cover
         them. */
      shards.length = 0;
      shardField.dispose();
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

/**
 * Rasterises the deck's circuit traces into a texture.
 *
 * Layout comes from `routeDeck` in arena.ts and resolution is decided here --
 * the split exists because the Vitest environment is `node` and has no canvas,
 * so the part worth asserting has to stay off it.
 *
 * USED AS AN emissiveMap, WHICH IS WHY THE CANVAS IS BLACK. `emissive` is set
 * to white on the material, so this canvas carries the colour on its own and
 * black means "no emission here" -- the metal underneath shows through
 * untouched. Painting the deck's base colour in would fight the reflection
 * instead of sitting on it.
 *
 * A square canvas maps straight onto a CylinderGeometry cap: three's cap UVs
 * put the circle in a centred unit disc, which is the same space arena.ts
 * routes in.
 */
function createDeckTexture(art: DeckArt, size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable -- cannot build deck art');
  }

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const centre = size / 2;
  /* Disc coordinates are -1..1; the cap's UV disc is half the texture. */
  const scale = size / 2;
  const at = (value: number): number => centre + value * scale;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* Rings first, so traces cross over them rather than under. */
  ctx.strokeStyle = hex(PALETTE.horizon);
  for (const radius of art.rings) {
    ctx.lineWidth = Math.max(size * 0.0022, 1);
    ctx.beginPath();
    ctx.arc(centre, centre, radius * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* Traces in cyan: thin line work, which is the only thing the palette rule
     allows cyan to be, and the motif the site header already uses. */
  ctx.strokeStyle = hex(PALETTE.signal);
  for (const trace of art.traces) {
    ctx.lineWidth = Math.max(trace.width * scale, 1);
    ctx.beginPath();
    ctx.moveTo(at(trace.points[0]!.x), at(trace.points[0]!.y));
    for (let i = 1; i < trace.points.length; i++) {
      ctx.lineTo(at(trace.points[i]!.x), at(trace.points[i]!.y));
    }
    ctx.stroke();
  }

  /* Pads last and brighter: they are where a trace begins, and a circuit
     without them reads as a maze. */
  ctx.fillStyle = hex(PALETTE.signal);
  for (const pad of art.pads) {
    ctx.beginPath();
    ctx.arc(at(pad.x), at(pad.y), Math.max(pad.radius * scale, 1), 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  /* The deck is a large surface seen at a shallow angle, which is the worst
     case for aliasing: without anisotropy the traces crawl and shimmer as
     nothing moves. */
  texture.anisotropy = 8;
  return texture;
}

/** `#rrggbb` for a palette entry, so the canvas API can take it. */
function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/**
 * Paints what the chrome reflects: an equirectangular sky, from the palette.
 *
 * An APPROXIMATION of the scene, not a capture of it. The real thing would be
 * a cube render, which costs a renderer reference createBattleScene does not
 * have and a per-frame update nothing here needs -- the camera is locked and
 * the environment is static.
 *
 * THE LAYOUT IS DICTATED BY three's EQUIRECT CONVENTION, not chosen:
 *
 *   u = atan2(dir.z, dir.x) / 2pi + 0.5     v = asin(dir.y) / pi + 0.5
 *
 * so u 0.25 is -Z, which is where the sun is; u 0.75 is +Z, behind the
 * camera; u 0 and u 0.5 are the two sides, which is where the mountain banks
 * are. v 0.5 is the horizon, and a CanvasTexture flips Y, so canvas row 0 is
 * straight up. Move the sun in the scene and this has to move with it or the
 * platform reflects a sunset that is not there.
 */
function createEnvironmentTexture(): THREE.CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable -- cannot build environment');
  }

  const horizon = height / 2;

  /* Sky and water as one vertical ramp. The water half is lighter than the
     sky because the grid ocean is live magenta line work and the terrain
     below the camera is closer, so a reflection pointing down should not go
     black. */
  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, hex(PALETTE.void));
  vertical.addColorStop(0.45, hex(PALETTE.void));
  vertical.addColorStop(0.5, hex(PALETTE.plum));
  vertical.addColorStop(0.66, hex(PALETTE.ridge));
  vertical.addColorStop(1, hex(PALETTE.void));
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);

  /* The sunset band, brightest at the sun's azimuth and falling off around
     the compass. This is most of what a mirrored surface actually shows -- a
     sun is a small bright dot, but the glow around it is broad enough to
     paint a whole reflection warm.

     KEPT DELIBERATELY DIM. A near-horizontal deck under this camera reflects
     almost one direction -- about 8 degrees up, straight down -Z, which is
     exactly where the sun is -- so every pixel of the floor samples the same
     few texels. Paint those bright and the deck is not a reflection, it is a
     flat fill in whatever colour they happen to be. */
  const sunU = 0.25;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const azimuth = ctx.createLinearGradient(0, 0, width, 0);
  azimuth.addColorStop(0, 'rgba(157, 70, 30, 0)');
  azimuth.addColorStop(sunU, 'rgba(232, 135, 58, 0.75)');
  azimuth.addColorStop(0.5, 'rgba(157, 70, 30, 0)');
  azimuth.addColorStop(1, 'rgba(157, 70, 30, 0)');
  ctx.fillStyle = azimuth;
  ctx.fillRect(0, horizon - height * 0.09, width, height * 0.11);

  /* The disc itself, a little above the horizon -- the sun sits at y 5.31,
     z -100, which is about 3 degrees up. Small: it is the thing that gives a
     polished surface a highlight to catch, not the thing that lights it. */
  const sunX = sunU * width;
  const sunY = horizon - height * (3 / 180);
  const disc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, height * 0.11);
  disc.addColorStop(0, 'rgba(255, 230, 109, 0.85)');
  disc.addColorStop(0.4, 'rgba(255, 154, 60, 0.5)');
  disc.addColorStop(1, 'rgba(255, 45, 149, 0)');
  ctx.fillStyle = disc;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  /* The banks, at the two sides. Dark mass either hand is a real feature of
     this scene and a mirror that omits it reflects an open plain. */
  ctx.save();
  ctx.fillStyle = hex(PALETTE.ridge);
  ctx.globalAlpha = 0.55;
  for (const centre of [0, 0.5, 1]) {
    const bankGradient = ctx.createLinearGradient(
      (centre - 0.14) * width,
      0,
      (centre + 0.14) * width,
      0,
    );
    bankGradient.addColorStop(0, 'rgba(74, 21, 51, 0)');
    bankGradient.addColorStop(0.5, hex(PALETTE.ridge));
    bankGradient.addColorStop(1, 'rgba(74, 21, 51, 0)');
    ctx.fillStyle = bankGradient;
    ctx.fillRect(0, horizon - height * 0.1, width, height * 0.14);
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
