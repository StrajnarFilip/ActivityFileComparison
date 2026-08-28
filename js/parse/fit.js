/**
 * Decoder for Garmin FIT activity files (protocol 1.0 / 2.0).
 *
 * Implements the parts of the FIT binary protocol an activity file actually
 * uses: the file header, definition messages, normal and compressed-timestamp
 * data messages, developer fields (skipped, but consumed so the stream stays
 * aligned) and chained files. Only the messages this app charts are decoded
 * into names; everything else is read and discarded.
 */

/** Seconds between the unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH = 631065600;

/** Semicircles -> degrees. */
const SEMICIRCLE = 180 / 2 ** 31;

/**
 * @typedef {Object} BaseType
 * @property {number} size    Bytes per element.
 * @property {(dv: DataView, off: number, le: boolean) => number} read
 * @property {number} [invalid]
 */

/** Indexed by the low 5 bits of the base-type byte. @type {BaseType[]} */
const BASE_TYPES = [
  { size: 1, read: (dv, o) => dv.getUint8(o), invalid: 0xff }, // 0 enum
  { size: 1, read: (dv, o) => dv.getInt8(o), invalid: 0x7f }, // 1 sint8
  { size: 1, read: (dv, o) => dv.getUint8(o), invalid: 0xff }, // 2 uint8
  { size: 2, read: (dv, o, le) => dv.getInt16(o, le), invalid: 0x7fff }, // 3 sint16
  { size: 2, read: (dv, o, le) => dv.getUint16(o, le), invalid: 0xffff }, // 4 uint16
  { size: 4, read: (dv, o, le) => dv.getInt32(o, le), invalid: 0x7fffffff }, // 5 sint32
  { size: 4, read: (dv, o, le) => dv.getUint32(o, le), invalid: 0xffffffff }, // 6 uint32
  { size: 1, read: (dv, o) => dv.getUint8(o) }, // 7 string (handled separately)
  { size: 4, read: (dv, o, le) => dv.getFloat32(o, le) }, // 8 float32 (invalid = NaN)
  { size: 8, read: (dv, o, le) => dv.getFloat64(o, le) }, // 9 float64 (invalid = NaN)
  { size: 1, read: (dv, o) => dv.getUint8(o), invalid: 0 }, // 10 uint8z
  { size: 2, read: (dv, o, le) => dv.getUint16(o, le), invalid: 0 }, // 11 uint16z
  { size: 4, read: (dv, o, le) => dv.getUint32(o, le), invalid: 0 }, // 12 uint32z
  { size: 1, read: (dv, o) => dv.getUint8(o), invalid: 0xff }, // 13 byte
  { size: 8, read: (dv, o, le) => Number(dv.getBigInt64(o, le)), invalid: 0x7fffffffffffffff }, // 14 sint64
  { size: 8, read: (dv, o, le) => Number(dv.getBigUint64(o, le)), invalid: 0xffffffffffffffff }, // 15 uint64
  { size: 8, read: (dv, o, le) => Number(dv.getBigUint64(o, le)), invalid: 0 }, // 16 uint64z
];

/**
 * @typedef {Object} FieldDef
 * @property {string} name
 * @property {number} [scale]   Raw value is divided by this.
 * @property {number} [offset]  Subtracted after scaling.
 */

/**
 * The subset of the FIT profile this app needs, as
 * `globalMessageNumber -> fieldDefinitionNumber -> field`.
 *
 * @type {Record<number, Record<number, FieldDef>>}
 */
const PROFILE = {
  // file_id
  0: {
    0: { name: 'type' },
    1: { name: 'manufacturer' },
    2: { name: 'product' },
    4: { name: 'time_created' },
  },
  // sport
  12: { 0: { name: 'sport' }, 1: { name: 'sub_sport' }, 3: { name: 'name' } },
  // session
  18: {
    5: { name: 'sport' },
    6: { name: 'sub_sport' },
    7: { name: 'total_elapsed_time', scale: 1000 },
    8: { name: 'total_timer_time', scale: 1000 },
    9: { name: 'total_distance', scale: 100 },
  },
  // record
  20: {
    253: { name: 'timestamp' },
    0: { name: 'position_lat' },
    1: { name: 'position_long' },
    2: { name: 'altitude', scale: 5, offset: 500 },
    3: { name: 'heart_rate' },
    4: { name: 'cadence' },
    5: { name: 'distance', scale: 100 },
    6: { name: 'speed', scale: 1000 },
    7: { name: 'power' },
    13: { name: 'temperature' },
    53: { name: 'fractional_cadence', scale: 128 },
    73: { name: 'enhanced_speed', scale: 1000 },
    78: { name: 'enhanced_altitude', scale: 5, offset: 500 },
  },
  // device_info
  23: {
    0: { name: 'device_index' },
    2: { name: 'manufacturer' },
    4: { name: 'product' },
    5: { name: 'software_version', scale: 100 },
    27: { name: 'product_name' },
  },
};

