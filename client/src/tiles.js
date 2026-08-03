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
  tiles.manager.addHandler(/\.(gltf|glb)$/g, gltfLoader);

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.errorTarget = 8;
  if (tiles.lruCache) tiles.lruCache.maxBytesSize = 512 * 1024 * 1024;

  tiles.setLatLonToYUp(THREE.MathUtils.degToRad(origin.lat), THREE.MathUtils.degToRad(origin.lon));

  const wrapper = new THREE.Group();
  const savedYaw = parseFloat(localStorage.getItem('tilesYaw') || '0');
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
      raycaster.set(new THREE.Vector3(x, 120, z), down);
      const hits = raycaster.intersectObject(tiles.group, true);
      return hits.length ? hits[0].point.y : null;
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
