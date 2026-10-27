// Birds: lightweight state machines for ground birds, waterfowl, waders, perching owls and
// soaring raptors. Flocks flush together. Game birds can be harvested like mammals;
// protected birds (eagles, hawks, owls, herons) cannot.
import * as THREE from 'three';
import { G } from './state.js';
import { SPECIES, BIRD_ORDER, BIRD_POPULATION } from './species.js';
import { createBirdRig, poseWings } from './birdModel.js';
import { animalMaterial } from './animalModel.js';
import { clamp, damp, dampAngle, angleDiff, smoothstep } from './utils.js';
import { PLAY_LIMIT, LAKE, riverX, riverHalfWidth, WATER_LEVEL, lakeRadiusAt } from './terrain.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
let nextId = 1;
const rnd = (a, b) => a + Math.random() * (b - a);

class Bird {
  constructor(mgr, id, male) {
    this.mgr = mgr;
    this.uid = nextId++;
    this.species = id;
    this.sp = SPECIES[id];
    this.b = this.sp.behavior;
    this.m = this.sp.model;
    this.male = male;
    this.rig = createBirdRig(id, male);
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.active = false;
    this.isBird = true;
  }

  get label() { return this.sp.sex[this.male ? 0 : 1]; }
  get stateLabel() { return { ground: 'Feeding', swim: 'Swimming', wade: 'Wading', perch: 'Perched', soar: 'Soaring', fly: 'Flying', down: 'Down' }[this.state]; }
  get awareness() { return this.state === 'fly' ? 1 : 0; }

  spawn(x, z, flock) {
    this.active = true;
    this.flock = flock;
    this.scale = 0.9 + Math.random() * 0.2;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.vy = 0;
    this.phase = Math.random() * 10;
    this.wingOpen = 0;
    this.thinkT = Math.random() * 0.3;
    this.callT = rnd(8, 40);
    this.printAcc = 0;
    this.tagged = false; this.harvest = null; this.popupShown = false; this.fadeAt = 0; this.fadeMat = null;
    this.skinned = false; this.meatTaken = false;
    const st = this.sp.stats;
    const wr = this.male ? st.wM : st.wF;
    this.weight = rnd(wr[0], wr[1]);
    this.age = Math.max(1, Math.round(rnd(1, st.ageMax)));
    const r = this.rig;
    r.root.scale.setScalar(this.scale);
    r.bodyPivot.rotation.set(0, 0, 0);
    r.bodyPivot.position.set(0, 0, 0);
    r.meshes.forEach((me) => { me.material = animalMaterial; });
    this.mgr.scene.add(r.root);
    this.settle(x, z);
  }

  despawn() {
    this.active = false;
    this.mgr.scene.remove(this.rig.root);
    if (this.fadeMat) { this.fadeMat.dispose(); this.fadeMat = null; }
  }

  // Put the bird into its resting mode at (x, z)
  settle(x, z) {
    const T = this.mgr.T, mode = this.b.mode;
    if (mode === 'soar') {
      this.center = { x, z, r: rnd(35, 70) };
      this.angle = Math.random() * 6.28;
      this.pos.set(x, T.getHeight(x, z) + this.b.soarAlt + rnd(-8, 8), z);
      this.setState('soar', rnd(40, 90));
      return;
    }
    if (mode === 'water') {
      const w = this.mgr.waterPoint(x, z);
      this.pos.set(w.x, WATER_LEVEL, w.z);
      this.target.copy(this.pos);
      this.setState('swim', rnd(10, 30));
      return;
    }
    if (mode === 'wade') {
      const w = this.mgr.shorePoint(x, z);
      this.pos.set(w.x, T.getHeight(w.x, w.z), w.z);
      this.setState('wade', rnd(20, 60));
      return;
    }
    if (mode === 'perch' || (this.b.roost && G.env && G.env.daylight < 0.15)) {
      const t = this.mgr.treePerch(x, z, 40);
      if (t) { this.pos.set(t.x, t.y, t.z); this.setState('perch', rnd(30, 90)); return; }
    }
    this.pos.set(x, T.getHeight(x, z), z);
    this.target.copy(this.pos);
    this.setState('ground', rnd(4, 10));
  }

