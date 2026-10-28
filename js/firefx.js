// Campfire effects: licking flames (noise-driven billboards that glow into the bloom), sparks
// spiralling up out of the fire, a column of smoke drifting with the wind, and pulsing coals.
import * as THREE from 'three';

const NOISE = /* glsl */`
float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1, 0)), u.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ return fn(p) * 0.55 + fn(p * 2.1 + 3.7) * 0.3 + fn(p * 4.3 + 7.1) * 0.15; }
`;

// Billboards that turn around the vertical axis to face the camera (flames, smoke)
const BILL_VS = /* glsl */`
attribute vec3 aCenter; attribute vec2 aCorner; attribute float aSeed;
uniform float uTime, uRise, uLife, uSize, uGrow;
uniform vec2 uWind;
varying vec2 vUv; varying float vSeed, vLife;
void main() {
  float life = uLife > 0.0 ? fract(uTime / uLife + aSeed) : 0.0;
  vec3 c = aCenter + vec3(uWind.x, 0.0, uWind.y) * life * life * 3.0 + vec3(sin(aSeed * 40.0 + life * 3.0), 0.0, cos(aSeed * 31.0 + life * 2.0)) * life * 0.35;
  c.y += life * uRise;
  vec3 wc = (modelMatrix * vec4(c, 1.0)).xyz;
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  float s = uSize * (1.0 + life * uGrow) * (0.8 + fract(aSeed * 13.7) * 0.4);
  vec3 wp = wc + right * aCorner.x * s + vec3(0.0, 1.0, 0.0) * aCorner.y * s * (uLife > 0.0 ? 1.0 : 1.7);
  vUv = vec2(aCorner.x, aCorner.y * 0.5 + 0.5); vSeed = aSeed; vLife = life;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FLAME_FS = /* glsl */`
