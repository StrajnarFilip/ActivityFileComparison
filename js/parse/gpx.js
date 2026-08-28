/**
 * Parser for GPX 1.1 track files, including the Garmin `TrackPointExtension`
 * and the various power extensions exporters have settled on.
 *
 * Element names are matched on their local name, so any namespace prefix
 * (`gpxtpx:`, `ns3:`, `gpxpx:`, none at all) is accepted.
 */

import { parseXml, textNumber, parseTime } from './xml.js';

/**
 * @param {string} text
 * @returns {import('../model.js').ParseResult}
 */
export function parseGpx(text) {
  const doc = parseXml(text, 'GPX');

  /** @type {import('../model.js').RawSample[]} */
  const samples = [];

  let points = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => local(el) === 'trkpt',
  );
  if (points.length === 0) {
    // Some tools export a plain route rather than a track.
    points = Array.from(doc.getElementsByTagName('*')).filter((el) => local(el) === 'rtept');
  }

  for (const point of points) {
    /** @type {import('../model.js').RawSample} */
    const sample = {
      lat: attrNumber(point, 'lat'),
      lon: attrNumber(point, 'lon'),
    };

    for (const el of point.getElementsByTagName('*')) {
      switch (local(el)) {
        case 'ele':
          sample.ele = textNumber(el);
          break;
        case 'time':
          sample.time = parseTime(el.textContent);
          break;
        case 'hr':
        case 'heartrate':
          sample.hr = textNumber(el);
          break;
        case 'cad':
        case 'cadence':
          sample.cad = textNumber(el);
          break;
        case 'atemp':
        case 'temp':
        case 'temperature':
          sample.temp = textNumber(el);
          break;
        case 'speed':
          sample.speed = textNumber(el);
          break;
        case 'power':
        case 'powerinwatts':
        case 'watts':
          sample.power = textNumber(el);
          break;
        case 'distance':
          sample.dist = textNumber(el);
          break;
        default:
          break;
      }
    }

    samples.push(sample);
  }

  return {
    samples,
    sport: firstText(doc, 'type'),
    device: doc.documentElement.getAttribute('creator') ?? undefined,
  };
}

/** @param {Element} el */
function local(el) {
  return (el.localName || el.nodeName).toLowerCase();
}

/** @param {Element} el @param {string} name */
function attrNumber(el, name) {
  const raw = el.getAttribute(name);
  if (raw === null) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** First non-empty text content of an element with the given local name. */
function firstText(/** @type {Document} */ doc, /** @type {string} */ name) {
  for (const el of doc.getElementsByTagName('*')) {
    if (local(el) === name) {
      const text = (el.textContent ?? '').trim();
      if (text) return text;
    }
  }
  return undefined;
}
