/**
 * The shared Leaflet map: every file's GPS track drawn on one map, in the same
 * colour it has in the charts, with a marker per file that follows the chart
 * cursor.
 */

/** Leaflet is loaded as a plain script, see index.html. @type {any} */
const L = /** @type {any} */ (window).L;

/** Panes keep every white casing below every coloured line. Drawing each
    track as casing-then-line would let a later track's casing wipe out an
    earlier track's line, which is the normal case here: the files being
    compared are usually recordings of the same route. */
const CASING_PANE = 'track-casings';
const LINE_PANE = 'tracks';

const LINE_WEIGHT = 3;
const LINE_WEIGHT_HIGHLIGHTED = 5;

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * @typedef {Object} TrackLayers
 * @property {any} casing  White outline drawn under the track for contrast.
 * @property {any} line
 * @property {any} marker
 */

export class TrackMap {
  /** @param {HTMLElement} element */
  constructor(element) {
    this.map = L.map(element, {
      // Canvas rendering keeps long tracks smooth; SVG chokes past a few
      // thousand points per polyline.
      preferCanvas: true,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(this.map);
    this.map.createPane(CASING_PANE).style.zIndex = '405';
    this.map.createPane(LINE_PANE).style.zIndex = '410';
    this.map.setView([0, 0], 2);

    /** @type {Map<string, TrackLayers>} */
    this.layers = new Map();
    /** @type {string} */
    this.fittedKey = '';
  }

  /**
   * Draw the visible tracks. Only tracks whose set of files changed cause the
   * view to move, so panning and zooming survives colour changes and reloads.
   *
   * @param {import('./model.js').Activity[]} activities
   */
  render(activities) {
    const shown = activities.filter((a) => a.visible && a.hasGps);
    const wanted = new Set(shown.map((a) => a.id));

    for (const [id, layers] of this.layers) {
      if (!wanted.has(id)) {
        this.map.removeLayer(layers.casing);
        this.map.removeLayer(layers.line);
        this.map.removeLayer(layers.marker);
        this.layers.delete(id);
      }
    }

    for (const activity of shown) {
      const existing = this.layers.get(activity.id);
      if (existing) {
        existing.line.setStyle({ color: activity.color });
        existing.marker.setStyle({ fillColor: activity.color });
        continue;
      }

      const casing = L.polyline(activity.latlngs, {
        pane: CASING_PANE,
        color: '#ffffff',
        weight: 6,
        opacity: 0.65,
        interactive: false,
      }).addTo(this.map);

      const line = L.polyline(activity.latlngs, {
        pane: LINE_PANE,
        color: activity.color,
        weight: LINE_WEIGHT,
        opacity: 0.9,
      })
        .addTo(this.map)
        .bindTooltip(activity.name, { sticky: true });

      const marker = L.circleMarker([0, 0], {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: activity.color,
        fillOpacity: 1,
        interactive: false,
      });

      this.layers.set(activity.id, { casing, line, marker });
    }

    const key = shown.map((a) => a.id).join('|');
    if (key && key !== this.fittedKey) {
      this.fittedKey = key;
      this.fit();
    } else if (!key) {
      this.fittedKey = '';
    }
  }

  /**
   * Lift one track above the others, for when several files follow the same
   * route and their lines sit on top of each other.
   *
   * @param {string|null} id  `null` restores every track to its normal weight.
   */
  highlight(id) {
    for (const [trackId, layers] of this.layers) {
      const active = trackId === id;
      layers.line.setStyle({ weight: active ? LINE_WEIGHT_HIGHLIGHTED : LINE_WEIGHT });
      if (active) layers.line.bringToFront();
    }
  }

  /** Zoom to show every drawn track. */
  fit() {
    const bounds = L.latLngBounds([]);
    for (const [, layers] of this.layers) bounds.extend(layers.line.getBounds());
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [24, 24] });
  }

  /**
   * Move the per-file markers to where the chart cursor is.
   *
   * @param {import('./charts.js').CursorPositions} positions
   */
  showCursor(positions) {
    /** @type {Set<string>} */
    const active = new Set();

    for (const position of positions) {
      if (!position) continue;
      const layers = this.layers.get(position.id);
      if (!layers) continue;
      active.add(position.id);
      layers.marker.setLatLng([position.lat, position.lon]);
      if (!this.map.hasLayer(layers.marker)) layers.marker.addTo(this.map);
    }

    for (const [id, layers] of this.layers) {
      if (!active.has(id) && this.map.hasLayer(layers.marker)) {
        this.map.removeLayer(layers.marker);
      }
    }
  }

  /** Hide every cursor marker. */
  hideCursor() {
    for (const [, layers] of this.layers) {
      if (this.map.hasLayer(layers.marker)) this.map.removeLayer(layers.marker);
    }
  }

  /** Recompute the map size after its container changed. */
  invalidate() {
    this.map.invalidateSize();
  }
}
