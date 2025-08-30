import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
import type { LatLngTime, UnitSystem } from './utils';
import {
  average,
  bearingDegrees,
  computeSegmentSpeedsMps,
  cumulativeDistancesMeters,
  decodePolyline,
  distributeEvenTimes,
  effectiveSamplingIntervalSec,
  formatDuration,
  formatDistance,
  formatTimeMs,
  haversineMeters,
  isoUtc,
  mpsToSpeedText,
  parseMaybeTime,
  speedColor,
} from './utils';

// Fix default icon assets for Vite bundling
// @ts-expect-error - vite will transform these imports to URLs
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
// @ts-expect-error
import markerIcon from 'leaflet/dist/images/marker-icon.png';
// @ts-expect-error
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

type AnyGeo = any;

type RouteMeta = {
  label?: string;
  direction?: string;
  startMs?: number;
  endMs?: number;
};

type AppState = {
  unitSystem: UnitSystem;
  points: LatLngTime[];
  timesMs: number[];
  cumDistM: number[];
  segSpeedsMps: number[];
  stats: {
    totalDistM: number;
    durationS: number;
    avgMps: number;
    maxMps: number;
    samplingS: number;
  } | null;
  meta: RouteMeta;
  map?: L.Map;
  layers?: {
    segments: L.LayerGroup;
    points: L.LayerGroup;
    arrows: L.LayerGroup;
    markers: L.LayerGroup;
    legend?: L.Control;
  };
};

const state: AppState = {
  unitSystem: 'imperial',
  points: [],
  timesMs: [],
  cumDistM: [],
  segSpeedsMps: [],
  stats: null,
  meta: {},
};

function buildLayout() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'topbar';

  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.innerHTML = `
    <div><span class="label">Route:</span> <span id="route_label" class="val">—</span></div>
    <div><span class="label">Dir:</span> <span id="route_dir" class="val">—</span></div>
    <div><span class="label">Start (UTC/CT):</span> <span id="start_times" class="val">—</span></div>
    <div><span class="label">End (UTC/CT):</span> <span id="end_times" class="val">—</span></div>
    <div><span class="label">Distance:</span> <span id="sum_dist" class="val">—</span></div>
    <div><span class="label">Duration:</span> <span id="sum_dur" class="val">—</span></div>
    <div><span class="label">Avg Speed:</span> <span id="avg_spd" class="val">—</span></div>
    <div><span class="label">Max Speed:</span> <span id="max_spd" class="val">—</span></div>
    <div><span class="label">Sampling:</span> <span id="samp_int" class="val">—</span></div>
  `;

  const controls = document.createElement('div');
  controls.className = 'controls';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,.geojson,application/json';
  fileInput.id = 'file_input';
  fileInput.className = 'hidden';

  const fileLabel = document.createElement('label');
  fileLabel.htmlFor = 'file_input';
  fileLabel.className = 'file-input-label';
  fileLabel.textContent = 'Open JSON/GeoJSON…';

  const dropzone = document.createElement('div');
  dropzone.className = 'dropzone';
  dropzone.textContent = 'Drop a Feature JSON/GeoJSON here or use "Open"';
  dropzone.title = 'All processing happens locally in your browser';

  const unitSelect = document.createElement('select');
  unitSelect.innerHTML = `
    <option value="imperial">mi / ft</option>
    <option value="metric">km / m</option>
  `;
  unitSelect.value = state.unitSystem;

  const exportCsvBtn = document.createElement('button');
  exportCsvBtn.textContent = 'Export CSV';
  exportCsvBtn.id = 'btn_csv';
  exportCsvBtn.disabled = true;

  const exportGpxBtn = document.createElement('button');
  exportGpxBtn.textContent = 'Export GPX';
  exportGpxBtn.id = 'btn_gpx';
  exportGpxBtn.disabled = true;

  controls.append(fileInput, fileLabel, exportCsvBtn, exportGpxBtn, unitSelect);

  topbar.append(summary, controls);
  app.appendChild(topbar);
  app.appendChild(dropzone);

  const mapDiv = document.createElement('div');
  mapDiv.id = 'map';
  app.appendChild(mapDiv);

  // Events
  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await loadFile(file);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) await loadFile(file);
  });

  unitSelect.addEventListener('change', () => {
    state.unitSystem = unitSelect.value as UnitSystem;
    refreshSummary();
    refreshTooltips();
    refreshLegend();
  });

  exportCsvBtn.addEventListener('click', () => exportCSV());
  exportGpxBtn.addEventListener('click', () => exportGPX());
}

