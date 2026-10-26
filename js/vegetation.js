// Instanced, chunked vegetation (trees, bushes, rocks, grass, flowers) + spatial hash for collisions.
import * as THREE from 'three';
import { enhanceShader, SurfaceDetail } from './surface.js';
import { colorize, mergeColored, xf, jitterVertices, shadeVertical } from './geo.js';
import { mulberry32, smoothstep, noise2 } from './utils.js';
import { HALF, riverDistance, MEADOWS } from './terrain.js';

const CHUNK = 80;          // tree chunk size
const GRASS_CHUNK = 40;
const HASH = 8;            // collision hash cell size

function makePine(rng) {
  const parts = [];
  parts.push(colorize(xf(new THREE.CylinderGeometry(0.11, 0.24, 3, 6), 0, 1.5, 0), 0x4a3424));
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 1.9 - t * 1.25, h = 2.4 - t * 0.7;
    const g = new THREE.ConeGeometry(r, h, 8, 1);
    xf(g, 0, 2.0 + i * 1.35 + h / 2, 0, 0, i * 0.7, 0);
    jitterVertices(g, 0.18, i + 3);
    const shade = [0x1f3d22, 0x23452a, 0x284d2c, 0x2e5531][i];
    parts.push(shadeVertical(colorize(g, shade, 0.12, rng), 0.7, 1.1));
  }
  return mergeColored(parts);
}

function makeBroadleaf(rng) {
  const parts = [];
  parts.push(colorize(xf(new THREE.CylinderGeometry(0.16, 0.3, 3.4, 7), 0, 1.7, 0), 0x51402e));
  parts.push(colorize(xf(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 5), 0.5, 3.4, 0, 0, 0, -0.7), 0x51402e));
  const blobs = [[0, 4.6, 0, 1.9], [1.0, 4.1, 0.6, 1.4], [-0.9, 4.3, -0.5, 1.5], [0.2, 5.6, -0.2, 1.3], [-0.3, 4.0, 1.0, 1.2]];
  blobs.forEach((b, i) => {
    const g = new THREE.IcosahedronGeometry(b[3], 1);
    xf(g, b[0], b[1], b[2], 0, 0, 0, 1, 0.85, 1);
    jitterVertices(g, 0.35, i * 7 + 1);
    parts.push(shadeVertical(colorize(g, [0x3b5e27, 0x46692c, 0x3f6329][i % 3], 0.15, rng), 0.65, 1.15));
  });
  return mergeColored(parts);
}

function makeBirch(rng) {
  const parts = [];
  const trunk = colorize(xf(new THREE.CylinderGeometry(0.09, 0.15, 6, 6, 6), 0, 3, 0), 0xdcd8cc);
  // dark lenticel bands
  const c = trunk.attributes.color.array, p = trunk.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) {
    if (Math.sin(p[i + 1] * 7.3 + p[i] * 20) > 0.55) {
      for (let k = 0; k < 9; k++) c[i + k] *= 0.35;
    }
  }
  parts.push(trunk);
  const blobs = [[0, 6.2, 0, 1.3], [0.6, 5.3, 0.3, 1.0], [-0.5, 5.5, -0.3, 1.0], [0.1, 4.6, 0.5, 0.8]];
  blobs.forEach((b, i) => {
    const g = new THREE.IcosahedronGeometry(b[3], 1);
    xf(g, b[0], b[1], b[2], 0, 0, 0, 0.9, 1.1, 0.9);
    jitterVertices(g, 0.3, i * 3 + 11);
    parts.push(shadeVertical(colorize(g, [0x6f8c34, 0x7a963a][i % 2], 0.15, rng), 0.7, 1.15));
  });
  return mergeColored(parts);
}

function makeBush(rng) {
  const parts = [];
  const blobs = [[0, 0.45, 0, 0.6], [0.45, 0.35, 0.2, 0.45], [-0.4, 0.38, -0.15, 0.5], [0.05, 0.4, -0.45, 0.42]];
  blobs.forEach((b, i) => {
    const g = new THREE.IcosahedronGeometry(b[3], 1);
    xf(g, b[0], b[1], b[2]);
    jitterVertices(g, 0.15, i + 21);
    parts.push(shadeVertical(colorize(g, [0x355a26, 0x3e6229][i % 2], 0.18, rng), 0.6, 1.1));
  });
  return mergeColored(parts);
}

function makeRock(rng) {
  const g = new THREE.DodecahedronGeometry(1, 1);
  xf(g, 0, 0.25, 0, 0, 0, 0, 1, 0.6, 1);
  jitterVertices(g, 0.35, 5);
  return shadeVertical(colorize(g, 0x77736b, 0.12, rng), 0.7, 1.1);
}

