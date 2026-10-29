// Dropped bags and gifts. Anything a player puts down from their pack lies on the ground in a bag
// that anyone can pick up (E); with a teammate close by, it goes straight into their pack instead.
// Killed in PvP, everything you carried (apart from the money your killer takes) falls in a bag
// where you died. Bags are shared: every player sees the same ones, and they rot away after a while.
import * as THREE from 'three';
import { G } from './state.js';
import { colorize, mergeColored, xf, ellipsoid, cylinderBetween } from './geo.js';
import { WEAPONS } from './equipment.js';
import { RARITY } from './rarity.js';
import { MAX_WOOD, PORTION_KG } from './survival.js';
import { FORAGE } from './forage.js';

const LIFE = 900;            // seconds before a bag disappears
export const GIVE_RANGE = 6; // metres: closer than this, items go to a teammate's pack
const GUNS = ['rifle', 'shotgun', 'pistol', 'bow'];
const ITEM_NAMES = { beans: 'can of beans', bandage: 'bandage', medkit: 'first-aid kit', veg: 'garden vegetables' };

export const emptyContents = () => ({ raw: {}, cooked: {}, forage: {}, items: {}, wood: 0, money: 0, ammo: {}, guns: [] });

function addTo(store, k, n) { if (n > 0) store[k] = +(((store[k] || 0) + n).toFixed(2)); }
export function mergeContents(a, b) {
  for (const s of ['raw', 'cooked', 'forage', 'items', 'ammo']) for (const k in b[s] || {}) addTo(a[s], k, b[s][k]);
  a.wood += b.wood || 0; a.money += b.money || 0;
  a.guns.push(...(b.guns || []));
  return a;
}
export function isEmpty(c) {
  if (!c) return true;
  for (const s of ['raw', 'cooked', 'forage', 'items', 'ammo']) for (const k in c[s] || {}) if (c[s][k] > 0) return false;
  return !(c.wood > 0 || c.money > 0 || (c.guns && c.guns.length));
}

// "2 kg raw venison, Rare rifle, 10 .308 cartridges, $50"
export function describe(c, max = 4) {
  const out = [];
  for (const [g, t] of c.guns || []) out.push(`${t ? RARITY[t].name + ' ' : ''}${WEAPONS[g].short.toLowerCase()}`);
  for (const k in c.cooked) out.push(`${c.cooked[k]} kg cooked ${k.toLowerCase()}`);
  for (const k in c.raw) out.push(`${c.raw[k]} kg raw ${k.toLowerCase()}`);
  for (const k in c.ammo) out.push(`${c.ammo[k]} ${WEAPONS[k].ammo}`);
  for (const k in c.items) out.push(`${c.items[k]} × ${ITEM_NAMES[k] || k}`);
  for (const k in c.forage) out.push(`${c.forage[k]} × ${G.survival.label(k).toLowerCase()}`);
  if (c.wood) out.push(`${c.wood} firewood`);
  if (c.money) out.push(`$${c.money}`);
  return out.length > max ? out.slice(0, max).join(', ') + ` and ${out.length - max} more` : out.join(', ');
}

// ---------- the player's own pack ----------
// Take something out of the player's pack. kind: raw|cooked|forage|item|wood|money|ammo|gun;
// amount: a number or 'all'. Returns the contents taken (empty if there was nothing).
export function takeFromPack(kind, key, amount) {
  const S = G.survival, E = G.equipment, c = emptyContents();
  const all = amount === 'all';
  if (kind === 'raw' || kind === 'cooked') {
    const store = S[kind], have = store[key] || 0;
    const kg = all ? have : Math.min(have, PORTION_KG);
    if (kg <= 0) return c;
    store[key] = +(have - kg).toFixed(2); if (store[key] < 0.01) delete store[key];
    c[kind][key] = +kg.toFixed(2);
  } else if (kind === 'forage' || kind === 'item') {
    const store = kind === 'forage' ? S.forage : S.items, have = store[key] || 0;
    const n = all ? have : Math.min(have, 1);
    if (n <= 0) return c;
    store[key] = have - n; if (kind === 'forage' && !store[key]) delete store[key];
    c[kind === 'forage' ? 'forage' : 'items'][key] = n;
  } else if (kind === 'wood') {
    const n = all ? S.wood : Math.min(S.wood, 1);
    S.wood -= n; c.wood = n;
  } else if (kind === 'money') {
    const n = all ? S.money : Math.min(S.money, amount);
    S.money -= n; c.money = n;
  } else if (kind === 'ammo') {
    const am = E.ammo[key]; if (!am) return c;
    const n = all ? am.reserve : Math.min(am.reserve, amount);
    am.reserve -= n; if (n > 0) c.ammo[key] = n;
  } else if (kind === 'gun') {
    if (!E.owned[key] || !GUNS.includes(key)) return c;
    // the gun goes with whatever is loaded in it
    const am = E.ammo[key], loaded = am.mag + am.reserve;
    if (loaded > 0) c.ammo[key] = loaded;
    am.mag = 0; am.reserve = 0;
    c.guns.push([key, E.tier(key)]);
    E.owned[key] = false;
    E.setRarity(key, 0);
    if (E.item === key || E.nextItem === key) { E.item = 'knife'; E.nextItem = null; E.reloadT = 0; E.draw = 0; }
  }
  return c;
}

