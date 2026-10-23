// Hunter avatars: how players look to each other in PvP (and in the character preview).
// The avatar holds its current item in its hands and points it where the player is looking.
import * as THREE from 'three';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween } from './geo.js';
import { rarityMap, recolor } from './rarity.js';

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
  beard: [['none', 'None'], ['stubble', 'Stubble'], ['full', 'Full beard']],
  pack: [['yes', 'Backpack'], ['no', 'No backpack']],
};
export const LOOK_LABELS = { jacket: 'Jacket', hat: 'Hat', hatColor: 'Hat colour', skin: 'Skin tone', pants: 'Trousers', beard: 'Beard', pack: 'Gear' };
export const DEFAULT_LOOK = { jacket: 'orange', hat: 'cap', hatColor: 'match', skin: '2', pants: 'khaki', beard: 'none', pack: 'yes' };

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
const cylZ = (r, len, x, y, z, c, seg = 8) => colorize(xf(new THREE.CylinderGeometry(r, r, len, seg), x, y, z, Math.PI / 2, 0, 0), c);
const wood = 0x5a3a20, steel = 0x26282c;

const ITEM_GEO = {};
const AV_COLORS = {
  rifle: { wood: [0x5a3a20], metal: [0x26282c, 0x18181a] },
  shotgun: { wood: [0x6a4a2a], metal: [0x26282c, 0x3a3a3e] },
  pistol: { wood: [0x5a3a22], metal: [0x26282c, 0x4a4e54] },
  bow: { wood: [0x6a3e22, 0x4a2a16], metal: [] },
};
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
  if (ITEM_GEO[id]) return ITEM_GEO[id];
  const p = [];
  if (id === 'rifle') { // origin at the butt
    p.push(box(0.05, 0.11, 0.34, 0, -0.03, 0.17, wood), box(0.045, 0.06, 0.08, 0, -0.08, 0.3, wood));
    p.push(box(0.05, 0.07, 0.24, 0, 0, 0.44, steel), cylZ(0.011, 0.56, 0, 0.01, 0.84, steel));
    p.push(box(0.045, 0.05, 0.26, 0, -0.035, 0.62, wood));
    p.push(cylZ(0.022, 0.32, 0, 0.07, 0.44, 0x18181a), cylZ(0.026, 0.05, 0, 0.07, 0.6, 0x18181a), box(0.02, 0.04, 0.03, 0, 0.045, 0.44, steel));
  } else if (id === 'shotgun') {
    p.push(box(0.05, 0.11, 0.32, 0, -0.03, 0.16, 0x6a4a2a), box(0.055, 0.08, 0.22, 0, 0, 0.42, 0x3a3a3e));
    p.push(cylZ(0.015, 0.52, 0, 0.015, 0.78, steel), cylZ(0.012, 0.42, 0, -0.025, 0.72, steel));
    p.push(box(0.05, 0.05, 0.16, 0, -0.03, 0.64, 0x6a4a2a));
  } else if (id === 'pistol') { // origin at the grip
    p.push(box(0.032, 0.1, 0.04, 0, -0.04, -0.01, 0x5a3a22, -0.3), box(0.03, 0.045, 0.08, 0, 0.025, 0.03, steel));
    p.push(colorize(xf(new THREE.CylinderGeometry(0.022, 0.022, 0.045, 10), 0, 0.022, 0.05, Math.PI / 2, 0, 0), 0x4a4e54));
    p.push(cylZ(0.009, 0.15, 0, 0.032, 0.15, steel));
  } else if (id === 'bow') { // origin at the grip, limbs along y
    p.push(box(0.03, 0.14, 0.035, 0, 0, 0, 0x4a2a16));
    const pts = [[0.07, 0], [0.22, 0.04], [0.38, 0.06], [0.5, 0.03], [0.56, -0.03]];
    for (const s of [1, -1]) for (let i = 0; i < pts.length - 1; i++) {
      p.push(cylinderBetween(new THREE.Vector3(0, pts[i][0] * s, pts[i][1]), new THREE.Vector3(0, pts[i + 1][0] * s, pts[i + 1][1]), 0.014 - i * 0.002, 0.012 - i * 0.002, 5, 0x6a3e22));
    }
  } else if (id === 'knife') {
    p.push(box(0.025, 0.03, 0.1, 0, 0, 0.0, 0x3a2a1a), box(0.008, 0.035, 0.16, 0, 0.004, 0.13, 0xc8ccd0), box(0.05, 0.012, 0.012, 0, 0, 0.05, 0x8a8a8a));
  } else if (id === 'binoculars') {
    for (const s of [-1, 1]) p.push(cylZ(0.026, 0.12, s * 0.036, 0, 0, 0x2a2a2c, 10));
    p.push(box(0.04, 0.02, 0.05, 0, 0, 0, 0x3a3a3c));
  } else if (id === 'bait') {
    p.push(box(0.14, 0.18, 0.08, 0, -0.08, 0, 0xb89a5a), box(0.15, 0.03, 0.09, 0, 0.0, 0, 0x8a6a3a));
  } else if (id === 'call') {
    p.push(cylZ(0.018, 0.14, 0, 0, 0.04, 0x3a2a1a), cylZ(0.024, 0.04, 0, 0, 0.12, 0x2a2a2a));
  }
  ITEM_GEO[id] = mergeColored(p);
  return ITEM_GEO[id];
}