function initMap() {
  const map = L.map('map', { preferCanvas: true });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  // Ensure dark UI does not affect map tiles
  (osm.getContainer() as HTMLElement).style.filter = 'none';

  const segments = L.layerGroup().addTo(map);
  const points = L.layerGroup().addTo(map);
  const arrows = L.layerGroup().addTo(map);
  const markers = L.layerGroup().addTo(map);

  state.map = map;
  state.layers = { segments, points, arrows, markers };
  addLegendControl();
}

function addLegendControl() {
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = `
      <div><b>Speed</b></div>
      <div class="bar"></div>
      <div class="scale"><span id="spd_min">0</span><span id="spd_mid">—</span><span id="spd_max">—</span></div>
    `;
    return div;
  };
  legend.addTo(state.map!);
  if (!state.layers) state.layers = {} as any;
  state.layers.legend = legend;
}

function refreshLegend() {
  if (!state.stats) return;
  const { maxMps, avgMps } = state.stats;
  const minEl = document.getElementById('spd_min');
  const midEl = document.getElementById('spd_mid');
  const maxEl = document.getElementById('spd_max');
  if (minEl && midEl && maxEl) {
    const minText = mpsToSpeedText(0, state.unitSystem).text;
    const midText = mpsToSpeedText(avgMps, state.unitSystem).text;
    const maxText = mpsToSpeedText(maxMps, state.unitSystem).text;
    minEl.textContent = minText;
    midEl.textContent = midText;
    maxEl.textContent = maxText;
  }
}

async function loadFile(file: File) {
  const text = await file.text();
  let json: AnyGeo;
  try {
    json = JSON.parse(text);
  } catch (e) {
    alert('Failed to parse JSON');
    return;
  }
  const { points, meta, timesMs } = extractPoints(json);
  if (!points.length) {
    alert('No coordinates found. Expect properties.polyline or geometry.coordinates');
    return;
  }

  state.meta = meta;
  state.points = points;

  // Times
  let tms = timesMs;
  if (!tms.length) {
    const start = meta.startMs ?? Date.now();
    const end = meta.endMs ?? start + (points.length - 1) * 1000;
    tms = distributeEvenTimes(start, end, points.length);
  }
  state.timesMs = tms;

  // Distances and speeds
  const cum = cumulativeDistancesMeters(points);
  state.cumDistM = cum;
  const speeds = computeSegmentSpeedsMps(tms, cum);
  state.segSpeedsMps = speeds;

  const totalDistM = cum[cum.length - 1] || 0;
  const durationS = (tms[tms.length - 1] - tms[0]) / 1000;
  const avgMps = durationS > 0 ? totalDistM / durationS : 0;
  const maxMps = speeds.length ? Math.max(...speeds) : 0;
  const samplingS = effectiveSamplingIntervalSec(tms);
  state.stats = { totalDistM, durationS, avgMps, maxMps, samplingS };

  renderRoute();
  refreshSummary();
  (document.getElementById('btn_csv') as HTMLButtonElement).disabled = false;
  (document.getElementById('btn_gpx') as HTMLButtonElement).disabled = false;
}

function extractPoints(json: AnyGeo): { points: LatLngTime[]; meta: RouteMeta; timesMs: number[] } {
  const feature = getFirstFeature(json);
  const props = feature?.properties ?? json?.properties ?? {};
  const meta: RouteMeta = {
    label: props.route_label ?? props.label ?? props.name ?? json?.route_label ?? json?.label,
    direction: props.direction ?? json?.direction,
    startMs: parseMaybeTime(props.start_time ?? json?.start_time),
    endMs: parseMaybeTime(props.end_time ?? json?.end_time),
  };
  let points: LatLngTime[] = [];
  let timesMs: number[] = [];

  // 1) properties.polyline (Google encoded, precision 5)
  const encoded = props.polyline ?? json?.polyline;
  if (typeof encoded === 'string' && encoded.length > 0) {
    const arr = decodePolyline(encoded, 5);
    points = arr.map(([lat, lon]) => ({ lat, lon }));
  }

  // 2) geometry.coordinates fallback (LineString or array of [lon,lat(,time)])
  if (!points.length) {
    const geom = feature?.geometry ?? json?.geometry;
    if (geom?.type === 'LineString' && Array.isArray(geom.coordinates)) {
      points = (geom.coordinates as any[]).map((c: any) => ({ lat: c[1], lon: c[0], t: parseMaybeTime(c[2]) }));
    } else if (geom?.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      const first: any[] = (geom.coordinates as any[])[0] ?? [];
      points = first.map((c: any) => ({ lat: c[1], lon: c[0], t: parseMaybeTime(c[2]) }));
    } else if (Array.isArray(geom)) {
      // Raw array of coordinates
      points = (geom as any[]).map((c: any) => ({ lat: c[1], lon: c[0], t: parseMaybeTime(c[2]) }));
    }
  }

  // Collect times from per-point t if present
  if (points.some(p => typeof p.t === 'number')) {
    timesMs = points.map(p => (typeof p.t === 'number' ? p.t! : NaN));
    // If some NaNs, try to fill with even distribution between known bounds
    if (timesMs.some(t => !isFinite(t))) {
      const start = meta.startMs ?? timesMs.find(t => isFinite(t)) ?? Date.now();
      const end = meta.endMs ?? (isFinite(timesMs[timesMs.length - 1]) ? timesMs[timesMs.length - 1] : start + (points.length - 1) * 1000);
      timesMs = distributeEvenTimes(start, end, points.length);
    }
  }

  // Or from properties.timestamps array
  if (!timesMs.length) {
    const ts = props.timestamps ?? json?.timestamps;
    if (Array.isArray(ts) && ts.length === points.length) {
      const parsed = ts.map((v: any) => parseMaybeTime(v)).filter((v: any) => typeof v === 'number') as number[];
      if (parsed.length === points.length) timesMs = parsed;
    }
  }

  return { points, meta, timesMs };
}

