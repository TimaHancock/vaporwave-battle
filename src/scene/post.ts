/**
 * Bloom post-processing.
 *
 * The scene is dark plum with hot magenta and cyan emissive edges. This pass
 * makes only the neon glow: a selective `UnrealBloomPass` whose threshold sits
 * above the chrome platform and columns so they stay crisp, while the dice,
 * grid centre line and sun bleed light.
 *
 * COLOUR MANAGEMENT
 * -----------------
 * `OutputPass` is last and reads `renderer.toneMapping`,
 * `renderer.toneMappingExposure` and `renderer.outputColorSpace`, applying
 * tone mapping + sRGB encode exactly once. The upstream `RenderPass` and
 * `UnrealBloomPass` render to linear HalfFloat targets where the renderer
 * suppresses tone mapping, so there is no double correction. main.ts therefore
 * leaves its renderer colour settings untouched.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { DisposalRegistry } from './battleScene';

/* Starting values. Tuned for a cohesive, atmospheric glow rather than hot
   spots: a gentle strength keeps blooms as soft halos, and the threshold sits
   below the sun but high enough that the placeholder sprites' white bodies
   (which are brighter than the sun in linear space) only rim-glow instead of
   blowing out. The harsh column/dice reflections that a lower threshold used
   to catch are handled at the material level (roughness in battleScene.ts),
   not here. */
const DEFAULT_STRENGTH = 0.4;
const DEFAULT_RADIUS = 0.55;
const DEFAULT_THRESHOLD = 0.68;

/** Bloom parameters exposed for assertion and live tuning. */
export interface BloomParams {
  strength: number;
  radius: number;
  threshold: number;
}

export interface PostProcessing {
  composer: EffectComposer;
  setSize(width: number, height: number): void;
  setBloom(next: Partial<BloomParams>): void;
  /** Live view of the current bloom parameters. */
  params: BloomParams;
  dispose(): void;
}

/**
 * Read a float from the current URL, falling back to `fallback` when the param
 * is absent or unparseable. Mirrors the seed/time idiom in rng.ts / main.ts.
 */
function numberParam(search: string, key: string, fallback: number): number {
  const raw = new URLSearchParams(search).get(key);
  if (raw === null) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build the composer chain. URL overrides (?bloom, ?bloomRadius,
 * ?bloomThreshold) let the scene be tuned by reloading rather than editing
 * code; `?bloom=0` is an effective off-switch.
 */
export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostProcessing {
  const registry = new DisposalRegistry();

  const search = window.location.search;
  const params: BloomParams = {
    strength: numberParam(search, 'bloom', DEFAULT_STRENGTH),
    radius: numberParam(search, 'bloomRadius', DEFAULT_RADIUS),
    threshold: numberParam(search, 'bloomThreshold', DEFAULT_THRESHOLD),
  };

  /* Size from the renderer's current drawing buffer so the composer's internal
     targets match the canvas resolution and pixel ratio. */
  const size = renderer.getSize(new THREE.Vector2());

  const composer = registry.track(new EffectComposer(renderer));
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.width, size.height);

  const renderPass = registry.track(new RenderPass(scene, camera));
  const bloomPass = registry.track(
    new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      params.strength,
      params.radius,
      params.threshold,
    ),
  );
  /* OutputPass must be last: it owns tone mapping and sRGB conversion. */
  const outputPass = registry.track(new OutputPass());

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  function setSize(width: number, height: number): void {
    composer.setSize(width, height);
    bloomPass.setSize(width, height);
  }

  function setBloom(next: Partial<BloomParams>): void {
    if (next.strength !== undefined) {
      params.strength = next.strength;
      bloomPass.strength = next.strength;
    }
    if (next.radius !== undefined) {
      params.radius = next.radius;
      bloomPass.radius = next.radius;
    }
    if (next.threshold !== undefined) {
      params.threshold = next.threshold;
      bloomPass.threshold = next.threshold;
    }
  }

  function dispose(): void {
    registry.disposeAll();
  }

  return { composer, setSize, setBloom, params, dispose };
}
