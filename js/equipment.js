// First-person equipment: rifle (scope), pump shotgun, revolver, recurve bow, hunting knife,
// binoculars, corn bait and a game call. Ballistic hitscan for bullets and pellets, real
// projectiles for arrows, per-weapon ammunition, recoil and reload animations.
import * as THREE from 'three';
import { G, settings, saveProgress } from './state.js';
import { clamp, damp, lerp, smoothstep } from './utils.js';
import { RARITY, rarityMap, recolor } from './rarity.js';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween, loft, curveRings } from './geo.js';
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
const glove = 0x4e4636, sleeve = 0x4a4f3a;
// stock (wood) and metal colours of each first-person weapon, for rarity finishes
const VM_COLORS = {
  rifle: { wood: [0x5b3a22, 0x4a2e1a], metal: [0x26282b, 0x3a3d41] },
  shotgun: { wood: [0x6a4428, 0x5a3a22], metal: [0x2a2c2e, 0x45484c] },
  pistol: { wood: [0x5a3a22], metal: [0x2a2c30, 0x4a4e54] },
  bow: { wood: [0x6a3e22, 0x4a2a16], metal: [] },
};
const POWER_ITEM = { rifle: 'rifle', shot: 'shotgun', pistol: 'pistol', arrow: 'bow' };

// ---------- gloved hands that actually wrap around what they hold ----------
// c: centre of the bar being held, axis: its direction, palm: which side the palm sits on,
// r: bar radius, wrap: which way the fingers curl round. Returns { parts, wrist }.
const _hA = new THREE.Vector3(), _hP = new THREE.Vector3(), _hB = new THREE.Vector3();
function handAround({ c, axis, palm, r, wrap = 1, spread = 0.0185, trigger = null, thumbSide = 1, curl = 1 }) {
  const C = c.clone();
  const A = _hA.copy(axis).normalize().clone();
  const P = _hP.copy(palm).addScaledVector(A, -palm.dot(A)).normalize().clone();
  const Bv = _hB.crossVectors(A, P).multiplyScalar(wrap).normalize().clone();
  const parts = [];
  const around = (o, th, extra = 0) => C.clone().addScaledVector(A, o).addScaledVector(P, Math.cos(th) * (r + 0.011 + extra)).addScaledVector(Bv, Math.sin(th) * (r + 0.011 + extra));
  const palmC = C.clone().addScaledVector(P, r + 0.014).addScaledVector(Bv, -0.012);
  // palm and back of the hand, shaped to sit flat against the grip
  const pg = new THREE.SphereGeometry(1, 14, 10);
  pg.applyMatrix4(new THREE.Matrix4().makeBasis(A, Bv, P).multiply(new THREE.Matrix4().makeScale(0.043, 0.036, 0.017)));
  pg.translate(palmC.x, palmC.y, palmC.z);
  parts.push(colorize(pg, glove));
  // four fingers curling round the bar; the index may reach for a trigger instead
  const lens = [0.92, 1, 0.94, 0.76];
  for (let k = 0; k < 4; k++) {
    const o = (k - 1.5) * spread * (k === 3 ? 1.08 : 1);
    let pts;
    if (k === 0 && trigger) {
      const base = around(o, 0.35);
      pts = [base, base.clone().lerp(trigger, 0.5).addScaledVector(P, 0.006), trigger.clone()];
    } else {
      const end = (3.3 + 0.55 * lens[k]) * curl;
      pts = [];
      for (let i = 0; i <= 5; i++) pts.push(around(o, 0.35 + (end - 0.35) * (i / 5), i === 0 ? 0.002 : 0));
    }
    parts.push(loft(curveRings(pts, (t) => 0.0098 - 0.002 * t, 9), { seg: 8, color: () => glove }));
    parts.push(colorize(xf(new THREE.SphereGeometry(0.0096, 8, 6), pts[1].x, pts[1].y, pts[1].z), glove)); // knuckle
  }
  // thumb wraps the other way, just past the index finger
  const to = -2.0 * spread * thumbSide;
  const tp = [];
  for (let i = 0; i <= 4; i++) tp.push(around(to, -0.2 - 1.25 * (i / 4), 0.002).addScaledVector(A, 0.004 * i * thumbSide));
  parts.push(loft(curveRings(tp, (t) => 0.0115 - 0.0025 * t, 8), { seg: 8, color: () => glove }));
  // wrist, behind the palm
  const wrist = palmC.clone().addScaledVector(Bv, -0.05).addScaledVector(P, 0.012);
  parts.push(loft(curveRings([palmC.clone().addScaledVector(Bv, -0.02), wrist], [0.03, 0.026], 4), { seg: 10, color: () => glove }));
  return { parts, wrist };
}
// sleeve from the wrist to off-screen, slightly tapered
function sleeveTo(wrist, elbow, r0 = 0.036, r1 = 0.05) { return cylinderBetween(wrist, elbow, r0, r1, 12, sleeve); }
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- weapon models (first person: barrel along -z; `hands = false` gives the bare weapon) ----------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// a shape lofted along -z from rings [z, yCentre, rx, ry]; s > 0 is the top side
function alongZ(rings, color, seg = 14, p = 2.4, caps = true) {
  return loft(rings.map(([z, y, rx, ry]) => ({ c: V3(0, y, z), rx, ry, p })), {
    seg, ySign: -1, capStart: caps, capEnd: caps, color: typeof color === 'function' ? color : () => color,
  });
}
// a straight tube along a list of points with a radius profile
function tube(points, r0, r1, color, seg = 10) {
  return loft(curveRings(points.map((q) => V3(...q)), (t) => r0 + (r1 - r0) * t, Math.max(4, points.length * 3)), { seg, color: () => color });
}
const cylZ = (r0, r1, z0, z1, y, color, seg = 14, x = 0) => part(new THREE.CylinderGeometry(r0, r1, Math.abs(z1 - z0), seg), color, x, y, (z0 + z1) / 2, Math.PI / 2);
// fine checkering on grips and fore-ends
const checker = (p, a, b) => (Math.sin(p.z * 520) * Math.sin(p.y * 520 + p.x * 520) > 0 ? a : b);

