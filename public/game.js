import * as THREE from 'three';
import { buildTrack, pointAt, nearest, itemBoxes, gridSlot, ROAD_WIDTH, LAPS } from '/shared/track.js';

// ───────────────────────────── constants ─────────────────────────────
const track = buildTrack();
const BOXES = itemBoxes(track);
const HALF = ROAD_WIDTH / 2;
const CURB = 1.6;
const WALL = HALF + 14;
const COLORS = ['#e8322d', '#2f7de1', '#2fbf4a', '#ffcc1f', '#ff7ac8', '#9b5cff', '#ff8a1f', '#20d6c9'];
const ITEMS = { turbo: '⚡', oil: '🛢️', missile: '🚀', shield: '🛡️' };
const PHY = { max: 34, offMax: 15, accel: 21, brake: 38, boostMax: 50, turn: 1.95 };
const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ───────────────────────────── renderer / scene ─────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.5, 1600);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// sky
scene.background = canvasTex(4, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#2f8ff0'); gr.addColorStop(0.55, '#8fd3ff'); gr.addColorStop(1, '#dff4ff');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(0xcdeeff, 180, 560);

scene.add(new THREE.HemisphereLight(0xffffff, 0x4f8a35, 0.95));
const sun = new THREE.DirectionalLight(0xfff3dd, 1.35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ground
const grassTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#5cb848'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#54ad41' : '#68c454';
    g.fillRect(Math.random() * w, Math.random() * h, 2, 4);
  }
  g.fillStyle = '#ffffff10';
  for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 32);
}, [140, 140]);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ map: grassTex }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.02, -100);
ground.receiveShadow = true;
scene.add(ground);

// ───────────────────────────── track meshes ─────────────────────────────
function strip(offA, offB, y, vLen, mat) {
  const M = track.count, pos = [], uv = [], idx = [];
  for (let k = 0; k <= M; k++) {
    const p = track.pts[k % M];
    pos.push(p.x + p.nx * offA, y, p.z + p.nz * offA, p.x + p.nx * offB, y, p.z + p.nz * offB);
    const v = (k * track.spacing) / vLen;
    uv.push(0, v, 1, v);
  }
  for (let k = 0; k < M; k++) { const i = k * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const roadTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#4a4d55'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) { const c = 60 + Math.random() * 30; g.fillStyle = `rgb(${c},${c},${c + 6})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.fillStyle = '#f2f2f2'; g.fillRect(w / 2 - 3, 0, 6, h / 2);
  g.fillStyle = '#dcdcdc'; g.fillRect(8, 0, 5, h); g.fillRect(w - 13, 0, 5, h);
});
roadTex.wrapT = THREE.RepeatWrapping;
const MAT_SIDE = { side: THREE.DoubleSide };
strip(HALF, -HALF, 0.02, 24, new THREE.MeshLambertMaterial({ map: roadTex, ...MAT_SIDE }));
const curbTex = canvasTex(8, 64, (g, w, h) => { g.fillStyle = '#e23b2e'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#fafafa'; g.fillRect(0, h / 2, w, h / 2); });
curbTex.wrapT = THREE.RepeatWrapping;
const curbMat = new THREE.MeshLambertMaterial({ map: curbTex, ...MAT_SIDE });
strip(HALF + CURB, HALF, 0.04, 4, curbMat);
strip(-HALF, -HALF - CURB, 0.04, 4, curbMat);
const dirtMat = new THREE.MeshLambertMaterial({ color: 0xc9a46a, ...MAT_SIDE });
strip(HALF + CURB + 5, HALF + CURB, 0.01, 10, dirtMat);
strip(-HALF - CURB, -HALF - CURB - 5, 0.01, 10, dirtMat);

// start line
{
  const p = track.pts[0];
  const chk = canvasTex(256, 32, (g, w, h) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); }
  });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 2.6), new THREE.MeshLambertMaterial({ map: chk }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(p.tx, p.tz) + Math.PI / 2;
  line.position.set(p.x, 0.05, p.z);
  scene.add(line);
  // gantry
  const h = Math.atan2(p.tx, p.tz);
  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0xffd23f });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 10, 12), postMat);
    post.position.set(s * (HALF + 2.5), 5, 0); post.castShadow = true; gantry.add(post);
  }
  const banner = canvasTex(512, 64, (g, w, hh) => {
    g.fillStyle = '#e8322d'; g.fillRect(0, 0, w, hh);
    g.font = 'bold 44px Bungee, Impact, sans-serif'; g.fillStyle = '#ffd23f'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('★ KART KREW ★', w / 2, hh / 2 + 2);
  });
  const ban = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 6, 2.4, 0.5), [postMat, postMat, postMat, postMat, new THREE.MeshLambertMaterial({ map: banner }), new THREE.MeshLambertMaterial({ map: banner })]);
  ban.position.y = 10; ban.castShadow = true; gantry.add(ban);
  gantry.position.set(p.x, 0, p.z);
  gantry.rotation.y = h;
  scene.add(gantry);
}

