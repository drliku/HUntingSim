// Sky dome, sun/moon lighting, day-night cycle, weather, precipitation, clouds, wind and water.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, mulberry32 } from './utils.js';
import { WORLD_SIZE, WATER_LEVEL } from './terrain.js';

export const WEATHER = {
  clear:  { label: 'Clear',    fog: 1.0,  cloud: 0.15, rain: 0, snow: 0, light: 1.0,  wind: 2.5, gray: 0.0 },
  cloudy: { label: 'Overcast', fog: 0.8,  cloud: 0.85, rain: 0, snow: 0, light: 0.65, wind: 4.5, gray: 0.6 },
  fog:    { label: 'Fog',      fog: 0.28, cloud: 0.6,  rain: 0, snow: 0, light: 0.6,  wind: 1.0, gray: 0.75 },
  rain:   { label: 'Rain',     fog: 0.55, cloud: 1.0,  rain: 1, snow: 0, light: 0.45, wind: 6.0, gray: 0.8 },
  storm:  { label: 'Storm',    fog: 0.42, cloud: 1.0,  rain: 1.6, snow: 0, light: 0.3, wind: 11, gray: 0.9 },
  snow:   { label: 'Snow',     fog: 0.45, cloud: 0.95, rain: 0, snow: 1, light: 0.7,  wind: 3.0, gray: 0.7 },
};

const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // keep at far plane
}`;
const SKY_FS = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize;
uniform vec3 uMoonDir; uniform float uMoon;
uniform float uCloud; uniform vec2 uCloudOff; uniform vec3 uCloudCol; uniform vec3 uCloudShade;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.6, h), 0.7));
  col = mix(col, uGround, smoothstep(0.0, -0.12, h));
  float sd = max(dot(d, uSunDir), 0.0);
  float md = max(dot(d, uMoonDir), 0.0);
  vec3 sun = uSunColor * (pow(sd, 900.0 / uSunSize) * 6.0) * smoothstep(-0.02, 0.02, h);
  vec3 moon = vec3(0.75, 0.8, 0.9) * pow(md, 2200.0) * 2.0 * uMoon;
  col += uSunColor * (pow(sd, 12.0) * 0.25 + pow(sd, 3.0) * 0.08) * smoothstep(-0.15, 0.05, h);
  col += vec3(0.2, 0.25, 0.35) * pow(md, 20.0) * 0.12 * uMoon;
  // Procedural cloud layer projected onto a plane above the camera
  float cover = 0.0;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.3 + uCloudOff;
    float n = fbm(uv);
    float t = 0.74 - uCloud * 0.46;
    cover = smoothstep(t - 0.1, t + 0.14, n) * smoothstep(0.0, 0.16, h);
    float dens = fbm(uv * 2.1 + 5.3);
    vec3 cc = mix(uCloudShade, uCloudCol, clamp(0.35 + (n - t) * 1.6 + dens * 0.3, 0.0, 1.0));
    cc += uSunColor * pow(sd, 8.0) * 0.35;
    col = mix(col, cc, cover * 0.95);
  }
  col += (sun + moon) * (1.0 - cover);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const PRECIP_VS = `
