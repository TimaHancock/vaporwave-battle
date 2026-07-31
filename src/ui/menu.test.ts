import { describe, expect, it } from 'vitest';
import {
  back,
  confirm,
  menuOptions,
  menuPanels,
  menuTitle,
  moveCursor,
  INITIAL_MENU,
  type MenuState,
} from './menu';
import { createBattle } from '../battle/battle';
import { takeAction } from '../battle/actions';
import { skillsFor } from '../battle/classes';
import { makeActor, makeBoss, makeParty, makeRoster } from '../battle/fixtures';
import { createRng } from '../rng';
import type { Action, BattleState } from '../battle/types';

/**
 * The menu is pure, so every one of these runs without a DOM. Playwright's
 * job is only to prove the rendering and the key handler agree with what is
 * asserted here -- not to re-derive it through a browser.
 */

const state = (): BattleState => createBattle(1337, makeRoster());

/**
 * The lead party member and their loadout.
 *
 * Every skill-level test below indexes into a skill LIST, and that list is
 * now KIRA's class rather than the whole table. Deriving the indices from the
 * loadout instead of hardcoding them means retuning a class -- or reordering
 * its skills -- does not silently turn these into tests of the wrong entry.
 */
const lead = () => {
  const actor = makeParty()[0]!;
  return { actor, skills: skillsFor(actor) };
};

/** Index of the lead's first ally-targeted skill, so a target list opens. */
const allySkillIndex = () =>
  lead().skills.findIndex((skill) => skill.target === 'ally');

/** Index of the lead's first enemy-targeted skill, which auto-targets. */
const enemySkillIndex = () =>
  lead().skills.findIndex((skill) => skill.target === 'enemy');

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
    /* KIRA's own three costs, read from the class table rather than written
       out -- the assertion is that the price is SHOWN, not what it is. */
    expect(options.map((option) => option.hint)).toEqual(
      lead().skills.map((skill) => `${skill.mpCost} MP`),
    );
  });

  it('offers each class its own skills, not the whole table', () => {
    const battle = state();
    const skillMenu = (id: string): string[] => {
      const index = battle.turnQueue.indexOf(id);
      const menu: MenuState = { ...INITIAL_MENU, level: 'skill', command: 'skill' };
      return menuOptions({ ...battle, turnIndex: index }, menu).map((o) => o.id);
    };

    /* The knight cannot reach the artificer's Repair Field, and the rogue is
       the only one holding Shadow Step. takeAction would resolve any of them
       happily -- the menu is where a class boundary is actually enforced. */
    expect(skillMenu('kira')).toEqual([
      'ember_lance',
      'bulwark_protocol',
      'dragons_wake',
    ]);
    expect(skillMenu('lyra')).toContain('repair_field');
    expect(skillMenu('kira')).not.toContain('repair_field');
    expect(skillMenu('vex')).toContain('shadow_step');
    expect(skillMenu('neo')).not.toContain('shadow_step');
  });

  it('labels ATTACK with the acting character own attack', () => {
    const battle = state();
    const attackLabel = (id: string): string | undefined => {
      const index = battle.turnQueue.indexOf(id);
      return menuOptions({ ...battle, turnIndex: index }, INITIAL_MENU).find(
        (option) => option.id === 'attack',
      )?.label;
    };

    expect(attackLabel('kira')).toBe('Scale Cleave');
    expect(attackLabel('vex')).toBe('Shiv');
    /* The id is unchanged, so every keyboard path and testid still works --
       only what the player reads moves. */
    expect(menuOptions(battle, INITIAL_MENU)[0]?.id).toBe('attack');
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

/**
 * The cascade.
 *
 * menuPanels is derived from MenuState rather than stored beside it, so what
 * these test is that every parent panel can in fact be reconstructed -- if it
 * could not, the alternative is a stack in state that is free to disagree
 * with the level it belongs to.
 */
describe('menuPanels', () => {
  const levels = (panels: readonly { level: string }[]) =>
    panels.map((panel) => panel.level);

  it('shows one panel at the command level', () => {
    const panels = menuPanels(state(), INITIAL_MENU);

    expect(levels(panels)).toEqual(['command']);
    expect(panels[0]?.isActive).toBe(true);
  });

  it('keeps the command panel on screen behind the skill list', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const panels = menuPanels(state(), skills);

    expect(levels(panels)).toEqual(['command', 'skill']);
    /* The parent still points at SKILL, which is how the player reads the
       path back rather than having to remember it. */
    expect(panels[0]).toMatchObject({ cursor: 1, isActive: false });
    expect(panels[1]?.isActive).toBe(true);
  });

  it('shows all three levels for a target reached through a skill', () => {
    const index = allySkillIndex();
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const targets = confirm(state(), { ...skills, cursor: index }).menu;
    const panels = menuPanels(state(), targets);

    expect(levels(panels)).toEqual(['command', 'skill', 'target']);
    expect(panels[1]?.cursor).toBe(index);
    expect(panels.filter((panel) => panel.isActive)).toHaveLength(1);
    expect(panels[2]?.isActive).toBe(true);
  });

  it('shows only two for a target reached straight from ATTACK', () => {
    /* There was no skill list on the way, and rendering an empty one would
       invent a step the player never took. Needs two enemies, because with
       one the target level is skipped entirely. */
    const twoEnemies = createBattle(1, [
      ...makeParty(),
      makeBoss(),
      makeBoss({ id: 'echo', name: 'ECHO' }),
    ]);
    const targets = confirm(twoEnemies, INITIAL_MENU).menu;

    expect(targets.level).toBe('target');
    expect(levels(menuPanels(twoEnemies, targets))).toEqual(['command', 'target']);
  });

  it('marks exactly one panel active at every level', () => {
    const battle = state();
    const skills = confirm(battle, { ...INITIAL_MENU, cursor: 1 }).menu;
    const targets = confirm(battle, { ...skills, cursor: allySkillIndex() }).menu;

    for (const menu of [INITIAL_MENU, skills, targets]) {
      expect(
        menuPanels(battle, menu).filter((panel) => panel.isActive),
        menu.level,
      ).toHaveLength(1);
    }
  });

  it('titles each panel by its own level, not by the active one', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    expect(menuPanels(state(), skills).map((panel) => panel.title)).toEqual([
      'Command',
      'Skill',
    ]);
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
    const result = confirm(state(), { ...skills, cursor: allySkillIndex() });

    expect(result.action).toBeNull();
    expect(result.menu.level).toBe('target');
    expect(menuOptions(state(), result.menu)).toHaveLength(4);
  });

  it('auto-targets an enemy skill, because there is only one enemy', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const index = enemySkillIndex();
    const result = confirm(state(), { ...skills, cursor: index });

    expect(result.action).toEqual({
      kind: 'skill',
      skillId: lead().skills[index]!.id,
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
    /* Has to be the ALLY skill: an enemy one auto-targets past the target
       level entirely, so there would be nothing to unwind from. */
    const index = allySkillIndex();
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const targets = confirm(state(), { ...skills, cursor: index }).menu;
    const returned = back(targets);

    expect(returned.level).toBe('skill');
    expect(returned.cursor).toBe(index);
    expect(returned.skillId).toBeNull();
  });

  it('unwinds all the way from a skill target in two presses', () => {
    const skills = confirm(state(), { ...INITIAL_MENU, cursor: 1 }).menu;
    const targets = confirm(state(), { ...skills, cursor: allySkillIndex() }).menu;

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