  setState(s, dur = Infinity) { this.state = s; this.stateT = 0; this.stateDur = dur; }

  // Take off and fly to a destination appropriate for the species
  flyTo(x, z, land) {
    x = clamp(x, -PLAY_LIMIT + 10, PLAY_LIMIT - 10);
    z = clamp(z, -PLAY_LIMIT + 10, PLAY_LIMIT - 10);
    const T = this.mgr.T, mode = this.b.mode;
    let tx = x, tz = z, ty;
    land = land || (mode === 'water' ? 'swim' : mode === 'wade' ? 'wade' : mode === 'perch' ? 'perch' : 'ground');
    if (land === 'swim') { const w = this.mgr.waterPoint(x, z); tx = w.x; tz = w.z; ty = WATER_LEVEL; }
    else if (land === 'wade') { const w = this.mgr.shorePoint(x, z); tx = w.x; tz = w.z; ty = T.getHeight(tx, tz); }
    else if (land === 'perch') { const t = this.mgr.treePerch(x, z, 50); if (t) { tx = t.x; tz = t.z; ty = t.y; } else { land = 'ground'; ty = T.getHeight(x, z); } }
    else ty = T.getHeight(x, z);
    this.target.set(tx, ty, tz);
    this.land = land;
    this.setState('fly', 60);
    this.vy = 0;
  }

  flush(fromX, fromZ, propagate = true) {
    if (this.state === 'down' || this.state === 'fly') return;
    if (this.state === 'soar') { // raptors simply drift their circle away
      const a = Math.atan2(this.center.x - fromX, this.center.z - fromZ);
      this.center.x += Math.sin(a) * 60; this.center.z += Math.cos(a) * 60;
      return;
    }
    const a = Math.atan2(this.pos.x - fromX, this.pos.z - fromZ) + rnd(-0.6, 0.6);
    const d = rnd(70, 150);
    this.flyTo(this.pos.x + Math.sin(a) * d, this.pos.z + Math.cos(a) * d);
    if (Math.random() < 0.6) G.audio?.birdCall(this.b.call, this.pos);
    if (propagate && this.flock) {
      for (const o of this.flock.members) {
        if (o === this || !o.active || o.state === 'down') continue;
        const off = rnd(-6, 6);
        o.flyTo(this.target.x + off, this.target.z + rnd(-6, 6), this.land);
        o.stateT = -Math.random() * 0.4;
      }
    }
  }

  think() {
    const P = G.player;
    if (!P || G.sandbox.observerMode) return;
    const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.playerDist = d;
    if (this.state === 'fly' || this.state === 'down' || this.state === 'soar') return;
    let k = P.moving ? (P.sprinting ? 1.5 : P.crouch ? 0.6 : 1) : (P.crouch ? 0.35 : 0.55);
    if (this.state === 'perch') k *= 0.7;
    if (d < this.b.flush * k) this.flush(P.pos.x, P.pos.z);
  }

  update(dt, camDist) {
    this.stateT += dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = camDist < 150 ? 0.25 : 0.8; this.think(); }
    const T = this.mgr.T, b = this.b;
    let flapAmp = 0, open = 0, pitch = 0, roll = 0;
    const night = G.env.daylight < 0.15;

