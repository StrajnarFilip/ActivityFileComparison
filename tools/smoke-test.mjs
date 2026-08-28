/**
 * End-to-end check: loads the three sample files into a real browser and
 * verifies that all three formats parse, that the charts, table and map agree
 * with each other, and that the controls do what they say.
 *
 *   npm install && npx playwright install chromium
 *   npm test
 */

import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8125;
const SAMPLES = ['ride-headunit.fit', 'ride-watch.tcx', 'ride-phone.gpx'];

let failures = 0;

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const server = await serve(PORT);
const browser = await chromium.launch();
// Pinned so date and number formatting in the assertions is deterministic.
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  locale: 'en-GB',
  timezoneId: 'Europe/Ljubljana',
});

/** @type {string[]} */
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

// Stand in for the tile server so the test needs no network.
await page.route('**://*.openstreetmap.org/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eceef0"/></svg>',
  }),
);

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
check('starts on the empty state', await page.isVisible('.dropzone'));

await page.setInputFiles(
  '#file-input',
  SAMPLES.map((name) => join(ROOT, 'testdata', name)),
);
await page.waitForSelector('.chart .uplot', { timeout: 30000 });
await page.waitForTimeout(1500);

const titles = await page.$$eval('.chart .u-title', (els) => els.map((e) => e.textContent));
check(
  'one chart per recorded channel',
  titles.join('|') ===
    'Power (W)|Heart rate (bpm)|Cadence (rpm)|Speed (km/h)|Elevation (m)|Temperature (°C)',
  titles.join(', '),
);
check('all three files parsed', (await page.$$('.file')).length === 3);
check('no parse errors', (await page.$$('#messages li')).length === 0);
check('map is drawn', await page.isVisible('#map.leaflet-container'));

const colours = await page.$$eval('.file-color', (els) =>
  els.map((e) => /** @type {HTMLInputElement} */ (e).value),
);
check('files get distinct default colours', new Set(colours).size === 3, colours.join(' '));

const swatches = await page.$$eval(
  '.chart:first-child .u-legend .u-series:not(:first-child) .u-marker',
  (els) => els.map((e) => getComputedStyle(e).borderTopColor),
);
check(
  'chart colours match the file colours',
  swatches.join(' ') === 'rgb(0, 114, 178) rgb(213, 94, 0) rgb(0, 158, 115)',
  swatches.join(' '),
);

// The three files record the same ride, so their derived totals must agree.
const distances = await page.$$eval('.summary tbody tr', (rows) =>
  rows.map((r) => Number(r.querySelectorAll('td')[3].textContent)),
);
check(
  'distances agree across formats',
  Math.max(...distances) - Math.min(...distances) < 0.1,
  distances.join(' / '),
);
const ascents = await page.$$eval('.summary tbody tr', (rows) =>
  rows.map((r) => Number(r.querySelectorAll('td')[4].textContent)),
);
check(
  'ascent agrees across formats',
  Math.max(...ascents) - Math.min(...ascents) < 20,
  ascents.join(' / '),
);

// Hovering a chart reads every file's value at that point.
const box = await page.locator('.chart .u-over').first().boundingBox();
if (!box) throw new Error('no chart to hover');
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
await page.waitForTimeout(300);
const readout = await page.$$eval('.chart:first-child .u-legend .u-value', (els) =>
  els.map((e) => (e.textContent ?? '').trim()),
);
check(
  'cursor reads a value from every file',
  readout.length === 4 && readout.slice(1).every((v) => /\d/.test(v)),
  readout.join(' | '),
);

// Every chart carries a statistics table, empty of selection figures until a
// segment is selected.
const statsHeaders = await page.$$eval('.chart:first-child .chart-stats thead th', (els) =>
  els.map((e) => e.textContent),
);
check(
  'each chart has a statistics table',
  statsHeaders.join('|') === 'Power|Avg|Max|Avg (selected)|Max (selected)' &&
    (await page.$$('.chart-stats table')).length === 6,
  statsHeaders.join(', '),
);
const beforeSelection = await page.$$eval('.chart:first-child .chart-stats tbody tr', (rows) =>
  rows.map((r) => [...r.querySelectorAll('td')].map((c) => (c.textContent ?? '').trim())),
);
check(
  'whole-file figures are shown, selection figures are not',
  beforeSelection.every((r) => r[0].endsWith('W') && r[1].endsWith('W') && r[2] === '–' && r[3] === '–'),
  beforeSelection.map((r) => r.join(' ')).join(' / '),
);

