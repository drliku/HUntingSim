// Traps, in three sizes. Small body-grip traps (rabbits, beavers, raccoons, badgers) kill at once;
// medium foothold traps (foxes, coyotes, lynx, wolves) and large ones (deer, boar, bear, cougar,
// pronghorn, bighorn) hold the animal until you come and finish it, or until it pulls free hours
// later. The lure on the pan draws animals of the right size in from the country around. Anything
// heavier springs the trap and gets away; anything lighter walks straight over it.
// In PvP the host's game decides what gets caught; every player sees every trap.
import * as THREE from 'three';
import { G, saveProgress } from './state.js';
import { colorize, mergeColored, xf, cylinderBetween } from './geo.js';
import { S } from './animals.js';
import { SPECIES } from './species.js';

// trigger: anything this heavy (kg) or more that isn't one of the trap's species springs it
// hold: game hours a held animal stays before it pulls free
export const TRAP_KINDS = {
  trapS: { name: 'Small trap', size: 'small', species: ['rabbit', 'beaver', 'raccoon', 'badger'], kills: true, trigger: 0.5, lure: 110, R: 0.1 },
  trapM: { name: 'Medium trap', size: 'medium', species: ['fox', 'coyote', 'lynx', 'wolf'], kills: false, trigger: 3, lure: 130, hold: 10, R: 0.1 },
  trapL: { name: 'Large trap', size: 'large', species: ['deer', 'boar', 'bear', 'cougar', 'pronghorn', 'bighorn'], kills: false, trigger: 20, lure: 150, hold: 8, R: 0.22 },
};
export const TRAP_ORDER = ['trapS', 'trapM', 'trapL'];
const MAX_OUT = 8;        // traps one player can have set at a time
const SPACING = 2;        // metres between traps

const STEEL = 0x4c4d4a, DARK = 0x34332f, RUST = 0x6a4a34, PAN = 0x5f5d56, STAKE = 0x5a4028, FLAG = 0xff7a1a;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const HINGE = 0.014; // height of the jaw hinge above the ground

// One jaw, standing up in the XY plane from the hinge line (the x axis): a half ring for the
// foothold traps (with teeth on the big one), a square U frame for the small body-grip trap.
function jawGeometry(kind) {
  const K = TRAP_KINDS[kind], R = K.R, p = [];
  if (kind === 'trapS') {
    const h = R * 1.8, r = 0.006;
    p.push(cylinderBetween(V(-R, 0, 0), V(-R, h, 0), r, r, 6, STEEL));
    p.push(cylinderBetween(V(R, 0, 0), V(R, h, 0), r, r, 6, STEEL));
    p.push(cylinderBetween(V(-R, h, 0), V(R, h, 0), r, r, 6, STEEL));
    p.push(cylinderBetween(V(-R * 0.6, h * 0.5, 0), V(R * 0.6, h * 0.5, 0), r * 0.7, r * 0.7, 5, STEEL)); // cross wire
  } else {
    const tube = kind === 'trapL' ? 0.014 : 0.006;
    p.push(colorize(new THREE.TorusGeometry(R, tube, 6, 20, Math.PI), STEEL));
    if (kind === 'trapL') {
      // teeth pointing in toward the middle
      for (let i = 1; i < 12; i++) {
        const a = (i / 12) * Math.PI;
        const tooth = new THREE.ConeGeometry(0.011, 0.04, 4);
        xf(tooth, 0, -0.02, 0); // tip at the origin side after the turn below
        xf(tooth, Math.cos(a) * (R - 0.02), Math.sin(a) * (R - 0.02), 0, 0, 0, a + Math.PI / 2);
        p.push(colorize(tooth, 0x6e6c66));
      }
    }
  }
  return mergeColored(p);
}

