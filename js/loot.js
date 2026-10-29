// Supply crates: scattered around the map, each holds a weapon of a random rarity or a bundle of
// supplies (ammunition, food, medicine, firewood, cash). In PvP there are more of them, the host
// decides where they appear and whoever opens one first gets it; every few minutes a supply drop
// also parachutes in under a column of orange smoke, announced to everyone and marked on the map,
// with a Rare-or-better weapon and good supplies inside. Opening a supply drop takes a few seconds.
import * as THREE from 'three';
import { G } from './state.js';
import { colorize, mergeColored, xf } from './geo.js';
import { RARITY, RARITY_WEAPONS, rollRarity } from './rarity.js';
import { WEAPONS } from './equipment.js';
import { LOCATIONS } from './world.js';

const SPOTS = [
  [-90, -20], [-120, 40], [-60, 110], [10, 120], [60, 150], [150, 80], [180, -20], [120, -90], [60, -120], [-20, -140],
  [-110, -90], [-170, -40], [-160, 100], [90, 20], [30, -40], [-70, 60], [200, 150], [-200, -180], [150, -170], [-30, 190],
  [100, 190], [-140, 170], [205, 60], [-205, 20],
];
const MAX_ACTIVE = 5, MAX_ACTIVE_PVP = 8;
const GUNS = ['rifle', 'shotgun', 'pistol', 'bow'];

function crateGeometry() {
  const p = [];
  const b = (w, h, d, x, y, z, c) => p.push(colorize(xf(new THREE.BoxGeometry(w, h, d), x, y, z), c));
  b(0.9, 0.55, 0.6, 0, 0.275, 0, 0x6a5232);
  b(0.94, 0.08, 0.64, 0, 0.58, 0, 0x5a4428);           // lid
  for (const x of [-0.42, 0.42]) b(0.06, 0.6, 0.62, x, 0.3, 0, 0x4a3a22);
  for (const y of [0.12, 0.44]) b(0.92, 0.05, 0.62, 0, y, 0, 0x4a3a22);
  b(0.5, 0.12, 0.005, 0, 0.3, 0.303, 0xd8b030);         // yellow supply band
  b(0.5, 0.12, 0.005, 0, 0.3, -0.303, 0xd8b030);
  for (const x of [-0.3, 0.3]) b(0.06, 0.05, 0.08, x, 0.6, 0.31, 0x3a3a3c);
  return mergeColored(p);
}

