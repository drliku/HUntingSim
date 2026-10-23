// Procedural low-poly animal models. Each animal is a handful of meshes sharing one
// vertex-coloured material: body, head (with neck/ears/antlers), four legs and a tail.
import * as THREE from 'three';
import { SPECIES } from './species.js';
import { colorize, mergeColored, ellipsoid, cylinderBetween, xf, shadeVertical } from './geo.js';
import { mulberry32 } from './utils.js';

export const animalMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const cache = new Map();

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

function buildBody(m, d, rng) {
  const c = m.colors, L = m.bodyLen, H = m.bodyH, W = m.bodyW, cY = d.cY;
  const p = [];
  const J = 0.08;
  const E = (x, y, z, sx, sy, sz, col, rx = 0) => {
    const g = ellipsoid(x, y, z, sx, sy, sz, col, 12, 9, rx);
    const cc = g.attributes.color.array;
    for (let i = 0; i < cc.length; i += 9) {
      const j = 1 + (rng() - 0.5) * J;
      for (let k = 0; k < 9; k++) cc[i + k] *= j;
    }
    p.push(g);
  };
  if (m.hopper) {
    E(0, cY + H * 0.05, -L * 0.12, W * 0.55, H * 0.55, L * 0.42, c.coat);
    E(0, cY - H * 0.05, L * 0.2, W * 0.42, H * 0.42, L * 0.3, c.coat);
    E(0, cY - H * 0.18, 0, W * 0.38, H * 0.32, L * 0.38, c.belly);
    E(0, cY + H * 0.2, -L * 0.08, W * 0.3, H * 0.4, L * 0.38, c.dorsal);
    // haunches
    E(W * 0.34, cY - H * 0.1, -L * 0.2, W * 0.22, H * 0.4, L * 0.3, c.coat);
    E(-W * 0.34, cY - H * 0.1, -L * 0.2, W * 0.22, H * 0.4, L * 0.3, c.coat);
  } else {
    E(0, cY, 0, W * 0.5, H * 0.5, L * 0.5, c.coat);
    E(0, cY + H * 0.03, L * 0.27, W * 0.5, H * 0.56, L * 0.28, m.colors.neck || c.coat);
    E(0, cY + H * 0.04, -L * 0.3, W * 0.52, H * 0.52, L * 0.26, c.coat);
    E(0, cY - H * 0.15, L * 0.03, W * 0.43, H * 0.37, L * 0.4, c.belly);
    E(0, cY + H * 0.17, 0, W * 0.3, H * 0.35, L * 0.46, c.dorsal);
    // haunches and shoulders give leg roots some mass
    for (const s of [-1, 1]) {
      E(s * W * 0.3, cY - H * 0.08, -L * 0.3, W * 0.2, H * 0.44, L * 0.19, c.coat);
      E(s * W * 0.3, cY - H * 0.06, L * 0.3, W * 0.18, H * 0.4, L * 0.15, m.colors.neck || c.coat);
    }
  }
  if (c.rump) E(0, cY + H * 0.05, -L * 0.47, W * 0.4, H * 0.38, L * 0.09, c.rump);
  if (m.bristles) E(0, cY + H * 0.33, L * 0.12, W * 0.16, H * 0.28, L * 0.42, c.dorsal);
  if (m.ruff) E(0, cY + H * 0.08, L * 0.42, W * 0.6, H * 0.6, L * 0.16, c.coat);
  if (m.mane) E(0, cY - H * 0.05, L * 0.44, W * 0.4, H * 0.5, L * 0.12, c.neck);
  if (m.hump) {
    // shoulder hump (bison, moose)
    E(0, cY + H * (0.24 + m.hump.h * 0.25), L * 0.24, W * 0.34, H * (0.2 + m.hump.h * 0.3), L * 0.3, m.hump.color);
  }
  return shadeVertical(mergeColored(p), 0.82, 1.08);
}

