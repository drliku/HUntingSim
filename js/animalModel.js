// Procedural animal models built from smooth lofted shapes: a continuous body with chest,
// tucked waist and rounded rump; a shaped head with skull, brow and snout; tapered legs;
// leaf-shaped ears; curved antlers and horns; fur shading painted into vertex colours.
// Each animal is a handful of meshes sharing one material: body, head (with neck), four legs and a tail.
import * as THREE from 'three';
import { SPECIES } from './species.js';
import { colorize, mergeColored, ellipsoid, cylinderBetween, xf, loft as loftGeo, curveRings } from './geo.js';
import { mulberry32 } from './utils.js';

export const animalMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const cache = new Map();
// level of detail: 1 = full model, lower for distant animals
let detail = 1;
const segs = (n, min) => Math.max(min, Math.round(n * detail));
const ell = (x, y, z, sx, sy, sz, col, ws = 10, hs = 8, rx = 0, ry = 0, rz = 0) => ellipsoid(x, y, z, sx, sy, sz, col, segs(ws, 5), segs(hs, 4), rx, ry, rz);
const cyl = (a, b, r1, r2, seg = 6, col = 0xffffff) => cylinderBetween(a, b, r1, r2, segs(seg, 4), col);
const _col = new THREE.Color(), _c2 = new THREE.Color();

export function computeDims(m) {
  const cY = m.shoulderH - m.bodyH * 0.45;
  const legTopY = cY - m.bodyH * 0.12;
  const legLen = legTopY;
  const neckBase = V(0, cY + m.bodyH * 0.22, m.bodyLen * 0.42);
  const na = m.neckAngle;
  const neckEnd = V(0, Math.sin(na) * m.neckLen, Math.cos(na) * m.neckLen);
  const tilt = m.headTilt ?? (m.hopper ? 0.25 : (m.tusks ? 0.55 : 0.4));
  const headDir = V(0, -Math.sin(tilt), Math.cos(tilt));
  const headCenter = neckEnd.clone().add(V(0, m.headH * 0.15, 0)).addScaledVector(headDir, m.headLen * 0.3);
  return {
    cY, legTopY, legLen, neckBase, neckEnd, headDir, headCenter,
    legX: m.bodyW * 0.3, frontZ: m.bodyLen * 0.33, hindZ: -m.bodyLen * 0.33,
    tailBase: V(0, cY + m.bodyH * 0.25, -m.bodyLen * 0.5),
    front: [V(0, 0, 0), V(0, -0.38 * legLen, -0.03 * legLen), V(0, -0.68 * legLen, 0.02 * legLen), V(0, -0.93 * legLen, 0), V(0, -legLen, 0.01 * legLen)],
    hind: [V(0, 0, 0), V(0, -0.3 * legLen, 0.07 * legLen), V(0, -0.6 * legLen, -0.1 * legLen), V(0, -0.93 * legLen, -0.04 * legLen), V(0, -legLen, -0.02 * legLen)],
  };
}

// ---------- helpers ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (t, c, w) => Math.exp(-((t - c) * (t - c)) / (2 * w * w));
// soft fur mottling, the same for every animal at a given spot of the body
const furNoise = (p) => 1 + 0.045 * Math.sin(p.x * 31 + p.y * 7.3) * Math.sin(p.z * 23 + p.y * 11.1) + 0.03 * Math.sin(p.x * 71 + p.z * 53 + p.y * 37);
function mix(a, b, t) { _col.setHex(a); _c2.setHex(b); return _col.lerp(_c2, clamp01(t)).getHex(); }

const loft = (rings, o = {}) => loftGeo(rings, { ...o, seg: segs(o.seg ?? 14, 5), noise: furNoise });

const lighter = (a, b) => { _col.setHex(a); _c2.setHex(b); return (_c2.r + _c2.g + _c2.b) > (_col.r + _col.g + _col.b); };

// ---------- body ----------
function bodyProfile(m) {
  const lean = m.foot === 'hoof' && !m.hump ? 0.3 : m.plantigrade || m.tusks || m.hump ? 0.08 : 0.38; // belly tuck-up
  return (t) => {
    // t: 0 = rump, 1 = chest front
    const end = Math.pow(1 - Math.pow(Math.abs(2 * t - 1), 2.4), 1 / 2.4);
    let top = 1 + 0.06 * gauss(t, 0.78, 0.12) - 0.04 * gauss(t, 0.45, 0.12);
    let bot = 1 - lean * gauss(t, 0.3, 0.14) + 0.1 * gauss(t, 0.7, 0.13);
    let wid = 0.9 + 0.12 * gauss(t, 0.2, 0.12) - 0.1 * gauss(t, 0.46, 0.12) + 0.06 * gauss(t, 0.74, 0.1);
    if (m.hump) top += m.hump.h * 1.4 * gauss(t, 0.74, 0.13);
    if (m.bristles) top += 0.16 * smooth(0.25, 0.5, t) * (1 - smooth(0.85, 1, t));
    if (m.hopper) {
      top = 1.05 + 0.25 * gauss(t, 0.4, 0.2);
      bot = 0.95 - 0.15 * smooth(0.5, 1, t);
      wid = 1.05 - 0.35 * smooth(0.35, 1, t);
    }
    return { end, top, bot, wid };
  };
}

