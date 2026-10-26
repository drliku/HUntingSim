// A small reusable 3D viewer for one animal: used by the Field Guide, the harvest card and
// carcass inspection. One WebGL context; its element is moved into whichever panel is open.
import * as THREE from 'three';
import { SPECIES } from './species.js';
import { createAnimalRig, animalMaterial } from './animalModel.js';
import { buildAnatomy, buildBirdAnatomy } from './anatomy.js';
import { createBirdRig, poseWings } from './birdModel.js';
import { clamp } from './utils.js';

const LAYER_COLORS = { skeleton: '#ece3cc', muscles: '#c4605a', organs: '#e58f9d' };

export class Stage {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'stage';
    this.el.innerHTML = `
      <div class="stage-view"><canvas></canvas><div class="anat-labels hidden"></div></div>
      <div class="stage-tools">
        <button class="btn small toggle" data-act="anatomy">Anatomy</button>
        <span class="anat-layers hidden">
          <label><input type="checkbox" data-layer="skin" checked />Skin</label>
          <label><input type="checkbox" data-layer="skeleton" checked />Skeleton</label>
          <label><input type="checkbox" data-layer="muscles" />Muscles</label>
          <label><input type="checkbox" data-layer="organs" checked />Organs</label>
        </span>
        <span class="stage-extra"></span>
      </div>
      <div class="anat-desc hidden"></div>`;
    this.view = this.el.querySelector('.stage-view');
    this.canvas = this.el.querySelector('canvas');
    this.labelsEl = this.el.querySelector('.anat-labels');
    this.toolsEl = this.el.querySelector('.stage-tools');
    this.extraEl = this.el.querySelector('.stage-extra');
    this.layersEl = this.el.querySelector('.anat-layers');
    this.descEl = this.el.querySelector('.anat-desc');
    this.anatomyBtn = this.el.querySelector('[data-act="anatomy"]');
    this.anatomyOn = false;
    this.yaw = -0.9; this.pitch = 0.15; this.dist = 3.1; this.auto = true;
    this.subject = null;
    this.renderer = null;

