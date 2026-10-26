// Cabin upgrades: planned at the board inside the home cabin. Each upgrade adds real
// furniture or structures to the cabin and changes how survival plays.
import * as THREE from 'three';
import { G } from './state.js';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween } from './geo.js';
import { box, shade, hash, shingles, endGrain, STONES } from './buildings.js';

export const UPGRADE_LIST = [
  { id: 'bed', name: 'Feather bed and quilts', price: 60, desc: 'A carved bed, patchwork quilt and a bedside candle. Sleep restores more rest and twice the health; lying down recovers rest faster.' },
  { id: 'stove', name: 'Cookstove kit', price: 45, desc: 'Pots, a kettle and a working firebox for the wood stove. Cook meat indoors any time, no campfire needed.' },
  { id: 'storage', name: 'Larder and pack frame', price: 50, desc: 'A storage chest, meat hooks and a pack frame. Carry 35 kg of meat instead of 20.' },
  { id: 'gunrack', name: 'Gun rack and ammo locker', price: 75, desc: 'A wall rack and an ammunition crate by the door. Restock ammunition at the cabin without walking to town.' },
  { id: 'porch', name: 'Covered porch', price: 70, desc: 'A deck with a roof, railings, lanterns, firewood and a rocking chair where you can sit and rest while watching the meadow.' },
  { id: 'fortify', name: 'Iron-bound door and shutters', price: 90, desc: 'Iron straps, window bars and shutters. Inside this cabin predators and poachers cannot reach you while you are awake, and the heavy door latches itself shut when you go to sleep.' },
  { id: 'renovate', name: 'Renovation · house level 2', price: 120, desc: 'Painted board-and-batten gables, a green door and window frames, flower boxes, a carved house sign, a weathervane and a flagstone path. Sleeping restores 20% more rest and extra health.' },
  { id: 'lodge', name: 'Hunting lodge · house level 3', price: 260, needs: 'renovate', desc: 'A second log storey with a balcony, a dormer and a new shingled roof, a tall stone chimney and a trophy rack on the gable. The butcher pays 10% more for your meat once your lodge is known in town.' },
  { id: 'garden', name: 'Vegetable garden', price: 55, desc: 'A fenced garden with raised beds and a rain barrel. Every morning three fresh, safe vegetables are ready to pick.' },
];

const wood = 0x7a5a3a, woodD = 0x5e432b, woodL = 0x9a7a52, iron = 0x2a2b2e;

export class CabinUpgrades {
  constructor(world) {
    this.world = world;
    this.home = world.home;
    this.built = {};
    this.gardenDay = -1;
    this.produce = null;
    this.stoveFire = { lit: true, fuel: 99, stove: true, name: 'the stove' };
    const h = this.home;
    // the upgrade board is always there
    this.spots = [{ kind: 'board', x: h.x - 1.3, z: h.z + h.D / 2 - 0.85, r: 1.25, text: () => '<kbd>E</kbd>Plan cabin upgrades' }];
  }

  has(id) { return !!this.built[id]; }
  count() { return Object.keys(this.built).length; }

  build(id) {
    if (this.built[id]) return;
    this.built[id] = true;
    this['build_' + id]();
  }

  // Interaction spot the player is standing at (or null)
  nearest(x, z) {
    for (const s of this.spots) if (Math.hypot(x - s.x, z - s.z) < s.r && (!s.active || s.active())) return s;
    return null;
  }

  update() {
    if (this.produce) this.produce.visible = this.gardenReady() > 0;
  }

