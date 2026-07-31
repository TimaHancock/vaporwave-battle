import { describe, expect, it } from 'vitest';
import { CLASSES, attackNameFor, skillsFor } from './classes';
import { SKILLS } from './skills';
import { PARTY_STATS, makeActor, makeRoster } from './roster';
import type { ClassName } from './types';

/**
 * The class table is DATA, and these are the mistakes data makes.
 *
 * Nothing here re-tests the resolver -- actions.test.ts owns that. What is on
 * trial is the join between three tables that have to agree: the roster says
 * which class each character is, CLASSES says which skill ids that class can
 * reach, and SKILLS says what those ids mean. A typo in any one of them
 * produces a menu that is empty, or a skill nobody can ever cast, and neither
 * shows up as a crash.
 */

const classNames = Object.keys(CLASSES) as ClassName[];

describe('the class table', () => {
  it('lists only skills that exist', () => {
    for (const className of classNames) {
      for (const id of CLASSES[className].skills) {
        expect(SKILLS[id], `${className} lists "${id}"`).toBeDefined();
      }
    }
  });

  it('leaves no skill unreachable', () => {
    /* The other direction, and the one a table grows into: a skill written,
       costed and balanced, that no class was ever given. It would pass every
       other test in the suite by simply never being offered. */
    const owned = new Set(classNames.flatMap((name) => CLASSES[name].skills));

    for (const id of Object.keys(SKILLS)) {
      expect(owned.has(id), `"${id}" is owned by no class`).toBe(true);
    }
  });

  it('gives every actor in the roster a class it can look up', () => {
    for (const actor of makeRoster()) {
      expect(CLASSES[actor.className], `${actor.id}`).toBeDefined();
      expect(skillsFor(actor).length, `${actor.id} skill count`).toBeGreaterThan(0);
      expect(attackNameFor(actor), `${actor.id} attack`).not.toBe('');
    }
  });

  it('gives the four party classes three skills each, and the boss one', () => {
    for (const className of ['knight', 'wizard', 'rogue', 'artificer'] as const) {
      expect(CLASSES[className].skills, className).toHaveLength(3);
    }
    /* One, deliberately: chooseEnemyAction takes exactly two rng draws, and a
       pick over a longer list would add a third and reroll every seeded
       fight. See the note in classes.ts. */
    expect(CLASSES.aberration.skills).toHaveLength(1);
  });

  it('names every attack, and names them all differently', () => {
    const names = classNames.map((name) => CLASSES[name].attackName);

    expect(names.every((name) => name.trim().length > 0)).toBe(true);
    /* Two classes sharing an attack name means one of them was copied and not
       finished -- the whole point is that they read as different characters. */
    expect(new Set(names).size).toBe(names.length);
  });

  it('prices every party skill within reach of the MP a party member has', () => {
    /* A skill costing more than maxMp can only ever render greyed out. That
       is not a balance choice, it is content nobody will see. */
    for (const className of ['knight', 'wizard', 'rogue', 'artificer'] as const) {
      for (const skill of skillsFor(makeActor({ className }))) {
        expect(skill.mpCost, `${className}: ${skill.id}`).toBeLessThanOrEqual(
          PARTY_STATS.maxMp,
        );
        expect(skill.mpCost, `${className}: ${skill.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('lets every class open with at least two skills before running dry', () => {
    /* Affordability at FULL MP is the weak check; what makes a skill list feel
       like a list is being able to use more than one of them in a fight. */
    for (const className of ['knight', 'wizard', 'rogue', 'artificer'] as const) {
      const cheapest = skillsFor(makeActor({ className }))
        .map((skill) => skill.mpCost)
        .sort((a, b) => a - b)
        .slice(0, 2)
        .reduce((total, cost) => total + cost, 0);

      expect(cheapest, `${className} two cheapest`).toBeLessThanOrEqual(
        PARTY_STATS.maxMp,
      );
    }
  });

  it('builds every skill out of the primitives the resolver handles', () => {
    /* resolveSkill knows about power, heal and status and nothing else. A
       skill with none of them costs MP and does nothing at all -- which
       throws no error anywhere, and is invisible until someone casts it. */
    for (const skill of Object.values(SKILLS)) {
      const doesSomething =
        skill.power !== undefined ||
        skill.heal !== undefined ||
        skill.status !== undefined;
      expect(doesSomething, `"${skill.id}" has no effect`).toBe(true);
    }
  });

  it('keeps each class recognisable from its numbers alone', () => {
    const damage = (className: ClassName) =>
      skillsFor(makeActor({ className })).filter((s) => s.power !== undefined);

    /* The rogue crits where the knight hits: their signature openers cost the
       same 12-14 MP band, so the difference has to be the profile. */
    const rogueOpener = damage('rogue')[0]!;
    const knightOpener = damage('knight')[0]!;
    expect(rogueOpener.critChance!).toBeGreaterThan(knightOpener.critChance! * 2);
    expect(rogueOpener.power!).toBeLessThan(knightOpener.power!);

    /* The wizard hits hardest and pays most for it. */
    const strongest = (className: ClassName) =>
      Math.max(...damage(className).map((s) => s.power ?? 0));
    expect(strongest('wizard')).toBeGreaterThan(strongest('knight'));
    expect(strongest('wizard')).toBeGreaterThan(strongest('artificer'));

    /* The artificer is the only one who heals. */
    const healers = classNames.filter((name) =>
      skillsFor(makeActor({ className: name })).some((s) => s.heal !== undefined),
    );
    expect(healers).toEqual(['artificer']);
  });

  it('gives the rogue the only source of HASTE', () => {
    /* effectiveSpeed in turnOrder.ts has supported HASTE since Phase 1 and
       nothing ever applied it. If this disappears, that code is dead again. */
    const hasteOwners = classNames.filter((name) =>
      skillsFor(makeActor({ className: name })).some(
        (skill) => skill.status?.kind === 'HASTE',
      ),
    );
    expect(hasteOwners).toEqual(['rogue']);
  });
});