function buildHead(m, d, male, rng) {
  const c = m.colors, p = [];
  const ne = d.neckEnd, hc = d.headCenter, hd = d.headDir;
  // neck
  const neckCol = c.neck || c.coat;
  p.push(cylinderBetween(V(0, -m.neckR * 0.6, -m.neckR * 0.8), ne, m.neckR * 1.35, m.neckR, 8, neckCol));
  if (m.mane) p.push(ellipsoid(0, ne.y * 0.45, ne.z * 0.45, m.neckR * 1.1, m.neckLen * 0.45, m.neckR * 1.3, c.neck, 8, 6, -m.neckAngle + Math.PI / 2));
  if (m.ruff) p.push(ellipsoid(0, ne.y * 0.4, ne.z * 0.4 + 0.02, m.neckR * 1.5, m.neckR * 1.6, m.neckR * 1.4, c.coat, 8, 6));
  // skull
  const tiltX = Math.atan2(-hd.y, hd.z);
  p.push(ellipsoid(hc.x, hc.y, hc.z, m.headW / 2, m.headH / 2, m.headLen / 2, c.head, 10, 8, tiltX));
  // cheeks/jaw mass
  p.push(ellipsoid(0, hc.y - m.headH * 0.15, hc.z - hd.z * m.headLen * 0.1, m.headW * 0.45, m.headH * 0.4, m.headLen * 0.35, c.head, 8, 6, tiltX));
  // snout
  const sStart = hc.clone().addScaledVector(hd, m.headLen * 0.3).add(V(0, -m.headH * 0.08, 0));
  const sEnd = sStart.clone().addScaledVector(hd, m.snoutLen);
  const snoutCol = m.tusks || m.snoutMuzzle ? c.muzzle : c.head;
  p.push(cylinderBetween(sStart, sEnd, m.snoutR * 1.5, m.snoutR, 8, snoutCol));
  if (!m.tusks) {
    // paler chin / lower jaw
    const jawA = sStart.clone().add(V(0, -m.snoutR * 0.75, -m.headLen * 0.05));
    const jawB = sEnd.clone().add(V(0, -m.snoutR * 0.7, -m.snoutR * 0.4));
    p.push(cylinderBetween(jawA, jawB, m.snoutR * 1.05, m.snoutR * 0.6, 7, c.muzzle));
  }
  p.push(ellipsoid(sEnd.x, sEnd.y, sEnd.z, m.snoutR * 1.05, m.snoutR * 0.9, m.snoutR * 0.6, c.nose, 8, 6, tiltX));
  if (m.tusks && male !== false) {
    for (const s of [-1, 1]) {
      const b = sStart.clone().addScaledVector(hd, m.snoutLen * 0.25).add(V(s * m.snoutR * 1.3, -m.snoutR * 0.6, 0));
      p.push(cylinderBetween(b, b.clone().add(V(s * 0.03, 0.07, 0.015)), 0.012, 0.003, 5, 0xe8dfc8));
    }
  }
  // facial markings
  if (c.mask) {
    const mc = hc.clone().add(V(0, m.headH * 0.14, 0)).addScaledVector(hd, m.headLen * 0.12);
    p.push(ellipsoid(mc.x, mc.y, mc.z, m.headW * 0.53, m.headH * 0.2, m.headLen * 0.24, c.mask, 10, 6, tiltX));
  }
  if (m.faceStripe) {
    const a = sEnd.clone().add(V(0, m.snoutR * 0.7, -m.snoutR * 0.5));
    const b = hc.clone().add(V(0, m.headH * 0.45, -m.headLen * 0.45));
    p.push(cylinderBetween(a, b, m.headW * 0.09, m.headW * 0.11, 6, m.faceStripe));
  }
  if (m.beard) p.push(ellipsoid(0, hc.y - m.headH * 0.55, hc.z - m.headLen * 0.05, m.headW * 0.22, m.headH * 0.35, m.headLen * 0.22, c.neck || c.head, 8, 6, 0.2));
  if (m.bell) {
    const bc = ne.clone().multiplyScalar(0.75).add(V(0, -m.neckR * 1.4, 0.02));
    p.push(ellipsoid(bc.x, bc.y, bc.z, m.neckR * 0.25, m.neckR * 1.1, m.neckR * 0.4, c.coat, 6, 5));
  }
  if (m.throatBands) {
    for (const t of [0.45, 0.8]) {
      const tc = ne.clone().multiplyScalar(t);
      p.push(ellipsoid(tc.x, tc.y - m.neckR * 0.35, tc.z + m.neckR * 0.2, m.neckR * 0.95, m.neckR * 0.35, m.neckR * 0.85, m.throatBands, 8, 5, -m.neckAngle));
    }
  }
  // eyes
  for (const s of [-1, 1]) {
    const e = hc.clone().add(V(s * m.headW * 0.44, m.headH * 0.18, 0)).addScaledVector(hd, m.headLen * 0.08);
    p.push(ellipsoid(e.x + s * (c.mask ? m.headW * 0.1 : 0), e.y, e.z, m.headW * 0.09, m.headW * 0.09, m.headW * 0.11, 0x0b0908, 6, 5));
  }
  // ears
  for (const s of [-1, 1]) {
    const base = hc.clone().add(V(s * m.headW * 0.32, m.headH * 0.38, 0)).addScaledVector(hd, -m.headLen * 0.25);
    if (m.earRound) {
      p.push(ellipsoid(base.x + s * m.earW * 0.2, base.y + m.earLen * 0.4, base.z, m.earW * 0.5, m.earLen * 0.55, m.earW * 0.22, c.ear, 7, 5, -0.2, 0, -s * m.earAngle));
      continue;
    }
    const g = new THREE.ConeGeometry(m.earW / 2, m.earLen, 6);
    g.translate(0, m.earLen / 2, 0);
    xf(g, 0, 0, 0, 0, 0, 0, 1, 1, 0.45);
    xf(g, base.x, base.y, base.z, -0.25, s * 0.3, -s * m.earAngle);
    p.push(colorize(g, c.ear));
    if (m.earTufts) {
      const tip = V(0, m.earLen, 0).applyEuler(new THREE.Euler(-0.25, s * 0.3, -s * m.earAngle)).add(base);
      p.push(cylinderBetween(tip, tip.clone().add(V(-s * 0.005, m.earLen * 0.45, -0.005)), m.earW * 0.1, m.earW * 0.02, 4, 0x111010));
    }
    if (m.colors.muzzle && m.foot === 'paw' && !m.hopper) {
      // pale inner ear
      const gi = new THREE.ConeGeometry(m.earW * 0.32, m.earLen * 0.75, 5);
      gi.translate(0, m.earLen * 0.37, 0);
      xf(gi, 0, 0, 0, 0, 0, 0, 1, 1, 0.3);
      xf(gi, base.x, base.y, base.z + 0.004, -0.25, s * 0.3, -s * m.earAngle);
      p.push(colorize(gi, c.muzzle));
    }
  }
  // horns (bovids, pronghorn) and moose antlers
  const hs = male ? 1 : (m.hornsBoth || 0);
  if (hs > 0 && ['moose', 'bovid', 'curl', 'prong'].includes(m.antlers)) buildHorns(p, m, hc, hs, rng);
  // antlers
  if (male && (m.antlers === 'deer' || m.antlers === 'elk')) {
    const ac = 0xcbb894;
    const top = hc.clone().add(V(0, m.headH * 0.42, -m.headLen * 0.12));
    for (const s of [-1, 1]) {
      const pts = [];
      let tines = [];
      const b0 = top.clone().add(V(s * m.headW * 0.22, 0, 0));
      if (m.antlers === 'deer') {
        const sc = 0.9 + rng() * 0.3;
        pts.push(b0, b0.clone().add(V(s * 0.1, 0.12, -0.05).multiplyScalar(sc)));
        pts.push(pts[1].clone().add(V(s * 0.07, 0.09, 0.08).multiplyScalar(sc)));
        pts.push(pts[2].clone().add(V(-s * 0.02, 0.05, 0.12).multiplyScalar(sc)));
        pts.push(pts[3].clone().add(V(-s * 0.04, 0.03, 0.08).multiplyScalar(sc)));
        tines = [[1, V(0, 0.13, 0.02)], [2, V(-s * 0.01, 0.14, 0)], [3, V(0, 0.1, 0)]];
        for (let i = 0; i < pts.length - 1; i++) p.push(cylinderBetween(pts[i], pts[i + 1], 0.02 - i * 0.003, 0.017 - i * 0.003, 5, ac));
        tines.forEach(([i, v]) => p.push(cylinderBetween(pts[i], pts[i].clone().add(v.multiplyScalar(sc)), 0.012, 0.004, 4, ac)));
        p.push(cylinderBetween(b0, b0.clone().add(V(s * 0.02, 0.05, 0.04)), 0.01, 0.004, 4, ac)); // brow tine
      } else {
        const sc = 0.9 + rng() * 0.25;
        pts.push(b0, b0.clone().add(V(s * 0.12, 0.28, -0.2).multiplyScalar(sc)));
        pts.push(pts[1].clone().add(V(s * 0.1, 0.3, -0.2).multiplyScalar(sc)));
        pts.push(pts[2].clone().add(V(s * 0.03, 0.26, -0.12).multiplyScalar(sc)));
        pts.push(pts[3].clone().add(V(-s * 0.05, 0.16, 0.02).multiplyScalar(sc)));
        tines = [[0, V(s * 0.02, 0.06, 0.26)], [0, V(s * 0.03, 0.12, 0.22)], [1, V(0, 0.1, 0.24)], [2, V(0, 0.14, 0.22)], [3, V(-s * 0.02, 0.18, 0.08)]];
        for (let i = 0; i < pts.length - 1; i++) p.push(cylinderBetween(pts[i], pts[i + 1], 0.035 - i * 0.005, 0.03 - i * 0.005, 5, ac));
        tines.forEach(([i, v]) => {
          const a = i === 0 ? pts[0].clone().add(V(s * 0.02, 0.04, 0)) : pts[i];
          p.push(cylinderBetween(a, a.clone().add(v.multiplyScalar(sc)), 0.02, 0.006, 4, ac));
        });
      }
    }
  }
  return mergeColored(p);
}

