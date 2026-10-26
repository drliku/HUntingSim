// Construction detail added on top of the basic cabins and storefronts: chinked logs with
// end grain, stone foundations and chimneys, shingled roofs, sills, porch clutter, awnings and lanterns.
import * as THREE from 'three';
import { colorize, mergeColored, xf } from './geo.js';

export const decoMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc860 });
const _c = new THREE.Color();
export const hash = (a, b) => { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };
export const shade = (hex, k) => _c.setHex(hex).multiplyScalar(k).getHex();
export const box = (p, w, h, d, x, y, z, c, rx = 0, ry = 0, rz = 0) => p.push(colorize(xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz), c));
export const STONES = [0x6e6a62, 0x7c776d, 0x5e5a53, 0x86817a];

// Individual shingle tabs on a roof board. Shingle frame: courses run along x (`width`),
// the slope runs along z (`len`), +y is out of the roof, and the eave is at z = eaveSign * len / 2.
// m4 places that frame on the board's top face.
export function shingles(p, width, len, m4, colors, eaveSign, tab = 0.38) {
  const rows = Math.max(4, Math.round(len / 0.3)), rowLen = len / rows;
  const g0 = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const z = eaveSign * (len / 2 - rowLen * (i + 0.5));
    const off = (i % 2) * tab * 0.5;
    for (let x = -width / 2 - off; x < width / 2; x += tab) {
      const xa = Math.max(-width / 2, x), xb = Math.min(width / 2, x + tab);
      if (xb - xa < 0.04) continue;
      const k = hash(i * 3.1 + x, width);
      // tilt so the lower edge lifts off the course below
      e.set(-eaveSign * 0.07, (k - 0.5) * 0.03, 0);
      v.set((xa + xb) / 2, 0.075, z);
      sc.set(xb - xa - 0.018, 0.03, rowLen * 1.28);
      m.compose(v, q.setFromEuler(e), sc).premultiply(m4);
      p.push(colorize(g0.clone().applyMatrix4(m), colors[Math.floor(k * colors.length)]));
    }
  }
}

// A course of rough stone blocks along a wall line, from yBot up to yTop
export function stonesAlong(p, x0, z0, x1, z1, yBot, yTop, seed, depth = 0.16) {
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
  const dirX = (x1 - x0) / len, dirZ = (z1 - z0) / len;
  const rows = Math.max(1, Math.round((yTop - yBot) / 0.22)), h = (yTop - yBot) / rows;
  for (let r = 0; r < rows; r++) {
    let s = -(r % 2) * 0.18;
    while (s < len) {
      const a = Math.max(0, s), b = Math.min(len, s + 0.3 + hash(seed + s, r) * 0.3);
      const w = b - a;
      if (w > 0.05) {
        const mid = (a + b) / 2;
        const col = STONES[Math.floor(hash(seed + r, s * 1.7) * 4)];
        const j = (hash(s, seed + r) - 0.5) * 0.03;
        box(p, w - 0.025, h - 0.03, depth + j, x0 + dirX * mid, yBot + h * (r + 0.5), z0 + dirZ * mid, col, 0, -ang, 0);
      }
      s = b;
    }
  }
}

// Pale sawn end of a log with its darker heart, facing along x (alongX) or z
export function endGrain(p, x, y, z, alongX) {
  const rx = alongX ? 0 : Math.PI / 2, rz = alongX ? Math.PI / 2 : 0;
  p.push(colorize(xf(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 10), x, y, z, rx, 0, rz), 0xb08a5a));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.045, 0.045, 0.024, 7), x, y, z, rx, 0, rz), 0x86663f));
}

