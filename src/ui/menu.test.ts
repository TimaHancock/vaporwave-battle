import { describe, expect, it } from 'vitest';
import {
  back,
  confirm,
  menuOptions,
  menuTitle,
  moveCursor,
  INITIAL_MENU,
  type MenuState,
} from './menu';
import { createBattle } from '../battle/battle';
import { takeAction } from '../battle/actions';
import { makeActor, makeBoss, makeParty, makeRoster } from '../battle/fixtures';
import { createRng } from '../rng';
import type { Action, BattleState } from '../battle/types';

/**
 * The menu is pure, so every one of these runs without a DOM. Playwright's
 * job is only to prove the rendering and the key handler agree with what is
 * asserted here -- not to re-derive it through a browser.
 */

const state = (): BattleState => createBattle(1337, makeRoster());

/** A party whose lead has no MP, so every skill is unaffordable. */
function brokeLead(): BattleState {
  const [, ...rest] = makeParty();
  return createBattle(1, [
    makeActor({ id: 'kira', name: 'KIRA', mp: 0, stats: makeParty()[0]!.stats }),
    ...rest,
    makeBoss(),
  ]);
}

describe('menuOptions', () => {
  it('offers only the three commands that exist', () => {
    expect(menuOptions(state(), INITIAL_MENU).map((o) => o.id)).toEqual([
      'attack',
      'skill',
      'defend',
    ]);
  });

  it('disables a skill the actor cannot afford, and says the price', () => {
    const menu: MenuState = { ...INITIAL_MENU, level: 'skill', command: 'skill' };
    const options = menuOptions(brokeLead(), menu);

    /* takeAction THROWS on insufficient MP. A menu that offers an
       unaffordable skill therefore turns a UI slip into a crash, which is
       why affordability is enforced here rather than described. */
    expect(options.every((option) => !option.enabled)).toBe(true);
    expect(options.map((option) => option.hint)).toEqual(['12 MP', '18 MP', '20 MP']);
  });

  it('disables the SKILL command when nothing is affordable', () => {
    const options = menuOptions(brokeLead(), INITIAL_MENU);

    expect(options.find((option) => option.id === 'skill')).toMatchObject({
      enabled: false,
      hint: 'no MP',
    });
    expect(options.find((option) => option.id === 'attack')?.enabled).toBe(true);
  });

  it('lists living allies for an ally-targeted skill', () => {
    const menu: MenuState = {
      ...INITIAL_MENU,
      level: 'target',
      command: 'skill',
      skillId: 'repair_field',
    };

    expect(menuOptions(state(), menu).map((option) => option.id)).toEqual([
      'kira',
      'neo',
      'vex',
      'lyra',
    ]);
  });

  it('omits a defeated actor from the target list', () => {
    const wounded = createBattle(1, [
      ...makeParty().map((actor) => (actor.id === 'vex' ? { ...actor, hp: 0 } : actor)),
      makeBoss(),
    ]);
    const menu: MenuState = {
      ...INITIAL_MENU,
      level: 'target',
      command: 'skill',
      skillId: 'overclock',
    };

    expect(menuOptions(wounded, menu).map((option) => option.id)).not.toContain('vex');
  });

  it('offers nothing selectable once the battle has ended', () => {
    const ended: BattleState = { ...state(), phase: 'victory' };
    expect(menuOptions(ended, INITIAL_MENU).every((option) => !option.enabled)).toBe(true);
  });
});

describe('moveCursor', () => {
  it('wraps at both ends', () => {
    const battle = state();

    expect(moveCursor(battle, INITIAL_MENU, -1).cursor).toBe(2);
    expect(moveCursor(battle, { ...INITIAL_MENU, cursor: 2 }, 1).cursor).toBe(0);
  });

  it('skips a disabled option instead of landing on it', () => {
    /* This, not a refusal inside confirm, is what makes "the menu cannot
       produce an action takeAction rejects" true. The cursor never gets
       anywhere illegal in the first place. */
    expect(moveCursor(brokeLead(), INITIAL_MENU, 1).cursor).toBe(2);
    expect(moveCursor(brokeLead(), { ...INITIAL_MENU, cursor: 2 }, -1).cursor).toBe(0);
  });

  it('stays put when nothing is selectable, rather than spinning', () => {
    const ended: BattleState = { ...state(), phase: 'victory' };
    expect(moveCursor(ended, INITIAL_MENU, 1).cursor).toBe(0);
  });

  it('rejects a non-integer delta', () => {
    expect(() => moveCursor(state(), INITIAL_MENU, 0.5)).toThrowError(/integer/);
  });
});

