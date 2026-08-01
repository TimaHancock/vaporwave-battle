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

/*
 * The display faces, self-hosted through Fontsource.
 *
 * LATIN SUBSETS, not the full families: Orbitron ships cyrillic and Rajdhani
 * ships devanagari, and neither appears in this game. The subset files are a
 * fraction of the size for identical output.
 *
 * Imported here rather than @import-ed from style.css so Vite resolves the
 * bare specifier unambiguously and fingerprints the woff2 into /assets/ --
 * which also means a font path cannot repeat the relative-URL bug the
 * portraits shipped with.
 *
 * Both are SIL Open Font License. That is a requirement rather than a
 * preference here: ART_WORKFLOW.md records that this game is attached to a
 * commercial site, so anything bundled has to permit commercial use and
 * embedding. Check the licence before swapping either one.
 */
import '@fontsource/orbitron/latin-600.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/rajdhani/latin-700.css';

import './style.css';
import * as THREE from 'three';
import { createBattleScene, CAMERA } from './scene/battleScene';
import { createPostProcessing } from './scene/post';
import { loadCharacterTexture } from './scene/sprite';
import { layoutBoss, layoutParty } from './scene/spriteLayout';
import type { ArenaMood } from './scene/arena';
import { BOSS, CAST, PARTY } from './scene/cast';
import { renderHud, toHudModel } from './ui/hud';
import {
  createFloatLayer,
  floatTargetOf,
  type Anchor,
} from './ui/floatLayer';
import { back, confirm, moveCursor, INITIAL_MENU, type MenuState } from './ui/menu';
import { createBattle } from './battle/battle';
import type { BattleState } from './battle/types';
import { createRoster } from './battle/roster';
import { createSequencer, type SequencerView } from './battle/sequencer';
import { previewUpcoming } from './battle/turnOrder';
import { createRng, seedFromLocation } from './rng';
import { publishDebugState, type DebugState } from './debug';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const hudRoot = document.querySelector<HTMLElement>('#hud');
const floatRoot = document.querySelector<HTMLElement>('#floats');

