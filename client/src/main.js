import * as THREE from 'three';
import mapData from './data/olivos.json';
import { makeProjector } from './geo.js';
import { buildWorld, buildCircuitDressing } from './world.js';
import { initTiles, fetchApiKey } from './tiles.js';
import { Car, RemoteCar } from './car.js';
import { Track } from './track.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { CARS } from './cars/index.js';

const $ = (id) => document.getElementById(id);

// ---------- menu ----------
const nameInput = $('name-input');
const roomInput = $('room-input');
nameInput.value = localStorage.getItem('playerName') || '';
const urlRoom = new URLSearchParams(location.search).get('room');
roomInput.value = urlRoom || localStorage.getItem('room') || `olivos-${Math.random().toString(36).slice(2, 6)}`;

let selectedCar = localStorage.getItem('car') || 'sharan-2006';
const carList = $('car-list');
for (const car of CARS) {
  const el = document.createElement('div');
  el.className = 'car-card' + (car.locked ? ' locked' : '') + (car.id === selectedCar ? ' sel' : '');
  el.innerHTML = car.locked
    ? `<div class="car-swatch" style="background:#333"></div><div class="car-name">???</div><div class="car-tag">${car.tagline}</div>`
    : `<div class="car-swatch" style="background:${car.color}"></div>
       <div class="car-name">${car.name}<br>(${car.year})</div><div class="car-tag">${car.tagline}</div>
       <div class="stats">${['speed', 'accel', 'handling'].map((s) => `<div class="stat"><i style="width:${car.stats[s] * 100}%"></i></div>`).join('')}</div>`;
  if (!car.locked) {
    el.onclick = () => {
      selectedCar = car.id;
      document.querySelectorAll('.car-card').forEach((c) => c.classList.remove('sel'));
      el.classList.add('sel');
    };
  }
  carList.appendChild(el);
}

