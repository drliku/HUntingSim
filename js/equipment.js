// First-person equipment: rifle (scope), pump shotgun, revolver, recurve bow, hunting knife,
// binoculars, corn bait and a game call. Ballistic hitscan for bullets and pellets, real
// projectiles for arrows, per-weapon ammunition, recoil and reload animations.
import * as THREE from 'three';
import { G, settings, saveProgress } from './state.js';
import { clamp, damp, lerp, smoothstep } from './utils.js';
import { RARITY, rarityMap, recolor } from './rarity.js';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween } from './geo.js';
import { S } from './animals.js';
import { SPECIES } from './species.js';

const GRAVITY = 9.81;

// Order defines the number keys 1–8.
export const ITEMS = ['rifle', 'shotgun', 'pistol', 'bow', 'knife', 'binoculars', 'bait', 'call'];

export const WEAPONS = {
  rifle:   { name: 'Bolt-action rifle · .308', short: 'Rifle', gun: true, magSize: 5, velocity: 820, hip: 0.03, ads: 0.0004, zoom: 4, cycle: 1.15, reload: 2.4, loud: 420, pellets: 1, power: 'rifle', ammo: '.308 cartridges' },
  shotgun: { name: 'Pump shotgun · 12 gauge', short: 'Shotgun', gun: true, magSize: 5, velocity: 380, hip: 0.075, ads: 0.05, zoom: 1.3, cycle: 0.75, reload: 0.55, perShell: true, loud: 360, pellets: 9, range: 60, power: 'shot', ammo: 'shells' },
  pistol:  { name: 'Revolver · .357 Magnum', short: 'Revolver', gun: true, magSize: 6, velocity: 400, hip: 0.035, ads: 0.008, zoom: 1.8, cycle: 0.38, reload: 2.2, loud: 300, pellets: 1, power: 'pistol', ammo: '.357 rounds' },
  bow:     { name: 'Recurve bow', short: 'Bow', bow: true, zoom: 1.3, power: 'arrow', ammo: 'arrows' },
  knife:   { name: 'Hunting knife · click to strike', short: 'Knife' },
  binoculars: { name: 'Binoculars · 4–12× rangefinder', short: 'Binoculars', zoom: 8 },
  bait:    { name: 'Deer corn bait · click to place', short: 'Bait', ammo: 'bags' },
  call:    { name: 'Grunt call · click to call', short: 'Call' },
};

function part(geo, color, x, y, z, rx = 0, ry = 0, rz = 0) { return colorize(xf(geo, x, y, z, rx, ry, rz), color); }
const glove = 0x3b3a30, sleeve = 0x4a4f3a;
// stock (wood) and metal colours of each first-person weapon, for rarity finishes
const VM_COLORS = {
  rifle: { wood: [0x5b3a22, 0x4a2e1a], metal: [0x26282b, 0x3a3d41] },
  shotgun: { wood: [0x6a4428, 0x5a3a22], metal: [0x2a2c2e, 0x45484c] },
  pistol: { wood: [0x5a3a22], metal: [0x2a2c30, 0x4a4e54] },
  bow: { wood: [0x6a3e22, 0x4a2a16], metal: [] },
};
const POWER_ITEM = { rifle: 'rifle', shot: 'shotgun', pistol: 'pistol', arrow: 'bow' };

function buildRifle() {
  const wood = 0x5b3a22, woodD = 0x4a2e1a, metal = 0x26282b, metalL = 0x3a3d41;
  const p = [];
  p.push(part(new THREE.BoxGeometry(0.042, 0.12, 0.26), wood, 0, -0.045, 0.31, -0.08));
  p.push(part(new THREE.BoxGeometry(0.046, 0.13, 0.03), 0x1a1a1a, 0, -0.05, 0.445, -0.08));
  p.push(part(new THREE.BoxGeometry(0.038, 0.06, 0.14), woodD, 0, -0.012, 0.13, -0.18));
  p.push(part(new THREE.BoxGeometry(0.044, 0.05, 0.42), wood, 0, -0.005, -0.2));
  p.push(part(new THREE.BoxGeometry(0.03, 0.025, 0.06), woodD, 0, 0.03, 0.29));
  p.push(part(new THREE.CylinderGeometry(0.017, 0.017, 0.24, 10), metal, 0, 0.026, 0.0, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.0095, 0.012, 0.62, 10), metal, 0, 0.028, -0.42, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), metalL, 0, 0.028, -0.735, Math.PI / 2));
  p.push(part(new THREE.TorusGeometry(0.022, 0.004, 4, 10, Math.PI), metal, 0, -0.03, 0.06, 0, Math.PI / 2, Math.PI));
  p.push(part(new THREE.BoxGeometry(0.026, 0.035, 0.018), metal, 0, 0.055, -0.06));
  p.push(part(new THREE.BoxGeometry(0.026, 0.035, 0.018), metal, 0, 0.055, 0.07));
  p.push(part(new THREE.CylinderGeometry(0.0155, 0.0155, 0.26, 14), metal, 0, 0.083, 0.0, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.025, 0.0155, 0.08, 14), metal, 0, 0.083, -0.165, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 14), metal, 0, 0.083, -0.225, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.019, 0.0155, 0.06, 14), metal, 0, 0.083, 0.155, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.021, 0.021, 0.05, 14), metalL, 0, 0.083, 0.205, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.011, 0.011, 0.025, 8), metalL, 0, 0.108, 0.0));
  p.push(part(new THREE.CircleGeometry(0.022, 14), 0x3a5a7a, 0, 0.083, -0.246, 0, Math.PI));
  return mergeColored(p);
}

function buildTwoHands(frontZ = -0.22) {
  const p = [];
  p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), 0.012, -0.03, 0.13, 0, 0, 0, 0.035, 0.045, 0.06), glove));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 8), 0.05, -0.1, 0.27, -1.1, 0, 0.35), sleeve));
  p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), -0.005, -0.035, frontZ, 0, 0, 0, 0.04, 0.035, 0.07), glove));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.04, 0.05, 0.34, 8), -0.08, -0.12, frontZ + 0.14, -1.25, 0, -0.6), sleeve));
  return mergeColored(p);
}

function buildShotgun() {
  const wood = 0x6a4428, metal = 0x2a2c2e, metalL = 0x45484c;
  const p = [];
  p.push(part(new THREE.BoxGeometry(0.044, 0.12, 0.28), wood, 0, -0.05, 0.3, -0.12));
  p.push(part(new THREE.BoxGeometry(0.046, 0.13, 0.03), 0x1a1a1a, 0, -0.065, 0.445, -0.12));
  p.push(part(new THREE.BoxGeometry(0.04, 0.07, 0.2), metal, 0, 0.0, 0.06));                 // receiver
  p.push(part(new THREE.CylinderGeometry(0.013, 0.013, 0.66, 10), metal, 0, 0.022, -0.38, Math.PI / 2));   // barrel
  p.push(part(new THREE.CylinderGeometry(0.011, 0.011, 0.5, 8), metalL, 0, -0.008, -0.3, Math.PI / 2));    // magazine tube
  p.push(part(new THREE.SphereGeometry(0.006, 6, 4), 0xd8c070, 0, 0.038, -0.7));            // bead sight
  p.push(part(new THREE.TorusGeometry(0.022, 0.004, 4, 10, Math.PI), metal, 0, -0.04, 0.08, 0, Math.PI / 2, Math.PI));
  return mergeColored(p);
}