// tyre barriers (instanced), skipped where they'd intrude on another part of the track
{
  const tyreGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.9, 12);
  const mats = [new THREE.MeshLambertMaterial({ color: 0x222222 }), new THREE.MeshLambertMaterial({ color: 0xffffff })];
  const spots = [[], []];
  let n = 0;
  for (let k = 0; k < track.count; k += 1) {
    const p = track.pts[k];
    for (const s of [-1, 1]) {
      const x = p.x + p.nx * s * (WALL + 1.2), z = p.z + p.nz * s * (WALL + 1.2);
      if (nearest(track, x, z).dist < WALL - 0.5) continue;
      spots[n++ % 4 === 0 ? 1 : 0].push([x, z]);
    }
  }
  spots.forEach((arr, i) => {
    const im = new THREE.InstancedMesh(tyreGeo, mats[i], arr.length * 2);
    const m = new THREE.Matrix4();
    let c = 0;
    for (const [x, z] of arr) for (const y of [0.45, 1.35]) { m.makeTranslation(x, y, z); im.setMatrixAt(c++, m); }
    im.castShadow = true;
    scene.add(im);
  });
}

// trees + hills + clouds
{
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 6);
  const leafGeo = new THREE.ConeGeometry(3.2, 7, 8);
  const ballGeo = new THREE.IcosahedronGeometry(3.4, 1);
  const trees = [];
  let guard = 0;
  while (trees.length < 260 && guard++ < 5000) {
    const x = -340 + Math.random() * 640, z = -400 + Math.random() * 500;
    if (nearest(track, x, z).dist < WALL + 6) continue;
    trees.push([x, z, 0.7 + Math.random() * 0.9, Math.random() < 0.5]);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7a4b25 }), trees.length);
  const cones = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x2e8b3a }), trees.length);
  const balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshLambertMaterial({ color: 0x47b04a }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  trees.forEach(([x, z, s, round], i) => {
    sc.set(s, s, s);
    trunks.setMatrixAt(i, m.compose(ps.set(x, 1.5 * s, z), q, sc));
    if (round) { balls.setMatrixAt(i, m.compose(ps.set(x, 5 * s, z), q, sc)); cones.setMatrixAt(i, zero); }
    else { cones.setMatrixAt(i, m.compose(ps.set(x, 6 * s, z), q, sc)); balls.setMatrixAt(i, zero); }
  });
  for (const im of [trunks, cones, balls]) { im.castShadow = true; scene.add(im); }

  const hillMat = new THREE.MeshLambertMaterial({ color: 0x3f9a45 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, r = 380 + Math.random() * 120;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(60 + Math.random() * 70, 16, 10), hillMat);
    hill.position.set(Math.cos(a) * r, -25, -100 + Math.sin(a) * r);
    hill.scale.y = 0.6 + Math.random() * 0.5;
    scene.add(hill);
  }
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 });
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 6, 10, 8), cloudMat);
      s.position.set(j * 9 - 18, Math.random() * 4, Math.random() * 6);
      c.add(s);
    }
    c.position.set(-400 + Math.random() * 800, 110 + Math.random() * 50, -500 + Math.random() * 700);
    scene.add(c);
  }
  // grandstand by the start
  const p = pointAt(track, 30, -(WALL + 10));
  const stand = new THREE.Group();
  const crowd = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#334'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = COLORS[i % 8]; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 3, 0, 7); g.fill(); }
  });
  for (let r = 0; r < 4; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(60, 2, 4), new THREE.MeshLambertMaterial({ map: crowd }));
    step.position.set(0, 1 + r * 2, -r * 4); step.castShadow = true; stand.add(step);
  }
  stand.position.set(p.x, 0, p.z);
  stand.rotation.y = p.h - Math.PI / 2;
  scene.add(stand);
}

// item boxes
const qTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#ff5f6d'); gr.addColorStop(0.33, '#ffc371'); gr.addColorStop(0.66, '#4de1ff'); gr.addColorStop(1, '#a66cff');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.font = 'bold 90px Bungee, Impact, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('?', w / 2, h / 2 + 6);
});
const boxMat = new THREE.MeshLambertMaterial({ map: qTex, transparent: true, opacity: 0.9, emissive: 0x333333 });
const boxMeshes = BOXES.map((b) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), boxMat);
  m.position.set(b.x, 1.6, b.z);
  m.castShadow = true;
  scene.add(m);
  return m;
});
let boxActive = BOXES.map(() => true);

