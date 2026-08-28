/**
 * The stack of comparison charts, one per channel.
 *
 * Every chart shares a single resampled x axis (see `resample.js`) so uPlot can
 * plot all files together, the cursors stay synchronised across charts, and the
 * legend of each chart reads as a row of "what was every device showing at this
 * point?".
 */

import { CHANNELS } from './model.js';
import { xSeries, prepareSource, makeGrid, resample } from './resample.js';
import { duration, number } from './format.js';

/** uPlot is loaded as a plain script, see index.html. @type {any} */
const uPlot = /** @type {any} */ (window).uPlot;

/** Cursors are synchronised across every chart through this key. */
const SYNC_KEY = 'activity-comparison';

/** Height of one chart's plotting area, in CSS pixels. */
const PLOT_HEIGHT = 150;

/** Fixed axis sizes keep the plotting areas of all charts aligned. */
const Y_AXIS_SIZE = 58;
const X_AXIS_SIZE = 34;
const X_AXIS_SIZE_HIDDEN = 12;

/** Upper bound on grid points; more than this is invisible on any screen. */
const MAX_GRID_POINTS = 8000;
const MIN_GRID_POINTS = 400;

/**
 * Where each file was at the sample the cursor is over. Entries are `null` for
 * files with no position at that point.
 *
 * @typedef {({id: string, lat: number, lon: number}|null)[]} CursorPositions
 */

export class ChartStack {
  /**
   * @param {HTMLElement} container
   * @param {Object} hooks
   * @param {(positions: CursorPositions) => void} hooks.onCursor
   * @param {() => void} hooks.onCursorLeave
   */
  constructor(container, hooks) {
    this.container = container;
    this.hooks = hooks;

    /** @type {any[]} */
    this.plots = [];
    /** @type {import('./model.js').Activity[]} */
    this.plotted = [];
    /** @type {{lat: Float64Array, lon: Float64Array}[]} */
    this.positions = [];
    /** @type {number|null} */
    this.lastIndex = null;

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
  }

