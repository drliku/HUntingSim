// Supply crates: scattered around the map, each holds a weapon of a random rarity.
// In PvP the host decides where crates appear; whoever opens one first gets it.
import * as THREE from 'three';
import { G } from './state.js';
import { colorize, mergeColored, xf } from './geo.js';
import { RARITY, RARITY_WEAPONS, rollRarity } from './rarity.js';
import { WEAPONS } from './equipment.js';

const SPOTS = [
  [-90, -20], [-120, 40], [-60, 110], [10, 120], [60, 150], [150, 80], [180, -20], [120, -90], [60, -120], [-20, -140],
  [-110, -90], [-170, -40], [-160, 100], [90, 20], [30, -40], [-70, 60], [200, 150], [-200, -180], [150, -170], [-30, 190],
  [100, 190], [-140, 170], [205, 60], [-205, 20],
];
const MAX_ACTIVE = 5;

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

  fill() { if (!this.authority) return; let guard = 0; while (this.activeList().length < MAX_ACTIVE && guard++ < 20) this.spawnOne(); }

  update(dt) {
    if (!this.authority || !G.started) return;
    if (this.activeList().length >= MAX_ACTIVE) return;
    this.respawnT -= dt;
    if (this.respawnT <= 0) { this.respawnT = 90 + Math.random() * 120; this.spawnOne(); }
  }

  nearest(x, z, r) {
    let best = -1, bd = r;
    this.spots.forEach((s, i) => { if (!s.active) return; const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // Open a crate: a random weapon at a random rarity
  open(i) {
    const s = this.spots[i];
    if (!s || !s.active) return;
    this.show(i, false);
    G.net?.crate(i, false);
    G.audio?.strike();
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
      line = `A ${R.name.toLowerCase()} ${name.toLowerCase()} — no better than yours, so you take its ammo${G.mode === 'survival' ? ` and $${cash}` : ''}.`;
    }
    G.ui.lootBanner(tier, `${R.name} ${WEAPONS[item].name.split(' · ')[0]}`, line);
    if (!this.authority) return;
    if (this.respawnT > 150) this.respawnT = 150;
  }
}
