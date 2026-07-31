import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright here does DOM assertions, not visual checks -- the screenshot
 * harness (scripts/shoot.mjs) owns the visual channel.
 *
 * The split is deliberate:
 *   Vitest      -> pure battle logic          (milliseconds)
 *   Playwright  -> UI behaviour via the DOM   (exact, assertable)
 *   shoot.mjs   -> does the scene look right  (needs human or model eyes)
 *
 * Because ~80% of this game is interface, the middle channel carries most
 * of the verification load.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',

  /*
   * EVERY TEST HERE BOOTS A SOFTWARE-RENDERED WEBGL SCENE.
   *
   * Headless Chromium has no GPU, so three.js runs through SwiftShader.
   * Measured on this scene at 1280x720: ~135-200ms per frame, about 5-7 fps,
   * and hiding the entire HUD changes it by nothing -- the cost is the scene
   * and its bloom pipeline being rasterised on the CPU.
   *
   * Two consequences, and the defaults are wrong for both:
   *
   *   timeout -- a test that plays a dozen turns at real sequencer timing
   *   legitimately takes 20-30s. At the 30s default those tests sat on the
   *   edge and fell off whenever the machine was busy, which reads as a UI
   *   bug and is not one.
   *
   *   workers -- the default is derived from core count, but the contended
   *   resource is CPU spent on software rasterisation, and every worker wants
   *   all of it. Seven workers made each test 3x slower than running alone,
   *   so the parallelism was buying nothing and costing reliability.
   *
   * If these ever need raising again, measure first: a scene that got slower
   * is the more likely explanation than a suite that got bigger.
   */
  timeout: 60_000,
  workers: process.env['CI'] ? 2 : 4,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /* Starts the dev server automatically if it is not already running, so
     `npm run e2e` works from a cold terminal and in CI unchanged. */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