export function decorateCabin(world, c) {
  const { W, D, H, rh, dx, dw, dh, floor } = c;
  const p = [], r = [];
  // ---- mortar chinking between the logs, and pale end grain where logs cross at the corners
  const mortar = 0xcfc4ad;
  const disc = (x, y, z, alongX) => endGrain(p, x, y, z, alongX);
  const aW = dx - dw / 2 + W / 2, bW = W / 2 - (dx + dw / 2);
  for (let i = 0; i < 10; i++) {
    const y = 0.13 + i * 0.25;
    for (const s of [-1, 1]) {
      if (i < 9) {
        // front and back walls; the front one stops at the doorway
        const z = s * (D / 2 + 0.02), cy = y + 0.125;
        if (s > 0 && cy < dh) {
          box(p, aW, 0.05, 0.19, -W / 2 + aW / 2, cy, z, mortar);
          box(p, bW, 0.05, 0.19, W / 2 - bW / 2, cy, z, mortar);
        } else box(p, W, 0.05, 0.19, 0, cy, z, mortar);
        // side walls; they stop around the window
        const xw = s * (W / 2 + 0.02), sy = y + 0.245;
        if (sy > 0.98 && sy < 1.92) {
          const l1 = D / 2 - 0.88, l2 = D / 2 - 0.28;
          box(p, 0.19, 0.05, l1, xw, sy, -D / 2 + l1 / 2, mortar);
          box(p, 0.19, 0.05, l2, xw, sy, D / 2 - l2 / 2, mortar);
        } else box(p, 0.19, 0.05, D, xw, sy, 0, mortar);
      }
      for (const sx of [-1, 1]) {
        disc(sx * (W / 2 + 0.235), y, s * (D / 2 + 0.02), true);
        disc(sx * (W / 2 + 0.02), y + 0.12, s * (D / 2 + 0.235), false);
      }
    }
  }
  // ---- stone foundation down to the ground
  const yBot = (c.lo !== undefined ? c.lo : floor - 0.4) - floor - 0.12;
  const fx = W / 2 + 0.17, fz = D / 2 + 0.17;
  stonesAlong(p, -fx, fz, fx, fz, yBot, 0.0, 1);
  stonesAlong(p, -fx, -fz, fx, -fz, yBot, 0.0, 2);
  stonesAlong(p, -fx, -fz, -fx, fz, yBot, 0.0, 3);
  stonesAlong(p, fx, -fz, fx, fz, yBot, 0.0, 4);
  // ---- window sills
  for (const s of [-1, 1]) box(p, 0.2, 0.05, 1.25, s * (W / 2 + 0.22), 0.97, -0.3, 0x6a5038);
  // glass panes with a plain wooden frame and cross bar over the side windows
  for (const s of [-1, 1]) {
    const wx = s * (W / 2 + 0.198);
    box(p, 0.01, 0.78, 0.9, wx - s * 0.01, 1.45, -0.3, 0x26343c);
    for (const [bh, bd, by, bz] of [[0.06, 1.0, 0.42, 0], [0.06, 1.0, -0.42, 0], [0.84, 0.06, 0, -0.47], [0.84, 0.06, 0, 0.47], [0.78, 0.03, 0, 0], [0.03, 0.9, 0, 0]]) box(p, 0.025, bh, bd, wx, 1.45 + by, -0.3 + bz, 0x5e432b);
  }
  // ---- stone chimney around the stove pipe
  if (c.stove) {
    const sx = c.stove.x, sz = c.stove.z, base = H + rh * 0.6 - 0.5;
    for (let k = 0; k < 7; k++) {
      box(p, 0.66 + hash(k, 1) * 0.05, 0.16, 0.66 + hash(k, 2) * 0.05, sx, base + 0.08 + k * 0.17, sz, STONES[(k * 3) % 4], 0, (hash(k, 3) - 0.5) * 0.06, 0);
    }
    box(p, 0.78, 0.07, 0.78, sx, base + 1.24, sz, 0x55514b);
    box(p, 0.36, 0.02, 0.36, sx, base + 1.28, sz, 0x141210);
  }
  // ---- shingled roof, ridge cap and fascia (a separate mesh so a lodge storey can replace it)
  const run = D / 2 + 0.45, slope = Math.atan2(rh, run), bl = Math.hypot(run, rh) + 0.1;
  const roofCols = [0x4a3f36, 0x3e352d, 0x54473c, 0x463b32, 0x3a3029, 0x5a4c40];
  for (const s of [-1, 1]) {
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(0, H + rh / 2 + 0.05, s * run / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(s * slope, 0, 0)), new THREE.Vector3(1, 1, 1));
    shingles(r, W + 0.9, bl, m4, roofCols, s);
  }
  box(r, W + 1.0, 0.2, 0.2, 0, H + rh + 0.1, 0, 0x2e2722, Math.PI / 4);
  for (const s of [-1, 1]) box(r, W + 0.95, 0.16, 0.04, 0, H - 0.02, s * (run + 0.06), 0x3a2c20);
  const mesh = new THREE.Mesh(mergeColored(p), decoMat);
  mesh.position.set(c.x, floor, c.z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  world.scene.add(mesh);
  const roof = new THREE.Mesh(mergeColored(r), decoMat);
  roof.position.copy(mesh.position);
  roof.castShadow = true; roof.receiveShadow = true;
  world.scene.add(roof);
  return { mesh, roof };
}