function buildRifle() {
  const wood = 0x5b3a22, woodD = 0x4a2e1a, metal = 0x26282b, metalL = 0x3a3d41;
  const p = [];
  // one-piece walnut stock: butt, comb, wrist and fore-end
  p.push(alongZ([
    [0.458, -0.055, 0.017, 0.056], [0.452, -0.055, 0.021, 0.064], [0.36, -0.045, 0.021, 0.057], [0.27, -0.028, 0.019, 0.043],
    [0.19, -0.012, 0.016, 0.027], [0.12, -0.003, 0.019, 0.027], [0.05, -0.005, 0.022, 0.03], [-0.08, -0.007, 0.022, 0.028],
    [-0.2, -0.009, 0.021, 0.024], [-0.36, -0.007, 0.019, 0.02], [-0.41, -0.005, 0.015, 0.016], [-0.425, -0.004, 0.008, 0.009],
  ], (q, u, s) => {
    if (q.z > 0.444) return 0x1a1a1a;                       // recoil pad
    if (q.z > 0.437) return 0xd8d0c0;                       // spacer
    if ((q.z < -0.15 && q.z > -0.31 && Math.abs(s) < 0.75)) return checker(q, woodD, wood);
    return wood;
  }, 16));
  // pistol grip with checkering and a cap
  p.push(loft(curveRings([V3(0, -0.012, 0.185), V3(0, -0.06, 0.2), V3(0, -0.1, 0.222)], (t) => [0.016 + 0.002 * t, 0.022 + 0.003 * t], 6), {
    seg: 12, color: (q, u) => (u > 0.92 ? 0x1a1a1a : u > 0.2 && u < 0.85 ? checker(q, woodD, wood) : wood),
  }));
  // receiver, bolt and trigger
  p.push(cylZ(0.017, 0.017, -0.12, 0.12, 0.026, metal));
  p.push(cylZ(0.014, 0.012, 0.12, 0.155, 0.027, metalL));     // bolt shroud
  p.push(tube([[0.016, 0.03, 0.06], [0.034, 0.016, 0.068], [0.048, -0.002, 0.074]], 0.0055, 0.0045, metal, 8)); // bolt handle
  p.push(part(new THREE.SphereGeometry(0.011, 10, 8), metalL, 0.052, -0.006, 0.076));
  p.push(part(new THREE.TorusGeometry(0.022, 0.004, 6, 14, Math.PI), metal, 0, -0.03, 0.06, 0, Math.PI / 2, Math.PI));
  p.push(part(new THREE.BoxGeometry(0.004, 0.024, 0.006), metalL, 0, -0.034, 0.058, 0.35));
  p.push(part(new THREE.BoxGeometry(0.028, 0.006, 0.08), metal, 0, -0.034, -0.01));   // floorplate
  // tapered barrel and muzzle crown
  p.push(cylZ(0.0125, 0.0095, -0.12, -0.725, 0.028, metal));
  p.push(cylZ(0.0108, 0.0108, -0.725, -0.738, 0.028, metalL));
  // scope: rings and bases, main tube, objective and ocular bells, turrets, lenses
  for (const z of [-0.06, 0.07]) {
    p.push(part(new THREE.BoxGeometry(0.026, 0.035, 0.018), metal, 0, 0.055, z));
    p.push(part(new THREE.TorusGeometry(0.018, 0.0045, 8, 16), metal, 0, 0.083, z));
  }
  p.push(cylZ(0.0155, 0.0155, -0.13, 0.13, 0.083, metal, 16));
  p.push(cylZ(0.0155, 0.025, -0.13, -0.19, 0.083, metal, 18));
  p.push(cylZ(0.025, 0.025, -0.19, -0.248, 0.083, metal, 18));
  p.push(cylZ(0.0265, 0.0265, -0.236, -0.244, 0.083, metalL, 18));
  p.push(cylZ(0.0155, 0.019, 0.13, 0.16, 0.083, metal, 16));
  p.push(cylZ(0.021, 0.021, 0.16, 0.215, 0.083, metalL, 16));
  p.push(cylZ(0.022, 0.022, 0.215, 0.232, 0.083, 0x1a1a1a, 16));
  p.push(part(new THREE.CylinderGeometry(0.0115, 0.0115, 0.024, 14), metalL, 0, 0.108, 0.0));
  p.push(part(new THREE.CylinderGeometry(0.0125, 0.0125, 0.008, 14), 0x1e1f21, 0, 0.121, 0.0));
  p.push(part(new THREE.CylinderGeometry(0.0115, 0.0115, 0.024, 14), metalL, 0.027, 0.083, 0.0, 0, 0, Math.PI / 2));
  p.push(part(new THREE.CircleGeometry(0.022, 18), 0x3a5a7a, 0, 0.083, -0.2485, 0, Math.PI));
  p.push(part(new THREE.CircleGeometry(0.006, 10), 0xa8cce8, 0.008, 0.091, -0.249, 0, Math.PI));
  // sling swivels
  p.push(part(new THREE.TorusGeometry(0.008, 0.0018, 4, 10), metalL, 0, -0.038, -0.33, 0, Math.PI / 2, 0));
  p.push(part(new THREE.TorusGeometry(0.008, 0.0018, 4, 10), metalL, 0, -0.118, 0.37, 0, Math.PI / 2, 0));
  return mergeColored(p);
}