describe('confirm', () => {
  it('auto-targets ATTACK when only one enemy is standing', () => {
    /* Making the player confirm the only possible target is a keypress that
       carries no information. The target level exists for real choices. */
    const result = confirm(state(), INITIAL_MENU);

    expect(result.action).toEqual({ kind: 'attack', targetId: 'apollyon' });
    expect(result.menu).toEqual(INITIAL_MENU);
  });

  it('resolves DEFEND with no target step at all', () => {
    const result = confirm(state(), { ...INITIAL_MENU, cursor: 2 });
    expect(result.action).toEqual({ kind: 'defend' });
  });

  it('opens the skill list rather than acting', () => {
    const result = confirm(state(), { ...INITIAL_MENU, cursor: 1 });

    expect(result.action).toBeNull();
    expect(result.menu.level).toBe('skill');
    expect(result.menu.command).toBe('skill');
    expect(menuTitle(result.menu)).toBe('Skill');
  });

  it('opens the target list for an ally skill, which has four choices', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    /* repair_field is index 2 in the skill table. */
    const result = confirm(state(), { ...skills, cursor: 2 });

    expect(result.action).toBeNull();
    expect(result.menu.level).toBe('target');
    expect(menuOptions(state(), result.menu)).toHaveLength(4);
  });

  it('auto-targets an enemy skill, because there is only one enemy', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const result = confirm(state(), { ...skills, cursor: 0 });

    expect(result.action).toEqual({
      kind: 'skill',
      skillId: 'pulse_strike',
      targetId: 'apollyon',
    });
  });

  it('refuses a cursor parked on a disabled option', () => {
    const result = confirm(brokeLead(), { ...INITIAL_MENU, cursor: 1 });

    expect(result.action).toBeNull();
    expect(result.menu.level).toBe('command');
  });

  /**
   * The invariant, tested as a closure rather than case by case.
   *
   * Every path the player can walk is followed to an Action, and every
   * Action is handed to takeAction. One case-by-case test per rejection
   * would prove each rule is enforced somewhere; this proves no path
   * reaches one.
   */
  it('never produces an action takeAction rejects', () => {
    const battle = state();
    const actions = reachableActions(battle);

    expect(actions.length).toBeGreaterThan(5);
    for (const action of actions) {
      expect(
        () => takeAction(battle, action, createRng(7)),
        `${JSON.stringify(action)} should be legal`,
      ).not.toThrow();
    }
  });
});

describe('back', () => {
  it('is a no-op at the command level', () => {
    expect(back(INITIAL_MENU)).toEqual(INITIAL_MENU);
  });

  it('returns the cursor to SKILL, not to the top of the menu', () => {
    /* Landing back on ATTACK would make Escape feel like a reset rather
       than a step backwards. */
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const returned = back(skills);

    expect(returned.level).toBe('command');
    expect(returned.cursor).toBe(1);
  });

  it('unwinds a skill target to the skill list, keeping its cursor', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const targets = confirm(state(), { ...skills, cursor: 2 }).menu;
    const returned = back(targets);

    expect(returned.level).toBe('skill');
    expect(returned.cursor).toBe(2);
    expect(returned.skillId).toBeNull();
  });

  it('unwinds all the way from a skill target in two presses', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const targets = confirm(state(), { ...skills, cursor: 1 }).menu;

    expect(back(back(targets))).toEqual({ ...INITIAL_MENU, cursor: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Every Action reachable by confirming, breadth-first from the command level. */
function reachableActions(battle: BattleState): Action[] {
  const found: Action[] = [];
  const frontier: MenuState[] = [INITIAL_MENU];

  while (frontier.length > 0) {
    const menu = frontier.shift();
    if (menu === undefined) continue;

    menuOptions(battle, menu).forEach((option, cursor) => {
      if (!option.enabled) return;
      const result = confirm(battle, { ...menu, cursor });
      if (result.action !== null) found.push(result.action);
      else frontier.push(result.menu);
    });
  }

  return found;
}
