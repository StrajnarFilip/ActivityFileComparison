# Activity File Comparison

A single-page app for comparing activity recordings side by side. Drop in any
number of **.FIT**, **.TCX** and **.GPX** files and it charts power, heart rate,
cadence, speed, elevation and temperature from all of them on the same axes, and
draws every GPS track on one map. Each file keeps one colour across the charts,
the map and the summary table, and you can change that colour yourself.

Everything runs in the browser. Files are never uploaded anywhere, and the app is
plain static files — **there is no build step**.

## Running it

ES modules have to be served over HTTP, so opening `index.html` from disk will not
work. Any static server will do:

```sh
node tools/serve.mjs        # then open http://localhost:8080/
# or: python3 -m http.server 8080
```

To deploy, copy the repository to any static host. The files the app needs at
runtime are `index.html`, `css/`, `js/` and `vendor/` — nothing else.

There are three sample files in `testdata/` (one simulated ride "recorded" by a
head unit, a watch and a phone) if you want to see it working before finding your
own.

## What it does

**Charts.** One chart per channel, stacked and sharing a cursor: move the pointer
over any of them and every chart, plus the map, shows what each file recorded at
that point. Drag to zoom, double-click to reset.

**X axis.** Three modes:

| Mode | Use it when |
| --- | --- |
| Elapsed | Comparing rides that did not start at the same moment. |
| Clock | Comparing several devices that recorded the same session simultaneously. |
| Distance | Comparing attempts at the same route. |

**Map.** All tracks on one Leaflet map, in matching colours, with a white casing
under every line so they stay legible on the tiles. Because the files being
compared usually follow the same route, their lines sit on top of each other —
hover a file in the sidebar to lift its track above the rest.

**Colours.** New files get the next unused colour from a palette that starts with
the six [Okabe–Ito](https://jfly.uni-koeln.de/color/) colours, so the default set
stays distinguishable for colour-blind viewers. The swatch next to each file is a
colour picker; changing it updates the charts, the map and the table together.

**Units.** Metric or imperial, applied to speed, distance, elevation and
temperature everywhere at once.

## How files are compared

Charts need one shared x axis, but the files being compared have different sample
rates, lengths and recording strategies (1 Hz, smart recording, GPS-only). So
every file is resampled onto one evenly spaced grid:

- samples inside a grid cell are averaged, which also downsamples long files to
  something a screen can actually show;
- cells with no samples are interpolated from their neighbours;
- cells further than a gap threshold (six times the file's own median sample
  interval) from any sample are left empty, so a pause shows as a real gap
  instead of a line drawn straight across it.

Some values are derived when a file does not record them: distance from GPS
positions when there is no distance field, speed from distance over time, and
ascent from elevation smoothed over ten seconds — without that smoothing, the
few metres of noise on GPS elevation accumulate into hundreds of metres of
imaginary climbing.

Averages are weighted by sample interval, so a smart-recording file and a 1 Hz
file of the same ride report the same numbers.

## Formats

| | FIT | TCX | GPX |
| --- | --- | --- | --- |
| Position, elevation, time | yes | yes | yes |
| Heart rate, cadence | yes | yes | `TrackPointExtension` |
| Power | yes | `TPX/Watts` | `power`, `PowerInWatts` or `watts` |
| Speed | yes | `TPX/Speed` | `speed`, else derived |
| Temperature | yes | – | `atemp` |

The FIT decoder is written against the FIT protocol directly rather than pulled
in as a dependency: it handles definition and data messages, compressed
timestamp headers, developer fields and chained files. The format is detected
from the file contents, so files renamed by an export tool still load.

## Project layout

```
index.html          markup and the two vendor <script> tags
css/app.css         layout and theming (light and dark)
js/model.js         typedefs, channel definitions, unit conversion
js/parse/           fit.js, gpx.js, tcx.js and the format dispatcher
js/activity.js      raw samples -> packed columns + summary statistics
js/resample.js      the shared x grid every chart is drawn on
js/charts.js        the uPlot chart stack
js/map.js           the Leaflet map
js/ui.js            file list and summary table
js/main.js          state and wiring
tools/              dev server, test, sample-file generator
vendor/             uPlot 1.6.32 and Leaflet 1.9.4, vendored
```

The code is plain JavaScript annotated with JSDoc types. `jsconfig.json` turns on
`checkJs` under `strict`, so editors type-check it with no setup.

## Development

The app needs no dependencies; these are only for the checks.

```sh
npm install
npx playwright install chromium   # for the browser test

npm run check      # type-check the JSDoc annotations
npm test           # load the sample files in a real browser and verify the app
npm run testdata   # regenerate testdata/
```

`npm test` drives Chromium through the whole app: it loads all three sample
files, then checks that the derived totals agree across formats, that colours
match between the charts and the table, that the cursor reads every file, and
that the axis, unit, visibility and removal controls work.

## Notes

- Map tiles come from OpenStreetMap and need an internet connection. Everything
  else, including the charting and map libraries, is served from `vendor/`.
- Files live in memory only; reloading the page clears them.

## Third-party code

`vendor/` contains unmodified builds of [uPlot](https://github.com/leeoniya/uPlot)
(MIT) and [Leaflet](https://leafletjs.com/) (BSD-2-Clause); their licences sit
next to them. The rest is Apache-2.0, see `LICENSE`.
