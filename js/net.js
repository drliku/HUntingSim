// PvP survival networking.
// One player hosts: their game runs the wildlife, the clock and the weather and streams it to
// everyone. Every player sends their own position; a shot that hits another player is sent to
// the victim, whose game applies the damage. All players build the same world from a shared seed.
import * as THREE from 'three';
import { G } from './state.js';
import { DEFAULT_LOOK, sanitizeLook, lookColor, loadLook } from './avatar.js';
import { makeAvatar, hunterReady } from './hunterModel.js';
import { giveToPack, describe, isEmpty } from './drops.js';

// Replace Math.random with a seeded generator (so every player builds the same forest).
// Returns a function that puts the real Math.random back.
export function seedRandom(seed) {
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = real; };
}

// Damage a hit does to another player, by weapon and body part (shotgun: per pellet)
const DAMAGE = {
  rifle: { head: 150, body: 80, legs: 45 },
  pistol: { head: 90, body: 42, legs: 24 },
  arrow: { head: 110, body: 65, legs: 35 },
  shot: { head: 18, body: 11, legs: 7 },
  knife: { head: 40, body: 40, legs: 40 },
};
const WEAPON_NAME = { rifle: 'rifle', pistol: 'revolver', arrow: 'bow', shot: 'shotgun', knife: 'knife' };
const SPAWNS = [[-40, -54], [118, 46], [-75, 15], [135, 25], [-15, 150], [95, -150], [-150, -130], [140, 125], [30, 80], [-110, 90]];
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- other players ----------
function nameTag(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fillRect(0, 8, 8, 48);
  ctx.font = '600 30px Inter, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(name, 132, 43);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false }));
  sp.scale.set(1.3, 0.33, 1);
  sp.position.y = 2.15;
  return sp;
}