if (canvas === null || hudRoot === null || floatRoot === null) {
  throw new Error('Expected #stage, #hud and #floats in index.html');
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

/**
 * Pause between sequencer beats, in milliseconds.
 *
 * Long enough to read a line of narration, short enough not to feel like a
 * cutscene. Overridable so a test can slow it down; the e2e suite runs at
 * the default so the input lock it asserts on is the real one.
 */
const DEFAULT_STEP_MS = 350;
const stepMs = nonNegativeParam(params.get('stepMs')) ?? DEFAULT_STEP_MS;

/**
 * Boss health override, for the e2e suite.
 *
 * A full-strength boss takes roughly 25 player actions to fell, which at a
 * readable pause length is a half-minute Playwright test. Shortening the
 * boss rather than the pauses keeps the timing under test real.
 */
const bossMaxHp = nonNegativeParam(params.get('bossHp'));

/**
 * How long a floating number lives, in milliseconds.
 *
 * Overridable for the same reason `stepMs` is, but the use case is the
 * opposite one: the screenshot harness needs the numbers to STAY. A float is
 * gone 900ms after the hit that caused it, and `shoot.mjs` captures after the
 * turn has settled -- so at the default there is nothing left to photograph.
 * `?floatMs=60000` freezes the effect for the camera without touching the
 * timing of anything else.
 */
const DEFAULT_FLOAT_MS = 900;
const floatMs = nonNegativeParam(params.get('floatMs')) ?? DEFAULT_FLOAT_MS;

/** Parses a non-negative integer parameter, ignoring anything else. */
function nonNegativeParam(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/* ---------------------------------------------------------------- */
/* Static configuration                                              */
/* ---------------------------------------------------------------- */

/* Four, not five. The composition is party-left / boss-right, and a party
   of five pushed its rightmost member to screen x 0.53 -- into the space
   the boss occupies. Dropping one shrinks the formation to 0.47 and opens
   the right half of frame; layoutParty handles the respacing.

   Who they are, how tall they are and which PNG they are all live in
   scene/cast.ts, which mirrors public/characters/CHARACTER_PROMPTS.md. */
const PARTY_NAMES = PARTY.map((member) => member.name);

/**
 * The display faces to have in hand before the scene calls itself ready.
 *
 * CSS font shorthand, which is what `FontFaceSet.load` takes. These must stay
 * in step with the `@fontsource/*` imports at the top of this file and with
 * `--font-display` / `--font-label` in style.css: a weight named here that is
 * not imported never resolves, and a weight used in CSS but missing here goes
 * back to loading lazily and reflowing on first use.
 */
const DISPLAY_FACES = [
  '900 2rem Orbitron',
  '600 2rem Orbitron',
  '700 1rem Rajdhani',
];

/* ---------------------------------------------------------------- */
/* Bootstrap                                                         */
/* ---------------------------------------------------------------- */

/* The roots arrive as parameters rather than closed over, because the null
   guard above narrows straight-line module code but not a function body --
   TypeScript cannot know when the function is called. */
async function main(
  canvas: HTMLCanvasElement,
  hudRoot: HTMLElement,
  floatRoot: HTMLElement,
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

  /* --- Battle ----------------------------------------------------- */

  /* A SEPARATE rng stream from the scene's, deliberately. Sharing one would
     make every crit roll depend on how many random draws scene construction
     happened to make, so adding a decorative flicker would silently reroll
     the fight -- and "seed 8871 turn 4 crashes" would stop being true. */
  const battleRng = createRng(seed);

  const initialState = createBattle(
    seed,
    createRoster(bossMaxHp === undefined ? {} : { bossMaxHp }),
  );

  let menu: MenuState = INITIAL_MENU;

  const sequencer = createSequencer({
    state: initialState,
    rng: battleRng,
    stepMs,
    onChange: refresh,
  });

  /* #floats, not hudRoot. renderHud replaceChildren()s its root on the first
     call, so a layer parked inside #hud is silently detached the moment the
     interface first renders -- it keeps working, appending to a node that is
     no longer in the document, and nothing appears. See index.html. */
  const floats = createFloatLayer(floatRoot, floatMs);

  /**
   * Sprites by ActorId, filled once the cast exists.
   *
   * A sprite's `name` IS its ActorId -- the correspondence cast.ts documents
   * -- which is the whole seam that lets an event resolve to a place on
   * screen.
   */
  const spritesById = new Map<string, (typeof battle.sprites)[number]>();

  /**
   * How many of `view.log` have already been turned into floats.
   *
   * The log only ever grows, so this stays a valid index for the life of the
   * battle -- the same append-only diff the action log uses for narration.
   * A count rather than a re-render is what stops `refresh()` re-spawning
   * every number it has ever shown: refresh runs on each keypress too, and
   * floats are events, not state.
   */
  let floatsSpawned = 0;

  /** Where a float for this actor belongs, or null if it has no sprite. */
  function anchorFor(actorId: string): Anchor | null {
    const sprite = spritesById.get(actorId);
    if (sprite === undefined) return null;
    return sprite.headScreenPosition(battle.camera);
  }

  /**
   * Spawn floats for whatever the battle has done since the last call.
   *
   * Spacing overlapping numbers apart is the LAYER's job, not this one's --
   * it is the only thing that knows which floats are still on screen, and
   * two turns in quick succession collide exactly as much as two hits in one
   * commit do.
   */
  function emitFloats(view: SequencerView): void {
    const fresh = view.log.slice(floatsSpawned);
    floatsSpawned = view.log.length;
    if (spritesById.size === 0) return;

    for (const event of fresh) {
      const targetId = floatTargetOf(event);
      if (targetId === null) continue;
      const at = anchorFor(targetId);
      if (at === null) continue;
      floats.spawn(event, at, targetId);
    }
  }

  /** The last mood applied, so `refresh` can tell when there is nothing to do. */
  let lastMood: ArenaMood = { chain: -1, bossHpFraction: -1 };

  /* One place the interface is rebuilt from state, called by the sequencer
     on every beat and by the keyboard handler on every keypress. Both the
     DOM and the debug channel are pure functions of the same view, so they
     cannot disagree about what moment they are describing.

     The float layer is deliberately NOT part of that: it is fed the events
     the view has accumulated since last time, because a number that has
     already flown is not recoverable from the state it left behind. */
  function refresh(view: SequencerView = sequencer.view): void {
    renderHud(hudRoot, toHudModel(view.state, menu, view));
    emitFloats(view);
    floats.setChain(view.state.chain, anchorFor(BOSS.name));
    /* The arena's neon, from the same view as everything else -- so the deck
       under the player's feet, the chain counter over the boss and the cards
       along the bottom can never be describing different moments. State in,
       nothing back: the renderer reads BattleState and never writes to it. */
    const mood = arenaMoodOf(view.state);
    /*
     * ONLY ON A CHANGE, and the guard is load-bearing rather than tidy.
     *
     * `refresh()` runs on every keypress, and most keypresses move a menu
     * cursor -- which the arena has no opinion about. Redrawing on all of
     * them put a full software render behind every arrow key in the e2e
     * suite and took it from 1.3 to 5.4 minutes with seven timeouts. That is
     * the same trap `?time=0` exists to avoid: headless Chromium has no GPU
     * and rasterises this scene in hundreds of milliseconds.
     */
    if (mood.chain !== lastMood.chain || mood.bossHpFraction !== lastMood.bossHpFraction) {
      lastMood = mood;
      battle.setMood(mood);

      /*
       * In step mode, redraw -- at the SAME simulated time.
       *
       * `?time=` renders one frame and halts the loop, which was fine while
       * the only thing that changed after boot was the DOM. It is not fine
       * now that the arena's neon is a function of battle state: the
       * materials would update and nothing would ever put them on screen, so
       * every screenshot showed the arena at its opening value however the
       * fight had gone. The same shape as publishing debug state off the
       * loop, and for the same reason.
       *
       * At `currentTime` rather than a fresh clock read, so ambient animation
       * does not advance and a stepped frame stays reproducible.
       */
      if (isStepMode && isReady) drawFrame(currentTime);
    }

    publish();
  }


  /**
   * The two numbers the arena reacts to.
   *
   * Kept to a function rather than inlined so the read stays in one place and
   * a missing boss -- which happens the instant the fight is won -- resolves
   * to a resting arena instead of a NaN that turns the whole stage black.
   */
  function arenaMoodOf(state: BattleState): ArenaMood {
    const boss = state.actors.find((actor) => actor.id === BOSS.name);
    return {
      chain: state.chain,
      bossHpFraction:
        boss === undefined || boss.stats.maxHp <= 0
          ? 1
          : boss.hp / boss.stats.maxHp,
    };
  }

  /* --- Input ------------------------------------------------------ */

  /* Listening on window, not on the buttons: this is a menu-driven game and
     the cursor is the interaction, so the keys must work regardless of what
     happens to hold focus. preventDefault stops arrows scrolling the page
     and stops Enter reaching a focused button, which would otherwise fire
     the same command a second time. */
  window.addEventListener('keydown', (event) => {
    const view = sequencer.view;

    /* The sequencer is the authority on whether input is accepted -- submit
       re-checks the lock itself. This is only an early return so the cursor
       cannot be walked around a menu that is mid-turn. */
    if (view.isLocked || view.state.phase !== 'in_progress') return;

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        menu = moveCursor(view.state, menu, -1);
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        menu = moveCursor(view.state, menu, 1);
        break;
      case 'Enter': {
        const result = confirm(view.state, menu);
        menu = result.menu;
        if (result.action !== null) sequencer.submit(result.action);
        break;
      }
      case 'Escape':
        menu = back(menu);
        break;
      default:
        return;
    }

    event.preventDefault();
    refresh();
  });

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

  /* Time and readiness are hoisted out of drawFrame because publishing is no
     longer the render loop's job alone. In `?time=` step mode drawFrame runs
     exactly ONCE, so a snapshot built only there would freeze isLocked and
     the battle state at their boot values for the whole harness session --
     the UI would be live and the debug channel would be reporting a moment
     from before the player pressed anything. */
  let currentTime = 0;
  let isReady = false;

  function publish(): void {
    publishDebugState(snapshot());
  }

  function snapshot(): DebugState {
    const view = sequencer.view;
    const state = view.state;

    return {
      time: Number(currentTime.toFixed(4)),
      seed,
      ready: isReady,
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
          side: sprite.side,
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

      battle: {
        phase: state.phase,
        round: state.round,
        chain: state.chain,
        activeActor: state.turnQueue[state.turnIndex] ?? null,
        isLocked: view.isLocked,
        actionsTaken: view.actionsTaken,
        pending: [...view.pending],
        upcoming:
          state.phase === 'in_progress' ? previewUpcoming(state, 6) : [],
        actors: state.actors.map((actor) => ({
          id: actor.id,
          name: actor.name,
          side: actor.side,
          hp: actor.hp,
          maxHp: actor.stats.maxHp,
          mp: actor.mp,
          maxMp: actor.stats.maxMp,
          statuses: actor.statuses.map((status) => ({ ...status })),
        })),
        log: view.log.map((event) => ({ ...event })),
      },
    };
  }

  /* --- Render ----------------------------------------------------- */

  const clock = new THREE.Clock();

  function drawFrame(elapsed: number): void {
    battle.update(elapsed);
    renderer.info.reset();
    post.composer.render();
    currentTime = elapsed;
    isReady = true;
    publish();
  }

  /* Render the HUD and publish a not-ready state BEFORE the texture load, so
     the harness can poll for `__debugState.ready === true` rather than
     guessing with a timeout. The cast is empty at this point, which is
     exactly what a not-ready state should report -- but the battle is not,
     so the interface is already correct and already playable. */
  refresh();

  /* --- Character cast --------------------------------------------- */

  /* Rejects on failure rather than substituting a blank. Nothing below
     runs, and `ready` stays false -- see the catch at the bottom.

     One texture per sprite, never shared: CharacterSprite.dispose()
     disposes its own map, so a shared texture would be destroyed the first
     time any one of its sprites went away. Loaded together rather than in
     sequence: five round trips one after another is five times the latency
     before anything appears, for no reason. */
  const textures = await Promise.all(
    CAST.map((member) => loadCharacterTexture(member.textureUrl)),
  );

  /* ONE spawnCast call for the whole cast, boss included.
     assignRenderOrders() ranks everyone in a single pass, so spawning the
     party and the boss separately would produce two independent draw
     sequences that collide -- and the boss, being furthest back, is exactly
     the sprite that has to draw first. */
  const partyPositions = layoutParty(PARTY_NAMES.length);
  let partyIndex = 0;

  battle.spawnCast(
    CAST.map((member, index) => ({
      name: member.name,
      side: member.side,
      texture: textures[index]!,
      /* The character's height, not the plane's. The sprite layer divides
         out the art's transparent margin, so these stay the authored
         numbers however the PNGs happen to be framed. */
      characterHeight: member.characterHeight,
      position:
        member.side === 'party'
          ? partyPositions[partyIndex++] ?? { x: 0, y: 0, z: 0 }
          : layoutBoss(),
      ...(member.alphaTest === undefined ? {} : { alphaTest: member.alphaTest }),
    })),
  );

  /* The cast exists, so events can now resolve to a place on screen. Built
     once here rather than looked up per event: a turn commits several events
     at a time and the map outlives all of them. */
  for (const sprite of battle.sprites) spritesById.set(sprite.name, sprite);

  /* The opening refresh ran before any of this, when there was nothing to
     anchor to. Nothing was missed -- the log is empty at boot -- but the
     chain counter needs a position it could not have been given then. */
  refresh();

  /* --- Fonts ------------------------------------------------------ */

  /*
   * Wait for the display faces before anything is allowed to call itself
   * ready.
   *
   * Fontsource ships `font-display: swap`, so text paints in the fallback
   * stack and re-lays out when the real face arrives. Everything downstream
   * of `ready` measures: the screenshot harness photographs it, and
   * e2e/hud.spec.ts asserts a damage number's risen box clears the boss bar.
   * Orbitron's metrics are nothing like a monospace fallback's, so allowing
   * ready to fire first means those measurements are of a layout that never
   * ships -- and only on a cold cache, which is the worst kind of flake.
   *
   * `load()` BEFORE `ready`, and that ordering is the whole point. A browser
   * fetches a web font only when something on screen actually uses it, and at
   * this moment nothing does -- the first damage number is several keypresses
   * away. So `ready` on its own resolves instantly with nothing pending, the
   * harness proceeds, and the first number to appear is the one that renders
   * in the fallback and then reflows. Asking for the faces explicitly is what
   * turns "no loads are pending" into "the faces are here".
   *
   * Guarded because `document.fonts` is absent in some environments, and a
   * missing Font Loading API should degrade to unstyled text rather than to
   * a bootstrap that never finishes.
   */
  if (document.fonts !== undefined) {
    await Promise.all(
      DISPLAY_FACES.map((face) =>
        /* A failed font is a cosmetic problem, not a fatal one -- the stacks
           in style.css fall back to the utility face. Swallow it here so a
           font 404 cannot take the whole bootstrap down with it. */
        document.fonts.load(face).catch(() => undefined),
      ),
    );
    await document.fonts.ready;
  }

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
void main(canvas, hudRoot, floatRoot).catch((error: unknown) => {
  console.error(
    'Bootstrap failed; the scene will never become ready.',
    error,
  );
  throw error;
});