// Put contents into the player's pack. Returns what didn't fit (empty if everything did).
export function giveToPack(c) {
  const S = G.survival, E = G.equipment, left = emptyContents();
  for (const kind of ['cooked', 'raw']) for (const k in c[kind]) {
    const kg = Math.min(c[kind][k], Math.floor(S.space() / PORTION_KG + 1e-6) * PORTION_KG);
    if (kg > 0) S[kind][k] = +(((S[kind][k] || 0) + kg).toFixed(2));
    addTo(left[kind], k, +(c[kind][k] - kg).toFixed(2));
  }
  for (const k in c.forage) if (FORAGE[k]) S.forage[k] = (S.forage[k] || 0) + c.forage[k];
  for (const k in c.items) S.items[k] = (S.items[k] || 0) + c.items[k];
  const w = Math.min(c.wood || 0, MAX_WOOD - S.wood);
  S.wood += w; left.wood = (c.wood || 0) - w;
  S.money += c.money || 0;
  for (const k in c.ammo) if (E.ammo[k]) E.ammo[k].reserve += c.ammo[k];
  for (const [g, t] of c.guns || []) {
    if (!E.owned[g]) { E.owned[g] = true; E.setRarity(g, t); }
    else if (t > E.tier(g)) { left.guns.push([g, E.tier(g)]); E.setRarity(g, t); } // swap: the worse one stays behind
    else left.guns.push([g, t]);
  }
  return left;
}

// what the player carries, as contents (everything but money): for the bag left where they die
function wholePack() {
  const S = G.survival, E = G.equipment, c = emptyContents();
  for (const s of ['raw', 'cooked', 'forage']) for (const k in S[s]) if (S[s][k] > 0) c[s][k] = S[s][k];
  for (const k in S.items) if (S.items[k] > 0) c.items[k] = S.items[k];
  c.wood = S.wood;
  for (const g of GUNS) {
    const am = E.ammo[g], n = am ? am.mag + am.reserve : 0;
    if (n > 0) c.ammo[g] = n;
    if (E.owned[g]) c.guns.push([g, E.tier(g)]);
  }
  if (E.ammo.bait && E.ammo.bait.reserve > 0) c.ammo.bait = E.ammo.bait.reserve;
  return c;
}

// ---------- bags on the ground ----------
let bagGeo = null;
function bagGeometry() {
  if (bagGeo) return bagGeo;
  const p = [];
  p.push(ellipsoid(0, 0.15, 0, 0.32, 0.15, 0.19, 0x4e5234, 14, 10));                 // canvas duffel
  p.push(ellipsoid(0, 0.15, 0, 0.325, 0.03, 0.195, 0x3a3c26, 14, 4));               // seam
  for (const x of [-0.18, 0.18]) p.push(colorize(xf(new THREE.TorusGeometry(0.17, 0.012, 5, 14, Math.PI * 1.1), x, 0.12, 0, 0, Math.PI / 2, -0.1), 0x2e2a20)); // straps
  p.push(cylinderBetween(new THREE.Vector3(-0.1, 0.29, 0), new THREE.Vector3(0.1, 0.29, 0), 0.018, 0.018, 6, 0x2a2620)); // handle
  for (const s of [-1, 1]) p.push(ellipsoid(s * 0.31, 0.15, 0, 0.03, 0.11, 0.13, 0x3e4228, 8, 6));
  bagGeo = mergeColored(p);
  return bagGeo;
}
const bagMat = new THREE.MeshLambertMaterial({ vertexColors: true });

