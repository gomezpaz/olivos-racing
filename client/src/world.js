import * as THREE from 'three';

// Fallback world built from baked OSM data: road ribbons, extruded buildings,
// grass ground. Also builds circuit dressing (curbs, gantry, checkpoint arches)
// which is shown in both fallback and photorealistic modes.
export function buildWorld(scene, data, proj, { tilesMode = false } = {}) {
  const world = new THREE.Group();
  scene.add(world);
  const colliders = new SpatialGrid(40);

  if (!tilesMode) {
    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x51643f, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    world.add(ground);

    // roads
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x2e2f33, roughness: 0.95 });
    const roadGeos = [];
    for (const road of data.roads) {
      const pts = road.p.map(([la, lo]) => proj.toWorld(la, lo));
      const g = ribbonGeometry(pts, road.w, 0.0);
      if (g) roadGeos.push(g);
    }
    if (roadGeos.length) {
      const merged = mergeGeometries(roadGeos);
      const mesh = new THREE.Mesh(merged, asphalt);
      mesh.receiveShadow = true;
      world.add(mesh);
    }

    // buildings
    const palette = [0xbfb6a8, 0xcec6b8, 0xa89f92, 0xd8d2c6, 0x9aa0a6];
    const bGeos = [];
    for (let i = 0; i < data.buildings.length; i++) {
      const b = data.buildings[i];
      const pts = b.p.map(([la, lo]) => proj.toWorld(la, lo));
      const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, b.h, 0);
      // ExtrudeGeometry extrudes +z; after rotateX(-90) depth axis -> +y... verify: rotateX(-90): (x,y,z)->(x,z,-y).
      // shape in xy at z in [0,depth] -> becomes (x, z(depth), -y). So height ok, but plan flipped to -y: we pre-negated z.
      colorGeometry(geo, palette[i % palette.length]);
      bGeos.push(geo);
      colliders.addPolygon(pts, b.h);
    }
    if (bGeos.length) {
      const merged = mergeGeometries(bGeos);
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      world.add(mesh);
    }
  }

  return { group: world, colliders };
}

export function buildCircuitDressing(scene, trackPts, { tilesMode = false } = {}) {
  const g = new THREE.Group();
  scene.add(g);

  // racing line ribbon (subtle in tiles mode, bold in fallback)
  const lineGeo = ribbonGeometry(trackPts, tilesMode ? 7 : 9, 0.06);
  const line = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({
    color: 0x3fa7ff, transparent: true, opacity: tilesMode ? 0.18 : 0.28, depthWrite: false }));
  g.add(line);

  // start/finish gantry with checkered banner
  const p0 = trackPts[0], p1 = trackPts[2];
  const dir = new THREE.Vector2(p1.x - p0.x, p1.z - p0.z).normalize();
  const perp = new THREE.Vector2(-dir.y, dir.x);
  const gantry = new THREE.Group();
  const post = new THREE.CylinderGeometry(0.18, 0.18, 6.5, 10);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(post, postMat);
    m.position.set(p0.x + perp.x * 7.5 * side, 3.25, p0.z + perp.y * 7.5 * side);
    gantry.add(m);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(15.4, 1.4, 0.15), checkerMaterial());
  banner.position.set(p0.x, 6.2, p0.z);
  banner.rotation.y = Math.atan2(dir.x, dir.y) + Math.PI / 2;
  gantry.add(banner);
  g.add(gantry);

  return g;
}

export function makeCheckpointMarker(scene) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(9, 0.35, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0xffc743, transparent: true, opacity: 0.85 }));
  ring.rotation.x = Math.PI / 2;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 30, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc743, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 15;
  const grp = new THREE.Group();
  grp.add(ring, beam);
  scene.add(grp);
  return grp;
}

function checkerMaterial() {
  const c = document.createElement('canvas');
  c.width = 220; c.height = 20;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 22; x++) for (let y = 0; y < 2; y++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
    ctx.fillRect(x * 10, y * 10, 10, 10);
  }
  const tex = new THREE.CanvasTexture(c);
  return new THREE.MeshBasicMaterial({ map: tex });
}

// Flat ribbon along a polyline at ground level.
function ribbonGeometry(pts, width, y) {
  if (pts.length < 2) return null;
  const hw = width / 2;
  const verts = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const px = -dz, pz = dx;
    verts.push(pts[i].x + px * hw, y, pts[i].z + pz * hw);
    verts.push(pts[i].x - px * hw, y, pts[i].z - pz * hw);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function colorGeometry(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

function mergeGeometries(geos) {
  // minimal merge (positions+index+color) to avoid importing BufferGeometryUtils
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    else col.fill(1, vo * 3, (vo + n) * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index ? g.index.array : [...Array(n).keys()];
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += n; io += gi.length;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// Simple spatial hash of building polygons for push-out collision.
class SpatialGrid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
    this.polys = [];
  }
  key(x, z) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }
  addPolygon(pts, h) {
    const id = this.polys.length;
    this.polys.push(pts);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    for (let x = minX; x <= maxX + this.cell; x += this.cell)
      for (let z = minZ; z <= maxZ + this.cell; z += this.cell) {
        const k = this.key(x, z);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(id);
      }
  }
  // If (x,z) is inside a building, return push-out vector; else null.
  resolve(x, z) {
    const ids = this.map.get(this.key(x, z));
    if (!ids) return null;
    for (const id of ids) {
      const poly = this.polys[id];
      if (pointInPoly(x, z, poly)) {
        // push toward nearest edge
        let best = null, bestD = 1e9;
        for (let i = 0; i < poly.length - 1; i++) {
          const r = nearestOnSegment(x, z, poly[i], poly[i + 1]);
          if (r.d < bestD) { bestD = r.d; best = r; }
        }
        if (best) return { x: best.x, z: best.z };
      }
    }
    return null;
  }
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function nearestOnSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  const px = a.x + dx * t, pz = a.z + dz * t;
  return { x: px, z: pz, d: Math.hypot(x - px, z - pz) };
}
