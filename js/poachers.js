// Hostile poachers: patrol the woods, investigate gunshots and shoot at the player on sight.
// When hit they drop their rifle and run off (no graphic violence) and leave the area.
import * as THREE from 'three';
import { G } from './state.js';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween } from './geo.js';
import { clamp, damp, dampAngle } from './utils.js';
import { PLAY_LIMIT } from './terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _push = { x: 0, z: 0 };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const material = new THREE.MeshLambertMaterial({ vertexColors: true });

let geo = null;
function buildGeometry() {
  if (geo) return geo;
  const camo = 0x3e4430, camo2 = 0x2e3324, skin = 0xc49a7a, boots = 0x2a2420, cap = 0x2a2e22;
  const body = [];
  body.push(colorize(xf(new THREE.BoxGeometry(0.44, 0.62, 0.26), 0, 1.26, 0), camo));
  body.push(colorize(xf(new THREE.BoxGeometry(0.46, 0.12, 0.28), 0, 0.98, 0), camo2));
  body.push(ellipsoid(0, 1.68, 0.02, 0.11, 0.13, 0.12, skin, 10, 8));
  body.push(colorize(xf(new THREE.CylinderGeometry(0.125, 0.125, 0.08, 10), 0, 1.79, 0), cap));
  body.push(colorize(xf(new THREE.BoxGeometry(0.2, 0.02, 0.14), 0, 1.76, 0.12), cap));
  body.push(colorize(xf(new THREE.BoxGeometry(0.3, 0.38, 0.12), 0, 1.3, -0.17), 0x4a4030)); // backpack
  // arms holding the rifle across the chest
  body.push(cylinderBetween(V(0.24, 1.5, 0), V(0.2, 1.22, 0.22), 0.055, 0.05, 6, camo));
  body.push(cylinderBetween(V(-0.24, 1.5, 0), V(-0.05, 1.3, 0.34), 0.055, 0.05, 6, camo));
  body.push(ellipsoid(0.2, 1.2, 0.26, 0.05, 0.05, 0.05, skin, 6, 5));
  body.push(ellipsoid(-0.04, 1.3, 0.38, 0.05, 0.05, 0.05, skin, 6, 5));
  const leg = [];
  leg.push(colorize(xf(new THREE.BoxGeometry(0.16, 0.86, 0.18), 0, -0.43, 0), camo2));
  leg.push(colorize(xf(new THREE.BoxGeometry(0.17, 0.1, 0.28), 0, -0.88, 0.05), boots));
  const rifle = [];
  rifle.push(colorize(xf(new THREE.BoxGeometry(0.05, 0.08, 0.5), 0, 0, -0.05), 0x4a3020));
  rifle.push(colorize(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), 0, 0.03, 0.45, Math.PI / 2, 0, 0), 0x222222));
  geo = { body: mergeColored(body), leg: mergeColored(leg), rifle: mergeColored(rifle) };
  return geo;
}

class Poacher {
  constructor(mgr) {
    this.mgr = mgr;
    const g = buildGeometry();
    this.root = new THREE.Group();
    this.body = new THREE.Mesh(g.body, material);
    this.legs = [new THREE.Mesh(g.leg, material), new THREE.Mesh(g.leg, material)];
    this.legs[0].position.set(0.11, 0.95, 0); this.legs[1].position.set(-0.11, 0.95, 0);
    this.rifle = new THREE.Mesh(g.rifle, material);
    this.root.add(this.body, ...this.legs, this.rifle);
    [this.body, ...this.legs, this.rifle].forEach((m) => { m.castShadow = true; });
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.lastSeen = new THREE.Vector3();
  }

  spawn(x, z) {
    this.active = true;
    this.pos.set(x, this.mgr.T.getHeight(x, z), z);
    this.heading = Math.random() * 6.28;
    this.state = 'patrol';
    this.stateT = 0;
    this.alert = 0;
    this.aimT = 0;
    this.cool = 0;
    this.phase = 0;
    this.speed = 0;
    this.thinkT = Math.random() * 0.4;
    this.armed = true;
    this.rifle.position.set(0.08, 1.26, 0.28);
    this.rifle.rotation.set(-0.15, 0.25, 0);
    this.root.rotation.set(0, 0, 0);
    this.pickPatrol();
    this.mgr.scene.add(this.root);
  }

  despawn() { this.active = false; this.mgr.scene.remove(this.root); this.droppedRifle = null; }

  pickPatrol() {
    const a = Math.random() * 6.28, d = rnd(40, 90);
    this.target.set(clamp(this.pos.x + Math.sin(a) * d, -PLAY_LIMIT + 15, PLAY_LIMIT - 15), 0, clamp(this.pos.z + Math.cos(a) * d, -PLAY_LIMIT + 15, PLAY_LIMIT - 15));
  }

