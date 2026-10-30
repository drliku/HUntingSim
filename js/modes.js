// Game modes, difficulty settings and the trading-post stores.
import { UPGRADE_LIST } from './upgrades.js';

// drain: hunger/rest speed · predator: how often predators attack · predDmg / poacherDmg: damage taken
// poachers: how many roam · poison: poison strength · prices: store price factor · sell: what the butcher pays
export const DIFFICULTY = {
  easy: {
    label: 'Easy', money: 150, drain: 0.7, predator: 0.45, predDmg: 0.6, poachers: 1, poacherAcc: 0.7, poacherDmg: 0.7, poison: 0.5, prices: 0.8, sell: 1.25,
    desc: 'Slower hunger, fewer attacks, one poacher, weaker poisons. $150 to start.',
  },
  medium: {
    label: 'Medium', money: 100, drain: 1, predator: 1, predDmg: 1, poachers: 2, poacherAcc: 1, poacherDmg: 1, poison: 1, prices: 1, sell: 1,
    desc: 'The intended experience. $100 to start.',
  },
  hard: {
    label: 'Hard', money: 60, drain: 1.4, predator: 1.7, predDmg: 1.4, poachers: 3, poacherAcc: 1.25, poacherDmg: 1.3, poison: 1.4, prices: 1.25, sell: 0.8,
    desc: 'Fast hunger, aggressive predators, three poachers, deadly poisons. Only $60 — not enough for a rifle.',
  },
};

export const FREE_ROAM = {
  label: 'Free roam', money: 0, drain: 1, predator: 0.7, predDmg: 0.8, poachers: 2, poacherAcc: 1, poacherDmg: 1, poison: 1, prices: 0, sell: 1,
};

// What the butcher pays per kg of raw meat (cooked meat fetches 40% more)
export const MEAT_PRICE = {
  Venison: 6, 'Elk meat': 7, 'Moose meat': 6, 'Pronghorn meat': 7, 'Wild mutton': 7, 'Bison meat': 8, 'Wild boar meat': 5,
  'Bear meat': 5, 'Rabbit meat': 8, 'Beaver meat': 6, Turkey: 9, Duck: 9, Goose: 8, Grouse: 10, Pigeon: 6, Dove: 10,
};

export const STORES = {
  gun: {
    name: 'Gun store', vendor: 'the gunsmith', sign: 'GUNS & AMMO', color: 0x5a4a3a,
    items: [
      { id: 'rifle', name: 'Bolt-action rifle (.308)', price: 100, desc: 'Scoped, accurate to 300 m+. Takes any game. Comes loaded (5).', once: true },
      { id: 'ammo-rifle', name: '.308 cartridges ×10', price: 15, desc: 'For the rifle.', needs: 'rifle', ammo: 'rifle', count: 10 },
      { id: 'shotgun', name: 'Pump shotgun (12 gauge)', price: 80, desc: 'Spreads pellets: ideal for birds and small game within 40 m. Comes loaded (5).', once: true },
      { id: 'ammo-shotgun', name: '12-gauge shells ×10', price: 12, desc: 'For the shotgun.', needs: 'shotgun', ammo: 'shotgun', count: 10 },
      { id: 'pistol', name: 'Revolver (.357 Magnum)', price: 55, desc: 'Fast, short range. Fine for small game; only vital shots stop deer. Comes loaded (6).', once: true },
      { id: 'ammo-pistol', name: '.357 rounds ×12', price: 10, desc: 'For the revolver.', needs: 'pistol', ammo: 'pistol', count: 12 },
      { id: 'bow', name: 'Recurve bow + 6 arrows', price: 70, desc: 'Silent: animals do not hear the shot. Hold to draw, release to shoot. Arrows can be picked up again.', once: true },
      { id: 'ammo-bow', name: 'Arrows ×6', price: 12, desc: 'For the bow.', needs: 'bow', ammo: 'bow', count: 6 },
      { id: 'binoculars', name: 'Binoculars 4–12× with rangefinder', price: 40, desc: 'Identify animals from a distance.', once: true },
    ],
  },
  butcher: {
    name: 'Butcher', vendor: 'the butcher', sign: 'BUTCHER', color: 0x7a3a32, buysMeat: true,
    items: [
      { id: 'cooked', name: 'Cooked venison (0.5 kg)', price: 7, desc: 'Ready to eat.' },
    ],
  },
  general: {
    name: 'General store', vendor: 'the shopkeeper', sign: 'GENERAL STORE', color: 0x3a5a4a,
    items: [
      { id: 'bait', name: 'Deer corn bait ×2', price: 8, desc: 'Place it (key 7) and herbivores come to feed over the next day.', ammo: 'bait', count: 2 },
      { id: 'call', name: 'Grunt call', price: 15, desc: 'Brings curious deer and elk closer (key 8). Predators may come too.', once: true },
      { id: 'trap-s', name: 'Small traps ×2', price: 16, desc: 'Body-grip traps (key 9): kill rabbits, beavers, raccoons and badgers outright.', ammo: 'trapS', count: 2 },
      { id: 'trap-m', name: 'Medium foothold trap', price: 22, desc: 'Holds foxes, coyotes, lynx and wolves until you come to finish them.', ammo: 'trapM', count: 1 },
      { id: 'trap-l', name: 'Large trap', price: 45, desc: 'Heavy toothed trap that holds deer, boar, bears, cougars, pronghorn and bighorn sheep.', ammo: 'trapL', count: 1 },
      { id: 'beans', name: 'Can of beans', price: 6, desc: '+35 food.' },
      { id: 'bandage', name: 'Bandage', price: 12, desc: 'Restores 30 health.' },
      { id: 'medkit', name: 'First-aid kit', price: 35, desc: 'Restores 70 health and treats poisoning (activated charcoal).' },
    ],
  },
};

// Cabin upgrades are sold from the board inside the cabin (see upgrades.js)
STORES.cabin = {
  name: 'Cabin upgrades', vendor: 'your cabin', kicker: 'Your cabin · upgrade board', upgrades: true,
  items: UPGRADE_LIST.map((u) => ({ ...u, upgrade: true, once: true })),
};
// The ammo locker (a cabin upgrade) sells the gunsmith's ammunition
STORES.locker = { name: 'Ammo locker', vendor: 'your ammo locker', kicker: 'Your cabin · ammo locker', items: STORES.gun.items.filter((it) => it.ammo) };

export function priceOf(item, cfg) { return Math.round(item.price * cfg.prices); }