uniform float uTime; uniform vec3 uCam; uniform float uSpeed; uniform vec3 uBox; uniform vec2 uWind; uniform float uSnow; uniform float uSize;
attribute float aEnd; attribute float aSeed;
varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y - uTime * uSpeed * (0.8 + aSeed * 0.4), uBox.y);
  vec3 off = vec3(uWind.x, 0.0, uWind.y) * (uBox.y - p.y) * 0.04;
  if (uSnow > 0.5) {
    off.x += sin(uTime * 1.3 + aSeed * 40.0) * 0.6;
    off.z += cos(uTime * 1.1 + aSeed * 30.0) * 0.6;
  }
  p += off;
  p.xz = mod(p.xz - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + uCam.xz;
  p.y += uCam.y - uBox.y * 0.4;
  // streak end: offset along velocity
  p += vec3(-uWind.x * 0.02, 0.45, -uWind.y * 0.02) * aEnd * (1.0 - uSnow);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (30.0 / -mv.z);
  vA = (1.0 - aEnd * 0.8) * smoothstep(40.0, 5.0, -mv.z);
}`;
const PRECIP_FS = `
uniform vec3 uColor; uniform float uOpacity; uniform float uSnow;
varying float vA;
void main(){
  float a = vA * uOpacity;
  if (uSnow > 0.5) {
    vec2 c = gl_PointCoord - 0.5;
    a *= smoothstep(0.5, 0.2, length(c));
  }
  gl_FragColor = vec4(uColor, a);
}`;

const SKY_KEYS = [
  // [sunElevation, top, horizon, sunColor, sunIntensity, hemiIntensity]
  [-0.35, 0x050a18, 0x0e1626, 0x000000, 0.0, 0.32],
  [-0.12, 0x0d1730, 0x222a42, 0x331a10, 0.0, 0.38],
  [-0.02, 0x253a66, 0xd27a4a, 0xff7a3a, 0.25, 0.40],
  [0.08, 0x3d64a8, 0xf0b07a, 0xffb070, 1.4, 1.0],
  [0.25, 0x4a7ec4, 0xb9cfe3, 0xffe2b8, 2.4, 1.35],
  [0.6, 0x3f76c9, 0xaecbe8, 0xfff4e0, 2.8, 1.45],
];

export class Environment {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.time = 7.2;              // hours
    this.totalHours = 0;          // game hours elapsed (track ageing)
    this.day = 1;
    this.daySeconds = 20 * 60;    // real seconds per 24h at timeScale 1
    this.timeScale = 1;
    this.weatherName = 'clear';
    this.w = { ...WEATHER.clear };
    this.wind = new THREE.Vector3(2, 0, 1);
    this.windAngle = 0.6;
    this.windTarget = 0.6;
    this.daylight = 1;
    this.sunDir = new THREE.Vector3();
    this.lightning = 0;
    this.nextLightning = 8;
    this.onThunder = null;
    this.viewDist = quality.viewDist;

    // Lights
    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x4a4030, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Sky dome
    this.skyUniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uSunSize: { value: 1 },
      uMoonDir: { value: new THREE.Vector3() }, uMoon: { value: 0 },
      uCloud: { value: 0.2 }, uCloudOff: { value: new THREE.Vector2() }, uCloudCol: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0.6, 0.6, 0.6) },
    };
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyUniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // Stars
    const rng = mulberry32(42);
    const sp = new Float32Array(1400 * 3);
    for (let i = 0; i < 1400; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u);
      sp[i * 3] = Math.cos(a) * r * 360; sp[i * 3 + 1] = y * 360; sp[i * 3 + 2] = Math.sin(a) * r * 360;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // Fog
    this.fogColor = new THREE.Color();
    scene.fog = new THREE.Fog(0xaabbcc, 20, this.viewDist);

    this.buildPrecipitation(rng);
    this.buildWater();

    this.setWeather('clear', true);
    this.update(0, new THREE.Vector3());
  }

  buildPrecipitation(rng) {
    const N = 3000;
    const box = new THREE.Vector3(50, 26, 50);
    const pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = (rng() - 0.5) * box.x, y = rng() * box.y, z = (rng() - 0.5) * box.z, s = rng();
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z; end[j] = k; seed[j] = s;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.precipUniforms = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSpeed: { value: 18 }, uBox: { value: box },
      uWind: { value: new THREE.Vector2() }, uSnow: { value: 0 }, uSize: { value: 2 },
      uColor: { value: new THREE.Color(0xaabbcc) }, uOpacity: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: PRECIP_VS, fragmentShader: PRECIP_FS, uniforms: this.precipUniforms,
      transparent: true, depthWrite: false, fog: false,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    // Snow uses the same buffers rendered as points
    const snowGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(N * 3), se = new Float32Array(N), ss = new Float32Array(N);
    for (let i = 0; i < N; i++) { sp[i * 3] = pos[i * 6]; sp[i * 3 + 1] = pos[i * 6 + 1]; sp[i * 3 + 2] = pos[i * 6 + 2]; ss[i] = seed[i * 2]; }
    snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    snowGeo.setAttribute('aEnd', new THREE.BufferAttribute(se, 1));
    snowGeo.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
    this.snowUniforms = THREE.UniformsUtils.clone(this.precipUniforms);
    this.snowUniforms.uBox.value = box;
    this.snowUniforms.uSnow.value = 1;
    this.snowUniforms.uSpeed.value = 1.6;
    this.snowUniforms.uSize.value = 5;
    this.snowUniforms.uColor.value = new THREE.Color(0xffffff);
    const snowMat = new THREE.ShaderMaterial({
      vertexShader: PRECIP_VS, fragmentShader: PRECIP_FS, uniforms: this.snowUniforms,
      transparent: true, depthWrite: false, fog: false,
    });
    this.snow = new THREE.Points(snowGeo, snowMat);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.scene.add(this.snow);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.waterUniforms = { uTime: { value: 0 } };
    const mat = new THREE.MeshPhongMaterial({
      color: 0x2c4f5a, specular: 0x1c2328, shininess: 60, transparent: true, opacity: 0.86, depthWrite: false,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;')
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          vec2 wp = vWPos.xz;
          float w1 = sin(wp.x * 0.9 + uTime * 1.3) * cos(wp.y * 0.7 - uTime * 1.1);
          float w2 = sin(wp.x * 2.3 - wp.y * 1.7 + uTime * 2.1);
          vec3 pn = normalize(vec3(w1 * 0.08 + w2 * 0.04, 1.0, w2 * 0.05 + w1 * 0.03));
          normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);`);
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER_LEVEL;
    this.water.renderOrder = 1;
    this.scene.add(this.water);
  }

  setWeather(name, instant = false) {
    if (!WEATHER[name]) return;
    this.weatherName = name;
    this.target = WEATHER[name];
    if (instant) this.w = { ...this.target };
  }

  setViewDistance(d) { this.viewDist = d; }

  // Sun elevation in [-1,1] from time
  sunElevation() {
    const t = (this.time - 6) / 24 * Math.PI * 2; // 6:00 sunrise, 18:00 sunset
    return Math.sin(t);
  }

  isNight() { return this.daylight < 0.25; }

  update(dt, camPos) {
    const dh = (dt * this.timeScale * 24) / this.daySeconds;
    const before = this.time;
    this.time = (this.time + dh) % 24;
    if (this.time < before && dh > 0) this.day++;
    this.totalHours += dh;

    // Weather interpolation
    const k = 1 - Math.exp(-dt * 0.35);
    for (const key of ['fog', 'cloud', 'rain', 'snow', 'light', 'wind', 'gray']) {
      this.w[key] = lerp(this.w[key], this.target[key], dt === 0 ? 1 : k);
    }

    // Wind slowly wanders
    if (Math.random() < dt * 0.02) this.windTarget += (Math.random() - 0.5) * 1.6;
    this.windAngle = damp(this.windAngle, this.windTarget, 0.2, dt);
    const ws = this.w.wind * (0.8 + 0.2 * Math.sin(performance.now() * 0.0003));
    this.wind.set(Math.sin(this.windAngle) * ws, 0, Math.cos(this.windAngle) * ws);

    // Sun position
    const t = (this.time - 6) / 24 * Math.PI * 2;
    const elev = Math.sin(t);
    this.sunDir.set(Math.cos(t) * 0.9, elev, 0.35).normalize();
    const moonDir = this.sunDir.clone().multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.9 + 0.1;
    moonDir.normalize();

    // Interpolate sky keyframes
    let i = 0;
    while (i < SKY_KEYS.length - 2 && elev > SKY_KEYS[i + 1][0]) i++;
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
    const f = clamp((elev - a[0]) / (b[0] - a[0]), 0, 1);
    const top = new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), f);
    const hor = new THREE.Color(a[2]).lerp(new THREE.Color(b[2]), f);
    const sunCol = new THREE.Color(a[3]).lerp(new THREE.Color(b[3]), f);
    let sunI = lerp(a[4], b[4], f), hemiI = lerp(a[5], b[5], f);

    this.daylight = smoothstep(-0.12, 0.2, elev);

    // Overcast desaturation
    const g = this.w.gray;
    const lum = 0.35 + 0.55 * this.daylight;
    const gray = new THREE.Color(0.5, 0.53, 0.56).multiplyScalar(lum * lum);
    top.lerp(gray, g * 0.85);
    hor.lerp(gray.clone().multiplyScalar(1.1), g * 0.75);
    sunI *= lerp(1, 0.15, g) * this.w.light;
    hemiI *= lerp(1, 0.85, g);

    // Lightning flash
    if (this.weatherName === 'storm') {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.lightning = 1;
        this.nextLightning = 6 + Math.random() * 14;
        if (this.onThunder) this.onThunder(0.6 + Math.random() * 2.5);
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    const flash = this.lightning > 0 ? this.lightning * (0.6 + 0.4 * Math.sin(this.lightning * 40)) : 0;

    this.skyUniforms.uTop.value.copy(top).addScalar(flash * 0.3);
    this.skyUniforms.uHorizon.value.copy(hor).addScalar(flash * 0.3);
    this.skyUniforms.uGround.value.copy(hor).multiplyScalar(0.6);
    this.skyUniforms.uSunDir.value.copy(this.sunDir);
    this.skyUniforms.uSunColor.value.copy(sunCol).multiplyScalar(1 - g * 0.9);
    this.skyUniforms.uMoonDir.value.copy(moonDir);
    this.skyUniforms.uMoon.value = (1 - this.daylight) * (1 - g * 0.8);
    this.sky.position.copy(camPos);
    this.stars.position.copy(camPos);
    this.stars.rotation.y = this.time * 0.05;
    this.starMat.opacity = clamp(1 - this.daylight * 1.6, 0, 1) * (1 - g) * 0.95;

    // Lights: sun by day, cool moonlight by night
    const night = 1 - this.daylight;
    if (elev > -0.05) {
      this.sun.position.copy(camPos).addScaledVector(this.sunDir, 160);
      this.sun.color.copy(sunCol);
      this.sun.intensity = sunI + flash * 2;
    } else {
      this.sun.position.copy(camPos).addScaledVector(moonDir, 160);
      this.sun.color.setRGB(0.55, 0.65, 0.9);
      this.sun.intensity = 0.7 * (1 - g * 0.6) + flash * 3;
    }
    this.sun.target.position.copy(camPos);
    // snap shadow camera to texel grid to reduce shimmering
    this.sun.target.updateMatrixWorld();
    this.hemi.intensity = hemiI + night * 0.2 + flash * 1.5;
    this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.setRGB(0.28, 0.24, 0.17).multiplyScalar(0.3 + this.daylight * 0.7);

    // Fog
    this.fogColor.copy(hor).lerp(top, 0.15);
    this.scene.fog.color.copy(this.fogColor);
    const far = this.viewDist * this.w.fog;
    this.scene.fog.far = far;
    this.scene.fog.near = Math.min(far * 0.15, 30);

    // Procedural clouds drift with the wind (rendered in the sky shader)
    const su = this.skyUniforms;
    su.uCloud.value = this.w.cloud;
    su.uCloudOff.value.x += this.wind.x * dt * 0.0012;
    su.uCloudOff.value.y += this.wind.z * dt * 0.0012;
    const cl = 0.012 + this.daylight * 0.988;
    su.uCloudCol.value.setRGB(cl, cl, cl * 1.03).lerp(gray, g * 0.7).addScalar(flash * 0.5);
    su.uCloudShade.value.copy(su.uCloudCol.value).multiplyScalar(0.55 + (1 - g) * 0.15).lerp(top, 0.15);

    // Precipitation
    const tnow = performance.now() / 1000;
    this.rain.visible = this.w.rain > 0.02;
    if (this.rain.visible) {
      const u = this.precipUniforms;
      u.uTime.value = tnow; u.uCam.value.copy(camPos); u.uWind.value.set(this.wind.x, this.wind.z);
      u.uOpacity.value = clamp(this.w.rain, 0, 1.3) * 0.38 * (0.35 + this.daylight * 0.65);
      u.uSpeed.value = 18 + this.w.rain * 4;
    }
    this.snow.visible = this.w.snow > 0.02;
    if (this.snow.visible) {
      const u = this.snowUniforms;
      u.uTime.value = tnow; u.uCam.value.copy(camPos); u.uWind.value.set(this.wind.x, this.wind.z);
      u.uOpacity.value = this.w.snow * 0.9 * (0.3 + this.daylight * 0.7);
    }

    this.waterUniforms.uTime.value = tnow;
    this.water.material.color.setRGB(0.04, 0.1, 0.12).multiplyScalar(0.4 + this.daylight * 0.6).lerp(this.fogColor, 0.12);
  }

  // How well things can be seen (0..1) — used by animal and player perception.
  visibilityFactor() {
    return clamp((0.25 + this.daylight * 0.75) * clamp(this.w.fog * 1.2, 0.3, 1), 0.15, 1);
  }
  // Rain/wind masks sounds.
  noiseMasking() {
    return clamp(this.w.rain * 0.45 + this.w.wind * 0.025, 0, 0.75);
  }
}
