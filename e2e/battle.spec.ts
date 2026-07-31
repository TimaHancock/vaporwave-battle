import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 3: the battle loop, driven through the real interface.
 *
 * These are the assertions Vitest cannot make. The pure logic is already
 * covered -- what is on trial here is the wiring: that a keypress becomes an
 * Action, that the Action reaches takeAction, that the resulting state
 * reaches the DOM, and that the input lock survives contact with a real
 * event loop.
 *
 * Where a test can read the same fact from two channels, it does. The DOM
 * says what the player sees; __debugState.battle says what the game
 * believes. A test that reads only one cannot catch them disagreeing, and
 * that disagreement is the bug this architecture exists to surface.
 */

/**
 * Pause length for the tests that assert on the input lock.
 *
 * Deliberately far longer than a playable turn. These tests are about
 * whether input is refused DURING a sequence, so the window has to be wide
 * enough that browser round-trip latency cannot close it out from under
 * them. Every other test runs at the default.
 */
const LONG_LOCK_MS = 2000;

/** Waits for the sequencer to finish whatever it is playing. */
async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__debugState?.battle?.isLocked === false);
}

/**
 * `time=0` renders one frame and halts the animation loop.
 *
 * Nothing in this file looks at the canvas -- it is all DOM and debug state --
 * and headless Chromium rasterises the scene in software at ~135-200ms a
 * frame. Leaving the loop running makes every test here compete for CPU spent
 * drawing something it never asserts on.
 *
 * It does NOT weaken what these tests are for. The sequencer runs on real
 * timers regardless of the render loop, so the input lock, the beat timing and
 * the narration order under test are the ones a player gets.
 */
async function ready(page: Page, query = ''): Promise<void> {
  await page.goto(`/?seed=1337&time=0${query}`);
  await page.waitForFunction(() => window.__debugState?.battle != null);
}

/** Boss HP as the PLAYER sees it -- parsed back out of the rendered text. */
async function bossHpFromDom(page: Page): Promise<number> {
  const text = await page.getByTestId('boss-hp-text').textContent();
  const [current] = (text ?? '').split('/');
  return Number.parseInt((current ?? '').replace(/,/g, ''), 10);
}

function battleState(page: Page) {
  return page.evaluate(() => window.__debugState!.battle!);
}

test.describe('the battle is wired to the interface', () => {
  test('opens on the first party member with real roster numbers', async ({ page }) => {
    await ready(page);

    await expect(page.getByTestId('active-actor')).toHaveText('kira');
    await expect(page.getByTestId('battle-phase')).toHaveText('IN PROGRESS');
    await expect(page.getByTestId('battle-round')).toHaveText('1');

    /* The bar used to read a fictional 588,321/1,200,000. It now reports the
       actor the battle is actually running. */
    await expect(page.getByTestId('boss-hp-text')).toHaveText('4,200/4,200');
  });

  test('shows every actor HP and MP as text', async ({ page }) => {
    await ready(page);

    for (const id of ['kira', 'neo', 'vex', 'lyra']) {
      await expect(page.getByTestId(`actor-${id}-hp`)).toHaveText('1500/1500');
      await expect(page.getByTestId(`actor-${id}-mp`)).toHaveText('120/120');
    }

    await expect(page.getByTestId('actor-apollyon-hp')).toHaveText('4200/4200');
    await expect(page.getByTestId('actor-apollyon-mp')).toHaveText('200/200');
  });

  test('previews the turn order, leading with whoever is up', async ({ page }) => {
    await ready(page);

    const slot = page.getByTestId('turn-order-slot-0');
    await expect(slot).toHaveAttribute('data-actor', 'kira');
    await expect(page.getByTestId('active-actor')).toHaveText('kira');

    /* Descending speed, boss last. The carousel shows the round as a ring, so
       each actor appears once -- the tiles beyond these are the lead-in
       duplicates the slide needs, and are read from their own testids. */
    const order = await page
      .locator('[data-testid^="turn-order-slot-"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-actor')));
    expect(order).toEqual(['kira', 'neo', 'vex', 'lyra', 'apollyon']);
  });
});