// ───────────────────────────── kart model ─────────────────────────────
function label(text, color) {
  const tex = canvasTex(256, 64, (g, w, h) => {
    g.font = 'bold 34px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#000a'; g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(6, 1.5, 1);
  s.position.y = 3.6;
  s.renderOrder = 10;
  return s;
}

function makeKart(color, name, isMe) {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const col = new THREE.Color(color);
  const bodyMat = new THREE.MeshLambertMaterial({ color: col });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222228 });
  const metal = new THREE.MeshLambertMaterial({ color: 0xc8c8d0 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; pivot.add(m); return m; };
  add(new THREE.BoxGeometry(2.0, 0.55, 3.0), bodyMat, 0, 0.62, 0);
  add(new THREE.BoxGeometry(1.5, 0.4, 1.0), bodyMat, 0, 0.55, 1.85).rotation.x = 0.25;
  add(new THREE.BoxGeometry(2.3, 0.25, 0.5), dark, 0, 0.45, 2.3);
  add(new THREE.BoxGeometry(1.2, 1.0, 0.3), dark, 0, 1.3, -0.75);
  add(new THREE.CylinderGeometry(0.42, 0.5, 0.9, 10), new THREE.MeshLambertMaterial({ color: col.clone().offsetHSL(0, 0, 0.15) }), 0, 1.3, -0.25);
  const head = add(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshLambertMaterial({ color: 0xffffff }), 0, 2.05, -0.2);
  add(new THREE.SphereGeometry(0.56, 16, 12, 0, Math.PI * 2, 0, 1.2), bodyMat, 0, 2.08, -0.2);
  const visor = add(new THREE.BoxGeometry(0.75, 0.25, 0.2), new THREE.MeshLambertMaterial({ color: 0x113355, emissive: 0x112244 }), 0, 2.05, 0.3);
  void head; void visor;
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 6), metal, 0, 1.1, 0.6).rotation.x = -0.8;
  add(new THREE.TorusGeometry(0.3, 0.06, 6, 16), dark, 0, 1.3, 0.85).rotation.x = -0.8;
  add(new THREE.BoxGeometry(2.4, 0.12, 0.6), bodyMat, 0, 1.5, -1.55);
  add(new THREE.BoxGeometry(0.12, 0.7, 0.12), dark, -0.8, 1.15, -1.5);
  add(new THREE.BoxGeometry(0.12, 0.7, 0.12), dark, 0.8, 1.15, -1.5);
  add(new THREE.CylinderGeometry(0.15, 0.2, 0.6, 8), metal, -0.45, 0.8, -1.7).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.15, 0.2, 0.6, 8), metal, 0.45, 0.8, -1.7).rotation.x = Math.PI / 2;
  const wheels = [];
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  for (const [x, z, r] of [[-1.15, 1.1, 0.42], [1.15, 1.1, 0.42], [-1.2, -1.0, 0.55], [1.2, -1.0, 0.55]]) {
    const w = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.5, 14), tyre);
    t.rotation.z = Math.PI / 2; t.castShadow = true; w.add(t);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.52, 8), metal);
    hub.rotation.z = Math.PI / 2; w.add(hub);
    w.position.set(x, r, z);
    pivot.add(w);
    wheels.push(w);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 10), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85 }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.8, -2.6);
  flame.visible = false;
  pivot.add(flame);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0x4de1ff });
  const sparks = [-1.2, 1.2].map((x) => { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), sparkMat); s.position.set(x, 0.3, -1.6); s.visible = false; pivot.add(s); return s; });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 14), new THREE.MeshBasicMaterial({ color: 0x7af7ff, transparent: true, opacity: 0.28, depthWrite: false }));
  shield.position.y = 1.2;
  shield.visible = false;
  root.add(shield);
  if (!isMe) root.add(label(name, color));
  scene.add(root);
  return { root, pivot, wheels, flame, sparks, sparkMat, shield, x: 0, z: 0, h: 0, tx: 0, tz: 0, th: 0, s: 0, f: 0, spinA: 0, roll: 0 };
}

// missiles + hazards
const missileMeshes = new Map();
const hazardMeshes = new Map();
function makeMissile() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.2, 4, 10), new THREE.MeshLambertMaterial({ color: 0xe8322d, emissive: 0x551111 }));
  b.rotation.x = Math.PI / 2; g.add(b);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6 }));
  glow.position.z = -0.9; g.add(glow);
  g.position.y = 1.1;
  scene.add(g);
  return g;
}
const oilTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w / 2);
  gr.addColorStop(0, '#000'); gr.addColorStop(0.6, '#1a1030'); gr.addColorStop(0.8, '#3a2a6acc'); gr.addColorStop(1, '#0000');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#a66cff88'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2 - 10, h / 2 - 8, 18, 0, 5); g.stroke();
});
function makeOil() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24), new THREE.MeshBasicMaterial({ map: oilTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.07;
  scene.add(m);
  return m;
}

// ───────────────────────────── audio ─────────────────────────────
let actx = null, engOsc, engGain, engFilter, muted = false;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    engOsc = actx.createOscillator(); engOsc.type = 'sawtooth';
    engFilter = actx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 600;
    engGain = actx.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter).connect(engGain).connect(actx.destination);
    engOsc.start();
  } catch { actx = null; }
}
function beep(freq, dur = 0.15, type = 'square', vol = 0.08, slide = 0) {
  if (!actx || muted) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, actx.currentTime + dur);
  g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination);
  o.start(); o.stop(actx.currentTime + dur);
}

// ───────────────────────────── input ─────────────────────────────
const keys = {};
const input = { up: false, down: false, left: false, right: false, drift: false, item: false };
let itemPressed = false;
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space') { itemPressed = true; e.preventDefault(); }
  if (e.code === 'KeyM') { muted = !muted; toast(muted ? 'Muted' : 'Sound on', 900); }
  if (e.code === 'KeyR' && me.active) respawn();
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
const touchState = {};
for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); touchState[k] = true; if (k === 'item') itemPressed = true; };
  const off = (e) => { e.preventDefault(); touchState[k] = false; };
  b.addEventListener('touchstart', on); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off);
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
}
function readInput() {
  input.up = keys.KeyW || keys.ArrowUp || (isTouch && !touchState.down);
  input.down = keys.KeyS || keys.ArrowDown || touchState.down;
  input.left = keys.KeyA || keys.ArrowLeft || touchState.left;
  input.right = keys.KeyD || keys.ArrowRight || touchState.right;
  input.drift = keys.ShiftLeft || keys.ShiftRight || keys.KeyK || touchState.drift;
}

// ───────────────────────────── game state ─────────────────────────────
let ws = null, myId = null, lobby = null, race = null, results = null;
let myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
const karts = new Map(); // id -> kart visual + net state
let hazards = [];
const hzHit = new Set();
const me = {
  active: false, x: 0, z: 0, h: 0, speed: 0, lapsDone: -1, idx: 0, lat: 0, progress: 0, finished: false, finishMs: 0,
  spin: 0, boost: 0, boostLvl: 0, shield: 0, drift: 0, driftCharge: 0, item: null, rolling: 0, place: 1, draft: false,
};

