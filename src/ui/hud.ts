/**
 * The HUD layer.
 *
 * ARCHITECTURAL RULE: all UI is real DOM, layered over the canvas. Nothing
 * in the interface is rendered inside three.js.
 *
 * Two reasons, and both matter:
 *
 *   1. Text rendering in WebGL is genuinely bad. Crisp, scalable,
 *      accessible text is what the browser is best at.
 *
 *   2. It preserves the strongest verification channel in the project. The
 *      harness reads the DOM directly and gets exact, assertable truth --
 *      "the boss HP bar reports 4200/4200" -- rather than having to
 *      interpret pixels. Roughly 80% of this game is UI, so keeping that
 *      80% machine-readable is the difference between a fast agentic loop
 *      and a slow one.
 *
 * TWO HALVES, DELIBERATELY SPLIT
 * ------------------------------
 * `toHudModel` is pure: BattleState in, a plain object out. It carries every
 * derivation worth being wrong about -- HP strings, the turn-order preview,
 * which actor is up -- so all of it is testable in Vitest with no jsdom.
 * `renderHud` is the half that needs a browser, and it is deliberately
 * boring: it does no arithmetic and makes no decisions.
 *
 * Every element carries a `data-testid` -- these are a stable contract for
 * the harness. Renaming one is a breaking change; treat them accordingly.
 *
 * This phase is DELIBERATELY UNSTYLED. New sections reuse existing classes
 * where one fits and otherwise render bare. No CSS was added.
 */

import {
  findActor,
  isDefeated,
  type Actor,
  type BattleState,
  type Side,
  type Status,
} from '../battle/types';
import { menuPanels, type MenuPanel, type MenuState } from './menu';
import { portraitFor } from './portraits';

/**
 * At or below this fraction of maximum HP, a party card's health bar switches
 * to the ember gradient.
 *
 * It lives here, in the pure half, rather than as a CSS threshold or a
 * comparison inside renderHud, for the reason the whole file is split this
 * way: it is a decision worth being wrong about, so it has to be reachable
 * from Vitest.
 */
export const LOW_HP_FRACTION = 0.25;

export interface HudActor {
  id: string;
  name: string;
  side: 'party' | 'enemy';
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /**
   * hp/maxHp and mp/maxMp, clamped to 0..1.
   *
   * Derived once, here, because the bar's width and its low-HP colouring are
   * two renderings of one number. Computing them separately in renderHud is
   * how a bar ends up 3% wide and still coloured as healthy.
   */
  hpFraction: number;
  mpFraction: number;
  /** Whether the health bar should read as a warning. */
  isHpLow: boolean;
  isActive: boolean;
  isDefeated: boolean;
  statuses: readonly Status[];
}