uniform float uTime, uIntensity;
varying vec2 vUv; varying float vSeed;
${NOISE}
void main() {
  vec2 uv = vec2(vUv.x, vUv.y);
  float n = fbm(vec2(uv.x * 2.2 + vSeed * 7.0, uv.y * 2.6 - uTime * 2.4 - vSeed * 3.0));
  float w = (1.0 - uv.y) * 0.62 + 0.04;
  float d = abs(uv.x + (n - 0.5) * 0.35 * uv.y) / w;
  float f = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.9) * smoothstep(1.0, 0.45, uv.y + (n - 0.5) * 0.55) * smoothstep(0.0, 0.12, uv.y);
  if (f < 0.01) discard;
  vec3 col = mix(vec3(0.9, 0.16, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.05, 0.5, f));
  col = mix(col, vec3(1.0, 0.92, 0.66), smoothstep(0.55, 0.95, f));
  gl_FragColor = vec4(col * f * uIntensity * 1.5, 1.0);
}`;

const SMOKE_FS = /* glsl */`
uniform float uTime, uIntensity, uLight;
varying vec2 vUv; varying float vSeed, vLife;
${NOISE}
void main() {
  vec2 q = vec2(vUv.x, vUv.y * 2.0 - 1.0);
  float n = fbm(q * 1.6 + vSeed * 9.0 + vec2(0.0, -uTime * 0.3));
  float a = smoothstep(1.0, 0.2, length(q) + (n - 0.5) * 0.7);
  a *= smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife)) * 0.24 * uIntensity;
  if (a < 0.004) discard;
  vec3 col = mix(vec3(0.42, 0.4, 0.38), vec3(0.62, 0.6, 0.58), n) * uLight;
  // the base of the plume is lit from below by the flames
  col += vec3(0.5, 0.2, 0.05) * (1.0 - smoothstep(0.0, 0.18, vLife)) * uIntensity;
  gl_FragColor = vec4(col, a);
}`;

const SPARK_VS = /* glsl */`
attribute float aSeed;
uniform float uTime, uIntensity;
uniform vec2 uWind;
varying float vA;
void main() {
  float life = fract(uTime * (0.35 + fract(aSeed * 7.3) * 0.3) + aSeed);
  float a = aSeed * 50.0 + life * 6.0;
  vec3 p = vec3(cos(a) * (0.08 + life * 0.35), 0.25 + life * (1.6 + fract(aSeed * 3.1) * 1.8), sin(a) * (0.08 + life * 0.35));
  p.xz += uWind * life * life * 1.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vA = (1.0 - life) * step(0.35, fract(aSeed * 17.0 + floor(uTime * 0.7 + aSeed * 5.0) * 0.37)) * uIntensity;
  gl_PointSize = clamp((1.0 + 1.4 * (1.0 - life)) * 16.0 / max(-mv.z, 0.3), 1.0, 14.0);
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FS = /* glsl */`
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5 || vA < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * (1.0 - d * 2.0) * min(vA, 1.0) * 2.5, 1.0);
}`;

const COAL_FS = /* glsl */`
uniform float uTime, uIntensity;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float n = fbm(q * 4.0 + uTime * 0.25) * 0.7 + fbm(q * 9.0 - uTime * 0.4) * 0.3;
  float glow = smoothstep(1.0, 0.2, r) * smoothstep(0.35, 0.75, n) * (0.7 + 0.3 * sin(uTime * 3.0 + n * 9.0));
  vec3 ash = vec3(0.07, 0.06, 0.055);
  vec3 col = mix(ash, vec3(1.0, 0.32, 0.06) * 2.2, glow * uIntensity);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const COAL_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function billboards(centers) {
  const n = centers.length, pos = new Float32Array(n * 12), ctr = new Float32Array(n * 12), cor = new Float32Array(n * 8), seed = new Float32Array(n * 4), idx = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  centers.forEach((c, i) => {
    for (let k = 0; k < 4; k++) {
      ctr.set(c.p, (i * 4 + k) * 3); pos.set(c.p, (i * 4 + k) * 3);
      cor.set(corners[k], (i * 4 + k) * 2);
      seed[i * 4 + k] = c.s;
    }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 6);
  return g;
}

const shared = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() } };

// Shared clock and wind for every fire; call once per frame.
export function updateFireShared(t, wind) {
  shared.uTime.value = t;
  shared.uWind.value.set(wind.x, wind.z).multiplyScalar(0.12);
}

export function makeFireFX() {
  const group = new THREE.Group();
  const intensity = { value: 1 }, light = { value: 1 };
  // flames: a cluster of tongues around the middle of the fire
  const fl = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, r = i === 0 ? 0 : 0.12 + (i % 3) * 0.05;
    fl.push({ p: [Math.cos(a) * r, i === 0 ? 0.55 : 0.42, Math.sin(a) * r], s: i * 0.137 + 0.05 });
  }
  const flames = new THREE.Mesh(billboards(fl), new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uWind: shared.uWind, uIntensity: intensity, uRise: { value: 0 }, uLife: { value: 0 }, uSize: { value: 0.3 }, uGrow: { value: 0 } },
    vertexShader: BILL_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  flames.renderOrder = 3;
  group.add(flames);
  // smoke: puffs that rise, swell and drift downwind
  const sm = [];
  for (let i = 0; i < 16; i++) sm.push({ p: [0, 0.7, 0], s: i / 16 });
  const smoke = new THREE.Mesh(billboards(sm), new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uWind: shared.uWind, uIntensity: intensity, uLight: light, uRise: { value: 6.5 }, uLife: { value: 9 }, uSize: { value: 0.35 }, uGrow: { value: 4.5 } },
    vertexShader: BILL_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false, fog: false,
  }));
  smoke.renderOrder = 2;
  group.add(smoke);
  // sparks
  const N = 48, sg = new THREE.BufferGeometry(), seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) seeds[i] = Math.random();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 4);
  const sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uWind: shared.uWind, uIntensity: intensity },
    vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  sparks.renderOrder = 3;
  group.add(sparks);
  // glowing bed of coals
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uIntensity: intensity }, vertexShader: COAL_VS, fragmentShader: COAL_FS,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  coals.rotation.x = -Math.PI / 2;
  coals.position.y = 0.05;
  group.add(coals);
  return { group, intensity, light };
}