class RemotePlayer {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.look = { ...DEFAULT_LOOK };
    this.avatar = makeAvatar(this.look);
    this.root = this.avatar.root;
    this.setTag();
    this.pos = new THREE.Vector3(0, -50, 0);
    this.target = new THREE.Vector3(0, -50, 0);
    this.eye = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.aim = 0; this.draw = 0; this.crouch = false; this.prone = false; this.mate = false; this.mark = null; this.markTxt = ''; this.item = 'knife'; this.hp = 100;
    this.dead = false; this.moving = false; this.visibility = 0.5; this.noise = 0.2;
    this.inBed = false; this.inCabinSafe = false; this.swimming = false;
    this.kills = 0; this.deaths = 0; this.shotAt = 0; this.seen = false;
    G.scene.add(this.root);
  }

  // swap the built-in avatar for the hunter model once it has loaded
  rebuildAvatar() {
    G.scene.remove(this.root);
    this.root.remove(this.tag);
    this.avatar.dispose();
    this.avatar = makeAvatar(this.look);
    this.root = this.avatar.root;
    this.root.add(this.tag);
    G.scene.add(this.root);
  }

  setTag() {
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.tag = nameTag(this.mate ? '★ ' + this.name : this.name, this.mate ? 0x50e070 : lookColor('jacket', this.look.jacket));
    this.root.add(this.tag);
  }

  // teammates get a marker that shows through everything, anywhere on the map
  setMate(on) {
    this.mate = on;
    if (on && !this.mark) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
      this.mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false, transparent: true }));
      this.mark.renderOrder = 999;
      this.mark.scale.set(0.2, 0.075, 1);
      this.markTxt = '';
      G.scene.add(this.mark);
    }
    if (!on && this.mark) { G.scene.remove(this.mark); this.mark.material.map.dispose(); this.mark.material.dispose(); this.mark = null; }
    this.setTag();
  }

  drawMark(txt) {
    if (txt === this.markTxt) return;
    this.markTxt = txt;
    const cv = this.mark.material.map.image, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 256, 96);
    ctx.font = '700 26px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = '#7dff9a';
    ctx.strokeText(txt, 128, 30); ctx.fillText(txt, 128, 30);
    ctx.beginPath(); ctx.moveTo(110, 48); ctx.lineTo(146, 48); ctx.lineTo(128, 74); ctx.closePath();
    ctx.lineWidth = 4; ctx.stroke(); ctx.fill();
    this.mark.material.map.needsUpdate = true;
  }

  setLook(look) {
    this.look = sanitizeLook(look);
    this.avatar.setLook(this.look);
    this.setTag();
  }

  apply(m) {
    this.target.set(m.x, m.y, m.z);
    if (!this.seen) { this.pos.copy(this.target); this.seen = true; }
    this.yaw = m.yaw; this.pitch = m.p || 0; this.aim = m.a || 0; this.draw = m.d || 0; this.tier = m.r || 0;
    this.crouch = !!m.c; this.prone = !!m.pr; this.sprint = !!m.sp; this.vx = m.vx; this.vz = m.vz; this.air = !!m.air; this.hidden = !!m.hd; this.item = m.it; this.hp = m.hp;
    this.dead = !!m.dead; this.moving = !!m.mv; this.visibility = m.vis; this.noise = m.no;
    this.inBed = !!m.bed; this.inCabinSafe = !!m.safe; this.swimming = !!m.sw;
  }

  update(dt) {
    if (!this.avatar.isModel && hunterReady()) this.rebuildAvatar();
    this.pos.lerp(this.target, Math.min(1, dt * 12));
    this.eye.set(this.pos.x, this.pos.y + (this.prone ? 0.42 : this.crouch ? 1.15 : 1.6), this.pos.z);
    const r = this.root;
    r.visible = this.seen && !this.inBed; // the bed hides you under the covers
    r.position.copy(this.pos);
    if (this.swimming) r.position.y -= 1.15;
    if (this.dead && !this.avatar.isModel) r.position.y += 0.25; // the model falls onto its back by itself
    r.rotation.y = this.yaw + Math.PI;
    this.avatar.update(dt, { pitch: this.pitch, aim: this.aim, draw: this.draw, item: this.item, tier: this.tier, moving: this.moving, sprint: this.sprint, vx: this.vx, vz: this.vz, air: this.air, crouch: this.crouch, prone: this.prone, dead: this.dead, swimming: this.swimming });
    // lying down: the body stretches out behind the head instead of standing on the spot
    const pa = this.avatar.proneAmt;
    if (pa > 0.001) { r.position.x += Math.sin(this.yaw) * 1.5 * pa; r.position.z += Math.cos(this.yaw) * 1.5 * pa; r.position.y += 0.15 * pa; }
    // the tag lives in the body's frame: keep it floating above the head when lying down
    this.tag.position.set(0, 2.15 - 0.45 * pa, -0.75 * pa);
    const d = G.camera.position.distanceTo(this.pos);
    this.tag.visible = !this.dead && (d < 45 || (this.mate && d < 120));
    if (this.mark) {
      this.mark.visible = this.seen && d > 9;
      this.mark.position.set(this.pos.x, this.pos.y + (this.prone ? 0.9 : 2.5), this.pos.z);
      if (this.mark.visible) this.drawMark(`${this.name} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}${this.dead ? ' · down' : ''}`);
    }
  }

  remove() { if (this.mark) this.setMate(false); G.scene.remove(this.root); this.avatar.dispose(); }
}

// ---------- connection ----------
export class Net {
  constructor(opts) {
    this.code = opts.code;
    this.seed = opts.seed;
    this.name = opts.name || 'Hunter';
    this.wantHost = opts.role === 'host';
    this.isHost = false;
    this.id = 0;
    this.players = new Map();
    this.meT = 0; this.worldT = 0;
    this.spawnQ = []; this.despawnQ = [];
    this.kills = 0; this.deaths = 0;
    this.lastHit = null;
    this.connected = false;
    this.team = new Set(); this.teamAsk = new Map(); this.asked = new Map();
  }

  get list() { return [...this.players.values()]; }

  connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pvp/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: this.wantHost ? 'host' : 'join', code: this.code, seed: this.seed, name: this.name }));
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.handle(m); };
    ws.onclose = () => { if (!this.leaving) G.ui.pvpEnded(this.connected ? 'Lost the connection to the game server.' : 'Could not reach the game server.'); };
  }

  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  leave() { this.leaving = true; try { this.ws.close(); } catch { /* already closed */ } }

  // ---------- incoming ----------
  handle(m) {
    const ui = G.ui, A = G.animals, W = G.world;
    const from = this.players.get(m.from);
    switch (m.t) {
      case 'welcome':
        this.connected = true;
        this.id = m.id;
        this.hostId = m.host;
        this.isHost = m.host === m.id;
        { const c = this.myHouse(); if (c) G.player.teleport(c.x + c.dx, c.z + c.D / 2 + 2.2); }
        for (const p of m.players) if (p.id !== this.id) this.players.set(p.id, new RemotePlayer(p.id, p.name));
        if (this.isHost) G.crates.fill(); // PvP has more crates than solo play
        if (!this.isHost) { A.clearAll(); A.byNid.clear(); }
        this.sendLook();
        ui.toast(this.isHost
          ? `You are hosting PvP game ${this.code}. Friends join from the main menu with this code. Other hunters are dangerous — and so is the wildlife.`
          : `Joined PvP game ${this.code}. ${m.players.length - 1} other player${m.players.length === 2 ? '' : 's'} in the forest. Trust no one.`, 'info');
        break;
      case 'error': ui.pvpEnded(m.error); this.leave(); break;
      case 'host-left': this.leaving = true; ui.pvpEnded('The host left, so the game has ended.'); break;
      case 'peer-join':
        this.players.set(m.id, new RemotePlayer(m.id, m.name));
        ui.toast(`${m.name} entered the forest.`, 'info');
        if (this.isHost) this.sendSync(m.id);
        this.sendLook(m.id);
        break;
      case 'peer-left': {
        const p = this.players.get(m.id);
        if (p) { ui.toast(`${p.name} left the game.`, 'info'); p.remove(); this.players.delete(m.id); this.team.delete(m.id); this.teamAsk.delete(m.id); this.asked.delete(m.id); }
        break;
      }
      case 'me': if (from) from.apply(m); break;
      case 'look': if (from) from.setLook(m.look); break;
      case 'team': if (from) this.onTeam(m, from); break;
      case 'bag': if (m.a === 'set') G.drops.set(m.id, m.x, m.z, m.c, m.o); else G.drops.remove(m.id, false); break;
      case 'gift': this.onGift(m, from); break;
      case 'airdrop':
        if (m.a === 'add') G.airdrops.add(m.id, m.x, m.z, 0);
        else {
          G.airdrops.remove(m.id);
          if (m.a === 'opened') ui.toast(`${from && from.mate ? 'Your teammate ' : ''}${m.name} opened the supply drop.`, from && from.mate ? 'good' : 'info');
        }
        break;
      case 'sync': this.applySync(m); break;
      case 'world':
        if (this.isHost) break;
        G.env.time = m.time; G.env.day = m.day;
        if (m.wx && m.wx !== G.env.weatherName) G.env.setWeather(m.wx);
        A.netApply(m.a);
        break;
      case 'spawn': if (!this.isHost) A.netSpawn(m.list); break;
      case 'despawn': if (!this.isHost) A.netDespawn(m.n); break;
      case 'down': A.netDown(m); break;
      case 'spook': if (this.isHost) { const a = A.byNid.get(m.n); if (a && a.state !== 'down') { if (m.w) a.wounded = true; if (a.state === 'attack') a.endAttack(); else a.flee(m.x, m.z, true); } } break;
      case 'noise': if (this.isHost) A.soundEvent(m.x, m.z, m.r, m.k); break;
      case 'call': if (this.isHost) A.callEvent(m.x, m.z); break;
      case 'bait': W.placeBait(m.x, m.z); break;
      case 'tag': { const a = A.byNid.get(m.n); if (a) { if (m.meat) a.meatTaken = true; else { a.tagged = true; if (!a.fadeAt) a.fadeAt = a.stateT; } } break; }
      case 'door': { const d = W.doors[m.i]; if (d) W.setDoor(d, m.open); break; }
      case 'fire': { const f = W.fires[m.i]; if (f) { f.lit = m.lit; f.fuel = m.fuel; } break; }
      case 'pick': { const n = G.forage.nodes[m.i]; if (n && !n.picked) G.forage.pick(n); break; }
      case 'crate': if (m.on) G.crates.show(m.i, true); else { G.crates.show(m.i, false); if (this.isHost && G.crates.respawnT > 150) G.crates.respawnT = 150; } break;
      case 'upgrade': if (!G.cabin.has(m.id)) { G.cabin.build(m.id); ui.toast(`${from ? from.name : 'Someone'} built a cabin upgrade.`, 'info'); } break;
      case 'shot': {
        const p = { x: m.x, y: m.y, z: m.z };
        const d = G.camera.position.distanceTo(new THREE.Vector3(m.x, m.y, m.z));
        if (d < 70) { if (m.w === 'pistol') G.audio?.pistolShot?.(); else if (m.w === 'shotgun') G.audio?.shotgunShot?.(); else G.audio?.gunshot(); }
        else G.audio?.distantShot?.(p);
        if (from) { from.shotAt = performance.now(); from.avatar.fire(); }
        if (this.isHost) A.soundEvent(m.x, m.z, m.loud || 300, 'shot');
        G.birds?.soundEvent(m.x, m.z, m.loud || 300, 'shot');
        break;
      }
      case 'hitP': this.takeHit(m, from); break;
      case 'dmg': if (!G.survival.dead) { this.lastHit = null; G.survival.damage(m.amount, { x: m.x, z: m.z }, m.cause); } break;
      case 'warn': ui.toast(m.text, 'warn'); break;
      case 'killed': this.onKilled(m); break;
    }
  }

  // ---------- host: world streaming ----------
  spawnInfo(a) {
    return { n: a.nid, s: a.species, m: a.male ? 1 : 0, x: r2(a.pos.x), z: r2(a.pos.z), h: r2(a.heading), sc: Math.round(a.scale * 1000) / 1000, w: Math.round(a.weight * 10) / 10, ag: a.age, st: a.state };
  }

  sendSync(to) {
    const W = G.world;
    this.send({
      t: 'sync', to,
      animals: G.animals.list.filter((a) => a.state !== 'down').map((a) => this.spawnInfo(a)),
      doors: W.doors.map((d) => (d.open ? 1 : 0)),
      fires: W.fires.map((f) => [f.lit ? 1 : 0, r2(f.fuel)]),
      picked: G.forage.nodes.map((n, i) => (n.picked ? i : -1)).filter((i) => i >= 0),
      upgrades: Object.keys(G.cabin.built),
      crates: G.crates.activeList(),
      baits: W.baits.filter((b) => b.active).map((b) => [r2(b.x), r2(b.z)]),
      bags: G.drops.list(), airdrops: G.airdrops.list(),
      time: G.env.time, day: G.env.day, wx: G.env.weatherName,
    });
  }

  applySync(m) {
    const W = G.world;
    G.env.time = m.time; G.env.day = m.day;
    if (m.wx) G.env.setWeather(m.wx, true);
    G.animals.netSpawn(m.animals);
    m.doors.forEach((o, i) => { if (W.doors[i]) W.setDoor(W.doors[i], !!o); });
    m.fires.forEach(([lit, fuel], i) => { const f = W.fires[i]; if (f) { f.lit = !!lit; f.fuel = fuel; } });
    for (const i of m.picked) { const n = G.forage.nodes[i]; if (n && !n.picked) G.forage.pick(n); }
    for (const id of m.upgrades) G.cabin.build(id);
    G.crates.clear();
    for (const i of m.crates || []) G.crates.show(i, true);
    for (const [x, z] of m.baits || []) W.placeBait(x, z);
    G.drops.clear();
    for (const b of m.bags || []) G.drops.set(b.id, b.x, b.z, b.c, b.o, b.t);
    G.airdrops.clear();
    for (const d of m.airdrops || []) G.airdrops.add(d.id, d.x, d.z, d.t, false);
  }

  queueSpawn(list) { if (this.isHost) for (const a of list) this.spawnQ.push(a); }
  queueDespawn(nid) { if (this.isHost) this.despawnQ.push(nid); }

  // ---------- every frame ----------
  tick(dt) {
    const P = G.player, S = G.survival;
    for (const p of this.players.values()) p.update(dt);
    if (!this.connected) return;
    this.meT -= dt;
    if (this.meT <= 0) {
      this.meT = 1 / 15;
      this.send({
        t: 'me', x: r2(P.pos.x), y: r2(P.pos.y), z: r2(P.pos.z), yaw: r2(P.yaw), p: r2(P.pitch), c: P.crouch && !P.prone ? 1 : 0, pr: P.prone ? 1 : 0, sp: P.sprinting ? 1 : 0, vx: r2(P.vel.x), vz: r2(P.vel.z), air: !P.onGround && !P.swimming && !P.inWater ? 1 : 0, hd: P.hidden ? 1 : 0,
        a: Math.round(G.equipment.aim * 10) / 10, d: G.equipment.item === 'bow' ? Math.round((G.equipment.draw || 0) * 10) / 10 : 0, r: G.equipment.tier(G.equipment.item),
        it: G.equipment.item, hp: Math.round(S.health), dead: S.dead ? 1 : 0, mv: P.moving ? 1 : 0,
        vis: r2(P.visibility || 0.5), no: r2(P.noise || 0), bed: P.inBed ? 1 : 0, safe: P.inCabinSafe ? 1 : 0, sw: P.swimming ? 1 : 0,
      });
    }
    if (!this.isHost) return;
    if (this.spawnQ.length) { this.send({ t: 'spawn', list: this.spawnQ.filter((a) => a.active).map((a) => this.spawnInfo(a)) }); this.spawnQ = []; }
    if (this.despawnQ.length) { this.send({ t: 'despawn', n: this.despawnQ }); this.despawnQ = []; }
    this.worldT -= dt;
    if (this.worldT <= 0) {
      this.worldT = 0.1;
      const a = [];
      for (const an of G.animals.list) if (an.state !== 'down') a.push([an.nid, r2(an.pos.x), r2(an.pos.z), r2(an.heading), r2(an.speed), an.state]);
      this.send({ t: 'world', time: Math.round(G.env.time * 10000) / 10000, day: G.env.day, wx: G.env.weatherName, a });
    }
  }

  // ---------- events from this player's game ----------
  sendLook(to) { const m = { t: 'look', look: loadLook() }; if (to) m.to = to; this.send(m); }
  shot(item, loud) { const p = G.camera.position; this.send({ t: 'shot', x: r2(p.x), y: r2(p.y), z: r2(p.z), w: item, loud }); }
  noise(x, z, r, k) { if (!this.isHost) this.send({ t: 'noise', to: 'host', x: r2(x), z: r2(z), r, k }); }
  spook(a) { if (!this.isHost) this.send({ t: 'spook', to: 'host', n: a.nid, w: a.wounded ? 1 : 0, x: r2(G.player.pos.x), z: r2(G.player.pos.z) }); }
  call(x, z) { this.send({ t: 'call', to: 'host', x: r2(x), z: r2(z) }); }
  bait(x, z) { this.send({ t: 'bait', x: r2(x), z: r2(z) }); }
  tag(a, meat = false) { if (!a.isBird) this.send({ t: 'tag', n: a.nid, meat: meat ? 1 : 0 }); }
  door(d) { this.send({ t: 'door', i: G.world.doors.indexOf(d), open: d.open }); }
  fire(f) { this.send({ t: 'fire', i: G.world.fires.indexOf(f), lit: f.lit, fuel: f.fuel }); }
  pick(node) { this.send({ t: 'pick', i: G.forage.nodes.indexOf(node) }); }
  upgrade(id) { this.send({ t: 'upgrade', id }); }
  crate(i, on) { this.send({ t: 'crate', i, on: on ? 1 : 0 }); }
  down(a, part) {
    this.send({ t: 'down', n: a.nid, part, px: r2(a.pos.x), pz: r2(a.pos.z), h: a.heading, side: a.downSide, run: a.runOff, sx: r2(G.player.pos.x), sz: r2(G.player.pos.z) });
  }
  // an animal attacking another player (host only)
  damage(p, amount, cause, from) { this.send({ t: 'dmg', to: p.id, amount, cause, x: r2(from.x), z: r2(from.z) }); }
  warn(p, text) { this.send({ t: 'warn', to: p.id, text }); }

  // ---------- teams ----------
  // Walk up to someone and press E to ask; they press E on you to accept (or you both ask).
  // Teammates see each other anywhere on the map and can't hurt each other.
  isMate(id) { return this.team.has(id); }

  nearPlayer() {
    const P = G.player;
    let best = null, bd = 3.2;
    for (const p of this.players.values()) {
      if (p.dead || !p.seen || p.inBed) continue;
      const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d >= bd || Math.abs(p.pos.y - P.pos.y) > 2.5) continue;
      // in front of you (or right next to you)
      if (d > 1.6 && (-Math.sin(P.yaw) * dx - Math.cos(P.yaw) * dz) / d < 0.5) continue;
      best = p; bd = d;
    }
    return best;
  }

  teamText(p) {
    const n = p.name.replace(/</g, '&lt;');
    if (this.team.has(p.id)) return `<kbd>E</kbd>Leave the team with ${n}`;
    if (this.teamAsk.has(p.id) && performance.now() - this.teamAsk.get(p.id) < 60000) return `<kbd>E</kbd>Accept ${n}'s team request`;
    if (this.asked.has(p.id) && performance.now() - this.asked.get(p.id) < 60000) return `Waiting for ${n} to accept · <kbd>E</kbd>Ask again`;
    return `<kbd>E</kbd>Team up with ${n}`;
  }

  teamUp(p) {
    const ui = G.ui, now = performance.now();
    if (this.team.has(p.id)) {
      this.team.delete(p.id); p.setMate(false);
      this.send({ t: 'team', to: p.id, a: 'bye' });
      ui.toast(`You left the team with ${p.name}.`, 'info');
      return;
    }
    if (this.teamAsk.has(p.id) && now - this.teamAsk.get(p.id) < 60000) {
      this.send({ t: 'team', to: p.id, a: 'ok' });
      this.joinTeam(p);
      return;
    }
    this.asked.set(p.id, now);
    this.send({ t: 'team', to: p.id, a: 'ask' });
    ui.toast(`Team request sent to ${p.name}. They accept by walking up to you and pressing E.`, 'info');
  }

  joinTeam(p) {
    this.team.add(p.id); this.teamAsk.delete(p.id); this.asked.delete(p.id);
    p.setMate(true);
    G.ui.toast(`You teamed up with ${p.name}! You can see each other anywhere on the map, and your weapons won't hurt each other.`, 'good');
  }

  onTeam(m, from) {
    const now = performance.now();
    if (m.a === 'ask') {
      if (this.team.has(from.id)) return;
      // we had already asked them: that's a yes from both sides
      if (this.asked.has(from.id) && now - this.asked.get(from.id) < 60000) { this.send({ t: 'team', to: from.id, a: 'ok' }); this.joinTeam(from); return; }
      this.teamAsk.set(from.id, now);
      G.ui.toast(`${from.name} wants to team up with you. Walk up to them and press E to accept.`, 'info');
    } else if (m.a === 'ok') {
      if (this.asked.has(from.id) && !this.team.has(from.id)) this.joinTeam(from);
    } else if (m.a === 'bye') {
      if (this.team.delete(from.id)) { from.setMate(false); G.ui.toast(`${from.name} left your team.`, 'warn'); }
    }
  }

  // ---------- gifts between teammates ----------
  gift(p, c) { this.send({ t: 'gift', to: p.id, c }); }

  onGift(m, from) {
    if (!m.c || isEmpty(m.c)) return;
    const left = giveToPack(m.c);
    const what = describe(m.c, 6);
    G.ui.toast(`${from ? from.name : 'A teammate'} gave you ${what}.${isEmpty(left) ? '' : ' Your pack is full — the rest is in a bag at your feet.'}`, 'good');
    if (!isEmpty(left)) G.drops.drop(left);
    G.audio?.strike();
    if (G.menuOpen === 'pack') G.ui.renderPack();
  }

  // ---------- player vs player ----------
  raycastPlayers(o, d, maxDist) {
    let best = null;
    for (const p of this.players.values()) {
      if (p.dead || !p.seen || p.inBed) continue;
      const base = p.pos.y - (p.swimming ? 1.15 : 0), dn = p.crouch ? 0.32 : 0;
      // lying down: head where they are, body and legs stretched out behind
      const bx = Math.sin(p.yaw), bz = Math.cos(p.yaw);
      const parts = p.prone ? [[0.2, 0.2, 'legs', 1.15], [0.2, 0.26, 'body', 0.5], [0.25, 0.15, 'head', -0.05]] : [[0.5, 0.22, 'legs', 0], [1.2, 0.3, 'body', 0], [1.68, 0.16, 'head', 0]];
      for (const [y, r, part, back] of parts) {
        const cx = p.pos.x + bx * back - o.x, cy = base + y - (p.prone ? 0 : part === 'legs' ? dn * 0.5 : dn) - o.y, cz = p.pos.z + bz * back - o.z;
        const tc = cx * d.x + cy * d.y + cz * d.z;
        if (tc < 0) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
        if (d2 > r * r) continue;
        const t = tc - Math.sqrt(r * r - d2);
        if (t <= maxDist && (!best || t < best.dist)) best = { dist: Math.max(0, t), player: p, part };
      }
    }
    return best;
  }

  hitPlayer(p, power, part, pellets = 1) {
    if (this.team.has(p.id)) {
      const now = performance.now();
      if (!this.mateWarnT || now - this.mateWarnT > 3000) { this.mateWarnT = now; G.ui.toast(`${p.name} is on your team — your weapons can't hurt them.`, 'warn'); }
      return;
    }
    const table = DAMAGE[power] || DAMAGE.rifle;
    const dmg = Math.round(table[part] * pellets * G.equipment.dmgMult(power));
    this.send({ t: 'hitP', to: p.id, dmg, part, w: power, x: r2(G.player.pos.x), z: r2(G.player.pos.z) });
    G.ui.hitMarker(part === 'head');
    G.ui.toast(`You hit ${p.name}${part === 'head' ? ' in the head' : part === 'legs' ? ' in the leg' : ''} (${dmg} damage).`, 'info');
  }

  takeHit(m, from) {
    const S = G.survival;
    if (S.dead || (from && this.team.has(from.id))) return;
    const who = from ? from.name : 'another hunter';
    this.lastHit = { from: m.from, t: performance.now(), w: m.w };
    S.damage(m.dmg, { x: m.x, z: m.z }, m.w === 'knife' ? `Stabbed by ${who}` : `Shot by ${who} with a ${WEAPON_NAME[m.w] || 'gun'}`);
    if (!S.dead) G.ui.toast(`${who} ${m.w === 'knife' ? 'stabbed' : 'shot'} you${m.part === 'head' ? ' in the head' : m.part === 'legs' ? ' in the leg' : ''}! (−${m.dmg})`, 'warn');
  }

  // called when this player dies (from any cause)
  onLocalDeath(cause) {
    const S = G.survival;
    const killer = this.lastHit && performance.now() - this.lastHit.t < 3000 ? this.lastHit.from : 0;
    this.deaths++;
    this.send({ t: 'killed', by: killer, victim: this.id, name: this.name, money: killer ? S.money : 0, cause });
    if (killer) { const k = this.players.get(killer); if (k) k.kills++; }
    if (killer) S.money = 0;
    this.lastHit = null;
  }

  onKilled(m) {
    const victim = this.players.get(m.victim);
    if (victim) victim.deaths++;
    if (m.by === this.id) {
      this.kills++;
      G.survival.money += m.money || 0;
      G.ui.toast(`You killed ${m.name}${m.money ? ` and took their $${m.money}` : ''}.`, 'good');
    } else {
      const k = this.players.get(m.by);
      if (k) k.kills++;
      G.ui.toast(k ? `${k.name} killed ${m.name}.` : `${m.name} died: ${m.cause.toLowerCase()}.`, 'info');
    }
  }

  // Houses: the host lives in the starting cabin, everyone else gets a homestead
  houseOf(id) {
    const H = G.world.houses;
    if (!H || !H.length) return -1;
    return id === this.hostId ? 0 : 1 + (id % (H.length - 1));
  }
  myHouse() { const i = this.houseOf(this.id); return i >= 0 ? G.world.houses[i] : null; }
  // who lives in house i: { id, name, me } or null
  ownerOf(i) {
    if (this.houseOf(this.id) === i) return { id: this.id, name: this.name, me: true };
    for (const p of this.players.values()) if (this.houseOf(p.id) === i) return { id: p.id, name: p.name, me: false, color: lookColor('jacket', p.look.jacket) };
    return null;
  }

  // Back into the forest after dying: fresh pack, knife only — at home if nobody is waiting
  // there, otherwise far from the other players
  respawnPoint() {
    const c = this.myHouse();
    if (c) {
      let md = 999;
      for (const p of this.players.values()) if (!p.dead && p.seen) md = Math.min(md, Math.hypot(p.pos.x - c.x, p.pos.z - c.z));
      if (md > 50) return [c.x + c.dx, c.z + c.D / 2 + 2.2];
    }
    let best = SPAWNS[0], bs = -1;
    for (const s of SPAWNS) {
      let md = 999;
      for (const p of this.players.values()) if (!p.dead && p.seen) md = Math.min(md, Math.hypot(p.pos.x - s[0], p.pos.z - s[1]));
      const score = md + Math.random() * 30;
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }
}