// ───────────────────────────── networking ─────────────────────────────
function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = onOpen;
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (myId) { toast('Disconnected — reload to rejoin', 999999); }
    else $('menuErr').textContent = 'Could not connect to server';
  };
}
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

function handle(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id;
      history.replaceState(null, '', `?room=${m.code}`);
      break;
    case 'error':
      $('menuErr').textContent = m.msg;
      ws.close(); ws = null;
      break;
    case 'lobby':
      lobby = m;
      renderLobby();
      break;
    case 'start':
      startRace(m);
      break;
    case 's':
      onSnapshot(m);
      break;
    case 'hit':
      if (m.id === myId) getHit();
      break;
    case 'results':
      showResults(m);
      break;
  }
}

// ───────────────────────────── menu / lobby UI ─────────────────────────────
function show(id) {
  for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
}
{
  const wrap = $('colors');
  for (const c of COLORS) {
    const d = document.createElement('div');
    d.style.background = c;
    if (c === myColor) d.classList.add('sel');
    d.onclick = () => { myColor = c; wrap.querySelectorAll('div').forEach((x) => x.classList.toggle('sel', x === d)); };
    wrap.appendChild(d);
  }
  $('name').value = localStorage.getItem('kk_name') || '';
  const qp = new URLSearchParams(location.search).get('room');
  if (qp) $('codeIn').value = qp.toUpperCase();
  const join = (code) => {
    initAudio();
    const name = $('name').value.trim() || 'Racer';
    localStorage.setItem('kk_name', name);
    $('menuErr').textContent = '';
    connect(() => send({ t: 'join', code, name, color: myColor }));
  };
  $('createBtn').onclick = () => join('');
  $('joinBtn').onclick = () => { const c = $('codeIn').value.trim().toUpperCase(); if (c.length === 4) join(c); else $('menuErr').textContent = 'Enter a 4-letter room code'; };
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
  $('copyBtn').onclick = () => { navigator.clipboard?.writeText($('shareLink').value); $('copyBtn').textContent = 'Copied!'; setTimeout(() => ($('copyBtn').textContent = 'Copy link'), 1200); };
  $('startBtn').onclick = () => send({ t: 'start' });
  $('againBtn').onclick = () => send({ t: 'lobby' });
  $('fillBots').onchange = (e) => send({ t: 'settings', fillBots: e.target.checked });
  document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => send({ t: 'settings', mode: b.dataset.mode })));
}

function renderLobby() {
  const L = lobby;
  const isHost = L.hostId === myId;
  $('roomCode').textContent = L.code;
  $('shareLink').value = `${location.origin}/?room=${L.code}`;
  $('playerList').innerHTML = L.players.map((p) =>
    `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === myId ? ' (you)' : ''}${p.id === L.hostId ? '<span class="host">HOST</span>' : ''}</li>`).join('');
  $('hostOpts').classList.toggle('hidden', !isHost);
  $('waitHost').classList.toggle('hidden', isHost);
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === L.mode));
  $('fillBots').checked = L.fillBots;
  $('modeDesc').textContent = L.mode === 'coop'
    ? 'CO-OP: all humans are one team. Your items only hit the Rival Crew, and you get a slipstream boost behind teammates. Team points decide the winner!'
    : 'FREE-FOR-ALL: every racer for themselves.';
  $('againBtn').classList.toggle('hidden', !isHost);
  $('resWait').classList.toggle('hidden', isHost);
  if (L.state === 'lobby') { show('lobby'); endRaceView(); }
  if (L.state === 'racing' && !race) { show(null); }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ───────────────────────────── race lifecycle ─────────────────────────────
function clearKarts() {
  for (const k of karts.values()) scene.remove(k.root);
  karts.clear();
  for (const m of missileMeshes.values()) scene.remove(m);
  missileMeshes.clear();
  for (const m of hazardMeshes.values()) scene.remove(m);
  hazardMeshes.clear();
}

function startRace(m) {
  clearKarts();
  results = null;
  race = { mode: m.mode, racers: new Map(), goAt: performance.now() + m.goIn, goShown: false, lastCount: -1, places: [] };
  for (const r of m.racers) {
    race.racers.set(r.id, r);
    const k = makeKart(r.color, r.name, r.id === myId);
    const g = gridSlot(track, r.slot);
    Object.assign(k, { x: g.x, z: g.z, h: g.h, tx: g.x, tz: g.z, th: g.h });
    k.root.position.set(g.x, 0, g.z);
    k.root.rotation.y = g.h;
    karts.set(r.id, k);
  }
  const mine = race.racers.get(myId);
  me.active = !!mine;
  if (mine) {
    const g = gridSlot(track, mine.slot);
    Object.assign(me, {
      x: g.x, z: g.z, h: g.h, speed: 0, lapsDone: -1, finished: false, finishMs: 0, spin: 0, boost: 0, shield: 0,
      drift: 0, driftCharge: 0, item: null, rolling: 0, place: mine.slot + 1, team: mine.team,
    });
    me.idx = nearest(track, me.x, me.z).i;
    me.progress = g.dist;
    camPos.set(g.x - Math.sin(g.h) * 10, 5, g.z - Math.cos(g.h) * 10);
  }
  boxActive = BOXES.map(() => true);
  hazards = []; hzHit.clear();
  show(null);
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch || !me.active);
  $('spec').classList.toggle('hidden', me.active);
  $('itemIcon').textContent = '';
  if (m.late && m.goIn <= 0) race.goShown = true;
}

