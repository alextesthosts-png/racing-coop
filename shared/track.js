// Shared track definition used by both the server (bots, missiles) and the client (rendering, physics).
export const ROAD_WIDTH = 22;
export const LAPS = 3;
export const MAX_RACERS = 8;
export const POINTS = [15, 12, 10, 8, 7, 6, 5, 4];

// Control points (x, z) of the closed circuit. The start line sits at the first point.
const CTRL = [
  [-80, 0], [0, 0], [80, 0], [150, -20], [195, -80], [175, -150], [115, -175],
  [70, -135], [20, -120], [-20, -170], [-80, -205], [-160, -185], [-205, -110],
  [-185, -40], [-140, 0],
];

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function buildTrack(spacing = 2) {
  const n = CTRL.length, SEG = 60, raw = [];
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    for (let s = 0; s < SEG; s++) {
      const t = s / SEG;
      raw.push({ x: cr(p0[0], p1[0], p2[0], p3[0], t), z: cr(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  // cumulative length (closed)
  const cum = [0];
  for (let i = 1; i <= raw.length; i++) {
    const a = raw[i - 1], b = raw[i % raw.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const L = cum[raw.length];
  const M = Math.round(L / spacing);
  const sp = L / M;
  const pts = [];
  let j = 0;
  for (let k = 0; k < M; k++) {
    const d = k * sp;
    while (cum[j + 1] < d) j++;
    const a = raw[j], b = raw[(j + 1) % raw.length];
    const f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }
  for (let k = 0; k < M; k++) {
    const a = pts[(k - 1 + M) % M], b = pts[(k + 1) % M];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    pts[k].tx = tx; pts[k].tz = tz;
    // normal points to the kart's LEFT (forward = (sin h, cos h), h grows to the left)
    pts[k].nx = tz; pts[k].nz = -tx;
  }
  return { pts, length: L, spacing: sp, count: M };
}

const mod = (a, n) => ((a % n) + n) % n;

export function pointAt(track, dist, lat = 0) {
  const d = mod(dist, track.length);
  const i = Math.floor(d / track.spacing) % track.count;
  const f = d / track.spacing - Math.floor(d / track.spacing);
  const a = track.pts[i], b = track.pts[(i + 1) % track.count];
  const tx = a.tx + (b.tx - a.tx) * f, tz = a.tz + (b.tz - a.tz) * f;
  const nx = a.nx + (b.nx - a.nx) * f, nz = a.nz + (b.nz - a.nz) * f;
  return {
    x: a.x + (b.x - a.x) * f + nx * lat,
    z: a.z + (b.z - a.z) * f + nz * lat,
    h: Math.atan2(tx, tz),
  };
}

export function nearest(track, x, z, hint = -1) {
  const { pts, count } = track;
  let best = -1, bd = Infinity;
  const scan = (i) => {
    const p = pts[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  };
  if (hint >= 0) {
    for (let o = -45; o <= 45; o++) scan(mod(hint + o, count));
    if (bd > 60 * 60) for (let i = 0; i < count; i++) scan(i);
  } else {
    for (let i = 0; i < count; i++) scan(i);
  }
  const p = pts[best];
  const lat = (x - p.x) * p.nx + (z - p.z) * p.nz;
  return { i: best, lat, dist: Math.sqrt(bd) };
}

export function itemBoxes(track) {
  const out = [];
  for (const frac of [0.12, 0.37, 0.6, 0.84]) {
    for (const lat of [-7.5, -2.5, 2.5, 7.5]) {
      const p = pointAt(track, frac * track.length, lat);
      out.push({ x: p.x, z: p.z });
    }
  }
  return out;
}

export function gridSlot(track, slot) {
  const back = 10 + Math.floor(slot / 2) * 8;
  const lat = slot % 2 ? -5 : 5;
  const p = pointAt(track, track.length - back, lat);
  return { x: p.x, z: p.z, h: p.h, dist: -back, lat };
}
