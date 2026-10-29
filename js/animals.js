// Wildlife: lightweight state-machine AI, perception (sight / hearing / scent), herds and packs,
// predator-prey interactions (non-lethal), object pooling and population management.
import * as THREE from 'three';
import { G } from './state.js';
import { SPECIES, MAMMAL_ORDER as SPECIES_ORDER, DEFAULT_POPULATION, PREDATORS_OF } from './species.js';
import { createAnimalRig, animalMaterial } from './animalModel.js';
import { clamp, lerp, damp, dampAngle, angleDiff, smoothstep } from './utils.js';
import { PLAY_LIMIT, MEADOWS, riverDistance } from './terrain.js';

export const S = {
  IDLE: 'idle', WANDER: 'wander', GRAZE: 'graze', REST: 'rest', DRINK: 'drink', ALERT: 'alert',
  FLEE: 'flee', HIDE: 'hide', FREEZE: 'freeze', STALK: 'stalk', CHASE: 'chase', CHARGE: 'charge', DOWN: 'down', ATTACK: 'attack',
};

export const STATE_LABEL = {
  idle: 'Standing', wander: 'Moving', graze: 'Feeding', rest: 'Bedded down', drink: 'Drinking', alert: 'Alert',
  flee: 'Fleeing', hide: 'Hiding', freeze: 'Frozen still', stalk: 'Stalking', chase: 'Chasing', charge: 'Bluff charge', down: 'Down', attack: 'Attacking',
};

// Animals that may attack the player. 'hunt': predators that come for you; 'defend': animals
// that attack when surprised at close range. dmg = health lost per hit, rate = seconds between hits.
// nightHunt: a defensive animal that turns predator after dark (chance like a hunter's).
const ATTACK = {
  wolf:   { mode: 'hunt',   range: 55, dmg: [8, 14],  rate: 1.0, chance: 0.08, pack: true },
  cougar: { mode: 'hunt',   range: 40, dmg: [15, 26], rate: 1.3, chance: 0.07 },
  coyote: { mode: 'hunt',   range: 25, dmg: [5, 9],   rate: 1.0, chance: 0.03, pack: true },
  bear:   { mode: 'defend', range: 20, dmg: [20, 32], rate: 1.5, chance: 0.65, nightHunt: 0.035 },
  boar:   { mode: 'defend', range: 13, dmg: [9, 16],  rate: 1.1, chance: 0.6 },
  moose:  { mode: 'defend', range: 12, dmg: [12, 22], rate: 1.4, chance: 0.4 },
  bison:  { mode: 'defend', range: 10, dmg: [12, 24], rate: 1.6, chance: 0.3 },
};
// Predators that roam in greater numbers after dark
const NIGHT_PREDATORS = ['wolf', 'cougar', 'coyote', 'bear'];
// Most animals will not attack into the light of a lit campfire
const FIRE_SAFE = 14;
function nearFire(P) {
  for (const f of G.world?.fires || []) if (f.lit && Math.hypot(f.x - P.pos.x, f.z - P.pos.z) < FIRE_SAFE) return true;
  return false;
}
let skinnedMat = null, bloodGeo = null, bloodMat = null;
const _eyeA = new THREE.Vector3(), _dirA = new THREE.Vector3();
const BAIT_EATERS = ['deer', 'elk', 'moose', 'boar', 'bear', 'bison', 'pronghorn', 'bighorn', 'rabbit'];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _push = { x: 0, z: 0 };
let nextId = 1;
let nextNid = 1; // network id (PvP): stable across all players' games

