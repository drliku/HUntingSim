// Terrain: height field, river/lake carving, biomes, trails and the terrain mesh.
import * as THREE from 'three';
import { fbm, noise2, smoothstep, lerp, clamp } from './utils.js';

export const WORLD_SIZE = 480;
export const HALF = WORLD_SIZE / 2;
export const PLAY_LIMIT = 205; // player/animal boundary
export const WATER_LEVEL = 0;

export const LAKE = { x: -110, z: 95, r: 27 };
// the shore wanders in and out around the lake instead of being a perfect circle
export function lakeRadiusAt(angle) {
  return LAKE.r * (1 + 0.13 * Math.sin(3 * angle + 0.7) + 0.07 * Math.sin(5 * angle + 2.1) + 0.04 * Math.sin(9 * angle + 4.0));
}
// distance from the lake centre in units where the (wobbly) shore is always at LAKE.r
export function lakeDist(x, z) {
  const dx = x - LAKE.x, dz = z - LAKE.z;
  return Math.hypot(dx, dz) * LAKE.r / lakeRadiusAt(Math.atan2(dz, dx));
}

export const MEADOWS = [
  { x: -40, z: -60, r: 24, name: 'Cabin Clearing' },
  { x: -75, z: 15, r: 42, name: 'West Meadow' },
  { x: 135, z: 25, r: 48, name: 'East Meadow' },
  { x: 140, z: 125, r: 44, name: 'Elk Valley' },
  { x: -15, z: 150, r: 30, name: 'South Glade' },
  { x: 95, z: -150, r: 22, name: 'Hollow Glade' },
];

// Trails as polylines (x, z)
export const TRAILS = [
  [[-40, -60], [-55, -30], [-70, 10], [-95, 50], [-110, 66]],
  [[-40, -60], [-15, -45], [10, -30], [riverXRaw(-30) - 2, -30], [riverXRaw(-28) + 14, -26], [80, -10], [120, 15], [140, 60], [140, 120]],
  [[-70, 10], [-40, 70], [-15, 150]],
  [[-40, -60], [-80, -95], [-130, -120], [-150, -130]],
  [[80, -10], [100, -80], [95, -150]],
];

