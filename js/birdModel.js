// Procedural low-poly birds: one body mesh (with head, legs and tail) and two wing meshes
// pivoting at the shoulders so they can fold against the body or flap in flight.
import * as THREE from 'three';
import { SPECIES } from './species.js';
import { colorize, mergeColored, ellipsoid, cylinderBetween, xf, shadeVertical } from './geo.js';
import { animalMaterial } from './animalModel.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const cache = new Map();

export function birdDims(m) {
  const R = m.bodyR, L = m.bodyLen;
  const cy = m.legLen + R * 0.85;
  const neckBase = V(0, cy + R * 0.45, L * 0.36);
  const up = m.sNeck ? 0.85 : 1.0;
  const neckEnd = neckBase.clone().add(V(0, Math.sin(up) * m.neckLen, Math.cos(up) * m.neckLen * 0.6));
  const head = neckEnd.clone().add(V(0, m.headR * 0.4, m.headR * 0.5));
  return { cy, R, L, neckBase, neckEnd, head, shoulder: V(R * 0.8, cy + R * 0.35, L * 0.12), half: m.wingSpan / 2 - R * 0.8 };
}

function colorsFor(m, male) {
  return male || !m.colorsF ? m.colors : Object.assign({}, m.colors, m.colorsF);
}

function buildBody(m, d, c) {
  const p = [];
  const { cy, R, L } = d;
  p.push(ellipsoid(0, cy, 0, R * 0.95, R, L / 2, c.body, 12, 9));
  p.push(ellipsoid(0, cy + R * 0.38, -L * 0.05, R * 0.78, R * 0.6, L * 0.44, c.back, 10, 7));
  p.push(ellipsoid(0, cy - R * 0.35, L * 0.04, R * 0.75, R * 0.6, L * 0.38, c.belly, 10, 7));
  if (c.breast) p.push(ellipsoid(0, cy + R * 0.05, L * 0.3, R * 0.8, R * 0.85, L * 0.22, c.breast, 10, 7));
  // neck
  if (m.sNeck) {
    const mid = d.neckBase.clone().lerp(d.neckEnd, 0.5).add(V(0, 0, -m.neckLen * 0.18));
    p.push(cylinderBetween(d.neckBase, mid, R * 0.32, R * 0.24, 6, c.neck));
    p.push(cylinderBetween(mid, d.neckEnd, R * 0.24, R * 0.22, 6, c.neck));
  } else {
    p.push(cylinderBetween(d.neckBase.clone().add(V(0, -R * 0.2, -R * 0.1)), d.neckEnd, R * 0.5, m.headR * 0.8, 7, c.neck));
  }
  if (c.collar) {
    const cc = d.neckBase.clone().lerp(d.neckEnd, 0.35);
    p.push(ellipsoid(cc.x, cc.y, cc.z, R * 0.42, R * 0.07, R * 0.42, c.collar, 8, 4));
  }
  // head
  const h = d.head;
  p.push(ellipsoid(h.x, h.y, h.z, m.headR, m.headR * (m.faceDisc ? 1.05 : 0.95), m.headR * 1.1, c.head, 10, 8));
  if (m.faceDisc) p.push(ellipsoid(h.x, h.y - m.headR * 0.05, h.z + m.headR * 0.55, m.headR * 0.85, m.headR * 0.75, m.headR * 0.35, c.face, 10, 7));
  if (m.chinstrap) for (const s of [-1, 1]) p.push(ellipsoid(h.x + s * m.headR * 0.62, h.y - m.headR * 0.25, h.z, m.headR * 0.4, m.headR * 0.55, m.headR * 0.7, c.cheek, 6, 5));
  if (m.earTufts) for (const s of [-1, 1]) p.push(cylinderBetween(h.clone().add(V(s * m.headR * 0.55, m.headR * 0.65, 0)), h.clone().add(V(s * m.headR * 0.8, m.headR * 1.4, -m.headR * 0.1)), m.headR * 0.22, m.headR * 0.04, 4, c.back));
  // eyes
  for (const s of [-1, 1]) {
    const big = m.faceDisc ? 2.2 : 1;
    const e = h.clone().add(V(s * m.headR * (m.faceDisc ? 0.38 : 0.78), m.headR * 0.22, m.headR * (m.faceDisc ? 0.85 : 0.45)));
    if (m.faceDisc) p.push(ellipsoid(e.x, e.y, e.z, m.headR * 0.2, m.headR * 0.2, m.headR * 0.1, 0xf0b020, 6, 5));
    p.push(ellipsoid(e.x, e.y, e.z + (m.faceDisc ? m.headR * 0.06 : 0), m.headR * 0.13 * big * 0.6, m.headR * 0.13 * big * 0.6, m.headR * 0.1, 0x0a0908, 6, 5));
  }
  // beak / bill
  const b0 = h.clone().add(V(0, -m.headR * 0.1, m.headR * 0.85));
  if (m.bill) {
    p.push(ellipsoid(b0.x, b0.y - m.headR * 0.12, b0.z + m.beakLen * 0.45, m.headR * 0.42, m.headR * 0.18, m.beakLen * 0.55, c.beak, 8, 5));
  } else {
    const tip = b0.clone().add(V(0, m.hooked ? -m.beakLen * 0.35 : -m.beakLen * 0.12, m.beakLen));
    p.push(cylinderBetween(b0, tip, m.headR * (m.hooked ? 0.42 : 0.3), m.headR * 0.04, 6, c.beak));
  }
  if (m.wattle) {
    p.push(ellipsoid(b0.x, b0.y - m.headR * 0.9, b0.z - m.headR * 0.5, m.headR * 0.32, m.headR * 0.9, m.headR * 0.35, 0xc03030, 6, 5));
    p.push(cylinderBetween(b0.clone().add(V(0, m.headR * 0.25, 0)), b0.clone().add(V(0, -m.beakLen * 1.4, m.beakLen * 0.3)), m.headR * 0.1, m.headR * 0.06, 4, 0xc03030));
  }
  // tail
  const t0 = V(0, cy + R * 0.2, -L * 0.42);
  if (m.tailFan) {
    p.push(ellipsoid(t0.x, t0.y + m.tailLen * 0.1, t0.z - m.tailLen * 0.45, m.tailLen * 0.75, m.tailLen * 0.08, m.tailLen * 0.5, c.tail, 12, 4, -0.35));
    p.push(ellipsoid(t0.x, t0.y + m.tailLen * 0.05, t0.z - m.tailLen * 0.85, m.tailLen * 0.72, m.tailLen * 0.05, m.tailLen * 0.14, c.tailTip, 12, 4, -0.35));
  } else {
    p.push(ellipsoid(t0.x, t0.y, t0.z - m.tailLen * 0.45, R * 0.55, R * 0.12, m.tailLen * 0.55, c.tail, 8, 4, -0.15));
    p.push(ellipsoid(t0.x, t0.y - m.tailLen * 0.07, t0.z - m.tailLen * 0.92, R * 0.5, R * 0.08, m.tailLen * 0.12, c.tailTip, 8, 4, -0.15));
  }
  // legs and feet
  for (const s of [-1, 1]) {
    const hip = V(s * R * 0.35, cy - R * 0.55, L * 0.02);
    const foot = V(s * R * 0.35, 0.01, L * 0.06);
    const lr = Math.max(0.006, R * 0.08);
    p.push(cylinderBetween(hip, foot, lr * 1.2, lr, 4, c.legs));
    for (const a of [-0.5, 0, 0.5]) p.push(cylinderBetween(foot, foot.clone().add(V(Math.sin(a) * R * 0.5, 0, Math.cos(a) * R * 0.55)), lr * 0.8, lr * 0.5, 3, c.legs));
    p.push(cylinderBetween(foot, foot.clone().add(V(0, 0, -R * 0.3)), lr * 0.7, lr * 0.5, 3, c.legs));
  }
  return shadeVertical(mergeColored(p), 0.8, 1.1);
}