function buildTwoHands(frontZ = -0.22) {
  const R = handAround({ c: v3(0, -0.06, 0.205), axis: v3(0, -0.088, 0.037), palm: v3(1, 0, 0.2), r: 0.019, wrap: -1, trigger: v3(0.002, -0.034, 0.064) });
  const L = handAround({ c: v3(0, -0.012, frontZ), axis: v3(0, 0, -1), palm: v3(-0.35, -1, 0), r: 0.022, wrap: -1, curl: 0.92 });
  return mergeColored([...R.parts, sleeveTo(R.wrist, v3(0.1, -0.2, 0.46)), ...L.parts, sleeveTo(L.wrist, v3(-0.14, -0.22, frontZ + 0.32))]);
}

function buildShotgun() {
  const wood = 0x6a4428, metal = 0x2a2c2e, metalL = 0x45484c;
  const p = [];
  p.push(alongZ([
    [0.462, -0.072, 0.018, 0.058], [0.455, -0.072, 0.022, 0.066], [0.34, -0.052, 0.021, 0.055], [0.22, -0.026, 0.017, 0.031],
    [0.15, -0.012, 0.017, 0.027], [0.11, -0.004, 0.019, 0.03], [0.1, -0.003, 0.015, 0.022],
  ], (q) => (q.z > 0.448 ? 0x1a1a1a : wood), 16));
  p.push(loft(curveRings([V3(0, -0.016, 0.165), V3(0, -0.058, 0.18), V3(0, -0.095, 0.2)], (t) => [0.016, 0.022 + 0.003 * t], 6), {
    seg: 12, color: (q, u) => (u > 0.9 ? 0x1a1a1a : u > 0.2 && u < 0.85 ? checker(q, 0x553620, wood) : wood),
  }));
  // receiver with ejection port, engraving line, trigger
  p.push(alongZ([[0.13, 0.0, 0.019, 0.034], [0.12, 0.0, 0.021, 0.037], [-0.03, 0.0, 0.021, 0.037], [-0.045, 0.004, 0.018, 0.03]], metal, 14, 4));
  p.push(part(new THREE.BoxGeometry(0.002, 0.022, 0.065), 0x101012, 0.0215, 0.012, 0.035));
  p.push(part(new THREE.BoxGeometry(0.002, 0.003, 0.15), metalL, 0.0215, -0.018, 0.045));
  p.push(part(new THREE.TorusGeometry(0.022, 0.004, 6, 14, Math.PI), metal, 0, -0.04, 0.08, 0, Math.PI / 2, Math.PI));
  p.push(part(new THREE.BoxGeometry(0.004, 0.024, 0.006), metalL, 0, -0.044, 0.078, 0.35));
  // barrel with ventilated rib, magazine tube and cap, bead sight
  p.push(cylZ(0.013, 0.013, -0.045, -0.71, 0.022, metal));
  p.push(part(new THREE.BoxGeometry(0.008, 0.003, 0.64), metalL, 0, 0.0385, -0.38));
  for (let z = -0.08; z > -0.7; z -= 0.055) p.push(part(new THREE.BoxGeometry(0.005, 0.006, 0.004), metal, 0, 0.0345, z));
  p.push(part(new THREE.SphereGeometry(0.0055, 8, 6), 0xd8c070, 0, 0.044, -0.702));
  p.push(cylZ(0.011, 0.011, -0.045, -0.62, -0.008, metalL, 12));
  p.push(cylZ(0.0125, 0.0115, -0.62, -0.645, -0.008, metal, 12));
  return mergeColored(p);
}

