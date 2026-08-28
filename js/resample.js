/**
 * Puts every file onto one shared x axis.
 *
 * Charts need a single x array for all series, and the files being compared
 * have different sample rates, lengths and recording strategies. So each
 * channel is resampled onto a common evenly spaced grid: samples falling
 * inside a grid cell are averaged (which is also how the data gets
 * downsampled), cells with no samples are linearly interpolated, and cells
 * further than `gap` from any sample stay NaN so the chart shows a real gap
 * rather than a line drawn across a pause.
 */

import { distanceToDisplay } from './model.js';

/** Longest backwards/forwards search for a neighbouring valid sample. */
const MAX_NEIGHBOUR_SCAN = 2000;

/** Gap floor, in x units, below which short pauses are still drawn as a line. */
const MIN_GAP_SECONDS = 12;
const MIN_GAP_METRES = 30;

/**
 * The x values of one file, in the unit the x axis displays.
 *
 * @param {import('./model.js').Track} track
 * @param {import('./model.js').XMode} xMode
 * @param {import('./model.js').UnitSystem} units
 * @returns {Float64Array}
 */
export function xSeries(track, xMode, units) {
  if (xMode === 'clock') return track.time;
  if (xMode === 'elapsed') return track.elapsed;

  const out = new Float64Array(track.dist.length);
  for (let i = 0; i < out.length; i++) out[i] = distanceToDisplay(track.dist[i], units);
  return out;
}

/**
 * A file prepared for resampling: the x values that are actually usable, in
 * ascending order, plus the index each one has in the original track.
 *
 * @typedef {Object} Source
 * @property {Float64Array} x    Finite, non-decreasing x values.
 * @property {Int32Array} index  `index[k]` is the track index of `x[k]`.
 * @property {number} gap        Largest x distance that is still drawn as a line.
 */

/**
 * @param {Float64Array} xs
 * @param {import('./model.js').XMode} xMode
 * @param {import('./model.js').UnitSystem} units
 * @returns {Source}
 */
export function prepareSource(xs, xMode, units) {
  const x = new Float64Array(xs.length);
  const index = new Int32Array(xs.length);
  let n = 0;
  let last = -Infinity;

  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    // Distance can step backwards on GPS jitter and clocks can repeat a
    // second; both would break the single forward pass below.
    if (!Number.isFinite(v) || v < last) continue;
    x[n] = v;
    index[n] = i;
    n += 1;
    last = v;
  }

  const floor = xMode === 'dist' ? distanceToDisplay(MIN_GAP_METRES, units) : MIN_GAP_SECONDS;
  return {
    x: x.subarray(0, n),
    index: index.subarray(0, n),
    gap: Math.max(floor, 6 * medianSpacing(x.subarray(0, n))),
  };
}

/**
 * Median distance between consecutive values, estimated from at most 1000
 * evenly spread gaps so long files stay cheap.
 *
 * @param {Float64Array} x
 * @returns {number}
 */
export function medianSpacing(x) {
  if (x.length < 2) return 0;
  const stride = Math.max(1, Math.floor((x.length - 1) / 1000));
  /** @type {number[]} */
  const gaps = [];
  for (let i = stride; i < x.length; i += stride) gaps.push((x[i] - x[i - stride]) / stride);
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

/**
 * An evenly spaced x axis shared by every chart.
 *
 * @typedef {Object} Grid
 * @property {Float64Array} x
 * @property {number} step
 */

/**
 * @param {number} min
 * @param {number} max
 * @param {number} count
 * @returns {Grid}
 */
export function makeGrid(min, max, count) {
  const n = Math.max(2, Math.round(count));
  const step = (max - min) / (n - 1);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = min + i * step;
  return { x, step };
}

/**
 * The half-open range of grid indices covered by the x values `[min, max]`,
 * or the whole grid when there is no range.
 *
 * @param {Grid} grid
 * @param {{min: number, max: number}|null} range
 * @returns {[number, number]}
 */
export function gridBounds(grid, range) {
  if (!range || grid.step <= 0) return [0, grid.x.length];
  const origin = grid.x[0];
  const from = Math.max(0, Math.ceil((range.min - origin) / grid.step));
  const to = Math.min(grid.x.length, Math.floor((range.max - origin) / grid.step) + 1);
  return [from, Math.max(from, to)];
}

/**
 * Resample one channel onto the grid.
 *
 * @param {Source} source
 * @param {Float64Array} values  Channel values, indexed like the original track.
 * @param {Grid} grid
 * @returns {Float64Array}  Grid-length array, NaN where there is no data.
 */
export function resample(source, values, grid) {
  const { x, index, gap } = source;
  const n = x.length;
  const out = new Float64Array(grid.x.length).fill(NaN);
  if (n === 0) return out;

  const half = grid.step / 2;
  let cursor = 0;

  for (let i = 0; i < grid.x.length; i++) {
    const centre = grid.x[i];
    const lo = centre - half;
    const hi = centre + half;

    while (cursor < n && x[cursor] < lo) cursor += 1;

    let sum = 0;
    let count = 0;
    for (let k = cursor; k < n && x[k] < hi; k++) {
      const v = values[index[k]];
      if (v === v) {
        sum += v;
        count += 1;
      }
    }

    if (count > 0) {
      out[i] = sum / count;
      continue;
    }

    // Nothing recorded in this cell: bridge it from the nearest valid samples
    // on either side, but only if they are close enough to be the same effort.
    let before = cursor - 1;
    let limit = MAX_NEIGHBOUR_SCAN;
    while (before >= 0 && limit-- > 0 && !(values[index[before]] === values[index[before]])) {
      before -= 1;
    }
    if (before < 0 || limit <= 0) continue;

    let after = cursor;
    limit = MAX_NEIGHBOUR_SCAN;
    while (after < n && limit-- > 0 && !(values[index[after]] === values[index[after]])) {
      after += 1;
    }
    if (after >= n || limit <= 0) continue;

    const xa = x[before];
    const xb = x[after];
    if (xb - xa > gap) continue;

    const va = values[index[before]];
    const vb = values[index[after]];
    out[i] = xb === xa ? va : va + ((vb - va) * (centre - xa)) / (xb - xa);
  }

  return out;
}