// Everything that doesn't move: base bar, springs, pan, chain, stake and a bit of flagging tape.
function baseGeometry(kind) {
  const K = TRAP_KINDS[kind], R = K.R, big = kind === 'trapL', p = [];
  const s = big ? 2 : 1;
  p.push(colorize(xf(new THREE.BoxGeometry(R * 2.2, 0.012 * s, 0.022 * s), 0, 0.006 * s, 0), DARK)); // base bar
  p.push(colorize(xf(new THREE.CylinderGeometry(R * 0.32, R * 0.32, 0.008, 12), 0, HINGE, 0), PAN));  // pan
  if (kind === 'trapS') {
    // coil spring and its arm off to one side
    for (let i = 0; i < 5; i++) p.push(colorize(xf(new THREE.TorusGeometry(0.018, 0.004, 4, 10), R + 0.03, 0.02 + i * 0.008, 0, Math.PI / 2, 0, 0), STEEL));
    p.push(colorize(xf(new THREE.BoxGeometry(0.012, 0.008, R * 1.6), R + 0.03, 0.012, 0), STEEL));
  } else {
    // a long flat spring out each side, its ring round the jaw ends
    for (const sx of [-1, 1]) {
      const L = R * (big ? 1.3 : 1.5);
      p.push(colorize(xf(new THREE.BoxGeometry(L, 0.008 * s, 0.026 * s), sx * (R + L / 2), 0.012 * s, 0), STEEL));
      p.push(colorize(xf(new THREE.TorusGeometry(0.03 * s, 0.006 * s, 5, 12), sx * (R + 0.01), 0.018 * s, 0, 0, Math.PI / 2, 0), STEEL));
    }
  }
  // chain to the stake
  const links = big ? 9 : 6, lr = 0.011 * s, z0 = -R * 0.3;
  for (let i = 0; i < links; i++) {
    const g = new THREE.TorusGeometry(lr, lr * 0.28, 4, 8);
    p.push(colorize(xf(g, 0.004 * Math.sin(i * 1.7), 0.006, z0 - i * lr * 1.55, Math.PI / 2, 0, i % 2 ? Math.PI / 2 : 0), RUST));
  }
  const sz = z0 - links * lr * 1.55 - lr;
  p.push(cylinderBetween(V(0, -0.12 * s, sz), V(0, 0.07 * s, sz), 0.012 * s, 0.01 * s, 6, STAKE));
  p.push(colorize(xf(new THREE.BoxGeometry(0.012, 0.09, 0.004), 0.008, 0.03 * s, sz), FLAG)); // flagging tape
  return mergeColored(p);
}

const geoCache = {};
function geos(kind) {
  return geoCache[kind] || (geoCache[kind] = { base: baseGeometry(kind), jaw: jawGeometry(kind) });
}

// A trap sprung shut, as one geometry: what you carry (and what other players see in your hand).
export function closedTrapGeometry(kind) {
  const g = geos(kind);
  const a = g.jaw.clone(); a.translate(0, HINGE, 0);
  const b = g.jaw.clone(); b.rotateY(Math.PI); b.translate(0, HINGE, 0.004);
  return mergeColored([g.base, a, b]);
}

const trapMat = new THREE.MeshLambertMaterial({ vertexColors: true });

function hunterNear(x, z, r) {
  const P = G.player;
  if (!G.survival?.dead && Math.hypot(P.pos.x - x, P.pos.z - z) < r) return true;
  if (G.net) for (const p of G.net.players.values()) if (!p.dead && Math.hypot(p.pos.x - x, p.pos.z - z) < r) return true;
  return false;
}

export class Traps {
  constructor(scene) {
    this.scene = scene;
    this.traps = new Map();
    this.n = 0;
  }

  get authority() { return !G.net || G.net.isHost; }
  get myId() { return G.net ? G.net.id : 0; }
  mine(t) { return t.owner === this.myId; }
  // your own traps and your teammates' show on your map
  ours(t) { return this.mine(t) || !!(G.net && G.net.isMate(t.owner)); }
  count(owner = this.myId) { let n = 0; for (const t of this.traps.values()) if (t.owner === owner) n++; return n; }
  list() { return [...this.traps.values()].map((t) => this.info(t)); }
  info(t) { return { id: t.id, x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100, k: t.kind, o: t.owner, s: t.state, n: t.nid, y: Math.round(t.yaw * 100) / 100 }; }

