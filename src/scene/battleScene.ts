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
import type { Rng } from '../rng';

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

const PALETTE = {
  void: 0x120327,
  horizon: 0xff2d95,
  chrome: 0xd9c7ff,
  signal: 0x22e0ff,
  ember: 0xff9a3c,
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

export interface BattleScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  registry: DisposalRegistry;
  /** Advance ambient animation to an absolute time, in seconds. */
  update(elapsedSeconds: number): void;
  dispose(): void;
}

export function createBattleScene(rng: Rng): BattleScene {
  const registry = new DisposalRegistry();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.void);

  /* Distance fog. Does double duty: it sells depth on the flat grid, and
     it hides the far edge of the plane so the horizon reads as infinite
     rather than as a plane that stops. */
  scene.fog = new THREE.Fog(PALETTE.void, 18, 70);

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    // Aspect is corrected on first resize; 16/9 is only a starting value.
    16 / 9,
    CAMERA.near,
    CAMERA.far,
  );
  camera.position.copy(CAMERA.position);
  camera.lookAt(CAMERA.target);

  /* --- Grid ocean ------------------------------------------------- */
  /* THREE.GridHelper is a LineSegments, so it renders as pure emissive
     colour with no lighting -- exactly the look wanted, and free. */
  const grid = new THREE.GridHelper(160, 80, PALETTE.horizon, PALETTE.signal);
  grid.position.set(0, 0, -20);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of gridMaterials) {
    material.transparent = true;
    material.opacity = 0.55;
    registry.track(material);
  }
  registry.track(grid.geometry);
  scene.add(grid);

  /* --- Sun -------------------------------------------------------- */
  /* A vertical gradient painted into a canvas texture, on a circle. A
     shader would be marginally cheaper but far less legible to edit. */
  const sunGeometry = registry.track(new THREE.CircleGeometry(6, 64));
  const sunTexture = registry.track(createGradientTexture());
  const sunMaterial = registry.track(
    new THREE.MeshBasicMaterial({ map: sunTexture, transparent: true, fog: false }),
  );
  const sun = new THREE.Mesh(sunGeometry, sunMaterial);
  sun.position.set(0, 4.2, -42);
  scene.add(sun);

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
      roughness: 0.15,
      metalness: 0.95,
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
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.6,
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

  /* --- Lighting ---------------------------------------------------- */
  /* KEY LIGHT DIRECTION IS A CONTRACT. Character illustrations arriving in
     Phase 4c must be drawn lit from this direction, or the sprites will
     read as pasted on. Front-left, slightly above. */
  const key = new THREE.DirectionalLight(PALETTE.chrome, 2.2);
  key.position.set(-4, 6, 6);
  scene.add(key);

  const rimMagenta = new THREE.DirectionalLight(PALETTE.horizon, 1.6);
  rimMagenta.position.set(6, 2, -4);
  scene.add(rimMagenta);

  const rimCyan = new THREE.DirectionalLight(PALETTE.signal, 1.2);
  rimCyan.position.set(-6, 1, -5);
  scene.add(rimCyan);

  scene.add(new THREE.AmbientLight(PALETTE.ember, 0.25));

  return {
    scene,
    camera,
    registry,

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