// ---------- detailed models for trees close to the camera ----------
const _vc = new THREE.Color(), _vc2 = new THREE.Color();
// colour each vertex from its position and normal
function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  const col = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    _vc.setHex(fn(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2]));
    col[i] = _vc.r; col[i + 1] = _vc.g; col[i + 2] = _vc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const mixC = (a, b, t) => _vc2.setHex(a).lerp(_vc.setHex(b), Math.max(0, Math.min(1, t))).getHex();
const hashN = (x, y, z) => { const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return h - Math.floor(h); };

// Conifer: tapered trunk and drooping, star-edged branch layers that lighten towards the tips
function makePineHi() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.27, 3.4, 9, 3);
  trunk.translate(0, 1.7, 0);
  parts.push(paint(trunk, (x, y, z) => mixC(0x3e2c1e, 0x5a4230, hashN(Math.round(Math.atan2(z, x) * 3), 0, 0) * 0.8)));
  const flare = new THREE.ConeGeometry(0.42, 0.5, 9, 1, true);
  flare.translate(0, 0.2, 0);
  parts.push(paint(flare, () => 0x3a2a1c));
  const layers = 7;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = 2.05 - t * 1.6, h = 1.9 - t * 0.85, y0 = 1.7 + i * 0.95;
    const g = new THREE.ConeGeometry(r, h, 10, 2, false);
    const pa = g.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k);
      const rr = Math.hypot(x, z);
      if (rr < 1e-4) continue;
      const a = Math.atan2(z, x), star = ((Math.round((a / (Math.PI * 2)) * 10) % 2) + 2) % 2 ? 1.16 : 0.84;
      const rim = y < -h / 2 + 1e-3, mid = Math.abs(y) < 1e-3;
      const f = rim ? star : mid ? 1.06 : 1;
      pa.setXYZ(k, x * f, y - (rim ? 0.32 * star : mid ? 0.08 : 0), z * f);
    }
    g.rotateY(i * 0.55);
    g.translate(0, y0 + h / 2, 0);
    g.computeVertexNormals();
    const dark = [0x1b3a20, 0x1f4024, 0x234628, 0x274c2b, 0x2a512e, 0x2e5732, 0x325c35][i];
    parts.push(paint(g, (x, y, z) => {
      const rr = Math.hypot(x, z) / r;
      return mixC(mixC(dark, 0x0f2414, 0.35), mixC(dark, 0x5a7a3a, 0.45), rr * rr + (hashN(x, y, z) - 0.5) * 0.15);
    }));
  }
  const tip = new THREE.ConeGeometry(0.22, 1.0, 7);
  tip.translate(0, 1.7 + layers * 0.95 + 0.5, 0);
  parts.push(paint(tip, () => 0x3a6038));
  return mergeColored(parts);
}

// Broadleaf: root flare, a forked trunk and a crown of clumps, sunlit on top and dark inside
function makeBroadleafHi() {
  const parts = [];
  const bark = (x, y, z) => mixC(0x4a3a2a, 0x5e4c38, hashN(Math.round(x * 30), Math.round(y * 6), Math.round(z * 30)));
  const trunk = new THREE.CylinderGeometry(0.17, 0.32, 3.2, 10, 4);
  trunk.translate(0, 1.6, 0);
  parts.push(paint(trunk, bark));
  const flare = new THREE.ConeGeometry(0.55, 0.6, 10, 1, true);
  flare.translate(0, 0.25, 0);
  parts.push(paint(flare, () => 0x3e3022));
  const branches = [[0.9, 4.6, 0.5], [-0.8, 4.8, -0.4], [0.1, 5.3, -0.7], [-0.3, 4.4, 0.9]];
  for (const [x, y, z] of branches) parts.push(paint(cylinderBetweenG(new THREE.Vector3(0, 3.0, 0), new THREE.Vector3(x, y, z), 0.13, 0.05, 6), bark));
  const clumps = [[0, 5.1, 0, 1.55], [1.15, 4.6, 0.6, 1.2], [-1.0, 4.8, -0.5, 1.25], [0.2, 5.9, -0.4, 1.15], [-0.35, 4.4, 1.0, 1.1], [0.9, 5.5, -0.7, 1.0], [-1.0, 5.6, 0.5, 1.0], [0.4, 4.2, -1.0, 0.95], [0.0, 6.4, 0.3, 0.85]];
  clumps.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    xf(g, x, y, z, 0, i, 0, 1, 0.82, 1);
    jitterVertices(g, 0.32, i * 7 + 1);
    const base = [0x3b5e27, 0x46692c, 0x3f6329, 0x4a6e2e][i % 4];
    parts.push(paint(g, (px, py, pz, nx, ny) => {
      const sun = ny * 0.5 + 0.5, height = (py - 3.8) / 3;
      return mixC(mixC(base, 0x1e3414, 0.55), mixC(base, 0x88a050, 0.35), sun * 0.7 + height * 0.3 + (hashN(px, py, pz) - 0.5) * 0.2);
    }));
  });
  return mergeColored(parts);
}

