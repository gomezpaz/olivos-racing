import * as THREE from 'three';
import {
  AerialPerspectiveEffect,
  SunDirectionalLight,
  SkyLightProbe,
  LightingMaskPass,
  PrecomputedTexturesLoader,
  DEFAULT_PRECOMPUTED_TEXTURES_URL,
  getSunDirectionECEF,
} from '@takram/three-atmosphere';
import {
  EffectComposer,
  RenderPass,
  NormalPass,
  EffectPass,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
} from 'postprocessing';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';

// Summer evening golden hour in Buenos Aires (UTC-3). Sun ephemeris is computed
// from this fixed date so the light always looks like a February asado hour.
const GOLDEN_HOUR = new Date('2026-02-15T18:40:00-03:00');

// Physically-based atmosphere for photorealistic mode, mirroring the official
// three.js "3d tiles" example: takram three-atmosphere relights the unlit
// photogrammetry (inputColor = albedo) with real sun/sky irradiance and adds
// aerial perspective; game objects (cars, gantry) are excluded via the lighting
// mask and instead lit by SunDirectionalLight + SkyLightProbe in matching
// physical units. AGX tone mapping compresses the HDR result.
export async function initAtmosphere({ renderer, scene, camera, origin }) {
  const latRad = THREE.MathUtils.degToRad(origin.lat);
  const lonRad = THREE.MathUtils.degToRad(origin.lon);

  const enu = new THREE.Matrix4();
  WGS84_ELLIPSOID.getEastNorthUpFrame(latRad, lonRad, 0, enu);
  const east = new THREE.Vector3(), north = new THREE.Vector3(), up = new THREE.Vector3();
  enu.extractBasis(east, north, up);
  const ecefPos = new THREE.Vector3().setFromMatrixPosition(enu);
  // our world basis expressed in ECEF: X=east, Y=up, Z=south(-north)
  const worldToECEF = new THREE.Matrix4()
    .makeBasis(east, up, north.clone().negate())
    .setPosition(ecefPos);

  const textures = await new Promise((resolve, reject) => {
    new PrecomputedTexturesLoader()
      .setType(renderer)
      .load(DEFAULT_PRECOMPUTED_TEXTURES_URL, resolve, undefined, reject);
  });

  const sunDirection = getSunDirectionECEF(GOLDEN_HOUR, new THREE.Vector3());

  const sunLight = new SunDirectionalLight({
    transmittanceTexture: textures.transmittanceTexture,
    sunDirection,
    distance: 280,
  });
  sunLight.worldToECEFMatrix.copy(worldToECEF);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -60; sunLight.shadow.camera.right = 60;
  sunLight.shadow.camera.top = 60; sunLight.shadow.camera.bottom = -60;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight, sunLight.target);

  const skyProbe = new SkyLightProbe({
    irradianceTexture: textures.irradianceTexture,
    sunDirection,
  });
  skyProbe.worldToECEFMatrix.copy(worldToECEF);
  scene.add(skyProbe);

  const normalPass = new NormalPass(scene, camera);
  const maskPass = new LightingMaskPass(scene, camera);

  const aerial = new AerialPerspectiveEffect(camera, {
    sky: true,
    sun: true,
    sunLight: true,
    skyLight: true,
    normalBuffer: normalPass.texture,
    sunDirection,
    irradianceTexture: textures.irradianceTexture,
    scatteringTexture: textures.scatteringTexture,
    transmittanceTexture: textures.transmittanceTexture,
    singleMieScatteringTexture: textures.singleMieScatteringTexture ?? null,
    higherOrderScatteringTexture: textures.higherOrderScatteringTexture ?? null,
  });
  aerial.worldToECEFMatrix.copy(worldToECEF);
  aerial.lightingMask = { map: maskPass.texture, channel: 'r' };

  renderer.toneMapping = THREE.NoToneMapping; // AGX applied in the effect pass
  renderer.toneMappingExposure = 10;          // matches the reference example

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(normalPass);
  composer.addPass(maskPass);
  composer.addPass(new EffectPass(camera, aerial,
    new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  composer.setSize(innerWidth, innerHeight);

  sunLight.update();
  skyProbe.update();

  return {
    composer,
    sunLight,
    // objects lit by scene lights (cars, track furniture) — excluded from
    // the atmosphere's albedo relighting
    addToMask(object) {
      object.traverse((c) => {
        if (c.isMesh || c.isSprite) maskPass.selection.add(c);
      });
    },
    update(carPos) {
      sunLight.target.position.copy(carPos);
      sunLight.update();
    },
    setSize(w, h) {
      composer.setSize(w, h);
    },
  };
}
