// Leafy foliage for the detailed (near) trees and bushes: hundreds of small alpha-tested cards
// with procedurally drawn leaf and needle textures, scattered over the crown clumps and hung
// from the pine layers. Their normals point out from each clump, so the crowns shade softly
// like a mass of leaves rather than a pile of flat cards.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- textures ----------
function leafTexture() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d'), r = rng(7);
  for (let i = 0; i < 70; i++) {
    const x = 26 + r() * (S - 52), y = 26 + r() * (S - 52), a = r() * Math.PI * 2, L = 32 + r() * 20, W = L * (0.45 + r() * 0.14);
    const v = Math.round(150 + r() * 105);
    c.save(); c.translate(x, y); c.rotate(a);
    c.beginPath(); c.moveTo(-L / 2, 0);
    c.quadraticCurveTo(-L * 0.1, -W, L / 2, 0); c.quadraticCurveTo(-L * 0.1, W, -L / 2, 0);
    c.fillStyle = `rgb(${v},${v},${v})`; c.fill();
    c.strokeStyle = `rgba(255,255,255,0.35)`; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(-L / 2, 0); c.lineTo(L / 2, 0); c.stroke(); // midrib
    c.strokeStyle = `rgb(${v * 0.7 | 0},${v * 0.7 | 0},${v * 0.7 | 0})`; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-L / 2, 0); c.lineTo(-L / 2 - 6, 0); c.stroke(); // stalk
    c.restore();
  }
  return finish(cv);
}

function needleTexture() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d'), r = rng(11);
  c.lineCap = 'round';
  // three overlapping sprigs: a twig with thick, close-set needles on both sides
  for (let k = 0; k < 3; k++) {
    const x0 = 55 + k * 72 + (r() - 0.5) * 12, len = 200 + r() * 40;
    for (let t = 0.02; t < 1; t += 0.018) {
      const px = x0 + Math.sin(t * 3 + k) * 6, py = 8 + t * len;
      for (const sd of [-1, 1]) {
        const v = Math.round(150 + r() * 105), nl = (30 - t * 12) * (0.8 + r() * 0.4);
        c.strokeStyle = `rgb(${v},${v},${v})`; c.lineWidth = 3.6;
        c.beginPath(); c.moveTo(px, py); c.lineTo(px + sd * nl, py + nl * 0.45 + (r() - 0.5) * 6); c.stroke();
      }
    }
    c.strokeStyle = 'rgb(110,100,85)'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(x0, 8); c.lineTo(x0 + Math.sin(3 + k) * 6, 8 + len); c.stroke();
  }
  return finish(cv);
}

