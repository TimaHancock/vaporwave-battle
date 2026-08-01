/**
 * Terrain geometry for the mountain valley.
 *
 * Pure functions over numbers, no three.js -- the same split spriteLayout.ts
 * follows, and for the same reason: the constraints here are the ones worth
 * asserting, and asserting them in Vitest costs milliseconds where asserting
 * them through a browser costs seconds and a screenshot to read.
 *
 * battleScene.ts turns what comes out of here into buffers and does no
 * geometry maths of its own.
 *
 * WHAT THE VALLEY IS
 * ------------------
 * Two banks of heightfield flanking a corridor of water. They begin just past
 * the arena and run continuously back to where the fog kills them, so the
 * recession is one visible surface rather than something inferred.
 *
 * This module previously produced FLAT CUTOUTS -- three silhouette curtains at
 * fixed depths -- on the argument that a locked camera never moves to reveal
 * they are flat. That argument was wrong in a way only a screenshot showed:
 * flat is not a problem because it can be seen through, it is a problem
 * because three parallel cutouts read as painted flats in a theatre. Land
 * running away from the viewer is a different image, and no number of layers
 * gets you there.
 */

import type { Rng } from '../rng';
import { CANONICAL_ASPECT, PLATFORM_RADIUS } from './spriteLayout';

/**
 * The locked camera, mirrored as plain numbers.
 *
 * Duplicated from battleScene.ts rather than imported, for the same reason
 * spriteLayout.ts duplicates PLATFORM_RADIUS: that module owns a
 * THREE.Vector3 and this one deliberately has no three.js dependency. The
 * camera is a documented contract that does not move without an explicit
 * instruction, so the duplication is cheap -- and if it ever does move, the
 * corridor tests here fail rather than the mountains quietly drifting off the
 * frame they were composed against.
 */
const CAMERA_FOV = 32;
const CAMERA_Z = 11;

/**
 * Fraction of the frame's half-width kept clear of terrain, so the sun is
 * seen through a window rather than over a wall.
 *
 * A COMPOSITION CONSTRAINT, in the same family as PLATFORM_SAFE_RADIUS and
 * --card-strip: the camera is locked, the sun is centred, and this is the
 * share of frame the mountains may not close over.
 *
 * MEASURED AGAINST THE SUN, not picked. The disc spans about 0.11 of the
 * frame's width either side of centre, which is 0.22 of the half-width. A
 * window at 0.34 cleared the sun entirely and the ridges read as unrelated
 * shapes off in the corners; at 0.20 they climb into its lower corners and
 * it becomes a sun seen THROUGH something, which is the whole request. Most
 * of the disc is still open sky.
 */
export const SUN_WINDOW_FRACTION = 0.2;

/**
 * How close to the arena a bank may come, in world units.
 *
 * Derived from PLATFORM_RADIUS rather than typed as a number, so moving the
 * platform moves the banks with it. The 1.2 is the margin: the platform's
 * base radius is wider than its top, and a bank hard against the dais would
 * put rock behind the outermost party member's shoulder.
 */
export const ARENA_CLEARANCE = PLATFORM_RADIUS * 1.2;

/**
 * The horizon plane's height, which terrain is measured against.
 *
 * The grid ocean sits here, so this is the waterline: terrain at 0 height is
 * at the shore, terrain above it is land. Mirrored from battleScene.ts rather
 * than imported, exactly as PLATFORM_RADIUS is in spriteLayout.ts -- this
 * module does not depend on three.js and will not start now. If the grid
 * moves, move this.
 */
export const HORIZON_Y = -0.6;

/**
 * World-space half-width of the visible frame at a given depth.
 *
 * Straight frustum maths, but worth having by name: everything below is
 * expressed as a fraction of it rather than in world units, which is what
 * makes a constraint hold at every depth instead of at the one it was
 * measured at.
 */
export function frameHalfWidth(z: number, aspect = CANONICAL_ASPECT): number {
  const distance = Math.abs(CAMERA_Z - z);
  return distance * Math.tan((CAMERA_FOV * Math.PI) / 360) * aspect;
}

/**
 * World-space half-HEIGHT of the visible frame at a given depth.
 *
 * The camera's fov is vertical, so this is the honest one and frameHalfWidth
 * is it multiplied by the aspect. Peak heights are expressed against this for
 * the same reason the window is expressed against the width: a height in
 * world units means a different thing in frame at every depth.
 */
