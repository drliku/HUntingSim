// Hunter avatars: how players look to each other in PvP (and in the character preview).
// The avatar holds its current item in its hands and points it where the player is looking.
import * as THREE from 'three';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween, loft, curveRings } from './geo.js';
import { rarityMap, recolor } from './rarity.js';
import { thirdPersonGeometry, VM_COLORS_EXPORT as AV_COLORS } from './equipment.js';
import { enhanceMaterial } from './matfx.js';

// ---------- customisation ----------
export const LOOK_OPTIONS = {
  jacket: [
    ['orange', 'Blaze orange', 0xe8641c], ['red', 'Red plaid', 0xb8322a], ['blue', 'Blue', 0x2a6ad0], ['yellow', 'Yellow', 0xd8b820],
    ['pink', 'Pink', 0xd85a9a], ['green', 'Green', 0x3a8a4a], ['purple', 'Purple', 0x7a4ac8], ['black', 'Black', 0x26262a],
    ['camo', 'Forest camo', 0x4a5236], ['snow', 'Snow camo', 0xdde2e4],
  ],
  hat: [['cap', 'Cap'], ['beanie', 'Beanie'], ['cowboy', 'Cowboy hat'], ['bucket', 'Bucket hat'], ['none', 'No hat']],
  hatColor: [['match', 'Match jacket'], ['brown', 'Brown', 0x6a4a2a], ['black', 'Black', 0x222224], ['olive', 'Olive', 0x4a5032], ['orange', 'Orange', 0xe8641c], ['white', 'White', 0xe6e2da]],
  skin: [['1', 'Light', 0xf0c8a8], ['2', 'Fair', 0xd8a882], ['3', 'Medium', 0xb88058], ['4', 'Tan', 0x8a5a3a], ['5', 'Dark', 0x5a3a26]],
  pants: [['khaki', 'Khaki', 0x8a7a52], ['jeans', 'Jeans', 0x34466a], ['black', 'Black', 0x2a2a2c], ['olive', 'Olive', 0x4a5032], ['camo', 'Camo', 0x5a5a3a]],
  hair: [['brown', 'Brown', 0x3a2416], ['black', 'Black', 0x16120f], ['blonde', 'Blonde', 0xb8924a], ['red', 'Ginger', 0x8a3a1a], ['gray', 'Grey', 0x8a8682]],
  beard: [['none', 'None'], ['stubble', 'Stubble'], ['full', 'Full beard']],
  pack: [['yes', 'Backpack'], ['no', 'No backpack']],
};
export const LOOK_LABELS = { jacket: 'Jacket', hat: 'Hat', hatColor: 'Hat colour', skin: 'Skin tone', pants: 'Trousers', hair: 'Hair', beard: 'Beard', pack: 'Gear' };
export const DEFAULT_LOOK = { jacket: 'orange', hat: 'cap', hatColor: 'match', skin: '2', pants: 'khaki', hair: 'brown', beard: 'none', pack: 'yes' };

export function sanitizeLook(l) {
  const out = {};
  for (const k in DEFAULT_LOOK) {
    const v = l && l[k] !== undefined ? String(l[k]) : null;
    out[k] = v && LOOK_OPTIONS[k].some((o) => o[0] === v) ? v : DEFAULT_LOOK[k];
  }
  return out;
}
export function lookColor(kind, id) { const o = LOOK_OPTIONS[kind].find((x) => x[0] === id); return o && o[2] !== undefined ? o[2] : 0x888888; }
export function loadLook() { try { return sanitizeLook(JSON.parse(localStorage.getItem('whs.look') || 'null')); } catch { return { ...DEFAULT_LOOK }; } }
export function saveLook(look) { try { localStorage.setItem('whs.look', JSON.stringify(look)); } catch { /* storage unavailable */ } }
export function randomLook() {
  const out = {};
  for (const k in LOOK_OPTIONS) out[k] = LOOK_OPTIONS[k][Math.floor(Math.random() * LOOK_OPTIONS[k].length)][0];
  return out;
}

// ---------- third-person items (origin = where the right hand grips; +z = forward) ----------
let flashTex = null;
function muzzleFlash(z, y = 0.02, s = 0.45) {
  if (!flashTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.3, 'rgba(255,190,80,0.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    flashTex = new THREE.CanvasTexture(cv);
  }
  const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  f.position.set(0, y, z); f.scale.setScalar(s); f.visible = false;
  return f;
}
const box = (w, h, d, x, y, z, c, rx = 0, ry = 0, rz = 0) => colorize(xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz), c);

const ITEM_GEO = {};
function tieredGeometry(id, tier) {
  const key = id + ':' + tier;
  if (ITEM_GEO[key]) return ITEM_GEO[key];
  const base = itemGeometry(id);
  if (!tier || !AV_COLORS[id]) return base;
  const g = base.clone();
  g.userData = {};
  recolor(g, rarityMap(tier, AV_COLORS[id].wood, AV_COLORS[id].metal));
  ITEM_GEO[key] = g;
  return g;
}
function itemGeometry(id) {
  if (!ITEM_GEO[id]) ITEM_GEO[id] = thirdPersonGeometry(id);
  return ITEM_GEO[id];
}

