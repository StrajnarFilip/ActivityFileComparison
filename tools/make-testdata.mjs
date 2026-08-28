/**
 * Generates the sample files in `testdata/`: one simulated ride recorded by
 * three "devices" that disagree slightly, written out as FIT, TCX and GPX.
 *
 * The FIT writer here is deliberately independent of the reader in
 * `js/parse/fit.js` — it encodes straight from the FIT protocol description —
 * so round-tripping these files actually exercises the decoder.
 *
 *   node tools/make-testdata.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'testdata');

const START = Date.UTC(2026, 3, 18, 7, 30, 0) / 1000; // 2026-04-18 07:30 UTC
const DURATION = 1800; // seconds
const CENTRE = { lat: 46.0569, lon: 14.5058 }; // Ljubljana
const RADIUS_LAT = 0.011;
const RADIUS_LON = 0.017;
const STOP_FROM = 900;
const STOP_TO = 960;

/** Where the loop passes at a given angle. */
function pointAt(angle) {
  return {
    lat: CENTRE.lat + RADIUS_LAT * Math.sin(angle),
    lon: CENTRE.lon + RADIUS_LON * Math.cos(angle),
  };
}

function metresBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Length of one lap, measured along the actual ellipse. Using the real
 * circumference keeps the distance the devices "record" consistent with the
 * distance you get by measuring the GPS trace.
 */
const LAP_LENGTH = (() => {
  const steps = 20000;
  let total = 0;
  let previous = pointAt(0);
  for (let i = 1; i <= steps; i++) {
    const next = pointAt((i / steps) * 2 * Math.PI);
    total += metresBetween(previous, next);
    previous = next;
  }
  return total;
})();

/** Deterministic noise so regenerating the files produces no diff. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The "true" ride, sampled once per second. Every device derives its own view
 * of this.
 */
function simulate() {
  const noise = rng(20260418);
  const samples = [];
  let distance = 0;

  for (let t = 0; t <= DURATION; t++) {
    const stopped = t >= STOP_FROM && t < STOP_TO;
    const speed = stopped
      ? 0
      : Math.max(0, 7.4 + 2.1 * Math.sin(t / 97) + 1.3 * Math.sin(t / 31) + 0.3 * (noise() - 0.5));
    distance += speed;

    const angle = (distance / LAP_LENGTH) * 2 * Math.PI;
    const grade = Math.cos(angle) * 0.03;
    const { lat, lon } = pointAt(angle);

    samples.push({
      t,
      time: START + t,
      lat,
      lon,
      ele: 295 + 42 * Math.sin(angle) + 11 * Math.sin(2 * angle),
      dist: distance,
      speed,
      power: stopped
        ? 0
        : Math.max(0, 195 + 1800 * grade + 55 * Math.sin(t / 61) + 18 * (noise() - 0.5)),
      hr: 128 + 26 * Math.sin(t / 190 - 0.7) + 6 * Math.sin(t / 43) - (stopped ? 12 : 0),
      cad: stopped ? 0 : 86 + 7 * Math.sin(t / 53) + 2 * (noise() - 0.5),
      temp: 17.5 + 2.5 * Math.sin(t / 420),
    });
  }

  return samples;
}

/* ------------------------------------------------------------------ FIT --- */

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800,
  0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc & 0xffff;
}

const ENUM = 0x00;
const SINT8 = 0x01;
const UINT8 = 0x02;
const UINT16 = 0x84;
const SINT32 = 0x85;
const UINT32 = 0x86;
const STRING = 0x07;
const BYTE = 0x0d;

const SIZES = { [ENUM]: 1, [SINT8]: 1, [UINT8]: 1, [UINT16]: 2, [SINT32]: 4, [UINT32]: 4 };

class FitWriter {
  constructor() {
    this.bytes = [];
  }

  u8(v) {
    this.bytes.push(v & 0xff);
  }

