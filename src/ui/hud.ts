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
 *      "the boss HP bar reports 588321/1200000" -- rather than having to
 *      interpret pixels. Roughly 80% of this game is UI, so keeping that
 *      80% machine-readable is the difference between a fast agentic loop
 *      and a slow one.
 *
 * Phase 0 renders a deliberately minimal HUD: enough structure to prove the
 * DOM channel works, not the finished layout. Phase 2 builds the real thing.
 *
 * Every element carries a `data-testid` -- these are a stable contract for
 * the harness. Renaming one is a breaking change; treat them accordingly.
 */

export interface HudModel {
  bossName: string;
  bossLevel: number;
  bossHp: number;
  bossMaxHp: number;
  commands: readonly string[];
  selectedCommandIndex: number;
  narration: string;
}

export function renderHud(root: HTMLElement, model: HudModel): void {
  root.innerHTML = '';

  root.append(
    bossBar(model),
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
  label.textContent = `${model.bossName} LV${model.bossLevel}`;

  const track = document.createElement('div');
  track.className = 'hud-boss__track';

  const fill = document.createElement('div');
  fill.className = 'hud-boss__fill';
  fill.dataset['testid'] = 'boss-hp-fill';
  const pct = clampPercent((model.bossHp / model.bossMaxHp) * 100);
  fill.style.width = `${pct}%`;

  /* The accessible name doubles as the harness's assertion target, so the
     exact numbers are readable without parsing a style attribute. */
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(model.bossMaxHp));
  track.setAttribute('aria-valuenow', String(model.bossHp));
  track.setAttribute('aria-label', `${model.bossName} health`);

  const readout = document.createElement('div');
  readout.className = 'hud-boss__readout';
  readout.dataset['testid'] = 'boss-hp-text';
  readout.textContent = `${model.bossHp.toLocaleString()}/${model.bossMaxHp.toLocaleString()}`;

  track.append(fill);
  wrap.append(label, track, readout);
  return wrap;
}

function commandMenu(model: HudModel): HTMLElement {
  const wrap = document.createElement('nav');
  wrap.className = 'hud-menu';
  wrap.dataset['testid'] = 'command-menu';
  wrap.setAttribute('aria-label', 'Battle commands');

  const heading = document.createElement('h2');
  heading.className = 'hud-menu__title';
  heading.textContent = 'Command';

  const list = document.createElement('ul');
  list.className = 'hud-menu__list';

  model.commands.forEach((command, index) => {
    const item = document.createElement('li');
    const selected = index === model.selectedCommandIndex;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-menu__item';
    button.dataset['testid'] = `command-${command.toLowerCase()}`;
    button.textContent = command;
    button.setAttribute('aria-current', selected ? 'true' : 'false');
    if (selected) button.classList.add('is-selected');

    item.append(button);
    list.append(item);
  });

  wrap.append(heading, list);
  return wrap;
}

function narrationLine(model: HudModel): HTMLElement {
  const line = document.createElement('p');
  line.className = 'hud-narration';
  line.dataset['testid'] = 'narration';
  /* Announced to screen readers when the sequencer updates it in Phase 3. */
  line.setAttribute('role', 'status');
  line.textContent = model.narration;
  return line;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
