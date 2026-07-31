import { defineConfig, devices } from '@playwright/test';

/**
 * The fourth verification channel: the BUILT OUTPUT, served the way Azure
 * serves it.
 *
 * The other three are all pointed at the dev server -- playwright.config.ts
 * starts `npm run dev`, scripts/shoot.mjs defaults to :5173, and Vitest has no
 * DOM at all. That is a structural blind spot, not an oversight in any one of
 * them: a whole class of bug only exists once Vite has bundled the CSS into
 * /assets/ and the browser has to resolve paths against a real stylesheet
 * rather than a <style> element injected into the document. The portraits
 * shipped blank to production for exactly that reason.
 *
 * A SIBLING CONFIG RATHER THAN A SECOND PROJECT in the existing one. A project
 * would mean every local `npm run e2e` pays for a production build before it
 * can run the DOM suite, and the DOM suite is the one that gets run twenty
 * times an hour. This runs on demand and in CI, after the build step that has
 * to happen anyway.
 *
 * It is deliberately NOT a second HUD suite. Anything assertable against the
 * dev server belongs in e2e/hud.spec.ts, where it is faster and easier to
 * debug. This asks only what the dev server cannot answer.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'dist.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 45_000,

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /* `vite preview` serves dist/ as static files, which is as close to Azure
     Static Web Apps as this can get without deploying. It does NOT run
     staticwebapp.config.json, so route rules and headers are still only
     verifiable in the real environment -- what this catches is everything
     that is wrong before the host is even involved. */
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