function buildPump() {
  return part(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 10), 0x5a3a22, 0, 0, 0, Math.PI / 2);
}

function buildPistol() {
  const metal = 0x2a2c30, metalL = 0x4a4e54, grip = 0x5a3a22;
  const p = [];
  p.push(part(new THREE.CylinderGeometry(0.009, 0.009, 0.15, 10), metal, 0, 0.02, -0.1, Math.PI / 2));  // barrel
  p.push(part(new THREE.BoxGeometry(0.018, 0.012, 0.15), metal, 0, 0.032, -0.1));              // rib
  p.push(part(new THREE.CylinderGeometry(0.021, 0.021, 0.042, 12), metalL, 0, 0.012, -0.01, Math.PI / 2)); // cylinder
  p.push(part(new THREE.BoxGeometry(0.024, 0.04, 0.07), metal, 0, 0.01, 0.03));                // frame
  p.push(part(new THREE.BoxGeometry(0.026, 0.085, 0.035), grip, 0, -0.035, 0.065, -0.3));      // grip
  p.push(part(new THREE.TorusGeometry(0.014, 0.003, 4, 8, Math.PI), metal, 0, -0.012, 0.025, 0, Math.PI / 2, Math.PI));
  p.push(part(new THREE.BoxGeometry(0.004, 0.01, 0.006), metal, 0, 0.042, -0.17));             // front sight
  for (const sx of [-0.0065, 0.0065]) p.push(part(new THREE.BoxGeometry(0.005, 0.012, 0.006), metal, sx, 0.043, 0.035)); // rear notch
  // hand wrapped around the grip, forearm dropping away below the line of sight
  p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), 0, -0.05, 0.072, -0.3, 0, 0, 0.028, 0.042, 0.03), glove));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.03, 0.04, 0.26, 8), 0.0, -0.2, 0.13, -0.45, 0, 0), sleeve));
  return mergeColored(p);
}

// Recurve bow: grip at origin, limbs curve along ±y, string at z = +limb offset
function buildBow() {
  const wood = 0x6a3e22, woodD = 0x4a2a16;
  const p = [];
  p.push(part(new THREE.BoxGeometry(0.03, 0.12, 0.035), woodD, 0, 0, 0));
  const pts = [[0, 0.06, 0], [0, 0.2, 0.035], [0, 0.34, 0.05], [0, 0.44, 0.02], [0, 0.5, -0.03]];
  for (const sy of [1, -1]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = new THREE.Vector3(pts[i][0], pts[i][1] * sy, pts[i][2]), b = new THREE.Vector3(pts[i + 1][0], pts[i + 1][1] * sy, pts[i + 1][2]);
      const len = a.distanceTo(b);
      const g = new THREE.BoxGeometry(0.022 - i * 0.003, len, 0.012);
      g.translate(0, len / 2, 0);
      const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 0, 1));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
      void m;
      p.push(colorize(g, wood));
    }
  }
  p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), 0, 0, 0.005, 0, 0, 0, 0.04, 0.05, 0.04), glove)); // bow hand
  p.push(cylinderBetween(new THREE.Vector3(-0.01, -0.03, 0.02), new THREE.Vector3(-0.14, -0.42, 0.55), 0.035, 0.05, 8, sleeve));
  return mergeColored(p);
}

function buildArrow() {
  const p = [];
  p.push(part(new THREE.CylinderGeometry(0.004, 0.004, 0.7, 5), 0x8a6a40, 0, 0, 0, Math.PI / 2));
  p.push(part(new THREE.ConeGeometry(0.009, 0.04, 4), 0x9a9a9a, 0, 0, -0.37, -Math.PI / 2, 0, 0));
  for (let i = 0; i < 3; i++) p.push(part(new THREE.BoxGeometry(0.002, 0.018, 0.07), i ? 0xe8e0d0 : 0xc03020, 0, 0, 0.3, 0, 0, (i * Math.PI * 2) / 3));
  return mergeColored(p);
}

function buildBinoculars() {
  const body = 0x2a2d2a, rubber = 0x3c4436, glass = 0x2a4a66;
  const p = [];
  for (const s of [-1, 1]) {
    p.push(part(new THREE.CylinderGeometry(0.024, 0.026, 0.13, 12), rubber, s * 0.034, 0, 0, Math.PI / 2));
    p.push(part(new THREE.CylinderGeometry(0.028, 0.026, 0.03, 12), body, s * 0.034, 0, -0.075, Math.PI / 2));
    p.push(part(new THREE.CircleGeometry(0.024, 12), glass, s * 0.034, 0, -0.091, 0, Math.PI));
    p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), s * 0.062, -0.01, 0.0, 0, 0, 0, 0.03, 0.045, 0.055), glove));
    p.push(colorize(xf(new THREE.CylinderGeometry(0.04, 0.05, 0.32, 8), s * 0.12, -0.13, 0.12, -0.8, 0, s * 0.5), sleeve));
  }
  p.push(part(new THREE.BoxGeometry(0.04, 0.02, 0.07), body, 0, 0.005, 0.0));
  return mergeColored(p);
}

function buildKnife() {
  const p = [];
  p.push(part(new THREE.BoxGeometry(0.022, 0.03, 0.11), 0x3a2a1c, 0, 0, 0.02));
  p.push(part(new THREE.BoxGeometry(0.05, 0.012, 0.012), 0x8a8a8a, 0, 0.004, -0.04));
  p.push(part(new THREE.BoxGeometry(0.006, 0.032, 0.16), 0xc8ccd0, 0, 0.006, -0.125));
  p.push(colorize(xf(new THREE.ConeGeometry(0.016, 0.04, 4), 0, 0.006, -0.22, -Math.PI / 2, 0, 0, 0.35, 1, 1), 0xc8ccd0));
  p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), 0.006, -0.012, 0.03, 0, 0, 0, 0.04, 0.035, 0.065), glove));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 8), 0.05, -0.07, 0.17, -1.2, 0, 0.3), sleeve));
  return mergeColored(p);
}

function buildBaitBag() {
  const p = [];
  p.push(ellipsoid(0, 0, 0, 0.07, 0.09, 0.05, 0xc8a860, 8, 6));
  p.push(part(new THREE.CylinderGeometry(0.03, 0.05, 0.03, 8), 0xa88848, 0, 0.09, 0));
  for (let i = 0; i < 6; i++) p.push(ellipsoid(Math.cos(i) * 0.03, 0.105, Math.sin(i) * 0.02, 0.008, 0.008, 0.008, 0xf0c030, 4, 3));
  p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), 0.02, -0.03, 0.04, 0, 0, 0, 0.04, 0.045, 0.05), glove));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 8), 0.06, -0.09, 0.18, -1.2, 0, 0.3), sleeve));
  return mergeColored(p);
}

