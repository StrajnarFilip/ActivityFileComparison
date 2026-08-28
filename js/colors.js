/**
 * Default series colours.
 *
 * The first six are the Okabe-Ito palette, which stays distinguishable under
 * the common forms of colour blindness; the rest extend it while keeping every
 * pair far apart in hue or lightness. They are dark enough to read as a thin
 * line on a light map tile.
 */
export const PALETTE = Object.freeze([
  '#0072b2', // blue
  '#d55e00', // vermillion
  '#009e73', // bluish green
  '#cc79a7', // reddish purple
  '#e69f00', // orange
  '#56b4e9', // sky blue
  '#7b3294', // purple
  '#a6761d', // dark goldenrod
  '#1b7837', // dark green
  '#b2182b', // dark red
  '#01665a', // teal
  '#4d4d4d', // grey
]);

/**
 * Pick the first palette colour that is not in use, so files added and removed
 * in any order still get distinct colours.
 *
 * @param {Iterable<string>} used
 * @returns {string}
 */
export function nextColor(used) {
  const taken = new Set(Array.from(used, (c) => c.toLowerCase()));
  const free = PALETTE.find((c) => !taken.has(c));
  if (free) return free;

  // More files than palette entries: keep going around the hue circle.
  const index = taken.size % 360;
  return hslToHex((index * 137.508) % 360, 0.62, 0.42);
}

/**
 * @param {number} h Hue in degrees.
 * @param {number} s Saturation 0..1.
 * @param {number} l Lightness 0..1.
 * @returns {string} `#rrggbb`
 */
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  /** @param {number} n */
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
