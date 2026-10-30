// HUD, menus, field guide (3D preview + anatomy), journal, sandbox, map and settings UI.
import * as THREE from 'three';
import { G, settings, saveSettings, saveProgress } from './state.js';
import { SPECIES, SPECIES_ORDER, MAMMAL_ORDER, BIRD_ORDER } from './species.js';
import { PORTION_KG, CARRY_KG, WOOD_HOURS, MAX_FUEL } from './survival.js';
import { STORES, MEAT_PRICE, priceOf, DIFFICULTY } from './modes.js';
import { FORAGE } from './forage.js';
import { ITEMS, WEAPONS } from './equipment.js';
import { TRAP_KINDS, TRAP_ORDER } from './traps.js';
import { RARITY, RARITY_WEAPONS, UPGRADE_PRICE } from './rarity.js';
import { WEATHER } from './environment.js';
import { LOCATIONS } from './world.js';
import { Stage } from './stage.js';
import { LOOK_OPTIONS, LOOK_LABELS, loadLook, saveLook, randomLook, lookColor, sanitizeLook } from './avatar.js';
import { makeAvatar, hunterReady } from './hunterModel.js';
import { takeFromPack, describe, isEmpty, GIVE_RANGE } from './drops.js';
import { yawToBearing, compassName, formatClock, clamp, smoothstep } from './utils.js';
import { HALF, WORLD_SIZE } from './terrain.js';
import { S } from './animals.js';

const $ = (id) => document.getElementById(id);
const PX_PER_DEG = 4;
const fmtWeight = (kg) => (kg < 10 ? `${kg.toFixed(1)} kg` : `${Math.round(kg)} kg`);