  u16(v) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff);
  }

  u32(v) {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }

  /** @param {{num: number, type: number, size?: number}[]} fields */
  definition(local, globalNum, fields, devFields = []) {
    this.u8(0x40 | local | (devFields.length ? 0x20 : 0));
    this.u8(0); // reserved
    this.u8(0); // architecture: little endian
    this.u16(globalNum);
    this.u8(fields.length);
    for (const f of fields) {
      this.u8(f.num);
      this.u8(f.size ?? SIZES[f.type]);
      this.u8(f.type);
    }
    if (devFields.length) {
      this.u8(devFields.length);
      for (const f of devFields) {
        this.u8(f.num);
        this.u8(f.size);
        this.u8(f.devIndex);
      }
    }
  }

  /** @param {{num: number, type: number, size?: number}[]} fields */
  data(local, fields, values, header) {
    this.u8(header ?? local);
    fields.forEach((field, i) => this.write(field, values[i]));
  }

  write(field, value) {
    const size = field.size ?? SIZES[field.type];
    switch (field.type) {
      case ENUM:
      case UINT8:
        this.u8(value);
        break;
      case SINT8:
        this.u8(value < 0 ? value + 256 : value);
        break;
      case UINT16:
        this.u16(value);
        break;
      case UINT32:
      case SINT32:
        this.u32(value);
        break;
      case STRING: {
        const encoded = Buffer.from(String(value), 'utf8');
        for (let i = 0; i < size; i++) this.u8(i < encoded.length ? encoded[i] : 0);
        break;
      }
      case BYTE:
        for (let i = 0; i < size; i++) this.u8(Array.isArray(value) ? (value[i] ?? 0xff) : 0xff);
        break;
      default:
        throw new Error(`unhandled base type 0x${field.type.toString(16)}`);
    }
  }
}

const FIT_EPOCH = 631065600;
const semicircles = (deg) => Math.round((deg * 2 ** 31) / 180);

function writeFit(samples, { device, product, tweak }) {
  const w = new FitWriter();

  const fileId = [
    { num: 0, type: ENUM }, // type: 4 = activity
    { num: 1, type: UINT16 }, // manufacturer: 1 = Garmin
    { num: 2, type: UINT16 }, // product
    { num: 4, type: UINT32 }, // time_created
  ];
  w.definition(0, 0, fileId);
  w.data(0, fileId, [4, 1, product, samples[0].time - FIT_EPOCH]);

  const devId = [
    { num: 1, type: BYTE, size: 16 }, // application_id
    { num: 3, type: UINT8 }, // developer_data_index
  ];
  w.definition(0, 207, devId);
  w.data(0, devId, [null, 0]);

  const fieldDesc = [
    { num: 0, type: UINT8 }, // developer_data_index
    { num: 1, type: UINT8 }, // field_definition_number
    { num: 2, type: UINT8 }, // fit_base_type_id
    { num: 3, type: STRING, size: 12 }, // field_name
    { num: 8, type: STRING, size: 8 }, // units
  ];
  w.definition(0, 206, fieldDesc);
  w.data(0, fieldDesc, [0, 0, UINT16, 'Form Power', 'W']);

  const deviceInfo = [
    { num: 253, type: UINT32 },
    { num: 0, type: UINT8 },
    { num: 2, type: UINT16 },
    { num: 27, type: STRING, size: device.length + 1 },
  ];
  w.definition(0, 23, deviceInfo);
  w.data(0, deviceInfo, [samples[0].time - FIT_EPOCH, 0, 1, device]);

  const sport = [
    { num: 0, type: ENUM },
    { num: 1, type: ENUM },
  ];
  w.definition(0, 12, sport);
  w.data(0, sport, [2, 0]); // cycling

  // Two record layouts: the first carries its own timestamp, the second relies
  // on the compressed-timestamp record header.
  const recordFields = [
    { num: 253, type: UINT32 },
    { num: 0, type: SINT32 },
    { num: 1, type: SINT32 },
    { num: 2, type: UINT16 },
    { num: 3, type: UINT8 },
    { num: 4, type: UINT8 },
    { num: 5, type: UINT32 },
    { num: 6, type: UINT16 },
    { num: 7, type: UINT16 },
    { num: 13, type: SINT8 },
  ];
  const devFields = [{ num: 0, size: 2, devIndex: 0 }];
  const compressedFields = recordFields.slice(1);

  w.definition(0, 20, recordFields, devFields);
  w.definition(1, 20, compressedFields, devFields);

  const half = Math.floor(samples.length / 2);
  let lastTimestamp = 0;

  samples.forEach((s, i) => {
    const v = tweak(s);
    const timestamp = Math.round(s.time) - FIT_EPOCH;
    const body = [
      semicircles(v.lat),
      semicircles(v.lon),
      Math.round((v.ele + 500) * 5),
      Math.round(v.hr),
      Math.round(v.cad),
      Math.round(v.dist * 100),
      Math.round(v.speed * 1000),
      Math.round(v.power),
      Math.round(v.temp),
    ];

    if (i < half) {
      w.data(0, recordFields, [timestamp, ...body]);
      lastTimestamp = timestamp;
    } else {
      // Compressed header: bit 7 set, 2 bits of local type, 5 bits of offset.
      const offset = timestamp & 0x1f;
      w.data(1, compressedFields, body, 0x80 | (1 << 5) | offset);
      lastTimestamp = timestamp;
    }
    w.u16(Math.round(40 + 20 * Math.sin(i / 70))); // developer field
  });

  void lastTimestamp;

  const data = w.bytes;
  const header = [14, 0x20, 0x5c, 0x08];
  header.push(data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, (data.length >>> 24) & 0xff);
  header.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
  const headerCrc = crc16(header.slice(0, 12));
  header.push(headerCrc & 0xff, (headerCrc >> 8) & 0xff);

  const all = [...header, ...data];
  const fileCrc = crc16(all);
  all.push(fileCrc & 0xff, (fileCrc >> 8) & 0xff);

  return Buffer.from(all);
}