// grooved slide-action fore-end
function buildPump() {
  const rings = [];
  for (let i = 0; i <= 10; i++) {
    const z = 0.08 - i * 0.016, groove = i > 0 && i < 10 && i % 2 === 0;
    rings.push([z, 0, groove ? 0.0185 : 0.021, groove ? 0.0185 : 0.021]);
  }
  return alongZ(rings, 0x5a3a22, 14, 2);
}

function buildPistol(hands = true) {
  const metal = 0x2a2c30, metalL = 0x4a4e54, grip = 0x5a3a22;
  const p = [];
  // barrel, top rib, underlug and ejector rod
  p.push(cylZ(0.0095, 0.0095, -0.025, -0.172, 0.02, metal, 12));
  p.push(part(new THREE.BoxGeometry(0.016, 0.008, 0.15), metal, 0, 0.031, -0.1));
  p.push(part(new THREE.BoxGeometry(0.013, 0.013, 0.13), metal, 0, 0.005, -0.105));
  p.push(cylZ(0.0035, 0.0035, -0.17, -0.176, 0.005, metalL, 8));
  // fluted cylinder with chamber mouths
  p.push(cylZ(0.021, 0.021, 0.012, -0.032, 0.012, metalL, 18));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    p.push(part(new THREE.BoxGeometry(0.005, 0.005, 0.03), 0x1a1a1c, Math.cos(a) * 0.019, 0.012 + Math.sin(a) * 0.019, -0.01, 0, 0, a));
    p.push(part(new THREE.CircleGeometry(0.0042, 8), 0x0c0c0e, Math.cos(a + Math.PI / 6) * 0.012, 0.012 + Math.sin(a + Math.PI / 6) * 0.012, -0.0325, 0, Math.PI));
  }
  // frame, top strap, hammer, trigger and guard
  p.push(alongZ([[0.07, 0.012, 0.012, 0.022], [0.012, 0.012, 0.013, 0.024], [0.008, 0.014, 0.012, 0.02]], metal, 12, 4));
  p.push(part(new THREE.BoxGeometry(0.017, 0.008, 0.07), metal, 0, 0.035, -0.002));
  p.push(part(new THREE.BoxGeometry(0.008, 0.02, 0.012), metal, 0, 0.036, 0.058, -0.45));
  p.push(part(new THREE.BoxGeometry(0.009, 0.005, 0.014), metalL, 0, 0.047, 0.07, -0.2));
  p.push(part(new THREE.TorusGeometry(0.014, 0.003, 6, 12, Math.PI), metal, 0, -0.012, 0.025, 0, Math.PI / 2, Math.PI));
  p.push(part(new THREE.BoxGeometry(0.0035, 0.018, 0.005), metalL, 0, -0.013, 0.025, 0.3));
  // wooden grip with checkering and a steel backstrap
  p.push(loft(curveRings([V3(0, 0.005, 0.058), V3(0, -0.035, 0.068), V3(0, -0.078, 0.086)], (t) => [0.0135 + 0.0015 * t, 0.019 + 0.004 * t], 6), {
    seg: 12, color: (q, u) => (u > 0.15 && u < 0.88 ? checker(q, 0x3e2816, grip) : grip),
  }));
  p.push(tube([[0, 0.012, 0.075], [0, -0.035, 0.088], [0, -0.078, 0.106]], 0.005, 0.005, metal, 6));
  // sights
  p.push(part(new THREE.BoxGeometry(0.004, 0.01, 0.006), metal, 0, 0.042, -0.17));
  for (const sx of [-0.0065, 0.0065]) p.push(part(new THREE.BoxGeometry(0.005, 0.012, 0.006), metal, sx, 0.043, 0.035));
  if (hands) {
    // hand wrapped around the grip, index finger on the trigger, forearm dropping away below the sights
    const H = handAround({ c: v3(0, -0.036, 0.072), axis: v3(0, -0.083, 0.028), palm: v3(0.35, 0, 0.94), r: 0.016, wrap: -1, trigger: v3(0.003, -0.014, 0.026) });
    p.push(...H.parts, sleeveTo(H.wrist, v3(0.0, -0.24, 0.2), 0.032, 0.042));
  }
  return mergeColored(p);
}

