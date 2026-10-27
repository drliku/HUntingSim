// Survival: health, food and rest, sickness and poisoning, money, and what the player carries.
// Rates are per game hour (a full day lasts 20 real minutes at normal speed).
// When health reaches zero the player dies and the game starts over.
import { G } from './state.js';
import { clamp } from './utils.js';
import { FORAGE } from './forage.js';

export const CARRY_KG = 20;
export const PORTION_KG = 0.5;
// Firewood: chop trees for it; a campfire takes FIRE_WOOD pieces to light and each piece burns WOOD_HOURS
export const FIRE_WOOD = 2, WOOD_HOURS = 1.5, MAX_WOOD = 12, WOOD_PER_TREE = 4, MAX_FUEL = 10;

export class Survival {
  constructor() {
    this.health = 100;
    this.food = 80;
    this.rest = 85;
    this.sick = 0;          // game hours of food sickness left (raw meat)
    this.poisons = [];      // { type, delay, left, rate, announced }
    this.raw = {};          // meat name -> kg
    this.cooked = {};
    this.forage = {};       // forage type -> count
    this.known = new Set(); // forage types the player has identified by eating them
    this.items = { beans: 0, bandage: 0, medkit: 0 };
    this.wood = 0;          // pieces of firewood carried
    this.money = 0;
    this.warned = {};
    this.lastHurt = 0;
    this.dead = false;
    this.cause = '';
    this.dizzy = 0;
  }

  get enabled() { return G.sandbox.survival !== false; }
  get cfg() { return G.cfg || { drain: 1, poison: 1 }; }
  carried() { let k = 0; for (const v of Object.values(this.raw)) k += v; for (const v of Object.values(this.cooked)) k += v; return k; }
  capacity() { return CARRY_KG + (G.cabin?.has('storage') ? 15 : 0); }
  space() { return Math.max(0, this.capacity() - this.carried()); }

  addRaw(type, kg) {
    const take = Math.min(kg, this.space());
    const rounded = Math.floor(take / PORTION_KG) * PORTION_KG;
    if (rounded <= 0) return 0;
    this.raw[type] = (this.raw[type] || 0) + rounded;
    return rounded;
  }

  cookPortion(type) {
    if ((this.raw[type] || 0) < PORTION_KG - 1e-6) return false;
    this.raw[type] -= PORTION_KG;
    if (this.raw[type] < 0.01) delete this.raw[type];
    this.cooked[type] = (this.cooked[type] || 0) + PORTION_KG;
    return true;
  }

  take(store, type, kg = PORTION_KG) {
    if ((store[type] || 0) < kg - 1e-6) return false;
    store[type] -= kg;
    if (store[type] < 0.01) delete store[type];
    return true;
  }

  eat(type, cooked) {
    if (!this.take(cooked ? this.cooked : this.raw, type)) return null;
    if (cooked) {
      this.food = Math.min(100, this.food + 28);
      this.health = Math.min(100, this.health + 4);
      return { ok: true, msg: `You eat some cooked ${type.toLowerCase()}. Hunger eased.` };
    }
    this.food = Math.min(100, this.food + 12);
    if (Math.random() < 0.45) {
      this.sick = Math.max(this.sick, 3);
      return { ok: true, sick: true, msg: 'You eat the meat raw and soon feel ill. Raw game can carry parasites and bacteria — always cook it.' };
    }
    return { ok: true, msg: 'You eat the meat raw. It is filling, but risky — cooking kills parasites and bacteria.' };
  }

  // Foraged food: the true identity is only revealed by eating it
  label(type) { return this.known.has(type) ? FORAGE[type].name : FORAGE[type].look; }

  eatForage(type) {
    if (!this.forage[type]) return null;
    this.forage[type]--;
    if (this.forage[type] <= 0) delete this.forage[type];
    const f = FORAGE[type];
    if (f.poison) {
      const p = f.poison;
      this.poisons.push({ type, delay: p.delay, left: p.hours, rate: (p.dmg * this.cfg.poison) / p.hours, announced: false, dizzy: p.dizzy });
      this.food = Math.min(100, this.food + 3);
      return { ok: true, msg: p.delay > 1 ? 'It tastes fine. You feel normal… for now.' : 'It tastes bitter and strange.' };
    }
    this.food = Math.min(100, this.food + f.food);
    const first = !this.known.has(type);
    this.known.add(type);
    return { ok: true, msg: first ? `They were ${f.name} (${f.sci}) — safe to eat. ${f.note}` : `You eat the ${f.name.toLowerCase()}.` };
  }

  useItem(id) {
    if (!this.items[id]) return null;
    this.items[id]--;
    if (id === 'veg') { this.food = Math.min(100, this.food + 20); this.health = Math.min(100, this.health + 3); return 'Fresh vegetables from your garden. Safe, filling and healthy.'; }
    if (id === 'beans') { this.food = Math.min(100, this.food + 35); return 'You eat the beans. Hunger eased.'; }
    if (id === 'bandage') { this.health = Math.min(100, this.health + 30); return 'You bandage your wounds. +30 health.'; }
    if (id === 'medkit') {
      this.health = Math.min(100, this.health + 70);
      const had = this.poisons.length || this.sick > 0;
      this.poisons = []; this.sick = 0;
      return had ? 'First aid and activated charcoal: the poisoning is treated. +70 health.' : 'You treat your injuries with the first-aid kit. +70 health.';
    }
    return null;
  }