export class Crates {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    const T = world.terrain;
    this.spots = [];
    for (const [sx, sz] of SPOTS) {
      // move onto dry, open ground away from buildings
      let best = null;
      for (let k = 0; k < 24 && !best; k++) {
        const a = k * 2.4, r = k * 2.5;
        const x = sx + Math.cos(a) * r, z = sz + Math.sin(a) * r;
        if (T.getHeight(x, z) < 0.8) continue;
        if (world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 14)) continue;
        best = [x, z];
      }
      if (best) this.spots.push({ x: best[0], z: best[1], y: T.getHeight(best[0], best[1]), active: false, mesh: null });
    }
    this.geo = crateGeometry();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.respawnT = 60;
  }

  get authority() { return !G.net || G.net.isHost; }
  get maxActive() { return G.net ? MAX_ACTIVE_PVP : MAX_ACTIVE; }
  activeList() { return this.spots.map((s, i) => (s.active ? i : -1)).filter((i) => i >= 0); }

  show(i, on) {
    const s = this.spots[i];
    if (!s || s.active === on) return;
    s.active = on;
    if (on) {
      if (!s.mesh) {
        s.mesh = new THREE.Mesh(this.geo, this.mat);
        s.mesh.position.set(s.x, s.y, s.z);
        s.mesh.rotation.y = (i * 1.7) % 6.28;
        s.mesh.castShadow = true; s.mesh.receiveShadow = true;
      }
      this.scene.add(s.mesh);
    } else if (s.mesh) this.scene.remove(s.mesh);
  }

  clear() { this.spots.forEach((s, i) => this.show(i, false)); }

  // spawn a crate somewhere nobody is standing
  spawnOne() {
    const P = G.player.pos;
    const players = [P, ...(G.net ? [...G.net.players.values()].map((p) => p.pos) : [])];
    const free = this.spots.map((s, i) => i).filter((i) => !this.spots[i].active && players.every((p) => Math.hypot(p.x - this.spots[i].x, p.z - this.spots[i].z) > 45));
    if (!free.length) return;
    const i = free[Math.floor(Math.random() * free.length)];
    this.show(i, true);
    G.net?.crate(i, true);
  }

  fill() { if (!this.authority) return; let guard = 0; while (this.activeList().length < this.maxActive && guard++ < 20) this.spawnOne(); }

  update(dt) {
    if (!this.authority || !G.started) return;
    if (this.activeList().length >= this.maxActive) return;
    this.respawnT -= dt;
    if (this.respawnT <= 0) { this.respawnT = 90 + Math.random() * 120; this.spawnOne(); }
  }

  nearest(x, z, r) {
    let best = -1, bd = r;
    this.spots.forEach((s, i) => { if (!s.active) return; const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // Open a crate: a random weapon at a random rarity, or (in survival and PvP, half the time) supplies
  open(i) {
    const s = this.spots[i];
    if (!s || !s.active) return;
    this.show(i, false);
    G.net?.crate(i, false);
    G.audio?.strike();
    if (this.authority && this.respawnT > 150) this.respawnT = 150;
    if (G.mode === 'survival' && Math.random() < 0.5) { const got = grantSupplies(1); G.ui.lootBanner(0, 'Supplies', `Inside: ${got}.`); return; }
    const item = RARITY_WEAPONS[Math.floor(Math.random() * RARITY_WEAPONS.length)];
    const tier = rollRarity();
    const eq = G.equipment;
    const res = eq.grantWeapon(item, tier);
    const R = RARITY[tier], name = WEAPONS[item].short;
    let line;
    if (res === 'new') line = `New weapon: ${R.name} ${name.toLowerCase()} (press ${['rifle', 'shotgun', 'pistol', 'bow'].indexOf(item) + 1}).`;
    else if (res === 'upgrade') line = `Your ${name.toLowerCase()} is now ${R.name}!`;
    else {
      const cash = 10 + tier * 12;
      if (G.mode === 'survival') G.survival.money += cash;
      line = `${/^[aeiou]/i.test(R.name) ? "An" : "A"} ${R.name.toLowerCase()} ${name.toLowerCase()} — no better than yours, so you take its ammo${G.mode === 'survival' ? ` and $${cash}` : ''}.`;
    }
    G.ui.lootBanner(tier, `${R.name} ${WEAPONS[item].name.split(' · ')[0]}`, line);
  }
}

// A bundle of supplies, straight into the player's pack; size 1 = crate, 2 = supply drop.
// Returns a description of what was inside.
export function grantSupplies(size) {
  const S = G.survival, E = G.equipment, got = [];
  const owned = GUNS.filter((g) => E.owned[g]);
  const ammoFor = (n) => {
    // usually ammunition for a gun you already have
    const pool = owned.length && Math.random() < 0.8 ? owned : GUNS;
    const g = pool[Math.floor(Math.random() * pool.length)];
    E.ammo[g].reserve += n; got.push(`${n} ${WEAPONS[g].ammo}`);
  };
  const picks = [
    () => ammoFor(size > 1 ? 15 : 6 + Math.floor(Math.random() * 5)),
    () => { const n = size > 1 ? 2 : 1 + Math.floor(Math.random() * 2); S.items.beans = (S.items.beans || 0) + n; got.push(`${n} × can of beans`); },
    () => { const n = size > 1 ? 2 : 1; S.items.bandage = (S.items.bandage || 0) + n; got.push(`${n} × bandage`); },
    () => { S.items.medkit = (S.items.medkit || 0) + 1; got.push('a first-aid kit'); },
    () => { const n = Math.min(3, 12 - S.wood); if (n > 0) { S.wood += n; got.push(`${n} firewood`); } },
    () => { const n = size > 1 ? 60 : 15 + Math.floor(Math.random() * 26); S.money += n; got.push(`$${n}`); },
  ];
  if (size > 1) [0, 1, 2, 3, 5].forEach((i) => picks[i]());
  else {
    const order = [0, 0, 1, 2, 4, 5, 3].sort(() => Math.random() - 0.5);
    const n = 2 + (Math.random() < 0.4 ? 1 : 0), done = new Set();
    for (const i of order) { if (done.size >= n) break; if (i === 3 && Math.random() < 0.6) continue; if (done.has(i)) continue; done.add(i); picks[i](); }
  }
  return got.join(', ');
}

// ---------- supply drops (PvP) ----------
const DROP_FALL = 14;   // seconds under the parachute
const DROP_HEIGHT = 70;
const DROP_LIFE = 480;  // an unopened drop is taken away after this long
export const OPEN_TIME = 3;

function smokeTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const cx = cv.getContext('2d'), g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class AirDrops {
  constructor(scene, crates) {
    this.scene = scene;
    this.crates = crates;
    this.drops = new Map();
    this.timer = 150;
    this.smokeTex = null;
    // big crate with red bands, and a parachute
    const p = [];
    const b = (w, h, d, x, y, z, c) => p.push(colorize(xf(new THREE.BoxGeometry(w, h, d), x, y, z), c));
    b(1.3, 0.8, 0.9, 0, 0.4, 0, 0x4a5a3a);
    b(1.34, 0.1, 0.94, 0, 0.84, 0, 0x3e4c30);
    for (const x of [-0.6, 0.6]) b(0.08, 0.86, 0.92, x, 0.43, 0, 0x2e3824);
    for (const z of [-0.46, 0.46]) b(1.0, 0.18, 0.01, 0, 0.45, z, 0xc83a2a);
    b(0.01, 0.18, 0.6, 0.66, 0.45, 0, 0xc83a2a); b(0.01, 0.18, 0.6, -0.66, 0.45, 0, 0xc83a2a);
    this.crateGeo = mergeColored(p);
    const canopy = new THREE.SphereGeometry(3.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6);
    const cols = canopy.attributes.position.count, cc = new Float32Array(cols * 3);
    for (let i = 0; i < cols; i++) {
      const a = Math.atan2(canopy.attributes.position.getZ(i), canopy.attributes.position.getX(i));
      const stripe = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2;
      const c = new THREE.Color(stripe ? 0xe8e2d4 : 0xd86a2a); cc[i * 3] = c.r; cc[i * 3 + 1] = c.g; cc[i * 3 + 2] = c.b;
    }
    canopy.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    this.chuteGeo = canopy;
    this.crateMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.chuteMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x2a2620 });
  }

  get authority() { return G.net && G.net.isHost; }
  list() { return [...this.drops.values()].map((d) => ({ id: d.id, x: d.x, z: d.z, t: Math.round(d.t * 10) / 10 })); }

  // the host picks a spot away from everyone and tells the other players
  launch() {
    const T = G.world.terrain;
    const players = [G.player.pos, ...[...G.net.players.values()].map((p) => p.pos)];
    for (let k = 0; k < 60; k++) {
      const x = (Math.random() - 0.5) * 420, z = (Math.random() - 0.5) * 420;
      if (T.getHeight(x, z) < 1) continue;
      if (G.world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 18)) continue;
      if (players.some((p) => Math.hypot(p.x - x, p.z - z) < 70)) continue;
      const id = 'ad' + Math.floor(Math.random() * 1e9);
      this.add(id, Math.round(x * 10) / 10, Math.round(z * 10) / 10, 0);
      G.net.send({ t: 'airdrop', a: 'add', id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
      return;
    }
  }

  add(id, x, z, t = 0, announce = true) {
    if (this.drops.has(id)) return;
    const y = G.world.terrain.getHeight(x, z);
    const group = new THREE.Group();
    const crate = new THREE.Mesh(this.crateGeo, this.crateMat);
    crate.castShadow = true;
    group.add(crate);
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(this.chuteGeo, this.chuteMat);
    canopy.position.y = 5.2;
    canopy.scale.y = 0.75;
    chute.add(canopy);
    const pts = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 0.5, 0.86, Math.sin(a) * 0.35), new THREE.Vector3(Math.cos(a) * 2.6, 6.0, Math.sin(a) * 2.6)); }
    chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), this.lineMat));
    group.add(chute);
    // orange smoke from a flare on the crate: rises high and drifts with the wind
    if (!this.smokeTex) this.smokeTex = smokeTexture();
    const puffs = [];
    for (let i = 0; i < 26; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xff7a2a, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      sp.visible = false;
      this.scene.add(sp);
      puffs.push({ sp, life: i / 26 });
    }
    this.scene.add(group);
    const d = { id, x, z, y, t, group, chute, puffs, opened: false };
    this.drops.set(id, d);
    this.place(d);
    if (announce) {
      const near = LOCATIONS.reduce((a, l) => (Math.hypot(l.x - x, l.z - z) < Math.hypot(a.x - x, a.z - z) ? l : a), LOCATIONS[0]);
      const dist = Math.round(Math.hypot(G.player.pos.x - x, G.player.pos.z - z));
      G.ui.toast(`A supply drop is coming down near ${near.name} (${dist} m away) — follow the orange smoke. It's marked on your map (M). First to open it gets a Rare-or-better weapon.`, 'warn');
      G.audio?.distantShot?.({ x, y: y + 40, z });
    }
  }

  place(d) {
    const fall = Math.max(0, 1 - d.t / DROP_FALL);
    d.group.position.set(d.x, d.y + fall * DROP_HEIGHT, d.z);
    d.group.rotation.z = Math.sin(d.t * 0.9) * 0.08 * fall;
    d.landed = fall <= 0;
    // the parachute collapses once the crate is down
    const k = d.landed ? Math.max(0, 1 - (d.t - DROP_FALL) / 2.5) : 1;
    d.chute.visible = k > 0;
    d.chute.scale.set(1, Math.max(0.05, k), 1);
  }

  remove(id, broadcast = false) {
    const d = this.drops.get(id);
    if (!d) return;
    this.scene.remove(d.group);
    for (const p of d.puffs) { this.scene.remove(p.sp); p.sp.material.dispose(); }
    this.drops.delete(id);
    if (broadcast) G.net?.send({ t: 'airdrop', a: 'del', id });
  }

  clear() { for (const id of [...this.drops.keys()]) this.remove(id); }

  nearestLanded(x, z, r) {
    let best = null, bd = r;
    for (const d of this.drops.values()) { if (!d.landed) continue; const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  // whoever finishes opening it first: weapon + supplies
  open(d) {
    if (!this.drops.has(d.id)) return;
    this.remove(d.id, true);
    G.net?.send({ t: 'airdrop', a: 'opened', id: d.id, name: G.net.name });
    G.audio?.strike();
    const r = Math.random(), tier = r < 0.15 ? 4 : r < 0.5 ? 3 : 2;
    const item = RARITY_WEAPONS[Math.floor(Math.random() * RARITY_WEAPONS.length)];
    const res = G.equipment.grantWeapon(item, tier);
    const name = WEAPONS[item].short.toLowerCase();
    const sup = grantSupplies(2);
    const wl = res === 'new' ? `New ${name}` : res === 'upgrade' ? `Your ${name} upgraded` : `${name} ammo (yours is as good)`;
    G.ui.lootBanner(tier, `${RARITY[tier].name} ${WEAPONS[item].name.split(' · ')[0]}`, `Supply drop! ${wl}, plus ${sup}.`);
  }

  update(dt, wind) {
    if (G.net && this.authority && G.started) {
      if ((this.timer -= dt) <= 0) { this.timer = 240 + Math.random() * 120; if (this.drops.size < 2) this.launch(); }
    }
    for (const d of [...this.drops.values()]) {
      d.t += dt;
      if (d.t > DROP_LIFE && this.authority) { this.remove(d.id, true); continue; }
      this.place(d);
      const top = d.group.position.y + 0.9;
      for (const p of d.puffs) {
        p.life += dt / 7;
        if (p.life >= 1) p.life -= 1;
        const l = p.life, sp = p.sp;
        sp.visible = true;
        sp.position.set(d.x + (wind ? wind.x : 0.5) * l * l * 9 + Math.sin(l * 9 + d.x) * 0.4, top + l * 26, d.z + (wind ? wind.z : 0.2) * l * l * 9);
        sp.scale.setScalar(0.8 + l * 7);
        sp.material.opacity = Math.min(1, l * 8) * (1 - l) * 0.55 * (d.landed ? 1 : 0.6);
      }
    }
  }
}
