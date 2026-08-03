import * as THREE from 'three';

// 2006 Volkswagen Sharan (7M facelift) — procedural model.
// Built facing +Z, dimensions ~4.62 x 1.81 x 1.73 m.
export function buildSharan({ color = 0x9a9da0 } = {}) {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.38 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x141c22, metalness: 0.9, roughness: 0.08 });
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

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.335, 0.335, 0.225, 24);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.23, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[-0.78, 1.45], [0.78, 1.45], [-0.78, -1.35], [0.78, -1.35]]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, dark);
    const hub = new THREE.Mesh(hubGeo, chrome);
    w.add(tire, hub);
    w.position.set(x, 0.335, z);
    w.castShadow = true;
    group.add(w);
    wheels.push(w);
  }

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

  return { group, wheels, wheelRadius: 0.335 };
}
