/** Value formatting shared by the charts, the summary table and the file list. */

/**
 * Seconds -> `h:mm:ss`, or `m:ss` for anything under an hour.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function duration(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  const sign = seconds < 0 ? '-' : '';
  const total = Math.round(Math.abs(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = /** @param {number} v */ (v) => String(v).padStart(2, '0');
  return h > 0 ? `${sign}${h}:${pad(m)}:${pad(s)}` : `${sign}${m}:${pad(s)}`;
}

/**
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
export function number(value, decimals = 0) {
  if (!Number.isFinite(value)) return '–';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * @param {Date|null} date
 * @returns {string}
 */
export function dateTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