  // ---------- helpers ----------
  mesh(parts, basic = false) {
    const h = this.home;
    const m = new THREE.Mesh(mergeColored(parts), basic ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.position.set(h.x, h.floor, h.z);
    m.castShadow = !basic; m.receiveShadow = !basic;
    this.world.scene.add(m);
    return m;
  }
  // collider in cabin-local coordinates, top at local height y1
  box(lx, lz, hw, hd, y1) { const h = this.home; this.world.addBox(h.x + lx, h.z + lz, hw, hd, h.floor - 1, h.floor + y1); }
  glow(lx, ly, lz, r = 0.05, color = 0xffc860) {
    const h = this.home;
    const g = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color }));
    g.position.set(h.x + lx, h.floor + ly, h.z + lz);
    this.world.scene.add(g);
    return g;
  }

  // ---------- feather bed ----------
  build_bed() {
    const { bx, bz } = this.home, P = [];
    const b = (w, hh, d, x, y, z, c, ry = 0) => P.push(colorize(xf(new THREE.BoxGeometry(w, hh, d), x, y, z, 0, ry, 0), c));
    // carved headboard with posts
    b(1.12, 1.0, 0.09, bx, 0.55, bz - 1.06, 0x4a3020);
    b(1.0, 0.12, 0.1, bx, 1.0, bz - 1.06, 0x6a4a30);
    for (const s of [-1, 1]) P.push(colorize(xf(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 8), bx + s * 0.55, 0.62, bz - 1.06), 0x3a2618));
    for (const s of [-1, 1]) P.push(colorize(xf(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 8), bx + s * 0.55, 0.4, bz + 0.98), 0x3a2618));
    b(1.12, 0.3, 0.07, bx, 0.48, bz + 0.98, 0x4a3020);
    // thick mattress and patchwork quilt
    b(0.96, 0.08, 1.9, bx, 0.53, bz, 0xf0e8d8);
    const quilt = [0x8a2e2a, 0x2e4a6a, 0xc9a24a, 0x3a6a3a, 0xe0d4bc, 0x6a3a5a];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) b(0.25, 0.07, 0.33, bx - 0.375 + i * 0.25, 0.6, bz - 0.2 + j * 0.33, quilt[(i + j * 2) % quilt.length]);
    b(1.0, 0.06, 0.08, bx, 0.6, bz - 0.37, 0xe0d4bc); // folded sheet edge
    // two plump pillows
    for (const s of [-1, 1]) P.push(ellipsoid(bx + s * 0.22, 0.62, bz - 0.74, 0.2, 0.06, 0.13, 0xf6f2ea));
    // bedside table with a candle
    const nx = bx + 0.72, nz = bz - 0.82;
    b(0.4, 0.04, 0.36, nx, 0.52, nz, woodL);
    b(0.36, 0.42, 0.32, nx, 0.29, nz, woodD);
    b(0.3, 0.14, 0.02, nx, 0.36, nz + 0.165, wood);
    P.push(colorize(xf(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 10), nx + 0.05, 0.55, nz), 0x8a7a50));
    P.push(colorize(xf(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), nx + 0.05, 0.63, nz), 0xf2ead2));
    b(0.14, 0.03, 0.2, nx - 0.09, 0.555, nz + 0.04, 0x6a2a2a); // a book
    // bear-skin rug beside the bed
    P.push(ellipsoid(bx + 1.0, 0.04, bz + 0.2, 0.42, 0.015, 0.75, 0x4a3426));
    P.push(ellipsoid(bx + 1.0, 0.05, bz - 0.55, 0.16, 0.04, 0.14, 0x3e2a1e));
    for (const [ox, oz] of [[-0.42, -0.35], [0.42, -0.35], [-0.38, 0.6], [0.38, 0.6]]) P.push(ellipsoid(bx + 1.0 + ox, 0.035, bz + 0.2 + oz, 0.13, 0.012, 0.09, 0x4a3426));
    this.mesh(P);
    this.glow(nx + 0.05, 0.73, nz, 0.02, 0xffd27a);
    this.box(nx, nz, 0.2, 0.18, 0.56);
  }

  // ---------- cookstove ----------
  build_stove() {
    const s = this.home.stove;
    if (!s) return;
    const P = [];
    P.push(colorize(xf(new THREE.CylinderGeometry(0.12, 0.11, 0.15, 14), s.x - 0.13, 0.82, s.z + 0.04), 0x3a3a3c));
    P.push(colorize(xf(new THREE.CylinderGeometry(0.125, 0.125, 0.02, 14), s.x - 0.13, 0.9, s.z + 0.04), 0x2a2a2c));
    P.push(ellipsoid(s.x + 0.15, 0.82, s.z - 0.08, 0.1, 0.08, 0.1, 0xb06a3a));
    P.push(cylinderBetween(new THREE.Vector3(s.x + 0.22, 0.83, s.z - 0.08), new THREE.Vector3(s.x + 0.32, 0.9, s.z - 0.08), 0.015, 0.01, 6, 0xb06a3a));
    P.push(colorize(xf(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), s.x + 0.15, 0.9, s.z - 0.08), 0x2a2a2c));
    P.push(colorize(xf(new THREE.CylinderGeometry(0.11, 0.1, 0.03, 14), s.x + 0.12, 0.765, s.z + 0.15), 0x1a1a1c)); // frying pan
    P.push(colorize(xf(new THREE.BoxGeometry(0.2, 0.02, 0.03), s.x + 0.12, 0.77, s.z + 0.31), 0x1a1a1c));
    // firebox door frame
    P.push(colorize(xf(new THREE.BoxGeometry(0.34, 0.22, 0.02), s.x, 0.34, s.z + 0.285), 0x3a3a3c));
    // hanging utensils on the wall
    for (let i = 0; i < 3; i++) P.push(colorize(xf(new THREE.BoxGeometry(0.03, 0.28, 0.01), s.x - 0.1 + i * 0.1, 1.25, s.z - 0.3), [0x8a8a8c, 0x6a4a30, 0x8a8a8c][i]));
    this.mesh(P);
    const fb = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.16), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
    fb.position.set(this.home.x + s.x, this.home.floor + 0.34, this.home.z + s.z + 0.297);
    this.world.scene.add(fb);
    this.spots.push({ kind: 'stove', x: this.home.x + s.x, z: this.home.z + s.z + 0.85, r: 1.0, text: () => '<kbd>E</kbd>Cook and eat at the stove' });
  }

  // ---------- larder ----------
  build_storage() {
    const { W, t } = this.home, P = [];
    const cx = -W / 2 + t + 0.32, cz = 1.45;
    const b = (w, hh, d, x, y, z, c) => P.push(colorize(xf(new THREE.BoxGeometry(w, hh, d), x, y, z), c));
    b(0.55, 0.42, 0.95, cx, 0.21, cz, 0x6a4a2a);
    b(0.6, 0.08, 1.0, cx, 0.46, cz, 0x5a3a20);
    for (const oz of [-0.35, 0.35]) b(0.57, 0.44, 0.04, cx, 0.23, cz + oz, iron);
    b(0.04, 0.1, 0.08, cx + 0.3, 0.38, cz, 0x9a8a60);
    // meat hooks with hanging hams on the back wall
    const hz = -this.home.D / 2 + t + 0.18;
    b(1.1, 0.08, 0.08, -1.1, 2.05, hz, woodD);
    for (let i = 0; i < 3; i++) {
      const hx = -1.5 + i * 0.4;
      b(0.012, 0.25, 0.012, hx, 1.9, hz, iron);
      P.push(ellipsoid(hx, 1.6, hz, 0.1, 0.2, 0.09, i === 1 ? 0x7a3026 : 0x8a4a32));
      P.push(colorize(xf(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6), hx, 1.82, hz), 0xe8dcc0));
    }
    // a pack frame leaning on the chest
    P.push(cylinderBetween(new THREE.Vector3(cx + 0.33, 0, cz + 0.6), new THREE.Vector3(cx + 0.18, 1.1, cz + 0.6), 0.02, 0.02, 6, woodD));
    P.push(cylinderBetween(new THREE.Vector3(cx + 0.33, 0, cz + 0.2), new THREE.Vector3(cx + 0.18, 1.1, cz + 0.2), 0.02, 0.02, 6, woodD));
    b(0.06, 0.6, 0.42, cx + 0.27, 0.55, cz + 0.4, 0x5a6a3a);
    this.mesh(P);
    this.box(cx, cz, 0.3, 0.5, 0.5);
  }

  // ---------- gun rack + ammo locker ----------
  build_gunrack() {
    const { D, t } = this.home, P = [];
    const rx = 2.62, rz = D / 2 - t - 0.04;
    const b = (w, hh, d, x, y, z, c) => P.push(colorize(xf(new THREE.BoxGeometry(w, hh, d), x, y, z), c));
    b(1.15, 0.95, 0.04, rx, 1.55, rz, woodD);
    for (const y of [1.33, 1.73]) {
      for (const s of [-1, 1]) b(0.05, 0.08, 0.12, rx + s * 0.4, y - 0.06, rz - 0.06, woodL);
      // a long gun on the pegs
      b(0.36, 0.08, 0.04, rx + 0.32, y, rz - 0.08, 0x6a3e22);
      P.push(colorize(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 8), rx - 0.18, y + 0.01, rz - 0.08, 0, 0, Math.PI / 2), 0x2a2c30));
      b(0.12, 0.05, 0.04, rx + 0.1, y + 0.05, rz - 0.08, 0x2a2c30);
    }
    // ammunition crate
    const cz = rz - 0.32;
    b(0.62, 0.34, 0.4, rx, 0.17, cz, 0x4a5a34);
    b(0.66, 0.05, 0.44, rx, 0.36, cz, 0x3e4c2c);
    b(0.3, 0.1, 0.01, rx, 0.2, cz - 0.205, 0xd8c890);
    for (let i = 0; i < 3; i++) b(0.06, 0.1, 0.12, rx - 0.15 + i * 0.12, 0.43, cz, [0xb08a3a, 0x8a2a2a, 0xb08a3a][i]); // ammo boxes on top
    this.mesh(P);
    this.box(rx, cz, 0.32, 0.21, 0.4);
    this.spots.push({ kind: 'locker', x: this.home.x + rx, z: this.home.z + cz - 0.7, r: 0.85, text: () => '<kbd>E</kbd>Open the ammo locker' });
  }

  // ---------- covered porch ----------
  build_porch() {
    const h = this.home, { W, D, H, dx } = h, P = [];
    const b = (w, hh, d, x, y, z, c, rx = 0) => P.push(colorize(xf(new THREE.BoxGeometry(w, hh, d), x, y, z, rx), c));
    const z0 = D / 2 + 0.15, z1 = D / 2 + 2.4, zc = (z0 + z1) / 2, dep = z1 - z0, hw = W / 2 + 0.25;
    // deck, planks and skirt
    b(hw * 2, 0.1, dep, 0, -0.1, zc, 0x8a6a48);
    for (let x = -hw + 0.15; x < hw; x += 0.18) b(0.012, 0.102, dep, x, -0.1, zc, 0x5e4630);
    b(hw * 2, 0.9, 0.06, 0, -0.6, z1, woodD);
    for (const s of [-1, 1]) b(0.06, 0.9, dep, s * hw, -0.6, zc, woodD);
    // front steps
    b(1.6, 0.18, 0.4, dx, -0.26, z1 + 0.22, 0x7a5a3a);
    b(1.6, 0.18, 0.4, dx, -0.46, z1 + 0.55, 0x6e5034);
    // posts, beam and roof
    const posts = [-hw + 0.1, -0.6, hw - 0.1];
    for (const px of posts) b(0.14, H, 0.14, px, -0.05 + H / 2, z1 - 0.12, woodD);
    b(hw * 2, 0.16, 0.16, 0, H - 0.08, z1 - 0.12, woodD);
    const rl = dep + 0.55, drop = 0.35, slope = Math.atan2(drop, rl);
    b(hw * 2 + 0.3, 0.1, rl + 0.05, 0, H + 0.08 - drop / 2, D / 2 + rl / 2, 0x3b3632, slope);
    for (const px of posts) b(0.1, 0.1, rl, px, H + 0.0 - drop / 2, D / 2 + rl / 2, woodD, slope);
    // railings (leave a gap at the steps)
    const rail = (xa, xb) => {
      b(xb - xa, 0.07, 0.07, (xa + xb) / 2, 0.9, z1 - 0.12, woodL);
      b(xb - xa, 0.05, 0.05, (xa + xb) / 2, 0.15, z1 - 0.12, woodD);
      for (let x = xa + 0.15; x < xb - 0.05; x += 0.22) b(0.04, 0.75, 0.04, x, 0.52, z1 - 0.12, wood);
    };
    rail(-hw + 0.1, -0.6); rail(-0.6, dx - 0.8); rail(dx + 0.8, hw - 0.1);
    for (const s of [-1, 1]) {
      b(0.07, 0.07, dep - 0.1, s * (hw - 0.1), 0.9, zc - 0.05, woodL);
      for (let z = z0 + 0.15; z < z1 - 0.2; z += 0.22) b(0.04, 0.75, 0.04, s * (hw - 0.1), 0.52, z, wood);
    }
    // rocking chair facing the meadow
    const cx = -2.2, cz = zc - 0.25;
    b(0.5, 0.05, 0.48, cx, 0.42, cz, woodL);
    b(0.5, 0.65, 0.05, cx, 0.78, cz - 0.24, woodL, -0.15);
    for (let i = 0; i < 4; i++) b(0.05, 0.6, 0.02, cx - 0.18 + i * 0.12, 0.78, cz - 0.21, wood, -0.15);
    for (const s of [-1, 1]) {
      b(0.05, 0.04, 0.5, cx + s * 0.25, 0.62, cz + 0.02, woodD);
      b(0.04, 0.4, 0.04, cx + s * 0.25, 0.22, cz - 0.15, woodD);
      b(0.04, 0.4, 0.04, cx + s * 0.25, 0.22, cz + 0.18, woodD);
      P.push(colorize(xf(new THREE.TorusGeometry(0.9, 0.025, 4, 16, 0.75), cx + s * 0.25, 0.92, cz + 0.02, 0, Math.PI / 2, -Math.PI / 2 - 0.375), woodD));
    }
    b(0.42, 0.05, 0.42, cx, 0.46, cz + 0.02, 0x8a2e2a); // cushion
    // firewood stack and a bench
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6 - r; i++) P.push(colorize(xf(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 7), hw - 0.45, -0.0 + 0.09 + r * 0.16, D / 2 + 0.35 + i * 0.19 + r * 0.09, Math.PI / 2, 0, 0), i % 2 ? 0x8a6a48 : 0x7a5a3a));
    b(1.2, 0.05, 0.32, -0.2, 0.42, D / 2 + 0.4, woodL);
    for (const s of [-1, 1]) b(0.05, 0.42, 0.28, -0.2 + s * 0.5, 0.21, D / 2 + 0.4, woodD);
    // wall lanterns either side of the door
    for (const lx of [dx - 0.95, dx + 0.95]) {
      b(0.04, 0.2, 0.12, lx, 1.95, D / 2 + 0.2, iron);
      b(0.14, 0.03, 0.14, lx, 1.83, D / 2 + 0.3, iron);
      b(0.14, 0.03, 0.14, lx, 2.05, D / 2 + 0.3, iron);
    }
    this.mesh(P);
    for (const lx of [dx - 0.95, dx + 0.95]) {
      this.glow(lx, 1.94, D / 2 + 0.3, 0.055);
      this.world.lanterns.push({ x: h.x + lx, y: h.floor + 1.94, z: h.z + D / 2 + 0.35 });
    }
    // walkable deck and steps, posts and rails collide
    const pl = this.world.platforms;
    pl.push({ x: h.x, z: h.z + zc, hw, hd: dep / 2, y: h.floor - 0.05 });
    pl.push({ x: h.x + dx, z: h.z + z1 + 0.22, hw: 0.8, hd: 0.2, y: h.floor - 0.17 });
    pl.push({ x: h.x + dx, z: h.z + z1 + 0.55, hw: 0.8, hd: 0.2, y: h.floor - 0.37 });
    const railZ = z1 - 0.12;
    const segs = [[-hw + 0.1, dx - 0.8], [dx + 0.8, hw - 0.1]];
    for (const [xa, xb] of segs) this.box((xa + xb) / 2, railZ, (xb - xa) / 2, 0.06, 1.0);
    for (const s of [-1, 1]) this.box(s * (hw - 0.1), zc, 0.06, dep / 2, 1.0);
    this.box(cx, cz, 0.28, 0.28, 0.9);
    this.box(hw - 0.45, D / 2 + 0.9, 0.32, 0.6, 0.7);
    // sitting in the rocking chair
    const seat = { x: h.x + cx + 0.7, z: h.z + cz, floor: h.floor - 0.05, name: 'the rocking chair', chair: true, yaw: Math.PI, head: new THREE.Vector3(h.x + cx, h.floor + 1.08, h.z + cz - 0.05) };
    this.spots.push({ kind: 'chair', seat, x: h.x + cx + 0.55, z: h.z + cz + 0.2, r: 0.9, text: () => '<kbd>E</kbd>Sit in the rocking chair' });
  }

  // ---------- fortifications ----------
  build_fortify() {
    const h = this.home, { W } = h, P = [];
    const b = (w, hh, d, x, y, z, c) => P.push(colorize(xf(new THREE.BoxGeometry(w, hh, d), x, y, z), c));
    for (const s of [-1, 1]) {
      const wx = s * (W / 2 + 0.22);
      // open shutters either side of the window
      for (const oz of [-0.88, 0.28]) {
        b(0.05, 0.95, 0.56, wx + s * 0.01, 1.45, oz, 0x4a3422);
        for (const y of [1.15, 1.75]) b(0.06, 0.07, 0.56, wx + s * 0.02, y, oz, 0x3a2818);
        P.push(colorize(xf(new THREE.BoxGeometry(0.06, 0.06, 0.7), wx + s * 0.02, 1.45, oz, 0.85, 0, 0), 0x3a2818));
      }
      // iron bars over the glass
      for (const oz of [-0.6, -0.42, -0.24, -0.06]) P.push(colorize(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 6), wx, 1.45, oz), iron));
      for (const y of [1.1, 1.8]) b(0.03, 0.03, 0.85, wx, y, -0.3, iron);
    }
    this.mesh(P);
    // iron straps and studs on the door (moves with it)
    const d = h.door, dw = h.dw, dg = [];
    for (const y of [0.3, 1.0, 1.7]) {
      dg.push(colorize(xf(new THREE.BoxGeometry(dw - 0.1, 0.07, 0.095), (dw - 0.06) / 2, y, 0), iron));
      for (let i = 0; i < 4; i++) dg.push(colorize(xf(new THREE.SphereGeometry(0.018, 5, 4), 0.12 + i * 0.27, y, 0.05), 0x4a4a4e));
    }
    dg.push(colorize(xf(new THREE.BoxGeometry(0.1, 0.18, 0.1), dw - 0.2, 1.15, 0), iron)); // heavy latch
    const straps = new THREE.Mesh(mergeColored(dg), new THREE.MeshLambertMaterial({ vertexColors: true }));
    d.pivot.add(straps);
  }

  // ---------- garden ----------
  build_garden() {
    const h = this.home, T = this.world.terrain, { W, D } = h, P = [], prod = [];
    const gx = -W / 2 - 3.4, gz = 0.4, hx = 2.1, hz = 2.6;
    const gy = (lx, lz) => T.getHeight(h.x + lx, h.z + lz) - h.floor;
    const b = (w, hh, d, x, y, z, c, list = P) => list.push(colorize(xf(new THREE.BoxGeometry(w, hh, d), x, y, z), c));
    // fence with a gate gap facing the cabin
    const post = (x, z) => b(0.08, 1.1, 0.08, x, gy(x, z) + 0.45, z, woodD);
    const railX = (xa, xb, z) => { const y = gy((xa + xb) / 2, z); for (const ry of [0.45, 0.85]) b(xb - xa, 0.06, 0.04, (xa + xb) / 2, y + ry, z, woodL); };
    const railZ = (za, zb, x) => { const y = gy(x, (za + zb) / 2); for (const ry of [0.45, 0.85]) b(0.04, 0.06, zb - za, x, y + ry, (za + zb) / 2, woodL); };
    for (let x = gx - hx; x <= gx + hx + 0.01; x += hx / 2) { post(x, gz - hz); post(x, gz + hz); }
    for (let z = gz - hz; z <= gz + hz + 0.01; z += hz / 3) { post(gx - hx, z); post(gx + hx, z); }
    railX(gx - hx, gx + hx, gz - hz); railX(gx - hx, gx + hx, gz + hz);
    railZ(gz - hz, gz + hz, gx - hx);
    railZ(gz - hz, gz - 0.6, gx + hx); railZ(gz + 0.6, gz + hz, gx + hx);
    // three raised beds with crops
    for (let i = 0; i < 3; i++) {
      const bz = gz - 1.7 + i * 1.7, y = gy(gx, bz);
      b(3.0, 0.3, 0.9, gx, y + 0.1, bz, 0x6a4a2a);
      b(2.9, 0.04, 0.8, gx, y + 0.26, bz, 0x3e2c1e);
      for (let k = 0; k < 6; k++) {
        const px = gx - 1.2 + k * 0.48;
        if (i === 0) P.push(ellipsoid(px, y + 0.36, bz, 0.17, 0.12, 0.17, k % 2 ? 0x6a9a44 : 0x5a8a3a)); // cabbages
        else if (i === 1) for (const oz of [-0.2, 0.2]) P.push(colorize(xf(new THREE.ConeGeometry(0.07, 0.3, 5), px, y + 0.42, bz + oz), 0x4a8a34)); // carrot tops
        else {
          P.push(colorize(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 5), px, y + 0.7, bz), woodL)); // tomato stakes
          P.push(ellipsoid(px, y + 0.6, bz, 0.14, 0.3, 0.14, 0x3e7a2e));
        }
      }
      // ripe produce, shown when there is a harvest waiting
      for (let k = 0; k < 6; k++) {
        const px = gx - 1.2 + k * 0.48;
        if (i === 0) prod.push(ellipsoid(px + 0.1, y + 0.33, bz + 0.25, 0.12, 0.1, 0.12, 0xd08a2a)); // pumpkins
        else if (i === 1) prod.push(colorize(xf(new THREE.ConeGeometry(0.035, 0.18, 6), px, y + 0.3, bz, Math.PI, 0, 0.4), 0xe07a20));
        else for (const oy of [0.5, 0.75]) prod.push(ellipsoid(px + 0.08, y + oy, bz + 0.1, 0.05, 0.05, 0.05, 0xc0302a));
      }
    }
    // rain barrel at the cabin corner
    const bx = -W / 2 - 0.45, bz = D / 2 - 0.5, by = gy(bx, bz);
    P.push(colorize(xf(new THREE.CylinderGeometry(0.34, 0.3, 0.9, 12), bx, by + 0.45, bz), 0x6a4a2a));
    for (const y of [0.15, 0.75]) P.push(colorize(xf(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 12), bx, by + y, bz), iron));
    P.push(colorize(xf(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 12), bx, by + 0.86, bz), 0x3a5a6a));
    this.mesh(P);
    this.produce = this.mesh(prod);
    const top = 1.2;
    this.box(gx, gz - hz, hx, 0.05, top); this.box(gx, gz + hz, hx, 0.05, top);
    this.box(gx - hx, gz, 0.05, hz, top);
    this.box(gx + hx, gz - (hz + 0.6) / 2, 0.05, (hz - 0.6) / 2, top);
    this.box(gx + hx, gz + (hz + 0.6) / 2, 0.05, (hz - 0.6) / 2, top);
    this.box(bx, bz, 0.34, 0.34, 1.0);
    this.gardenDay = G.env ? G.env.day : 1; // first harvest the next morning
    this.spots.push({
      kind: 'garden', x: h.x + gx, z: h.z + gz, r: 2.3,
      active: () => this.gardenReady() > 0,
      text: () => `<kbd>E</kbd>Harvest the garden (${this.gardenReady()} vegetables)`,
    });
  }

  // ---------- house level 2: renovation ----------
  build_renovate() {
    const h = this.home, T = this.world.terrain, { W, D, H, rh, dx, dw, dh } = h, P = [], U = [];
    const paint = 0x2f5a3c, cream = 0xd9ccaa, glass = 0x24343e;
    // board-and-batten siding and a round vent on both gables
    for (const s of [-1, 1]) {
      for (let z = -D / 2 + 0.11; z < D / 2; z += 0.22) {
        const hg = rh * (1 - Math.abs(z) / (D / 2)) - 0.04;
        if (hg < 0.06) continue;
        box(U, 0.03, hg, 0.21, s * (W / 2 + 0.04), H + hg / 2, z, shade(cream, 0.94 + hash(z, s) * 0.1));
        box(U, 0.045, hg, 0.04, s * (W / 2 + 0.06), H + hg / 2, z + 0.11, shade(cream, 0.76));
      }
      U.push(colorize(xf(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 14), s * (W / 2 + 0.08), H + rh * 0.42, 0, 0, 0, Math.PI / 2), paint));
      U.push(colorize(xf(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 14), s * (W / 2 + 0.085), H + rh * 0.42, 0, 0, 0, Math.PI / 2), 0x1e2a30));
    }
    // weathervane on the ridge
    const vx = -W / 2 + 0.7, vy = H + rh + 0.15;
    U.push(cylinderBetween(new THREE.Vector3(vx, vy, 0), new THREE.Vector3(vx, vy + 0.8, 0), 0.018, 0.013, 6, iron));
    box(U, 0.5, 0.02, 0.02, vx, vy + 0.45, 0, iron);
    box(U, 0.02, 0.02, 0.5, vx, vy + 0.45, 0, iron);
    box(U, 0.36, 0.14, 0.015, vx, vy + 0.72, 0, iron);
    box(U, 0.1, 0.13, 0.015, vx + 0.16, vy + 0.83, 0, iron);
    box(U, 0.12, 0.22, 0.015, vx - 0.2, vy + 0.8, 0, iron, 0, 0, 0.5);
    // painted window frames with a cross mullion, and flower boxes underneath
    const flowers = [0xc8303a, 0xe8c040, 0xf0ece0, 0x8a4ab0, 0xe86a8a];
    for (const s of [-1, 1]) {
      const wx = s * (W / 2 + 0.2);
      box(P, 0.012, 0.78, 0.9, wx - s * 0.006, 1.45, -0.3, glass);
      for (const [bh, bd, by, bz] of [[0.07, 1.06, 0.43, 0], [0.07, 1.06, -0.43, 0], [0.86, 0.07, 0, -0.5], [0.86, 0.07, 0, 0.5], [0.78, 0.035, 0, 0], [0.035, 0.9, 0, 0]]) box(P, 0.035, bh, bd, wx, 1.45 + by, -0.3 + bz, paint);
      const fx = s * (W / 2 + 0.36);
      box(P, 0.24, 0.2, 1.1, fx, 0.84, -0.3, paint);
      box(P, 0.2, 0.02, 1.04, fx, 0.945, -0.3, 0x3a2a1c);
      for (let k = 0; k < 9; k++) {
        const fz = -0.76 + k * 0.115, j = hash(k, s);
        P.push(ellipsoid(fx, 0.99, fz, 0.07, 0.06, 0.07, k % 2 ? 0x4a7a34 : 0x3e6a2c));
        P.push(ellipsoid(fx + (j - 0.5) * 0.08, 1.05 + j * 0.04, fz + 0.02, 0.035, 0.03, 0.035, flowers[(k + (s > 0 ? 2 : 0)) % flowers.length]));
      }
    }
    // carved house sign over the door
    box(P, 1.05, 0.26, 0.04, dx, dh + 0.27, h.D / 2 + 0.17, 0x6a4a2e);
    box(P, 0.85, 0.07, 0.01, dx, dh + 0.27, h.D / 2 + 0.195, cream);
    // flagstone path from the step out into the clearing
    for (let i = 0; i < 11; i++) {
      const pz = D / 2 + 1.0 + i * 0.62, px = dx + Math.sin(i * 0.7) * 0.25;
      const gy = T.getHeight(h.x + px, h.z + pz) - h.floor;
      P.push(colorize(xf(new THREE.CylinderGeometry(0.3 + hash(i, 1) * 0.08, 0.32, 0.08, 7), px, gy + 0.015, pz, 0, hash(i, 2) * 3, 0), STONES[i % 4]));
    }
    this.mesh(P);
    this.renoUpper = this.mesh(U);
    if (this.built.lodge) this.renoUpper.visible = false;
    // a painted door (moves with it)
    const door = new THREE.Mesh(colorize(xf(new THREE.BoxGeometry(dw - 0.09, dh - 0.09, 0.066), (dw - 0.06) / 2, (dh - 0.06) / 2 + 0.03, 0), paint), new THREE.MeshLambertMaterial({ vertexColors: true }));
    h.door.pivot.add(door);
  }

  // ---------- house level 3: hunting lodge ----------
  build_lodge() {
    const h = this.home, c = h.cabin, { W, D, H, dx, t } = h, P = [];
    const paint = 0x2f5a3c, cream = 0xd9ccaa, glass = 0x24343e, mortar = 0xcfc4ad, sill = 0x6a5038;
    // the old roof comes off
    if (c.roof) c.roof.visible = false;
    if (c.deco) c.deco.roof.visible = false;
    if (this.renoUpper) this.renoUpper.visible = false;
    const UH = 2.0, U = H + UH, rh = 1.7, run = D / 2 + 0.5, slope = Math.atan2(rh, run), bl = Math.hypot(run, rh) + 0.1;
    // a second storey of logs with chinking and end grain
    const logC = [0x7a5a3a, 0x6e5034];
    const log = (len, px, py, pz, alongX, col) => P.push(colorize(xf(new THREE.CylinderGeometry(0.13, 0.13, len, 7), px, py, pz, alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0), col));
    for (let i = 0; i < 8; i++) {
      const y = H + 0.13 + i * 0.25;
      for (const s of [-1, 1]) {
        log(W + 0.45, 0, y, s * (D / 2 + 0.02), true, logC[i % 2]);
        log(D + 0.45, s * (W / 2 + 0.02), y + 0.12, 0, false, logC[(i + 1) % 2]);
        if (i < 7) {
          box(P, W, 0.05, 0.19, 0, y + 0.125, s * (D / 2 + 0.02), mortar);
          box(P, 0.19, 0.05, D, s * (W / 2 + 0.02), y + 0.245, 0, mortar);
        }
        for (const sx of [-1, 1]) {
          endGrain(P, sx * (W / 2 + 0.235), y, s * (D / 2 + 0.02), true);
          endGrain(P, sx * (W / 2 + 0.02), y + 0.12, s * (D / 2 + 0.235), false);
        }
      }
    }
    // a plank ceiling downstairs
    box(P, W - 2 * t, 0.05, D - 2 * t, 0, H - 0.02, 0, 0x8a6a48);
    // board-and-batten gables with an attic window and a trophy rack
    for (const s of [-1, 1]) {
      for (let z = -run + 0.45; z < run - 0.4; z += 0.22) {
        const hg = rh * (1 - Math.abs(z) / run) - 0.05;
        if (hg < 0.06) continue;
        box(P, 0.03, hg, 0.21, s * (W / 2 + 0.12), U + hg / 2, z, shade(cream, 0.94 + hash(z, s) * 0.1));
        box(P, 0.045, hg, 0.04, s * (W / 2 + 0.14), U + hg / 2, z + 0.11, shade(cream, 0.76));
      }
      const gx = s * (W / 2 + 0.16);
      box(P, 0.012, 0.42, 0.5, gx - s * 0.01, U + 0.48, 0, glass);
      for (const [bh, bd, by, bz] of [[0.06, 0.62, 0.24, 0], [0.06, 0.62, -0.24, 0], [0.48, 0.06, 0, -0.28], [0.48, 0.06, 0, 0.28], [0.42, 0.03, 0, 0]]) box(P, 0.035, bh, bd, gx, U + 0.48 + by, bz, paint);
      // antlers on a shield
      const ax = s * (W / 2 + 0.18), ay = U + 1.0;
      box(P, 0.04, 0.32, 0.26, ax, ay, 0, 0x5a3e26);
      P.push(ellipsoid(ax + s * 0.05, ay - 0.02, 0, 0.06, 0.11, 0.07, 0xe0d4b8));
      const bone = 0xd8c8a4, V = (a, b, cz) => new THREE.Vector3(ax + s * a, ay + b, cz);
      for (const sz of [-1, 1]) {
        const pts = [V(0.06, 0.07, sz * 0.05), V(0.12, 0.2, sz * 0.2), V(0.15, 0.38, sz * 0.28), V(0.12, 0.52, sz * 0.22)];
        for (let k = 0; k < 3; k++) P.push(cylinderBetween(pts[k], pts[k + 1], 0.02 - k * 0.004, 0.017 - k * 0.004, 6, bone));
        for (let k = 1; k < 3; k++) P.push(cylinderBetween(pts[k], pts[k].clone().add(new THREE.Vector3(s * 0.04, 0.16, -sz * 0.03)), 0.012, 0.007, 5, bone));
      }
    }
    // new steeper shingled roof
    const roofCols = [0x4a3f36, 0x3e352d, 0x54473c, 0x463b32, 0x3a3029, 0x5a4c40];
    for (const s of [-1, 1]) {
      box(P, W + 1.0, 0.12, bl, 0, U + rh / 2 + 0.05, s * run / 2, 0x3b3632, s * slope);
      const m4 = new THREE.Matrix4().compose(new THREE.Vector3(0, U + rh / 2 + 0.05, s * run / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(s * slope, 0, 0)), new THREE.Vector3(1, 1, 1));
      shingles(P, W + 1.0, bl, m4, roofCols, s);
      box(P, W + 1.05, 0.16, 0.04, 0, U - 0.02, s * (run + 0.06), 0x3a2c20);
    }
    box(P, W + 1.1, 0.2, 0.2, 0, U + rh + 0.1, 0, 0x2e2722, Math.PI / 4);
    // a dormer on the front slope
    const dX = -W / 4, dz0 = 0.5, dz1 = D / 2 - 0.05, dw2 = 1.3, dwh = 1.15, drh = 0.38;
    for (const sx of [-1, 1]) box(P, 0.1, dwh, dz1 - dz0, dX + sx * dw2 / 2, U + dwh / 2, (dz0 + dz1) / 2, cream);
    box(P, dw2 + 0.1, dwh, 0.1, dX, U + dwh / 2, dz1, cream);
    box(P, 0.6, 0.5, 0.012, dX, U + 0.74, dz1 + 0.055, glass);
    for (const [bw, bh, bx, by] of [[0.72, 0.06, 0, 0.28], [0.72, 0.06, 0, -0.28], [0.06, 0.5, -0.33, 0], [0.06, 0.5, 0.33, 0], [0.03, 0.5, 0, 0]]) box(P, bw, bh, 0.035, dX + bx, U + 0.74 + by, dz1 + 0.07, paint);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-dw2 / 2 - 0.05, 0, 0, dw2 / 2 + 0.05, 0, 0, 0, drh, 0], 3));
    tri.computeVertexNormals();
    tri.translate(dX, U + dwh, dz1 + 0.05);
    P.push(colorize(tri, cream));
    const dh2 = dw2 / 2 + 0.15, ds = Math.atan2(drh, dh2), dbl = Math.hypot(dh2, drh) + 0.08, dlen = dz1 - dz0 + 0.35;
    for (const sx of [-1, 1]) {
      const pos = new THREE.Vector3(dX + sx * dh2 / 2, U + dwh + drh / 2 + 0.04, dz0 + dlen / 2);
      box(P, dbl, 0.08, dlen, pos.x, pos.y, pos.z, 0x3b3632, 0, 0, -sx * ds);
      const m4 = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -sx * ds)), new THREE.Vector3(1, 1, 1));
      m4.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(0, -0.02, 0));
      shingles(P, dlen, dbl, m4, roofCols, sx, 0.3);
    }
    // upstairs windows
    const winZ = (x, y, w, hh) => {
      box(P, w, hh, 0.012, x, y, D / 2 + 0.155, glass);
      for (const [bw, bh, bx, by] of [[w + 0.12, 0.06, 0, hh / 2], [w + 0.12, 0.06, 0, -hh / 2], [0.06, hh, -w / 2, 0], [0.06, hh, w / 2, 0], [0.03, hh, 0, 0], [w, 0.03, 0, 0]]) box(P, bw, bh, 0.035, x + bx, y + by, D / 2 + 0.17, paint);
      box(P, w + 0.22, 0.05, 0.14, x, y - hh / 2 - 0.05, D / 2 + 0.2, sill);
    };
    winZ(-1.75, H + 1.05, 0.8, 0.85);
    winZ(W / 2 - 0.5, H + 1.05, 0.62, 0.85);
    for (const s of [-1, 1]) {
      const wx = s * (W / 2 + 0.155);
      box(P, 0.012, 0.85, 0.9, wx, H + 1.05, 0, glass);
      for (const [bh, bd, by, bz] of [[0.06, 1.02, 0.425, 0], [0.06, 1.02, -0.425, 0], [0.85, 0.06, 0, -0.45], [0.85, 0.06, 0, 0.45], [0.85, 0.03, 0, 0], [0.03, 0.9, 0, 0]]) box(P, 0.035, bh, bd, wx + s * 0.015, H + 1.05 + by, bz, paint);
      box(P, 0.14, 0.05, 1.12, wx + s * 0.045, H + 0.58, 0, sill);
    }
    // a balcony over the door: cantilevered joists, deck, railings and a door out onto it
    const bz0 = D / 2 + 0.15, bdep = 1.15, bw = 2.6, by = H + 0.12;
    for (const jx of [dx - bw / 2 + 0.15, dx, dx + bw / 2 - 0.15]) {
      box(P, 0.14, 0.16, bdep + 0.12, jx, by - 0.12, bz0 + bdep / 2 + 0.02, 0x5e432b);
      endGrain(P, jx, by - 0.12, bz0 + bdep + 0.09, false);
    }
    box(P, bw, 0.08, bdep, dx, by, bz0 + bdep / 2, 0x8a6a48);
    for (let x = dx - bw / 2 + 0.15; x < dx + bw / 2; x += 0.18) box(P, 0.012, 0.082, bdep, x, by, bz0 + bdep / 2, 0x5e4630);
    const fz = bz0 + bdep - 0.05;
    box(P, bw, 0.07, 0.07, dx, by + 0.95, fz, woodL);
    for (let x = dx - bw / 2 + 0.06; x <= dx + bw / 2 - 0.05; x += 0.16) box(P, 0.04, 0.9, 0.04, x, by + 0.5, fz, wood);
    for (const sx of [-1, 1]) {
      const rx = dx + sx * (bw / 2 - 0.04);
      box(P, 0.07, 0.07, bdep, rx, by + 0.95, bz0 + bdep / 2, woodL);
      for (let z = bz0 + 0.12; z < fz; z += 0.16) box(P, 0.04, 0.9, 0.04, rx, by + 0.5, z, wood);
    }
    box(P, 0.92, 1.78, 0.04, dx, by + 0.94, D / 2 + 0.16, paint);
    for (const yy of [0.5, 1.3]) box(P, 0.84, 0.08, 0.05, dx, by + yy, D / 2 + 0.17, 0x24402c);
    for (const sx of [-1, 1]) box(P, 0.08, 1.86, 0.06, dx + sx * 0.5, by + 0.97, D / 2 + 0.17, 0x5e432b);
    box(P, 1.1, 0.08, 0.07, dx, by + 1.9, D / 2 + 0.17, 0x5e432b);
    // wall lanterns beside the balcony door
    for (const lx of [dx - 0.78, dx + 0.78]) {
      box(P, 0.04, 0.2, 0.12, lx, by + 1.35, D / 2 + 0.2, iron);
      box(P, 0.14, 0.03, 0.14, lx, by + 1.23, D / 2 + 0.3, iron);
      box(P, 0.14, 0.03, 0.14, lx, by + 1.45, D / 2 + 0.3, iron);
    }
    // a tall stone chimney through the new roof
    if (h.stove) {
      const sx = h.stove.x, sz = h.stove.z, top = U + 0.11 + rh * (1 - Math.abs(sz) / run) + 1.0;
      let k = 0;
      for (let y = H + 1.2; y < top; y += 0.17, k++) box(P, 0.7 + hash(k, 1) * 0.05, 0.16, 0.7 + hash(k, 2) * 0.05, sx, y + 0.08, sz, STONES[(k * 3) % 4], 0, (hash(k, 3) - 0.5) * 0.06, 0);
      box(P, 0.82, 0.07, 0.82, sx, top + 0.05, sz, 0x55514b);
      box(P, 0.38, 0.02, 0.38, sx, top + 0.09, sz, 0x141210);
    }
    // weathervane on the new ridge
    const vx = -W / 2 + 0.7, vy = U + rh + 0.15;
    P.push(cylinderBetween(new THREE.Vector3(vx, vy, 0), new THREE.Vector3(vx, vy + 0.8, 0), 0.018, 0.013, 6, iron));
    box(P, 0.5, 0.02, 0.02, vx, vy + 0.45, 0, iron);
    box(P, 0.02, 0.02, 0.5, vx, vy + 0.45, 0, iron);
    box(P, 0.36, 0.14, 0.015, vx, vy + 0.72, 0, iron);
    box(P, 0.1, 0.13, 0.015, vx + 0.16, vy + 0.83, 0, iron);
    box(P, 0.12, 0.22, 0.015, vx - 0.2, vy + 0.8, 0, iron, 0, 0, 0.5);
    this.mesh(P);
    for (const lx of [dx - 0.78, dx + 0.78]) {
      this.glow(lx, by + 1.34, D / 2 + 0.3, 0.055);
      this.world.lanterns.push({ x: h.x + lx, y: h.floor + by + 1.34, z: h.z + D / 2 + 0.4 });
    }
  }

  gardenReady() {
    if (!this.built.garden) return 0;
    const env = G.env;
    return env.day > this.gardenDay && env.time >= 5.5 ? 3 : env.day > this.gardenDay + 1 ? 3 : 0;
  }

  harvestGarden() {
    const n = this.gardenReady();
    if (!n) return 0;
    this.gardenDay = G.env.day;
    G.survival.items.veg = (G.survival.items.veg || 0) + n;
    return n;
  }
}
