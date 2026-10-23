// Small geometry toolkit: vertex-coloured part merging and helpers.
import * as THREE from 'three';

const _c = new THREE.Color();

// Colour an entire geometry (converted to non-indexed) with one colour + optional jitter.
export function colorize(geo, color, jitter = 0, rng = Math.random) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rng() - 0.5) * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      arr[(i + k) * 3] = _c.r * j;
      arr[(i + k) * 3 + 1] = _c.g * j;
      arr[(i + k) * 3 + 2] = _c.b * j;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Apply a vertical colour gradient (multiplies existing colours).
export function shadeVertical(geo, bottomMul, topMul) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const p = geo.attributes.position.array, c = geo.attributes.color.array;
  const span = max.y - min.y || 1;
  for (let i = 0; i < p.length; i += 3) {
    const t = (p[i + 1] - min.y) / span;
    const m = bottomMul + (topMul - bottomMul) * t;
    c[i] *= m; c[i + 1] *= m; c[i + 2] *= m;
  }
  return geo;
}

// Merge a list of non-indexed geometries that each carry position/normal/color.
export function mergeColored(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

// Transform helper: position, euler rotation, scale.
export function xf(geo, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
// Tapered cylinder between two points.
export function cylinderBetween(a, b, r1, r2, seg = 6, color = 0xffffff) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(_up, _dir.normalize());
  _m.compose(a, _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return colorize(g, color);
}

// Ellipsoid (sphere scaled) at position.
export function ellipsoid(px, py, pz, sx, sy, sz, color, ws = 10, hs = 8, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  xf(g, px, py, pz, rx, ry, rz, sx, sy, sz);
  return colorize(g, color);
}

// Deterministic per-position jitter keeps shared vertices together (no cracks).
export function jitterVertices(geo, amount, seed = 1) {
  const p = geo.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const h = Math.sin(p[i] * 12.9898 + p[i + 1] * 78.233 + p[i + 2] * 37.719 + seed) * 43758.5453;
    const h2 = Math.sin(p[i] * 93.989 + p[i + 1] * 67.345 + p[i + 2] * 12.345 + seed) * 24634.6345;
    const h3 = Math.sin(p[i] * 45.332 + p[i + 1] * 18.233 + p[i + 2] * 98.112 + seed) * 35724.2346;
    p[i] += ((h - Math.floor(h)) - 0.5) * amount;
    p[i + 1] += ((h2 - Math.floor(h2)) - 0.5) * amount;
    p[i + 2] += ((h3 - Math.floor(h3)) - 0.5) * amount;
  }
  geo.computeVertexNormals();
  return geo;
}
