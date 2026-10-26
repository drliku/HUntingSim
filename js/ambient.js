// Ambient particles around the camera: fireflies blinking over the grass at dusk and night,
// pollen and dust drifting in the air by day, and leaves tumbling down under the trees in the
// wind. All of them wrap around the camera in a box.
import * as THREE from 'three';

const VS = /* glsl */`
uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uSize; uniform float uFly;
attribute float aSeed;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * (0.25 + aSeed * 0.2);
  // lazy wandering drift
  p += vec3(sin(t + aSeed * 31.0), sin(t * 0.7 + aSeed * 17.0) * 0.4, cos(t * 0.8 + aSeed * 23.0)) * (uFly > 0.5 ? 1.2 : 0.6);
  p.y += uFly > 0.5 ? 0.0 : uTime * 0.05 * (aSeed - 0.3);
  // wrap into a box that follows the camera
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCam + rel;
  if (uFly > 0.5) wp.y = uCam.y - 1.4 + mod(position.y, 2.6);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = uFly > 0.5 ? smoothstep(0.15, 1.0, sin(uTime * (1.2 + aSeed * 1.8) + aSeed * 50.0)) : 1.0;
  float edge = 1.0 - smoothstep(0.35, 0.5, length(rel.xz) / uBox.x);
  vA = blink * edge;
  gl_PointSize = uSize * (uFly > 0.5 ? 1.0 : 0.6 + aSeed * 0.6) * (300.0 / max(1.0, -mv.z));
}`;
const FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
  gl_FragColor = vec4(uColor * (1.0 + smoothstep(0.25, 0.0, d) * 2.0), a);
}`;

// Leaves: little tumbling ellipses that fall, drift with the wind and spin as they go
const LEAF_VS = /* glsl */`
uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uSize;
attribute float aSeed; attribute vec3 aCol;
varying float vSpin; varying vec3 vCol; varying float vA;
void main() {
  vec3 p = position;
  float t = uTime;
  p.y -= t * (0.55 + aSeed * 0.5);
  p.x += sin(t * 1.3 + aSeed * 40.0) * 0.7 + uWind.x * t * 0.3;
  p.z += cos(t * 1.1 + aSeed * 25.0) * 0.7 + uWind.y * t * 0.3;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  gl_Position = projectionMatrix * mv;
  vSpin = t * (1.5 + aSeed * 3.0) + aSeed * 20.0;
  vCol = aCol;
  vA = (1.0 - smoothstep(0.3, 0.5, length(rel.xz) / uBox.x)) * (1.0 - smoothstep(0.35, 0.5, abs(rel.y) / uBox.y));
  gl_PointSize = uSize * (300.0 / max(1.0, -mv.z));
}`;
const LEAF_FS = /* glsl */`
uniform float uOpacity, uLight;
varying float vSpin; varying vec3 vCol; varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vSpin), co = cos(vSpin);
  c = mat2(co, -s, s, co) * c;
  c.x /= max(0.22, abs(cos(vSpin * 0.7)));
  float d = length(c * vec2(1.0, 1.9));
  if (d > 0.42 || vA * uOpacity < 0.02) discard;
  gl_FragColor = vec4(vCol * uLight * (0.7 + 0.3 * (1.0 - d / 0.42)), 1.0);
}`;

function swarm(n, box, seed0) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  let s = seed0;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (r() - 0.5) * box.x; pos[i * 3 + 1] = r() * box.y; pos[i * 3 + 2] = (r() - 0.5) * box.z;
    seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  return g;
}

export class Ambient {
  constructor(scene) {
    const make = (n, box, color, size, fly, seed) => {
      const u = {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uSize: { value: size },
        uFly: { value: fly }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 },
      };
      const pts = new THREE.Points(swarm(n, box, seed), new THREE.ShaderMaterial({
        uniforms: u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      pts.frustumCulled = false;
      scene.add(pts);
      return { pts, u };
    };
    this.flies = make(240, new THREE.Vector3(44, 3, 44), 0xc8ff6a, 0.2, 1, 7);
    this.dust = make(260, new THREE.Vector3(30, 8, 30), 0xfff2d0, 0.05, 0, 11);
    // falling leaves (alpha-tested, so they sort with the scene)
    const box = new THREE.Vector3(36, 14, 36), lg = swarm(170, box, 23);
    const cols = new Float32Array(170 * 3), pal = [0x6a8a2a, 0x8a9a30, 0xb08a2a, 0xa0581e, 0x7a4a1e, 0x5a7a24].map((h) => new THREE.Color(h));
    for (let i = 0; i < 170; i++) pal[i % pal.length].toArray(cols, i * 3);
    lg.setAttribute('aCol', new THREE.BufferAttribute(cols, 3));
    this.leafU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uWind: { value: new THREE.Vector2() }, uSize: { value: 0.22 }, uOpacity: { value: 0 }, uLight: { value: 1 } };
    this.leaves = new THREE.Points(lg, new THREE.ShaderMaterial({ uniforms: this.leafU, vertexShader: LEAF_VS, fragmentShader: LEAF_FS, fog: false }));
    this.leaves.frustumCulled = false;
    scene.add(this.leaves);
    this.trees = 0; this.treeT = 0;
  }

  update(dt, cam, env, nearForestOrMeadow = 1, veg = null) {
    const t = performance.now() / 1000;
    const wet = Math.min(1, (env.w.rain || 0) + (env.w.snow || 0));
    for (const s of [this.flies, this.dust]) { s.u.uTime.value = t; s.u.uCam.value.copy(cam); }
    // fireflies come out as the light fades (and stay in when it rains)
    const dusk = 1 - Math.min(1, env.daylight * 3);
    this.flies.u.uOpacity.value = dusk * (1 - wet) * 0.9 * nearForestOrMeadow;
    this.flies.pts.visible = this.flies.u.uOpacity.value > 0.01;
    // motes catch the daylight
    this.dust.u.uOpacity.value = env.daylight * (1 - wet) * 0.28 * env.w.light;
    this.dust.pts.visible = this.dust.u.uOpacity.value > 0.01;
    // leaves fall where there are trees around, more of them when it is windy
    if ((this.treeT -= dt) <= 0 && veg) {
      this.treeT = 1;
      let n = 0;
      veg.forEachNear(cam.x, cam.z, 16, (it) => { if (it.kind === 'tree') n++; });
      this.treesWant = Math.min(1, n / 12);
    }
    this.trees += ((this.treesWant || 0) - this.trees) * Math.min(1, dt * 0.5);
    const L = this.leafU, ws = Math.hypot(env.wind.x, env.wind.z);
    L.uTime.value = t; L.uCam.value.copy(cam);
    L.uWind.value.set(env.wind.x, env.wind.z);
    L.uOpacity.value = this.trees * (1 - (env.w.snow || 0)) * Math.min(1, 0.35 + ws * 0.12);
    L.uLight.value = 0.06 + env.daylight * env.w.light * 0.9;
    this.leaves.visible = L.uOpacity.value > 0.03;
  }
}