// Recurve bow: grip at origin, limbs curve along ±y, string at z = +limb offset
function buildBow(hands = true) {
  const wood = 0x6a3e22, woodD = 0x4a2a16;
  const p = [];
  // riser with leather grip wrap and arrow shelf
  p.push(loft([-0.075, -0.05, -0.02, 0.02, 0.05, 0.075].map((y) => ({ c: V3(0, y, Math.abs(y) < 0.04 ? 0.004 : 0), rx: 0.015, ry: Math.abs(y) < 0.04 ? 0.02 : 0.017 })), {
    seg: 12, side: V3(1, 0, 0), color: (q) => (Math.abs(q.y) < 0.04 ? 0x2a1a10 : woodD),
  }));
  p.push(part(new THREE.BoxGeometry(0.014, 0.006, 0.026), woodD, -0.01, 0.045, 0.002));
  // laminated limbs: dark face, light back, curling forward at the tips
  const pts = [[0, 0.06, 0], [0, 0.2, 0.035], [0, 0.34, 0.05], [0, 0.44, 0.02], [0, 0.5, -0.03]];
  for (const sy of [1, -1]) {
    p.push(loft(curveRings(pts.map(([x, y, z]) => V3(x, y * sy, z)), (t) => [0.021 - 0.012 * t, 0.0075 - 0.003 * t], 14), {
      seg: 10, side: V3(1, 0, 0), color: (q, u, s) => (s * sy > 0.25 ? woodD : wood),
    }));
    p.push(part(new THREE.SphereGeometry(0.006, 8, 6), 0x2a1a10, 0, 0.5 * sy, -0.03)); // string nock
  }
  if (hands) {
    // bow hand closed round the leather grip
    const H = handAround({ c: v3(0, 0, 0.004), axis: v3(0, 1, 0), palm: v3(1, 0, 0.15), r: 0.019, wrap: 1 });
    p.push(...H.parts, sleeveTo(H.wrist, v3(-0.32, -0.55, 0.42)));
  }
  return mergeColored(p);
}