function buildHorns(p, m, hc, scale, rng) {
  const top = hc.clone().add(V(0, m.headH * 0.4, -m.headLen * 0.15));
  for (const s of [-1, 1]) {
    if (m.antlers === 'moose') {
      const ac = 0xc4b088;
      const b0 = top.clone().add(V(s * m.headW * 0.3, 0, 0));
      const b1 = b0.clone().add(V(s * 0.2, 0.06, -0.02));
      p.push(cylinderBetween(b0, b1, 0.045, 0.04, 6, ac));
      // broad palm with tines along its outer rim
      const pc = b1.clone().add(V(s * 0.28, 0.14, 0.02));
      p.push(ellipsoid(pc.x, pc.y, pc.z, 0.3, 0.035, 0.2, ac, 10, 6, 0, 0, s * 0.45));
      const n = 5 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const a = -0.9 + (i / (n - 1)) * 1.8;
        const base = pc.clone().add(V(s * Math.cos(a) * 0.26, Math.cos(a) * 0.12 + 0.02, Math.sin(a) * 0.18));
        p.push(cylinderBetween(base, base.clone().add(V(s * 0.05, 0.1, Math.sin(a) * 0.04)), 0.018, 0.005, 4, ac));
      }
      // small brow palm
      const fp = b1.clone().add(V(s * 0.06, 0.04, 0.14));
      p.push(ellipsoid(fp.x, fp.y, fp.z, 0.1, 0.03, 0.08, ac, 8, 5));
    } else if (m.antlers === 'bovid') {
      const hcol = 0x1a1612;
      const b0 = hc.clone().add(V(s * m.headW * 0.46, m.headH * 0.32, -m.headLen * 0.12));
      const b1 = b0.clone().add(V(s * 0.11 * scale, 0.02, 0));
      const b2 = b1.clone().add(V(s * 0.04 * scale, 0.11 * scale, 0.03));
      p.push(cylinderBetween(b0, b1, 0.045 * scale, 0.032 * scale, 6, hcol));
      p.push(cylinderBetween(b1, b2, 0.032 * scale, 0.006, 6, hcol));
    } else if (m.antlers === 'curl') {
      // bighorn: thick horns spiralling back, down and forward around the ear
      const hcol = 0x9a8866;
      const R0 = 0.13 * scale;
      const start = top.clone().add(V(s * m.headW * 0.25, 0, 0.03));
      const turns = scale >= 1 ? 1.65 : 0.55;
      const N = scale >= 1 ? 14 : 6;
      let prev = start;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const a = t * turns * Math.PI;
        const R = R0 * (1 - 0.25 * t);
        const pt = start.clone().add(V(s * (0.02 + 0.09 * t) * scale, R * Math.cos(a) - R0, -R * Math.sin(a) - 0.02));
        p.push(cylinderBetween(prev, pt, (0.05 - 0.032 * (t - 1 / N)) * scale, (0.05 - 0.032 * t) * scale, 6, hcol));
        prev = pt;
      }
    } else if (m.antlers === 'prong') {
      const hcol = 0x161210;
      const b0 = top.clone().add(V(s * m.headW * 0.22, 0, 0.02));
      const b1 = b0.clone().add(V(s * 0.015, 0.12, -0.01));
      const b2 = b1.clone().add(V(-s * 0.02, 0.1, -0.04));
      p.push(cylinderBetween(b0, b1, 0.022, 0.016, 5, hcol));
      p.push(cylinderBetween(b1, b2, 0.016, 0.004, 5, hcol));
      p.push(cylinderBetween(b1.clone().add(V(0, -0.02, 0)), b1.clone().add(V(0, 0.01, 0.05)), 0.012, 0.003, 4, hcol)); // forward prong
    }
  }
}