function getFirstFeature(json: AnyGeo): AnyGeo | undefined {
  if (!json) return undefined;
  if (json.type === 'Feature') return json;
  if (json.type === 'FeatureCollection' && Array.isArray(json.features)) return json.features[0];
  if (json.geometry || json.properties) return json; // loosely treat as Feature-like
  return undefined;
}

function clearLayers() {
  if (!state.layers) return;
  state.layers.segments.clearLayers();
  state.layers.points.clearLayers();
  state.layers.arrows.clearLayers();
  state.layers.markers.clearLayers();
}

function renderRoute() {
  if (!state.map || !state.layers || !state.points.length) return;
  clearLayers();

  const { points, segSpeedsMps, cumDistM, timesMs } = state;
  const maxMps = state.stats?.maxMps ?? 1;

  // Segment-colored polyline
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const col = speedColor(segSpeedsMps[i] ?? 0, maxMps);
    const line = L.polyline([
      L.latLng(p1.lat, p1.lon),
      L.latLng(p2.lat, p2.lon),
    ], { color: col, weight: 5, opacity: 0.9 });
    line.addTo(state.layers.segments);
  }

  // Start (A) and End (B) markers
  const start = points[0];
  const end = points[points.length - 1];
  const aIcon = L.divIcon({ html: '<div class="marker-label" style="background:#2ecc71;color:#000">A</div>', className: '', iconAnchor: [12, 12] });
  const bIcon = L.divIcon({ html: '<div class="marker-label" style="background:#e74c3c;color:#000">B</div>', className: '', iconAnchor: [12, 12] });
  L.marker([start.lat, start.lon], { icon: aIcon }).addTo(state.layers.markers);
  L.marker([end.lat, end.lon], { icon: bIcon }).addTo(state.layers.markers);

  // Direction arrows at intervals by index
  addDirectionArrows();

  // Point markers for hover/click info
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const cm = L.circleMarker([p.lat, p.lon], { radius: 3, color: '#fff', weight: 1, fillOpacity: 0.7 });
    const segIdx = Math.min(i, segSpeedsMps.length - 1);
    const spd = segSpeedsMps[segIdx] ?? 0;
    const t = timesMs[i];
    const dist = cumDistM[i];
    const html = pointInfoHtml(i, t, dist, spd);
    cm.bindTooltip(html, { direction: 'top', sticky: true, opacity: 0.9 });
    cm.on('click', () => cm.bindPopup(html).openPopup());
    cm.addTo(state.layers.points);
  }

  // Fit bounds
  const latlngs = points.map(p => L.latLng(p.lat, p.lon));
  const bounds = L.latLngBounds(latlngs);
  state.map.fitBounds(bounds.pad(0.15));

  refreshLegend();
}

