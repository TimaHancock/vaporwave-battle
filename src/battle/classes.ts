/**
 * What each class can do.
 *
 * Two things live here, and both are the answer to "why does this character
 * play differently from that one": the name of their basic attack, and which
 * skills they can reach. The skills themselves are in skills.ts -- that is a
 * flat table keyed by id because resolution needs to look one up without
 * caring whose it is. This file is the ownership layer on top.
 *
 * CLASSES MIRROR THE ART, THEY DO NOT INVENT IT.
 * ---------------------------------------------
 * kira is a dragonborn knight, neo a human wizard, vex a tiefling rogue, lyra
 * a halfling artificer. Those are authored in
 * public/characters/CHARACTER_PROMPTS.md, beside the prompts that produced the
 * sprites, and the names below are chosen against them -- Kira's attack is a
 * cleave because he carries a longsword point-down, Lyra swings a wrench
 * because that is what is in her hand. Change a character's class there and
 * change it here, the same discipline the heights follow in scene/cast.ts.
 */

import { SKILLS, type Skill } from './skills';
import type { Actor, ClassName, SkillId } from './types';

export interface ClassProfile {
  /** Shown in the HUD where a class needs naming. */
  label: string;
  /**
   * The basic attack's name.
   *
   * Replaces the word ATTACK in the command menu as well as in the narration,
   * so the menu changes as the turn passes down the party. That is the point:
   * the difference between these characters should be visible where the
   * player is actually looking, not only in a line that scrolls past.
   */
  attackName: string;
  /** Ids into SKILLS, in the order the menu lists them. */
  skills: readonly SkillId[];
}

export const CLASSES: Record<ClassName, ClassProfile> = {
  knight: {
    label: 'Knight',
    attackName: 'Scale Cleave',
    skills: ['ember_lance', 'bulwark_protocol', 'dragons_wake'],
  },
  wizard: {
    label: 'Wizard',
    attackName: 'Arc Bolt',
    skills: ['static_lance', 'overclock', 'null_cascade'],
  },
  rogue: {
    label: 'Rogue',
    attackName: 'Shiv',
    skills: ['pulse_strike', 'shadow_step', 'venom_trace'],
  },
  artificer: {
    label: 'Artificer',
    attackName: 'Wrench Swing',
    skills: ['repair_field', 'turret_burst', 'power_surge'],
  },
  aberration: {
    label: 'Aberration',
    attackName: 'Tendril Lash',
    /* ONE skill, and that is a decision rather than a gap. chooseEnemyAction
       takes exactly two rng draws -- a chance roll and a target pick -- so
       adding a pick over the boss's skills would shift every subsequent draw
       and silently change every seeded fight, including the screenshot
       baselines. A second boss skill is affordable the day that function
       learns to choose deliberately rather than at random. */
    skills: ['eye_of_ruin'],
  },
};

/**
 * The skills this actor can reach, in menu order.
 *
 * Returns the resolved Skill objects rather than ids: every caller -- the
 * menu, the affordability check, the tests -- wants the cost or the name, and
 * having one place do the lookup means one place can be wrong about a missing
 * id instead of four.
 */
export function skillsFor(actor: Actor): Skill[] {
  return CLASSES[actor.className].skills.map((id) => {
    const skill = SKILLS[id];
    if (skill === undefined) {
      throw new Error(
        `Class "${actor.className}" lists unknown skill "${id}". ` +
          `Known skills: ${Object.keys(SKILLS).join(', ')}.`,
      );
    }
    return skill;
  });
}

export function attackNameFor(actor: Actor): string {
  return CLASSES[actor.className].attackName;
}
