/**
 * The command menu state machine.
 *
 * Pure: every function takes state and returns new state, and nothing here
 * touches the DOM. That is what lets the whole menu be tested in Vitest in
 * milliseconds, leaving Playwright to verify only that the rendering and the
 * keyboard wiring agree with it.
 *
 * It lives in src/ui/ rather than src/battle/ because a cursor position is
 * not a battle rule -- BattleState would be carrying interface state, and
 * the renderer's promise to never write to it would be a lie.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD
 * --------------------------------------
 * takeAction THROWS on an illegal action -- an unaffordable skill, a dead
 * target, an offensive action aimed at your own side. That is the right
 * behaviour there, but it makes this file responsible for never producing
 * one. So the rule is enforced twice over: menuOptions marks anything
 * illegal as disabled, and moveCursor refuses to land on a disabled option.
 * confirm therefore cannot be reached with an illegal selection.
 */

import { SKILLS } from '../battle/actions';
import {
  isDefeated,
  type Action,
  type Actor,
  type ActorId,
  type BattleState,
  type SkillId,
} from '../battle/types';

export type MenuLevel = 'command' | 'skill' | 'target';
export type CommandId = 'attack' | 'skill' | 'defend';

/**
 * Only the three commands that exist.
 *
 * The reference art shows five, but SPELL and ITEM have nothing behind them
 * -- takeAction accepts attack, skill and defend and nothing else. A menu
 * offering a fourth is not driven by real state, it is decoration that lies.
 * They come back when there is an implementation to come back to.
 */
export const COMMANDS: readonly { id: CommandId; label: string }[] = [
  { id: 'attack', label: 'Attack' },
  { id: 'skill', label: 'Skill' },
  { id: 'defend', label: 'Defend' },
];

export interface MenuState {
  level: MenuLevel;
  cursor: number;
  /** The command being configured. Null at the command level. */
  command: CommandId | null;
  /** The skill being targeted. Null unless level is 'target' via a skill. */
  skillId: SkillId | null;
  /**
   * Cursor to restore when backing out of the target level into the skill
   * list.
   *
   * Only the skill list needs remembering. The command level's cursor is
   * recoverable from `command` -- COMMANDS is a fixed list, so SKILL is
   * always index 1 -- and deriving it beats carrying a stack of cursors that
   * can fall out of step with the level it belongs to.
   */
  skillCursor: number;
}

export const INITIAL_MENU: MenuState = {
  level: 'command',
  cursor: 0,
  command: null,
  skillId: null,
  skillCursor: 0,
};

