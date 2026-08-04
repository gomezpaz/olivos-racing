import * as THREE from 'three';
import mapData from './data/olivos.json';
import { makeProjector } from './geo.js';
import { buildWorld, buildCircuitDressing } from './world.js';
import { initTiles, fetchApiKey, probeTiles } from './tiles.js';
import { Car, RemoteCar } from './car.js';
import { Track } from './track.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { CarAudio } from './audio.js';
import { CARS } from './cars/index.js';

const $ = (id) => document.getElementById(id);

// diagnostic mode: /?probe=1 exercises tile loading without WebGL
const PROBING = !!new URLSearchParams(location.search).get('probe');
if (PROBING) {
  document.body.style.cssText = 'color:#0f0;background:#000;font:12px monospace;overflow:auto';
  document.querySelectorAll('.overlay,#hud').forEach((el) => el.remove());
  fetchApiKey().then((k) => probeTiles(mapData.origin, k));
}

// ---------- menu ----------
if (!PROBING) {
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

const trackSelect = $('track-select');
for (let i = 0; i < mapData.tracks.length; i++) {
  const t = mapData.tracks[i];
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = `${t.name} · ${(t.lengthM / 1000).toFixed(1)} km · ${t.laps} vueltas`;
  trackSelect.appendChild(opt);
}
trackSelect.value = localStorage.getItem('trackIdx') || '0';

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

// ?auto=1 skips the menu (headless visual QA); ?track= picks the circuit
const autoParams = new URLSearchParams(location.search);
if (autoParams.get('auto')) {
  if (autoParams.get('track') != null) trackSelect.value = autoParams.get('track');
  nameInput.value = autoParams.get('name') || 'QA';
  apiKeyPromise.then(() => setTimeout(() => $('play-btn').click(), 50));
}

$('play-btn').onclick = async () => {
  const name = nameInput.value.trim() || 'Piloto';
  const room = roomInput.value.trim() || 'olivos';
  const trackIdx = parseInt(trackSelect.value, 10) || 0;
  localStorage.setItem('playerName', name);
  localStorage.setItem('room', room);
  localStorage.setItem('car', selectedCar);
  localStorage.setItem('trackIdx', String(trackIdx));
  const keep = new URLSearchParams(location.search).get('debug');
  history.replaceState(null, '', `?room=${encodeURIComponent(room)}${keep ? '&debug=1' : ''}`);
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  startGame(name, room, selectedCar, await apiKeyPromise, trackIdx);
};
} // end !PROBING