function buildArrow() {
  const p = [];
  p.push(part(new THREE.CylinderGeometry(0.004, 0.004, 0.7, 6), 0x8a6a40, 0, 0, 0, Math.PI / 2));
  // broadhead: ferrule and two crossed blades
  p.push(part(new THREE.CylinderGeometry(0.0045, 0.004, 0.02, 6), 0x7a7a7a, 0, 0, -0.355, Math.PI / 2));
  for (const r of [0, Math.PI / 2]) p.push(colorize(xf(new THREE.ConeGeometry(0.012, 0.045, 3), 0, 0, -0.385, -Math.PI / 2, 0, r, 1, 1, 0.15), 0xb0b4b8));
  // shaped fletching and nock
  for (let i = 0; i < 3; i++) p.push(colorize(xf(new THREE.SphereGeometry(1, 8, 4), 0, 0, 0.3, 0, 0, (i * Math.PI * 2) / 3, 0.0015, 0.014, 0.04).translate(0, 0, 0), i ? 0xe8e0d0 : 0xc03020));
  p.push(part(new THREE.CylinderGeometry(0.0048, 0.0048, 0.012, 6), 0xd86a20, 0, 0, 0.356, Math.PI / 2));
  return mergeColored(p);
}

function buildBinoculars(hands = true) {
  const body = 0x2a2d2a, rubber = 0x3c4436, glass = 0x2a4a66;
  const p = [];
  for (const s of [-1, 1]) {
    p.push(loft([[0.065, 0.02], [0.05, 0.024], [-0.04, 0.025], [-0.07, 0.027], [-0.09, 0.028]].map(([z, r]) => ({ c: V3(s * 0.034, 0, z), rx: r, ry: r })), {
      seg: 16, ySign: -1, color: (q) => (q.z < -0.065 ? body : Math.sin(q.z * 260) > 0.6 ? 0x323a2e : rubber),
    }));
    p.push(part(new THREE.TorusGeometry(0.019, 0.006, 8, 16), 0x1a1a1a, s * 0.034, 0, 0.068));      // eyecup
    p.push(part(new THREE.CircleGeometry(0.024, 16), glass, s * 0.034, 0, -0.091, 0, Math.PI));
    p.push(part(new THREE.CircleGeometry(0.006, 8), 0x9ac0e0, s * 0.034 + 0.008, 0.008, -0.0915, 0, Math.PI));
    if (hands) {
      const H = handAround({ c: v3(s * 0.034, 0, 0.005), axis: v3(0, 0, 1), palm: v3(s, -0.45, 0), r: 0.026, wrap: s, curl: 0.55 });
      p.push(...H.parts, sleeveTo(H.wrist, v3(s * 0.13, -0.21, 0.24)));
    }
  }
  // hinge bridge and ridged focus wheel
  p.push(cylZ(0.009, 0.009, 0.05, -0.05, 0.004, body, 10));
  for (let i = 0; i < 10; i++) p.push(part(new THREE.CylinderGeometry(0.011, 0.011, 0.004, 12), i % 2 ? body : 0x3a3d3a, -0.012 + i * 0.0026, 0.016, 0.03, 0, 0, Math.PI / 2));
  return mergeColored(p);
}

