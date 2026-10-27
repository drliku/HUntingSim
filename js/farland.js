// The land beyond the edge of the map: a coarse ring of forested hills that continues the real
// terrain at the boundary and rises towards the mountain ranges, so the horizon is a landscape
// fading into haze instead of a fog wall. Not walkable; the scene fog gives it aerial perspective.
import * as THREE from 'three';
import { heightAnalytic, HALF } from './terrain.js';
import { fbm, noise2, smoothstep } from './utils.js';

export const FAR_EXTENT = 820;

export function farHeight(x, z) {
  const e = Math.max(Math.abs(x), Math.abs(z));
  let h = heightAnalytic(x, z);
  // beyond the map the hills keep climbing, broken up into ridges and valleys
  const out = smoothstep(HALF, HALF + 260, e);
  const ridge = fbm(x * 0.0032 + 7, z * 0.0032 - 3, 4) * 0.5 + 0.5;
  h += out * (25 + ridge * 95) + smoothstep(HALF + 150, FAR_EXTENT, e) * 60;
  // canopy roughness: the forest reads as a bumpy, darker surface from afar
  h += noise2(x * 0.06, z * 0.06) * 1.6 * out;
  return h;
}

export function buildFarLand(scene) {
  const step = 10, n = Math.round((FAR_EXTENT * 2) / step);
  const pos = new Float32Array((n + 1) * (n + 1) * 3), col = new Float32Array((n + 1) * (n + 1) * 3);
  const inside = new Uint8Array((n + 1) * (n + 1));
  const c = new THREE.Color(), canopyA = new THREE.Color(0x203419), canopyB = new THREE.Color(0x34492a);
  const meadow = new THREE.Color(0x56692e), rock = new THREE.Color(0x5c5850), snow = new THREE.Color(0xd8dde2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = j * (n + 1) + i, x = -FAR_EXTENT + i * step, z = -FAR_EXTENT + j * step;
    const e = Math.max(Math.abs(x), Math.abs(z));
    inside[k] = e < HALF - 8 ? 1 : 0;
    // tuck it slightly under the real terrain where they meet so no seam shows
    const h = e < HALF + 2 ? heightAnalytic(x, z) - 0.6 : farHeight(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    c.copy(canopyA).lerp(canopyB, noise2(x * 0.02, z * 0.02) * 0.5 + 0.5);
    c.lerp(meadow, smoothstep(0.55, 0.8, noise2(x * 0.007 + 11, z * 0.007) * 0.5 + 0.5) * 0.6);
    c.lerp(rock, smoothstep(105, 150, h) * 0.8);
    c.lerp(snow, smoothstep(165, 200, h));
    c.multiplyScalar(0.9 + noise2(x * 0.15, z * 0.15) * 0.12);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + n + 1, d = a + 1, cc = b + 1;
    if (inside[a] && inside[b] && inside[d] && inside[cc]) continue; // the real terrain covers this
    idx.push(a, b, d, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.noDetail = true;
  const mesh = new THREE.Mesh(g, mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