function buildBody(m, d) {
  const c = m.colors, L = m.bodyLen, H = m.bodyH, W = m.bodyW, cY = d.cY;
  const prof = bodyProfile(m);
  const rings = [];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const tt = 0.5 - 0.5 * Math.cos(t * Math.PI); // denser rings at both ends
    const { end, top, bot, wid } = prof(tt);
    const e = Math.max(end, 0.06);
    const yTop = cY + (H / 2) * top * (0.35 + 0.65 * e), yBot = cY - (H / 2) * bot * (0.35 + 0.65 * e);
    const yC = (yTop + yBot) / 2 + (m.hopper ? H * 0.05 : 0);
    rings.push({ c: V(0, yC, -L / 2 + tt * L), rx: (W / 2) * wid * e, ry: Math.max((yTop - yBot) / 2 * e, 0.01), p: 2.35 });
  }
  const neckCol = c.neck || c.coat;
  const bellyHigh = m.throatBands ? -0.05 : -0.3; // pronghorn: white flanks
  const color = (p, u, s) => {
    let col = c.coat;
    if (c.neck) col = mix(col, neckCol, smooth(0.66, 0.86, u));
    col = mix(col, c.belly, smooth(bellyHigh, bellyHigh - 0.38, s));
    col = mix(col, c.dorsal, smooth(0.55, 0.97, s) * (m.bristles ? 0.95 : 0.7));
    if (c.rump) col = mix(col, c.rump, smooth(0.18, 0.05, u) * smooth(-0.7, -0.2, s));
    if (m.hump) col = mix(col, m.hump.color, gauss(u, 0.74, 0.12) * smooth(0.0, 0.6, s));
    // underside a little darker, as if in shadow
    const shade = 0.86 + 0.18 * smooth(-1, 0.6, s);
    _col.setHex(col).multiplyScalar(shade);
    return _col.getHex();
  };
  const parts = [loft(rings, { seg: 20, color })];
  // rabbits: big haunches (other animals' thighs grow out of the body smoothly instead)
  if (m.hopper) for (const s of [-1, 1]) parts.push(ell(s * W * 0.36, cY - H * 0.05, -L * 0.2, W * 0.2, H * 0.38, L * 0.26, c.coat, 12, 9));
  if (m.ruff) parts.push(ell(0, cY + H * 0.06, L * 0.42, W * 0.47, H * 0.5, L * 0.12, mix(c.coat, c.belly, 0.12), 14, 10));
  if (m.mane) parts.push(ell(0, cY - H * 0.08, L * 0.42, W * 0.36, H * 0.48, L * 0.13, c.neck, 12, 9));
  return mergeColored(parts);
}