test.describe('taking a turn', () => {
  test('ATTACK reduces boss HP by exactly the amount in the event log', async ({ page }) => {
    await ready(page);

    const before = await bossHpFromDom(page);
    expect(before).toBe(4200);

    await page.keyboard.press('Enter');
    await idle(page);

    const after = await bossHpFromDom(page);
    const { log } = await battleState(page);

    const damage = log.find((event) => event['kind'] === 'damage');
    expect(damage, 'an attack should log a damage event').toBeDefined();
    expect(damage!['targetId']).toBe('apollyon');

    /* The delta is read from the DOM and the amount from the log. Asserting
       them equal is what proves the two channels describe one battle. */
    expect(before - after).toBe(damage!['amount']);
    expect(after).toBeLessThan(before);
  });

  test('narrates the action and hands the turn on', async ({ page }) => {
    await ready(page);

    await page.keyboard.press('Enter');
    await idle(page);

    await expect(page.getByTestId('narration')).toContainText('damage');
    await expect(page.getByTestId('active-actor')).toHaveText('neo');
    await expect(page.getByTestId('turn-order-slot-0')).toHaveAttribute('data-actor', 'neo');
  });

  test('pressing Enter three times rapidly produces exactly one action', async ({ page }) => {
    /* A LONG pause, not a short one. Each keyboard.press is a round trip to
       the browser, and under a full parallel run those can add up to more
       than a default-length turn -- at which point the third press would
       land on a legitimately unlocked battle and the test would fail for a
       reason that has nothing to do with the lock. Stretching the window
       makes the assertion stricter: three presses well inside one turn. */
    await ready(page, `&stepMs=${LONG_LOCK_MS}`);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await idle(page);

    const { actionsTaken, log } = await battleState(page);
    expect(actionsTaken).toBe(1);
    expect(log.filter((event) => event['kind'] === 'damage')).toHaveLength(1);

    /* And the two keypresses were dropped, not deferred -- a queued input
       would fire against a state the player never saw. */
    await expect(page.getByTestId('active-actor')).toHaveText('neo');
  });

  test('ignores the cursor while a turn is playing out', async ({ page }) => {
    await ready(page, `&stepMs=${LONG_LOCK_MS}`);

    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');

    expect((await battleState(page)).isLocked).toBe(true);
    await expect(page.getByTestId('command-attack')).toHaveAttribute('aria-current', 'true');

    await idle(page);
    await expect(page.getByTestId('command-attack')).toHaveAttribute('aria-current', 'true');
  });
});

test.describe('the enemy turn', () => {
  /* The boss acts after the fourth party member, so this is the only test
     that reaches the other half of a round. Everything above stops at the
     handover to the next party turn. */
  test('announces itself, then lands a hit on the party', async ({ page }) => {
    /* Slow enough that the announcement is observable rather than a flicker
       -- which is the behaviour under test. An enemy beat holds for three
       times this. */
    await ready(page, '&stepMs=400');

    for (let turn = 0; turn < 3; turn++) {
      await idle(page);
      await page.keyboard.press('Enter');
    }
    await idle(page);
    await expect(page.getByTestId('active-actor')).toHaveText('lyra');

    /* No idle() here -- the assertion has to catch the boss's turn while it
       is on screen. */
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('narration')).toHaveText('APOLLYON moves.');

    await idle(page);

    const { log, round } = await battleState(page);
    const hit = log.find(
      (event) => event['kind'] === 'damage' && event['sourceId'] === 'apollyon',
    );
    expect(hit, 'the boss should have attacked').toBeDefined();

    /* The damage reached the DOM, not just the log. */
    const target = String(hit!['targetId']);
    const hp = await page.getByTestId(`actor-${target}-hp`).textContent();
    expect(hp).not.toBe('1500/1500');

    expect(round).toBe(2);
    await expect(page.getByTestId('active-actor')).toHaveText('kira');
  });
});

