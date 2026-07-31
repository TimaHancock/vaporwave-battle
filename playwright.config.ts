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
  /* dist.spec.ts belongs to playwright.dist.config.ts, which serves the BUILT
     output. Run against the dev server it would assert nothing -- the bug it
     exists to catch is invisible there -- and it would pass, which is worse
     than not running it. */
  testIgnore: 'dist.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',

  /*
   * A raised timeout, but the default worker count.
   *
   * Headless Chromium has no GPU, so three.js runs through SwiftShader --
   * measured on this scene at 1280x720, about 135-200ms per frame. That made
   * the suite slow and flaky until the DOM specs started loading with
   * `?time=0`, which renders one frame and halts the animation loop; see the
   * note on `ready()` in e2e/hud.spec.ts. The whole suite went from ~3min with
   * timeouts to under a minute clean, so capping workers is no longer buying
   * anything.
   *
   * The timeout stays above the 30s default because harness.spec.ts still
   * renders real frames -- it has to, it asserts on draw calls and sprite
   * geometry -- and a scene test on a busy machine is legitimately slow.
   *
   * If this needs raising again, measure before assuming: a spec that stopped
   * using step mode is more likely than the suite simply getting bigger.
   */
  timeout: 45_000,

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