// Birch: slender, slightly leaning white trunk with black marks and a light, drooping crown
function makeBirchHi() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.15, 6.2, 8, 10);
  const pa = trunk.attributes.position;
  for (let k = 0; k < pa.count; k++) { const y = pa.getY(k) + 3.1; pa.setX(k, pa.getX(k) + y * y * 0.006); }
  trunk.translate(0, 3.1, 0);
  trunk.computeVertexNormals();
  parts.push(paint(trunk, (x, y, z) => {
    const mark = Math.sin(y * 7.3 + Math.atan2(z, x) * 2) > 0.62 || (y < 1.2 && hashN(x, Math.round(y * 8), z) > 0.55);
    return mark ? 0x2a2622 : mixC(0xe6e2d6, 0xc8c2b4, hashN(Math.round(x * 40), Math.round(y * 10), Math.round(z * 40)));
  }));
  const clumps = [[0.25, 6.3, 0, 1.2], [0.85, 5.4, 0.3, 0.95], [-0.35, 5.6, -0.35, 0.95], [0.4, 4.7, 0.55, 0.8], [-0.2, 4.9, 0.4, 0.75], [0.7, 6.0, -0.5, 0.8], [0.15, 7.0, 0.1, 0.65]];
  clumps.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    xf(g, x, y, z, 0, i * 1.3, 0, 0.88, 1.2, 0.88);
    jitterVertices(g, 0.26, i * 3 + 11);
    parts.push(paint(g, (px, py, pz, nx, ny) => mixC(mixC(0x6f8c34, 0x3a5420, 0.5), mixC(0x7a963a, 0xc0c870, 0.4), (ny * 0.5 + 0.5) * 0.8 + (hashN(px, py, pz) - 0.5) * 0.25)));
  });
  return mergeColored(parts);
}

function makeBushHi() {
  const parts = [];
  const blobs = [[0, 0.5, 0, 0.62], [0.5, 0.38, 0.22, 0.46], [-0.45, 0.4, -0.18, 0.5], [0.08, 0.42, -0.5, 0.44], [-0.2, 0.3, 0.45, 0.4], [0.42, 0.3, -0.35, 0.36], [-0.05, 0.75, 0.1, 0.38]];
  blobs.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    xf(g, x, y, z, 0, i, 0, 1, 0.85, 1);
    jitterVertices(g, 0.14, i + 21);
    parts.push(paint(g, (px, py, pz, nx, ny) => mixC(0x1e3a16, mixC([0x355a26, 0x3e6229][i % 2], 0x7a9a48, 0.3), 0.35 + (ny * 0.5 + 0.5) * 0.55 + (hashN(px, py, pz) - 0.5) * 0.2)));
  });
  return mergeColored(parts);
}

function makeRockHi() {
  const g = new THREE.DodecahedronGeometry(1, 2);
  xf(g, 0, 0.25, 0, 0, 0, 0, 1, 0.6, 1);
  jitterVertices(g, 0.3, 5);
  return paint(g, (x, y, z, nx, ny) => {
    const stone = mixC(0x5e5b55, 0x8a867c, hashN(Math.round(x * 6), Math.round(y * 6), Math.round(z * 6)) * 0.8 + 0.1);
    return mixC(stone, 0x4a6030, Math.max(0, (ny - 0.55) / 0.45) * 0.85);
  });
}

// tapered cylinder between two points, uncoloured (paint() colours it)
function cylinderBetweenG(a, b, r1, r2, seg) {
  const dir = b.clone().sub(a), len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

function makeGrassTuft(rng) {
  // nine curved blades, each a quad and a tip, dark at the root and pale at the tip
  const pos = [], col = [];
  const base = new THREE.Color(0x2e4a18), mid = new THREE.Color(0x58782c), tip = new THREE.Color(0x9cae54);
  const push = (p, c) => { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); };
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.3 + rng() * 0.45, w = 0.03 + rng() * 0.015;
    const ba = rng() * Math.PI;
    const dx = Math.cos(ba) * w, dz = Math.sin(ba) * w;
    const la = rng() * Math.PI * 2, lean = 0.08 + rng() * 0.18;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const b0 = [x - dx, 0, z - dz], b1 = [x + dx, 0, z + dz];
    const m0 = [x - dx * 0.6 + lx * 0.35, h * 0.55, z - dz * 0.6 + lz * 0.35], m1 = [x + dx * 0.6 + lx * 0.35, h * 0.55, z + dz * 0.6 + lz * 0.35];
    const t = [x + lx, h, z + lz];
    const tint = 0.85 + rng() * 0.3, mc = mid.clone().multiplyScalar(tint), tc = tip.clone().multiplyScalar(tint);
    push(b0, base); push(b1, base); push(m0, mc);
    push(b1, base); push(m1, mc); push(m0, mc);
    push(m0, mc); push(m1, mc); push(t, tc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Normals pointing up give soft, uniform lighting on blades
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) { n[i] = 0; n[i + 1] = 1; n[i + 2] = 0; }
  return g;
}