function buildLeg(m, d, hind) {
  const c = m.colors, r = m.legR, p = [];
  const J = hind ? d.hind : d.front;
  const upper = c.coat, lower = c.legs;
  if (m.hopper) {
    if (hind) {
      p.push(ellipsoid(0, -d.legLen * 0.3, -0.01, r * 2.5, d.legLen * 0.45, r * 3.5, upper, 8, 6));
      p.push(ellipsoid(0, -d.legLen + r * 0.7, 0.03, r * 1.5, r * 0.8, d.legLen * 0.75, lower, 8, 6));
    } else {
      p.push(cylinderBetween(V(0, 0, 0), V(0, -d.legLen, 0.01), r * 1.4, r, 5, lower));
      p.push(ellipsoid(0, -d.legLen + r * 0.6, 0.012, r * 1.1, r * 0.7, r * 1.6, lower, 6, 5));
    }
    return mergeColored(p);
  }
  const radii = hind ? [r * 2.8, r * 1.7, r * 1.25, r * 0.85, r * 0.8] : [r * 2.3, r * 1.5, r * 1.1, r * 0.85, r * 0.8];
  for (let i = 0; i < 4; i++) {
    const col = i < 1 ? upper : (i < 2 && !(m.foot === 'paw' && c.legs !== c.coat && m.colors.legs === 0x2c201a)) ? upper : lower;
    p.push(cylinderBetween(J[i], J[i + 1], radii[i], radii[i + 1], 6, col));
  }
  // joint knobs
  p.push(ellipsoid(J[2].x, J[2].y, J[2].z, r * 1.2, r * 1.3, r * 1.2, lower, 6, 5));
  const g = J[4];
  if (m.foot === 'hoof') {
    p.push(cylinderBetween(V(g.x, g.y + r * 2.2, g.z), V(g.x, g.y, g.z + r * 0.3), r * 0.95, r * 1.15, 6, 0x1c1714));
    p.push(ellipsoid(g.x, g.y + r * 2.6, g.z - r * 0.9, r * 0.35, r * 0.35, r * 0.35, 0x1c1714, 4, 4)); // dewclaw
  } else if (m.plantigrade) {
    // walks on the whole sole: long, flat foot
    p.push(ellipsoid(g.x, g.y + r * 0.6, g.z + r * 1.3, r * 1.4, r * 0.65, r * 2.6, lower, 7, 5));
  } else {
    const k = m.bigPaws ? 1.7 : 1;
    p.push(ellipsoid(g.x, g.y + r * 0.7, g.z + r * 0.6, r * 1.25 * k, r * 0.75, r * 1.6 * k, lower, 7, 5));
  }
  return mergeColored(p);
}