function buildKnife(hands = true) {
  const p = [];
  // drop-point blade, extruded from its outline with bevelled edges
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.013); sh.lineTo(0.125, 0.013); sh.quadraticCurveTo(0.165, 0.011, 0.19, -0.004);
  sh.quadraticCurveTo(0.15, -0.016, 0.06, -0.017); sh.lineTo(0, -0.013); sh.lineTo(0, 0.013);
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0014, bevelSegments: 1, curveSegments: 8 });
  blade.translate(0, 0, -0.001);
  blade.rotateY(Math.PI / 2);
  blade.translate(0, 0.006, -0.042);
  p.push(colorize(blade.toNonIndexed(), 0xc8ccd0));
  p.push(part(new THREE.BoxGeometry(0.0012, 0.004, 0.1), 0x8a8e92, 0.0024, 0.01, -0.1)); // fuller
  // guard, grooved handle and pommel
  p.push(part(new THREE.BoxGeometry(0.05, 0.012, 0.012), 0x8a8a8a, 0, 0.004, -0.04));
  p.push(alongZ([[0.085, 0, 0.012, 0.016], [0.07, 0, 0.0125, 0.017], [0.05, 0, 0.011, 0.014], [0.03, 0, 0.0125, 0.016], [0.01, 0, 0.011, 0.014], [-0.01, 0, 0.0125, 0.016], [-0.034, 0, 0.011, 0.014]], 0x3a2a1c, 12));
  p.push(part(new THREE.SphereGeometry(1, 10, 8).scale(0.013, 0.017, 0.012), 0x8a8a8a, 0, 0, 0.09));
  if (hands) {
    const H = handAround({ c: v3(0, 0, 0.03), axis: v3(0, 0, 1), palm: v3(1, -0.4, 0), r: 0.015, wrap: -1 });
    p.push(...H.parts, sleeveTo(H.wrist, v3(0.07, -0.13, 0.32)));
  }
  return mergeColored(p);
}

function buildBaitBag(hands = true) {
  const p = [];
  p.push(ellipsoid(0, 0, 0, 0.07, 0.09, 0.05, 0xc8a860, 12, 9));
  p.push(part(new THREE.CylinderGeometry(0.03, 0.05, 0.03, 12), 0xa88848, 0, 0.09, 0));
  p.push(part(new THREE.TorusGeometry(0.032, 0.004, 6, 12), 0x6a5030, 0, 0.098, 0, Math.PI / 2, 0, 0)); // drawstring
  for (let i = 0; i < 6; i++) p.push(ellipsoid(Math.cos(i) * 0.03, 0.105, Math.sin(i) * 0.02, 0.008, 0.008, 0.008, 0xf0c030, 5, 4));
  if (hands) {
    const H = handAround({ c: v3(0, -0.03, 0.0), axis: v3(1, 0, 0), palm: v3(0, -1, 0.3), r: 0.05, wrap: 1, curl: 0.6 });
    p.push(...H.parts, sleeveTo(H.wrist, v3(0.07, -0.2, 0.26)));
  }
  return mergeColored(p);
}

function buildCall(hands = true) {
  const p = [];
  p.push(cylZ(0.014, 0.018, 0.06, -0.06, 0, 0x3a2a1c, 12));
  p.push(cylZ(0.02, 0.02, -0.06, -0.08, 0, 0xc8a050, 12));
  p.push(cylZ(0.01, 0.01, 0.06, 0.17, -0.005, 0x2a2a2a, 8));
  p.push(part(new THREE.TorusGeometry(0.008, 0.002, 4, 10), 0xc8a050, 0, 0.016, 0.02, 0, Math.PI / 2, 0)); // lanyard ring
  if (hands) {
    const H = handAround({ c: v3(0, 0, 0.0), axis: v3(0, 0, 1), palm: v3(0.6, -0.8, 0), r: 0.017, wrap: -1 });
    p.push(...H.parts, sleeveTo(H.wrist, v3(0.06, -0.13, 0.28)));
  }
  return mergeColored(p);
}

