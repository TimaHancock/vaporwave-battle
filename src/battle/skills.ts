/**
 * The skill table.
 *
 * Lived in actions.ts while there were three of them. It moved here for the
 * reason that file predicted: characters have individual skill lists now, and
 * a resolver should not also be a content file.
 *
 * WHO OWNS WHAT IS NOT HERE. This is a flat table keyed by id, because
 * resolution and targeting both need to look a skill up by id without caring
 * whose it is. classes.ts decides who can reach which.
 *
 * NOTHING HERE INVENTS A MECHANIC
 * -------------------------------
 * `resolveSkill` handles exactly three things: `power` (with crit), `heal`,
 * and `status`. Every entry below is built from those. Class identity comes
 * from how they are weighted -- the rogue crits, the wizard hits hardest and
 * pays for it, the artificer is the only one who heals -- not from new
 * branches in the resolver. A skill that needs a fourth primitive is a change
 * to actions.ts first and a table entry second.
 *
 * MP BUDGET: party members carry 120 max MP (roster.ts). Costs are set so a
 * character can open with their signature skill and still afford something
 * afterwards; classes.test.ts asserts nothing is priced beyond its owner's
 * maximum, which would make it permanently greyed out.
 */

import type { SkillId, Status } from './types';

export interface Skill {
  id: SkillId;
  name: string;
  mpCost: number;
  /** Which side a legal target is on, relative to the actor. */
  target: 'enemy' | 'ally';
  /** Damage multiplier. Omitted for a skill that deals none. */
  power?: number;
  critChance?: number;
  critMultiplier?: number;
  /** Fraction of the target's maxHp restored. */
  heal?: number;
  /** Status applied to the target on resolution. */
  status?: Omit<Status, 'turnsRemaining'> & { turnsRemaining: number };
}

export const SKILLS: Record<SkillId, Skill> = {
  /* ---- Knight: durable, front-loaded, protects other people ---- */

  ember_lance: {
    id: 'ember_lance',
    name: 'Ember Lance',
    mpCost: 14,
    target: 'enemy',
    power: 2.2,
    critChance: 0.15,
    critMultiplier: 2,
  },
  bulwark_protocol: {
    id: 'bulwark_protocol',
    name: 'Bulwark Protocol',
    mpCost: 12,
    target: 'ally',
    /* Below DEFEND's x2, deliberately: DEFEND costs a whole turn and protects
       only the defender, so a cheaper buff you can aim at someone else should
       not also be strictly better. */
    status: { kind: 'DEF_UP', magnitude: 1.8, turnsRemaining: 3 },
  },
  dragons_wake: {
    id: 'dragons_wake',
    name: "Dragon's Wake",
    mpCost: 28,
    target: 'enemy',
    power: 3,
    critChance: 0.25,
    critMultiplier: 2.2,
  },

  /* ---- Wizard: the highest ceiling, and the highest bill ---- */

  static_lance: {
    id: 'static_lance',
    name: 'Static Lance',
    mpCost: 16,
    target: 'enemy',
    power: 2.4,
    critChance: 0.1,
    critMultiplier: 2,
  },
  overclock: {
    id: 'overclock',
    name: 'Overclock',
    mpCost: 18,
    target: 'ally',
    status: { kind: 'ATK_UP', magnitude: 1.35, turnsRemaining: 3 },
  },
  null_cascade: {
    id: 'null_cascade',
    name: 'Null Cascade',
    mpCost: 30,
    target: 'enemy',
    power: 3.4,
    critChance: 0.2,
    critMultiplier: 2,
  },

  /* ---- Rogue: cheap, and wins on crits rather than on power ---- */

  pulse_strike: {
    id: 'pulse_strike',
    name: 'Pulse Strike',
    mpCost: 12,
    target: 'enemy',
    /* Lower power than the knight's opener but more than twice the crit
       chance. This is the whole rogue in one entry. */
    power: 2,
    critChance: 0.35,
    critMultiplier: 2.4,
  },
  shadow_step: {
    id: 'shadow_step',
    name: 'Shadow Step',
    mpCost: 14,
    target: 'ally',
    /* The only source of HASTE in the game. effectiveSpeed in turnOrder.ts has
       supported it since Phase 1 and nothing has ever applied it -- the turn
       queue rebuilds each round, so this reorders the NEXT round, not the one
       it is cast in. */
    status: { kind: 'HASTE', magnitude: 1.4, turnsRemaining: 3 },
  },
  venom_trace: {
    id: 'venom_trace',
    name: 'Venom Trace',
    mpCost: 20,
    target: 'enemy',
    power: 2.4,
    critChance: 0.3,
    critMultiplier: 2.2,
  },

  /* ---- Artificer: the only healer, and the only one who fixes things ---- */

  repair_field: {
    id: 'repair_field',
    name: 'Repair Field',
    mpCost: 20,
    target: 'ally',
    heal: 0.35,
  },
  turret_burst: {
    id: 'turret_burst',
    name: 'Turret Burst',
    mpCost: 14,
    target: 'enemy',
    power: 1.9,
    critChance: 0.15,
    critMultiplier: 2,
  },
  power_surge: {
    id: 'power_surge',
    name: 'Power Surge',
    mpCost: 16,
    target: 'ally',
    /* Weaker than the wizard's Overclock and cheaper. The artificer can buff,
       but the wizard is better at it -- that is the point of both. */
    status: { kind: 'ATK_UP', magnitude: 1.3, turnsRemaining: 3 },
  },

  /* ---- Aberration: the boss ---- */

  eye_of_ruin: {
    id: 'eye_of_ruin',
    name: 'Eye of Ruin',
    mpCost: 25,
    target: 'enemy',
    power: 2.1,
    critChance: 0.2,
    critMultiplier: 2,
  },
};
