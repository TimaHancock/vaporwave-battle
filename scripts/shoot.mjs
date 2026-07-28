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
  const context = await browser.newContext({
    viewport: VIEWPORT,
    // Pin DPR so screenshot dimensions are identical on every machine.
    deviceScaleFactor: 1,
    // Ambient CSS transitions would otherwise race the capture.
    reducedMotion: 'reduce',
  });

  const failures = [];

  for (const shot of SHOTS) {
    const page = await context.newPage();

    // Surface browser-side errors. A silent exception in the scene is the
    // single most common cause of a black screenshot.
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const url = `${BASE_URL}/?seed=${shot.seed}&time=${shot.time}`;

    try {
      await page.goto(url, { waitUntil: 'load' });

      // Wait on an actual readiness signal, not an arbitrary sleep. This is
      // the difference between a harness that is reliable and one that
      // produces mystery failures under CI load.
      await page.waitForFunction(() => window.__debugState?.ready === true, null, {
        timeout: READY_TIMEOUT_MS,
      });

      const state = await page.evaluate(() => window.__debugState);

      await page.screenshot({ path: `${OUT_DIR}/${shot.name}.png` });
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