// ---------- neck (bends on a chain of bones) ----------
// Bones: 0 = anchor (stays with the chest), 1 = root (at the neck base), 2 = mid, 3 = top (the head rides on it).
// Each vertex is weighted by how far along the neck it lies, so the neck bends smoothly out of the shoulders.
function skinNeck(geo, E) {
  const pos = geo.attributes.position, n = pos.count;
  const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
  const len2 = E.lengthSq() || 1;
  for (let i = 0; i < n; i++) {
    const t = (pos.getX(i) * E.x + pos.getY(i) * E.y + pos.getZ(i) * E.z) / len2;
    let a = 0, b = 0, w = 0;
    if (t < -0.05) { a = 0; b = 0; w = 0; }
    else if (t < 0.3) { a = 0; b = 1; w = smooth(-0.05, 0.3, t); }
    else if (t < 0.65) { a = 1; b = 2; w = smooth(0.3, 0.65, t); }
    else if (t < 1) { a = 2; b = 3; w = smooth(0.65, 1, t); }
    else { a = 3; b = 3; w = 0; }
    idx[i * 4] = a; idx[i * 4 + 1] = b; wt[i * 4] = 1 - w; wt[i * 4 + 1] = w;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  return geo;
}

function buildNeck(m, d) {
  const c = m.colors, p = [];
  const ne = d.neckEnd, hc = d.headCenter, hd = d.headDir;
  const up = V(0, hd.z, -hd.y);
  const neckCol = c.neck || c.coat;
  const throat = lighter(neckCol, c.belly) ? mix(neckCol, c.belly, 0.45) : neckCol;
  // neck: from inside the chest, curving up into the back of the skull
  const n0 = V(0, -m.neckR * 1.6, -m.neckR * 2.4), n3 = hc.clone().addScaledVector(hd, -m.headLen * 0.12).addScaledVector(up, -m.headH * 0.08);
  const n1 = n0.clone().lerp(ne, 0.45), n2 = ne.clone().lerp(n3, 0.4);
  p.push(loft(curveRings([n0, n1, n2, n3], (t) => {
    // deep and broad where it leaves the chest, tapering quickly to the throat
    const r = m.neckR * (1.95 - 1.15 * Math.pow(t, 0.6));
    return [r * (0.78 - 0.08 * t), r * (1.18 - 0.1 * t)];
  }, 16), {
    seg: 16, ySign: 1, side: V(1, 0, 0), capStart: true, capEnd: true,
    color: (pt, u, s) => mix(neckCol, throat, smooth(-0.15, -0.8, s)), // -y of the neck frame is the throat side
  }));
  if (m.mane) p.push(ell(0, ne.y * 0.45 - m.neckR * 0.4, ne.z * 0.45 + m.neckR * 0.3, m.neckR * 1.05, m.neckLen * 0.42, m.neckR * 1.2, c.neck, 12, 8, -m.neckAngle + Math.PI / 2));
  if (m.ruff) p.push(ell(0, ne.y * 0.3, ne.z * 0.3 + 0.01, m.neckR * 1.2, m.neckR * 1.3, m.neckR * 1.15, mix(c.coat, c.belly, 0.12), 12, 9));

  if (m.bell) {
    const bc = ne.clone().multiplyScalar(0.75).add(V(0, -m.neckR * 1.4, 0.02));
    p.push(ell(bc.x, bc.y, bc.z, m.neckR * 0.25, m.neckR * 1.1, m.neckR * 0.4, c.coat, 8, 6));
  }
  if (m.throatBands) {
    for (const t of [0.45, 0.8]) {
      const tc = ne.clone().multiplyScalar(t);
      p.push(ell(tc.x, tc.y - m.neckR * 0.35, tc.z + m.neckR * 0.25, m.neckR * 0.95, m.neckR * 0.35, m.neckR * 0.85, m.throatBands, 10, 6, -m.neckAngle));
    }
  }
  return skinNeck(mergeColored(p), ne);
}

// ---------- head ----------
function buildHead(m, d, male, rng) {
  const c = m.colors, p = [];
  const ne = d.neckEnd, hc = d.headCenter, hd = d.headDir;
  const up = V(0, hd.z, -hd.y); // head-local up (perpendicular to the head axis)
  const neckCol = c.neck || c.coat;
  const throat = lighter(neckCol, c.belly) ? mix(neckCol, c.belly, 0.45) : neckCol;

  // skull and snout as one smooth shape along the head axis
  const at = (along, lift) => hc.clone().addScaledVector(hd, along).addScaledVector(up, lift);
  const hl = m.headLen, hh = m.headH, hw = m.headW, sl = m.snoutLen, sr = m.snoutR;
  const drop = -hh * 0.1;
  const cheek = m.foot === 'paw' && !m.hopper && sl < hl * 0.6 ? 1.12 : 1; // cats and bears: round cheeks
  const rings = [
    { c: at(-hl * 0.5, 0), rx: hw * 0.2, ry: hh * 0.2 },
    { c: at(-hl * 0.4, hh * 0.02), rx: hw * 0.4, ry: hh * 0.42 },
    { c: at(-hl * 0.18, hh * 0.04), rx: hw * 0.5 * cheek, ry: hh * 0.52 },
    { c: at(hl * 0.05, hh * 0.02), rx: hw * 0.48 * cheek, ry: hh * 0.5 },
    { c: at(hl * 0.26, drop * 0.5), rx: hw * 0.36, ry: hh * 0.4 },
    { c: at(hl * 0.3 + sl * 0.35, drop), rx: sr * 1.45, ry: sr * 1.4 },
    { c: at(hl * 0.3 + sl * 0.75, drop), rx: sr * 1.15, ry: sr * 1.1 },
    { c: at(hl * 0.3 + sl, drop - sr * 0.05), rx: sr * 0.95, ry: sr * 0.9 },
    { c: at(hl * 0.3 + sl + sr * 0.25, drop - sr * 0.1), rx: sr * 0.55, ry: sr * 0.5 },
  ];
  rings.forEach((r) => { r.p = 2.2; r.ryDown = 1.1; });
  const snoutCol = m.tusks || m.snoutMuzzle ? c.muzzle : c.head;
  const nr = rings.length;
  p.push(loft(rings, {
    seg: 18, side: V(1, 0, 0),
    color: (pt, u, s, i) => {
      let col = c.head;
      const snout = smooth(3.3, 5.2, i);
      col = mix(col, snoutCol, snout);
      if (!m.tusks) col = mix(col, c.muzzle, smooth(4.5, 7, i) * smooth(0.2, -0.6, s) + smooth(6.5, 8, i) * 0.6);
      if (i >= nr - 1) col = c.nose;
      return mix(col, c.dorsal || col, smooth(0.75, 1, s) * (1 - snout) * 0.35);
    },
  }));
  const tip = rings[nr - 1].c;
  // nose pad with nostrils
  p.push(ell(tip.x, tip.y + sr * 0.05, tip.z, sr * 0.75, sr * 0.6, sr * 0.38, c.nose, 10, 7, Math.atan2(-hd.y, hd.z)));
  for (const s of [-1, 1]) {
    const nn = tip.clone().addScaledVector(hd, sr * 0.3).add(V(s * sr * 0.28, sr * 0.06, 0));
    p.push(ell(nn.x, nn.y, nn.z, sr * 0.14, sr * 0.1, sr * 0.08, 0x050404, 6, 5));
  }
  // lower jaw and mouth line
  if (!m.tusks) {
    const ja = at(hl * 0.12, -hh * 0.36), jb = at(hl * 0.3 + sl * 0.92, drop - sr * 0.7);
    p.push(cyl(ja, jb, sr * 1.05, sr * 0.55, 10, c.muzzle));
  }
  if (m.tusks && male !== false) {
    for (const s of [-1, 1]) {
      const b = at(hl * 0.3 + sl * 0.3, drop - sr * 0.55).add(V(s * sr * 1.25, 0, 0));
      const e1 = b.clone().add(V(s * 0.025, 0.05, 0.02)), e2 = e1.clone().add(V(s * 0.015, 0.035, -0.015));
      p.push(loft(curveRings([b, e1, e2], (t) => 0.013 * (1 - t * 0.85), 6), { seg: 6, color: () => 0xeee4cc }));
    }
  }
  // facial markings
  const tiltX = Math.atan2(-hd.y, hd.z);
  if (c.mask) {
    const mc = at(hl * 0.08, hh * 0.12);
    p.push(ell(mc.x, mc.y, mc.z, hw * 0.54, hh * 0.21, hl * 0.25, c.mask, 14, 8, tiltX));
  }
  if (m.faceStripe) {
    const a = at(hl * 0.3 + sl * 0.9, drop + sr * 0.85), b = at(-hl * 0.45, hh * 0.48);
    p.push(cyl(a, b, hw * 0.09, hw * 0.12, 8, m.faceStripe));
  }
  if (m.beard) p.push(ell(0, hc.y - hh * 0.6, hc.z - hl * 0.02, hw * 0.24, hh * 0.38, hl * 0.22, c.neck || c.head, 10, 8, 0.2));
  // eyes with a glint of light
  for (const s of [-1, 1]) {
    const e = at(hl * 0.05, hh * 0.16).add(V(s * hw * 0.46 * cheek, 0, 0));
    const er = hw * 0.085;
    p.push(ell(e.x, e.y, e.z, er * 0.9, er, er * 1.1, 0x0b0908, 8, 6));
    p.push(ell(e.x + s * er * 0.55, e.y + er * 0.35, e.z + er * 0.35, er * 0.22, er * 0.22, er * 0.22, 0xdad4c8, 5, 4));
    // brow ridge
    p.push(ell(e.x - s * er * 0.2, e.y + er * 1.05, e.z, er * 1.3, er * 0.45, er * 1.4, c.head, 8, 5));
  }
  // ears: leaf-shaped, cupped, with a paler inside
  for (const s of [-1, 1]) {
    const base = at(-hl * 0.22, hh * 0.36).add(V(s * hw * 0.3, 0, 0));
    const rot = new THREE.Euler(-0.25, s * 0.3, -s * m.earAngle);
    const dirUp = V(0, 1, 0).applyEuler(rot), dirSide = V(1, 0, 0).applyEuler(rot), dirFwd = V(0, 0, 1).applyEuler(rot);
    if (m.earRound) {
      const ec = base.clone().addScaledVector(dirUp, m.earLen * 0.4).addScaledVector(dirSide, s * m.earW * 0.1);
      p.push(ell(ec.x, ec.y, ec.z, m.earW * 0.5, m.earLen * 0.55, m.earW * 0.2, c.ear, 10, 7, -0.2, 0, -s * m.earAngle));
      const ic = ec.clone().addScaledVector(dirFwd, m.earW * 0.08);
      p.push(ell(ic.x, ic.y, ic.z, m.earW * 0.32, m.earLen * 0.36, m.earW * 0.1, mix(c.ear, c.muzzle, 0.55), 8, 6, -0.2, 0, -s * m.earAngle));
      continue;
    }
    const pts = [0, 0.3, 0.62, 0.88, 1].map((k) => base.clone().addScaledVector(dirUp, m.earLen * k).addScaledVector(dirFwd, -m.earLen * 0.08 * k * k));
    const prof = (t) => Math.max(0.05, Math.sin(Math.PI * (0.18 + 0.82 * t)) * (1 - 0.35 * t));
    p.push(loft(curveRings(pts, (t) => [m.earW * 0.5 * prof(t), m.earW * 0.13 * prof(t)], 7), {
      seg: 10, side: dirSide, color: () => c.ear,
    }));
    const inner = pts.map((q) => q.clone().addScaledVector(dirFwd, m.earW * 0.06));
    p.push(loft(curveRings(inner.slice(0, 4), (t) => [m.earW * 0.32 * prof(t * 0.85), m.earW * 0.05], 6), {
      seg: 8, side: dirSide, color: () => mix(c.ear, c.muzzle || 0xd8d0c4, 0.6),
    }));
    if (m.earTufts) {
      const tp = pts[4];
      p.push(cyl(tp, tp.clone().addScaledVector(dirUp, m.earLen * 0.45), m.earW * 0.1, m.earW * 0.02, 5, 0x111010));
    }
  }
  // horns (bovids, pronghorn, bighorn) and moose antlers
  const hs = male ? 1 : (m.hornsBoth || 0);
  if (hs > 0 && ['moose', 'bovid', 'curl', 'prong'].includes(m.antlers)) buildHorns(p, m, hc, hs, rng);
  // deer and elk antlers: smooth curved beams with tines
  if (male && (m.antlers === 'deer' || m.antlers === 'elk')) {
    const ac = 0xcbb894, tipC = 0xeae0c8;
    const top = hc.clone().add(V(0, m.headH * 0.42, -m.headLen * 0.12));
    const tube = (pts, r0, r1) => p.push(loft(curveRings(pts, (t) => r0 + (r1 - r0) * t, Math.max(5, pts.length * 3)), {
      seg: 7, color: (pt, u) => mix(ac, tipC, smooth(0.6, 1, u)),
    }));
    for (const s of [-1, 1]) {
      const b0 = top.clone().add(V(s * m.headW * 0.22, 0, 0));
      p.push(ell(b0.x, b0.y + 0.008, b0.z, 0.028 * (m.antlers === 'elk' ? 1.6 : 1), 0.012, 0.028 * (m.antlers === 'elk' ? 1.6 : 1), 0xa89870, 8, 5)); // burr
      if (m.antlers === 'deer') {
        const sc = 0.9 + rng() * 0.3;
        const pts = [b0];
        pts.push(pts[0].clone().add(V(s * 0.1, 0.12, -0.05).multiplyScalar(sc)));
        pts.push(pts[1].clone().add(V(s * 0.07, 0.09, 0.08).multiplyScalar(sc)));
        pts.push(pts[2].clone().add(V(-s * 0.02, 0.05, 0.12).multiplyScalar(sc)));
        pts.push(pts[3].clone().add(V(-s * 0.04, 0.03, 0.08).multiplyScalar(sc)));
        tube(pts, 0.02, 0.006);
        const curve = new THREE.CatmullRomCurve3(pts);
        for (const [t, v] of [[0.3, V(0, 0.13, 0.02)], [0.55, V(-s * 0.01, 0.14, 0)], [0.78, V(0, 0.1, 0)]]) {
          const a = curve.getPoint(t);
          tube([a, a.clone().add(v.clone().multiplyScalar(sc * 0.5)).add(V(0, 0, 0.012)), a.clone().add(v.clone().multiplyScalar(sc))], 0.012, 0.003);
        }
        tube([b0, b0.clone().add(V(s * 0.01, 0.03, 0.025)), b0.clone().add(V(s * 0.02, 0.05, 0.04))], 0.009, 0.003); // brow tine
      } else {
        const sc = 0.9 + rng() * 0.25;
        const pts = [b0];
        pts.push(pts[0].clone().add(V(s * 0.12, 0.28, -0.2).multiplyScalar(sc)));
        pts.push(pts[1].clone().add(V(s * 0.1, 0.3, -0.2).multiplyScalar(sc)));
        pts.push(pts[2].clone().add(V(s * 0.03, 0.26, -0.12).multiplyScalar(sc)));
        pts.push(pts[3].clone().add(V(-s * 0.05, 0.16, 0.02).multiplyScalar(sc)));
        tube(pts, 0.035, 0.01);
        const curve = new THREE.CatmullRomCurve3(pts);
        for (const [t, v] of [[0.04, V(s * 0.02, 0.06, 0.26)], [0.1, V(s * 0.03, 0.12, 0.22)], [0.3, V(0, 0.1, 0.24)], [0.55, V(0, 0.14, 0.22)], [0.8, V(-s * 0.02, 0.18, 0.08)]]) {
          const a = curve.getPoint(t);
          tube([a, a.clone().add(v.clone().multiplyScalar(sc * 0.5)).add(V(0, 0.02, 0)), a.clone().add(v.clone().multiplyScalar(sc))], 0.02, 0.005);
        }
      }
    }
  }
  return mergeColored(p);
}

function buildHorns(p, m, hc, scale, rng) {
  const top = hc.clone().add(V(0, m.headH * 0.4, -m.headLen * 0.15));
  const tube = (pts, r0, r1, col, tipCol) => p.push(loft(curveRings(pts, (t) => r0 + (r1 - r0) * t, Math.max(6, pts.length * 3)), {
    seg: 8, color: (pt, u) => (tipCol ? mix(col, tipCol, smooth(0.5, 1, u)) : col),
  }));
  for (const s of [-1, 1]) {
    if (m.antlers === 'moose') {
      const ac = 0xc4b088;
      const b0 = top.clone().add(V(s * m.headW * 0.3, 0, 0));
      const b1 = b0.clone().add(V(s * 0.2, 0.06, -0.02));
      tube([b0, b0.clone().lerp(b1, 0.5).add(V(0, 0.01, 0)), b1], 0.045, 0.04, ac);
      // broad palm with tines along its outer rim
      const pc = b1.clone().add(V(s * 0.28, 0.14, 0.02));
      p.push(ell(pc.x, pc.y, pc.z, 0.3, 0.035, 0.2, ac, 16, 8, 0, 0, s * 0.45));
      const n = 5 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const a = -0.9 + (i / (n - 1)) * 1.8;
        const base = pc.clone().add(V(s * Math.cos(a) * 0.26, Math.cos(a) * 0.12 + 0.02, Math.sin(a) * 0.18));
        tube([base, base.clone().add(V(s * 0.03, 0.05, Math.sin(a) * 0.02)), base.clone().add(V(s * 0.05, 0.1, Math.sin(a) * 0.04))], 0.018, 0.004, ac, 0xe0d2b0);
      }
      const fp = b1.clone().add(V(s * 0.06, 0.04, 0.14));
      p.push(ell(fp.x, fp.y, fp.z, 0.1, 0.03, 0.08, ac, 10, 6));
    } else if (m.antlers === 'bovid') {
      const hcol = 0x1a1612;
      const b0 = hc.clone().add(V(s * m.headW * 0.46, m.headH * 0.32, -m.headLen * 0.12));
      const b1 = b0.clone().add(V(s * 0.11 * scale, 0.02, 0));
      const b2 = b1.clone().add(V(s * 0.04 * scale, 0.11 * scale, 0.03));
      tube([b0, b1, b2], 0.045 * scale, 0.006, hcol, 0x3a3228);
    } else if (m.antlers === 'curl') {
      // bighorn: thick, ridged horns spiralling back, down and forward around the ear
      const hcol = 0x9a8866, R0 = 0.13 * scale;
      const start = top.clone().add(V(s * m.headW * 0.25, 0, 0.03));
      const turns = scale >= 1 ? 1.65 : 0.55, N = scale >= 1 ? 14 : 6;
      const pts = [start];
      for (let i = 1; i <= N; i++) {
        const t = i / N, a = t * turns * Math.PI, R = R0 * (1 - 0.25 * t);
        pts.push(start.clone().add(V(s * (0.02 + 0.09 * t) * scale, R * Math.cos(a) - R0, -R * Math.sin(a) - 0.02)));
      }
      p.push(loft(curveRings(pts, (t) => (0.05 - 0.034 * t) * scale, N * 3), {
        seg: 9, color: (pt, u) => mix(Math.floor(u * N * 3) % 2 ? hcol : 0x8a7858, 0xb8a888, smooth(0.8, 1, u)),
      }));
    } else if (m.antlers === 'prong') {
      const hcol = 0x161210;
      const b0 = top.clone().add(V(s * m.headW * 0.22, 0, 0.02));
      const b1 = b0.clone().add(V(s * 0.015, 0.12, -0.01));
      const b2 = b1.clone().add(V(-s * 0.02, 0.1, -0.04));
      tube([b0, b1, b2], 0.022, 0.004, hcol);
      tube([b1.clone().add(V(0, -0.02, 0)), b1.clone().add(V(0, -0.005, 0.03)), b1.clone().add(V(0, 0.01, 0.05))], 0.012, 0.003, hcol);
    }
  }
}

