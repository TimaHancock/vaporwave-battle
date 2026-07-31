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

/**
 * `time=0` is doing real work here: it renders ONE frame and halts the
 * animation loop.
 *
 * Headless Chromium has no GPU, so the scene runs through SwiftShader at
 * roughly 135-200ms a frame. Every test in this file is about the DOM, and
 * leaving the loop running means each one spends its whole life competing
 * with the others for CPU spent rasterising a scene it never looks at --
 * which is what pushed tests from 4s solo to 60s under a parallel run.
 *
 * The HUD stays completely live: publishDebugState is fed from refresh() as
 * well as from the render loop, precisely so step mode does not freeze the
 * interface. Keyboard input, the sequencer and the debug channel all behave
 * exactly as they do with the loop running.
 */
async function ready(page: Page, query = ''): Promise<void> {
  await page.goto(`/?seed=1337&time=0${query}`);
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
 * The turn-order carousel.
 *
 * A ring of the round's actors that rotates one place per turn and loops. Four
 * portraits show whole; the fifth is split across the seam, half-dissolving at
 * each edge.
 *
 * The geometry is the part that can be wrong while still looking plausible in
 * a screenshot, so most of what follows measures boxes rather than reading
 * attributes: the window has to be exactly the ring's width, and the fixed
 * cursor has to land exactly on the active portrait.
 */
test.describe('the turn-order carousel', () => {
  /** The opening round, in speed order. */
  const RING = ['kira', 'neo', 'vex', 'lyra', 'apollyon'] as const;

  /** Waits out the slide, which runs for --card-motion after a turn lands. */
  async function settled(page: Page): Promise<void> {
    await page.waitForFunction(
      () =>
        document
          .querySelector('.hud-turn-order__track')
          ?.getAnimations()
          .every((animation) => animation.playState !== 'running') ?? true,
    );
  }

  test('shows the round as a ring, each actor once, active first', async ({
    page,
  }) => {
    await ready(page);

    for (const [position, id] of RING.entries()) {
      const slot = page.getByTestId(`turn-order-slot-${position}`);
      await expect(slot).toHaveAttribute('data-actor', id);

      /* Each tile carries that actor's own art. A shared or stale portrait
         would still pass a count assertion. */
      const image = await slot
        .locator('.hud-turn__portrait')
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(image, `slot ${position} portrait`).toContain(`${id}.png`);
    }

    /* No slot 5. The ring is a cycle, not a lookahead that repeats the
       leader at the far end. */
    await expect(page.getByTestId('turn-order-slot-5')).toHaveCount(0);
  });

  test('carries two lead-in tiles, hidden from assistive tech', async ({ page }) => {
    await ready(page);

    /* The track runs N+2 wide: the two extra tiles sit off the left edge at
       rest and exist so the slide has something to bring in. They duplicate
       the ring's tail, so they must not be announced -- otherwise a screen
       reader reads two of the five characters twice. */
    await expect(page.getByTestId('turn-order').locator('li')).toHaveCount(
      RING.length + 2,
    );

    for (const [index, id] of [
      ['0', 'lyra'],
      ['1', 'apollyon'],
    ] as const) {
      const lead = page.getByTestId(`turn-order-lead-${index}`);
      await expect(lead).toHaveAttribute('data-actor', id);
      await expect(lead).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('keeps the character name readable to a screen reader', async ({ page }) => {
    await ready(page);

    await expect(page.getByTestId('turn-order-slot-0')).toHaveText('KIRA');
    await expect(page.getByTestId('turn-order').locator('ol')).toHaveAttribute(
      'aria-label',
      'Turn order',
    );
  });

  test('is exactly the ring wide, so one portrait straddles the seam', async ({
    page,
  }) => {
    await ready(page);

    const window = (await page.getByTestId('turn-order').boundingBox())!;
    const first = (await page.getByTestId('turn-order-slot-0').boundingBox())!;
    const second = (await page.getByTestId('turn-order-slot-1').boundingBox())!;
    const pitch = second.x - first.x;

    /* half + (N-1) full + half is exactly N pitches. Get this wrong and the
       split portrait stops being one character across a seam and becomes two
       arbitrary crops. */
    expect(window.width).toBeCloseTo(RING.length * pitch, 0);

    /* And the tail entry really does show at both edges: its left copy hangs
       half off the window's start, its right copy half off the end. */
    const tail = (await page.getByTestId(`turn-order-slot-${RING.length - 1}`).boundingBox())!;
    expect(tail.x + tail.width).toBeGreaterThan(window.x + window.width);
    expect(tail.x).toBeLessThan(window.x + window.width);

    const lead = (await page.getByTestId('turn-order-lead-1').boundingBox())!;
    expect(lead.x, 'lead-in hangs off the left edge').toBeLessThan(window.x);
    expect(lead.x + lead.width).toBeGreaterThan(window.x);
  });

  test('pins the cursor exactly over the active portrait', async ({ page }) => {
    await ready(page);

    const cursor = (await page.getByTestId('turn-order-cursor').boundingBox())!;
    const active = (await page.getByTestId('turn-order-slot-0').boundingBox())!;

    /* THE ASSERTION THE WHOLE GEOMETRY RESTS ON. The cursor never moves; the
       portraits rotate under it. If the resting offset and the cursor's
       left edge disagree by even a few pixels the highlight sits between two
       faces, and a static screenshot makes that look almost right. */
    expect(cursor.x + cursor.width / 2).toBeCloseTo(active.x + active.width / 2, 0);
    expect(cursor.y + cursor.height / 2).toBeCloseTo(active.y + active.height / 2, 0);
    /* A reticle around the portrait, not a border on it. */
    expect(cursor.width).toBeGreaterThan(active.width);
  });

  test('the cursor wears the same cyan as the active card, tiles stay magenta', async ({
    page,
  }) => {
    await ready(page);

    const cursor = channels(await computed(page, 'turn-order-cursor', 'border-top-color'));
    const tile = channels(await slotStyle(page, 1, 'border-top-color'));

    expect(cursor.b, 'cursor is cyan-dominant').toBeGreaterThan(cursor.r);
    expect(tile.r, 'a waiting tile is magenta-dominant').toBeGreaterThan(tile.b);

    /* The SAME cyan the active card uses, not a second one that happens to
       also be blue -- they share a CSS rule and this is what says so. */
    expect(await computed(page, 'turn-order-cursor', 'border-top-color')).toBe(
      await cardStyle(page, 'kira', 'border-top-color'),
    );
  });

  test('rotates one place per turn, and the cursor does not move', async ({ page }) => {
    await ready(page);
    const before = (await page.getByTestId('turn-order-cursor').boundingBox())!;

    await page.keyboard.press('Enter');
    await idle(page);
    await settled(page);

    /* The ring has turned by one: NEO leads and KIRA has gone to the tail,
       where the split portrait lives. */
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
      'data-actor',
      'neo',
    );
    await expect(
      page.getByTestId(`turn-order-slot-${RING.length - 1}`),
    ).toHaveAttribute('data-actor', 'kira');

    await expect(
      page.locator('[data-testid^="turn-order-slot-"][data-current]'),
    ).toHaveCount(1);
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
      'data-current',
      'true',
    );

    /* The highlight is a fixed frame: the portraits travelled, it did not. */
    const after = (await page.getByTestId('turn-order-cursor').boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 0);
  });

  test('slides on a turn change, timed with the party cards', async ({ page }) => {
    await ready(page);

    /* Recorded at the call rather than caught in flight. The turn does not
       advance until the sequencer has played its beats, and the slide then
       lasts only --card-motion -- polling for a live animation is a race
       against a 300ms window. Wrapping animate() captures exactly what the
       carousel ASKED for, which is the thing worth pinning. */
    await page.evaluate(() => {
      const track = document.querySelector('.hud-turn-order__track');
      if (track === null) throw new Error('no carousel track to observe');
      const recorded: KeyframeAnimationOptions[] = [];
      (window as unknown as Record<string, unknown>)['__slides'] = recorded;

      const original = track.animate.bind(track);
      track.animate = ((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
        recorded.push(options);
        return original(keyframes, options);
      }) as Element['animate'];
    });

    await page.keyboard.press('Enter');
    await idle(page);
    await settled(page);

    const slides = await page.evaluate(
      () =>
        (window as unknown as Record<string, KeyframeAnimationOptions[] | undefined>)[
          '__slides'
        ] ?? [],
    );

    expect(slides.length, 'one slide per turn advanced').toBe(1);
    /* Read from --card-motion, so the carousel and the cards cannot drift out
       of step -- they are one motion language. */
    const cardMotion = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--card-motion').trim(),
    );
    expect(`${slides[0]!.duration}ms`).toBe(cardMotion);
    expect(slides[0]!.easing).toBe('ease-in-out');
  });

  test('records which side each turn belongs to', async ({ page }) => {
    await ready(page);

    /* "Is the boss up next" is the question the bar exists to answer, and a
       test should be able to ask it without recognising a portrait. */
    await expect(
      page.getByTestId(`turn-order-slot-${RING.indexOf('apollyon')}`),
    ).toHaveAttribute('data-side', 'enemy');
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
      'data-side',
      'party',
    );
  });

  test('does not collide with the boss bar', async ({ page }) => {
    await ready(page);

    /* Measured on the WINDOW, not the track -- the track is N+2 tiles wide
       and translated, so its box is not what the carousel occupies. */
    const bar = (await page.getByTestId('turn-order').boundingBox())!;
    const boss = (await page.getByTestId('boss-bar').boundingBox())!;

    expect(bar.x + bar.width, 'turn order right edge vs boss bar').toBeLessThan(
      boss.x,
    );
  });

  test.describe('with reduced motion requested', () => {
    test('lands on the new order instead of travelling to it', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await ready(page);

      await page.keyboard.press('Enter');
      const running = await page
        .locator('.hud-turn-order__track')
        .evaluate((el) => el.getAnimations().length);

      /* Motion, not state: the carousel still rotates, it just does not
         travel. */
      expect(running).toBe(0);
      await idle(page);
      await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute(
        'data-actor',
        'neo',
      );
    });
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

    /* SKILL -> bulwark_protocol, the knight's ally-targeted guard, 12 MP. */
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await idle(page);

    await expect(page.getByTestId('actor-kira-mp')).toHaveText('108/120');
    await expect(page.getByTestId('actor-kira-mp-bar')).toHaveAttribute(
      'aria-valuenow',
      '108',
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

/**
 * The command menu, as a cascade.
 *
 * Two things are on trial. First that the path stays on screen -- the parent
 * panel visible and inert while its child is live. Second that the selected
 * row obeys the palette rule: cyan is a thin line accent and never a fill,
 * which this menu violated for three phases by painting the whole selected
 * row `var(--signal)`.
 */
test.describe('the command menu', () => {
  /** COMMAND -> SKILL, leaving the command panel behind as a parent. */
  async function openSkills(page: Page): Promise<void> {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menu-panel-skill')).toBeVisible();
  }

  test('opens as a single panel of the acting character commands', async ({
    page,
  }) => {
    await ready(page);

    await expect(page.getByTestId('menu-panel-command')).toHaveAttribute(
      'data-active',
      'true',
    );
    await expect(page.getByTestId('menu-panel-skill')).toHaveCount(0);
    await expect(page.getByTestId('menu-panel-target')).toHaveCount(0);

    /* The knight's cleave, not the word ATTACK -- and the testid is unchanged,
       which is what keeps every keyboard path working. */
    await expect(page.getByTestId('command-attack')).toHaveText('Scale Cleave');
  });

  test('keeps the parent panel on screen, inert, while a child is open', async ({
    page,
  }) => {
    await ready(page);
    await openSkills(page);

    const parent = page.getByTestId('menu-panel-command');
    await expect(parent).toBeVisible();
    await expect(parent).not.toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('menu-panel-skill')).toHaveAttribute(
      'data-active',
      'true',
    );

    /* The parent records the choice that got you here, and nothing in it is
       actionable -- the arrow keys cannot reach it, so it must not collect a
       Tab stop either. */
    await expect(page.getByTestId('command-skill')).toHaveAttribute(
      'data-chosen',
      'true',
    );
    await expect(page.getByTestId('command-skill')).toBeDisabled();
  });

  test('reports exactly one current row across the whole menu', async ({ page }) => {
    await ready(page);
    await openSkills(page);

    /* Two aria-current="true" would be a menu claiming to be in two places.
       The parent's chosen row uses data-chosen precisely so it does not
       compete. */
    const menu = page.getByTestId('command-menu');
    await expect(menu.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(page.getByTestId('skill-ember_lance')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('names only the active level in menu-title', async ({ page }) => {
    await ready(page);
    await expect(page.getByTestId('menu-title')).toHaveText('Command');

    await openSkills(page);
    /* Three headings are rendered now where one used to be, so this staying
       single and naming where the player IS is the contract. */
    await expect(page.getByTestId('menu-title')).toHaveCount(1);
    await expect(page.getByTestId('menu-title')).toHaveText('Skill');
  });

  test('cascades left to right, each panel clear of the last', async ({ page }) => {
    await ready(page);
    await openSkills(page);

    const command = (await page.getByTestId('menu-panel-command').boundingBox())!;
    const skill = (await page.getByTestId('menu-panel-skill').boundingBox())!;

    expect(skill.x, 'skill panel starts right of the command panel').toBeGreaterThanOrEqual(
      command.x + command.width,
    );
  });

  test('marks the selected row with cyan as a LINE, never a fill', async ({ page }) => {
    await ready(page);

    const selected = page.getByTestId('command-attack');
    const style = await selected.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, shadow: s.boxShadow, colour: s.color };
    });

    /* THE PALETTE RULE, asserted rather than trusted. This row used to be
       `background: var(--signal)` -- a solid cyan bar, the one thing
       CLAUDE.md says cyan must never be. */
    const fill = channels(style.background);
    expect(fill.b, 'selected row background is not cyan').not.toBeGreaterThan(
      Math.max(fill.r, 1) * 1.5,
    );

    /* The cyan is on the edge and in the text instead. */
    expect(style.shadow, 'a cyan inset rule').toContain('inset');
    const text = channels(style.colour);
    expect(text.b, 'selected row text is cyan').toBeGreaterThan(text.r);
  });

  test('the active panel wears the same cyan rule as the cards', async ({ page }) => {
    await ready(page);
    await openSkills(page);

    const active = channels(await computed(page, 'menu-panel-skill', 'border-top-color'));
    const parent = channels(
      await computed(page, 'menu-panel-command', 'border-top-color'),
    );

    expect(active.b, 'active panel is cyan-dominant').toBeGreaterThan(active.r);
    expect(parent.r, 'parent panel is magenta-dominant').toBeGreaterThan(parent.b);
  });

  test('shows three panels for a target reached through a skill', async ({ page }) => {
    await ready(page);
    await openSkills(page);

    /* bulwark_protocol is ally-targeted, so a real target list opens. */
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    for (const level of ['command', 'skill', 'target']) {
      await expect(page.getByTestId(`menu-panel-${level}`)).toBeVisible();
    }
    await expect(page.getByTestId('menu-title')).toHaveText('Target');

    /* Escape unwinds one level, and the target panel goes with it. */
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-panel-target')).toHaveCount(0);
    await expect(page.getByTestId('menu-title')).toHaveText('Skill');
  });

  test('the cascade stays clear of the action log across the frame', async ({ page }) => {
    await ready(page);
    await openSkills(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    /* Three panels deep is the menu at its widest and tallest. It used to
       share a flex column with the narration line to stay clear of it; the
       narration is the action log in the opposite corner now, and the menu
       owns the bottom-left alone. This says the move actually separated
       them rather than moving the collision. */
    const menu = (await page.getByTestId('command-menu').boundingBox())!;
    const log = (await page.getByTestId('action-log').boundingBox())!;

    expect(menu.y, 'menu top vs log bottom').toBeGreaterThanOrEqual(log.y + log.height);
  });
});

/**
 * Phase 5c: the action log.
 *
 * It replaced the single-line narration box, so the `narration` testid moved
 * with it -- onto the newest line, which the sequencer guarantees is the
 * current one (see SequencerView.history). Everything e2e/battle.spec.ts
 * asserts about narration is still asserting against this region.
 *
 * The load-bearing test here is the head clearance. The log grows upward off
 * a fixed bottom edge precisely so that edge is a constant, and the constant
 * is chosen against where Kira's head projects through the locked camera.
 */
test.describe('the action log', () => {
  const lines = (page: Page) => page.locator('.hud-log__line');

  /** Every line, top to bottom -- oldest first. */
  async function rows(page: Page): Promise<string[]> {
    return lines(page).allTextContents();
  }

  /**
   * Waits out the arrival keyframe AND the age-ramp transitions.
   *
   * Sampling opacity mid-animation reads a number that belongs to neither
   * the old row nor the new one, which is a flake rather than a failure --
   * the same reason the carousel has a settled() of its own.
   */
  async function still(page: Page): Promise<void> {
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.hud-log__line')].every((el) =>
        el.getAnimations().every((animation) => animation.playState !== 'running'),
      ),
    );
  }

  test('opens showing the current line and nothing else', async ({ page }) => {
    await ready(page);

    await expect(lines(page)).toHaveCount(1);
    await expect(page.getByTestId('narration')).toHaveText('Awaiting orders.');
    /* The newest line IS the narration element, not a copy sitting beside
       it. One line, one place. */
    await expect(page.getByTestId('narration')).toHaveClass(/hud-log__line/);
  });

  test('adds newest at the bottom and ages upward', async ({ page }) => {
    await ready(page, '&stepMs=0');

    const opening = await rows(page);
    await page.keyboard.press('Enter');
    await idle(page);

    const after = await rows(page);
    expect(after.length).toBeGreaterThan(opening.length);

    /* Read top to bottom, the log is oldest to newest: the opening line is
       still above what followed it. A log that grew the other way would put
       the line the player is reading at the top and push it down as the turn
       plays out, which is the one thing the fade cannot survive. */
    expect(after[0]).toBe(opening[0]);
    await expect(page.getByTestId('narration')).toHaveText(after.at(-1)!);
  });

  test('numbers the rows by age, newest zero', async ({ page }) => {
    await ready(page, '&stepMs=0');
    await page.keyboard.press('Enter');
    await idle(page);

    const ages = await lines(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-age')),
    );

    /* Top to bottom, the age counts DOWN to zero. The CSS ramp is keyed on
       this attribute, so if it ever ran the other way the newest line would
       be the faintest. */
    expect(ages).toEqual(ages.map((_, i) => String(ages.length - 1 - i)));
  });

  test('fades toward the carousel instead of cutting off', async ({ page }) => {
    await ready(page, '&stepMs=0');
    for (let turn = 0; turn < 3; turn++) {
      await page.keyboard.press('Enter');
      await idle(page);
    }
    await still(page);

    const opacities = await lines(page).evaluateAll((els) =>
      els.map((el) => Number(getComputedStyle(el).opacity)),
    );

    expect(opacities.length).toBeGreaterThan(2);
    /* Strictly increasing downward: every line is more present than the one
       above it, and the top of the stack is nearly gone before it reaches
       the turn-order bar. */
    for (let i = 1; i < opacities.length; i++) {
      expect(opacities[i]!, `row ${i} vs ${i - 1}`).toBeGreaterThan(opacities[i - 1]!);
    }
    expect(opacities.at(-1), 'the current line is fully opaque').toBe(1);
    expect(opacities[0], 'the oldest line is all but gone').toBeLessThan(0.2);
  });

  test('caps the rows however long the fight runs', async ({ page }) => {
    await ready(page, '&stepMs=0');
    for (let turn = 0; turn < 5; turn++) {
      await page.keyboard.press('Enter');
      await idle(page);
    }

    /* Five turns is well past a round, so the boss has acted and the history
       is far longer than the window. LOG_LINES in src/ui/hud.ts. */
    const history = await page.evaluate(() => window.__debugState!.battle!.actionsTaken);
    expect(history).toBeGreaterThanOrEqual(4);
    await expect(lines(page)).toHaveCount(5);
  });

  test('sits under the carousel and a clear margin above Kira', async ({ page }) => {
    await ready(page);
    await page.waitForFunction(() => window.__debugState?.ready === true);

    const viewport = page.viewportSize()!;
    const log = (await page.getByTestId('action-log').boundingBox())!;
    const carousel = (await page.getByTestId('turn-order').boundingBox())!;

    expect(log.y, 'log top vs carousel bottom').toBeGreaterThanOrEqual(
      carousel.y + carousel.height,
    );

    /* THE CONSTRAINT ON --log-height. The camera is locked, so where Kira's
       head lands is a fixed number, and the log's bottom edge is fixed too
       -- it grows upward. Reading the head from the debug channel rather
       than hardcoding 0.369 means re-laying out the party fails this test
       instead of silently dropping text on her face. */
    const sprites = await page.evaluate(() => window.__debugState!.sprites);
    const kira = sprites.find((sprite) => sprite.name === 'kira');
    expect(kira, 'kira sprite').toBeDefined();

    const bottom = (log.y + log.height) / viewport.height;
    expect(bottom, 'log bottom vs kira head').toBeLessThan(kira!.headScreen[1] - 0.05);
  });
});

/**
 * Floating combat numbers and the chain counter.
 *
 * These live in #floats, a SIBLING of #hud — renderHud replaceChildren()s its
 * own root, so a layer inside it is detached on the first render and every
 * number afterwards is appended to a node nobody can see. That failure is
 * invisible to a unit test and obvious here, which is why the position
 * assertions below are worth their cost.
 *
 * `floatMs` is the lever that makes any of this assertable: at the shipped
 * 900ms a number is gone long before a round trip can measure it. Tests that
 * inspect a float hold it open; the one test that cares about CLEANUP uses
 * the real duration, because that is the behaviour under test.
 */
test.describe('floating combat numbers', () => {
  /** Every float, whatever kind. The no-orphans check needs one selector. */
  const floats = (page: Page) => page.locator('.hud-float');

  /* `ready` pins seed 1337 and URLSearchParams.get returns the FIRST match,
     so a second `seed=` in the query string would be silently ignored. Tests
     that need a different battle build the URL themselves. */
  async function openBattle(page: Page, query: string): Promise<void> {
    await page.goto(`/?time=0&${query}`);
    await page.waitForFunction(() => window.__debugState?.battle != null);
    await page.waitForFunction(() => window.__debugState?.ready === true);
  }

  /** A turn, played out to the handover. */
  async function takeTurn(page: Page): Promise<void> {
    await page.keyboard.press('Enter');
    await idle(page);
  }

  test('a hit puts its damage over the target', async ({ page }) => {
    await ready(page, '&stepMs=0&floatMs=60000');
    await takeTurn(page);

    const number = page.getByTestId('damage-number').first();
    await expect(number).toBeVisible();

    /* The DOM says what the battle says. Read from the event log rather than
       hardcoded, so a damage-formula change does not silently invalidate
       this into a test of nothing. */
    const { log } = await page.evaluate(() => window.__debugState!.battle!);
    const damage = log.find((event) => event['kind'] === 'damage');
    expect(damage, 'a damage event').toBeDefined();
    await expect(number).toHaveText(String(damage!['amount']));
  });

  test('the number sits where the target is', async ({ page }) => {
    await ready(page, '&stepMs=0&floatMs=60000');
    await takeTurn(page);

    const viewport = page.viewportSize()!;
    const box = (await page.getByTestId('damage-number').first().boundingBox())!;
    const sprites = await page.evaluate(() => window.__debugState!.sprites);
    const boss = sprites.find((sprite) => sprite.name === 'apollyon')!;

    /* The element is `translate: -50% -100%`, so its horizontal centre is the
       anchor and its BOTTOM is the anchor — it grows up out of the head
       rather than straddling it. Anchoring is the whole feature; a number
       floating over the wrong character is worse than no number. */
    const centreX = (box.x + box.width / 2) / viewport.width;
    const bottomY = (box.y + box.height) / viewport.height;

    expect(centreX, 'number centre vs boss head x').toBeCloseTo(boss.headScreen[0], 1);
    expect(bottomY, 'number bottom vs boss head y').toBeCloseTo(boss.headScreen[1], 1);
  });

  test('a critical is marked and reads larger', async ({ page }) => {
    /* Seed 7 crits on the opening turn. Chosen rather than hunted for: a test
       that drives turns until a crit happens passes vacuously on a seed where
       one never does. */
    await openBattle(page, 'seed=7&stepMs=0&floatMs=60000');
    await takeTurn(page);

    const { log } = await page.evaluate(() => window.__debugState!.battle!);
    const crit = log.find(
      (event) => event['kind'] === 'damage' && event['isCritical'] === true,
    );
    expect(crit, 'seed 7 should crit on turn one').toBeDefined();

    const number = page.getByTestId('damage-number').first();
    await expect(number).toHaveAttribute('data-kind', 'critical');
    await expect(number).toHaveText(String(crit!['amount']));

    /* Larger, not merely a different hue: ember against magenta is a
       comparison, where twice the glyph height reads peripherally. */
    const size = await number.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize),
    );
    const ordinary = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('font-size'),
      ),
    );
    expect(size, 'critical font size').toBeGreaterThan(ordinary);
  });

  test('numbers clear the boss bar even at the top of their rise', async ({
    page,
  }) => {
    await ready(page, '&stepMs=0&floatMs=60000');
    await takeTurn(page);

    const bar = (await page.getByTestId('boss-bar').boundingBox())!;

    /* THE CONSTRAINT ON --float-rise. The boss's head projects just under the
       APOLLYON bar, and a number travels upward from it — so the resting box
       clearing the bar proves nothing. Seek the animation to its end and
       measure THERE. 99% rather than 100%: finishing it fires animationend
       and the element removes itself mid-measurement. */
    const top = await page
      .getByTestId('damage-number')
      .first()
      .evaluate((el) => {
        const animation = el.getAnimations()[0];
        if (animation !== undefined) {
          const timing = animation.effect!.getComputedTiming();
          animation.currentTime = Number(timing.activeDuration) * 0.99;
        }
        return el.getBoundingClientRect().top;
      });

    expect(top, 'risen number top vs boss bar bottom').toBeGreaterThanOrEqual(
      bar.y + bar.height,
    );
  });

  test('removes itself from the DOM, leaving no orphans', async ({ page }) => {
    /* THE REAL DURATION. Every other test here holds the numbers open, which
       is exactly the condition under which a cleanup bug hides. */
    await ready(page, '&stepMs=0');

    await takeTurn(page);
    await expect(floats(page)).not.toHaveCount(0);

    /* Back to nothing on its own, with no further interaction. */
    await expect(floats(page)).toHaveCount(0, { timeout: 5_000 });

    /* And still nothing after several more turns — a leak that drops one
       element per turn passes a single-turn check. */
    for (let turn = 0; turn < 3; turn++) await takeTurn(page);
    await expect(floats(page)).toHaveCount(0, { timeout: 5_000 });
  });

  test('the layer survives the HUD rebuilding itself', async ({ page }) => {
    /* renderHud builds its skeleton once and replaceChildren()s the root to
       do it. #floats is a sibling for that reason, and this is the assertion
       that says so — it fails if the layer is ever moved back inside #hud. */
    await ready(page, '&stepMs=0&floatMs=60000');
    await takeTurn(page);

    const parked = await page
      .getByTestId('float-layer')
      .evaluate((el) => el.closest('#hud') === null && el.isConnected);

    expect(parked, 'float layer is connected and outside #hud').toBe(true);
    await expect(page.getByTestId('damage-number').first()).toBeVisible();
  });

  test.describe('the chain counter', () => {
    test('stays hidden until a chain is actually a chain', async ({ page }) => {
      await ready(page, '&stepMs=0&floatMs=60000');

      /* Nothing landed yet. */
      await expect(page.getByTestId('chain-counter')).toHaveCount(0);

      /* One hit is a hit, not a chain. */
      await takeTurn(page);
      expect((await page.evaluate(() => window.__debugState!.battle!)).chain).toBe(1);
      await expect(page.getByTestId('chain-counter')).toHaveCount(0);
    });

    test('counts landed hits and clears the boss bar', async ({ page }) => {
      await ready(page, '&stepMs=0&floatMs=60000');
      await takeTurn(page);
      await takeTurn(page);

      const chain = (await page.evaluate(() => window.__debugState!.battle!)).chain;
      expect(chain, 'two hits in a row').toBe(2);

      const counter = page.getByTestId('chain-counter');
      /* textContent is the bare number — the word CHAIN is a ::before, the
         same arrangement the status badges use so the value stays readable. */
      await expect(counter).toHaveText(String(chain));

      const box = (await counter.boundingBox())!;
      const bar = (await page.getByTestId('boss-bar').boundingBox())!;
      expect(box.y, 'chain counter vs boss bar bottom').toBeGreaterThanOrEqual(
        bar.y + bar.height,
      );
    });

    test('breaks when the party takes damage', async ({ page }) => {
      await ready(page, '&stepMs=0&floatMs=60000');

      /* Four party turns, then the boss acts and the chain breaks. */
      for (let turn = 0; turn < 4; turn++) await takeTurn(page);

      const { chain } = await page.evaluate(() => window.__debugState!.battle!);
      expect(chain, 'the boss connecting breaks the chain').toBe(0);
      await expect(page.getByTestId('chain-counter')).toHaveCount(0);
    });
  });

  test.describe('with reduced motion requested', () => {
    test('still removes its numbers rather than leaking them', async ({ page }) => {
      /* THE ONE PLACE `animation: none` WOULD BE A BUG. Removal is driven by
         animationend, so switching the animation off under reduced motion
         means it never fires and every number ever spawned stays forever.
         The fade is kept and only the travel is dropped. */
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await ready(page, '&stepMs=0');

      await takeTurn(page);
      await expect(floats(page)).toHaveCount(0, { timeout: 5_000 });
    });
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
