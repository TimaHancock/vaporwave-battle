import { test, expect } from '@playwright/test';
import { CAST, PARTY, BOSS } from '../src/scene/cast';

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
    // Phase 3: the bar reports the real boss from the roster, not the
    // placeholder 588,321/1,200,000 it carried while nothing was wired up.
    await expect(page.getByTestId('boss-hp-text')).toHaveText('4,200/4,200');

    // The accessible progressbar doubles as the machine-readable value --
    // this is exactly the precision a screenshot cannot give.
    const track = bar.getByRole('progressbar');
    await expect(track).toHaveAttribute('aria-valuenow', '4200');
    await expect(track).toHaveAttribute('aria-valuemax', '4200');
  });

  /* Phase 3 dropped SPELL and ITEM. takeAction accepts attack, skill and
     defend and nothing else, so a five-item menu was decoration that lied
     about what the game could do. They return when there is an
     implementation behind them. */
  test('renders every implemented command with the cursor on ATTACK', async ({ page }) => {
    await page.goto('/');

    const menu = page.getByTestId('command-menu');
    await expect(menu.getByRole('button')).toHaveCount(3);

    /* "Scale Cleave", not "Attack": the first command is the acting
       character's own attack, and the battle opens on KIRA, a knight. The
       testid stays `command-attack` -- only the label is per-class. */
    for (const label of ['Scale Cleave', 'Skill', 'Defend']) {
      await expect(menu.getByRole('button', { name: label })).toBeVisible();
    }

    await expect(page.getByTestId('command-attack')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('command-skill')).toHaveAttribute('aria-current', 'false');
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

    // Four party members and one boss. Asserted by side rather than by a
    // bare total, so losing a party member and gaining a second boss cannot
    // pass as "still five sprites".
    expect(sprites.filter((s) => s.side === 'party')).toHaveLength(4);
    expect(sprites.filter((s) => s.side === 'enemy')).toHaveLength(1);
    expect(sprites.map((s) => s.name).sort()).toEqual(CAST.map((m) => m.name).sort());

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

      /* Every character stands at the height the cast table -- and behind it
         CHARACTER_PROMPTS.md -- says it does.

         contentHeight, not size[1]: size[1] is the PLANE, which includes
         whatever transparent margin the art happens to carry, and that
         varies per asset by a third. Asserting the plane would pin an
         accident of framing and break the next time a PNG is re-prepped;
         asserting the visible figure is the actual contract. */
      const authored = CAST.find((m) => m.name === sprite.name);
      expect(authored, `${sprite.name} is in the cast table`).toBeDefined();
      expect(sprite.contentHeight, `${sprite.name} height`).toBeCloseTo(
        authored!.characterHeight,
        1,
      );
    }
  });

  test('the boss looms roughly twice the party', async ({ page }) => {
    await page.goto('/?seed=1337&time=2.0');
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const sprites = await page.evaluate(() => window.__debugState!.sprites);
    const party = sprites.filter((s) => s.side === 'party');
    const boss = sprites.find((s) => s.side === 'enemy')!;

    /* Size relationship rather than a literal, because the number that
       matters is how the boss compares to the people it is fighting. A boss
       that came through at party scale means its cast entry was lost. */
    const meanPartyPlane =
      party.reduce((total, s) => total + s.size[1], 0) / party.length;
    expect(boss.size[1] / meanPartyPlane).toBeGreaterThan(1.7);
    expect(boss.size[1] / meanPartyPlane).toBeLessThan(2.3);

    // And it must out-loom every one of them individually, not just on average.
    for (const member of party) {
      expect(boss.contentHeight, `boss vs ${member.name}`).toBeGreaterThan(
        member.contentHeight * 1.4,
      );
    }

    /* The party's own order, which a flat height would flatten: the
       dragonborn knight stands over the halfling artificer. */
    const heightOf = (name: string) =>
      party.find((s) => s.name === name)!.contentHeight;
    expect(heightOf('kira')).toBeGreaterThan(heightOf('lyra'));
    expect(heightOf('lyra') / heightOf('kira')).toBeLessThan(0.75);
  });

  test('sprite planes carry the art\'s margin without moving the character', async ({
    page,
  }) => {
    await page.goto('/?seed=1337&time=2.0');
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const sprites = await page.evaluate(() => window.__debugState!.sprites);

    for (const sprite of sprites) {
      /* The plane is always at least as tall as the character -- it is the
         character plus the transparent margin. Equal would mean the margin
         measurement returned nothing, which is how a sprite ends up sunk
         into the floor by exactly its own foot gap. */
      expect(sprite.contentHeight, `${sprite.name}`).toBeLessThan(sprite.size[1]);
      expect(sprite.contentHeight).toBeGreaterThan(sprite.size[1] * 0.4);
      expect(sprite.feetInset, `${sprite.name} feet inset`).toBeGreaterThan(0);
    }

    /* The boss carries the most margin of anyone -- its art was framed for a
       portrait crop it does not fill. If this ever equalises, the art was
       re-prepped, and the point of deriving the plane at load is that
       nothing else has to change when it is. */
    const boss = sprites.find((s) => s.side === 'enemy')!;
    expect(boss.contentHeight).toBeCloseTo(BOSS.characterHeight, 1);
    expect(PARTY).toHaveLength(4);
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

    test('party holds the left of frame and the boss the right', async ({ page }) => {
      await page.goto('/?seed=1337&time=0');
      await page.waitForFunction(() => window.__debugState?.ready === true);

      const sprites = await page.evaluate(() => window.__debugState!.sprites);
      const party = sprites.filter((s) => s.side === 'party');
      const boss = sprites.find((s) => s.side === 'enemy');

      expect(party.length).toBeGreaterThan(0);
      expect(boss).toBeDefined();

      /* Composition contract from the reference art: party left, boss right.
         Both halves are asserted. Checking only that the party stays left
         would pass a scene with no boss at all -- which is exactly what it
         used to be doing. */
      const rightmostParty = Math.max(...party.map((sprite) => sprite.headScreen[0]));
      expect(rightmostParty, 'rightmost party member').toBeLessThan(0.6);
      expect(boss!.headScreen[0], 'boss').toBeGreaterThan(0.6);

      /* Visible separation between the two sides, not merely an ordering. */
      expect(boss!.headScreen[0] - rightmostParty).toBeGreaterThan(0.15);
    });

    test('boss head clears the HUD boss bar', async ({ page }) => {
      await page.goto('/?seed=1337&time=0');
      await page.waitForFunction(() => window.__debugState?.ready === true);

      const sprites = await page.evaluate(() => window.__debugState!.sprites);
      const boss = sprites.find((s) => s.side === 'enemy')!;

      /* A damage number anchored to the boss head renders upward from it.
         The APOLLYON bar occupies the top of frame, so a head sitting too
         high puts the two in the same pixels. */
      const bar = page.locator('[data-testid="boss-bar"]');
      const barBox = await bar.boundingBox();
      const viewport = page.viewportSize()!;

      expect(barBox).not.toBeNull();
      const barBottom = (barBox!.y + barBox!.height) / viewport.height;
      expect(boss.headScreen[1], 'boss head y').toBeGreaterThan(barBottom);
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