  /**
   * Rebuild every chart. Called whenever the files, their colours, the x axis
   * mode or the unit system change — uPlot is fast enough that a full rebuild
   * is simpler and less error-prone than patching each option in place.
   *
   * @param {import('./model.js').Activity[]} activities
   * @param {import('./model.js').XMode} xMode
   * @param {import('./model.js').UnitSystem} units
   */
  render(activities, xMode, units) {
    this.destroyPlots();

    const visible = activities.filter((a) => a.visible);
    const prepared = visible
      .map((activity) => ({
        activity,
        source: prepareSource(xSeries(activity.track, xMode, units), xMode, units),
      }))
      .filter((entry) => entry.source.x.length > 1);

    if (prepared.length === 0) {
      this.plotted = [];
      this.positions = [];
      this.renderEmpty(visible.length > 0 && xMode !== 'dist');
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    let longest = 0;
    for (const { source } of prepared) {
      min = Math.min(min, source.x[0]);
      max = Math.max(max, source.x[source.x.length - 1]);
      longest = Math.max(longest, source.x.length);
    }
    if (!(max > min)) max = min + 1;

    const grid = makeGrid(
      min,
      max,
      Math.min(MAX_GRID_POINTS, Math.max(MIN_GRID_POINTS, longest)),
    );

    this.plotted = prepared.map((entry) => entry.activity);
    this.positions = prepared.map(({ activity, source }) =>
      activity.hasGps
        ? {
            lat: resample(source, activity.track.lat, grid),
            lon: resample(source, activity.track.lon, grid),
          }
        : { lat: new Float64Array(0), lon: new Float64Array(0) },
    );

    const drawn = CHANNELS.filter((c) => prepared.some(({ activity }) => activity.has[c.key]));
    this.container.replaceChildren();

    // A file with no timestamps cannot be drawn against time, and one with no
    // distance cannot be drawn against distance. Say so rather than quietly
    // leaving it out.
    const excluded = visible.filter((a) => !prepared.some((entry) => entry.activity === a));
    if (excluded.length > 0) this.container.append(exclusionNote(excluded, xMode));

    drawn.forEach((spec, position) => {
      const data = [
        grid.x,
        ...prepared.map(({ activity, source }) =>
          toSeries(resample(source, activity.track[spec.key], grid), (v) =>
            spec.toDisplay(v, units),
          ),
        ),
      ];

      const wrapper = document.createElement('section');
      wrapper.className = 'chart';
      this.container.append(wrapper);

      const options = this.chartOptions({
        spec,
        units,
        xMode,
        activities: this.plotted,
        showXLabels: position === drawn.length - 1,
        width: this.plotWidth(),
      });

      this.plots.push(new uPlot(options, data, wrapper));
    });

    if (drawn.length === 0) this.renderEmpty(false);
  }

  /**
   * @param {Object} config
   * @param {import('./model.js').Channel} config.spec
   * @param {import('./model.js').UnitSystem} config.units
   * @param {import('./model.js').XMode} config.xMode
   * @param {import('./model.js').Activity[]} config.activities
   * @param {boolean} config.showXLabels
   * @param {number} config.width
   * @returns {any}
   */
  chartOptions({ spec, units, xMode, activities, showXLabels, width }) {
    const style = getComputedStyle(document.documentElement);
    const stroke = style.getPropertyValue('--chart-axis').trim() || '#666';
    const gridColor = style.getPropertyValue('--chart-grid').trim() || '#e5e5e5';
    const unit = spec.unit(units);

    /** @type {Record<string, unknown>} */
    const xAxis = {
      stroke,
      grid: { stroke: gridColor, width: 1 },
      ticks: { stroke: gridColor, width: 1 },
      size: showXLabels ? X_AXIS_SIZE : X_AXIS_SIZE_HIDDEN,
      space: 70,
    };
    // Only the bottom chart shows tick labels; the others keep the grid lines
    // but drop the text so the stack stays readable. Clock mode is left to
    // uPlot's own time formatting.
    if (!showXLabels) xAxis.values = () => [];
    else if (xMode !== 'clock') xAxis.values = xTickValues(xMode);

    return {
      title: `${spec.label} (${unit})`,
      width,
      height: PLOT_HEIGHT,
      cursor: {
        // Only the x position is meaningful when comparing files.
        y: false,
        sync: { key: SYNC_KEY, setSeries: false },
        drag: { x: true, y: false, setScale: true },
        points: { size: 6 },
      },
      legend: { live: true },
      scales: {
        x: { time: xMode === 'clock' },
        y: {
          range: (/** @type {any} */ _u, /** @type {number} */ lo, /** @type {number} */ hi) =>
            yRange(lo, hi, spec.zeroBased === true),
        },
      },
      axes: [
        xAxis,
        {
          stroke,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          size: Y_AXIS_SIZE,
        },
      ],
      series: [
        {
          label: xLabel(xMode, units),
          value: (/** @type {any} */ _u, /** @type {number|null} */ v) =>
            formatX(v, xMode, units),
        },
        ...activities.map((activity) => ({
          label: activity.name,
          stroke: activity.color,
          width: 1.75,
          spanGaps: false,
          points: { show: false },
          value: (/** @type {any} */ _u, /** @type {number|null} */ v) =>
            v == null ? '–' : `${number(v, spec.decimals)} ${unit}`,
        })),
      ],
      hooks: {
        setCursor: [(/** @type {any} */ u) => this.handleCursor(u)],
      },
    };
  }

  /** @param {any} u */
  handleCursor(u) {
    const index = u.cursor.idx;

    if (index == null) {
      if (this.lastIndex !== null) {
        this.lastIndex = null;
        this.hooks.onCursorLeave();
      }
      return;
    }

    if (index === this.lastIndex) return;
    this.lastIndex = index;

    this.hooks.onCursor(
      this.plotted.map((activity, i) => {
        const position = this.positions[i];
        const lat = position.lat[index];
        const lon = position.lon[index];
        return Number.isFinite(lat) && Number.isFinite(lon)
          ? { id: activity.id, lat, lon }
          : null;
      }),
    );
  }

  /** @param {boolean} missingTimestamps */
  renderEmpty(missingTimestamps) {
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = missingTimestamps
      ? 'None of the loaded files have timestamps — switch the x axis to Distance.'
      : 'No chartable data in the selected files.';
    this.container.replaceChildren(message);
  }

  plotWidth() {
    return Math.max(320, this.container.clientWidth);
  }

  resize() {
    const width = this.plotWidth();
    for (const plot of this.plots) plot.setSize({ width, height: PLOT_HEIGHT });
  }

  destroyPlots() {
    for (const plot of this.plots) plot.destroy();
    this.plots = [];
    this.lastIndex = null;
  }

  destroy() {
    this.observer.disconnect();
    this.destroyPlots();
    this.container.replaceChildren();
  }
}

/**
 * @param {import('./model.js').Activity[]} excluded
 * @param {import('./model.js').XMode} xMode
 * @returns {HTMLElement}
 */
function exclusionNote(excluded, xMode) {
  const axis = xMode === 'dist' ? 'distance' : xMode === 'clock' ? 'clock time' : 'elapsed time';
  const reason = xMode === 'dist' ? 'no distance data' : 'no timestamps';
  const note = document.createElement('p');
  note.className = 'chart-note';
  note.textContent = `Not charted against ${axis}: ${excluded
    .map((a) => a.name)
    .join(', ')} (${reason}).`;
  return note;
}

/**
 * uPlot treats `null` as a gap in the line; NaN would be drawn as a broken
 * segment instead, so the conversion happens here.
 *
 * @param {Float64Array} values
 * @param {(v: number) => number} convert
 * @returns {(number|null)[]}
 */
function toSeries(values, convert) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = Number.isFinite(v) ? convert(v) : null;
  }
  return out;
}

/**
 * @param {number|null} lo
 * @param {number|null} hi
 * @param {boolean} zeroBased
 * @returns {[number, number]}
 */
function yRange(lo, hi, zeroBased) {
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  let low = zeroBased ? Math.min(0, lo) : lo;
  let high = hi;
  if (high === low) high = low + 1;
  const pad = (high - low) * 0.08;
  return [zeroBased && low === 0 ? 0 : low - pad, high + pad];
}

/**
 * Tick labels for the elapsed-time and distance axes.
 *
 * @param {import('./model.js').XMode} xMode
 * @returns {(u: any, ticks: number[]) => string[]}
 */
function xTickValues(xMode) {
  if (xMode === 'elapsed') return (_u, ticks) => ticks.map((t) => duration(t));
  return (_u, ticks) => ticks.map((t) => number(t, t < 10 ? 1 : 0));
}

/**
 * @param {import('./model.js').XMode} xMode
 * @param {import('./model.js').UnitSystem} units
 */
function xLabel(xMode, units) {
  if (xMode === 'elapsed') return 'Elapsed';
  if (xMode === 'clock') return 'Time';
  return units === 'imperial' ? 'Distance (mi)' : 'Distance (km)';
}

/**
 * @param {number|null} value
 * @param {import('./model.js').XMode} xMode
 * @param {import('./model.js').UnitSystem} units
 */
function formatX(value, xMode, units) {
  if (value == null) return '–';
  if (xMode === 'elapsed') return duration(value);
  if (xMode === 'clock') return new Date(value * 1000).toLocaleTimeString();
  return `${number(value, 2)} ${units === 'imperial' ? 'mi' : 'km'}`;
}