function addDirectionArrows() {
  if (!state.layers) return;
  const { points } = state;
  if (points.length < 2) return;

  const totalDist = state.cumDistM[state.cumDistM.length - 1] || 0;
  const desired = Math.min(20, Math.max(3, Math.floor(totalDist / 500)));
  const step = Math.max(1, Math.floor((points.length - 1) / desired));

  for (let i = 0; i < points.length - 1; i += step) {
    const p1 = points[i];
    const p2 = points[Math.min(i + 1, points.length - 1)];
    const mid = { lat: (p1.lat + p2.lat) / 2, lon: (p1.lon + p2.lon) / 2 };
    const brg = bearingDegrees(p1, p2);
    const icon = L.divIcon({ className: '', html: `<div class="arrow-icon" style="transform: rotate(${brg}deg)">➤</div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    L.marker([mid.lat, mid.lon], { icon }).addTo(state.layers.arrows);
  }
}

function pointInfoHtml(index: number, tMs: number, cumDistM: number, speedMps: number): string {
  const utc = formatTimeMs(tMs, 'UTC');
  const local = formatTimeMs(tMs, 'America/Chicago');
  const distText = formatDistance(cumDistM, state.unitSystem).text;
  const spdText = mpsToSpeedText(speedMps, state.unitSystem).text;
  return `<div>
    <div><b>#${index}</b></div>
    <div>Time UTC: ${utc}</div>
    <div>Time CT: ${local}</div>
    <div>Cum Dist: ${distText}</div>
    <div>Speed: ${spdText}</div>
  </div>`;
}

function refreshTooltips() {
  if (!state.layers) return;
  const pts = state.layers.points;
  pts.eachLayer((ly: any) => {
    if (ly instanceof L.CircleMarker) {
      const latlng = ly.getLatLng();
      const i = nearestPointIndex(latlng.lat, latlng.lng);
      if (i >= 0) {
        const html = pointInfoHtml(i, state.timesMs[i], state.cumDistM[i], state.segSpeedsMps[Math.min(i, state.segSpeedsMps.length - 1)] ?? 0);
        ly.bindTooltip(html, { direction: 'top', sticky: true, opacity: 0.9 });
      }
    }
  });
}

function nearestPointIndex(lat: number, lon: number): number {
  let best = -1; let bestD = Infinity;
  for (let i = 0; i < state.points.length; i++) {
    const d = haversineMeters({ lat, lon }, state.points[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function refreshSummary() {
  const labelEl = document.getElementById('route_label')!;
  const dirEl = document.getElementById('route_dir')!;
  const startEl = document.getElementById('start_times')!;
  const endEl = document.getElementById('end_times')!;
  const distEl = document.getElementById('sum_dist')!;
  const durEl = document.getElementById('sum_dur')!;
  const avgEl = document.getElementById('avg_spd')!;
  const maxEl = document.getElementById('max_spd')!;
  const sampEl = document.getElementById('samp_int')!;

  labelEl.textContent = state.meta.label ?? '—';
  dirEl.textContent = state.meta.direction ?? '—';

  if (state.timesMs.length) {
    const s = state.timesMs[0];
    const e = state.timesMs[state.timesMs.length - 1];
    startEl.textContent = `${formatTimeMs(s, 'UTC')} / ${formatTimeMs(s, 'America/Chicago')}`;
    endEl.textContent = `${formatTimeMs(e, 'UTC')} / ${formatTimeMs(e, 'America/Chicago')}`;
  } else {
    startEl.textContent = '—';
    endEl.textContent = '—';
  }

  if (state.stats) {
    const { totalDistM, durationS, avgMps, maxMps, samplingS } = state.stats;
    distEl.textContent = formatDistance(totalDistM, state.unitSystem).text;
    durEl.textContent = formatDuration(durationS);
    avgEl.textContent = mpsToSpeedText(avgMps, state.unitSystem).text;
    maxEl.textContent = mpsToSpeedText(maxMps, state.unitSystem).text;
    sampEl.textContent = `${samplingS.toFixed(1)} s`;
  } else {
    distEl.textContent = durEl.textContent = avgEl.textContent = maxEl.textContent = sampEl.textContent = '—';
  }
}

function exportCSV() {
  // index, lat, lon, timestamp, cum_distance_m, speed_mps
  const lines = ['index,lat,lon,timestamp,cum_distance_m,speed_mps'];
  const n = state.points.length;
  for (let i = 0; i < n; i++) {
    const p = state.points[i];
    const t = state.timesMs[i];
    const cum = state.cumDistM[i] ?? 0;
    const spd = state.segSpeedsMps[Math.min(i, n - 2)] ?? 0;
    lines.push(`${i},${p.lat.toFixed(6)},${p.lon.toFixed(6)},${isoUtc(t)},${cum.toFixed(3)},${spd.toFixed(3)}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  triggerDownload(blob, (state.meta.label || 'route') + '.csv');
}

function exportGPX() {
  const name = state.meta.label || 'route';
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="GeoInterp" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
  lines.push(`<trk><name>${escapeXml(name)}</name>`);
  if (state.meta.direction) lines.push(`<desc>${escapeXml(state.meta.direction!)}</desc>`);
  lines.push('<trkseg>');
  for (let i = 0; i < state.points.length; i++) {
    const p = state.points[i];
    const t = state.timesMs[i];
    lines.push(`<trkpt lat="${p.lat}" lon="${p.lon}"><time>${isoUtc(t)}</time></trkpt>`);
  }
  lines.push('</trkseg></trk></gpx>');
  const blob = new Blob([lines.join('')], { type: 'application/gpx+xml' });
  triggerDownload(blob, (state.meta.label || 'route') + '.gpx');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Bootstrap
buildLayout();
initMap();