// The player an animal reacts to: in PvP the host's game considers every player and picks the
// nearest living one (an attacking animal sticks to its victim).
function nearestPlayer(a) {
  const net = G.net;
  if (!net || !net.isHost) return G.player;
  const keep = a.state === S.ATTACK ? a.P : null;
  if (keep && !isDead(keep) && (keep === G.player || net.players.has(keep.id))) return keep;
  let best = G.survival?.dead ? null : G.player;
  let bd = best ? Math.hypot(G.player.pos.x - a.pos.x, G.player.pos.z - a.pos.z) : Infinity;
  for (const p of net.players.values()) {
    if (p.dead || !p.seen) continue;
    const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best || G.player;
}
function isDead(P) { return P === G.player ? !!G.survival?.dead : !!P.dead; }

function habitat(id, x, z, T) {
  const f = T.densityAt(x, z);
  const h = T.getHeight(x, z);
  if (h < 0.4 || Math.abs(x) > PLAY_LIMIT - 8 || Math.abs(z) > PLAY_LIMIT - 8) return 0;
  const rd = riverDistance(x, z);
  const nearWater = smoothstep(60, 5, rd);
  const ridge = smoothstep(100, 30, Math.hypot(x + 150, z + 130));
  switch (id) {
    case 'deer': return clamp(1 - Math.abs(f - 0.4) * 1.7, 0, 1) * 0.9 + nearWater * 0.1;
    case 'elk': {
      let m = 0;
      for (const mm of MEADOWS) m = Math.max(m, smoothstep(mm.r * 1.4, mm.r * 0.3, Math.hypot(x - mm.x, z - mm.z)));
      return clamp((1 - f) * 0.5 + m * 0.6 - ridge * 0.3, 0, 1);
    }
    case 'boar': return clamp(f * 0.8 + nearWater * 0.35 - ridge * 0.2, 0, 1);
    case 'rabbit': return clamp((1 - f) * 0.7 + (f > 0.1 && f < 0.5 ? 0.3 : 0), 0, 1);
    case 'fox': return clamp(1 - Math.abs(f - 0.35) * 1.5, 0, 1);
    case 'wolf': return clamp(f * 0.6 + ridge * 0.5 + 0.1, 0, 1);
    case 'moose': return clamp(nearWater * 0.6 + f * 0.4 - ridge * 0.2, 0, 1);
    case 'bear': return clamp(f * 0.8 + 0.1, 0, 1);
    case 'cougar': return clamp(ridge * 0.6 + f * 0.4, 0, 1);
    case 'coyote': return clamp(1 - Math.abs(f - 0.25) * 1.4, 0, 1);
    case 'raccoon': return clamp(nearWater * 0.7 + f * 0.3, 0, 1);
    case 'bison':
    case 'pronghorn': {
      let m = 0;
      for (const mm of MEADOWS) m = Math.max(m, smoothstep(mm.r * 1.4, mm.r * 0.3, Math.hypot(x - mm.x, z - mm.z)));
      return clamp((1 - f) * (id === 'pronghorn' ? 0.6 : 0.35) + m * 0.75 - ridge * 0.4, 0, 1);
    }
    case 'bighorn': return clamp(ridge * 0.8 + smoothstep(14, 32, h) * 0.6 - f * 0.2, 0, 1);
    case 'lynx': return clamp(f * 0.6 + ridge * 0.4, 0, 1);
    case 'badger': return clamp((1 - f) * 0.8, 0, 1);
    default: return 0.5;
  }
}

class Animal {
  constructor(manager, speciesId, male) {
    this.m = manager;
    this.id = nextId++;
    this.species = speciesId;
    this.sp = SPECIES[speciesId];
    // a little slower than real life, so a hunter on foot has a chance
    this.b = { ...this.sp.behavior, run: this.sp.behavior.run * 0.72 };
    this.male = male;
    this.rig = createAnimalRig(speciesId, male);
    this.rig.root.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3();
    this.active = false;
  }

  spawn(x, z, group) {
    this.active = true;
    this.nid = nextNid++;
    this.m.byNid.set(this.nid, this);
    this.P = G.player;
    this.pos.set(x, this.m.T.getHeight(x, z), z);
    this.heading = Math.random() * Math.PI * 2;
    this.desired = this.heading;
    this.avoid = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.awareness = 0;
    this.threat = { x: 0, z: 0, kind: null, ref: null };
    this.playerDist = 999;
    this.group = group;
    this.target = { x, z };
    this.thirst = Math.random() * 0.8;
    this.energy = 0.5 + Math.random() * 0.5;
    this.phase = Math.random() * 10;
    this.printAcc = 0;
    this.printSide = 1;
    this.thinkT = Math.random() * 0.3;
    this.cooldown = 20 + Math.random() * 40;
    this.charged = false;
    this.scale = 0.9 + Math.random() * 0.2;
    this.headPitch = 0; this.headYaw = 0; this.tailAngle = 0; this.restAmt = 0;
    this.breathT = Math.random() * 6; this.exert = 0; this.lean = 0; this.prevHeading = 0; this.nod = 0; this.fidget = null; this.fidgetCd = 2 + Math.random() * 6;
    this.downSide = 1;
    this.fadeMat = null;
    this.identifyT = 0;
    this.hidden = false;
    this.callT = 10 + Math.random() * 40;
    // individual measurements (used by the harvest card and carcass inspection)
    const st = this.sp.stats;
    const wr = this.male ? st.wM : st.wF;
    const k = Math.min(1, Math.max(0, (this.scale - 0.9) / 0.2));
    this.age = Math.max(1, Math.round(1 + Math.random() * (st.ageMax - 1) * (0.4 + k * 0.6)));
    this.weight = wr[0] + (wr[1] - wr[0]) * Math.min(1, k * 0.7 + Math.random() * 0.3);
    this.tagged = false; this.harvest = null; this.popupShown = false;
    this.skinned = false; this.meatTaken = false; this.wounded = false; this.knifeHits = 0;
    this.prey = null;
    const r = this.rig;
    r.root.scale.setScalar(this.scale);
    r.bodyPivot.position.set(0, 0, 0);
    r.bodyPivot.rotation.set(0, 0, 0);
    r.meshes.forEach((me) => { me.material = animalMaterial; });
    r.root.visible = true;
    this.m.scene.add(r.root);
    this.setState(S.IDLE, 2 + Math.random() * 4);
    this.syncTransform();
  }

  despawn() {
    this.active = false;
    this.m.scene.remove(this.rig.root);
    if (this.fadeMat) { this.fadeMat.dispose(); this.fadeMat = null; }
    if (this.blood) { this.m.scene.remove(this.blood); this.blood = null; }
  }

  get label() { return this.sp.sex[this.male ? 0 : 1]; }
  get stateLabel() { return STATE_LABEL[this.state]; }
  get leader() { return this.group ? this.group.leader : null; }
  get radius() { return this.sp.model.bodyW * 0.6 * this.scale; }

  setState(s, dur = Infinity) {
    this.state = s;
    this.stalking = false;
    this.stateT = 0;
    this.stateDur = dur;
  }

  pickActivity() {
    const env = G.env, h = env.time, b = this.b;
    if (this.species === 'rabbit') this.thirst = 0; // cottontails get their water from food and dew
    // bait piles draw herbivores in
    if (BAIT_EATERS.includes(this.species) && G.world.baits && G.world.baits.length) {
      const bt = G.world.nearestBait(this.pos.x, this.pos.z, 170);
      if (bt && Math.random() < 0.6) {
        if (Math.hypot(bt.x - this.pos.x, bt.z - this.pos.z) < 3) { this.target.x = this.pos.x; this.target.z = this.pos.z; this.setState(S.GRAZE, 25 + Math.random() * 30); return; }
        this.target.x = bt.x + (Math.random() - 0.5) * 2; this.target.z = bt.z + (Math.random() - 0.5) * 2;
        this.setState(S.WANDER, 90);
        return;
      }
    }
    if (this.thirst > 1) {
      const spot = this.m.T.nearestDrinkSpot(this.pos.x, this.pos.z);
      if (spot.d < 160) {
        this.target.x = spot.x; this.target.z = spot.z;
        this.setState(S.DRINK, 90);
        this.drinking = false;
        return;
      }
      this.thirst = 0;
    }
    let rest = 0.12, graze = 0.4, wander = 0.33, idle = 0.12;
    const dawnDusk = (h > 5 && h < 9) || (h > 17 && h < 21);
    const night = h < 5 || h > 21;
    if (b.activity === 'crepuscular') {
      if (dawnDusk) { graze += 0.2; wander += 0.1; }
      if (h > 11 && h < 15) rest += 0.35;
      if (night) rest += 0.3;
    } else if (b.activity === 'diurnal') {
      if (night || h < 6 || h > 20) rest += 0.7;
      if (h > 12 && h < 14) rest += 0.2;
    } else if (b.activity === 'nocturnal') {
      if (h > 8 && h < 17) rest += 0.45;
      if (night || dawnDusk) wander += 0.25;
    }
    if (this.energy < 0.2) rest += 0.8;
    if (b.predator) { wander += graze * 0.6; graze *= 0.4; }
    const L = this.leader;
    if (L && L !== this && L.active && L.state !== S.DOWN) {
      // followers mirror the leader's activity
      if (L.state === S.REST) rest += 1.0;
      if (L.state === S.GRAZE) graze += 0.6;
      const dl = Math.hypot(L.pos.x - this.pos.x, L.pos.z - this.pos.z);
      if (dl > 14) { this.wanderNear(L.pos.x, L.pos.z, 8); return; }
      wander *= 0.4;
    }
    const total = rest + graze + wander + idle;
    let r = Math.random() * total;
    if ((r -= rest) < 0) { this.setState(S.REST, 25 + Math.random() * 50); return; }
    if ((r -= graze) < 0) { this.setState(S.GRAZE, 12 + Math.random() * 25); this.target.x = this.pos.x; this.target.z = this.pos.z; return; }
    if ((r -= wander) < 0) { this.pickWanderTarget(); return; }
    this.setState(S.IDLE, 3 + Math.random() * 6);
  }

  wanderNear(x, z, spread) {
    const a = Math.random() * Math.PI * 2;
    this.target.x = x + Math.cos(a) * spread * Math.random();
    this.target.z = z + Math.sin(a) * spread * Math.random();
    this.setState(S.WANDER, 30);
  }

  pickWanderTarget() {
    let best = null, bs = -1;
    const range = this.b.predator ? 70 : 45;
    for (let i = 0; i < 6; i++) {
      const a = this.heading + (Math.random() - 0.5) * Math.PI * 1.4;
      const d = range * (0.4 + Math.random() * 0.6);
      const x = clamp(this.pos.x + Math.sin(a) * d, -PLAY_LIMIT + 10, PLAY_LIMIT - 10);
      const z = clamp(this.pos.z + Math.cos(a) * d, -PLAY_LIMIT + 10, PLAY_LIMIT - 10);
      const s = habitat(this.species, x, z, this.m.T) + Math.random() * 0.2;
      if (s > bs) { bs = s; best = { x, z }; }
    }
    this.target.x = best.x; this.target.z = best.z;
    this.setState(S.WANDER, 40);
  }

  flee(tx, tz, propagate) {
    const b = this.b;
    if (this.state === S.DOWN) return;
    let a = Math.atan2(this.pos.x - tx, this.pos.z - tz) + (Math.random() - 0.5) * 0.8;
    // avoid fleeing straight off the map
    for (let i = 0; i < 6; i++) {
      const fx = this.pos.x + Math.sin(a) * 60, fz = this.pos.z + Math.cos(a) * 60;
      if (Math.abs(fx) < PLAY_LIMIT - 15 && Math.abs(fz) < PLAY_LIMIT - 15) break;
      a += 0.7;
    }
    this.threat.x = tx; this.threat.z = tz;
    this.fleeAngle = a;
    this.desired = a;
    this.awareness = Math.max(this.awareness, 1.0);
    if (b.hides) {
      const bush = this.m.veg.nearestBush(this.pos.x, this.pos.z, 30);
      if (bush && Math.hypot(bush.x - tx, bush.z - tz) > Math.hypot(this.pos.x - tx, this.pos.z - tz) * 0.6) {
        this.target.x = bush.x; this.target.z = bush.z;
        this.setState(S.HIDE, 25 + Math.random() * 15);
        this.hideArrived = false;
        return;
      }
    }
    this.setState(S.FLEE, 8 + Math.random() * 6);
    if (this.state === S.FLEE && b.call === 'snort' && Math.random() < 0.6) G.audio?.animalCall('snort', this.pos);
    if (propagate) this.m.alarm(this, tx, tz);
  }

  charge() {
    this.charged = true;
    this.setState(S.CHARGE, 1.4);
    G.audio?.animalCall('grunt', this.pos);
    G.ui?.toast(`The ${this.sp.name.toLowerCase()} bluff-charges! Hold still — it will break away.`, 'warn');
  }

  // --- perception ---
  perceivePlayer(tdt) {
    const P = this.P || G.player, b = this.b, env = G.env;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    this.playerDist = d;
    if (G.sandbox.observerMode || d > 320) { this.awareness = Math.max(0, this.awareness - tdt * 0.1); return; }
    // lying still in the grass you cannot be seen, heard or winded unless something walks right onto you
    if (P.hidden && d > 2.5) { this.awareness = Math.max(0, this.awareness - tdt * 0.12); return; }
    let score = 0;
    const ang = Math.abs(angleDiff(this.heading + this.headYaw, Math.atan2(dx, dz)));
    const headDown = this.state === S.GRAZE && this.headPitch > 0.5 ? 0.45 : 1;
    if (ang < (b.fov * Math.PI) / 360) {
      let vis = P.visibility * env.visibilityFactor();
      if (b.activity === 'nocturnal' && env.isNight()) vis = Math.min(1, vis * 1.8);
      vis *= 1 - this.m.T.densityAt(P.pos.x, P.pos.z) * 0.55;
      // Prey eyes are tuned to motion: a motionless figure is only picked out at close range
      const motion = P.moving ? (P.crouch ? 0.75 : 1) : 0.45;
      const range = b.sight * vis * headDown * motion;
      if (d < range) {
        const eyeY = this.pos.y + this.sp.model.shoulderH * this.scale;
        if (this.m.T.lineOfSight(this.pos.x, eyeY, this.pos.z, P.eye.x, P.eye.y, P.eye.z)) {
          const k = 1 - d / range;
          score += k * k * 2.6 * (P.moving ? (P.crouch ? 0.8 : 1.6) : 0.5);
        }
      }
    }
    const noise = P.noise * (1 - env.noiseMasking());
    const hr = b.hearing * noise;
    if (d < hr) score += (1 - d / hr) * 2.0;
    const ws = Math.hypot(env.wind.x, env.wind.z);
    if (ws > 0.3 && d > 0.1) {
      const dot = (-dx / d) * (env.wind.x / ws) + (-dz / d) * (env.wind.z / ws);
      const sr = b.smell * clamp(ws / 4, 0.4, 1.4);
      if (dot > 0.8 && d < sr) score += (1 - d / sr) * (dot - 0.8) * 9;
    }
    if (d < 3 + P.visibility * 5) score += 3;
    if (score > 0) {
      this.awareness = Math.min(1.5, this.awareness + score * tdt * b.timid);
      if (this.awareness > 0.25) { this.threat.x = P.pos.x; this.threat.z = P.pos.z; this.threat.kind = 'player'; }
    } else {
      this.awareness = Math.max(0, this.awareness - tdt * 0.12);
    }
  }

  perceivePredators() {
    const preds = PREDATORS_OF[this.species];
    if (!preds) return;
    const near = this.m.nearest(preds, this.pos.x, this.pos.z, 45, (a) => a.state !== S.DOWN);
    if (!near) return;
    const d = Math.hypot(near.pos.x - this.pos.x, near.pos.z - this.pos.z);
    const hunting = near.state === S.CHASE || (near.state === S.STALK && d < 25);
    if (hunting || d < 14) {
      if (this.state !== S.FLEE && this.state !== S.HIDE) this.flee(near.pos.x, near.pos.z, true);
      this.threat.kind = 'predator';
    }
  }

  // --- AI decision step (throttled) ---
  think(tdt) {
    if (this.state === S.DOWN) return;
    const b = this.b;
    this.perceivePlayer(tdt);
    this.perceivePredators();
    this.thirst += tdt / 300;
    this.energy = clamp(this.energy + (this.state === S.REST ? tdt / 60 : -tdt / 400), 0, 1);
    this.cooldown -= tdt;
    if (this.state !== S.ATTACK && this.tryAttack(tdt)) return;
    if (this.nightStalk(tdt)) return;
    const st = this.state;
    const d = this.playerDist;

    if (st !== S.FLEE && st !== S.CHARGE && st !== S.HIDE && st !== S.CHASE && st !== S.ATTACK) {
      if (this.awareness >= 1 || (this.awareness > 0.3 && d < b.panic)) {
        if (b.bluff && d < 9 && !this.charged && Math.random() < 0.45) this.charge();
        else this.flee(this.threat.x, this.threat.z, true);
        return;
      }
      if (this.awareness > 0.35 && st !== S.ALERT && st !== S.FREEZE) {
        this.setState(b.hides ? S.FREEZE : S.ALERT, 5 + Math.random() * 6);
        if (b.call === 'snort' && Math.random() < 0.35) G.audio?.animalCall('snort', this.pos);
        if (b.call === 'bark' && Math.random() < 0.3) G.audio?.animalCall('bark', this.pos);
        return;
      }
    }

    switch (st) {
      case S.ALERT:
      case S.FREEZE:
        this.targetSpeed = 0;
        this.desired = this.heading;
        if (this.stateT > this.stateDur || this.awareness < 0.12) this.pickActivity();
        break;
      case S.FLEE: {
        const td = Math.hypot(this.pos.x - this.threat.x, this.pos.z - this.threat.z);
        this.targetSpeed = b.run * (this.stateT < 3.5 ? 1 : this.stateT < 12 ? 0.6 : 0.45);
        // zig-zag for rabbits, gentle weave for others
        const weave = b.hides ? Math.sin(this.stateT * 5) * 0.7 : Math.sin(this.stateT * 0.9 + this.id) * 0.25;
        this.desired = this.fleeAngle + weave;
        if (this.stateT > this.stateDur || td > 140) {
          this.awareness = 0.5;
          this.setState(S.ALERT, 4 + Math.random() * 4);
        }
        break;
      }
      case S.HIDE: {
        const dt = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (!this.hideArrived) {
          this.desired = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
          this.targetSpeed = b.run;
          if (dt < 0.8 || this.stateT > 6) { this.hideArrived = true; this.targetSpeed = 0; }
        } else {
          this.targetSpeed = 0;
          this.awareness = Math.max(0, this.awareness - tdt * 0.1);
          if (this.playerDist < 4) this.flee((this.P || G.player).pos.x, (this.P || G.player).pos.z, false);
          else if (this.stateT > this.stateDur) this.pickActivity();
        }
        break;
      }
      case S.CHARGE: {
        const P = (this.P || G.player).pos;
        this.desired = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
        this.targetSpeed = b.run * 0.8;
        if (this.stateT > this.stateDur || d < 3.5) this.flee(P.x, P.z, true);
        break;
      }
      case S.STALK: {
        const pr = this.prey;
        if (!pr || !pr.active || pr.state === S.DOWN || this.stateT > this.stateDur) { this.endHunt(); break; }
        const dp = Math.hypot(pr.pos.x - this.pos.x, pr.pos.z - this.pos.z);
        this.desired = Math.atan2(pr.pos.x - this.pos.x, pr.pos.z - this.pos.z);
        this.targetSpeed = b.walk * 0.7;
        const strike = b.strike || 20;
        if (dp < strike || pr.state === S.FLEE) {
          this.setState(S.CHASE, strike < 10 ? 1.6 : 6 + Math.random() * 3);
          if (this.group) for (const o of this.group.members) if (o !== this && o.active && o.state !== S.DOWN) { o.prey = pr; o.setState(S.CHASE, this.stateDur); }
        }
        if (dp > 110) this.endHunt();
        break;
      }
      case S.ATTACK:
        this.updateAttack(tdt);
        break;
      case S.CHASE: {
        const pr = this.prey;
        if (!pr || !pr.active || this.stateT > this.stateDur) { this.endHunt(); break; }
        this.desired = Math.atan2(pr.pos.x - this.pos.x, pr.pos.z - this.pos.z);
        this.targetSpeed = b.run * ((b.strike || 20) < 10 ? 0.9 : 0.85);
        const dp = Math.hypot(pr.pos.x - this.pos.x, pr.pos.z - this.pos.z);
        if (dp > 70) this.endHunt();
        break;
      }
      default:
        this.calm(tdt);
    }
  }

  endHunt() {
    this.prey = null;
    this.cooldown = 60 + Math.random() * 60;
    this.setState(S.IDLE, 4 + Math.random() * 4);
  }

  calm(tdt) {
    const b = this.b, st = this.state;
    // Predators look for prey when calm
    if (b.prey.length && this.cooldown <= 0 && (!this.leader || this.leader === this) && Math.random() < tdt * 0.15) {
      const pr = this.m.nearest(b.prey, this.pos.x, this.pos.z, 80, (a) => a.state !== S.DOWN && a.state !== S.FLEE);
      if (pr) {
        this.prey = pr;
        this.setState(S.STALK, 40);
        if (this.group) for (const o of this.group.members) if (o !== this && o.active) { o.prey = pr; o.setState(S.STALK, 40); }
        return;
      }
      this.cooldown = 15;
    }
    // occasional calls
    this.callT -= tdt;
    if (this.callT <= 0) {
      this.callT = 30 + Math.random() * 60;
      if (b.call === 'howl' && G.env.isNight() && (!this.leader || this.leader === this)) G.audio?.animalCall('howl', this.pos);
      else if (b.call === 'bugle' && this.male && Math.random() < 0.6) G.audio?.animalCall('bugle', this.pos);
      else if (b.call === 'grunt' && Math.random() < 0.5) G.audio?.animalCall('grunt', this.pos);
    }
    switch (st) {
      case S.IDLE:
        this.targetSpeed = 0;
        if (this.stateT > this.stateDur) this.pickActivity();
        break;
      case S.REST:
        this.targetSpeed = 0;
        if (this.stateT > this.stateDur) {
          if (!b.hides) this.m.tracks?.addSign('bed', this.pos.x, this.pos.z, this.heading, this.species, this.id, this.sp.model.bodyLen * this.scale);
          this.pickActivity();
        }
        break;
      case S.GRAZE: {
        const dt = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (dt < 0.5 && Math.random() < tdt * 0.25) {
          const a = this.heading + (Math.random() - 0.5) * 1.5;
          this.target.x = this.pos.x + Math.sin(a) * 2.5;
          this.target.z = this.pos.z + Math.cos(a) * 2.5;
        }
        if (dt > 0.5) {
          this.desired = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
          this.targetSpeed = b.walk * 0.35;
        } else this.targetSpeed = 0;
        if (b.roots && Math.random() < tdt * 0.06) this.m.tracks?.addSign('root', this.pos.x + Math.sin(this.heading) * 0.6, this.pos.z + Math.cos(this.heading) * 0.6, this.heading, this.species, this.id, 1);
        if (this.stateT > this.stateDur) this.pickActivity();
        break;
      }
      case S.WANDER: {
        const L = this.leader;
        if (L && L !== this && L.active && (L.state === S.WANDER) && Math.random() < tdt * 0.5) {
          // keep loosely formed around the moving leader
          const off = (this.id % 5) - 2;
          this.target.x = L.target.x + off * 3; this.target.z = L.target.z + ((this.id * 7) % 5 - 2) * 3;
        }
        const dt = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        this.desired = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
        const lag = L && L !== this ? Math.hypot(L.pos.x - this.pos.x, L.pos.z - this.pos.z) : 0;
        this.targetSpeed = lag > 25 || this.stalking ? b.trot : b.walk;
        if (dt < 2 || this.stateT > this.stateDur) this.pickActivity();
        break;
      }
      case S.DRINK: {
        const dt = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (!this.drinking) {
          this.desired = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
          this.targetSpeed = dt > 25 ? b.trot : b.walk;
          if (dt < 1.6) {
            this.drinking = true;
            this.drinkT = 0;
            // face the water
            const T = this.m.T;
            let best = this.heading, bh = 99;
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const hh = T.getHeight(this.pos.x + Math.sin(a) * 3, this.pos.z + Math.cos(a) * 3);
              if (hh < bh) { bh = hh; best = a; }
            }
            this.desired = best;
          }
          if (this.stateT > this.stateDur) { this.thirst = 0; this.pickActivity(); }
        } else {
          this.targetSpeed = 0;
          this.drinkT += tdt;
          if (this.drinkT > 7 + Math.random() * 4) { this.thirst = 0; this.pickActivity(); }
        }
        break;
      }
      default:
        this.pickActivity();
    }
  }

  computeAvoid() {
    const T = this.m.T, veg = this.m.veg;
    const look = clamp(this.speed * 0.7, 1.6, 7);
    const fx = Math.sin(this.desired), fz = Math.cos(this.desired);
    const ax = this.pos.x + fx * look, az = this.pos.z + fz * look;
    let avoid = 0;
    if (!(this.state === S.DRINK) && T.getHeight(ax, az) < 0.1) {
      const l = T.getHeight(this.pos.x + Math.sin(this.desired + 1) * look, this.pos.z + Math.cos(this.desired + 1) * look);
      const r = T.getHeight(this.pos.x + Math.sin(this.desired - 1) * look, this.pos.z + Math.cos(this.desired - 1) * look);
      avoid = l > r ? 1.3 : -1.3;
      if (this.state === S.FLEE) this.fleeAngle += avoid * 0.5;
    }
    if (Math.abs(ax) > PLAY_LIMIT - 4 || Math.abs(az) > PLAY_LIMIT - 4) {
      const toC = Math.atan2(-this.pos.x, -this.pos.z);
      avoid = angleDiff(this.desired, toC) * 0.8;
      if (this.state === S.FLEE) this.fleeAngle = toC + (Math.random() - 0.5);
    }
    const ob = veg.nearestObstacle(ax, az, 1.0 + this.radius);
    if (ob) {
      const cross = fx * (ob.z - this.pos.z) - fz * (ob.x - this.pos.x);
      avoid += cross > 0 ? 0.8 : -0.8;
    }
    // simple separation within herd
    if (this.group && this.group.members.length > 1) {
      for (const o of this.group.members) {
        if (o === this || !o.active) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const dd = dx * dx + dz * dz;
        if (dd < 2.5 && dd > 0.0001) { this.pos.x += dx * 0.05; this.pos.z += dz * 0.05; }
      }
    }
    this.avoid = avoid;
  }

  // --- per-frame update ---
  update(dt, camDist) {
    const b = this.b;
    this.P = nearestPlayer(this);
    this.stateT += dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      const interval = camDist < 150 ? 0.25 : 0.8;
      this.think(interval);
      if (this.state !== S.DOWN) this.computeAvoid();
      this.thinkT = interval * (0.85 + Math.random() * 0.3);
    }

    if (this.state === S.DOWN) { this.updateDown(dt); this.syncTransform(); this.animate(dt, camDist); return; }

    const turn = b.turnRate * (this.speed > b.trot ? 0.8 : 1.2);
    this.heading = dampAngle(this.heading, this.desired + this.avoid, turn, dt);
    // a knife wound slows them right down
    if (this.wounded) this.targetSpeed = Math.min(this.targetSpeed, b.trot * 0.8);
    const accel = this.targetSpeed > this.speed ? 2.5 : 3.5;
    this.speed = damp(this.speed, this.targetSpeed, accel, dt);
    if (this.speed < 0.02) this.speed = 0;

    if (this.speed > 0) {
      const step = this.speed * dt;
      this.pos.x += Math.sin(this.heading) * step;
      this.pos.z += Math.cos(this.heading) * step;
      G.world.collide(this.pos.x, this.pos.z, this.radius, _push);
      this.pos.x = clamp(_push.x, -PLAY_LIMIT, PLAY_LIMIT);
      this.pos.z = clamp(_push.z, -PLAY_LIMIT, PLAY_LIMIT);
      // tracks
      this.printAcc += step;
      const fast = this.speed > b.trot * 1.1;
      const spacing = (b.hides ? (fast ? 1.6 : 0.6) : fast ? 3.2 : 1.1) * this.scale;
      if (this.printAcc >= spacing && camDist < 220) {
        this.printAcc = 0;
        this.printSide = -this.printSide;
        const off = b.hides ? 0 : this.sp.model.bodyW * 0.22 * this.printSide * this.scale;
        const px = this.pos.x + Math.cos(this.heading) * off, pz = this.pos.z - Math.sin(this.heading) * off;
        if (this.m.T.getHeight(px, pz) > 0.05) this.m.tracks?.addPrint(b.print, px, pz, this.heading, this.species, this.id, fast);
      }
    }
    this.pos.y = G.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3); // cabin floors count
    this.syncTransform();
    this.animate(dt, camDist);
  }

  updateDown(dt) {
    const t = this.stateT;
    if (t < this.runOff) {
      this.speed = damp(this.speed, this.runOff > 1 ? this.b.run * 0.6 : 0, 2, dt);
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
      G.world.collide(this.pos.x, this.pos.z, this.radius, _push);
      this.pos.x = _push.x; this.pos.z = _push.z;
      this.pos.y = this.m.T.getHeight(this.pos.x, this.pos.z);
      return;
    }
    this.speed = 0;
    const c = smoothstep(0, 0.9, t - this.runOff);
    const r = this.rig;
    r.bodyPivot.rotation.z = c * 1.3 * this.downSide;
    r.bodyPivot.position.y = -c * this.sp.model.bodyH * 0.12;
    // Show the harvest card once the animal has settled
    if (!this.popupShown && this.harvest && t > this.runOff + 1.4) {
      this.popupShown = true;
      G.ui?.showHarvest(this);
    }
    // The body stays for inspection until it is tagged, left far behind, or after a long time
    const P = (this.P || G.player).pos;
    const far = Math.hypot(P.x - this.pos.x, P.z - this.pos.z) > 260;
    if (!this.fadeAt && (this.tagged || far || t > this.runOff + 900)) this.fadeAt = t;
    if (this.fadeAt) {
      const fadeStart = this.fadeAt;
      if (!this.fadeMat) {
        this.fadeMat = (this.skinned ? skinnedMat : animalMaterial).clone();
        this.fadeMat.transparent = true;
        r.meshes.forEach((me) => { me.material = this.fadeMat; me.castShadow = false; });
      }
      this.fadeMat.opacity = clamp(1 - (t - fadeStart) / 1.6, 0, 1);
      if (this.fadeMat.opacity <= 0) {
        r.meshes.forEach((me) => { me.castShadow = true; });
        this.m.release(this);
      }
    }
  }

  tryAttack(tdt) {
    const A = ATTACK[this.species];
    const P = this.P || G.player;
    if (!A || !G.cfg || G.sandbox.observerMode || !G.started || isDead(P) || P.inBed || P.inCabinSafe) return false;
    if (this.state === S.DOWN || this.state === S.FLEE) return false;
    this.atkCooldown = (this.atkCooldown || 0) - tdt;
    const d = this.playerDist;
    if (P.hidden && d > 3) return false;
    const night = G.env.isNight();
    const hunts = A.mode === 'hunt' || (night && A.nightHunt);
    // hunters range much further after dark
    const range = A.range * (night && hunts ? 1.6 : 1);
    if (d > range || this.atkCooldown > 0) return false;
    const aggr = G.cfg.predator * (nearFire(P) ? 0.12 : 1);
    if (hunts) {
      // by day a hunter has to have noticed you; at night it follows your scent
      if (!night && this.awareness < 0.2 && d > range * 0.5) return false;
      const pack = A.pack && this.group ? 1 + this.group.members.length * 0.3 : 1;
      const chance = (A.mode === 'hunt' ? A.chance : A.nightHunt) * (night ? 3 : 1);
      if (Math.random() < chance * aggr * pack * tdt) { this.startAttack(true); return true; }
      if (A.mode === 'hunt') return false;
    }
    // defensive animals strike when you get too close
    if (this.awareness >= 0.6 || d < A.range * 0.6) {
      if (Math.random() < A.chance * aggr) { this.startAttack(true); return true; }
      this.atkCooldown = 6;
    }
    return false;
  }

  // After dark, predators (and the odd bear) pick up your scent and close in, unless you are by a
  // lit campfire, indoors or lying hidden in the grass.
  nightStalk(tdt) {
    const A = ATTACK[this.species];
    if (!A || !(A.mode === 'hunt' || A.nightHunt) || !G.cfg || !G.started || G.sandbox.observerMode || !G.env.isNight()) return false;
    const st = this.state;
    if (st !== S.WANDER && st !== S.IDLE && st !== S.REST && st !== S.GRAZE) return false;
    this.stalkT = (this.stalkT || 0) - tdt;
    if (this.stalkT > 0) return false;
    this.stalkT = 6 + Math.random() * 6;
    const P = this.P || G.player, d = this.playerDist;
    if (d > 240 || d < 8 || isDead(P) || P.inBed || P.inCabinSafe || P.hidden || nearFire(P)) return false;
    if (Math.random() > 0.6 * G.cfg.predator) return false;
    this.target.x = P.pos.x + (Math.random() - 0.5) * 12;
    this.target.z = P.pos.z + (Math.random() - 0.5) * 12;
    this.setState(S.WANDER, 30);
    this.stalking = true;
    return true;
  }

  // Skinned carcass: raw red flesh and a pool of blood on the ground
  markSkinned() {
    this.skinned = true;
    if (!skinnedMat) {
      skinnedMat = animalMaterial.clone();
      skinnedMat.color.setRGB(0.78, 0.3, 0.26);
      bloodGeo = new THREE.CircleGeometry(1, 16);
      bloodGeo.rotateX(-Math.PI / 2);
      bloodMat = new THREE.MeshLambertMaterial({ color: 0x3e0806, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    if (!this.fadeMat) this.rig.meshes.forEach((me) => { me.material = skinnedMat; });
    const s = this.sp.model.bodyLen * this.scale * 0.6;
    this.blood = new THREE.Mesh(bloodGeo, bloodMat);
    this.blood.position.set(this.pos.x, this.m.T.getHeight(this.pos.x, this.pos.z) + 0.03, this.pos.z);
    this.blood.scale.set(s * 0.8, 1, s);
    this.blood.rotation.y = this.heading;
    this.m.scene.add(this.blood);
  }

  startAttack(announce) {
    if (this.state === S.ATTACK || this.state === S.DOWN) return;
    this.setState(S.ATTACK, 22 + Math.random() * 8);
    this.atkCool = 0.6;
    this.awareness = 1.5;
    this.knifeHits = this.knifeHits || 0;
    G.audio?.growl(this.pos, this.species);
    if (announce) {
      const msg = `A ${this.sp.name.toLowerCase()} is attacking you! Shoot it, fight it off with your knife, or get indoors and shut the door.`;
      if (!this.P || this.P === G.player) G.ui?.toast(msg, 'warn'); else G.net?.warn(this.P, msg);
      if (ATTACK[this.species].pack && this.group) for (const o of this.group.members) if (o !== this && o.active && o.state !== S.DOWN) o.startAttack(false);
    }
  }

  endAttack() {
    this.atkCooldown = 45 + Math.random() * 45;
    const P = (this.P || G.player).pos;
    this.flee(P.x, P.z, false);
  }

  updateAttack(tdt) {
    const A = ATTACK[this.species], P = this.P || G.player;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    this.desired = Math.atan2(dx, dz);
    this.targetSpeed = d > 1.6 ? this.b.run * 0.9 : 0;
    this.atkCool -= tdt;
    // animals fear fire: reach a lit campfire and an attacker backs off
    if (this.stateT > this.stateDur || d > 90 || G.sandbox.observerMode || P.inBed || P.inCabinSafe || isDead(P) || (nearFire(P) && this.stateT > 1.5)) { this.endAttack(); return; }
    if (d < 2.4 && this.atkCool <= 0) {
      // walls and shut doors protect you
      _eyeA.set(this.pos.x, this.pos.y + this.sp.model.shoulderH * 0.8, this.pos.z);
      _dirA.subVectors(P.eye, _eyeA);
      const dist = _dirA.length();
      _dirA.divideScalar(dist);
      const blocked = G.world.raycastStatic(_eyeA, _dirA, dist) >= 0;
      if (!blocked) {
        const dmg = (A.dmg[0] + Math.random() * (A.dmg[1] - A.dmg[0])) * G.cfg.predDmg * (G.env.isNight() ? 1.25 : 1);
        if (P === G.player) G.survival?.damage(dmg, this.pos, `Killed by a ${this.sp.name.toLowerCase()}`);
        else G.net?.damage(P, dmg, `Killed by a ${this.sp.name.toLowerCase()}`, this.pos);
        this.lunge = 0.45;
        G.audio?.growl(this.pos, this.species);
        if (A.mode === 'defend' && Math.random() < 0.25) { this.endAttack(); return; }
      }
      this.atkCool = A.rate * (0.8 + Math.random() * 0.4);
    }
  }

  // Struck with the knife: small animals go down, big ones break off and run
  knifeHit(shooter) {
    this.knifeHits = (this.knifeHits || 0) + 1;
    // anything under 200 kg goes down to one good stab; the giants (bear, moose, bison) take two,
    // and the first leaves them wounded and slow so you can finish the job
    if (this.weight < 200 || this.knifeHits >= 2) return true; // caller records the kill
    this.wounded = true;
    if (this.state !== S.ATTACK) this.flee(shooter.x, shooter.z, true);
    return false;
  }

  hit(part, shooter) {
    if (this.state === S.DOWN) return;
    const vital = part === 'vitals' || part === 'head' || part === 'neck';
    this.vital = vital;
    this.setState(S.DOWN);
    this.fadeAt = 0;
    this.runOff = vital ? 0.35 : 2.2;
    this.heading = Math.atan2(this.pos.x - shooter.x, this.pos.z - shooter.z) + (Math.random() - 0.5);
    this.downSide = Math.random() < 0.5 ? 1 : -1;
    this.m.alarm(this, shooter.x, shooter.z, 60);
  }

  syncTransform() {
    const r = this.rig.root;
    const T = this.m.T;
    const half = this.sp.model.bodyLen * 0.45 * this.scale;
    const fx = Math.sin(this.heading) * half, fz = Math.cos(this.heading) * half;
    const hF = T.getHeight(this.pos.x + fx, this.pos.z + fz), hB = T.getHeight(this.pos.x - fx, this.pos.z - fz);
    const pitch = Math.atan2(hB - hF, half * 2);
    r.position.set(this.pos.x, Math.min(this.pos.y, (hF + hB) / 2 + 0.02), this.pos.z);
    r.rotation.set(clamp(pitch, -0.5, 0.5), this.heading, 0);
  }

  animate(dt, camDist) {
    const r = this.rig, b = this.b, m = this.sp.model;
    const near = camDist < 95;
    const st = this.state;
    // Resting posture
    const wantRest = st === S.REST ? 1 : (st === S.HIDE && this.hideArrived) || st === S.FREEZE ? 0.35 : 0;
    this.restAmt = damp(this.restAmt, wantRest, 2.5, dt);
    if (!near && st !== S.DOWN) {
      r.bodyPivot.position.y = -this.restAmt * this.rig.dims.legLen * (m.hopper ? 0.25 : 0.72);
      return;
    }
    const sp = this.speed;
    const legs = r.legs;
    if (st === S.DOWN) {
      const c = this.stateT > this.runOff ? smoothstep(0, 0.9, this.stateT - this.runOff) : 0;
      for (let i = 0; i < 4; i++) { legs[i].rotation.x = damp(legs[i].rotation.x, (i < 2 ? -0.3 : 0.3) * c, 6, dt); r.knees[i].rotation.x = damp(r.knees[i].rotation.x, (i < 2 ? 0.5 : 0.35) * c, 6, dt); }
      this.headPitch = damp(this.headPitch, 0.4 * c, 4, dt);
      r.setHead(this.headPitch, 0);
      if (this.stateT < this.runOff) this.animateGait(dt, this.speed);
      return;
    }

    if (this.restAmt > 0.02 && sp < 0.2) {
      const fold = this.restAmt;
      if (m.hopper) {
        r.bodyPivot.position.y = -fold * this.rig.dims.legLen * 0.25;
      } else {
        legs[0].rotation.x = legs[1].rotation.x = fold * 1.1;
        legs[2].rotation.x = legs[3].rotation.x = -fold * 1.1;
        // fold the lower legs under the body
        r.knees[0].rotation.x = r.knees[1].rotation.x = fold * 1.5;
        r.knees[2].rotation.x = r.knees[3].rotation.x = fold * 1.6;
        r.bodyPivot.position.y = -fold * this.rig.dims.legLen * 0.72;
      }
      r.bodyPivot.rotation.x = 0;
    } else {
      r.bodyPivot.position.y = 0;
      this.animateGait(dt, sp);
    }

    // Head: graze/drink down, alert up and toward threat
    let pitchT = 0, yawT = 0;
    // swing the neck down from the shoulders far enough for the muzzle to reach the grass
    const headDown = m.hopper ? (m.neckAngle + 0.55) * 0.5 : Math.min(2.3, m.neckAngle + 1.1);
    if (st === S.GRAZE || (st === S.DRINK && this.drinking)) {
      const vigil = Math.sin(this.stateT * 0.7 + this.id) > 0.75; // periodically lift head to scan
      pitchT = vigil ? 0 : headDown;
    } else if (st === S.ALERT || st === S.FREEZE || (st === S.HIDE && this.hideArrived)) {
      pitchT = -0.2;
      const toT = Math.atan2(this.threat.x - this.pos.x, this.threat.z - this.pos.z);
      yawT = clamp(angleDiff(this.heading, toT), -1.1, 1.1);
    } else if (st === S.REST) {
      pitchT = 0.15; yawT = Math.sin(this.stateT * 0.2 + this.id) * 0.5;
    } else if (st === S.STALK) {
      pitchT = 0.35;
    } else if (st === S.IDLE) {
      yawT = Math.sin(this.stateT * 0.5 + this.id) * 0.6;
    } else if (b.predator && st === S.WANDER) {
      pitchT = 0.25 + Math.sin(this.stateT * 0.8) * 0.15;
    }
    this.headPitch = damp(this.headPitch, pitchT, 4, dt);
    this.headYaw = damp(this.headYaw, yawT, 4, dt);
    // walking animals nod with each stride; calm ones fidget now and then
    const walking = sp > 0.1 && sp < b.trot * 1.1 && !m.hopper;
    this.nod = damp(this.nod, walking ? Math.sin(this.phase * 2 + 0.6) * 0.07 : 0, 10, dt);
    let fp = 0, fy = 0;
    const calm = st === S.GRAZE || st === S.IDLE || st === S.REST || st === S.DRINK;
    if (this.fidget) {
      const fd = this.fidget, u = (fd.t += dt) / fd.dur, env = Math.sin(Math.min(1, u) * Math.PI);
      if (fd.kind === 'shake') { fy = Math.sin(fd.t * 34) * 0.22 * env; fp = -0.15 * env; }
      else if (fd.kind === 'look') { fy = fd.dir * 0.9 * env; fp = -0.25 * env; }
      else if (fd.kind === 'flick') r.tailPivot.rotation.y += Math.sin(fd.t * 28) * 0.5 * env;
      else if (fd.kind === 'stamp' && sp < 0.05 && this.restAmt < 0.1) { legs[fd.leg].rotation.x -= env * 0.45; r.knees[fd.leg].rotation.x += env * 1.3; }
      if (u >= 1 || !calm) this.fidget = null;
    } else if (calm && (this.fidgetCd -= dt) <= 0) {
      const kinds = this.restAmt > 0.5 ? ['shake', 'look', 'flick'] : ['shake', 'look', 'flick', 'stamp', 'look'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      this.fidget = { kind, t: 0, dur: kind === 'shake' ? 0.55 : kind === 'look' ? 2.2 : kind === 'stamp' ? 0.5 : 0.7, dir: Math.random() < 0.5 ? -1 : 1, leg: Math.random() < 0.5 ? 0 : 1 };
      this.fidgetCd = 3 + Math.random() * 8;
    }
    r.setHead(this.headPitch + this.nod + fp, this.headYaw + fy);
    // breathing: faster and deeper after running
    this.exert = damp(this.exert, sp > b.trot ? 1 : sp > b.walk * 1.4 ? 0.5 : 0, sp > b.walk ? 0.8 : 0.12, dt);
    this.breathT += dt * (1.6 + this.exert * 4.5) * (st === S.REST ? 0.7 : 1);
    const br = Math.sin(this.breathT) * (0.012 + this.exert * 0.02);
    r.bones.spine.scale.set(1 + br * 0.8, 1 + br, 1);
    // lean into turns and flex the spine with the stride
    const turn = angleDiff(this.prevHeading, this.heading) / Math.max(dt, 1e-3);
    this.prevHeading = this.heading;
    this.lean = damp(this.lean, clamp(-turn * sp * 0.035, -0.22, 0.22), 5, dt);
    r.bodyPivot.rotation.z = this.lean;
    r.bones.spine.rotation.y = sp > 0.1 && !m.hopper ? Math.sin(this.phase) * 0.035 * Math.min(1, sp / b.walk) : 0;
    if (this.lunge > 0) { this.lunge -= dt; r.bodyPivot.rotation.x = -Math.sin((this.lunge / 0.45) * Math.PI) * 0.35; }
    if (st === S.ATTACK) { this.headPitch = damp(this.headPitch, 0.15, 6, dt); }

    // Tail
    let tailT = 0;
    if (m.tailType === 'deer') tailT = st === S.FLEE || st === S.ALERT && this.awareness > 0.8 ? 2.2 : Math.sin(this.stateT * 3) * 0.05;
    else if (m.tailType === 'bushy') tailT = st === S.FLEE || st === S.CHASE ? -0.5 : st === S.STALK ? 0.2 : Math.sin(this.stateT * 1.5 + this.id) * 0.08;
    else if (m.tailType === 'thin') tailT = Math.sin(this.stateT * 6) * 0.25;
    this.tailAngle = damp(this.tailAngle, tailT, 6, dt);
    r.tailPivot.rotation.x = this.tailAngle;
    if (['bushy', 'thin', 'long', 'ringed'].includes(m.tailType)) r.tailPivot.rotation.y = Math.sin(this.stateT * 2 + this.id) * 0.15;
  }

  animateGait(dt, sp) {
    const r = this.rig, b = this.b, m = this.sp.model, legs = r.legs;
    const stride = b.stride * this.scale * (sp > b.trot * 1.1 ? 2.4 : sp > b.walk * 1.3 ? 1.5 : 1);
    this.phase += (dt * sp / (stride * 2)) * Math.PI * 2;
    const ph = this.phase;
    if (m.hopper) {
      const s = Math.sin(ph);
      const amp = clamp(sp / 3, 0, 1);
      r.bodyPivot.position.y = Math.max(0, s) * 0.12 * amp * (sp > 3 ? 2 : 1);
      r.bodyPivot.rotation.x = -s * 0.25 * amp;
      legs[0].rotation.x = legs[1].rotation.x = s * 0.7 * amp;
      legs[2].rotation.x = legs[3].rotation.x = -s * 0.9 * amp;
      for (const k of r.knees) k.rotation.x = 0;
      return;
    }
    if (sp < 0.05) {
      for (const l of legs) l.rotation.x = damp(l.rotation.x, 0, 8, dt);
      for (const k of r.knees) k.rotation.x = damp(k.rotation.x, 0, 8, dt);
      r.bodyPivot.rotation.x = damp(r.bodyPivot.rotation.x, 0, 6, dt);
      return;
    }
    let offs, amp;
    if (sp > b.trot * 1.1) { offs = [0.5, 0.6, 0.0, 0.1]; amp = 0.75; }
    else if (sp > b.walk * 1.4) { offs = [0, 0.5, 0.5, 0]; amp = 0.5; }
    else { offs = [0.25, 0.75, 0, 0.5]; amp = clamp(0.2 + sp / b.walk * 0.18, 0, 0.42); }
    for (let i = 0; i < 4; i++) {
      const a = ph + offs[i] * Math.PI * 2;
      legs[i].rotation.x = Math.sin(a) * amp * (i < 2 ? 1 : 0.9);
      // the knee (front) or hock (hind) folds while the foot swings forward off the ground
      const lift = Math.max(0, Math.cos(a));
      r.knees[i].rotation.x = lift * amp * (i < 2 ? 1.9 : 1.3) + (i < 2 ? 0.04 : 0.08);
    }
    const gallop = sp > b.trot * 1.1;
    r.bodyPivot.position.y = gallop ? Math.abs(Math.sin(ph)) * 0.08 * m.shoulderH : Math.abs(Math.sin(ph * 2)) * 0.012 * m.shoulderH;
    r.bodyPivot.rotation.x = gallop ? Math.sin(ph) * 0.07 : 0;
  }

  // World-space hit spheres: [{part, c: Vector3, r}]
  hitSpheres(out, inflate = 1) {
    const r = this.rig, m = this.sp.model, d = r.dims;
    r.root.updateMatrixWorld(true);
    const bm = r.bodyPivot.matrixWorld;
    const sc = this.scale * inflate;
    let i = 0;
    const put = (part, x, y, z, rad, mat) => {
      if (!out[i]) out[i] = { part: '', c: new THREE.Vector3(), r: 0 };
      out[i].part = part; out[i].c.set(x, y, z).applyMatrix4(mat); out[i].r = rad * sc; i++;
    };
    put('vitals', 0, d.cY - m.bodyH * 0.12, m.bodyLen * 0.24, m.bodyH * 0.3, bm);
    put('body', 0, d.cY, 0, m.bodyH * 0.5, bm);
    put('body', 0, d.cY, -m.bodyLen * 0.3, m.bodyH * 0.46, bm);
    // neck and head follow the bending neck bones
    put('neck', 0, 0, 0, m.neckR * 1.3, r.bones.mid.matrixWorld);
    put('head', d.headCenter.x - d.neckEnd.x, d.headCenter.y - d.neckEnd.y, d.headCenter.z - d.neckEnd.z + m.headLen * 0.1, Math.max(m.headH, m.headW) * 0.65, r.bones.top.matrixWorld);
    out.length = i;
    return out;
  }
}

export class AnimalManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.T = world.terrain;
    this.veg = world.veg;
    this.tracks = null;
    this.list = [];
    this.byNid = new Map();
    this.pool = {};
    this.population = { ...DEFAULT_POPULATION };
    this.popTimer = 0;
    this._spheres = [];
  }

  acquire(id, male) {
    const key = id + (male ? 'm' : 'f');
    const arr = this.pool[key] || (this.pool[key] = []);
    return arr.pop() || new Animal(this, id, male);
  }

  release(a) {
    if (this.byNid.get(a.nid) === a) this.byNid.delete(a.nid);
    if (G.net?.isHost && a.state !== S.DOWN) G.net.queueDespawn(a.nid);
    a.despawn();
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
    if (a.group) {
      a.group.members = a.group.members.filter((m) => m !== a);
      if (a.group.leader === a) a.group.leader = a.group.members[0] || null;
    }
    const key = a.species + (a.male ? 'm' : 'f');
    (this.pool[key] || (this.pool[key] = [])).push(a);
  }

  spawnGroup(id, x, z, count) {
    const sp = SPECIES[id];
    const herd = sp.behavior.herd;
    const n = count || herd[0] + Math.floor(Math.random() * (herd[1] - herd[0] + 1));
    const group = n > 1 ? { leader: null, members: [] } : null;
    const spawned = [];
    for (let i = 0; i < n; i++) {
      const male = sp.model.maleChance !== undefined ? (i === 0 && n > 2 ? Math.random() < 0.5 : Math.random() < sp.model.maleChance * (n > 2 ? 0.5 : 1)) : Math.random() < 0.5;
      const a = this.acquire(id, male);
      let px = x, pz = z;
      for (let k = 0; k < 6; k++) {
        px = x + (Math.random() - 0.5) * 10 * Math.sqrt(n);
        pz = z + (Math.random() - 0.5) * 10 * Math.sqrt(n);
        if (this.T.getHeight(px, pz) > 0.4) break;
      }
      a.spawn(px, pz, group);
      if (group) group.members.push(a);
      this.list.push(a);
      spawned.push(a);
    }
    if (group) { group.leader = group.members[0]; const h = Math.random() * 6.28; group.members.forEach((m) => { m.heading = m.desired = h + (Math.random() - 0.5); }); }
    G.net?.queueSpawn(spawned);
    return spawned;
  }

  findSpawnPoint(id, minDist = 90, maxDist = 400) {
    const P = G.player ? G.player.pos : new THREE.Vector3();
    let best = null, bs = -1;
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() * 2 - 1) * (PLAY_LIMIT - 15), z = (Math.random() * 2 - 1) * (PLAY_LIMIT - 15);
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < minDist || d > maxDist) continue;
      const s = habitat(id, x, z, this.T) + Math.random() * 0.25;
      if (s > bs) { bs = s; best = { x, z }; }
    }
    return best;
  }

  initialSpawn() {
    // Guaranteed early encounters near the cabin so the player meets wildlife quickly
    this.spawnGroup('deer', -64, -8, 3).forEach((a) => { a.setState(S.GRAZE, 20 + Math.random() * 20); a.target.x = a.pos.x; a.target.z = a.pos.z; });
    this.spawnGroup('rabbit', -22, -44, 1);
    this.spawnGroup('rabbit', -60, -78, 1);
    for (const id of SPECIES_ORDER) {
      let c = this.count(id);
      let guard = 0;
      while (c < this.population[id] && guard++ < 20) {
        const p = this.findSpawnPoint(id, 70);
        if (!p) break;
        const sp = SPECIES[id];
        const n = Math.min(this.population[id] - c, sp.behavior.herd[0] + Math.floor(Math.random() * (sp.behavior.herd[1] - sp.behavior.herd[0] + 1)));
        this.spawnGroup(id, p.x, p.z, n);
        c = this.count(id);
      }
    }
  }

  count(id) {
    let c = 0;
    for (const a of this.list) if (a.species === id && a.state !== S.DOWN) c++;
    return c;
  }

  spawnNear(id, pos, yaw) {
    const d = id === 'rabbit' || id === 'fox' ? 18 : 32;
    const x = clamp(pos.x - Math.sin(yaw) * d, -PLAY_LIMIT + 5, PLAY_LIMIT - 5);
    const z = clamp(pos.z - Math.cos(yaw) * d, -PLAY_LIMIT + 5, PLAY_LIMIT - 5);
    const sp = SPECIES[id];
    const n = sp.behavior.herd[0];
    return this.spawnGroup(id, x, z, n);
  }

  nearest(ids, x, z, maxD, filter) {
    let best = null, bd = maxD;
    for (const a of this.list) {
      if (!ids.includes(a.species)) continue;
      if (filter && !filter(a)) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.z - z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // Alarm spreads to nearby animals (herd members respond strongly).
  alarm(src, tx, tz, radius = 45) {
    for (const a of this.list) {
      if (a === src || a.state === S.DOWN || a.state === S.FLEE || a.state === S.HIDE || a.state === S.ATTACK) continue;
      const d = Math.hypot(a.pos.x - src.pos.x, a.pos.z - src.pos.z);
      const sameGroup = a.group && a.group === src.group;
      if (sameGroup || (d < radius && !a.b.predator)) {
        a.flee(tx, tz, false);
      }
    }
  }

  // A game call: curious deer and elk come to investigate (and sometimes predators).
  callEvent(x, z) {
    const curious = ['deer', 'elk', 'moose', 'pronghorn'], hunters = ['wolf', 'coyote', 'cougar', 'bear'];
    const now = performance.now();
    this.calls = (this.calls || []).filter((t) => now - t < 60000);
    this.calls.push(now);
    const overcall = this.calls.length > 3;
    let came = 0;
    for (const a of this.list) {
      if (a.state === S.DOWN || a.state === S.FLEE || a.state === S.ATTACK) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.z - z);
      if (d > 260) continue;
      if (overcall && d < 140 && curious.includes(a.species)) { a.awareness = Math.min(1.5, a.awareness + 0.6); continue; }
      const p = curious.includes(a.species) ? 0.55 : hunters.includes(a.species) ? 0.3 : 0;
      if (Math.random() < p) {
        const ang = Math.random() * 6.28, r = 15 + Math.random() * 15;
        a.target.x = x + Math.cos(ang) * r; a.target.z = z + Math.sin(ang) * r;
        a.setState(S.WANDER, 70);
        a.awareness = Math.min(a.awareness, 0.2);
        came++;
      }
    }
    if (overcall) G.ui?.toast('Calling too often makes animals suspicious. Wait a few minutes between calls.', 'warn');
    return came;
  }

  // Loud sounds: gunshots alarm wildlife over long distances.
  soundEvent(x, z, radius, kind) {
    for (const a of this.list) {
      if (a.state === S.DOWN) continue;
      if (a.state === S.ATTACK && Math.random() < 0.75) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.z - z);
      if (d > radius) continue;
      if (kind === 'shot') {
        const k = 1 - d / radius;
        a.awareness = Math.min(1.5, a.awareness + k * 2.5 + 0.3);
        if (d < radius * 0.7 || a.awareness >= 1) {
          if (a.state !== S.FLEE && a.state !== S.HIDE) a.flee(x, z, false);
        } else if (a.state !== S.FLEE) {
          a.threat.x = x; a.threat.z = z;
          a.setState(a.b.hides ? S.FREEZE : S.ALERT, 6);
        }
      } else if (kind === 'impact') {
        if (a.state !== S.FLEE && a.state !== S.HIDE) a.flee(x, z, true);
      }
    }
  }

  // Bullet ray vs animals. Returns {animal, part, dist} or null.
  raycast(origin, dir, maxDist, inflate = 1) {
    let best = null;
    for (const a of this.list) {
      if (!a.active || (a.state === S.DOWN && inflate === 1)) continue;
      const dx = a.pos.x - origin.x, dz = a.pos.z - origin.z;
      if (dx * dx + dz * dz > (maxDist + 5) ** 2) continue;
      const spheres = a.hitSpheres(this._spheres, inflate);
      // entry distance = first sphere touched; part = most critical structure on the bullet path
      let entry = Infinity, part = null;
      const rank = { head: 3, vitals: 3, neck: 2, body: 1 };
      for (const s of spheres) {
        _v.subVectors(s.c, origin);
        const t = _v.dot(dir);
        if (t < -s.r || t > maxDist + s.r) continue;
        _v2.copy(origin).addScaledVector(dir, t);
        const d2 = _v2.distanceToSquared(s.c);
        if (d2 > s.r * s.r) continue;
        const th = Math.max(0, t - Math.sqrt(s.r * s.r - d2));
        if (th > maxDist) continue;
        entry = Math.min(entry, th);
        if (!part || rank[s.part] > rank[part]) part = s.part;
      }
      if (part && (!best || entry < best.dist)) best = { animal: a, part, dist: entry };
    }
    return best;
  }

  setPopulation(id, n) { this.population[id] = n; }

  // ---------- PvP: animals mirrored from the host's game ----------
  netSpawn(list) {
    for (const e of list) {
      if (this.byNid.has(e.n)) continue;
      const a = this.acquire(e.s, !!e.m);
      a.spawn(e.x, e.z, null);
      this.byNid.delete(a.nid);
      a.nid = e.n;
      this.byNid.set(e.n, a);
      a.scale = e.sc; a.rig.root.scale.setScalar(e.sc);
      a.weight = e.w; a.age = e.ag;
      a.heading = a.desired = e.h;
      if (e.st && e.st !== S.DOWN) a.setState(e.st);
      a.net = { x: e.x, z: e.z, h: e.h, sp: 0, st: a.state };
      this.list.push(a);
      a.syncTransform();
    }
  }

  netApply(arr) {
    for (const [n, x, z, h, sp, st] of arr) {
      const a = this.byNid.get(n);
      if (!a || a.state === S.DOWN) continue;
      a.net = { x, z, h, sp, st };
    }
  }

  netDespawn(ids) {
    for (const n of ids) { const a = this.byNid.get(n); if (a && a.state !== S.DOWN) this.release(a); }
  }

  // someone (anyone) brought an animal down: reproduce the same fall in this game
  netDown(m) {
    const a = this.byNid.get(m.n);
    if (!a || a.state === S.DOWN) return;
    a.pos.x = m.px; a.pos.z = m.pz;
    a.hit(m.part, { x: m.sx, z: m.sz });
    a.heading = m.h; a.downSide = m.side; a.runOff = m.run;
    a.popupShown = true;
  }

  // Client side of PvP: no AI here, just follow the host's positions and animate
  netUpdate(dt) {
    const cam = G.camera.position;
    const viewDist = G.env.viewDist * Math.max(0.5, G.env.w.fog) + 20;
    const k = Math.min(1, dt * 8);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      const cd = Math.hypot(a.pos.x - cam.x, a.pos.z - cam.z);
      a.P = G.player;
      if (a.state === S.DOWN) {
        a.stateT += dt;
        a.updateDown(dt);
        if (!a.active) continue;
        a.syncTransform(); a.animate(dt, cd);
      } else if (a.net) {
        const n = a.net;
        if (Math.hypot(n.x - a.pos.x, n.z - a.pos.z) > 25) { a.pos.x = n.x; a.pos.z = n.z; }
        a.pos.x += (n.x - a.pos.x) * k; a.pos.z += (n.z - a.pos.z) * k;
        a.heading = dampAngle(a.heading, n.h, 10, dt);
        a.speed = n.sp;
        if (a.state !== n.st) a.setState(n.st); else a.stateT += dt;
        a.pos.y = G.world.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.3);
        a.syncTransform(); a.animate(dt, cd);
      }
      this.cull(a, cd, viewDist);
    }
  }

  // draw an animal only within sight (small ones closer; big ones stay visible in a scope at range),
  // skip all matrix work while hidden (hitSpheres refreshes it when a shot needs it);
  // only the nearby ones cast shadows (the shadow map only covers ~55 m anyway)
  cull(a, cd, viewDist) {
    const r = a.rig.root;
    r.visible = cd < (a.sp.model.shoulderH < 0.45 ? Math.min(viewDist, 140) : viewDist);
    r.matrixWorldAutoUpdate = r.visible;
    a.rig.setLod(cd > 60 ? 1 : 0);
    const sh = cd < 45;
    if (a.shadowOn !== sh) { a.shadowOn = sh; r.traverse((o) => { if (o.isMesh) o.castShadow = sh; }); }
  }

  clearAll() {
    for (const a of [...this.list]) this.release(a);
  }

  update(dt) {
    const cam = G.camera.position;
    const viewDist = G.env.viewDist * Math.max(0.5, G.env.w.fog) + 20;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      const cd = Math.hypot(a.pos.x - cam.x, a.pos.z - cam.z);
      a.update(dt, cd);
      this.cull(a, cd, viewDist);
    }
    // Population maintenance
    this.popTimer -= dt;
    if (this.popTimer <= 0) {
      this.popTimer = 3;
      for (const id of SPECIES_ORDER) {
        const c = this.count(id);
        // more predators roam after dark, and closer by
        const nightPred = G.env.isNight() && NIGHT_PREDATORS.includes(id);
        const target = nightPred ? Math.ceil(this.population[id] * 2) : this.population[id];
        if (c < target) {
          const p = nightPred ? this.findSpawnPoint(id, 90, 260) : this.findSpawnPoint(id, 110);
          if (p) {
            const sp = SPECIES[id];
            const n = Math.min(target - c, sp.behavior.herd[0] + Math.floor(Math.random() * (sp.behavior.herd[1] - sp.behavior.herd[0] + 1)));
            this.spawnGroup(id, p.x, p.z, Math.max(1, n));
          }
        } else if (c > target) {
          // remove the farthest one
          let far = null, fd = 0;
          for (const a of this.list) {
            if (a.species !== id || a.state === S.DOWN) continue;
            const d = Math.hypot(a.pos.x - cam.x, a.pos.z - cam.z);
            if (d > fd) { fd = d; far = a; }
          }
          if (far) this.release(far);
        }
      }
    }
  }
}
