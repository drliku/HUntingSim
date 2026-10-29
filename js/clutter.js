// Ground clutter around the player: fallen leaves and twigs on the forest floor, pinecones under
// the trees, mushrooms in the damp shade, and pebbles along trails and riverbanks. Instanced in
// small chunks that only show close up, so the ground reads as rich without costing much.
import * as THREE from 'three';
import { colorize, mergeColored, xf } from './geo.js';
import { mulberry32 } from './utils.js';

const CHUNK = 32, SHOW = 12; // bigger chunks = fewer draw calls; tiny things only show up close
const UP = new THREE.Vector3(0, 1, 0);

function flatShape(pts, color, y = 0) {
  // a flat polygon (fan) lying on the ground; pts: [[x, z], ...]
  const pos = [], cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    pos.push(cx, y + 0.004, cz, b[0], y, b[1], a[0], y, a[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return colorize(g, color);
}

function leafPatch(seed) {
  const r = mulberry32(seed), p = [];
  const cols = [0x5a3c22, 0x6a4626, 0x7a5a2e, 0x4e3a26, 0x6a3a22, 0x4a4228, 0x7a6a34, 0x3e3a24];
  for (let i = 0; i < 40; i++) {
    const x = (r() - 0.5) * 1.7, z = (r() - 0.5) * 1.7, a = r() * Math.PI * 2, L = 0.035 + r() * 0.03, W = L * 0.55;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pt = (u, v) => [x + u * ca - v * sa, z + u * sa + v * ca];
    p.push(flatShape([pt(-L, 0), pt(-L * 0.2, W), pt(L, 0), pt(-L * 0.2, -W)], cols[Math.floor(r() * cols.length)], 0.005 + i * 0.0005));
  }
  // a couple of twigs
  for (let i = 0; i < 3; i++) {
    const x = (r() - 0.5) * 1.3, z = (r() - 0.5) * 0.8, a = r() * Math.PI;
    p.push(colorize(xf(new THREE.CylinderGeometry(0.008, 0.011, 0.35 + r() * 0.3, 4), x, 0.012, z, 0, a, Math.PI / 2), 0x4a3828));
  }
  return mergeColored(p);
}

function pebbles(seed) {
  const r = mulberry32(seed), p = [];
  for (let i = 0; i < 5; i++) {
    const s = 0.03 + r() * 0.07;
    p.push(colorize(xf(new THREE.DodecahedronGeometry(1, 0), (r() - 0.5) * 0.7, s * 0.25, (r() - 0.5) * 0.7, r(), r(), r(), s, s * 0.6, s * 1.2), [0x6e6a62, 0x7e786e, 0x5a5650, 0x8a857c][i % 4]));
  }
  return mergeColored(p);
}

function pinecones(seed) {
  const r = mulberry32(seed), p = [];
  for (let i = 0; i < 3; i++) {
    const x = (r() - 0.5) * 0.6, z = (r() - 0.5) * 0.6;
    p.push(colorize(xf(new THREE.ConeGeometry(0.025, 0.08, 6, 2), x, 0.025, z, Math.PI / 2, r() * 6, 0), 0x5a3a20));
    p.push(colorize(xf(new THREE.SphereGeometry(0.026, 6, 4), x, 0.025, z, 0, 0, 0, 1.2, 0.9, 1.2), 0x6a4626));
  }
  return mergeColored(p);
}

function mushrooms(seed) {
  const r = mulberry32(seed), p = [];
  const red = r() < 0.4;
  for (let i = 0; i < 3; i++) {
    const x = (r() - 0.5) * 0.25, z = (r() - 0.5) * 0.25, h = 0.04 + r() * 0.05, cr = 0.025 + r() * 0.03;
    p.push(colorize(xf(new THREE.CylinderGeometry(cr * 0.28, cr * 0.36, h, 6), x, h / 2, z), 0xe6dccb));
    p.push(colorize(xf(new THREE.SphereGeometry(cr, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), x, h, z, 0, 0, 0, 1, 0.6, 1), red ? 0xb0281e : 0x9a6a3a));
    if (red) for (let k = 0; k < 4; k++) p.push(colorize(xf(new THREE.SphereGeometry(cr * 0.14, 4, 3), x + Math.cos(k * 1.7) * cr * 0.55, h + cr * 0.42, z + Math.sin(k * 1.7) * cr * 0.55), 0xf4efe6));
  }
  return mergeColored(p);
}

export class GroundClutter {
  constructor(scene, terrain, half) {
    this.scene = scene;
    this.chunks = [];
    this.geos = { leaves: [leafPatch(1), leafPatch(2)], pebbles: pebbles(4), cones: pinecones(5), shrooms: [mushrooms(6), mushrooms(7)] };
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const T = terrain, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    const n = Math.ceil((half * 2) / CHUNK);
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      const r = mulberry32(9100 + cz * 131 + cx);
      const x0 = -half + cx * CHUNK, z0 = -half + cz * CHUNK;
      const lists = { leaves0: [], leaves1: [], pebbles: [], cones: [], shrooms0: [], shrooms1: [] };
      for (let i = 0; i < 660; i++) {
        const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, h = T.getHeight(x, z);
        if (h < 0.25) continue;
        const d = T.densityAt(x, z), trail = T.trailAt(x, z), roll = r();
        const it = { x, y: h, z, s: 0.75 + r() * 0.6, a: r() * 6.28 };
        if (roll < d * 0.85 + 0.04) lists['leaves' + (i % 2)].push(it);
        else if ((trail < 2.5 && roll < 0.5) || (h < 1.4 && roll < 0.45) || roll > 0.995) lists.pebbles.push(it);
        else if (d > 0.4 && roll > 0.96) lists.cones.push(it);
        else if (d > 0.55 && roll > 0.94 && roll < 0.95) lists['shrooms' + (i % 2)].push(it);
      }
      const meshes = [];
      for (const [k, items] of Object.entries(lists)) {
        if (!items.length) continue;
        const geo = k.startsWith('leaves') ? this.geos.leaves[+k.slice(6)] : k.startsWith('shrooms') ? this.geos.shrooms[+k.slice(7)] : this.geos[k];
        const mesh = new THREE.InstancedMesh(geo, this.mat, items.length);
        items.forEach((it, i) => {
          q.setFromAxisAngle(UP, it.a);
          m4.compose(pv.set(it.x, it.y - 0.01, it.z), q, sv.set(it.s, it.s, it.s));
          mesh.setMatrixAt(i, m4);
        });
        mesh.computeBoundingSphere();
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        mesh.castShadow = k === 'shrooms0' || k === 'shrooms1' || k === 'cones';
        mesh.visible = false;
        scene.add(mesh);
        meshes.push(mesh);
      }
      if (meshes.length) this.chunks.push({ x: x0 + CHUNK / 2, z: z0 + CHUNK / 2, meshes });
    }
  }

  update(camPos) {
    for (const c of this.chunks) {
      const vis = Math.hypot(c.x - camPos.x, c.z - camPos.z) - CHUNK * 0.71 < SHOW;
      if (vis !== c.vis) { c.vis = vis; for (const m of c.meshes) m.visible = vis; }
    }
  }

  // remove clutter from a cleared building site
  clearArea(x, z, r) {
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const c of this.chunks) {
      if (Math.hypot(c.x - x, c.z - z) > r + CHUNK) continue;
      for (const mesh of c.meshes) {
        let changed = false;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m4); p.setFromMatrixPosition(m4);
          if (Math.hypot(p.x - x, p.z - z) < r) { mesh.setMatrixAt(i, zero); changed = true; }
        }
        if (changed) mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