// ---------- game ----------
async function startGame(playerName, room, carId, apiKey, trackIdx = 0) {
  // renderer is optional: headless QA drives the full game sim without WebGL
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    document.body.appendChild(renderer.domElement);
  } catch (e) {
    console.warn('WebGL unavailable — running simulation-only', e);
  }

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 6000);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if (renderer) renderer.setSize(innerWidth, innerHeight);
  });

  const proj = makeProjector(mapData.origin);
  const trackData = mapData.tracks[Math.min(trackIdx, mapData.tracks.length - 1)];

  $('loading-note').classList.remove('hidden');
  const tilesCtl = await initTiles(scene, camera, renderer, mapData.origin, apiKey);
  const tilesMode = !!tilesCtl;
  if (tilesMode) {
    $('attribution').classList.remove('hidden');
    $('attribution').textContent = 'Map data ©2026 Google';
  }

  // lighting: physically-based atmosphere in photorealistic mode,
  // stylized sky + sun in OSM fallback (or if atmosphere init fails)
  let atmo = null, sun = null;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(35));
  if (tilesMode && renderer) {
    try {
      const { initAtmosphere } = await import('./atmosphere.js');
      atmo = await initAtmosphere({ renderer, scene, camera, origin: mapData.origin });
    } catch (e) {
      console.error('atmosphere init failed, falling back to basic lighting', e);
    }
  }
  if (!atmo) {
    scene.fog = new THREE.Fog(0xcfe2f3, 500, 2200);
    if (renderer) {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.55;
    }
    const { Sky } = await import('three/addons/objects/Sky.js');
    const sky = new Sky();
    sky.scale.setScalar(45000);
    sky.material.uniforms.turbidity.value = 6;
    sky.material.uniforms.rayleigh.value = 1.8;
    sky.material.uniforms.mieCoefficient.value = 0.004;
    sky.material.uniforms.mieDirectionalG.value = 0.85;
    sky.material.uniforms.sunPosition.value.copy(sunDir);
    scene.add(sky);
    sun = new THREE.DirectionalLight(0xffe8c8, 3.1);
    sun.position.copy(sunDir).multiplyScalar(250);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xbfd7f0, 0x54503e, 0.75));
  }
  const { colliders } = buildWorld(scene, mapData, proj, { tilesMode });
  const track = new Track(trackData, proj, scene);
  const dressing = buildCircuitDressing(scene, track.pts, { tilesMode });
  if (atmo) {
    atmo.addToMask(dressing);
    atmo.addToMask(track.marker);
    addEventListener('resize', () => atmo.setSize(innerWidth, innerHeight));
  }
  let roadOverlay = null;
  if (tilesMode) {
    const { RoadOverlay } = await import('./roadOverlay.js');
    roadOverlay = new RoadOverlay(scene, track.pts);
  }

  const groundHeight = tilesMode
    ? (x, z) => roadOverlay?.heightAt(x, z) ?? tilesCtl.groundHeight(x, z)
    : () => 0;

  const car = new Car(carId, scene);
  if (atmo) atmo.addToMask(car.mesh);
  const spawn = track.spawnPose(0);
  car.place(spawn.x, spawn.z, spawn.yaw);
  // photorealistic terrain streams in async — hold the car until the ground exists
  let awaitingTerrain = tilesMode;
  let terrainWaitMs = 0;
  if (awaitingTerrain) car.frozen = true;

  const audio = new CarAudio();
  try { audio.start(); } catch (e) { console.warn('audio unavailable', e); }

  const input = new Input();
  input.onAction('KeyM', () => {
    const muted = audio.toggleMute();
    toast(muted ? '🔇 Sonido apagado' : '🔊 Sonido prendido');
  });
  input.onAction('KeyR', () => {
    const cp = track.nearestCheckpoint(car.pos);
    car.place(cp.pos.x, cp.pos.z, cp.yaw, tilesMode ? (x, z) => tilesCtl.groundHeight(x, z) ?? car.groundY : null);
  });
  let camMode = 0;
  input.onAction('KeyC', () => (camMode = (camMode + 1) % 2));
  if (tilesMode) {
    input.onAction('Digit9', () => tilesCtl.adjustYaw(0.005));
    input.onAction('Digit0', () => tilesCtl.adjustYaw(-0.005));
    input.onAction('Digit8', () => tilesCtl.adjustYaw(Math.PI / 2)); // coarse 90° fix
    input.onAction('Minus', () => tilesCtl.adjustHeight(-1));
    input.onAction('Equal', () => tilesCtl.adjustHeight(1));
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
    const rc = new RemoteCar(p.car, p.name, scene);
    if (atmo) atmo.addToMask(rc.mesh);
    remotes.set(id, rc);
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

  let tilesErrToasted = false;
  addEventListener('tiles-error', () => {
    if (tilesErrToasted) return;
    tilesErrToasted = true;
    toast('Error cargando Google Earth 3D — revisá la consola (F12)');
  });

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

  // ---------- minimap ----------
  const mm = $('minimap');
  const mmCtx = mm.getContext('2d');
  const mmPad = 16;
  let mmMinX = Infinity, mmMaxX = -Infinity, mmMinZ = Infinity, mmMaxZ = -Infinity;
  for (const p of track.pts) {
    mmMinX = Math.min(mmMinX, p.x); mmMaxX = Math.max(mmMaxX, p.x);
    mmMinZ = Math.min(mmMinZ, p.z); mmMaxZ = Math.max(mmMaxZ, p.z);
  }
  const mmScale = Math.min((mm.width - mmPad * 2) / (mmMaxX - mmMinX), (mm.height - mmPad * 2) / (mmMaxZ - mmMinZ));
  const mmX = (x) => mmPad + (x - mmMinX) * mmScale + (mm.width - mmPad * 2 - (mmMaxX - mmMinX) * mmScale) / 2;
  const mmY = (z) => mmPad + (z - mmMinZ) * mmScale + (mm.height - mmPad * 2 - (mmMaxZ - mmMinZ) * mmScale) / 2;
  function drawMinimap() {
    mmCtx.clearRect(0, 0, mm.width, mm.height);
    mmCtx.beginPath();
    for (let i = 0; i < track.pts.length; i++) {
      const p = track.pts[i];
      i ? mmCtx.lineTo(mmX(p.x), mmY(p.z)) : mmCtx.moveTo(mmX(p.x), mmY(p.z));
    }
    mmCtx.closePath();
    mmCtx.strokeStyle = 'rgba(255,255,255,0.75)';
    mmCtx.lineWidth = 3;
    mmCtx.stroke();
    // start line
    const s0 = track.pts[0];
    mmCtx.fillStyle = '#f6b40e';
    mmCtx.fillRect(mmX(s0.x) - 3, mmY(s0.z) - 3, 6, 6);
    // next checkpoint
    const cp = track.checkpoints[track.nextCp % track.checkpoints.length];
    mmCtx.beginPath();
    mmCtx.arc(mmX(cp.pos.x), mmY(cp.pos.z), 4, 0, 7);
    mmCtx.strokeStyle = '#ffc743';
    mmCtx.lineWidth = 2;
    mmCtx.stroke();
    // remote players
    mmCtx.fillStyle = '#e66';
    for (const r of remotes.values()) {
      mmCtx.beginPath();
      mmCtx.arc(mmX(r.mesh.position.x), mmY(r.mesh.position.z), 3.5, 0, 7);
      mmCtx.fill();
    }
    // me
    mmCtx.fillStyle = '#74acdf';
    mmCtx.beginPath();
    mmCtx.arc(mmX(car.pos.x), mmY(car.pos.z), 4.5, 0, 7);
    mmCtx.fill();
  }

  // ---------- debug overlay (?debug=1, auto-on in simulation-only mode) ----------
  const debugMode = !!new URLSearchParams(location.search).get('debug') || !renderer;
  let debugEl = null, debugAcc = 0;
  if (debugMode) {
    debugEl = document.createElement('div');
    debugEl.id = 'debug-overlay';
    debugEl.style.cssText = 'position:fixed;top:70px;left:12px;z-index:99;background:rgba(0,0,0,0.7);color:#7fff7f;font:11px monospace;padding:8px;border-radius:6px;white-space:pre';
    document.body.appendChild(debugEl);
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let sendAcc = 0, cpAcc = 0, roadAcc = 0, mmAcc = 0;
  const camPos = new THREE.Vector3();
  const camRay = new THREE.Raycaster();
  camRay.firstHitOnly = true;
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

    // wait for streamed terrain before releasing the car (photorealistic mode)
    if (awaitingTerrain) {
      terrainWaitMs += dt * 1000;
      const gy = tilesCtl.groundHeight(spawn.x, spawn.z);
      if (gy != null) {
        awaitingTerrain = false;
        car.frozen = false;
        car.groundY = gy;
        car.place(spawn.x, spawn.z, spawn.yaw, () => gy);
        $('loading-note').classList.add('hidden');
      } else if (terrainWaitMs > 25000) {
        awaitingTerrain = false;
        car.frozen = false;
        toast('El terreno no cargó — revisá la consola (F12)');
      } else {
        $('loading-note').classList.remove('hidden');
        $('loading-note').textContent = 'Cargando Olivos… (Google Earth 3D)';
      }
    }

    const inp = input.read();
    car.update(dt, inp, groundHeight);
    audio.update(car.speed, car.frozen ? 0 : inp.throttle, inp.handbrake, dt);

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
    // camera collision: don't let foliage/buildings swallow the chase cam
    camera.position.copy(camPos);
    if (tilesMode && camMode === 0) {
      const head = new THREE.Vector3(car.pos.x, car.pos.y + 1.5, car.pos.z);
      const toCam = new THREE.Vector3().subVectors(camPos, head);
      const dist = toCam.length();
      camRay.set(head, toCam.normalize());
      camRay.far = dist;
      const hits = camRay.intersectObject(tilesCtl.tiles.group, true);
      if (hits.length && hits[0].distance < dist) {
        camera.position.copy(head).addScaledVector(toCam, Math.max(hits[0].distance * 0.88, 2.2));
      }
    }
    camera.lookAt(car.pos.x + fwd.x * 6, car.pos.y + 1.2, car.pos.z + fwd.z * 6);

    // sun follows car for shadow coverage
    if (sun) {
      sun.position.copy(car.pos).addScaledVector(sunDir, 250);
      sun.target.position.copy(car.pos);
    }
    if (atmo) atmo.update(car.pos);

    if (tilesCtl) tilesCtl.update();

    if (debugEl && (debugAcc += dt) > 0.5) {
      debugAcc = 0;
      const gy = tilesMode ? tilesCtl.groundHeight(car.pos.x, car.pos.z) : 0;
      const t = tilesCtl?.tiles;
      debugEl.textContent =
        `tilesMode=${tilesMode} renderer=${!!renderer}\n` +
        `loadProgress=${t ? t.loadProgress?.toFixed(3) : '-'} tilesInGroup=${t ? t.group.children.length : '-'}\n` +
        `car=(${car.pos.x.toFixed(1)}, ${car.pos.y.toFixed(1)}, ${car.pos.z.toFixed(1)}) yaw=${car.yaw.toFixed(2)}\n` +
        `groundRaycast=${gy == null ? 'NULL' : gy.toFixed(2)} awaitingTerrain=${awaitingTerrain}\n` +
        `tilesYaw=${tilesCtl ? tilesCtl.wrapper.rotation.y.toFixed(3) : '-'} tilesH=${tilesCtl ? tilesCtl.wrapper.position.y.toFixed(1) : '-'}`;
    }

    // HUD
    const kmh = Math.round(car.speed * 3.6);
    $('speedo').firstElementChild.textContent = kmh;
    mmAcc += dt;
    if (mmAcc > 0.12) { mmAcc = 0; drawMinimap(); }
    if (localRacing) {
      const myProg = track.lap * 10000 + track.nextCp;
      let rank = 1;
      for (const m of playersMeta.values()) {
        if ((m.lap || 0) * 10000 + (m.cp || 0) > myProg) rank++;
      }
      $('race-info').innerHTML = `<div class="lap">Vuelta ${track.lap}/${track.laps} · P${rank}/${playersMeta.size + 1}</div><div class="time">${fmtTime(now - track.raceStart)}</div>`;
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
    roadAcc += dt;
    if (roadOverlay && roadAcc > 0.4) {
      roadAcc = 0;
      roadOverlay.update(car.pos, (x, z, ref) => tilesCtl.groundHeight(x, z, ref), now);
    }

    cpAcc += dt;
    if (cpAcc > 2) {
      cpAcc = 0;
      $('loading-note').classList.add('hidden');
      // photorealistic mode: settle track furniture onto the real terrain
      if (tilesMode) {
        const cp = track.checkpoints[track.nextCp % track.checkpoints.length];
        const gy = tilesCtl.groundHeight(cp.pos.x, cp.pos.z);
        if (gy != null) { track.groundY = gy; track.updateMarker(); }
        const g0 = tilesCtl.groundHeight(track.pts[0].x, track.pts[0].z);
        if (g0 != null) dressing.position.y = g0;
      }
    }

    if (atmo) atmo.composer.render(dt);
    else if (renderer) renderer.render(scene, camera);
    else scene.updateMatrixWorld(true); // sim mode: render normally does this
  }
  frame();
}

function fmtTime(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