function endRaceView() {
  race = null;
  me.active = false;
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  if (engGain) engGain.gain.value = 0;
}

function showResults(m) {
  results = m;
  const coop = m.mode === 'coop';
  $('resTable').innerHTML = m.list.map((r, i) => `
    <tr class="${r.id === myId ? 'me' : ''}"><td>${i + 1}</td>
    <td><span class="sw" style="background:${r.color}"></span>${esc(r.name)}${r.bot ? ' 🤖' : ''}</td>
    <td>${r.time != null ? fmt(r.time) : '—'}</td><td>+${r.points}</td></tr>`).join('');
  if (coop) {
    const P = m.teams.players || 0, R = m.teams.rivals || 0;
    const msg = R === 0 ? 'Team race complete!' : P > R ? '🏆 TEAM VICTORY! 🏆' : P === R ? 'Dead heat!' : 'Rival Crew wins this time…';
    $('teamScore').innerHTML = `<span class="big">${msg}</span>Your team: <b>${P}</b> pts · Rival Crew: <b>${R}</b> pts`;
  } else {
    const w = m.list[0];
    $('teamScore').innerHTML = `<span class="big">${w.id === myId ? '🏆 YOU WIN! 🏆' : esc(w.name) + ' wins!'}</span>`;
  }
  $('resTitle').textContent = 'Race results';
  setTimeout(() => {
    endRaceView();
    show('results');
  }, 1500);
  if (lobby) renderLobby();
}

// ───────────────────────────── snapshot ─────────────────────────────
function onSnapshot(m) {
  if (!race) return;
  race.places = [];
  for (const [id, x, z, h, s, f, place, progress, fin] of m.r) {
    race.places.push({ id, place, fin });
    if (id === myId) { me.place = place; continue; }
    const k = karts.get(id);
    if (!k) continue;
    k.tx = x; k.tz = z; k.th = h; k.s = s; k.f = f; k.progress = progress;
  }
  // missiles
  const seen = new Set();
  for (const [id, x, z] of m.m) {
    seen.add(id);
    let mm = missileMeshes.get(id);
    if (!mm) { mm = makeMissile(); mm.position.set(x, 1.1, z); missileMeshes.set(id, mm); beep(300, 0.3, 'sawtooth', 0.04, 400); }
    mm.userData.tx = x; mm.userData.tz = z;
  }
  for (const [id, mm] of missileMeshes) if (!seen.has(id)) { scene.remove(mm); missileMeshes.delete(id); }
  // hazards
  hazards = m.hz.map(([id, x, z, team]) => ({ id, x, z, team }));
  const hseen = new Set(hazards.map((h) => h.id));
  for (const h of hazards) if (!hazardMeshes.has(h.id)) { const o = makeOil(); o.position.x = h.x; o.position.z = h.z; hazardMeshes.set(h.id, o); }
  for (const [id, o] of hazardMeshes) if (!hseen.has(id)) { scene.remove(o); hazardMeshes.delete(id); }
  // boxes
  for (let i = 0; i < m.b.length; i++) if (m.b[i] === '1') boxActive[i] = true; else boxActive[i] = false;
}

// ───────────────────────────── local kart physics ─────────────────────────────
function respawn() {
  const p = pointAt(track, me.idx * track.spacing, 0);
  me.x = p.x; me.z = p.z; me.h = p.h; me.speed = 0; me.drift = 0;
}

function getHit() {
  if (me.shield > 0) { beep(900, 0.1, 'triangle', 0.08); return; }
  me.spin = 1.3; me.speed *= 0.25; me.drift = 0; me.driftCharge = 0;
  toast('💫 Spun out!', 900);
  beep(200, 0.4, 'sawtooth', 0.08, -150);
}

function rollItem() {
  const n = race.racers.size, frac = n > 1 ? (me.place - 1) / (n - 1) : 0;
  let table;
  if (me.place === 1) table = { oil: 55, turbo: 30, missile: 10, shield: 5 };
  else if (frac < 0.5) table = { oil: 35, turbo: 35, missile: 22, shield: 8 };
  else table = { oil: 12, turbo: 38, missile: 32, shield: 18 };
  let r = Math.random() * 100;
  for (const [k, w] of Object.entries(table)) { if ((r -= w) < 0) return k; }
  return 'turbo';
}

function useItem() {
  const it = me.item;
  if (!it) return;
  me.item = null;
  $('itemIcon').textContent = '';
  if (it === 'turbo') { me.boost = 1.4; me.boostLvl = 2; beep(500, 0.4, 'sawtooth', 0.06, 600); }
  else if (it === 'shield') { me.shield = 7; beep(700, 0.5, 'triangle', 0.08, 500); }
  else { send({ t: 'item', kind: it }); if (it === 'oil') beep(150, 0.2, 'square', 0.05); }
}

