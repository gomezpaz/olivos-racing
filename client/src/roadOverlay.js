import * as THREE from 'three';

const WIDTH = 7.6;
const LIFT = 0.18;        // meters above sampled terrain
const RESAMPLE_MS = 8000; // terrain LODs keep refining — refresh heights
const WINDOW = 70;        // path indices around the car to keep draped
const PER_TICK = 28;      // height samples per update call

// Crisp asphalt ribbon draped over the streamed photogrammetry along the
// racing line. Vertex heights follow terrain raycasts, sampled progressively
// around the car and re-sampled as tile LODs refine. Unlit material on
// purpose: the atmosphere pass relights it exactly like the tiles around it.
export class RoadOverlay {
  constructor(scene, trackPts) {
    this.pts = trackPts;
    const n = trackPts.length;
    this.heights = new Float32Array(n).fill(NaN);
    this.sampledAt = new Float32Array(n).fill(-Infinity);

    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const prev = trackPts[(i - 1 + n) % n];
      const next = trackPts[(i + 1) % n];
      let dx = next.x - prev.x, dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const px = -dz, pz = dx;
      pos.set([trackPts[i].x + px * WIDTH / 2, 0, trackPts[i].z + pz * WIDTH / 2], i * 6);
      pos.set([trackPts[i].x - px * WIDTH / 2, 0, trackPts[i].z - pz * WIDTH / 2], i * 6 + 3);
      if (i > 0) s += trackPts[i].distanceTo(trackPts[i - 1]);
      uv.set([0, s / 12], i * 4);
      uv.set([1, s / 12], i * 4 + 2);
      const a = i * 2, b = ((i + 1) % n) * 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);

    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: makeAsphaltTexture(),
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false; // until first heights arrive
    scene.add(this.mesh);
    this.cursor = 0;
  }

  // smoothed road-surface height if (x,z) is on the ribbon, else null
  heightAt(x, z) {
    const n = this.pts.length;
    let ni = 0, nd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (this.pts[i].x - x) ** 2 + (this.pts[i].z - z) ** 2;
      if (d < nd) { nd = d; ni = i; }
    }
    if (nd > (WIDTH / 2 + 1.5) ** 2) return null;
    const y = this.mesh.geometry.attributes.position.array[ni * 6 + 1];
    return this.mesh.visible && !Number.isNaN(this.heights[ni]) ? y - LIFT + 0.05 : null;
  }

  update(carPos, groundHeight, now) {
    const n = this.pts.length;
    // nearest path index to the car
    let ni = 0, nd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (this.pts[i].x - carPos.x) ** 2 + (this.pts[i].z - carPos.z) ** 2;
      if (d < nd) { nd = d; ni = i; }
    }
    // sample heights round-robin inside the window around the car
    let done = 0;
    for (let k = 0; k < 2 * WINDOW && done < PER_TICK; k++) {
      this.cursor = (this.cursor + 1) % (2 * WINDOW);
      const i = (ni + this.cursor - WINDOW + n) % n;
      if (now - this.sampledAt[i] < RESAMPLE_MS) continue;
      const known = this.heights[i];
      const neighbor = this.heights[(i - 1 + n) % n];
      const ref = !Number.isNaN(known) ? known - LIFT : (!Number.isNaN(neighbor) ? neighbor - LIFT : null);
      const gy = groundHeight(this.pts[i].x, this.pts[i].z, ref);
      done++;
      this.sampledAt[i] = now;
      if (gy != null) this.heights[i] = gy + LIFT;
    }

    // write smoothed heights into the strip (interpolate gaps)
    const posAttr = this.mesh.geometry.attributes.position;
    let any = false;
    for (let i = 0; i < n; i++) {
      let h = this.heights[i];
      if (Number.isNaN(h)) {
        const hp = this.heights[(i - 1 + n) % n], hn = this.heights[(i + 1) % n];
        if (!Number.isNaN(hp) && !Number.isNaN(hn)) h = (hp + hn) / 2;
        else if (!Number.isNaN(hp)) h = hp;
        else if (!Number.isNaN(hn)) h = hn;
        else continue;
      }
      const hp = this.heights[(i - 1 + n) % n], hn = this.heights[(i + 1) % n];
      let sm = h, w = 1;
      if (!Number.isNaN(hp)) { sm += hp; w++; }
      if (!Number.isNaN(hn)) { sm += hn; w++; }
      sm /= w;
      posAttr.array[i * 6 + 1] = sm;
      posAttr.array[i * 6 + 4] = sm;
      any = true;
    }
    if (any) {
      posAttr.needsUpdate = true;
      this.mesh.visible = true;
    }
  }
}

function makeAsphaltTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b3c40';
  ctx.fillRect(0, 0, W, H);
  // speckle noise
  for (let i = 0; i < 900; i++) {
    const v = 50 + Math.random() * 30;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }
  // edge lines
  ctx.fillStyle = '#cfcfcb';
  ctx.fillRect(5, 0, 3, H);
  ctx.fillRect(W - 8, 0, 3, H);
  // dashed center line (dash = half the 12m tile)
  ctx.fillStyle = '#d8d8d2';
  ctx.fillRect(W / 2 - 2, 0, 4, H * 0.4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