  damage(amount, from, cause) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.lastHurt = performance.now();
    if (cause) this.cause = cause;
    G.ui?.damageFlash(from, amount);
    G.audio?.hurt();
    if (this.health <= 0) this.die(cause || this.cause || 'Died of your injuries');
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.cause = cause;
    G.ui?.showDeath(cause);
  }

  // Called after sleeping
  slept(hours) {
    const feather = G.cabin?.has('bed');
    const reno = G.cabin?.has('renovate');
    this.rest = Math.min(100, this.rest + hours * 13 * (feather ? 1.35 : 1) * (reno ? 1.2 : 1));
    this.food = Math.max(0, this.food - hours * 2.2 * this.cfg.drain);
    if (this.food > 25) this.health = Math.min(100, this.health + hours * ((feather ? 6 : 3) + (reno ? 1.5 : 0)));
    for (let i = 0; i < Math.ceil(hours * 4); i++) this.tickPoison(0.25);
  }

  tickPoison(dh) {
    let dmg = 0;
    for (const p of this.poisons) {
      if (p.delay > 0) { p.delay -= dh; continue; }
      if (!p.announced) {
        p.announced = true;
        const f = FORAGE[p.type];
        this.known.add(p.type);
        G.ui?.toast(`You are poisoned! It was ${f.name} (${f.sci}). ${f.note} A first-aid kit from the general store can treat it.`, 'warn');
        G.audio?.hurt();
      }
      const step = Math.min(dh, p.left);
      dmg += p.rate * step;
      p.left -= step;
      if (p.dizzy) this.dizzy = Math.max(this.dizzy, p.left);
    }
    this.poisons = this.poisons.filter((p) => p.left > 0);
    if (dmg > 0) {
      this.health = Math.max(0, this.health - dmg);
      const active = this.poisons.find((p) => p.announced);
      if (active) this.cause = `Poisoned by ${FORAGE[active.type].name.toLowerCase()}`;
      if (this.health <= 0) this.die(this.cause || 'Poisoned');
    }
  }

  update(dt) {
    if (this.dead) return;
    const env = G.env, P = G.player;
    const dh = (dt * env.timeScale * 24) / env.daySeconds;
    this.tickPoison(dh);
    this.dizzy = Math.max(0, this.dizzy - dh);
    P.dizzy = this.dizzy > 0 ? Math.min(1, this.dizzy) : 0;
    if (!this.enabled) { P.tired = 0; return; }
    const drain = this.cfg.drain;
    const effort = P.inBed ? 0.7 : P.sprinting ? 2.2 : P.moving ? 1.25 : 1;
    this.food = clamp(this.food - dh * 5 * effort * drain, 0, 100);
    // lying in bed slowly restores rest (sleeping restores it much faster)
    if (P.inBed) this.rest = clamp(this.rest + dh * (P.inBed.spot.chair ? 3 : G.cabin?.has('bed') ? 7 : 4) * (G.net ? 3 : 1), 0, 100);
    else this.rest = clamp(this.rest - dh * 4.2 * (P.sprinting ? 1.6 : 1) * drain, 0, 100);
    let dHealth = 0;
    if (this.food <= 0) { dHealth -= 8; this.cause = 'Starved to death'; }
    if (this.rest <= 0) { dHealth -= 6; if (this.food > 0) this.cause = 'Died of exhaustion'; }
    if (this.sick > 0) { this.sick -= dh; dHealth -= 10; if (this.food > 0 && this.rest > 0) this.cause = 'Died of food poisoning from raw meat'; }
    if (this.food > 30 && this.rest > 30 && this.sick <= 0 && !this.poisons.some((p) => p.delay <= 0)) dHealth += 3;
    this.health = clamp(this.health + dHealth * dh, 0, 100);

    // effects on the player
    P.tired = this.rest < 20 ? (20 - this.rest) / 20 : 0;
    if (this.food < 15) P.stamina = Math.min(P.stamina, 0.5 + this.food / 30);

    this.warn('hungry', this.food < 25, 'You are getting hungry. Eat cooked meat, wild food or canned beans (I opens your pack).');
    this.warn('starving', this.food <= 0, 'You are starving and losing health. Eat something soon.');
    this.warn('tired', this.rest < 25, 'You are getting tired. Find a cabin and sleep in the bed.');
    this.warn('exhausted', this.rest <= 0, 'You are exhausted and losing health. You need to sleep.');
    this.warn('sick', this.sick > 0, 'Food sickness: you are losing health for a few hours.');
    this.warn('low', this.health < 25, 'Your health is low. Use a bandage or first-aid kit, rest and eat. If it reaches zero, you die.');

    if (this.health <= 0) this.die(this.cause || 'Died');
  }

  warn(key, cond, msg) {
    if (cond && !this.warned[key]) { this.warned[key] = true; G.ui?.toast(msg, 'warn'); }
    if (!cond) this.warned[key] = false;
  }
}
