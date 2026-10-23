// World assembly: terrain, vegetation, environment, man-made landmarks and collision queries.
import * as THREE from 'three';
import { Terrain, riverX, LAKE } from './terrain.js';
import { Vegetation } from './vegetation.js';
import { Environment } from './environment.js';
import { colorize, mergeColored, xf, cylinderBetween, ellipsoid } from './geo.js';

export const LOCATIONS = [
  { name: 'Cabin Clearing', x: -40, z: -54, desc: 'Starting point and campfire' },
  { name: 'Hunting Stand', x: -56, z: -37, desc: 'Elevated stand overlooking the meadow' },
  { name: 'Meadow Hut', x: 118, z: 46, desc: 'Small hut and campfire east of the river' },
  { name: 'Trading Post', x: -30, z: -26, desc: 'Gun store, butcher and general store' },
  { name: 'West Meadow', x: -75, z: 15, desc: 'Open grassland — deer and rabbits' },
  { name: 'River Ford', x: riverX(-28) + 14, z: -26, desc: 'Shallow crossing, good for drinking spots' },
  { name: 'East Meadow', x: 135, z: 25, desc: 'Wide meadow — elk graze here' },
  { name: 'Elk Valley', x: 140, z: 125, desc: 'Remote valley with herds' },
  { name: 'Lakeshore', x: LAKE.x + 4, z: LAKE.z - 35, desc: 'Quiet lake surrounded by birch' },
  { name: 'Pine Ridge', x: -150, z: -130, desc: 'High ground, dense pines — wolf country' },
  { name: 'Hollow Glade', x: 95, z: -150, desc: 'Damp forest — boar rooting grounds' },
  { name: 'South Glade', x: -15, z: 150, desc: 'Sunny clearing in the southern woods' },
];


