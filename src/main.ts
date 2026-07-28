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
   high intensity. Revisit when bloom lands in Phase 4b. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const battle = createBattleScene(rng);

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
  renderer.render(battle.scene, battle.camera);
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