function buildTail(m) {
  const c = m.colors, p = [];
  const tl = m.tailLen, tr = m.tailR;
  switch (m.tailType) {
    case 'deer':
      p.push(ellipsoid(0, -tl * 0.45, -0.02, tr * 1.3, tl * 0.5, tr * 0.55, c.tail, 8, 6, 0.25));
      p.push(ellipsoid(0, -tl * 0.45, 0.006, tr * 1.2, tl * 0.45, tr * 0.45, c.tailUnder, 8, 6, 0.25));
      break;
    case 'bushy': {
      const th = 0.75;
      const dir = V(0, -Math.sin(th), -Math.cos(th));
      const cen = dir.clone().multiplyScalar(tl * 0.5);
      p.push(ellipsoid(cen.x, cen.y, cen.z, tr, tr * 1.05, tl * 0.5, c.tail, 9, 7, -th));
      const tip = dir.clone().multiplyScalar(tl * 0.92);
      p.push(ellipsoid(tip.x, tip.y, tip.z, tr * 0.6, tr * 0.6, tl * 0.12, c.tailUnder, 7, 5, -th));
      break;
    }
    case 'long': {
      // cat tail: hangs down, curves back up at the tip
      const pts = [V(0, 0, 0), V(0, -tl * 0.35, -tl * 0.22), V(0, -tl * 0.62, -tl * 0.45), V(0, -tl * 0.7, -tl * 0.72), V(0, -tl * 0.58, -tl * 0.92)];
      for (let i = 0; i < pts.length - 1; i++) p.push(cylinderBetween(pts[i], pts[i + 1], tr * (1.1 - i * 0.08), tr * (1.02 - i * 0.08), 6, i === pts.length - 2 ? c.tailUnder : c.tail));
      break;
    }
    case 'ringed': {
      const th = 0.6;
      const dir = V(0, -Math.sin(th), -Math.cos(th));
      const n = 7;
      for (let i = 0; i < n; i++) {
        const cen = dir.clone().multiplyScalar(tl * (i + 0.5) / n);
        p.push(ellipsoid(cen.x, cen.y, cen.z, tr * (1 - i * 0.05), tr * (1 - i * 0.05), tl / n * 0.62, i % 2 ? c.tailUnder : c.tail, 8, 6, -th));
      }
      break;
    }
    case 'bob':
      p.push(ellipsoid(0, -tl * 0.3, -tl * 0.4, tr, tr, tl * 0.5, c.tail, 7, 5, -0.7));
      p.push(ellipsoid(0, -tl * 0.6, -tl * 0.78, tr * 0.8, tr * 0.8, tl * 0.2, c.tailUnder, 6, 5, -0.7));
      break;
    case 'thin':
      p.push(cylinderBetween(V(0, 0, 0), V(0, -tl, -0.04), tr * 1.5, tr, 4, c.tail));
      p.push(ellipsoid(0, -tl, -0.04, tr * 2.5, tr * 4, tr * 2.5, c.dorsal, 5, 4));
      break;
    case 'puff':
      p.push(ellipsoid(0, 0, -tr * 0.4, tr, tr, tr, c.tail, 7, 6));
      break;
    default:
      p.push(ellipsoid(0, -tl * 0.4, -0.02, tr * 1.6, tl * 0.5, tr, c.tail, 6, 5));
  }
  return mergeColored(p);
}