/** Manufacturer ids that are safe to name. @type {Record<number, string>} */
const MANUFACTURERS = {
  1: 'Garmin',
  6: 'SRM',
  7: 'Quarq',
  15: 'Dynastream',
  16: 'Timex',
  23: 'Suunto',
  32: 'Wahoo Fitness',
  40: 'Concept2',
  41: 'Shimano',
  76: 'Moxy',
  89: 'Tacx',
  260: 'Zwift',
};

/** @type {Record<number, string>} */
const SPORTS = {
  0: 'Generic',
  1: 'Running',
  2: 'Cycling',
  3: 'Transition',
  4: 'Fitness equipment',
  5: 'Swimming',
  6: 'Basketball',
  7: 'Soccer',
  8: 'Tennis',
  9: 'American football',
  10: 'Training',
  11: 'Walking',
  12: 'Cross-country skiing',
  13: 'Alpine skiing',
  14: 'Snowboarding',
  15: 'Rowing',
  16: 'Mountaineering',
  17: 'Hiking',
  18: 'Multisport',
  19: 'Paddling',
  20: 'Flying',
  21: 'E-biking',
};

/**
 * A definition message: the layout of every data message that follows on the
 * same local message type.
 *
 * @typedef {Object} MessageDef
 * @property {number} globalNum
 * @property {boolean} le             Little-endian payload.
 * @property {{num: number, size: number, base: number}[]} fields
 * @property {number} devSize         Total bytes of developer fields to skip.
 */

/**
 * Read one field value. Returns `undefined` for the type's invalid value.
 *
 * @param {DataView} dv
 * @param {number} off
 * @param {number} size   Bytes reserved for this field (may hold an array).
 * @param {number} baseNum
 * @param {boolean} le
 * @returns {number|string|undefined}
 */