// Weapon placement relative to the shoulders: 'aim' follows the view, 'low' is the carry position.
// R / L = where each hand grips, in the item's own space (null = that hand hangs at the side).
const POSE = {
  rifle: { aim: [[0.12, -0.05, 0.0], [0, 0, 0]], low: [[0.14, -0.34, 0.22], [0.42, -0.72, 0.45]], R: [0, -0.04, 0.3], L: [0, -0.03, 0.62], flash: 1.12 },
  shotgun: { aim: [[0.12, -0.05, 0.0], [0, 0, 0]], low: [[0.14, -0.34, 0.22], [0.42, -0.72, 0.45]], R: [0, -0.04, 0.29], L: [0, -0.04, 0.64], flash: 1.05 },
  pistol: { aim: [[0.02, -0.04, 0.52], [0, 0, 0]], low: [[0.24, -0.66, 0.14], [1.2, 0, 0]], R: [0, -0.05, 0], L: [-0.02, -0.07, -0.01], lAimOnly: true, flash: 0.24 },
  bow: { aim: [[-0.07, 0.0, 0.6], [0, 0, -0.14]], low: [[-0.28, -0.6, 0.12], [0.15, 0, 0]], L: [0, 0, 0], R: 'string' },
  knife: { aim: [[0.2, -0.42, 0.36], [-0.25, 0, 0]], low: [[0.2, -0.42, 0.36], [-0.25, 0, 0]], R: [0, 0, 0] },
  binoculars: { aim: [[0, 0.22, 0.17], [0, 0, 0]], low: [[0, -0.24, 0.17], [0.4, 0, 0]], R: [0.05, -0.01, 0], L: [-0.05, -0.01, 0], handsAimOnly: true },
  bait: { aim: [[0.24, -0.58, 0.14], [0.3, 0, 0]], low: [[0.24, -0.58, 0.14], [0.3, 0, 0]], R: [0, 0.02, 0] },
  call: { aim: [[0.24, -0.58, 0.14], [0.3, 0, 0]], low: [[0.24, -0.58, 0.14], [0.3, 0, 0]], R: [0, 0.0, 0.0] },
};
const SHOULDER_Y = 1.46;
const SEG = new THREE.CylinderGeometry(0.048, 0.042, 1, 7).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3(), _hand = new THREE.Vector3(), _elbow = new THREE.Vector3();

function setSeg(mesh, a, b) {
  _v.subVectors(b, a);
  const len = _v.length() || 0.001;
  mesh.position.copy(a);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, _v.divideScalar(len));
}

const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });

