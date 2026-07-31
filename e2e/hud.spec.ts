import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 5a: the party status cards.
 *
 * The cards are the first styled region in the interface, and styling is
 * exactly where a HUD can start lying: a bar can look half full while the
 * actor is at 3 HP, and no screenshot will tell you which one is wrong.
 *
 * So the assertions here are mostly CROSS-CHANNEL. `__debugState.battle` says
 * what the game believes; `aria-valuenow` says what the accessibility tree
 * reports; the computed fill width says what the player sees. Every test below
 * that matters joins at least two of those, because a HUD frozen at its boot
 * values satisfies any one of them on its own.
 *
 * Pinned to 16:9 throughout. The card strip is sized against where the
 * characters' feet project through the locked camera, so a viewport default
 * would turn a layout assertion into a measurement of Playwright's config.
 */

test.use({ viewport: { width: 1280, height: 720 } });

/** The four party members, in formation order. */
const PARTY = ['kira', 'neo', 'vex', 'lyra'] as const;

async function ready(page: Page, query = ''): Promise<void> {
  await page.goto(`/?seed=1337${query}`);
  await page.waitForFunction(() => window.__debugState?.battle != null);
}

async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__debugState?.battle?.isLocked === false);
}

function actors(page: Page) {
  return page.evaluate(() => window.__debugState!.battle!.actors);
}

/** `rgb(...)` / `rgba(...)` as channels. Computed colours are always one of these. */
function channels(colour: string): { r: number; g: number; b: number } {
  const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  return { r, g, b };
}