$('copy-link').onclick = () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomInput.value.trim())}`;
  navigator.clipboard.writeText(url);
  $('copy-link').textContent = '¡Copiado!';
  setTimeout(() => ($('copy-link').textContent = 'Copiar link'), 1500);
};

const apiKeyPromise = fetchApiKey();
apiKeyPromise.then((k) => {
  $('mode-note').innerHTML = k
    ? '<b>Modo fotorrealista</b> — Google Earth 3D activado'
    : 'Modo mapa OSM (calles reales). Agregá una API key de Google Maps para el modo fotorrealista.';
});

$('play-btn').onclick = async () => {
  const name = nameInput.value.trim() || 'Piloto';
  const room = roomInput.value.trim() || 'olivos';
  localStorage.setItem('playerName', name);
  localStorage.setItem('room', room);
  localStorage.setItem('car', selectedCar);
  history.replaceState(null, '', `?room=${encodeURIComponent(room)}`);
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  startGame(name, room, selectedCar, await apiKeyPromise);
};

// ---------- game ----------
async function startGame(playerName, room, carId, apiKey) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe2f3, 500, 2200);

  // image-based lighting so car paint has real reflections
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 6000);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // late-afternoon sun over the river
  const { Sky } = await import('three/addons/objects/Sky.js');
  const sky = new Sky();
  sky.scale.setScalar(45000);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(35));
  sky.material.uniforms.turbidity.value = 6;
  sky.material.uniforms.rayleigh.value = 1.8;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.85;
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xffe8c8, 3.1);
  sun.position.copy(sunDir).multiplyScalar(250);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbfd7f0, 0x54503e, 0.75));

  const proj = makeProjector(mapData.origin);
  const trackData = mapData.tracks[0];

  $('loading-note').classList.remove('hidden');
  const tilesCtl = await initTiles(scene, camera, renderer, mapData.origin, apiKey);
  const tilesMode = !!tilesCtl;
  if (tilesMode) {
    $('attribution').classList.remove('hidden');
    $('attribution').textContent = 'Map data ©2026 Google';
  }
  const { colliders } = buildWorld(scene, mapData, proj, { tilesMode });
  const track = new Track(trackData, proj, scene);
  buildCircuitDressing(scene, track.pts, { tilesMode });

  const groundHeight = tilesMode ? (x, z) => tilesCtl.groundHeight(x, z) : () => 0;

  const car = new Car(carId, scene);
  const spawn = track.spawnPose(0);
  car.place(spawn.x, spawn.z, spawn.yaw);

  const input = new Input();
  input.onAction('KeyR', () => {
    const cp = track.nearestCheckpoint(car.pos);
    car.place(cp.pos.x, cp.pos.z, cp.yaw, tilesMode ? (x, z) => tilesCtl.groundHeight(x, z) ?? car.groundY : null);
  });
  let camMode = 0;
  input.onAction('KeyC', () => (camMode = (camMode + 1) % 2));
  if (tilesMode) {
    input.onAction('Digit9', () => tilesCtl.adjustYaw(0.005));
    input.onAction('Digit0', () => tilesCtl.adjustYaw(-0.005));
  }

  // ---------- networking ----------
  const net = new Net();
  const remotes = new Map();
  let race = { phase: 'free', startAt: 0, results: [] };
  const playersMeta = new Map(); // id -> {name, car, cp, lap}

  net.on('welcome', (msg) => {
    race = msg.race;
    for (const p of msg.players) {
      addRemote(p.id, p);
      if (p.state) remotes.get(p.id)?.push(p.state, performance.now());
    }
    renderPlayers();
  });
  net.on('joined', (msg) => {
    addRemote(msg.player.id, msg.player);
    toast(`${msg.player.name} se unió`);
    renderPlayers();
  });
  net.on('left', (msg) => {
    const r = remotes.get(msg.id);
    if (r) { r.dispose(scene); remotes.delete(msg.id); }
    playersMeta.delete(msg.id);
    renderPlayers();
  });
  net.on('states', (msg) => {
    const now = performance.now();
    for (const row of msg.d) {
      const [id, ...d] = row;
      if (id === net.id) continue;
      remotes.get(id)?.push(d, now);
    }
  });
  net.on('progress', (msg) => {
    const m = playersMeta.get(msg.id);
    if (m) { m.cp = msg.cp; m.lap = msg.lap; }
    renderPlayers();
  });
  net.on('race', (msg) => {
    race = msg.race;
    if (race.phase === 'countdown') beginCountdown();
    if (race.phase === 'racing' && !localRacing) beginRacing();
    if (race.phase === 'finished') showResults();
    if (race.phase === 'free') { $('results').classList.add('hidden'); localRacing = false; car.frozen = false; }
    renderPlayers();
  });
  net.connect(room, playerName, carId);

  function addRemote(id, p) {
    if (remotes.has(id) || id === net.id) return;
    remotes.set(id, new RemoteCar(p.car, p.name, scene));
    playersMeta.set(id, { name: p.name, car: p.car, cp: p.progress?.cp || 0, lap: p.progress?.lap || 0 });
  }

  // ---------- race flow ----------
  let localRacing = false;
  $('start-race-btn').onclick = () => net.send({ t: 'startRace' });
  $('again-btn').onclick = () => net.send({ t: 'resetRace' });

  function beginCountdown() {
    $('start-race-btn').classList.add('hidden');
    $('results').classList.add('hidden');
    const gridIdx = [...playersMeta.keys(), net.id].sort((a, b) => a - b).indexOf(net.id);
    const pose = track.spawnPose(Math.max(0, gridIdx));
    car.place(pose.x, pose.z, pose.yaw, tilesMode ? (x, z) => tilesCtl.groundHeight(x, z) ?? 0 : null);
    car.frozen = true;
    localRacing = false;
  }

  function beginRacing() {
    localRacing = true;
    car.frozen = false;
    track.resetRace(performance.now());
    $('center-msg').textContent = '¡VAMOS!';
    setTimeout(() => ($('center-msg').textContent = ''), 1200);
  }

  function showResults() {
    const rows = race.results.map((r, i) =>
      `<div class="row"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '°'} ${r.name}</span><span>${fmtTime(r.timeMs)}</span></div>`).join('');
    $('results-rows').innerHTML = rows || '<div class="row">Sin resultados</div>';
    $('results').classList.remove('hidden');
    $('start-race-btn').classList.remove('hidden');
  }

  function toast(text) {
    $('toast').textContent = text;
    clearTimeout(toast.tid);
    toast.tid = setTimeout(() => ($('toast').textContent = ''), 2500);
  }

  function renderPlayers() {
    const rows = [[net.id, { name: playerName + ' (vos)', me: true, lap: track.lap, cp: track.nextCp }]];
    for (const [id, m] of playersMeta) rows.push([id, m]);
    $('players').innerHTML = rows.map(([, m]) =>
      `<div class="p ${m.me ? 'me' : ''}"><span>${m.name}</span><span>${race.phase === 'racing' || race.phase === 'countdown' ? 'V' + (m.lap || 0) : ''}</span></div>`).join('');
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let sendAcc = 0, cpAcc = 0;
  const camPos = new THREE.Vector3();
  let firstFrames = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();

    // countdown display
    if (race.phase === 'countdown') {
      const left = Math.max(0, (race.startAt - Date.now()) / 1000);
      $('center-msg').textContent = left > 0.05 ? Math.ceil(left) : '';
      if (Date.now() >= race.startAt && !localRacing) beginRacing();
    }

    car.update(dt, input.read(), groundHeight);

    // building collision (fallback mode only)
    const hit = colliders.resolve(car.pos.x, car.pos.z);
    if (hit) {
      car.pos.x = hit.x; car.pos.z = hit.z;
      car.vel.multiplyScalar(0.4);
    }

    // race progress
    if (localRacing && !track.finished) {
      const ev = track.update(car.pos, true, now);
      if (ev === 'checkpoint' || ev === 'lap') {
        net.send({ t: 'progress', cp: track.nextCp, lap: track.lap });
        if (ev === 'lap') toast(`Vuelta ${track.lap} / ${track.laps}`);
        renderPlayers();
      } else if (ev === 'finish') {
        net.send({ t: 'finish', timeMs: Math.round(track.timeMs) });
        toast(`¡Terminaste! ${fmtTime(track.timeMs)}`);
        car.frozen = false;
        localRacing = false;
      }
    }

    for (const r of remotes.values()) r.update(now);

    // camera: chase / hood
    const back = camMode === 0 ? 9.5 : 0.2;
    const height = camMode === 0 ? 4.2 : 1.35;
    const fwd = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    const target = new THREE.Vector3().copy(car.pos).addScaledVector(fwd, -back).add(new THREE.Vector3(0, height, 0));
    if (firstFrames++ < 3) camPos.copy(target);
    camPos.x = THREE.MathUtils.damp(camPos.x, target.x, 5, dt);
    camPos.y = THREE.MathUtils.damp(camPos.y, target.y, 5, dt);
    camPos.z = THREE.MathUtils.damp(camPos.z, target.z, 5, dt);
    camera.position.copy(camPos);
    camera.lookAt(car.pos.x + fwd.x * 6, car.pos.y + 1.2, car.pos.z + fwd.z * 6);

    // sun follows car for shadow coverage
    sun.position.copy(car.pos).addScaledVector(sunDir, 250);
    sun.target.position.copy(car.pos);

    if (tilesCtl) tilesCtl.update();

    // HUD
    const kmh = Math.round(car.speed * 3.6);
    $('speedo').firstElementChild.textContent = kmh;
    if (localRacing) {
      $('race-info').innerHTML = `<div class="lap">Vuelta ${track.lap}/${track.laps}</div><div class="time">${fmtTime(now - track.raceStart)}</div>`;
    } else if (race.phase !== 'racing') {
      $('race-info').innerHTML = `<div class="lap">${trackData.name}</div><div class="time">${(trackData.lengthM / 1000).toFixed(1)} km · modo libre</div>`;
    }

    // network send @15Hz
    sendAcc += dt;
    if (sendAcc > 1 / 15) {
      sendAcc = 0;
      net.send({ t: 's', d: [
        +car.pos.x.toFixed(2), +car.pos.y.toFixed(2), +car.pos.z.toFixed(2),
        +car.yaw.toFixed(3), +car.steer.toFixed(3), +car.speed.toFixed(1)] });
    }
    cpAcc += dt;
    if (cpAcc > 2 && $('loading-note') && !$('loading-note').classList.contains('hidden')) {
      cpAcc = 0;
      $('loading-note').classList.add('hidden');
    }

    renderer.render(scene, camera);
  }
  frame();
}

function fmtTime(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