let sendAcc = 0;
function updateMe(dt, now) {
  const started = now >= race.goAt;
  readInput();
  // timers
  me.boost = Math.max(0, me.boost - dt);
  me.shield = Math.max(0, me.shield - dt);
  if (me.rolling > 0) {
    me.rolling -= dt;
    $('itemIcon').textContent = Object.values(ITEMS)[Math.floor(now / 80) % 4];
    if (me.rolling <= 0) { me.item = me.pendingItem; $('itemIcon').textContent = ITEMS[me.item]; $('itemBox').classList.remove('rolling'); beep(880, 0.12); }
  }
  if (itemPressed && started && me.item && me.spin <= 0) useItem();
  itemPressed = false;

  const near = nearest(track, me.x, me.z, me.idx);
  const offroad = Math.abs(near.lat) > HALF + CURB;
  let steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  let gas = input.up, brake = input.down;

  // autopilot after finishing
  if (me.finished) {
    const tp = pointAt(track, near.i * track.spacing + 14, 0);
    let da = Math.atan2(tp.x - me.x, tp.z - me.z) - me.h;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    steer = Math.max(-1, Math.min(1, da * 3)); gas = me.speed < 22; brake = false;
  }
  if (!started) { gas = false; brake = false; steer = 0; }

  if (me.spin > 0) {
    me.spin -= dt;
    me.speed *= Math.pow(0.12, dt);
  } else {
    let max = offroad ? PHY.offMax : PHY.max;
    // co-op slipstream: stay close behind a teammate
    me.draft = false;
    if (race.mode === 'coop') {
      for (const [id, k] of karts) {
        if (id === myId || race.racers.get(id)?.bot) continue;
        const dx = k.x - me.x, dz = k.z - me.z, d = Math.hypot(dx, dz);
        if (d < 14 && d > 2 && (dx * Math.sin(me.h) + dz * Math.cos(me.h)) / d > 0.8) me.draft = true;
      }
      if (me.draft) max += 4;
    }
    if (me.shield > 0) max += 5;
    if (me.boost > 0) { max = PHY.boostMax; me.speed = Math.min(PHY.boostMax, me.speed + 70 * dt); }
    if (gas) me.speed += (me.speed < max ? PHY.accel : 0) * dt;
    else if (brake) me.speed -= (me.speed > 0 ? PHY.brake : 14) * dt;
    else me.speed -= Math.sign(me.speed) * Math.min(Math.abs(me.speed), 9 * dt);
    if (me.speed > max) me.speed -= (me.speed - max) * (offroad ? 3 : 1.5) * dt;
    me.speed = Math.max(-10, me.speed);

    // drifting
    if (me.drift === 0 && input.drift && steer !== 0 && me.speed > 15 && !offroad) {
      me.drift = steer; me.driftCharge = 0; me.hop = 0.25; beep(220, 0.08, 'triangle', 0.05);
    }
    let turn = steer;
    if (me.drift !== 0) {
      if (!input.drift || me.speed < 10) {
        if (me.driftCharge > 1.7) { me.boost = 1.1; me.boostLvl = 2; beep(660, 0.3, 'sawtooth', 0.06, 500); }
        else if (me.driftCharge > 0.75) { me.boost = 0.6; me.boostLvl = 1; beep(520, 0.2, 'sawtooth', 0.05, 300); }
        me.drift = 0; me.driftCharge = 0;
      } else {
        turn = me.drift * (0.55 + 0.5 * Math.max(0, steer * me.drift)) - (steer === -me.drift ? me.drift * 0.25 : 0);
        me.driftCharge += dt * (steer === me.drift ? 1.25 : 0.75);
      }
    }
    const grip = Math.min(1, Math.abs(me.speed) / 10) * Math.sign(me.speed || 1);
    me.h += turn * PHY.turn * (me.drift ? 1.25 : 1) * grip * dt;
  }
  me.hop = Math.max(0, (me.hop || 0) - dt);

  const fx = Math.sin(me.h), fz = Math.cos(me.h);
  let vx = fx * me.speed, vz = fz * me.speed;
  if (me.drift) { const s = me.speed * 0.18 * -me.drift; vx += fz * s; vz += -fx * s; } // slide outward
  me.x += vx * dt; me.z += vz * dt;

  // walls
  const n2 = nearest(track, me.x, me.z, near.i);
  const p = track.pts[n2.i];
  if (Math.abs(n2.lat) > WALL) {
    const s = Math.sign(n2.lat);
    me.x = p.x + p.nx * s * WALL; me.z = p.z + p.nz * s * WALL;
    me.speed *= 0.55; me.drift = 0;
    if (Math.abs(me.speed) > 8) beep(90, 0.12, 'square', 0.06);
  }
  // kart collisions
  for (const [id, k] of karts) {
    if (id === myId) continue;
    const dx = me.x - k.x, dz = me.z - k.z, d = Math.hypot(dx, dz);
    if (d < 2.7 && d > 0.01) {
      const push = (2.7 - d) * 0.6;
      me.x += (dx / d) * push; me.z += (dz / d) * push;
      me.speed *= 0.985;
    }
  }

  // lap tracking
  const prev = me.idx;
  me.idx = n2.i; me.lat = n2.lat;
  const M = track.count;
  if (prev > M * 0.75 && me.idx < M * 0.25) {
    me.lapsDone++;
    if (!me.finished && me.lapsDone >= 1 && me.lapsDone < LAPS) { toast(me.lapsDone === LAPS - 1 ? '🏁 FINAL LAP!' : `LAP ${me.lapsDone + 1}`, 1300); beep(784, 0.25, 'triangle', 0.08); }
  } else if (prev < M * 0.25 && me.idx > M * 0.75) me.lapsDone--;
  me.progress = me.lapsDone * track.length + me.idx * track.spacing;
  if (!me.finished && started && me.lapsDone >= LAPS) {
    me.finished = true; me.finishMs = now - race.goAt;
    me.drift = 0;
    send({ t: 'fin' });
    toast('🏁 FINISH! 🏁', 3000);
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'triangle', 0.09), i * 120));
  }

  // item boxes
  BOXES.forEach((b, i) => {
    if (boxActive[i] && (b.x - me.x) ** 2 + (b.z - me.z) ** 2 < 8) {
      boxActive[i] = false;
      send({ t: 'box', i });
      beep(1200, 0.08, 'square', 0.05);
      if (!me.item && me.rolling <= 0) { me.pendingItem = rollItem(); me.rolling = 1.1; $('itemBox').classList.add('rolling'); }
    }
  });
  // hazards
  for (const h of hazards) {
    if (h.team === me.team || hzHit.has(h.id)) continue;
    if ((h.x - me.x) ** 2 + (h.z - me.z) ** 2 < 5.5) { hzHit.add(h.id); send({ t: 'hz', id: h.id }); getHit(); }
  }

  // network
  sendAcc += dt;
  if (sendAcc > 0.05) {
    sendAcc = 0;
    const f = (me.spin > 0 ? 1 : 0) | (me.shield > 0 ? 2 : 0) | (me.boost > 0 ? 4 : 0) | (me.drift ? 8 : 0) | (me.driftCharge > 1.7 ? 16 : me.driftCharge > 0.75 ? 32 : 0) | (me.drift < 0 ? 64 : 0);
    me.f = f;
    send({ t: 'u', x: +me.x.toFixed(2), z: +me.z.toFixed(2), h: +me.h.toFixed(3), s: +me.speed.toFixed(2), p: +me.progress.toFixed(1), lat: +me.lat.toFixed(2), f });
  }

  // engine sound
  if (actx && engGain) {
    engOsc.frequency.value = 55 + Math.abs(me.speed) * 4.2 + (me.boost > 0 ? 40 : 0);
    engFilter.frequency.value = 400 + Math.abs(me.speed) * 30;
    engGain.gain.value = muted ? 0 : 0.035;
  }

  // own kart visual
  const k = karts.get(myId);
  if (k) {
    k.x = me.x; k.z = me.z; k.h = me.h; k.s = me.speed;
    k.f = (me.spin > 0 ? 1 : 0) | (me.shield > 0 ? 2 : 0) | (me.boost > 0 ? 4 : 0) | (me.drift ? 8 : 0) | (me.driftCharge > 1.7 ? 16 : me.driftCharge > 0.75 ? 32 : 0) | (me.drift < 0 ? 64 : 0);
    k.steer = steer;
    k.hop = me.hop;
  }
}

