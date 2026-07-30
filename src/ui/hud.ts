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
import { isDefeated, type BattleState, type Status } from '../battle/types';
import { menuOptions, menuTitle, type MenuOption, type MenuState } from './menu';

/** How many turns the order bar looks ahead. */
export const TURN_PREVIEW_LENGTH = 6;

export interface HudActor {
  id: string;
  name: string;
  side: 'party' | 'enemy';
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  isActive: boolean;
  isDefeated: boolean;
  statuses: readonly Status[];
}

export interface HudModel {
  boss: { id: string; name: string; level: number; hp: number; maxHp: number };
  actors: readonly HudActor[];
  /** Upcoming turns, current actor first. */
  turnOrder: readonly { id: string; name: string }[];
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

  const nameOf = (id: string): string =>
    state.actors.find((actor) => actor.id === id)?.name ?? id;

  return {
    boss: {
      id: boss.id,
      name: boss.name,
      level: boss.level,
      hp: boss.hp,
      maxHp: boss.stats.maxHp,
    },
    actors: state.actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      side: actor.side,
      hp: actor.hp,
      maxHp: actor.stats.maxHp,
      mp: actor.mp,
      maxMp: actor.stats.maxMp,
      isActive: actor.id === activeActorId,
      isDefeated: isDefeated(actor),
      statuses: actor.statuses,
    })),
    turnOrder:
      state.phase === 'in_progress'
        ? previewUpcoming(state, TURN_PREVIEW_LENGTH).map((id) => ({
            id,
            name: nameOf(id),
          }))
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

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export function renderHud(root: HTMLElement, model: HudModel): void {
  root.innerHTML = '';

  root.append(
    bossBar(model),
    turnOrderBar(model),
    partyPanel(model),
    statusLine(model),
    commandMenu(model),
    narrationLine(model),
  );
}

function bossBar(model: HudModel): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'hud-boss';
  wrap.dataset['testid'] = 'boss-bar';

  const label = document.createElement('div');
  label.className = 'hud-boss__label';
  label.dataset['testid'] = 'boss-name';
  label.textContent = `${model.boss.name} LV${model.boss.level}`;

  const track = document.createElement('div');
  track.className = 'hud-boss__track';

  const fill = document.createElement('div');
  fill.className = 'hud-boss__fill';
  fill.dataset['testid'] = 'boss-hp-fill';
  const pct = clampPercent((model.boss.hp / model.boss.maxHp) * 100);
  fill.style.width = `${pct}%`;

  /* The accessible name doubles as the harness's assertion target, so the
     exact numbers are readable without parsing a style attribute. */
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(model.boss.maxHp));
  track.setAttribute('aria-valuenow', String(model.boss.hp));
  track.setAttribute('aria-label', `${model.boss.name} health`);

  const readout = document.createElement('div');
  readout.className = 'hud-boss__readout';
  readout.dataset['testid'] = 'boss-hp-text';
  readout.textContent = `${model.boss.hp.toLocaleString()}/${model.boss.maxHp.toLocaleString()}`;

  track.append(fill);
  wrap.append(label, track, readout);
  return wrap;
}

function turnOrderBar(model: HudModel): HTMLElement {
  const wrap = document.createElement('ol');
  wrap.dataset['testid'] = 'turn-order';
  wrap.setAttribute('aria-label', 'Turn order');

  model.turnOrder.forEach((entry, index) => {
    const slot = document.createElement('li');
    slot.dataset['testid'] = `turn-order-slot-${index}`;
    /* The id as well as the name: the name is for a human reading the
       screen, the id is what a test can join against an ActorId. */
    slot.dataset['actor'] = entry.id;
    slot.textContent = entry.name;
    wrap.append(slot);
  });

  return wrap;
}

