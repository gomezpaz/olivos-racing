import * as THREE from 'three';

// 2006 Volkswagen Sharan (7M facelift) — procedural model.
// Built facing +Z, dimensions ~4.62 x 1.81 x 1.73 m.
export function buildSharan({ color = 0x9a9da0 } = {}) {
  const group = new THREE.Group();
  const body = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.85, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.06,
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x141c22, metalness: 0.2, roughness: 0.03, clearcoat: 1.0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.2, roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 0.95, roughness: 0.15 });

  // Side silhouette (x = longitudinal, +x front; y = height)
  const s = new THREE.Shape();
  s.moveTo(-2.28, 0.32);
  s.lineTo(-2.33, 0.78);   // rear bumper
  s.lineTo(-2.26, 1.60);   // tailgate (near vertical, MPV)
  s.quadraticCurveTo(-2.1, 1.70, -1.7, 1.71);
  s.lineTo(-0.2, 1.72);    // long roof
  s.quadraticCurveTo(0.45, 1.68, 0.95, 1.42); // A-pillar / windshield
  s.quadraticCurveTo(1.45, 1.14, 1.75, 1.02); // cowl into short hood
  s.lineTo(2.18, 0.92);    // hood slope
  s.quadraticCurveTo(2.32, 0.82, 2.32, 0.62); // nose
  s.lineTo(2.30, 0.32);    // front bumper
  s.lineTo(-2.28, 0.32);

  const W = 1.78;
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
  bodyGeo.rotateY(-Math.PI / 2); // silhouette +x -> world +z
  bodyGeo.translate((W + 0.1) / 2, 0, 0);
  const bodyMesh = new THREE.Mesh(bodyGeo, body);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);

  // Greenhouse: dark glass band wrapping the cabin
  const bandGeo = new THREE.BoxGeometry(1.66, 0.52, 3.05);
  const band = new THREE.Mesh(bandGeo, glass);
  band.position.set(0, 1.33, -0.35);
  group.add(band);
  // Windshield
  const wsGeo = new THREE.PlaneGeometry(1.58, 0.78);
  const ws = new THREE.Mesh(wsGeo, glass);
  ws.position.set(0, 1.28, 1.02);
  ws.rotation.x = -0.62;
  group.add(ws);

  // Wheels: tire + alloy rim with 6 spokes + center cap
  const tireGeo = new THREE.CylinderGeometry(0.335, 0.335, 0.215, 28);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.22, 20);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcbf, metalness: 0.9, roughness: 0.25 });
  const spokeGeo = new THREE.BoxGeometry(0.06, 0.36, 0.08); // radial spokes (wheel axis = x)
  const capGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.24, 12);
  capGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const archGeo = new THREE.TorusGeometry(0.40, 0.055, 8, 20, Math.PI);
  for (const [x, z] of [[-0.78, 1.45], [0.78, 1.45], [-0.78, -1.35], [0.78, -1.35]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(tireGeo, dark));
    const rim = new THREE.Mesh(rimGeo, rimMat);
    w.add(rim);
    for (let s = 0; s < 6; s++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (s / 6) * Math.PI * 2;
      spoke.position.x = x > 0 ? 0.05 : -0.05;
      w.add(spoke);
    }
    w.add(new THREE.Mesh(capGeo, chrome));
    w.position.set(x, 0.335, z);
    w.castShadow = true;
    group.add(w);
    wheels.push(w);
    // wheel arch trim on the body (doesn't rotate)
    const arch = new THREE.Mesh(archGeo, dark);
    arch.position.set(x * 1.13, 0.35, z);
    arch.rotation.y = Math.PI / 2;
    group.add(arch);
  }

  // lower plastic trim band (classic 7M Sharan grey plastic)
  const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.14, 4.5), dark);
  rocker.position.set(0, 0.30, 0);
  group.add(rocker);

  // license plates (Argentine black-on-white style)
  const plateTex = makePlateTexture();
  const plateGeo = new THREE.PlaneGeometry(0.4, 0.13);
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 });
  const frontPlate = new THREE.Mesh(plateGeo, plateMat);
  frontPlate.position.set(0, 0.55, 2.345);
  group.add(frontPlate);
  const rearPlate = new THREE.Mesh(plateGeo, plateMat);
  rearPlate.position.set(0, 0.72, -2.345);
  rearPlate.rotation.y = Math.PI;
  group.add(rearPlate);

  // Lights, grille, plate
  const headGeo = new THREE.BoxGeometry(0.46, 0.16, 0.06);
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(headGeo, chrome);
    h.position.set(sx * 0.58, 0.86, 2.31);
    group.add(h);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.06), new THREE.MeshStandardMaterial({ color: 0x7a1220, roughness: 0.3 }));
    tl.position.set(sx * 0.76, 1.15, -2.32);
    group.add(tl);
    // mirrors
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.20), body);
    m.position.set(sx * 0.97, 1.12, 0.85);
    group.add(m);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.05), dark);
  grille.position.set(0, 0.86, 2.33);
  group.add(grille);
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20), chrome);
  badge.rotation.x = Math.PI / 2;
  badge.position.set(0, 0.86, 2.36);
  group.add(badge);

  // Roof rails (classic Sharan)
  const railGeo = new THREE.BoxGeometry(0.05, 0.05, 2.6);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, dark);
    rail.position.set(sx * 0.72, 1.78, -0.35);
    group.add(rail);
  }

  // soft contact shadow (helps ground the car in both render modes)
  const shadowTex = makeShadowTexture();
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.renderOrder = 1;
  group.add(blob);

  return { group, wheels, wheelRadius: 0.335 };
}

let _plateTex = null;
function makePlateTexture() {
  if (_plateTex) return _plateTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 42;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(0, 0, 128, 42);
  ctx.strokeStyle = '#222';
  ctx.strokeRect(1, 1, 126, 40);
  ctx.fillStyle = '#151515';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('OLV 006', 64, 30);
  _plateTex = new THREE.CanvasTexture(c);
  _plateTex.colorSpace = THREE.SRGBColorSpace;
  return _plateTex;
}

let _shadowTex = null;
function makeShadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}