    switch (this.state) {
      case 'ground': {
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.3) {
          this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 4, dt);
          const step = b.walk * dt;
          this.pos.x += Math.sin(this.heading) * step;
          this.pos.z += Math.cos(this.heading) * step;
          this.printAcc += step;
          if (b.print && this.printAcc > Math.max(0.12, this.m.legLen * 1.2) && camDist < 120) {
            this.printAcc = 0;
            this.mgr.tracks?.addPrint(b.print, this.pos.x, this.pos.z, this.heading, this.species, 'b' + this.uid, false);
          }
        } else {
          pitch = Math.sin(this.stateT * 6 + this.uid) > 0.4 ? 0.45 : 0; // pecking
        }
        this.pos.y = T.getHeight(this.pos.x, this.pos.z);
        if (this.stateT > this.stateDur) {
          if (b.roost && night) { this.flyTo(this.pos.x + rnd(-30, 30), this.pos.z + rnd(-30, 30), 'perch'); break; }
          if (b.grazes && Math.random() < 0.3) { this.flyTo(this.pos.x + rnd(-40, 40), this.pos.z + rnd(-40, 40), 'swim'); break; }
          const p = this.mgr.groundPoint(this.species, this.pos.x, this.pos.z, 12);
          this.target.set(p.x, 0, p.z);
          this.setState('ground', rnd(4, 12));
        }
        break;
      }
      case 'swim': {
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
        if (Math.hypot(dx, dz) > 0.3) {
          this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 2, dt);
          this.pos.x += Math.sin(this.heading) * b.walk * 0.6 * dt;
          this.pos.z += Math.cos(this.heading) * b.walk * 0.6 * dt;
        } else if (Math.sin(this.stateT * 0.8 + this.uid) > 0.7) pitch = 1.1; // dabbling
        this.pos.y = WATER_LEVEL - this.m.legLen - this.m.bodyR * 0.35 + Math.sin(this.stateT * 2 + this.uid) * 0.01;
        if (this.stateT > this.stateDur) {
          if (b.grazes && Math.random() < 0.35 && !night) {
            // geese walk up to graze on the bank
            const p = this.mgr.groundPoint(this.species, this.pos.x, this.pos.z, 30);
            this.flyTo(p.x, p.z, 'ground');
            break;
          }
          const w = this.mgr.waterPoint(this.pos.x + rnd(-15, 15), this.pos.z + rnd(-15, 15), true);
          this.target.set(w.x, WATER_LEVEL, w.z);
          this.setState('swim', rnd(8, 25));
        }
        break;
      }
      case 'wade':
        this.pos.y = T.getHeight(this.pos.x, this.pos.z);
        if (Math.sin(this.stateT * 0.5 + this.uid) > 0.93) pitch = 0.9; // strike
        if (this.stateT > this.stateDur) {
          const w = this.mgr.shorePoint(this.pos.x + rnd(-6, 6), this.pos.z + rnd(-6, 6));
          if (Math.hypot(w.x - this.pos.x, w.z - this.pos.z) < 10) { this.pos.set(w.x, T.getHeight(w.x, w.z), w.z); this.heading += rnd(-1, 1); }
          this.setState('wade', rnd(20, 50));
        }
        break;
      case 'perch':
        if (this.stateT > this.stateDur) {
          if (b.roost && !night) { const p = this.mgr.groundPoint(this.species, this.pos.x, this.pos.z, 30); this.flyTo(p.x, p.z, 'ground'); break; }
          if (b.mode === 'perch' && (night || Math.random() < 0.2)) this.flyTo(this.pos.x + rnd(-60, 60), this.pos.z + rnd(-60, 60), 'perch');
          else this.setState('perch', rnd(30, 90));
        }
        if (b.mode === 'perch' && this.state === 'perch') this.heading += Math.sin(this.stateT * 0.3) * dt * 0.3;
        break;
      case 'soar': {
        const c = this.center;
        const v = b.fly * 0.75;
        this.angle += (v / c.r) * dt;
        const nx = c.x + Math.cos(this.angle) * c.r, nz = c.z + Math.sin(this.angle) * c.r;
        this.heading = Math.atan2(nx - this.pos.x, nz - this.pos.z);
        const ty = T.getHeight(c.x, c.z) + b.soarAlt + Math.sin(this.stateT * 0.2) * 6;
        this.pos.set(nx, damp(this.pos.y, ty, 0.5, dt), nz);
        open = 1;
        flapAmp = Math.sin(this.stateT * 0.35 + this.uid) > 0.85 ? 0.55 : 0.04;
        roll = -0.35;
        if (this.stateT > this.stateDur) {
          // drift to a new area, staying near water for eagles
          let nxC = c.x + rnd(-80, 80), nzC = c.z + rnd(-80, 80);
          if (b.water) { const w = this.mgr.waterPoint(nxC, nzC); nxC = w.x; nzC = w.z; }
          c.x = clamp(nxC, -PLAY_LIMIT + 30, PLAY_LIMIT - 30); c.z = clamp(nzC, -PLAY_LIMIT + 30, PLAY_LIMIT - 30);
          c.r = rnd(35, 75);
          this.stateDur = rnd(40, 90);
          this.stateT = 0;
        }
        break;
      }
      case 'fly': {
        if (this.stateT < 0) break;
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
        const hd = Math.hypot(dx, dz);
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 3, dt);
        const cruiseY = Math.max(T.getHeight(this.pos.x, this.pos.z), this.target.y) + (b.cruise || 10);
        const desiredY = hd < 15 ? this.target.y + hd * 0.5 : cruiseY;
        const climb = clamp((desiredY - this.pos.y) * 1.5, -4, 6);
        this.pos.y += climb * dt;
        const v = b.fly * (hd < 12 ? 0.5 : 1) * (this.stateT < 1 ? 0.6 + this.stateT * 0.4 : 1);
        this.pos.x += Math.sin(this.heading) * v * dt;
        this.pos.z += Math.cos(this.heading) * v * dt;
        const ground = T.getHeight(this.pos.x, this.pos.z);
        if (this.pos.y < ground + 0.3 && hd > 3) this.pos.y = ground + 0.3;
        open = 1; flapAmp = hd < 6 ? 0.9 : (climb > 0.5 ? 0.9 : 0.6);
        pitch = -climb * 0.06;
        if (hd < 0.8 && Math.abs(this.pos.y - this.target.y) < 0.6 || this.stateT > this.stateDur) {
          this.pos.copy(this.target);
          if (this.land === 'swim') this.setState('swim', rnd(10, 30));
          else if (this.land === 'wade') this.setState('wade', rnd(20, 50));
          else if (this.land === 'perch') this.setState('perch', rnd(30, 90));
          else { this.target.copy(this.pos); this.setState('ground', rnd(4, 10)); }
        }
        break;
      }
      case 'down':
        this.updateDown(dt);
        break;
    }

    // occasional calls
    this.callT -= dt;
    if (this.callT <= 0 && this.state !== 'down') {
      this.callT = rnd(20, 70);
      const nightCall = b.activity === 'nocturnal';
      if (nightCall === night || b.call === 'honk') G.audio?.birdCall(b.call, this.pos);
    }

    // animation
    if (this.state !== 'down' && camDist < 160) {
      this.wingOpen = damp(this.wingOpen, open, 6, dt);
      const rate = clamp(14 - this.m.wingSpan * 5, 3, 13);
      this.phase += dt * rate;
      poseWings(this.rig, this.wingOpen, Math.sin(this.phase) * flapAmp);
      const bp = this.rig.bodyPivot;
      bp.rotation.x = damp(bp.rotation.x, pitch, 8, dt);
      bp.rotation.z = damp(bp.rotation.z, roll, 3, dt);
      bp.position.y = this.state === 'ground' && pitch === 0 ? Math.abs(Math.sin(this.stateT * 8)) * 0.01 : 0;
    }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.heading;
  }

  updateDown(dt) {
    const T = this.mgr.T;
    const ground = Math.max(T.getHeight(this.pos.x, this.pos.z), WATER_LEVEL - 0.05);
    if (!this.landed) {
      this.vy -= 9.8 * dt;
      this.pos.y += this.vy * dt;
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      this.speed = damp(this.speed, 0, 1, dt);
      this.rig.bodyPivot.rotation.x += dt * 4;
      if (this.pos.y <= ground) { this.pos.y = ground; this.landed = true; this.landT = this.stateT; this.rig.bodyPivot.rotation.x = 0; }
      return;
    }
    const c = smoothstep(0, 0.5, this.stateT - this.landT);
    this.rig.bodyPivot.rotation.z = c * 1.35 * this.downSide;
    this.rig.bodyPivot.position.y = -c * this.m.legLen * 0.6;
    poseWings(this.rig, 0.5 * c, 0.15);
    if (!this.popupShown && this.harvest && this.stateT > this.landT + 1.2) { this.popupShown = true; G.ui?.showHarvest(this); }
    const P = G.player.pos;
    const far = Math.hypot(P.x - this.pos.x, P.z - this.pos.z) > 260;
    if (!this.fadeAt && (this.tagged || far || this.stateT > 900)) this.fadeAt = this.stateT;
    if (this.fadeAt) {
      if (!this.fadeMat) {
        this.fadeMat = animalMaterial.clone();
        this.fadeMat.transparent = true;
        this.rig.meshes.forEach((me) => { me.material = this.fadeMat; });
      }
      this.fadeMat.opacity = clamp(1 - (this.stateT - this.fadeAt) / 1.6, 0, 1);
      if (this.fadeMat.opacity <= 0) this.mgr.release(this);
    }
  }

  hit(part, shooter) {
    if (this.state === 'down') return;
    this.speed = this.state === 'fly' || this.state === 'soar' ? this.b.fly * 0.6 : 0;
    this.vy = 0;
    this.landed = this.state !== 'fly' && this.state !== 'soar' && this.state !== 'perch';
    this.landT = 0;
    this.downSide = Math.random() < 0.5 ? 1 : -1;
    this.setState('down');
    this.fadeAt = 0;
    if (this.flock) for (const o of this.flock.members) if (o !== this && o.active) o.flush(shooter.x, shooter.z, false);
  }

  hitSpheres(out, inflate = 1) {
    const flying = this.state === 'fly' || this.state === 'soar';
    const r = this.m.bodyR * 1.25 * this.scale * inflate * (flying ? 1.8 : 1);
    if (!out[0]) out[0] = { part: 'body', c: new THREE.Vector3(), r: 0 };
    out[0].c.set(this.pos.x, this.pos.y + this.rig.dims.cy * this.scale, this.pos.z);
    out[0].r = r;
    out.length = 1;
    return out;
  }
}