export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.terrain = new Terrain(scene);
    this.veg = new Vegetation(scene, this.terrain, quality);
    this.env = new Environment(scene, quality);
    this.boxes = [];       // axis-aligned colliders {minX,maxX,minZ,maxZ,minY,maxY}
    this.platforms = [];   // walkable surfaces {x,z,hw,hd,y}
    this.ladders = [];
    this.restSpots = [];   // beds where the player can sleep
    this.fires = [];
    this.lanterns = [];
    this.doors = [];
    this.cabins = [];
    this.baits = [];
    this.buildCabin(-36, -66, 7, 5.5, 'the cabin', { stove: true, home: true });
    this.buildTown(-30, -19);
    this.buildStand(-56, -35);
    this.buildCampfire(-41, -58);
    // a small hunting hut with its own fire on the east side of the river
    this.buildCabin(122, 36, 4.6, 4.0, 'the meadow hut');
    this.buildCampfire(118.5, 42.5);
    this.terrain.finishEdits();
    // one shared light for the nearest lit fire and one for the nearest cabin lantern
    this.fireLight = new THREE.PointLight(0xff8a40, 0, 16, 1.8);
    this.lanternLight = new THREE.PointLight(0xffc070, 0, 11, 1.3);
    scene.add(this.fireLight, this.lanternLight);
  }

  addBox(cx, cz, hw, hd, y0, y1) {
    this.boxes.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd, minY: y0, maxY: y1 });
  }

  // Enterable log cabin: plank floor, doorway, bed, table, lantern, shelves (and a stove in big cabins).
  buildCabin(x, z, W, D, name, opts = {}) {
    const T = this.terrain;
    const t = 0.22, H = 2.5, rh = Math.min(1.4, D * 0.26);
    const dx = W * 0.18, dw = 1.15, dh = 2.0;
    const site = Math.max(W, D) * 0.75;
    this.terrain.flatten(x, z, site, site + 7, this.terrain.averageHeight(x, z, site * 0.7));
    this.veg.clearArea(x, z, site + 7);
    let lo = Infinity, hi = -Infinity;
    for (const [px, pz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [0, 0], [dx, D / 2 + 0.6]]) {
      const h = T.getHeight(x + px, z + pz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    const floor = hi + 0.18;
    const P = [];
    const box = (w, h, d, px, py, pz, col, ry = 0, rx = 0) => P.push(colorize(xf(new THREE.BoxGeometry(w, h, d), px, py, pz, rx, ry, 0), col));
    const wood = 0x7a5a3a, woodD = 0x5e432b, woodL = 0x9a7a52;
    // foundation and floor
    const fh = floor - lo + 0.3;
    box(W + 0.3, fh, D + 0.3, 0, -fh / 2 - 0.01, 0, 0x6a6660);
    box(W - 0.1, 0.06, D - 0.1, 0, 0, 0, 0x8a6a48);
    for (let px = -W / 2 + 0.3; px < W / 2 - 0.1; px += 0.3) box(0.015, 0.062, D - 0.12, px, 0, 0, 0x5e4630);
    // walls (inner surfaces)
    box(W, H, t, 0, H / 2, -D / 2 + t / 2, wood);
    box(t, H, D, -W / 2 + t / 2, H / 2, 0, wood);
    box(t, H, D, W / 2 - t / 2, H / 2, 0, wood);
    const aW = dx - dw / 2 + W / 2, bW = W / 2 - (dx + dw / 2);
    box(aW, H, t, -W / 2 + aW / 2, H / 2, D / 2 - t / 2, wood);
    box(bW, H, t, W / 2 - bW / 2, H / 2, D / 2 - t / 2, wood);
    box(dw, H - dh, t, dx, dh + (H - dh) / 2, D / 2 - t / 2, wood);
    // exterior logs
    const logC = [0x7a5a3a, 0x6e5034];
    const log = (len, px, py, pz, alongX, col) => P.push(colorize(xf(new THREE.CylinderGeometry(0.13, 0.13, len, 7), px, py, pz, alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0), col));
    for (let i = 0; i < 10; i++) {
      const y = 0.13 + i * 0.25, col = logC[i % 2];
      log(W + 0.45, 0, y, -D / 2 - 0.02, true, col);
      log(D + 0.45, -W / 2 - 0.02, y + 0.12, 0, false, logC[(i + 1) % 2]);
      log(D + 0.45, W / 2 + 0.02, y + 0.12, 0, false, logC[(i + 1) % 2]);
      if (y + 0.13 < dh) {
        const la = aW + 0.22, lb = bW + 0.22;
        log(la, -W / 2 - 0.22 + la / 2, y, D / 2 + 0.02, true, col);
        log(lb, W / 2 + 0.22 - lb / 2, y, D / 2 + 0.02, true, col);
      } else log(W + 0.45, 0, y, D / 2 + 0.02, true, col);
    }
    // door frame, open door and windows
    box(0.08, dh, 0.3, dx - dw / 2 - 0.04, dh / 2, D / 2 - t / 2, woodD);
    box(0.08, dh, 0.3, dx + dw / 2 + 0.04, dh / 2, D / 2 - t / 2, woodD);
    for (const s of [-1, 1]) {
      for (const off of [0.14, -0.14]) box(0.03, 0.75, 0.95, s * (W / 2 + off), 1.45, -0.3, 0x2a3a44);
      box(0.06, 0.9, 1.1, s * (W / 2 + 0.16), 1.45, -0.3, woodL);
    }
    // roof: two sloped boards, gables, beams
    const run = D / 2 + 0.45, slope = Math.atan2(rh, run), bl = Math.hypot(run, rh) + 0.1;
    for (const s of [-1, 1]) box(W + 0.9, 0.12, bl, 0, H + rh / 2 + 0.05, s * run / 2, 0x3b3632, 0, s * slope);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -D / 2, 0, 0, D / 2, 0, rh, 0], 3));
    tri.computeVertexNormals();
    for (const s of [-1, 1]) { const g = tri.clone(); g.translate(s * (W / 2 - 0.02), H, 0); P.push(colorize(g, 0x6e5034)); }
    for (const bz of [-D / 4, D / 4]) log(W - 0.3, 0, H - 0.08, bz, true, woodD);
    // ---- interior ----
    const bx = -W / 2 + t + 0.55, bz = -D / 2 + t + 1.05;
    box(1.0, 0.32, 2.0, bx, 0.19, bz, 0x6a4a30);
    box(0.92, 0.16, 1.92, bx, 0.42, bz, 0xe6dccb);
    box(0.97, 0.09, 1.25, bx, 0.53, bz + 0.32, 0x8a2e2a);
    for (const o of [0.05, 0.45]) box(0.98, 0.092, 0.05, bx, 0.53, bz + o, 0x3a2a24);
    box(0.62, 0.11, 0.34, bx, 0.55, bz - 0.74, 0xf2eee6);
    box(1.05, 0.8, 0.08, bx, 0.45, bz - 1.02, woodD);
    const tx = W / 2 - t - 0.6, tz = D * 0.08;
    box(0.9, 0.06, 0.7, tx, 0.74, tz, woodL);
    for (const [lx, lz] of [[-0.38, -0.28], [0.38, -0.28], [-0.38, 0.28], [0.38, 0.28]]) box(0.06, 0.72, 0.06, tx + lx, 0.36, tz + lz, woodD);
    const cx = tx - 0.75;
    box(0.42, 0.05, 0.42, cx, 0.45, tz, woodL);
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) box(0.04, 0.44, 0.04, cx + lx, 0.22, tz + lz, woodD);
    box(0.05, 0.5, 0.42, cx - 0.2, 0.72, tz, woodL);
    box(0.12, 0.04, 0.12, tx + 0.15, 0.79, tz - 0.1, 0x2a2a2a); // lantern base
    box(0.12, 0.04, 0.12, tx + 0.15, 0.97, tz - 0.1, 0x2a2a2a); // lantern top
    box(0.18, 0.03, 0.25, tx - 0.2, 0.785, tz + 0.1, 0xd8d0b8);  // open book
    box(1.6, 0.012, 1.0, 0.15, 0.035, 0.15, 0x6a3a2a);
    box(1.4, 0.014, 0.8, 0.15, 0.036, 0.15, 0x8a5a3a);
    const sx = opts.stove ? 0.2 : W / 2 - t - 0.5, sz = -D / 2 + t + 0.14;
    for (const sy of [1.25, 1.65]) box(1.1, 0.04, 0.26, sx, sy, sz, woodL);
    const jars = [0x7a8a5a, 0xb07a40, 0x5a6a8a, 0x9a3a2a, 0xd8c8a0];
    for (let i = 0; i < 5; i++) box(0.1, 0.16 + (i % 2) * 0.06, 0.1, sx - 0.4 + i * 0.2, 1.36 + (i % 2) * 0.03, sz, jars[i]);
    for (let i = 0; i < 6; i++) box(0.05, 0.24, 0.17, sx - 0.35 + i * 0.07, 1.79, sz, [0x6a2a2a, 0x2a4a6a, 0x4a5a2a][i % 3]);
    let stove = null;
    if (opts.stove) {
      stove = { x: W / 2 - t - 0.45, z: -D / 2 + t + 0.5 };
      box(0.6, 0.7, 0.55, stove.x, 0.35, stove.z, 0x1e1e20);
      box(0.66, 0.05, 0.6, stove.x, 0.72, stove.z, 0x2a2a2c);
      P.push(colorize(xf(new THREE.CylinderGeometry(0.08, 0.08, H + rh - 0.6, 8), stove.x, 0.72 + (H + rh - 0.6) / 2, stove.z), 0x1a1a1c));
      box(0.6, 1.0, 0.6, stove.x, H + rh * 0.6, stove.z, 0x5f5a54); // chimney above roof
      for (let i = 0; i < 4; i++) log(0.55, stove.x - 0.75 + (i % 2) * 0.22, 0.12 + Math.floor(i / 2) * 0.2, stove.z + 0.1, false, 0x8a6a48);
    }
    if (opts.home) {
      const bz2 = D / 2 - t - 0.025;
      box(1.1, 0.8, 0.03, -1.3, 1.5, bz2, woodD);
      box(1.0, 0.7, 0.02, -1.3, 1.5, bz2 - 0.015, 0xa47a4a);
      const papers = [[-1.6, 1.62, 0.22, 0.28], [-1.3, 1.6, 0.26, 0.2], [-1.0, 1.55, 0.2, 0.3], [-1.45, 1.3, 0.3, 0.2], [-1.05, 1.3, 0.22, 0.18]];
      for (const [px, py, pw, ph] of papers) box(pw, ph, 0.006, px, py, bz2 - 0.03, 0xeae2cc);
      box(0.5, 0.05, 0.006, -1.3, 1.92, bz2 - 0.03, 0x3a2a1a);
      box(0.06, 0.25, 0.04, -0.68, 1.3, bz2 - 0.04, 0x6a4a30); // hammer handle
      box(0.12, 0.05, 0.05, -0.68, 1.44, bz2 - 0.04, 0x3a3a3c);
    }
    // porch step
    const gDoor = T.getHeight(x + dx, z + D / 2 + 0.55);
    const stepTop = (gDoor - floor) / 2;
    const sh = Math.max(0.1, stepTop - (gDoor - floor) + 0.1);
    box(1.4, sh, 0.6, dx, stepTop - sh / 2, D / 2 + 0.38, 0x6a6660);

    const mesh = new THREE.Mesh(mergeColored(P), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.position.set(x, floor, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    // glowing lantern glass
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 8), new THREE.MeshBasicMaterial({ color: 0xffc860 }));
    glass.position.set(x + tx + 0.15, floor + 0.88, z + tz - 0.1);
    this.scene.add(glass);

    // colliders (thin wall boxes, furniture) and walkable surfaces
    const y0 = floor - 1, y1 = floor + H + 0.5;
    this.addBox(x, z - D / 2 + t / 2, W / 2, t / 2, y0, y1);
    this.addBox(x - W / 2 + t / 2, z, t / 2, D / 2, y0, y1);
    this.addBox(x + W / 2 - t / 2, z, t / 2, D / 2, y0, y1);
    this.addBox(x - W / 2 + aW / 2, z + D / 2 - t / 2, aW / 2, t / 2, y0, y1);
    this.addBox(x + W / 2 - bW / 2, z + D / 2 - t / 2, bW / 2, t / 2, y0, y1);
    this.addBox(x + bx, z + bz, 0.5, 1.0, y0, floor + 0.55);
    this.addBox(x + tx, z + tz, 0.45, 0.35, y0, floor + 0.8);
    if (stove) this.addBox(x + stove.x, z + stove.z, 0.3, 0.28, y0, floor + 0.8);
    this.platforms.push({ x, z, hw: W / 2 - 0.05, hd: D / 2 + 0.02, y: floor + 0.03 });
    this.platforms.push({ x: x + dx, z: z + D / 2 + 0.38, hw: 0.7, hd: 0.3, y: floor + stepTop });
    this.restSpots.push({ x: x + bx + 0.8, z: z + bz, name, bed: true, cabinX: x, cabinZ: z, floor });
    this.lanterns.push({ x: x + tx + 0.15, y: floor + 1.0, z: z + tz - 0.1 });

    // hinged door: a separate mesh that swings inward; a collider is added while it is shut
    const dg = [];
    dg.push(colorize(xf(new THREE.BoxGeometry(dw - 0.06, dh - 0.06, 0.06), (dw - 0.06) / 2, (dh - 0.06) / 2 + 0.03, 0), 0x4a3422));
    for (const by of [0.4, 1.0, 1.6]) dg.push(colorize(xf(new THREE.BoxGeometry(dw - 0.1, 0.1, 0.075), (dw - 0.06) / 2, by, 0), 0x3a2818));
    for (const hz of [0.05, -0.05]) dg.push(colorize(xf(new THREE.SphereGeometry(0.035, 6, 5), dw - 0.18, 1.0, hz * 1.4), 0x9a8a60));
    const door = new THREE.Mesh(mergeColored(dg), new THREE.MeshLambertMaterial({ vertexColors: true }));
    door.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(x + dx - dw / 2 + 0.03, floor, z + D / 2 - t / 2);
    pivot.add(door);
    this.scene.add(pivot);
    const zf = z + D / 2 - t / 2;
    const openAngle = Math.PI / 2 * 0.95;
    pivot.rotation.y = openAngle;
    this.doors.push({
      pivot, open: true, angle: openAngle, openAngle, name,
      x: x + dx, z: zf,
      box: { minX: x + dx - dw / 2, maxX: x + dx + dw / 2, minZ: zf - t / 2, maxZ: zf + t / 2, minY: y0, maxY: y1 },
    });
    this.cabins.push({ x, z, W, D, floor, name, door: this.doors[this.doors.length - 1], home: !!opts.home });
    if (opts.home) this.home = { x, z, W, D, floor, t, H, rh, dx, dw, dh, stove, bx, bz, tx, tz, name, door: this.doors[this.doors.length - 1] };
  }

  // A small frontier street: three enterable storefronts around a levelled square.
  buildTown(cx, cz) {
    this.stores = [];
    const h = this.terrain.averageHeight(cx, cz, 14);
    this.terrain.flatten(cx, cz, 23, 33, h);
    this.veg.clearArea(cx, cz, 34);
    this.buildStore('gun', cx, cz + 14, Math.PI, h);          // south side, facing north
    this.buildStore('butcher', cx + 14, cz, -Math.PI / 2, h); // east side, facing west
    this.buildStore('general', cx - 14, cz, Math.PI / 2, h);  // west side, facing east
    // hitching rail, barrels and a lamp post on the square
    const P = [];
    const wood = 0x6e5034;
    P.push(colorize(xf(new THREE.BoxGeometry(3, 0.12, 0.12), 0, 1.0, 0), wood));
    for (const s of [-1, 1]) P.push(colorize(xf(new THREE.BoxGeometry(0.14, 1.1, 0.14), s * 1.4, 0.55, 0), wood));
    for (const [bx, bz] of [[3.5, 2], [4.1, 2.6], [-4, -3]]) P.push(colorize(xf(new THREE.CylinderGeometry(0.32, 0.36, 0.9, 10), bx, 0.45, bz), 0x8a6238));
    P.push(colorize(xf(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), -3, 1.6, 4), 0x2a2a2a));
    const deco = new THREE.Mesh(mergeColored(P), new THREE.MeshLambertMaterial({ vertexColors: true }));
    deco.position.set(cx, h, cz);
    deco.castShadow = true;
    this.scene.add(deco);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd080 }));
    lamp.position.set(cx - 3, h + 3.3, cz + 4);
    this.scene.add(lamp);
    this.addBox(cx, cz, 1.5, 0.15, h - 1, h + 1.2);
    this.lanterns.push({ x: cx - 3, y: h + 3.2, z: cz + 4 });
  }

  // Storefront with a false-front facade, porch, door, windows, counter and vendor inside.
  // Built in local space (front faces +z) and rotated by rot.
  buildStore(id, x, z, rot, ground) {
    const W = 8, D = 7, t = 0.2, H = 3.4, FH = 5.4, dw = 1.3, dh = 2.3;
    const look = STORE_LOOK[id];
    const floor = ground + 0.35;
    const c = Math.cos(rot), s = Math.sin(rot);
    const toW = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const swap = Math.abs(s) > 0.5;
    const boxL = (lx, lz, hw, hd, y0, y1) => { const [wx, wz] = toW(lx, lz); this.addBox(wx, wz, swap ? hd : hw, swap ? hw : hd, y0, y1); };
    const P = [];
    const box = (w, hh, d, px, py, pz, col, rx = 0, ry = 0, rz = 0) => P.push(colorize(xf(new THREE.BoxGeometry(w, hh, d), px, py, pz, rx, ry, rz), col));
    const wall = look.wall, trim = look.trim, dark = 0x3a2a1c, plank = 0x8a6a48;

    // foundation, floor and porch
    box(W + 0.3, 0.7, D + 0.3, 0, -0.35, 0, 0x5f5a54);
    box(W - 0.1, 0.06, D - 0.1, 0, 0, 0, plank);
    for (let px = -W / 2 + 0.3; px < W / 2; px += 0.3) box(0.015, 0.062, D - 0.12, px, 0, 0, 0x5e4630);
    box(W + 1.2, 0.12, 2.4, 0, -0.04, D / 2 + 1.2, plank);
    for (let px = -W / 2 - 0.5; px < W / 2 + 0.6; px += 0.3) box(0.015, 0.122, 2.38, px, -0.04, D / 2 + 1.2, 0x5e4630);
    box(W + 1.2, 0.3, 2.4, 0, -0.25, D / 2 + 1.2, 0x5f5a54);
    // walls
    box(W, H, t, 0, H / 2, -D / 2 + t / 2, wall);
    box(t, H, D, -W / 2 + t / 2, H / 2, 0, wall);
    box(t, H, D, W / 2 - t / 2, H / 2, 0, wall);
    const seg = (W - dw) / 2;
    box(seg, H, t, -W / 2 + seg / 2, H / 2, D / 2 - t / 2, wall);
    box(seg, H, t, W / 2 - seg / 2, H / 2, D / 2 - t / 2, wall);
    box(dw, H - dh, t, 0, dh + (H - dh) / 2, D / 2 - t / 2, wall);
    // false front facade above the roofline, with cornice
    box(W + 0.3, FH - H, t, 0, H + (FH - H) / 2, D / 2 - t / 2, wall);
    box(W + 0.7, 0.2, 0.45, 0, FH, D / 2 - t / 2, trim);
    box(W + 0.5, 0.12, 0.3, 0, FH - 0.25, D / 2 - t / 2, trim);
    // horizontal siding lines on the outside
    for (let y = 0.25; y < FH - 0.3; y += 0.28) {
      if (y > dh + 0.15) box(W + 0.3, 0.03, 0.03, 0, y, D / 2 + 0.01, 0x2a1e14);
      else for (const sx of [-1, 1]) box(seg + 0.15, 0.03, 0.03, sx * (W / 2 - seg / 2 + 0.075), y, D / 2 + 0.01, 0x2a1e14);
    }
    for (let y = 0.25; y < H; y += 0.28) for (const sx of [-1, 1]) box(0.03, 0.03, D, sx * (W / 2 + 0.01), y, 0, 0x2a1e14);
    // corner boards, door frame, windows
    for (const sx of [-1, 1]) box(0.16, FH, 0.16, sx * (W / 2 + 0.06), FH / 2, D / 2 + 0.02, trim);
    box(0.12, dh + 0.1, 0.3, -dw / 2 - 0.06, dh / 2, D / 2 - t / 2, trim);
    box(0.12, dh + 0.1, 0.3, dw / 2 + 0.06, dh / 2, D / 2 - t / 2, trim);
    box(dw + 0.3, 0.14, 0.3, 0, dh + 0.06, D / 2 - t / 2, trim);
    const glass = 0x2a3a44;
    for (const sx of [-1, 1]) {
      // front shop windows: dark glass on both faces, framed by thin bars and a cross mullion
      const wx = sx * (W / 4 + 0.35), wy = 1.45, ww = 1.5, wh = 1.3;
      box(ww, wh, 0.02, wx, wy, D / 2 + 0.035, glass);
      box(ww, wh, 0.02, wx, wy, D / 2 - t - 0.015, glass);
      for (const [fw, fh, fx, fy] of [[ww + 0.2, 0.1, 0, wh / 2 + 0.05], [ww + 0.2, 0.1, 0, -wh / 2 - 0.05], [0.1, wh, -ww / 2 - 0.05, 0], [0.1, wh, ww / 2 + 0.05, 0], [ww, 0.05, 0, 0], [0.05, wh, 0, 0]]) {
        box(fw, fh, 0.08, wx + fx, wy + fy, D / 2 + 0.06, trim);
      }
      box(1.8, 0.08, 0.3, wx, wy - wh / 2 - 0.15, D / 2 + 0.15, trim);
      // side windows
      const sxw = sx * (W / 2 + 0.035);
      box(0.02, 1.1, 1.3, sxw, 1.5, -0.6, glass);
      box(0.02, 1.1, 1.3, sx * (W / 2 - t - 0.015), 1.5, -0.6, glass);
      for (const [fz, fy, fd, fh] of [[0, 0.6, 1.5, 0.1], [0, -0.6, 1.5, 0.1], [-0.7, 0, 0.1, 1.1], [0.7, 0, 0.1, 1.1], [0, 0, 0.05, 1.1]]) {
        box(0.08, fh, fd, sx * (W / 2 + 0.06), 1.5 + fy, -0.6 + fz, trim);
      }
    }
    // gable roof behind the facade (ridge front-to-back)
    const rh = 1.4, run = W / 2 + 0.4, slope = Math.atan2(rh, run), bl = Math.hypot(run, rh) + 0.1;
    for (const sx of [-1, 1]) box(bl, 0.12, D + 0.3, sx * run / 2, H + rh / 2 + 0.05, -0.1, look.roof, 0, 0, -sx * slope);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-W / 2, 0, 0, W / 2, 0, 0, 0, rh, 0], 3));
    tri.computeVertexNormals();
    const back = tri.clone(); back.translate(0, H, -D / 2 + 0.02); P.push(colorize(back, wall));
    for (let i = 0; i < 3; i++) P.push(colorize(xf(new THREE.CylinderGeometry(0.09, 0.09, D - 0.3, 6), -2.2 + i * 2.2, H - 0.1, 0, Math.PI / 2, 0, 0), dark));
    // porch awning on posts
    box(W + 1.2, 0.1, 2.6, 0, 2.95, D / 2 + 1.25, look.roof, -0.12, 0, 0);
    for (const sx of [-1, -0.33, 0.33, 1]) box(0.14, 2.95, 0.14, sx * (W / 2 + 0.45), 1.47, D / 2 + 2.3, trim);
    box(W + 1.1, 0.08, 0.1, 0, 0.95, D / 2 + 2.3, trim);
    // ---- interior ----
    const cz = -D / 2 + 2.1;
    box(W - 1.6, 1.0, 0.7, -0.4, 0.5, cz, dark);
    box(W - 1.4, 0.07, 0.85, -0.4, 1.03, cz, plank);
    for (let i = 0; i < 3; i++) box(W - 1.0, 0.05, 0.38, 0, 0.9 + i * 0.6, -D / 2 + t + 0.2, plank);
    for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) box(0.38, 0.05, 2.0, sx * (W / 2 - t - 0.2), 0.9 + i * 0.6, D / 2 - 2.0, plank);
    const goods = (n, w, hh, col, y, z0) => { for (let i = 0; i < n; i++) box(w, hh, w, -W / 2 + 0.7 + i * ((W - 1.4) / (n - 1)), y + hh / 2, z0, Array.isArray(col) ? col[i % col.length] : col); };
    if (id === 'gun') {
      for (let i = 0; i < 6; i++) { // rifles on the back wall
        const gx = -2.4 + i * 0.95;
        box(0.06, 1.15, 0.09, gx, 2.3, -D / 2 + t + 0.08, 0x4a3020, 0, 0, 0.08);
        box(0.025, 0.55, 0.025, gx + 0.05, 3.05, -D / 2 + t + 0.08, 0x222222);
      }
      goods(9, 0.18, 0.12, 0x3a5a2a, 0.93, -D / 2 + t + 0.2);
      goods(8, 0.16, 0.14, [0xb03a2a, 0x2a4a6a], 1.53, -D / 2 + t + 0.2);
      box(2.2, 0.35, 0.6, -1.2, 1.25, cz, 0x5a6a70); // glass display case
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) box(0.2, 0.12, 0.25, sx * (W / 2 - t - 0.2), 0.96 + i * 0.6, D / 2 - 2.6 + i * 0.5, 0x3a5a2a);
      box(0.9, 0.08, 0.08, 0, 3.0, -D / 2 + t + 0.06, 0xcbb894); // antler mount
      for (const sx of [-1, 1]) box(0.05, 0.4, 0.05, sx * 0.35, 3.2, -D / 2 + t + 0.06, 0xcbb894, 0, 0, sx * 0.4);
    } else if (id === 'butcher') {
      goods(10, 0.26, 0.14, 0xd8c8a8, 0.93, -D / 2 + t + 0.2);
      goods(10, 0.22, 0.18, 0xc8b898, 1.53, -D / 2 + t + 0.2);
      for (let i = 0; i < 7; i++) box(0.09, 0.4, 0.09, -2.6 + i * 0.8, 2.6, -D / 2 + 0.8, 0x8a4a32); // hanging sausages
      box(W - 1.0, 0.04, 0.04, 0, 2.85, -D / 2 + 0.8, 0x6a6a6a);
      box(0.4, 0.25, 0.35, 1.6, 1.2, cz, 0x9a9a9a); // scale
      box(0.6, 0.8, 0.6, W / 2 - 0.9, 0.4, D / 2 - 1.3, 0x6a4a30); // chopping block
      box(1.2, 0.8, 0.7, -W / 2 + 1.0, 0.4, D / 2 - 1.2, 0xd8d8d8); // ice chest
      box(1.4, 0.9, 0.05, 0, 2.2, -D / 2 + t + 0.03, 0x2a2a2a); // price board
    } else {
      goods(10, 0.12, 0.16, [0xb03a2a, 0x3a6a3a, 0xc8a030, 0x3a4a8a], 0.93, -D / 2 + t + 0.2);
      goods(9, 0.2, 0.25, [0xd8c890, 0x8a6a3a], 1.53, -D / 2 + t + 0.2);
      goods(10, 0.12, 0.18, [0x7a8a5a, 0xb07a40, 0x5a6a8a], 2.13, -D / 2 + t + 0.2);
      for (const [bx, bz] of [[-W / 2 + 0.8, D / 2 - 1.2], [-W / 2 + 1.5, D / 2 - 1.0], [W / 2 - 0.9, D / 2 - 1.3]]) P.push(colorize(xf(new THREE.CylinderGeometry(0.33, 0.37, 0.9, 10), bx, 0.45, bz), 0x8a6238));
      for (let i = 0; i < 3; i++) box(0.5, 0.35, 0.4, W / 2 - 0.9, 0.17 + i * 0.01, D / 2 - 2.4 + i * 0.5, 0xc8b078); // flour sacks
      box(0.3, 0.35, 0.3, 1.4, 1.22, cz, 0x2a2a2a); // cash register
    }
    // lantern on the counter
    box(0.12, 0.04, 0.12, -2.6, 1.08, cz, 0x2a2a2a);
    box(0.12, 0.04, 0.12, -2.6, 1.28, cz, 0x2a2a2a);

    const mesh = new THREE.Mesh(mergeColored(P), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.position.set(x, floor, z);
    mesh.rotation.y = rot;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);

    const [gx, gz] = toW(-2.6, cz);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 8), new THREE.MeshBasicMaterial({ color: 0xffc860 }));
    glow.position.set(gx, floor + 1.18, gz);
    this.scene.add(glow);
    const [lx, lz] = toW(0, 0);
    this.lanterns.push({ x: lx, y: floor + 2.6, z: lz });

    // facade sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, 1.15), new THREE.MeshLambertMaterial({ map: signTexture(look.sign, look.signColor) }));
    const [sx, sz] = toW(0, D / 2 + 0.06);
    sign.position.set(sx, floor + H + 0.95, sz);
    sign.rotation.y = rot;
    this.scene.add(sign);

    // vendor behind the counter, facing the door
    const v = new THREE.Mesh(vendorGeometry(look.apron), new THREE.MeshLambertMaterial({ vertexColors: true }));
    const [vx, vz] = toW(-0.4, cz - 0.85);
    v.position.set(vx, floor + 0.03, vz);
    v.rotation.y = rot;
    v.castShadow = true;
    this.scene.add(v);

    // colliders and floors
    const y0 = floor - 1.5, y1 = floor + H + 1;
    boxL(0, -D / 2 + t / 2, W / 2, t / 2, y0, y1);
    boxL(-W / 2 + t / 2, 0, t / 2, D / 2, y0, y1);
    boxL(W / 2 - t / 2, 0, t / 2, D / 2, y0, y1);
    boxL(-W / 2 + seg / 2, D / 2 - t / 2, seg / 2, t / 2, y0, y1);
    boxL(W / 2 - seg / 2, D / 2 - t / 2, seg / 2, t / 2, y0, y1);
    boxL(-0.4, cz, (W - 1.4) / 2, 0.42, y0, floor + 1.1);
    const [fx, fz] = toW(0, 0.5);
    this.platforms.push({ x: fx, z: fz, hw: swap ? (D + 2.4) / 2 + 1.2 : W / 2 + 0.6, hd: swap ? W / 2 + 0.6 : (D + 2.4) / 2 + 1.2, y: floor + 0.03 });

    // hinged door, shut by default (customers open it themselves)
    const door = this.makeDoor({ x, z, rot, hingeX: -dw / 2 + 0.03, frontZ: D / 2 - t / 2, dw, dh, floor, t, name: look.sign, open: false });

    // where the player stands to trade: in front of the counter
    const [ix, iz] = toW(-0.4, cz + 1.1);
    const st = { id, x: ix, z: iz, vendor: v, base: floor, door, closed: false, bounds: { x, z, hw: (swap ? D : W) / 2, hd: (swap ? W : D) / 2 } };
    door.store = st;
    this.stores.push(st);
    this.cabins.push({ x, z, W: swap ? D : W, D: swap ? W : D, floor, store: true });
  }

  isInside(b, x, z) { return Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd; }

  // Stores open 09:00–21:00. After hours the shopkeeper goes home and the door is locked
  // (once you have left — you can always let yourself out).
  updateStores(time, px, pz) {
    const open = time >= 9 && time < 21;
    for (const st of this.stores) {
      const inside = this.isInside(st.bounds, px, pz);
      if (open) { st.closed = false; st.vendor.visible = true; continue; }
      st.closed = true;
      if (!inside) {
        st.vendor.visible = false;
        if (st.door.open) this.setDoor(st.door, false);
      }
    }
  }

  // Ray against the shopkeepers (only those behind their counters)
  raycastVendors(o, d, maxDist) {
    let best = null;
    for (const st of this.stores) {
      const v = st.vendor;
      if (!v.visible) continue;
      for (const [y, r] of [[0.5, 0.24], [1.05, 0.3], [1.58, 0.17]]) {
        const cx = v.position.x - o.x, cy = v.position.y + y - o.y, cz = v.position.z - o.z;
        const tc = cx * d.x + cy * d.y + cz * d.z;
        if (tc < 0) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
        if (d2 > r * r) continue;
        const t = tc - Math.sqrt(r * r - d2);
        if (t <= maxDist && (!best || t < best.dist)) best = { dist: Math.max(0, t), store: st };
      }
    }
    return best;
  }

  // Hinged door on a rotated building; adds a collider while it is shut.
  makeDoor({ x, z, rot, hingeX, frontZ, dw, dh, floor, t, name, open }) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const toW = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const dg = [];
    dg.push(colorize(xf(new THREE.BoxGeometry(dw - 0.06, dh - 0.06, 0.06), (dw - 0.06) / 2, (dh - 0.06) / 2 + 0.03, 0), 0x4a3422));
    for (const by of [0.45, 1.15, 1.85]) dg.push(colorize(xf(new THREE.BoxGeometry(dw - 0.12, 0.1, 0.075), (dw - 0.06) / 2, by, 0), 0x3a2818));
    for (const hz of [0.05, -0.05]) dg.push(colorize(xf(new THREE.SphereGeometry(0.035, 6, 5), dw - 0.18, 1.05, hz * 1.4), 0x9a8a60));
    const door = new THREE.Mesh(mergeColored(dg), new THREE.MeshLambertMaterial({ vertexColors: true }));
    door.castShadow = true;
    const pivot = new THREE.Group();
    const [px, pz] = toW(hingeX, frontZ);
    pivot.position.set(px, floor, pz);
    pivot.add(door);
    this.scene.add(pivot);
    const openAngle = Math.PI / 2 * 0.95;
    const [mx, mz] = toW(hingeX + dw / 2, frontZ);
    const swap = Math.abs(s) > 0.5;
    const hw = swap ? t / 2 : dw / 2, hd = swap ? dw / 2 : t / 2;
    const d = {
      pivot, open, angle: open ? openAngle : 0, openAngle, baseRot: rot, name, x: mx, z: mz,
      box: { minX: mx - hw, maxX: mx + hw, minZ: mz - hd, maxZ: mz + hd, minY: floor - 1, maxY: floor + dh + 0.5 },
    };
    pivot.rotation.y = rot + d.angle;
    this.doors.push(d);
    if (!open) this.boxes.push(d.box);
    return d;
  }

  buildStand(x, z) {
    const T = this.terrain;
    const base = T.getHeight(x, z);
    const top = 4.2;
    const parts = [];
    const wood = 0x7d6244, dark = 0x5a4430;
    const hw = 1.1;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const a = new THREE.Vector3(sx * (hw + 0.35), T.getHeight(x + sx * (hw + 0.35), z + sz * (hw + 0.35)) - base - 0.2, sz * (hw + 0.35));
      const b = new THREE.Vector3(sx * hw * 0.9, top, sz * hw * 0.9);
      parts.push(cylinderBetween(a, b, 0.09, 0.07, 6, dark));
    }
    // cross braces
    parts.push(cylinderBetween(new THREE.Vector3(-hw - 0.2, 0.8, -hw - 0.2), new THREE.Vector3(hw, top - 0.6, -hw), 0.04, 0.04, 4, dark));
    parts.push(cylinderBetween(new THREE.Vector3(hw + 0.2, 0.8, hw + 0.2), new THREE.Vector3(-hw, top - 0.6, hw), 0.04, 0.04, 4, dark));
    // floor
    parts.push(colorize(xf(new THREE.BoxGeometry(hw * 2 + 0.2, 0.1, hw * 2 + 0.2), 0, top, 0), wood));
    // railings (open side faces the meadow: +z)
    for (const s of [-1, 1]) {
      parts.push(colorize(xf(new THREE.BoxGeometry(0.06, 0.06, hw * 2), s * hw, top + 0.95, 0), wood));
      parts.push(colorize(xf(new THREE.BoxGeometry(hw * 2, 0.06, 0.06), 0, top + 0.95, s * hw), wood));
      for (const s2 of [-1, 1]) parts.push(colorize(xf(new THREE.BoxGeometry(0.07, 1.0, 0.07), s * hw, top + 0.5, s2 * hw), wood));
    }
    // seat
    parts.push(colorize(xf(new THREE.BoxGeometry(1.2, 0.08, 0.45), 0, top + 0.45, -hw + 0.35), wood));
    // ladder on -z side
    const lz = -hw - 0.55;
    for (const s of [-1, 1]) parts.push(cylinderBetween(new THREE.Vector3(s * 0.28, -0.1, lz - 0.5), new THREE.Vector3(s * 0.28, top + 0.1, lz + 0.35), 0.035, 0.035, 5, wood));
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      parts.push(colorize(xf(new THREE.CylinderGeometry(0.025, 0.025, 0.56, 4), 0, -0.1 + t * (top + 0.2), lz - 0.5 + t * 0.85, 0, 0, Math.PI / 2), wood));
    }
    // camo canvas skirt
    for (const s of [-1, 1]) parts.push(colorize(xf(new THREE.BoxGeometry(hw * 2, 0.6, 0.03), 0, top + 0.4, s * hw * 1.0), s > 0 ? 0x4a5236 : 0x434a30));
    const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.position.set(x, base, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.platforms.push({ x, z, hw: hw + 0.05, hd: hw + 0.05, y: base + top + 0.05 });
    this.ladders.push({ x, z: z + lz - 0.6, topX: x, topZ: z - hw + 0.5, topY: base + top + 0.05, baseY: base });
  }

  buildCampfire(x, z) {
    const T = this.terrain;
    const base = T.getHeight(x, z);
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const g = new THREE.DodecahedronGeometry(0.17, 0);
      xf(g, Math.cos(a) * 0.55, 0.07, Math.sin(a) * 0.55, a, a * 2, 0, 1, 0.7, 1);
      parts.push(colorize(g, 0x5c5954));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.3;
      parts.push(cylinderBetween(new THREE.Vector3(Math.cos(a) * 0.45, 0.02, Math.sin(a) * 0.45), new THREE.Vector3(Math.cos(a) * 0.05, 0.32, Math.sin(a) * 0.05), 0.05, 0.04, 5, 0x3a2a1c));
    }
    // log benches
    parts.push(colorize(xf(new THREE.CylinderGeometry(0.2, 0.2, 1.8, 7), 0, 0.2, 1.7, 0, 0, Math.PI / 2), 0x6e5034));
    parts.push(colorize(xf(new THREE.CylinderGeometry(0.2, 0.2, 1.8, 7), -1.7, 0.2, 0, Math.PI / 2, 0, 0), 0x6e5034));
    const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.position.set(x, base, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    // embers / flame
    if (!this.fireMat) this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.9, depthWrite: false });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 6, 1, true), this.fireMat);
    flame.position.set(x, base + 0.35, z);
    flame.visible = false;
    this.scene.add(flame);
    const embers = new THREE.Mesh(new THREE.CircleGeometry(0.32, 10), new THREE.MeshBasicMaterial({ color: 0xc4401a }));
    embers.rotation.x = -Math.PI / 2;
    embers.position.set(x, base + 0.06, z);
    embers.visible = false;
    this.scene.add(embers);
    this.fires.push({ x, z, y: base, flame, embers, lit: false, fuel: 0, phase: this.fires.length * 2.3 });
  }

  update(dt, camPos) {
    this.env.update(dt, camPos);
    this.veg.update(dt, camPos, this.env.viewDist * Math.max(0.55, this.env.w.fog) + 30, this.env.wind);
    const t = performance.now() / 1000;
    const dh = (dt * this.env.timeScale * 24) / this.env.daySeconds;
    let nearFire = null, nfd = 70;
    for (const f of this.fires) {
      if (f.lit) {
        f.fuel -= dh * (1 + this.env.w.rain * 1.5);
        if (f.fuel <= 0) { f.lit = false; f.fuel = 0; if (this.onFireOut) this.onFireOut(f); }
      }
      f.flame.visible = f.embers.visible = f.lit;
      if (!f.lit) continue;
      const flick = 0.75 + Math.sin(t * 13 + f.phase) * 0.12 + Math.sin(t * 7.3 + f.phase) * 0.1;
      const k = Math.min(1, f.fuel / 0.5 + 0.3);
      f.flame.scale.set(k, (0.8 + flick * 0.4) * k, k);
      f.flame.rotation.y = t * 2 + f.phase;
      const d = Math.hypot(f.x - camPos.x, f.z - camPos.z);
      if (d < nfd) { nfd = d; nearFire = f; f.flick = flick * k; }
    }
    if (nearFire) {
      this.fireLight.position.set(nearFire.x, nearFire.y + 0.8, nearFire.z);
      this.fireLight.intensity = (1 - this.env.daylight * 0.8) * 7 * nearFire.flick;
    } else this.fireLight.intensity = 0;
    for (const d of this.doors) {
      const target = d.open ? d.openAngle : 0;
      d.angle += (target - d.angle) * Math.min(1, dt * 6);
      d.pivot.rotation.y = (d.baseRot || 0) + d.angle;
    }
    let lan = null, ld = 18;
    for (const l of this.lanterns) { const d = Math.hypot(l.x - camPos.x, l.z - camPos.z); if (d < ld) { ld = d; lan = l; } }
    if (lan) { this.lanternLight.position.set(lan.x, lan.y, lan.z); this.lanternLight.intensity = 4 + (1 - this.env.daylight) * 3; }
    else this.lanternLight.intensity = 0;
  }

  // Corn bait pile that draws herbivores in over the next game day
  placeBait(x, z) {
    if (!this.baitGeo) {
      const p = [ellipsoid(0, 0.04, 0, 0.35, 0.09, 0.3, 0xd8a830, 10, 6)];
      for (let i = 0; i < 24; i++) { const a = i * 2.4, r = 0.1 + (i % 5) * 0.06; p.push(ellipsoid(Math.cos(a) * r, 0.09 + (i % 3) * 0.02, Math.sin(a) * r, 0.025, 0.02, 0.025, i % 4 ? 0xf0c030 : 0xe8a020, 4, 3)); }
      this.baitGeo = mergeColored(p);
      this.baitMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    const mesh = new THREE.Mesh(this.baitGeo, this.baitMat);
    mesh.position.set(x, this.terrain.getHeight(x, z), z);
    this.scene.add(mesh);
    this.baits.push({ x, z, mesh, active: true, until: this.env.totalHours + 24 });
  }

  updateBaits() {
    for (const b of this.baits) {
      if (b.active && this.env.totalHours > b.until) { b.active = false; this.scene.remove(b.mesh); }
    }
    this.baits = this.baits.filter((b) => b.active);
  }

  nearestBait(x, z, r) {
    let best = null, bd = r;
    for (const b of this.baits) { const d = Math.hypot(b.x - x, b.z - z); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  setDoor(d, open) {
    if (d.open === open) return;
    d.open = open;
    const i = this.boxes.indexOf(d.box);
    if (open && i >= 0) this.boxes.splice(i, 1);
    if (!open && i < 0) this.boxes.push(d.box);
  }

  // Ground height including walkable platforms (for the player).
  groundAt(x, z, feetY) {
    let h = this.terrain.getHeight(x, z);
    for (const p of this.platforms) {
      if (Math.abs(x - p.x) < p.hw && Math.abs(z - p.z) < p.hd && feetY >= p.y - 0.7) h = Math.max(h, p.y);
    }
    return h;
  }

  // Circle collision against vegetation and structures.
  collide(x, z, r, out, y = null) {
    this.veg.collide(x, z, r, out);
    for (const b of this.boxes) {
      if (y !== null && (y > b.maxY || y < b.minY - 1.5)) continue;
      const cx = Math.max(b.minX, Math.min(out.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(out.z, b.maxZ));
      const dx = out.x - cx, dz = out.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          out.x = cx + (dx / d) * r; out.z = cz + (dz / d) * r;
        } else {
          // inside: push out along smallest axis
          const pen = [out.x - b.minX, b.maxX - out.x, out.z - b.minZ, b.maxZ - out.z];
          const m = Math.min(...pen);
          if (m === pen[0]) out.x = b.minX - r; else if (m === pen[1]) out.x = b.maxX + r;
          else if (m === pen[2]) out.z = b.minZ - r; else out.z = b.maxZ + r;
        }
      }
    }
    return out;
  }

  // Bullet blocking geometry: returns nearest distance or -1.
  raycastStatic(origin, dir, maxDist) {
    let best = this.terrain.raycast(origin, dir, maxDist, 0.75);
    const tv = this.veg.raycast(origin, dir, best > 0 ? best : maxDist);
    if (tv >= 0 && (best < 0 || tv < best)) best = tv;
    for (const b of this.boxes) {
      const t = rayBox(origin, dir, b);
      if (t >= 0 && t < maxDist && (best < 0 || t < best)) best = t;
    }
    return best;
  }
}

function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity;
  const ax = [['x', b.minX, b.maxX], ['y', b.minY, b.maxY], ['z', b.minZ, b.maxZ]];
  for (const [k, mn, mx] of ax) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < mn || o[k] > mx) return -1; continue; }
    let t1 = (mn - o[k]) / d[k], t2 = (mx - o[k]) / d[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin >= 0 ? tmin : -1;
}