  // create a trap or update its state (from this game or from the network)
  set(m) {
    let t = this.traps.get(m.id);
    if (!t) {
      if (!TRAP_KINDS[m.k]) return null;
      const g = geos(m.k);
      const group = new THREE.Group();
      const base = new THREE.Mesh(g.base, trapMat);
      const jawA = new THREE.Mesh(g.jaw, trapMat), jawB = new THREE.Mesh(g.jaw, trapMat);
      jawA.position.y = jawB.position.y = HINGE;
      jawB.rotation.y = Math.PI;
      for (const me of [base, jawA, jawB]) { me.castShadow = true; me.receiveShadow = true; group.add(me); }
      group.position.set(m.x, G.world.terrain.getHeight(m.x, m.z) + 0.005, m.z);
      group.rotation.y = m.y || 0;
      this.scene.add(group);
      t = { id: m.id, x: m.x, z: m.z, kind: m.k, owner: m.o, yaw: m.y || 0, group, jawA, jawB, shut: m.s === 'set' ? 0 : 1 };
      jawA.rotation.x = jawB.rotation.x = (1 - t.shut) * Math.PI / 2; // set: jaws open flat; sprung: shut
      this.traps.set(m.id, t);
    }
    t.state = m.s; t.nid = m.n || 0;
    return t;
  }

  remove(id, broadcast = true) {
    const t = this.traps.get(id);
    if (!t) return;
    this.scene.remove(t.group);
    this.traps.delete(id);
    if (broadcast) G.net?.send({ t: 'trap', a: 'del', id });
  }

  clear() { for (const id of [...this.traps.keys()]) this.remove(id, false); }

