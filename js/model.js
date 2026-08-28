/**
 * Domain model shared by the parsers, the charts and the map.
 *
 * Everything downstream of the parsers works on {@link Track}: a column-wise
 * ("struct of arrays") view of one file. Every array has the same length and
 * index `i` refers to the same recorded sample in all of them. Missing values
 * are `NaN` rather than `null` so the columns stay packed typed arrays.
 */

/**
 * @typedef {Object} Track
 * @property {Float64Array} time     Unix time in seconds.
 * @property {Float64Array} elapsed  Seconds since the first sample of this file.
 * @property {Float64Array} dist     Cumulative distance in metres (monotonic).
 * @property {Float64Array} lat      Latitude in degrees, NaN where there is no fix.
 * @property {Float64Array} lon      Longitude in degrees.
 * @property {Float64Array} ele      Elevation in metres.
 * @property {Float64Array} hr       Heart rate in beats per minute.
 * @property {Float64Array} cad      Cadence in revolutions (or steps) per minute.
 * @property {Float64Array} power    Power in watts.
 * @property {Float64Array} speed    Speed in metres per second.
 * @property {Float64Array} temp     Temperature in degrees Celsius.
 */

/**
 * A sample as it comes out of a parser, before it is packed into a {@link Track}.
 * Absent values may be `undefined`, `null` or `NaN`.
 *
 * @typedef {Object} RawSample
 * @property {number} [time]   Unix seconds.
 * @property {number} [lat]
 * @property {number} [lon]
 * @property {number} [ele]    Metres.
 * @property {number} [hr]     bpm.
 * @property {number} [cad]    rpm.
 * @property {number} [power]  Watts.
 * @property {number} [speed]  Metres per second.
 * @property {number} [dist]   Cumulative metres, as recorded by the device.
 * @property {number} [temp]   Degrees Celsius.
 */

/**
 * What a parser returns. `buildActivity` turns this into an {@link Activity}.
 *
 * @typedef {Object} ParseResult
 * @property {RawSample[]} samples
 * @property {string} [sport]
 * @property {string} [device]
 */

/** @typedef {'power'|'hr'|'cad'|'speed'|'ele'|'temp'} ChannelKey */
/** @typedef {'elapsed'|'clock'|'dist'} XMode */
/** @typedef {'metric'|'imperial'} UnitSystem */

/**
 * A quantity that gets its own chart.
 *
 * @typedef {Object} Channel
 * @property {ChannelKey} key
 * @property {string} label
 * @property {(v: number, units: UnitSystem) => number} toDisplay  SI value -> displayed value.
 * @property {(units: UnitSystem) => string} unit
 * @property {number} decimals    Decimals to show in legends and tables.
 * @property {boolean} [zeroBased] Start the y axis at 0 rather than at the data minimum.
 */

/**
 * Per-file summary shown in the comparison table.
 *
 * @typedef {Object} Stats
 * @property {number} elapsedTime   Seconds from first to last sample.
 * @property {number} movingTime    Seconds excluding stops, in seconds.
 * @property {number} distance      Metres.
 * @property {number} ascent        Metres climbed.
 * @property {number} descent       Metres descended.
 * @property {number} samples
 * @property {Date|null} start
 * @property {Record<ChannelKey, {avg: number, max: number}>} channels
 */

/**
 * One loaded file plus everything the UI needs to draw it.
 *
 * @typedef {Object} Activity
 * @property {string} id
 * @property {string} name        File name as dropped by the user.
 * @property {'FIT'|'GPX'|'TCX'} format
 * @property {string} sport
 * @property {string} device
 * @property {string} color       CSS hex colour, shared by charts, map and table.
 * @property {boolean} visible
 * @property {Track} track
 * @property {Record<ChannelKey, boolean>} has  Which channels actually carry data.
 * @property {boolean} hasGps
 * @property {[number, number][]} latlngs       Positions for Leaflet, gaps removed.
 * @property {Stats} stats
 */

const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;

/** @type {readonly Channel[]} */
export const CHANNELS = Object.freeze([
  {
    key: 'power',
    label: 'Power',
    toDisplay: (v) => v,
    unit: () => 'W',
    decimals: 0,
    zeroBased: true,
  },
  {
    key: 'hr',
    label: 'Heart rate',
    toDisplay: (v) => v,
    unit: () => 'bpm',
    decimals: 0,
  },
  {
    key: 'cad',
    label: 'Cadence',
    toDisplay: (v) => v,
    unit: () => 'rpm',
    decimals: 0,
    zeroBased: true,
  },
  {
    key: 'speed',
    label: 'Speed',
    toDisplay: (v, u) => (u === 'imperial' ? (v * 3600) / M_PER_MI : v * 3.6),
    unit: (u) => (u === 'imperial' ? 'mph' : 'km/h'),
    decimals: 1,
    zeroBased: true,
  },
  {
    key: 'ele',
    label: 'Elevation',
    toDisplay: (v, u) => (u === 'imperial' ? v / M_PER_FT : v),
    unit: (u) => (u === 'imperial' ? 'ft' : 'm'),
    decimals: 0,
  },
  {
    key: 'temp',
    label: 'Temperature',
    toDisplay: (v, u) => (u === 'imperial' ? (v * 9) / 5 + 32 : v),
    unit: (u) => (u === 'imperial' ? '°F' : '°C'),
    decimals: 1,
  },
]);

/** @type {ChannelKey[]} */
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key);

/**
 * @param {ChannelKey} key
 * @returns {Channel}
 */
export function channel(key) {
  const found = CHANNELS.find((c) => c.key === key);
  if (!found) throw new Error(`unknown channel: ${key}`);
  return found;
}

/** Distance, metres -> display value. @param {number} m @param {UnitSystem} u */
export function distanceToDisplay(m, u) {
  return u === 'imperial' ? m / M_PER_MI : m / 1000;
}

/** @param {UnitSystem} u */
export function distanceUnit(u) {
  return u === 'imperial' ? 'mi' : 'km';
}

/** Elevation, metres -> display value. @param {number} m @param {UnitSystem} u */
export function elevationToDisplay(m, u) {
  return u === 'imperial' ? m / M_PER_FT : m;
}

/** @param {UnitSystem} u */
export function elevationUnit(u) {
  return u === 'imperial' ? 'ft' : 'm';
}