// Fern: fronds arching out from the centre, each a tapering strip of leaflets
function makeFern() {
  const pos = [], col = [];
  const dark = new THREE.Color(0x24461c), light = new THREE.Color(0x6a9a3a);
  const fronds = 9;
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + (k % 2) * 0.2;
    const len = 0.75 + (k % 3) * 0.15, rise = 0.45 + (k % 2) * 0.12;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const steps = 5;
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = dx * len * t, z = dz * len * t, y = Math.sin(t * Math.PI * 0.85) * rise * (1 - t * 0.25) + 0.02;
      const w = 0.11 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.012;
      const L = [x + px * w, y - 0.02, z + pz * w], R = [x - px * w, y - 0.02, z - pz * w], C = [x, y, z];
      const c = dark.clone().lerp(light, t * 0.8 + 0.1);
      if (prev) {
        for (const [p0, p1, p2] of [[prev.L, prev.C, L], [prev.C, C, L], [prev.C, prev.R, C], [prev.R, R, C]]) {
          pos.push(...p0, ...p1, ...p2);
          for (let q = 0; q < 3; q++) col.push(c.r, c.g, c.b);
        }
      }
      prev = { L, R, C };
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) { n[i] *= 0.3; n[i + 1] = Math.abs(n[i + 1]) * 0.7 + 0.5; n[i + 2] *= 0.3; }
  return g;
}

// Fallen log: bark, a mossy top and pale broken ends
function makeLog() {
  const g = new THREE.CylinderGeometry(0.2, 0.24, 3.2, 10, 4);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.2, 0);
  const parts = [paint(g, (x, y, z, nx, ny) => {
    const end = Math.abs(nx) > 0.9;
    if (end) return mixC(0x9a8058, 0x6a5238, Math.hypot(y - 0.2, z) * 4);
    const moss = Math.max(0, ny - 0.45) * 1.6 * (0.6 + 0.4 * Math.sin(x * 3.1));
    return mixC(mixC(0x4a3a2a, 0x5e4a36, hashN(Math.round(x * 6), Math.round(Math.atan2(z, y - 0.2) * 3), 1)), 0x4a6a2a, moss);
  })];
  const br = new THREE.CylinderGeometry(0.04, 0.07, 0.7, 6);
  br.translate(0, 0.35, 0); br.rotateZ(-0.9); br.translate(0.6, 0.25, 0.1);
  parts.push(paint(br, () => 0x4e3e2c));
  return mergeColored(parts);
}

// Tree stump with a cut top showing growth rings
function makeStump() {
  const g = new THREE.CylinderGeometry(0.3, 0.42, 0.55, 12, 1);
  g.translate(0, 0.27, 0);
  const parts = [paint(g, (x, y, z, nx, ny) => {
    if (ny > 0.9) { const r = Math.hypot(x, z); return Math.sin(r * 60) > 0.3 ? 0xb0905e : 0x8e7048; }
    return mixC(0x4a3a2a, 0x5e4a36, hashN(Math.round(Math.atan2(z, x) * 4), Math.round(y * 8), 2));
  })];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7, root = new THREE.ConeGeometry(0.1, 0.5, 5);
    root.rotateZ(Math.PI / 2 + 0.9); root.translate(Math.cos(a) * 0.38, 0.06, Math.sin(a) * 0.38);
    root.rotateY(-a);
    parts.push(paint(root, () => 0x4a3a2a));
  }
  return mergeColored(parts);
}

function makeFlower() {
  const parts = [];
  parts.push(colorize(xf(new THREE.CylinderGeometry(0.008, 0.01, 0.35, 3), 0, 0.175, 0), 0x4a6a2a));
  parts.push(colorize(xf(new THREE.OctahedronGeometry(0.045, 0), 0, 0.36, 0, 0, 0, 0, 1, 0.5, 1), 0xffffff));
  parts.push(colorize(xf(new THREE.CylinderGeometry(0.008, 0.01, 0.28, 3), 0.08, 0.14, 0.03), 0x4a6a2a));
  parts.push(colorize(xf(new THREE.OctahedronGeometry(0.04, 0), 0.08, 0.29, 0.03, 0, 0, 0, 1, 0.5, 1), 0xffffff));
  return mergeColored(parts);
}

