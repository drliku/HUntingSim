// Footprints and other animal sign, rendered as instanced decals in ring buffers.
import * as THREE from 'three';
import { G } from './state.js';
import { SPECIES } from './species.js';
import { compassName } from './utils.js';

const CAPACITY = {
  deer: 1100, elk: 1000, boar: 500, rabbit: 400, fox: 500, wolf: 500,
  feline: 250, bear: 250, raccoon: 250, badger: 200, bird3: 400, webbed: 250, bed: 50, root: 80,
};
const EXAGGERATE = 2.6; // prints drawn larger than life for readability
const LIFE = 480;       // real seconds before a print fully fades (rain speeds this up)

const VS = `
attribute float aFade; attribute float aHi;
varying vec2 vUv; varying float vFade; varying float vHi; varying float vDist;
void main(){
  vUv = uv; vFade = aFade; vHi = aHi;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D map; uniform vec3 uColor; uniform vec3 uHi; uniform float uMode; uniform float uTime; uniform float uLight; uniform float uRange;
varying vec2 vUv; varying float vFade; varying float vHi; varying float vDist;
void main(){
  vec4 t = texture2D(map, vUv);
  float a = t.a * vFade;
  vec3 col = uColor * uLight;
  if (vHi > 0.5) {
    col = mix(col, uHi, 0.6 + 0.25 * sin(uTime * 4.0));
    a = max(a, t.a * 0.9);
  } else if (uMode > 0.5) {
    col = mix(col, uHi * 0.85, 0.35);
    a = min(1.0, a * 1.4);
  }
  a *= smoothstep(uRange, uRange * 0.6, vDist);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}`;

function canvasTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 5;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function hoofHalf(ctx, cx, cy, w, h, side, round) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.bezierCurveTo(cx + side * w * (round ? 1.1 : 0.9), cy - h * (round ? 0.35 : 0.2), cx + side * w * 1.05, cy + h * 0.45, cx + side * w * 0.4, cy + h / 2);
  ctx.bezierCurveTo(cx + side * w * 0.05, cy + h * 0.5, cx + side * w * 0.05, cy + h * 0.1, cx, cy - h / 2);
  ctx.fill();
}

