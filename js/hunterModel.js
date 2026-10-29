// The hunter character model (models/hunter.glb) with motion-captured idle, walk, run and
// crouch-walk clips (models/hunter-anims.json, retargeted from Mixamo onto the model's rig).
// On top of the clips: the head and chest follow the player's aim, both hands reach for the
// weapon's grips (two-bone IK), and lying down stretches the body out flat. The jacket, trousers,
// cap and skin are tinted to the player's Customize choices. Same interface as Avatar, which
// stays as the fallback until (or if) the model loads.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { POSE, SHOULDER_Y, tieredGeometry, muzzleFlash, lookColor, vcMat, Avatar } from './avatar.js';

const SCALE = 1.08; // the model is 1.70 m; this matches the hunters' eye height
let tpl = null, clips = null, baseMat = null, loading = null;

export const hunterReady = () => !!tpl;

export function loadHunter() {
  if (loading) return loading;
  loading = Promise.all([
    new GLTFLoader().loadAsync(new URL('../models/hunter.glb', import.meta.url).href),
    fetch(new URL('../models/hunter-anims.json', import.meta.url)).then((r) => r.json()),
  ]).then(([g, a]) => {
    const hip = new THREE.Vector3().fromArray(a.hipRest);
    clips = {};
    for (const k in a.clips) clips[k] = toClip(a.clips[k], hip);
    g.scene.traverse((o) => { if (o.isSkinnedMesh) baseMat = o.material; });
    tpl = g.scene;
  }).catch((e) => { console.warn('Hunter model unavailable — using the built-in avatar.', e); });
  return loading;
}

function toClip(d, hipRest) {
  const tr = [];
  for (const k in d.tracks) tr.push(new THREE.QuaternionKeyframeTrack(k + '.quaternion', d.times, d.tracks[k]));
  const v = [];
  for (let i = 0; i < d.hip.length; i += 3) v.push(hipRest.x + d.hip[i], hipRest.y + d.hip[i + 1], hipRest.z + d.hip[i + 2]);
  tr.push(new THREE.VectorKeyframeTrack('Bone_000.position', d.times, v));
  return new THREE.AnimationClip(d.name, d.duration, tr);
}

// The model's own colours are a camo suit, fair skin and a camo cap. Regions are picked out by
// where each pixel sits on the body in the bind pose: cap (top of the head), jacket (torso and
// arms), trousers (legs, above the boots); skin by its colour (face, neck and hands).
const DEFAULT_SKIN = new THREE.Color(0xd8a882);
function hunterMaterial() {
  const m = new THREE.MeshLambertMaterial({ map: baseMat.map, normalMap: baseMat.normalMap, normalScale: baseMat.normalScale.clone() });
  const u = {
    uJacket: { value: new THREE.Color() }, uPants: { value: new THREE.Color() }, uHat: { value: new THREE.Color() },
    uSkin: { value: new THREE.Vector3(1, 1, 1) }, uAmt: { value: new THREE.Vector3() },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vBind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBind = position;');
    sh.fragmentShader = 'uniform vec3 uJacket, uPants, uHat, uSkin, uAmt;\nvarying vec3 vBind;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec3 c = diffuseColor.rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float skin = smoothstep(0.04, 0.1, c.r - c.g) * smoothstep(0.12, 0.22, c.r) * step(c.b, c.g);
    float y = vBind.y, ax = abs(vBind.x);
    float hat = smoothstep(1.555, 1.575, y);
    // the backpack (behind the shoulders) keeps its own colour
    float jacket = step(0.86, y) * (1.0 - smoothstep(1.38, 1.42, y)) * (1.0 - smoothstep(0.52, 0.56, ax)) * smoothstep(-0.2, -0.15, vBind.z);
    float pants = smoothstep(0.14, 0.18, y) * (1.0 - step(0.86, y));
    // keep the camo pattern: the new colour takes the original brightness
    float k = clamp(lum / 0.11, 0.3, 2.2);
    vec3 cloth = c;
    cloth = mix(cloth, uJacket * k * 0.55, jacket * uAmt.x * (1.0 - skin));
    cloth = mix(cloth, uPants * k * 0.5, pants * uAmt.y * (1.0 - skin));
    cloth = mix(cloth, uHat * k * 0.55, hat * uAmt.z * (1.0 - skin));
    diffuseColor.rgb = mix(cloth, c * uSkin, skin * (1.0 - hat));
  }`)
      .replace('#include <opaque_fragment>', `{
    float nv = abs(dot(normalize(normal), normalize(vViewPosition)));
    outgoingLight += outgoingLight * pow(1.0 - nv, 3.0) * 0.28;
  }
  #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'hunter-model';
  return m;
}

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3(), _T = new THREE.Vector3(), _P = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _sc = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

