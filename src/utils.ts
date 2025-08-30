export type UnitSystem = 'imperial' | 'metric';

export interface LatLngTime {
  lat: number;
  lon: number;
  t?: number; // epoch ms
}

export function decodePolyline(str: string, precision = 5): [number, number][] {
  // Returns [lat, lon] pairs
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = Math.pow(10, precision);

  while (index < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlon = (result & 1) ? ~(result >> 1) : (result >> 1);
    lon += dlon;

    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

export function toRad(x: number): number { return (x * Math.PI) / 180; }

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000; // meters
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const λ1 = toRad(a.lon);
  const λ2 = toRad(b.lon);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  let deg = (θ * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function cumulativeDistancesMeters(points: LatLngTime[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineMeters(points[i - 1], points[i]);
  }
  return cum;
}

export function computeSegmentSpeedsMps(timesMs: number[], cumDistM: number[]): number[] {
  // Segment speeds between point i and i+1, length = n-1. If dt <= 0 -> 0
  const n = timesMs.length;
  const speeds: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dt = (timesMs[i + 1] - timesMs[i]) / 1000; // s
    const dd = cumDistM[i + 1] - cumDistM[i]; // m
    speeds[i] = dt > 0 ? dd / dt : 0;
  }
  return speeds;
}

export function effectiveSamplingIntervalSec(timesMs: number[]): number {
  if (timesMs.length < 2) return 0;
  const dts: number[] = [];
  for (let i = 0; i < timesMs.length - 1; i++) dts.push((timesMs[i + 1] - timesMs[i]) / 1000);
  dts.sort((a, b) => a - b);
  const mid = Math.floor(dts.length / 2);
  return dts.length % 2 ? dts[mid] : (dts[mid - 1] + dts[mid]) / 2;
}

export function parseMaybeTime(input: unknown): number | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number') {
    // Heuristic: if it's in seconds since epoch (< 10^12), convert to ms
    return input < 1e12 ? input * 1000 : input;
  }
  if (typeof input === 'string') {
    const ms = Date.parse(input);
    return isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

export function distributeEvenTimes(startMs: number, endMs: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [startMs];
  const times: number[] = new Array(n);
  const step = (endMs - startMs) / (n - 1);
  for (let i = 0; i < n; i++) times[i] = Math.round(startMs + step * i);
  return times;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [] as string[];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${r}s`);
  return parts.join(' ');
}

export function formatDistance(distanceMeters: number, units: UnitSystem): { text: string; value: number; unit: string } {
  if (!isFinite(distanceMeters)) return { text: '—', value: 0, unit: '' };
  if (units === 'imperial') {
    const miles = distanceMeters / 1609.344;
    if (miles >= 1) return { text: `${miles.toFixed(2)} mi`, value: miles, unit: 'mi' };
    const feet = distanceMeters / 0.3048;
    return { text: `${feet.toFixed(0)} ft`, value: feet, unit: 'ft' };
  } else {
    const km = distanceMeters / 1000;
    if (km >= 1) return { text: `${km.toFixed(2)} km`, value: km, unit: 'km' };
    return { text: `${distanceMeters.toFixed(0)} m`, value: distanceMeters, unit: 'm' };
  }
}

export function mpsToSpeedText(mps: number, units: UnitSystem): { text: string; value: number; unit: string } {
  if (!isFinite(mps)) return { text: '—', value: 0, unit: '' };
  if (units === 'imperial') {
    const mph = mps * 2.23693629;
    return { text: `${mph.toFixed(2)} mph`, value: mph, unit: 'mph' };
  } else {
    const kph = mps * 3.6;
    return { text: `${kph.toFixed(2)} km/h`, value: kph, unit: 'km/h' };
  }
}

export function formatTimeMs(ms: number, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat([], {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    return fmt.format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

export function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

export function speedColor(mps: number, maxMps: number): string {
  // Map 0..max to blue->cyan->yellow->red via HSL (240 -> 0)
  const clamped = Math.max(0, Math.min(maxMps || 1, mps));
  const t = clamped / (maxMps || 1);
  // 240 (blue) to 0 (red)
  const hue = 240 * (1 - t);
  return `hsl(${hue.toFixed(0)}, 90%, 50%)`;
}

export function average(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