function riverXRaw(z) {
  return 30 + 35 * Math.sin(z * 0.012) + 12 * Math.sin(z * 0.031 + 1.3);
}
export const riverX = riverXRaw;
export function riverHalfWidth(z) {
  return 5.5 + 2 * Math.sin(z * 0.021 + 0.7);
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

export function trailDistance(x, z) {
  let best = 1e9;
  for (const tr of TRAILS) {
    for (let i = 0; i < tr.length - 1; i++) {
      const d = segDist(x, z, tr[i][0], tr[i][1], tr[i + 1][0], tr[i + 1][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

export function riverDistance(x, z) {
  return Math.abs(x - riverX(z)) - riverHalfWidth(z);
}

// Analytic height used to build the mesh.
export function heightAnalytic(x, z) {
  let h = 3 + (fbm(x * 0.0055, z * 0.0055, 4) * 0.5 + 0.5) * 20;
  h += Math.max(0, fbm(x * 0.016 + 50, z * 0.016, 3)) * 6;
  h += noise2(x * 0.08, z * 0.08) * 0.25;
  // Pine ridge to the north-west
  const dr = Math.hypot(x + 150, z + 130);
  h += 30 * Math.exp(-(dr * dr) / (2 * 55 * 55));
  // Hills around the rim of the map form a natural boundary
  const e = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(165, 235, e) * 45;
  // Gentle flattening in meadows
  for (const m of MEADOWS) {
    const d = Math.hypot(x - m.x, z - m.z);
    const t = smoothstep(m.r * 1.5, m.r * 0.4, d);
    if (t > 0) h = lerp(h, h * 0.8 + 2, t * 0.5);
  }
  // River channel
  const rx = riverX(z), hw = riverHalfWidth(z);
  const d = Math.abs(x - rx);
  {
    const target = d < hw ? -1.7 * (1 - (d / hw) ** 2) : (d - hw) * 0.12;
    const t = smoothstep(hw, hw + 30, d);
    h = lerp(target, h, t);
    // Shallow fords where trails cross the river
    if (d < hw + 10) {
      const f = smoothstep(9, 3, trailDistance(x, z));
      if (f > 0) h = Math.max(h, lerp(h, -0.35, f));
    }
  }
  // Lake
  {
    const dl = lakeDist(x, z);
    const target = dl < LAKE.r ? -2.2 * (1 - (dl / LAKE.r) ** 2) : (dl - LAKE.r) * 0.1;
    const t = smoothstep(LAKE.r, LAKE.r + 28, dl);
    h = lerp(target, h, t);
  }
  return h;
}

export function forestDensityAnalytic(x, z) {
  let f = fbm(x * 0.0085 + 100, z * 0.0085 - 40, 3) * 0.5 + 0.5;
  f = smoothstep(0.36, 0.6, f);
  // Ridge is dense pine forest
  const dr = Math.hypot(x + 150, z + 130);
  f = Math.max(f, smoothstep(80, 30, dr) * 0.95);
  for (const m of MEADOWS) {
    const d = Math.hypot(x - m.x, z - m.z);
    f *= smoothstep(m.r * 0.75, m.r * 1.3, d);
  }
  f *= smoothstep(1, 12, riverDistance(x, z));
  f *= smoothstep(LAKE.r + 2, LAKE.r + 14, lakeDist(x, z));
  f *= smoothstep(2.5, 7, trailDistance(x, z));
  return clamp(f, 0, 1);
}

export class Terrain {
  constructor(scene) {
    this.segs = 192;
    this.size = WORLD_SIZE;
    this.step = this.size / this.segs;
    const n = this.segs + 1;
    this.heights = new Float32Array(n * n);
    // Coarse grids for runtime queries
    this.gridN = 120;
    this.gridStep = this.size / this.gridN;
    this.density = new Float32Array(this.gridN * this.gridN);
    this.trailGrid = new Float32Array(this.gridN * this.gridN);

    for (let gz = 0; gz < this.gridN; gz++) {
      for (let gx = 0; gx < this.gridN; gx++) {
        const x = -HALF + (gx + 0.5) * this.gridStep;
        const z = -HALF + (gz + 0.5) * this.gridStep;
        this.density[gz * this.gridN + gx] = forestDensityAnalytic(x, z);
        this.trailGrid[gz * this.gridN + gx] = trailDistance(x, z);
      }
    }
    this.mesh = this.buildMesh();
    scene.add(this.mesh);
  }

  buildMesh() {
    const n = this.segs + 1;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = -HALF + ix * this.step, z = -HALF + iz * this.step;
        const h = heightAnalytic(x, z);
        this.heights[i] = h;
        pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
        uv[i * 2] = x / 6; uv[i * 2 + 1] = z / 6;
      }
    }
    const idx = [];
    for (let iz = 0; iz < this.segs; iz++) {
      for (let ix = 0; ix < this.segs; ix++) {
        const a = iz * n + ix, b = (iz + 1) * n + ix, c = (iz + 1) * n + ix + 1, d = iz * n + ix + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // Vertex colours by biome
    const nrm = geo.attributes.normal.array;
    const c = new THREE.Color();
    const grassA = new THREE.Color(0x4d6b2a), grassB = new THREE.Color(0x6f7d34);
    const dry = new THREE.Color(0x8f8650), forest = new THREE.Color(0x3d3a22);
    const mud = new THREE.Color(0x6b5a40), rock = new THREE.Color(0x6b6862), rockWarm = new THREE.Color(0x7a6a56);
    const trail = new THREE.Color(0x7a6448), ridge = new THREE.Color(0x3f4f2a);
    const tmp = new THREE.Color();
    for (let i = 0; i < n * n; i++) {
      const x = pos[i * 3], h = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const slope = 1 - nrm[i * 3 + 1];
      const nv = noise2(x * 0.03, z * 0.03) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, nv);
      const dn = noise2(x * 0.011 + 9, z * 0.011) * 0.5 + 0.5;
      c.lerp(dry, smoothstep(0.55, 0.85, dn) * 0.6);
      const fd = this.densityAt(x, z);
      c.lerp(forest, fd * 0.75);
      const dr = Math.hypot(x + 150, z + 130);
      c.lerp(ridge, smoothstep(90, 30, dr) * 0.5);
      c.lerp(mud, smoothstep(1.6, 0.2, h));
      // steep ground turns to rock, warm or cool by area, only where it is really steep
      tmp.copy(rock).lerp(rockWarm, noise2(x * 0.02 + 4, z * 0.02) * 0.5 + 0.5);
      c.lerp(tmp, smoothstep(0.2, 0.45, slope));
      const td = this.trailAt(x, z);
      c.lerp(trail, smoothstep(2.6, 1.0, td) * 0.85);
      const v = 0.92 + noise2(x * 0.25, z * 0.25) * 0.1;
      tmp.copy(c).multiplyScalar(v);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: makeGroundTexture(),
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
        .replace('#include <common>', '#include <common>\nvarying vec3 vTN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vTW;
varying vec3 vTN;
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1.0, 0.0)), u.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), u.x), u.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec2 q = vTW.xz;
    float m = tn(q * 0.03) * 0.55 + tn(q * 0.09 + 3.1) * 0.3 + tn(q * 0.4 + 7.7) * 0.15;
    vec3 c = diffuseColor.rgb * (0.86 + 0.28 * m);
    // fine grit up close
    c *= 0.95 + 0.1 * tn(q * 2.3);
    // on slopes: rock strata, cracks, and moss creeping over the flatter ledges
    float sl = 1.0 - normalize(vTN).y;
    float rk = smoothstep(0.16, 0.42, sl);
    if (rk > 0.0) {
      float strata = tn(vec2(vTW.y * 2.2, (vTW.x + vTW.z) * 0.08)) * 0.6 + tn(vec2(vTW.y * 7.0, (vTW.x - vTW.z) * 0.3)) * 0.4;
      float blotch = tn(q * 1.7 + vTW.y * 0.6) * 0.6 + tn(q * 5.3) * 0.4;
      vec3 r = c * (0.8 + 0.38 * strata) * (0.86 + 0.28 * blotch);
      float moss = smoothstep(0.55, 0.25, sl) * smoothstep(0.35, 0.7, tn(q * 0.25 + 11.0));
      r = mix(r, vec3(0.2, 0.27, 0.11) * (0.8 + 0.4 * strata), moss * 0.7);
      c = mix(c, r, rk);
    }
    diffuseColor.rgb = c;
  }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec2 q = vTW.xz * 1.1;
    float e = 0.35;
    float h0 = tn(q), hx = tn(q + vec2(e, 0.0)), hz = tn(q + vec2(0.0, e));
    vec3 g = vec3(hx - h0, 0.0, hz - h0) * 0.6;
    normal = normalize(normal - (viewMatrix * vec4(g, 0.0)).xyz);
  }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  // Darken the ground under tree crowns, around rocks and next to buildings (soft ambient occlusion).
  // spots: [{ x, z, r, k }] — k = how dark the centre gets.
  bakeShade(spots) {
    const n = this.segs + 1;
    const col = this.mesh.geometry.attributes.color;
    const shade = new Float32Array(n * n).fill(1);
    for (const sp of spots) {
      const i0 = Math.max(0, Math.floor((sp.x - sp.r + HALF) / this.step)), i1 = Math.min(this.segs, Math.ceil((sp.x + sp.r + HALF) / this.step));
      const j0 = Math.max(0, Math.floor((sp.z - sp.r + HALF) / this.step)), j1 = Math.min(this.segs, Math.ceil((sp.z + sp.r + HALF) / this.step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * this.step, z = -HALF + j * this.step;
        const d = Math.hypot(x - sp.x, z - sp.z);
        if (d >= sp.r) continue;
        const k = j * n + i;
        shade[k] *= 1 - sp.k * smoothstep(sp.r, sp.r * 0.25, d);
      }
    }
    for (let k = 0; k < n * n; k++) {
      const f = Math.max(0.55, shade[k]);
      col.array[k * 3] *= f; col.array[k * 3 + 1] *= f; col.array[k * 3 + 2] *= f * 1.02;
    }
    col.needsUpdate = true;
  }

  // Level the ground for a building site: fully flat inside rIn, blending back to the
  // natural terrain by rOut. Call finishEdits() afterwards to rebuild normals.
  flatten(cx, cz, rIn, rOut, h) {
    const n = this.segs + 1;
    const pos = this.mesh.geometry.attributes.position.array;
    const i0 = Math.max(0, Math.floor((cx - rOut + HALF) / this.step)), i1 = Math.min(this.segs, Math.ceil((cx + rOut + HALF) / this.step));
    const j0 = Math.max(0, Math.floor((cz - rOut + HALF) / this.step)), j1 = Math.min(this.segs, Math.ceil((cz + rOut + HALF) / this.step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * this.step, z = -HALF + j * this.step;
        const d = Math.hypot(x - cx, z - cz);
        if (d >= rOut) continue;
        const t = smoothstep(rOut, rIn, d);
        const k = j * n + i;
        this.heights[k] = lerp(this.heights[k], h, t);
        pos[k * 3 + 1] = this.heights[k];
      }
    }
    this.editsPending = true;
  }

  finishEdits() {
    if (!this.editsPending) return;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.editsPending = false;
  }

  // Average ground height over a square area (used to pick a level for building sites)
  averageHeight(cx, cz, r) {
    let s = 0, c = 0;
    for (let dx = -r; dx <= r; dx += r / 3) for (let dz = -r; dz <= r; dz += r / 3) { s += this.getHeight(cx + dx, cz + dz); c++; }
    return s / c;
  }

  // Exact height matching the mesh triangulation.
  getHeight(x, z) {
    const n = this.segs + 1;
    let fx = (x + HALF) / this.step, fz = (z + HALF) / this.step;
    fx = clamp(fx, 0, this.segs - 0.0001); fz = clamp(fz, 0, this.segs - 0.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const H = this.heights;
    const ha = H[iz * n + ix], hb = H[(iz + 1) * n + ix];
    const hc = H[(iz + 1) * n + ix + 1], hd = H[iz * n + ix + 1];
    if (tx + tz <= 1) return ha + (hd - ha) * tx + (hb - ha) * tz;
    return hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
  }

  getNormal(x, z, out) {
    const e = 0.8;
    const hL = this.getHeight(x - e, z), hR = this.getHeight(x + e, z);
    const hD = this.getHeight(x, z - e), hU = this.getHeight(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }

  densityAt(x, z) {
    const gx = clamp(Math.floor((x + HALF) / this.gridStep), 0, this.gridN - 1);
    const gz = clamp(Math.floor((z + HALF) / this.gridStep), 0, this.gridN - 1);
    return this.density[gz * this.gridN + gx];
  }
  trailAt(x, z) {
    const gx = clamp(Math.floor((x + HALF) / this.gridStep), 0, this.gridN - 1);
    const gz = clamp(Math.floor((z + HALF) / this.gridStep), 0, this.gridN - 1);
    return this.trailGrid[gz * this.gridN + gx];
  }

  waterDepth(x, z) {
    return WATER_LEVEL - this.getHeight(x, z);
  }

  // Nearest point on a bank where an animal can drink.
  nearestDrinkSpot(x, z) {
    const rx = riverX(z), hw = riverHalfWidth(z);
    const side = x >= rx ? 1 : -1;
    const river = { x: rx + side * (hw + 1.2), z, d: Math.abs(x - (rx + side * (hw + 1.2))) };
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z) || 1, rs = lakeRadiusAt(Math.atan2(z - LAKE.z, x - LAKE.x)) + 1.5;
    const lx = LAKE.x + ((x - LAKE.x) / dl) * rs;
    const lz = LAKE.z + ((z - LAKE.z) / dl) * rs;
    const ld = Math.hypot(x - lx, z - lz);
    return ld < river.d ? { x: lx, z: lz, d: ld } : river;
  }

  // March a ray against the height field; returns distance or -1.
  raycast(origin, dir, maxDist, step = 1.0) {
    let prevT = 0;
    // short segments (arrows, pellets) are checked at their end point
    for (let t = Math.min(step, maxDist); t <= maxDist + 1e-6; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < this.getHeight(x, z)) {
        // refine
        let a = prevT, b = t;
        for (let i = 0; i < 6; i++) {
          const m = (a + b) / 2;
          const yy = origin.y + dir.y * m;
          if (yy < this.getHeight(origin.x + dir.x * m, origin.z + dir.z * m)) b = m; else a = m;
        }
        return b;
      }
      prevT = t;
    }
    return -1;
  }

  // Line-of-sight check between two points (used by animal vision).
  lineOfSight(ax, ay, az, bx, by, bz) {
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (this.getHeight(x, z) > y + 0.2) return false;
    }
    return true;
  }
}

function makeGroundTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // tileable noise via torus mapping
      const a = (x / s) * Math.PI * 2, b = (y / s) * Math.PI * 2;
      const n1 = noise2(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + Math.cos(b) * 3) * 0.5;
      const n2 = noise2(Math.cos(a) * 9 + Math.sin(b) * 9, Math.sin(a) * 9 + 50) * 0.35;
      const n3 = (Math.random() - 0.5) * 0.18;
      const v = clamp(0.82 + n1 * 0.25 + n2 * 0.25 + n3, 0.5, 1);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.floor(v * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
