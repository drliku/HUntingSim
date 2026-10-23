// Educational anatomy models (skeleton, major muscles, internal organs) generated from the same
// proportions as the in-game animal so that structures line up with the body silhouette.
import * as THREE from 'three';
import { SPECIES } from './species.js';
import { computeDims } from './animalModel.js';
import { birdDims } from './birdModel.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BONE = 0xece3cc;

const matCache = {};
function mat(color, opacity = 1) {
  const k = color + ':' + opacity;
  if (!matCache[k]) {
    matCache[k] = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  }
  return matCache[k];
}

const _up = V(0, 1, 0);
function rod(a, b, r1, r2, color, seg = 6, opacity = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, seg);
  g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, mat(color, opacity));
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  return m;
}
function blob(c, sx, sy, sz, color, opacity = 1, rx = 0, ry = 0, rz = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.max(6, seg - 3)), mat(color, opacity));
  m.position.copy(c);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  return m;
}
// Ellipsoid aligned between two points.
function spindle(a, b, r, color, opacity = 1, flat = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), mat(color, opacity));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  m.scale.set(r * flat, len / 2, r);
  return m;
}

class RibCurve extends THREE.Curve {
  constructor(cy, rx, ry, z, tilt, gap) { super(); Object.assign(this, { cy, rx, ry, z, tilt, gap }); }
  getPoint(t, out = new THREE.Vector3()) {
    const th = this.gap + t * (Math.PI * 2 - this.gap * 2);
    const down = (1 - Math.cos(th)) / 2;
    return out.set(this.rx * Math.sin(th), this.cy + this.ry * Math.cos(th), this.z - this.tilt * down);
  }
}

function vertebrae(group, curve, n, r, spine = 0, color = BONE) {
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 0.78) / n;
    const a = curve.getPoint(t0), b = curve.getPoint(t1);
    group.add(rod(a, b, r, r * 0.95, color, 6));
    if (spine > 0) {
      const mid = a.clone().lerp(b, 0.5);
      group.add(rod(mid, mid.clone().add(V(0, spine * (1 - i / n * 0.6), -spine * 0.25)), r * 0.35, r * 0.15, color, 4));
    }
  }
}

