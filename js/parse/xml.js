/** Small helpers shared by the GPX and TCX parsers. */

/**
 * Parse XML and turn the browser's in-band error reporting into an exception.
 *
 * @param {string} text
 * @param {string} what  Format name, used in the error message.
 * @returns {Document}
 */
export function parseXml(text, what) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) {
    const detail = (error.textContent ?? '').trim().split('\n')[0];
    throw new Error(`${what} file is not valid XML: ${detail}`);
  }
  return doc;
}

/**
 * Numeric text content of an element, or `undefined` when it is absent or not
 * a number.
 *
 * @param {Element} el
 * @returns {number|undefined}
 */
export function textNumber(el) {
  const text = (el.textContent ?? '').trim();
  if (!text) return undefined;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * ISO-8601 timestamp -> unix seconds.
 *
 * @param {string|null} text
 * @returns {number|undefined}
 */
export function parseTime(text) {
  if (!text) return undefined;
  const ms = Date.parse(text.trim());
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}