function finish(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------- card geometry ----------
class Cards {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.idx = []; }
  // centre, two half-axes, lighting normal, colour
  quad(o, a, b, nrm, col, flip) {
    const i0 = this.p.length / 3;
    for (const [sa, sb, u, v] of [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]]) {
      this.p.push(o.x + a.x * sa + b.x * sb, o.y + a.y * sa + b.y * sb, o.z + a.z * sa + b.z * sb);
      this.n.push(nrm.x, nrm.y, nrm.z);
      this.c.push(col.r, col.g, col.b);
      this.uv.push(flip ? 1 - u : u, v);
    }
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const _v = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Leaf cards over a set of clumps [x, y, z, r]; sy squashes the clumps vertically
function crownCards(clumps, { seed, size, density, sy = 1, sxz = 1, dark, light }) {
  const K = new Cards(), r = rng(seed), d = _v(), n = _v(), t = _v(), b = _v(), o = _v(), nl = _v();
  const cd = new THREE.Color(dark), cl = new THREE.Color(light), col = new THREE.Color();
  for (const [x, y, z, rad] of clumps) {
    const count = Math.round(rad * rad * density);
    for (let i = 0; i < count; i++) {
      // a direction over the clump, fewer facing straight down
      d.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      if (d.lengthSq() > 1 || d.lengthSq() < 0.01) { i--; continue; }
      d.normalize();
      if (d.y < -0.6 && r() < 0.6) d.y *= -0.4;
      d.normalize();
      const k = 0.95 + r() * 0.32;
      o.set(x + d.x * rad * sxz * k, y + d.y * rad * sy * k, z + d.z * rad * sxz * k);
      n.set(d.x + (r() - 0.5) * 1.2, d.y + (r() - 0.5) * 1.2, d.z + (r() - 0.5) * 1.2).normalize();
      t.crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
      b.crossVectors(n, t).normalize();
      const s = size * (0.75 + r() * 0.5);
      t.multiplyScalar(s / 2); b.multiplyScalar(s / 2);
      nl.copy(d).addScaledVector(UP, 0.35).normalize();
      // lit from above and outside, darker underneath
      col.copy(cd).lerp(cl, Math.min(1, Math.max(0, (d.y * 0.5 + 0.5) * 0.8 + (r() - 0.5) * 0.3)));
      col.multiplyScalar(0.85 + r() * 0.3);
      K.quad(o, t, b, nl, col, r() < 0.5);
    }
  }
  return K.geometry();
}

// Needle fringes hanging from the rims of the pine's branch layers, plus some on top of each layer
function pineCards() {
  const K = new Cards(), r = rng(31), o = _v(), a = _v(), b = _v(), nl = _v(), col = new THREE.Color();
  const layers = 7;
  for (let i = 0; i < layers; i++) {
    const tt = i / (layers - 1);
    const R = 2.05 - tt * 1.6, h = 1.9 - tt * 0.85, y0 = 1.7 + i * 0.95;
    const dark = new THREE.Color([0x1b3a20, 0x1f4024, 0x234628, 0x274c2b, 0x2a512e, 0x2e5732, 0x325c35][i]);
    const n = Math.round(10 + R * 7);
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + i * 0.55 + r() * 0.3;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // fringe card: spans the tangent, hangs out and down from the rim
      const rr = R * (0.86 + r() * 0.12);
      o.set(ca * rr, y0 + 0.02, sa * rr);
      a.set(-sa, 0, ca).multiplyScalar(0.36 + R * 0.12);
      b.set(ca * 0.75, -0.5, sa * 0.75).normalize().multiplyScalar(0.26 + r() * 0.1);
      nl.set(ca, 0.6, sa).normalize();
      col.copy(dark).lerp(new THREE.Color(0x6a8a44), 0.5 + r() * 0.25);
      K.quad(o.clone().add(b), a, b, nl, col, r() < 0.5);
      // a card lying along the upper slope of the layer
      if (k % 2 === 0) {
        const rm = R * (0.45 + r() * 0.3);
        o.set(ca * rm, y0 + h * (1 - rm / R) * 0.9 + 0.05, sa * rm);
        a.set(-sa, 0, ca).multiplyScalar(0.4);
        b.set(ca, -h / R * 0.9, sa).normalize().multiplyScalar(0.45);
        nl.set(ca * 0.5, 1, sa * 0.5).normalize();
        col.copy(dark).lerp(new THREE.Color(0x6a8a44), 0.4 + r() * 0.25);
        K.quad(o, a, b, nl, col, r() < 0.5);
      }
    }
  }
  return K.geometry();
}

export function buildFoliage() {
  const leafTex = leafTexture(), needleTex = needleTexture();
  const geos = {
    broad: crownCards([[0, 5.1, 0, 1.55], [1.15, 4.6, 0.6, 1.2], [-1.0, 4.8, -0.5, 1.25], [0.2, 5.9, -0.4, 1.15], [-0.35, 4.4, 1.0, 1.1], [0.9, 5.5, -0.7, 1.0], [-1.0, 5.6, 0.5, 1.0], [0.4, 4.2, -1.0, 0.95], [0.0, 6.4, 0.3, 0.85]],
      { seed: 3, size: 1.05, density: 22, sy: 0.82, dark: 0x22381a, light: 0x8aa452 }),
    birch: crownCards([[0.25, 6.3, 0, 1.2], [0.85, 5.4, 0.3, 0.95], [-0.35, 5.6, -0.35, 0.95], [0.4, 4.7, 0.55, 0.8], [-0.2, 4.9, 0.4, 0.75], [0.7, 6.0, -0.5, 0.8], [0.15, 7.0, 0.1, 0.65]],
      { seed: 5, size: 0.85, density: 26, sy: 1.2, sxz: 0.88, dark: 0x3a5420, light: 0xc0c870 }),
    bush: crownCards([[0, 0.5, 0, 0.62], [0.5, 0.38, 0.22, 0.46], [-0.45, 0.4, -0.18, 0.5], [0.08, 0.42, -0.5, 0.44], [-0.2, 0.3, 0.45, 0.4], [0.42, 0.3, -0.35, 0.36], [-0.05, 0.75, 0.1, 0.38]],
      { seed: 9, size: 0.5, density: 50, sy: 0.85, dark: 0x1e3a16, light: 0x7a9a48 }),
    pine: pineCards(),
  };
  const mat = (map) => new THREE.MeshLambertMaterial({ vertexColors: true, map, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide });
  return { geos, leafMat: mat(leafTex), needleMat: mat(needleTex) };
}
