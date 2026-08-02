/**
 * The shard burst: what comes off a character when a blow lands.
 *
 * Pure maths, no three.js and no DOM -- the same split `mountains.ts`,
 * `arena.ts` and `impact.ts` follow. `battleScene.ts` owns the one pooled
 * InstancedMesh that draws whatever this describes.
 *
 * WHY SHARDS AND NOT SPARKS. Everything solid in this scene is faceted: the
 * dais, the dice, the columns, the terrain. A point sprite would have matched
 * the grid ocean and the starfield instead, which are the two things in frame
 * that are explicitly NOT objects. Debris coming off a struck character should
 * read as a piece of the world, so it is cut from the same geometry as the
 * world.
 *
 * EVERY SHARD IS A FUNCTION OF AGE, like every other curve in the impact
 * layer, and for the same reason: the caller holds nothing but "when did this
 * start", so hit-stop freezes a burst mid-air simply by holding the scene
 * clock still. Nothing integrates, so nothing can drift out of step with the
 * clock driving it -- and a burst photographed at a given age is the same
 * burst on every run.
 */

import type { Rng } from '../rng';
import type { Vec3 } from './spriteLayout';

/**
 * How long a shard lives, in seconds.
 *
 * Longer than the flash, the freeze and the shake, and about twice the recoil.
 * The debris is the last thing still moving after a blow, which is what makes
 * the hit feel like it had consequences rather than like it was a state
 * change -- but short enough that two hits in quick succession do not build up
 * a permanent cloud of glitter around the boss.
 */
export const SHARD_LIFE = 0.55;

/** Downward acceleration, world units per second squared. */
export const SHARD_GRAVITY = 9;

/**
 * Fraction of its speed a shard keeps after one second.
 *
 * Drag is what makes the burst read as a spray rather than as a firework:
 * without it every shard travels the same distance per frame for its whole
 * life and the cloud expands at a constant rate, which is not what debris
 * does. With it the shards leap out and then hang, and gravity takes over.
 */
export const SHARD_DRAG = 0.12;

/**
 * How fast a shard leaves the impact, world units per second.
 *
 * Set by what the burst looks like in its FIRST TENTH OF A SECOND, which is
 * the only part of it anybody sees -- the fade is quadratic, so a shard is
 * already half out by a quarter of its life. Early travel is essentially
 * `speed × age` whatever the drag does, so at 3.4 the whole cloud was still
 * inside half a unit at the moment it was brightest, and it read as a hot spot
 * on the character rather than as pieces leaving it.
 *
 * Bounded above by the deck: `burst.test.ts` walks every shard's whole life
 * and asserts none of them outruns the stage.
 */
export const SHARD_SPEED = 5.5;

/** How much of that speed is thrown along the blow rather than scattered. */
export const SHARD_DIRECTIONAL_BIAS = 0.55;

/** Half-size of a shard, in world units. Small: this is debris, not shrapnel. */
export const SHARD_SIZE_MIN = 0.035;
export const SHARD_SIZE_MAX = 0.085;

/** One piece of debris. Everything about it is fixed at spawn. */
export interface Shard {
  /** Initial velocity, world units per second. */
  vx: number;
  vy: number;
  vz: number;
  /** Angular velocity, radians per second, one per axis. */
  spin: Vec3;
  /** Starting orientation, so the pieces do not all face the same way. */
  tilt: Vec3;
  /** Half-extent in world units. */
  size: number;
  /** How long this shard lives, in seconds. Varied so they do not all die at once. */
  life: number;
}

/** Where a shard is, and how faded, at a given age. */
export interface ShardPose {
  x: number;
  y: number;
  z: number;
  /** Euler rotation, radians. */
  rx: number;
  ry: number;
  rz: number;
  /** 1 at the moment of impact, 0 at the end of life. */
  fade: number;
}

/**
 * A field of shards thrown by one blow.
 *
 * `direction` is which way the blow throws things -- the same -1/+1
 * `recoilDirection` produces, and passed in rather than recomputed so the
 * stagger and the debris cannot disagree about which way the hit went.
 *
 * The spray is BIASED, not aimed. Every shard gets a random direction on the
 * sphere and then has the blow's direction mixed into it, so the cloud leans
 * away from the attacker while still coming off the character in every
 * direction. Aiming them all one way reads as a jet rather than as something
 * breaking.
 */
