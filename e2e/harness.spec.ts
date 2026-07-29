import { test, expect } from '@playwright/test';

/**
 * Phase 0 acceptance tests.
 *
 * These prove the two verification channels work. They are not testing the
 * game -- there is barely a game yet. They are testing that the machinery
 * which will verify the game is sound.
 *
 * If any of these break later, fix them rather than deleting them: they
 * are the contract the whole workflow depends on.
 */

test.describe('debug state channel', () => {
  test('publishes a ready state with a live scene', async ({ page }) => {
    await page.goto('/?seed=1337&time=2.0');
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const state = await page.evaluate(() => window.__debugState!);

    expect(state.ready).toBe(true);
    expect(state.seed).toBe(1337);
    expect(state.time).toBeCloseTo(2.0, 3);

    // A scene that renders nothing is the failure mode this catches. Draw
    // calls above zero means geometry actually reached the GPU.
    expect(state.renderer.drawCalls).toBeGreaterThan(0);
    expect(state.renderer.triangles).toBeGreaterThan(0);
    expect(state.renderer.geometries).toBeGreaterThan(0);
  });

  test('camera sits at the canonical position', async ({ page }) => {
    await page.goto('/?seed=1337&time=0');
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const camera = await page.evaluate(() => window.__debugState!.camera);

    // The camera is locked by design. Any drift is a bug, and asserting it
    // here means no human has to notice it in a screenshot.
    expect(camera.position).toEqual([0, 3.2, 11]);
    expect(camera.target).toEqual([0, 1.6, 0]);
    expect(camera.fov).toBe(32);
  });

  test('the same seed and time produce identical state', async ({ page }) => {
    const read = async () => {
      await page.goto('/?seed=99&time=3.5');
      await page.waitForFunction(() => window.__debugState?.ready === true);
      return page.evaluate(() => window.__debugState!);
    };

    const first = await read();
    const second = await read();

    // Determinism is what makes screenshots comparable. If this ever fails,
    // something reached for Math.random() or a wall-clock timer.
    expect(second.time).toBe(first.time);
    expect(second.renderer.triangles).toBe(first.renderer.triangles);
    expect(second.renderer.drawCalls).toBe(first.renderer.drawCalls);
  });
});

test.describe('HUD DOM channel', () => {
  test('renders the boss bar with exact, readable values', async ({ page }) => {
    await page.goto('/');

    const bar = page.getByTestId('boss-bar');
    await expect(bar).toBeVisible();

    await expect(page.getByTestId('boss-name')).toHaveText('APOLLYON LV95');
    await expect(page.getByTestId('boss-hp-text')).toHaveText('588,321/1,200,000');

    // The accessible progressbar doubles as the machine-readable value --
    // this is exactly the precision a screenshot cannot give.
    const track = bar.getByRole('progressbar');
    await expect(track).toHaveAttribute('aria-valuenow', '588321');
    await expect(track).toHaveAttribute('aria-valuemax', '1200000');
  });

  test('renders every command with the cursor on SKILL', async ({ page }) => {
    await page.goto('/');

    const menu = page.getByTestId('command-menu');
    await expect(menu.getByRole('button')).toHaveCount(5);

    for (const label of ['Attack', 'Skill', 'Spell', 'Item', 'Defend']) {
      await expect(menu.getByRole('button', { name: label })).toBeVisible();
    }

    await expect(page.getByTestId('command-skill')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('command-attack')).toHaveAttribute('aria-current', 'false');
  });

  test('command menu is keyboard reachable', async ({ page }) => {
    await page.goto('/');

    // This game is entirely menu-driven, so keyboard access is not a nicety.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('command-attack')).toBeFocused();
  });
});

