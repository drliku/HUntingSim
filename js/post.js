// Post-processing: the scene and the weapon in your hands are rendered into an HDR,
// multisampled target, then get ambient occlusion, cloud shadows and valley mist (from depth),
// light shafts, a soft bloom (sun, lanterns, fire, muzzle flash), colour grading with a gentle
// vignette, and finally tone mapping to the screen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { WATER_LEVEL } from './terrain.js';
import { WaterReflection } from './reflection.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.3 },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.05 },
    uWarm: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
    uCool: { value: new THREE.Vector3(0.96, 0.99, 1.04) },
    uAspect: { value: 1 },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
    uTime: { value: 0 },
    uSharpen: { value: 0.35 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast, uAspect, uTime, uSharpen;
    uniform vec2 uTexel;
    uniform vec3 uWarm, uCool;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = max(tex.rgb, 0.0);
      // contrast-adaptive sharpening: pull detail out of the image without ringing on edges
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
      vec3 amt = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0)) * uSharpen;
      c = max(c + (c * 4.0 - (n + s + e + w)) * amt * 0.25, 0.0);
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // contrast around mid grey (the image is still linear here, before tone mapping)
      c = 0.18 * pow(c / 0.18 + 1e-5, vec3(uContrast));
      lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(lum), c, uSaturation);
      // split toning: cool shadows, warm highlights
      float hl = smoothstep(0.05, 0.6, lum);
      c *= mix(uCool, uWarm, hl);
      // vignette
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      c *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(d));
      // fine animated grain (also hides banding in the sky and fog)
      float gr = fract(sin(dot(vUv * 1000.0 + uTime * 61.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c *= 1.0 + gr * 0.035;
      gl_FragColor = vec4(c, tex.a);
    }`,
};

// Light shafts: bright sky around the sun is smeared towards the sun's position on screen,
// so trees and hills cut visible rays into the light.
const RaysShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uTint: { value: new THREE.Color(1, 0.92, 0.78) } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uStrength;
    uniform vec3 uTint;
    varying vec2 vUv;
    const int N = 36;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.001) { gl_FragColor = base; return; }
      vec2 delta = (vUv - uSun) * (0.92 / float(N));
      vec2 uv = vUv;
      float illum = 1.0, acc = 0.0;
      for (int i = 0; i < N; i++) {
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
        float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
        acc += clamp(l - 1.35, 0.0, 3.0) * illum;
        illum *= 0.95;
      }
      float fall = 1.0 - smoothstep(0.0, 0.9, length((vUv - uSun) * vec2(1.6, 1.0)));
      gl_FragColor = vec4(base.rgb + uTint * acc * (uStrength / float(N)) * (0.35 + 0.65 * fall), base.a);
    }`,
};
// Ambient occlusion, cloud shadows and valley mist, all worked out from the depth buffer.
// AO is computed at half resolution (screen-space, normals rebuilt from depth), then blurred
// back up with a depth-aware filter and multiplied into the image together with the drifting
// cloud shadows and the low mist that settles over water and in hollows at dawn.
const AO_FS = /* glsl */`
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform mat4 uProjInv;
  uniform float uProjY, uRadius;
  varying vec2 vUv;
  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1000.0, 0.0, 1.0); return; }
    vec3 P = viewPos(vUv);
    float dist = -P.z;
    vec2 px = 1.0 / uRes;
    vec3 Px = viewPos(vUv + vec2(px.x, 0.0)), Pxn = viewPos(vUv - vec2(px.x, 0.0));
    vec3 Py = viewPos(vUv + vec2(0.0, px.y)), Pyn = viewPos(vUv - vec2(0.0, px.y));
    vec3 dx = abs(Px.z - P.z) < abs(P.z - Pxn.z) ? Px - P : P - Pxn;
    vec3 dy = abs(Py.z - P.z) < abs(P.z - Pyn.z) ? Py - P : P - Pyn;
    vec3 N = normalize(cross(dx, dy));
    float R = uRadius * (1.0 + dist * 0.012);
    float rad = clamp(R * uProjY * 0.5 / dist, px.y * 3.0, 0.12);
    float ang = hash12(gl_FragCoord.xy) * 6.2831;
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = (float(i) + 0.5) / 12.0;
      float a = ang + float(i) * 2.39996;
      vec2 off = vec2(cos(a) * uRes.y / uRes.x, sin(a)) * rad * sqrt(fi);
      vec3 v = viewPos(vUv + off) - P;
      float vv = dot(v, v);
      occ += max(0.0, dot(v, N) * inversesqrt(vv + 1e-6) - 0.18) * clamp(1.0 - vv / (R * R * 1.6), 0.0, 1.0);
    }
    float ao = clamp(1.0 - occ / 12.0 * 3.2, 0.0, 1.0);
    ao = mix(1.0, ao, 1.0 - smoothstep(40.0, 95.0, dist));
    gl_FragColor = vec4(ao, dist, 0.0, 1.0);
  }`;

const COMPOSE_FS = /* glsl */`
  uniform sampler2D tDiffuse, tDepth, tAO;
  uniform vec2 uAORes;
  uniform mat4 uProjInv, uCamWorld;
  uniform float uAOStrength, uCloud, uTime, uMist, uMistBase;
  uniform vec2 uCloudOff;
  uniform vec3 uSunDir, uMistColor;
  varying vec2 vUv;
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec4 col = texture2D(tDiffuse, vUv);
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = (any(isnan(col)) || any(isinf(col))) ? vec4(0.0) : col; return; }
    vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec3 P = vp.xyz / vp.w;
    float dist = -P.z;
    vec3 c = col.rgb;
    // depth-aware blur of the half-resolution AO
    if (uAOStrength > 0.0) {
      vec2 t = 1.0 / uAORes;
      float sum = 0.0, wsum = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 s = texture2D(tAO, vUv + vec2(float(x), float(y)) * t * 1.2).xy;
        float w = 1.0 / (0.02 + abs(s.y - dist) / max(dist, 1.0) * 30.0);
        sum += s.x * w; wsum += w;
      }
      float ao = sum / wsum;
      c *= mix(1.0, ao, uAOStrength);
    }
    vec3 wp = (uCamWorld * vec4(P, 1.0)).xyz;
    // drifting cloud shadows, cast along the sun direction from a layer high above
    if (uCloud > 0.001 && dist < 380.0) {
      vec2 q = wp.xz + uSunDir.xz / max(uSunDir.y, 0.15) * (140.0 - wp.y);
      q = q * 0.018 + uCloudOff;
      float n = vnoise(q) * 0.62 + vnoise(q * 2.3 + 7.1) * 0.28 + vnoise(q * 5.1 - 3.3) * 0.1;
      float sh = smoothstep(0.52, 0.6, n);
      c *= 1.0 - sh * uCloud * (1.0 - smoothstep(120.0, 320.0, dist)); // far away the haze hides them
    }
    // low mist hugging the water and the hollows
    if (uMist > 0.001 && dist < 380.0) {
      float hgt = exp(-max(0.0, wp.y - uMistBase) / 5.0);
      float m = uMist * hgt * (1.0 - exp(-dist * 0.025));
      m *= 0.75 + 0.25 * vnoise(wp.xz * 0.05 + vec2(uTime * 0.02, 0.0));
      c = mix(c, uMistColor, clamp(m, 0.0, 0.8));
    }
    // a single bad pixel would be smeared over the whole screen by the bloom
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    gl_FragColor = vec4(c, col.a);
  }`;

class AtmosPass extends Pass {
  constructor(camera, aoOn) {
    super();
    this.camera = camera;
    this.aoOn = aoOn;
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uRes: { value: new THREE.Vector2(2, 2) }, uProjInv: { value: new THREE.Matrix4() }, uProjY: { value: 1 }, uRadius: { value: 1.0 } },
      vertexShader: GradeShader.vertexShader, fragmentShader: AO_FS, depthTest: false, depthWrite: false,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, tAO: { value: this.aoTarget.texture }, uAORes: { value: new THREE.Vector2(2, 2) },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uAOStrength: { value: aoOn ? 0.9 : 0 }, uCloud: { value: 0 }, uTime: { value: 0 }, uMist: { value: 0 }, uMistBase: { value: 1.5 },
        uCloudOff: { value: new THREE.Vector2() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMistColor: { value: new THREE.Color() },
      },
      vertexShader: GradeShader.vertexShader, fragmentShader: COMPOSE_FS, depthTest: false, depthWrite: false,
    });
    this.aoQuad = new FullScreenQuad(this.aoMat);
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(w, h) {
    const aw = Math.max(1, Math.round(w / 2)), ah = Math.max(1, Math.round(h / 2));
    this.aoTarget.setSize(aw, ah);
    this.aoMat.uniforms.uRes.value.set(aw, ah);
    this.mat.uniforms.uAORes.value.set(aw, ah);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer.depthTexture;
    const cam = this.camera;
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    this.mat.uniforms.tDepth.value = depth;
    this.mat.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.mat.uniforms.uCamWorld.value.copy(cam.matrixWorld);
    if (this.aoOn && depth) {
      this.aoMat.uniforms.tDepth.value = depth;
      this.aoMat.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
      this.aoMat.uniforms.uProjY.value = cam.projectionMatrix.elements[5];
      renderer.setRenderTarget(this.aoTarget);
      this.aoQuad.render(renderer);
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() { this.aoTarget.dispose(); this.aoMat.dispose(); this.mat.dispose(); this.aoQuad.dispose(); this.quad.dispose(); }
}

const _sunP = new THREE.Vector3(), _fwd = new THREE.Vector3();

export class PostFX {
  constructor(renderer, scene, camera, equipment, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.equipment = equipment;
    this.enabled = false;
    this.composer = null;
    this.reflection = new WaterReflection(quality);
    this.setQuality(quality);
  }

  build(q) {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa || 0 });
    target.depthTexture = new THREE.DepthTexture(size.x, size.y);
    const composer = new EffectComposer(r, target);
    composer.setPixelRatio(r.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
    this.scenePass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.scenePass);
    // AO, cloud shadows and mist need the scene's depth, so they come before the weapon is drawn
    this.atmos = new AtmosPass(this.camera, !!q.ao);
    composer.addPass(this.atmos);
    this.cloudOff = new THREE.Vector2(); this.lastT = performance.now();
    // the weapon in your hands, drawn on top with its own camera and lights
    this.vmPass = new RenderPass(this.equipment.vmScene, this.equipment.vmCamera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    composer.addPass(this.vmPass);
    const res = new THREE.Vector2(window.innerWidth, window.innerHeight).multiplyScalar(q.bloomRes || 0.5);
    this.rays = new ShaderPass(RaysShader);
    composer.addPass(this.rays);
    this.bloom = new UnrealBloomPass(res, 0.32, 0.55, 0.88);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setQuality(q) {
    const want = !!q.post;
    if (this.reflection) { this.reflection.setQuality(q); this.reflection.setSize(window.innerWidth * this.renderer.getPixelRatio(), window.innerHeight * this.renderer.getPixelRatio()); }
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); this.atmos?.dispose(); this.composer = null; }
    this.enabled = want;
    if (want) {
      try { this.build(q); } catch (e) { console.warn('Post-processing unavailable:', e); this.enabled = false; }
    }
  }

  setSize(w, h) {
    this.reflection.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.setSize(w * 0.5, h * 0.5);
  }

  // night and weather change how strong the bloom and grading look
  update(env) {
    this.env = env;
    if (!this.enabled) return;
    const day = env.daylight;
    this.bloom.strength = 0.22 + (1 - day) * 0.35 + (env.w.fog < 0.6 ? 0.06 : 0);
    this.grade.uniforms.uSaturation.value = 0.98 + day * 0.04 - (env.w.rain || 0) * 0.15;
    this.grade.uniforms.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    this.grade.uniforms.uTime.value = (performance.now() / 1000) % 100;
    { const pr = this.renderer.getPixelRatio(); this.grade.uniforms.uTexel.value.set(1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr)); }
    // cloud shadows sweep over the land on broken-cloud days; mist settles at dawn and in fog
    const now = performance.now(), dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const au = this.atmos.mat.uniforms, cl = env.w.cloud;
    this.cloudOff.x += env.wind.x * dt * 0.0035; this.cloudOff.y += env.wind.z * dt * 0.0035;
    au.uCloudOff.value.copy(this.cloudOff);
    au.uSunDir.value.copy(env.sunDir);
    au.uCloud.value = (0.18 + Math.min(1, cl * 1.6) * 0.22) * (1 - Math.max(0, cl - 0.75) * 3.2) * Math.max(0, Math.min(1, env.sunDir.y * 4)) * env.daylight;
    au.uCloud.value = Math.max(0, au.uCloud.value);
    const t = env.time, dawn = Math.max(0, Math.min(1, (t - 4.3) / 1.8)) * (1 - Math.max(0, Math.min(1, (t - 7.6) / 2.4)));
    au.uMist.value = Math.min(0.9, dawn * 0.6 + (1 - env.w.fog) * 0.45 + (env.w.rain || 0) * 0.15 + (1 - env.daylight) * 0.12);
    au.uMistBase.value = WATER_LEVEL + 1.5;
    au.uMistColor.value.copy(this.scene.fog.color).multiplyScalar(0.95);
    au.uTime.value = now / 1000;
    // rays only when the sun is up and somewhere ahead of the camera
    const cam = this.camera;
    _sunP.copy(env.sunDir).multiplyScalar(300).add(cam.position);
    cam.getWorldDirection(_fwd);
    const facing = env.sunDir.dot(_fwd);
    _sunP.project(cam);
    const sx = _sunP.x * 0.5 + 0.5, sy = _sunP.y * 0.5 + 0.5;
    const onScreen = 1 - Math.min(1, Math.max(0, Math.hypot(Math.max(0, Math.abs(sx - 0.5) - 0.5), Math.max(0, Math.abs(sy - 0.5) - 0.5)) * 2.5));
    const strength = Math.max(0, facing) > 0.05 && env.sunDir.y > -0.02 ? onScreen * Math.min(1, facing * 2) * Math.min(1, (env.sunDir.y + 0.02) * 6) * env.w.light * (1 - (env.w.rain || 0) * 0.8) : 0;
    this.rays.uniforms.uSun.value.set(sx, sy);
    this.rays.uniforms.uStrength.value = strength * 0.42;
    this.rays.uniforms.uTint.value.setRGB(1, 0.86 + env.sunDir.y * 0.3, 0.68 + env.sunDir.y * 0.5);
  }

  render(showWeapon) {
    this.vmPass.enabled = showWeapon && Object.values(this.equipment.models).some((m) => m.visible);
    const wu = this.env && this.env.waterUniforms;
    if (wu && wu.tRefl) {
      this.reflection.render(this.renderer, this.scene, this.camera);
      wu.tRefl.value = this.reflection.target.texture;
      wu.uReflMat.value = this.reflection.textureMatrix;
      wu.uRefl.value = this.reflection.active ? 1 : 0;
    }
    this.composer.render();
  }
}
