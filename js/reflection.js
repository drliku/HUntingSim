// Planar reflections for the water: every frame the scene is drawn from a camera mirrored in the
// water plane into a smaller render target, which the water shader samples (rippled by its
// waves). An oblique clip plane cuts away everything below the water so the lake bed does not
// show up in the reflection. Grass, particles and the water itself are left out to keep it cheap.
import * as THREE from 'three';
import { WATER_LEVEL, LAKE, riverDistance } from './terrain.js';

const _cw = new THREE.Vector3(), _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _target = new THREE.Vector3();
const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
const N = new THREE.Vector3(0, 1, 0), P0 = new THREE.Vector3(0, WATER_LEVEL, 0);

export class WaterReflection {
  constructor(quality) {
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = true;
    this.target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    this.textureMatrix = new THREE.Matrix4();
    this.hidden = [];   // objects to leave out of the reflection
    this.frame = 0;
    this.setQuality(quality);
  }

  setQuality(q) {
    this.enabled = !!q.post;
    this.scale = q.msaa >= 4 ? 0.5 : 0.35;
    this.every = q.msaa >= 4 ? 1 : 2;   // Medium refreshes the reflection every other frame
  }

  setSize(w, h) { this.target.setSize(Math.max(2, Math.round(w * this.scale)), Math.max(2, Math.round(h * this.scale))); }

  // is any water close enough to be worth reflecting?
  nearWater(cam) {
    if (cam.y - WATER_LEVEL > 70) return false;
    return riverDistance(cam.x, cam.z) < 140 || Math.hypot(cam.x - LAKE.x, cam.z - LAKE.z) < LAKE.r + 140;
  }

  render(renderer, scene, camera) {
    this.active = this.enabled && this.nearWater(camera.position);
    if (!this.active) return;
    if (this.frame++ % this.every !== 0) return;
    const vc = this.camera;
    camera.updateMatrixWorld();
    _cw.setFromMatrixPosition(camera.matrixWorld);
    if (_cw.y < WATER_LEVEL + 0.05) { this.active = false; return; } // under or at the surface
    // mirror the camera in the water plane
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
    vc.position.set(_cw.x, 2 * WATER_LEVEL - _cw.y, _cw.z);
    _target.set(_look.x, 2 * WATER_LEVEL - _look.y, _look.z);
    vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(N);
    vc.lookAt(_target);
    vc.near = camera.near; vc.far = camera.far; vc.fov = camera.fov; vc.aspect = camera.aspect;
    vc.updateProjectionMatrix();
    vc.updateMatrixWorld();
    vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane at the water surface (Lengyel's method, as in three's Reflector)
    _plane.setFromNormalAndCoplanarPoint(N, P0).applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + pm[8]) / pm[0], (Math.sign(_clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    pm[2] = _clip.x; pm[6] = _clip.y; pm[10] = _clip.z + 1 - 0.003; pm[14] = _clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    // draw it: no shadow map update (the main pass already does that), no grass or water
    const vis = this.hidden.map((o) => o.visible);
    this.hidden.forEach((o) => { o.visible = false; });
    const prevTarget = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    this.hidden.forEach((o, i) => { o.visible = vis[i]; });
  }
}
