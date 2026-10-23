// Wild plants and mushrooms to forage. Several are poisonous look-alikes: the player only sees
// a description ("Shiny black berries") until they eat one and find out what it really was.
import * as THREE from 'three';
import { G } from './state.js';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween, jitterVertices } from './geo.js';
import { mulberry32 } from './utils.js';
import { HALF, riverDistance } from './terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// food: hunger restored. poison: { delay, hours, dmg } in game hours / total health lost.
export const FORAGE = {
  blueberry:   { look: 'Small blue-black berries', name: 'Wild blueberries', sci: 'Vaccinium spp.', model: 'berry', color: 0x2c3a78, where: 'edge', food: 8,
    note: 'Safe and nutritious. Look for the small "crown" on the end of each berry.' },
  raspberry:   { look: 'Red clustered berries', name: 'Wild raspberries', sci: 'Rubus idaeus', model: 'berry', color: 0xc0283a, where: 'edge', food: 8,
    note: 'Safe. The hollow berry pulls cleanly off its core.' },
  blackberry:  { look: 'Glossy black clustered berries', name: 'Blackberries', sci: 'Rubus spp.', model: 'berry', color: 0x14101a, where: 'edge', food: 8,
    note: 'Safe. Made of many small drupelets, on thorny canes.' },
  nightshade:  { look: 'Shiny black berries', name: 'Deadly nightshade', sci: 'Atropa belladonna', model: 'berry', color: 0x0a0a10, where: 'forest',
    poison: { delay: 0.3, hours: 2, dmg: 55 }, note: 'Highly toxic: its alkaloids (atropine) cause racing heart, confusion and can be fatal.' },
  pokeweed:    { look: 'Dark purple berries on red stems', name: 'Pokeweed', sci: 'Phytolacca americana', model: 'berry', color: 0x3a1040, stem: 0xb03050, where: 'edge',
    poison: { delay: 0.4, hours: 1.5, dmg: 28 }, note: 'Poisonous berries, roots and leaves; causes severe stomach upset.' },
  baneberry:   { look: 'White berries with black dots', name: 'White baneberry ("doll\'s eyes")', sci: 'Actaea pachypoda', model: 'berry', color: 0xf0f0ea, where: 'forest',
    poison: { delay: 0.2, hours: 1.5, dmg: 30 }, note: 'Toxic to people; affects the heart muscle. Birds can eat them safely.' },
  chanterelle: { look: 'Golden funnel-shaped mushroom', name: 'Golden chanterelle', sci: 'Cantharellus cibarius', model: 'funnel', color: 0xe8a830, where: 'forest', food: 7,
    note: 'A prized edible. Real gill-like ridges run down the stem; grows alone, not in clusters.' },
  jackolantern:{ look: 'Orange mushrooms growing in a cluster', name: 'Jack-o\'-lantern mushroom', sci: 'Omphalotus illudens', model: 'cluster', color: 0xe07020, where: 'forest',
    poison: { delay: 0.5, hours: 2, dmg: 30 }, note: 'A chanterelle look-alike that grows in clusters on wood; causes severe vomiting and cramps. Its gills can glow faintly in the dark.' },
  bolete:      { look: 'Brown-capped mushroom with a thick stem', name: 'King bolete (porcini)', sci: 'Boletus edulis', model: 'bolete', color: 0x8a5a30, where: 'forest', food: 9,
    note: 'A choice edible with a sponge-like underside instead of gills.' },
  deathcap:    { look: 'Pale greenish-capped mushroom', name: 'Death cap', sci: 'Amanita phalloides', model: 'cap', color: 0xc8cfa0, where: 'forest',
    poison: { delay: 3, hours: 4, dmg: 95 }, note: 'Responsible for most fatal mushroom poisonings. Symptoms only start hours later, after the liver is already being damaged.' },
  flyagaric:   { look: 'Red-capped mushroom with white spots', name: 'Fly agaric', sci: 'Amanita muscaria', model: 'spotted', color: 0xc02818, where: 'forest',
    poison: { delay: 0.5, hours: 2, dmg: 25, dizzy: true }, note: 'Poisonous and hallucinogenic; causes dizziness, confusion and vomiting.' },
  apple:       { look: 'Small red-green fruit under a tree', name: 'Wild apples', sci: 'Malus spp.', model: 'fruit', color: 0xb83a28, where: 'meadow', food: 10,
    note: 'Safe, though tart. Avoid swallowing many seeds.' },
  plum:        { look: 'Small purple fruit under a tree', name: 'American wild plums', sci: 'Prunus americana', model: 'fruit', color: 0x5a2a6a, where: 'edge', food: 10,
    note: 'Safe and sweet when ripe; do not eat the stones.' },
  wildcarrot:  { look: 'Carrot-like root with a white flower umbrella and a hairy stem', name: 'Wild carrot (Queen Anne\'s lace)', sci: 'Daucus carota', model: 'umbel', color: 0xf2f0e6, stem: 0x6a8a3a, where: 'meadow', food: 10,
    note: 'Edible root. The hairy stem and carrot smell tell it apart from deadly hemlock — but only experts should rely on that.' },
  hemlock:     { look: 'Carrot-like root with a white flower umbrella and a smooth, purple-blotched stem', name: 'Poison hemlock', sci: 'Conium maculatum', model: 'umbel', color: 0xf2f0e6, stem: 0x5a6a3a, spots: true, where: 'meadow',
    poison: { delay: 0.3, hours: 2, dmg: 80 }, note: 'Extremely toxic: coniine paralyses the muscles, including those used for breathing. It killed the philosopher Socrates.' },
  wildonion:   { look: 'Slender grass-like plant with small bulbs', name: 'Wild onion', sci: 'Allium canadense', model: 'onion', color: 0xe8e0f0, where: 'meadow', food: 5,
    note: 'Edible; it smells of onion. Look-alikes without the smell (like death camas) are poisonous.' },
  cattail:     { look: 'Tall reed with a brown spike, by the water', name: 'Cattail', sci: 'Typha latifolia', model: 'reed', color: 0x6a4a2a, where: 'water', food: 8,
    note: 'Edible shoots and starchy roots; a classic survival food.' },
};