  eye(out) { return out.set(this.pos.x, this.pos.y + 1.65, this.pos.z); }

  canSee() {
    const P = G.player;
    const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    const range = 115 * P.visibility * G.env.visibilityFactor() * (1 - G.world.terrain.densityAt(P.pos.x, P.pos.z) * 0.4);
    if (d > range) return false;
    this.eye(_o);
    _d.subVectors(P.eye, _o);
    const dist = _d.length();
    _d.divideScalar(dist);
    const block = G.world.raycastStatic(_o, _d, dist - 0.5);
    return block < 0;
  }

  think(dt) {
    const P = G.player;
    if (!this.armed || G.sandbox.observerMode || P.inCabinSafe) { this.alert = Math.max(0, this.alert - dt * 0.5); return; }
    const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.playerDist = d;
    const sees = d < 140 && this.canSee();
    const hears = d < 55 * P.noise;
    if (sees) {
      this.alert = Math.min(1.5, this.alert + dt * (1.4 - d / 140) * 1.4);
      this.lastSeen.copy(P.pos);
    } else if (hears) {
      this.alert = Math.min(1.5, this.alert + dt * 0.6);
      this.lastSeen.copy(P.pos);
    } else this.alert = Math.max(0, this.alert - dt * 0.15);
    if (this.alert >= 1 && sees && this.state !== 'engage') {
      this.state = 'engage'; this.stateT = 0; this.aimT = rnd(2.0, 3.0);
      G.ui?.toast('A poacher has spotted you! Break line of sight — get behind trees, rocks or into a cabin.', 'warn');
      G.audio?.shout(this.pos);
    } else if (this.state === 'engage' && !sees && this.stateT > 1.5) {
      this.state = 'search'; this.stateT = 0; this.target.copy(this.lastSeen);
    } else if (this.alert > 0.4 && this.state === 'patrol') {
      this.state = 'search'; this.stateT = 0; this.target.copy(this.lastSeen);
    }
    this.sees = sees;
  }

  hearShot(x, z) {
    if (!this.armed || this.state === 'engage') return;
    this.state = 'search'; this.stateT = 0;
    this.target.set(x + rnd(-10, 10), 0, z + rnd(-10, 10));
    this.alert = Math.max(this.alert, 0.5);
  }

  shoot() {
    const P = G.player;
    const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    G.audio?.distantShot(this.pos);
    G.animals?.soundEvent(this.pos.x, this.pos.z, 380, 'shot');
    G.birds?.soundEvent(this.pos.x, this.pos.z, 380, 'shot');
    let p = clamp(0.6 - d / 120, 0.06, 0.45);
    if (P.moving) p *= P.sprinting ? 0.5 : 0.75;
    if (P.crouch) p *= 0.75;
    p *= G.env.visibilityFactor() * (G.cfg ? G.cfg.poacherAcc : 1);
    if (Math.random() < p) {
      const dmg = Math.round(rnd(10, 18) * (d < 25 ? 1.25 : 1));
      G.survival?.damage(dmg * (G.cfg ? G.cfg.poacherDmg : 1), this.pos, 'Shot by a poacher');
    } else {
      G.audio?.whiz();
    }
  }

  surrender() {
    if (!this.armed) return;
    this.armed = false;
    this.state = 'surrender';
    this.stateT = 0;
    // the rifle falls to the ground and stays there
    this.root.remove(this.rifle);
    const r = this.rifle.clone();
    r.position.set(this.pos.x + 0.4, this.mgr.T.getHeight(this.pos.x + 0.4, this.pos.z) + 0.04, this.pos.z);
    r.rotation.set(0, Math.random() * 6, Math.PI / 2);
    this.mgr.scene.add(r);
    this.droppedRifle = r;
    this.mgr.drops.push({ mesh: r, x: r.position.x, z: r.position.z });
    G.stats.poachers = (G.stats.poachers || 0) + 1;
    G.journal.push({ type: 'poacher', species: null, time: G.env.time, day: G.env.day, weather: G.env.weatherName });
    G.ui?.toast('The poacher drops their rifle, raises their hands and flees the area.', 'good');
  }