function addSway(material, strength, uniforms) {
  material.onBeforeCompile = (shader) => {
    if (SurfaceDetail.enabled && material.userData.detailKind) enhanceShader(shader, material.userData.detailKind);
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform vec2 uWind;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29;
      #else
        float ph = 0.0;
      #endif
      float sway = (sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.7) * 0.4) * ${strength.toFixed(3)} * (0.4 + length(uWind) * 0.12);
      #ifdef USE_INSTANCING
        vec2 wpos = instanceMatrix[3].xz;
      #else
        vec2 wpos = vec2(0.0);
      #endif
      float wl = length(uWind) + 1e-4;
      float gust = smoothstep(0.35, 1.0, sin(dot(wpos, uWind / wl) * 0.09 - uTime * 1.5) * 0.5 + 0.5) * min(wl, 8.0);
      transformed.x += (sway + uWind.x * 0.015 + gust * uWind.x / wl * ${(strength * 0.9).toFixed(3)}) * position.y;
      transformed.z += (sway * 0.6 + uWind.y * 0.015 + gust * uWind.y / wl * ${(strength * 0.9).toFixed(3)}) * position.y;`
    );
  };
}

export class Vegetation {
  constructor(scene, terrain, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.hash = new Map();
    this.bushes = [];           // positions used by rabbits for hiding
    this.chunks = [];
    this.grassChunks = [];
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) } };
    const rng = mulberry32(777);

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.treeMat.userData.detailKind = 'foliage';
    addSway(this.treeMat, 0.012, this.uniforms);
    this.bushMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.bushMat.userData.detailKind = 'foliage';
    addSway(this.bushMat, 0.04, this.uniforms);
    this.grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.grassMat.userData.noDetail = true;
    addSway(this.grassMat, 0.12, this.uniforms);
    this.flowerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.flowerMat.userData.noDetail = true;
    addSway(this.flowerMat, 0.1, this.uniforms);

    // light models for distance, detailed ones for trees near the camera
    this.geos = {
      pine: makePine(rng), broad: makeBroadleaf(rng), birch: makeBirch(rng),
      bush: makeBush(rng), rock: makeRock(rng),
    };
    this.geos.fern = makeFern(); this.geos.log = makeLog(); this.geos.stump = makeStump();
    this.geosHi = { pine: makePineHi(), broad: makeBroadleafHi(), birch: makeBirchHi(), bush: makeBushHi(), rock: makeRockHi(), fern: this.geos.fern, log: this.geos.log, stump: this.geos.stump };
    this.fernMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.fernMat.userData.noDetail = true;
    addSway(this.fernMat, 0.06, this.uniforms);
    this.hiDist = quality.shadows ? 12 : -1e9; // no detailed trees on the low setting
    this.grassGeo = makeGrassTuft(rng);
    this.flowerGeo = makeFlower();

    this.place(rng, quality);
  }

  addToHash(item) {
    const k = this.key(Math.floor(item.x / HASH), Math.floor(item.z / HASH));
    let arr = this.hash.get(k);
    if (!arr) { arr = []; this.hash.set(k, arr); }
    arr.push(item);
  }
  key(cx, cz) { return (cx + 1000) * 4096 + (cz + 1000); }

  place(rng, quality) {
    const T = this.terrain;
    const nC = Math.ceil((HALF * 2) / CHUNK);
    const buckets = {};
    const bucket = (type, x, z) => {
      const cx = Math.floor((x + HALF) / CHUNK), cz = Math.floor((z + HALF) / CHUNK);
      const k = `${type}:${cx}:${cz}`;
      if (!buckets[k]) buckets[k] = { type, cx, cz, items: [] };
      return buckets[k].items;
    };

    // Trees on a jittered grid
    const step = 4.2;
    for (let z = -HALF + 4; z < HALF - 4; z += step) {
      for (let x = -HALF + 4; x < HALF - 4; x += step) {
        const px = x + (rng() - 0.5) * step * 0.9, pz = z + (rng() - 0.5) * step * 0.9;
        const d = T.densityAt(px, pz);
        const lone = 0.012;
        if (rng() > d * 0.8 + lone) continue;
        const h = T.getHeight(px, pz);
        if (h < 0.7) continue;
        const slopeN = new THREE.Vector3();
        T.getNormal(px, pz, slopeN);
        if (slopeN.y < 0.72) continue;
        const nv = noise2(px * 0.02 + 33, pz * 0.02) * 0.5 + 0.5;
        const ridge = smoothstep(95, 40, Math.hypot(px + 150, pz + 130));
        let type;
        if (ridge > 0.3 || h > 17 || nv > 0.66) type = 'pine';
        else if (nv < 0.25 && riverDistance(px, pz) < 45) type = 'birch';
        else type = rng() < 0.22 ? 'pine' : 'broad';
        const s = 0.75 + rng() * 0.65;
        bucket(type, px, pz).push({ x: px, y: h - 0.1, z: pz, s, r: rng() * Math.PI * 2 });
        const trunkR = (type === 'broad' ? 0.3 : type === 'pine' ? 0.24 : 0.15) * s + 0.08;
        this.addToHash({ x: px, z: pz, r: trunkR, h: (type === 'pine' ? 5 : 4) * s, kind: 'tree' });
      }
    }

    // Bushes: edges of forest and meadows
    for (let i = 0; i < 2600; i++) {
      const px = (rng() * 2 - 1) * (HALF - 10), pz = (rng() * 2 - 1) * (HALF - 10);
      const d = T.densityAt(px, pz);
      const edge = 1 - Math.abs(d - 0.45) * 2;
      if (rng() > edge * 0.7 + 0.05) continue;
      const h = T.getHeight(px, pz);
      if (h < 0.6) continue;
      const s = 0.7 + rng() * 0.9;
      bucket('bush', px, pz).push({ x: px, y: h - 0.05, z: pz, s, r: rng() * 6.28 });
      this.bushes.push({ x: px, z: pz });
    }

    // Rocks
    for (let i = 0; i < 520; i++) {
      const px = (rng() * 2 - 1) * (HALF - 6), pz = (rng() * 2 - 1) * (HALF - 6);
      const h = T.getHeight(px, pz);
      if (h < -0.5) continue;
      const ridge = smoothstep(110, 40, Math.hypot(px + 150, pz + 130));
      const nearRiver = smoothstep(25, 6, riverDistance(px, pz));
      if (rng() > 0.35 + ridge * 0.5 + nearRiver * 0.4) continue;
      const big = rng() < 0.15;
      const s = big ? 1.4 + rng() * 1.8 : 0.3 + rng() * 0.7;
      bucket('rock', px, pz).push({ x: px, y: h - s * 0.15, z: pz, s, r: rng() * 6.28 });
      if (s > 0.55) this.addToHash({ x: px, z: pz, r: s * 0.85, h: s * 0.7, kind: 'rock' });
    }
    // forest floor: ferns, fallen logs and old stumps
    for (let i = 0; i < 5200; i++) {
      const px = (rng() * 2 - 1) * (HALF - 8), pz = (rng() * 2 - 1) * (HALF - 8);
      const d = T.densityAt(px, pz), h = T.getHeight(px, pz);
      if (h < 0.7 || rng() > (d - 0.3) * 1.4) continue;
      const roll = rng();
      if (roll < 0.9) {
        bucket('fern', px, pz).push({ x: px, y: h - 0.03, z: pz, s: 0.7 + rng() * 0.7, r: rng() * 6.28 });
      } else if (roll < 0.95) {
        const r = rng() * 6.28, s = 0.8 + rng() * 0.5;
        bucket('log', px, pz).push({ x: px, y: h - 0.08, z: pz, s, r });
        for (const t of [-1.2, 0, 1.2]) this.addToHash({ x: px + Math.cos(r) * t * s, z: pz - Math.sin(r) * t * s, r: 0.3 * s, h: 0.5 * s, kind: 'rock' });
      } else {
        const s = 0.7 + rng() * 0.6;
        bucket('stump', px, pz).push({ x: px, y: h - 0.05, z: pz, s, r: rng() * 6.28 });
        this.addToHash({ x: px, z: pz, r: 0.38 * s, h: 0.55 * s, kind: 'rock' });
      }
    }
    this.bushHash = new Map();
    for (const b of this.bushes) {
      const k = this.key(Math.floor(b.x / 16), Math.floor(b.z / 16));
      if (!this.bushHash.has(k)) this.bushHash.set(k, []);
      this.bushHash.get(k).push(b);
    }

    // Build tree/bush/rock instanced chunks
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const k in buckets) {
      const b = buckets[k];
      const mat = b.type === 'rock' || b.type === 'log' || b.type === 'stump' ? this.material : b.type === 'bush' ? this.bushMat : b.type === 'fern' ? this.fernMat : this.treeMat;
      const mesh = new THREE.InstancedMesh(this.geos[b.type], mat, b.items.length);
      b.items.forEach((it, i) => {
        q.setFromAxisAngle(up, it.r);
        const sy = b.type === 'rock' ? it.s * (0.7 + (i % 5) * 0.12) : b.type === 'log' || b.type === 'stump' ? it.s : it.s * (0.9 + (i % 7) * 0.04);
        m4.compose(pv.set(it.x, it.y, it.z), q, sv.set(it.s, sy, it.s));
        mesh.setMatrixAt(i, m4);
        const tint = 0.85 + ((i * 7919) % 100) / 100 * 0.3;
        col.setRGB(tint, tint * (0.97 + ((i * 31) % 10) / 160), tint * 0.95);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = b.type !== 'bush' && b.type !== 'fern';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.chunks.push({
        mesh, type: b.type, hi: false,
        x: -HALF + (b.cx + 0.5) * CHUNK, z: -HALF + (b.cz + 0.5) * CHUNK,
        small: b.type === 'bush' || b.type === 'rock' || b.type === 'fern' || b.type === 'log' || b.type === 'stump',
      });
    }

    // Grass + flowers in small chunks shown near the player
    const nG = Math.ceil((HALF * 2) / GRASS_CHUNK);
    for (let cz = 0; cz < nG; cz++) {
      for (let cx = 0; cx < nG; cx++) {
        const items = [], flowers = [];
        const x0 = -HALF + cx * GRASS_CHUNK, z0 = -HALF + cz * GRASS_CHUNK;
        const tries = 820;
        for (let i = 0; i < tries; i++) {
          const px = x0 + rng() * GRASS_CHUNK, pz = z0 + rng() * GRASS_CHUNK;
          const h = T.getHeight(px, pz);
          if (h < 0.35) continue;
          const d = T.densityAt(px, pz);
          if (rng() < d * 0.75) continue;
          if (T.trailAt(px, pz) < 1.2) continue;
          if (h > 28 && rng() < 0.6) continue;
          items.push({ x: px, y: h - 0.03, z: pz, s: 0.7 + rng() * 0.7, r: rng() * 6.28 });
          let meadow = 0;
          for (const m of MEADOWS) meadow = Math.max(meadow, smoothstep(m.r, m.r * 0.3, Math.hypot(px - m.x, pz - m.z)));
          if (rng() < 0.05 + meadow * 0.12) flowers.push({ x: px + 0.3, y: h - 0.02, z: pz + 0.2, s: 0.8 + rng() * 0.6, r: rng() * 6.28 });
        }
        if (!items.length) continue;
        // shuffle so that a prefix subset is spatially uniform (quality scaling)
        for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
        const gm = new THREE.InstancedMesh(this.grassGeo, this.grassMat, items.length);
        items.forEach((it, i) => {
          q.setFromAxisAngle(up, it.r);
          m4.compose(pv.set(it.x, it.y, it.z), q, sv.set(it.s, it.s * (0.8 + (i % 5) * 0.1), it.s));
          gm.setMatrixAt(i, m4);
          // same dry-patch pattern as the ground colours, plus a little per-tuft variety
          const dn = noise2(it.x * 0.011 + 9, it.z * 0.011) * 0.5 + 0.5, dryK = smoothstep(0.55, 0.85, dn) * 0.7;
          const v = 0.88 + ((i * 7919) % 100) / 100 * 0.24;
          gm.setColorAt(i, col.setRGB(v * (1 + dryK * 0.28), v * (1 + dryK * 0.08), v * (1 - dryK * 0.35)));
        });
        if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
        gm.computeBoundingSphere();
        gm.matrixAutoUpdate = false;
        gm.receiveShadow = true;
        gm.userData.total = items.length;
        gm.count = Math.floor(items.length * quality.grass);
        this.scene.add(gm);
        let fm = null;
        if (flowers.length) {
          fm = new THREE.InstancedMesh(this.flowerGeo, this.flowerMat, flowers.length);
          const palette = [0xf2f0e6, 0xf4d24a, 0xb48be0, 0xf0a0b8, 0xffffff];
          flowers.forEach((it, i) => {
            q.setFromAxisAngle(up, it.r);
            m4.compose(pv.set(it.x, it.y, it.z), q, sv.set(it.s, it.s, it.s));
            fm.setMatrixAt(i, m4);
            fm.setColorAt(i, col.set(palette[Math.floor(rng() * palette.length)]));
          });
          fm.computeBoundingSphere();
          fm.matrixAutoUpdate = false;
          this.scene.add(fm);
        }
        this.grassChunks.push({ mesh: gm, flowers: fm, x: x0 + GRASS_CHUNK / 2, z: z0 + GRASS_CHUNK / 2 });
      }
    }
  }

  // Remove vegetation and colliders inside a circle (used to clear building sites)
  clearArea(x, z, r) {
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const c of [...this.chunks, ...this.grassChunks.flatMap((g) => [{ mesh: g.mesh }, g.flowers ? { mesh: g.flowers } : null]).filter(Boolean)]) {
      const mesh = c.mesh;
      let changed = false;
      for (let i = 0; i < mesh.instanceMatrix.count; i++) {
        mesh.getMatrixAt(i, m4);
        m4.decompose(p, q, sc);
        if (Math.hypot(p.x - x, p.z - z) < r) { mesh.setMatrixAt(i, zero); changed = true; }
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [k, arr] of this.hash) this.hash.set(k, arr.filter((it) => Math.hypot(it.x - x, it.z - z) >= r));
    this.bushes = this.bushes.filter((b) => Math.hypot(b.x - x, b.z - z) >= r);
    for (const [k, arr] of this.bushHash) this.bushHash.set(k, arr.filter((b) => Math.hypot(b.x - x, b.z - z) >= r));
  }

  setGrassDensity(f) {
    for (const g of this.grassChunks) g.mesh.count = Math.floor(g.mesh.userData.total * f);
  }

  update(dt, camPos, viewDist, wind) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uWind.value.set(wind.x, wind.z);
    for (const c of this.chunks) {
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z) - CHUNK * 0.71;
      c.mesh.visible = d < (c.type === 'fern' ? 40 : c.small ? viewDist * 0.6 : viewDist);
      const hi = d < this.hiDist;
      if (hi !== c.hi) { c.hi = hi; c.mesh.geometry = hi ? this.geosHi[c.type] : this.geos[c.type]; }
    }
    const gd = 75;
    for (const g of this.grassChunks) {
      const d = Math.hypot(g.x - camPos.x, g.z - camPos.z) - GRASS_CHUNK * 0.71;
      g.mesh.visible = d < gd;
      if (g.flowers) g.flowers.visible = d < gd * 0.8;
    }
  }

  // Query colliders near a point.
  forEachNear(x, z, radius, fn) {
    const c0x = Math.floor((x - radius) / HASH), c1x = Math.floor((x + radius) / HASH);
    const c0z = Math.floor((z - radius) / HASH), c1z = Math.floor((z + radius) / HASH);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = this.hash.get(this.key(cx, cz));
        if (arr) for (const it of arr) fn(it);
      }
    }
  }

  // Push a circle out of colliders; returns adjusted {x, z}.
  collide(x, z, r, out) {
    out.x = x; out.z = z;
    this.forEachNear(x, z, r + 2, (it) => {
      const dx = out.x - it.x, dz = out.z - it.z;
      const min = it.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        out.x = it.x + (dx / d) * min;
        out.z = it.z + (dz / d) * min;
      }
    });
    return out;
  }

  // Nearest collider within radius (for animal steering).
  nearestObstacle(x, z, radius) {
    let best = null, bd = radius;
    this.forEachNear(x, z, radius, (it) => {
      const d = Math.hypot(it.x - x, it.z - z) - it.r;
      if (d < bd) { bd = d; best = it; }
    });
    return best;
  }

  nearestBush(x, z, maxD = 40) {
    let best = null, bd = maxD;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const arr = this.bushHash.get(this.key(cx + dx, cz + dz));
      if (!arr) continue;
      for (const b of arr) {
        const d = Math.hypot(b.x - x, b.z - z);
        if (d < bd) { bd = d; best = b; }
      }
    }
    return best;
  }

  // Ray vs tree trunks / rocks (2D circle test + height check). Returns distance or -1.
  raycast(origin, dir, maxDist) {
    let best = -1;
    const tested = new Set();
    const step = HASH * 0.5;
    for (let t = 0; t <= maxDist + step; t += step) {
      const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
      this.forEachNear(x, z, 1, (it) => {
        if (tested.has(it)) return;
        tested.add(it);
        // ray-circle in xz
        const ox = origin.x - it.x, oz = origin.z - it.z;
        const a = dir.x * dir.x + dir.z * dir.z;
        const b = 2 * (ox * dir.x + oz * dir.z);
        const c = ox * ox + oz * oz - it.r * it.r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return;
        const th = (-b - Math.sqrt(disc)) / (2 * a);
        if (th < 0 || th > maxDist) return;
        const y = origin.y + dir.y * th;
        const base = this.terrain.getHeight(it.x, it.z);
        if (y > base - 0.5 && y < base + it.h) {
          if (best < 0 || th < best) best = th;
        }
      });
      if (best >= 0 && best < t - step) break;
    }
    return best;
  }

  // Cover factor 0..1 at position — how concealed something is by forest.
  coverAt(x, z) { return this.terrain.densityAt(x, z); }
}

