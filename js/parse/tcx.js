/**
 * Parser for Garmin TCX (Training Center Database) files.
 *
 * Reads every `Trackpoint` of every `Lap`, including the `TPX` activity
 * extension that carries speed, power and running cadence.
 */

import { parseXml, textNumber, parseTime } from './xml.js';

/**
 * @param {string} text
 * @returns {import('../model.js').ParseResult}
 */
export function parseTcx(text) {
  const doc = parseXml(text, 'TCX');

  /** @type {import('../model.js').RawSample[]} */
  const samples = [];
  let sport;
  let device;

  for (const el of doc.getElementsByTagName('*')) {
    const name = local(el);

    if (name === 'activity' && !sport) {
      sport = el.getAttribute('Sport') ?? undefined;
      continue;
    }

    // <Creator><Name>Edge 830</Name></Creator> — the device that recorded the file.
    if (name === 'creator' && !device) {
      for (const child of el.getElementsByTagName('*')) {
        if (local(child) === 'name') {
          device = (child.textContent ?? '').trim() || undefined;
          break;
        }
      }
      continue;
    }

    if (name !== 'trackpoint') continue;

    /** @type {import('../model.js').RawSample} */
    const sample = {};

    for (const field of el.getElementsByTagName('*')) {
      switch (local(field)) {
        case 'time':
          sample.time = parseTime(field.textContent);
          break;
        case 'latitudedegrees':
          sample.lat = textNumber(field);
          break;
        case 'longitudedegrees':
          sample.lon = textNumber(field);
          break;
        case 'altitudemeters':
          sample.ele = textNumber(field);
          break;
        case 'distancemeters':
          sample.dist = textNumber(field);
          break;
        // <HeartRateBpm><Value>142</Value></HeartRateBpm> — the wrapper's text
        // content is the value, so the inner element needs no special case.
        case 'heartratebpm':
          sample.hr = textNumber(field);
          break;
        case 'cadence':
        case 'runcadence':
          sample.cad = textNumber(field);
          break;
        case 'watts':
          sample.power = textNumber(field);
          break;
        case 'speed':
          sample.speed = textNumber(field);
          break;
        default:
          break;
      }
    }

    samples.push(sample);
  }

  return { samples, sport, device };
}

/** @param {Element} el */
function local(el) {
  return (el.localName || el.nodeName).toLowerCase();
}