export interface HudModel {
  boss: { id: string; name: string; level: number; hp: number; maxHp: number };
  actors: readonly HudActor[];
  /**
   * THE ROUND AS A RING: every living actor exactly once, active first.
   *
   * Not a forecast. The turn-order bar is a carousel that rotates one place
   * per turn and loops, so what it needs is a cycle rather than a lookahead --
   * and a cycle is what a round already is.
   *
   * Two properties the carousel is built on:
   *
   *   - index 0 is the actor whose turn it is
   *   - the LAST entry is the actor who acted immediately before them, and
   *     also the last to act before the leader comes round again
   *
   * That second one is why a single portrait can be split across the seam,
   * half-dissolving off the left edge as "just went" and half-dissolving in at
   * the right as "next loop". They are the same character.
   */
  turnOrder: readonly { id: string; name: string; side: Side }[];
  round: number;
  chain: number;
  phase: BattleState['phase'];
  activeActorId: string | null;
  /**
   * The command menu as a cascade -- the path taken, left to right.
   *
   * Exactly one panel is active. The rest are the choices already made, kept
   * on screen so the player can see where they are rather than having to
   * remember.
   */
  panels: readonly MenuPanel[];
  narration: string;
  /**
   * Every narration line, oldest first. The action log renders the tail.
   *
   * `narration` is kept alongside it rather than replaced by
   * `history.at(-1)`: it is the sequencer's own statement of what is on
   * screen NOW, and the log's newest line is only the same element because
   * that invariant holds. Two names for one fact is the point -- if they
   * ever diverge, the log is the thing that is wrong.
   */
  history: readonly string[];
  isLocked: boolean;
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

export function toHudModel(
  state: BattleState,
  menu: MenuState,
  view: { narration: string; isLocked: boolean; history: readonly string[] },
): HudModel {
  const activeActorId = state.turnQueue[state.turnIndex] ?? null;

  /* The bar tracks the enemy whether or not it is still standing -- after
     victory the player should see the bar sitting at zero, not vanish. */
  const boss = state.actors.find((actor) => actor.side === 'enemy');
  if (boss === undefined) {
    throw new Error(
      'The HUD needs an enemy to put in the boss bar, and the roster has none. ' +
        'createBattle should have rejected this state at construction.',
    );
  }


  return {
    boss: {
      id: boss.id,
      name: boss.name,
      level: boss.level,
      hp: boss.hp,
      maxHp: boss.stats.maxHp,
    },
    actors: state.actors.map((actor) => {
      const hpFraction = fraction(actor.hp, actor.stats.maxHp);
      return {
        id: actor.id,
        name: actor.name,
        side: actor.side,
        level: actor.level,
        hp: actor.hp,
        maxHp: actor.stats.maxHp,
        mp: actor.mp,
        maxMp: actor.stats.maxMp,
        hpFraction,
        mpFraction: fraction(actor.mp, actor.stats.maxMp),
        isHpLow: hpFraction <= LOW_HP_FRACTION,
        isActive: actor.id === activeActorId,
        isDefeated: isDefeated(actor),
        statuses: actor.statuses,
      };
    }),
    /* The round's queue, rotated so the active actor leads. Rotating rather
       than forecasting is what makes the last entry the previous actor, which
       is the property the carousel's split portrait depends on.

       DEFEATED ACTORS ARE DROPPED, and the ring shortens rather than padding.
       `advance` walks past a fallen actor when it picks the next turn, but the
       queue itself is built once per round and never edited -- that is what
       makes a mid-round speed change safe. So without this filter a party
       member who falls keeps a place on the carousel for the rest of the
       round, advertising a turn that will not happen. Filtering here rather
       than in turnOrder.ts: which turns are worth SHOWING is a UI question. */
    turnOrder:
      state.phase === 'in_progress'
        ? [
            ...state.turnQueue.slice(state.turnIndex),
            ...state.turnQueue.slice(0, state.turnIndex),
          ]
            .map((id) => findActor(state, id))
            .filter((actor): actor is Actor => actor !== undefined && !isDefeated(actor))
            .map((actor) => ({ id: actor.id, name: actor.name, side: actor.side }))
        : [],
    round: state.round,
    chain: state.chain,
    phase: state.phase,
    activeActorId,
    panels: menuPanels(state, menu),
    narration: view.narration,
    history: view.history,
    isLocked: view.isLocked,
  };
}

/**
 * A gauge's fill as 0..1.
 *
 * Clamped, because overheal and negative HP are both states the battle layer
 * is allowed to produce transiently and neither should push a bar past its
 * track. A zero maximum returns 0 rather than NaN -- an empty bar is a
 * survivable rendering of a nonsensical actor; `width: NaN%` is not.
 */
function fraction(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * THE SKELETON IS BUILT ONCE AND UPDATED IN PLACE.
 *
 * This used to be `root.innerHTML = ''` followed by a full rebuild, which was
 * simple and honest right up until a bar needed to animate. A CSS transition
 * fires on a CHANGE to a property; a brand-new element has no previous value,
 * so its width is simply its initial value and nothing moves. The boss bar has
 * carried `transition: width 400ms` since Phase 0 and has never once animated
 * for exactly this reason.
 *
 * So: build the regions once, then write text, widths, aria and state
 * attributes onto the elements that already exist. Lists whose LENGTH varies
 * with state -- the turn order, the menu -- still clear and rebuild their
 * children, because nothing in them animates and reconciling them would be
 * complexity bought for nothing.
 *
 * `renderHud` keeps its signature and its contract: no arithmetic, no
 * decisions. Everything worth being wrong about is already in HudModel.
 */
interface HudView {
  update(model: HudModel): void;
}

/**
 * Keyed on the root rather than held in a module variable, so a second HUD
 * root -- a test, a restarted battle -- gets its own skeleton, and neither
 * root keeps the other alive.
 */
const views = new WeakMap<HTMLElement, HudView>();

export function renderHud(root: HTMLElement, model: HudModel): void {
  let view = views.get(root);
  if (view === undefined) {
    root.replaceChildren();
    view = buildHud(root, model);
    views.set(root, view);
  }
  view.update(model);
}

function buildHud(root: HTMLElement, model: HudModel): HudView {
  const boss = buildBossBar(model);
  const turnOrder = buildTurnOrder();
  const party = buildPartyStrip(model);
  const enemies = buildEnemyReadout(model);
  const status = buildStatusLine();
  const menu = buildCommandMenu();
  const log = buildLog();

  /* Append order is paint order. The log follows the status strip because it
     is the third IN-FLOW child of the top-left column: carousel, then the
     round/chain/phase strip, then the history hanging beneath them. The menu
     is absolutely positioned in the opposite corner and its place in this
     list means nothing. */
  root.append(boss.el, turnOrder.el, party.el, enemies.el, status.el, log.el, menu.el);

  return {
    update(next: HudModel): void {
      boss.update(next);
      turnOrder.update(next);
      party.update(next);
      enemies.update(next);
      status.update(next);
      menu.update(next);
      log.update(next);
    },
  };
}

/** A region: the element, and how to write a model onto it. */
interface Region {
  el: HTMLElement;
  update(model: HudModel): void;
}

/* ------------------------------------------------------------------ */
/* Boss bar                                                            */
/* ------------------------------------------------------------------ */

function buildBossBar(model: HudModel): Region {
  const el = document.createElement('div');
  el.className = 'hud-boss';
  el.dataset['testid'] = 'boss-bar';

  const label = document.createElement('div');
  label.className = 'hud-boss__label';
  label.dataset['testid'] = 'boss-name';

  const track = document.createElement('div');
  track.className = 'hud-boss__track';
  /* The accessible name doubles as the harness's assertion target, so the
     exact numbers are readable without parsing a style attribute. */
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-label', `${model.boss.name} health`);

  const fill = document.createElement('div');
  fill.className = 'hud-boss__fill';
  fill.dataset['testid'] = 'boss-hp-fill';

  const readout = document.createElement('div');
  readout.className = 'hud-boss__readout';
  readout.dataset['testid'] = 'boss-hp-text';

  track.append(fill);
  el.append(label, track, readout);

  return {
    el,
    update(next: HudModel): void {
      const { boss } = next;
      setText(label, `${boss.name} LV${boss.level}`);
      setAttr(track, 'aria-valuemax', String(boss.maxHp));
      setAttr(track, 'aria-valuenow', String(boss.hp));
      setWidth(fill, fraction(boss.hp, boss.maxHp));
      setText(
        readout,
        `${boss.hp.toLocaleString()}/${boss.maxHp.toLocaleString()}`,
      );
    },
  };
}

/* ------------------------------------------------------------------ */
/* Turn order                                                          */
/* ------------------------------------------------------------------ */

/**
 * The turn-order carousel.
 *
 * A ring of portraits that rotates one place per turn and loops. Four are
 * shown whole; the fifth is split across the seam, half-dissolving off the
 * left edge as the turn just taken and half-dissolving in at the right as the
 * same character coming round again. Those two halves are one actor -- see
 * HudModel.turnOrder for why the ring guarantees it.
 *
 * THE GEOMETRY, because everything below depends on it
 * ----------------------------------------------------
 * With `pitch = tile + gap` and a ring of N:
 *
 *   window   N * pitch                 = half + (N-1) full + half
 *   track    N + 2 tiles, where tile i shows ring position (i - 2) mod N
 *   rest     translateX(-(tile/2 + pitch))
 *
 * The two extra tiles sit off the left edge at rest. They exist so the slide
 * has something to bring in: shifting the resting track right by exactly one
 * pitch reproduces the PREVIOUS turn's resting frame, which is what lets the
 * animation start on the old picture and end on the new one with no seam.
 *
 * WHY THERE IS NO SNAP-BACK
 * -------------------------
 * The usual way to loop a carousel is to animate past the end and then jump
 * the transform back, which then has to be hidden. Instead the track always
 * renders the CURRENT ring already at its resting offset; the animation only
 * makes it arrive, running from `rest + pitch` to `rest`. It finishes at the
 * resting style, so there is nothing to undo.
 */
function buildTurnOrder(): Region {
  /* The window. Masked, clipped, and the element the testid names -- the
     track is N+2 tiles wide and translated, so ITS box is not what the bar
     occupies on screen, and a layout assertion against it would be wrong. */
  const el = document.createElement('div');
  el.className = 'hud-turn-order';
  el.dataset['testid'] = 'turn-order';

  const track = document.createElement('ol');
  track.className = 'hud-turn-order__track';
  track.setAttribute('aria-label', 'Turn order');

  /* The highlight does not move. It is a reticle pinned over the "now" slot,
     and the portraits rotate underneath it into place. Decorative: slot 0
     already carries data-current for anything that needs to know. */
  const cursor = document.createElement('div');
  cursor.className = 'hud-turn-order__cursor';
  cursor.dataset['testid'] = 'turn-order-cursor';
  cursor.setAttribute('aria-hidden', 'true');

  el.append(track, cursor);

  const pool: TurnSlot[] = [];
  /** The leader last rendered. A change in it is what a turn advancing means. */
  let leader: string | null = null;

  return {
    el,
    update(next: HudModel): void {
      const ring = next.turnOrder;
      const tiles = ring.length === 0 ? 0 : ring.length + 2;

      el.style.setProperty('--turn-slots', String(ring.length));

      while (pool.length < tiles) pool.push(buildTurnSlot());
      for (let i = tiles; i < pool.length; i++) pool[i]!.el.remove();

      for (let i = 0; i < tiles; i++) {
        /* (i - 2) mod N: the first two tiles are the lead-ins, duplicating
           the ring's tail so the slide has content to bring in from the left.
           They are aria-hidden -- without that a screen reader reads two of
           the characters twice. */
        const position = (((i - 2) % ring.length) + ring.length) % ring.length;
        const slot = pool[i]!;
        slot.update(ring[position]!, i, position);
        if (slot.el.parentNode === null) track.append(slot.el);
      }

      const nextLeader = ring[0]?.id ?? null;
      if (leader !== null && nextLeader !== null && nextLeader !== leader) {
        slideOnePlace(track);
      }
      leader = nextLeader;
    },
  };
}

/**
 * Bring the track in from one place to the right.
 *
 * Web Animations rather than a CSS transition, deliberately. A transition
 * needs a previous value to move FROM, and by the time this runs the element
 * is already at its destination -- the content was rendered at its resting
 * offset. Saying "arrive from over there" in CSS means writing the start
 * position, forcing a reflow, then writing the end position; `animate()` says
 * it directly. Without `fill`, it releases itself when it finishes.
 */
function slideOnePlace(track: HTMLElement): void {
  if (typeof track.animate !== 'function') return;
  /* Motion, not state: a reduced-motion preference means the carousel should
     land on the new order rather than travel to it. */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* MEASURED, not read from --turn-pitch. An unregistered custom property
     computes to its literal token stream, so getPropertyValue would hand back
     "calc(2.25rem + 0.5rem)" and parseFloat would give NaN -- the animation
     would silently never run. Two adjacent tiles give the real pitch in px,
     including whatever the gap actually resolved to. */
  const [first, second] = track.children;
  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return;
  const pitch = second.offsetLeft - first.offsetLeft;
  if (!Number.isFinite(pitch) || pitch <= 0) return;

  const styles = getComputedStyle(track);

  track.animate(
    [{ transform: `translateX(${pitch}px)` }, { transform: 'translateX(0)' }],
    {
      /* Read from the token rather than restated, so the carousel and the
         party cards cannot drift out of step. They are one motion language. */
      duration: durationOf(styles.getPropertyValue('--card-motion')),
      easing: 'ease-in-out',
      composite: 'add',
    },
  );
}

/** Parses a CSS time token. Falls back to the card motion's authored value. */
function durationOf(value: string): number {
  const trimmed = value.trim();
  const amount = Number.parseFloat(trimmed);
  if (!Number.isFinite(amount)) return 300;
  return trimmed.endsWith('ms') ? amount : amount * 1000;
}

interface TurnSlot {
  el: HTMLElement;
  update(
    entry: HudModel['turnOrder'][number],
    trackIndex: number,
    ringPosition: number,
  ): void;
}

function buildTurnSlot(): TurnSlot {
  const el = document.createElement('li');
  el.className = 'hud-turn';

  const portrait = document.createElement('span');
  portrait.className = 'hud-turn__portrait';

  /* The name stays in the DOM, off-screen. It keeps the tile's accessible
     name, keeps the list readable as characters rather than as blanks, and
     keeps each item's textContent equal to the character name. */
  const name = document.createElement('span');
  name.className = 'hud-sr-only';

  el.append(portrait, name);

  return {
    el,
    update(entry, trackIndex, ringPosition): void {
      const isLead = trackIndex < 2;

      /* Testids index the RING, not the track, so `turn-order-slot-0` still
         means "whose turn it is" -- the meaning it has always had. The
         lead-ins are duplicates and get their own name. */
      setAttr(
        el,
        'data-testid',
        isLead ? `turn-order-lead-${trackIndex}` : `turn-order-slot-${ringPosition}`,
      );
      toggleAttr(el, 'aria-hidden', isLead);

      if (el.dataset['actor'] !== entry.id) {
        /* The id is what a test joins against an ActorId; the side answers
           "is the boss up next" without anyone parsing a portrait. */
        el.dataset['actor'] = entry.id;
        el.dataset['side'] = entry.side;
        setText(name, entry.name);
        applyPortrait(portrait, entry.id);
      }
      toggleAttr(el, 'data-current', !isLead && ringPosition === 0);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Party cards                                                         */
/* ------------------------------------------------------------------ */

/**
 * The bottom strip: one card per party member.
 *
 * The roster is fixed for the life of a battle, so the cards are built once
 * from the opening model and only their contents move afterwards. That is what
 * lets the gauges transition.
 */
function buildPartyStrip(model: HudModel): Region {
  const el = document.createElement('ul');
  el.className = 'hud-party';
  el.dataset['testid'] = 'party-panel';
  el.setAttribute('aria-label', 'Party status');

  const cards = new Map<string, (actor: HudActor) => void>();

  for (const actor of model.actors) {
    if (actor.side !== 'party') continue;
    const card = buildCard(actor);
    cards.set(actor.id, card.update);
    el.append(card.el);
  }

  return {
    el,
    update(next: HudModel): void {
      for (const actor of next.actors) {
        cards.get(actor.id)?.(actor);
      }
    },
  };
}

function buildCard(actor: HudActor): {
  el: HTMLElement;
  update(actor: HudActor): void;
} {
  const el = document.createElement('li');
  el.className = 'hud-card';
  el.dataset['testid'] = `party-card-${actor.id}`;
  el.dataset['actor'] = actor.id;

  el.append(buildPortrait(actor));

  /* The card root carries the testid the new suite reads; the body carries
     the `actor-<id>` testid the Phase 3 suite already reads. Two elements,
     because a testid is one per element -- and both are a contract now. */
  const body = document.createElement('div');
  body.className = 'hud-card__body';
  body.dataset['testid'] = `actor-${actor.id}`;

  const header = document.createElement('div');
  header.className = 'hud-card__header';

  const name = document.createElement('span');
  name.className = 'hud-card__name';
  name.dataset['testid'] = `actor-${actor.id}-name`;
  name.textContent = actor.name;

  const level = document.createElement('span');
  level.className = 'hud-card__level';
  level.dataset['testid'] = `actor-${actor.id}-level`;

  header.append(name, level);

  const hp = buildGauge(actor, 'hp', 'HP', `${actor.name} health`);
  const mp = buildGauge(actor, 'mp', 'MP', `${actor.name} magic`);

  const statuses = document.createElement('ul');
  statuses.className = 'hud-card__statuses';
  statuses.dataset['testid'] = `actor-${actor.id}-statuses`;
  statuses.setAttribute('aria-label', `${actor.name} status effects`);

  body.append(header, hp.el, mp.el, statuses);
  el.append(body);

  return {
    el,
    update(next: HudActor): void {
      setAttr(el, 'aria-current', next.isActive ? 'true' : 'false');
      toggleAttr(el, 'data-defeated', next.isDefeated);

      setText(level, `LV${next.level}`);
      hp.update(next.hp, next.maxHp, next.hpFraction, next.isHpLow);
      mp.update(next.mp, next.maxMp, next.mpFraction, false);
      renderStatuses(statuses, next);
    },
  };
}

function buildPortrait(actor: HudActor): HTMLElement {
  const el = document.createElement('div');
  el.className = 'hud-card__portrait';
  el.dataset['testid'] = `actor-${actor.id}-portrait`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${actor.name} portrait`);
  applyPortrait(el, actor.id);

  return el;
}

/**
 * Point an element at a character's portrait crop.
 *
 * Custom properties rather than the background shorthand, so the stylesheet
 * still owns how a portrait is composed and this only says which pixels. Used
 * by both the party cards and the turn-order tiles -- one crop table, two
 * sizes, and ui/portraits.ts stays the single source for the numbers.
 */
function applyPortrait(el: HTMLElement, actorId: string): void {
  const art = portraitFor(actorId);
  if (art.url === null) return;

  el.style.setProperty('--portrait-src', `url("${art.url}")`);
  el.style.setProperty('--portrait-zoom', String(art.zoom));
  el.style.setProperty('--portrait-x', art.x);
  el.style.setProperty('--portrait-y', art.y);
}

interface CardGauge {
  el: HTMLElement;
  update(now: number, max: number, filled: number, low: boolean): void;
}

function buildGauge(
  actor: HudActor,
  kind: 'hp' | 'mp',
  key: string,
  ariaLabel: string,
): CardGauge {
  const el = document.createElement('div');
  el.className = `hud-card__gauge hud-card__gauge--${kind}`;
  el.dataset['testid'] = `actor-${actor.id}-${kind}-bar`;

  /* progressbar on the WRAPPER, not the fill: the accessible node should be
     the one that also carries the label and the readout, which is the
     arrangement the boss bar already uses. The suite reads these attributes
     rather than parsing a width, so they are the contract. */
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-label', ariaLabel);

  const label = document.createElement('span');
  label.className = 'hud-card__key';
  label.textContent = key;
  /* The gauge already has an accessible name; the two-letter key is visual
     shorthand and would only be read out as noise. */
  label.setAttribute('aria-hidden', 'true');

  const track = document.createElement('div');
  track.className = 'hud-card__track';

  const fill = document.createElement('i');
  fill.className = 'hud-card__fill';
  track.append(fill);

  const value = document.createElement('span');
  value.className = 'hud-card__value';
  value.dataset['testid'] = `actor-${actor.id}-${kind}`;

  el.append(label, track, value);

  return {
    el,
    update(now, max, filled, low): void {
      setAttr(el, 'aria-valuemax', String(max));
      setAttr(el, 'aria-valuenow', String(now));
      toggleAttr(el, 'data-low', low);
      setWidth(fill, filled);
      setText(value, `${now}/${max}`);
    },
  };
}

/**
 * Status badges.
 *
 * The GLYPH IS A `::before` PSEUDO-ELEMENT, deliberately. Pseudo-element
 * content is excluded from `textContent`, which is what Playwright's
 * `toHaveText` reads, so `actor-kira-statuses` still reads exactly `DEF_UP`
 * and the Phase 3 DEFEND test passes untouched. Putting the glyph in the text
 * would break it.
 *
 * The `' '` separators keep the space-joined string the old bare row
 * produced. Whitespace-only text between flex items is not rendered as a flex
 * item, so it costs nothing visually.
 */
function renderStatuses(list: HTMLElement, actor: HudActor): void {
  list.replaceChildren();

  actor.statuses.forEach((status, index) => {
    if (index > 0) list.append(' ');

    const badge = document.createElement('li');
    badge.className = 'hud-status';
    badge.dataset['kind'] = status.kind;
    badge.dataset['testid'] = `status-${actor.id}-${status.kind}`;
    badge.title = `${STATUS_LABELS[status.kind]}, ${status.turnsRemaining} turn${
      status.turnsRemaining === 1 ? '' : 's'
    } left`;
    badge.textContent = status.kind;

    list.append(badge);
  });
}

const STATUS_LABELS: Record<Status['kind'], string> = {
  ATK_UP: 'Attack up',
  DEF_UP: 'Defence up',
  HASTE: 'Haste',
};

/* ------------------------------------------------------------------ */
/* Enemy readout                                                       */
/* ------------------------------------------------------------------ */

/**
 * The enemy's numbers, off-screen but in the DOM and the accessibility tree.
 *
 * The bottom strip is PARTY cards, and the boss's HP already has a home in the
 * boss bar. Its MP and statuses have no visual design until the boss-bar pass,
 * and they cannot simply be appended to the bar: the `boss head clears the HUD
 * boss bar` test measures that element's bounding box, and the boss's head
 * sits at screen y 0.147 against a bar bottom near 0.12. An extra visible row
 * would close that gap and put damage numbers behind the bar.
 *
 * So the `actor-apollyon*` testids the Phase 3 suite reads keep working
 * unchanged, a screen reader can still reach the boss's full state, and
 * nothing is faked in the meantime.
 */
function buildEnemyReadout(model: HudModel): Region {
  const el = document.createElement('div');
  el.className = 'hud-sr-only';
  el.dataset['testid'] = 'enemy-readout';

  const rows = new Map<string, (actor: HudActor) => void>();

  for (const actor of model.actors) {
    if (actor.side !== 'enemy') continue;

    const row = document.createElement('div');
    row.dataset['testid'] = `actor-${actor.id}`;

    const name = document.createElement('span');
    name.dataset['testid'] = `actor-${actor.id}-name`;
    name.textContent = actor.name;

    const level = document.createElement('span');
    level.dataset['testid'] = `actor-${actor.id}-level`;

    const hp = document.createElement('span');
    hp.dataset['testid'] = `actor-${actor.id}-hp`;

    const mp = document.createElement('span');
    mp.dataset['testid'] = `actor-${actor.id}-mp`;

    const statuses = document.createElement('span');
    statuses.dataset['testid'] = `actor-${actor.id}-statuses`;

    row.append(name, ' ', level, ' HP ', hp, ' MP ', mp, ' ', statuses);
    el.append(row);

    rows.set(actor.id, (next) => {
      setAttr(row, 'aria-current', next.isActive ? 'true' : 'false');
      toggleAttr(row, 'data-defeated', next.isDefeated);
      setText(level, `LV${next.level}`);
      setText(hp, `${next.hp}/${next.maxHp}`);
      setText(mp, `${next.mp}/${next.maxMp}`);
      setText(statuses, next.statuses.map((s) => s.kind).join(' '));
    });
  }

  return {
    el,
    update(next: HudModel): void {
      for (const actor of next.actors) {
        rows.get(actor.id)?.(actor);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Status line                                                         */
/* ------------------------------------------------------------------ */

/** Round, chain, phase and whose turn it is -- the machine-readable strip. */
function buildStatusLine(): Region {
  const el = document.createElement('div');
  el.dataset['testid'] = 'battle-status';

  const phase = document.createElement('span');
  phase.dataset['testid'] = 'battle-phase';

  const round = document.createElement('span');
  round.dataset['testid'] = 'battle-round';

  const chain = document.createElement('span');
  chain.dataset['testid'] = 'battle-chain';

  const active = document.createElement('span');
  active.dataset['testid'] = 'active-actor';

  el.append(phase, ' ROUND ', round, ' CHAIN ', chain, ' TURN ', active);

  return {
    el,
    update(next: HudModel): void {
      setText(phase, PHASE_LABELS[next.phase]);
      setText(round, String(next.round));
      setText(chain, String(next.chain));
      setText(active, next.activeActorId ?? '');
    },
  };
}

const PHASE_LABELS: Record<BattleState['phase'], string> = {
  in_progress: 'IN PROGRESS',
  victory: 'VICTORY',
  defeat: 'DEFEAT',
};

/* ------------------------------------------------------------------ */
/* Command menu                                                        */
/* ------------------------------------------------------------------ */

/**
 * The command menu, as a cascade of panels.
 *
 * One panel per level the player has walked through, left to right, with the
 * active one lit and its parents dimmed. Seeing the path beats remembering it,
 * and it is what makes ATTACK -> a target and SKILL -> a skill -> a target
 * legible as different depths rather than as two identical lists.
 *
 * The panel ROW persists; each panel's contents are rebuilt on update. Panels
 * come and go with the level and their options change identity and count, so
 * there is nothing stable to reconcile -- and unlike the gauges, none of it
 * animates.
 */
function buildCommandMenu(): Region {
  const el = document.createElement('nav');
  el.className = 'hud-menu';
  el.dataset['testid'] = 'command-menu';
  el.setAttribute('aria-label', 'Battle commands');

  return {
    el,
    update(next: HudModel): void {
      /* Locked is not hidden: the player should still see what they chose
         while it plays out. It is announced so a screen reader does not
         report a menu as interactive when it is not. */
      setAttr(el, 'aria-disabled', next.isLocked ? 'true' : 'false');

      el.replaceChildren(
        ...next.panels.map((panel) => renderPanel(panel, next.isLocked)),
      );
    },
  };
}

function renderPanel(panel: MenuPanel, isLocked: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'hud-menu__panel';
  el.dataset['testid'] = `menu-panel-${panel.level}`;
  if (panel.isActive) el.dataset['active'] = 'true';

  const heading = document.createElement('h2');
  heading.className = 'hud-menu__title';
  /* menu-title names the ACTIVE level, and only one panel is active -- so it
     stays the single element it has always been, and the assertions that read
     it keep meaning "where is the player now". */
  if (panel.isActive) heading.dataset['testid'] = 'menu-title';
  heading.textContent = panel.title;

  const list = document.createElement('ul');
  list.className = 'hud-menu__list';

  panel.options.forEach((option, index) => {
    const item = document.createElement('li');
    const selected = index === panel.cursor;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-menu__item';
    button.dataset['testid'] = `${TESTID_PREFIX[panel.level]}-${option.id}`;
    button.textContent =
      option.hint === undefined ? option.label : `${option.label} (${option.hint})`;

    if (selected) button.classList.add('is-selected');

    if (panel.isActive) {
      button.setAttribute('aria-current', selected ? 'true' : 'false');
      button.disabled = !option.enabled || isLocked;
    } else {
      /* A parent panel records the choice already made, but it is NOT the
         current position -- two aria-current="true" in one nav is a menu that
         reports being in two places. And nothing in a dimmed panel is
         actionable, so it must not collect a Tab stop either: the arrow keys
         cannot reach it. */
      button.setAttribute('aria-current', 'false');
      if (selected) button.dataset['chosen'] = 'true';
      button.disabled = true;
    }

    item.append(button);
    list.append(item);
  });

  el.append(heading, list);
  return el;
}

/** Testid prefix per menu level. The values are a contract with the suite. */
const TESTID_PREFIX: Record<MenuPanel['level'], string> = {
  command: 'command',
  skill: 'skill',
  target: 'target',
};

/* ------------------------------------------------------------------ */
/* Action log                                                          */
/* ------------------------------------------------------------------ */

/**
 * How many lines stay in the DOM. Beyond this, the oldest is dropped.
 *
 * The CSS ages each surviving line by its `data-age` and the oldest is
 * nearly transparent, so this number and the opacity ramp in style.css are
 * one decision in two files -- raise it there too or the new bottom line
 * appears at full strength and the fade turns into a cut.
 */
const LOG_LINES = 5;

/**
 * The action log: the narration history, newest at the bottom.
 *
 * This replaces the single-line narration box that used to sit above the
 * command menu. A line held for one beat and was gone, which is survivable
 * for a player action they chose and were watching for, and not for an enemy
 * turn -- the boss acts three beats deep into narration the player's
 * attention has already left, and they are told why their HP moved exactly
 * once. Older lines riding upward mean the answer is still on screen.
 *
 * THE UPDATE IS APPEND-ONLY, which is what keeps this region honest about
 * the build-once-update-in-place contract above. `rendered` is a count of
 * history entries already turned into elements, and it is a valid index
 * forever because the sequencer never drops from the front of `history`.
 * Rebuilding the list instead would work and would also throw away every
 * element's previous opacity, so the age ramp would snap rather than
 * transition -- the boss bar's bug, one region along.
 */
function buildLog(): Region {
  const el = document.createElement('div');
  el.className = 'hud-log';
  el.dataset['testid'] = 'action-log';

  /* The LIST is the live region, not the line. A `role="log"` announces its
     new children, which is precisely the shape of this data; a per-line
     `role="status"` would announce by node insertion, which is the accident
     the narration box was fixed to stop relying on. */
  const list = document.createElement('ol');
  list.className = 'hud-log__lines';
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  list.setAttribute('aria-relevant', 'additions');
  list.setAttribute('aria-label', 'Battle log');

  el.append(list);

  let rendered = 0;

  return {
    el,
    update(next: HudModel): void {
      for (let i = rendered; i < next.history.length; i++) {
        const line = document.createElement('li');
        line.className = 'hud-log__line';
        line.textContent = next.history[i]!;
        list.append(line);
      }
      rendered = next.history.length;

      while (list.children.length > LOG_LINES) {
        list.firstElementChild?.remove();
      }

      /* Walk newest-first so age 0 is the bottom row. The `narration` testid
         RIDES the newest line -- see SequencerView.history for why that is
         the same thing as the current line, and e2e/battle.spec.ts for what
         reads it. */
      const lines = list.children;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i] as HTMLElement;
        const age = lines.length - 1 - i;
        setAttr(line, 'data-age', String(age));
        if (age === 0) setAttr(line, 'data-testid', 'narration');
        else if (line.hasAttribute('data-testid')) line.removeAttribute('data-testid');
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

/*
 * All four write only when the value actually changes.
 *
 * Not a micro-optimisation: assigning the same width back to a transitioning
 * element restarts nothing, but assigning the same textContent DOES tear down
 * and rebuild a text node, and re-announces a `role="status"` live region.
 * The sequencer refreshes the whole HUD on every beat, so "unchanged means
 * untouched" is what keeps that quiet.
 */

function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

function setAttr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function toggleAttr(el: HTMLElement, name: string, on: boolean): void {
  if (on) setAttr(el, name, 'true');
  else if (el.hasAttribute(name)) el.removeAttribute(name);
}

/** Fixed precision so a test can compare a rendered width to a fraction. */
function setWidth(el: HTMLElement, filled: number): void {
  const next = `${(filled * 100).toFixed(2)}%`;
  if (el.style.width !== next) el.style.width = next;
}