// ---------- legs ----------
function buildLeg(m, d, hind) {
  const c = m.colors, r = m.legR, p = [];
  const J = hind ? d.hind : d.front;
  const upper = c.coat, lower = c.legs;
  if (m.hopper) {
    if (hind) {
      p.push(ell(0, -d.legLen * 0.3, -0.01, r * 2.5, d.legLen * 0.45, r * 3.5, upper, 12, 9));
      p.push(ell(0, -d.legLen + r * 0.7, 0.03, r * 1.5, r * 0.8, d.legLen * 0.75, lower, 10, 7));
    } else {
      p.push(loft(curveRings([V(0, r, 0), V(0, -d.legLen * 0.5, 0.005), V(0, -d.legLen, 0.01)], (t) => r * (1.5 - 0.5 * t), 5), { seg: 8, color: () => lower }));
      p.push(ell(0, -d.legLen + r * 0.6, 0.012, r * 1.1, r * 0.7, r * 1.6, lower, 8, 6));
    }
    return mergeColored(p);
  }
  // one smooth limb from deep in the body down to the foot, thick at the top
  // the top is a rounded dome tucked up inside the body, so no edge shows where the leg joins
  const top = V(J[0].x, J[0].y + r * 3.2, J[0].z + (hind ? -r * 0.4 : r * 0.25));
  const pts = [top, ...J];
  // broad thigh / shoulder blending up into the body, then a slim lower leg
  const radii = hind ? [r * 2.2, r * 3.1, r * 1.75, r * 1.12, r * 0.82, r * 0.78] : [r * 1.9, r * 2.5, r * 1.5, r * 1.02, r * 0.82, r * 0.78];
  const N = 16;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const rings = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), f = t * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(f));
    const rr = radii[k] + (radii[k + 1] - radii[k]) * (f - k);
    rings.push({ c: curve.getPoint(t), rx: rr * 0.82, ry: rr, p: 2.1 });
  }
  const darkLower = m.foot === 'paw' && c.legs !== c.coat;
  p.push(loft(rings, {
    seg: 12, capStart: true, capEnd: true,
    color: (pt, u) => mix(upper, lower, smooth(darkLower ? 0.3 : 0.38, darkLower ? 0.5 : 0.62, u)),
  }));
  // knee / hock knob
  p.push(ell(J[2].x, J[2].y, J[2].z, r * 1.15, r * 1.3, r * 1.25, mix(upper, lower, 0.6), 10, 7));
  const g = J[4];
  if (m.foot === 'hoof') {
    const hoof = 0x1c1714;
    p.push(loft([
      { c: V(g.x, g.y + r * 2.3, g.z), rx: r * 0.85, ry: r * 0.9 },
      { c: V(g.x, g.y + r * 1.2, g.z + r * 0.1), rx: r * 1.0, ry: r * 1.1 },
      { c: V(g.x, g.y + r * 0.15, g.z + r * 0.35), rx: r * 1.15, ry: r * 1.3 },
    ], { seg: 12, color: (pt, u) => mix(0x2a221c, hoof, u) }));
    p.push(colorize(xf(new THREE.BoxGeometry(r * 0.18, r * 1.6, r * 1.4), g.x, g.y + r * 0.8, g.z + r * 0.55), 0x0c0a08)); // cleft
    p.push(ell(g.x, g.y + r * 2.6, g.z - r * 0.9, r * 0.32, r * 0.32, r * 0.32, hoof, 6, 5)); // dewclaw
  } else if (m.plantigrade) {
    // walks on the whole sole: long, flat foot with claws
    p.push(ell(g.x, g.y + r * 0.6, g.z + r * 1.3, r * 1.4, r * 0.65, r * 2.6, lower, 12, 8));
    for (let i = 0; i < 5; i++) {
      const cx = g.x + (i - 2) * r * 0.55, cz = g.z + r * 3.7;
      p.push(cyl(V(cx, g.y + r * 0.4, cz - r * 0.2), V(cx, g.y + r * 0.08, cz + r * 0.45), r * 0.13, r * 0.03, 5, 0x3a332c));
    }
  } else {
    // paw with four toes
    const k = m.bigPaws ? 1.7 : 1;
    p.push(ell(g.x, g.y + r * 0.7, g.z + r * 0.4, r * 1.15 * k, r * 0.75, r * 1.3 * k, lower, 12, 8));
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.45;
      p.push(ell(g.x + Math.sin(a) * r * 0.85 * k, g.y + r * 0.45, g.z + r * 0.4 + Math.cos(a) * r * 1.2 * k, r * 0.42 * k, r * 0.42, r * 0.5 * k, lower, 7, 5));
    }
  }
  return mergeColored(p);
}

