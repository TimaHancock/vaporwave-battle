/**
 * Entry point.
 *
 * Responsibilities, in order:
 *   1. Read the seed and the optional step-to time from the URL.
 *   2. Build the scene and the HUD.
 *   3. Load character art, then spawn the cast.
 *   4. Run the render loop, publishing debug state every frame.
 *   5. Handle resize.
 *
 * The step-to-time mode is what makes screenshots reproducible. Loading
 * `?time=3.5` fast-forwards ambient animation to exactly 3.5 seconds,
 * renders one frame, and stops. The harness can therefore capture the same
 * composition on every run, forever.
 *
 * The bootstrap is async for one reason: a sprite cannot be built until its
 * texture has decoded, because the plane's dimensions are derived from the
 * image's pixel aspect. createCharacterSprite() throws rather than guessing.
 * So everything after the texture load lives behind an await -- including
 * the first render, which is what flips `ready` to true. The harness polls
 * that flag, so it must not go true before the sprites exist.
 */

import './style.css';
import * as THREE from 'three';
import { createBattleScene, CAMERA } from './scene/battleScene';
import { createPostProcessing } from './scene/post';
import {
  createPlaceholderCharacterTexture,
  loadCharacterTexture,
} from './scene/sprite';
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
/* Static configuration                                              */
/* ---------------------------------------------------------------- */

/* Party count is 5 to match the silhouettes in the site hero. The first
   member has real art; the rest stay procedural until their PNGs exist. */
const PARTY_NAMES = ['kira', 'neo', 'vex', 'lyra', 'sage'] as const;

/** Served from the web root -- public/ is copied there by Vite. */
const KIRA_TEXTURE_URL = './characters/kira.png';

/* HUD placeholder data -- real battle state arrives in Phase 1. */
const hudModel: HudModel = {
  bossName: 'APOLLYON',
  bossLevel: 95,
  bossHp: 588_321,
  bossMaxHp: 1_200_000,
  commands: ['Attack', 'Skill', 'Spell', 'Item', 'Defend'],
  selectedCommandIndex: 1,
  narration: 'Awaiting orders.',
};

/* ---------------------------------------------------------------- */
/* Bootstrap                                                         */
/* ---------------------------------------------------------------- */

/* canvas and hudRoot arrive as parameters rather than closed over, because
   the null guard above narrows straight-line module code but not a function
   body -- TypeScript cannot know when the function is called. */
async function main(
  canvas: HTMLCanvasElement,
  hudRoot: HTMLElement,
): Promise<void> {
  /* --- Renderer --------------------------------------------------- */

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

  /* --- HUD -------------------------------------------------------- */

  renderHud(hudRoot, hudModel);

  /* --- Resize ----------------------------------------------------- */

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

  /* --- Debug state ------------------------------------------------ */

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
          feetInset: Number(sprite.feetInset.toFixed(4)),
          contentHeight: Number(sprite.contentHeight.toFixed(4)),
          renderOrder: sprite.mesh.renderOrder,
          headScreen: [
            Number(head.x.toFixed(4)),
            Number(head.y.toFixed(4)),
          ] as [number, number],
          hasShadow: sprite.shadow !== null,
        };
      }),

      /* Null until Phase 1 introduces real battle state. */
      battle: null,
    };
  }

  /* --- Render ----------------------------------------------------- */

  const clock = new THREE.Clock();

  function drawFrame(elapsed: number): void {
    battle.update(elapsed);
    renderer.info.reset();
    post.composer.render();
    publishDebugState(snapshot(elapsed, true));
  }

  /* Publish a not-ready state BEFORE the texture load, so the harness can
     poll for `__debugState.ready === true` rather than guessing with a
     timeout. The cast is empty at this point, which is exactly what a
     not-ready state should report. */
  publishDebugState(snapshot(0, false));

  /* --- Character cast --------------------------------------------- */

  /* Rejects on failure rather than substituting a blank. Nothing below
     runs, and `ready` stays false -- see the catch at the bottom. */
  const kira = await loadCharacterTexture(KIRA_TEXTURE_URL);

  /* One spawnCast call for the whole party. assignRenderOrders() ranks the
     cast in a single pass, so splitting real art from placeholders would
     produce two independent draw sequences that collide.

     One texture per sprite, never shared: CharacterSprite.dispose()
     disposes its own map, so a shared texture would be destroyed the first
     time any one of its sprites went away. */
  const partyPositions = layoutParty(PARTY_NAMES.length);

  battle.spawnCast(
    PARTY_NAMES.map((name, index) => ({
      name,
      texture: index === 0 ? kira : createPlaceholderCharacterTexture(),
      worldHeight: 2.2,
      position: partyPositions[index] ?? { x: 0, y: 0, z: 0 },
    })),
  );

  /* --- Go --------------------------------------------------------- */

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
}

/* A failed texture load leaves `ready` false forever, deliberately. A blank
   substitute would render as nothing at all, which in a screenshot is
   indistinguishable from a positioning bug. Rethrowing surfaces the reason
   to Playwright's pageerror hook, so the shot manifest records why. */
void main(canvas, hudRoot).catch((error: unknown) => {
  console.error(
    'Bootstrap failed; the scene will never become ready.',
    error,
  );
  throw error;
});