function partyPanel(model: HudModel): HTMLElement {
  const wrap = document.createElement('div');
  wrap.dataset['testid'] = 'party-panel';

  for (const actor of model.actors) {
    const row = document.createElement('div');
    row.dataset['testid'] = `actor-${actor.id}`;
    row.setAttribute('aria-current', actor.isActive ? 'true' : 'false');
    if (actor.isDefeated) row.setAttribute('data-defeated', 'true');

    const name = document.createElement('span');
    name.dataset['testid'] = `actor-${actor.id}-name`;
    name.textContent = actor.name;

    const hp = document.createElement('span');
    hp.dataset['testid'] = `actor-${actor.id}-hp`;
    hp.textContent = `${actor.hp}/${actor.maxHp}`;

    const mp = document.createElement('span');
    mp.dataset['testid'] = `actor-${actor.id}-mp`;
    mp.textContent = `${actor.mp}/${actor.maxMp}`;

    const statuses = document.createElement('span');
    statuses.dataset['testid'] = `actor-${actor.id}-statuses`;
    statuses.textContent = actor.statuses.map((s) => s.kind).join(' ');

    row.append(name, ' HP ', hp, ' MP ', mp, ' ', statuses);
    wrap.append(row);
  }

  return wrap;
}

/** Round, chain, phase and whose turn it is -- the machine-readable strip. */
function statusLine(model: HudModel): HTMLElement {
  const wrap = document.createElement('div');
  wrap.dataset['testid'] = 'battle-status';

  const phase = document.createElement('span');
  phase.dataset['testid'] = 'battle-phase';
  phase.textContent = PHASE_LABELS[model.phase];

  const round = document.createElement('span');
  round.dataset['testid'] = 'battle-round';
  round.textContent = String(model.round);

  const chain = document.createElement('span');
  chain.dataset['testid'] = 'battle-chain';
  chain.textContent = String(model.chain);

  const active = document.createElement('span');
  active.dataset['testid'] = 'active-actor';
  active.textContent = model.activeActorId ?? '';

  wrap.append(phase, ' ROUND ', round, ' CHAIN ', chain, ' TURN ', active);
  return wrap;
}

const PHASE_LABELS: Record<BattleState['phase'], string> = {
  in_progress: 'IN PROGRESS',
  victory: 'VICTORY',
  defeat: 'DEFEAT',
};

function commandMenu(model: HudModel): HTMLElement {
  const wrap = document.createElement('nav');
  wrap.className = 'hud-menu';
  wrap.dataset['testid'] = 'command-menu';
  wrap.setAttribute('aria-label', 'Battle commands');
  /* Locked is not hidden: the player should still see what they chose while
     it plays out. It is announced so a screen reader does not report a menu
     as interactive when it is not. */
  wrap.setAttribute('aria-disabled', model.isLocked ? 'true' : 'false');

  const heading = document.createElement('h2');
  heading.className = 'hud-menu__title';
  heading.dataset['testid'] = 'menu-title';
  heading.textContent = model.menuTitle;

  const list = document.createElement('ul');
  list.className = 'hud-menu__list';

  model.options.forEach((option, index) => {
    const item = document.createElement('li');
    const selected = index === model.cursor;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-menu__item';
    button.dataset['testid'] = `${TESTID_PREFIX[model.menuTitle] ?? 'option'}-${option.id}`;
    button.textContent = option.hint === undefined
      ? option.label
      : `${option.label} (${option.hint})`;
    button.setAttribute('aria-current', selected ? 'true' : 'false');
    button.disabled = !option.enabled || model.isLocked;
    if (selected) button.classList.add('is-selected');

    item.append(button);
    list.append(item);
  });

  wrap.append(heading, list);
  return wrap;
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

function narrationLine(model: HudModel): HTMLElement {
  const line = document.createElement('p');
  line.className = 'hud-narration';
  line.dataset['testid'] = 'narration';
  /* Announced to screen readers as the sequencer steps through a turn. */
  line.setAttribute('role', 'status');
  line.textContent = model.narration;
  return line;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