const STORE_LOOK = {
  gun: { sign: 'GUNSMITH', roof: 0x3a3632, wall: 0x6a5a48, trim: 0x2e2a24, apron: 0x3a4a3a, signColor: 0x9a2a1e },
  butcher: { sign: 'BUTCHER', roof: 0x4a2a24, wall: 0x8a3a2e, trim: 0xe8dcc4, apron: 0xe8e2d6, signColor: 0xe8dcc4 },
  general: { sign: 'GENERAL STORE', roof: 0x2e3a32, wall: 0x6e7e6a, trim: 0xe0d8c0, apron: 0x8a6a3a, signColor: 0xc8a040 },
};

function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 118;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a2a1c'; ctx.fillRect(0, 0, 512, 118);
  ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0'); ctx.lineWidth = 10; ctx.strokeRect(5, 5, 502, 108);
  ctx.fillStyle = '#efe2c4';
  ctx.font = '600 58px "Barlow Condensed", Impact, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 62);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function vendorGeometry(apron) {
  const p = [];
  p.push(colorize(xf(new THREE.BoxGeometry(0.34, 0.85, 0.2), 0, 0.45, 0), 0x3a3428));          // legs
  p.push(colorize(xf(new THREE.BoxGeometry(0.44, 0.6, 0.26), 0, 1.17, 0), 0x6a5a4a));          // shirt
  p.push(colorize(xf(new THREE.BoxGeometry(0.4, 0.75, 0.04), 0, 1.0, 0.14), apron));           // apron
  p.push(colorize(xf(new THREE.SphereGeometry(1, 10, 8), 0, 1.6, 0.02, 0, 0, 0, 0.11, 0.13, 0.12), 0xc49a7a));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 10), 0, 1.72, 0), 0x4a3a2a)); // hat brim
  p.push(colorize(xf(new THREE.CylinderGeometry(0.1, 0.11, 0.12, 10), 0, 1.79, 0), 0x4a3a2a));
  for (const s of [-1, 1]) p.push(colorize(xf(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), s * 0.27, 1.12, 0.1, 0.5, 0, 0), 0x6a5a4a));
  return mergeColored(p);
}