export function getSpeciesGeometry(speciesId, male) {
  const key = speciesId + (male ? ':m' : ':f');
  if (cache.has(key)) return cache.get(key);
  const sp = SPECIES[speciesId];
  const m = sp.model;
  const rng = mulberry32(speciesId.length * 97 + (male ? 13 : 7));
  const d = computeDims(m);
  const geo = {
    body: buildBody(m, d, rng),
    head: buildHead(m, d, male, rng),
    legF: buildLeg(m, d, false),
    legH: buildLeg(m, d, true),
    tail: buildTail(m),
    dims: d,
  };
  cache.set(key, geo);
  return geo;
}

// Create an animal rig. Returns references to the animated parts.
export function createAnimalRig(speciesId, male, material = animalMaterial) {
  const sp = SPECIES[speciesId];
  const m = sp.model;
  const g = getSpeciesGeometry(speciesId, male);
  const d = g.dims;
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const body = new THREE.Mesh(g.body, material);
  bodyPivot.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.copy(d.neckBase);
  const head = new THREE.Mesh(g.head, material);
  headPivot.add(head);
  bodyPivot.add(headPivot);

  const legs = [];
  const legPos = [[d.legX, d.frontZ, false], [-d.legX, d.frontZ, false], [d.legX, d.hindZ, true], [-d.legX, d.hindZ, true]];
  for (const [x, z, hind] of legPos) {
    const leg = new THREE.Mesh(hind ? g.legH : g.legF, material);
    leg.position.set(x, d.legTopY, z);
    bodyPivot.add(leg);
    legs.push(leg);
  }
  const tailPivot = new THREE.Group();
  tailPivot.position.copy(d.tailBase);
  const tail = new THREE.Mesh(g.tail, material);
  tailPivot.add(tail);
  bodyPivot.add(tailPivot);

  const meshes = [body, head, tail, ...legs];
  for (const me of meshes) { me.castShadow = true; me.receiveShadow = false; }
  return { root, bodyPivot, body, headPivot, head, legs, tailPivot, tail, meshes, dims: d, model: m };
}