// Weapon placement relative to the shoulders: 'aim' follows the view, 'low' is the carry position.
// R / L = where each hand grips, in the item's own space (null = that hand hangs at the side).
const POSE = {
  rifle: { aim: [[0.12, -0.03, 0.0], [0, 0, 0]], low: [[0.14, -0.34, 0.22], [0.42, -0.72, 0.45]], R: [0, -0.07, 0.25], L: [0, -0.02, 0.66], flash: 1.2, flashY: 0.028 },
  shotgun: { aim: [[0.12, -0.02, 0.0], [0, 0, 0]], low: [[0.14, -0.34, 0.22], [0.42, -0.72, 0.45]], R: [0, -0.06, 0.28], L: [0, -0.012, 0.76], flash: 1.18, flashY: 0.022 },
  pistol: { aim: [[0.02, -0.04, 0.52], [0, 0, 0]], low: [[0.24, -0.66, 0.14], [1.2, 0, 0]], R: [0, -0.01, 0], L: [-0.02, -0.03, -0.01], lAimOnly: true, flash: 0.24, flashY: 0.055 },
  bow: { aim: [[-0.07, 0.0, 0.6], [0, 0, -0.14]], low: [[-0.28, -0.6, 0.12], [0.15, 0, 0]], L: [0, 0, 0], R: 'string' },
  knife: { aim: [[0.2, -0.42, 0.36], [-0.25, 0, 0]], low: [[0.2, -0.42, 0.36], [-0.25, 0, 0]], R: [0, 0, 0] },
  binoculars: { aim: [[0, 0.22, 0.17], [0, 0, 0]], low: [[0, -0.24, 0.17], [0.4, 0, 0]], R: [0.05, -0.01, 0], L: [-0.05, -0.01, 0], handsAimOnly: true },
  bait: { aim: [[0.24, -0.58, 0.14], [0.3, 0, 0]], low: [[0.24, -0.58, 0.14], [0.3, 0, 0]], R: [0, 0.02, 0] },
  call: { aim: [[0.24, -0.58, 0.14], [0.3, 0, 0]], low: [[0.24, -0.58, 0.14], [0.3, 0, 0]], R: [0, 0.0, 0.0] },
  none: { aim: [[0, -0.5, 0.2], [0, 0, 0]], low: [[0, -0.5, 0.2], [0, 0, 0]], R: null, L: null },
};
const SHOULDER_Y = 1.46;
const HIP_Y = 0.95, THIGH = 0.45, SHIN = 0.42;
const UP = new THREE.Vector3(0, 1, 0);
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3(), _hand = new THREE.Vector3(), _elbow = new THREE.Vector3(), _dir = new THREE.Vector3();
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// sleeve segments: a tapered tube from 0 to 1 along y, stretched between two joints
const SEG = new THREE.CylinderGeometry(0.047, 0.04, 1, 16, 3).translate(0, 0.5, 0);
const JOINT = new THREE.SphereGeometry(1, 16, 12);
// gloved hand: palm, fingers and thumb; the wrist is at the origin and the fingers point along +y
const HAND_GEO = (() => {
  const p = [];
  p.push(ellipsoid(0, 0.038, 0, 0.033, 0.04, 0.017, 0xffffff, 12, 9));
  for (let k = 0; k < 4; k++) {
    const x = -0.021 + k * 0.014, len = [0.036, 0.04, 0.038, 0.03][k];
    p.push(cylinderBetween(new THREE.Vector3(x, 0.072, 0.002), new THREE.Vector3(x, 0.072 + len * 0.6, 0.008), 0.0072, 0.0066, 6, 0xffffff));
    p.push(cylinderBetween(new THREE.Vector3(x, 0.072 + len * 0.6, 0.008), new THREE.Vector3(x, 0.072 + len * 0.95, 0.022), 0.0066, 0.0058, 6, 0xffffff));
    p.push(ellipsoid(x, 0.072, 0.002, 0.0078, 0.0078, 0.0078, 0xffffff, 6, 5));
  }
  p.push(cylinderBetween(new THREE.Vector3(-0.026, 0.03, 0.006), new THREE.Vector3(-0.04, 0.062, 0.02), 0.009, 0.0075, 6, 0xffffff));
  return mergeColored(p);
})();

function setSeg(mesh, a, b) {
  _v.subVectors(b, a);
  const len = _v.length() || 0.001;
  mesh.position.copy(a);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, _v.divideScalar(len));
}

// cloth gets a woven grain and a soft sheen at the edges; faces a much finer one
const vcMat = enhanceMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { grain: 0.11, freq: 75, rim: 0.32 });
const headMat = enhanceMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { grain: 0.04, freq: 110, rim: 0.22 });
const _c = new THREE.Color(), _c2 = new THREE.Color();
const mixHex = (a, b, t) => _c.setHex(a).lerp(_c2.setHex(b), Math.max(0, Math.min(1, t))).getHex();
const shadeHex = (a, k) => _c.setHex(a).multiplyScalar(k).getHex();