const TEXTURES = {
  deer: () => canvasTex((ctx) => { hoofHalf(ctx, 60, 64, 22, 92, -1, false); hoofHalf(ctx, 68, 64, 22, 92, 1, false); }),
  elk: () => canvasTex((ctx) => { hoofHalf(ctx, 59, 66, 28, 90, -1, true); hoofHalf(ctx, 69, 66, 28, 90, 1, true); }),
  boar: () => canvasTex((ctx) => {
    hoofHalf(ctx, 58, 56, 22, 70, -1, true); hoofHalf(ctx, 70, 56, 22, 70, 1, true);
    ctx.beginPath(); ctx.ellipse(28, 104, 8, 11, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(100, 104, 8, 11, -0.3, 0, Math.PI * 2); ctx.fill();
  }),
  fox: () => canvasTex((ctx) => {
    const toes = [[48, 34], [80, 34], [30, 62], [98, 62]];
    toes.forEach(([x, y], i) => { ctx.beginPath(); ctx.ellipse(x, y, 11, 15, i < 2 ? 0 : (i === 2 ? -0.4 : 0.4), 0, Math.PI * 2); ctx.fill(); });
    [[48, 14], [80, 14]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); });
    ctx.beginPath(); ctx.moveTo(64, 70); ctx.lineTo(88, 98); ctx.quadraticCurveTo(64, 112, 40, 98); ctx.closePath(); ctx.fill();
  }),
  wolf: () => canvasTex((ctx) => {
    const toes = [[50, 28], [78, 28], [28, 56], [100, 56]];
    toes.forEach(([x, y], i) => { ctx.beginPath(); ctx.ellipse(x, y, 13, 17, i < 2 ? 0 : (i === 2 ? -0.35 : 0.35), 0, Math.PI * 2); ctx.fill(); });
    [[50, 6], [78, 6], [22, 34], [106, 34]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.beginPath(); ctx.moveTo(64, 66); ctx.bezierCurveTo(98, 70, 100, 110, 80, 114); ctx.lineTo(64, 106); ctx.lineTo(48, 114); ctx.bezierCurveTo(28, 110, 30, 70, 64, 66); ctx.fill();
  }),
  rabbit: () => canvasTex((ctx) => {
    ctx.beginPath(); ctx.ellipse(44, 34, 10, 26, -0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(84, 34, 10, 26, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(64, 80, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(62, 108, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
  }),
  bed: () => canvasTex((ctx) => {
    ctx.shadowBlur = 0;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.7, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r = 10 + Math.random() * 40; ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); ctx.lineTo(64 + Math.cos(a + 0.3) * (r + 14), 64 + Math.sin(a + 0.3) * (r + 14)); ctx.stroke(); }
  }),
  feline: () => canvasTex((ctx) => {
    // four teardrop toes, no claws, broad heel pad with three lobes at the back
    [[40, 34, -0.25], [58, 24, -0.08], [78, 26, 0.1], [94, 40, 0.3]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.ellipse(x, y, 10, 13, r, 0, Math.PI * 2); ctx.fill(); });
    ctx.beginPath();
    ctx.moveTo(40, 72); ctx.quadraticCurveTo(66, 50, 92, 72);
    ctx.quadraticCurveTo(100, 100, 88, 108); ctx.quadraticCurveTo(80, 100, 72, 110);
    ctx.quadraticCurveTo(66, 102, 60, 110); ctx.quadraticCurveTo(52, 100, 44, 108);
    ctx.quadraticCurveTo(30, 100, 40, 72); ctx.fill();
  }),
  bear: () => canvasTex((ctx) => {
    // broad sole pad with five toes and short claw marks
    ctx.beginPath(); ctx.ellipse(64, 80, 40, 30, 0, 0, Math.PI * 2); ctx.fill();
    [[26, 40], [44, 28], [64, 24], [84, 28], [102, 40]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.ellipse(x, y, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 16, 3, 0, Math.PI * 2); ctx.fill();
    });
  }),
  raccoon: () => canvasTex((ctx) => {
    // hand-like: palm and five long, separate fingers
    ctx.beginPath(); ctx.ellipse(64, 84, 26, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'round'; ctx.lineWidth = 9;
    [[30, 70, 14, 46], [44, 62, 36, 26], [64, 60, 64, 18], [84, 62, 92, 26], [98, 70, 114, 46]].forEach(([x0, y0, x1, y1]) => {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    });
  }),
  badger: () => canvasTex((ctx) => {
    // wide pad, five toes and long claw marks, slightly toed-in
    ctx.beginPath(); ctx.ellipse(66, 86, 34, 18, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'round';
    [[32, 62], [48, 54], [64, 52], [80, 54], [96, 60]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.ellipse(x, y, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x - 3, y - 34); ctx.stroke();
    });
  }),
  bird3: () => canvasTex((ctx) => {
    // three slender forward toes and a short rear toe
    ctx.lineCap = 'round'; ctx.lineWidth = 8;
    [[64, 12], [30, 30], [98, 30]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(64, 80); ctx.lineTo(x, y); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(64, 80); ctx.lineTo(64, 112); ctx.stroke();
  }),
  webbed: () => canvasTex((ctx) => {
    // three toes joined by webbing
    ctx.beginPath(); ctx.moveTo(64, 96); ctx.lineTo(18, 30); ctx.quadraticCurveTo(40, 40, 64, 14); ctx.quadraticCurveTo(88, 40, 110, 30); ctx.closePath();
    ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineCap = 'round'; ctx.lineWidth = 7;
    [[18, 30], [64, 14], [110, 30]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(64, 96); ctx.lineTo(x, y); ctx.stroke(); });
  }),
  root: () => canvasTex((ctx) => {
    ctx.shadowBlur = 8;
    for (let i = 0; i < 16; i++) { ctx.globalAlpha = 0.5 + Math.random() * 0.5; ctx.beginPath(); ctx.ellipse(30 + Math.random() * 68, 30 + Math.random() * 68, 6 + Math.random() * 16, 4 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2); ctx.fill(); }
  }),
};

const SIGN_COLOR = { bed: 0x2a2a14, root: 0x2b1c10 };

export class Tracks {
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.types = {};
    this.mode = false;
    this.followId = null;
    this.timer = 0;
    this.uniformsShared = { uTime: { value: 0 }, uMode: { value: 0 }, uLight: { value: 1 }, uRange: { value: 45 } };
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI);
    for (const type in CAPACITY) {
      const cap = CAPACITY[type];
      const g = geo.clone();
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      const hi = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      fade.setUsage(THREE.DynamicDrawUsage); hi.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aFade', fade);
      g.setAttribute('aHi', hi);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS,
        uniforms: {
          map: { value: TEXTURES[type]() },
          uColor: { value: new THREE.Color(SIGN_COLOR[type] || 0x150e07) },
          uHi: { value: new THREE.Color(0xffc46b) },
          uTime: this.uniformsShared.uTime, uMode: this.uniformsShared.uMode, uLight: this.uniformsShared.uLight,
          uRange: type === 'bed' || type === 'root' ? { value: 70 } : this.uniformsShared.uRange,
        },
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.InstancedMesh(g, mat, cap);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 2;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.types[type] = { mesh, cap, next: 0, used: 0, recs: new Array(cap), fade, hi };
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this._n = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  _add(type, x, z, heading, species, animalId, fast, sx, sz) {
    const T = this.types[type];
    const i = T.next;
    T.next = (T.next + 1) % T.cap;
    T.used = Math.min(T.cap, T.used + 1);
    T.mesh.count = T.used;
    const h = this.terrain.getHeight(x, z);
    this.terrain.getNormal(x, z, this._n);
    this._q.setFromUnitVectors(this._up, this._n);
    this._q2.setFromAxisAngle(this._up, heading);
    this._q.multiply(this._q2);
    this._m.compose(this._p.set(x, h + 0.025, z), this._q, this._s.set(sx, 1, sz));
    T.mesh.setMatrixAt(i, this._m);
    T.mesh.instanceMatrix.needsUpdate = true;
    T.recs[i] = { type, x, z, heading, species, animalId, fast, born: G.env.totalHours, age: 0 };
    T.fade.array[i] = 1; T.fade.needsUpdate = true;
    T.hi.array[i] = animalId === this.followId ? 1 : 0; T.hi.needsUpdate = true;
  }

  addPrint(type, x, z, heading, species, animalId, fast) {
    const s = SPECIES[species].behavior.printSize * (species === 'rabbit' ? 1.6 : EXAGGERATE) * (0.9 + Math.random() * 0.2);
    this._add(type, x, z, heading + (Math.random() - 0.5) * 0.15, species, animalId, fast, s, s);
  }

  addSign(type, x, z, heading, species, animalId, size) {
    if (type === 'bed') this._add('bed', x, z, heading, species, animalId, false, size * 0.6, size * 1.05);
    else this._add('root', x, z, Math.random() * 6.28, species, animalId, false, 0.9 * size, 0.9 * size);
  }

  setMode(on) { this.mode = on; this.uniformsShared.uMode.value = on ? 1 : 0; this.uniformsShared.uRange.value = on ? 70 : 45; }

  setFollow(animalId) {
    this.followId = animalId;
    for (const type in this.types) {
      const T = this.types[type];
      for (let i = 0; i < T.used; i++) T.hi.array[i] = T.recs[i] && T.recs[i].animalId === animalId ? 1 : 0;
      T.hi.needsUpdate = true;
    }
  }

  update(dt) {
    this.uniformsShared.uTime.value += dt;
    this.uniformsShared.uLight.value = 0.35 + G.env.daylight * 0.65;
    this.timer -= dt;
    if (this.timer > 0) return;
    const step = 1 - this.timer;
    this.timer = 1;
    const rate = 1 + G.env.w.rain * 3 + G.env.w.snow * 1.5;
    for (const type in this.types) {
      const T = this.types[type];
      const life = type === 'bed' || type === 'root' ? LIFE * 1.5 : LIFE;
      for (let i = 0; i < T.used; i++) {
        const r = T.recs[i];
        if (!r) continue;
        r.age += step * rate;
        T.fade.array[i] = Math.max(0, 1 - (r.age / life) ** 1.5);
      }
      T.fade.needsUpdate = true;
    }
  }

  // Nearest visible sign to a world point.
  findNear(x, z, radius) {
    let best = null, bd = radius;
    for (const type in this.types) {
      const T = this.types[type];
      const rr = type === 'bed' ? radius + 0.6 : radius;
      for (let i = 0; i < T.used; i++) {
        const r = T.recs[i];
        if (!r || T.fade.array[i] < 0.08) continue;
        const d = Math.hypot(r.x - x, r.z - z) - (rr - radius);
        if (d < bd) { bd = d; best = r; }
      }
    }
    return best;
  }

  describe(rec) {
    const sp = SPECIES[rec.species];
    const ageMin = Math.max(0, (G.env.totalHours - rec.born) * 60);
    let fresh;
    if (ageMin < 10) fresh = { label: 'Very fresh', note: 'Crisp edges, moist soil — the animal is probably close.', level: 4 };
    else if (ageMin < 45) fresh = { label: 'Fresh', note: 'Sharp outline, under an hour old.', level: 3 };
    else if (ageMin < 180) fresh = { label: 'A few hours old', note: 'Edges starting to soften.', level: 2 };
    else fresh = { label: 'Old', note: 'Weathered and crumbling.', level: 1 };
    const bearing = ((Math.atan2(Math.sin(rec.heading), -Math.cos(rec.heading)) * 180) / Math.PI + 360) % 360;
    let kind, gait;
    if (rec.type === 'bed') {
      kind = 'Bedding site';
      gait = `An oval of pressed vegetation where a ${sp.name.toLowerCase()} lay down to rest and ruminate.`;
    } else if (rec.type === 'root') {
      kind = 'Rooting';
      kind = rec.species === 'badger' ? 'Digging' : 'Rooting';
      gait = rec.species === 'badger'
        ? 'Fresh earth thrown out where a badger dug after a ground squirrel or gopher.'
        : 'Turned-over soil where a boar dug for roots, tubers and invertebrates with its snout.';
    } else {
      kind = 'Footprint';
      gait = rec.species === 'rabbit'
        ? (rec.fast ? 'Bounding — long gaps between hop groups.' : 'Hopping slowly while feeding.')
        : (rec.fast ? 'Running — widely spaced, deeper prints.' : 'Walking — even, regular spacing.');
    }
    return {
      species: sp, kind, gait, fresh, ageMin,
      bearing, dir: compassName(bearing),
      sizeCm: Math.round(sp.behavior.printSize * 100 * (rec.species === 'rabbit' ? 0.5 : 0.75)),
      tracksNote: sp.tracks,
    };
  }
}
