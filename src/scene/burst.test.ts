import { describe, expect, it } from 'vitest';
import {
  SHARD_LIFE,
  SHARD_SIZE_MAX,
  SHARD_SIZE_MIN,
  shardAt,
  spawnShards,
} from './burst';
import { PLATFORM_SAFE_RADIUS } from './spriteLayout';
import { createRng } from '../rng';

/**
 * The shard burst, asserted where it is cheap.
 *
 * Whether a burst LOOKS like debris coming off a character is a screenshot
 * question and nothing here pretends otherwise. What can be pinned down is
 * that every shard retires, that none of them travels somewhere absurd, and
 * that the field is a pure function of its seed -- which is what lets the shot
 * harness photograph the same burst on every run.
 */

const COUNT = 28;

function field(seed = 1337, direction: -1 | 1 = 1) {
  return spawnShards(createRng(seed), COUNT, direction);
}

/** Every age a shard passes through, sampled finely. */
function ages(life: number): number[] {
  const out: number[] = [];
  for (let age = 0; age < life; age += life / 60) out.push(age);
  return out;
}

describe('spawnShards', () => {
  it('produces the count it was asked for', () => {
    expect(field()).toHaveLength(COUNT);
  });

  it('produces the same field for the same seed', () => {
    /* The shot harness photographs a burst mid-flight through `?fxTime=`. That
       is only a baseline if the same seed gives the same debris. */
    expect(field(1337)).toEqual(field(1337));
    expect(field(7)).not.toEqual(field(1337));
  });

  it('leans away from the attacker on both sides', () => {
    /* The party is left of centre and the boss right of it, so a blow from
       either side has to throw debris outward. Derived from the direction it
       is handed rather than from who is who -- the same argument that keeps
       `recoilDirection` from being a lookup by side. */
    const rightward = field(1337, 1).reduce((sum, s) => sum + s.vx, 0) / COUNT;
    const leftward = field(1337, -1).reduce((sum, s) => sum + s.vx, 0) / COUNT;
    expect(rightward).toBeGreaterThan(0);
    expect(leftward).toBeLessThan(0);
  });

  it('still scatters rather than firing a jet', () => {
    /* The bias leans the cloud; it must not aim it. Every shard travelling the
       same way is a jet, which reads as a magic effect rather than as
       something coming apart. */
    const shards = field();
    expect(shards.some((s) => s.vx > 0)).toBe(true);
    expect(shards.some((s) => s.vx < 0)).toBe(true);
  });

  it('throws the cloud upward on average', () => {
    /* Debris that only ever falls reads as the character shedding rather than
       as something being knocked off it. The CLOUD, not every shard: a few
       pieces going straight down is what makes it look like fragments instead
       of a fountain. */
    const meanRise = field().reduce((sum, s) => sum + s.vy, 0) / COUNT;
    expect(meanRise).toBeGreaterThan(0);
  });

  it('keeps every shard small', () => {
    for (const shard of field()) {
      expect(shard.size).toBeGreaterThanOrEqual(SHARD_SIZE_MIN);
      expect(shard.size).toBeLessThanOrEqual(SHARD_SIZE_MAX);
    }
  });

  it('returns nothing rather than a broken field for nonsense input', () => {
    expect(spawnShards(createRng(1), 0, 1)).toEqual([]);
    expect(spawnShards(createRng(1), -5, 1)).toEqual([]);
    expect(spawnShards(createRng(1), Number.NaN, 1)).toEqual([]);
  });
});

describe('shardAt', () => {
  it('starts at the impact point', () => {
    for (const shard of field()) {
      const pose = shardAt(shard, 0);
      expect(pose).not.toBeNull();
      expect(Math.hypot(pose!.x, pose!.y, pose!.z)).toBe(0);
      expect(pose!.fade).toBe(1);
    }
  });

  it('EVERY shard retires, and stays retired', () => {
    /* THE ONE THAT MATTERS. Retirement is what lets the pooled mesh reuse an
       instance slot, so a shard that never reports itself finished is a slot
       leaked for the rest of the battle -- and the field silently stops being
       able to draw new bursts once they are all gone. */
    for (const shard of field()) {
      expect(shardAt(shard, shard.life)).toBeNull();
      expect(shardAt(shard, shard.life * 4)).toBeNull();
      expect(shardAt(shard, SHARD_LIFE * 10)).toBeNull();
    }
  });

  it('fades out without ever brightening again', () => {
    for (const shard of field()) {
      let previous = Number.POSITIVE_INFINITY;
      for (const age of ages(shard.life)) {
        const { fade } = shardAt(shard, age)!;
        expect(fade).toBeLessThanOrEqual(previous + 1e-9);
        expect(fade).toBeGreaterThanOrEqual(0);
        expect(fade).toBeLessThanOrEqual(1);
        previous = fade;
      }
    }
  });

  it('never throws a shard off the stage', () => {
    /* A burst is anchored to the character it came off, and characters stand
       inside PLATFORM_SAFE_RADIUS. Debris that outran the deck would be neon
       hanging over open water with nothing under it -- the same failure the
       recoil bound exists to prevent, at a different scale. */
    const reach = PLATFORM_SAFE_RADIUS;
    for (const shard of field()) {
      for (const age of ages(shard.life)) {
        const pose = shardAt(shard, age)!;
        expect(Math.hypot(pose.x, pose.z), `age ${age.toFixed(3)}`).toBeLessThan(reach);
        expect(Number.isFinite(pose.y)).toBe(true);
      }
    }
  });

  it('arcs -- the cloud rises, and gravity always wins', () => {
    /* Gravity has to actually beat the drag. Without it the shards coast
       upward for their whole life and the burst reads as smoke rather than as
       debris.

       The RISE is asserted of the cloud and the FALL of every shard, and the
       asymmetry is deliberate: a few pieces knocked straight downward is what
       makes a burst look like fragments rather than a fountain, but a single
       shard still climbing when it expires is the drag term having eaten
       gravity, which is a bug in the curve. */
    const arcs = field().map((shard) => {
      let peak = Number.NEGATIVE_INFINITY;
      let last = 0;
      for (const age of ages(shard.life)) {
        const { y } = shardAt(shard, age)!;
        peak = Math.max(peak, y);
        last = y;
      }
      return { peak, last };
    });

    expect(arcs.reduce((sum, arc) => sum + arc.peak, 0) / COUNT).toBeGreaterThan(0);
    for (const { peak, last } of arcs) expect(last).toBeLessThan(peak);
  });

  it('spins throughout', () => {
    /* A shard that holds one orientation is a billboard, and a billboard is
       the one thing this scene already has plenty of. */
    for (const shard of field()) {
      const start = shardAt(shard, 0)!;
      const later = shardAt(shard, shard.life * 0.5)!;
      expect(
        start.rx !== later.rx || start.ry !== later.ry || start.rz !== later.rz,
      ).toBe(true);
    }
  });

  it('returns null for nonsense input rather than a NaN pose', () => {
    /* A NaN in an instance matrix does not throw. It puts the shard at nowhere
       and three.js quietly drops the whole instanced draw -- which looks like
       the burst never fired. */
    const [shard] = field();
    expect(shardAt(shard!, Number.NaN)).toBeNull();
    expect(shardAt(shard!, -1)).toBeNull();
  });
});