// ───────────────────────────── visuals update ─────────────────────────────
function updateKartVisual(k, dt, isMe) {
  if (!isMe) {
    k.tx += Math.sin(k.th) * k.s * dt;
    k.tz += Math.cos(k.th) * k.s * dt;
    const a = Math.min(1, dt * 10);
    k.x += (k.tx - k.x) * a; k.z += (k.tz - k.z) * a;
    if (Math.hypot(k.tx - k.x, k.tz - k.z) > 25) { k.x = k.tx; k.z = k.tz; }
    let dh = k.th - k.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    k.h += dh * a;
  }
  k.root.position.set(k.x, (k.hop || 0) > 0 ? Math.sin((k.hop / 0.25) * Math.PI) * 0.6 : 0, k.z);
  k.root.rotation.y = k.h;
  const f = k.f | 0;
  if (f & 1) k.spinA += dt * 14; else k.spinA *= Math.pow(0.001, dt);
  const driftDir = f & 8 ? (f & 64 ? -1 : 1) : 0;
  k.roll += ((driftDir ? driftDir * 0.45 : 0) - k.roll) * Math.min(1, dt * 8);
  k.pivot.rotation.y = k.spinA + k.roll;
  k.pivot.rotation.z = -(k.steer || driftDir) * 0.06;
  for (const w of k.wheels) w.rotation.x += k.s * dt * 2;
  k.wheels[0].rotation.y = k.wheels[1].rotation.y = (k.steer || 0) * 0.3;
  k.flame.visible = !!(f & 4);
  if (k.flame.visible) { k.flame.scale.set(1, 0.8 + Math.random() * 0.6, 1); }
  k.shield.visible = !!(f & 2);
  if (k.shield.visible) k.shield.rotation.y += dt;
  const charged = f & 16 ? 0xff8a1f : f & 32 ? 0x4de1ff : 0;
  for (const s of k.sparks) { s.visible = !!(f & 8) && !!charged && Math.random() < 0.8; s.rotation.y += dt * 20; s.scale.setScalar(0.7 + Math.random() * 0.6); }
  if (charged) k.sparkMat.color.setHex(charged);
}

// ───────────────────────────── HUD ─────────────────────────────
let toastTimer = 0;
function toast(msg, ms = 1200) {
  $('toast').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').textContent = ''), ms);
}
function fmt(ms) {
  ms = Math.max(0, ms);
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), c = Math.floor((ms % 1000) / 10);
  return `${m}'${String(s).padStart(2, '0')}"${String(c).padStart(2, '0')}`;
}
const ord = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