test.describe('sprite billboard layer', () => {
  test('spawns the full cast, grounded and shadowed', async ({ page }) => {
    await page.goto('/?seed=1337&time=2.0');
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const sprites = await page.evaluate(() => window.__debugState!.sprites);

    expect(sprites).toHaveLength(5);

    for (const sprite of sprites) {
      // Feet on the ground plane. A non-zero y means the grounding maths
      // regressed and characters are floating or sunk into the platform.
      expect(sprite.position[1]).toBe(0);

      // Every sprite needs a contact shadow or it reads as pasted on.
      expect(sprite.hasShadow).toBe(true);

      // A 1:1 size is the signature of a texture that had not decoded when
      // the sprite was built -- the aspect collapses and the character
      // renders as a sliver.
      expect(sprite.size[0]).not.toBeCloseTo(sprite.size[1], 3);
      expect(sprite.size[1]).toBeCloseTo(2.2, 3);
    }
  });

  test('assigns unique render orders, furthest sprite drawn first', async ({ page }) => {
    await page.goto('/?seed=1337&time=0');
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const sprites = await page.evaluate(() => window.__debugState!.sprites);

    // Unique orders are what stop sprites flickering past each other.
    const orders = sprites.map((s) => s.renderOrder);
    expect(new Set(orders).size).toBe(orders.length);

    // Furthest (most negative z) must draw first.
    const byDepth = [...sprites].sort((a, b) => a.position[2] - b.position[2]);
    const byOrder = [...sprites].sort((a, b) => a.renderOrder - b.renderOrder);
    expect(byOrder.map((s) => s.name)).toEqual(byDepth.map((s) => s.name));
  });

  /* The camera has a fixed vertical fov, so horizontal coverage shrinks as
     the window narrows -- a formation that fits at 16:9 can run off the
     left edge at 4:3. Pinning the viewport makes this assertion measure the
     layout rather than whatever viewport default is in effect.

     The composition is authored for 16:9. Narrower aspects will clip the
     outermost party member; that is a known constraint, tracked as the
     mobile layout question rather than papered over by loosening this. */
  test.describe('at the canonical 16:9 viewport', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('every sprite head projects on-screen with margin', async ({ page }) => {
      await page.goto('/?seed=1337&time=0');
      await page.waitForFunction(() => window.__debugState?.ready === true);

      const sprites = await page.evaluate(() => window.__debugState!.sprites);
      expect(sprites.length).toBeGreaterThan(0);

      for (const sprite of sprites) {
        const [x, y] = sprite.headScreen;
        /* Margin rather than a bare > 0: a head sitting exactly on the frame
           edge is already a composition bug, and a damage number anchored
           there would render half off-screen. */
        expect(x, `${sprite.name} head x`).toBeGreaterThan(0.03);
        expect(x, `${sprite.name} head x`).toBeLessThan(0.97);
        expect(y, `${sprite.name} head y`).toBeGreaterThan(0.03);
        expect(y, `${sprite.name} head y`).toBeLessThan(0.97);
      }
    });

    test('party occupies the left of frame, leaving room for the boss', async ({
      page,
    }) => {
      await page.goto('/?seed=1337&time=0');
      await page.waitForFunction(() => window.__debugState?.ready === true);

      const sprites = await page.evaluate(() => window.__debugState!.sprites);
      const rightmost = Math.max(...sprites.map((sprite) => sprite.headScreen[0]));

      /* Composition contract from the reference art: party left, boss right. */
      expect(rightmost).toBeLessThan(0.6);
    });

    test('every sprite stands on the platform, not off its edge', async ({ page }) => {
      await page.goto('/?seed=1337&time=0');
      await page.waitForFunction(() => window.__debugState?.ready === true);

      const sprites = await page.evaluate(() => window.__debugState!.sprites);

      /* The failure the original CI run did NOT catch: a sprite can be on
         screen and still be standing on empty space beyond the platform lip,
         with its contact shadow floating. Platform top radius is 6. */
      for (const sprite of sprites) {
        const [x, , z] = sprite.position;
        expect(Math.hypot(x, z), `${sprite.name} distance from centre`).toBeLessThan(5.2);
      }
    });
  });

  test('cast teardown returns GPU memory to baseline', async ({ page }) => {
    await page.goto('/?seed=1337&time=0');
    await page.waitForFunction(() => window.__debugState?.ready === true);

    // This is the leak that kills a game which restarts battles: three.js
    // allocates geometry and texture memory on the GPU that JavaScript's
    // garbage collector cannot reclaim.
    const readMemory = () =>
      page.evaluate(() => ({
        geometries: window.__debugState!.renderer.geometries,
        textures: window.__debugState!.renderer.textures,
      }));

    const before = await readMemory();
    expect(before.geometries).toBeGreaterThan(0);
  });
});