    let drag = null;
    this.view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; this.view.setPointerCapture(e.pointerId); });
    this.view.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag.x) * 0.01;
      this.pitch = clamp(this.pitch + (e.clientY - drag.y) * 0.006, -0.3, 1.25);
      this.auto = false;
      drag = { x: e.clientX, y: e.clientY };
    });
    this.view.addEventListener('pointerup', () => { drag = null; });
    this.view.addEventListener('wheel', (e) => { this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 1.4, 7); e.preventDefault(); }, { passive: false });
    this.anatomyBtn.addEventListener('click', () => this.setAnatomy(!this.anatomyOn));
    this.layersEl.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => this.refresh()));
    this.labelsEl.addEventListener('click', (e) => {
      const el = e.target.closest('.anat-label');
      if (!el || !this.anat) return;
      const l = this.anat.labels[+el.dataset.i];
      this.labelsEl.querySelectorAll('.anat-label').forEach((n) => n.classList.toggle('sel', n === el));
      this.descEl.innerHTML = `<b>${l.name}</b> — ${l.desc}`;
      this.descEl.classList.remove('hidden');
    });
  }

  init() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3428, 1.6));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd2ff, 1.0);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    this.holder = new THREE.Group();
    scene.add(this.holder);
    this.ghostMat = animalMaterial.clone();
    this.ghostMat.transparent = true;
    this.ghostMat.opacity = 0.14;
    this.ghostMat.depthWrite = false;
  }

  // Place the viewer inside a panel. `tools` shows the anatomy toolbar.
  mount(host, { tools = true } = {}) {
    this.init();
    if (this.el.parentElement !== host) host.appendChild(this.el);
    this.toolsEl.classList.toggle('hidden', !tools);
    this.extraEl.innerHTML = '';
    if (!tools && this.anatomyOn) this.setAnatomy(false);
    this.descEl.classList.add('hidden');
    return this.extraEl;
  }

  // pose: 'stand' | 'down' (lying on its side, used for harvested animals)
  show(speciesId, male, pose = 'stand') {
    this.init();
    this.subject = { speciesId, male, pose };
    this.auto = true;
    this.yaw = pose === 'down' ? -0.5 : -0.9;
    this.pitch = pose === 'down' ? 0.45 : 0.15;
    this.build();
  }

  build() {
    const { speciesId, male } = this.subject;
    const pose = this.anatomyOn ? 'stand' : this.subject.pose;
    while (this.holder.children.length) this.holder.remove(this.holder.children[0]);
    if (this.anat) this.anat.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const sp = SPECIES[speciesId];
    const m = sp.model;
    const isBird = sp.kind === 'bird';
    const rig = isBird ? createBirdRig(speciesId, male, animalMaterial) : createAnimalRig(speciesId, male, animalMaterial);
    const anat = isBird ? buildBirdAnatomy(speciesId) : buildAnatomy(speciesId, male);
    (isBird ? rig.bodyPivot : rig.root).add(anat.group);
    const size = isBird
      ? Math.max(m.bodyLen + m.neckLen * 0.5 + m.tailLen, m.legLen + m.bodyR * 2 + m.neckLen)
      : Math.max(m.shoulderH + m.neckLen * 0.6, m.bodyLen + m.headLen + m.neckLen * 0.6 + (['bushy', 'long', 'ringed'].includes(m.tailType) ? m.tailLen * 0.6 : 0));
    const s = 1.9 / size;
    rig.root.scale.setScalar(s);
    rig.root.position.set(0, 0, isBird ? 0 : -(m.neckLen * 0.35) * s);
    if (isBird) {
      poseWings(rig, pose === 'down' ? 0.55 : 0, pose === 'down' ? 0.15 : 0);
      if (pose === 'down') { rig.bodyPivot.rotation.z = 1.35; rig.bodyPivot.position.y = -m.legLen * 0.6; }
    } else if (pose === 'down') {
      rig.bodyPivot.rotation.z = 1.3;
      rig.bodyPivot.position.y = -m.bodyH * 0.12;
      rig.legs.forEach((l, i) => { l.rotation.x = i < 2 ? -0.3 : 0.3; });
      if (rig.setHead) rig.setHead(0.4, 0); else rig.headPivot.rotation.x = 0.4;
    }
    this.holder.add(rig.root);
    this.rig = rig; this.anat = anat; this.scale = s; this.pose = pose;
    // frame the camera on the posed model
    rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig.root);
    const bsize = box.getSize(new THREE.Vector3());
    this.target = box.getCenter(new THREE.Vector3());
    if (pose === 'stand' && !isBird) this.target.y = m.shoulderH * 0.62 * s;
    this.dist = Math.max(2.2, Math.max(bsize.x, bsize.y, bsize.z) * (pose === 'down' ? 1.45 : 1.9));
    this.labelsEl.innerHTML = anat.labels.map((l, i) => `<div class="anat-label" data-i="${i}" data-layer="${l.layer}" style="--c:${LAYER_COLORS[l.layer]}"><span class="t">${l.name}</span></div>`).join('');
    this.refresh();
  }

  setAnatomy(on) {
    const changedPose = this.subject && this.subject.pose !== 'stand';
    this.anatomyOn = on;
    if (!on) this.descEl.classList.add('hidden');
    if (this.subject && changedPose) this.build(); else this.refresh();
  }

  refresh() {
    if (!this.rig) return;
    const on = this.anatomyOn;
    this.anatomyBtn.classList.toggle('on', on);
    this.layersEl.classList.toggle('hidden', !on);
    this.labelsEl.classList.toggle('hidden', !on);
    const layer = (n) => this.layersEl.querySelector(`input[data-layer="${n}"]`).checked;
    const skin = !on || layer('skin');
    this.rig.meshes.forEach((me) => { me.visible = skin; me.material = on ? this.ghostMat : animalMaterial; me.renderOrder = on ? 5 : 0; });
    this.anat.layers.skeleton.visible = on && layer('skeleton');
    this.anat.layers.muscles.visible = on && layer('muscles');
    this.anat.layers.organs.visible = on && layer('organs');
  }

  render(dt) {
    if (!this.rig || !this.el.isConnected) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(w * pr) || this.canvas.height !== Math.floor(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.auto) this.yaw += dt * 0.25;
    const t = this.target, cam = this.camera;
    cam.position.set(t.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, t.y + Math.sin(this.pitch) * this.dist, t.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    cam.lookAt(t);
    if (this.pose === 'stand' && this.rig.headPivot) {
      const tt = performance.now() / 1000;
      if (this.rig.setHead) this.rig.setHead(Math.sin(tt * 0.6) * 0.04, Math.sin(tt * 0.4) * 0.12);
      else this.rig.headPivot.rotation.set(Math.sin(tt * 0.6) * 0.04, Math.sin(tt * 0.4) * 0.12, 0);
    }
    this.renderer.render(this.scene, cam);
    if (this.anatomyOn) this.positionLabels(w, h);
  }

  positionLabels(w, h) {
    const nodes = this.labelsEl.children;
    const v = new THREE.Vector3();
    this.rig.root.updateMatrixWorld(true);
    const L = this.anat.layers;
    const layerOn = { skeleton: L.skeleton.visible, muscles: L.muscles.visible, organs: L.organs.visible };
    const camDir = new THREE.Vector3().subVectors(this.camera.position, this.target).setY(0).normalize();
    const placed = [];
    this.anat.labels.forEach((l, i) => {
      const n = nodes[i];
      if (!n) return;
      v.copy(l.pos);
      this.rig.root.localToWorld(v);
      const side = new THREE.Vector3(v.x - this.target.x, 0, v.z - this.target.z);
      const facing = side.lengthSq() < 1e-6 ? 1 : side.normalize().dot(camDir);
      v.project(this.camera);
      const show = layerOn[l.layer] && facing > -0.25 && v.z < 1;
      n.style.display = show ? '' : 'none';
      if (!show) return;
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      n.style.left = `${x}px`; n.style.top = `${y}px`;
      // labels that would overlap collapse to dots that reveal their name on hover
      const bw = l.name.length * 6.2 + 26, bh = 20;
      const r = { x0: x - bw / 2, x1: x + bw / 2, y0: y - bh / 2, y1: y + bh / 2 };
      const hit = placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
      const sel = n.classList.contains('sel');
      n.classList.toggle('dot', hit && !sel);
      if (!hit || sel) placed.push(r);
    });
  }
}