export class Drops {
  constructor(scene) {
    this.scene = scene;
    this.bags = new Map();
    this.n = 0;
  }

  get authority() { return !G.net || G.net.isHost; }
  list() { return [...this.bags.values()].map((b) => ({ id: b.id, x: b.x, z: b.z, c: b.c, o: b.owner, t: Math.round(b.t) })); }

  // create or replace a bag (from this game or from the network)
  set(id, x, z, c, owner, t = 0) {
    let b = this.bags.get(id);
    if (isEmpty(c)) { if (b) this.remove(id, false); return null; }
    if (!b) {
      const y = G.world.terrain.getHeight(x, z);
      const mesh = new THREE.Mesh(bagGeometry(), bagMat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = (x * 7.1 + z * 3.3) % 6.28;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      b = { id, x, z, mesh, t };
      this.bags.set(id, b);
    }
    b.c = c; b.owner = owner;
    return b;
  }

  remove(id, broadcast = true) {
    const b = this.bags.get(id);
    if (!b) return;
    this.scene.remove(b.mesh);
    this.bags.delete(id);
    if (broadcast) G.net?.send({ t: 'bag', a: 'del', id });
  }

  clear() { for (const id of [...this.bags.keys()]) this.remove(id, false); }

  nearest(x, z, r) {
    let best = null, bd = r;
    for (const b of this.bags.values()) { const d = Math.hypot(b.x - x, b.z - z); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  broadcast(b) { G.net?.send({ t: 'bag', a: 'set', id: b.id, x: Math.round(b.x * 100) / 100, z: Math.round(b.z * 100) / 100, c: b.c, o: b.owner }); }

  // put contents on the ground at the player's feet (adding to their own bag if one is right there)
  drop(c, owner = G.net ? G.net.name : 'Your') {
    if (isEmpty(c)) return null;
    const P = G.player;
    const mine = [...this.bags.values()].find((b) => b.mine && Math.hypot(b.x - P.pos.x, b.z - P.pos.z) < 2.5);
    let b;
    if (mine) { mergeContents(mine.c, c); b = mine; b.t = 0; }
    else {
      const x = P.pos.x - Math.sin(P.yaw) * 0.8, z = P.pos.z - Math.cos(P.yaw) * 0.8;
      b = this.set(`${G.net ? G.net.id : 0}-${++this.n}-${Math.floor(Math.random() * 1e6)}`, x, z, c, owner);
      b.mine = true;
    }
    this.broadcast(b);
    return b;
  }

  // pick up as much of a bag as fits
  pick(b) {
    const left = giveToPack(b.c);
    const got = describe(diff(b.c, left), 6);
    if (isEmpty(left)) this.remove(b.id);
    else { b.c = left; this.broadcast(b); }
    G.audio?.strike();
    if (got) G.ui.toast(`You take ${got}.${isEmpty(left) ? '' : ' Your pack is full — the rest stays in the bag.'}`, 'good');
    else G.ui.toast('Your pack is full.', 'warn');
  }

  // killed in PvP: everything you had falls where you died
  deathBag(name) {
    const c = wholePack();
    if (isEmpty(c)) return;
    const P = G.player;
    const b = this.set(`${G.net ? G.net.id : 0}-d${++this.n}-${Math.floor(Math.random() * 1e6)}`, P.pos.x, P.pos.z, c, name);
    if (b) this.broadcast(b);
  }

  update(dt) {
    for (const b of [...this.bags.values()]) {
      b.t += dt;
      if (b.t > LIFE && this.authority) this.remove(b.id);
    }
  }
}

// what was taken: before minus what's left
function diff(a, left) {
  const d = emptyContents();
  for (const s of ['raw', 'cooked', 'forage', 'items', 'ammo']) for (const k in a[s]) addTo(d[s], k, +((a[s][k] || 0) - ((left[s] && left[s][k]) || 0)).toFixed(2));
  d.wood = (a.wood || 0) - (left.wood || 0); d.money = (a.money || 0) - (left.money || 0);
  const rest = [...(left.guns || [])];
  for (const g of a.guns || []) { const i = rest.findIndex((r) => r[0] === g[0] && r[1] === g[1]); if (i >= 0) rest.splice(i, 1); else d.guns.push(g); }
  return d;
}