// The same weapons as other players see them: turned to face +z with the grip (or butt) at the origin
export const VM_COLORS_EXPORT = VM_COLORS;
export function thirdPersonGeometry(id) {
  let g;
  if (id === 'rifle') g = buildRifle();
  else if (id === 'shotgun') g = mergeColored([buildShotgun(), buildPump().translate(0, -0.008, -0.3)]);
  else if (id === 'pistol') g = buildPistol(false);
  else if (id === 'bow') g = buildBow(false);
  else if (id === 'knife') g = buildKnife(false);
  else if (id === 'binoculars') g = buildBinoculars(false);
  else if (id === 'bait') g = buildBaitBag(false);
  else g = buildCall(false);
  g.rotateY(Math.PI);
  const off = { rifle: [0, 0, 0.458], shotgun: [0, 0, 0.462], pistol: [0, 0.035, 0.065], knife: [0, 0, 0.02] }[id];
  if (off) g.translate(...off);
  return g;
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
    // soft fill from the viewer's side so the near faces of the weapon are not lost in shadow
    this.vmFill = new THREE.DirectionalLight(0xfff4e8, 0.8);
    this.vmFill.position.set(-0.6, 0.35, 1);
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmFill);
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 55, specular: 0x4a4a4a });
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
    // fist with the fingers hooked round the string, wrist back towards you
    this.drawHand = new THREE.Mesh(mergeColored(handAround({ c: v3(0, 0, 0), axis: v3(0, 1, 0), palm: v3(-1, 0, 0), r: 0.004, wrap: -1, curl: 0.85 }).parts), mat);
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
    if (input.right && W.perShell && this.reloadT > 0 && this.ammo[this.item].mag > 0) this.reloadT = 0;
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
    this.vmHemi.intensity = 0.12 + li * 1.8;
    this.vmSun.intensity = li * 2.4;
    this.vmFill.intensity = 0.06 + li * 1.0;
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
    this.weaponFeel(m, dt, a, t);
  }

  // What the weapon does on top of its pose: it lags behind quick turns and springs back,
  // tilts into strafes, dips when you land, breathes, and recoil kicks up and to one side.
  weaponFeel(m, dt, a, t) {
    const P = G.player;
    if (!this.feel) this.feel = { yaw: P.yaw, pitch: P.pitch, x: 0, y: 0, vx: 0, vy: 0, tilt: 0 };
    const f = this.feel, idt = 1 / Math.max(dt, 1 / 240);
    let dYaw = P.yaw - f.yaw; dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const dPitch = P.pitch - f.pitch;
    f.yaw = P.yaw; f.pitch = P.pitch;
    const k = 1 - a * 0.8;
    const tx = clamp(-dYaw * idt * 0.0045, -0.045, 0.045), ty = clamp(dPitch * idt * 0.0045, -0.035, 0.035);
    f.vx += ((tx - f.x) * 140 - f.vx * 15) * dt; f.x += f.vx * dt;
    f.vy += ((ty - f.y) * 140 - f.vy * 15) * dt; f.y += f.vy * dt;
    const side = P.vel.x * Math.cos(P.yaw) - P.vel.z * Math.sin(P.yaw);
    f.tilt = damp(f.tilt, clamp(-side * 0.03, -0.12, 0.12), 6, dt);
    const breathe = Math.sin(t * 1.25) * (1 - a);
    m.position.x += (f.x + Math.sin(t * 0.62) * 0.0018 * (1 - a)) * k;
    m.position.y += f.y * k + (P.dip || 0) * 0.35 + breathe * 0.0025;
    m.rotation.x += f.y * 1.6 * k + breathe * 0.006 + (P.dip || 0) * 0.4;
    m.rotation.y += f.x * 2.4 * k;
    m.rotation.z += (f.tilt + f.x * 1.4) * k;
    // recoil throws the muzzle up and to a random side
    if (this.kick > 0.001) { m.rotation.y += this.kick * (this.kickSide || 0) * 0.12; m.rotation.z += this.kick * (this.kickSide || 0) * 0.18; }
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
    this.kickSide = Math.random() * 2 - 1;
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
    if (!a.isBird) G.net?.down(a, e.part); else G.net?.birdDown(a);
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
    else { G.net?.spook(a); G.ui.toast(`You wounded the ${a.sp.name.toLowerCase()}! It's slowed down — catch it and strike again to finish it.`, 'info'); }
  }

  render(renderer) {
    if (!Object.values(this.models).some((m) => m.visible)) return;
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCamera);
  }
}
