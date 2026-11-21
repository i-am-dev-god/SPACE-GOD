import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const ui = {
  loading: $('loading'), loadingFill: $('loading-fill'), loadingDetail: $('loading-detail'),
  start: $('start-screen'), startButton: $('start-race'), pause: $('pause-screen'), finish: $('finish-screen'),
  hud: $('hud'), speed: $('speed'), gear: $('gear'), rpm: $('rpm-number'), rpmFill: $('rpm-fill'),
  session: $('session-clock'), lap: $('lap-readout'), position: $('position-readout'), lastLap: $('last-lap'),
  bestLap: $('best-lap'), message: $('race-message'), toast: $('toast'), sessionLabel: $('session-label'),
  camera: $('camera-label'), delta: $('delta-text'), deltaPill: $('delta-pill'),
};
const ASSET = (name) => `${import.meta.env.BASE_URL}assets/${name}`;
const loader = new GLTFLoader();
const clock = new THREE.Clock();
const WORLD = { width: 12.6, half: 6.3, length: 0, sampleCount: 1500 };
const MASS = 1325, WHEELBASE = 2.86, MAX_STEER = 0.52, G = 9.81;
const controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const keys = new Set();
let renderer, scene, camera, carAsset, roadAsset, barrierAsset, roadMaterial;
let player, bots = [], trackCurve, trackSamples = [], trackCum = [], trackMesh, grassMaterial;
let running = false, paused = false, finished = false, raceStarted = false, cameraMode = 0;
let startCountdown = 0, raceTime = 0, toastTimer = 0, raceMessageTimer = 0;
let audioCtx, engineOsc, engineOsc2, engineGain, audioEnabled = true;
let worldGroup, roadMaterialSource, trackSectionGroup, barriersGroup, sceneryGroup;
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

function setLoading(progress, label) {
  ui.loadingFill.style.width = `${Math.round(progress * 100)}%`;
  ui.loadingDetail.textContent = label;
}
function showToast(text, duration = 2300) {
  ui.toast.textContent = text; ui.toast.classList.add('show');
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => ui.toast.classList.remove('show'), duration);
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---';
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60), ms = Math.floor((seconds % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
function makeRenderer() {
  const canvasHost = $('viewport');
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  } catch (error) {
    document.body.classList.add('no-webgl'); setLoading(1, 'WebGL unavailable'); throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.useLegacyLights = false;
  renderer.domElement.setAttribute('aria-label', 'Interactive racing circuit');
  canvasHost.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9c1d0);
  scene.fog = new THREE.FogExp2(0xa9c1d0, 0.0009);
  camera = new THREE.PerspectiveCamera(61, window.innerWidth / window.innerHeight, 0.12, 1800);
  camera.position.set(-1, 6, 12);
  const hemi = new THREE.HemisphereLight(0xd9e8ff, 0x445544, 1.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffefcf, 3.1); sun.position.set(-180, 260, -100);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -230; sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230; sun.shadow.camera.bottom = -230; sun.shadow.camera.near = 5; sun.shadow.camera.far = 650;
  sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3; scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9ab7d0, 0.85); fill.position.set(160, 90, 180); scene.add(fill);
  worldGroup = new THREE.Group(); scene.add(worldGroup);
  window.addEventListener('resize', onResize);
}

function createGrassTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); const img = ctx.createImageData(256, 256);
  let seed = 7331;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.floor(rand() * 32), patch = rand() > 0.94 ? 13 : 0;
    img.data[i] = 42 + n + patch; img.data[i + 1] = 76 + n + patch; img.data[i + 2] = 39 + Math.round(n * .54); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(70, 70); tex.anisotropy = 8;
  return tex;
}
function addGround() {
  grassMaterial = new THREE.MeshStandardMaterial({ map: createGrassTexture(), color: 0xb7c3a5, roughness: 0.98 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), grassMaterial); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.26; ground.receiveShadow = true; worldGroup.add(ground);
  const infield = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshStandardMaterial({ color: 0x435d3b, roughness: 1 }));
  infield.scale.set(84, 1, 70); infield.rotation.x = -Math.PI / 2; infield.position.set(0, -0.23, 0); infield.receiveShadow = true; worldGroup.add(infield);
}
function makeTrackCurve() {
  const points = [
    [-76, -105], [-26, -123], [44, -119], [100, -99], [128, -64], [132, -16],
    [111, 27], [121, 65], [93, 98], [48, 113], [-1, 102], [-41, 116],
    [-91, 92], [-120, 56], [-132, 10], [-121, -34], [-106, -74],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  trackCurve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.12);
  trackCurve.curveType = 'centripetal';
  WORLD.length = trackCurve.getLength();
  const n = WORLD.sampleCount;
  trackSamples = Array.from({ length: n + 1 }, (_, i) => trackCurve.getPointAt(i / n));
  trackCum = Array.from({ length: n + 1 }, (_, i) => WORLD.length * i / n);
}
function tangentAt(t) { return trackCurve.getTangentAt(((t % 1) + 1) % 1).normalize(); }
function normalAt(t) { const tangent = tangentAt(t); return new THREE.Vector3(-tangent.z, 0, tangent.x).normalize(); }
function pointAt(t, lateral = 0, y = 0) {
  const u = ((t % 1) + 1) % 1; const p = trackCurve.getPointAt(u); const n = normalAt(u);
  p.addScaledVector(n, lateral); p.y += y; return p;
}
function surfaceGeometry(innerWidth, outerWidth, height, steps = 1500) {
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; const p = trackCurve.getPointAt(t); const n = normalAt(t);
    const a = p.clone().addScaledVector(n, innerWidth); a.y = height;
    const b = p.clone().addScaledVector(n, outerWidth); b.y = height;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z); uvs.push(0, t * WORLD.length / 3.4, 1, t * WORLD.length / 3.4);
    if (i < steps) { const v = i * 2; indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geom.setIndex(indices); geom.computeVertexNormals(); return geom;
}
function createTrack(kit) {
  makeTrackCurve(); addGround();
  const source = kit.getObjectByName('Road_Straight');
  roadMaterial = source?.material?.clone() || new THREE.MeshStandardMaterial({ color: 0x343739, roughness: .9 });
  roadMaterial.side = THREE.DoubleSide; roadMaterial.roughness = Math.max(.7, roadMaterial.roughness || .8); roadMaterial.metalness = 0.02;
  for (const tex of [roadMaterial.map, roadMaterial.normalMap, roadMaterial.roughnessMap]) if (tex) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; }
  const road = new THREE.Mesh(surfaceGeometry(-WORLD.half, WORLD.half, 0.12, 1900), roadMaterial);
  road.receiveShadow = true; road.castShadow = false; road.name = 'Racing surface'; worldGroup.add(road); trackMesh = road;
  const runoffMat = new THREE.MeshStandardMaterial({ color: 0x8e8b7b, roughness: .94 });
  const runoff = new THREE.Mesh(surfaceGeometry(-WORLD.half - 3.4, WORLD.half + 3.4, 0.025, 1400), runoffMat); runoff.receiveShadow = true; worldGroup.add(runoff);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe5e5d9, roughness: .78, side: THREE.DoubleSide });
  const edgeLines = [
    new THREE.Mesh(surfaceGeometry(-WORLD.half + .25, -WORLD.half + .38, .132, 1200), lineMat),
    new THREE.Mesh(surfaceGeometry(WORLD.half - .38, WORLD.half - .25, .132, 1200), lineMat),
  ]; edgeLines.forEach((m) => worldGroup.add(m));
  addKerbs();
  addStartFinish();
}
function addKerbs() {
  const red = new THREE.MeshStandardMaterial({ color: 0xc44537, roughness: .72 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xe8e1d2, roughness: .75 });
  const geo = new THREE.BoxGeometry(1, .12, .92); const a = new THREE.InstancedMesh(geo, red, 90), b = new THREE.InstancedMesh(geo, ivory, 90); a.castShadow = b.castShadow = true; a.receiveShadow = b.receiveShadow = true;
  const dummy = new THREE.Object3D(); let ia = 0, ib = 0;
  // Alternating curb blocks on the high-load corners.
  const zones = [[.18, .23, 1], [.36, .42, -1], [.54, .60, 1], [.75, .82, -1], [.91, .96, 1]];
  for (const [start, end, side] of zones) {
    const count = Math.ceil((end - start) * WORLD.length / 1.15);
    for (let j = 0; j < count; j++) {
      const t = start + (end - start) * j / count; const p = pointAt(t, side * (WORLD.half + .42), .13); const tan = tangentAt(t);
      dummy.position.copy(p); dummy.rotation.set(0, Math.atan2(-tan.z, tan.x), 0); dummy.scale.set(1.24, 1, 1); dummy.updateMatrix();
      if (j % 2) b.setMatrixAt(ib++, dummy.matrix); else a.setMatrixAt(ia++, dummy.matrix);
    }
  }
  a.count = ia; b.count = ib; worldGroup.add(a, b);
}
function addStartFinish() {
  const p = pointAt(.006, 0, .16); const tangent = tangentAt(.006); const yaw = Math.atan2(-tangent.z, tangent.x);
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe8eee3, roughness: .7 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(.7, .018, WORLD.width), stripeMat); stripe.position.copy(p); stripe.rotation.y = yaw; stripe.receiveShadow = true; worldGroup.add(stripe);
  for (let i = 0; i < 12; i++) {
    const checker = new THREE.Mesh(new THREE.BoxGeometry(.7, .024, WORLD.width / 12), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x101310 : 0xf2f2eb, roughness: .7 }));
    checker.position.copy(p); const right = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); checker.position.addScaledVector(right, -WORLD.width / 2 + (i + .5) * WORLD.width / 12); checker.position.y += .02; checker.rotation.y = yaw; worldGroup.add(checker);
  }
  const gantry = new THREE.Group(); const steel = new THREE.MeshStandardMaterial({ color: 0x29322d, metalness: .75, roughness: .38 });
  const post = new THREE.BoxGeometry(.34, 8.5, .34); const beam = new THREE.BoxGeometry(.42, .42, WORLD.width + 2);
  for (const side of [-1, 1]) { const m = new THREE.Mesh(post, steel); m.position.set(0, 4.25, side * (WORLD.half + 1)); m.castShadow = true; gantry.add(m); }
  const cross = new THREE.Mesh(beam, steel); cross.position.y = 8.2; cross.castShadow = true; gantry.add(cross);
  for (let i = 0; i < 10; i++) { const bulb = new THREE.Mesh(new THREE.SphereGeometry(.17, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff4136, emissive: 0xe3211a, emissiveIntensity: 3 })); bulb.position.set(0, 7.75, -4.3 + i * .95); gantry.add(bulb); }
  gantry.position.set(p.x, 0, p.z); gantry.rotation.y = yaw; worldGroup.add(gantry);
}
function addTreeLine() {
  const trunkGeo = new THREE.CylinderGeometry(.16, .28, 2.4, 7); const leafGeo = new THREE.ConeGeometry(1.5, 5.3, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4837, roughness: 1 });
  const greens = [0x345344, 0x49694f, 0x586f4a, 0x3f5e48].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: .9 }));
  const treeCount = 220; const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount); trunks.receiveShadow = true;
  const crowns = greens.map(mat => new THREE.InstancedMesh(leafGeo, mat, treeCount)); crowns.forEach(m => {m.castShadow = true; m.receiveShadow = true;});
  const d = new THREE.Object3D(); let index = 0; let seed = 191;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < treeCount; i++) {
    const t = rnd(); const side = rnd() < .5 ? -1 : 1; const p = pointAt(t, side * (WORLD.half + 34 + rnd() * 56), 0); const scale = .75 + rnd() * .8;
    d.position.set(p.x, 1.2 * scale, p.z); d.rotation.set(0, rnd() * Math.PI * 2, 0); d.scale.set(scale, scale, scale); d.updateMatrix(); trunks.setMatrixAt(index, d.matrix);
    d.position.y = 4 * scale; d.scale.set(scale * (0.8 + rnd() * .5), scale, scale * (0.8 + rnd() * .5)); d.updateMatrix(); crowns[i % greens.length].setMatrixAt(index, d.matrix); index++;
  }
  worldGroup.add(trunks, ...crowns);
  // Distant wooded ridges soften the horizon without expensive imported scenery.
  for (let i = 0; i < 28; i++) {
    const angle = i / 28 * Math.PI * 2; const radius = 370 + (i % 5) * 42; const h = 45 + (i % 7) * 12;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(45 + (i % 3) * 13, h, 8), new THREE.MeshStandardMaterial({ color: [0x647866, 0x71856e, 0x7b8971][i % 3], roughness: 1 }));
    hill.position.set(Math.cos(angle) * radius, h / 2 - 7, Math.sin(angle) * radius); hill.scale.z = .86; hill.receiveShadow = true; worldGroup.add(hill);
  }
}
function addPitBuildings() {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9ca19a, roughness: .8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb0b6, metalness: .38, roughness: .18, transparent: true, opacity: .78 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x27302c, roughness: .6 });
  const baseT = .015; const p = pointAt(baseT, -WORLD.half - 16, 0); const tan = tangentAt(baseT); const yaw = Math.atan2(-tan.z, tan.x);
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const bay = new THREE.Group(); const w = 8.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 5.2, 10), concrete); body.position.set(i * 9.3, 2.6, 0); body.castShadow = true; body.receiveShadow = true; bay.add(body);
    const door = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.1, .09), dark); door.position.set(i * 9.3, 1.62, 5.06); bay.add(door);
    const window = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.1, .12), glass); window.position.set(i * 9.3, 4.23, 5.03); bay.add(window);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(9, .25, 2.3), new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? 0xd3ff3f : 0x28322e, roughness: .5 })); awning.position.set(i * 9.3, 3.45, 6); bay.add(awning);
    g.add(bay);
  }
  g.position.set(p.x, 0, p.z); g.rotation.y = yaw; worldGroup.add(g);
  // Grandstand terraces on the infield.
  const stand = new THREE.Group(); const seatMat = new THREE.MeshStandardMaterial({ color: 0x343e38, roughness: .8 });
  for (let row = 0; row < 8; row++) {
    const rowMesh = new THREE.Mesh(new THREE.BoxGeometry(35, .7, 1.55), row % 2 ? seatMat : dark); rowMesh.position.set(0, .5 + row * .75, row * 1.7); rowMesh.castShadow = true; stand.add(rowMesh);
    for (let col = 0; col < 14; col++) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, .42, .62), new THREE.MeshStandardMaterial({ color: [0xd3ff3f, 0x9d332c, 0xe0e4dc][(col + row) % 3], roughness: .75 }));
      seat.position.set(-16 + col * 2.45, .9 + row * .75, row * 1.7 - .1); stand.add(seat);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(39, .5, 17), dark); roof.position.set(0, 7.8, 6.5); roof.castShadow = true; stand.add(roof);
  stand.position.set(30, 0, -22); stand.rotation.y = -.5; worldGroup.add(stand);
}
function addBarriers(asset) {
  const proto = asset.getObjectByName('Concrete_Barrier');
  if (!proto) return;
  barriersGroup = new THREE.Group(); const segments = 90;
  for (let i = 0; i < segments; i++) {
    // Keep the barriers on the outside of medium/fast corners; leave runoff and escape roads elsewhere.
    const t = i / segments; const tan = tangentAt(t); const ahead = tangentAt(t + .008); const curvature = Math.abs(Math.atan2(tan.x * ahead.z - tan.z * ahead.x, tan.x * ahead.x + tan.z * ahead.z));
    if (curvature < .0019) continue;
    const side = (i % 3 === 0) ? -1 : 1; const p = pointAt(t, side * (WORLD.half + 9), 0); const yaw = Math.atan2(-tan.z, tan.x);
    const anchor = new THREE.Group(); anchor.position.set(p.x, 0, p.z); anchor.rotation.y = yaw + (side < 0 ? Math.PI : 0);
    const section = proto.clone(true); section.castShadow = true; section.receiveShadow = true; anchor.add(section); barriersGroup.add(anchor);
  }
  worldGroup.add(barriersGroup);
  // Guardrail/catch fence segments along the fast outer sweeps.
  const rail = asset.getObjectByName('Guardrail_Section');
  if (rail) for (let i = 0; i < 24; i++) {
    const t = .08 + i / 24 * .42; const tan = tangentAt(t); const p = pointAt(t, WORLD.half + 13, 0); const a = new THREE.Group(); a.position.set(p.x, 0, p.z); a.rotation.y = Math.atan2(-tan.z, tan.x); a.add(rail.clone(true)); worldGroup.add(a);
  }
}
function makeCar(root, name, color, isPlayer = false) {
  const model = root.clone(true); model.name = name;
  const body = model.getObjectByName('Main_Body');
  if (body?.material) {
    body.material = body.material.clone(); body.material.color.set(color);
    body.material.metalness = .48; body.material.roughness = .3;
    if (body.material.clearcoat !== undefined) { body.material.clearcoat = .9; body.material.clearcoatRoughness = .16; }
  }
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material?.transparent) { o.material.depthWrite = false; o.material.side = THREE.DoubleSide; } } });
  const group = new THREE.Group(); group.add(model); worldGroup.add(group);
  return { name, group, model, isPlayer, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, speed: 0, vLat: 0, t: 0, lap: 0, lastT: 0, lapStart: 0, lastLap: NaN, bestLap: Number(localStorage.getItem('apex-best-lap') || NaN), steer: 0, throttle: 0, brake: 0, handbrake: 0, rpm: 950, gear: 1, progress: 0, lane: 0, ai: !isPlayer, finished: false, finishTime: 0, startArmed: isPlayer, wheelNodes: ['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR'].map(n => model.getObjectByName(n)).filter(Boolean), brakeLights: model.getObjectByName('Rear_Lights') };
}
function placeCarOnTrack(car, t, lane) {
  const p = pointAt(t, lane, .15); const tan = tangentAt(t); const yaw = Math.atan2(-tan.z, tan.x);
  car.x = p.x; car.z = p.z; car.yaw = yaw; car.vx = car.vz = 0; car.speed = 0; car.yawRate = 0; car.vLat = 0; car.t = t; car.lastT = t; car.lane = lane;
  car.group.position.set(p.x, .08, p.z); car.group.rotation.y = yaw;
}
function createScenery(kit, barriers) {
  createTrack(kit); addBarriers(barriers); addTreeLine(); addPitBuildings();
}
function projectToTrack(x, z) {
  let bestD2 = Infinity, bestI = 0, bestU = 0, bestX = 0, bestZ = 0;
  const n = WORLD.sampleCount;
  // Local segment projection; 1,500 short segments is cheap and stable at browser frame rates.
  for (let i = 0; i < n; i++) {
    const a = trackSamples[i], b = trackSamples[i + 1]; const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz; const u = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
    const px = a.x + dx * u, pz = a.z + dz * u; const ex = x - px, ez = z - pz; const d2 = ex * ex + ez * ez;
    if (d2 < bestD2) { bestD2 = d2; bestI = i; bestU = u; bestX = px; bestZ = pz; }
  }
  const t = (bestI + bestU) / n; const tan = tangentAt(t); const ex = x - bestX, ez = z - bestZ;
  const lateral = -tan.z * ex + tan.x * ez;
  return { t, lateral, distance: Math.sqrt(bestD2), x: bestX, z: bestZ, tangent: tan };
}
function updateWheels(car, dt) {
  const angle = car.speed * dt / .34;
  for (let i = 0; i < car.wheelNodes.length; i++) {
    const wheel = car.wheelNodes[i]; if (!wheel) continue;
    if (i < 2) wheel.rotation.y = car.steer * .48;
    wheel.rotation.z += angle;
  }
  if (car.brakeLights?.material) {
    const mat = car.brakeLights.material; mat.emissive = new THREE.Color(car.brake > .08 ? 0xe12c1b : 0x150200); mat.emissiveIntensity = car.brake > .08 ? 2.5 : .2;
  }
}
function readPlayerControls() {
  controls.throttle = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0;
  controls.brake = (keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0;
  // The GLB car's local +Z is right; positive yaw bends toward -Z, so left = positive steer.
  controls.steer = ((keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0) - ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0);
  controls.handbrake = keys.has('Space') ? 1 : 0;
  const pads = navigator.getGamepads?.(); const pad = pads?.[0];
  if (pad) {
    const axis = Math.abs(pad.axes[0]) > .08 ? pad.axes[0] : 0;
    controls.steer = axis ? -axis : controls.steer;
    controls.throttle = Math.max(controls.throttle, pad.buttons[7]?.value || 0);
    controls.brake = Math.max(controls.brake, pad.buttons[6]?.value || 0);
    controls.handbrake = Math.max(controls.handbrake, pad.buttons[0]?.value || 0);
  }
  const mobile = window.__mobileDrive || {};
  controls.throttle = Math.max(controls.throttle, mobile.throttle ? 1 : 0);
  controls.brake = Math.max(controls.brake, mobile.brake ? 1 : 0);
  controls.steer = mobile.left ? 1 : mobile.right ? -1 : controls.steer;
}
function calculateGrip(lateral, handbrake = 0) {
  const edge = Math.max(0, Math.abs(lateral) - (WORLD.half - 1.25));
  const off = Math.max(0, Math.abs(lateral) - WORLD.half);
  let mu = 1.42 - clamp(edge * .18, 0, .46) - clamp(off * .09, 0, .82);
  if (handbrake) mu *= 1 - .48 * handbrake;
  return clamp(mu, .38, 1.42);
}
function updateVehicle(car, dt, command) {
  const proj = projectToTrack(car.x, car.z); car.t = proj.t;
  const forward = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
  const right = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
  const vel = new THREE.Vector3(car.vx, 0, car.vz);
  let vLong = vel.dot(forward), vLat = vel.dot(right); const absV = Math.max(0, Math.abs(vLong));
  const steer = clamp(command.steer, -1, 1); const throttle = clamp(command.throttle, 0, 1); const brake = clamp(command.brake, 0, 1); const handbrake = clamp(command.handbrake || 0, 0, 1);
  car.steer = lerp(car.steer, steer, clamp(dt * 7.5, 0, 1)); car.throttle = throttle; car.brake = brake; car.handbrake = handbrake;
  const mu = calculateGrip(proj.lateral, handbrake); const steerAngle = car.steer * MAX_STEER;
  // A bicycle-model yaw response bounded by the available tire friction circle.
  let targetYaw = vLong / WHEELBASE * Math.tan(steerAngle);
  const maxYaw = (mu * G * .94) / Math.max(absV, 2.2);
  targetYaw = clamp(targetYaw, -maxYaw, maxYaw);
  const response = 1 - Math.exp(-dt * (3.3 + Math.min(absV * .06, 2.5)));
  car.yawRate = lerp(car.yawRate, targetYaw, response);
  const powerDrop = clamp(1 - absV / 76, .12, 1);
  let ax = throttle * 6.9 * powerDrop - brake * (vLong >= 0 ? 11.6 : -7.5) - Math.sign(vLong) * (.13 + .00040 * vLong * vLong);
  if (handbrake) ax -= Math.sign(vLong || 1) * handbrake * 1.5;
  const ay = -car.yawRate * vLong - vLat * (2.7 + mu * 1.1);
  const aLong = ax + car.yawRate * vLat;
  const aWorld = forward.multiplyScalar(aLong).add(right.multiplyScalar(ay));
  car.vx += aWorld.x * dt; car.vz += aWorld.z * dt;
  // Tire-force clamp prevents physically impossible lateral acceleration on low-grip surfaces.
  const postV = new THREE.Vector3(car.vx, 0, car.vz); vLong = postV.dot(new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw)));
  const maxSpeed = 81; if (Math.abs(vLong) > maxSpeed) { car.vx *= maxSpeed / Math.abs(vLong); car.vz *= maxSpeed / Math.abs(vLong); }
  car.yaw += car.yawRate * dt;
  car.speed = Math.hypot(car.vx, car.vz);
  const newProj = projectToTrack(car.x + car.vx * dt, car.z + car.vz * dt);
  const off = Math.abs(newProj.lateral);
  if (off > WORLD.half + 9) {
    const corrected = pointAt(newProj.t, Math.sign(newProj.lateral) * (WORLD.half + 8.5), .15);
    car.x = corrected.x; car.z = corrected.z; car.vx *= .46; car.vz *= .46; car.yawRate *= .35;
  } else { car.x += car.vx * dt; car.z += car.vz * dt; }
  car.group.position.set(car.x, .12 + Math.sin(performance.now() * .0018 + car.x) * Math.min(car.speed * .0008, .045), car.z);
  car.group.rotation.y = car.yaw;
  car.rpm = 950 + clamp((car.speed * 3.6 % (car.gear === 1 ? 47 : 51)) / (car.gear === 1 ? 47 : 51), 0, 1) * 6200 + throttle * 500;
  car.gear = car.speed < 1.5 ? (throttle ? 1 : 0) : clamp(Math.floor(car.speed * 3.6 / 47) + 1, 1, 6);
  updateWheels(car, dt);
  return { ...newProj, mu };
}
function curvatureAt(t, distance = 16) {
  const dt = distance / WORLD.length; const a = tangentAt(t - dt), b = tangentAt(t), c = tangentAt(t + dt);
  const ang1 = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  const ang2 = Math.atan2(b.x * c.z - b.z * c.x, b.x * c.x + b.z * c.z);
  return Math.abs(ang1 + ang2) / Math.max(distance * 2, 1);
}
function aiCommand(bot, dt) {
  const proj = projectToTrack(bot.x, bot.z); bot.t = proj.t;
  const speed = Math.hypot(bot.vx, bot.vz); const look = clamp(8 + speed * .42, 9, 31); const aimT = (proj.t + look / WORLD.length) % 1;
  let lane = bot.lane;
  // Give other cars a little space, without teleporting between lanes.
  for (const other of [player, ...bots]) if (other !== bot && other) {
    const dx = other.x - bot.x, dz = other.z - bot.z; const forward = Math.cos(bot.yaw) * dx - Math.sin(bot.yaw) * dz; const side = Math.sin(bot.yaw) * dx + Math.cos(bot.yaw) * dz;
    if (forward > -2 && forward < 15 && Math.abs(side) < 3.6) lane = bot.lane + (side > 0 ? -2.5 : 2.5);
  }
  lane = clamp(lane, -2.7, 2.7);
  const target = pointAt(aimT, lane, .15); const dx = target.x - bot.x, dz = target.z - bot.z;
  const desiredYaw = Math.atan2(-dz, dx); let angle = ((desiredYaw - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const desiredYawRate = 2 * speed * Math.sin(angle) / Math.max(look, 7);
  let steer = clamp(Math.atan(desiredYawRate * WHEELBASE / Math.max(speed, 4)) / MAX_STEER, -1, 1);
  const curve = curvatureAt(aimT, 17); const targetSpeed = clamp(Math.sqrt((1.32 * G) / Math.max(curve, .00045)) * .86, 24, 69);
  const delta = targetSpeed - speed; const throttle = delta > 1.5 ? clamp(delta * .55, .12, 1) : 0;
  const brake = delta < -2.5 ? clamp((-delta - 1.5) * .34, 0, .88) : 0;
  return { steer, throttle, brake, handbrake: 0 };
}
function initializeCars(carScene) {
  player = makeCar(carScene, 'PLAYER // APEX 07', 0xf0f1e9, true);
  bots = [
    makeCar(carScene, 'RIVAL // VOLT', 0xc4df3a),
    makeCar(carScene, 'RIVAL // CRIMSON', 0xc63d34),
    makeCar(carScene, 'RIVAL // AZURE', 0x467ba9),
  ];
  placeCarOnTrack(player, .012, 0);
  placeCarOnTrack(bots[0], .006, -2.5); placeCarOnTrack(bots[1], .998, 2.5); placeCarOnTrack(bots[2], .988, -2.3);
  for (const bot of bots) { bot.progress = bot.t; bot.lastT = bot.t; }
  player.progress = player.t; player.lastT = player.t;
}
function resetSession() {
  running = false; paused = false; finished = false; raceStarted = false; raceTime = 0; startCountdown = 2.55;
  ui.start.classList.add('hidden'); ui.pause.classList.add('hidden'); ui.finish.classList.add('hidden'); ui.hud.style.opacity = '1';
  placeCarOnTrack(player, .012, 0); player.lap = 0; player.lapStart = 0; player.lastLap = NaN; player.finished = false; player.startArmed = true; player.progress = .012; player.bestLap = Number(localStorage.getItem('apex-best-lap') || NaN);
  const starts = [[.006, -2.4], [.998, 2.4], [.990, -2.4]];
  bots.forEach((bot, i) => { placeCarOnTrack(bot, starts[i][0], starts[i][1]); bot.lap = 0; bot.lapStart = 0; bot.lastLap = NaN; bot.finished = false; bot.startArmed = false; bot.progress = starts[i][0] < .5 ? starts[i][0] : starts[i][0] - 1; });
  showMessage('3'); setTimeout(() => showMessage('2'), 700); setTimeout(() => showMessage('1'), 1400); setTimeout(() => showMessage('GO', 850), 2100);
}
function showMessage(text, duration = 620) {
  ui.message.textContent = text; ui.message.classList.add('show'); window.clearTimeout(raceMessageTimer); raceMessageTimer = window.setTimeout(() => ui.message.classList.remove('show'), duration);
}
function startRace() {
  ensureAudio(); resetSession(); running = true; ui.sessionLabel.textContent = 'SPRINT RACE // 3 LAPS'; ui.start.classList.add('hidden');
}
function pauseRace() {
  if (!running || finished) return; paused = !paused; ui.pause.classList.toggle('hidden', !paused); ui.hud.style.opacity = paused ? '.24' : '1';
  if (paused) audioSet(0); else clock.getDelta();
}
function finishRace() {
  finished = true; running = false; const place = getPosition(player); ui.finish.classList.remove('hidden');
  $('finish-heading').textContent = place === 1 ? 'P1 // VICTORY' : 'CHEQUERED FLAG'; $('finish-copy').textContent = place === 1 ? 'A clean drive. That one was earned.' : 'The circuit is complete. Find more time next run.';
  $('finish-position').textContent = `P${String(place).padStart(2, '0')}`; $('finish-best').textContent = Number.isFinite(player.bestLap) ? formatTime(player.bestLap) : '--:--.---'; $('finish-time').textContent = formatTime(raceTime);
}
function getPosition(car) {
  const all = [player, ...bots].sort((a, b) => (b.lap + b.t) - (a.lap + a.t)); return all.indexOf(car) + 1;
}
function resolveCarContacts(cars) {
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j]; const dx = b.x - a.x, dz = b.z - a.z; const d2 = dx * dx + dz * dz; const minDist = 2.35;
    if (d2 > 0.001 && d2 < minDist * minDist) {
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, overlap = minDist - d;
      a.x -= nx * overlap * .52; a.z -= nz * overlap * .52; b.x += nx * overlap * .48; b.z += nz * overlap * .48;
      const relative = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (relative < 0) { const impulse = -(1 + .14) * relative * .5; a.vx -= impulse * nx; a.vz -= impulse * nz; b.vx += impulse * nx; b.vz += impulse * nz; }
      a.group.position.x = a.x; a.group.position.z = a.z; b.group.position.x = b.x; b.group.position.z = b.z;
    }
  }
}
function updateRace(dt, playerProj) {
  if (!running || paused || finished) return;
  if (startCountdown > 0) { startCountdown -= dt; if (startCountdown <= 0) { raceStarted = true; showMessage('GREEN FLAG', 700); bots.forEach(b => b.lapStart = 0); player.lapStart = 0; } }
  else raceTime += dt;
  if (raceStarted) {
    const pNow = playerProj.t;
    if (player.lastT > .87 && pNow < .13 && player.speed > 9) {
      const lapTime = raceTime - player.lapStart; player.lap++; player.lastLap = lapTime; player.lapStart = raceTime;
      if (lapTime > 15 && (!Number.isFinite(player.bestLap) || lapTime < player.bestLap)) { player.bestLap = lapTime; localStorage.setItem('apex-best-lap', String(lapTime)); showToast('PERSONAL BEST // ' + formatTime(lapTime), 3200); }
      if (player.lap >= 3) { finishRace(); }
    }
    player.lastT = pNow;
    for (const bot of bots) {
      const prev = bot.lastT, now = bot.t;
      if (prev > .87 && now < .13 && bot.speed > 8) {
        if (!bot.startArmed) { bot.startArmed = true; bot.lapStart = raceTime; }
        else bot.lap++;
      }
      bot.lastT = now;
      bot.progress = bot.lap + now;
      if (bot.lap >= 3 && !bot.finished) { bot.finished = true; bot.finishTime = raceTime; }
    }
  }
  player.progress = player.lap + player.t;
  ui.position.innerHTML = `${String(getPosition(player)).padStart(2, '0')} <small>/ 04</small>`;
  ui.lap.innerHTML = `${String(Math.min(player.lap + 1, 3)).padStart(2, '0')} <small>/ 03</small>`;
  ui.lastLap.textContent = Number.isFinite(player.lastLap) ? formatTime(player.lastLap) : '--:--.---';
  ui.bestLap.textContent = Number.isFinite(player.bestLap) ? formatTime(player.bestLap) : '--:--.---';
  ui.session.textContent = formatTime(raceTime);
  ui.speed.textContent = String(Math.round(player.speed * 3.6)).padStart(3, '0'); ui.gear.textContent = player.gear || 'N';
  ui.rpm.textContent = String(Math.round(player.rpm)).padStart(4, '0'); ui.rpmFill.style.width = `${clamp((player.rpm - 900) / 6800 * 100, 0, 100)}%`;
  const rank = getPosition(player); $('sector-status').textContent = player.speed > 3 ? 'GREEN' : raceStarted ? 'READY' : 'GRID';
  for (let i = 1; i <= 4; i++) { const el = $(`tire-${i}`); el.style.opacity = String(clamp(.35 + Math.abs(player.steer) * .5 + player.speed / 180, .3, 1)); }
  if (Number.isFinite(player.bestLap)) {
    const delta = (raceStarted ? raceTime - player.lapStart : 0) - player.bestLap;
    ui.delta.textContent = `${delta > 0 ? '+' : ''}${delta.toFixed(3)} S`;
    ui.deltaPill.style.color = delta <= 0 ? '#d3ff3f' : '#ff8b72';
    ui.deltaPill.querySelector('.delta-dot').style.background = delta <= 0 ? '#d3ff3f' : '#ff8b72';
  } else { ui.delta.textContent = 'NO DELTA'; ui.deltaPill.style.color = ''; }
}
function updateCamera(dt) {
  const fwd = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  let desired, target;
  if (cameraMode === 0) {
    desired = new THREE.Vector3(player.x, .5, player.z).addScaledVector(fwd, -9.5); desired.y += 4.3 + player.speed * .014;
    target = new THREE.Vector3(player.x, 1.1, player.z).addScaledVector(fwd, 5.4); target.y += .6;
  } else {
    desired = new THREE.Vector3(player.x, 1.42, player.z).addScaledVector(fwd, .38);
    target = new THREE.Vector3(player.x, 1.25, player.z).addScaledVector(fwd, 22);
  }
  const alpha = 1 - Math.exp(-dt * (cameraMode === 0 ? 2.4 : 8)); camera.position.lerp(desired, alpha); camera.lookAt(target);
  ui.camera.innerHTML = `${cameraMode === 0 ? 'CHASE CAM' : 'HOOD CAM'} <span>·</span> C`;
}
function updateAudio() {
  if (!audioCtx || !engineOsc) return;
  const rpm = player?.rpm || 950; const hz = 34 + rpm / 60 * (player?.gear || 1) * .48;
  engineOsc.frequency.setTargetAtTime(hz, audioCtx.currentTime, .06); engineOsc2.frequency.setTargetAtTime(hz * 1.51, audioCtx.currentTime, .06);
  const gain = audioEnabled && running && !paused ? .038 + (player.throttle || 0) * .045 + Math.min(player.speed / 90, .025) : 0;
  engineGain.gain.setTargetAtTime(gain, audioCtx.currentTime, .09);
}
function audioSet(value) { if (engineGain && audioCtx) engineGain.gain.setTargetAtTime(value, audioCtx.currentTime, .06); }
function ensureAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)(); engineOsc = audioCtx.createOscillator(); engineOsc2 = audioCtx.createOscillator(); engineGain = audioCtx.createGain(); const filter = audioCtx.createBiquadFilter();
    engineOsc.type = 'sawtooth'; engineOsc2.type = 'triangle'; filter.type = 'lowpass'; filter.frequency.value = 650;
    engineOsc.connect(filter); engineOsc2.connect(filter); filter.connect(engineGain); engineGain.connect(audioCtx.destination); engineGain.gain.value = 0;
    engineOsc.start(); engineOsc2.start();
  } catch { audioEnabled = false; }
}
function animate() {
  requestAnimationFrame(animate); const dt = Math.min(clock.getDelta(), .035);
  if (player && running && !paused && !finished) {
    readPlayerControls(); const proj = updateVehicle(player, dt, controls);
    for (const bot of bots) { const command = aiCommand(bot, dt); updateVehicle(bot, dt, command); }
    resolveCarContacts([player, ...bots]);
    updateRace(dt, proj); updateCamera(dt); updateAudio();
  } else if (player) { updateCamera(Math.min(dt || .016, .04)); updateAudio(); }
  if (renderer && scene && camera) renderer.render(scene, camera);
}
function onResize() {
  if (!camera || !renderer) return; camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.35 : 1.7));
}
function bindUI() {
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Escape' && running) pauseRace();
    if (e.code === 'KeyC') { cameraMode = 1 - cameraMode; showToast(cameraMode ? 'HOOD CAMERA' : 'CHASE CAMERA', 1200); }
    if (e.code === 'KeyR' && player) { const p = pointAt(player.t, 0, .15); player.x = p.x; player.z = p.z; const tan = tangentAt(player.t); player.yaw = Math.atan2(-tan.z, tan.x); player.vx = player.vz = 0; player.yawRate = 0; showToast('CAR RECOVERED'); }
  });
  window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => keys.clear());
  ui.startButton.addEventListener('click', startRace); $('resume-race').addEventListener('click', pauseRace);
  $('restart-race').addEventListener('click', () => { ui.pause.classList.add('hidden'); resetSession(); running = true; });
  $('race-again').addEventListener('click', () => { ui.finish.classList.add('hidden'); resetSession(); running = true; });
  $('sound-toggle').addEventListener('click', () => { audioEnabled = !audioEnabled; $('sound-glyph').textContent = audioEnabled ? '◖' : '×'; if (!audioEnabled) audioSet(0); else ensureAudio(); showToast(audioEnabled ? 'ENGINE AUDIO ON' : 'ENGINE AUDIO OFF'); });
  window.__mobileDrive = {};
  for (const btn of document.querySelectorAll('[data-drive]')) {
    const kind = btn.dataset.drive; const down = e => { e.preventDefault(); window.__mobileDrive[kind] = true; btn.classList.add('active'); };
    const up = e => { e.preventDefault(); window.__mobileDrive[kind] = false; btn.classList.remove('active'); };
    btn.addEventListener('pointerdown', down); btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
  }
}
async function loadAsset(url, label, progress) {
  return new Promise((resolve, reject) => loader.load(url, (gltf) => { setLoading(progress, `${label} ready`); resolve(gltf.scene); }, undefined, reject));
}
async function boot() {
  bindUI(); makeRenderer(); setLoading(.05, 'Loading car geometry…');
  try {
    carAsset = await loadAsset(ASSET('gt3-car.glb'), 'GT3 vehicle', .38);
    setLoading(.42, 'Loading circuit materials…'); roadAsset = await loadAsset(ASSET('circuit-kit.glb'), 'Circuit surface kit', .68);
    setLoading(.72, 'Loading safety assets…'); barrierAsset = await loadAsset(ASSET('safety-barriers.glb'), 'Trackside safety kit', .86);
    setLoading(.88, 'Building circuit and race grid…'); createScenery(roadAsset, barrierAsset); initializeCars(carAsset);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(950, 32, 18), new THREE.MeshBasicMaterial({ color: 0x9eb7c6, side: THREE.BackSide, fog: false })); sky.position.y = 110; worldGroup.add(sky);
    setLoading(.97, 'Ready for the green flag');
    ui.bestLap.textContent = Number.isFinite(player.bestLap) ? formatTime(player.bestLap) : '--:--.---';
    updateCamera(.016); animate();
    setTimeout(() => { ui.loading.classList.add('done'); }, 250);
  } catch (error) {
    console.error(error); setLoading(1, 'Asset load failed — check the network and reload'); showToast('Unable to load a race asset. Reload to retry.', 6000);
  }
}
boot();
