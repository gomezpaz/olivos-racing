import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Google Photorealistic 3D Tiles. Returns null if no API key (fallback mode).
// The tile set is rotated so `origin` sits at world origin with Y up; a manual
// yaw offset (persisted in localStorage, keys 9/0 to adjust) allows fine
// alignment against the OSM-derived track until calibrated.
export async function initTiles(scene, camera, renderer, origin, apiKey) {
  if (!apiKey) return null;

  let GoogleCloudAuthPlugin, TilesFadePlugin, TileCompressionPlugin;
  try {
    const plugins = await import('3d-tiles-renderer/plugins');
    ({ GoogleCloudAuthPlugin, TilesFadePlugin, TileCompressionPlugin } = plugins);
  } catch (e) {
    console.error('tiles plugins failed to load', e);
    return null;
  }

  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
  if (TileCompressionPlugin) tiles.registerPlugin(new TileCompressionPlugin());
  if (TilesFadePlugin) tiles.registerPlugin(new TilesFadePlugin());

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
  const gltfLoader = new GLTFLoader(tiles.manager);
  gltfLoader.setDRACOLoader(draco);
  // tile URLs carry ?session=…&key=… query strings, so don't anchor at end-of-string
  tiles.manager.addHandler(/\.(gltf|glb)(\?|$)/, gltfLoader);

  tiles.addEventListener('load-error', (e) => {
    console.error('3D tiles load error:', e);
    dispatchEvent(new CustomEvent('tiles-error', { detail: e }));
  });

  tiles.setCamera(camera);
  if (renderer) tiles.setResolutionFromRenderer(camera, renderer);
  else tiles.setResolution(camera, 1920, 1080);
  tiles.errorTarget = 3; // lower = sharper LODs at street level
  if (tiles.lruCache) tiles.lruCache.maxBytesSize = 768 * 1024 * 1024;

  // sharpen textures at grazing angles (roads were smearing badly without this)
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 0;
  if (maxAniso > 1) {
    tiles.addEventListener('load-model', ({ scene: tileScene }) => {
      tileScene.traverse((c) => {
        if (c.material?.map) {
          c.material.map.anisotropy = maxAniso;
          c.material.map.needsUpdate = true;
        }
      });
    });
  }

  tiles.setLatLonToYUp(THREE.MathUtils.degToRad(origin.lat), THREE.MathUtils.degToRad(origin.lon));

  const wrapper = new THREE.Group();
  // setLatLonToYUp yields north=+X / east=+Z; our world is east=+X / north=-Z,
  // so a +90° yaw brings the imagery into our frame. 9/0 keys fine-tune from there.
  const savedYaw = parseFloat(localStorage.getItem('tilesYaw') ?? 'x') || Math.PI / 2;
  const savedH = parseFloat(localStorage.getItem('tilesHeight') || '0');
  wrapper.rotation.y = savedYaw;
  wrapper.position.y = savedH;
  wrapper.add(tiles.group);
  scene.add(wrapper);

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const down = new THREE.Vector3(0, -1, 0);

  return {
    tiles,
    wrapper,
    update() {
      camera.updateMatrixWorld();
      tiles.update();
    },
    groundHeight(x, z) {
      raycaster.set(new THREE.Vector3(x, 300, z), down);
      const hits = raycaster.intersectObject(tiles.group, true);
      // Take the lowest plausible hit: photogrammetry tree canopies hang over
      // the road, and coarse whole-earth tiles produce km-scale garbage.
      let best = null;
      for (const h of hits) {
        if (h.point.y > -60 && h.point.y < 200 && (best == null || h.point.y < best)) best = h.point.y;
      }
      return best;
    },
    adjustYaw(d) {
      wrapper.rotation.y += d;
      localStorage.setItem('tilesYaw', String(wrapper.rotation.y));
    },
    adjustHeight(d) {
      wrapper.position.y += d;
      localStorage.setItem('tilesHeight', String(wrapper.position.y));
    },
    dispose() {
      scene.remove(wrapper);
      tiles.dispose();
    },
  };
}

// Headless diagnostic: run the tile pipeline without WebGL and report activity.
export async function probeTiles(origin, apiKey) {
  const log = (m) => {
    console.log('[probe]', m);
    document.body.insertAdjacentHTML('beforeend', `<div>${m}</div>`);
  };
  try {
    const { GoogleCloudAuthPlugin } = await import('3d-tiles-renderer/plugins');
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    const gltfLoader = new GLTFLoader(tiles.manager);
    gltfLoader.setDRACOLoader(draco);
    tiles.manager.addHandler(/\.(gltf|glb)(\?|$)/, gltfLoader);

    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.5, 6000);
    camera.position.set(0, 50, 120);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    tiles.setCamera(camera);
    tiles.setResolution(camera, 1920, 1080);
    tiles.setLatLonToYUp(THREE.MathUtils.degToRad(origin.lat), THREE.MathUtils.degToRad(origin.lon));

    tiles.addEventListener('load-tileset', () => log('load-tileset ok'));
    tiles.addEventListener('load-model', (e) => log('load-model ok: ' + (e.tile?.content?.uri || '')));
    tiles.addEventListener('load-error', (e) => log('LOAD-ERROR: ' + (e.error?.message || e.error || JSON.stringify(e).slice(0, 200))));
    tiles.manager.onError = (url) => log('MANAGER-ERROR: ' + url.slice(0, 140));

    let n = 0;
    const iv = setInterval(() => {
      camera.updateMatrixWorld();
      tiles.update();
      if (++n % 20 === 0) {
        const s = tiles.stats || {};
        log(`t=${n / 10}s progress=${tiles.loadProgress?.toFixed(3)} downloading=${s.downloading} parsing=${s.parsing} inFrustum=${s.inFrustum} groupChildren=${tiles.group.children.length}`);
      }
      if (n > 120) clearInterval(iv);
    }, 100);
  } catch (e) {
    log('PROBE EXCEPTION: ' + e.message + '\n' + e.stack);
  }
}

export async function fetchApiKey() {
  const url = new URL(location.href);
  const qk = url.searchParams.get('key');
  if (qk) {
    localStorage.setItem('gmapsKey', qk);
    url.searchParams.delete('key');
    history.replaceState(null, '', url);
  }
  const stored = localStorage.getItem('gmapsKey');
  if (stored) return stored;
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    return cfg.googleMapsApiKey || null;
  } catch {
    return null;
  }
}