/* ------------------------------------------------------------------ TCX --- */

const iso = (unix) => new Date(Math.round(unix) * 1000).toISOString().replace('.000Z', 'Z');

function writeTcx(samples, { device, tweak, every }) {
  const points = samples
    .filter((_, i) => i % every === 0)
    .map((s) => {
      const v = tweak(s);
      return `        <Trackpoint>
          <Time>${iso(v.time)}</Time>
          <Position>
            <LatitudeDegrees>${v.lat.toFixed(7)}</LatitudeDegrees>
            <LongitudeDegrees>${v.lon.toFixed(7)}</LongitudeDegrees>
          </Position>
          <AltitudeMeters>${v.ele.toFixed(1)}</AltitudeMeters>
          <DistanceMeters>${v.dist.toFixed(2)}</DistanceMeters>
          <HeartRateBpm><Value>${Math.round(v.hr)}</Value></HeartRateBpm>
          <Cadence>${Math.round(v.cad)}</Cadence>
          <Extensions>
            <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
              <Speed>${v.speed.toFixed(3)}</Speed>
              <Watts>${Math.round(v.power)}</Watts>
            </TPX>
          </Extensions>
        </Trackpoint>`;
    });

  const first = tweak(samples[0]);
  const last = tweak(samples[samples.length - 1]);

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${iso(first.time)}</Id>
      <Lap StartTime="${iso(first.time)}">
        <TotalTimeSeconds>${(last.time - first.time).toFixed(0)}</TotalTimeSeconds>
        <DistanceMeters>${last.dist.toFixed(1)}</DistanceMeters>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${points.join('\n')}
        </Track>
      </Lap>
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <Name>${device}</Name>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

/* ------------------------------------------------------------------ GPX --- */

function writeGpx(samples, { device, tweak, every }) {
  const points = samples
    .filter((_, i) => i % every === 0)
    .map((s) => {
      const v = tweak(s);
      return `      <trkpt lat="${v.lat.toFixed(7)}" lon="${v.lon.toFixed(7)}">
        <ele>${v.ele.toFixed(1)}</ele>
        <time>${iso(v.time)}</time>
        <extensions>
          <power>${Math.round(v.power)}</power>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>${Math.round(v.hr)}</gpxtpx:hr>
            <gpxtpx:cad>${Math.round(v.cad)}</gpxtpx:cad>
            <gpxtpx:atemp>${v.temp.toFixed(1)}</gpxtpx:atemp>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>`;
    });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${device}"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Ljubljana loop</name>
    <type>cycling</type>
    <trkseg>
${points.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
}

/* ----------------------------------------------------------------- main --- */

const samples = simulate();
mkdirSync(OUT, { recursive: true });

// Head unit: the reference recording.
writeFileSync(
  join(OUT, 'ride-headunit.fit'),
  writeFit(samples, { device: 'Edge 830', product: 3122, tweak: (s) => s }),
);

// Watch: reads a little high on power and heart rate, barometer sits higher.
const watchNoise = rng(7);
writeFileSync(
  join(OUT, 'ride-watch.tcx'),
  writeTcx(samples, {
    device: 'Forerunner 955',
    every: 1,
    tweak: (s) => ({
      ...s,
      power: s.power * 0.965 + 6 + 4 * (watchNoise() - 0.5),
      hr: s.hr + 3.5,
      ele: s.ele + 6.2,
    }),
  }),
);

// Phone: smart recording every four seconds, GPS elevation, no barometer.
const phoneNoise = rng(11);
writeFileSync(
  join(OUT, 'ride-phone.gpx'),
  writeGpx(samples, {
    device: 'Ride Tracker for Android',
    every: 4,
    tweak: (s) => ({
      ...s,
      power: s.power * 1.02,
      hr: s.hr - 2,
      ele: s.ele + 9 * (phoneNoise() - 0.5),
      lat: s.lat + 0.00004 * (phoneNoise() - 0.5),
      lon: s.lon + 0.00004 * (phoneNoise() - 0.5),
    }),
  }),
);

console.log('wrote testdata/ride-headunit.fit, ride-watch.tcx, ride-phone.gpx');