export class BirdManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.T = world.terrain;
    this.veg = world.veg;
    this.tracks = null;
    this.list = [];
    this.pool = {};
    this.population = { ...BIRD_POPULATION };
    this.popTimer = 0;
    this._s = [];
  }

  // --- location helpers ---
  waterPoint(x, z, local = false) {
    const T = this.T;
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    for (let i = 0; i < 12; i++) {
      let px, pz;
      if (!local && dl < 140 && Math.random() < 0.6) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * LAKE.r * 0.75;
        px = LAKE.x + Math.cos(a) * r; pz = LAKE.z + Math.sin(a) * r;
      } else if (local) {
        px = x; pz = z;
        if (T.getHeight(px, pz) < -0.35) return { x: px, z: pz };
        const rz = clamp(z, -PLAY_LIMIT + 10, PLAY_LIMIT - 10);
        px = riverX(rz) + (Math.random() - 0.5) * riverHalfWidth(rz) * 0.9; pz = rz;
        if (dl < LAKE.r + 10) { const a = Math.random() * 6.28, r = Math.random() * LAKE.r * 0.7; px = LAKE.x + Math.cos(a) * r; pz = LAKE.z + Math.sin(a) * r; }
      } else {
        pz = clamp(z + (Math.random() - 0.5) * 80, -PLAY_LIMIT + 10, PLAY_LIMIT - 10);
        px = riverX(pz) + (Math.random() - 0.5) * riverHalfWidth(pz) * 0.9;
      }
      if (T.getHeight(px, pz) < -0.35) return { x: px, z: pz };
    }
    return { x: LAKE.x, z: LAKE.z };
  }

  shorePoint(x, z) {
    const T = this.T;
    for (let i = 0; i < 12; i++) {
      const pz = clamp(z + (Math.random() - 0.5) * 60, -PLAY_LIMIT + 10, PLAY_LIMIT - 10);
      const side = Math.random() < 0.5 ? -1 : 1;
      const px = riverX(pz) + side * (riverHalfWidth(pz) - 0.5);
      const h = T.getHeight(px, pz);
      if (h > -0.45 && h < 0.1) return { x: px, z: pz };
    }
    const a = Math.random() * 6.28;
    const rs = lakeRadiusAt(a) - 1;
    return { x: LAKE.x + Math.cos(a) * rs, z: LAKE.z + Math.sin(a) * rs };
  }

  treePerch(x, z, radius) {
    const trees = [];
    this.veg.forEachNear(x, z, radius, (it) => { if (it.kind === 'tree') trees.push(it); });
    if (!trees.length) return null;
    const t = trees[Math.floor(Math.random() * trees.length)];
    return { x: t.x + 0.4, z: t.z, y: this.T.getHeight(t.x, t.z) + t.h * 1.25 };
  }

  habitat(id, x, z) {
    const T = this.T;
    const h = T.getHeight(x, z);
    if (h < 0.35 || Math.abs(x) > PLAY_LIMIT - 10 || Math.abs(z) > PLAY_LIMIT - 10) return 0;
    const f = T.densityAt(x, z);
    switch (id) {
      case 'turkey': return 1 - Math.abs(f - 0.35) * 1.6;
      case 'grouse': return f;
      case 'pigeon': {
        let near = 0;
        for (const r of this.world.restSpots) near = Math.max(near, smoothstep(70, 15, Math.hypot(x - r.x, z - r.z)));
        return near * (1 - f);
      }
      case 'dove': case 'crow': return 1 - f;
      case 'owl': return f;
      default: return 0.5;
    }
  }

  groundPoint(id, x, z, range) {
    let best = { x, z }, bs = -1;
    for (let i = 0; i < 6; i++) {
      const px = x + (Math.random() - 0.5) * range * 2, pz = z + (Math.random() - 0.5) * range * 2;
      const s = this.habitat(id, px, pz) + Math.random() * 0.2;
      if (s > bs && this.T.getHeight(px, pz) > 0.35) { bs = s; best = { x: px, z: pz }; }
    }
    return best;
  }

  findSpawn(id, minDist = 80) {
    const P = G.player ? G.player.pos : new THREE.Vector3();
    const mode = SPECIES[id].behavior.mode;
    if (mode === 'water' || mode === 'wade' || (mode === 'soar' && SPECIES[id].behavior.water)) {
      for (let i = 0; i < 10; i++) {
        const w = Math.random() < 0.5 ? this.waterPoint(LAKE.x, LAKE.z) : this.waterPoint(rnd(-150, 150), rnd(-180, 180));
        if (Math.hypot(w.x - P.x, w.z - P.z) > minDist) return w;
      }
      return this.waterPoint(LAKE.x, LAKE.z);
    }
    let best = null, bs = -1;
    for (let i = 0; i < 30; i++) {
      const x = rnd(-PLAY_LIMIT + 15, PLAY_LIMIT - 15), z = rnd(-PLAY_LIMIT + 15, PLAY_LIMIT - 15);
      if (Math.hypot(x - P.x, z - P.z) < minDist) continue;
      const s = (mode === 'soar' ? 0.5 : this.habitat(id, x, z)) + Math.random() * 0.25;
      if (s > bs) { bs = s; best = { x, z }; }
    }
    return best;
  }

  // --- spawning and pooling ---
  acquire(id, male) {
    const key = id + (male ? 'm' : 'f');
    const arr = this.pool[key] || (this.pool[key] = []);
    return arr.pop() || new Bird(this, id, male);
  }

  release(bd) {
    bd.despawn();
    const i = this.list.indexOf(bd);
    if (i >= 0) this.list.splice(i, 1);
    if (bd.flock) bd.flock.members = bd.flock.members.filter((m) => m !== bd);
    const key = bd.species + (bd.male ? 'm' : 'f');
    (this.pool[key] || (this.pool[key] = [])).push(bd);
  }

  spawnGroup(id, x, z, count) {
    const fl = SPECIES[id].behavior.flock;
    const n = count || Math.round(rnd(fl[0], fl[1]));
    const flock = n > 1 ? { members: [] } : null;
    for (let i = 0; i < n; i++) {
      const bd = this.acquire(id, Math.random() < 0.5);
      bd.spawn(x + rnd(-4, 4), z + rnd(-4, 4), flock);
      if (flock) flock.members.push(bd);
      this.list.push(bd);
    }
  }

  initialSpawn() {
    // a few pigeons around the cabin and turkeys in the West Meadow to meet early on
    this.spawnGroup('pigeon', -30, -60, 6);
    this.spawnGroup('turkey', -80, 0, 5);
    for (const id of BIRD_ORDER) {
      let guard = 0;
      while (this.count(id) < this.population[id] && guard++ < 10) {
        const p = this.findSpawn(id);
        if (!p) break;
        const fl = SPECIES[id].behavior.flock;
        this.spawnGroup(id, p.x, p.z, Math.min(this.population[id] - this.count(id), Math.round(rnd(fl[0], fl[1]))));
      }
    }
  }

  count(id) { let c = 0; for (const b of this.list) if (b.species === id && b.state !== 'down') c++; return c; }

  spawnNear(id, pos, yaw) {
    const d = 20;
    const x = clamp(pos.x - Math.sin(yaw) * d, -PLAY_LIMIT + 5, PLAY_LIMIT - 5), z = clamp(pos.z - Math.cos(yaw) * d, -PLAY_LIMIT + 5, PLAY_LIMIT - 5);
    this.spawnGroup(id, x, z, SPECIES[id].behavior.flock[0]);
  }

  setPopulation(id, n) { this.population[id] = n; }
  clearAll() { for (const b of [...this.list]) this.release(b); }

  nearest(ids, x, z, maxD, filter) {
    let best = null, bd = maxD;
    for (const b of this.list) {
      if (!ids.includes(b.species) || (filter && !filter(b))) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  soundEvent(x, z, radius, kind) {
    for (const b of this.list) {
      if (b.state === 'down') continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (kind === 'shot' && d < Math.min(radius, 170)) b.flush(x, z, true);
      else if (kind === 'impact' && d < 25) b.flush(x, z, true);
    }
  }

  raycast(origin, dir, maxDist, inflate = 1) {
    let best = null;
    for (const b of this.list) {
      if (!b.active || (b.state === 'down' && inflate === 1)) continue;
      const s = b.hitSpheres(this._s, inflate)[0];
      _v.subVectors(s.c, origin);
      const t = _v.dot(dir);
      if (t < -s.r || t > maxDist + s.r) continue;
      _v2.copy(origin).addScaledVector(dir, t);
      const d2 = _v2.distanceToSquared(s.c);
      if (d2 > s.r * s.r) continue;
      const th = Math.max(0, t - Math.sqrt(s.r * s.r - d2));
      if (th <= maxDist && (!best || th < best.dist)) best = { animal: b, part: 'body', dist: th };
    }
    return best;
  }

  update(dt) {
    const cam = G.camera.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const cd = Math.hypot(b.pos.x - cam.x, b.pos.z - cam.z);
      b.update(dt, cd);
      const big = b.m.wingSpan > 1.2 || b.state === 'soar';
      b.rig.root.visible = cd < (big ? 420 : 150);
    }
    this.popTimer -= dt;
    if (this.popTimer <= 0) {
      this.popTimer = 4;
      for (const id of BIRD_ORDER) {
        const c = this.count(id), t = this.population[id];
        if (c < t) {
          const p = this.findSpawn(id, 100);
          if (p) this.spawnGroup(id, p.x, p.z, Math.min(t - c, Math.round(rnd(...SPECIES[id].behavior.flock))));
        } else if (c > t) {
          let far = null, fd = -1;
          for (const b of this.list) { if (b.species !== id || b.state === 'down') continue; const d = Math.hypot(b.pos.x - cam.x, b.pos.z - cam.z); if (d > fd) { fd = d; far = b; } }
          if (far) this.release(far);
        }
      }
    }
  }
}