export function buildAnatomy(speciesId, male) {
  const sp = SPECIES[speciesId];
  const m = sp.model;
  const d = computeDims(m);
  const L = m.bodyLen, H = m.bodyH, W = m.bodyW, cY = d.cY;
  const nb = d.neckBase;
  const headBase = nb.clone().add(d.neckEnd);
  const hc = nb.clone().add(d.headCenter);
  const hd = d.headDir;
  const skeleton = new THREE.Group(), muscles = new THREE.Group(), organs = new THREE.Group();
  const labels = [];
  const label = (layer, name, desc, pos) => labels.push({ layer, name, desc, pos: pos.clone() });
  const vr = H * 0.045;
  const A = sp.anatomy;
  const fam = sp.family;
  const carnivoran = /Canidae|Felidae|Ursidae|Procyonidae|Mustelidae/.test(fam);
  const isCat = /Felidae/.test(fam), isDog = /Canidae/.test(fam), isDeer = /Cervidae/.test(fam);

  // ---- Skeleton ----
  const withers = V(0, cY + H * 0.4, L * 0.3);
  const tEnd = V(0, cY + H * 0.34, -L * 0.12);
  const lEnd = V(0, cY + H * 0.31, -L * 0.38);
  const tailBase = d.tailBase.clone();
  const tailTip = tailBase.clone().add(V(0, -m.tailLen * 0.7, -m.tailLen * 0.5));
  const neckCurve = new THREE.QuadraticBezierCurve3(headBase.clone().add(V(0, -m.headH * 0.15, -m.headLen * 0.1)), nb.clone().lerp(headBase, 0.5).add(V(0, -m.neckLen * 0.08, 0)), nb.clone().add(V(0, -H * 0.05, -L * 0.04)));
  const thorCurve = new THREE.QuadraticBezierCurve3(nb.clone().add(V(0, -H * 0.05, -L * 0.04)), withers.clone().add(V(0, 0.02 * H, -L * 0.05)), tEnd);
  const lumbCurve = new THREE.QuadraticBezierCurve3(tEnd, V(0, cY + H * 0.36, -L * 0.25), lEnd);
  const tailCurve = new THREE.QuadraticBezierCurve3(tailBase, tailBase.clone().lerp(tailTip, 0.5).add(V(0, 0, -0.02)), tailTip);
  vertebrae(skeleton, neckCurve, 7, vr * 1.25);
  vertebrae(skeleton, thorCurve, sp.anatomy.ribs, vr, H * (m.hopper ? 0.06 : 0.18 + (m.hump ? m.hump.h * 0.5 : 0)));
  vertebrae(skeleton, lumbCurve, m.hopper ? 7 : 6, vr * 1.1, H * 0.06);
  skeleton.add(rod(lEnd, tailBase, vr * 1.2, vr * 0.8, BONE, 6)); // sacrum
  vertebrae(skeleton, tailCurve, m.tailType === 'bushy' ? 10 : 5, vr * 0.6);
  label('skeleton', 'Cervical vertebrae', 'Seven neck vertebrae — the same number in almost all mammals, from rabbits to giraffes. They carry the head and allow it to lower for feeding.', neckCurve.getPoint(0.5));
  label('skeleton', 'Thoracic spine', `${A.ribsApprox ? 'About ' : ''}${A.ribs} thoracic vertebrae, each bearing a pair of ribs. ${A.spine || 'Tall dorsal spines over the shoulders (the withers) anchor the neck ligament and muscles.'}`, thorCurve.getPoint(0.35).add(V(0, H * 0.12, 0)));
  label('skeleton', 'Lumbar & sacrum', 'Lumbar vertebrae carry no ribs and flex during running; the fused sacrum joins the spine to the pelvis.', lumbCurve.getPoint(0.6));

  // Ribs + sternum
  const nR = sp.anatomy.ribs;
  const sternY = cY - H * 0.42;
  for (let i = 0; i < nR; i++) {
    const k = i / (nR - 1);
    const p = thorCurve.getPoint(0.12 + k * 0.85);
    const bottom = lerpN(sternY, cY - H * 0.2, Math.max(0, k - 0.55) / 0.45);
    const ry = (p.y - bottom) / 2;
    const rx = W * 0.47 * (0.65 + 0.35 * Math.sin(Math.PI * (0.2 + k * 0.75)));
    const curve = new RibCurve(p.y - ry, rx, ry, p.z, L * 0.07, k > 0.6 ? 0.18 + (k - 0.6) * 1.2 : 0.12);
    const geo = new THREE.TubeGeometry(curve, 18, vr * 0.32, 4, false);
    skeleton.add(new THREE.Mesh(geo, mat(BONE)));
  }
  const sFront = thorCurve.getPoint(0.12), sBack = thorCurve.getPoint(0.72);
  skeleton.add(rod(V(0, sternY + 0.01, sFront.z - L * 0.07), V(0, sternY + H * 0.06, sBack.z - L * 0.07), vr * 0.6, vr * 0.5, BONE, 5));
  label('skeleton', 'Rib cage', 'Ribs and sternum protect the heart and lungs and act as bellows during breathing.', V(W * 0.42, cY, L * 0.12));

  // Skull
  skeleton.add(blob(hc, m.headW * 0.42, m.headH * 0.42, m.headLen * 0.45, BONE, 1, Math.atan2(-hd.y, hd.z)));
  const snoutA = hc.clone().addScaledVector(hd, m.headLen * 0.25).add(V(0, -m.headH * 0.08, 0));
  const snoutB = snoutA.clone().addScaledVector(hd, m.snoutLen * 0.95);
  skeleton.add(spindle(snoutA, snoutB, m.snoutR * 1.05, BONE));
  const jawA = hc.clone().add(V(0, -m.headH * 0.32, 0)).addScaledVector(hd, -m.headLen * 0.25);
  skeleton.add(spindle(jawA, snoutB.clone().add(V(0, -m.snoutR * 0.9, 0)), m.headW * 0.12, BONE, 1, 2.2));
  for (const s of [-1, 1]) skeleton.add(blob(hc.clone().add(V(s * m.headW * 0.36, m.headH * 0.14, m.headLen * 0.05)), m.headW * 0.1, m.headW * 0.1, m.headW * 0.1, 0x3a332b));
  const skullNote = A.skull ? A.skull : sp.behavior.predator
    ? 'Forward-facing eye sockets give overlapping (binocular) vision for judging distance. Large carnassial teeth shear meat.'
    : carnivoran
      ? 'A carnivoran skull adapted to a mixed diet: canines for defence and broad, flattened molars for crushing plants.'
    : speciesId === 'boar'
      ? 'Long skull ending in the prenasal bone that stiffens the digging snout. Continuously growing canine tusks.'
      : 'Eye sockets sit on the sides of the skull for a wide field of view. Broad molars grind plant material' + (sp.anatomy.ruminant ? '; there are no upper incisors, only a tough dental pad.' : '.');
  label('skeleton', 'Skull', skullNote, hc.clone().add(V(0, m.headH * 0.4, 0)));

  // Limbs
  const legRoots = [[d.legX, d.frontZ, false], [-d.legX, d.frontZ, false], [d.legX, d.hindZ, true], [-d.legX, d.hindZ, true]];
  for (const [x, z, hind] of legRoots) {
    const J = (hind ? d.hind : d.front).map((p) => p.clone().add(V(x, d.legTopY, z)));
    const r = m.legR;
    if (!hind) {
      // scapula
      const top = V(x * 1.15, cY + H * 0.36, z - L * 0.1);
      skeleton.add(spindle(top, J[0], r * 1.6, BONE, 1, 0.45));
    } else {
      // pelvis (ilium + ischium)
      skeleton.add(rod(V(x * 0.7, cY + H * 0.3, -L * 0.3), J[0], r * 0.9, r * 0.8, BONE, 5));
      skeleton.add(rod(J[0], V(x * 0.6, cY + H * 0.08, -L * 0.5), r * 0.8, r * 0.6, BONE, 5));
    }
    const radii = hind ? [1.0, 0.85, 0.6, 0.5] : [0.95, 0.75, 0.55, 0.5];
    for (let i = 0; i < 4; i++) {
      skeleton.add(rod(J[i], J[i + 1], r * radii[i], r * radii[i] * 0.85, BONE, 6));
      skeleton.add(blob(J[i + 1], r * radii[i] * 0.95, r * radii[i] * 0.95, r * radii[i] * 0.95, BONE, 1, 0, 0, 0, 6));
    }
    if (hind) skeleton.add(rod(J[2], J[2].clone().add(V(0, r * 2.2, -r * 1.6)), r * 0.45, r * 0.3, BONE, 5)); // calcaneus (point of hock)
    if (x > 0) {
      if (!hind) {
        label('skeleton', 'Scapula & humerus', 'In most running mammals the shoulder blade is attached only by muscle, with no functional collarbone, which lengthens the stride.', J[0].clone().add(V(0, H * 0.1, 0)));
        const footNote = A.foot ? A.foot
          : A.ruminant ? 'Fused third and fourth metacarpals form a single long "cannon bone"; the animal stands on the tips of two toes (unguligrade).'
          : m.foot === 'hoof' ? 'Pigs stand on their third and fourth toes; unlike ruminants their metacarpals stay separate, and two smaller dewclaws sit behind.'
          : m.hopper ? 'Rabbits have long, furred hind feet with no pads; long metatarsals power each hop.'
          : isDog ? 'Canids walk on their toes (digitigrade); the long metacarpals act as an extra lever for speed.'
          : isCat ? 'Cats are digitigrade and keep their claws retracted while walking.'
          : 'The feet carry five toes with non-retractable claws.';
        label('skeleton', A.ruminant ? 'Cannon bone' : 'Metacarpals', footNote, J[2].clone().lerp(J[3], 0.5));
      } else {
        label('skeleton', 'Femur, tibia & hock', 'The hock is the ankle; its point (calcaneus) anchors the Achilles tendon that powers each stride.', J[2].clone());
      }
    }
  }

  // ---- Muscles ----
  const MC = 0xb8584e, MC2 = 0xa64a44, MO = 0.72;
  for (const s of [-1, 1]) {
    const x = s * W * 0.38;
    muscles.add(spindle(headBase.clone().add(V(s * m.neckR * 0.8, -m.neckR * 0.3, 0)), V(s * W * 0.4, cY - H * 0.05, L * 0.36), m.neckR * 0.55, MC, MO));
    muscles.add(spindle(V(x * 0.6, cY + H * 0.4, L * 0.25), V(x * 0.6, cY + H * 0.38, -L * 0.4), H * 0.12, MC2, MO));
    muscles.add(blob(V(x * 0.95, cY + H * 0.1, L * 0.28), W * 0.13, H * 0.3, L * 0.12, MC, MO, -0.3));
    muscles.add(blob(V(x * 0.95, cY - H * 0.1, L * 0.2), W * 0.12, H * 0.22, L * 0.08, MC2, MO));
    muscles.add(blob(V(x * 0.8, cY + H * 0.25, -L * 0.36), W * 0.15, H * 0.2, L * 0.13, MC2, MO));
    muscles.add(blob(V(x * 0.95, cY - H * 0.08, -L * 0.42), W * 0.14, H * 0.38, L * 0.11, MC, MO, 0.25));
    muscles.add(blob(V(x * 0.95, cY - H * 0.05, -L * 0.24), W * 0.12, H * 0.32, L * 0.08, MC2, MO, -0.2));
    muscles.add(blob(V(x * 1.0, cY - H * 0.12, -L * 0.02), W * 0.05, H * 0.3, L * 0.26, 0xc06a5e, 0.45));
    muscles.add(blob(hc.clone().add(V(s * m.headW * 0.38, -m.headH * 0.15, -m.headLen * 0.1)), m.headW * 0.1, m.headH * 0.22, m.headLen * 0.18, MC, MO));
  }
  label('muscles', 'Brachiocephalicus', 'Runs from the head to the upper foreleg; it swings the leg forward and lowers the head and neck.', V(W * 0.35, nb.y + 0.02, nb.z + m.neckLen * 0.25));
  label('muscles', 'Longissimus dorsi', 'The long back muscle along the spine — it extends and stabilises the back during running and leaping.', V(W * 0.3, cY + H * 0.48, -L * 0.05));
  label('muscles', 'Triceps brachii', 'Behind the shoulder; straightens the elbow to push the body forward and bear weight.', V(W * 0.45, cY + H * 0.05, L * 0.28));
  label('muscles', 'Gluteals & hamstrings', 'Hindquarter muscles (gluteals, biceps femoris, semitendinosus) produce most of the propulsion when running.', V(W * 0.45, cY + H * 0.15, -L * 0.42));
  label('muscles', 'Abdominal obliques', 'Thin sheets of muscle that support the abdominal organs and help with breathing.', V(W * 0.5, cY - H * 0.15, -L * 0.02));
  label('muscles', 'Masseter', carnivoran ? 'Powerful jaw muscle; together with the temporalis it gives carnivorans a strong bite.' : 'Jaw muscle used in the side-to-side chewing motion that grinds plant food.', hc.clone().add(V(m.headW * 0.45, -m.headH * 0.1, 0)));

  // ---- Organs ----
  const brain = blob(hc.clone().addScaledVector(hd, -m.headLen * 0.12).add(V(0, m.headH * 0.12, 0)), m.headW * 0.28, m.headH * 0.24, m.headLen * 0.2, 0xe8b6c4);
  organs.add(brain);
  label('organs', 'Brain', sp.behavior.predator ? 'Large olfactory bulbs process an exceptional sense of smell.' : 'Well-developed regions for smell and hearing support constant vigilance for predators.', brain.position.clone().add(V(0, m.headH * 0.2, 0)));
  // trachea
  const trA = headBase.clone().add(V(0, -m.headH * 0.35, m.headLen * 0.05));
  const trB = V(0, cY + H * 0.05, L * 0.34);
  organs.add(rod(trA, trB, m.neckR * 0.22, m.neckR * 0.2, 0xe9d2c6, 8));
  label('organs', 'Trachea', 'The windpipe, stiffened by cartilage rings, carries air from the throat to the lungs.', trA.clone().lerp(trB, 0.5));
  // lungs
  for (const s of [-1, 1]) organs.add(blob(V(s * W * 0.16, cY + H * 0.06, L * 0.14), W * 0.17, H * 0.27, L * 0.19, 0xe58f9d, 0.95));
  label('organs', 'Lungs', 'Fill most of the chest cavity. Large lungs give the endurance needed to flee or chase over long distances.', V(W * 0.25, cY + H * 0.2, L * 0.14));
  // heart
  const heart = blob(V(W * 0.03, cY - H * 0.18, L * 0.24), W * 0.12, H * 0.15, L * 0.08, 0xb3343f, 1, 0.4);
  organs.add(heart);
  label('organs', 'Heart', 'A four-chambered heart lying low in the chest, just behind the elbow of the front leg. Together with the lungs this "vital zone" is where ethical hunters aim for a quick, humane harvest.', heart.position);
  // diaphragm
  const dia = new THREE.Mesh(new THREE.CircleGeometry(1, 20), mat(0xd9a7a0, 0.45));
  dia.position.set(0, cY, -L * 0.04);
  dia.scale.set(W * 0.45, H * 0.45, 1);
  dia.rotation.x = 0.35;
  organs.add(dia);
  label('organs', 'Diaphragm', 'Dome-shaped muscle separating chest from abdomen; contracting it draws air into the lungs.', V(0, cY + H * 0.38, -L * 0.04));
  // liver (right side = -X)
  const liver = blob(V(-W * 0.12, cY - H * 0.04, -L * 0.08), W * 0.22, H * 0.24, L * 0.08, 0x7d2f29, 1, 0.3);
  organs.add(liver);
  label('organs', 'Liver', 'The largest internal organ: stores energy, filters blood and produces bile.' + (isDeer ? ' Deer have no gallbladder.' : ''), liver.position.clone().add(V(-W * 0.2, 0, 0)));
  if (sp.anatomy.ruminant) {
    const rumen = blob(V(W * 0.13, cY - H * 0.06, -L * 0.22), W * 0.28, H * 0.33, L * 0.18, 0x9aa96b);
    organs.add(rumen);
    organs.add(blob(V(W * 0.04, cY - H * 0.22, -L * 0.07), W * 0.12, H * 0.12, L * 0.06, 0x8c9a5c));
    organs.add(blob(V(-W * 0.1, cY - H * 0.16, -L * 0.14), W * 0.11, H * 0.12, L * 0.07, 0xb9a77c));
    organs.add(spindle(V(-W * 0.02, cY - H * 0.32, -L * 0.1), V(-W * 0.14, cY - H * 0.22, -L * 0.28), W * 0.08, 0xd49c7c));
    label('organs', 'Rumen', 'The largest of four stomach chambers (rumen, reticulum, omasum, abomasum). Microbes ferment cellulose here; the animal later regurgitates and re-chews this cud.', rumen.position.clone().add(V(W * 0.3, 0, 0)));
    label('organs', 'Omasum & abomasum', 'The omasum absorbs water; the abomasum is the "true stomach" that digests with acid and enzymes, like our own.', V(-W * 0.28, cY - H * 0.2, -L * 0.18));
  } else {
    const st = blob(V(W * 0.1, cY - H * 0.06, -L * 0.06), W * 0.2, H * 0.2, L * 0.12, 0xd9a066, 1, 0, 0, 0.4);
    organs.add(st);
    label('organs', 'Stomach', sp.behavior.predator || carnivoran ? 'A simple, stretchy stomach typical of carnivorans, able to hold a large meal at once.' : 'A single-chambered (monogastric) stomach, as in humans.', st.position.clone().add(V(W * 0.25, 0, 0)));
  }
  // intestines
  const gut = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.28, 64, 6, 3, 7), mat(0xd9b384));
  gut.position.set(0, cY - H * 0.2, -L * (sp.anatomy.ruminant ? 0.32 : 0.26));
  gut.scale.set(W * 0.26, H * 0.18, L * 0.14);
  organs.add(gut);
  label('organs', 'Intestines', A.gut ? A.gut : sp.behavior.predator || carnivoran ? 'Relatively short — meat is easy to digest.' : 'Very long intestines — many times the body length — extract nutrients from fibrous plants.', gut.position.clone().add(V(W * 0.32, -H * 0.05, 0)));
  if (speciesId === 'rabbit' || speciesId === 'boar') {
    const ce = blob(V(-W * 0.12, cY - H * 0.15, -L * 0.3), W * 0.16, H * 0.16, L * 0.14, 0xb39556, 1, 0.5);
    organs.add(ce);
    label('organs', 'Cecum', speciesId === 'rabbit' ? 'Huge in rabbits — a fermentation chamber that produces nutrient-rich soft pellets which the rabbit re-ingests (caecotrophy).' : 'An enlarged cecum helps ferment the plant part of the boar\'s omnivorous diet.', ce.position.clone().add(V(-W * 0.25, 0, 0)));
  }
  for (const s of [-1, 1]) organs.add(blob(V(s * W * 0.14, cY + H * 0.2, -L * 0.24), W * 0.06, H * 0.08, L * 0.05, 0x8e3a3a));
  label('organs', 'Kidneys', 'Filter the blood and regulate water balance; they lie against the roof of the abdomen beneath the lumbar spine.', V(W * 0.2, cY + H * 0.28, -L * 0.24));

  const group = new THREE.Group();
  group.add(skeleton, muscles, organs);
  return { group, layers: { skeleton, muscles, organs }, labels, dims: d };
}