// minimap
const mm = $('minimap'), mctx = mm.getContext('2d');
const bounds = track.pts.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
const mScale = 150 / Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0);
const mx = (x) => 10 + (x - bounds.x0) * mScale + (150 - (bounds.x1 - bounds.x0) * mScale) / 2;
const mz = (z) => 10 + (z - bounds.z0) * mScale + (150 - (bounds.z1 - bounds.z0) * mScale) / 2;
function drawMinimap() {
  mctx.clearRect(0, 0, 170, 170);
  mctx.lineJoin = 'round';
  mctx.beginPath();
  track.pts.forEach((p, i) => (i ? mctx.lineTo(mx(p.x), mz(p.z)) : mctx.moveTo(mx(p.x), mz(p.z))));
  mctx.closePath();
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 9; mctx.stroke();
  mctx.strokeStyle = '#555'; mctx.lineWidth = 5; mctx.stroke();
  const s = track.pts[0];
  mctx.fillStyle = '#fff'; mctx.fillRect(mx(s.x) - 1, mz(s.z) - 5, 3, 10);
  for (const [id, k] of karts) {
    const r = race.racers.get(id);
    mctx.beginPath();
    mctx.arc(mx(k.x), mz(k.z), id === myId ? 5.5 : 4, 0, 7);
    mctx.fillStyle = r.color; mctx.fill();
    mctx.lineWidth = id === myId ? 2.5 : 1.5; mctx.strokeStyle = id === myId ? '#ffd23f' : '#000'; mctx.stroke();
  }
  mctx.fillStyle = '#e8322d';
  for (const m of missileMeshes.values()) mctx.fillRect(mx(m.position.x) - 2, mz(m.position.z) - 2, 4, 4);
}

let boardAcc = 0;
function updateHud(now) {
  const t = race.goAt - now;
  const cd = $('countdown');
  if (t > 0) {
    const n = Math.ceil(t / 1000);
    if (n <= 3 && n !== race.lastCount) { race.lastCount = n; cd.textContent = n; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop'); beep(440, 0.2, 'square', 0.08); }
    if (n > 3) cd.textContent = '';
  } else if (!race.goShown) {
    race.goShown = true;
    cd.textContent = 'GO!'; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
    beep(880, 0.45, 'square', 0.09);
    setTimeout(() => (cd.textContent = ''), 900);
  }
  if (me.active) {
    $('lap').innerHTML = `LAP <b>${Math.min(LAPS, Math.max(1, me.lapsDone + 1))}</b>/${LAPS}`;
    $('timer').textContent = 'TIME ' + fmt(me.finished ? me.finishMs : Math.max(0, now - race.goAt));
    $('place').innerHTML = `${me.place}<sup>${ord(me.place)}</sup>`;
  } else {
    $('lap').textContent = ''; $('place').textContent = '';
    $('timer').textContent = 'TIME ' + fmt(Math.max(0, now - race.goAt));
  }
  if ((boardAcc += 1) % 10 === 0 && race.places.length) {
    $('board').innerHTML = race.places.map(({ id, place, fin }) => {
      const r = race.racers.get(id);
      if (!r) return '';
      const mate = race.mode === 'coop' && !r.bot ? '🤝' : r.bot ? '🤖' : '';
      return `<li class="${id === myId ? 'me' : ''}"><span class="n">${place}</span><span class="sw" style="background:${r.color}"></span>${esc(r.name)} ${mate}${fin ? '<span class="tm">🏁</span>' : ''}</li>`;
    }).join('');
  }
  drawMinimap();
}

// ───────────────────────────── camera ─────────────────────────────
const camPos = new THREE.Vector3(0, 30, 40);
const camLook = new THREE.Vector3();
function updateCamera(dt) {
  let target = null;
  if (me.active) target = karts.get(myId);
  else if (race && race.places.length) target = karts.get(race.places[0].id);
  if (!target) {
    // menu flyover
    const t = performance.now() / 1000;
    const p = pointAt(track, t * 25, 0), q = pointAt(track, t * 25 + 40, 0);
    camPos.lerp(new THREE.Vector3(p.x + 30, 28, p.z + 30), Math.min(1, dt * 1.5));
    camera.position.copy(camPos);
    camLook.lerp(new THREE.Vector3(q.x, 0, q.z), Math.min(1, dt * 2));
    camera.lookAt(camLook);
    sun.position.set(camLook.x + 60, 140, camLook.z + 40);
    sun.target.position.copy(camLook);
    return;
  }
  const h = target.h;
  const back = me.active && keys.KeyC ? -9 : 9.5;
  const want = new THREE.Vector3(target.x - Math.sin(h) * back, 4.4, target.z - Math.cos(h) * back);
  camPos.lerp(want, Math.min(1, dt * 6));
  camera.position.copy(camPos);
  camLook.set(target.x + Math.sin(h) * 6, 1.6, target.z + Math.cos(h) * 6);
  camera.lookAt(camLook);
  const boosting = (target.f | 0) & 4;
  camera.fov += ((boosting ? 80 : 68) - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  sun.position.set(target.x + 60, 140, target.z + 40);
  sun.target.position.set(target.x, 0, target.z);
}

// ───────────────────────────── main loop ─────────────────────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (race) {
    if (me.active) updateMe(dt, now);
    for (const [id, k] of karts) updateKartVisual(k, dt, id === myId);
    for (const m of missileMeshes.values()) {
      const u = m.userData;
      const dx = u.tx - m.position.x, dz = u.tz - m.position.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) m.rotation.y = Math.atan2(dx, dz);
      m.position.x += dx * Math.min(1, dt * 12); m.position.z += dz * Math.min(1, dt * 12);
    }
    updateHud(now);
  }
  boxMeshes.forEach((b, i) => {
    b.visible = boxActive[i];
    b.rotation.y += dt * 1.5; b.rotation.x += dt * 0.7;
    b.position.y = 1.6 + Math.sin(now / 300 + i) * 0.25;
  });
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__kk = { me, karts, get race() { return race; } };