/** Relative luminance, good enough to compare two surfaces of the same hue family. */
function luminance(colour: string): number {
  const { r, g, b } = channels(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function computed(page: Page, testid: string, property: string) {
  return page
    .getByTestId(testid)
    .evaluate(
      (el, prop) => getComputedStyle(el).getPropertyValue(prop),
      property,
    );
}

function cardStyle(page: Page, id: string, property: string) {
  return computed(page, `party-card-${id}`, property);
}

function slotStyle(page: Page, index: number, property: string) {
  return computed(page, `turn-order-slot-${index}`, property);
}

async function cardWidth(page: Page, id: string): Promise<number> {
  const box = await page.getByTestId(`party-card-${id}`).boundingBox();
  expect(box, `${id} card box`).not.toBeNull();
  return box!.width;
}

test.describe('the party card strip', () => {
  test('renders one card per party member and none for the boss', async ({ page }) => {
    await ready(page);

    /* Asserted per id rather than as a bare count of four: "four cards" also
       passes a strip that dropped Lyra and grew an APOLLYON card, which is
       precisely the mistake worth catching. */
    for (const id of PARTY) {
      await expect(page.getByTestId(`party-card-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('party-card-apollyon')).toHaveCount(0);
    await expect(page.locator('[data-testid^="party-card-"]')).toHaveCount(4);
  });

  test('each card shows portrait, name, level, HP and MP', async ({ page }) => {
    await ready(page);

    for (const id of PARTY) {
      const card = page.getByTestId(`party-card-${id}`);

      await expect(card.getByTestId(`actor-${id}-name`)).toHaveText(id.toUpperCase());
      await expect(card.getByTestId(`actor-${id}-level`)).toHaveText('LV70');
      await expect(card.getByTestId(`actor-${id}-hp`)).toHaveText('1500/1500');
      await expect(card.getByTestId(`actor-${id}-mp`)).toHaveText('120/120');

      /* The portrait is a CSS crop of the character's sprite PNG. Assert the
         image actually resolved to a URL -- a typo'd filename renders as a
         plain plum square, which looks deliberate. */
      const portrait = card.getByTestId(`actor-${id}-portrait`);
      const image = await portrait.evaluate(
        (el) => getComputedStyle(el).backgroundImage,
      );
      expect(image, `${id} portrait`).toContain(`${id}.png`);
    }
  });

  test('both gauges are progressbars with accurate values', async ({ page }) => {
    await ready(page);

    for (const id of PARTY) {
      const hp = page.getByTestId(`actor-${id}-hp-bar`);
      await expect(hp).toHaveAttribute('role', 'progressbar');
      await expect(hp).toHaveAttribute('aria-valuemin', '0');
      await expect(hp).toHaveAttribute('aria-valuenow', '1500');
      await expect(hp).toHaveAttribute('aria-valuemax', '1500');

      const mp = page.getByTestId(`actor-${id}-mp-bar`);
      await expect(mp).toHaveAttribute('role', 'progressbar');
      await expect(mp).toHaveAttribute('aria-valuenow', '120');
      await expect(mp).toHaveAttribute('aria-valuemax', '120');
    }
  });

  test('marks exactly one card as the actor whose turn it is', async ({ page }) => {
    await ready(page);

    await expect(page.getByTestId('active-actor')).toHaveText('kira');
    await expect(page.getByTestId('party-card-kira')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.locator('[data-testid^="party-card-"][aria-current="true"]')).toHaveCount(1);

    await page.keyboard.press('Enter');
    await idle(page);

    /* The marker follows the turn rather than sticking to the first card. */
    await expect(page.getByTestId('active-actor')).toHaveText('neo');
    await expect(page.getByTestId('party-card-neo')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByTestId('party-card-kira')).toHaveAttribute(
      'aria-current',
      'false',
    );
  });
});

/**
 * The active card has to be findable at a glance.
 *
 * The first pass marked it with a magenta border on a magenta-dominant scene
 * and it disappeared into the strip. It now carries four separate signals --
 * cyan rule, cyan glow, lighter surface, larger size -- and these tests exist
 * because any one of them could be silently reverted by a palette tweak while
 * the other three carried on looking fine.
 *
 * Colours are asserted by CHANNEL DOMINANCE rather than exact rgb strings, so
 * adjusting a color-mix percentage does not break the suite, but swapping the
 * two back or collapsing them to one colour does.
 */
test.describe('the active card stands out', () => {
  test('is outlined in cyan while the idle cards are magenta', async ({ page }) => {
    await ready(page);

    const activeBorder = channels(await cardStyle(page, 'kira', 'border-top-color'));
    const idleBorder = channels(await cardStyle(page, 'neo', 'border-top-color'));

    expect(activeBorder.b, 'active border is cyan-dominant').toBeGreaterThan(
      activeBorder.r,
    );
    expect(idleBorder.r, 'idle border is magenta-dominant').toBeGreaterThan(
      idleBorder.b,
    );
  });

  test('outlines are heavy enough to read', async ({ page }) => {
    await ready(page);

    for (const id of PARTY) {
      expect(await cardStyle(page, id, 'border-top-width'), `${id} border`).toBe(
        '2px',
      );
    }
  });

  test('the idle cards sit on a darker surface', async ({ page }) => {
    await ready(page);

    const activeSurface = luminance(
      await cardStyle(page, 'kira', 'background-color'),
    );
    const idleSurface = luminance(
      await cardStyle(page, 'neo', 'background-color'),
    );

    expect(idleSurface, 'idle surface vs active').toBeLessThan(activeSurface);
  });

  test('the active card is drawn larger than the idle ones', async ({ page }) => {
    await ready(page);

    const activeWidth = await cardWidth(page, 'kira');
    const idleWidth = await cardWidth(page, 'neo');

    /* A band, not the exact token: the point is that the scale is applied and
       is visible without being a jump. */
    expect(activeWidth / idleWidth).toBeGreaterThan(1.02);
    expect(activeWidth / idleWidth).toBeLessThan(1.1);
  });

  test('the highlight and the size move to the next card together', async ({
    page,
  }) => {
    await ready(page);

    await page.keyboard.press('Enter');
    await idle(page);
    await expect(page.getByTestId('active-actor')).toHaveText('neo');
    /* Past the 300ms handover, so both properties have settled. */
    await page.waitForTimeout(600);

    const neoBorder = channels(await cardStyle(page, 'neo', 'border-top-color'));
    const kiraBorder = channels(await cardStyle(page, 'kira', 'border-top-color'));

    expect(neoBorder.b, 'neo is now the cyan card').toBeGreaterThan(neoBorder.r);
    expect(kiraBorder.r, 'kira has gone back to magenta').toBeGreaterThan(
      kiraBorder.b,
    );

    /* The size has to follow the colour. Driven by the same `aria-current`
       selector, so these coming apart means one of them stopped being. */
    expect(await cardWidth(page, 'neo')).toBeGreaterThan(
      await cardWidth(page, 'kira'),
    );
  });
});

/**
 * The turn-order bar: portraits only, next up first.
 *
 * It shares its selection cues with the party cards by sharing their CSS
 * rules, so these tests assert the cues on the BAR independently -- if someone
 * splits the grouped selectors apart later, the cards would still pass their
 * own tests while the bar quietly went plain.
 */
test.describe('the turn-order bar', () => {
  /** The opening preview: one round of five, then it wraps back to KIRA. */
  const OPENING = ['kira', 'neo', 'vex', 'lyra', 'apollyon', 'kira'] as const;

  test('shows a portrait per upcoming turn, in order', async ({ page }) => {
    await ready(page);

    const bar = page.getByTestId('turn-order');
    await expect(bar.locator('li')).toHaveCount(OPENING.length);

    for (const [index, id] of OPENING.entries()) {
      const slot = page.getByTestId(`turn-order-slot-${index}`);
      await expect(slot).toHaveAttribute('data-actor', id);

      /* Each tile carries that actor's own art. A single shared or stale
         portrait would still pass a count assertion. */
      const image = await slot
        .locator('.hud-turn__portrait')
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(image, `slot ${index} portrait`).toContain(`${id}.png`);
    }
  });

  test('keeps the character name readable to a screen reader', async ({ page }) => {
    await ready(page);

    /* The names are off-screen, not deleted -- otherwise the list announces
       as six blank items. */
    await expect(page.getByTestId('turn-order-slot-0')).toHaveText('KIRA');
    await expect(page.getByTestId('turn-order')).toHaveAttribute(
      'aria-label',
      'Turn order',
    );
  });

  test('marks the current turn once, even though KIRA appears twice', async ({
    page,
  }) => {
    await ready(page);

    /* THE TRAP THIS BAR HAS TO SURVIVE. The preview is six long and the round
       is five, so KIRA is at both index 0 and index 5. Marking the current
       turn by matching activeActorId lights both tiles. */
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
      'data-actor',
      'kira',
    );
    await expect(page.getByTestId('turn-order-slot-5')).toHaveAttribute(
      'data-actor',
      'kira',
    );

    const current = page.locator('[data-testid^="turn-order-slot-"][data-current]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('data-testid', 'turn-order-slot-0');
  });

  test('wears the same cyan-on-magenta cue as the party cards', async ({ page }) => {
    await ready(page);

    const leading = channels(await slotStyle(page, 0, 'border-top-color'));
    const waiting = channels(await slotStyle(page, 1, 'border-top-color'));

    expect(leading.b, 'leading tile is cyan-dominant').toBeGreaterThan(leading.r);
    expect(waiting.r, 'waiting tile is magenta-dominant').toBeGreaterThan(
      waiting.b,
    );

    /* And it is the SAME cyan the active card uses, not a second one that
       happens to also be blue. */
    expect(await slotStyle(page, 0, 'border-top-color')).toBe(
      await cardStyle(page, 'kira', 'border-top-color'),
    );
  });

  test('the leading tile is drawn larger, and the queue advances', async ({
    page,
  }) => {
    await ready(page);

    const leadingBox = (await page.getByTestId('turn-order-slot-0').boundingBox())!;
    const waitingBox = (await page.getByTestId('turn-order-slot-1').boundingBox())!;
    expect(leadingBox.width / waitingBox.width).toBeGreaterThan(1.05);

    await page.keyboard.press('Enter');
    await idle(page);

    /* The whole queue shifts left by one; the tile that is lit stays slot 0. */
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
      'data-actor',
      'neo',
    );
    await expect(
      page.locator('[data-testid^="turn-order-slot-"][data-current]'),
    ).toHaveCount(1);
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
      'data-current',
      'true',
    );
  });

  test('records which side each turn belongs to', async ({ page }) => {
    await ready(page);

    /* "Is the boss up next" is the question the bar exists to answer, and a
       test should be able to ask it without recognising a portrait. */
    await expect(page.getByTestId('turn-order-slot-4')).toHaveAttribute(
      'data-side',
      'enemy',
    );
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
      'data-side',
      'party',
    );
  });

  test('does not collide with the boss bar', async ({ page }) => {
    await ready(page);

    const bar = (await page.getByTestId('turn-order').boundingBox())!;
    const boss = (await page.getByTestId('boss-bar').boundingBox())!;

    expect(bar.x + bar.width, 'turn order right edge vs boss bar').toBeLessThan(
      boss.x,
    );
  });
});

test.describe('cards track the battle', () => {
  test('every card aria-valuenow matches the actor HP in debug state', async ({
    page,
  }) => {
    /* Four turns takes the round past the boss, which is the only actor that
       damages the party -- so this reaches a state where the cards must show
       something other than their boot values.

       stepMs=0 because what is on trial is the VALUES, not the timing. At the
       default pause the enemy beat alone is a second, and four turns puts the
       test within a few seconds of the 30s limit for no added coverage --
       e2e/battle.spec.ts owns the real-timing assertions. */
    await ready(page, '&stepMs=0');

    for (let turn = 0; turn < 4; turn++) {
      await idle(page);
      await page.keyboard.press('Enter');
    }
    await idle(page);

    const state = await actors(page);
    const party = state.filter((actor) => actor.side === 'party');
    expect(party).toHaveLength(4);

    /* Without this, a HUD frozen at 1500/1500 would satisfy every assertion
       below by rendering the values it was born with. */
    expect(
      party.some((actor) => actor.hp < actor.maxHp),
      'the boss should have damaged someone by the end of round one',
    ).toBe(true);

    for (const actor of party) {
      const hp = page.getByTestId(`actor-${actor.id}-hp-bar`);
      await expect(hp, `${actor.id} hp`).toHaveAttribute(
        'aria-valuenow',
        String(actor.hp),
      );
      await expect(hp).toHaveAttribute('aria-valuemax', String(actor.maxHp));

      const mp = page.getByTestId(`actor-${actor.id}-mp-bar`);
      await expect(mp, `${actor.id} mp`).toHaveAttribute(
        'aria-valuenow',
        String(actor.mp),
      );

      /* And the number the player reads, not just the one a screen reader
         does. Three channels agreeing is the point of the architecture. */
      await expect(page.getByTestId(`actor-${actor.id}-hp`)).toHaveText(
        `${actor.hp}/${actor.maxHp}`,
      );
    }
  });

  test('the rendered fill width tracks the same fraction as the aria value', async ({
    page,
  }) => {
    await ready(page, '&stepMs=0');

    for (let turn = 0; turn < 4; turn++) {
      await idle(page);
      await page.keyboard.press('Enter');
    }
    await idle(page);

    /* The bars are mid-flight the instant the state settles -- that is the
       point of them. Wait out the 400ms transition before measuring, or this
       samples an animation frame and fails on a number that was correct a
       moment later. Comfortably longer than --bar-motion. */
    await page.waitForTimeout(700);

    const state = await actors(page);

    for (const actor of state.filter((a) => a.side === 'party')) {
      const measured = await page
        .getByTestId(`actor-${actor.id}-hp-bar`)
        .locator('.hud-card__fill')
        .evaluate((fill) => {
          /* Against the track's CONTENT box, not its border box. The track
             carries the 1px cyan rule, and on a bar this short that border is
             2% of the width -- enough to make a full bar measure 0.98 and the
             assertion fail for a reason that has nothing to do with HP. */
          const track = fill.parentElement!;
          const style = getComputedStyle(track);
          const inner =
            track.getBoundingClientRect().width -
            Number.parseFloat(style.borderLeftWidth) -
            Number.parseFloat(style.borderRightWidth);
          return fill.getBoundingClientRect().width / inner;
        });

      /* A bar that reads 40% while the aria value says 3% is a HUD that lies
         to the player and tells the truth to the test suite. */
      expect(measured, `${actor.id} fill`).toBeCloseTo(actor.hp / actor.maxHp, 2);
    }
  });

  test('spending MP moves the MP bar, not just the text', async ({ page }) => {
    await ready(page);

    /* SKILL -> repair_field, an ally-targeted heal that costs 20 MP. */
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await idle(page);

    await expect(page.getByTestId('actor-kira-mp')).toHaveText('100/120');
    await expect(page.getByTestId('actor-kira-mp-bar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  test('a status effect renders as a badge without changing the text', async ({
    page,
  }) => {
    await ready(page);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await idle(page);

    await expect(page.getByTestId('status-kira-DEF_UP')).toBeVisible();

    /* THE GUARD THAT MATTERS. The badge's icon is a ::before pseudo-element
       precisely so it stays out of textContent -- which is what toHaveText
       reads, and what e2e/battle.spec.ts already asserts on this element.
       Move the glyph into the text and this fails immediately. */
    await expect(page.getByTestId('actor-kira-statuses')).toHaveText('DEF_UP');
  });
});

test.describe('the strip as a layout', () => {
  test('sits below the party feet so contact shadows stay visible', async ({
    page,
  }) => {
    await ready(page);

    const strip = await page.getByTestId('party-panel').boundingBox();
    const viewport = page.viewportSize()!;
    expect(strip).not.toBeNull();

    /* The camera is locked, so this number is a constant: a sprite's feet at
       world y = 0 project to screen y 0.743 at 16:9. Phase 4 spent real
       effort making the contact shadows ground the characters, and a taller
       strip simply covers them. */
    const top = strip!.y / viewport.height;
    expect(top, 'card strip top edge').toBeGreaterThan(0.76);
    expect(strip!.y + strip!.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  test('cards sit on screen, side by side, without overlapping', async ({ page }) => {
    await ready(page);

    const viewport = page.viewportSize()!;
    const boxes = [];
    for (const id of PARTY) {
      const box = await page.getByTestId(`party-card-${id}`).boundingBox();
      expect(box, `${id} card box`).not.toBeNull();
      boxes.push(box!);
    }

    for (const [index, box] of boxes.entries()) {
      expect(box.x, `${PARTY[index]} left`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${PARTY[index]} right`).toBeLessThanOrEqual(
        viewport.width + 1,
      );
      expect(box.width, `${PARTY[index]} width`).toBeGreaterThan(0);
    }

    /* Left to right in roster order, each clear of the last. Overlapping
       cards read as one wide panel and hide whichever member is underneath. */
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.x, `${PARTY[i]} clears ${PARTY[i - 1]}`).toBeGreaterThanOrEqual(
        boxes[i - 1]!.x + boxes[i - 1]!.width,
      );
    }
  });

  test('the command menu clears the cards rather than sitting behind them', async ({
    page,
  }) => {
    await ready(page);

    const menu = (await page.getByTestId('command-menu').boundingBox())!;
    const strip = (await page.getByTestId('party-panel').boundingBox())!;

    expect(menu.y + menu.height, 'menu bottom vs strip top').toBeLessThanOrEqual(
      strip.y,
    );
  });

  test('counters use tabular figures so they do not jitter', async ({ page }) => {
    await ready(page);

    /* The requirement is that a 1500 -> 999 transition does not reflow the
       card. Asserting the computed property is the only way to check it
       without diffing screenshots of two different HP values. */
    for (const testid of ['actor-kira-hp', 'actor-kira-mp', 'actor-kira-level']) {
      const figures = await page
        .getByTestId(testid)
        .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
      expect(figures, testid).toContain('tabular-nums');
    }
  });
});

test.describe('motion', () => {
  test('bars transition over 400ms by default', async ({ page }) => {
    await ready(page);

    const duration = await page
      .getByTestId('actor-kira-hp-bar')
      .locator('.hud-card__fill')
      .evaluate((el) => getComputedStyle(el).transitionDuration);

    expect(duration).toBe('0.4s');
  });

  test.describe('with reduced motion requested', () => {
    /* page.emulateMedia rather than test.use({ reducedMotion: 'reduce' }).
       The fixture option does not reach the page under this project's
       `devices['Desktop Chrome']` config -- matchMedia reports false and the
       test passes against unreduced CSS, which is the worst possible outcome
       for an accessibility assertion. The explicit call was verified to flip
       matchMedia to true. */
    test('bars snap instead of animating', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await ready(page);

      expect(
        await page.evaluate(
          () => matchMedia('(prefers-reduced-motion: reduce)').matches,
        ),
        'the preference actually reached the page',
      ).toBe(true);

      const duration = await page
        .getByTestId('actor-kira-hp-bar')
        .locator('.hud-card__fill')
        .evaluate((el) => getComputedStyle(el).transitionDuration);

      expect(duration).toBe('0s');

      /* The boss bar too. It has carried a transition since Phase 0 and was
         never covered, because until the HUD persisted its elements the
         transition could not fire at all. */
      const boss = await page
        .getByTestId('boss-hp-fill')
        .evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(boss).toBe('0s');

      /* And the card itself, which now animates border, background and a
         transform on every turn handover. The SIZE difference stays -- a
         reduced-motion preference asks for no animation, not for no state. */
      const card = await cardStyle(page, 'kira', 'transition-duration');
      expect(card.split(',').every((d) => d.trim() === '0s'), card).toBe(true);

      expect(await cardWidth(page, 'kira')).toBeGreaterThan(
        await cardWidth(page, 'neo'),
      );
    });
  });
});
