import { test, expect, type Page } from '@playwright/test';

/**
 * The built output, served as static files. Run by playwright.dist.config.ts
 * against `vite preview`, NOT by `npm run e2e`.
 *
 * One question: does every asset the interface references actually resolve?
 *
 * That sounds like something the dev server would already have told us, and it
 * is exactly what it cannot. In dev, Vite injects the stylesheet as a <style>
 * element inside the document, so a relative URL resolves against the document
 * no matter who wrote it. In the build the stylesheet is a real file at
 * /assets/index-*.css, and a relative URL that reaches CSS through a custom
 * property resolves against THAT instead -- one directory too deep. Every
 * portrait in the HUD shipped blank to Azure on that difference, while all
 * three local channels stayed green.
 *
 * So the assertions here follow the URL all the way to a response. A computed
 * background-image that merely EXISTS proves nothing; the broken build had one
 * on every portrait.
 */

test.use({ viewport: { width: 1280, height: 720 } });

/* Same `?time=0` step mode the DOM specs use: one frame, then the loop halts.
   The HUD stays live, and a software-rasterised scene stops competing for CPU
   with the assertions. */
async function ready(page: Page): Promise<void> {
  await page.goto('/?seed=1337&time=0');
  await page.waitForFunction(() => window.__debugState?.battle != null);
}

/** Every portrait box in the HUD -- party cards and turn-order tiles alike. */
const PORTRAITS = '.hud-card__portrait, .hud-turn__portrait';

/** The URL out of a computed `background-image`, or null for `none`. */
function urlOf(backgroundImage: string): string | null {
  const match = /url\(["']?(.*?)["']?\)/.exec(backgroundImage);
  return match?.[1] ?? null;
}

test.describe('the built output', () => {
  test('every portrait resolves to a real image', async ({ page }) => {
    await ready(page);

    const boxes = await page.locator(PORTRAITS).evaluateAll((els) =>
      els.map((el) => ({
        testid: el.getAttribute('data-testid') ?? el.className,
        backgroundImage: getComputedStyle(el).backgroundImage,
      })),
    );

    /* Four cards plus seven turn tiles. A zero here would pass every
       assertion below by having nothing to assert on. */
    expect(boxes.length, 'portrait elements found').toBeGreaterThan(4);

    const origin = new URL(page.url()).origin;

    for (const box of boxes) {
      const url = urlOf(box.backgroundImage);
      expect(url, `${box.testid} has a background-image`).not.toBeNull();

      /* Absolute and same-origin. Asserted separately from the fetch so a
         regression reports WHERE the URL pointed rather than just that
         something 404'd. */
      expect(url, `${box.testid} url is absolute`).toMatch(/^https?:\/\//);
      expect(new URL(url!).origin, `${box.testid} origin`).toBe(origin);

      /* THE ASSERTION THAT MATTERS. Fetched from inside the page so it goes
         out with the page's own origin and headers. */
      const res = await page.evaluate(async (href) => {
        const response = await fetch(href);
        return {
          ok: response.ok,
          status: response.status,
          type: response.headers.get('content-type') ?? '',
        };
      }, url!);

      expect(res.status, `${box.testid} -> ${url}`).toBe(200);
      /* Content type as well as status: a host with a navigation fallback
         answers a missing path with index.html and a cheerful 200, and an
         <img> pointed at HTML fails silently exactly like a 404. */
      expect(res.type, `${box.testid} content-type`).toMatch(/^image\//);
    }
  });

  test('portraits point at the same files the scene loaded', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => window.__debugState?.ready === true);

    /* One CastMember.textureUrl, two consumers: THREE.TextureLoader resolves
       it against the document, CSS resolved it against the stylesheet. They
       agreed in dev and disagreed in the build, which is the whole bug. This
       says they agree here. */
    const backgrounds = await page.locator(PORTRAITS).evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).backgroundImage),
    );
    const paths = new Set(
      backgrounds.map((background) => {
        const match = /url\(["']?(.*?)["']?\)/.exec(background);
        return match?.[1] === undefined ? null : new URL(match[1]).pathname;
      }),
    );

    const sprites = await page.evaluate(() => window.__debugState!.sprites);
    expect(sprites.length).toBeGreaterThan(0);

    for (const sprite of sprites) {
      expect(paths, `${sprite.name} portrait path`).toContain(
        `/characters/${sprite.name}.png`,
      );
    }
  });

  test('the scene textures decoded', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const sprites = await page.evaluate(() => window.__debugState!.sprites);
    expect(sprites.length).toBeGreaterThan(0);

    for (const sprite of sprites) {
      /* A 1:1 sprite means the texture had not decoded when the plane was
         built -- the documented signature of a texture that never arrived.
         Cheap to check, and it is the canvas half of the same question. */
      const [width, height] = sprite.size;
      expect(width / height, `${sprite.name} aspect`).not.toBeCloseTo(1, 3);
    }
  });

  test('loads without a console error', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));

    await ready(page);
    await page.waitForFunction(() => window.__debugState?.ready === true);

    /* Tree-shaking and minification break things the dev server never
       exercises, and a three.js failure here usually surfaces as a thrown
       error long before it surfaces as a wrong pixel. */
    expect(errors, 'console errors on the built output').toEqual([]);
  });
});
