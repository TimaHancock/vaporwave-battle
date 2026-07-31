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

import { previewUpcoming } from '../battle/turnOrder';
import {
  findActor,
  isDefeated,
  type Actor,
  type BattleState,
  type Side,
  type Status,
} from '../battle/types';
import { menuOptions, menuTitle, type MenuOption, type MenuState } from './menu';
import { portraitFor } from './portraits';

/** How many turns the order bar looks ahead. */
export const TURN_PREVIEW_LENGTH = 6;

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
   * Upcoming turns, current actor first.
   *
   * THE CURRENT TURN IS INDEX 0, NOT "whichever entry matches activeActorId".
   * The preview runs past the end of the round into the next one, so a fast
   * actor legitimately appears twice -- a 4+1 roster returns
   * [kira, neo, vex, lyra, apollyon, kira]. Marking by id lights two tiles.
   */
  turnOrder: readonly { id: string; name: string; side: Side }[];
  round: number;
  chain: number;
  phase: BattleState['phase'];
  activeActorId: string | null;
  menuTitle: string;
  options: readonly MenuOption[];
  cursor: number;
  narration: string;
  isLocked: boolean;
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

export function toHudModel(
  state: BattleState,
  menu: MenuState,
  view: { narration: string; isLocked: boolean },
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
    /* DEFEATED ACTORS ARE DROPPED, and the bar shortens rather than padding.
       `advance` walks past a fallen actor when it picks the next turn, but
       previewUpcoming slices the round's queue raw -- the queue is built once
       per round and never edited, which is what makes a mid-round speed
       change safe. So a party member who falls stays in the raw preview for
       the rest of the round, advertising a turn that will not happen.
       Filtering here rather than there: which turns are worth SHOWING is a UI
       question, and turnOrder.ts is deliberately not a UI module. */
    turnOrder:
      state.phase === 'in_progress'
        ? previewUpcoming(state, TURN_PREVIEW_LENGTH)
            .map((id) => findActor(state, id))
            .filter((actor): actor is Actor => actor !== undefined && !isDefeated(actor))
            .map((actor) => ({ id: actor.id, name: actor.name, side: actor.side }))
        : [],
    round: state.round,
    chain: state.chain,
    phase: state.phase,
    activeActorId,
    menuTitle: menuTitle(menu),
    options: menuOptions(state, menu),
    cursor: menu.cursor,
    narration: view.narration,
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
  const narration = buildNarration();

  root.append(
    boss.el,
    turnOrder.el,
    party.el,
    enemies.el,
    status.el,
    menu.el,
    narration.el,
  );

  return {
    update(next: HudModel): void {
      boss.update(next);
      turnOrder.update(next);
      party.update(next);
      enemies.update(next);
      status.update(next);
      menu.update(next);
      narration.update(next);
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
 * The turn-order bar: portraits, left to right, next up first.
 *
 * Deliberately just faces. A row of portraits is read at a glance where a
 * numbered list of names has to be parsed, and the bar's whole job is to be
 * glanced at. It wears the same selection cues as the party cards -- cyan
 * rule, cyan glow, larger -- because "whose turn is it" is one question and
 * should not have two visual languages.
 *
 * Slots are a REUSED POOL rather than a rebuild. The pool grows and shrinks
 * with the queue, so `turn-order-slot-<n>` is a stable element per position:
 * the bar stops churning on every narration beat, and the tiles can
 * transition. What moves between beats is which portrait is in which slot.
 */
function buildTurnOrder(): Region {
  const el = document.createElement('ol');
  el.className = 'hud-turn-order';
  el.dataset['testid'] = 'turn-order';
  el.setAttribute('aria-label', 'Turn order');

  const pool: TurnSlot[] = [];

  return {
    el,
    update(next: HudModel): void {
      const entries = next.turnOrder;

      while (pool.length < entries.length) {
        pool.push(buildTurnSlot(pool.length));
      }
      /* Detached rather than hidden. An empty tile still reads as a turn, and
         the queue really is empty once the battle has ended. */
      for (let i = entries.length; i < pool.length; i++) {
        pool[i]!.el.remove();
      }

      entries.forEach((entry, index) => {
        const slot = pool[index]!;
        /* Index 0 is the current turn -- see HudModel.turnOrder for why this
           cannot be a match against activeActorId. */
        slot.update(entry, index === 0);
        if (slot.el.parentNode === null) el.append(slot.el);
      });
    },
  };
}

interface TurnSlot {
  el: HTMLElement;
  update(entry: HudModel['turnOrder'][number], isCurrent: boolean): void;
}

function buildTurnSlot(index: number): TurnSlot {
  const el = document.createElement('li');
  el.className = 'hud-turn';
  el.dataset['testid'] = `turn-order-slot-${index}`;

  const portrait = document.createElement('span');
  portrait.className = 'hud-turn__portrait';

  /* The name stays in the DOM, off-screen. It keeps the tile's accessible
     name, keeps the <ol> readable as a list of characters rather than a list
     of blanks, and keeps each item's textContent equal to the character name
     -- which is what the id/name pair in the old bare row was for. */
  const name = document.createElement('span');
  name.className = 'hud-sr-only';

  el.append(portrait, name);

  return {
    el,
    update(entry, isCurrent): void {
      if (el.dataset['actor'] !== entry.id) {
        /* The id is what a test joins against an ActorId; the side answers
           "is the boss up next" without anyone parsing a portrait. */
        el.dataset['actor'] = entry.id;
        el.dataset['side'] = entry.side;
        setText(name, entry.name);
        applyPortrait(portrait, entry.id);
      }
      toggleAttr(el, 'data-current', isCurrent);
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

function buildCommandMenu(): Region {
  const el = document.createElement('nav');
  el.className = 'hud-menu';
  el.dataset['testid'] = 'command-menu';
  el.setAttribute('aria-label', 'Battle commands');

  const heading = document.createElement('h2');
  heading.className = 'hud-menu__title';
  heading.dataset['testid'] = 'menu-title';

  const list = document.createElement('ul');
  list.className = 'hud-menu__list';

  el.append(heading, list);

  return {
    el,
    update(next: HudModel): void {
      /* Locked is not hidden: the player should still see what they chose
         while it plays out. It is announced so a screen reader does not
         report a menu as interactive when it is not. */
      setAttr(el, 'aria-disabled', next.isLocked ? 'true' : 'false');
      setText(heading, next.menuTitle);

      /* Rebuilt wholesale, as before. The options change identity and count
         with the menu level -- command, skill, target -- so there is nothing
         stable to update in place, and none of it animates. */
      list.replaceChildren();

      next.options.forEach((option, index) => {
        const item = document.createElement('li');
        const selected = index === next.cursor;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hud-menu__item';
        button.dataset['testid'] =
          `${TESTID_PREFIX[next.menuTitle] ?? 'option'}-${option.id}`;
        button.textContent =
          option.hint === undefined
            ? option.label
            : `${option.label} (${option.hint})`;
        button.setAttribute('aria-current', selected ? 'true' : 'false');
        button.disabled = !option.enabled || next.isLocked;
        if (selected) button.classList.add('is-selected');

        item.append(button);
        list.append(item);
      });
    },
  };
}

/**
 * Testid prefix per menu level.
 *
 * Keyed off the rendered title rather than the MenuState so renderHud stays
 * a pure function of HudModel -- it never reaches back into menu state.
 */
const TESTID_PREFIX: Record<string, string> = {
  Command: 'command',
  Skill: 'skill',
  Target: 'target',
};

/* ------------------------------------------------------------------ */
/* Narration                                                           */
/* ------------------------------------------------------------------ */

function buildNarration(): Region {
  const el = document.createElement('p');
  el.className = 'hud-narration';
  el.dataset['testid'] = 'narration';
  /* Announced to screen readers as the sequencer steps through a turn.
     Updating the text of a live region is what actually announces -- the old
     replace-the-whole-node approach was announcing by accident. */
  el.setAttribute('role', 'status');

  return {
    el,
    update(next: HudModel): void {
      setText(el, next.narration);
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