// ---------- tail ----------
function buildTail(m) {
  const c = m.colors, p = [];
  const tl = m.tailLen, tr = m.tailR;
  switch (m.tailType) {
    case 'deer': {
      // flat tail: brown above, white below (flagged when alarmed)
      const pts = [V(0, 0.01, 0), V(0, -tl * 0.4, -tr * 0.5), V(0, -tl * 0.9, -tr * 0.4)];
      p.push(loft(curveRings(pts, (t) => [tr * (0.9 + 0.5 * Math.sin(Math.PI * t * 0.9)), tr * 0.42 * (1 - 0.4 * t)], 7), {
        seg: 12, side: V(1, 0, 0), color: (pt, u, s) => (s > 0.1 ? c.tailUnder : c.tail), ySign: 1,
      }));
      break;
    }
    case 'bushy': {
      const pts = [V(0, 0, 0), V(0, -tl * 0.3, -tl * 0.3), V(0, -tl * 0.6, -tl * 0.5), V(0, -tl * 0.78, -tl * 0.62)];
      p.push(loft(curveRings(pts, (t) => tr * (0.35 + 1.1 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - 0.2 * t)) + 0.003, 12), {
        seg: 14, color: (pt, u, s) => mix(mix(c.tail, c.dorsal, smooth(0.4, 1, -s) * 0.4), c.tailUnder, smooth(0.78, 0.92, u)),
      }));
      break;
    }
    case 'long': {
      // cat tail: hangs down, curls back up at the tip
      const pts = [V(0, 0, 0), V(0, -tl * 0.35, -tl * 0.22), V(0, -tl * 0.62, -tl * 0.45), V(0, -tl * 0.7, -tl * 0.72), V(0, -tl * 0.58, -tl * 0.92)];
      p.push(loft(curveRings(pts, (t) => tr * (1.15 - 0.3 * t), 16), { seg: 10, color: (pt, u) => mix(c.tail, c.tailUnder, smooth(0.82, 0.92, u)) }));
      break;
    }
    case 'ringed': {
      const pts = [V(0, 0, 0), V(0, -tl * 0.3, -tl * 0.45), V(0, -tl * 0.55, -tl * 0.8)];
      p.push(loft(curveRings(pts, (t) => tr * (1.05 - 0.25 * t), 21), { seg: 12, color: (pt, u) => (Math.floor(u * 7) % 2 ? c.tailUnder : c.tail) }));
      break;
    }
    case 'bob':
      p.push(loft(curveRings([V(0, 0, 0), V(0, -tl * 0.3, -tl * 0.45), V(0, -tl * 0.6, -tl * 0.8)], (t) => tr * (1 - 0.3 * t), 7), {
        seg: 10, color: (pt, u) => mix(c.tail, c.tailUnder, smooth(0.65, 0.85, u)),
      }));
      break;
    case 'thin':
      p.push(loft(curveRings([V(0, 0, 0), V(0, -tl * 0.5, -0.025), V(0, -tl, -0.04)], (t) => tr * (1.5 - 0.6 * t), 7), { seg: 7, color: () => c.tail }));
      p.push(ell(0, -tl, -0.04, tr * 2.4, tr * 4, tr * 2.4, c.dorsal, 8, 6));
      break;
    case 'puff':
      p.push(ell(0, 0, -tr * 0.4, tr, tr, tr, c.tail, 10, 8));
      break;
    default:
      p.push(loft(curveRings([V(0, 0.01, 0), V(0, -tl * 0.4, -0.02), V(0, -tl * 0.8, -0.03)], (t) => [tr * (1.5 - 0.4 * t), tr * (1 - 0.3 * t)], 6), { seg: 10, color: () => c.tail }));
  }
  return mergeColored(p);
}

