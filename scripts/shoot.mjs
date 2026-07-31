/**
 * The screenshot harness.
 *
 * WHY THIS IS THE FIRST THING BUILT
 * ---------------------------------
 * Claude Code cannot see the rendered canvas. Without this script, "the
 * screen is black" is a bug only a human can observe, which makes you the
 * debugger on every single iteration. This closes the loop.
 *
 * Two channels are produced per shot:
 *   - shots/<name>.png        what it looks like
 *   - shots/<name>.json       what the game believes about itself
 *
 * When those two disagree, the gap is the bug. Example: the JSON says
 * seven meshes and twenty-two draw calls, but the PNG is black -- that is
 * a lighting or camera problem, not a loading problem. That inference is
 * only possible because both channels exist.
 *
 * USAGE
 *   npm run dev          (in one terminal, leave running)
 *   npm run shots        (in another)
 *
 * Or against a production build:
 *   npm run build && npm run preview
 *   BASE_URL=http://localhost:4173 npm run shots
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { SHOTS, VIEWPORT } from './shots.config.mjs';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:5173';
const OUT_DIR = 'shots';
const READY_TIMEOUT_MS = 15_000;

async function main() {
  // Clear stale output so a deleted shot cannot linger and mislead.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();

  /*
   * `scale` is deviceScaleFactor, and it is the right knob for anything whose
   * subject is the HUD.
   *
   * Enlarging the VIEWPORT does not enlarge the interface: the DOM is sized in
   * rem, so a 2x viewport renders the same 36px tile into twice as much frame
   * and makes it relatively smaller. It is the correct knob for a shot whose
   * subject is the SCENE -- boss_closeup wants more samples along a silhouette
   * -- and the wrong one for a shot of a card or a portrait tile.
   *
   * deviceScaleFactor keeps the layout identical, at the size a player
   * actually sees, and renders those same CSS pixels at higher resolution.
   */
  const newContext = (viewport, scale) =>
    browser.newContext({
      viewport: viewport ?? VIEWPORT,
      // Pinned unless a shot asks, so dimensions are identical on every machine.
      deviceScaleFactor: scale ?? 1,
      // Ambient CSS transitions would otherwise race the capture.
      reducedMotion: 'reduce',
    });

  const context = await newContext();
  const failures = [];

  for (const shot of SHOTS) {
    /* A shot may ask for a bigger frame -- boss_closeup does, to get pixels
       on the silhouette edge. Keep the ASPECT the same as VIEWPORT when you
       do: the camera's fov is vertical, so a different aspect is a different
       composition, and the shot stops being comparable with the others. */
    const shotContext =
      shot.viewport || shot.scale
        ? await newContext(shot.viewport, shot.scale)
        : context;
    const page = await shotContext.newPage();

    // Surface browser-side errors. A silent exception in the scene is the
    // single most common cause of a black screenshot.
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const extra = shot.query ? `&${shot.query}` : '';
    const url = `${BASE_URL}/?seed=${shot.seed}&time=${shot.time}${extra}`;

    try {
      await page.goto(url, { waitUntil: 'load' });

      // Wait on an actual readiness signal, not an arbitrary sleep. This is
      // the difference between a harness that is reliable and one that
      // produces mystery failures under CI load.
      await page.waitForFunction(() => window.__debugState?.ready === true, null, {
        timeout: READY_TIMEOUT_MS,
      });

      const state = await page.evaluate(() => window.__debugState);

      /* A clip is a crop of the canonical render, NOT a moved camera. The
         camera is locked by design (see CLAUDE.md), so the only honest way
         to look closely at one character is to cut that part out of the
         frame everything else is judged in. Expressed as fractions so it
         survives a viewport change. */
      const { width: vw, height: vh } = shot.viewport ?? VIEWPORT;
      const clip = shot.clip
        ? {
            x: Math.round(shot.clip.x * vw),
            y: Math.round(shot.clip.y * vh),
            width: Math.round(shot.clip.width * vw),
            height: Math.round(shot.clip.height * vh),
          }
        : undefined;

      await page.screenshot({
        path: `${OUT_DIR}/${shot.name}.png`,
        ...(clip ? { clip } : {}),
      });
      await writeFile(
        `${OUT_DIR}/${shot.name}.json`,
        JSON.stringify({ shot, url, consoleErrors, state }, null, 2),
      );

      const status = consoleErrors.length > 0 ? 'WARN' : 'ok';
      console.log(
        `[${status}] ${shot.name.padEnd(16)} ` +
          `draws=${state.renderer.drawCalls} ` +
          `tris=${state.renderer.triangles} ` +
          `geo=${state.renderer.geometries} ` +
          `tex=${state.renderer.textures}`,
      );

      for (const err of consoleErrors) console.log(`        console: ${err}`);
    } catch (error) {
      failures.push({ name: shot.name, error: String(error) });
      console.error(`[FAIL] ${shot.name}: ${error}`);
      // Capture whatever is on screen anyway -- a screenshot of the failure
      // state is usually more informative than the exception text.
      await page
        .screenshot({ path: `${OUT_DIR}/${shot.name}.FAILED.png` })
        .catch(() => {});
    } finally {
      await page.close();
      if (shotContext !== context) await shotContext.close();
    }
  }

  await browser.close();

  console.log(`\n${SHOTS.length - failures.length}/${SHOTS.length} shots captured -> ${OUT_DIR}/`);

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
