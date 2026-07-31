import { describe, it, expect } from 'vitest';
import { CAST, PARTY, BOSS } from './cast';
import { makeRoster } from '../battle/roster';

/**
 * The cast table mirrors public/characters/CHARACTER_PROMPTS.md, and nothing
 * in TypeScript can read a markdown file to prove it. What these tests can
 * prove is the part a careless edit would actually break: the size
 * relationships the races imply, and the join with the battle roster.
 */

describe('the cast', () => {
  it('has one sprite per actor in the battle roster', () => {
    // The sprite name IS the ActorId. A cast member with no actor is a
    // sprite nothing can ever target; an actor with no cast member is an
    // actor nothing can ever draw.
    const castIds = [...CAST].map((m) => m.name).sort();
    const actorIds = makeRoster().map((a) => a.id).sort();
    expect(castIds).toEqual(actorIds);
  });

  it('agrees with the roster about which side everyone fights for', () => {
    const sides = new Map(makeRoster().map((a) => [a.id, a.side]));
    for (const member of CAST) {
      expect(sides.get(member.name), member.name).toBe(member.side);
    }
  });

  it('is four party members and one boss', () => {
    expect(PARTY).toHaveLength(4);
    expect(BOSS.name).toBe('apollyon');
  });

  /* Dragonborn knight, human wizard, tiefling rogue, halfling artificer --
     in that order, tallest to shortest. This is the relationship the art was
     generated to have, and the one a flat worldHeight destroys. */
  it('stands the party in race order, tallest first', () => {
    expect(PARTY.map((m) => m.name)).toEqual(['kira', 'neo', 'vex', 'lyra']);

    const heights = PARTY.map((m) => m.characterHeight);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!, `${PARTY[i]!.name} vs ${PARTY[i - 1]!.name}`).toBeLessThan(
        heights[i - 1]!,
      );
    }
  });

  it('makes the halfling markedly shorter than the knight, not merely shorter', () => {
    // A 3% difference is a rounding error, not a race. Lyra is described as
    // roughly two-thirds of a human adult.
    expect(BOSS.characterHeight).toBeGreaterThan(0);
    const lyra = PARTY.find((m) => m.name === 'lyra')!;
    const kira = PARTY.find((m) => m.name === 'kira')!;
    expect(lyra.characterHeight / kira.characterHeight).toBeLessThan(0.75);
  });

  it('makes the boss loom over the whole party', () => {
    const tallest = Math.max(...PARTY.map((m) => m.characterHeight));
    expect(BOSS.characterHeight).toBeGreaterThan(tallest * 1.4);
  });

  it('gives every character a positive height and a texture', () => {
    for (const member of CAST) {
      expect(member.characterHeight, member.name).toBeGreaterThan(0);
      expect(member.textureUrl).toBe(`./characters/${member.name}.png`);
    }
  });

  /* The boss is the least-minified sprite on screen, so its soft edge shows
     about twice as wide as the party's. It is the one entry that should be
     overriding the default. */
  it('tunes alphaTest for the boss and leaves the party on the default', () => {
    expect(BOSS.alphaTest).toBeGreaterThan(0.15);
    expect(BOSS.alphaTest).toBeLessThan(0.5);
    for (const member of PARTY) expect(member.alphaTest).toBeUndefined();
  });
});