  nearest(x, z, r) {
    let best = null, bd = r;
    for (const t of this.traps.values()) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = t; } }
    return best;
  }

  // ---------- the player's side ----------
  // Set a trap on the ground in front of you. Returns a message for the player if it can't be done.
  place(kind) {
    const P = G.player, E = G.equipment, am = E.ammo[kind], K = TRAP_KINDS[kind];
    if (!am || am.reserve <= 0) return `You have no ${K.size} traps. The general store sells them.`;
    if (this.count() >= MAX_OUT) return `You already have ${MAX_OUT} traps set. Pick one up (E) before setting another.`;
    if (P.swimming || P.inWater) return 'You can\'t set a trap in the water.';
    const x = P.pos.x - Math.sin(P.yaw) * 1.3, z = P.pos.z - Math.cos(P.yaw) * 1.3;
    if (G.world.terrain.getHeight(x, z) < 0.05) return 'Too wet here: set it on dry ground.';
    if (this.nearest(x, z, SPACING)) return 'There is already a trap right there.';
    if (!G.sandbox.infiniteAmmo) am.reserve--;
    const t = this.set({ id: `${this.myId}-${++this.n}-${Math.floor(Math.random() * 1e6)}`, x, z, k: kind, o: this.myId, s: 'set', y: P.yaw + Math.PI / 2 });
    this.broadcast(t);
    G.audio?.dryFire();
    return null;
  }

  // E on a trap: take it back (only once nothing live is held in it)
  pickUp(t) {
    if (t.state === 'caught') return;
    const am = G.equipment.ammo[t.kind];
    am.reserve++;
    G.equipment.owned.trap = true;
    this.remove(t.id);
    G.audio?.strike();
    G.ui.toast(`You pick up the ${TRAP_KINDS[t.kind].name.toLowerCase()}${this.mine(t) ? '' : ' — somebody else\'s, now yours'}.`, 'good');
  }

  broadcast(t, ev) {
    const m = { t: 'trap', a: 'set', ...this.info(t) };
    if (ev) Object.assign(m, ev);
    G.net?.send(m);
  }

  // ---------- the animals' side ----------
  // The nearest set trap whose lure works on this animal, if it can smell it from here.
  // Nothing comes to a trap while a hunter is standing over it.
  lureFor(a) {
    let best = null, bd = Infinity;
    for (const t of this.traps.values()) {
      if (t.state !== 'set' || hunterNear(t.x, t.z, 35)) continue;
      const K = TRAP_KINDS[t.kind];
      if (!K.species.includes(a.species)) continue;
      const d = Math.hypot(t.x - a.pos.x, t.z - a.pos.z);
      if (d < K.lure && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // Something stepped on the pan (authority only)
  trigger(t, a) {
    const K = TRAP_KINDS[t.kind];
    let ev;
    if (K.species.includes(a.species)) {
      if (K.kills) {
        a.pos.x = t.x; a.pos.z = t.z;
        a.trapKilled = true;
        // a body-grip trap kills on the spot: the animal drops where it stands
        a.hit('vitals', { x: t.x - Math.sin(a.heading), z: t.z - Math.cos(a.heading) });
        a.runOff = 0; a.popupShown = true;
        G.net?.down(a, 'vitals');
        t.state = 'sprung'; t.nid = a.nid;
        ev = { ev: 'kill', sp: a.species };
      } else {
        a.trap(t, K.hold);
        t.state = 'caught'; t.nid = a.nid;
        ev = { ev: 'held', sp: a.species };
      }
    } else if (a.weight >= K.trigger) {
      t.state = 'sprung'; t.nid = 0;
      a.flee(t.x, t.z, false);
      ev = { ev: 'sprung', sp: a.species };
    } else return;
    this.broadcast(t, ev);
    this.onEvent(t, ev.ev, a.species, a);
  }

  // what happens at a trap, in every player's game (sounds, the owner's news, the journal)
  onEvent(t, ev, species, a) {
    t.shut = Math.min(t.shut, 0.999); // let the jaws animate shut from wherever they were
    if (ev !== 'escaped') G.audio?.trapSnap?.(t);
    if (a && ev === 'kill') a.trapKilled = true;
    if (!this.mine(t)) return;
    const name = SPECIES[species] ? SPECIES[species].name.toLowerCase() : 'animal';
    const d = Math.hypot(t.x - G.player.pos.x, t.z - G.player.pos.z);
    const where = d < 40 ? 'right near you' : `${Math.round(d / 10) * 10} m away — it's on your map (M)`;
    const K = TRAP_KINDS[t.kind];
    if (ev === 'kill') {
      if (a) this.recordKill(a, t);
      G.ui.toast(`Your ${K.size} trap caught a ${name}, ${where}.`, 'good');
    } else if (ev === 'held') {
      G.ui.toast(`A ${name} is caught in your ${K.size} trap, ${where}! It won't stay forever: go and finish it.`, 'good');
    } else if (ev === 'sprung') {
      G.ui.toast(`A ${name} sprang your ${K.size} trap and pulled free (${where}). Pick the trap up to set it again.`, 'info');
    } else if (ev === 'escaped') {
      G.ui.toast(`The ${name} in your ${K.size} trap pulled free and got away.`, 'warn');
    }
  }

  // a catch counts as your harvest, just like a shot
  recordKill(a, t) {
    if (a.harvest) return;
    const entry = {
      type: 'harvest', species: a.species, label: a.label, dist: 0, part: 'vitals', clean: true,
      weight: Math.round(a.weight * 10) / 10, age: a.age, tagged: false, weapon: 'trap', trap: t.kind,
      time: G.env.time, day: G.env.day, weather: G.env.weatherName,
    };
    G.journal.push(entry);
    a.harvest = entry;
    G.ui.discover(a.species, 'harvest');
    saveProgress();
  }

  // a held animal broke out (authority)
  escaped(t, a) {
    t.state = 'sprung'; t.nid = 0;
    const ev = { ev: 'escaped', sp: a.species };
    this.broadcast(t, ev);
    this.onEvent(t, 'escaped', a.species, a);
  }

  // network: a trap placed, changed or caught something in another player's game
  netSet(m) {
    const t = this.set(m);
    if (!t || !m.ev) return;
    const a = m.n ? G.animals.byNid.get(m.n) : null;
    this.onEvent(t, m.ev, m.sp, a);
  }

  // every game, every frame: the jaws
  animate(dt) {
    for (const t of this.traps.values()) {
      // jaws slam shut in a twentieth of a second
      const want = t.state === 'set' ? 0 : 1;
      if (t.shut !== want) {
        t.shut = want ? Math.min(1, t.shut + dt * 20) : 0;
        const ang = (1 - t.shut) * Math.PI / 2;
        t.jawA.rotation.x = ang; t.jawB.rotation.x = ang;
      }
    }
  }

  // the game that runs the animals: has anything stepped on a pan, or died in a trap?
  check() {
    if (!this.authority) return;
    for (const t of this.traps.values()) {
      if (t.state === 'caught') {
        // the animal in it was killed (or is gone): the trap just sits there sprung
        const a = G.animals.byNid.get(t.nid);
        if (!a || !a.active || a.state !== S.TRAPPED) { t.state = 'sprung'; this.broadcast(t); }
        continue;
      }
      if (t.state !== 'set') continue;
      for (const a of G.animals.list) {
        if (!a.active || a.state === S.DOWN || a.state === S.TRAPPED) continue;
        const dx = a.pos.x - t.x, dz = a.pos.z - t.z;
        const r = 0.35 + a.radius * 0.5;
        if (dx * dx + dz * dz < r * r) { this.trigger(t, a); break; }
      }
    }
  }
}