// Fabric patterns painted into vertex colours
function fabric(kind, base) {
  const n = (p) => Math.sin(p.x * 37 + p.y * 23) * Math.sin(p.y * 29 - p.z * 31) + Math.sin(p.x * 13 + p.z * 17 + p.y * 9) * 0.6;
  if (kind === 'camo') return (p) => { const v = n(p); return v > 0.55 ? 0x2e3324 : v > 0.1 ? 0x6a5a3a : v < -0.6 ? 0x3a4228 : base; };
  if (kind === 'snow') return (p) => { const v = n(p); return v > 0.55 ? 0xa8b0b4 : v > 0.15 ? 0xc4cacc : v < -0.6 ? 0x8a9298 : base; };
  if (kind === 'plaid') return (p) => {
    const a = Math.abs(Math.sin(p.y * 42)) < 0.28, b = Math.abs(Math.sin((p.x + p.z) * 42)) < 0.28;
    return a && b ? shadeHex(base, 0.35) : a || b ? shadeHex(base, 0.62) : base;
  };
  return () => base;
}

function lathe(profile, color, seg = 16) {
  return colorize(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), seg), color);
}

export class Avatar {
  constructor(look) {
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ'; // lying down tilts the body forward after turning to face
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.aimGroup = new THREE.Group(); // pitches with the view: head
    this.aimGroup.position.set(0, SHOULDER_Y, 0);
    this.body.add(this.aimGroup);
    this.weapon = new THREE.Group();
    this.body.add(this.weapon);
    this.sleeveMat = enhanceMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), { grain: 0.11, freq: 75, rim: 0.32 });
    this.skinMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.gloveMat = enhanceMaterial(new THREE.MeshLambertMaterial({ color: 0x3b3a30 }), { grain: 0.14, freq: 140, rim: 0.2 });
    this.arms = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const upper = new THREE.Mesh(SEG, this.sleeveMat), fore = new THREE.Mesh(SEG, this.sleeveMat);
      const shoulder = new THREE.Mesh(JOINT, this.sleeveMat), elbow = new THREE.Mesh(JOINT, this.sleeveMat);
      shoulder.scale.setScalar(0.068); elbow.scale.setScalar(0.046);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.035, 10), this.sleeveMat);
      const hand = new THREE.Mesh(HAND_GEO, this.gloveMat);
      if (side < 0) hand.scale.x = -1; // mirror the thumb for the left hand
      [upper, fore, shoulder, elbow, cuff, hand].forEach((m) => { m.castShadow = true; this.body.add(m); });
      this.arms.push({ upper, fore, shoulder, elbow, cuff, hand, side });
    }
    // legs: hip and knee joints so walking and crouching bend the knees
    this.legs = [];
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, HIP_Y, 0);
      const knee = new THREE.Group();
      knee.position.set(0, -THIGH, 0);
      hip.add(knee);
      this.root.add(hip);
      this.legs.push({ hip, knee, side, thigh: null, shin: null });
    }
    this.parts = [];
    this.items = {};
    this.item = null;
    this.aimAmt = 0; this.pitch = 0; this.draw = 0; this.flashT = 0; this.kick = 0; this.phase = 0; this.crouchAmt = 0; this.proneAmt = 0;
    // bow string and nocked arrow
    const strMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d0 });
    const strGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 4).translate(0, 0.5, 0);
    this.strA = new THREE.Mesh(strGeo, strMat); this.strB = new THREE.Mesh(strGeo, strMat);
    this.arrow = new THREE.Mesh(colorize(new THREE.CylinderGeometry(0.005, 0.005, 0.72, 5).translate(0, 0.36, 0), 0xcaa870), vcMat);
    this.setLook(look);
    this.setItem('knife');
  }

  setLook(look) {
    this.look = { ...look };
    for (const m of this.parts) { m.parent?.remove(m); m.geometry.dispose(); }
    this.parts = [];
    const add = (geo, parent, mat = vcMat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); this.parts.push(m); return m; };
    const jacket = lookColor('jacket', look.jacket), skin = lookColor('skin', look.skin), pants = lookColor('pants', look.pants);
    const hair = lookColor('hair', look.hair);
    const hatC = look.hatColor === 'match' ? jacket : lookColor('hatColor', look.hatColor);
    const pattern = fabric(look.jacket === 'camo' ? 'camo' : look.jacket === 'snow' ? 'snow' : look.jacket === 'red' ? 'plaid' : '', jacket);
    this.sleeveMat.color.setHex(jacket);
    this.skinMat.color.setHex(skin);

    // ---- torso: hips, waist, chest and sloping shoulders in one smooth shape ----
    const ring = (y, rx, ry, z = 0) => ({ c: V3(0, y, z), rx, ry, p: 2.6 });
    const torsoRings = [
      ring(0.88, 0.15, 0.1), ring(0.9, 0.185, 0.118), ring(0.97, 0.198, 0.125), ring(1.08, 0.19, 0.122),
      ring(1.22, 0.205, 0.132, 0.005), ring(1.35, 0.222, 0.138, 0.01), ring(1.45, 0.226, 0.13, 0.0), ring(1.52, 0.2, 0.115, -0.005),
      ring(1.57, 0.13, 0.09, -0.005), ring(1.6, 0.075, 0.065, 0),
    ];
    const ao = (c, p) => {
      let k = 1;
      if (Math.abs(p.x) > 0.17 && p.y > 1.22 && p.y < 1.47) k *= 0.78 + 0.22 * Math.min(1, (0.226 - Math.abs(p.x)) / 0.05); // under the arms
      if (p.y > 1.54) k *= 0.86; // in the collar's shadow
      if (p.y < 0.9 && Math.abs(p.x) < 0.06) k *= 0.8; // crotch
      return shadeHex(c, k);
    };
    const torsoColor = (p, s) => {
      {
        if (p.y < 0.935) return pants;
        if (p.y < 0.965) return shadeHex(jacket, 0.72); // hem
        let c = pattern(p);
        if (s > 0.985 && p.y < 1.55) c = shadeHex(c, 0.55); // zip
        // side seams and a yoke across the shoulders
        if (Math.abs(Math.abs(p.x) - 0.2) < 0.006 && p.y < 1.4) c = shadeHex(c, 0.8);
        if (Math.abs(p.y - 1.42) < 0.006) c = shadeHex(c, 0.82);
        return shadeHex(c, 0.9 + 0.12 * (p.y - 0.9) / 0.7);
      }
    };
    add(loft(torsoRings, { seg: 32, ySign: -1, color: (p, u, s) => ao(torsoColor(p, s), p) }), this.body);
    const t = [];
    if (look.jacket === 'orange') t.push(loft([ring(1.305, 0.2215, 0.1385, 0.009), ring(1.345, 0.2245, 0.1405, 0.01)], { seg: 22, ySign: -1, capStart: false, capEnd: false, color: () => 0xf0d040 })); // reflective band
    // collar, chest pockets and zip pull
    t.push(colorize(xf(new THREE.TorusGeometry(0.078, 0.022, 8, 18), 0, 1.585, 0, Math.PI / 2, 0, 0), shadeHex(jacket, 0.8)));
    for (const sx of [-1, 1]) {
      t.push(box(0.085, 0.08, 0.014, sx * 0.1, 1.31, 0.141, shadeHex(jacket, 0.82), 0.1));
      t.push(box(0.088, 0.022, 0.016, sx * 0.1, 1.355, 0.143, shadeHex(jacket, 0.7), 0.1));
    }
    t.push(box(0.012, 0.03, 0.01, 0, 1.47, 0.135, 0xb8b0a0));
    t.push(loft([ring(0.9, 0.19, 0.123), ring(0.932, 0.2, 0.128)], { seg: 32, ySign: -1, capStart: false, capEnd: false, color: () => 0x2a1e16 })); // belt
    t.push(box(0.05, 0.036, 0.012, 0, 0.916, 0.128, 0x9a8e70), box(0.034, 0.02, 0.014, 0, 0.916, 0.129, 0x2a1e16)); // buckle
    t.push(ellipsoid(0, 1.575, -0.085, 0.12, 0.05, 0.06, shadeHex(jacket, 0.78), 16, 10)); // rolled-up hood
    for (const sx of [-1, 1]) t.push(box(0.012, 0.11, 0.07, sx * 0.205, 1.12, 0.06, shadeHex(jacket, 0.84), 0, 0, sx * 0.04)); // hand-warmer pockets
    if (look.pack === 'yes') {
      const pk = 0x4a4030, strap = 0x3a3226;
      t.push(loft([ring(1.06, 0.13, 0.05, -0.2), ring(1.1, 0.155, 0.065, -0.205), ring(1.3, 0.16, 0.07, -0.21), ring(1.48, 0.15, 0.064, -0.205), ring(1.52, 0.12, 0.05, -0.2)], { seg: 16, ySign: -1, color: () => pk }));
      t.push(box(0.24, 0.12, 0.04, 0, 1.17, -0.27, strap), box(0.3, 0.05, 0.13, 0, 1.5, -0.2, shadeHex(pk, 0.85)));
      for (const sx of [-1, 1]) {
        t.push(loft(curveRings([V3(sx * 0.1, 1.46, -0.15), V3(sx * 0.11, 1.575, -0.04), V3(sx * 0.115, 1.53, 0.1), V3(sx * 0.11, 1.3, 0.148), V3(sx * 0.1, 1.12, 0.135)], [0.02, 0.008], 14), { seg: 6, color: () => strap }));
        t.push(box(0.05, 0.14, 0.08, sx * 0.175, 1.22, -0.2, shadeHex(pk, 0.9)));
      }
    }
    add(mergeColored(t), this.body);

    // ---- head (aim space: it turns up and down with the view) ----
    const h = [];
    const lips = mixHex(skin, 0x9a4a40, 0.45), skinD = shadeHex(skin, 0.9);
    h.push(colorize(xf(new THREE.CylinderGeometry(0.048, 0.054, 0.13, 12), 0, 0.075, -0.005), skin)); // neck
    h.push(ellipsoid(0, 0.228, 0, 0.1, 0.12, 0.108, skin, 24, 18)); // skull
    h.push(ellipsoid(0, 0.168, 0.032, 0.083, 0.066, 0.085, skin, 20, 14)); // cheeks and jaw
    h.push(ellipsoid(0, 0.122, 0.07, 0.038, 0.028, 0.034, skin, 10, 8)); // chin
    h.push(ellipsoid(0, 0.205, 0.108, 0.017, 0.032, 0.022, skinD, 8, 6, -0.25)); // nose bridge
    h.push(ellipsoid(0, 0.185, 0.118, 0.021, 0.015, 0.017, skinD, 8, 6)); // nose tip
    h.push(ellipsoid(0, 0.1515, 0.1105, 0.019, 0.0048, 0.0075, lips, 10, 6)); // upper lip
    h.push(ellipsoid(0, 0.1435, 0.109, 0.017, 0.006, 0.0085, mixHex(lips, skin, 0.25), 10, 6)); // lower lip
    h.push(ellipsoid(0, 0.247, 0.098, 0.03, 0.009, 0.014, skinD, 10, 6)); // brow ridge
    for (const sx of [-1, 1]) {
      h.push(ellipsoid(sx * 0.102, 0.212, -0.005, 0.016, 0.033, 0.024, skinD, 8, 6)); // ear
      h.push(ellipsoid(sx * 0.038, 0.235, 0.087, 0.025, 0.017, 0.013, mixHex(skin, 0x4a2a24, 0.16), 10, 8)); // eye socket shadow
      h.push(ellipsoid(sx * 0.038, 0.234, 0.094, 0.019, 0.012, 0.012, 0xf2eee6, 10, 8)); // eye white
      h.push(ellipsoid(sx * 0.038, 0.234, 0.1035, 0.0085, 0.0085, 0.005, 0x4a3420, 10, 8)); // iris
      h.push(ellipsoid(sx * 0.038, 0.234, 0.1072, 0.0042, 0.0042, 0.002, 0x0a0806, 8, 6)); // pupil
      h.push(ellipsoid(sx * 0.0345, 0.2375, 0.1078, 0.0018, 0.0018, 0.001, 0xffffff, 6, 4)); // catchlight
      h.push(ellipsoid(sx * 0.038, 0.2448, 0.0965, 0.021, 0.0062, 0.0135, skinD, 10, 6, 0.15)); // upper eyelid
      h.push(ellipsoid(sx * 0.038, 0.2238, 0.0965, 0.019, 0.0038, 0.011, skin, 10, 6)); // lower eyelid
      h.push(ellipsoid(sx * 0.041, 0.2575, 0.101, 0.021, 0.0055, 0.008, hair, 10, 6, 0, 0, sx * -0.14)); // eyebrow
      h.push(ellipsoid(sx * 0.0085, 0.1775, 0.1215, 0.0045, 0.003, 0.003, mixHex(skin, 0x2a1810, 0.6), 6, 4)); // nostril
      h.push(ellipsoid(sx * 0.05, 0.192, 0.083, 0.019, 0.016, 0.016, mixHex(skin, 0xc06050, 0.08), 10, 8)); // cheek
      h.push(ellipsoid(sx * 0.104, 0.212, 0.002, 0.008, 0.02, 0.012, mixHex(skin, 0x6a3a30, 0.3), 6, 5)); // inner ear
      h.push(ellipsoid(sx * 0.095, 0.205, 0.035, 0.008, 0.03, 0.016, hair, 8, 6)); // sideburn
    }
    if (look.beard === 'full') {
      h.push(ellipsoid(0, 0.145, 0.05, 0.092, 0.07, 0.083, hair, 14, 10));
      h.push(box(0.05, 0.014, 0.016, 0, 0.162, 0.112, hair)); // moustache
    } else if (look.beard === 'stubble') h.push(ellipsoid(0, 0.152, 0.046, 0.086, 0.062, 0.084, mixHex(skin, hair, 0.4), 14, 10));
    // hair shows below every hat
    h.push(ellipsoid(0, 0.21, -0.04, 0.103, 0.1, 0.085, hair, 14, 10));
    if (look.hat === 'none') {
      h.push(ellipsoid(0, 0.272, -0.005, 0.106, 0.078, 0.116, hair, 16, 10));
      h.push(ellipsoid(0, 0.285, 0.06, 0.09, 0.04, 0.06, hair, 12, 8, 0.3)); // fringe
    } else if (look.hat === 'cap') {
      h.push(lathe([[0, 0.368], [0.06, 0.362], [0.098, 0.338], [0.114, 0.3], [0.116, 0.262], [0, 0.262]], hatC, 18));
      h.push(xf(ellipsoid(0, 0, 0, 0.095, 0.009, 0.082, hatC, 14, 6), 0, 0.272, 0.102, -0.1, 0, 0));
      h.push(ellipsoid(0, 0.369, 0, 0.014, 0.008, 0.014, shadeHex(hatC, 0.7), 6, 4));
    } else if (look.hat === 'beanie') {
      h.push(lathe([[0, 0.375], [0.05, 0.37], [0.095, 0.345], [0.117, 0.3], [0.119, 0.26], [0, 0.26]], hatC, 18));
      h.push(lathe([[0.121, 0.245], [0.124, 0.265], [0.124, 0.29], [0.121, 0.3], [0.1, 0.3], [0.1, 0.245]], shadeHex(hatC, 0.82), 18));
      h.push(ellipsoid(0, 0.39, 0, 0.032, 0.03, 0.032, 0xe6e2da, 8, 6));
    } else if (look.hat === 'cowboy') {
      h.push(lathe([[0, 0.272], [0.2, 0.268], [0.238, 0.282], [0.252, 0.3], [0.246, 0.302], [0.232, 0.288], [0.2, 0.258], [0, 0.262]], hatC, 24));
      h.push(lathe([[0, 0.41], [0.05, 0.4], [0.085, 0.415], [0.104, 0.39], [0.108, 0.32], [0.106, 0.27], [0, 0.27]], hatC, 20));
      h.push(lathe([[0.108, 0.278], [0.109, 0.302], [0.1, 0.302], [0.1, 0.278]], 0x2a1a10, 20)); // band
    } else if (look.hat === 'bucket') {
      h.push(lathe([[0, 0.375], [0.085, 0.37], [0.106, 0.335], [0.114, 0.26], [0, 0.26]], hatC, 18));
      h.push(lathe([[0.11, 0.27], [0.19, 0.232], [0.195, 0.226], [0.11, 0.258]], shadeHex(hatC, 0.92), 20));
    }
    add(mergeColored(h), this.aimGroup, headMat);

    // ---- legs: thigh, knee, shin and boot ----
    const pantsCol = fabric(look.pants === 'camo' ? 'camo' : '', pants);
    const thighGeo = (side) => mergeColored([loft([
      { c: V3(0, 0.05, 0), rx: 0.06, ry: 0.065 }, { c: V3(0, 0.0, 0), rx: 0.085, ry: 0.09 }, { c: V3(0, -0.2, 0.005), rx: 0.078, ry: 0.082 },
      { c: V3(0, -0.4, 0.01), rx: 0.063, ry: 0.066 }, { c: V3(0, -THIGH - 0.03, 0.01), rx: 0.055, ry: 0.058 },
    ], { seg: 20, color: (p) => (p.y < -0.33 && p.z > 0.02 ? shadeHex(pantsCol(p), 0.88) : pantsCol(p)) }),
      box(0.022, 0.12, 0.1, side * 0.078, -0.2, 0.005, shadeHex(pants, 0.86), 0, 0, side * -0.06), // cargo pocket
      box(0.026, 0.03, 0.105, side * 0.08, -0.14, 0.005, shadeHex(pants, 0.74), 0, 0, side * -0.06), // pocket flap
    ]);
    const shinGeo = mergeColored([
      loft([{ c: V3(0, 0.03, 0.01), rx: 0.056, ry: 0.06 }, { c: V3(0, -0.12, 0), rx: 0.058, ry: 0.064 }, { c: V3(0, -0.3, -0.005), rx: 0.05, ry: 0.052 }, { c: V3(0, -0.36, 0), rx: 0.052, ry: 0.055 }], { seg: 14, color: (p) => pantsCol(p) }),
      // boot: shaft, ankle and foot with a toe cap and a darker sole
      loft([{ c: V3(0, -0.3, 0), rx: 0.058, ry: 0.062 }, { c: V3(0, -0.38, 0.0), rx: 0.056, ry: 0.06 }, { c: V3(0, -0.44, 0.01), rx: 0.054, ry: 0.06 }], { seg: 14, color: () => 0x3a2c20 }),
      loft([{ c: V3(0, -0.46, -0.06), rx: 0.045, ry: 0.035 }, { c: V3(0, -0.46, -0.03), rx: 0.056, ry: 0.045 }, { c: V3(0, -0.465, 0.06), rx: 0.056, ry: 0.04 }, { c: V3(0, -0.47, 0.14), rx: 0.048, ry: 0.032 }, { c: V3(0, -0.475, 0.17), rx: 0.028, ry: 0.022 }], {
        seg: 14, side: V3(1, 0, 0), color: (p) => (p.y < -0.49 ? 0x161210 : 0x3a2c20),
      }),
      box(0.105, 0.022, 0.24, 0, -0.495, 0.055, 0x161210),
      box(0.04, 0.09, 0.012, 0, -0.39, 0.058, 0x4a3828), // tongue
      ...[0, 1, 2, 3].map((k) => box(0.05, 0.006, 0.01, 0, -0.355 - k * 0.025, 0.063, 0xb09a70)), // laces
      loft([{ c: V3(0, -0.29, 0), rx: 0.061, ry: 0.065 }, { c: V3(0, -0.31, 0), rx: 0.061, ry: 0.065 }], { seg: 16, capStart: false, capEnd: false, color: () => 0x2a2018 }), // boot collar
    ]);
    const thighs = { 1: thighGeo(1), [-1]: thighGeo(-1) };
    for (const L of this.legs) {
      L.thigh = add(thighs[L.side], L.hip);
      L.shin = add(shinGeo, L.knee);
    }
  }

  setItem(id, tier = 0) {
    if (!POSE[id]) id = 'knife';
    if (this.item === id && this.itemTier === tier) return;
    this.item = id;
    this.itemTier = tier;
    for (const k in this.items) this.items[k].visible = false;
    if (id === 'none') return;
    if (!this.items[id]) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(tieredGeometry(id, tier), vcMat);
      mesh.castShadow = true;
      g.add(mesh);
      g.mesh = mesh;
      if (POSE[id].flash) { g.flash = muzzleFlash(POSE[id].flash, POSE[id].flashY, id === 'shotgun' ? 0.55 : 0.4); g.add(g.flash); }
      if (id === 'bow') g.add(this.strA, this.strB, this.arrow);
      this.weapon.add(g);
      this.items[id] = g;
    }
    this.items[id].mesh.geometry = tieredGeometry(id, tier);
    this.items[id].visible = true;
  }

  fire() { this.flashT = 0.06; this.kick = 1; }

  // a work apron over the clothes (shopkeepers); stripe: optional pinstripe colour
  setApron(color, stripe = null) {
    if (this.apron) { this.body.remove(this.apron); this.apron.geometry.dispose(); }
    const p = [];
    const plate = (w, h, y, z, c) => p.push(box(w, h, 0.016, 0, y, z, c));
    plate(0.4, 0.56, 1.06, 0.142, color);
    plate(0.27, 0.27, 1.42, 0.15, color);
    if (stripe) for (let x = -0.18; x <= 0.18; x += 0.045) p.push(box(0.008, 0.82, 0.018, x, 1.16, 0.149, stripe));
    p.push(box(0.42, 0.04, 0.02, 0, 1.08, 0.152, color === 0xf0ece4 ? 0xcfc8bc : color)); // waist tie
    p.push(box(0.11, 0.09, 0.02, 0.1, 0.98, 0.153, color)); // pocket
    for (const s of [-1, 1]) p.push(cylinderBetween(new THREE.Vector3(s * 0.12, 1.55, 0.15), new THREE.Vector3(s * 0.06, 1.62, 0.02), 0.008, 0.008, 5, color)); // neck strap
    this.apron = new THREE.Mesh(mergeColored(p), vcMat);
    this.apron.castShadow = true;
    this.body.add(this.apron);
  }

  // state: { pitch, aim (0..1), draw (0..1), item, moving, crouch, dead, swimming, dt }
  update(dt, s) {
    this.setItem(s.item, s.tier || 0);
    this.pitch += (s.pitch - this.pitch) * Math.min(1, dt * 14);
    this.aimAmt += ((s.aim || 0) - this.aimAmt) * Math.min(1, dt * 10);
    this.draw += ((s.draw || 0) - this.draw) * Math.min(1, dt * 12);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.crouchAmt += ((s.crouch && !s.dead ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 10);
    this.proneAmt += ((s.prone && !s.dead && !s.swimming ? 1 : 0) - this.proneAmt) * Math.min(1, dt * 5);
    const pr = this.proneAmt;
    const cr = this.crouchAmt * (1 - pr);
    this.life = (this.life || Math.random() * 10) + dt;
    // breathing lifts the chest a little; walking swings the shoulders against the hips
    const bob = s.moving && !s.dead && !s.swimming ? Math.abs(Math.sin(this.phase)) * 0.018 * (1 - pr) : 0;
    this.body.position.y = -0.32 * cr + bob + (s.dead ? 0 : Math.sin(this.life * 1.7) * 0.004);
    this.body.rotation.y = s.moving && !s.dead && !s.swimming ? Math.sin(this.phase) * 0.06 : 0;
    // the head turns to look around when told to (shopkeepers), or glances about when idle
    const idleLook = !s.moving && !s.dead && (s.aim || 0) < 0.1 ? Math.sin(this.life * 0.37) * 0.25 * Math.max(0, Math.sin(this.life * 0.13)) : 0;
    this.lookYaw = (this.lookYaw || 0) + ((s.lookYaw !== undefined ? s.lookYaw : idleLook) - (this.lookYaw || 0)) * Math.min(1, dt * 4);
    this.phase += s.moving ? dt * (pr > 0.5 ? 4 : s.crouch ? 6 : 9) : 0;
    // legs: swing from the hip, bend the knee on the back swing; crouching folds both joints
    for (const L of this.legs) {
      const ph = this.phase + (L.side > 0 ? 0 : Math.PI);
      const sw = s.moving && !s.dead ? Math.sin(ph) : 0;
      const lift = s.moving && !s.dead ? Math.max(0, -Math.cos(ph)) : 0;
      L.hip.position.y = HIP_Y - 0.32 * cr;
      if (s.swimming) { L.hip.rotation.x = Math.sin(this.phase * 1.4 + L.side) * 0.35; L.knee.rotation.x = 0.4; continue; }
      // prone: legs straight out behind, a slow crawl lifts one knee then the other
      L.hip.rotation.x = (sw * 0.45 * (1 - cr * 0.4) - 0.95 * cr) * (1 - pr) + pr * sw * 0.2;
      L.hip.rotation.z = pr * L.side * 0.12;
      L.knee.rotation.x = (lift * 0.75 + 1.75 * cr) * (1 - pr) + pr * (0.15 + lift * 0.7);
    }
    this.aimGroup.rotation.x = -this.pitch - pr * 1.3; // lying down: chin up to look ahead
    this.aimGroup.rotation.y = this.lookYaw;
    this.weapon.visible = !s.swimming && !s.dead && this.item !== 'none';

    // weapon placement: blend the carry pose with the aim pose (which follows the view)
    // lying down, items are held out in front along the ground
    const P = POSE[this.item], a = Math.max(this.aimAmt, pr);
    _m1.compose(_p1.set(0, SHOULDER_Y, 0), _q1.setFromEuler(_e.set(-this.pitch - pr * Math.PI / 2, 0, 0)), _s);
    _m2.compose(_p2.fromArray(P.aim[0]), _q2.setFromEuler(_e.set(P.aim[1][0] + this.kick * 0.12, P.aim[1][1], P.aim[1][2])), _s);
    _m3.multiplyMatrices(_m1, _m2);
    const aimPos = new THREE.Vector3(), aimQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
    _m3.decompose(aimPos, aimQ, tmpS);
    if (pr > 0) aimPos.z += (Math.min(aimPos.z, 0.05) - aimPos.z) * pr; // keep it above the ground
    const lowPos = _p1.set(P.low[0][0], P.low[0][1] + SHOULDER_Y, P.low[0][2]);
    const lowQ = _q1.setFromEuler(_e.set(P.low[1][0], P.low[1][1], P.low[1][2]));
    this.weapon.position.lerpVectors(lowPos, aimPos, a);
    this.weapon.position.z -= this.kick * 0.04;
    this.weapon.quaternion.slerpQuaternions(lowQ, aimQ, a);
    this.weapon.updateMatrix();

    // bow string pulled back to the right hand
    if (this.item === 'bow') {
      const pull = Math.max(this.draw, 0);
      const nock = _p2.set(0, 0, -0.04 - pull * 0.42);
      setSeg(this.strA, new THREE.Vector3(0, 0.5, 0.03), nock);
      setSeg(this.strB, new THREE.Vector3(0, -0.5, 0.03), nock);
      this.arrow.visible = pull > 0.05;
      this.arrow.position.copy(nock);
      this.arrow.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, 0, 1));
    }
    const fl = this.items[this.item] && this.items[this.item].flash;
    if (fl) { fl.visible = this.flashT > 0; this.flashT -= dt; }

    // arms reach for the grip points, bending at the elbow
    for (const arm of this.arms) {
      const right = arm.side === 1;
      const S = _p1.set(arm.side * 0.2, SHOULDER_Y - 0.005, -0.005);
      let grip = right ? P.R : P.L, w = 1;
      if (right && grip === 'string') { grip = [0, 0, -0.04 - this.draw * 0.42]; w = Math.max(a, this.draw); }
      if (!right && P.lAimOnly) w = a;
      if (P.handsAimOnly) w = a;
      if (s.swimming || s.dead) w = 0;
      const rest = _p2.set(arm.side * 0.25, 0.9, 0.06 + (s.moving ? Math.sin(this.phase + (right ? Math.PI : 0)) * 0.12 : 0));
      if (this.restHands) rest.set(arm.side * this.restHands[0], this.restHands[1], this.restHands[2]);
      const hp = this.handPose && this.handPose[right ? 'R' : 'L'];
      if (hp) rest.fromArray(hp);
      if (s.swimming) rest.set(arm.side * 0.45, 1.25, 0.25 + Math.sin(this.phase + arm.side) * 0.2);
      if (grip) { _hand.fromArray(grip).applyMatrix4(this.weapon.matrix); _hand.lerpVectors(rest, _hand, w); } else _hand.copy(rest);
      // characters with posed hands (shopkeepers) move them smoothly from pose to pose
      if (this.restHands) { arm.sm = arm.sm || _hand.clone(); arm.sm.lerp(_hand, Math.min(1, dt * 7)); _hand.copy(arm.sm); }
      // elbow: half way, pushed outward and down; the closer the hand, the more the arm bends
      const reach = S.distanceTo(_hand);
      const bend = Math.max(0, 0.56 - reach) * 0.9;
      _elbow.addVectors(S, _hand).multiplyScalar(0.5);
      _elbow.x += arm.side * (0.05 + bend * 0.5); _elbow.y -= 0.05 + bend * 0.6; _elbow.z -= 0.02 + bend * 0.2;
      arm.shoulder.position.copy(S);
      setSeg(arm.upper, S, _elbow);
      arm.elbow.position.copy(_elbow);
      _dir.subVectors(_hand, _elbow).normalize();
      const wrist = _v.copy(_hand).addScaledVector(_dir, -0.045);
      setSeg(arm.fore, _elbow, wrist);
      arm.cuff.position.copy(wrist).addScaledVector(_dir, -0.012);
      arm.cuff.quaternion.setFromUnitVectors(UP, _dir);
      arm.hand.position.copy(wrist);
      arm.hand.quaternion.setFromUnitVectors(UP, _dir);
    }
    this.root.rotation.z = s.dead ? 1.45 : 0;
    this.root.rotation.x = pr * Math.PI / 2;
  }

  dispose() {
    for (const m of this.parts) if (!this.legs.some((L) => L.thigh === m || L.shin === m)) m.geometry.dispose();
    const legGeos = new Set(this.legs.flatMap((L) => [L.thigh && L.thigh.geometry, L.shin && L.shin.geometry]));
    for (const g of legGeos) g && g.dispose();
    this.sleeveMat.dispose(); this.skinMat.dispose(); this.gloveMat.dispose();
  }
}