const COUNT = { edge: 9, forest: 8, meadow: 9, water: 10 };

function buildModel(type) {
  const f = FORAGE[type];
  const p = [];
  const leaf = 0x3e6a2a;
  switch (f.model) {
    case 'berry': {
      for (const [x, y, z, r] of [[0, 0.3, 0, 0.35], [0.25, 0.25, 0.1, 0.25], [-0.2, 0.25, -0.1, 0.28]]) {
        const g = new THREE.IcosahedronGeometry(r, 1); xf(g, x, y, z); jitterVertices(g, 0.08, x * 10 + 3);
        p.push(colorize(g, leaf, 0.15));
      }
      for (let i = 0; i < 16; i++) {
        const a = i * 2.4, h = 0.18 + (i % 5) * 0.08, r = 0.28 + (i % 3) * 0.06;
        if (f.stem) p.push(cylinderBetween(V(Math.cos(a) * r * 0.6, h - 0.1, Math.sin(a) * r * 0.6), V(Math.cos(a) * r, h, Math.sin(a) * r), 0.008, 0.006, 3, f.stem));
        p.push(ellipsoid(Math.cos(a) * r, h, Math.sin(a) * r, 0.035, 0.035, 0.035, f.color, 5, 4));
        if (type === 'baneberry') p.push(ellipsoid(Math.cos(a) * (r + 0.03), h, Math.sin(a) * (r + 0.03), 0.012, 0.012, 0.012, 0x101010, 4, 3));
      }
      break;
    }
    case 'funnel': case 'cap': case 'spotted': case 'bolete': {
      const big = f.model === 'bolete' ? 1.3 : 1;
      p.push(cylinderBetween(V(0, 0, 0), V(0, 0.09 * big, 0), 0.02 * big * (f.model === 'bolete' ? 1.8 : 1), 0.016 * big, 6, f.model === 'funnel' ? f.color : 0xe8e2d0));
      if (f.model === 'funnel') p.push(colorize(xf(new THREE.ConeGeometry(0.07, 0.06, 9, 1, true), 0, 0.11, 0, Math.PI, 0, 0), f.color));
      else p.push(ellipsoid(0, 0.095 * big, 0, 0.07 * big, 0.035 * big, 0.07 * big, f.color, 10, 6));
      if (f.model === 'spotted') for (let i = 0; i < 7; i++) { const a = i * 0.9; p.push(ellipsoid(Math.cos(a) * 0.04, 0.12, Math.sin(a) * 0.04, 0.009, 0.006, 0.009, 0xf4f0e8, 4, 3)); }
      if (f.model === 'cap') p.push(ellipsoid(0, 0.06, 0, 0.03, 0.008, 0.03, 0xf0f0e0, 6, 3)); // ring
      break;
    }
    case 'cluster':
      for (const [x, z, s] of [[0, 0, 1], [0.06, 0.04, 0.8], [-0.05, 0.05, 0.85], [0.03, -0.06, 0.75], [-0.04, -0.04, 0.7]]) {
        p.push(cylinderBetween(V(x * 0.4, 0, z * 0.4), V(x, 0.1 * s, z), 0.012, 0.01, 5, f.color));
        p.push(colorize(xf(new THREE.ConeGeometry(0.05 * s, 0.04, 8, 1, true), x, 0.115 * s, z, Math.PI, 0, 0), f.color));
      }
      p.push(colorize(xf(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6), 0.02, 0.0, 0.02, Math.PI / 2, 0.5, 0), 0x4a3828)); // rotting wood
      break;
    case 'fruit':
      p.push(cylinderBetween(V(0, 0, 0), V(0, 1.4, 0), 0.05, 0.035, 5, 0x5a4430));
      for (const [x, y, z, r] of [[0, 1.6, 0, 0.5], [0.3, 1.4, 0.2, 0.35], [-0.25, 1.45, -0.15, 0.38]]) { const g = new THREE.IcosahedronGeometry(r, 1); xf(g, x, y, z); jitterVertices(g, 0.1, x + 7); p.push(colorize(g, 0x4a7a32, 0.15)); }
      for (let i = 0; i < 6; i++) { const a = i * 1.7; p.push(ellipsoid(Math.cos(a) * 0.35, 0.03, Math.sin(a) * 0.35, 0.035, 0.035, 0.035, f.color, 6, 5)); }
      for (let i = 0; i < 5; i++) { const a = i * 2.1 + 0.3; p.push(ellipsoid(Math.cos(a) * 0.4, 1.45, Math.sin(a) * 0.4, 0.035, 0.035, 0.035, f.color, 6, 5)); }
      break;
    case 'umbel':
      for (const [x, z, h] of [[0, 0, 0.75], [0.12, 0.08, 0.6], [-0.1, 0.06, 0.65]]) {
        p.push(cylinderBetween(V(x, 0, z), V(x, h, z), 0.012, 0.009, 5, f.stem));
        if (f.spots) for (let i = 0; i < 4; i++) p.push(ellipsoid(x + 0.011, 0.12 + i * 0.13, z, 0.004, 0.02, 0.008, 0x6a2050, 4, 3));
        p.push(ellipsoid(x, h, z, 0.1, 0.018, 0.1, f.color, 10, 4));
      }
      for (let i = 0; i < 5; i++) { const a = i * 1.3; p.push(colorize(xf(new THREE.ConeGeometry(0.05, 0.25, 4), Math.cos(a) * 0.1, 0.1, Math.sin(a) * 0.1, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6), 0x5a7a34)); }
      break;
    case 'onion':
      for (let i = 0; i < 7; i++) { const a = i * 0.9; p.push(cylinderBetween(V(0, 0, 0), V(Math.cos(a) * 0.05, 0.35, Math.sin(a) * 0.05), 0.006, 0.003, 3, 0x5a8a3a)); }
      for (const [x, z] of [[0.04, 0], [-0.03, 0.03]]) { p.push(cylinderBetween(V(0, 0, 0), V(x, 0.42, z), 0.004, 0.003, 3, 0x5a8a3a)); p.push(ellipsoid(x, 0.44, z, 0.025, 0.025, 0.025, f.color, 6, 4)); }
      break;
    case 'reed':
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05, x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12;
        p.push(cylinderBetween(V(x, 0, z), V(x * 1.3, 1.5, z * 1.3), 0.012, 0.008, 4, 0x6a8a3a));
        if (i % 2 === 0) p.push(ellipsoid(x * 1.25, 1.25, z * 1.25, 0.03, 0.12, 0.03, f.color, 6, 4));
      }
      break;
  }
  return mergeColored(p);
}