  update(dt) {
    this.stateT += dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.think(0.35); this.thinkT = 0.35; }
    const P = G.player, T = this.mgr.T;
    let speed = 0, face = null;
    switch (this.state) {
      case 'patrol': {
        speed = 1.3;
        if (Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 2 || this.stateT > 70) { this.pickPatrol(); this.stateT = 0; }
        break;
      }
      case 'search': {
        speed = 2.2;
        if (Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 2.5 || this.stateT > 25) { this.state = 'patrol'; this.stateT = 0; this.pickPatrol(); }
        break;
      }
      case 'engage': {
        face = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
        this.aimT -= dt;
        if (this.aimT <= 0 && this.sees) { this.shoot(); this.aimT = rnd(2.6, 4.0); }
        // close in slowly when far away
        if (this.playerDist > 70) { speed = 1.6; this.target.copy(P.pos); }
        break;
      }
      case 'surrender':
        if (this.stateT > 2.2) { this.state = 'flee'; this.stateT = 0; const a = Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z); this.target.set(this.pos.x + Math.sin(a) * 200, 0, this.pos.z + Math.cos(a) * 200); }
        break;
      case 'flee':
        speed = 5.5;
        if (this.stateT > 25 || Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z) > 160) { this.mgr.release(this); return; }
        break;
    }
    if (speed > 0) {
      const want = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
      this.heading = dampAngle(this.heading, face ?? want, 4, dt);
      this.pos.x += Math.sin(want) * speed * dt;
      this.pos.z += Math.cos(want) * speed * dt;
      G.world.collide(this.pos.x, this.pos.z, 0.35, _push);
      this.pos.x = clamp(_push.x, -PLAY_LIMIT, PLAY_LIMIT); this.pos.z = clamp(_push.z, -PLAY_LIMIT, PLAY_LIMIT);
      if (T.getHeight(this.pos.x, this.pos.z) < -0.4) this.pickPatrol();
    } else if (face !== null) this.heading = dampAngle(this.heading, face, 6, dt);
    this.pos.y = T.getHeight(this.pos.x, this.pos.z);
    this.speed = damp(this.speed, speed, 6, dt);
    this.phase += dt * this.speed * 3.2;
    const sw = Math.sin(this.phase) * Math.min(0.6, this.speed * 0.25);
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    this.body.rotation.x = this.state === 'engage' ? 0.08 : 0;
    if (this.state === 'surrender') this.body.position.y = Math.sin(this.stateT * 10) * 0.01;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
  }

  hitSpheres(out) {
    if (!out[0]) { out[0] = { part: 'body', c: new THREE.Vector3(), r: 0.32 }; out[1] = { part: 'head', c: new THREE.Vector3(), r: 0.14 }; }
    out[0].c.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
    out[1].c.set(this.pos.x, this.pos.y + 1.68, this.pos.z);
    out.length = 2;
    return out;
  }
}

export class PoacherManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.T = world.terrain;
    this.list = [];
    this.drops = [];   // rifles dropped by poachers that the player can pick up
    this.pool = [];
    this.target = 2;
    this.respawnT = 40;
    this._s = [];
  }

  get enabled() { return G.sandbox.poachers !== false; }

  spawnOne() {
    const P = G.player.pos;
    for (let i = 0; i < 30; i++) {
      const x = rnd(-PLAY_LIMIT + 20, PLAY_LIMIT - 20), z = rnd(-PLAY_LIMIT + 20, PLAY_LIMIT - 20);
      if (Math.hypot(x - P.x, z - P.z) < 170) continue;
      if (this.T.getHeight(x, z) < 0.5) continue;
      if (this.world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 70)) continue;
      const p = this.pool.pop() || new Poacher(this);
      p.spawn(x, z);
      this.list.push(p);
      return p;
    }
    return null;
  }

  release(p) {
    p.despawn();
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    this.pool.push(p);
    this.respawnT = 180 + Math.random() * 120;
  }

  clearAll() { for (const p of [...this.list]) this.release(p); }

  hearShot(x, z) {
    for (const p of this.list) if (Math.hypot(p.pos.x - x, p.pos.z - z) < 260) p.hearShot(x, z);
  }

  raycast(origin, dir, maxDist) {
    let best = null;
    for (const p of this.list) {
      if (!p.armed) continue;
      for (const s of p.hitSpheres(this._s)) {
        _v.subVectors(s.c, origin);
        const t = _v.dot(dir);
        if (t < -s.r || t > maxDist + s.r) continue;
        _v2.copy(origin).addScaledVector(dir, t);
        const d2 = _v2.distanceToSquared(s.c);
        if (d2 > s.r * s.r) continue;
        const th = Math.max(0, t - Math.sqrt(s.r * s.r - d2));
        if (th <= maxDist && (!best || th < best.dist)) best = { poacher: p, dist: th };
      }
    }
    return best;
  }

  update(dt) {
    if (!this.enabled) { if (this.list.length) this.clearAll(); return; }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.update(dt);
      if (p.active) p.root.visible = Math.hypot(p.pos.x - G.camera.position.x, p.pos.z - G.camera.position.z) < 260;
    }
    this.target = G.cfg ? G.cfg.poachers : 2;
    const armed = this.list.filter((p) => p.armed).length;
    if (armed < this.target) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.spawnOne(); this.respawnT = 120 + Math.random() * 120; }
    }
  }

  takeDrop(d) {
    this.scene.remove(d.mesh);
    this.drops = this.drops.filter((x) => x !== d);
  }

  // markers of poachers currently engaging (for the HUD)
  threats() { return this.list.filter((p) => p.state === 'engage' && p.armed); }
}
