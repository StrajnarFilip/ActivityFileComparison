/**
 * Turns the loose {@link import('./model.js').RawSample} arrays the parsers
 * produce into the packed {@link import('./model.js').Track} everything else
 * consumes, and derives the per-file summary statistics.
 */

import { CHANNEL_KEYS } from './model.js';

/** Mean earth radius in metres (IUGG). */
const EARTH_RADIUS = 6371008.8;

/** A pause longer than this is not counted towards moving time. */
const MAX_SAMPLE_GAP = 60;

/** Speed below which the athlete counts as stopped, in m/s. */
const MOVING_SPEED = 0.5;

/** Elevation must change by this much before it counts as ascent or descent. */
const ELEVATION_HYSTERESIS = 3;

/**
 * Half-width of the window elevation is smoothed over before ascent is summed.
 * GPS elevation wanders by several metres between samples, which would
 * otherwise accumulate into hundreds of metres of imaginary climbing.
 */
const ELEVATION_SMOOTHING_SECONDS = 10;

/**
 * @param {Object} options
 * @param {string} options.id
 * @param {string} options.name
 * @param {'FIT'|'GPX'|'TCX'} options.format
 * @param {string} options.color
 * @param {import('./model.js').ParseResult} options.result
 * @returns {import('./model.js').Activity}
 */
export function buildActivity({ id, name, format, color, result }) {
  const samples = prepare(result.samples);
  if (samples.length === 0) {
    throw new Error('no track points found in this file');
  }

  const n = samples.length;
  /** @type {import('./model.js').Track} */
  const track = {
    time: new Float64Array(n),
    elapsed: new Float64Array(n),
    dist: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    ele: new Float64Array(n),
    hr: new Float64Array(n),
    cad: new Float64Array(n),
    power: new Float64Array(n),
    speed: new Float64Array(n),
    temp: new Float64Array(n),
  };

  const t0 = samples[0].time ?? NaN;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    track.time[i] = s.time ?? NaN;
    track.elapsed[i] = s.time === undefined ? NaN : s.time - t0;
    track.lat[i] = s.lat ?? NaN;
    track.lon[i] = s.lon ?? NaN;
    track.ele[i] = s.ele ?? NaN;
    track.hr[i] = s.hr ?? NaN;
    track.cad[i] = s.cad ?? NaN;
    track.power[i] = s.power ?? NaN;
    track.speed[i] = s.speed ?? NaN;
    track.temp[i] = s.temp ?? NaN;
  }

  fillDistance(track, samples);
  fillSpeed(track);

  /** @type {Record<string, boolean>} */
  const has = {};
  for (const key of CHANNEL_KEYS) has[key] = hasData(track[key]);

  const latlngs = positions(track);

  return {
    id,
    name,
    format,
    sport: result.sport ? titleCase(result.sport) : '',
    device: result.device ?? '',
    color,
    visible: true,
    track,
    has: /** @type {Record<import('./model.js').ChannelKey, boolean>} */ (has),
    hasGps: latlngs.length > 1,
    latlngs,
    stats: summarise(track),
  };
}

/**
 * Drop unusable samples and put the rest in chronological order.
 *
 * @param {import('./model.js').RawSample[]} samples
 * @returns {import('./model.js').RawSample[]}
 */
function prepare(samples) {
  const usable = samples.filter(
    (s) =>
      s.time !== undefined ||
      (s.lat !== undefined && s.lon !== undefined) ||
      s.dist !== undefined,
  );

  const timed = usable.filter((s) => s.time !== undefined).length;
  if (timed === usable.length && timed > 1) {
    usable.sort((a, b) => /** @type {number} */ (a.time) - /** @type {number} */ (b.time));
  }

  // Positions of exactly 0,0 mean "no fix" on most devices.
  for (const s of usable) {
    if (s.lat === 0 && s.lon === 0) {
      s.lat = undefined;
      s.lon = undefined;
    }
  }

  return usable;
}

/**
 * Populate `track.dist`, preferring the distance the device recorded, then GPS,
 * then speed integrated over time. The result is always monotonic.
 *
 * @param {import('./model.js').Track} track
 * @param {import('./model.js').RawSample[]} samples
 */
function fillDistance(track, samples) {
  const n = samples.length;
  const recorded = samples.filter((s) => s.dist !== undefined).length;

  if (recorded > n * 0.9) {
    let last = 0;
    for (let i = 0; i < n; i++) {
      const value = samples[i].dist;
      if (value !== undefined && value >= last) last = value;
      track.dist[i] = last;
    }
    // Devices report distance from the start of the activity; normalise in case
    // the file is a fragment that starts part-way through.
    const base = track.dist[0];
    if (base > 0) for (let i = 0; i < n; i++) track.dist[i] -= base;
    return;
  }

  const gps = samples.filter((s) => s.lat !== undefined && s.lon !== undefined).length;
  if (gps > 1) {
    let total = 0;
    let prevLat = NaN;
    let prevLon = NaN;
    for (let i = 0; i < n; i++) {
      const lat = track.lat[i];
      const lon = track.lon[i];
      if (!Number.isNaN(lat) && !Number.isNaN(prevLat)) {
        total += haversine(prevLat, prevLon, lat, lon);
      }
      if (!Number.isNaN(lat)) {
        prevLat = lat;
        prevLon = lon;
      }
      track.dist[i] = total;
    }
    return;
  }

  let total = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const dt = track.time[i] - track.time[i - 1];
      const v = track.speed[i];
      if (Number.isFinite(dt) && dt > 0 && dt <= MAX_SAMPLE_GAP && Number.isFinite(v)) {
        total += v * dt;
      }
    }
    track.dist[i] = total;
  }
}

