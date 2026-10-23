// PvP survival networking.
// One player hosts: their game runs the wildlife, the clock and the weather and streams it to
// everyone. Every player sends their own position; a shot that hits another player is sent to
// the victim, whose game applies the damage. All players build the same world from a shared seed.
import * as THREE from 'three';
import { G } from './state.js';
import { Avatar, DEFAULT_LOOK, sanitizeLook, lookColor, loadLook } from './avatar.js';

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
    this.avatar = new Avatar(this.look);
    this.root = this.avatar.root;
    this.setTag();
    this.pos = new THREE.Vector3(0, -50, 0);
    this.target = new THREE.Vector3(0, -50, 0);
    this.eye = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.aim = 0; this.draw = 0; this.crouch = false; this.item = 'knife'; this.hp = 100;
    this.dead = false; this.moving = false; this.visibility = 0.5; this.noise = 0.2;
    this.inBed = false; this.inCabinSafe = false; this.swimming = false;
    this.kills = 0; this.deaths = 0; this.shotAt = 0; this.seen = false;
    G.scene.add(this.root);
  }

  setTag() {
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.tag = nameTag(this.name, lookColor('jacket', this.look.jacket));
    this.root.add(this.tag);
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
    this.crouch = !!m.c; this.item = m.it; this.hp = m.hp;
    this.dead = !!m.dead; this.moving = !!m.mv; this.visibility = m.vis; this.noise = m.no;
    this.inBed = !!m.bed; this.inCabinSafe = !!m.safe; this.swimming = !!m.sw;
  }

  update(dt) {
    this.pos.lerp(this.target, Math.min(1, dt * 12));
    this.eye.set(this.pos.x, this.pos.y + (this.crouch ? 1.15 : 1.6), this.pos.z);
    const r = this.root;
    r.visible = this.seen && !this.inBed; // the bed hides you under the covers
    r.position.copy(this.pos);
    if (this.swimming) r.position.y -= 1.15;
    if (this.dead) r.position.y += 0.25;
    r.rotation.y = this.yaw + Math.PI;
    this.avatar.update(dt, { pitch: this.pitch, aim: this.aim, draw: this.draw, item: this.item, tier: this.tier, moving: this.moving, crouch: this.crouch, dead: this.dead, swimming: this.swimming });
    this.tag.visible = !this.dead && G.camera.position.distanceTo(this.pos) < 45;
  }

  remove() { G.scene.remove(this.root); this.avatar.dispose(); }
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
        this.isHost = m.host === m.id;
        for (const p of m.players) if (p.id !== this.id) this.players.set(p.id, new RemotePlayer(p.id, p.name));
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
        if (p) { ui.toast(`${p.name} left the game.`, 'info'); p.remove(); this.players.delete(m.id); }
        break;
      }
      case 'me': if (from) from.apply(m); break;
      case 'look': if (from) from.setLook(m.look); break;
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
      case 'spook': if (this.isHost) { const a = A.byNid.get(m.n); if (a && a.state !== 'down') { if (a.state === 'attack') a.endAttack(); else a.flee(m.x, m.z, true); } } break;
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
        t: 'me', x: r2(P.pos.x), y: r2(P.pos.y), z: r2(P.pos.z), yaw: r2(P.yaw), p: r2(P.pitch), c: P.crouch ? 1 : 0,
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
  spook(a) { if (!this.isHost) this.send({ t: 'spook', to: 'host', n: a.nid, x: r2(G.player.pos.x), z: r2(G.player.pos.z) }); }
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

  // ---------- player vs player ----------
  raycastPlayers(o, d, maxDist) {
    let best = null;
    for (const p of this.players.values()) {
      if (p.dead || !p.seen || p.inBed) continue;
      const base = p.pos.y - (p.swimming ? 1.15 : 0), dn = p.crouch ? 0.32 : 0;
      for (const [y, r, part] of [[0.5, 0.22, 'legs'], [1.2, 0.3, 'body'], [1.68, 0.16, 'head']]) {
        const cx = p.pos.x - o.x, cy = base + y - (part === 'legs' ? dn * 0.5 : dn) - o.y, cz = p.pos.z - o.z;
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
    const table = DAMAGE[power] || DAMAGE.rifle;
    const dmg = Math.round(table[part] * pellets * G.equipment.dmgMult(power));
    this.send({ t: 'hitP', to: p.id, dmg, part, w: power, x: r2(G.player.pos.x), z: r2(G.player.pos.z) });
    G.ui.hitMarker(part === 'head');
    G.ui.toast(`You hit ${p.name}${part === 'head' ? ' in the head' : part === 'legs' ? ' in the leg' : ''} (${dmg} damage).`, 'info');
  }

  takeHit(m, from) {
    const S = G.survival;
    if (S.dead) return;
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

  // Back into the forest after dying: fresh pack, knife only, far from other players
  respawnPoint() {
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
