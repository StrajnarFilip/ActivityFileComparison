/**
 * Application entry point: loads files, owns the application state and keeps
 * the file list, summary table, charts and map in sync with it.
 */

import { parseActivityFile } from './parse/index.js';
import { buildActivity } from './activity.js';
import { nextColor } from './colors.js';
import { ChartStack } from './charts.js';
import { TrackMap } from './map.js';
import { renderFileList, renderSummary, renderReferenceOptions } from './ui.js';
import { fileSize } from './format.js';

/** Colour changes come in a stream while the picker is dragged. */
const COLOUR_REDRAW_DELAY = 150;

/**
 * @typedef {Object} State
 * @property {import('./model.js').Activity[]} activities
 * @property {import('./model.js').XMode} xMode
 * @property {import('./model.js').UnitSystem} units
 * @property {string|null} referenceId  File the others are compared against.
 */

/** @type {State} */
const state = {
  activities: [],
  xMode: 'elapsed',
  units: 'metric',
  referenceId: null,
};

const dom = {
  empty: required('empty'),
  layout: required('layout'),
  fileList: required('file-list'),
  summary: required('summary'),
  charts: required('charts'),
  map: required('map'),
  mapPanel: required('map-panel'),
  messages: required('messages'),
  selectionInfo: required('selection-info'),
  overlay: required('drop-overlay'),
  fileInput: /** @type {HTMLInputElement} */ (required('file-input')),
  clearAll: required('clear-all'),
  fitMap: required('fit-map'),
  reference: /** @type {HTMLSelectElement} */ (required('reference')),
};

/** @type {ChartStack|null} */
let charts = null;
/** @type {TrackMap|null} */
let map = null;
let nextId = 0;
/** @type {number|undefined} */
let colourTimer;

start();

function start() {
  if (!(/** @type {any} */ (window).uPlot) || !(/** @type {any} */ (window).L)) {
    message('Cannot start', 'the bundled uPlot / Leaflet files did not load — check vendor/.');
    return;
  }

  dom.fileInput.addEventListener('change', () => {
    if (dom.fileInput.files) void addFiles(dom.fileInput.files);
    // Reset so re-adding the same file still fires a change event.
    dom.fileInput.value = '';
  });

  for (const input of document.querySelectorAll('input[name="x-mode"]')) {
    input.addEventListener('change', () => {
      state.xMode = /** @type {import('./model.js').XMode} */ (
        /** @type {HTMLInputElement} */ (input).value
      );
      renderCharts();
    });
  }

  for (const input of document.querySelectorAll('input[name="units"]')) {
    input.addEventListener('change', () => {
      state.units = /** @type {import('./model.js').UnitSystem} */ (
        /** @type {HTMLInputElement} */ (input).value
      );
      render();
    });
  }

  dom.reference.addEventListener('change', () => {
    state.referenceId = dom.reference.value || null;
    render();
  });

  dom.clearAll.addEventListener('click', () => {
    state.activities = [];
    state.referenceId = null;
    render();
  });

  dom.fitMap.addEventListener('click', () => map?.fit());

  // Charts read their axis colours from the stylesheet, so they have to be
  // rebuilt when the system switches between light and dark.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderCharts());

  setUpDragAndDrop();
  render();
}

/**
 * @param {FileList|File[]} files
 */
async function addFiles(files) {
  document.body.style.cursor = 'progress';

  for (const file of Array.from(files)) {
    try {
      const { format, result } = await parseActivityFile(file);
      state.activities.push(
        buildActivity({
          id: `activity-${nextId++}`,
          name: file.name,
          format,
          color: nextColor(state.activities.map((a) => a.color)),
          result,
        }),
      );
    } catch (error) {
      message(file.name, `${describe(error)} (${fileSize(file.size)})`);
    }
  }

  document.body.style.cursor = '';
  render();
}

/** Redraw everything from the current state. */
function render() {
  const hasFiles = state.activities.length > 0;
  dom.empty.hidden = hasFiles;
  dom.layout.hidden = !hasFiles;

  renderFileList(dom.fileList, state.activities, state.units, state.referenceId, {
    onColor: setColor,
    onVisibility: setVisibility,
    onRemove: removeActivity,
    onHighlight: (id) => map?.highlight(id),
  });
  renderSummary(dom.summary, state.activities, state.units);
  renderReferenceOptions(dom.reference, state.activities, state.referenceId);

  if (!hasFiles) {
    charts?.render([], state.xMode, state.units, null);
    map?.render([]);
    return;
  }

  // The map has to be laid out before Leaflet measures it, so unhide first.
  dom.mapPanel.hidden = !state.activities.some((a) => a.visible && a.hasGps);

  if (!charts) {
    charts = new ChartStack(dom.charts, {
      onCursor: (positions) => map?.showCursor(positions),
      onCursorLeave: () => map?.hideCursor(),
      onSelection: (label) => {
        dom.selectionInfo.textContent = label;
      },
    });
  }
  charts.render(state.activities, state.xMode, state.units, state.referenceId);

  if (!dom.mapPanel.hidden) {
    if (!map) map = new TrackMap(dom.map);
    map.render(state.activities);
    map.invalidate();
  }
}

function renderCharts() {
  charts?.render(state.activities, state.xMode, state.units, state.referenceId);
}

/**
 * @param {string} id
 * @param {string} color
 */
function setColor(id, color) {
  const activity = state.activities.find((a) => a.id === id);
  if (!activity) return;
  activity.color = color;

  // The map and the table are cheap to restyle immediately; rebuilding six
  // charts on every step of a colour drag is not.
  map?.render(state.activities);
  renderSummary(dom.summary, state.activities, state.units);
  clearTimeout(colourTimer);
  colourTimer = setTimeout(renderCharts, COLOUR_REDRAW_DELAY);
}

/**
 * @param {string} id
 * @param {boolean} visible
 */
function setVisibility(id, visible) {
  const activity = state.activities.find((a) => a.id === id);
  if (!activity) return;
  activity.visible = visible;
  render();
}

/** @param {string} id */
function removeActivity(id) {
  state.activities = state.activities.filter((a) => a.id !== id);
  if (state.referenceId === id) state.referenceId = null;
  render();
}

function setUpDragAndDrop() {
  let depth = 0;

  /** @param {DragEvent} event */
  const carriesFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  document.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    dom.overlay.hidden = false;
  });

  document.addEventListener('dragover', (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });

  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) dom.overlay.hidden = true;
  });

  document.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    dom.overlay.hidden = true;
    if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files);
  });
}

/**
 * @param {string} title
 * @param {string} detail
 */
function message(title, detail) {
  const item = document.createElement('li');

  const strong = document.createElement('strong');
  strong.textContent = title;

  const text = document.createElement('span');
  text.textContent = detail;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.addEventListener('click', () => item.remove());

  item.append(strong, text, dismiss);
  dom.messages.append(item);
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} id */
function required(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element;
}
