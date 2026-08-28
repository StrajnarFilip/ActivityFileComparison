/** Picks the right parser for a dropped file and runs it. */

import { parseFit } from './fit.js';
import { parseGpx } from './gpx.js';
import { parseTcx } from './tcx.js';

/**
 * @typedef {Object} ParsedFile
 * @property {'FIT'|'GPX'|'TCX'} format
 * @property {import('../model.js').ParseResult} result
 */

/**
 * Parse one file. The format is detected from the contents, with the file
 * extension only used as a tie-breaker, so files renamed by an export tool
 * still load.
 *
 * @param {File} file
 * @returns {Promise<ParsedFile>}
 */
export async function parseActivityFile(file) {
  const buffer = await file.arrayBuffer();

  if (isFit(buffer)) {
    return { format: 'FIT', result: parseFit(buffer) };
  }

  const text = decodeText(buffer);
  const head = text.slice(0, 2048);

  if (/<\s*TrainingCenterDatabase/i.test(head)) {
    return { format: 'TCX', result: parseTcx(text) };
  }
  if (/<\s*gpx[\s>]/i.test(head)) {
    return { format: 'GPX', result: parseGpx(text) };
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'tcx') return { format: 'TCX', result: parseTcx(text) };
  if (extension === 'gpx') return { format: 'GPX', result: parseGpx(text) };
  if (extension === 'fit') {
    throw new Error('this .fit file does not start with a FIT header');
  }

  throw new Error('unrecognised file — expected .fit, .gpx or .tcx');
}

/**
 * FIT files carry the ASCII tag `.FIT` at offset 8, right after the header's
 * size, protocol version, profile version and data size.
 *
 * @param {ArrayBuffer} buffer
 */
function isFit(buffer) {
  if (buffer.byteLength < 12) return false;
  const tag = new Uint8Array(buffer, 8, 4);
  return tag[0] === 0x2e && tag[1] === 0x46 && tag[2] === 0x49 && tag[3] === 0x54;
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function decodeText(buffer) {
  const text = new TextDecoder('utf-8').decode(buffer);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