export function decorateStore(world, st) {
  const g = st.geom;
  if (!g) return null;
  const { W, D, H, floor, look, dw } = g;
  const p = [];
  // ---- shingled gable roof (ridge runs front to back)
  const rh = 1.4, run = W / 2 + 0.4, slope = Math.atan2(rh, run), bl = Math.hypot(run, rh) + 0.1;
  const rc = look.roof, roofCols = [rc, shade(rc, 0.82), shade(rc, 1.12), shade(rc, 0.92), shade(rc, 1.04)];
  for (const sx of [-1, 1]) {
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(sx * run / 2, H + rh / 2 + 0.05, -0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -sx * slope)), new THREE.Vector3(1, 1, 1));
    // turn the shingle frame so its slope (z) runs along the board's x
    m4.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    shingles(p, D + 0.3, bl, m4, roofCols, sx);
  }
  box(p, 0.2, 0.2, D + 0.4, 0, H + rh + 0.1, -0.1, shade(rc, 0.7), 0, 0, Math.PI / 4);
  // ---- striped canvas awning over the porch (corrugated tin for the gunsmith)
  const stripes = 12, aw = W + 1.2, awnCol = look.awning || (st.id === 'butcher' ? 0x9a2a26 : 0x3a6a4a);
  for (let i = 0; i < stripes; i++) {
    const x = -aw / 2 + aw / stripes * (i + 0.5);
    const col = st.id === 'gun' ? (i % 2 ? 0x6a6e70 : 0x585c5e) : (i % 2 ? awnCol : 0xe8e0cc);
    // canvas on top and underneath the awning board
    box(p, aw / stripes + 0.004, 0.03, 2.62, x, 3.02, D / 2 + 1.25, col, -0.12, 0, 0);
    box(p, aw / stripes + 0.004, 0.02, 2.6, x, 2.888, D / 2 + 1.25, shade(col, 0.85), -0.12, 0, 0);
    if (st.id !== 'gun') box(p, aw / stripes - 0.01, 0.2, 0.02, x, 3.0 - (i % 2) * 0.02, D / 2 + 2.57, col); // valance
  }
  // ---- skirting board along the front
  box(p, W + 0.32, 0.22, 0.04, 0, 0.11, D / 2 + 0.03, shade(look.trim, 0.8));
  // ---- wall lanterns either side of the door
  const glows = [];
  for (const sx of [-1, 1]) {
    const lx = sx * (dw / 2 + 0.38);
    box(p, 0.04, 0.22, 0.14, lx, 2.05, D / 2 + 0.07, 0x222222);
    box(p, 0.16, 0.03, 0.16, lx, 1.9, D / 2 + 0.19, 0x222222);
    box(p, 0.16, 0.03, 0.16, lx, 2.16, D / 2 + 0.19, 0x222222);
    for (const [ox, oz] of [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]]) box(p, 0.015, 0.24, 0.015, lx + ox, 2.03, D / 2 + 0.19 + oz, 0x222222);
    glows.push([lx, 2.03, D / 2 + 0.19]);
  }
  // ---- porch clutter: barrels, crates, a bench
  const porchZ = D / 2 + 1.2;
  const barrel = (x, z, h = 0.85) => {
    p.push(colorize(xf(new THREE.CylinderGeometry(0.27, 0.25, h, 12), x, h / 2, z), 0x7a5634));
    for (const y of [0.12, h - 0.12]) p.push(colorize(xf(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 12), x, y, z), 0x2e2a26));
    p.push(colorize(xf(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 12), x, h + 0.005, z), 0x8a6a44));
  };
  const crate = (x, z, s = 0.45, y = 0, ry = 0.2) => {
    box(p, s, s, s, x, y + s / 2, z, 0x9a7a4c, 0, ry, 0);
    box(p, s + 0.012, 0.05, s + 0.012, x, y + s * 0.5, z, 0x6a5232, 0, ry, 0);
    box(p, s + 0.012, s * 0.98, 0.05, x, y + s / 2, z, 0x7a5f3a, 0, ry, 0);
  };
  if (st.id === 'gun') { barrel(-W / 2 + 0.2, porchZ + 0.6); crate(W / 2 - 0.3, porchZ + 0.5); crate(W / 2 - 0.3, porchZ + 0.5, 0.34, 0.45, -0.3); }
  if (st.id === 'butcher') { barrel(W / 2 - 0.2, porchZ + 0.7); barrel(W / 2 - 0.75, porchZ + 0.75, 0.7); crate(-W / 2 + 0.4, porchZ + 0.7, 0.5); }
  if (st.id === 'general') { crate(-W / 2 + 0.3, porchZ + 0.6); crate(-W / 2 + 0.85, porchZ + 0.7, 0.4, 0, -0.15); barrel(W / 2 - 0.25, porchZ + 0.7, 0.75); }
  // bench under one window
  const bx = st.id === 'general' ? W / 4 + 0.35 : -(W / 4 + 0.35);
  box(p, 1.4, 0.06, 0.36, bx, 0.46, D / 2 + 0.42, 0x7a5a3a);
  box(p, 1.4, 0.05, 0.05, bx, 0.43, D / 2 + 0.6, 0x5a4028);
  for (const s of [-1, 1]) box(p, 0.06, 0.46, 0.32, bx + s * 0.62, 0.23, D / 2 + 0.42, 0x5a4028);
  // hitching rail off to one side of the steps
  const railZ = D / 2 + 3.3, railX = st.id === 'general' ? -3.0 : 3.0;
  for (const x of [railX - 1.2, railX + 1.2]) box(p, 0.13, 1.05, 0.13, x, 0.27, railZ, 0x5a4028);
  box(p, 2.7, 0.09, 0.09, railX, 0.74, railZ, 0x6a4a30);
  const mesh = new THREE.Mesh(mergeColored(p), decoMat);
  mesh.position.set(g.x, floor, g.z);
  mesh.rotation.y = g.rot;
  mesh.castShadow = true; mesh.receiveShadow = true;
  world.scene.add(mesh);
  for (const [x, y, z] of glows) {
    const gm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), glowMat);
    gm.position.set(x, y, z);
    mesh.add(gm);
  }
  // the hitching rail is solid
  const c = Math.cos(g.rot), s = Math.sin(g.rot);
  const [wx, wz] = [g.x + railX * c + railZ * s, g.z - railX * s + railZ * c];
  const swap = Math.abs(s) > 0.5;
  world.addBox(wx, wz, swap ? 0.08 : 1.3, swap ? 1.3 : 0.08, floor - 1, floor + 0.85);
  return mesh;
}