export interface MenuOption {
  /** 'attack' | a SkillId | an ActorId, depending on the level. */
  id: string;
  label: string;
  /** A disabled option renders, but the cursor cannot rest on it. */
  enabled: boolean;
  /** Why it is disabled, or what it costs. Rendered beside the label. */
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

/** The options at the menu's current level, derived from live battle state. */
export function menuOptions(state: BattleState, menu: MenuState): MenuOption[] {
  const actor = activeParty(state);

  switch (menu.level) {
    case 'command':
      return COMMANDS.map((command) => ({
        id: command.id,
        label: command.label,
        enabled: actor === null ? false : commandEnabled(state, actor, command.id),
        hint:
          command.id === 'skill' && actor !== null && !anySkillAffordable(actor)
            ? 'no MP'
            : undefined,
      }));

    case 'skill':
      return Object.values(SKILLS).map((skill) => ({
        id: skill.id,
        label: skill.name,
        enabled: actor !== null && actor.mp >= skill.mpCost,
        hint: `${skill.mpCost} MP`,
      }));

    case 'target':
      return legalTargets(state, menu).map((target) => ({
        id: target.id,
        label: target.name,
        enabled: true,
        hint: `${target.hp}/${target.stats.maxHp}`,
      }));
  }
}

function commandEnabled(state: BattleState, actor: Actor, command: CommandId): boolean {
  switch (command) {
    case 'attack':
      return living(state, opposing(actor)).length > 0;
    case 'skill':
      return anySkillAffordable(actor);
    case 'defend':
      return true;
  }
}

function anySkillAffordable(actor: Actor): boolean {
  return Object.values(SKILLS).some((skill) => actor.mp >= skill.mpCost);
}

/**
 * Living actors on the side the pending selection wants to hit.
 *
 * Defined for the target level only; every other level has no pending
 * selection to resolve.
 */
function legalTargets(state: BattleState, menu: MenuState): Actor[] {
  const actor = activeParty(state);
  if (actor === null) return [];

  if (menu.command === 'skill') {
    const skill = menu.skillId === null ? undefined : SKILLS[menu.skillId];
    if (skill === undefined) return [];
    return skill.target === 'ally' ? living(state, actor.side) : living(state, opposing(actor));
  }

  return living(state, opposing(actor));
}

function living(state: BattleState, side: Actor['side']): Actor[] {
  return state.actors.filter((a) => a.side === side && !isDefeated(a));
}

function opposing(actor: Actor): Actor['side'] {
  return actor.side === 'party' ? 'enemy' : 'party';
}

/** The party member whose turn it is, or null if it is not a party turn. */
export function activeParty(state: BattleState): Actor | null {
  if (state.phase !== 'in_progress') return null;
  const id = state.turnQueue[state.turnIndex];
  const actor = state.actors.find((a) => a.id === id);
  if (actor === undefined || actor.side !== 'party' || isDefeated(actor)) return null;
  return actor;
}

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

/**
 * Move the cursor, wrapping at both ends and skipping disabled options.
 *
 * Skipping rather than stopping is what makes the "menu cannot produce an
 * illegal action" invariant hold without confirm having to refuse anything.
 * If every option is disabled the cursor does not move -- there is nowhere
 * legal to put it, and spinning forever looking for one would hang.
 */
export function moveCursor(state: BattleState, menu: MenuState, delta: number): MenuState {
  if (!Number.isInteger(delta)) {
    throw new Error(`moveCursor delta must be an integer, got ${delta}`);
  }

  const options = menuOptions(state, menu);
  if (options.length === 0 || delta === 0) return menu;

  const direction = delta > 0 ? 1 : -1;
  let cursor = menu.cursor;

  for (let stepped = 0; stepped < Math.abs(delta); stepped++) {
    let next = cursor;
    /* Bounded by the list length: one full lap proves there is no other
       enabled option, so we stop rather than loop. */
    for (let probe = 0; probe < options.length; probe++) {
      next = (next + direction + options.length) % options.length;
      if (options[next]?.enabled === true) break;
    }
    cursor = next;
  }

  return { ...menu, cursor };
}

/** Snap the cursor onto the first enabled option. Used when a level opens. */
function firstEnabled(options: readonly MenuOption[]): number {
  const index = options.findIndex((option) => option.enabled);
  return index === -1 ? 0 : index;
}

/* ------------------------------------------------------------------ */
/* Confirm and back                                                    */
/* ------------------------------------------------------------------ */

export interface ConfirmResult {
  menu: MenuState;
  /** Non-null when the selection completed an action ready to submit. */
  action: Action | null;
}

/**
 * Advance the selection one level, or complete it.
 *
 * TARGETS ARE AUTO-SELECTED WHEN THERE IS EXACTLY ONE
 * ---------------------------------------------------
 * With a single boss, making the player confirm ATTACK and then confirm the
 * only possible target is a keypress that carries no information. The target
 * level opens only when there is a real choice -- which today means
 * ally-targeted skills, where all four party members are legal.
 */
export function confirm(state: BattleState, menu: MenuState): ConfirmResult {
  const options = menuOptions(state, menu);
  const chosen = options[menu.cursor];
  /* A cursor on a disabled or absent option means moveCursor was bypassed.
     Refuse rather than fall through to an action takeAction would throw on. */
  if (chosen === undefined || !chosen.enabled) return { menu, action: null };

  switch (menu.level) {
    case 'command': {
      const command = COMMANDS.find((entry) => entry.id === chosen.id);
      if (command === undefined) return { menu, action: null };
      return confirmCommand(state, menu, command.id);
    }

    case 'skill':
      return openTargets(state, {
        ...menu,
        skillId: chosen.id,
        skillCursor: menu.cursor,
      });

    case 'target':
      return { menu: INITIAL_MENU, action: actionFor(menu, chosen.id) };
  }
}

function confirmCommand(
  state: BattleState,
  menu: MenuState,
  command: CommandId,
): ConfirmResult {
  if (command === 'defend') {
    return { menu: INITIAL_MENU, action: { kind: 'defend' } };
  }

  const next: MenuState = { ...menu, command, skillId: null };

  if (command === 'skill') {
    const options = menuOptions(state, { ...next, level: 'skill' });
    return {
      menu: { ...next, level: 'skill', cursor: firstEnabled(options) },
      action: null,
    };
  }

  return openTargets(state, next);
}

/** Open the target level, or skip it when the choice makes itself. */
function openTargets(state: BattleState, menu: MenuState): ConfirmResult {
  const targets = legalTargets(state, menu);

  if (targets.length === 1) {
    const only = targets[0];
    if (only !== undefined) {
      return { menu: INITIAL_MENU, action: actionFor(menu, only.id) };
    }
  }

  return { menu: { ...menu, level: 'target', cursor: 0 }, action: null };
}

function actionFor(menu: MenuState, targetId: ActorId): Action {
  if (menu.command === 'skill') {
    if (menu.skillId === null) {
      throw new Error('Reached a skill target with no skill selected.');
    }
    return { kind: 'skill', skillId: menu.skillId, targetId };
  }
  return { kind: 'attack', targetId };
}

/**
 * Back out one level, restoring the cursor you came from.
 *
 * Escaping the skill list puts the cursor back on SKILL rather than on
 * ATTACK -- returning to the top of a list you have just navigated away from
 * makes Escape feel like a reset instead of a step backwards.
 *
 * At the command level there is nothing above, so it is a no-op rather than
 * an error: a player pressing Escape at the top of the menu has not done
 * anything wrong.
 */
export function back(menu: MenuState): MenuState {
  switch (menu.level) {
    case 'command':
      return menu;

    case 'skill':
      return { ...INITIAL_MENU, cursor: commandCursor(menu.command) };

    case 'target':
      /* A target reached via a skill unwinds to the skill list; one reached
         straight from ATTACK unwinds to the command list. */
      return menu.command === 'skill'
        ? { ...menu, level: 'skill', cursor: menu.skillCursor, skillId: null }
        : { ...INITIAL_MENU, cursor: commandCursor(menu.command) };
  }
}

/** Where the cursor sat at the command level, derived from the choice made. */
function commandCursor(command: CommandId | null): number {
  const index = COMMANDS.findIndex((entry) => entry.id === command);
  return index === -1 ? 0 : index;
}

/** Heading for the current level. Shown as the menu's title. */
export function menuTitle(menu: MenuState): string {
  switch (menu.level) {
    case 'command':
      return 'Command';
    case 'skill':
      return 'Skill';
    case 'target':
      return 'Target';
  }
}