function buildCall() {
  const p = [];
  p.push(part(new THREE.CylinderGeometry(0.014, 0.018, 0.12, 10), 0x3a2a1c, 0, 0, 0, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 10), 0xc8a050, 0, 0, -0.07, Math.PI / 2));
  p.push(part(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 6), 0x2a2a2a, 0, -0.005, 0.11, Math.PI / 2));
  p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 6), 0.0, -0.02, 0.0, 0, 0, 0, 0.04, 0.04, 0.05), glove));
  p.push(colorize(xf(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 8), 0.05, -0.08, 0.15, -1.2, 0, 0.3), sleeve));
  return mergeColored(p);
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.25, 'rgba(255,200,90,0.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Equipment {
  constructor(renderer) {
    this.renderer = renderer;
    this.item = 'rifle';
    this.nextItem = null;
    this.switchT = 0;
    this.aim = 0;
    this.scopeZoom = 4;
    this.binoZoom = 8;
    this.cycleT = 0;
    this.reloadT = 0;
    this.kick = 0;
    this.flashT = 0;
    this.draw = 0;           // bow draw 0..1
    this.slashT = 0;
    this.callT = 0;
    this.identifyTarget = null; this.identifyT = 0; this.scanT = 0; this.range = null; this.info = null;
    this.owned = { rifle: true, shotgun: true, pistol: true, bow: true, knife: true, binoculars: true, bait: true, call: true };
    // magazine + reserve per weapon; bow and bait use reserve only
    this.ammo = {
      rifle: { mag: 5, reserve: 10 }, shotgun: { mag: 5, reserve: 10 }, pistol: { mag: 6, reserve: 12 },
      bow: { mag: 0, reserve: 12 }, bait: { mag: 0, reserve: 4 },
    };

    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x444033, 1.2);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.vmSun.position.set(0.5, 1, 0.3);
    this.vmScene.add(this.vmHemi, this.vmSun);
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x222222 });
    const group = (...meshes) => { const g = new THREE.Group(); meshes.forEach((m) => g.add(m)); g.visible = false; this.vmScene.add(g); return g; };
    const flash = (z, y, s) => {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      f.position.set(0, y, z); f.scale.setScalar(s); f.visible = false;
      return f;
    };

    this.models = {};
    this.flashes = {};
    // rifle
    this.flashes.rifle = flash(-0.8, 0.028, 0.25);
    this.models.rifle = group(new THREE.Mesh(buildRifle(), mat), new THREE.Mesh(buildTwoHands(), mat), this.flashes.rifle);
    // shotgun with moving pump
    this.pump = new THREE.Mesh(buildPump(), mat);
    this.pump.position.set(0, -0.008, -0.3);
    this.flashes.shotgun = flash(-0.74, 0.022, 0.35);
    this.models.shotgun = group(new THREE.Mesh(buildShotgun(), mat), new THREE.Mesh(buildTwoHands(-0.3), mat), this.pump, this.flashes.shotgun);
    // revolver
    this.flashes.pistol = flash(-0.19, 0.02, 0.16);
    this.models.pistol = group(new THREE.Mesh(buildPistol(), mat), this.flashes.pistol);
    // bow with string and nocked arrow
    this.bowString = new THREE.Group();
    const strMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d0 });
    this.strTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 1, 4), strMat);
    this.strBot = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 1, 4), strMat);
    this.bowString.add(this.strTop, this.strBot);
    this.nocked = new THREE.Mesh(buildArrow(), mat);
    this.drawHand = new THREE.Mesh(colorize(new THREE.SphereGeometry(0.035, 8, 6), glove), mat);
    this.bowModel = new THREE.Mesh(buildBow(), mat);
    this.models.bow = group(this.bowModel, this.bowString, this.nocked, this.drawHand);
    this.models.bow.scale.setScalar(0.55);
    this.models.knife = group(new THREE.Mesh(buildKnife(), mat));
    this.models.binoculars = group(new THREE.Mesh(buildBinoculars(), mat));
    this.models.bait = group(new THREE.Mesh(buildBaitBag(), mat));
    this.models.call = group(new THREE.Mesh(buildCall(), mat));
    this.rarity = { rifle: 0, shotgun: 0, pistol: 0, bow: 0 };

    this.hipPos = new THREE.Vector3(0.16, -0.18, -0.56);
    this.adsPos = new THREE.Vector3(0, -0.083, -0.2);

    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 25, 2);
    G.scene.add(this.muzzleLight);

    // world arrows (flying and stuck)
    this.arrowGeo = buildArrow();
    this.arrowMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.arrows = [];

    this.puffs = [];
    const puffMat = new THREE.PointsMaterial({ color: 0x8a7a60, size: 0.25, transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
      const pts = new THREE.Points(g, puffMat.clone());
      pts.visible = false; pts.frustumCulled = false;
      G.scene.add(pts);
      this.puffs.push({ pts, vel: new Float32Array(14 * 3), t: 0 });
    }
    this.pending = [];
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._o = new THREE.Vector3();
  }

  get W() { return WEAPONS[this.item]; }
  get busy() { return this.cycleT > 0 || this.reloadT > 0 || this.switchT > 0; }
  get zoom() {
    if (this.item === 'rifle') return this.scopeZoom;
    if (this.item === 'binoculars') return this.binoZoom;
    return WEAPONS[this.item].zoom || 1;
  }
  // current weapon's ammo (falls back to the rifle for older callers)
  get mag() { return (this.ammo[this.item] || this.ammo.rifle).mag; }
  set mag(v) { (this.ammo[this.item] || this.ammo.rifle).mag = v; }
  get reserve() { return (this.ammo[this.item] || this.ammo.rifle).reserve; }
  set reserve(v) { (this.ammo[this.item] || this.ammo.rifle).reserve = v; }
  get boltT() { return this.cycleT; }

  select(item) {
    if (item === this.item || this.reloadT > 0) return;
    if (!this.owned[item]) {
      G.ui?.toast(`You do not own ${WEAPONS[item].short === 'Bait' ? 'any bait' : 'a ' + WEAPONS[item].short.toLowerCase()} yet. ${item === 'bait' || item === 'call' ? 'The general store sells it.' : 'Buy it at the gunsmith.'}`, 'warn');
      return;
    }
    this.nextItem = item;
    this.switchT = 0.5;
    this.draw = 0;
  }

  cycleItem(dir) {
    const owned = ITEMS.filter((i) => this.owned[i]);
    const idx = owned.indexOf(this.nextItem || this.item);
    this.select(owned[(idx + dir + owned.length) % owned.length]);
  }

  resize(aspect) { this.vmCamera.aspect = aspect; this.vmCamera.updateProjectionMatrix(); }

  // ---------- rarity ----------
  tier(item) { return (this.rarity && this.rarity[item]) || 0; }
  rar(item) { return RARITY[this.tier(item)]; }
  magSize(item) { const W = WEAPONS[item]; return W.magSize ? W.magSize + this.rar(item).mag : 0; }
  lethalBonus(power) { const it = POWER_ITEM[power]; return it ? this.rar(it).lethal : 0; }
  dmgMult(power) { const it = POWER_ITEM[power]; return it ? this.rar(it).dmg : 1; }

  applyRarityLook(item) {
    const cols = VM_COLORS[item], m = this.models[item];
    if (!cols || !m) return;
    const map = rarityMap(this.tier(item), cols.wood, cols.metal);
    m.traverse((o) => { if (o.isMesh && o.geometry.attributes.color) recolor(o.geometry, map); });
  }

  resetRarity() {
    this.rarity = { rifle: 0, shotgun: 0, pistol: 0, bow: 0 };
    for (const it of Object.keys(VM_COLORS)) this.applyRarityLook(it);
  }

  setRarity(item, tier) {
    this.rarity[item] = tier;
    this.applyRarityLook(item);
    const am = this.ammo[item], max = this.magSize(item);
    if (am && WEAPONS[item].gun && am.mag > max) am.mag = max;
  }

  // A weapon from a crate or a poacher: new, an upgrade, or (if no better) just its ammo
  grantWeapon(item, tier) {
    const W = WEAPONS[item], am = this.ammo[item];
    const extra = W.gun ? W.magSize : 4;
    if (!this.owned[item]) {
      this.owned[item] = true;
      this.setRarity(item, tier);
      if (W.gun) am.mag = this.magSize(item);
      am.reserve += extra;
      return 'new';
    }
    am.reserve += extra;
    if (tier > this.tier(item)) { this.setRarity(item, tier); return 'upgrade'; }
    return 'dupe';
  }

  // First-person sleeves take the colour of the jacket chosen in "Customize hunter"
  setSleeveColor(hex) {
    const ref = colorize(new THREE.BoxGeometry(0.01, 0.01, 0.01), sleeve).attributes.color.array;
    const nc = colorize(new THREE.BoxGeometry(0.01, 0.01, 0.01), hex).attributes.color.array;
    this.vmScene.traverse((o) => {
      const c = o.geometry && o.geometry.attributes.color;
      if (!c) return;
      if (!o.geometry.userData.origColors) o.geometry.userData.origColors = c.array.slice();
      const orig = o.geometry.userData.origColors;
      for (let i = 0; i < orig.length; i += 3) {
        if (Math.abs(orig[i] - ref[0]) < 1e-4 && Math.abs(orig[i + 1] - ref[1]) < 1e-4 && Math.abs(orig[i + 2] - ref[2]) < 1e-4) {
          c.array[i] = nc[0]; c.array[i + 1] = nc[1]; c.array[i + 2] = nc[2];
        }
      }
      c.needsUpdate = true;
    });
  }

  update(dt, input) {
    const P = G.player;
    ITEMS.forEach((id, i) => { if (input.wasPressed('Digit' + (i + 1))) this.select(id); });
    if (this.switchT > 0) {
      const before = this.switchT;
      this.switchT -= dt;
      if (before > 0.25 && this.switchT <= 0.25 && this.nextItem) { this.item = this.nextItem; this.nextItem = null; }
      if (this.switchT < 0) this.switchT = 0;
    }
    const W = this.W;
    const canAim = !!W.zoom && !P.sprinting && !P.swimming && this.switchT === 0 && this.reloadT === 0;
    const wantAim = input.right && canAim;
    this.aim = damp(this.aim, wantAim ? 1 : 0, wantAim ? 7 : 9, dt);
    if (this.aim < 0.001) this.aim = 0;

    // wheel: optic zoom while aiming, otherwise switch items
    if (input.wheel) {
      if (this.aim > 0.5 && this.item === 'rifle') this.scopeZoom = clamp(this.scopeZoom - input.wheel, 3, 9);
      else if (this.aim > 0.5 && this.item === 'binoculars') this.binoZoom = clamp(this.binoZoom - input.wheel * 2, 4, 12);
      else if (this.aim < 0.1) this.cycleItem(input.wheel > 0 ? 1 : -1);
    }

    const zf = lerp(1, this.zoom, smoothstep(0.05, 1, this.aim));
    const fov = settings.fov / zf;
    if (Math.abs(G.camera.fov - fov) > 0.01) { G.camera.fov = fov; G.camera.updateProjectionMatrix(); }
    P.zoomSensitivity = 1 / Math.pow(zf, 0.85);

    // actions (not while swimming)
    if (!P.swimming) {
      if (W.gun && input.leftPressed) this.fire();
      if (W.bow) this.updateBow(dt, input);
      if (this.item === 'knife' && input.leftPressed && this.slashT <= 0 && this.switchT === 0) { this.slashT = 0.45; this.slashHit = false; G.audio?.slash(); }
      if (this.item === 'bait' && input.leftPressed && this.switchT === 0) this.placeBait();
      if (this.item === 'call' && input.leftPressed && this.switchT === 0) this.useCall();
      if (input.wasPressed('KeyR')) this.reload();
    }
    if (this.slashT > 0) {
      this.slashT -= dt;
      if (!this.slashHit && this.slashT < 0.3) { this.slashHit = true; this.knifeStrike(); }
    }
    this.callT = Math.max(0, this.callT - dt);

    // weapon cycling and reloading
    if (this.cycleT > 0) {
      const before = this.cycleT;
      this.cycleT = Math.max(0, this.cycleT - dt);
      if (this.item === 'rifle' && before > 0.95 && this.cycleT <= 0.95) G.audio?.boltCycle();
      if (this.item === 'shotgun' && before > 0.5 && this.cycleT <= 0.5) G.audio?.pump?.();
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }
    this.kick = damp(this.kick, 0, 10, dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const k in this.flashes) { const f = this.flashes[k]; f.visible = this.flashT > 0 && k === this.item; f.material.rotation = Math.random() * 6; }
      this.muzzleLight.intensity = this.flashT > 0 ? 60 : 0;
    }
    this.muzzleLight.position.copy(G.camera.position);

    this.updateViewmodel(dt);
    this.updateArrows(dt);
    this.updatePuffs(dt);
    this.updatePending(dt);
    this.updateOptics(dt);
  }

  // ---------- viewmodels ----------
  updateViewmodel(dt) {
    const P = G.player, env = G.env;
    const t = performance.now() / 1000;
    const li = 0.12 + env.daylight * 0.9 * env.w.light;
    this.vmHemi.intensity = 0.35 + li * 1.6;
    this.vmSun.intensity = li * 2.4;
    this.vmHemi.color.copy(env.hemi.color);
    const bob = P.bobAmt;
    const bx = Math.cos(P.bobT) * 0.012 * bob, by = Math.abs(Math.sin(P.bobT)) * 0.012 * bob;
    const idle = Math.sin(t * 1.4) * 0.002;
    const sw = this.switchT > 0 ? Math.sin((this.switchT / 0.5) * Math.PI) * 0.35 : 0;
    this.sprintAmt = damp(this.sprintAmt || 0, P.sprinting ? 1 : 0, 8, dt);
    this.swimAmt = damp(this.swimAmt || 0, P.swimming ? 1 : 0, 6, dt);
    const low = sw + this.swimAmt * 0.4;
    const a = smoothstep(0, 1, this.aim);
    const overlay = smoothstep(0.65, 0.95, this.aim);
    for (const k in this.models) this.models[k].visible = k === this.item && this.swimAmt < 0.95;
    if (this.item === 'rifle' || this.item === 'binoculars') if (overlay >= 0.98) this.models[this.item].visible = false;

    const m = this.models[this.item];
    if (!m) return;
    const recoil = this.kick;
    switch (this.item) {
      case 'rifle': {
        m.position.lerpVectors(this.hipPos, this.adsPos, a);
        m.position.x += bx * (1 - a) + this.sprintAmt * 0.05;
        m.position.y += by * (1 - a) + idle - low - this.sprintAmt * 0.06;
        m.position.z += recoil * 0.09;
        m.rotation.set(recoil * 0.25 - this.sprintAmt * 0.35, this.sprintAmt * 0.6, this.sprintAmt * 0.3);
        if (this.cycleT > 0) m.rotation.z += Math.sin((1 - this.cycleT / 1.15) * Math.PI) * 0.12 * (1 - a);
        if (this.reloadT > 0) { const tilt = Math.sin((1 - this.reloadT / 2.4) * Math.PI); m.rotation.z += tilt * 0.5; m.rotation.x += tilt * 0.2; m.position.y -= tilt * 0.05; }
        break;
      }
      case 'shotgun': {
        const ads = new THREE.Vector3(0, -0.038, -0.3);
        m.position.lerpVectors(this.hipPos, ads, a);
        m.position.x += bx * (1 - a) + this.sprintAmt * 0.05;
        m.position.y += by * (1 - a) + idle - low - this.sprintAmt * 0.06;
        m.position.z += recoil * 0.12;
        m.rotation.set(recoil * 0.35 - this.sprintAmt * 0.35, this.sprintAmt * 0.6, this.sprintAmt * 0.3);
        const pumpBack = this.cycleT > 0 ? Math.sin((1 - this.cycleT / 0.75) * Math.PI) : 0;
        this.pump.position.z = -0.3 + pumpBack * 0.09;
        if (this.reloadT > 0) { const tilt = 0.5; m.rotation.z += tilt * 0.6; m.position.y -= 0.04; }
        break;
      }
      case 'pistol': {
        const hip = new THREE.Vector3(0.13, -0.15, -0.38), ads = new THREE.Vector3(0, -0.046, -0.47);
        m.position.lerpVectors(hip, ads, a);
        m.position.x += bx * (1 - a);
        m.position.y += by * (1 - a) + idle - low;
        m.position.z += recoil * 0.05;
        m.rotation.set(recoil * 0.5, 0, 0);
        if (this.reloadT > 0) { const tilt = Math.sin((1 - this.reloadT / 2.2) * Math.PI); m.rotation.z = tilt * 0.9; m.position.y -= tilt * 0.06; }
        break;
      }
      case 'bow': {
        const hip = new THREE.Vector3(-0.07, -0.06, -0.42), ads = new THREE.Vector3(0.0, -0.005, -0.34);
        m.position.lerpVectors(hip, ads, a);
        m.position.x += bx; m.position.y += by + idle - low;
        m.rotation.set(0, 0.0, -0.18 * (1 - a) - 0.05);
        // string pulled back toward the eye with the draw
        const pull = 0.06 + this.draw * 0.3;
        const nock = new THREE.Vector3(0, 0, pull);
        const tops = [new THREE.Vector3(0, 0.5, -0.03), new THREE.Vector3(0, -0.5, -0.03)];
        [this.strTop, this.strBot].forEach((s, i) => {
          const a2 = tops[i], dir = nock.clone().sub(a2);
          s.position.copy(a2).add(nock).multiplyScalar(0.5);
          s.scale.set(1, dir.length(), 1);
          s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        });
        this.nocked.visible = this.ammo.bow.reserve > 0;
        this.nocked.position.set(0, 0, pull - 0.33);
        this.drawHand.position.set(0, -0.01, pull + 0.02);
        break;
      }
      case 'knife': {
        const u = this.slashT > 0 ? 1 - this.slashT / 0.45 : 0;
        const swing = Math.sin(u * Math.PI);
        m.position.set(0.17 - swing * 0.2 + bx, -0.17 + by + idle - low + swing * 0.05, -0.36 - swing * 0.12);
        m.rotation.set(-0.15 - swing * 0.6, 0.3 + swing * 0.9, -0.2 - swing * 0.8);
        break;
      }
      case 'binoculars':
        m.position.set(lerp(0.05, 0, a) + bx, lerp(-0.26, -0.01, a) + by + idle - low, lerp(-0.38, -0.14, a));
        m.rotation.set(lerp(-0.5, 0, a), 0, 0);
        break;
      default: {
        const blow = this.item === 'call' ? Math.max(0, this.callT - 5.2) : 0;
        m.position.set(0.15 - blow * 0.4, -0.16 + by + idle - low + blow * 0.3, -0.32 + blow * 0.1);
        m.rotation.set(-0.2, 0.3, -0.1);
      }
    }
  }

  // ---------- firearms ----------
  reload() {
    const W = this.W;
    if (!W.gun) return;
    const am = this.ammo[this.item];
    if (am.mag >= this.magSize(this.item) || this.reloadT > 0 || this.cycleT > 0) return;
    if (am.reserve <= 0 && !G.sandbox.infiniteAmmo) { G.ui.toast(`No ${W.ammo} left. Buy more at the gunsmith in town.`, 'warn'); return; }
    this.reloadT = W.reload * this.rar(this.item).speed;
    G.audio?.reloadSound();
  }

  finishReload() {
    const W = this.W, am = this.ammo[this.item];
    if (!W || !W.gun) return;
    const need = W.perShell ? 1 : this.magSize(this.item) - am.mag;
    const take = G.sandbox.infiniteAmmo ? need : Math.min(need, am.reserve);
    am.mag += take;
    if (!G.sandbox.infiniteAmmo) am.reserve -= take;
    // shotguns load one shell at a time until full
    if (W.perShell && am.mag < this.magSize(this.item) && (am.reserve > 0 || G.sandbox.infiniteAmmo)) { this.reloadT = W.reload * this.rar(this.item).speed; G.audio?.dryFire(); }
  }

  fire() {
    const W = this.W, am = this.ammo[this.item];
    if (this.cycleT > 0 || this.switchT > 0) return;
    if (this.reloadT > 0) { if (W.perShell && am.mag > 0) this.reloadT = 0; else return; }
    if (am.mag <= 0) { G.audio?.dryFire(); G.ui.toast('Empty — press R to reload', 'warn'); return; }
    const P = G.player;
    am.mag--;
    G.stats.shots++;
    if (this.item === 'pistol') G.audio?.pistolShot?.(); else if (this.item === 'shotgun') G.audio?.shotgunShot?.(); else G.audio?.gunshot();
    this.flashT = 0.05;
    const aimed = this.aim > 0.8;
    this.kick = 1;
    const rk = this.item === 'shotgun' ? 1.5 : this.item === 'pistol' ? 0.8 : 1;
    P.recoil += (aimed ? 0.05 : 0.075) * rk;
    P.pitch += (aimed ? 0.006 : 0.012) * rk;
    P.shake = 0.2 * rk;
    if (this.item === 'rifle') G.ui.scopeKick();
    this.cycleT = am.mag > 0 || this.item === 'shotgun' ? W.cycle * this.rar(this.item).speed : 0;

    const cam = G.camera;
    const base = this._d.set(0, 0, -1).applyQuaternion(cam.quaternion).clone();
    const spread = (aimed ? W.ads : (P.moving ? W.hip * 1.6 : W.hip) * (1 - this.aim * 0.6)) * this.rar(this.item).spread;
    const origin = cam.position.clone();
    if (W.pellets > 1) this.firePellets(origin, base, spread, W);
    else {
      const dir = base.clone();
      dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      if (this.item === 'rifle' && aimed) { dir.y += 0.0006; dir.normalize(); }
      this.traceBullet(origin, dir, W);
    }
    G.animals.soundEvent(P.pos.x, P.pos.z, W.loud, 'shot');
    G.net?.shot(this.item, W.loud);
    G.birds?.soundEvent(P.pos.x, P.pos.z, W.loud, 'shot');
    G.poachers?.hearShot(P.pos.x, P.pos.z);
    if (am.mag === 0 && (am.reserve > 0 || G.sandbox.infiniteAmmo)) setTimeout(() => { if (this.ammo[this.item] === am && am.mag === 0) G.ui.toast('Press R to reload', 'info'); }, 600);
  }

  // Nearest thing a straight segment hits: { kind, dist, ... }
  segmentHit(pos, dir, len) {
    const ts = G.world.raycastStatic(pos, dir, len);
    let ah = G.animals.raycast(pos, dir, len);
    const bh = G.birds ? G.birds.raycast(pos, dir, len) : null;
    if (bh && (!ah || bh.dist < ah.dist)) ah = bh;
    const ph = G.poachers ? G.poachers.raycast(pos, dir, len) : null;
    const vh = G.world.raycastVendors(pos, dir, len);
    let best = ts >= 0 ? { kind: 'static', dist: ts } : null;
    if (vh && (!best || vh.dist < best.dist)) best = { kind: 'vendor', dist: vh.dist, store: vh.store };
    const rh = G.net ? G.net.raycastPlayers(pos, dir, len) : null;
    if (rh && (!best || rh.dist < best.dist)) best = { kind: 'player', dist: rh.dist, player: rh.player, part: rh.part };
    if (ah && (!best || ah.dist < best.dist)) best = { kind: 'animal', dist: ah.dist, animal: ah.animal, part: ah.part };
    if (ph && (!best || ph.dist < best.dist)) best = { kind: 'poacher', dist: ph.dist, poacher: ph.poacher };
    return best;
  }

  traceBullet(origin, dir, W) {
    const pos = origin.clone();
    const vel = dir.clone().multiplyScalar(W.velocity);
    const dt = 0.01;
    let t = 0, travelled = 0;
    const segDir = new THREE.Vector3(), next = new THREE.Vector3();
    const maxRange = W.range || 600;
    while (travelled < maxRange) {
      next.copy(pos).addScaledVector(vel, dt);
      next.y -= 0.5 * GRAVITY * dt * dt;
      vel.y -= GRAVITY * dt;
      segDir.subVectors(next, pos);
      const len = segDir.length();
      segDir.divideScalar(len);
      const h = this.segmentHit(pos, segDir, len);
      if (h) {
        const tof = t + (h.dist / len) * dt;
        if (h.kind === 'animal') this.pending.push({ t: tof, kind: 'animal', animal: h.animal, part: h.part, dist: origin.distanceTo(h.animal.pos), power: W.power });
        else if (h.kind === 'poacher') this.pending.push({ t: tof, kind: 'poacher', poacher: h.poacher });
        else if (h.kind === 'vendor') this.pending.push({ t: tof, kind: 'vendor', store: h.store });
        else if (h.kind === 'player') this.pending.push({ t: tof, kind: 'player', player: h.player, part: h.part, power: W.power });
        else this.pending.push({ t: tof, kind: 'static', point: pos.clone().addScaledVector(segDir, h.dist) });
        return;
      }
      pos.copy(next);
      travelled += len;
      t += dt;
    }
  }

  // Shotgun: several pellets; their hits on each animal are added up
  firePellets(origin, base, spread, W) {
    const perAnimal = new Map(), perPlayer = new Map();
    let puffs = 0;
    for (let i = 0; i < W.pellets; i++) {
      const dir = base.clone();
      dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      const h = this.segmentHit(origin, dir, W.range);
      if (!h) continue;
      if (h.kind === 'animal') {
        const e = perAnimal.get(h.animal) || { n: 0, dist: h.dist, part: h.part };
        e.n++;
        if (h.part === 'vitals' || h.part === 'head') e.part = h.part;
        perAnimal.set(h.animal, e);
      } else if (h.kind === 'poacher') this.pending.push({ t: h.dist / W.velocity, kind: 'poacher', poacher: h.poacher });
      else if (h.kind === 'vendor') this.pending.push({ t: h.dist / W.velocity, kind: 'vendor', store: h.store });
      else if (h.kind === 'player') {
        const e = perPlayer.get(h.player) || { n: 0, dist: h.dist, part: 'legs' };
        e.n++;
        if (h.part === 'head' || (h.part === 'body' && e.part === 'legs')) e.part = h.part;
        perPlayer.set(h.player, e);
      } else if (puffs++ < 3) this.pending.push({ t: h.dist / W.velocity, kind: 'static', point: origin.clone().addScaledVector(dir, h.dist), quiet: puffs > 1 });
    }
    for (const [player, e] of perPlayer) this.pending.push({ t: e.dist / W.velocity, kind: 'player', player, part: e.part, power: 'shot', pellets: e.n });
    for (const [animal, e] of perAnimal) this.pending.push({ t: e.dist / W.velocity, kind: 'animal', animal, part: e.part, dist: e.dist, power: 'shot', pellets: e.n });
  }

  // ---------- bow ----------
  updateBow(dt, input) {
    const am = this.ammo.bow;
    if (this.switchT > 0) { this.draw = 0; return; }
    if (input.left && am.reserve > 0 && !G.player.sprinting) {
      if (this.draw === 0) G.audio?.bowDraw?.();
      this.draw = Math.min(1, this.draw + dt / (0.85 * this.rar('bow').speed));
    } else if (this.draw > 0) {
      if (this.draw > 0.2 && am.reserve > 0) this.shootArrow();
      this.draw = 0;
    } else if (input.leftPressed && am.reserve <= 0) G.ui.toast('No arrows left. Pick up arrows you have shot, or buy more at the gunsmith.', 'warn');
  }

  shootArrow() {
    const am = this.ammo.bow;
    if (!G.sandbox.infiniteAmmo) am.reserve--;
    G.stats.shots++;
    G.audio?.bowShot?.();
    const cam = G.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const spread = (this.aim > 0.8 ? 0.004 : 0.03) * this.rar('bow').spread;
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.normalize();
    const speed = 22 + 48 * this.draw;
    // the bow sight is zeroed at 20 m when aiming
    if (this.aim > 0.8) { dir.y += (0.5 * GRAVITY * 20) / (speed * speed); dir.normalize(); }
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    mesh.position.copy(cam.position).addScaledVector(dir, 0.5);
    G.scene.add(mesh);
    this.arrows.push({ mesh, pos: mesh.position, vel: dir.multiplyScalar(speed), flying: true, age: 0, travelled: 0 });
    this.kick = 0.3;
  }

  updateArrows(dt) {
    const tmp = new THREE.Vector3(), seg = new THREE.Vector3();
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const ar = this.arrows[i];
      ar.age += dt;
      if (!ar.flying) { if (ar.age > 600) { G.scene.remove(ar.mesh); this.arrows.splice(i, 1); } continue; }
      const steps = 2;
      for (let k = 0; k < steps && ar.flying; k++) {
        const h = dt / steps;
        ar.vel.y -= GRAVITY * h;
        seg.copy(ar.vel).multiplyScalar(h);
        const len = seg.length();
        const dir = seg.clone().divideScalar(len);
        const hit = this.segmentHit(ar.pos, dir, len);
        if (hit) {
          ar.pos.addScaledVector(dir, hit.dist);
          if (hit.kind === 'animal') {
            this.onAnimalHit({ animal: hit.animal, part: hit.part, dist: Math.max(1, ar.travelled), power: 'arrow' });
            G.scene.remove(ar.mesh); this.arrows.splice(i, 1);
          } else if (hit.kind === 'poacher') {
            G.ui.hitMarker(false); hit.poacher.surrender();
            G.scene.remove(ar.mesh); this.arrows.splice(i, 1);
          } else if (hit.kind === 'player') {
            G.scene.remove(ar.mesh); this.arrows.splice(i, 1);
            G.net.hitPlayer(hit.player, 'arrow', hit.part);
          } else if (hit.kind === 'vendor') {
            G.scene.remove(ar.mesh); this.arrows.splice(i, 1);
            G.ui.shopkeeperShoots(hit.store);
          } else {
            // stuck in the ground or a tree: it can be picked up again
            ar.flying = false; ar.age = 0;
            ar.pos.addScaledVector(dir, 0.15);
            G.audio?.impact(ar.pos, true);
            G.animals.soundEvent(ar.pos.x, ar.pos.z, 14, 'impact');
            G.birds?.soundEvent(ar.pos.x, ar.pos.z, 14, 'impact');
          }
          break;
        }
        ar.pos.add(seg);
        ar.travelled += len;
        const gh = G.world.terrain.getHeight(ar.pos.x, ar.pos.z);
        if (ar.pos.y < gh) { ar.pos.y = gh + 0.05; ar.flying = false; ar.age = 0; G.audio?.impact(ar.pos, true); break; }
        if (ar.travelled > 250 || ar.age > 8) { ar.flying = false; }
      }
      if (ar.flying) {
        tmp.copy(ar.pos).add(ar.vel);
        ar.mesh.lookAt(tmp);
        ar.mesh.rotateY(Math.PI); // the model points along -z
      }
    }
  }

  nearestStuckArrow(x, z, r) {
    let best = null, bd = r;
    for (const ar of this.arrows) {
      if (ar.flying) continue;
      const d = Math.hypot(ar.pos.x - x, ar.pos.z - z);
      if (d < bd) { bd = d; best = ar; }
    }
    return best;
  }

  pickupArrow(ar) {
    G.scene.remove(ar.mesh);
    this.arrows.splice(this.arrows.indexOf(ar), 1);
    this.ammo.bow.reserve++;
  }

  // ---------- bait and calls ----------
  placeBait() {
    const am = this.ammo.bait;
    if (am.reserve <= 0) { G.ui.toast('You have no bait left. The general store sells bags of deer corn.', 'warn'); return; }
    const P = G.player;
    if (G.world.baits.filter((b) => b.active).length >= 3) { G.ui.toast('You already have three bait piles out. Animals will find them in time.', 'info'); return; }
    const x = P.pos.x - Math.sin(P.yaw) * 1.6, z = P.pos.z - Math.cos(P.yaw) * 1.6;
    if (!G.sandbox.infiniteAmmo) am.reserve--;
    G.world.placeBait(x, z);
    G.net?.bait(x, z);
    G.ui.toast('Bait placed. Deer, elk, boar, bison and bears nearby may come to feed over the next hours. Watch it from a distance — downwind.', 'good');
  }

  useCall() {
    if (this.callT > 0) return;
    this.callT = 6;
    const P = G.player;
    G.audio?.animalCall('snort', { x: P.pos.x + Math.sin(-P.yaw) * 2, z: P.pos.z - Math.cos(P.yaw) * 2 });
    G.audio?.gruntCall?.();
    if (G.net && !G.net.isHost) G.net.call(P.pos.x, P.pos.z); else G.animals.callEvent(P.pos.x, P.pos.z);
  }

  // ---------- hits ----------
  updatePending(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      e.t -= dt;
      if (e.t > 0) continue;
      this.pending.splice(i, 1);
      if (e.kind === 'animal') this.onAnimalHit(e);
      else if (e.kind === 'poacher') { G.ui.hitMarker(false); e.poacher.surrender(); }
      else if (e.kind === 'vendor') G.ui.shopkeeperShoots(e.store);
      else if (e.kind === 'player') G.net?.hitPlayer(e.player, e.power, e.part, e.pellets || 1);
      else {
        this.spawnPuff(e.point);
        G.net?.noise(e.point.x, e.point.z, 28, 'impact');
        if (!e.quiet) G.audio?.impact(e.point, true);
        G.animals.soundEvent(e.point.x, e.point.z, 28, 'impact');
        G.birds?.soundEvent(e.point.x, e.point.z, 28, 'impact');
      }
    }
  }

  // Does this hit bring the animal down? Depends on weapon power, shot placement and animal size.
  isLethal(a, e) {
    const kg = a.weight, vital = e.part === 'vitals' || e.part === 'head' || e.part === 'neck';
    if (a.isBird) return true;
    switch (e.power) {
      case 'pistol': return kg < 60 || (vital && kg < 200);
      case 'shot': {
        const n = e.pellets || 1;
        if (kg < 15) return true;
        if (kg < 70) return n >= 3 && e.dist < 40;
        if (kg < 160) return n >= 6 && e.dist < 25;
        return false;
      }
      case 'arrow': return vital ? kg < 600 : kg < 80;
      default: return true; // rifle
    }
  }

  onAnimalHit(e) {
    const a = e.animal;
    if (!a.active || a.state === S.DOWN) return;
    if (a.sp.protected) {
      a.flush(G.player.pos.x, G.player.pos.z, true);
      G.stats.protectedWarnings = (G.stats.protectedWarnings || 0) + 1;
      G.ui.toast(`${a.sp.name}s are protected by law. Never shoot protected birds — the bird escaped unharmed.`, 'warn');
      return;
    }
    if (e.power && !this.isLethal(a, e) && !(Math.random() < this.lethalBonus(e.power))) {
      // not enough to bring it down: it breaks off and runs
      G.ui.hitMarker(false);
      if (a.state === 'attack') a.endAttack(); else a.flee(G.player.pos.x, G.player.pos.z, true);
      G.net?.spook(a);
      const why = { pistol: 'A handgun round is too light for an animal this size — aim for the heart and lungs.', shot: 'Too few pellets at this range. Shotguns are for birds and small game, close up.', arrow: 'The arrow missed the vital zone. Aim just behind the front shoulder.' }[e.power];
      G.ui.toast(`The ${a.sp.name.toLowerCase()} runs off. ${why || ''}`, 'info');
      return;
    }
    a.hit(e.part, G.player.pos);
    if (!a.isBird) G.net?.down(a, e.part);
    G.stats.hits++;
    const clean = e.part === 'vitals' || e.part === 'head' || e.part === 'neck';
    const entry = {
      type: 'harvest', species: a.species, label: a.label, dist: Math.round(e.dist), part: e.part, clean,
      weight: Math.round(a.weight * 10) / 10, age: a.age, tagged: false, weapon: e.power || 'knife',
      time: G.env.time, day: G.env.day, weather: G.env.weatherName,
    };
    G.journal.push(entry);
    a.harvest = entry;
    G.ui.hitMarker(clean);
    G.ui.discover(a.species, 'harvest');
    saveProgress();
  }

  spawnPuff(p) {
    const puff = this.puffs.find((x) => !x.pts.visible) || this.puffs[0];
    const arr = puff.pts.geometry.attributes.position.array;
    for (let i = 0; i < 14; i++) {
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y + 0.05; arr[i * 3 + 2] = p.z;
      puff.vel[i * 3] = (Math.random() - 0.5) * 2;
      puff.vel[i * 3 + 1] = 1 + Math.random() * 2.5;
      puff.vel[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    puff.pts.geometry.attributes.position.needsUpdate = true;
    puff.t = 0;
    puff.pts.visible = true;
    puff.pts.material.color.setRGB(0.55, 0.48, 0.38).multiplyScalar(0.4 + G.env.daylight * 0.6);
  }

  updatePuffs(dt) {
    for (const puff of this.puffs) {
      if (!puff.pts.visible) continue;
      puff.t += dt;
      const arr = puff.pts.geometry.attributes.position.array;
      for (let i = 0; i < 14; i++) {
        puff.vel[i * 3 + 1] -= 4 * dt;
        arr[i * 3] += puff.vel[i * 3] * dt;
        arr[i * 3 + 1] += puff.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += puff.vel[i * 3 + 2] * dt;
      }
      puff.pts.geometry.attributes.position.needsUpdate = true;
      puff.pts.material.opacity = 0.8 * (1 - puff.t / 1.2);
      puff.pts.material.size = 0.25 + puff.t * 0.5;
      if (puff.t > 1.2) puff.pts.visible = false;
    }
  }

  // Rangefinder + species identification through binoculars / scope.
  updateOptics(dt) {
    const optic = this.aim > 0.8 && (this.item === 'binoculars' || this.item === 'rifle');
    this.scanT -= dt;
    if (!optic) { this.identifyTarget = null; this.identifyT = 0; this.info = null; this.range = null; return; }
    if (this.scanT <= 0) {
      this.scanT = 0.1;
      const cam = G.camera;
      const o = this._o.copy(cam.position);
      const d = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const ts = G.world.raycastStatic(o, d, 800);
      let ah = G.animals.raycast(o, d, ts > 0 ? ts : 800, 1.7);
      const bh = G.birds ? G.birds.raycast(o, d, ts > 0 ? ts : 800, 1.6) : null;
      if (bh && (!ah || bh.dist < ah.dist)) ah = bh;
      if (ah) {
        this.range = ah.dist;
        if (this.identifyTarget !== ah.animal) { this.identifyTarget = ah.animal; this.identifyT = 0; }
      } else {
        this.range = ts > 0 ? ts : null;
        this.identifyTarget = null; this.identifyT = 0;
      }
    }
    const a = this.identifyTarget;
    if (a && a.active) {
      this.identifyT += dt;
      if (this.identifyT > 0.6) {
        const sp = SPECIES[a.species];
        this.info = { name: sp.name + (sp.protected ? ' (protected)' : ''), sci: sp.sci, label: a.label, state: a.state === S.DOWN || a.state === 'down' ? 'Down' : a.stateLabel, dist: Math.round(Math.hypot(a.pos.x - G.player.pos.x, a.pos.z - G.player.pos.z)), aware: a.awareness };
        if (!a.sighted) {
          a.sighted = true;
          G.stats.sightings++;
          G.journal.push({ type: 'sighting', species: a.species, label: a.label, dist: this.info.dist, time: G.env.time, day: G.env.day, weather: G.env.weatherName });
          if (G.journal.length > 300) G.journal.shift();
        }
        G.ui.discover(a.species, 'observation');
      } else this.info = { pending: true };
    } else this.info = null;
  }

  knifeStrike() {
    const cam = G.camera;
    const o = cam.position.clone();
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const reach = 2.6;
    const ph = G.poachers ? G.poachers.raycast(o, d, reach) : null;
    if (ph) { G.ui.hitMarker(false); ph.poacher.surrender(); return; }
    const vh = G.world.raycastVendors(o, d, reach);
    if (vh) { G.ui.shopkeeperShoots(vh.store); return; }
    const rp = G.net ? G.net.raycastPlayers(o, d, reach) : null;
    if (rp) { G.net.hitPlayer(rp.player, 'knife', rp.part); return; }
    let ah = G.animals.raycast(o, d, reach, 1.35);
    const bh = G.birds ? G.birds.raycast(o, d, reach, 1.5) : null;
    if (bh && (!ah || bh.dist < ah.dist)) ah = bh;
    if (!ah || ah.animal.state === 'down') return;
    const a = ah.animal;
    if (a.sp.protected) { this.onAnimalHit({ animal: a, part: 'body', dist: ah.dist }); return; }
    G.ui.hitMarker(false);
    const kill = a.isBird ? true : a.knifeHit(G.player.pos);
    if (kill) this.onAnimalHit({ animal: a, part: 'vitals', dist: Math.max(1, ah.dist) });
    else { G.net?.spook(a); G.ui.toast(`The ${a.sp.name.toLowerCase()} is too big to bring down with a knife — it breaks away.`, 'info'); }
  }

  render(renderer) {
    if (!Object.values(this.models).some((m) => m.visible)) return;
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCamera);
  }
}