export function frameHalfHeight(z: number, aspect = CANONICAL_ASPECT): number {
  return frameHalfWidth(z, aspect) / aspect;
}

/**
 * How wide the sun's window is, in world units, at a given depth.
 *
 * THE WINDOW IS AN ANGLE, NOT A DISTANCE, and this is the function that says
 * so. Terrain spans a range of depths; a gap of a fixed number of world units
 * would subtend a wide angle up close and a narrow one far away, so the near
 * end would gape while the far end closed over the sun. Scaling the gap with
 * depth keeps every row clear of the same part of the FRAME, which is the only
 * place the constraint actually means anything.
 */
export function sunWindowHalfWidth(z: number, aspect = CANONICAL_ASPECT): number {
  return frameHalfWidth(z, aspect) * SUN_WINDOW_FRACTION;
}

/**
 * The channel the banks may not enter, at a given depth.
 *
 * ONE EXPRESSION, THREE JOBS, which is the reason to write it as a max rather
 * than as two rules in two places:
 *
 *   1. NEAR THE CAMERA THE ARENA BINDS. Whatever a seed does, no bank can
 *      crowd the platform or stand behind a party member's shoulder.
 *
 *   2. FAR AWAY THE SUN BINDS. sunWindowHalfWidth overtakes ARENA_CLEARANCE
 *      around z = -60 and the corridor widens with it from there, so the
 *      window rule governs every depth rather than three chosen ones.
 *
 *   3. IN BETWEEN, THE BANKS CONVERGE. A corridor that is constant in world
 *      units closes hard on screen: ~94% of the half-frame at z = -4, 20% by
 *      z = -60. That convergence is the depth cue flat cutouts could not
 *      produce, and it falls out of the maths rather than being tuned in.
 */
export function corridorHalfWidth(z: number, aspect = CANONICAL_ASPECT): number {
  return Math.max(sunWindowHalfWidth(z, aspect), ARENA_CLEARANCE);
}

/**
 * How far the near and far ends of the terrain sit, and therefore what
 * "normalised depth" means to everything below.
 *
 * BOTH ENDS ARE PLACED SO THE EDGE IS NOT VISIBLE, by opposite means.
 *
 * NEAR is in FRONT of the arena, past the camera's own depth for practical
 * purposes: the frame is only about +/-3.6 wide out here and the corridor is
 * 7.2, so the near rows are outside the view entirely and the bank appears to
 * carry on past the bottom of the frame. Starting it at the first depth that
 * shows any frame at all is the obvious thing and the wrong one -- the row
 * where the land begins is then a straight line running diagonally out of the
 * corner, and it reads exactly like what it is, an object that stops.
 *
 * FAR is at fog.far (96 from the camera, so world z = -85), where the fog has
 * already taken the terrain to the void colour, so the last row dissolves
 * rather than ending.
 */
export const TERRAIN_NEAR_Z = 4;
export const TERRAIN_FAR_Z = -85;

/**
 * Peak height at the frame edge, as a share of the frame's half-height.
 *
 * NOT CONSTANT WITH DEPTH, and that is the layering decision. At a constant
 * fraction every ridge is the same apparent height, so the far ones sit
 * exactly behind the near ones and are simply occluded -- a valley with one
 * visible ridge on each side. Growing the fraction with depth makes distant
 * ridges rise above nearer ones on screen, which is what stacks them into
 * layers and gives the eye something to read the recession from.
 */
export const PEAK_FRACTION_NEAR = 0.42;
export const PEAK_FRACTION_FAR = 0.58;

/**
 * How far toward the frame edge the height ramp reaches full height.
 *
 * THE ENVELOPE HAS TO TOP OUT INSIDE THE FRAME. A bank extends past the edge
 * so it has no visible end, and the first version ramped across that whole
 * span -- so the tallest land was 30% outside the view and everything on
 * screen was on the way up. The valley came out as two smooth berms with the
 * peaks cropped off. Ramping to full height at 80% of the way to the edge and
 * holding it from there puts the mass where it can be seen, and the flat top
 * beyond is only ever off screen.
 */
const RAMP_FRACTION = 0.8;

