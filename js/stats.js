/**
 * Aggregates over a slice of one file, for the per-chart statistics tables.
 *
 * These work on the {@link import('./resample.js').Source} the charts already
 * build — the file's usable x values plus the track index each one came from —
 * so a selected segment of the x axis maps to a contiguous run of samples that
 * can be summarised without touching the resampled data.
 */

/** Sample intervals longer than this are a pause, and carry no weight. */
const MAX_SAMPLE_GAP = 60;

/**
 * @typedef {Object} Aggregate
 * @property {number} avg    Time-weighted mean, NaN when nothing was recorded.
 * @property {number} max    NaN when nothing was recorded.
 * @property {number} count  Samples that carried a value.
 */

/** @type {Aggregate} */
export const EMPTY = { avg: NaN, max: NaN, count: 0 };

/**
 * The half-open range of source indices covered by the x values `[min, max]`.
 *
 * @param {import('./resample.js').Source} source
 * @param {number} min
 * @param {number} max
 * @returns {[number, number]}
 */
export function rangeBounds(source, min, max) {
  return [firstAtLeast(source.x, min), firstAbove(source.x, max)];
}

/**
 * Mean and maximum of one channel over a run of samples.
 *
 * The mean is weighted by the sample interval so that a file recorded at 1 Hz
 * and one using smart recording report the same number for the same effort.
 *
 * @param {import('./resample.js').Source} source
 * @param {Float64Array} values  Channel values, indexed like the track.
 * @param {Float64Array} time    Track timestamps, for the weighting.
 * @param {number} from          First source index, inclusive.
 * @param {number} to            Last source index, exclusive.
 * @returns {Aggregate}
 */
export function aggregate(source, values, time, from, to) {
  let weighted = 0;
  let weight = 0;
  let total = 0;
  let count = 0;
  let max = -Infinity;

  for (let k = from; k < to; k++) {
    const value = values[source.index[k]];
    if (!Number.isFinite(value)) continue;

    if (value > max) max = value;
    total += value;
    count += 1;

    // The first sample of the range has no interval to be weighted by; with
    // more than a handful of samples this makes no visible difference.
    if (k > from) {
      const dt = time[source.index[k]] - time[source.index[k - 1]];
      if (Number.isFinite(dt) && dt > 0 && dt <= MAX_SAMPLE_GAP) {
        weighted += value * dt;
        weight += dt;
      }
    }
  }

  if (count === 0) return EMPTY;
  return { avg: weight > 0 ? weighted / weight : total / count, max, count };
}

/**
 * @param {Float64Array} x  Ascending.
 * @param {number} value
 * @returns {number} First index whose value is >= `value`.
 */
function firstAtLeast(x, value) {
  let low = 0;
  let high = x.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (x[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * @param {Float64Array} x  Ascending.
 * @param {number} value
 * @returns {number} First index whose value is > `value`.
 */
function firstAbove(x, value) {
  let low = 0;
  let high = x.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (x[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}
