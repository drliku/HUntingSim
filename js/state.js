// Shared game state container + persistent settings.
export const G = {
  scene: null,
  camera: null,
  renderer: null,
  world: null,
  env: null,
  player: null,
  animals: null,
  tracks: null,
  equipment: null,
  audio: null,
  ui: null,
  input: null,
  paused: true,
  started: false,
  menuOpen: null,       // name of open menu or null
  gameTime: 0,          // real seconds elapsed while unpaused
  sandbox: {
    infiniteAmmo: false,
    observerMode: false, // animals ignore the player
    revealAnimals: false,
  },
  discovered: new Set(),
  journal: [],
  stats: { shots: 0, hits: 0, tracksInspected: 0, sightings: 0 },
};

const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  invertY: false,
  fov: 72,
  volume: 0.7,
  quality: 'medium',
  showFps: true,
  headBob: true,
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const settings = Object.assign({}, DEFAULT_SETTINGS, load('whs.settings', {}));
export function saveSettings() { save('whs.settings', settings); }

export function loadProgress() {
  const p = load('whs.progress', null);
  if (!p) return;
  (p.discovered || []).forEach((s) => G.discovered.add(s));
  G.journal = p.journal || [];
  Object.assign(G.stats, p.stats || {});
}
export function saveProgress() {
  save('whs.progress', {
    discovered: [...G.discovered],
    journal: G.journal.slice(-200),
    stats: G.stats,
  });
}

export const QUALITY = {
  low:    { pixelRatio: 0.8, shadows: false, shadowSize: 512,  grass: 0.35, viewDist: 170, antialias: false },
  medium: { pixelRatio: 1.0, shadows: true,  shadowSize: 1024, grass: 0.7,  viewDist: 230, antialias: true },
  high:   { pixelRatio: 1.5, shadows: true,  shadowSize: 2048, grass: 1.0,  viewDist: 290, antialias: true },
};