function lerpN(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

// ---------------------------------------------------------------------------
// Birds: skeleton (with keel, wishbone and fused bones), flight muscles and the
// distinctive bird organs (air sacs, crop, gizzard). Built in the bird rig's space.
// ---------------------------------------------------------------------------
export function buildBirdAnatomy(speciesId) {
  const sp = SPECIES[speciesId];
  const m = sp.model;
  const d = birdDims(m);
  const { cy, R, L } = d;
  const skeleton = new THREE.Group(), muscles = new THREE.Group(), organs = new THREE.Group();
  const labels = [];
  const label = (layer, name, desc, pos) => labels.push({ layer, name, desc, pos: pos.clone() });
  const br = Math.max(0.004, R * 0.05);
  const isRaptor = !!m.hooked;
  const noCrop = speciesId === 'owl';

  // spine: long flexible neck, fused back (synsacrum), pygostyle
  const neckPts = [];
  const nN = m.sNeck ? 18 : 14;
  for (let i = 0; i <= nN; i++) {
    const t = i / nN;
    const p = d.neckBase.clone().lerp(d.neckEnd, t);
    if (m.sNeck) p.z -= Math.sin(t * Math.PI) * m.neckLen * 0.18;
    neckPts.push(p);
  }
  for (let i = 0; i < nN; i++) skeleton.add(rod(neckPts[i], neckPts[i].clone().lerp(neckPts[i + 1], 0.75), br * 1.1, br, BONE, 5));
  const back0 = V(0, cy + R * 0.55, L * 0.3), back1 = V(0, cy + R * 0.5, -L * 0.3), pyg = V(0, cy + R * 0.3, -L * 0.45);
  skeleton.add(rod(back0, back1, br * 1.6, br * 1.8, BONE, 6));
  skeleton.add(rod(back1, pyg, br * 1.4, br * 0.8, BONE, 5));
  label('skeleton', 'Neck vertebrae', `About ${nN} neck vertebrae (mammals have 7), giving birds a very flexible neck for preening and feeding.`, neckPts[Math.floor(nN / 2)]);
  label('skeleton', 'Synsacrum', 'Lower back vertebrae fused with the pelvis into one rigid plate — a stable base for flight and walking.', back1.clone().add(V(0, R * 0.15, 0)));
  label('skeleton', 'Pygostyle', 'Fused tail vertebrae that anchor the tail feathers used for steering.', pyg);

  // skull and beak
  skeleton.add(blob(d.head, m.headR * 0.85, m.headR * 0.8, m.headR * 0.95, BONE));
  const b0 = d.head.clone().add(V(0, -m.headR * 0.1, m.headR * 0.8));
  skeleton.add(rod(b0, b0.clone().add(V(0, isRaptor ? -m.beakLen * 0.3 : -m.beakLen * 0.1, m.beakLen)), m.headR * 0.28, m.headR * 0.04, BONE, 5));
  label('skeleton', 'Skull & beak', 'A light skull with very large eye sockets. The beak is bone covered in keratin; there are no teeth.', d.head.clone().add(V(0, m.headR, 0)));

  // ribs, keel and wishbone
  for (let i = 0; i < 6; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.82, br * 0.5, 4, 14, Math.PI * 1.6), mat(BONE));
    ring.position.set(0, cy, L * (0.22 - i * 0.08));
    ring.rotation.set(0, Math.PI / 2, Math.PI * 0.7);
    ring.scale.set(1, 1.05, 0.9);
    skeleton.add(ring);
  }
  const keel = new THREE.Mesh(new THREE.BoxGeometry(br * 0.8, R * 0.7, L * 0.5), mat(BONE));
  keel.position.set(0, cy - R * 0.6, L * 0.12);
  skeleton.add(keel);
  label('skeleton', 'Keel (sternum)', 'A deep blade on the breastbone that anchors the huge flight muscles. Flightless birds lack it.', keel.position.clone().add(V(0, -R * 0.3, 0)));
  for (const s of [-1, 1]) skeleton.add(rod(V(s * R * 0.55, cy + R * 0.4, L * 0.3), V(0, cy - R * 0.25, L * 0.42), br * 0.7, br * 0.6, BONE, 4));
  label('skeleton', 'Furcula (wishbone)', 'Fused collarbones that flex like a spring with each wingbeat.', V(R * 0.3, cy + R * 0.1, L * 0.4));

  // folded wing bones (Z-fold: humerus back, forearm forward, hand back) and legs
  const half = d.half;
  for (const s of [-1, 1]) {
    const sh = V(s * R * 0.85, cy + R * 0.35, L * 0.12);
    const el = sh.clone().add(V(s * R * 0.12, -R * 0.1, -half * 0.28));
    const wr = el.clone().add(V(0, R * 0.05, half * 0.24));
    const tip = wr.clone().add(V(0, -R * 0.05, -half * 0.42));
    skeleton.add(rod(sh, el, br * 1.4, br * 1.2, BONE, 5));
    skeleton.add(rod(el, wr, br * 1.1, br, BONE, 5));
    skeleton.add(rod(wr, tip, br, br * 0.4, BONE, 4));
    if (s > 0) label('skeleton', 'Wing bones', 'Humerus, radius and ulna, then fused hand bones (carpometacarpus) that carry the primary flight feathers. Many bones are hollow and braced inside.', el);
    const hip = V(s * R * 0.35, cy - R * 0.1, -L * 0.05);
    const knee = hip.clone().add(V(0, -R * 0.35, L * 0.12));
    const ankle = V(s * R * 0.35, m.legLen * 0.55 + 0.01, -L * 0.02);
    const foot = V(s * R * 0.35, 0.01, L * 0.06);
    skeleton.add(rod(hip, knee, br * 1.5, br * 1.3, BONE, 5));
    skeleton.add(rod(knee, ankle, br * 1.3, br, BONE, 5));
    skeleton.add(rod(ankle, foot, br, br * 0.8, BONE, 4));
    if (s > 0) label('skeleton', 'Leg bones', 'The joint that seems to bend "backwards" is the ankle; the true knee is hidden up against the body.', ankle);
  }

  // flight muscles
  const MC = 0xb8584e;
  for (const s of [-1, 1]) {
    muscles.add(blob(V(s * R * 0.42, cy - R * 0.25, L * 0.16), R * 0.42, R * 0.55, L * 0.28, MC, 0.72));
    muscles.add(blob(V(s * R * 0.2, cy - R * 0.38, L * 0.14), R * 0.2, R * 0.3, L * 0.18, 0xa64a44, 0.72));
    muscles.add(blob(V(s * R * 0.4, cy - R * 0.55, -L * 0.04), R * 0.22, R * 0.35, R * 0.3, 0xa64a44, 0.72));
  }
  label('muscles', 'Pectoralis', 'The main flight muscle, pulling the wing down on each beat. In strong fliers it can be a fifth or more of body weight.', V(R * 0.85, cy - R * 0.2, L * 0.2));
  label('muscles', 'Supracoracoideus', 'Lies beneath the pectoralis and lifts the wing through a tendon that runs over the shoulder like a pulley.', V(R * 0.2, cy - R * 0.75, L * 0.2));
  label('muscles', 'Leg muscles', sp.behavior.mode === 'ground' ? 'Ground birds use their legs all day; these muscles are rich in myoglobin, which is why the leg meat is dark.' : 'Thigh and drumstick muscles that move the long tendons of the toes.', V(R * 0.7, cy - R * 0.6, -L * 0.05));

  // organs
  const heart = blob(V(0, cy - R * 0.15, L * 0.22), R * 0.2, R * 0.26, R * 0.22, 0xb3343f);
  organs.add(heart);
  label('organs', 'Heart', 'A four-chambered heart that is large for the body size, beating hundreds of times a minute in flight.', heart.position);
  for (const s of [-1, 1]) organs.add(blob(V(s * R * 0.32, cy + R * 0.38, L * 0.1), R * 0.18, R * 0.14, L * 0.16, 0xe58f9d));
  label('organs', 'Lungs', 'Small, rigid lungs fixed against the ribs. Air flows through them in one direction, extracting oxygen more efficiently than mammal lungs.', V(R * 0.45, cy + R * 0.55, L * 0.1));
  for (const s of [-1, 1]) organs.add(blob(V(s * R * 0.4, cy, -L * 0.12), R * 0.3, R * 0.45, L * 0.2, 0xdfe8f0, 0.35));
  label('organs', 'Air sacs', 'Balloon-like sacs that fill much of the body and even extend into some bones. They act as bellows that push air through the lungs.', V(R * 0.7, cy + R * 0.1, -L * 0.15));
  if (!noCrop) {
    const crop = blob(d.neckBase.clone().add(V(0, -R * 0.1, R * 0.15)), R * 0.25, R * 0.22, R * 0.25, 0xe2c6a0);
    organs.add(crop);
    label('organs', 'Crop', speciesId === 'pigeon' || speciesId === 'dove' ? 'A pouch in the throat that stores food. Pigeons and doves also produce "crop milk" here to feed their young.' : 'A pouch in the throat where food is stored before digestion.', crop.position);
  }
  const giz = blob(V(R * 0.1, cy - R * 0.3, -L * 0.08), R * 0.28, R * 0.25, R * 0.28, 0x9a5a3a);
  organs.add(giz);
  label('organs', 'Gizzard', isRaptor ? 'A thinner-walled gizzard; fur, feathers and bones are compacted and coughed up as pellets.' : 'A muscular stomach that grinds food with swallowed grit, doing the job of teeth.', giz.position.clone().add(V(R * 0.3, 0, 0)));
  const liver = blob(V(-R * 0.2, cy - R * 0.1, L * 0.06), R * 0.32, R * 0.25, R * 0.3, 0x7d2f29);
  organs.add(liver);
  label('organs', 'Liver', 'A large two-lobed liver that stores energy and produces bile.', liver.position.clone().add(V(-R * 0.3, 0, 0)));
  const gut = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 48, 5, 2, 5), mat(0xd9b384));
  gut.position.set(0, cy - R * 0.2, -L * 0.25);
  gut.scale.set(R * 0.28, R * 0.22, L * 0.12);
  organs.add(gut);
  label('organs', 'Intestines & cloaca', 'A short gut keeps the bird light. Digestive, urinary and reproductive tracts all open into the single cloaca.', gut.position.clone().add(V(R * 0.35, 0, 0)));
  const brain = blob(d.head.clone().add(V(0, m.headR * 0.15, -m.headR * 0.15)), m.headR * 0.5, m.headR * 0.45, m.headR * 0.55, 0xe8b6c4);
  organs.add(brain);
  label('organs', 'Brain', speciesId === 'crow' ? 'Exceptionally large for a bird; crows rival apes in some problem-solving tests.' : 'Large optic lobes process vision, the most important sense for most birds.', brain.position.clone().add(V(0, m.headR * 0.5, 0)));

  const group = new THREE.Group();
  group.add(skeleton, muscles, organs);
  return { group, layers: { skeleton, muscles, organs }, labels, dims: d };
}
