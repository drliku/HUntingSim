// Input handling and the first-person player controller.
import * as THREE from 'three';
import { G, settings } from './state.js';
import { clamp, damp } from './utils.js';
import { HALF } from './terrain.js';

const SWIM_DEPTH = 1.25;   // water deeper than this and you swim
const SWIM_FEET = -1.4;    // feet height while swimming (eyes just above the surface)

// ?nolock runs without pointer lock (for automated testing / debugging) and exposes window.G
export const DEBUG_NOLOCK = new URLSearchParams(location.search).has('nolock');
if (DEBUG_NOLOCK) window.G = G;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0; this.dy = 0;
    this.left = false; this.right = false;
    this.leftPressed = false;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;
    this.exitAt = -1e9; // when the mouse was last released (Chrome won't re-capture it for a moment after Esc)

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      // Ctrl/Cmd + a game key would trigger browser shortcuts (save page, bookmark, find...);
      // block the ones the browser lets us block (Ctrl+W/T/N can't be, hence the leave prompt)
      if ((e.ctrlKey || e.metaKey) && /^(Key[A-Z]|Digit\d)$/.test(e.code) && !['KeyC', 'KeyV', 'KeyX'].includes(e.code)) e.preventDefault();
      // In free-cursor mode the browser does not exit on Esc, so pause here
      if (e.code === 'Escape' && this.fallback && this.locked) { this.locked = false; if (this.onLockChange) this.onLockChange(false); return; }
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.left = this.right = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || G.chatOpen) return;
      // free-cursor mode: the cursor may rest on a HUD panel; only real controls keep the click for themselves
      if (!document.pointerLockElement && e.target !== canvas && e.target.closest && e.target.closest('button, a, input, select, textarea, label')) return;
      if (e.button === 0) { this.left = true; this.leftPressed = true; }
      if (e.button === 2) this.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.left = false;
      if (e.button === 2) this.right = false;
    });
    // no browser right-click menu over the game: it would swallow the scope button's release
    window.addEventListener('contextmenu', (e) => { if (this.locked || e.target === canvas) e.preventDefault(); });
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockerror', () => {
      if (this.promiseLock) return; // counted by the promise rejection instead
      if (performance.now() - this.exitAt < 2500) return; // just the cooldown after Esc, not a real refusal
      this.refusals = (this.refusals || 0) + 1;
      if (this.refusals >= 2 && !this.fallback) { this.fallback = true; this.locked = true; if (this.onFallback) this.onFallback(); if (this.onLockChange) this.onLockChange(true); }
    });
    document.addEventListener('pointerlockchange', () => {
      const captured = document.pointerLockElement === canvas;
      // mouse capture works after all: back to normal (out of free-cursor mode), refusals forgotten
      if (captured) { this.refusals = 0; this.fallback = false; }
      else if (this.locked) this.exitAt = performance.now();
      this.locked = captured;
      if (!this.locked) { this.left = this.right = false; this.keys.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (DEBUG_NOLOCK || this.fallback) { this.locked = true; if (this.onLockChange) this.onLockChange(true); return; }
    // Some embedded frames refuse pointer lock entirely; after repeated refusals,
    // switch to free-cursor mode where plain mouse movement turns the view.
    const refused = () => {
      // Chrome refuses to re-capture the mouse for about a second after Esc: that's not a sign capture is
      // unavailable, so don't count it toward free-cursor mode (the click-to-resume prompt appears instead)
      if (performance.now() - this.exitAt < 2500) return;
      this.refusals = (this.refusals || 0) + 1;
      if (this.refusals >= 2 && !document.pointerLockElement) {
        this.fallback = true;
        this.locked = true;
        if (this.onFallback) this.onFallback();
        if (this.onLockChange) this.onLockChange(true);
      }
    };
    try {
      const p = this.canvas.requestPointerLock();
      this.promiseLock = !!(p && p.then);
      if (this.promiseLock) p.then(() => { this.refusals = 0; }, refused);
    } catch { refused(); }
  }
  unlock() {
    if (DEBUG_NOLOCK || this.fallback) { this.locked = false; return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }
  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() {
    this.pressed.clear();
    this.dx = this.dy = 0;
    this.wheel = 0;
    this.leftPressed = false;
  }
}

const _out = { x: 0, z: 0 };

export class Player {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.pos = new THREE.Vector3(-40, 0, -52);
    this.pos.y = world.terrain.getHeight(this.pos.x, this.pos.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI * 0.88; // facing south-west toward the stand and meadow
    this.pitch = -0.02;
    this.eyeH = 1.7;
    this.crouch = false;
    this.prone = false;     // lying flat on your belly
    this.hidden = false;    // prone and still in the grass: invisible to wildlife
    this.onGround = true;
    this.stamina = 1;
    this.staminaDelay = 0;
    this.sprinting = false;
    this.moving = false;
    this.speed2d = 0;
    this.noise = 0;
    this.noiseSpike = 0;
    this.visibility = 1;
    this.bobT = 0;
    this.bobAmt = 0;
    this.lastStep = 0;
    this.recoil = 0;
    this.shake = 0;
    this.dip = 0; this.dipV = 0; this.lean = 0; // camera spring (landings) and strafe lean
    this.sway = new THREE.Vector2();
    this.eye = new THREE.Vector3();
    this.inWater = false;
    this.holdBreath = false;
    this.zoomSensitivity = 1;
  }

  teleport(x, z, y = null) {
    this.pos.set(x, y ?? this.world.groundAt(x, z, 999), z);
    if (y === null) this.pos.y = this.world.terrain.getHeight(x, z);
    this.vel.set(0, 0, 0);
  }

  update(dt, input, ads, wantAim = false) {
    // Mouse look (sensitivity reduced when zoomed)
    const sens = 0.0022 * settings.sensitivity * this.zoomSensitivity;
    this.yaw -= input.dx * sens;
    this.pitch -= input.dy * sens * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.5, 1.5);

    if (this.inBed) { this.updateInBed(dt); return; }

    if (input.wasPressed('KeyC') || input.wasPressed('ControlLeft')) { this.crouch = this.prone || !this.crouch; this.prone = false; }
    // Z: lie flat in the grass; keep still and nothing can see you
    if (input.wasPressed('KeyZ')) { this.prone = !this.prone; this.crouch = false; }

    // Wish direction
    let fx = 0, fz = 0;
    if (input.isDown('KeyW')) fz += 1;
    if (input.isDown('KeyS')) fz -= 1;
    if (input.isDown('KeyA')) fx -= 1;
    if (input.isDown('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = -sy * fz + cy * fx;
    const wz = -cy * fz - sy * fx;

    const wantSprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    this.holdBreath = ads && wantSprint && this.stamina > 0.02;
    const hT = this.world.terrain.getHeight(this.pos.x, this.pos.z);
    // on frozen water you walk (and slide) on the ice instead of wading or swimming
    const frozen = this.world.env.frozen, onIce = frozen && hT < -0.05;
    const h = frozen ? Math.max(hT, 0) : hT;
    // swimming in deep water (with a little hysteresis so you don't flicker at the edge)
    const onPlatform = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) > h + 0.05;
    if (!onPlatform && -h > SWIM_DEPTH) this.swimming = true;
    else if (-h < SWIM_DEPTH - 0.15 || onPlatform) this.swimming = false;
    this.sprinting = !ads && !wantAim && !this.swimming && !this.prone && wantSprint && len > 0 && fz > 0 && this.stamina > 0.05 && this.onGround;
    if ((this.sprinting || this.swimming) && this.crouch) this.crouch = false;
    if (this.crouch && h < -0.6) this.crouch = false; // keep head above water
    if (this.prone && (this.swimming || h < -0.2)) this.prone = false;

    this.inWater = h < -0.25;
    let speed = this.prone ? 0.75 : this.crouch ? 1.5 : this.sprinting ? 6.8 : 3.3;
    if (ads) speed *= 0.5;
    if (this.tired) speed *= 1 - this.tired * 0.25;
    if (this.swimming) {
      // breaststroke; Shift swims faster but tires you out
      const fast = wantSprint && len > 0 && this.stamina > 0.05;
      speed = fast ? 2.5 : 1.6;
      if (this.stamina <= 0.02) speed = 1.1;
      if (fast) { this.stamina = Math.max(0, this.stamina - dt * 0.12); this.staminaDelay = 1.2; }
    } else if (this.inWater) speed *= h < -1.0 ? 0.45 : 0.65;
    const k = this.swimming ? 3 : this.onGround ? (onIce ? 1.8 : 10) : 2;
    this.vel.x = damp(this.vel.x, wx * speed, k, dt);
    this.vel.z = damp(this.vel.z, wz * speed, k, dt);

    // Jump & gravity
    if (input.wasPressed('Space') && this.onGround && !this.inWater && !this.swimming) {
      if (this.prone) { this.prone = false; this.crouch = true; }
      else if (this.crouch) this.crouch = false;
      else if (this.stamina > 0.1) { this.vel.y = 6.2; this.onGround = false; this.stamina -= 0.08; this.noiseSpike = 0.5; }
    }
    this.vel.y -= 20 * dt;

    // Integrate horizontally with collision
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    // steep slopes slow you down (you can still scramble up the hills and mountains)
    const nh = this.world.terrain.getHeight(nx, nz);
    const climb = (nh - h) / Math.max(1e-4, Math.hypot(nx - this.pos.x, nz - this.pos.z));
    if (climb > 3 && this.onGround) { this.vel.x *= 0.2; this.vel.z *= 0.2; }
    else {
      const slow = climb > 0.7 && this.onGround ? clamp(1.5 - climb * 0.6, 0.25, 1) : 1;
      this.pos.x += (nx - this.pos.x) * slow; this.pos.z += (nz - this.pos.z) * slow;
    }
    this.world.collide(this.pos.x, this.pos.z, 0.35, _out, this.pos.y);
    this.pos.x = clamp(_out.x, -HALF + 3, HALF - 3);
    this.pos.z = clamp(_out.z, -HALF + 3, HALF - 3);

    if (this.swimming) {
      // float at the surface
      this.vel.y = 0;
      this.pos.y = damp(this.pos.y, SWIM_FEET + Math.sin(performance.now() / 700) * 0.03, 4, dt);
      this.onGround = true;
    } else this.pos.y += this.vel.y * dt;
    const ground = this.swimming ? -999 : this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const wasAir = !this.onGround;
    if (this.pos.y <= ground) {
      if (wasAir) this.dipV += Math.max(-3.2, this.vel.y * 0.28);
      if (wasAir && this.vel.y < -6) { this.noiseSpike = 0.7; G.audio?.footstep(1.2, this.inWater); this.shake = 0.15; }
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > ground + 0.25) {
      this.onGround = false;
    } else if (this.onGround) {
      this.pos.y = ground; // stick to slopes when walking downhill
      this.vel.y = 0;
    }

    // Stamina
    if (this.sprinting || this.holdBreath) {
      this.stamina = Math.max(0, this.stamina - dt * (this.sprinting ? 0.16 : 0.22));
      this.staminaDelay = 1.2;
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(1, this.stamina + dt * 0.14);
    }

    this.speed2d = Math.hypot(this.vel.x, this.vel.z);
    this.moving = this.speed2d > 0.4;

    // Noise & visibility used by animal perception
    let n = 0;
    if (this.moving) n = this.sprinting ? 1.0 : this.prone ? 0.04 : this.crouch ? 0.1 : 0.42;
    if (this.inWater && this.moving) n = Math.min(1, n * 1.6 + 0.15);
    if (this.swimming) n = this.moving ? 0.55 : 0.15;
    this.noiseSpike = Math.max(0, this.noiseSpike - dt * 1.5);
    this.noise = Math.max(n, this.noiseSpike);
    let v = this.swimming ? 0.55 : this.prone ? 0.18 : this.crouch ? 0.45 : 0.85;
    if (this.moving) v += this.sprinting ? 0.3 : this.prone ? 0.04 : 0.12;
    if (this.pos.y > this.world.terrain.getHeight(this.pos.x, this.pos.z) + 2) v *= 0.6; // elevated stands break outline
    // lying still in the grass (off the trails, out of the water) you vanish completely
    this.hidden = this.prone && !this.moving && !this.inWater && hT > 0.3 && this.world.terrain.trailAt(this.pos.x, this.pos.z) > 2;
    this.visibility = this.hidden ? 0.02 : clamp(v, 0.1, 1);

    // Eye height, head bob and footsteps
    this.eyeH = damp(this.eyeH, this.prone ? 0.42 : this.crouch ? 1.05 : 1.7, this.prone ? 6 : 10, dt);
    const bobTarget = this.onGround && this.moving && !this.swimming ? Math.min(1, this.speed2d / 3.3) : 0;
    this.bobAmt = damp(this.bobAmt, bobTarget, 8, dt);
    this.bobT += dt * (this.sprinting ? 11 : this.prone ? 3.5 : this.crouch ? 5 : 7.5) * (this.moving ? 1 : 0);
    const stepPhase = Math.floor(this.bobT / Math.PI);
    if (stepPhase !== this.lastStep && this.onGround && this.moving) {
      this.lastStep = stepPhase;
      if (this.swimming) { if (stepPhase % 2 === 0) G.audio?.footstep(1, true); }
      else G.audio?.footstep(this.sprinting ? 1 : this.prone ? 0.12 : this.crouch ? 0.3 : 0.6, this.inWater);
    }

    this.recoil = damp(this.recoil, 0, 9, dt);
    this.shake = Math.max(0, this.shake - dt);
    // the camera sinks on landing and springs back; it leans a touch into sideways movement
    this.dipV += (-this.dip * 110 - this.dipV * 13) * dt;
    this.dip = clamp(this.dip + this.dipV * dt, -0.25, 0.1);
    const side = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.lean = damp(this.lean, clamp(-side * 0.0055, -0.028, 0.028), 5, dt);

    // Weapon sway when aiming (steadier crouched, much steadier holding breath)
    const t = performance.now() / 1000;
    let swayAmt = ads ? (this.prone ? 0.0007 : this.crouch ? 0.0016 : 0.003) : 0;
    if (ads && this.moving) swayAmt *= 2.5;
    if (this.holdBreath) swayAmt *= 0.15;
    if (ads && this.stamina < 0.05 && !this.holdBreath) swayAmt *= 1.8;
    if (this.tired) swayAmt = swayAmt * (1 + this.tired * 2) + this.tired * 0.004; // exhaustion makes the view drift
    if (this.dizzy) swayAmt += this.dizzy * 0.02; // poisoning (fly agaric) makes the world spin
    this.sway.x = damp(this.sway.x, (Math.sin(t * 0.9) + Math.sin(t * 2.1) * 0.4) * swayAmt, 6, dt);
    this.sway.y = damp(this.sway.y, (Math.sin(t * 1.3 + 1) * 0.8 + Math.cos(t * 0.7) * 0.4) * swayAmt, 6, dt);

    this.applyCamera();
  }

  // Lie on the bed: head on the pillow, free to look around the cabin
  enterBed(spot) {
    const bx = spot.x - 0.8, bz = spot.z;
    const yaw = spot.yaw ?? Math.PI;
    this.inBed = { spot, yaw, head: spot.head ? spot.head.clone() : new THREE.Vector3(bx, spot.floor + 0.78, bz - 0.62) };
    this.yaw = yaw;      // facing the foot of the bed and the door (or out from a chair)
    this.pitch = 0.08;
    this.vel.set(0, 0, 0);
    this.crouch = false;
    this.prone = false;
    this.sprinting = false;
  }

  leaveBed() {
    if (!this.inBed) return;
    const s = this.inBed.spot;
    this.inBed = null;
    this.teleport(s.x, s.z, s.floor + 0.03);
    this.pitch = 0;
  }

  updateInBed(dt) {
    const base = this.inBed.yaw;
    let dy = ((this.yaw - base + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    dy = clamp(dy, -1.4, 1.4);
    this.yaw = base + dy;
    this.pitch = clamp(this.pitch, -0.5, 1.3);
    this.moving = false; this.speed2d = 0; this.noise = 0; this.visibility = 0.1;
    this.stamina = Math.min(1, this.stamina + dt * 0.3);
    this.bobAmt = 0;
    this.recoil = 0; this.sway.set(0, 0);
    const t = performance.now() / 1000;
    const cam = this.camera;
    cam.position.copy(this.inBed.head);
    cam.position.y += Math.sin(t * 0.9) * 0.008; // slow breathing
    cam.rotation.set(this.pitch, this.yaw, 0.08);
    this.eye.copy(cam.position);
    this.pos.set(this.inBed.head.x, this.inBed.spot.floor, this.inBed.head.z);
  }

  applyCamera() {
    if (this.inBed) { this.updateInBed(0); return; }
    const cam = this.camera;
    const hb = settings.headBob ? this.bobAmt : this.bobAmt * 0.2;
    const bobY = Math.sin(this.bobT * 2) * 0.045 * hb;
    const bobX = Math.cos(this.bobT) * 0.03 * hb;
    const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
    cam.position.set(this.pos.x + sx * bobX, this.pos.y + this.eyeH + bobY + this.dip, this.pos.z + sz * bobX);
    const shake = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.05 : 0;
    cam.rotation.set(this.pitch + this.recoil + this.sway.y + shake, this.yaw + this.sway.x, -bobX * 0.15 + this.lean);
    this.eye.copy(cam.position);
  }

  forward(out) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }
}