export class ForageManager {
  constructor(scene, world) {
    this.world = world;
    this.nodes = [];
    this.meshes = {};
    const T = world.terrain, rng = mulberry32(9090);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V(0, 1, 0);
    for (const type in FORAGE) {
      const f = FORAGE[type];
      const n = COUNT[f.where];
      const spots = [];
      for (let tries = 0; spots.length < n && tries < 600; tries++) {
        let x, z;
        if (f.model === 'berry' && world.veg.bushes.length && rng() < 0.7) {
          const b = world.veg.bushes[Math.floor(rng() * world.veg.bushes.length)];
          x = b.x + (rng() - 0.5) * 3; z = b.z + (rng() - 0.5) * 3;
        } else { x = (rng() * 2 - 1) * (HALF - 40); z = (rng() * 2 - 1) * (HALF - 40); }
        const h = T.getHeight(x, z), d = T.densityAt(x, z);
        if (h < 0.3) continue;
        let ok;
        switch (f.where) {
          case 'edge': ok = d > 0.15 && d < 0.6; break;
          case 'forest': ok = d > 0.55; break;
          case 'meadow': ok = d < 0.2 && T.trailAt(x, z) > 2; break;
          case 'water': { const rd = riverDistance(x, z); ok = rd > 0.3 && rd < 5; break; }
        }
        if (!ok) continue;
        if (world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 8)) continue;
        spots.push({ x, z, y: h, r: rng() * 6.28, s: 0.85 + rng() * 0.3 });
      }
      const mesh = new THREE.InstancedMesh(buildModel(type), mat, Math.max(1, spots.length));
      mesh.count = spots.length;
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.r);
        m4.compose(V(sp.x, sp.y - 0.02, sp.z), q, V(sp.s, sp.s, sp.s));
        mesh.setMatrixAt(i, m4);
        this.nodes.push({ type, i, x: sp.x, z: sp.z, y: sp.y, s: sp.s, r: sp.r, picked: false, respawnAt: 0, mesh });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      scene.add(mesh);
      this.meshes[type] = mesh;
    }
    this._m4 = m4; this._q = q;
  }

  nearest(x, z, maxD) {
    let best = null, bd = maxD;
    for (const n of this.nodes) {
      if (n.picked) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  pick(node) {
    node.picked = true;
    node.respawnAt = G.env.totalHours + 18 + Math.random() * 12;
    node.mesh.setMatrixAt(node.i, new THREE.Matrix4().makeScale(0, 0, 0));
    node.mesh.instanceMatrix.needsUpdate = true;
  }

  update() {
    const now = G.env.totalHours;
    for (const n of this.nodes) {
      if (!n.picked || now < n.respawnAt) continue;
      n.picked = false;
      this._q.setFromAxisAngle(V(0, 1, 0), n.r);
      this._m4.compose(V(n.x, n.y - 0.02, n.z), this._q, V(n.s, n.s, n.s));
      n.mesh.setMatrixAt(n.i, this._m4);
      n.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