const _s0 = new THREE.Vector3(), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _sq = new THREE.Quaternion();
// rotate a bone (in world space) so the direction from its origin to `from` points at `to`
function swing(bone, from, to, amt = 1) {
  bone.getWorldPosition(_s0);
  const a = _s1.subVectors(from, _s0), b = _s2.subVectors(to, _s0);
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
  _q0.setFromUnitVectors(a.normalize(), b.normalize());
  if (amt < 1) _q0.slerp(_sq.identity(), 1 - amt);
  bone.getWorldQuaternion(_q1).premultiply(_q0);
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(_q1));
  bone.updateMatrixWorld(true);
}
// turn a bone about a world axis
function turn(bone, axis, angle) {
  if (!angle) return;
  _q0.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_q1).premultiply(_q0);
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(_q1));
  bone.updateMatrixWorld(true);
}

export class HunterAvatar {
  constructor(look) {
    this.isModel = true;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.model = SkeletonUtils.clone(tpl);
    this.model.scale.setScalar(SCALE);
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) { this.mesh = o; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.material = hunterMaterial(); }
    });
    const B = this.bones;
    this.rest = new Map(Object.values(B).map((b) => [b, b.quaternion.clone()]));
    // character's right is -x (it faces +z); weapons go in the right hand
    this.arms = [
      { side: -1, right: true, upper: B.Bone_022, fore: B.Bone_021, hand: B.Bone_020, finger: B.Bone_048 },
      { side: 1, right: false, upper: B.Bone_027, fore: B.Bone_026, hand: B.Bone_025, finger: B.Bone_064 },
    ];
    this.legBones = [B.Bone_010, B.Bone_009, B.Bone_008, B.Bone_015, B.Bone_014, B.Bone_013, B.Bone_001, B.Bone_004, B.Bone_002];
    this.mixer = new THREE.AnimationMixer(this.model);
    this.acts = {};
    for (const k in clips) {
      const a = this.mixer.clipAction(clips[k]);
      a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0);
      a.time = Math.random() * clips[k].duration;
      this.acts[k] = a;
    }
    this.wts = { idle: 1, walk: 0, run: 0, crouch: 0 };
    this.weapon = new THREE.Group();
    this.root.add(this.weapon);
    this.items = {}; this.item = null;
    this.aimAmt = 0; this.pitch = 0; this.draw = 0; this.flashT = 0; this.kick = 0; this.proneAmt = 0; this.deadAmt = 0;
    const strMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d0 });
    const strGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 4).translate(0, 0.5, 0);
    this.strA = new THREE.Mesh(strGeo, strMat); this.strB = new THREE.Mesh(strGeo, strMat);
    this.arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.72, 5).translate(0, 0.36, 0), new THREE.MeshLambertMaterial({ color: 0xcaa870 }));
    this.setLook(look);
    this.setItem('knife');
  }

  setLook(look) {
    this.look = { ...look };
    const u = this.mesh.material.userData.u;
    const lin = (hex) => new THREE.Color(hex); // Color() stores linear values, as the shader wants
    const camo = look.jacket === 'camo';
    u.uJacket.value.copy(lin(lookColor('jacket', look.jacket)));
    u.uPants.value.copy(lin(lookColor('pants', look.pants)));
    const hatHex = look.hatColor === 'match' ? lookColor('jacket', look.jacket) : lookColor('hatColor', look.hatColor);
    u.uHat.value.copy(lin(hatHex));
    // forest camo is the suit's own pattern; everything else is dyed over it
    u.uAmt.value.set(camo ? 0 : 0.78, look.pants === 'camo' ? 0 : 0.75, look.hatColor === 'match' && camo ? 0 : 0.8);
    const sk = lin(lookColor('skin', look.skin)), d = DEFAULT_SKIN;
    u.uSkin.value.set(sk.r / d.r, sk.g / d.g, sk.b / d.b);
  }

  setItem(id, tier = 0) {
    if (!POSE[id]) id = 'knife';
    if (this.item === id && this.itemTier === tier) return;
    this.item = id; this.itemTier = tier;
    for (const k in this.items) this.items[k].visible = false;
    if (id === 'none') return;
    if (!this.items[id]) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(tieredGeometry(id, tier), vcMat);
      mesh.castShadow = true;
      g.add(mesh); g.mesh = mesh;
      if (POSE[id].flash) { g.flash = muzzleFlash(POSE[id].flash, POSE[id].flashY, id === 'shotgun' ? 0.55 : 0.4); g.add(g.flash); }
      if (id === 'bow') g.add(this.strA, this.strB, this.arrow);
      this.weapon.add(g);
      this.items[id] = g;
    }
    this.items[id].mesh.geometry = tieredGeometry(id, tier);
    this.items[id].visible = true;
  }

  fire() { this.flashT = 0.06; this.kick = 1; }

  // state: { pitch, aim, draw, item, tier, moving, sprint, crouch, prone, dead, swimming }
  update(dt, s) {
    dt = Math.min(dt, 0.1);
    this.setItem(s.item, s.tier || 0);
    const k = (r) => Math.min(1, dt * r);
    this.pitch += (s.pitch - this.pitch) * k(14);
    this.aimAmt += ((s.aim || 0) - this.aimAmt) * k(10);
    this.draw += ((s.draw || 0) - this.draw) * k(12);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.proneAmt += ((s.prone && !s.dead && !s.swimming ? 1 : 0) - this.proneAmt) * k(5);
    this.deadAmt += ((s.dead ? 1 : 0) - this.deadAmt) * k(6);
    const pr = this.proneAmt;

    // ---- motion clips ----
    const st = s.dead || s.swimming || pr > 0.5 ? 'idle' : s.crouch ? 'crouch' : s.moving ? (s.sprint ? 'run' : 'walk') : 'idle';
    for (const n in this.acts) {
      this.wts[n] += ((n === st ? 1 : 0) - this.wts[n]) * k(8);
      this.acts[n].setEffectiveWeight(this.wts[n]);
    }
    this.acts.crouch.timeScale = s.moving ? 1 : 0; // a still crouch holds the pose
    this.mixer.update(dt);

    const R = this.root;
    R.rotation.x = pr * Math.PI / 2;
    R.rotation.z = this.deadAmt * 1.45;
    R.updateWorldMatrix(true, true);
    const B = this.bones;
    // lying down: legs and back straighten out
    if (pr > 0.001) for (const b of this.legBones) b.quaternion.slerp(this.rest.get(b), pr);
    if (pr > 0.001) this.model.updateMatrixWorld(true);

    // ---- head and chest follow the view ----
    const right = _v3.set(1, 0, 0).transformDirection(R.matrixWorld);
    turn(B.Bone_002, right, -this.pitch * 0.45);
    // cheek down onto the stock when aiming a long gun
    const cheek = this.item === 'rifle' || this.item === 'shotgun' ? this.aimAmt * 0.32 : 0;
    turn(B.Bone_017, right, -this.pitch * 0.55 - pr * 1.2 + cheek);

    // ---- weapon: carry pose blended with the aim pose, then mirrored into the right hand ----
    const P = POSE[this.item], a = Math.max(this.aimAmt, pr);
    this.weapon.visible = !s.swimming && !s.dead && this.item !== 'none';
    _m1.compose(_p1.set(0, SHOULDER_Y, 0), _q1.setFromEuler(_e.set(-this.pitch - pr * Math.PI / 2, 0, 0)), _sc);
    _m2.compose(_p2.fromArray(P.aim[0]), _q2.setFromEuler(_e.set(P.aim[1][0] + this.kick * 0.12, P.aim[1][1], P.aim[1][2])), _sc);
    _m3.multiplyMatrices(_m1, _m2);
    const aimPos = new THREE.Vector3(), aimQ = new THREE.Quaternion();
    _m3.decompose(aimPos, aimQ, _p2);
    if (pr > 0) aimPos.z += (Math.min(aimPos.z, 0.05) - aimPos.z) * pr;
    const lowPos = _p1.set(P.low[0][0], P.low[0][1] + SHOULDER_Y, P.low[0][2]);
    const lowQ = _q1.setFromEuler(_e.set(P.low[1][0], P.low[1][1], P.low[1][2]));
    const W = this.weapon;
    W.position.lerpVectors(lowPos, aimPos, a);
    W.position.z -= this.kick * 0.04;
    W.quaternion.slerpQuaternions(lowQ, aimQ, a);
    W.position.x = -W.position.x;
    W.quaternion.set(W.quaternion.x, -W.quaternion.y, -W.quaternion.z, W.quaternion.w);
    W.updateMatrix();
    W.updateMatrixWorld(true);
    if (this.item === 'bow') {
      const pull = Math.max(this.draw, 0);
      const nock = _p2.set(0, 0, -0.04 - pull * 0.42);
      setSeg(this.strA, _v0.set(0, 0.5, 0.03), nock);
      setSeg(this.strB, _v0.set(0, -0.5, 0.03), nock);
      this.arrow.visible = pull > 0.05;
      this.arrow.position.copy(nock);
      this.arrow.quaternion.setFromUnitVectors(UP, _v0.set(0, 0, 1));
    }
    const fl = this.items[this.item] && this.items[this.item].flash;
    if (fl) { fl.visible = this.flashT > 0; this.flashT -= dt; }

    // ---- hands reach for the grips ----
    if (!this.weapon.visible) return;
    for (const arm of this.arms) {
      let grip = arm.right ? P.R : P.L, w = 1;
      if (arm.right && grip === 'string') { grip = [0, 0, -0.04 - this.draw * 0.42]; w = Math.max(a, this.draw); }
      if (!arm.right && P.lAimOnly) w = a;
      if (P.handsAimOnly) w = a;
      if (!grip || w < 0.01) continue;
      _T.set(-grip[0], grip[1], grip[2]).applyMatrix4(W.matrixWorld);
      // elbows out and down
      _P.set(arm.side * 0.55, SHOULDER_Y - 0.6, -0.2).applyMatrix4(R.matrixWorld);
      this.reach(arm, _T, _P, w);
      // fingers wrap the grip: point them along the item, tipped down
      const fd = _v0.set(0, arm.right ? -0.75 : -0.45, arm.right ? 0.65 : 0.9).transformDirection(W.matrixWorld);
      arm.hand.getWorldPosition(_W);
      arm.finger.getWorldPosition(_E);
      swing(arm.hand, _E, _v1.copy(_W).addScaledVector(fd, _E.distanceTo(_W)), w);
    }
  }

  // two-bone IK: shoulder → elbow → wrist onto target T, elbow bending toward the pole
  reach(arm, T, pole, w) {
    const qu = arm.upper.quaternion.clone(), qf = arm.fore.quaternion.clone();
    arm.upper.getWorldPosition(_S); arm.fore.getWorldPosition(_E); arm.hand.getWorldPosition(_W);
    const la = _S.distanceTo(_E), lb = _E.distanceTo(_W);
    const dir = _v2.subVectors(T, _S);
    const d = Math.min(Math.max(dir.length(), Math.abs(la - lb) + 1e-3), la + lb - 1e-3);
    dir.normalize();
    const cosA = Math.min(1, Math.max(-1, (la * la + d * d - lb * lb) / (2 * la * d)));
    const perp = _v3.subVectors(pole, _S);
    perp.addScaledVector(dir, -perp.dot(dir)).normalize();
    const E2 = new THREE.Vector3().copy(_S).addScaledVector(dir, la * cosA).addScaledVector(perp, la * Math.sqrt(1 - cosA * cosA));
    const goal = new THREE.Vector3().copy(_S).addScaledVector(dir, d);
    swing(arm.upper, _E.clone(), E2);
    arm.hand.getWorldPosition(_W);
    swing(arm.fore, _W.clone(), goal);
    if (w < 1) {
      arm.upper.quaternion.copy(qu.slerp(arm.upper.quaternion, w));
      arm.fore.quaternion.copy(qf.slerp(arm.fore.quaternion, w));
      arm.upper.updateMatrixWorld(true);
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.mesh.material.dispose();
  }
}

function setSeg(mesh, a, b) {
  const v = _v1.subVectors(b, a);
  const len = v.length() || 0.001;
  mesh.position.copy(a);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, v.divideScalar(len));
}

// The model when it's loaded, otherwise the built-in avatar
export function makeAvatar(look) { return tpl ? new HunterAvatar(look) : new Avatar(look); }