/**
 * Shortest distance the ramp may climb over, in world units.
 *
 * At the very near rows the corridor is nearly as wide as the frame, so the
 * ramp would have a fraction of a unit to get from the waterline to full
 * height -- a knife edge at the shore. Those rows are almost entirely off
 * frame, but a spike is a spike.
 */
const MIN_RAMP_REACH = 3;

/**
 * Narrowest a bank may be, corridor edge to outer edge, in world units.
 *
 * The outer edge is normally a multiple of the frame half-width, which
 * shrinks as the terrain approaches the camera -- and in front of the arena
 * the frame is NARROWER THAN THE CORRIDOR, so that multiple lands inside the
 * channel and the bank is built inside out. Every downstream property goes
 * with it: the corridor stops being clear, and the triangles wind backwards
 * and vanish. The floor keeps the bank pointing outward at every depth.
 *
 * 6 is where the two rules meet at about z = -9, so the outer edge is
 * continuous rather than stepping as one takes over from the other.
 */
const MIN_BANK_WIDTH = 6;

/**
 * Envelope height at the frame edge for a given depth, in world units.
 *
 * The height counterpart of sunWindowHalfWidth: expressed against the frame
 * rather than in absolutes, so it means the same thing at every depth.
 */
export function peakHeightAt(z: number, aspect = CANONICAL_ASPECT): number {
  const t = depthFraction(z);
  const fraction = PEAK_FRACTION_NEAR + (PEAK_FRACTION_FAR - PEAK_FRACTION_NEAR) * t;
  return frameHalfHeight(z, aspect) * fraction;
}

