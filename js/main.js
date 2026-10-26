// Entry point: renderer setup, loading sequence, main loop, interactions and menu hotkeys.
import * as THREE from 'three';
import { G, settings, QUALITY, loadProgress } from './state.js';
import { World } from './world.js';
import { installSurfaceDetail, SurfaceDetail } from './surface.js';
installSurfaceDetail();
import { AnimalManager } from './animals.js';
import { Tracks } from './tracks.js';
import { Player, Input } from './player.js';
import { Equipment } from './equipment.js';
import { AudioSystem } from './audio.js';
import { UI } from './ui.js';
import { BirdManager } from './birds.js';
import { Survival } from './survival.js';
import { PoacherManager } from './poachers.js';
import { ForageManager } from './forage.js';
import { DIFFICULTY, FREE_ROAM, STORES } from './modes.js';
import { CabinUpgrades } from './upgrades.js';
import { Net, seedRandom } from './net.js';
import { loadLook, lookColor } from './avatar.js';
import { Crates } from './loot.js';
import { PostFX } from './post.js';
import { Ambient } from './ambient.js';
import { rollRarity, RARITY } from './rarity.js';

// Yield so the loading bar can paint; the timeout keeps loading going in background tabs where rAF pauses
const _aimDir = new THREE.Vector3();
const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });

async function boot() {
  const ui = new UI();
  G.ui = ui;
  ui.setLoading(0.05, 'Starting renderer…');
  await nextFrame();

  loadProgress();
  const q = QUALITY[settings.quality] || QUALITY.medium;
  const canvas = document.getElementById('game');
  // the graphics driver can reset the WebGL context (driver update, GPU out of memory, sleep);
  // keep the context restorable and reload into the same game mode once it is back
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    G.ui?.toast('The graphics driver reset. Restarting the game...', 'warn');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { if (G.started && !G.net) sessionStorage.setItem('whs.pending', JSON.stringify({ mode: G.mode, diff: G.difficulty })); } catch { /* ignore */ }
    G.leaving = true;
    location.reload();
  });
  // closing the tab by accident (Ctrl+W, Ctrl+Q...) asks first while a game is running
  window.addEventListener('beforeunload', (e) => {
    if (G.started && !G.leaving) { e.preventDefault(); e.returnValue = ''; }
  });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = q.shadows;
  SurfaceDetail.enabled = !!q.post;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  G.renderer = renderer;

  const scene = new THREE.Scene();
  G.scene = scene;
  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 520);
  camera.rotation.order = 'YXZ';
  G.camera = camera;

  ui.setLoading(0.15, 'Shaping terrain, rivers and forest…');
  await nextFrame();
  // PvP: every player builds the same forest, wildlife and wild food from the room's seed
  let pendingBoot = null;
  try { pendingBoot = JSON.parse(sessionStorage.getItem('whs.pending') || 'null'); } catch { /* ignore */ }
  const unseed = pendingBoot && pendingBoot.pvp ? seedRandom(pendingBoot.pvp.seed) : null;
  const world = new World(scene, q);
  G.world = world;
  G.env = world.env;
  const cabin = new CabinUpgrades(world);
  G.cabin = cabin;

  ui.setLoading(0.6, 'Releasing wildlife…');
  await nextFrame();
  const input = new Input(canvas);
  G.input = input;
  const player = new Player(world, camera);
  G.player = player;
  const tracks = new Tracks(scene, world.terrain);
  G.tracks = tracks;
  const animals = new AnimalManager(scene, world);
  animals.tracks = tracks;
  G.animals = animals;
  animals.initialSpawn();
  const birds = new BirdManager(scene, world);
  birds.tracks = tracks;
  G.birds = birds;
  birds.initialSpawn();
  const survival = new Survival();
  G.survival = survival;
  const poachers = new PoacherManager(scene, world);
  G.poachers = poachers;
  const forage = new ForageManager(scene, world);
  G.forage = forage;
  if (unseed) unseed();
  const crates = new Crates(scene, world);
  G.crates = crates;
  G.mode = 'free';
  G.cfg = FREE_ROAM;
  world.onFireOut = (fire) => { if (Math.hypot(fire.x - player.pos.x, fire.z - player.pos.z) < 40) ui.toast('The campfire has burned out.', 'info'); };

  ui.setLoading(0.8, 'Checking the rifle…');
  await nextFrame();
  const equipment = new Equipment(renderer);
  G.equipment = equipment;
  equipment.setSleeveColor(lookColor('jacket', loadLook().jacket));
  const post = new PostFX(renderer, scene, camera, equipment, q);
  G.post = post;
  const ambient = new Ambient(scene);
  G.ambient = ambient;
  world.env.camRef = camera;
  // draw one frame: through the post-processing chain when it is on, directly otherwise
  const renderFrame = (showWeapon) => {
    if (post.enabled) { post.update(world.env); post.render(showWeapon); return; }
    renderer.clear();
    renderer.render(scene, camera);
    if (showWeapon) equipment.render(renderer);
  };
  equipment.resize(camera.aspect);
  const audio = new AudioSystem();
  G.audio = audio;
  world.env.onThunder = (delay) => audio.thunder(delay);

  const startYaw = player.yaw;
  // Warm up: compile shaders and settle the world before showing the start screen
  player.applyCamera();
  world.update(0.016, camera.position);
  animals.update(0.016);
  birds.update(0.016);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  ui.setLoading(1, 'Ready');
  await nextFrame();
  ui.showMainMenu();

  // ---- quality / resize ----
  G.applyQuality = () => {
    const qq = QUALITY[settings.quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, qq.pixelRatio));
    renderer.shadowMap.enabled = qq.shadows;
    SurfaceDetail.enabled = !!qq.post;
    world.env.sun.castShadow = qq.shadows;
    if (world.env.sun.shadow.map) { world.env.sun.shadow.map.dispose(); world.env.sun.shadow.map = null; }
    world.env.sun.shadow.mapSize.set(qq.shadowSize, qq.shadowSize);
    world.veg.setGrassDensity(qq.grass);
    world.veg.hiDist = !qq.shadows ? -1e9 : qq.grass >= 1 ? 30 : 12;
    post.setQuality(qq);
    world.env.setViewDistance(qq.viewDist);
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    renderOnce = true;
  };
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    equipment.resize(camera.aspect);
    post.setSize(window.innerWidth, window.innerHeight);
    renderOnce = true;
  });

  // ---- start & pointer lock flow ----
  // ---- game modes ----
  function startGame(mode, diff) {
    audio.init();
    G.mode = mode;
    G.difficulty = diff || null;
    G.cfg = mode === 'survival' ? DIFFICULTY[diff] : FREE_ROAM;
    if (mode === 'survival') {
      equipment.owned = { rifle: false, shotgun: false, pistol: false, bow: false, knife: true, binoculars: false, bait: false, call: false };
      equipment.item = 'knife'; equipment.nextItem = null;
      for (const k in equipment.ammo) { equipment.ammo[k].mag = 0; equipment.ammo[k].reserve = 0; }
      survival.money = G.cfg.money;
      equipment.resetRarity();
      Object.assign(G.sandbox, { survival: true, infiniteAmmo: false, observerMode: false, poachers: true, revealAnimals: false });
    }
    G.started = true;
    crates.clear();
    crates.fill();
    ui.hideMainMenu();
    ui.closeMenus();
    input.lock();
    player.yaw = startYaw; player.pitch = -0.02;
    if (mode === 'survival') {
      ui.toast(`Survival (${G.cfg.label}): you have a knife and $${G.cfg.money}. The town east of the cabin has a gunsmith, a butcher who buys meat, and a general store. Ammunition is only sold there. Use the board inside your cabin to build upgrades.`, 'info');
    } else {
      ui.toast('Welcome to the forest. A small group of deer was seen south-west of the cabin — try your binoculars (6, then hold right mouse). Keys 1–8 switch rifle, shotgun, revolver, bow, knife, binoculars, bait and call (or use the mouse wheel). Restock ammunition at the gunsmith in town.', 'info');
    }
  }
  // PvP survival: survival rules (medium), no poachers — the other hunters are the danger
  function startPvp(p) {
    startGame('survival', 'medium');
    G.cfg = { ...DIFFICULTY.medium, label: 'PvP', poachers: 0, money: 120 };
    survival.money = 120;
    G.sandbox.poachers = false;
    const net = new Net(p);
    G.net = net;
    if (p.role !== 'host') crates.clear(); // the host's crates arrive with the world sync
    net.connect();
    const [sx, sz] = p.role === 'host' ? [-40, -54] : net.respawnPoint();
    player.teleport(sx, sz);
    ui.showPvpHud(true);
  }
  // Back into the forest after dying in PvP: knife, a little cash, somewhere away from the others
  G.pvpRespawn = () => {
    Object.assign(survival, { health: 100, food: 75, rest: 80, sick: 0, poisons: [], raw: {}, cooked: {}, forage: {}, items: { beans: 0, bandage: 0, medkit: 0 }, dead: false, cause: '', dizzy: 0 });
    survival.money = Math.max(survival.money, 40);
    equipment.owned = { rifle: false, shotgun: false, pistol: false, bow: false, knife: true, binoculars: false, bait: false, call: false };
    equipment.item = 'knife'; equipment.nextItem = null; equipment.reloadT = 0; equipment.draw = 0;
    for (const k in equipment.ammo) { equipment.ammo[k].mag = 0; equipment.ammo[k].reserve = 0; }
    equipment.resetRarity();
    player.inBed = null;
    const [x, z] = G.net.respawnPoint();
    player.teleport(x, z);
    ui.hideDeath();
    ui.toast('You are back in the forest with a knife and $' + survival.money + '. Everything else was lost.', 'info');
  };

  // Start a new game; if one is already running, the page restarts from scratch first
  G.newGame = (mode, diff) => {
    if (!G.started) { startGame(mode, diff); return; }
    try { sessionStorage.setItem('whs.pending', JSON.stringify({ mode, diff })); } catch { /* ignore */ }
    G.restartGame();
  };
  // Death or a new run: wipe all progress and reload the world from zero
  G.restartGame = () => {
    try { localStorage.removeItem('whs.progress'); } catch { /* storage unavailable */ }
    G.journal = []; G.discovered.clear();
    G.leaving = true;
    location.reload();
  };
  try {
    const pending = JSON.parse(sessionStorage.getItem('whs.pending') || 'null');
    if (pending) { sessionStorage.removeItem('whs.pending'); setTimeout(() => (pending.pvp ? startPvp(pending.pvp) : startGame(pending.mode, pending.diff)), 50); }
  } catch { /* ignore */ }

  document.getElementById('btn-start').addEventListener('click', () => {
    audio.init();
    const first = !G.started;
    if (first) { startGame('free'); return; }
    G.started = true;
    ui.hideMainMenu();
    ui.closeMenus();
    input.lock();
    if (first) {
      player.yaw = startYaw; player.pitch = -0.02;
      ui.toast('Welcome to the forest. A small group of deer was seen south-west of the cabin, past the hunting stand — try your binoculars (6, then hold right mouse).', 'info');
    } else if (G.savedYaw !== undefined) { player.yaw = G.savedYaw; player.pitch = G.savedPitch; }
  });
  canvas.addEventListener('click', () => {
    if (G.started && !G.menuOpen && !G.inMainMenu && !input.locked) { input.lock(); ui.el['lock-hint'].classList.add('hidden'); }
  });
  input.onFallback = () => ui.toast('Mouse capture is not available here. Move the mouse to look around; press Esc to pause.', 'warn');
  input.onLockChange = (locked) => {
    if (locked) { ui.el['lock-hint'].classList.add('hidden'); audio.init(); }
    else if (G.started && !G.menuOpen && !G.inMainMenu && !G.sleep) ui.openMenu('pause');
  };

  // ---- main loop ----
  const clock = new THREE.Clock();
  let renderOnce = true;
  let interactT = 0;
  let interaction = null;
  let lightProg = 0;
  let forageT = 5;
  let lastStore = null;
  const dirV = new THREE.Vector3();

  function updateInteraction() {
    interaction = null;
    const P = player;
    if (P.inBed) { interaction = { kind: 'bed-up', text: P.inBed.spot.chair ? '<kbd>E</kbd>Get up' : '<kbd>E</kbd>Get up · <kbd>Z</kbd>Sleep' }; return; }
    const us = cabin.nearest(P.pos.x, P.pos.z);
    if (us) { interaction = { kind: 'cabin', us, text: us.text() }; return; }
    for (const st of world.stores) {
      if (Math.hypot(P.pos.x - st.x, P.pos.z - st.z) < 2.3) {
        interaction = st.closed ? { kind: 'none', text: `${STORES[st.id].name} is closed. Open 09:00–21:00.` } : { kind: 'store', st, text: `<kbd>E</kbd>Trade with ${STORES[st.id].vendor} — ${STORES[st.id].name}` };
        return;
      }
    }
    const ci = crates.nearest(P.pos.x, P.pos.z, 1.8);
    if (ci >= 0) { interaction = { kind: 'crate', i: ci, text: '<kbd>E</kbd>Open the supply crate' }; return; }
    const ar = equipment.nearestStuckArrow(P.pos.x, P.pos.z, 1.8);
    if (ar) { interaction = { kind: 'arrow', ar, text: '<kbd>E</kbd>Pick up your arrow' }; return; }
    for (const d of poachers.drops) {
      if (Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.8) { interaction = { kind: 'drop', d, text: '<kbd>E</kbd>Pick up the poacher\'s rifle' }; return; }
    }
    const fn = forage.nearest(P.pos.x, P.pos.z, 1.7);
    if (fn) { interaction = { kind: 'forage', node: fn, text: `<kbd>E</kbd>Pick: ${survival.label(fn.type).toLowerCase()}` }; }
    for (const d of world.doors) {
      if (Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.7) {
        if (d.store && d.store.closed && !d.open && !world.isInside(d.store.bounds, P.pos.x, P.pos.z)) interaction = { kind: 'none', text: `Locked — ${STORES[d.store.id].name.toLowerCase()} opens at 09:00` };
        else interaction = { kind: 'door', d, text: `<kbd>E</kbd>${d.open ? 'Close' : 'Open'} the door` };
        return;
      }
    }
    for (const a of [...animals.list, ...birds.list]) {
      if (a.state !== 'down' || a.tagged || (a.isBird ? !a.landed : a.stateT < a.runOff + 1)) continue;
      if (Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z) < 3.2 + a.sp.model.bodyLen * 0.5) {
        interaction = { kind: 'carcass', a, text: `<kbd>E</kbd>Inspect the ${a.sp.name.toLowerCase()}` };
        return;
      }
    }
    for (const r of world.restSpots) {
      if (Math.hypot(P.pos.x - r.x, P.pos.z - r.z) < 1.9) {
        const tired = survival.rest < 40 ? ' — you are tired' : '';
        interaction = { kind: 'sleep', r, text: `<kbd>E</kbd>Sleep in the bed${tired}` };
        return;
      }
    }
    for (const fire of world.fires) {
      if (Math.hypot(P.pos.x - fire.x, P.pos.z - fire.z) < 2.4) {
        if (fire.lit) interaction = { kind: 'fire', fire, text: '<kbd>E</kbd>Cook and eat at the campfire' };
        else interaction = { kind: 'fire-unlit', fire, text: '<kbd>E</kbd>Hold to light the campfire' };
        return;
      }
    }
    for (const l of world.ladders) {
      const dBase = Math.hypot(P.pos.x - l.x, P.pos.z - l.z);
      if (dBase < 1.8 && P.pos.y < l.baseY + 1.5) { interaction = { kind: 'ladder-up', l, text: '<kbd>E</kbd>Climb into the hunting stand' }; return; }
      const dTop = Math.hypot(P.pos.x - l.topX, P.pos.z - l.topZ);
      if (dTop < 1.3 && P.pos.y > l.topY - 0.3) { interaction = { kind: 'ladder-down', l, text: '<kbd>E</kbd>Climb down' }; return; }
    }
    if (equipment.aim > 0.3) return;
    camera.getWorldDirection(dirV);
    let rec = null;
    const t = world.terrain.raycast(camera.position, dirV, 8, 0.2);
    if (t > 0) {
      const px = camera.position.x + dirV.x * t, pz = camera.position.z + dirV.z * t;
      rec = tracks.findNear(px, pz, 0.9);
    }
    if (rec) {
      const label = rec.type === 'bed' ? 'bedding site' : rec.type === 'root' ? 'rooting sign' : 'tracks';
      interaction = { kind: 'track', rec, text: `<kbd>E</kbd>Inspect ${label}` };
    }
  }

  function doInteraction() {
    if (!interaction) return;
    const P = player;
    if (interaction.kind === 'ladder-up') {
      const l = interaction.l;
      P.teleport(l.topX, l.topZ, l.topY);
      P.crouch = false;
      ui.toast('In the stand: your scent and outline carry less from up here.', 'info');
    } else if (interaction.kind === 'ladder-down') {
      const l = interaction.l;
      P.teleport(l.x, l.z - 0.6);
    } else if (interaction.kind === 'cabin') {
      const us = interaction.us;
      if (us.kind === 'board') ui.showStore({ id: 'cabin' });
      else if (us.kind === 'locker') ui.showStore({ id: 'locker' });
      else if (us.kind === 'stove') ui.showCampfire(cabin.stoveFire);
      else if (us.kind === 'chair') { P.enterBed(us.seat); ui.toast('You settle into the rocking chair and watch the meadow. Rest slowly recovers. Press E to get up.', 'info'); }
      else if (us.kind === 'garden') { const n = cabin.harvestGarden(); if (n) ui.toast(`You pick ${n} fresh vegetables. Eat them from your pack (I). The garden will be ready again tomorrow morning.`, 'good'); }
      interactT = 0;
    } else if (interaction.kind === 'store') {
      ui.showStore(interaction.st);
    } else if (interaction.kind === 'crate') {
      crates.open(interaction.i);
      interactT = 0;
    } else if (interaction.kind === 'arrow') {
      equipment.pickupArrow(interaction.ar);
      interactT = 0;
    } else if (interaction.kind === 'drop') {
      poachers.takeDrop(interaction.d);
      const tier = Math.min(rollRarity(), 3);
      if (!equipment.owned.rifle) { equipment.owned.rifle = true; equipment.setRarity('rifle', tier); equipment.ammo.rifle.mag = 3; ui.toast(`You pick up the poacher's ${RARITY[tier].name.toLowerCase()} rifle. It has 3 rounds left. Press 1 to use it.`, 'good'); }
      else if (tier > equipment.tier('rifle')) { equipment.setRarity('rifle', tier); equipment.ammo.rifle.reserve += 4; ui.toast(`The poacher's rifle is ${RARITY[tier].name} — better than yours. You keep it, with 4 cartridges.`, 'good'); }
      else { equipment.ammo.rifle.reserve += 4; ui.toast('You take 4 cartridges from the poacher\'s rifle.', 'good'); }
    } else if (interaction.kind === 'forage') {
      const t = interaction.node.type;
      G.net?.pick(interaction.node);
      forage.pick(interaction.node);
      survival.forage[t] = (survival.forage[t] || 0) + 1;
      if (!G.pickedOnce) { G.pickedOnce = true; ui.toast('Picked. Eat it from your pack (I) — but some wild plants and mushrooms are poisonous, and you will not know until you eat them.', 'info'); }
      else ui.toast(`Picked: ${survival.label(t).toLowerCase()}`, 'info');
      interactT = 0;
    } else if (interaction.kind === 'bed-up') {
      P.leaveBed();
    } else if (interaction.kind === 'door') {
      world.setDoor(interaction.d, !interaction.d.open);
      G.net?.door(interaction.d);
      audio.doorSound?.();
      interactT = 0;
    } else if (interaction.kind === 'sleep') {
      ui.showSleep(interaction.r);
    } else if (interaction.kind === 'fire') {
      ui.showCampfire(interaction.fire);
    } else if (interaction.kind === 'carcass') {
      ui.showInspect(interaction.a);
    } else if (interaction.kind === 'track') {
      const info = tracks.describe(interaction.rec);
      ui.showTrack(info);
      tracks.setFollow(interaction.rec.animalId);
      G.stats.tracksInspected++;
    }
  }

  function handleHotkeys() {
    if (G.menuOpen === 'death') return;
    if (input.wasPressed('KeyF')) ui.toggleMenu('guide');
    else if (input.wasPressed('KeyJ')) ui.toggleMenu('journal');
    else if (input.wasPressed('KeyB') && !G.net) ui.toggleMenu('sandbox');
    else if (input.wasPressed('KeyM')) ui.toggleMenu('map');
    else if (input.wasPressed('KeyI')) ui.toggleMenu('pack');
    else if (input.wasPressed('Escape') && G.menuOpen && performance.now() - (G.menuOpenedAt || 0) > 400) ui.back();
  }

  // PvP world step without the player's own controls (menus open, dead, or tab hidden)
  function pvpSimulate(dt) {
    world.update(dt, camera.position);
    if (!G.net.isHost) animals.netUpdate(dt); else animals.update(dt);
    birds.update(dt);
    crates.update(dt);
    survival.update(dt);
    world.updateStores(world.env.time, player.pos.x, player.pos.z);
    G.net.tick(dt);
  }
  let lastFrameAt = performance.now();
  // Browsers pause animation frames in hidden tabs and minimised windows; in PvP the game must keep running
  // (especially for the host), so a worker timer drives the world while the tab is hidden.
  try {
    const src = 'setInterval(() => postMessage(0), 50);';
    const ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    let lastHidden = performance.now();
    ticker.onmessage = () => {
      const now = performance.now();
      const dt = Math.min((now - lastHidden) / 1000, 0.25);
      lastHidden = now;
      if (G.net && G.started && now - lastFrameAt > 250) { pvpSimulate(dt); clock.getDelta(); }
    };
  } catch { /* workers unavailable: hidden tabs pause */ }

  // A thrown error must not wedge the game: keys would stay "pressed" and the frame would
  // keep failing at the same spot. Log it once, clear the frame's input and carry on.
  let frameErrors = 0;
  function frame() {
    requestAnimationFrame(frame);
    try { frameBody(); } catch (err) {
      frameErrors++;
      if (frameErrors <= 3) console.error('Frame error (the game keeps running):', err);
      if (frameErrors === 1) ui.toast('Something went wrong for a moment; the game recovered. If it keeps happening, try a lower graphics setting.', 'warn');
      try { input.endFrame(); } catch { /* ignore */ }
    }
  }
  function frameBody() {
    lastFrameAt = performance.now();
    const dt = Math.min(clock.getDelta(), 0.05);
    if (G.sleep) {
      // fast-forward the world in chunks while the screen is dark
      const sl = G.sleep;
      if (sl.delay > 0) sl.delay -= dt;
      else if (!sl.done) {
        const n = Math.max(1, Math.min(sl.steps - (sl.intruder ? sl.intruder.at : 0), 140));
        const env = world.env, ts = env.timeScale;
        env.timeScale = 1;
        for (let i = 0; i < n; i++) { world.update(0.1, camera.position); animals.update(0.1); birds.update(0.1); tracks.update(0.1); }
        env.timeScale = ts;
        sl.steps -= n;
        ui.updateSleep();
        if (sl.intruder && sl.steps <= sl.intruder.at) { ui.intruderWake(); input.endFrame(); return; }
        if (sl.steps <= 0) { ui.finishSleep(); renderOnce = true; }
      }
      if (renderOnce) { renderFrame(false); renderOnce = false; }
      input.endFrame();
      return;
    }
    if (G.started && !G.inMainMenu) handleHotkeys();
    else if (input.wasPressed('Escape') && G.menuOpen && G.menuOpen !== 'death' && performance.now() - (G.menuOpenedAt || 0) > 400) ui.back();
    const playing = G.started && !G.inMainMenu && !G.menuOpen && input.locked;
    if (playing) {
      G.gameTime += dt;
      player.update(dt, input, equipment.aim > 0.5, input.right && !!equipment.W.zoom);
      if (!player.inBed) equipment.update(dt, input);
      else if (input.wasPressed('KeyZ') && player.inBed.spot.bed) ui.showSleep(player.inBed.spot);
      if (input.wasPressed('KeyT')) { tracks.setMode(!tracks.mode); ui.toast(tracks.mode ? 'Tracking mode on — fresh sign is easier to spot' : 'Tracking mode off', 'info'); }
      if (input.wasPressed('KeyH')) ui.toggleHUD();
      interactT -= dt;
      if (interactT <= 0) { interactT = 0.12; updateInteraction(); }
      if (interaction && interaction.kind === 'fire-unlit') {
        if (input.isDown('KeyE')) {
          if (lightProg === 0) audio.strike();
          lightProg += dt / (world.env.w.rain > 0.3 ? 3.5 : 1.8);
          if (Math.random() < dt * 4) audio.strike();
          if (lightProg >= 1) {
            const fire = interaction.fire;
            fire.lit = true; fire.fuel = 5;
            G.net?.fire(fire);
            lightProg = 0;
            ui.toast('The campfire catches. It will burn for about five hours (game time). Press E at the fire to cook.', 'good');
            interactT = 0;
          }
        } else lightProg = 0;
      } else lightProg = 0;
      const promptText = interaction ? interaction.text + (lightProg > 0 ? `<span class="hold"><i style="width:${Math.round(lightProg * 100)}%"></i></span>` : '') : null;
      ui.setPrompt(promptText);
      if (input.wasPressed('KeyE') && interaction && interaction.kind !== 'fire-unlit') doInteraction();
      world.update(dt, camera.position);
      ambient.update(dt, camera.position, world.env, 1, world.veg);
      if (G.net && !G.net.isHost) animals.netUpdate(dt); else animals.update(dt);
      birds.update(dt);
      poachers.update(dt);
      crates.update(dt);
      G.net?.tick(dt);
      if (G.net) ui.updateBoard(input.isDown('Tab'));
      survival.update(dt);
      forageT -= dt;
      if (forageT <= 0) { forageT = 5; forage.update(); world.updateBaits(); cabin.update(); }
      world.updateStores(world.env.time, player.pos.x, player.pos.z, camera.position.y);
      // point a weapon at a shopkeeper and they draw theirs on you until you lower it
      const EW = equipment.W;
      if (EW && (EW.gun || (equipment.item === 'bow' && equipment.draw > 0.15)) && !player.inBed && !player.swimming) {
        player.forward(_aimDir);
        const vh = world.raycastVendors(camera.position, _aimDir, 40);
        if (vh) {
          const wall = world.raycastStatic(camera.position, _aimDir, vh.dist);
          if (wall < 0 || wall >= vh.dist - 0.3) {
            const st = vh.store;
            if (st.threat <= 0 && (!st.warnedAt || G.gameTime - st.warnedAt > 12)) {
              st.warnedAt = G.gameTime;
              ui.toast(`${st.title}: "Whoa, put that down, friend!" The shopkeeper has a gun on you. Lower your weapon; if you fire, they fire first.`, 'warn');
            }
            st.threat = 1.6;
          }
        }
      }
      // warn once each time you walk into a store
      const inStore = world.stores.find((st) => world.isInside(st.bounds, player.pos.x, player.pos.z));
      if (inStore !== lastStore) {
        lastStore = inStore;
        if (inStore) {
          const def = { ...STORES[inStore.id], name: inStore.title || STORES[inStore.id].name };
          if (inStore.closed) ui.toast(`${def.name} is closing (open 09:00–21:00). Head out — the door locks behind you.`, 'info');
          else ui.toast(`${def.name}: ${def.vendor} keeps a loaded gun under the counter. Do NOT fire at the shopkeeper — they will shoot back and kill you instantly.`, 'warn');
        }
      }
      // inside a cabin with the door shut (or anywhere in a fortified home) you are safe
      player.inCabinSafe = world.cabins.some((c) => !c.store && Math.abs(player.pos.x - c.x) < c.W / 2 && Math.abs(player.pos.z - c.z) < c.D / 2 && ((c.door && !c.door.open) || (c.home && cabin.has('fortify'))));
      tracks.update(dt);
      audio.update(dt);
      ui.updateHUD(dt);
      renderOnce = true;
    } else if (G.net && G.started) {
      // PvP: the forest does not pause while you are in a menu or dead
      pvpSimulate(dt);
      if (G.menuOpen === 'map') ui.updateMap();
      renderOnce = true;
    } else if (G.inMainMenu && !G.menuOpen) {
      // slow cinematic pan behind the main menu
      player.yaw += dt * 0.04;
      player.applyCamera();
      world.update(dt, camera.position);
      renderOnce = true;
    } else if (G.menuOpen === 'map') {
      ui.updateMap();
    }
    ui.renderStage(dt);
    if (renderOnce || !G.started) {
      renderFrame(G.started && !G.inMainMenu && !player.inBed);
      renderOnce = playing || (G.inMainMenu && !G.menuOpen);
    }
    input.endFrame();
  }
  frame();
}

boot().catch((err) => {
  console.error(err);
  const t = document.getElementById('load-text');
  if (t) t.textContent = `Failed to start: ${err.message}. Make sure you run the game through a local server (see README).`;
});
