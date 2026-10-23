// Weapon rarities: better tiers hit harder, shoot straighter, reload faster and hold more rounds,
// and get a coloured finish on the stock (Legendary weapons are gold all over).
import * as THREE from 'three';
import { colorize } from './geo.js';

export const RARITY = [
  { id: 'gray', name: 'Common', css: '#a7adb3', dmg: 1.0, spread: 1.0, speed: 1.0, mag: 0, lethal: 0 },
  { id: 'green', name: 'Uncommon', css: '#5fd068', dmg: 1.08, spread: 0.85, speed: 0.93, mag: 0, lethal: 0.1 },
  { id: 'blue', name: 'Rare', css: '#4aa3ff', dmg: 1.16, spread: 0.7, speed: 0.86, mag: 1, lethal: 0.2 },
  { id: 'purple', name: 'Epic', css: '#b46cff', dmg: 1.25, spread: 0.55, speed: 0.78, mag: 1, lethal: 0.32 },
  { id: 'gold', name: 'Legendary', css: '#f2c230', dmg: 1.35, spread: 0.4, speed: 0.7, mag: 2, lethal: 0.45 },
];
export const RARITY_WEAPONS = ['rifle', 'shotgun', 'pistol', 'bow'];
// gunsmith price to upgrade to each tier (before the difficulty price factor)
export const UPGRADE_PRICE = [0, 60, 120, 220, 400];
// stock finish per tier: [light, dark]; Legendary also turns the metal gold
const STOCK = [null, [0x3f8a46, 0x2c6a34], [0x3468b8, 0x24508f], [0x7a46b8, 0x5a3090], [0xe0b040, 0xb88a24]];
const GOLD_METAL = [0x9a7420, 0xd4a840];

// odds of each tier from a supply crate (percent)
const ODDS = [45, 28, 16, 8, 3];
export function rollRarity(luck = 0) {
  let r = Math.random() * 100;
  for (let i = ODDS.length - 1; i >= 0; i--) { r -= ODDS[i] * (i > 0 ? 1 + luck : 1); if (r < 0) return i; }
  return 0;
}

const _ref = new Map();
function refColor(hex) {
  if (!_ref.has(hex)) _ref.set(hex, colorize(new THREE.BoxGeometry(0.01, 0.01, 0.01), hex).attributes.color.array.slice(0, 3));
  return _ref.get(hex);
}

// Colour swaps for one tier: wood = the item's stock colours [light, dark…], metal = its metal colours
export function rarityMap(tier, wood, metal = []) {
  const map = [];
  if (!tier || !STOCK[tier]) return map;
  wood.forEach((h, i) => map.push([h, STOCK[tier][i === 0 ? 0 : 1]]));
  if (tier === 4) metal.forEach((h, i) => map.push([h, GOLD_METAL[i === 0 ? 0 : 1]]));
  return map;
}

// Recolour a vertex-coloured geometry in place. The original colours are kept so tiers can change.
export function recolor(geo, map) {
  const c = geo.attributes.color;
  if (!c) return;
  if (!geo.userData.rarityOrig) geo.userData.rarityOrig = c.array.slice();
  const orig = geo.userData.rarityOrig;
  const pairs = map.map(([from, to]) => [refColor(from), refColor(to)]);
  const all = geo.userData.rarityTouched || [];
  // put back anything a previous tier changed
  for (const i of all) { c.array[i] = orig[i]; c.array[i + 1] = orig[i + 1]; c.array[i + 2] = orig[i + 2]; }
  const touched = [];
  for (let i = 0; i < orig.length; i += 3) {
    for (const [f, t] of pairs) {
      if (Math.abs(orig[i] - f[0]) < 1e-4 && Math.abs(orig[i + 1] - f[1]) < 1e-4 && Math.abs(orig[i + 2] - f[2]) < 1e-4) {
        c.array[i] = t[0]; c.array[i + 1] = t[1]; c.array[i + 2] = t[2];
        touched.push(i);
        break;
      }
    }
  }
  geo.userData.rarityTouched = touched;
  c.needsUpdate = true;
}

export function rarityLabel(tier) { return RARITY[tier] ? RARITY[tier].name : RARITY[0].name; }
