/**
 * Entry point.
 *
 * Responsibilities, in order:
 *   1. Read the seed and the optional step-to time from the URL.
 *   2. Build the scene and the HUD.
 *   3. Run the render loop, publishing debug state every frame.
 *   4. Handle resize.
 *
 * The step-to-time mode is what makes screenshots reproducible. Loading
 * `?time=3.5` fast-forwards ambient animation to exactly 3.5 seconds,
 * renders one frame, and stops. The harness can therefore capture the same
 * composition on every run, forever.
 */

import './style.css';
import * as THREE from 'three';
import { createBattleScene, CAMERA } from './scene/battleScene';
import { createPostProcessing } from './scene/post';
import { createPlaceholderCharacterTexture } from './scene/sprite';
import { layoutParty } from './scene/spriteLayout';
import { renderHud, type HudModel } from './ui/hud';
import { createRng, seedFromLocation } from './rng';
import { publishDebugState, type DebugState } from './debug';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const hudRoot = document.querySelector<HTMLElement>('#hud');

if (canvas === null || hudRoot === null) {
  throw new Error('Expected #stage and #hud in index.html');
}

/* ---------------------------------------------------------------- */
/* URL parameters                                                    */
/* ---------------------------------------------------------------- */

const params = new URLSearchParams(window.location.search);
const seed = seedFromLocation(window.location.search);
const rng = createRng(seed);

/** When present, render exactly one frame at this simulated time, then halt. */
const stepToRaw = params.get('time');
const stepTo = stepToRaw === null ? null : Number.parseFloat(stepToRaw);
const isStepMode = stepTo !== null && Number.isFinite(stepTo);

/* ---------------------------------------------------------------- */
/* Renderer                                                          */
/* ---------------------------------------------------------------- */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  /* Required for screenshots: without it the drawing buffer may be cleared
     before Playwright can read the canvas. */
  preserveDrawingBuffer: true,
});

/* Cap at 2. Uncapped devicePixelRatio on a high-DPI display quadruples
   fragment work for no visible gain and makes screenshot dimensions
   inconsistent across machines. */
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* Tone mapping matters for the aesthetic: neon emissive colours blow out
   to white without it. ACESFilmic keeps the magenta reading as magenta at
   high intensity. These settings are now consumed by the bloom pipeline's
   OutputPass (see scene/post.ts), which applies tone mapping + sRGB encode
   once at the end of the chain -- so they stay here, unchanged. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

/* The composer issues many internal render calls per frame (scene, bloom mip
   passes, output). With autoReset on, renderer.info would report only the last
   pass -- a single fullscreen quad -- making the drawCalls/triangles debug
   channel useless. Disable it and reset once per frame instead, so the stats
   capture the whole pipeline's GPU work. */
renderer.info.autoReset = false;

const battle = createBattleScene(rng);
const post = createPostProcessing(renderer, battle.scene, battle.camera);

/* ---------------------------------------------------------------- */
/* Character cast                                                    */
/* ---------------------------------------------------------------- */

/* Placeholder sprites, so the billboard pipeline -- aspect handling,
   alpha cutoff, draw order, contact shadows -- can be verified today,
   before any character art exists.
 *
 * To swap in real art, replace createPlaceholderCharacterTexture() with
 * `await loadCharacterTexture('./characters/kira.png')`. Nothing else in
 * this block changes.
 *
 * Party count is 5 to match the silhouettes in the site hero. */
const PARTY_NAMES = ['kira', 'neo', 'vex', 'lyra', 'sage'] as const;
const partyPositions = layoutParty(PARTY_NAMES.length);

battle.spawnCast(
  PARTY_NAMES.map((name, index) => ({
    name,
    texture: createPlaceholderCharacterTexture(),
    worldHeight: 2.2,
    position: partyPositions[index] ?? { x: 0, y: 0, z: 0 },
  })),
);

/* ---------------------------------------------------------------- */
/* HUD (placeholder data -- real battle state arrives in Phase 1)    */
/* ---------------------------------------------------------------- */

const hudModel: HudModel = {
  bossName: 'APOLLYON',
  bossLevel: 95,
  bossHp: 588_321,
  bossMaxHp: 1_200_000,
  commands: ['Attack', 'Skill', 'Spell', 'Item', 'Defend'],
  selectedCommandIndex: 1,
  narration: 'Awaiting orders.',
};

renderHud(hudRoot, hudModel);

/* ---------------------------------------------------------------- */
/* Resize                                                            */
/* ---------------------------------------------------------------- */

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  battle.camera.aspect = width / height;
  battle.camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  post.setSize(width, height);
}

window.addEventListener('resize', resize);
resize();

/* ---------------------------------------------------------------- */
/* Debug state                                                       */
/* ---------------------------------------------------------------- */

function snapshot(time: number, ready: boolean): DebugState {
  return {
    time: Number(time.toFixed(4)),
    seed,
    ready,
    camera: {
      position: battle.camera.position.toArray() as [number, number, number],
      target: CAMERA.target.toArray() as [number, number, number],
      fov: battle.camera.fov,
    },
    renderer: {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    },
    post: {
      strength: post.params.strength,
      radius: post.params.radius,
      threshold: post.params.threshold,
    },
    sprites: battle.sprites.map((sprite) => {
      const head = sprite.headScreenPosition(battle.camera);
      return {
        name: sprite.name,
        position: [
          sprite.group.position.x,
          sprite.group.position.y,
          sprite.group.position.z,
        ] as [number, number, number],
        size: [
          Number(sprite.size.width.toFixed(4)),
          Number(sprite.size.height.toFixed(4)),
        ] as [number, number],
        renderOrder: sprite.mesh.renderOrder,
        headScreen: [Number(head.x.toFixed(4)), Number(head.y.toFixed(4))] as [
          number,
          number,
        ],
        hasShadow: sprite.shadow !== null,
      };
    }),

    /* Null until Phase 1 introduces real battle state. */
    battle: null,
  };
}

/* ---------------------------------------------------------------- */
/* Render loop                                                       */
/* ---------------------------------------------------------------- */

const clock = new THREE.Clock();

function drawFrame(elapsed: number): void {
  battle.update(elapsed);
  renderer.info.reset();
  post.composer.render();
  publishDebugState(snapshot(elapsed, true));
}

/* Publish a not-ready state BEFORE the first render, so the harness can
   poll for `__debugState.ready === true` rather than guessing with a
   timeout. Order matters here: publishing this after drawFrame would
   immediately overwrite the ready flag and hang every screenshot run. */
publishDebugState(snapshot(0, false));

if (isStepMode) {
  /* Deterministic single-frame capture. No animation loop at all. */
  drawFrame(stepTo);
} else {
  const loop = (): void => {
    window.requestAnimationFrame(loop);
    drawFrame(clock.getElapsedTime());
  };
  loop();
}