// Drag a segment: every chart follows, and the selection columns fill in.
await page.locator('.chart .u-over').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const drag = await page.locator('.chart .u-over').first().boundingBox();
if (!drag) throw new Error('no chart to drag on');
await page.mouse.move(drag.x + drag.width * 0.1, drag.y + drag.height / 2);
await page.mouse.down();
await page.mouse.move(drag.x + drag.width * 0.25, drag.y + drag.height / 2, { steps: 8 });
await page.mouse.move(drag.x + drag.width * 0.4, drag.y + drag.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(700);

const label = await page.$eval('#selection-info', (e) => (e.textContent ?? '').trim());
check('the selected segment is reported', /^Selected \d+:\d\d – \d+:\d\d/.test(label), label);

const selected = await page.$$eval('.chart:first-child .chart-stats tbody tr', (rows) =>
  rows.map((r) =>
    [...r.querySelectorAll('td')].map((c) => Number.parseFloat((c.textContent ?? '').trim())),
  ),
);
check(
  'selection figures appear and stay within the whole-file figures',
  selected.length === 3 &&
    selected.every(([avg, max, selAvg, selMax]) => selAvg > 0 && selMax > 0 && selMax <= max && avg > 0),
  selected.map((r) => r.join('/')).join(' '),
);

// The drag was on the power chart; the cadence chart must report the same
// segment. Its selected average excludes the stop, so it beats the whole-file
// average, which does not.
const cadence = await page.$$eval('.chart:nth-child(3) .chart-stats tbody tr', (rows) =>
  rows.map((r) =>
    [...r.querySelectorAll('td')].map((c) => Number.parseFloat((c.textContent ?? '').trim())),
  ),
);
check(
  'the selection applies to every chart',
  cadence.every(([avg, , selAvg]) => selAvg > avg),
  cadence.map((r) => r.join('/')).join(' '),
);

await page.mouse.dblclick(drag.x + drag.width * 0.5, drag.y + drag.height / 2);
await page.waitForTimeout(600);
check(
  'double-click clears the selection',
  (await page.$eval('#selection-info', (e) => (e.textContent ?? '').trim())) === '',
);

// A colour change has to reach the charts, the table and the map together.
await page.$eval('.file:nth-child(2) .file-color', (el) => {
  /** @type {HTMLInputElement} */ (el).value = '#8e44ad';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(600);
const tableSwatch = await page.$eval(
  '.summary tbody tr:nth-child(2) .swatch',
  (e) => /** @type {HTMLElement} */ (e).style.background,
);
const chartSwatch = await page.$eval(
  '.chart:first-child .u-legend .u-series:nth-child(3) .u-marker',
  (e) => getComputedStyle(e).borderTopColor,
);
check(
  'a recolour reaches the table and the charts',
  tableSwatch === 'rgb(142, 68, 173)' && chartSwatch === 'rgb(142, 68, 173)',
  `${tableSwatch} / ${chartSwatch}`,
);

for (const [id, expected] of [
  ['x-dist', 'Distance'],
  ['x-clock', 'Time'],
  ['x-elapsed', 'Elapsed'],
]) {
  await page.click(`label[for="${id}"]`);
  await page.waitForTimeout(600);
  const label = await page.$eval('.chart:first-child .u-legend th', (e) =>
    (e.textContent ?? '').trim(),
  );
  check(`x axis switches to ${expected.toLowerCase()}`, label.startsWith(expected), label);
}

await page.click('label[for="units-imperial"]');
await page.waitForTimeout(600);
const headers = await page.$$eval('.summary thead th', (els) => els.map((e) => e.textContent));
const speedTitle = await page.$$eval('.chart .u-title', (els) =>
  els.map((e) => e.textContent).find((t) => t?.startsWith('Speed')),
);
check(
  'imperial units reach the table and the charts',
  headers.some((h) => h?.includes('(mi)')) && speedTitle === 'Speed (mph)',
  String(speedTitle),
);
await page.click('label[for="units-metric"]');
await page.waitForTimeout(400);

await page.uncheck('.file:nth-child(1) .file-visible');
await page.waitForTimeout(600);
check('hiding a file removes it from the table', (await page.$$('.summary tbody tr')).length === 2);
await page.check('.file:nth-child(1) .file-visible');
await page.waitForTimeout(400);

await page.click('.file:nth-child(3) .file-remove');
await page.waitForTimeout(600);
check('a file can be removed', (await page.$$('.file')).length === 2);

await page.click('#clear-all');
await page.waitForTimeout(300);
check('removing everything returns to the empty state', await page.isVisible('.dropzone'));

// A planned route has positions but no timestamps, so it can only be charted
// against distance. Loading it beside a recording must say so rather than
// leaving it silently out.
await page.setInputFiles('#file-input', join(ROOT, 'testdata', SAMPLES[0]));
await page.waitForTimeout(800);
await page.setInputFiles('#file-input', {
  name: 'route.gpx',
  mimeType: 'application/gpx+xml',
  buffer: Buffer.from(routeWithoutTimestamps()),
});
await page.waitForTimeout(1000);
check(
  'a file with no timestamps is reported, not dropped',
  (await page.$eval('.chart-note', (e) => e.textContent ?? '')).includes('route.gpx'),
  await page.$eval('.chart-note', (e) => e.textContent ?? '').catch(() => 'no note shown'),
);
await page.click('label[for="x-dist"]');
await page.waitForTimeout(800);
check(
  'and it is charted once the axis is distance',
  (await page.$$('.chart-note')).length === 0 &&
    (await page.$$eval('.chart .u-title', (els) => els.map((e) => e.textContent))).includes(
      'Elevation (m)',
    ),
);
await page.click('#clear-all');
await page.waitForTimeout(300);

await page.setInputFiles('#file-input', {
  name: 'notes.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('not an activity'),
});
await page.waitForTimeout(400);
check('an unsupported file reports an error', (await page.$$('#messages li')).length === 1);

check('no console or page errors', problems.length === 0, problems.join(' / '));

await browser.close();
server.close();

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

/** A GPX route: positions and elevation, but no times. */
function routeWithoutTimestamps() {
  const points = [];
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * 2 * Math.PI;
    points.push(
      `<trkpt lat="${(46.0569 + 0.011 * Math.sin(a)).toFixed(7)}" ` +
        `lon="${(14.5058 + 0.017 * Math.cos(a)).toFixed(7)}">` +
        `<ele>${(295 + 42 * Math.sin(a)).toFixed(1)}</ele></trkpt>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Planned route</name><trkseg>${points.join('')}</trkseg></trk>
</gpx>`;
}