test.describe('the menu', () => {
  test('moves the cursor with the arrow keys', async ({ page }) => {
    await ready(page);

    await expect(page.getByTestId('command-attack')).toHaveAttribute('aria-current', 'true');

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('command-skill')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('command-attack')).toHaveAttribute('aria-current', 'false');

    /* Wraps rather than stopping at the end. */
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('command-defend')).toHaveAttribute('aria-current', 'true');
  });

  test('Enter opens the skill list and Escape backs out onto SKILL', async ({ page }) => {
    await ready(page);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    /* KIRA is a knight, so this is the knight's list -- the whole skill table
       is no longer offered to everyone. */
    await expect(page.getByTestId('menu-title')).toHaveText('Skill');
    await expect(page.getByTestId('skill-ember_lance')).toBeVisible();
    await expect(page.getByTestId('skill-bulwark_protocol')).toContainText('12 MP');
    /* And the artificer's heal is not reachable from here. */
    await expect(page.getByTestId('skill-repair_field')).toHaveCount(0);

    await page.keyboard.press('Escape');

    await expect(page.getByTestId('menu-title')).toHaveText('Command');
    /* Back on SKILL, not reset to the top -- Escape is a step backwards. */
    await expect(page.getByTestId('command-skill')).toHaveAttribute('aria-current', 'true');

    /* Backing out is not a turn. Nothing was spent and nobody acted. */
    const { actionsTaken } = await battleState(page);
    expect(actionsTaken).toBe(0);
    await expect(page.getByTestId('active-actor')).toHaveText('kira');
  });

  test('an ally skill opens a target list of the four party members', async ({ page }) => {
    await ready(page);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    /* bulwark_protocol, index 1 of the knight's list: ally-targeted, so the
       choice is real rather than auto-resolved. */
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('menu-title')).toHaveText('Target');
    for (const id of ['kira', 'neo', 'vex', 'lyra']) {
      await expect(page.getByTestId(`target-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('target-apollyon')).toHaveCount(0);

    await page.keyboard.press('Enter');
    await idle(page);

    const { log } = await battleState(page);
    expect(
      log.some(
        (event) => event['kind'] === 'statusApplied' && event['targetId'] === 'kira',
      ),
    ).toBe(true);
    await expect(page.getByTestId('actor-kira-mp')).toHaveText('108/120');
    await expect(page.getByTestId('actor-kira-statuses')).toHaveText('DEF_UP');
  });

  test('DEFEND applies a guard and costs no MP', async ({ page }) => {
    await ready(page);

    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('command-defend')).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Enter');
    await idle(page);

    await expect(page.getByTestId('actor-kira-statuses')).toHaveText('DEF_UP');
    await expect(page.getByTestId('actor-kira-mp')).toHaveText('120/120');
  });
});

test.describe('the battle ends', () => {
  /* A full-strength boss is roughly 25 player actions, which at a readable
     pause length is a half-minute test. Shortening the BOSS rather than the
     pauses keeps the timing under test real -- the lock, the narration
     beats and the commit order all still happen at a player's speed. */
  test('reaches a victory state', async ({ page }) => {
    await ready(page, '&bossHp=400');
    await expect(page.getByTestId('boss-hp-text')).toHaveText('400/400');

    /* Capped so a stall fails as a named assertion rather than as a
       timeout with nothing to read. */
    const MAX_ACTIONS = 12;
    let actions = 0;

    while (actions < MAX_ACTIONS) {
      const { phase } = await battleState(page);
      if (phase !== 'in_progress') break;

      await idle(page);
      await page.keyboard.press('Enter');
      actions += 1;
    }

    await idle(page);
    const { phase, log } = await battleState(page);

    expect(phase, `still in progress after ${actions} actions`).toBe('victory');
    expect(log.at(-1)).toMatchObject({ kind: 'battleEnded', outcome: 'victory' });

    await expect(page.getByTestId('battle-phase')).toHaveText('VICTORY');
    await expect(page.getByTestId('narration')).toHaveText('VICTORY');
    await expect(page.getByTestId('boss-hp-text')).toHaveText('0/400');
    await expect(page.getByTestId('actor-apollyon')).toHaveAttribute('data-defeated', 'true');
  });

  test('stops accepting input after victory', async ({ page }) => {
    await ready(page, '&bossHp=400');

    for (let attempt = 0; attempt < 12; attempt++) {
      const { phase } = await battleState(page);
      if (phase !== 'in_progress') break;
      await idle(page);
      await page.keyboard.press('Enter');
    }
    await idle(page);

    const settled = await battleState(page);
    expect(settled.phase).toBe('victory');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const after = await battleState(page);
    expect(after.actionsTaken).toBe(settled.actionsTaken);
    expect(after.log).toHaveLength(settled.log.length);
  });
});