/**
 * Derive speed from distance and time when the file does not record it.
 * Files that do record speed are left untouched.
 *
 * @param {import('./model.js').Track} track
 */
function fillSpeed(track) {
  if (hasData(track.speed)) return;

  const n = track.speed.length;
  for (let i = 0; i < n; i++) {
    // Centre the difference on the sample so the curve is not shifted by half
    // a sample interval.
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dt = track.time[b] - track.time[a];
    const dd = track.dist[b] - track.dist[a];
    track.speed[i] = Number.isFinite(dt) && dt > 0 && dt <= MAX_SAMPLE_GAP * 2 ? dd / dt : NaN;
  }
}

/**
 * Positions for Leaflet, with samples that have no fix removed.
 *
 * @param {import('./model.js').Track} track
 * @returns {[number, number][]}
 */
function positions(track) {
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i < track.lat.length; i++) {
    const lat = track.lat[i];
    const lon = track.lon[i];
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon]);
  }
  return out;
}

/**
 * @param {import('./model.js').Track} track
 * @returns {import('./model.js').Stats}
 */
function summarise(track) {
  const n = track.time.length;
  const t0 = track.time[0];
  const t1 = track.time[n - 1];

  let movingTime = 0;
  for (let i = 1; i < n; i++) {
    const dt = track.time[i] - track.time[i - 1];
    if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_SAMPLE_GAP) continue;
    const v = track.speed[i];
    const moving = Number.isFinite(v)
      ? v >= MOVING_SPEED
      : track.dist[i] - track.dist[i - 1] > MOVING_SPEED;
    if (moving) movingTime += dt;
  }

  const elevation = smooth(track.ele, samplesPerWindow(track.time, ELEVATION_SMOOTHING_SECONDS));
  let ascent = 0;
  let descent = 0;
  let reference = NaN;
  for (let i = 0; i < n; i++) {
    const ele = elevation[i];
    if (!Number.isFinite(ele)) continue;
    if (Number.isNaN(reference)) {
      reference = ele;
    } else if (ele > reference + ELEVATION_HYSTERESIS) {
      ascent += ele - reference;
      reference = ele;
    } else if (ele < reference - ELEVATION_HYSTERESIS) {
      descent += reference - ele;
      reference = ele;
    }
  }

  /** @type {Record<string, {avg: number, max: number}>} */
  const channels = {};
  for (const key of CHANNEL_KEYS) channels[key] = aggregate(track[key], track.time);

  return {
    elapsedTime: Number.isFinite(t1 - t0) ? t1 - t0 : NaN,
    movingTime,
    distance: track.dist[n - 1],
    ascent,
    descent,
    samples: n,
    start: Number.isFinite(t0) ? new Date(t0 * 1000) : null,
    channels: /** @type {import('./model.js').Stats['channels']} */ (channels),
  };
}

/**
 * Time-weighted average and maximum of one channel. Weighting by the sample
 * interval keeps smart-recording files comparable with 1 Hz files.
 *
 * @param {Float64Array} values
 * @param {Float64Array} time
 * @returns {{avg: number, max: number}}
 */
function aggregate(values, time) {
  let weighted = 0;
  let weight = 0;
  let plain = 0;
  let count = 0;
  let max = -Infinity;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v > max) max = v;
    plain += v;
    count += 1;

    const dt = i > 0 ? time[i] - time[i - 1] : NaN;
    if (Number.isFinite(dt) && dt > 0 && dt <= MAX_SAMPLE_GAP) {
      weighted += v * dt;
      weight += dt;
    }
  }

  if (count === 0) return { avg: NaN, max: NaN };
  return { avg: weight > 0 ? weighted / weight : plain / count, max };
}

/**
 * How many samples cover `seconds`, from the file's median sample interval.
 *
 * @param {Float64Array} time
 * @param {number} seconds
 * @returns {number}
 */
function samplesPerWindow(time, seconds) {
  const intervals = [];
  const stride = Math.max(1, Math.floor(time.length / 500));
  for (let i = stride; i < time.length; i += stride) {
    const dt = (time[i] - time[i - stride]) / stride;
    if (Number.isFinite(dt) && dt > 0) intervals.push(dt);
  }
  if (intervals.length === 0) return 4;
  intervals.sort((a, b) => a - b);
  const median = intervals[intervals.length >> 1];
  return Math.min(30, Math.max(1, Math.round(seconds / median)));
}

/**
 * Centred moving average ignoring NaN, via prefix sums so the window width
 * costs nothing.
 *
 * @param {Float64Array} values
 * @param {number} half  Window half-width in samples.
 * @returns {Float64Array}
 */
function smooth(values, half) {
  const n = values.length;
  const sums = new Float64Array(n + 1);
  const counts = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const valid = Number.isFinite(v);
    sums[i + 1] = sums[i] + (valid ? v : 0);
    counts[i + 1] = counts[i] + (valid ? 1 : 0);
  }

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(n, i + half + 1);
    const count = counts[to] - counts[from];
    out[i] = count > 0 ? (sums[to] - sums[from]) / count : NaN;
  }
  return out;
}

/** @param {Float64Array} values */
function hasData(values) {
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) return true;
  }
  return false;
}

/**
 * Great-circle distance in metres.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** @param {string} text */
function titleCase(text) {
  const clean = text.replace(/[_-]+/g, ' ').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