// Map icons: a round badge per kind of place, drawn once and reused on both maps
const ICON_STYLE = {
  home: ['#d9733a', 'house'], homestead: ['#77756c', 'house'], hut: ['#8a6a44', 'house'],
  gun: ['#b8322a', 'cross'], butcher: ['#9a3a2e', '🥩'], general: ['#3a7a5a', '🛒'],
  stand: ['#4e6474', 'tower'], outpost: ['#c89a3a', '🚩'],
};
const _icons = new Map();
function mapIcon(kind, color) {
  const key = kind + (color || '');
  if (_icons.has(key)) return _icons.get(key);
  const [bg, glyph] = ICON_STYLE[kind] || ['#666', 'house'];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 48;
  const c = cv.getContext('2d');
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 4;
  c.beginPath(); c.arc(24, 24, 19, 0, Math.PI * 2);
  c.fillStyle = color || bg; c.fill();
  c.shadowBlur = 0;
  c.lineWidth = 3; c.strokeStyle = '#f4ecdc'; c.stroke();
  c.fillStyle = c.strokeStyle = '#fff';
  if (glyph === 'house') {
    c.beginPath(); c.moveTo(13, 24); c.lineTo(24, 13); c.lineTo(35, 24); c.lineTo(32, 24); c.lineTo(32, 34); c.lineTo(16, 34); c.lineTo(16, 24); c.closePath(); c.fill();
    c.fillStyle = color || bg; c.fillRect(22, 27, 5, 7);
  } else if (glyph === 'cross') {
    c.lineWidth = 2.6; c.beginPath(); c.arc(24, 24, 8, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(24, 11); c.lineTo(24, 19); c.moveTo(24, 29); c.lineTo(24, 37); c.moveTo(11, 24); c.lineTo(19, 24); c.moveTo(29, 24); c.lineTo(37, 24); c.stroke();
    c.beginPath(); c.arc(24, 24, 1.8, 0, Math.PI * 2); c.fill();
  } else if (glyph === 'tower') {
    c.lineWidth = 2.4; c.fillRect(15, 13, 18, 5);
    c.beginPath(); c.moveTo(17, 18); c.lineTo(14, 36); c.moveTo(31, 18); c.lineTo(34, 36); c.moveTo(16, 26); c.lineTo(32, 26); c.moveTo(16, 26); c.lineTo(32, 34); c.stroke();
  } else {
    c.font = '20px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(glyph, 24, 26);
  }
  const out = { cv, url: cv.toDataURL() };
  _icons.set(key, out);
  return out;
}
const hexCss = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'compass-strip', 'compass-deg', 'hud-time', 'hud-day', 'hud-weather', 'wind-arrow', 'hud-wind', 'fps', 'crosshair',
      'hitmarker', 'prompt', 'track-badge', 'stance', 'noise-bar', 'vis-bar', 'detect', 'detect-text', 'item-name', 'ammo', 'ammo-mag', 'ammo-res',
      'zoom-label', 'money', 'stamina', 'stamina-bar', 'toasts', 'markers', 'scope-overlay', 'binoc-overlay', 'scope-info', 'bino-range', 'bino-bearing',
      'bino-zoom', 'bino-id', 'track-panel', 'loading', 'load-fill', 'load-text', 'mainmenu', 'lock-hint']) this.el[id] = $(id);
    this.menus = ['pause', 'guide', 'journal', 'sandbox', 'map', 'settings', 'controls', 'harvest', 'inspect', 'sleep', 'pack', 'campfire', 'store', 'custom'];
    this.stage = new Stage();
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.hudHidden = false;
    this.trackPanelT = 0;
    this.markerPool = [];
    this.buildCompass();
    $('slots').innerHTML = ITEMS.map((id, i) => `<span data-slot="${id}"><b>${i + 1}</b>${WEAPONS[id].short}<i class="cnt"></i></span>`).join('');
    this.bindMenus();
    this.bindSettings();
    this.buildSandbox();
    this.guideSel = 'deer';
    this.guideSex = true;
  }

  // ---------- loading / start ----------
  setLoading(p, text) {
    this.el['load-fill'].style.width = `${Math.round(p * 100)}%`;
    if (text) this.el['load-text'].textContent = text;
  }
  // Main menu: shown after loading and whenever the player leaves the hunt
  showMainMenu() {
    this.el.loading.classList.add('hidden');
    this.closeMenus();
    G.inMainMenu = true;
    G.input.unlock();
    this.el.hud.classList.add('hidden');
    this.el['lock-hint'].classList.add('hidden');
    this.hideTrack();
    this.el.mainmenu.classList.remove('hidden');
    const modeName = G.mode === 'survival' ? `survival (${DIFFICULTY[G.difficulty].label.toLowerCase()})` : 'free roam';
    $('btn-start').querySelector('span').textContent = G.started ? 'Resume' : 'Free roam';
    $('btn-start').querySelector('small').textContent = G.started ? `Continue your ${modeName} game` : 'Explore, track and hunt freely';
    $('btn-survival').querySelector('span').textContent = G.started ? 'New survival run' : 'Survival mode';
    $('mm-diff').classList.add('hidden');
    $('mm-guide-sub').textContent = `${G.discovered.size} of ${SPECIES_ORDER.length} species recorded`;
    this.renderMainJournal();
  }

  hideMainMenu() {
    G.inMainMenu = false;
    this.el.mainmenu.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  renderMainJournal() {
    const st = G.stats;
    const harvests = G.journal.filter((e) => e.type === 'harvest').length;
    $('mm-stats').innerHTML = [
      [`${G.discovered.size}/${SPECIES_ORDER.length}`, 'Species'], [st.sightings, 'Sightings'], [harvests, 'Harvests'], [st.tracksInspected, 'Tracks read'],
    ].map(([b, t]) => `<div><b>${b}</b><span>${t}</span></div>`).join('');
    const last = G.journal.slice(-5).reverse();
    $('mm-entries').innerHTML = last.length ? last.map((e) => this.journalLine(e, true)).join('')
      : '<div class="j-empty">Nothing yet. Observe animals through binoculars or read their tracks to start your journal.</div>';
  }

  buildCompass() {
    const strip = this.el['compass-strip'];
    const cards = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let d = -90; d <= 450; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const x = (d + 90) * PX_PER_DEG;
      if (cards[n] !== undefined) html += `<span class="card ${n === 0 ? 'n' : ''}" style="left:${x}px">${cards[n]}</span>`;
      else if (n % 45 !== 0) html += `<span style="left:${x}px">${n}</span>`;
      html += `<span class="tick" style="left:${x + 7.5 * PX_PER_DEG}px"></span>`;
    }
    strip.innerHTML = html;
  }

  // ---------- notifications ----------
  toast(msg, type = 'info') {
    const box = this.el.toasts;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    box.appendChild(t);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => t.classList.add('out'), type === 'discover' ? 5200 : 3600);
    setTimeout(() => t.remove(), type === 'discover' ? 5800 : 4200);
  }

  discover(species, how) {
    if (G.discovered.has(species)) return;
    G.discovered.add(species);
    const sp = SPECIES[species];
    this.toast(`New species recorded: ${sp.name} (${sp.sci}) — press F to open the Field Guide`, 'discover');
    saveProgress();
    void how;
  }

  hitMarker(clean) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'clean');
    void h.offsetWidth;
    h.classList.add('show');
    if (clean) h.classList.add('clean');
  }

  scopeKick() {
    const o = this.el['scope-overlay'];
    o.animate([{ transform: 'translateY(-14px) scale(1.02)' }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
  }

  setPrompt(html) {
    const p = this.el.prompt;
    if (html) { if (p.innerHTML !== html) p.innerHTML = html; p.classList.add('show'); }
    else p.classList.remove('show');
  }

  toggleHUD() {
    this.hudHidden = !this.hudHidden;
    this.el.hud.classList.toggle('faded', this.hudHidden);
  }

  // ---------- track panel ----------
  showTrack(info) {
    const sp = info.species;
    $('tp-kind').textContent = info.kind;
    $('tp-species').textContent = sp.name;
    $('tp-sci').textContent = sp.sci;
    $('tp-dir').textContent = `${info.dir} · ${Math.round(info.bearing)}°`;
    const dots = [1, 2, 3, 4].map((i) => `<i class="${i <= info.fresh.level ? 'on' : ''}"></i>`).join('');
    $('tp-fresh').innerHTML = `${info.fresh.label}<span class="fresh-dots">${dots}</span>`;
    $('tp-gait').textContent = info.kind === 'Footprint' ? (info.gait.split('—')[0].trim()) : '—';
    $('tp-size').textContent = info.kind === 'Footprint' ? `~${info.sizeCm} cm` : '—';
    $('tp-note').innerHTML = `${info.gait} ${info.fresh.note}<br><br><span style="opacity:.8">${info.tracksNote}</span>`;
    this.el['track-panel'].classList.remove('hidden');
    this.trackPanelT = 14;
  }
  hideTrack() { this.el['track-panel'].classList.add('hidden'); this.trackPanelT = 0; }

  // ---------- HUD per-frame ----------
  updateHUD(dt) {
    const P = G.player, env = G.env, eq = G.equipment;
    this.updatePvpHud();
    // FPS
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.el.fps.textContent = settings.showFps ? `${Math.round(this.fpsFrames / this.fpsAcc)} FPS` : '';
      this.fpsAcc = 0; this.fpsFrames = 0;
    }
    // compass
    const bearing = yawToBearing(P.yaw);
    const w = this.el['compass-strip'].parentElement.clientWidth;
    this.el['compass-strip'].style.transform = `translateX(${w / 2 - (bearing + 90) * PX_PER_DEG}px)`;
    this.el['compass-deg'].textContent = `${String(Math.round(bearing) % 360).padStart(3, '0')}° ${compassName(bearing)}`;
    // status
    this.el['hud-time'].textContent = formatClock(env.time);
    this.el['hud-day'].textContent = `Day ${env.day}`;
    this.el['hud-weather'].textContent = WEATHER[env.weatherName].label + (env.daylight < 0.2 ? ' · Night' : env.daylight < 0.7 && env.time < 12 ? ' · Dawn' : env.daylight < 0.7 ? ' · Dusk' : '') + ` · ${Math.round(env.tempC ?? 10)}°C`;
    if (env.frozen !== this.wasFrozen) {
      if (this.wasFrozen !== undefined) this.toast(env.frozen ? 'The water has frozen over. You can walk on the ice.' : 'The ice is thawing. The water is open again.');
      this.wasFrozen = env.frozen;
    }
    const night = env.isNight();
    if (night !== this.wasNight) {
      if (night && this.wasNight !== undefined) this.toast('Night is falling and the predators are out hunting. Stay by a lit campfire, get indoors, or lie flat and still in the grass (Z).', 'warn');
      this.wasNight = night;
    }
    const ws = Math.hypot(env.wind.x, env.wind.z);
    const windTo = (Math.atan2(env.wind.x, -env.wind.z) * 180 / Math.PI + 360) % 360;
    this.el['wind-arrow'].style.transform = `rotate(${windTo - bearing}deg)`;
    this.el['hud-wind'].textContent = `Wind ${ws.toFixed(0)} m/s from ${compassName(windTo + 180)}`;

    // loadout
    const Wp = WEAPONS[eq.item];
    const tierNow = RARITY_WEAPONS.includes(eq.item) ? eq.tier(eq.item) : -1;
    const nameHtml = tierNow >= 0 ? `<span style="color:${RARITY[tierNow].css}">${RARITY[tierNow].name}</span> ${Wp.name}` : Wp.name;
    if (this._itemName !== nameHtml) { this.el['item-name'].innerHTML = nameHtml; this._itemName = nameHtml; }
    const am = eq.ammo[eq.item];
    if (eq.item === 'trap') {
      this.el.ammo.style.display = '';
      this.el['ammo-mag'].textContent = G.sandbox.infiniteAmmo ? '∞' : eq.ammo[eq.trapSize].reserve;
      this.el['ammo-res'].textContent = `${TRAP_KINDS[eq.trapSize].size} traps · right-click: size`;
    } else if (Wp.gun) {
      this.el.ammo.style.display = '';
      this.el['ammo-mag'].textContent = eq.reloadT > 0 && !Wp.perShell ? '…' : am.mag;
      this.el['ammo-res'].textContent = G.sandbox.infiniteAmmo ? '∞' : am.reserve;
    } else if (am) {
      this.el.ammo.style.display = '';
      this.el['ammo-mag'].textContent = G.sandbox.infiniteAmmo ? '∞' : am.reserve;
      this.el['ammo-res'].textContent = Wp.ammo;
    } else this.el.ammo.style.display = 'none';
    this.el['zoom-label'].textContent = P.swimming ? 'Swimming — weapons lowered'
      : eq.item === 'bow' && eq.draw > 0 ? `Draw ${Math.round(eq.draw * 100)}%`
      : eq.aim > 0.5 && Wp.zoom ? `${eq.zoom}× ${eq.item === 'rifle' || eq.item === 'binoculars' ? 'zoom' : 'sights'}`
      : eq.reloadT > 0 ? 'Reloading' : eq.cycleT > 0 ? (eq.item === 'shotgun' ? 'Pumping' : 'Cycling') : '';
    document.querySelectorAll('#slots span').forEach((sl) => {
      const id = sl.dataset.slot;
      sl.classList.toggle('active', id === (eq.nextItem || eq.item));
      sl.classList.toggle('unowned', !eq.owned[id]);
      const tr = RARITY_WEAPONS.includes(id) && eq.owned[id] ? eq.tier(id) : 0;
      const sh = tr ? `inset 0 -2px 0 ${RARITY[tr].css}` : '';
      if (sl.style.boxShadow !== sh) sl.style.boxShadow = sh;
      const a = eq.ammo[id];
      const txt = id === 'trap' ? (eq.owned.trap ? String(TRAP_ORDER.reduce((n, k) => n + eq.ammo[k].reserve, 0)) : '')
        : !eq.owned[id] || !a ? '' : WEAPONS[id].gun ? String(a.mag + a.reserve) : String(a.reserve);
      const c = sl.querySelector('.cnt');
      if (c && c.textContent !== txt) c.textContent = txt;
    });
    const money = G.mode === 'survival' ? `$${G.survival.money}` : '';
    if (this.el.money.textContent !== money) this.el.money.textContent = money;

    // stealth
    this.el.stance.textContent = P.inBed ? (P.inBed.spot.chair ? 'Sitting on the porch' : 'Resting in bed') : P.swimming ? 'Swimming' : P.inWater ? 'Wading' : P.prone ? (P.hidden ? 'Hidden in the grass' : P.moving ? 'Crawling' : 'Lying down') : P.crouch ? (P.moving ? 'Stalking' : 'Crouched') : P.sprinting ? 'Sprinting' : P.moving ? 'Walking' : 'Standing';
    this.el['noise-bar'].style.width = `${P.noise * 100}%`;
    this.el['vis-bar'].style.width = `${P.visibility * env.visibilityFactor() * 100}%`;
    let maxA = 0, fleeing = false;
    for (const a of G.animals.list) {
      if (a.playerDist > 180 || a.state === S.DOWN) continue;
      if (a.threat.kind === 'player') { maxA = Math.max(maxA, a.awareness); if (a.state === S.FLEE && a.stateT < 6) fleeing = true; }
    }
    const det = this.el.detect;
    det.classList.toggle('suspicious', maxA > 0.3 && maxA < 0.9 && !fleeing);
    det.classList.toggle('alarmed', maxA >= 0.9 || fleeing);
    const attacked = G.animals.list.some((a) => a.state === 'attack');
    if (attacked) det.classList.add('alarmed');
    this.el['detect-text'].textContent = attacked ? 'Under attack!' : fleeing ? 'Spooked wildlife' : maxA >= 0.9 ? 'Spotted' : maxA > 0.3 ? 'Something noticed you' : 'Unnoticed';

    // stamina
    this.el.stamina.classList.toggle('show', P.stamina < 0.98);
    this.el['stamina-bar'].style.width = `${P.stamina * 100}%`;

    // optics overlays
    const ov = smoothstep(0.65, 0.95, eq.aim);
    const scope = eq.item === 'rifle' ? ov : 0, bino = eq.item === 'binoculars' ? ov : 0;
    this.el['scope-overlay'].style.opacity = scope;
    this.el['binoc-overlay'].style.opacity = bino;
    this.el.crosshair.style.opacity = P.inBed || P.swimming ? 0 : eq.item === 'rifle' || eq.item === 'binoculars' ? (1 - eq.aim * 2) : WEAPONS[eq.item].gun || eq.item === 'bow' ? 1 - eq.aim * 0.5 : 0.5;
    const spread = WEAPONS[eq.item].gun ? (eq.aim > 0.5 ? 10 : P.moving ? 34 : 22) : eq.item === 'bow' ? 26 - eq.draw * 14 : 14;
    this.el.crosshair.style.width = this.el.crosshair.style.height = `${spread}px`;
    if (scope > 0.01 || bino > 0.01) this.updateOpticInfo(eq, bearing, scope > 0.01);

    this.el['track-badge'].classList.toggle('show', G.tracks.mode);
    if (this.trackPanelT > 0) {
      this.trackPanelT -= dt;
      if (this.trackPanelT <= 0) this.hideTrack();
    }
    this.updateMarkers();
    this.updateVitals(dt);
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) { this.mmT = 0.05; this.updateMinimap(); }
  }

  // Circular north-up minimap cut from the full map image, ~65 m around the player
  updateMinimap() {
    const src = $('map-canvas');
    if (!this.mapDrawn) { this.drawMap(); this.mapDrawn = true; }
    const cv = $('minimap-canvas'), ctx = cv.getContext('2d');
    const S = cv.width, R = 65;              // metres shown from centre to edge
    const k = src.width / WORLD_SIZE;        // map pixels per metre
    const P = G.player.pos;
    const sx = (P.x + HALF) * k - R * k, sy = (P.z + HALF) * k - R * k;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1a1f1a'; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(src, sx, sy, R * 2 * k, R * 2 * k, 0, 0, S, S);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, S, S);
    const toMini = (x, z) => [S / 2 + ((x - P.x) / R) * (S / 2), S / 2 + ((z - P.z) / R) * (S / 2)];
    // cabins and fires
    for (const c of G.world.cabins) {
      const [mx, my] = toMini(c.x, c.z);
      ctx.fillStyle = '#e8d6b0'; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      const w = (c.W / R) * (S / 2), h = (c.D / R) * (S / 2);
      ctx.fillRect(mx - w / 2, my - h / 2, w, h); ctx.strokeRect(mx - w / 2, my - h / 2, w, h);
    }
    const isz = S * 0.13;
    for (const p of this.mapPois()) {
      let [mx, my] = toMini(p.x, p.z);
      const dx = mx - S / 2, dy = my - S / 2, d = Math.hypot(dx, dy), rim = S / 2 - isz * 0.62;
      if (d > rim) {
        if (!p.pin) continue;
        mx = S / 2 + dx / d * rim; my = S / 2 + dy / d * rim;
        ctx.globalAlpha = 0.8;
      }
      ctx.drawImage(mapIcon(p.kind, p.color).cv, mx - isz / 2, my - isz / 2, isz, isz);
      ctx.globalAlpha = 1;
    }
    for (const f of G.world.fires) {
      const [mx, my] = toMini(f.x, f.z);
      ctx.beginPath(); ctx.arc(mx, my, f.lit ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = f.lit ? '#ff9a3a' : '#7a7066'; ctx.fill();
      if (f.lit) { ctx.strokeStyle = 'rgba(255,160,60,.5)'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1; }
    }
    // the trail you are following, revealed animals, poachers shooting at you
    if (G.sandbox.revealAnimals) {
      ctx.fillStyle = '#ff6b5a';
      for (const a of [...G.animals.list, ...G.birds.list]) {
        if (a.state === 'down') continue;
        const [mx, my] = toMini(a.pos.x, a.pos.z);
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }
    for (const p of G.poachers.threats()) {
      const [mx, my] = toMini(p.pos.x, p.pos.z);
      ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fillStyle = '#e04040'; ctx.fill();
    }
    if (G.traps) for (const t of G.traps.traps.values()) {
      if (!G.traps.ours(t)) continue;
      let [mx, my] = toMini(t.x, t.z);
      const dx = mx - S / 2, dy = my - S / 2, dd = Math.hypot(dx, dy), rim = S / 2 - 5;
      const busy = t.state !== 'set';
      if (dd > rim) { if (!busy) continue; mx = S / 2 + dx / dd * rim; my = S / 2 + dy / dd * rim; }
      ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = t.state === 'caught' ? '#ff4a3a' : t.state === 'sprung' ? '#f0b040' : '#c8c4b8';
      ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#111'; ctx.stroke(); ctx.lineWidth = 1;
    }
    if (G.crates) for (const c of G.crates.spots) {
      if (!c.active) continue;
      const [mx, my] = toMini(c.x, c.z);
      if (Math.hypot(mx - S / 2, my - S / 2) > S / 2 - 4) continue;
      ctx.fillStyle = '#e8c040'; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(mx - 3.5, my - 3.5, 7, 7); ctx.strokeRect(mx - 3.5, my - 3.5, 7, 7);
    }
    if (G.net) {
      const now = performance.now();
      // supply drops: always on the minimap, pinned to the edge when far away
      const pulse = 0.6 + 0.4 * Math.sin(now / 250);
      for (const d of G.airdrops.drops.values()) {
        let [mx, my] = toMini(d.x, d.z);
        const dx = mx - S / 2, dy = my - S / 2, dd = Math.hypot(dx, dy), rim = S / 2 - 7;
        if (dd > rim) { mx = S / 2 + dx / dd * rim; my = S / 2 + dy / dd * rim; }
        ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = `rgba(255,122,42,${pulse})`; ctx.strokeStyle = '#1a0e06'; ctx.lineWidth = 1.5;
        ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
      }
      for (const b of G.drops.bags.values()) {
        const [mx, my] = toMini(b.x, b.z);
        if (Math.hypot(mx - S / 2, my - S / 2) > S / 2 - 4) continue;
        ctx.fillStyle = '#b8a070'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1;
        ctx.fillRect(mx - 3, my - 2.5, 6, 5); ctx.strokeRect(mx - 3, my - 2.5, 6, 5);
      }
      // teammates: always shown, pinned to the edge when they're out of range
      for (const p of G.net.players.values()) {
        if (!p.mate || !p.seen) continue;
        let [mx, my] = toMini(p.pos.x, p.pos.z);
        const dx = mx - S / 2, dy = my - S / 2, dd = Math.hypot(dx, dy), rim = S / 2 - 6;
        if (dd > rim) { mx = S / 2 + dx / dd * rim; my = S / 2 + dy / dd * rim; }
        ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fillStyle = p.dead ? '#8a8a8a' : '#50e070'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#0c1a0e'; ctx.stroke();
      }
      for (const p of G.net.players.values()) {
        if (p.mate || now - p.shotAt > 6000) continue;
        const [mx, my] = toMini(p.pos.x, p.pos.z);
        const a = 1 - (now - p.shotAt) / 6000;
        ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,80,60,${a})`; ctx.fill();
        ctx.beginPath(); ctx.arc(mx, my, 5 + (1 - a) * 10, 0, Math.PI * 2); ctx.strokeStyle = `rgba(255,80,60,${a * 0.6})`; ctx.stroke();
      }
    }
    // player arrow
    ctx.translate(S / 2, S / 2);
    ctx.rotate((yawToBearing(G.player.yaw) * Math.PI) / 180);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fillStyle = '#d9a85b'; ctx.fill(); ctx.strokeStyle = '#1a1712'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  updateVitals(dt) {
    const S = G.survival;
    if (!S) return;
    const on = S.enabled;
    $('vitals').style.display = on ? '' : 'none';
    $('v-health').style.width = `${S.health}%`;
    $('v-food').style.width = `${S.food}%`;
    $('v-rest').style.width = `${S.rest}%`;
    const st = [];
    if (S.sick > 0) st.push('Food sickness');
    if (S.food < 20) st.push(S.food <= 0 ? 'Starving' : 'Hungry');
    if (S.rest < 20) st.push(S.rest <= 0 ? 'Exhausted' : 'Tired');
    const txt = st.join(' · ');
    if ($('v-status').textContent !== txt) $('v-status').textContent = txt;
    $('tired-overlay').style.opacity = on ? Math.min(0.85, (G.player.tired || 0) * 0.7 + (S.rest <= 0 ? 0.15 + Math.sin(performance.now() / 600) * 0.1 : 0)) : 0;
    $('damage-overlay').style.opacity = Math.max(0, 1 - (performance.now() - S.lastHurt) / 900) * 0.9 + (S.health < 25 ? 0.25 : 0);
    if (this.dmgFrom) {
      const P = G.player;
      const ang = (Math.atan2(this.dmgFrom.x - P.pos.x, -(this.dmgFrom.z - P.pos.z)) * 180) / Math.PI - yawToBearing(P.yaw);
      $('dmg-dir').style.transform = `rotate(${ang}deg)`;
      $('dmg-dir').style.opacity = Math.max(0, 1 - (performance.now() - S.lastHurt) / 2500);
    }
  }

  damageFlash(from) {
    this.dmgFrom = from ? { x: from.x, z: from.z } : null;
  }

  // Health reached zero: fade out and wake up in the cabin
  collapse() {
    G.survival?.die('Died of your injuries');
    return;
    G.menuOpen = 'collapse';
    G.input.unlock();
    this.collapsing = true;
    const fade = $('sleep-fade');
    $('sf-title').textContent = 'You collapsed. A ranger found you and brought you back to the cabin.';
    $('sf-clock').textContent = 'Injured';
    $('sf-bar').style.width = '100%';
    $('sf-continue').classList.remove('hidden');
    fade.classList.remove('hidden');
    requestAnimationFrame(() => fade.classList.add('show'));
  }

  // ---------- pack ----------
  openPack() {
    this.openMenu('pack');
    this.renderPack();
  }

  renderPack() {
    const S = G.survival;
    $('pk-vitals').innerHTML = [['Health', S.health], ['Food', S.food], ['Rest', S.rest]].map(([l, v]) => `<div><b>${Math.round(v)}</b><span>${l}</span></div>`).join('');
    $('pk-load').textContent = `${S.carried().toFixed(1)} / ${S.capacity()} kg`;
    const mate = this.giveTarget();
    const tip = G.mode !== 'survival' ? '' : mate
      ? `<div class="pk-give mate">${mate.name.replace(/</g, '&lt;')} is right here — what you give goes straight into their pack.</div>`
      : `<div class="pk-give">Dropped things go in a bag at your feet that anyone can pick up${G.net ? '. Stand within ' + GIVE_RANGE + ' m of a teammate to hand things over directly' : ''}.</div>`;
    $('pk-meat').innerHTML = tip + this.meatRows(false) + this.forageRows() + this.supplyRows() + this.weaponRows();
  }

  // the teammate close enough to hand things to, if any
  giveTarget() {
    if (!G.net) return null;
    const P = G.player.pos;
    let best = null, bd = GIVE_RANGE;
    for (const p of G.net.players.values()) {
      if (!p.mate || p.dead || !p.seen) continue;
      const d = Math.hypot(p.pos.x - P.x, p.pos.z - P.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // "Give" / "Drop" buttons for one pack row; amounts: [label, amount] pairs
  giveBtns(kind, key, amounts) {
    if (G.mode !== 'survival') return '';
    const verb = this.giveTarget() ? 'Give' : 'Drop';
    return amounts.map(([l, a]) => `<button class="btn small give" data-give="${kind}|${key}|${a}">${verb}${l ? ' ' + l : ''}</button>`).join('');
  }

  giveOrDrop(kind, key, amount) {
    const c = takeFromPack(kind, key, amount === 'all' ? 'all' : Number(amount) || 1);
    if (isEmpty(c)) return;
    const mate = this.giveTarget(), what = describe(c, 6);
    if (mate) { G.net.gift(mate, c); this.toast(`You give ${what} to ${mate.name}.`, 'good'); }
    else { G.drops.drop(c); this.toast(`You drop ${what} in a bag at your feet.`, 'info'); }
    G.audio?.strike();
  }

  weaponRows() {
    if (G.mode !== 'survival') return '';
    const E = G.equipment, rows = [];
    for (const g of ['rifle', 'shotgun', 'pistol', 'bow']) {
      const am = E.ammo[g];
      if (!E.owned[g] && !(am && am.reserve > 0)) continue;
      const R = RARITY[E.tier(g)];
      const label = E.owned[g] ? `<span style="color:${R.css}">${R.name}</span> ${WEAPONS[g].short.toLowerCase()}` : WEAPONS[g].ammo;
      const btns = (am.reserve > 0 ? this.giveBtns('ammo', g, [[Math.min(5, am.reserve) + ' ammo', 5]]) : '') + (E.owned[g] ? this.giveBtns('gun', g, [['weapon', 1]]) : '');
      rows.push(`<div class="meat-row"><span>${label} <small>${am.reserve} spare ${WEAPONS[g].ammo}</small></span><span class="acts">${btns}</span></div>`);
    }
    for (const k of TRAP_ORDER) {
      const n = E.ammo[k].reserve;
      if (n > 0) rows.push(`<div class="meat-row"><span>${TRAP_KINDS[k].name}s <small>× ${n}</small></span><span class="acts">${this.giveBtns('ammo', k, [['', 1]])}</span></div>`);
    }
    return rows.length ? '<h4>Weapons and traps</h4>' + rows.join('') : '';
  }

  forageRows() {
    const S = G.survival;
    const rows = Object.entries(S.forage).map(([t, n]) => `<div class="meat-row"><span>${S.label(t)} <small>× ${n}${S.known.has(t) && FORAGE[t].poison ? ' · poisonous!' : ''}</small></span><span class="acts"><button class="btn small" data-forage="${t}">Eat</button>${this.giveBtns('forage', t, n > 1 ? [['', 1], ['all', 'all']] : [['', 1]])}</span></div>`);
    return rows.length ? '<h4>Wild food</h4>' + rows.join('') : '';
  }

  supplyRows() {
    const S = G.survival;
    const names = { beans: 'Can of beans', bandage: 'Bandage', medkit: 'First-aid kit', veg: 'Garden vegetables' };
    const rows = Object.entries(S.items).filter(([, n]) => n > 0).map(([id, n]) => `<div class="meat-row"><span>${names[id]} <small>× ${n}</small></span><span class="acts"><button class="btn small primary" data-use="${id}">Use</button>${this.giveBtns('item', id, [['', 1]])}</span></div>`);
    if (S.wood > 0) rows.push(`<div class="meat-row"><span>Firewood <small>× ${S.wood}</small></span><span class="acts">${this.giveBtns('wood', 'w', S.wood > 1 ? [['', 1], ['all', 'all']] : [['', 1]])}</span></div>`);
    const money = G.mode === 'survival' ? `<div class="meat-row"><span>Money <span class="st-money" style="font-size:16px">$${S.money}</span></span><span class="acts">${S.money > 0 ? this.giveBtns('money', 'm', [['$10', 10], ['$50', 50], ['all', 'all']].filter(([, a]) => a === 'all' || S.money >= a)) : ''}</span></div>` : '';
    return (rows.length || money ? '<h4>Supplies</h4>' : '') + rows.join('') + money;
  }

  meatRows(atFire) {
    const S = G.survival;
    const rows = [];
    const give = (kind, type, kg) => (atFire ? '' : this.giveBtns(kind, type, kg > PORTION_KG + 1e-6 ? [[PORTION_KG + ' kg', 1], ['all', 'all']] : [['', 1]]));
    for (const [type, kg] of Object.entries(S.cooked)) rows.push(`<div class="meat-row"><span>Cooked ${type.toLowerCase()} <small>${kg.toFixed(1)} kg</small></span><span class="acts"><button class="btn small primary" data-eat="${type}" data-cooked="1">Eat ${PORTION_KG} kg</button>${give('cooked', type, kg)}</span></div>`);
    for (const [type, kg] of Object.entries(S.raw)) {
      const acts = atFire
        ? `<button class="btn small" data-cook="${type}">Cook ${PORTION_KG} kg</button><button class="btn small" data-cookall="${type}">Cook all</button>`
        : `<button class="btn small" data-eat="${type}" data-cooked="0">Eat raw</button>${give('raw', type, kg)}`;
      rows.push(`<div class="meat-row"><span>Raw ${type.toLowerCase()} <small>${kg.toFixed(1)} kg</small></span><span class="acts">${acts}</span></div>`);
    }
    return rows.join('') || '<div class="meat-empty">No meat. Hunt a game animal, inspect it and choose "Harvest meat".</div>';
  }

  eatItem(type, cooked) {
    const r = G.survival.eat(type, cooked);
    if (!r) return;
    G.audio?.eatSound();
    this.toast(r.msg, r.sick ? 'warn' : 'good');
  }

  // ---------- campfire ----------
  showCampfire(fire) {
    this.fire = fire;
    this.cooking = null;
    this.openMenu('campfire');
    this.renderCampfire();
  }

  renderCampfire() {
    const f = this.fire;
    const mins = Math.round(f.fuel * 60);
    $('cf-kicker').textContent = f.stove ? 'Wood stove' : 'Campfire';
    $('cf-douse').style.display = f.stove ? 'none' : '';
    if (f.stove) $('cf-fuel').textContent = 'The stove is lit and hot. Cook as much as you like.';
    else $('cf-fuel').textContent = f.lit ? `The fire will burn for about ${mins >= 60 ? (mins / 60).toFixed(1) + ' more hours' : mins + ' more minutes'} (game time). Rain makes it burn down faster. You carry ${G.survival.wood} firewood; each piece adds ${WOOD_HOURS} hours.` : 'The fire is out.';
    const wb = $('cf-wood');
    wb.style.display = f.stove ? 'none' : '';
    wb.disabled = !f.lit || G.survival.wood <= 0 || f.fuel > MAX_FUEL - WOOD_HOURS;
    wb.textContent = `Add firewood (${G.survival.wood})`;
    $('cf-meat').innerHTML = this.meatRows(true);
    $('cf-progress').classList.toggle('hidden', !this.cooking);
  }

  menuTick(dt) {
    if (G.menuOpen === 'inspect' && this.skinning) {
      const s = this.skinning;
      s.t += dt;
      if ((s.cut -= dt) <= 0) { s.cut = 0.45 + Math.random() * 0.35; G.audio?.slash(); }
      $('in-meat').textContent = `${s.a.isBird ? 'Plucking' : 'Skinning'}… ${Math.round(Math.min(1, s.t / s.dur) * 100)}%`;
      if (s.t >= s.dur) {
        this.skinning = null;
        s.a.skinned = true;
        s.a.markSkinned?.();
        this.toast(s.a.isBird ? `You pluck and clean the ${s.a.sp.name.toLowerCase()}. Now you can take the meat.` : `You skin and gut the ${s.a.sp.name.toLowerCase()}. Now you can cut the meat.`, 'good');
        this.showInspect(s.a);
      }
    }
    if (G.menuOpen === 'campfire' && this.cooking) {
      const c = this.cooking;
      c.t += dt;
      $('cf-progress-fill').style.width = `${Math.min(100, (c.t / 0.8) * 100)}%`;
      $('cf-progress-text').textContent = `Cooking ${c.type.toLowerCase()} over the fire… (${c.left} left)`;
      if (c.t >= 0.8) {
        if (!this.fire.lit) { this.cooking = null; this.toast('The fire went out.', 'warn'); this.renderCampfire(); return; }
        G.survival.cookPortion(c.type);
        c.left--;
        c.t = 0;
        if (c.left <= 0 || (G.survival.raw[c.type] || 0) < PORTION_KG) { this.cooking = null; this.toast(`Cooked ${c.type.toLowerCase()} is ready.`, 'good'); }
        else G.audio?.sizzle();
        this.renderCampfire();
      }
    }
  }

  startCooking(type, all) {
    if (this.cooking || !this.fire.lit) return;
    const n = all ? Math.floor((G.survival.raw[type] || 0) / PORTION_KG + 1e-6) : 1;
    if (n <= 0) return;
    this.cooking = { type, left: n, t: 0 };
    G.audio?.sizzle();
    this.renderCampfire();
  }

  updateOpticInfo(eq, bearing, isScope) {
    const info = eq.info;
    let idHtml = '';
    if (info && info.pending) idHtml = '<div class="scan">IDENTIFYING…</div>';
    else if (info) {
      idHtml = `<div class="nm">${info.name}</div><div class="sc">${info.sci}</div><div class="meta">${info.label} · ${info.dist} m · ${info.state}${info.aware > 0.35 ? ' · aware of you' : ''}</div>`;
    }
    if (isScope) {
      this.el['scope-info'].innerHTML = (info && !info.pending ? `${info.name.toUpperCase()} · ${info.dist} M · ${info.state.toUpperCase()}<br>` : '') + `${eq.scopeZoom}× · Hold Shift to steady`;
    } else {
      this.el['bino-range'].textContent = eq.range ? `${Math.round(eq.range)} m` : '— m';
      this.el['bino-bearing'].textContent = `${String(Math.round(bearing) % 360).padStart(3, '0')}°`;
      this.el['bino-zoom'].textContent = `${eq.binoZoom}×`;
      if (this.el['bino-id'].innerHTML !== idHtml) this.el['bino-id'].innerHTML = idHtml;
    }
  }

  updateMarkers() {
    const box = this.el.markers;
    if (!G.sandbox.revealAnimals) { if (box.childElementCount) box.innerHTML = ''; this.markerPool = []; return; }
    const cam = G.camera, v = new THREE.Vector3();
    const W = window.innerWidth, H = window.innerHeight;
    let i = 0;
    for (const a of G.animals.list) {
      if (a.state === S.DOWN) continue;
      v.copy(a.pos); v.y += a.sp.model.shoulderH * a.scale + 0.5;
      v.project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      let m = this.markerPool[i];
      if (!m) { m = document.createElement('div'); m.className = 'mk'; box.appendChild(m); this.markerPool.push(m); }
      m.style.display = '';
      m.style.left = `${(v.x * 0.5 + 0.5) * W}px`;
      m.style.top = `${(-v.y * 0.5 + 0.5) * H}px`;
      const txt = `${a.sp.name.split(' (')[0]} · ${Math.round(a.playerDist)}m`;
      if (m.textContent !== txt) m.textContent = txt;
      i++;
    }
    for (; i < this.markerPool.length; i++) this.markerPool[i].style.display = 'none';
  }

  // ---------- menus ----------
  bindMenus() {
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this.openMenu(b.dataset.open)));
    document.querySelectorAll('[data-action="resume"]').forEach((b) => b.addEventListener('click', () => this.resume()));
    document.querySelectorAll('[data-action="back"]').forEach((b) => b.addEventListener('click', () => this.back()));
    this.el['lock-hint'].addEventListener('click', () => this.resume());
    $('btn-clear-journal').addEventListener('click', () => { G.journal = []; saveProgress(); this.renderJournal(); });
    document.querySelectorAll('[data-action="mainmenu"]').forEach((b) => b.addEventListener('click', () => { G.savedYaw = G.player.yaw; G.savedPitch = G.player.pitch; this.showMainMenu(); }));
    $('hv-continue').addEventListener('click', () => this.resume());
    $('hv-inspect').addEventListener('click', () => { if (this.harvested) this.showInspect(this.harvested); });
    $('hv-guide').addEventListener('click', () => { if (this.harvested) { this.guideSel = this.harvested.species; this.openMenu('guide'); } });
    $('in-tag').addEventListener('click', () => this.tagAnimal());
    $('in-meat').addEventListener('click', () => this.harvestMeat());
    const meatClick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.give) { const [k, key, a] = b.dataset.give.split('|'); this.giveOrDrop(k, key, a); }
      else if (b.dataset.eat) { this.eatItem(b.dataset.eat, b.dataset.cooked === '1'); }
      else if (b.dataset.forage) { const r = G.survival.eatForage(b.dataset.forage); if (r) { G.audio?.eatSound(); this.toast(r.msg, 'info'); } }
      else if (b.dataset.use) { const m = G.survival.useItem(b.dataset.use); if (m) this.toast(m, 'good'); }
      else if (b.dataset.cook) this.startCooking(b.dataset.cook, false);
      else if (b.dataset.cookall) this.startCooking(b.dataset.cookall, true);
      if (G.menuOpen === 'pack') this.renderPack(); else this.renderCampfire();
    };
    $('pk-meat').addEventListener('click', meatClick);
    $('cf-meat').addEventListener('click', meatClick);
    $('cf-wood').addEventListener('click', () => {
      const f = this.fire, S = G.survival;
      if (!f || !f.lit || f.stove || S.wood <= 0) return;
      S.wood--;
      f.fuel = Math.min(MAX_FUEL, f.fuel + WOOD_HOURS);
      G.net?.fire(f);
      G.audio?.strike();
      this.renderCampfire();
    });
    $('cf-douse').addEventListener('click', () => { if (this.fire) { this.fire.lit = false; this.fire.fuel = 0; this.cooking = null; this.toast('You put out the fire.', 'info'); this.resume(); } });
    $('sl-options').addEventListener('click', (e) => { const b = e.target.closest('[data-hours]'); if (b) this.startSleep(parseFloat(b.dataset.hours)); });
    $('sf-continue').addEventListener('click', () => this.endSleep());
    $('sl-relax').addEventListener('click', () => {
      if (!this.sleepSpot) return;
      G.player.enterBed(this.sleepSpot);
      this.toast('You lie down on the bed. Rest slowly recovers. Press E to get up or Z to sleep.', 'info');
      this.resume();
    });
    $('minimap').addEventListener('click', () => this.openMenu('map'));
    $('btn-survival').addEventListener('click', () => $('mm-diff').classList.toggle('hidden'));
    this.bindPvp();
    document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => G.newGame('survival', b.dataset.diff)));
    $('dt-restart').addEventListener('click', () => { if (this.pvpOver) { G.leaving = true; location.href = location.pathname; } else if (G.net) G.pvpRespawn(); else G.restartGame(); });
    $('st-items').addEventListener('click', (e) => { const b = e.target.closest('[data-buy]'); if (b) this.buy(b.dataset.buy); const u = e.target.closest('[data-upgrade]'); if (u) this.upgradeWeapon(u.dataset.upgrade); });
    $('st-sell').addEventListener('click', (e) => { const b = e.target.closest('[data-sell]'); if (b) this.sellMeat(b.dataset.sell, b.dataset.cooked === '1', b.dataset.all === '1'); });
  }

  isOpen() { return G.menuOpen !== null; }

  openMenu(name) {
    if (name === 'sandbox' && G.mode === 'survival') { this.toast('The sandbox is not available in survival mode.', 'warn'); return; }
    if (G.inMainMenu) this.el.mainmenu.classList.add('hidden');
    for (const m of this.menus) $(m).classList.toggle('hidden', m !== name);
    G.menuOpen = name;
    G.menuOpenedAt = performance.now();
    this.el['lock-hint'].classList.add('hidden');
    G.input.unlock();
    if (name === 'guide') this.openGuide();
    if (name === 'journal') this.renderJournal();
    if (name === 'map') this.openMap();
    if (name === 'sandbox') this.syncSandbox();
    if (name === 'settings') this.syncSettings();
    if (name === 'pack') this.renderPack();
    if (name === 'custom') this.openCustom();
  }

  closeMenus() {
    for (const m of this.menus) $(m).classList.add('hidden');
    G.menuOpen = null;
  }

  back() {
    if (G.menuOpen === 'death') return;
    if (G.inMainMenu) { this.showMainMenu(); return; }
    if (['inspect', 'harvest', 'campfire', 'pack', 'sleep', 'store'].includes(G.menuOpen)) { this.resume(); return; }
    if (G.menuOpen && G.menuOpen !== 'pause') this.openMenu('pause');
    else this.resume();
  }

  resume() {
    if (G.inMainMenu) { this.showMainMenu(); return; }
    this.closeMenus();
    G.input.lock();
    // If the browser refuses the lock (e.g. right after Esc), offer a click target
    setTimeout(() => { if (!G.input.locked && !G.menuOpen) this.el['lock-hint'].classList.remove('hidden'); }, 300);
  }

  toggleMenu(name) {
    if (G.menuOpen === name) this.resume();
    else this.openMenu(name);
  }

  // ---------- settings ----------
  bindSettings() {
    const bind = (id, key, fmt, apply) => {
      const inp = $(id);
      inp.addEventListener('input', () => {
        settings[key] = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : parseFloat(inp.value);
        if (fmt) $(fmt.id).textContent = fmt.f(settings[key]);
        saveSettings();
        if (apply) apply();
      });
    };
    bind('s-sens', 'sensitivity', { id: 'v-sens', f: (v) => v.toFixed(2) });
    bind('s-fov', 'fov', { id: 'v-fov', f: (v) => `${v}°` });
    bind('s-vol', 'volume', { id: 'v-vol', f: (v) => `${Math.round(v * 100)}%` }, () => G.audio?.setVolume(settings.volume));
    bind('s-quality', 'quality', null, () => G.applyQuality && G.applyQuality());
    bind('s-invert', 'invertY');
    bind('s-bob', 'headBob');
    bind('s-fps', 'showFps');
  }

  syncSettings() {
    $('s-sens').value = settings.sensitivity; $('v-sens').textContent = settings.sensitivity.toFixed(2);
    $('s-fov').value = settings.fov; $('v-fov').textContent = `${settings.fov}°`;
    $('s-vol').value = settings.volume; $('v-vol').textContent = `${Math.round(settings.volume * 100)}%`;
    $('s-quality').value = settings.quality;
    $('s-invert').checked = settings.invertY;
    $('s-bob').checked = settings.headBob;
    $('s-fps').checked = settings.showFps;
  }

  // ---------- journal ----------
  renderJournal() {
    const st = G.stats;
    const harvests = G.journal.filter((e) => e.type === 'harvest').length;
    $('journal-stats').innerHTML = [
      [`${G.discovered.size}/${SPECIES_ORDER.length}`, 'Species'], [st.sightings, 'Sightings'], [st.tracksInspected, 'Tracks read'], [harvests, 'Harvests'],
      [st.shots ? `${Math.round((st.hits / st.shots) * 100)}%` : '—', 'Accuracy'],
    ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
    const list = $('journal-list');
    if (!G.journal.length) { list.innerHTML = '<div class="j-empty">No entries yet. Identify animals with binoculars (hold the view on them) or harvest one to fill your journal.</div>'; return; }
    list.innerHTML = G.journal.slice().reverse().map((e) => this.journalLine(e)).join('');
  }

  journalLine(e, compact = false) {
    if (e.type === 'poacher') return `<div class="j-entry"><span class="t">Day ${e.day} ${formatClock(e.time)}</span><span><b>Poacher</b> disarmed and driven off</span><span class="k harvest">poacher</span></div>`;
    const sp = SPECIES[e.species];
    if (!sp) return '';
    const extra = e.type === 'harvest' && e.weight ? ` · ${fmtWeight(e.weight)}, ~${e.age} yr` : '';
    const what = e.type === 'harvest'
      ? `<b>${sp.name}</b> (${e.label}) harvested at ${e.dist} m${e.clean ? ' — clean vital shot' : ''}${compact ? '' : extra}`
      : `<b>${sp.name}</b> (${e.label}) observed at ${e.dist} m`;
    const kind = e.type === 'harvest' && e.tagged ? 'tagged' : e.type;
    return `<div class="j-entry"><span class="t">Day ${e.day} ${formatClock(e.time)}</span><span>${what}${compact ? '' : `<span class="muted"> · ${WEATHER[e.weather]?.label || ''}</span>`}</span><span class="k ${e.type}">${kind}</span></div>`;
  }

  // ---------- sandbox ----------
  buildSandbox() {
    $('spawn-grid').innerHTML = SPECIES_ORDER.map((id) => `<button class="btn small" data-spawn="${id}">${SPECIES[id].name.split(' (')[0]}</button>`).join('');
    $('spawn-grid').addEventListener('click', (e) => {
      const id = e.target.dataset.spawn;
      if (!id) return;
      this.mgr(id).spawnNear(id, G.player.pos, G.player.yaw);
      this.toast(`Spawned ${SPECIES[id].name} ahead of you`, 'good');
    });
    $('pop-sliders').innerHTML = SPECIES_ORDER.map((id) => `<label>${SPECIES[id].name.split(' (')[0]} <span id="pv-${id}"></span><input type="range" min="0" max="20" step="1" data-pop="${id}"/></label>`).join('');
    $('pop-sliders').addEventListener('input', (e) => {
      const id = e.target.dataset.pop;
      if (!id) return;
      this.mgr(id).setPopulation(id, parseInt(e.target.value, 10));
      $(`pv-${id}`).textContent = e.target.value;
    });
    $('btn-clear-animals').addEventListener('click', () => {
      for (const id of SPECIES_ORDER) this.mgr(id).setPopulation(id, 0);
      G.animals.clearAll();
      G.birds.clearAll();
      this.syncSandbox();
      this.toast('All animals removed. Raise population sliders to bring them back.', 'info');
    });
    $('weather-chips').innerHTML = Object.keys(WEATHER).map((k) => `<button class="btn small" data-weather="${k}">${WEATHER[k].label}</button>`).join('');
    $('weather-chips').addEventListener('click', (e) => {
      const k = e.target.dataset.weather;
      if (!k) return;
      G.env.setWeather(k);
      this.syncSandbox();
    });
    const tInp = $('s-time');
    tInp.addEventListener('input', () => { G.env.time = parseFloat(tInp.value); $('v-time').textContent = formatClock(G.env.time); });
    const speeds = [[0, 'Paused'], [1, 'Normal'], [4, '4×'], [12, '12×'], [40, '40×']];
    $('speed-chips').innerHTML = speeds.map(([v, l]) => `<button class="btn small" data-speed="${v}">${l}</button>`).join('');
    $('speed-chips').addEventListener('click', (e) => {
      if (e.target.dataset.speed === undefined) return;
      G.env.timeScale = parseFloat(e.target.dataset.speed);
      this.syncSandbox();
    });
    const chk = (id, key) => $(id).addEventListener('change', (e) => { G.sandbox[key] = e.target.checked; });
    chk('sb-ammo', 'infiniteAmmo'); chk('sb-observer', 'observerMode'); chk('sb-reveal', 'revealAnimals');
    chk('sb-survival', 'survival'); chk('sb-poachers', 'poachers');
    $('btn-heal').addEventListener('click', () => { const S = G.survival; S.health = 100; S.food = 100; S.rest = 100; S.sick = 0; this.toast('Health, food and rest restored', 'good'); });
    $('btn-refill').addEventListener('click', () => { const a = G.equipment.ammo; a.rifle.mag = 5; a.rifle.reserve = 30; a.shotgun.mag = 5; a.shotgun.reserve = 30; a.pistol.mag = 6; a.pistol.reserve = 36; a.bow.reserve = 24; a.bait.reserve = 6; a.trapS.reserve = 6; a.trapM.reserve = 4; a.trapL.reserve = 3; this.toast('All ammunition, arrows, bait and traps refilled', 'good'); });
    $('btn-unlock').addEventListener('click', () => { SPECIES_ORDER.forEach((s) => G.discovered.add(s)); saveProgress(); this.toast('All Field Guide entries unlocked', 'good'); });
    $('tele-list').innerHTML = LOCATIONS.map((l, i) => `<button class="btn small" data-tele="${i}">${l.name}<span>${l.desc}</span></button>`).join('');
    $('tele-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tele]');
      if (!b) return;
      this.teleport(LOCATIONS[+b.dataset.tele]);
    });
    $('find-chips').innerHTML = SPECIES_ORDER.map((id) => `<button class="btn small" data-find="${id}">${SPECIES[id].name.split(' (')[0]}</button>`).join('');
    $('find-chips').addEventListener('click', (e) => {
      const id = e.target.dataset.find;
      if (!id) return;
      const P = G.player.pos;
      const a = this.mgr(id).nearest([id], P.x, P.z, 9999, (x) => x.state !== S.DOWN);
      if (!a) { this.toast(`No ${SPECIES[id].name} in the area — raise its population first.`, 'warn'); return; }
      // land ~70 m away, out of panic range, facing the animal
      const ang = Math.atan2(P.x - a.pos.x, P.z - a.pos.z);
      const x = a.pos.x + Math.sin(ang) * 70, z = a.pos.z + Math.cos(ang) * 70;
      this.teleport({ name: `near a ${SPECIES[id].name}`, x, z }, Math.atan2(-(a.pos.x - x), -(a.pos.z - z)));
    });
  }

  mgr(id) { return SPECIES[id].kind === 'bird' ? G.birds : G.animals; }

  teleport(loc, yaw) {
    const T = G.world.terrain;
    let { x, z } = loc;
    for (let i = 0; i < 10 && T.getHeight(x, z) < 0.2; i++) { x += 4; z += 3; }
    G.player.teleport(x, z);
    if (yaw !== undefined) G.player.yaw = yaw;
    G.player.pitch = 0;
    this.toast(`Travelled to ${loc.name}`, 'info');
    if (G.menuOpen) this.resume();
  }

  syncSandbox() {
    for (const id of SPECIES_ORDER) {
      const inp = document.querySelector(`[data-pop="${id}"]`);
      inp.value = this.mgr(id).population[id];
      $(`pv-${id}`).textContent = this.mgr(id).population[id];
    }
    document.querySelectorAll('[data-weather]').forEach((b) => b.classList.toggle('on', b.dataset.weather === G.env.weatherName));
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', parseFloat(b.dataset.speed) === G.env.timeScale));
    $('s-time').value = G.env.time; $('v-time').textContent = formatClock(G.env.time);
    $('sb-ammo').checked = G.sandbox.infiniteAmmo;
    $('sb-observer').checked = G.sandbox.observerMode;
    $('sb-reveal').checked = G.sandbox.revealAnimals;
    $('sb-survival').checked = G.sandbox.survival !== false;
    $('sb-poachers').checked = G.sandbox.poachers !== false;
  }

  // ---------- map ----------
  openMap() {
    if (!this.mapDrawn) { this.drawMap(); this.mapDrawn = true; }
    const ov = $('map-overlay');
    ov.innerHTML = LOCATIONS.map((l, i) => `<div class="map-loc" data-tele="${i}" style="left:${((l.x + HALF) / WORLD_SIZE) * 100}%;top:${((l.z + HALF) / WORLD_SIZE) * 100}%">${l.name}</div>`).join('')
      + this.mapPoiHtml()
      + '<div id="map-traps"></div><div id="map-drops"></div><div id="map-mates"></div><div class="map-player" id="map-player"></div><div id="map-animals"></div>';
    ov.onclick = (e) => { const b = e.target.closest('[data-tele]'); if (!b) return; if (G.mode === 'survival') { this.toast('No fast travel in survival mode — you have to walk.', 'warn'); return; } this.teleport(LOCATIONS[+b.dataset.tele]); };
  }

  updateMap() {
    const p = $('map-player');
    if (!p) return;
    const P = G.player;
    p.style.left = `calc(${((P.pos.x + HALF) / WORLD_SIZE) * 100}% - 7px)`;
    p.style.top = `calc(${((P.pos.z + HALF) / WORLD_SIZE) * 100}% - 11px)`;
    p.style.transform = `rotate(${yawToBearing(P.yaw)}deg)`;
    const md = $('map-drops');
    if (md) md.innerHTML = G.airdrops ? [...G.airdrops.drops.values()].map((d) => `<div class="map-airdrop" style="left:${((d.x + HALF) / WORLD_SIZE) * 100}%;top:${((d.z + HALF) / WORLD_SIZE) * 100}%"><span>Supply drop</span></div>`).join('') : '';
    const mt = $('map-traps');
    if (mt) {
      const label = { set: 'set', sprung: 'sprung', caught: 'caught!' };
      mt.innerHTML = G.traps ? [...G.traps.traps.values()].filter((t) => G.traps.ours(t)).map((t) => `<div class="map-trap ${t.state}" style="left:${((t.x + HALF) / WORLD_SIZE) * 100}%;top:${((t.z + HALF) / WORLD_SIZE) * 100}%"><span>${TRAP_KINDS[t.kind].size} trap · ${label[t.state]}</span></div>`).join('') : '';
    }
    const mm = $('map-mates');
    if (mm) mm.innerHTML = G.net ? G.net.list.filter((q) => q.mate && q.seen).map((q) => `<div class="map-mate${q.dead ? ' dead' : ''}" style="left:${((q.pos.x + HALF) / WORLD_SIZE) * 100}%;top:${((q.pos.z + HALF) / WORLD_SIZE) * 100}%"><span>${q.name.replace(/</g, '&lt;')}</span></div>`).join('') : '';
    const ab = $('map-animals');
    if (G.sandbox.revealAnimals) {
      ab.innerHTML = G.animals.list.filter((a) => a.state !== S.DOWN).map((a) => `<div class="map-animal" title="${a.sp.name}" style="left:${((a.pos.x + HALF) / WORLD_SIZE) * 100}%;top:${((a.pos.z + HALF) / WORLD_SIZE) * 100}%"></div>`).join('');
    } else ab.innerHTML = '';
  }

  // Icons for the big map. Stores standing together become one row of icons; a label is
  // left off where a named place (the fast-travel spots) already says what is there.
  mapPoiHtml() {
    const groups = [];
    for (const p of this.mapPois()) {
      const g = p.store && groups.find((q) => q.store && Math.hypot(q.x - p.x, q.z - p.z) < 40);
      if (g) { g.items.push(p); g.x = g.items.reduce((s, i) => s + i.x, 0) / g.items.length; g.z = g.items.reduce((s, i) => s + i.z, 0) / g.items.length; }
      else groups.push({ x: p.x, z: p.z, store: !!p.store, items: [p] });
    }
    return groups.map((g) => {
      const p = g.items[0];
      const named = LOCATIONS.some((l) => Math.hypot(l.x - g.x, l.z - g.z) < 16);
      const label = g.store ? g.items.map((i) => i.label).join(' · ') : p.label;
      const showLabel = p.house !== undefined ? (p.mine || p.color || !named) : !named;
      const icons = g.items.map((i) => `<img src="${mapIcon(i.kind, i.color).url}" alt="" title="${i.label}">`).join('');
      return `<div class="map-poi${p.mine ? ' mine' : ''}${named && showLabel ? ' above' : ''}" style="left:${((g.x + HALF) / WORLD_SIZE) * 100}%;top:${((g.z + HALF) / WORLD_SIZE) * 100}%"><div class="icons">${icons}</div>${showLabel ? `<span${p.color ? ` style="color:${p.color}"` : ''}>${label}</span>` : ''}</div>`;
    }).join('');
  }

  // Everything worth an icon, with PvP house owners worked out
  mapPois() {
    const net = G.net;
    return (G.world.pois || []).map((p) => {
      const q = { ...p, pin: false, mine: false, color: null };
      if (p.house !== undefined) {
        if (net && net.hostId !== undefined) {
          const o = net.ownerOf(p.house);
          if (o && o.me) Object.assign(q, { kind: 'home', label: 'Your house', pin: true, mine: true });
          else if (o) Object.assign(q, { kind: 'homestead', label: `${o.name}'s house`, color: hexCss(o.color || 0x888888), pin: true });
          else Object.assign(q, { kind: 'homestead', label: 'Empty cabin' });
        } else if (p.kind === 'home') Object.assign(q, { pin: true, mine: true });
      } else if (p.store) q.pin = true;
      return q;
    });
  }

  drawMap() {
    const cv = $('map-canvas'), ctx = cv.getContext('2d');
    const N = 320, T = G.world.terrain;
    const img = ctx.createImageData(N, N);
    const step = WORLD_SIZE / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -HALF + (i + 0.5) * step, z = -HALF + (j + 0.5) * step;
        const h = T.getHeight(x, z);
        let r, g, b;
        if (h < 0) {
          const d = clamp(-h / 2, 0, 1);
          r = 52 - d * 20; g = 88 - d * 25; b = 104 - d * 15;
        } else {
          const f = T.densityAt(x, z);
          r = 120 - f * 70; g = 132 - f * 55; b = 78 - f * 40;
          const hx = T.getHeight(x + 2, z) - T.getHeight(x - 2, z), hz = T.getHeight(x, z + 2) - T.getHeight(x, z - 2);
          const shade = clamp(1 + (-hx - hz) * 0.12, 0.6, 1.35);
          r *= shade; g *= shade; b *= shade;
          if (T.trailAt(x, z) < 1.8) { r = 150; g = 124; b = 88; }
          if (Math.abs((h % 5) - 2.5) > 2.35) { r *= 0.85; g *= 0.85; b *= 0.85; }
          if (h < 0.6) { r = 128; g = 116; b = 88; }
        }
        const k = (j * N + i) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = N;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
    // cabin and stand
    ctx.fillStyle = '#e8d6b0';
    const toPx = (x, z) => [((x + HALF) / WORLD_SIZE) * cv.width, ((z + HALF) / WORLD_SIZE) * cv.height];
    for (const c of G.world.cabins) {
      const [cx, cz] = toPx(c.x, c.z);
      const w = (c.W / WORLD_SIZE) * cv.width, h = (c.D / WORLD_SIZE) * cv.height;
      ctx.fillStyle = c.store ? "#d8c49a" : "#e8d6b0";
      ctx.fillRect(cx - w / 2, cz - h / 2, w, h);
    }
    ctx.fillStyle = '#ff9a4a';
    for (const f of G.world.fires) { const [fx, fz] = toPx(f.x, f.z); ctx.beginPath(); ctx.arc(fx, fz, 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = '600 14px Inter, sans-serif';
    ctx.fillText('N ↑', 12, 22);
  }

  // ---------- field guide ----------
  openGuide() {
    if (!G.discovered.has(this.guideSel)) {
      const first = SPECIES_ORDER.find((s) => G.discovered.has(s));
      if (first) this.guideSel = first;
    }
    const extra = this.stage.mount($('guide-stage'), { tools: true });
    extra.innerHTML = '<button class="btn small" id="btn-sex">Male / Female</button>';
    $('btn-sex').onclick = () => { this.guideSex = !this.guideSex; this.stage.show(this.guideSel, this.guideSex, 'stand'); };
    this.renderSpeciesList();
    this.selectSpecies(this.guideSel);
  }

  renderSpeciesList() {
    $('guide-count').textContent = `${G.discovered.size} of ${SPECIES_ORDER.length} species recorded`;
    $('species-list').innerHTML = SPECIES_ORDER.map((id) => {
      const head = id === MAMMAL_ORDER[0] ? '<div class="sp-head">Mammals</div>' : id === BIRD_ORDER[0] ? '<div class="sp-head">Birds</div>' : '';
      const known = G.discovered.has(id);
      const sp = SPECIES[id];
      return `<div class="sp-item ${known ? '' : 'locked'} ${id === this.guideSel ? 'active' : ''}" data-sp="${id}">
        <span class="tag">${known ? 'Recorded' : 'Unknown'}</span>
        <div class="n">${known ? sp.name : '???'}</div><div class="s">${known ? sp.sci : sp.family}</div></div>`.replace(/^/, head);
    }).join('');
    $('species-list').onclick = (e) => { const it = e.target.closest('[data-sp]'); if (it) this.selectSpecies(it.dataset.sp); };
  }

  selectSpecies(id) {
    this.guideSel = id;
    document.querySelectorAll('.sp-item').forEach((n) => n.classList.toggle('active', n.dataset.sp === id));
    const sp = SPECIES[id];
    const known = G.discovered.has(id);
    $('guide-locked').classList.toggle('hidden', known);
    $('g-family').textContent = sp.family;
    $('g-name').textContent = sp.name;
    $('g-sci').textContent = sp.sci;
    $('g-status').textContent = sp.status;
    $('g-status').classList.toggle('warn', !/Least Concern/.test(sp.status));
    const stats = [['Habitat', sp.habitat], ['Diet', sp.diet], ['Size', sp.size], ['Weight', sp.weight], ['Lifespan', sp.lifespan], ['Top speed', sp.speed], ['Activity', sp.activity]];
    $('g-stats').innerHTML = stats.map(([l, v]) => `<div><label>${l}</label>${v}</div>`).join('');
    $('g-facts').innerHTML = sp.facts.map((f) => `<li>${f}</li>`).join('');
    $('g-tracks').textContent = sp.tracks;
    $('g-anat').textContent = sp.anatomy.notes;
    const sexBtn = $('btn-sex');
    if (sexBtn) sexBtn.classList.toggle('hidden', !(sp.model.antlers || sp.model.tusks));
    this.guideSex = true;
    this.stage.show(id, true, 'stand');
  }

  // ---------- harvest card ----------
  showHarvest(a) {
    this.harvested = a;
    const sp = a.sp, h = a.harvest;
    this.openMenu('harvest');
    this.stage.mount($('harvest-stage'), { tools: false });
    this.stage.show(a.species, a.male, 'down');
    $('hv-kicker').textContent = `Harvest recorded · Day ${h.day}, ${formatClock(h.time)}`;
    $('hv-name').textContent = `${sp.name} · ${a.label}`;
    $('hv-sci').textContent = `${sp.sci} — ${sp.family}`;
    const rows = [
      ['Estimated weight', fmtWeight(a.weight)],
      ['Estimated age', `~${a.age} ${a.age === 1 ? 'year' : 'years'}`],
      ['Shot distance', `${h.dist} m`],
      ['Conditions', `${WEATHER[h.weather]?.label || ''}, ${formatClock(h.time)}`],
      ['Conservation', sp.status],
      ['Diet', sp.diet.split('.')[0]],
    ];
    $('hv-grid').innerHTML = rows.map(([l, v]) => `<div><label>${l}</label>${v}</div>`).join('');
    const where = { vitals: 'heart and lungs', head: 'head', neck: 'neck', body: 'body' }[h.part] || 'body';
    $('hv-shot').innerHTML = h.clean
      ? `<b>Clean shot through the ${where}.</b> A shot to the vital zone brings an animal down quickly and humanely.`
      : `<b>Hit in the ${where}.</b> The animal ran a short way before going down. Aiming just behind the front shoulder, at the heart and lungs, gives the quickest and most humane result.`;
    $('hv-shot').classList.toggle('clean', h.clean);
    const facts = sp.facts.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    $('hv-facts').innerHTML = facts.map((f) => `<li>${f}</li>`).join('');
  }

  // ---------- carcass inspection ----------
  showInspect(a) {
    this.inspected = a;
    const sp = a.sp, m = sp.model;
    this.openMenu('inspect');
    this.stage.mount($('inspect-stage'), { tools: true });
    this.stage.show(a.species, a.male, 'down');
    $('in-kicker').textContent = a.tagged ? 'Inspection · tagged' : 'Inspection';
    $('in-name').textContent = `${sp.name} · ${a.label}`;
    $('in-sci').textContent = `${sp.sci} — ${sp.family}`;
    const fmtLen = (v) => (v < 1 ? `${Math.round(v * 100)} cm` : `${v.toFixed(2)} m`);
    const rows = a.isBird ? [
      ['Sex', a.label],
      ['Estimated weight', fmtWeight(a.weight)],
      ['Length', fmtLen((m.bodyLen + m.neckLen * 0.6 + m.tailLen * 0.6) * a.scale)],
      ['Wingspan', fmtLen(m.wingSpan * a.scale)],
      ['Estimated age', `~${a.age} ${a.age === 1 ? 'year' : 'years'}`],
      ['Aged by', sp.stats.ageMethod],
    ] : [
      ['Sex', a.label],
      ['Estimated weight', fmtWeight(a.weight)],
      ['Body length', fmtLen((m.bodyLen + m.headLen * 0.8 + m.neckLen * 0.3) * a.scale)],
      ['Shoulder height', fmtLen(m.shoulderH * a.scale)],
      ['Estimated age', `~${a.age} ${a.age === 1 ? 'year' : 'years'}`],
      ['Aged by', sp.stats.ageMethod],
    ];
    const trophy = this.trophyFor(a);
    if (trophy) rows.splice(4, 0, trophy);
    if (a.harvest) rows.push(a.harvest.weapon === 'trap' ? ['Taken with', `${TRAP_KINDS[a.harvest.trap]?.name || 'A trap'}`] : ['Shot placement', a.harvest.clean ? 'Heart / lungs — clean' : 'Body']);
    $('in-grid').innerHTML = rows.map(([l, v]) => `<div><label>${l}</label>${v}</div>`).join('');
    $('in-notes').innerHTML = (sp.inspect || []).map((t) => `<li>${t}</li>`).join('');
    $('in-anat').textContent = sp.anatomy.notes;
    $('in-tag').textContent = a.tagged ? 'Tagged' : 'Tag & record';
    $('in-tag').disabled = a.tagged;
    const meatBtn = $('in-meat');
    if (this.skinning && this.skinning.a !== a) this.skinning = null;
    meatBtn.disabled = !sp.meat || a.meatTaken || !!this.skinning;
    meatBtn.textContent = a.meatTaken ? 'Meat harvested' : !sp.meat ? 'Meat not eaten' : !a.skinned ? `${a.isBird ? 'Pluck' : 'Skin'} the ${sp.name.toLowerCase()}` : `Harvest ${sp.meat.toLowerCase()}`;
    const note = $('in-meat-note');
    const noteText = a.meatTaken ? 'You have taken the meat. Cook it on a campfire before eating.'
      : !sp.meat ? `The ${sp.name.toLowerCase()} is not normally hunted for food. You can still record and tag it.`
      : !a.skinned ? (a.isBird ? 'Before you can take the meat you have to pluck and clean the bird with your knife.' : 'Before you can take the meat you have to skin and gut the carcass with your knife. It takes a while on a big animal.')
      : 'The carcass is skinned and gutted. Now cut the meat.';
    note.classList.toggle('hidden', !noteText);
    note.innerHTML = noteText;
  }

  trophyFor(a) {
    const t = a.sp.trophy;
    if (!t) return null;
    const r = (lo, hi) => lo + (a.scale - 0.9) / 0.2 * (hi - lo);
    if (!a.trophyVal) {
      a.trophyVal = {
        points: Math.max(2, Math.round(r(4, 10) + Math.random() * 2)) & ~1,
        spread: Math.round(r(95, 150)),
        tusks: Math.round(r(5, 11)),
        horns: Math.round(r(38, 52)),
        curl: Math.round(r(55, 100) / 25) * 25,
        hornlen: Math.round(r(28, 42)),
      };
    }
    const v = a.trophyVal;
    if (!a.male && t !== 'horns' && t !== 'curl') return null;
    switch (t) {
      case 'points': return ['Antlers', `${v.points} points (${v.points / 2} per side)`];
      case 'spread': return ['Antler spread', `${v.spread} cm`];
      case 'tusks': return ['Tusk length', `~${v.tusks} cm`];
      case 'horns': return ['Horn length', `~${a.male ? v.horns : Math.round(v.horns * 0.8)} cm`];
      case 'curl': return ['Horns', a.male ? `${v.curl}% curl` : 'Short, slightly curved (ewe)'];
      case 'hornlen': return ['Horn length', `~${v.hornlen} cm`];
      default: return null;
    }
  }

  harvestMeat() {
    const a = this.inspected;
    if (!a || !a.sp.meat || a.meatTaken || this.skinning) return;
    if (!a.skinned) {
      // skinning takes longer the bigger the animal
      this.skinning = { a, t: 0, cut: 0, dur: a.isBird ? 2.5 : clamp(3 + a.weight / 70, 3.5, 9) };
      $('in-meat').disabled = true;
      return;
    }
    G.net?.tag(a, true);
    const yieldFrac = a.isBird ? 0.5 : 0.38;
    const available = a.weight * yieldFrac;
    const got = G.survival.addRaw(a.sp.meat, available);
    if (got <= 0) { this.toast(`Your pack is full (${G.survival.capacity()} kg). Cook and eat some meat first.`, 'warn'); return; }
    a.meatTaken = true;
    const left = available - got;
    this.toast(`You field-dress the ${a.sp.name.toLowerCase()} and pack ${got.toFixed(1)} kg of ${a.sp.meat.toLowerCase()}${left > 0.5 ? ` (you can only carry ${G.survival.capacity()} kg in total)` : ''}.`, 'good');
    this.showInspect(a);
  }

  tagAnimal() {
    const a = this.inspected;
    if (!a || a.tagged) return;
    a.tagged = true;
    G.net?.tag(a);
    if (a.harvest) a.harvest.tagged = true;
    saveProgress();
    this.toast(`${a.sp.name} tagged and recorded in your journal.`, 'good');
    this.resume();
  }

  // ---------- sleeping ----------
  showSleep(spot) {
    if (G.net) {
      // the world cannot be fast-forwarded with other players in it
      if (!G.player.inBed) G.player.enterBed(spot);
      this.toast('PvP: the forest does not stop while you sleep. You rest in real time here (three times faster in bed) — shut the door first.', 'info');
      return;
    }
    this.sleepSpot = spot;
    this.openMenu('sleep');
    const now = G.env.time;
    const until = (target) => ((target - now) % 24 + 24) % 24 || 24;
    $('sl-title').textContent = `Sleep in ${spot.name}`;
    $('sl-now').textContent = `It is ${formatClock(now)}. How long do you want to sleep?`;
    const opts = [
      [2, '2 hours', 'A short nap'],
      [4, '4 hours', 'Rest until later'],
      [8, '8 hours', 'A full night\'s sleep'],
      [until(5.5), 'Until dawn', `Wake at 05:30 for the first light`],
      [until(17.5), 'Until dusk', 'Wake at 17:30 when animals stir'],
      [until(12), 'Until midday', 'Wake at 12:00'],
    ];
    $('sl-options').innerHTML = opts.map(([h, l, d], i) => `<button class="btn ${i === 2 ? 'primary' : ''}" data-hours="${h.toFixed(3)}">${l}<small>${d} · ${h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(h % 1 ? 1 : 0) + ' h'}</small></button>`).join('');
  }

  startSleep(hours) {
    this.closeMenus();
    const env = G.env;
    // one simulation step = 0.1 s of game time at normal speed
    const steps = Math.round((hours * env.daySeconds / 24) / 0.1);
    this.lastSleepHours = hours;
    G.sleep = { steps, total: steps, delay: 0.9, hours, prevObserver: G.sandbox.observerMode, wakeAt: (env.time + hours) % 24 };
    // an open door invites predators in, especially at night
    const sp = this.sleepSpot;
    const cab = sp && G.world.cabins.find((c) => c.x === sp.cabinX && c.z === sp.cabinZ);
    if (cab && cab.door && cab.door.open) {
      if (cab.home && G.cabin?.has('fortify')) {
        G.world.setDoor(cab.door, false);
        this.toast('The heavy iron-bound door swings shut and latches behind you.', 'info');
      } else if (G.cfg && G.sandbox.survival !== false) {
        let nightH = 0;
        for (let h = 0; h < hours; h += 0.25) { const tt = (env.time + h) % 24; if (tt >= 20 || tt < 6) nightH += 0.25; }
        const rate = (0.3 * nightH + 0.06 * (hours - nightH)) * G.cfg.predator;
        if (Math.random() < 1 - Math.exp(-rate)) G.sleep.intruder = { at: Math.floor(steps * Math.random() * 0.8), cabin: cab };
      }
    }
    G.sandbox.observerMode = true; // animals don't react to you while you're indoors
    this.hideTrack();
    $('sf-title').textContent = `Sleeping in ${this.sleepSpot ? this.sleepSpot.name : 'the cabin'}…`;
    $('sf-continue').classList.add('hidden');
    $('sf-bar').style.width = '0%';
    $('sf-clock').textContent = formatClock(env.time);
    const fade = $('sleep-fade');
    fade.classList.remove('hidden');
    requestAnimationFrame(() => fade.classList.add('show'));
  }

  updateSleep() {
    const sl = G.sleep;
    $('sf-clock').textContent = formatClock(G.env.time);
    $('sf-bar').style.width = `${Math.round((1 - sl.steps / sl.total) * 100)}%`;
  }

  finishSleep() {
    const sl = G.sleep;
    G.sandbox.observerMode = sl.prevObserver;
    G.player.stamina = 1;
    const day = G.env.day;
    $('sf-title').textContent = `You slept ${sl.hours >= 1 ? sl.hours.toFixed(sl.hours % 1 ? 1 : 0) + ' hours' : Math.round(sl.hours * 60) + ' minutes'} and feel rested`;
    $('sf-clock').textContent = `${formatClock(G.env.time)} · Day ${day}`;
    $('sf-bar').style.width = '100%';
    $('sf-continue').classList.remove('hidden');
    sl.done = true;
  }

  endSleep() {
    const fade = $('sleep-fade');
    fade.classList.remove('show');
    setTimeout(() => fade.classList.add('hidden'), 800);
    if (this.collapsing) {
      this.collapsing = false;
      G.menuOpen = null;
      const bed = G.world.restSpots[0];
      G.player.inBed = null;
      G.player.teleport(bed.x, bed.z, bed.floor + 0.03);
      G.survival.revive();
      G.env.time += 6; if (G.env.time >= 24) { G.env.time -= 24; G.env.day++; } G.env.totalHours += 6;
      this.toast('You wake in the cabin six hours later, weak and sore. Eat, rest and keep out of poachers\' sight.', 'warn');
      this.resume();
      return;
    }
    G.sleep = null;
    G.survival?.slept(this.lastSleepHours || 0);
    const env = G.env;
    this.toast(`${formatClock(env.time)} — ${WEATHER[env.weatherName].label.toLowerCase()} outside. ${env.isNight() ? 'It is still dark.' : env.time < 9 ? 'Animals are active around dawn.' : env.time > 17 ? 'Dusk is a good time to watch for wildlife.' : ''}`, 'info');
    this.resume();
  }

  // ---------- stores ----------
  showStore(store) {
    this.store = store;
    this.openMenu('store');
    this.renderStore();
  }

  renderStore() {
    const def = STORES[this.store.id], S = G.survival, eq = G.equipment, cfg = G.cfg;
    const free = G.mode !== 'survival';
    $('st-kicker').textContent = def.kicker || `Trading post · talking to ${def.vendor}`;
    $('st-name').textContent = def.name;
    $('st-money').textContent = free ? 'Free roam: everything is free' : `Your money: $${S.money}`;
    $('st-items').innerHTML = def.items.map((it) => {
      const owned = it.upgrade ? G.cabin.has(it.id) : it.once && eq.owned[it.id];
      const needs = it.needs && (it.upgrade ? !G.cabin.has(it.needs) : !eq.owned[it.needs]);
      const price = free ? 0 : priceOf(it, cfg);
      const verb = it.upgrade ? 'Build' : 'Buy';
      const label = owned ? (it.upgrade ? 'Built' : RARITY_WEAPONS.includes(it.id) ? `Owned · ${RARITY[eq.tier(it.id)].name}` : 'Owned') : needs ? (it.upgrade ? `Needs ${def.items.find((x) => x.id === it.needs).name.split(' · ')[0].toLowerCase()}` : `Needs ${WEAPONS[it.needs].short.toLowerCase()}`) : price ? `${verb} $${price}` : (it.upgrade ? 'Build' : 'Take');
      const disabled = owned || needs || price > S.money;
      return `<div class="meat-row ${owned ? 'locked' : ''}"><span>${it.name}<br><small>${it.desc || ''}</small></span><span class="acts"><button class="btn small ${disabled ? '' : 'primary'}" data-buy="${it.id}" ${disabled ? 'disabled' : ''}>${label}</button></span></div>`;
    }).join('');
    if (this.store.id === 'gun') {
      const ups = RARITY_WEAPONS.filter((w) => eq.owned[w] && eq.tier(w) < 4).map((w) => {
        const next = eq.tier(w) + 1, R = RARITY[next];
        const price = free ? 0 : Math.round(UPGRADE_PRICE[next] * cfg.prices);
        const dis = price > S.money;
        return `<div class="meat-row"><span>Upgrade your ${WEAPONS[w].short.toLowerCase()} to <b style="color:${R.css}">${R.name}</b><br><small>+${Math.round((R.dmg - 1) * 100)}% damage, ${Math.round((1 - R.spread) * 100)}% tighter shots, ${Math.round((1 - R.speed) * 100)}% faster${R.mag ? `, +${R.mag} round${R.mag > 1 ? 's' : ''}` : ''}</small></span><span class="acts"><button class="btn small ${dis ? '' : 'primary'}" data-upgrade="${w}" ${dis ? 'disabled' : ''}>${price ? `Upgrade $${price}` : 'Upgrade'}</button></span></div>`;
      });
      if (ups.length) $('st-items').insertAdjacentHTML('beforeend', '<h4 style="margin:10px 0 4px">Weapon upgrades</h4>' + ups.join(''));
    }
    const sellWrap = $('st-sell-wrap');
    sellWrap.style.display = def.buysMeat ? '' : 'none';
    if (def.buysMeat) {
      const rows = [];
      for (const [cooked, store] of [[false, S.raw], [true, S.cooked]]) {
        for (const [type, kg] of Object.entries(store)) {
          const per = this.meatPrice(type, cooked);
          rows.push(`<div class="meat-row"><span>${cooked ? 'Cooked' : 'Raw'} ${type.toLowerCase()} <small>${kg.toFixed(1)} kg · $${per}/kg</small></span><span class="acts"><button class="btn small" data-sell="${type}" data-cooked="${cooked ? 1 : 0}">Sell ${PORTION_KG} kg</button><button class="btn small primary" data-sell="${type}" data-cooked="${cooked ? 1 : 0}" data-all="1">Sell all $${Math.round(per * kg)}</button></span></div>`);
        }
      }
      $('st-sell').innerHTML = rows.join('') || '<div class="meat-empty">You have no meat to sell. Hunt game, inspect it and harvest the meat.</div>';
    }
    $('st-note').textContent = this.store.id === 'cabin' ? `Upgrades built: ${G.cabin.count()} of ${def.items.length}. Each one appears in and around the cabin straight away.` : this.store.id === 'locker' ? 'Same prices as the gunsmith in town.' : this.store.id === 'gun' ? 'This is the only place to restock ammunition. Rifles take any game; bows are silent; shotguns are for birds.' : this.store.id === 'butcher' ? 'The butcher pays more for cooked meat.' : 'Medical supplies can save your life — first-aid kits treat poisoning.';
  }

  upgradeWeapon(w) {
    const eq = G.equipment, S = G.survival;
    if (!eq.owned[w] || eq.tier(w) >= 4) return;
    const next = eq.tier(w) + 1;
    const price = G.mode === 'survival' ? Math.round(UPGRADE_PRICE[next] * G.cfg.prices) : 0;
    if (price > S.money) return;
    S.money -= price;
    eq.setRarity(w, next);
    G.audio?.strike();
    this.lootBanner(next, `${RARITY[next].name} ${WEAPONS[w].name.split(' · ')[0]}`, 'The gunsmith reworks your weapon.');
    this.renderStore();
  }

  // Big centre banner when you get a weapon of some rarity
  lootBanner(tier, title, line) {
    const R = RARITY[tier], el = $('loot-banner');
    el.innerHTML = `<div class="lb-tier" style="color:${R.css}">${'★'.repeat(tier + 1)} ${R.name}</div><div class="lb-title">${title}</div><div class="lb-line">${line}</div>`;
    el.style.setProperty('--rar', R.css);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._lbT);
    this._lbT = setTimeout(() => el.classList.remove('show'), tier >= 3 ? 4200 : 3000);
    if (tier >= 3) G.audio?.bowShot?.();
  }

  meatPrice(type, cooked) {
    return Math.round((MEAT_PRICE[type] || 5) * (cooked ? 1.4 : 1) * (G.cfg ? G.cfg.sell : 1) * (G.cabin?.has('lodge') ? 1.1 : 1));
  }

  buy(id) {
    const def = STORES[this.store.id], it = def.items.find((x) => x.id === id), S = G.survival, eq = G.equipment;
    const price = G.mode === 'survival' ? priceOf(it, G.cfg) : 0;
    if (price > S.money || (it.upgrade ? G.cabin.has(id) : it.once && eq.owned[id])) return;
    if (id === 'cooked' && S.space() < PORTION_KG) { this.toast('Your pack is full.', 'warn'); return; }
    if (it.needs && (it.upgrade ? !G.cabin.has(it.needs) : !eq.owned[it.needs])) return;
    S.money -= price;
    if (it.upgrade) {
      G.cabin.build(id);
      G.net?.upgrade(id);
      G.audio?.strike();
      this.toast(`Built: ${it.name}. ${it.desc.split('. ').slice(1).join('. ')}`, 'good');
      this.renderStore();
      return;
    }
    const key = ITEMS.indexOf(id) + 1;
    if (WEAPONS[id] && it.once) {
      eq.owned[id] = true;
      const W = WEAPONS[id];
      eq.setRarity(id, 0);
      if (W.gun) eq.ammo[id].mag = eq.magSize(id);
      if (id === 'bow') eq.ammo.bow.reserve += 6;
      if (W.gun || W.bow) eq.select(id);
      this.toast(`${it.name.split(' (')[0].split(' +')[0]} bought. Press ${key} to equip it.`, 'good');
    } else if (it.ammo) {
      eq.ammo[it.ammo].reserve += it.count;
      if (it.ammo === 'bait') eq.owned.bait = true;
      if (it.ammo.startsWith('trap')) eq.owned.trap = true;
      this.toast(`+${it.count} ${WEAPONS[it.ammo].ammo}.`, 'good');
    } else if (id === 'cooked') { S.cooked.Venison = (S.cooked.Venison || 0) + PORTION_KG; this.toast('Bought 0.5 kg of cooked venison.', 'good'); }
    else { S.items[id] = (S.items[id] || 0) + 1; this.toast(`Bought: ${it.name}.`, 'good'); }
    G.audio?.strike();
    this.renderStore();
  }

  sellMeat(type, cooked, all) {
    const S = G.survival;
    const store = cooked ? S.cooked : S.raw;
    const kg = all ? (store[type] || 0) : Math.min(PORTION_KG, store[type] || 0);
    if (kg <= 0) return;
    S.take(store, type, kg);
    const pay = Math.round(this.meatPrice(type, cooked) * kg);
    S.money += pay;
    G.stats.earned = (G.stats.earned || 0) + pay;
    this.toast(`Sold ${kg.toFixed(1)} kg of ${cooked ? 'cooked ' : ''}${type.toLowerCase()} for $${pay}.`, 'good');
    this.renderStore();
  }

  // Attacking a shopkeeper is fatal: they keep a loaded gun under the counter
  shopkeeperShoots(store) {
    const S = G.survival;
    if (!S || S.dead) return;
    const def = STORES[store.id];
    G.audio?.shotgunShot?.();
    S.health = 0;
    S.lastHurt = performance.now();
    S.die(`Shot dead by ${def.vendor} after you attacked them in the ${def.name.toLowerCase()}`);
  }

  // A predator wandered in through the open door while you slept
  intruderWake() {
    const sl = G.sleep, P = G.player, cab = sl.intruder.cabin;
    const doneHours = sl.hours * (1 - sl.steps / sl.total);
    G.sandbox.observerMode = sl.prevObserver;
    G.sleep = null;
    G.survival?.slept(doneHours);
    const fade = $('sleep-fade');
    fade.classList.remove('show');
    setTimeout(() => fade.classList.add('hidden'), 400);
    const night = G.env.isNight();
    const pool = night ? ['wolf', 'wolf', 'cougar', 'coyote', 'bear'] : ['coyote', 'bear', 'wolf'];
    const want = pool[Math.floor(Math.random() * pool.length)];
    const d = cab.door;
    const list = G.animals.list.filter((a) => a.active !== false && a.state !== 'down');
    let a = list.filter((x) => x.species === want).sort((p, q) => Math.hypot(p.pos.x - d.x, p.pos.z - d.z) - Math.hypot(q.pos.x - d.x, q.pos.z - d.z))[0];
    if (!a) a = list.filter((x) => ['wolf', 'cougar', 'coyote', 'bear'].includes(x.species))[0];
    if (P.inBed) P.leaveBed();
    if (a) {
      // put it just inside the doorway, facing the bed
      const ix = cab.x - d.x, iz = cab.z - d.z, l = Math.hypot(ix, iz) || 1;
      a.pos.set(d.x + (ix / l) * 1.0, cab.floor, d.z + (iz / l) * 1.0);
      a.heading = Math.atan2(P.pos.x - a.pos.x, P.pos.z - a.pos.z);
      a.syncTransform();
      a.awareness = 1;
      a.startAttack(false);
      const dmg = (a.species === 'bear' || a.species === 'cougar' ? 28 : a.species === 'wolf' ? 20 : 12) * (G.cfg ? G.cfg.predDmg : 1);
      G.survival?.damage(dmg, a.pos, `Mauled in your sleep by a ${a.sp.name.toLowerCase()} — the cabin door was left open`);
      G.audio?.growl?.(a.pos, a.species);
      if (!G.survival?.dead) this.toast(`You wake to a ${a.sp.name.toLowerCase()} biting you! You left the cabin door open and it wandered in. Fight it off or get out!`, 'warn');
    }
    if (!G.survival?.dead) this.resume();
  }

  // ---------- death ----------
  showDeath(cause) {
    G.menuOpen = 'death';
    G.input.unlock();
    this.closeMenus();
    G.menuOpen = 'death';
    const harvests = G.journal.filter((e) => e.type === 'harvest').length;
    $('dt-cause').textContent = cause;
    if (G.net && !this.pvpOver) { G.drops?.deathBag(G.net.name); G.net.onLocalDeath(cause); }
    $('death').querySelector('p.muted').textContent = G.net ? 'Your gear, meat and supplies are in a bag where you fell — you or a teammate can pick it up. Whoever killed you took your money.' : 'Everything starts over from zero: your journal, money and gear are gone.';
    $('dt-restart').textContent = this.pvpOver ? 'Back to the menu' : G.net ? 'Respawn' : 'Start over';
    $('dt-stats').innerHTML = [[G.env.day, 'Days'], [harvests, 'Harvests'], [G.discovered.size, 'Species'], [G.mode === 'survival' ? '$' + (G.stats.earned || 0) : '—', 'Earned']]
      .map(([b, t]) => `<div><b>${b}</b><span>${t}</span></div>`).join('');
    this.el.hud.classList.add('hidden');
    $('death').classList.remove('hidden');
    G.audio?.hurt();
  }

  hideDeath() {
    $('death').classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    G.menuOpen = null;
    this.resume();
  }

  // ---------- customize your hunter ----------
  openCustom() {
    const c = this.cust || this.initCustom();
    c.look = loadLook();
    c.avatar.setLook(c.look);
    this.renderCustomOptions();
    c.resize();
  }

  initCustom() {
    const canvas = $('custom-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3a2a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshLambertMaterial({ color: 0x3a4a2a }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(0, 1.25, 4.4);
    camera.lookAt(0, 1.0, 0);
    const avatar = makeAvatar(loadLook());
    scene.add(avatar.root);
    const c = { renderer, scene, camera, avatar, look: loadLook(), item: 'rifle', aim: false, yaw: 0.5, drag: null, t: 0 };
    c.resize = () => {
      const w = canvas.clientWidth || 320, h = canvas.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    canvas.addEventListener('pointerdown', (e) => { c.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (c.drag !== null) { c.yaw += (e.clientX - c.drag) * 0.012; c.drag = e.clientX; } });
    canvas.addEventListener('pointerup', () => { c.drag = null; });
    $('custom-opts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-look]');
      if (!b) return;
      c.look[b.dataset.look] = b.dataset.val;
      this.applyLook(c.look);
    });
    $('custom-hold').addEventListener('click', (e) => {
      const b = e.target.closest('[data-hold]');
      if (!b) return;
      if (b.dataset.hold === 'aim') c.aim = !c.aim; else c.item = b.dataset.hold;
      this.renderCustomOptions();
    });
    $('custom-random').addEventListener('click', () => { c.look = sanitizeLook(randomLook()); this.applyLook(c.look); });
    window.addEventListener('resize', () => { if (G.menuOpen === 'custom') c.resize(); });
    this.cust = c;
    return c;
  }

  applyLook(look) {
    const c = this.cust;
    c.look = sanitizeLook(look);
    saveLook(c.look);
    c.avatar.setLook(c.look);
    G.equipment?.setSleeveColor(lookColor('jacket', c.look.jacket));
    G.net?.sendLook();
    this.renderCustomOptions();
  }

  renderCustomOptions() {
    const c = this.cust;
    const swatch = (hex) => (hex !== undefined ? `<i class="sw" style="background:#${hex.toString(16).padStart(6, '0')}"></i>` : '');
    $('custom-opts').innerHTML = Object.keys(LOOK_OPTIONS).map((k) => {
      if (k === 'hatColor' && c.look.hat === 'none' && !c.avatar.isModel) return '';
      // the hunter model has its own cap, hair, beard and pack
      if (c.avatar.isModel && (k === 'hat' || k === 'hair' || k === 'beard' || k === 'pack')) return '';
      return `<div class="cust-row"><h4>${LOOK_LABELS[k]}</h4><div class="chips">${LOOK_OPTIONS[k].map(([id, label, hex]) => `<button class="chip ${c.look[k] === id ? 'on' : ''}" data-look="${k}" data-val="${id}">${swatch(hex)}${label}</button>`).join('')}</div></div>`;
    }).join('');
    const items = [['rifle', 'Rifle'], ['shotgun', 'Shotgun'], ['pistol', 'Revolver'], ['bow', 'Bow'], ['knife', 'Knife'], ['binoculars', 'Binoculars']];
    $('custom-hold').innerHTML = items.map(([id, l]) => `<button class="chip ${c.item === id ? 'on' : ''}" data-hold="${id}">${l}</button>`).join('') +
      `<button class="chip aim ${c.aim ? 'on' : ''}" data-hold="aim">${c.aim ? 'Aiming' : 'Aim'}</button>`;
  }

  renderCustom(dt) {
    const c = this.cust;
    if (!c) return;
    c.t += dt;
    if (c.drag === null) c.yaw += dt * 0.25;
    if (!c.avatar.isModel && hunterReady()) { c.scene.remove(c.avatar.root); c.avatar.dispose(); c.avatar = makeAvatar(c.look); c.scene.add(c.avatar.root); this.renderCustomOptions(); }
    c.avatar.root.rotation.y = c.yaw;
    const drawing = c.aim && c.item === 'bow';
    c.avatar.update(dt, { pitch: c.aim ? 0.05 : 0, aim: c.aim ? 1 : 0, draw: drawing ? 1 : 0, item: c.item, tier: G.equipment && G.equipment.owned[c.item] ? G.equipment.tier(c.item) : 0, moving: false, crouch: false, dead: false, swimming: false });
    c.renderer.render(c.scene, c.camera);
  }

  // ---------- PvP ----------
  bindPvp() {
    const status = (t, err = false) => { $('pvp-status').textContent = t; $('pvp-status').classList.toggle('pvp-err', err); };
    const NO_SERVER = 'PvP can\'t run on this shared claude.ai page: it needs the game server on your computer. Open the HuntingSimulator folder, double-click start.bat, and play from the browser tab it opens. Friends join from the address it prints. (If a start.bat window is already open from before, close it and run start.bat again so the new server starts.)';
    let server = null; // null = not checked yet
    const checkServer = async () => {
      if (server) return server;
      try { const r = await fetch('/pvp/info'); const j = await r.json(); server = j && j.ok ? j : false; } catch { server = false; }
      return server;
    };
    const needServer = async () => {
      if (await checkServer()) return true;
      status(NO_SERVER, true);
      this.toast('PvP needs the game server on your computer. Run start.bat and play from there.', 'warn');
      return false;
    };
    const nameOf = () => { const n = $('pvp-name').value.trim().slice(0, 16) || 'Hunter'; try { localStorage.setItem('whs.pvpname', n); } catch { /* ignore */ } return n; };
    try { $('pvp-name').value = localStorage.getItem('whs.pvpname') || ''; } catch { /* ignore */ }
    const go = (pvp) => { try { sessionStorage.setItem('whs.pending', JSON.stringify({ pvp })); } catch { /* ignore */ } G.leaving = true; location.reload(); };
    $('btn-pvp').addEventListener('click', async () => {
      $('mm-pvp').classList.toggle('hidden');
      if ($('mm-pvp').classList.contains('hidden')) return;
      const info = await checkServer();
      if (!info) { status(NO_SERVER, true); return; }
      const here = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      status(info.lan.length ? (here ? `Friends on your Wi-Fi open http://${info.lan[0]}:${info.port} and join with your code.` : 'Connected to the game server.') : 'Server ready.');
    });
    $('pvp-host').addEventListener('click', async () => {
      if (!(await needServer())) return;
      status('Starting your game…');
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      let code = '';
      for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
      go({ role: 'host', code, seed: Math.floor(Math.random() * 4294967295), name: nameOf() });
    });
    $('pvp-join').addEventListener('click', async () => {
      const code = $('pvp-code').value.trim().toUpperCase();
      if (!(await needServer())) return;
      if (code.length < 4) { status('Enter the 4-letter code from the host.', true); return; }
      status('Looking for the game…');
      try {
        const r = await fetch('/pvp/room?code=' + encodeURIComponent(code));
        const info = await r.json();
        if (!info.ok) { status(info.error, true); return; }
        go({ role: 'join', code: info.code, seed: info.seed, name: nameOf() });
      } catch { status('Could not reach the game server.', true); }
    });
  }

  showPvpHud(on) { $('pvp-hud').classList.toggle('hidden', !on); $('chat').classList.toggle('hidden', !on); }

  // ---------- PvP chat (Y) ----------
  openChat() {
    if (!G.net || this.chatOpen) return;
    if (!this.chatBound) {
      this.chatBound = true;
      $('chat-input').addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.closeChat(true); } else if (e.key === 'Escape') { e.preventDefault(); this.closeChat(false); }
      });
      // Esc while the mouse is captured releases it (and pauses): drop the half-typed message
      document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.chatOpen && !G.input.fallback) this.closeChat(false); });
    }
    this.chatOpen = true; G.chatOpen = true;
    G.input.keys.clear(); G.input.left = G.input.right = false; // don't keep walking or aiming while typing
    $('chat').classList.add('open');
    const inp = $('chat-input');
    inp.classList.remove('hidden');
    inp.value = '';
    inp.focus();
  }

  closeChat(send) {
    if (!this.chatOpen) return;
    const inp = $('chat-input');
    const text = inp.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
    if (send && text) {
      const now = performance.now();
      if (now - (this.chatSentAt || 0) < 700) this.chatLine(null, 'Slow down a little.', true);
      else { this.chatSentAt = now; G.net.chat(text); this.chatLine({ name: G.net.name + ' (you)', color: '#d9a85b' }, text); }
    }
    inp.value = ''; inp.blur(); inp.classList.add('hidden');
    $('chat').classList.remove('open');
    this.chatOpen = false; G.chatOpen = false;
    G.input.keys.clear();
  }

  // one line in the chat log: who (null for a system line) and what
  chatLine(who, text, sys = false) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = 'cl' + (sys ? ' sys' : '');
    if (who) { const b = document.createElement('b'); b.textContent = who.name + ':'; b.style.color = who.color; el.appendChild(b); }
    el.appendChild(document.createTextNode(text));
    log.appendChild(el);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => el.classList.add('faded'), 12000);
    if (!sys) G.audio?.uiTick?.();
  }

  updatePvpHud() {
    const n = G.net;
    if (!n) return;
    const txt = `PvP · game ${n.code}${n.isHost ? ' (host)' : ''} · ${n.players.size + 1} players${n.team.size ? ` · team of ${n.team.size + 1}` : ''} · ${n.kills} kills · <kbd>Tab</kbd> scores`;
    if (this._pvpTxt !== txt) { $('pvp-hud').innerHTML = txt; this._pvpTxt = txt; }
  }

  updateBoard(show) {
    const el = $('pvp-board');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const n = G.net;
    const rows = [{ name: n.name + ' (you)', kills: n.kills, deaths: n.deaths, hp: Math.round(G.survival.health), dead: G.survival.dead }, ...n.list.map((p) => ({ name: p.name + (p.mate ? ' ★ team' : ''), kills: p.kills, deaths: p.deaths, hp: p.hp, dead: p.dead }))];
    rows.sort((a, b) => b.kills - a.kills);
    el.innerHTML = `<h3>Game ${n.code}</h3><table><tr><th>Hunter</th><th>Kills</th><th>Deaths</th><th></th></tr>${rows.map((r) => `<tr><td>${r.name.replace(/</g, '&lt;')}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.dead ? 'dead' : ''}</td></tr>`).join('')}</table>`;
  }

  // The game can't continue (host left, connection lost, bad code)
  pvpEnded(msg) {
    if (this.pvpOver) return;
    this.pvpOver = true;
    G.input.unlock();
    this.closeMenus();
    G.menuOpen = 'death';
    $('dt-cause').textContent = msg;
    $('death').querySelector('.death-kicker').textContent = 'PvP game over';
    $('death').querySelector('p.muted').textContent = 'Host a new game or join another from the main menu.';
    $('dt-stats').innerHTML = G.net ? [[G.net.kills, 'Kills'], [G.net.deaths, 'Deaths'], ['$' + G.survival.money, 'Money']].map(([b, t]) => `<div><b>${b}</b><span>${t}</span></div>`).join('') : '';
    $('dt-restart').textContent = 'Back to the menu';
    this.el.hud.classList.add('hidden');
    $('death').classList.remove('hidden');
  }

  // Render whichever 3D stage is visible (called every frame while a menu is open)
  renderStage(dt) {
    this.menuTick(dt);
    if (G.menuOpen === 'guide' || G.menuOpen === 'harvest' || G.menuOpen === 'inspect') this.stage.render(dt);
    if (G.menuOpen === 'custom') this.renderCustom(dt);
  }
}
