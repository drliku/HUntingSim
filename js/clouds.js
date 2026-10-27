// Volumetric clouds: a tiling 3D noise texture (billowy Perlin-Worley in red, fine Worley in green)
// that the sky shader ray-marches through a slab of sky, lighting each sample by marching again
// towards the sun. Gives real, puffy cumulus with dark bellies, bright sunlit tops and silver edges.
import * as THREE from 'three';
import { mulberry32 } from './utils.js';

const N = 64;

function worleyGrid(cells, rng) {
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rng();
  return pts;
}

// 1 - distance to the nearest feature point, tiling every `cells` cells
function worley(x, y, z, cells, pts) {
  const fx = x * cells, fy = y * cells, fz = z * cells;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz;
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
    const k = ((wz * cells + wy) * cells + wx) * 3;
    const ddx = cx + pts[k] - fx, ddy = cy + pts[k + 1] - fy, ddz = cz + pts[k + 2] - fz;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d < best) best = d;
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

function valueLattice(p, rng) {
  const v = new Float32Array(p * p * p);
  for (let i = 0; i < v.length; i++) v[i] = rng();
  return v;
}

function valueNoise(x, y, z, p, v) {
  const fx = x * p, fy = y * p, fz = z * p;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  let tx = fx - ix, ty = fy - iy, tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); tz = tz * tz * (3 - 2 * tz);
  const at = (a, b, c) => v[(((c % p) + p) % p * p + (((b % p) + p) % p)) * p + (((a % p) + p) % p)];
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(at(ix, iy, iz), at(ix + 1, iy, iz), tx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
    l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
}

export function makeCloudNoise() {
  const rng = mulberry32(4242);
  const w4 = worleyGrid(4, rng), w8 = worleyGrid(8, rng), w16 = worleyGrid(16, rng), w32 = worleyGrid(32, rng);
  const v4 = valueLattice(4, rng), v8 = valueLattice(8, rng), v16 = valueLattice(16, rng);
  const data = new Uint8Array(N * N * N * 2);
  let k = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
    const val = (valueNoise(u, v, w, 4, v4) * 0.57 + valueNoise(u, v, w, 8, v8) * 0.29 + valueNoise(u, v, w, 16, v16) * 0.14);
    const wl = worley(u, v, w, 4, w4) * 0.625 + worley(u, v, w, 8, w8) * 0.25 + worley(u, v, w, 16, w16) * 0.125;
    // Perlin-Worley: value noise with the cellular billows carved into it
    const pw = Math.min(1, Math.max(0, (val - (1 - wl) * 0.55) / 0.45 + 0.25));
    const det = worley(u, v, w, 8, w8) * 0.5 + worley(u, v, w, 16, w16) * 0.3 + worley(u, v, w, 32, w32) * 0.2;
    data[k++] = Math.round(pw * 255);
    data[k++] = Math.round(det * 255);
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// GLSL: march the cloud slab along view ray rd. Returns scattered light (rgb) and transmittance (a).
export const CLOUD_GLSL = /* glsl */`
precision highp sampler3D;
uniform sampler3D tCloudNoise;
uniform float uVolSteps;
const float CL_H0 = 1300.0, CL_H1 = 2600.0;
float clHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float clDensity(vec3 p, bool detail) {
  float hf = clamp((p.y - CL_H0) / (CL_H1 - CL_H0), 0.0, 1.0);
  vec3 q = p * 0.00019 + vec3(uCloudOff.x * 2.2, 0.0, uCloudOff.y * 2.2);
  // large-scale weather: where clouds gather, and how tall they grow
  float wx = vnoise(p.xz * 0.00011 + uCloudOff * 0.9 + 3.1);
  float cov = clamp(0.03 + uCloud * 0.72 + (wx - 0.5) * 0.5, 0.0, 1.0);
  float top = 0.45 + wx * 0.55;
  float shape = smoothstep(0.0, 0.1, hf) * smoothstep(top, top * 0.45, hf);
  float base = texture(tCloudNoise, q).r;
  float d = clamp((base * shape - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
  if (detail && d > 0.0) {
    float de = texture(tCloudNoise, q * 5.3 + vec3(0.0, uCloudOff.x * 3.0, 0.0)).g;
    d = clamp(d - (1.0 - de) * mix(0.32, 0.12, hf) * (1.0 - d) * 1.6, 0.0, 1.0);
  }
  return d;
}
float clHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
vec4 marchClouds(vec3 rd) {
  if (rd.y < 0.012 || uVolSteps < 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = CL_H0 / rd.y, t1 = min(CL_H1 / rd.y, t0 + 6000.0);
  float dt = (t1 - t0) / uVolSteps;
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float c = dot(rd, uSunDir);
  float phase = 0.75 + 0.16 * clHG(c, 0.6) * 12.566 + 0.25 * clHG(c, -0.25) * 12.566;
  float sunUp = smoothstep(-0.06, 0.08, uSunDir.y);
  vec3 sunL = uSunColor * (1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.5, uSunDir.y))) * sunUp;
  float T = 1.0; vec3 S = vec3(0.0);
  for (int i = 0; i < 48; i++) {
    if (float(i) >= uVolSteps || T < 0.02) break;
    vec3 p = rd * (t0 + (float(i) + j) * dt);
    float d = clDensity(p, true);
    if (d > 0.002) {
      float hf = clamp((p.y - CL_H0) / (CL_H1 - CL_H0), 0.0, 1.0);
      // optical depth towards the sun
      float ld = clDensity(p + uSunDir * 70.0, false) * 70.0 + clDensity(p + uSunDir * 220.0, false) * 150.0 + clDensity(p + uSunDir * 520.0, false) * 300.0;
      float beer = exp(-ld * 0.02);
      float powder = 1.0 - exp(-d * 6.0 - ld * 0.02);
      vec3 amb = mix(uCloudShade, uCloudCol, 0.35 + hf * 0.65);
      // sunlight through the cloud, plus skylight: grey-white from above, a touch of blue from the sky dome
      vec3 L = sunL * beer * mix(0.45, 1.0, powder) * phase + amb * (0.24 + 0.5 * hf) + uTop * (0.3 + 0.4 * hf);
      float a = exp(-d * 0.022 * dt);
      S += T * (1.0 - a) * L;
      T *= a;
    }
  }
  // far clouds melt into the horizon haze
  float far = exp(-t0 * 0.000055);
  return vec4(S * far, mix(1.0, T, far));
}
`;