/** Where a depth sits between the near and far ends, clamped to 0..1. */
function depthFraction(z: number): number {
  const span = TERRAIN_NEAR_Z - TERRAIN_FAR_Z;
  return clamp((TERRAIN_NEAR_Z - z) / span, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Hermite ease, so lattice cells meet with matching slope rather than a crease. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface BankOptions {
  /** -1 for the left bank, +1 for the right. */
  side: -1 | 1;
  /** Samples across the bank, corridor edge to frame edge. */
  columns: number;
  /** Samples in depth, near to far. */
  rows: number;
  /**
   * How much of the envelope the relief controls, 0..1.
   *
   * At 0 the bank is the bare envelope -- a smooth ramp. At 0.75 a trough
   * sits at a quarter of the envelope and a crest reaches all of it, which
   * is a mountain range. At 1 the troughs reach the waterline and the bank
   * becomes a row of islands.
   */
  roughness: number;
  /** Lattice resolution of the coarsest noise octave. More is busier. */
  octaveCells: number;
  aspect?: number;
}

export interface TerrainVertex {
  x: number;
  y: number;
  z: number;
  /**
   * Baked lighting, 0..1. Dark valley floor to lit peak.
   *
   * A VALUE, NOT A COLOUR -- battleScene.ts decides what two colours it lerps
   * between. Keeping it a scalar is what lets this module stay free of the
   * palette as well as of three.js.
   */
  shade: number;
}

export interface Bank {
  columns: number;
  rows: number;
  /** Row-major: row * columns + column. Row 0 is nearest the camera. */
  vertices: TerrainVertex[];
}

/**
 * The sun, as a position to shade against -- LIFTED.
 *
 * x and z are the sun mesh's own, from battleScene.ts. It is the only light
 * source in frame, so it is the only one the terrain can plausibly be lit by:
 * shading these from the character key light at (-4, 6, 6) would put the
 * highlights on the wrong side of every peak while a sun blazes dead centre
 * behind them. Taking the direction per vertex rather than as a constant is
 * also what makes the lighting frame the corridor -- the sun is at x = 0, so
 * "toward the sun" is "inward" on both banks without either knowing which
 * side it is.
 *
 * THE HEIGHT IS A CHEAT AND IT IS THE POINT. The real sun sits at y = 5.31,
 * about five degrees above a horizon 100 units away, which is grazing
 * incidence on a heightfield: the dot product against a near-vertical normal
 * is close to zero everywhere, so the whole surface shades to one flat value
 * and the terrain reads as a black sheet with a wireframe on it. That is
 * measurable, not a matter of taste -- the middle half of the field spanned
 * 0.08 of the ramp. Lifting the light gives the normals something to vary
 * against while keeping the azimuth, and therefore the composition, honest.
 * The same authored-over-physical trade the sprites already make.
 */
const SUN_SHADING_POSITION = { x: 0, y: 40, z: -100 };

/**
 * Contrast on the slope term, about a level surface.
 *
 * Even lifted, the usable range of the dot product is a fraction of [-1, 1]:
 * this terrain's slopes are gentle by design, because a valley the arena sits
 * in should not be a canyon. The gain spends the ramp on the range the
 * geometry actually produces instead of on the range a sphere would.
 */
const SHADE_PIVOT = 0.5;
const SHADE_GAIN = 3;

/**
 * How much of the shade comes from which term.
 *
 * The slope term is the one that produces form. The height term is a floor
 * under it: where a slope happens to face square-on to the sun, neighbouring
 * peaks and troughs shade identically and the ridge flattens out, and a small
 * altitude bias keeps the crest legible through that.
 */
const SLOPE_WEIGHT = 0.72;
const HEIGHT_WEIGHT = 0.28;

/**
 * One bank of terrain, near row first.
 *
 * Seeded rather than random. `Math.random()` is banned project-wide, and the
 * screenshot baseline needs the same seed to build the same mountains.
 *
 * The corridor constraint is ENFORCED HERE rather than trusted to the caller:
 * column 0 sits exactly on corridorHalfWidth(z) at every row, and the height
 * envelope is zero there, so a bank rises out of the water at the shoreline
 * and cannot present a cliff wall to the channel. That is the
 * fitSpacingToPlatform move -- a composition rule the geometry enforces.
 */
export function buildBank(rng: Rng, options: BankOptions): Bank {
  const {
    side,
    columns,
    rows,
    roughness,
    octaveCells,
    aspect = CANONICAL_ASPECT,
  } = options;

  if (columns < 2 || rows < 2) {
    throw new Error(
      `A bank needs at least 2 columns and 2 rows, got ${columns}x${rows}`,
    );
  }

  /* Two octaves, drawn UP FRONT as lattices of amplitudes.
     A sequential generator cannot be sampled at (u, v) on demand, so the
     draws happen here in a fixed order and the surface interpolates between
     them. That is what makes the terrain random-access and still
     deterministic: the same seed draws the same lattice, whatever order the
     vertices are then visited in. */
  const coarse = noiseLattice(rng, octaveCells);
  const fine = noiseLattice(rng, octaveCells * 2);

  const vertices: TerrainVertex[] = [];

  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    const z = lerp(TERRAIN_NEAR_Z, TERRAIN_FAR_Z, v);
    const inner = corridorHalfWidth(z, aspect);
    const frameEdge = frameHalfWidth(z, aspect);
    /* Past the frame edge on purpose. A bank that stops exactly at the edge
       shows its outer end as a vertical cut the moment the window is anything
       but 16:9, and the composition is authored for 16:9 but must not fall
       apart off it. Floored so the bank cannot invert in front of the arena
       -- see MIN_BANK_WIDTH. */
    const outer = Math.max(frameEdge * 1.3, inner + MIN_BANK_WIDTH);
    const peak = peakHeightAt(z, aspect);
    /* Measured to the FRAME EDGE, not to `outer` -- see RAMP_FRACTION. */
    const reach = Math.max((frameEdge - inner) * RAMP_FRACTION, MIN_RAMP_REACH);

    for (let column = 0; column < columns; column++) {
      const u = column / (columns - 1);
      const x = side * lerp(inner, outer, u);
      const ramp = clamp((Math.abs(x) - inner) / reach, 0, 1);

      vertices.push({
        x,
        y: HORIZON_Y + terrainHeight(ramp, u, v, peak, roughness, coarse, fine),
        z,
        /* Filled in below: shading needs neighbours, which do not all exist
           until the whole field does. */
        shade: 0,
      });
    }
  }

  applyShade({ columns, rows, vertices }, aspect);

  return { columns, rows, vertices };
}

/**
 * Height above the waterline at a point on the bank.
 *
 * `ramp` is the height envelope's parameter, 0 at the shore and 1 once the
 * land has reached full height; `u` and `v` are the position across and along
 * the bank, which is what the noise is sampled at. They are separate because
 * the envelope tops out before the geometry does -- see RAMP_FRACTION.
 *
 * The envelope is squared so the land leaves the shore low and gathers height
 * as it goes out -- a linear ramp reads as a wedge, not as terrain. Relief
 * MULTIPLIES the envelope rather than being added to it, so the envelope
 * decides how tall a place is allowed to be and the relief only decides where
 * within that it lands. A bad draw therefore cannot spike a peak at the
 * water's edge, and no draw can dig below the shoreline.
 */
function terrainHeight(
  ramp: number,
  u: number,
  v: number,
  peak: number,
  roughness: number,
  coarse: Lattice,
  fine: Lattice,
): number {
  const envelope = peak * ramp * ramp;
  const relief =
    ridged(sampleLattice(coarse, u, v)) * 0.65 +
    ridged(sampleLattice(fine, u, v)) * 0.35;
  return envelope * (1 - roughness + roughness * relief);
}

/**
 * Value noise folded into ridges: 0 at the extremes, 1 at the midpoint.
 *
 * Plain value noise gives rolling hills, and rolling hills read as dunes.
 * Folding it puts a CREASE wherever the field crosses its midpoint, which is
 * what turns a smooth field into a range with crests and saddles -- and the
 * crest is the whole silhouette here, because the sky behind it is the
 * brightest thing in the frame.
 */
function ridged(noise: number): number {
  return 1 - Math.abs(noise * 2 - 1);
}

interface Lattice {
  cells: number;
  values: number[];
}

/** A square grid of amplitudes in [0, 1), drawn in a fixed order. */
function noiseLattice(rng: Rng, cells: number): Lattice {
  const size = cells + 1;
  const values: number[] = [];
  for (let i = 0; i < size * size; i++) values.push(rng.next());
  return { cells, values };
}

/** Smoothstep-interpolated value noise at (u, v), both in 0..1. */
function sampleLattice(lattice: Lattice, u: number, v: number): number {
  const { cells, values } = lattice;
  const size = cells + 1;

  const fx = clamp(u, 0, 1) * cells;
  const fy = clamp(v, 0, 1) * cells;
  const x0 = Math.min(Math.floor(fx), cells - 1);
  const y0 = Math.min(Math.floor(fy), cells - 1);
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);

  const at = (x: number, y: number): number => values[y * size + x] ?? 0;

  return lerp(
    lerp(at(x0, y0), at(x0 + 1, y0), tx),
    lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx),
    ty,
  );
}

