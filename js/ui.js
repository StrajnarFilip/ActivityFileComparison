/** Rendering for the file panel and the summary comparison table. */

import { CHANNELS } from './model.js';
import {
  distanceToDisplay,
  distanceUnit,
  elevationToDisplay,
  elevationUnit,
} from './model.js';
import { duration, number, dateTime } from './format.js';

/**
 * Which aggregates are worth a column for each channel. Elevation is covered by
 * the ascent column, so only its peak is shown, and average temperature is
 * enough for a device comparison.
 *
 * @type {Record<import('./model.js').ChannelKey, ('avg'|'max')[]>}
 */
const CHANNEL_COLUMNS = {
  power: ['avg', 'max'],
  hr: ['avg', 'max'],
  cad: ['avg', 'max'],
  speed: ['avg', 'max'],
  ele: ['max'],
  temp: ['avg'],
};

/**
 * @typedef {Object} FileHandlers
 * @property {(id: string, color: string) => void} onColor
 * @property {(id: string, visible: boolean) => void} onVisibility
 * @property {(id: string) => void} onRemove
 * @property {(id: string|null) => void} onHighlight  Pointer entered/left a row.
 */

/**
 * @param {HTMLElement} container
 * @param {import('./model.js').Activity[]} activities
 * @param {import('./model.js').UnitSystem} units
 * @param {FileHandlers} handlers
 */
export function renderFileList(container, activities, units, handlers) {
  container.replaceChildren();

  for (const activity of activities) {
    const item = document.createElement('li');
    item.className = 'file';
    if (!activity.visible) item.classList.add('is-hidden');

    const visible = el('input', 'file-visible');
    visible.type = 'checkbox';
    visible.checked = activity.visible;
    visible.title = 'Show this file in the charts and on the map';
    visible.addEventListener('change', () => handlers.onVisibility(activity.id, visible.checked));

    const color = el('input', 'file-color');
    color.type = 'color';
    color.value = activity.color;
    color.title = 'Colour for the chart lines and the map track';
    color.addEventListener('input', () => handlers.onColor(activity.id, color.value));

    const body = document.createElement('div');
    body.className = 'file-body';

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = activity.name;
    name.title = activity.name;

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.textContent = [
      activity.format,
      activity.sport,
      activity.device,
      duration(activity.stats.elapsedTime),
      activity.stats.distance > 0
        ? `${number(distanceToDisplay(activity.stats.distance, units), 1)} ${distanceUnit(units)}`
        : '',
      activity.hasGps ? '' : 'no GPS',
    ]
      .filter(Boolean)
      .join(' · ');

    body.append(name, meta);

    const remove = el('button', 'file-remove');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove ${activity.name}`;
    remove.setAttribute('aria-label', `Remove ${activity.name}`);
    remove.addEventListener('click', () => handlers.onRemove(activity.id));

    item.addEventListener('pointerenter', () => handlers.onHighlight(activity.id));
    item.addEventListener('pointerleave', () => handlers.onHighlight(null));

    item.append(visible, color, body, remove);
    container.append(item);
  }
}

/**
 * @param {HTMLElement} container
 * @param {import('./model.js').Activity[]} activities
 * @param {import('./model.js').UnitSystem} units
 */
export function renderSummary(container, activities, units) {
  const shown = activities.filter((a) => a.visible);
  container.replaceChildren();
  if (shown.length === 0) return;

  /** @type {{head: string, cell: (a: import('./model.js').Activity) => string}[]} */
  const columns = [
    { head: 'Start', cell: (a) => dateTime(a.stats.start) },
    { head: 'Elapsed', cell: (a) => duration(a.stats.elapsedTime) },
    { head: 'Moving', cell: (a) => duration(a.stats.movingTime) },
    {
      head: `Distance (${distanceUnit(units)})`,
      cell: (a) => number(distanceToDisplay(a.stats.distance, units), 2),
    },
    {
      head: `Ascent (${elevationUnit(units)})`,
      cell: (a) => number(elevationToDisplay(a.stats.ascent, units), 0),
    },
  ];

  for (const spec of CHANNELS) {
    if (!shown.some((a) => a.has[spec.key])) continue;
    for (const kind of CHANNEL_COLUMNS[spec.key]) {
      columns.push({
        head: `${kind === 'avg' ? 'Avg' : 'Max'} ${spec.label.toLowerCase()} (${spec.unit(units)})`,
        cell: (a) => {
          const value = a.stats.channels[spec.key][kind];
          return Number.isFinite(value) ? number(spec.toDisplay(value, units), spec.decimals) : '–';
        },
      });
    }
  }

  const table = document.createElement('table');
  table.className = 'summary';

  const head = document.createElement('tr');
  head.append(th('File'));
  for (const column of columns) head.append(th(column.head));
  table.createTHead().append(head);

  const body = table.createTBody();
  for (const activity of shown) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = activity.color;
    nameCell.append(swatch, document.createTextNode(activity.name));
    row.append(nameCell);

    for (const column of columns) {
      const cell = document.createElement('td');
      cell.textContent = column.cell(activity);
      row.append(cell);
    }
    body.append(row);
  }

  container.append(table);
}

/** @param {string} text */
function th(text) {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = text;
  return cell;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} className
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