// Wing extends from the shoulder along +x (s = 1) or -x (s = -1)
function buildWing(m, d, c, s) {
  const p = [];
  const half = d.half, chord = Math.max(m.bodyLen * 0.42, half * 0.42);
  const t = Math.max(0.008, m.bodyR * 0.08);
  const inner = new THREE.BoxGeometry(half * 0.5, t, chord);
  xf(inner, s * half * 0.25, 0, -chord * 0.25);
  p.push(colorize(inner, c.wing));
  const outer = new THREE.BoxGeometry(half * 0.5, t * 0.8, chord * 0.8);
  xf(outer, s * half * 0.72, 0, -chord * 0.32, 0, s * 0.18, 0);
  p.push(colorize(outer, c.wing));
  const tip = new THREE.BoxGeometry(half * 0.28, t * 0.7, chord * 0.55);
  xf(tip, s * half * 0.95, 0, -chord * 0.42, 0, s * 0.35, 0);
  p.push(colorize(tip, c.wingTip));
  return mergeColored(p);
}

function getGeometry(id, male) {
  const key = id + (male ? ':m' : ':f');
  if (cache.has(key)) return cache.get(key);
  const m = SPECIES[id].model;
  const d = birdDims(m);
  const c = colorsFor(m, male);
  const g = { body: buildBody(m, d, c), wingL: buildWing(m, d, c, 1), wingR: buildWing(m, d, c, -1), dims: d };
  cache.set(key, g);
  return g;
}

export function createBirdRig(id, male, material = animalMaterial) {
  const g = getGeometry(id, male);
  const d = g.dims;
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const body = new THREE.Mesh(g.body, material);
  bodyPivot.add(body);
  const wings = [];
  for (const [geo, s] of [[g.wingL, 1], [g.wingR, -1]]) {
    const w = new THREE.Mesh(geo, material);
    w.position.set(s * d.shoulder.x, d.shoulder.y, d.shoulder.z);
    w.userData.side = s;
    bodyPivot.add(w);
    wings.push(w);
  }
  const meshes = [body, ...wings];
  meshes.forEach((me) => { me.castShadow = true; });
  // folded wings tuck to roughly the length of the body
  const fold = Math.min(1, (SPECIES[id].model.bodyLen * 0.62) / d.half);
  return { root, bodyPivot, body, wings, meshes, dims: d, model: SPECIES[id].model, bird: true, fold };
}

// open: 0 = folded against the body, 1 = spread; flap: wing beat angle
export function poseWings(rig, open, flap = 0) {
  for (const w of rig.wings) {
    const s = w.userData.side;
    w.rotation.set(0, s * (Math.PI / 2) * 0.92 * (1 - open), s * (-0.12 * (1 - open) + flap * open), 'YZX');
    w.scale.x = rig.fold + (1 - rig.fold) * open;
  }
}