export class Avatar {
  constructor(look) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.aimGroup = new THREE.Group(); // pitches with the view: head
    this.aimGroup.position.set(0, SHOULDER_Y, 0);
    this.body.add(this.aimGroup);
    this.weapon = new THREE.Group();
    this.body.add(this.weapon);
    this.sleeveMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.skinMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.arms = [];
    for (let i = 0; i < 2; i++) {
      const upper = new THREE.Mesh(SEG, this.sleeveMat), fore = new THREE.Mesh(SEG, this.sleeveMat);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6), this.skinMat);
      [upper, fore, hand].forEach((m) => { m.castShadow = true; this.body.add(m); });
      this.arms.push({ upper, fore, hand, side: i === 0 ? 1 : -1 });
    }
    this.legs = [];
    this.parts = [];
    this.items = {};
    this.item = null;
    this.aimAmt = 0; this.pitch = 0; this.draw = 0; this.flashT = 0; this.kick = 0; this.phase = 0;
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
    const jacket = lookColor('jacket', look.jacket), skin = lookColor('skin', look.skin), pants = lookColor('pants', look.pants);
    const hatC = look.hatColor === 'match' ? jacket : lookColor('hatColor', look.hatColor);
    this.sleeveMat.color.setHex(jacket);
    this.skinMat.color.setHex(skin);
    // torso (body space)
    const t = [];
    t.push(box(0.44, 0.62, 0.26, 0, 1.26, 0, jacket), box(0.46, 0.1, 0.28, 0, 0.99, 0, 0x3a3022), box(0.08, 0.06, 0.03, 0, 0.99, 0.14, 0x9a8a5a));
    t.push(box(0.3, 0.08, 0.27, 0, 1.55, 0, jacket));
    const patches = look.jacket === 'camo' ? [0x2e3324, 0x6a5a3a, 0x3a4228] : look.jacket === 'snow' ? [0xa8b0b4, 0x8a9298, 0xc4cacc] : null;
    if (patches) {
      const spots = [[-0.12, 1.4, 1], [0.1, 1.15, 1], [0.15, 1.42, -1], [-0.1, 1.1, -1], [0.02, 1.28, 1], [-0.16, 1.22, -1], [0.12, 1.3, -1], [-0.04, 1.47, 1]];
      spots.forEach(([x, y, s], i) => t.push(box(0.12 + (i % 3) * 0.03, 0.1, 0.01, x, y, s * 0.132, patches[i % 3])));
    }
    if (look.jacket === 'red') for (let y = 1.0; y < 1.56; y += 0.12) t.push(box(0.445, 0.025, 0.265, 0, y + 0.03, 0, 0x2a1a1a));
    if (look.jacket === 'orange') t.push(box(0.446, 0.06, 0.265, 0, 1.36, 0, 0xf0d040)); // reflective band
    if (look.pack === 'yes') {
      t.push(box(0.32, 0.42, 0.14, 0, 1.3, -0.2, 0x4a4030), box(0.28, 0.12, 0.06, 0, 1.12, -0.29, 0x3a3226), box(0.3, 0.04, 0.15, 0, 1.52, -0.2, 0x3a3226));
      for (const s of [-1, 1]) t.push(box(0.04, 0.5, 0.02, s * 0.12, 1.3, 0.135, 0x3a3226));
    }
    const torso = new THREE.Mesh(mergeColored(t), vcMat);
    torso.castShadow = true;
    this.body.add(torso); this.parts.push(torso);
    // head (aim space: the head turns up and down with the view)
    const h = [];
    h.push(ellipsoid(0, 0.22, 0.02, 0.11, 0.13, 0.12, skin, 12, 9));
    h.push(ellipsoid(0, 0.21, 0.13, 0.025, 0.03, 0.025, skin, 6, 5)); // nose
    for (const s of [-1, 1]) h.push(box(0.025, 0.012, 0.01, s * 0.045, 0.25, 0.125, 0x1a1410));
    h.push(colorize(xf(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), 0, 0.07, 0), skin)); // neck
    if (look.beard === 'full') { h.push(ellipsoid(0, 0.14, 0.06, 0.1, 0.08, 0.08, 0x3a2416, 10, 7)); }
    if (look.beard === 'stubble') { h.push(ellipsoid(0, 0.15, 0.065, 0.095, 0.06, 0.075, 0x6a5040, 10, 7)); }
    if (look.hat === 'cap') { h.push(ellipsoid(0, 0.31, 0.02, 0.118, 0.07, 0.125, hatC, 12, 6), box(0.2, 0.015, 0.12, 0, 0.3, 0.15, hatC)); }
    else if (look.hat === 'beanie') { h.push(ellipsoid(0, 0.3, 0.02, 0.122, 0.1, 0.128, hatC, 12, 8), colorize(xf(new THREE.CylinderGeometry(0.124, 0.124, 0.05, 12), 0, 0.27, 0.02), hatC), ellipsoid(0, 0.4, 0.02, 0.03, 0.03, 0.03, 0xe6e2da, 6, 5)); }
    else if (look.hat === 'cowboy') { h.push(colorize(xf(new THREE.CylinderGeometry(0.24, 0.24, 0.015, 16), 0, 0.29, 0.02), hatC), colorize(xf(new THREE.CylinderGeometry(0.1, 0.12, 0.13, 12), 0, 0.36, 0.02), hatC), box(0.21, 0.02, 0.02, 0, 0.31, 0.13, 0x2a1a10)); }
    else if (look.hat === 'bucket') { h.push(colorize(xf(new THREE.CylinderGeometry(0.11, 0.13, 0.1, 12), 0, 0.33, 0.02), hatC), colorize(xf(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 14), 0, 0.29, 0.02), hatC)); }
    else { h.push(ellipsoid(0, 0.29, 0.0, 0.112, 0.06, 0.12, 0x3a2416, 10, 6)); } // hair
    const head = new THREE.Mesh(mergeColored(h), vcMat);
    head.castShadow = true;
    this.aimGroup.add(head); this.parts.push(head);
    // legs (pivot at the hip)
    for (const l of this.legs) this.root.remove(l);
    this.legs = [];
    const lg = mergeColored([box(0.16, 0.86, 0.18, 0, -0.43, 0, pants), box(0.17, 0.1, 0.28, 0, -0.88, 0.05, 0x2a2420)]);
    for (const s of [1, -1]) {
      const leg = new THREE.Mesh(lg, vcMat);
      leg.position.set(s * 0.11, 0.95, 0); leg.castShadow = true;
      this.root.add(leg); this.legs.push(leg); this.parts.push(leg);
    }
  }

  setItem(id, tier = 0) {
    if (!POSE[id]) id = 'knife';
    if (this.item === id && this.itemTier === tier) return;
    this.item = id;
    this.itemTier = tier;
    for (const k in this.items) this.items[k].visible = false;
    if (!this.items[id]) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(tieredGeometry(id, tier), vcMat);
      mesh.castShadow = true;
      g.add(mesh);
      g.mesh = mesh;
      if (POSE[id].flash) { g.flash = muzzleFlash(POSE[id].flash, id === 'pistol' ? 0.03 : 0.015, id === 'shotgun' ? 0.55 : 0.4); g.add(g.flash); }
      if (id === 'bow') g.add(this.strA, this.strB, this.arrow);
      this.weapon.add(g);
      this.items[id] = g;
    }
    this.items[id].mesh.geometry = tieredGeometry(id, tier);
    this.items[id].visible = true;
  }

  fire() { this.flashT = 0.06; this.kick = 1; }

  // state: { pitch, aim (0..1), draw (0..1), item, moving, crouch, dead, swimming, dt }
  update(dt, s) {
    this.setItem(s.item, s.tier || 0);
    this.pitch += (s.pitch - this.pitch) * Math.min(1, dt * 14);
    this.aimAmt += ((s.aim || 0) - this.aimAmt) * Math.min(1, dt * 10);
    this.draw += ((s.draw || 0) - this.draw) * Math.min(1, dt * 12);
    this.kick = Math.max(0, this.kick - dt * 6);
    const crouch = s.crouch && !s.dead ? 1 : 0;
    this.body.position.y = -0.32 * crouch;
    for (const l of this.legs) { l.scale.y = crouch ? 0.62 : 1; l.position.y = 0.95 - 0.32 * crouch; }
    this.phase += s.moving ? dt * 9 : 0;
    const sw = s.moving && !s.dead ? Math.sin(this.phase) * 0.5 : 0;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    this.aimGroup.rotation.x = -this.pitch;
    this.weapon.visible = !s.swimming && !s.dead;

    // weapon placement: blend the carry pose with the aim pose (which follows the view)
    const P = POSE[this.item], a = this.aimAmt;
    _m1.compose(_p1.set(0, SHOULDER_Y, 0), _q1.setFromEuler(_e.set(-this.pitch, 0, 0)), _s);
    _m2.compose(_p2.fromArray(P.aim[0]), _q2.setFromEuler(_e.set(P.aim[1][0] + this.kick * 0.12, P.aim[1][1], P.aim[1][2])), _s);
    _m3.multiplyMatrices(_m1, _m2);
    const aimPos = new THREE.Vector3(), aimQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
    _m3.decompose(aimPos, aimQ, tmpS);
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
      setSeg(this.strA, new THREE.Vector3(0, 0.55, -0.03), nock);
      setSeg(this.strB, new THREE.Vector3(0, -0.55, -0.03), nock);
      this.arrow.visible = pull > 0.05;
      this.arrow.position.copy(nock);
      this.arrow.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, 0, 1));
    }
    const fl = this.items[this.item].flash;
    if (fl) { fl.visible = this.flashT > 0; this.flashT -= dt; }

    // arms reach for the grip points
    for (const arm of this.arms) {
      const right = arm.side === 1;
      const S = _p1.set(arm.side * 0.215, SHOULDER_Y + 0.01, 0);
      let grip = right ? P.R : P.L, w = 1;
      if (right && grip === 'string') { grip = [0, 0, -0.04 - this.draw * 0.42]; w = Math.max(a, this.draw); }
      if (!right && P.lAimOnly) w = a;
      if (P.handsAimOnly) w = a;
      if (s.swimming || s.dead) w = 0;
      const rest = _p2.set(arm.side * 0.27, 0.86, 0.05);
      if (s.swimming) rest.set(arm.side * 0.45, 1.25, 0.25 + Math.sin(this.phase + arm.side) * 0.2);
      if (grip) { _hand.fromArray(grip).applyMatrix4(this.weapon.matrix); _hand.lerpVectors(rest, _hand, w); } else _hand.copy(rest);
      _elbow.addVectors(S, _hand).multiplyScalar(0.5);
      _elbow.x += arm.side * 0.07; _elbow.y -= 0.08; _elbow.z -= 0.02;
      setSeg(arm.upper, S, _elbow);
      setSeg(arm.fore, _elbow, _hand);
      arm.hand.position.copy(_hand);
    }
    this.root.rotation.z = s.dead ? 1.45 : 0;
  }

  dispose() {
    for (const m of this.parts) m.geometry.dispose();
    this.sleeveMat.dispose(); this.skinMat.dispose();
  }
}