function readField(dv, off, size, baseNum, le) {
  if (baseNum === 7) {
    // Null-terminated UTF-8; a field may hold several strings, take the first.
    const bytes = [];
    for (let i = 0; i < size; i++) {
      const b = dv.getUint8(off + i);
      if (b === 0) break;
      bytes.push(b);
    }
    if (bytes.length === 0) return undefined;
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  const type = BASE_TYPES[baseNum];
  if (!type) return undefined;

  // Arrays are declared by reserving a multiple of the element size. None of
  // the fields we chart are arrays, so the first element is enough.
  const value = type.read(dv, off, le);
  if (Number.isNaN(value)) return undefined;
  if (type.invalid !== undefined && value === type.invalid) return undefined;
  return value;
}

/**
 * Decode the messages of one FIT file segment into named records.
 *
 * @param {DataView} dv
 * @param {number} start   First byte of the data records.
 * @param {number} end     One past the last byte of the data records.
 * @param {(globalNum: number, values: Record<string, number|string>) => void} emit
 */
function readMessages(dv, start, end, emit) {
  /** @type {Map<number, MessageDef>} */
  const defs = new Map();
  let lastTimestamp = 0;
  let p = start;

  while (p < end) {
    const header = dv.getUint8(p);
    p += 1;

    let localNum;
    /** @type {number|undefined} */
    let compressedTime;

    if (header & 0x80) {
      // Compressed timestamp header: 2 bits of local type, 5 bits of time offset.
      localNum = (header >> 5) & 0x03;
      const offset = header & 0x1f;
      const rolled = offset < (lastTimestamp & 0x1f) ? 0x20 : 0;
      lastTimestamp = (lastTimestamp & ~0x1f) + offset + rolled;
      compressedTime = lastTimestamp;
    } else {
      localNum = header & 0x0f;

      if (header & 0x40) {
        // Definition message.
        p += 1; // reserved
        const le = dv.getUint8(p) === 0;
        p += 1;
        const globalNum = dv.getUint16(p, le);
        p += 2;
        const fieldCount = dv.getUint8(p);
        p += 1;

        /** @type {{num: number, size: number, base: number}[]} */
        const fields = [];
        for (let i = 0; i < fieldCount; i++) {
          fields.push({
            num: dv.getUint8(p),
            size: dv.getUint8(p + 1),
            base: dv.getUint8(p + 2) & 0x1f,
          });
          p += 3;
        }

        let devSize = 0;
        if (header & 0x20) {
          const devCount = dv.getUint8(p);
          p += 1;
          for (let i = 0; i < devCount; i++) {
            devSize += dv.getUint8(p + 1);
            p += 3;
          }
        }

        defs.set(localNum, { globalNum, le, fields, devSize });
        continue;
      }
    }

    const def = defs.get(localNum);
    if (!def) {
      // A data message with no preceding definition: the stream is desynced and
      // there is no way to know how many bytes to skip.
      throw new Error(`FIT data message for undefined local type ${localNum}`);
    }

    const profile = PROFILE[def.globalNum];
    /** @type {Record<string, number|string>} */
    const values = {};

    for (const field of def.fields) {
      if (profile && p + field.size <= end) {
        const spec = profile[field.num];
        if (spec) {
          const raw = readField(dv, p, field.size, field.base, def.le);
          if (raw !== undefined) {
            values[spec.name] =
              typeof raw === 'number' && (spec.scale || spec.offset)
                ? raw / (spec.scale ?? 1) - (spec.offset ?? 0)
                : raw;
          }
        }
      }
      p += field.size;
    }
    p += def.devSize;

    if (compressedTime !== undefined) {
      values.timestamp = compressedTime;
    } else if (typeof values.timestamp === 'number') {
      lastTimestamp = values.timestamp;
    }

    if (profile) emit(def.globalNum, values);
  }
}

/**
 * Parse a FIT file.
 *
 * @param {ArrayBuffer} buffer
 * @returns {import('../model.js').ParseResult}
 */
export function parseFit(buffer) {
  const dv = new DataView(buffer);
  /** @type {import('../model.js').RawSample[]} */
  const samples = [];
  /** @type {string|undefined} */
  let sport;
  /** @type {string|undefined} */
  let device;
  /** @type {number|undefined} */
  let manufacturerId;

  /** @type {(globalNum: number, v: Record<string, number|string>) => void} */
  const emit = (globalNum, v) => {
    if (globalNum === 20) {
      if (typeof v.timestamp !== 'number') return;
      const cadence = typeof v.cadence === 'number' ? v.cadence : undefined;
      const fractional = typeof v.fractional_cadence === 'number' ? v.fractional_cadence : 0;
      samples.push({
        time: v.timestamp + FIT_EPOCH,
        lat: typeof v.position_lat === 'number' ? v.position_lat * SEMICIRCLE : undefined,
        lon: typeof v.position_long === 'number' ? v.position_long * SEMICIRCLE : undefined,
        ele: num(v.enhanced_altitude ?? v.altitude),
        hr: num(v.heart_rate),
        cad: cadence === undefined ? undefined : cadence + fractional,
        power: num(v.power),
        speed: num(v.enhanced_speed ?? v.speed),
        dist: num(v.distance),
        temp: num(v.temperature),
      });
      return;
    }

    if ((globalNum === 18 || globalNum === 12) && typeof v.sport === 'number') {
      sport = sport ?? SPORTS[v.sport] ?? `Sport ${v.sport}`;
      return;
    }

    if (globalNum === 0 || globalNum === 23) {
      // device_info repeats for every sensor; the first product name wins, and
      // only the file_id / device 0 manufacturer is used as a fallback.
      if (device === undefined && typeof v.product_name === 'string') device = v.product_name;
      if (manufacturerId === undefined && typeof v.manufacturer === 'number') {
        manufacturerId = v.manufacturer;
      }
    }
  };

  let pos = 0;
  let segments = 0;
  while (pos + 12 <= dv.byteLength) {
    const headerSize = dv.getUint8(pos);
    if (headerSize < 12 || pos + headerSize > dv.byteLength) break;
    const magic = String.fromCharCode(
      dv.getUint8(pos + 8),
      dv.getUint8(pos + 9),
      dv.getUint8(pos + 10),
      dv.getUint8(pos + 11),
    );
    if (magic !== '.FIT') {
      if (segments === 0) throw new Error('not a FIT file (missing .FIT signature)');
      break;
    }

    const dataSize = dv.getUint32(pos + 4, true);
    const dataStart = pos + headerSize;
    const dataEnd = Math.min(dataStart + dataSize, dv.byteLength);
    readMessages(dv, dataStart, dataEnd, emit);

    segments += 1;
    pos = dataEnd + 2; // skip the trailing CRC
  }

  if (segments === 0) throw new Error('not a FIT file (missing .FIT signature)');
  if (device === undefined && manufacturerId !== undefined) {
    device = MANUFACTURERS[manufacturerId] ?? `Manufacturer ${manufacturerId}`;
  }

  return { samples, sport, device };
}

/** @param {number|string|undefined} v @returns {number|undefined} */
function num(v) {
  return typeof v === 'number' ? v : undefined;
}
