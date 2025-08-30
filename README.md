GeoInterp — Route Interpolation & Visualization
==============================================

GeoInterp is a small, single‑page app built with Vite, TypeScript, and Leaflet. It loads a route from JSON or GeoJSON, computes cumulative distance and per‑segment speed, renders the line color‑coded by speed, shows summary stats, and lets you export the results as CSV or GPX. All processing happens locally in your browser.

Features
--------
- Speed‑colored route: per‑segment color from blue→red based on speed.
- Stats: total distance, duration, average/max speed, sampling interval.
- Tooltips/popups: per‑point UTC/CT timestamps, cumulative distance, speed.
- Units: toggle between imperial (mi/ft, mph) and metric (km/m, km/h).
- Exports: per‑point CSV and GPX track with timestamps.
- Simple UI: drag‑and‑drop a file or use the Open button.

Supported Input Formats
-----------------------
Provide a single route as one of the following:

- Feature with Google encoded polyline:
  - `properties.polyline` (or top‑level `polyline`) string using precision 5.
- GeoJSON geometry coordinates:
  - `geometry.type: "LineString"` with `coordinates: [lon, lat, (optional time)]`.
  - `geometry.type: "MultiLineString"` uses the first line’s coordinates.
  - Or a raw array shaped like LineString coordinates.
- Timestamps (optional):
  - Per‑point time as the 3rd coordinate or as point property `t` (epoch ms/seconds or ISO string).
  - Or `properties.timestamps` (array length equal to number of points; items may be epoch ms/seconds or ISO strings).
- Metadata (optional):
  - `properties.route_label` | `properties.label` | `properties.name`
  - `properties.direction`
  - `properties.start_time`, `properties.end_time` (epoch ms/seconds or ISO). Used if per‑point times are missing; otherwise times are evenly distributed between these bounds.

Quick Start (Preview a Built App)
---------------------------------
This repo includes a built `dist/` folder. You can preview it directly:

1) Install dependencies (Node 18+ recommended):

   npm install

2) Preview the production build:

   npm run preview

If preview shows a 404, build first:

   npm run build
   npm run preview

Development (Live Reload)
-------------------------
Vite dev server expects a root `index.html` that loads `src/main.ts`. If you don’t have one yet, create an `index.html` at the repo root like this:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GeoInterp</title>
    <style>html,body,#app{height:100%;margin:0}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
  </html>
```

Then run the dev server:

```
npm run dev
```

Usage
-----
- Open the app in a browser.
- Drag & drop a JSON/GeoJSON file onto the drop zone or click Open.
- Choose units (imperial/metric); stats, legend, and tooltips update.
- Hover points for details; click a point to pin a popup.
- Export results via “Export CSV” or “Export GPX”.

What Gets Computed
------------------
- Distances: Haversine great‑circle distance per segment; cumulative sum.
- Speeds: segment length divided by delta‑time (m/s), colored on the line.
- Stats:
  - Total distance and total duration.
  - Average speed (total distance / duration) and max segment speed.
  - Effective sampling interval (median of time deltas).

Exports
-------
- CSV (per point): `index, lat, lon, timestamp(ISO), cum_distance_m, speed_mps`.
- GPX: single `<trk>` containing a `<trkseg>` of `<trkpt lat/ lon>` with `<time>` in ISO‑8601 UTC.

Examples
--------
1) GeoJSON LineString with timestamps array

```json
{
  "type": "Feature",
  "properties": {
    "route_label": "Sample Route",
    "direction": "NNE",
    "timestamps": [
      "2024-07-01T12:00:00Z",
      "2024-07-01T12:00:10Z",
      "2024-07-01T12:00:25Z"
    ]
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-122.420679, 37.772537],
      [-122.414863, 37.780145],
      [-122.406417, 37.785834]
    ]
  }
}
```

2) Encoded polyline (precision 5) with start/end time

```json
{
  "polyline": "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
  "route_label": "Polyline Example",
  "direction": "Westbound",
  "start_time": "2024-07-01T00:00:00Z",
  "end_time": "2024-07-01T00:05:00Z"
}
```

Project Structure
-----------------
- `src/main.ts` — UI, map rendering, file parsing, stats, exports.
- `src/utils.ts` — geometry/time/unit helpers (haversine, polyline decode, etc.).
- `src/style.css` — dark UI theme and component styling.
- `vite.config.ts` — Vite config (dev server on port 5173).
- `tsconfig.json` — TypeScript settings.
- `dist/` — built production assets and `index.html` for preview.

Troubleshooting
---------------
- “No coordinates found” alert:
  - Ensure you provided `properties.polyline` or a valid `geometry.coordinates` (LineString or array of `[lon, lat, (time)]`).
  - If using `properties.timestamps`, its length must equal the number of points.
- Times look wrong or are missing:
  - Per‑point `t` (epoch ms/seconds or ISO) or `properties.timestamps` must be parseable; otherwise the app evenly distributes time between `start_time` and `end_time`.
- OSM tiles not loading:
  - Requires internet access to `tile.openstreetmap.org`.
- Dev server blank page:
  - Make sure a root `index.html` is present (see Development section), or use `npm run preview` to serve `dist/`.

Notes / Known Issues
--------------------
- Some placeholder glyphs may appear for default text and arrow icons if the source contains non‑ASCII characters from a bad copy/paste; replacing them with plain ASCII fixes display.
- If you see errors in `bearingDegrees` (in `src/utils.ts`) due to corrupted variable names, restore it to a standard great‑circle bearing implementation.

Privacy
-------
- All parsing and computation happens locally in the browser. The app fetches only map tiles from OpenStreetMap.

License
-------
No license specified.