export function getSpeciesGeometry(speciesId, male, lod = 0) {
  const key = speciesId + (male ? ':m' : ':f') + ':' + lod;
  if (cache.has(key)) return cache.get(key);
  detail = lod ? 0.32 : 1.05;
  const sp = SPECIES[speciesId];
  const m = sp.model;
  const rng = mulberry32(speciesId.length * 97 + (male ? 13 : 7));
  const d = computeDims(m);
  const geo = {
    body: buildBody(m, d),
    head: buildHead(m, d, male, rng),
    neck: buildNeck(m, d),
    legF: buildLeg(m, d, false),
    legH: buildLeg(m, d, true),
    tail: buildTail(m),
    dims: d,
  };
  detail = 1;
  cache.set(key, geo);
  return geo;
}

// ---------- one skinned mesh per animal ----------
// Bones: 0 spine, 1-3 neck (root, mid, top — the head rides on top), 4 tail,
// then hip + knee for each leg: 5/6 front-left, 7/8 front-right, 9/10 hind-left, 11/12 hind-right.
const B = { SPINE: 0, NROOT: 1, NMID: 2, NTOP: 3, TAIL: 4 };
const HIP = [5, 7, 9, 11], KNEE = [6, 8, 10, 12];
const unifiedCache = new Map();