/**
 * Bake the lighting into each vertex.
 *
 * A WRAPPED SUN, not a clamped one: the dot product is remapped from [-1, 1]
 * into [0, 1] rather than cut off at zero. A hard terminator on a backlit
 * ridge gives you a black silhouette with a bright edge, which is precisely
 * the image the flat cutouts already produced and the thing this replaces.
 * Wrapping keeps a face turned away from the sun reading as form.
 *
 * Baked into vertex values rather than lit by a scene light on purpose. The
 * key light is a contract with the CHARACTER ART -- sprites are unlit and the
 * lighting is painted into the image -- and pulling the backdrop into the rig
 * would mean every future light change had to be judged against mountains as
 * well as faces.
 *
 * Takes no side: the sun is at x = 0, so a slope facing the corridor faces the
 * sun whichever bank it is on. That symmetry is the point -- both banks light
 * inward and fall away at the frame edges, which is what frames the corridor.
 */
function applyShade(bank: Bank, aspect: number): void {
  const { columns, rows, vertices } = bank;

  const at = (row: number, column: number): TerrainVertex =>
    vertices[row * columns + clamp(column, 0, columns - 1)]!;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const here = at(row, column);
      const left = at(row, column - 1);
      const right = at(row, column + 1);
      const near = vertices[Math.max(row - 1, 0) * columns + column]!;
      const far = vertices[Math.min(row + 1, rows - 1) * columns + column]!;

      /* Central differences. Degenerate spans (the clamped edges) fall back to
         zero slope rather than dividing by zero -- a NaN here collapses the
         whole BufferGeometry and the symptom is an invisible mountain. */
      const dx = right.x - left.x;
      const dz = far.z - near.z;
      const slopeX = dx === 0 ? 0 : (right.y - left.y) / dx;
      const slopeZ = dz === 0 ? 0 : (far.y - near.y) / dz;

      /* Surface normal of y = f(x, z) is (-df/dx, 1, -df/dz), normalised. */
      const nx = -slopeX;
      const ny = 1;
      const nz = -slopeZ;
      const nLength = Math.hypot(nx, ny, nz);

      const sx = SUN_SHADING_POSITION.x - here.x;
      const sy = SUN_SHADING_POSITION.y - here.y;
      const sz = SUN_SHADING_POSITION.z - here.z;
      const sLength = Math.hypot(sx, sy, sz);

      const dot =
        nLength === 0 || sLength === 0
          ? 0
          : (nx * sx + ny * sy + nz * sz) / (nLength * sLength);

      const lit = clamp((dot - SHADE_PIVOT) * SHADE_GAIN + SHADE_PIVOT, 0, 1);

      /* Altitude measured against how high the land gets AT THIS DEPTH, not
         against the tallest point in the bank. The envelope grows with depth,
         so a global maximum would score every near ridge as a foothill and
         put the whole altitude term on the far rows -- exactly where fog has
         already taken them. */
      const ceiling = peakHeightAt(here.z, aspect);
      const altitude =
        ceiling === 0 ? 0 : clamp((here.y - HORIZON_Y) / ceiling, 0, 1);

      here.shade = clamp(lit * SLOPE_WEIGHT + altitude * HEIGHT_WEIGHT, 0, 1);
    }
  }
}

