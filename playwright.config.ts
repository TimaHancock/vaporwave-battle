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