function legSlots(d) {
  return [[d.legX, d.frontZ, false], [-d.legX, d.frontZ, false], [d.legX, d.hindZ, true], [-d.legX, d.hindZ, true]];
}

// Merge body, neck, head, legs and tail into one geometry with bone weights
function unifiedGeometry(speciesId, male, lod) {
  const key = speciesId + (male ? ':m' : ':f') + ':' + lod;
  if (unifiedCache.has(key)) return unifiedCache.get(key);
  const m = SPECIES[speciesId].model;
  const g = getSpeciesGeometry(speciesId, male, lod);
  const d = g.dims;
  const parts = [];
  const add = (geo, offset, weigh) => parts.push({ geo, offset, weigh });
  const slots = legSlots(d);
  // body: the flanks over each leg follow that leg a little, so shoulders and haunches move with it
  add(g.body, null, (x, y, z) => {
    let best = -1, bw = 0;
    slots.forEach(([lx, lz], k) => {
      if (Math.sign(x) !== Math.sign(lx) && Math.abs(x) > 0.02) return;
      const dist = Math.hypot((x - lx) * 1.3, (z - lz)) / (m.bodyLen * 0.2);
      const w = smooth(1, 0.15, dist) * smooth(d.cY + m.bodyH * 0.15, d.legTopY - m.bodyH * 0.05, y) * 0.55;
      if (w > bw) { bw = w; best = k; }
    });
    return best >= 0 ? [B.SPINE, HIP[best], bw] : [B.SPINE, B.SPINE, 0];
  });
  // neck: its own weights (anchor/root/mid/top) map onto spine and neck bones
  add(g.neck, d.neckBase, null);
  add(g.head, d.neckBase, () => [B.NTOP, B.NTOP, 0]);
  add(g.tail, d.tailBase, (x, y, z) => [B.SPINE, B.TAIL, smooth(0.0, Math.min(0.06, m.tailLen * 0.3), Math.hypot(y, z))]);
  slots.forEach(([lx, lz, hind], k) => {
    const J = hind ? d.hind : d.front;
    const jy = J[2].y, band = m.legR * 2.6;
    add(hind ? g.legH : g.legF, new THREE.Vector3(lx, d.legTopY, lz), (x, y) => (y > 0
      ? [HIP[k], B.SPINE, 0.6 * smooth(0, m.legR * 3.2, y)] // the part tucked inside the body stays with it
      : [HIP[k], KNEE[k], smooth(jy + band, jy - band, y)]));
  });
  let total = 0;
  for (const p of parts) total += p.geo.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  const si = new Uint16Array(total * 4), sw = new Float32Array(total * 4);
  let o = 0;
  for (const p of parts) {
    const a = p.geo.attributes, n = a.position.count;
    const ox = p.offset ? p.offset.x : 0, oy = p.offset ? p.offset.y : 0, oz = p.offset ? p.offset.z : 0;
    for (let i = 0; i < n; i++) {
      const x = a.position.getX(i), y = a.position.getY(i), z = a.position.getZ(i);
      const k = o + i;
      pos[k * 3] = x + ox; pos[k * 3 + 1] = y + oy; pos[k * 3 + 2] = z + oz;
      nrm[k * 3] = a.normal.getX(i); nrm[k * 3 + 1] = a.normal.getY(i); nrm[k * 3 + 2] = a.normal.getZ(i);
      col[k * 3] = a.color.getX(i); col[k * 3 + 1] = a.color.getY(i); col[k * 3 + 2] = a.color.getZ(i);
      if (p.weigh) {
        const [b0, b1, w] = p.weigh(x, y, z);
        si[k * 4] = b0; si[k * 4 + 1] = b1; sw[k * 4] = 1 - w; sw[k * 4 + 1] = w;
      } else {
        // neck geometry: anchor (0) -> spine, root/mid/top (1-3) keep their numbers
        si[k * 4] = a.skinIndex.getX(i); si[k * 4 + 1] = a.skinIndex.getY(i);
        sw[k * 4] = a.skinWeight.getX(i); sw[k * 4 + 1] = a.skinWeight.getY(i);
      }
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  unifiedCache.set(key, out);
  return out;
}

// Create an animal rig. Returns references to the animated parts:
// legs[] are the hip bones and knees[] the knee/hock bones, tailPivot the tail bone.
export function createAnimalRig(speciesId, male, material = animalMaterial) {
  const sp = SPECIES[speciesId];
  const m = sp.model;
  const d = getSpeciesGeometry(speciesId, male, 0).dims;
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const spine = new THREE.Bone();
  const nRoot = new THREE.Bone(), nMid = new THREE.Bone(), nTop = new THREE.Bone();
  nRoot.position.copy(d.neckBase);
  nMid.position.copy(d.neckEnd).multiplyScalar(0.5);
  nTop.position.copy(d.neckEnd).multiplyScalar(0.5);
  spine.add(nRoot); nRoot.add(nMid); nMid.add(nTop);
  const tailB = new THREE.Bone();
  tailB.position.copy(d.tailBase);
  spine.add(tailB);
  const legs = [], knees = [];
  for (const [lx, lz, hind] of legSlots(d)) {
    const hip = new THREE.Bone(), knee = new THREE.Bone();
    hip.position.set(lx, d.legTopY, lz);
    knee.position.copy((hind ? d.hind : d.front)[2]);
    hip.add(knee);
    spine.add(hip);
    legs.push(hip); knees.push(knee);
  }
  const bones = [spine, nRoot, nMid, nTop, tailB];
  for (let k = 0; k < 4; k++) bones.push(legs[k], knees[k]);

  const mesh = new THREE.SkinnedMesh(unifiedGeometry(speciesId, male, 0), material);
  mesh.add(spine);
  bodyPivot.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true;

  // Head down: the neck swings from the shoulders while the poll straightens, so the muzzle points at the
  // ground instead of tucking under the chin. Head up: shared more evenly along the neck.
  const setHead = (pitch, yaw = 0) => {
    if (pitch >= 0) {
      nRoot.rotation.set(pitch * 0.95, yaw * 0.45, 0, 'YXZ');
      nMid.rotation.set(pitch * 0.06, yaw * 0.3, 0, 'YXZ');
      nTop.rotation.set(-pitch * 0.4, yaw * 0.25, 0, 'YXZ');
    } else {
      nRoot.rotation.set(pitch * 0.5, yaw * 0.45, 0, 'YXZ');
      nMid.rotation.set(pitch * 0.2, yaw * 0.3, 0, 'YXZ');
      nTop.rotation.set(pitch * 0.3, yaw * 0.25, 0, 'YXZ');
    }
  };
  // distant animals swap to a lighter version of the same model
  let lod = 0;
  const setLod = (level) => {
    if (level === lod) return;
    lod = level;
    mesh.geometry = unifiedGeometry(speciesId, male, level);
  };
  const meshes = [mesh];
  return {
    root, bodyPivot, body: mesh, mesh, headPivot: nRoot, neck: mesh, head: mesh,
    bones: { spine, root: nRoot, mid: nMid, top: nTop }, setHead,
    legs, knees, tailPivot: tailB, tail: mesh, meshes, dims: d, model: m, setLod,
  };
}