/**
 * Triangle indices for a columns x rows lattice, as two triangles per quad.
 *
 * WINDING IS SIDE-DEPENDENT AND IT IS NOT COSMETIC. A bank's columns run
 * OUTWARD from the corridor, so x increases along a row on the right bank and
 * decreases on the left. One index order therefore produces upward-facing
 * triangles on one bank and downward-facing ones on the other, and downward
 * means backface-culled by a camera looking down at it -- an entire mountain
 * range that submits its triangles, counts in renderer.info, and draws
 * nothing. The symptom is a wireframe hanging in the air with no rock under
 * it, which reads as a shading bug and is not one.
 *
 * Separate from the vertex builder so it can be asserted in isolation, which
 * is the only channel that catches this: an index past the end of the buffer
 * or a backwards triangle is a black mesh or a GL warning, never a useful
 * error message.
 */
export function terrainIndices(
  columns: number,
  rows: number,
  side: -1 | 1 = 1,
): number[] {
  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      if (side === 1) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  return indices;
}

/**
 * The upward component of a triangle's normal, for asserting winding.
 *
 * Only the sign matters: positive is a face the locked camera can see.
 */
export function triangleUpwardNormal(
  a: TerrainVertex,
  b: TerrainVertex,
  c: TerrainVertex,
): number {
  /* The y component of (b - a) x (c - a). */
  return (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z);
}

/**
 * Line indices for the neon lattice drawn over a bank.
 *
 * EVERY `step`th ROW AND COLUMN, not every triangle edge. THREE.WireframeGeometry
 * would give the second: it draws the diagonal of every quad, which triples the
 * line count and puts the triangulation on screen, so the mountains would read
 * as a mesh someone forgot to hide rather than as a grid over rock. A
 * rectilinear lattice is also the same language as the grid ocean, which is the
 * reason the treatment was chosen.
 */
export function wireframeIndices(
  columns: number,
  rows: number,
  step: number,
): number[] {
  if (step < 1) throw new Error(`Wireframe step must be at least 1, got ${step}`);

  const indices: number[] = [];

  /* Lines running away from the camera. */
  for (let column = 0; column < columns; column += step) {
    for (let row = 0; row < rows - 1; row++) {
      indices.push(row * columns + column, (row + 1) * columns + column);
    }
  }

  /* Lines running across the bank. */
  for (let row = 0; row < rows; row += step) {
    for (let column = 0; column < columns - 1; column++) {
      indices.push(row * columns + column, row * columns + column + 1);
    }
  }

  return indices;
}

/**
 * True when no vertex of a bank has entered the corridor at its own depth.
 *
 * The check the composition depends on, exported so it can be asserted
 * directly rather than inferred from a screenshot. It is a SCREEN-SPACE test
 * despite being written in world units: corridorHalfWidth is a fraction of the
 * frame at that depth, and height does not move a vertex horizontally in
 * frame, so a vertex outside the corridor at its own z is outside the window
 * on screen however tall it is.
 */
export function corridorIsClear(bank: Bank, aspect = CANONICAL_ASPECT): boolean {
  return bank.vertices.every(
    (vertex) => Math.abs(vertex.x) >= corridorHalfWidth(vertex.z, aspect) - 1e-9,
  );
}