export function spawnShards(
  rng: Rng,
  count: number,
  direction: -1 | 1,
): readonly Shard[] {
  const shards: Shard[] = [];
  if (!Number.isFinite(count) || count <= 0) return shards;

  for (let i = 0; i < Math.floor(count); i++) {
    /* A direction on the unit sphere, sampled properly: picking a polar angle
       uniformly clusters the shards at the poles, which here means a burst
       that fires mostly straight up and straight down. */
    const theta = rng.next() * Math.PI * 2;
    const z = rng.next() * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));

    const ux = Math.cos(theta) * radial;
    const uy = z;
    const uz = Math.sin(theta) * radial;

    /* Speeds vary by a third either way. A burst where every piece leaves at
       the same speed keeps its shape as an expanding shell, and a shell reads
       as an explosion effect rather than as fragments. */
    const speed = SHARD_SPEED * (0.7 + rng.next() * 0.6);

    shards.push({
      vx: (ux + direction * SHARD_DIRECTIONAL_BIAS) * speed,
      /* Lifted, so the cloud rises before gravity brings it down. Debris that
         only ever falls reads as the character shedding rather than as
         something being knocked off it. */
      vy: (uy * 0.8 + 0.55) * speed,
      /* Damped on Z: the camera is locked and nearly side-on, so depth spread
         costs draw distance and buys almost nothing on screen. */
      vz: uz * speed * 0.45,
      spin: {
        x: (rng.next() * 2 - 1) * 12,
        y: (rng.next() * 2 - 1) * 12,
        z: (rng.next() * 2 - 1) * 12,
      },
      tilt: {
        x: rng.next() * Math.PI * 2,
        y: rng.next() * Math.PI * 2,
        z: rng.next() * Math.PI * 2,
      },
      size: SHARD_SIZE_MIN + rng.next() * (SHARD_SIZE_MAX - SHARD_SIZE_MIN),
      life: SHARD_LIFE * (0.75 + rng.next() * 0.5),
    });
  }

  return shards;
}

/**
 * Where a shard is at a given age, or null once it is done.
 *
 * RETURNING NULL IS THE RETIREMENT SIGNAL, and it belongs here rather than in
 * the renderer: whether a shard is finished is a property of the curve, and a
 * renderer that decided it separately would be a second copy of `life` to keep
 * in step.
 *
 * The integral is closed-form rather than stepped. Exponential drag has one,
 * and using it means the pose depends only on `age` -- so a frozen clock
 * freezes the burst exactly, and a stepped frame at `?fxTime=` renders the
 * same burst every run rather than however many frames happened to elapse.
 */
export function shardAt(shard: Shard, age: number): ShardPose | null {
  if (!Number.isFinite(age) || age < 0) return null;
  if (age >= shard.life) return null;

  /* Distance travelled under exponential drag: the integral of v * drag^t
     from 0 to t, which is v * (drag^t - 1) / ln(drag). */
  const decay = Math.pow(SHARD_DRAG, age);
  const travel = (decay - 1) / Math.log(SHARD_DRAG);

  return {
    x: shard.vx * travel,
    /* Gravity is applied to the CLOCK rather than to the dragged velocity.
       Air resistance on a chip of debris barely touches its fall, and folding
       the two integrals together would trade a readable arc for arithmetic
       nobody can check by eye. */
    y: shard.vy * travel - 0.5 * SHARD_GRAVITY * age * age,
    z: shard.vz * travel,
    rx: shard.tilt.x + shard.spin.x * age,
    ry: shard.tilt.y + shard.spin.y * age,
    rz: shard.tilt.z + shard.spin.z * age,
    fade: fadeAt(age, shard.life),
  };
}

/**
 * How lit a shard is, 1 at impact and 0 at the end of its life.
 *
 * Quadratic rather than linear: the shards are additive neon against a dark
 * scene, and a linear ramp holds them visible for most of their flight, so the
 * burst reads as a lingering cloud. Fading fast at the start and slowly at the
 * end puts the light where the impact is.
 */
function fadeAt(age: number, life: number): number {
  if (life <= 0) return 0;
  const remaining = 1 - age / life;
  return remaining * remaining;
}
