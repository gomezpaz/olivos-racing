import * as THREE from 'three';
import { makeCheckpointMarker } from './world.js';

const CP_SPACING = 150; // meters between checkpoints
const CP_RADIUS = 16;

export class Track {
  constructor(trackData, proj, scene) {
    this.data = trackData;
    this.laps = trackData.laps;
    this.pts = trackData.path.map(([la, lo]) => {
      const w = proj.toWorld(la, lo);
      return new THREE.Vector3(w.x, 0, w.z);
    });

    // checkpoints every ~CP_SPACING along the loop, cp0 = start/finish
    this.checkpoints = [];
    let acc = 0;
    for (let i = 0; i < this.pts.length; i++) {
      const prev = this.pts[(i - 1 + this.pts.length) % this.pts.length];
      acc += prev.distanceTo(this.pts[i]);
      if (i === 0 || acc >= CP_SPACING) {
        acc = 0;
        const next = this.pts[(i + 1) % this.pts.length];
        this.checkpoints.push({
          pos: this.pts[i].clone(),
          yaw: Math.atan2(next.x - this.pts[i].x, next.z - this.pts[i].z),
        });
      }
    }

    this.marker = makeCheckpointMarker(scene);
    this.groundY = 0; // terrain height at markers (photorealistic mode)
    this.nextCp = 0;
    this.lap = 0;
    this.raceStart = 0;
    this.finished = false;
    this.updateMarker();
  }

  spawnPose(gridIndex) {
    // grid behind the start line, 2 columns
    const cp = this.checkpoints[0];
    const back = new THREE.Vector3(-Math.sin(cp.yaw), 0, -Math.cos(cp.yaw));
    const side = new THREE.Vector3(back.z, 0, -back.x);
    const row = Math.floor(gridIndex / 2), col = gridIndex % 2 ? 1 : -1;
    const p = cp.pos.clone()
      .addScaledVector(back, 12 + row * 8)
      .addScaledVector(side, col * 3.2);
    return { x: p.x, z: p.z, yaw: cp.yaw };
  }

  resetRace(now) {
    this.nextCp = 1;
    this.lap = 1;
    this.raceStart = now;
    this.finished = false;
    this.updateMarker();
  }

  // returns event: null | 'checkpoint' | 'lap' | 'finish'
  update(carPos, racing, now) {
    if (!racing || this.finished) return null;
    const cp = this.checkpoints[this.nextCp % this.checkpoints.length];
    const dx = carPos.x - cp.pos.x, dz = carPos.z - cp.pos.z;
    if (dx * dx + dz * dz < CP_RADIUS * CP_RADIUS) {
      this.nextCp++;
      if (this.nextCp % this.checkpoints.length === 1 && this.nextCp > 1) {
        // crossed start/finish (cp index wrapped past 0)
      }
      if ((this.nextCp - 1) % this.checkpoints.length === 0) {
        if (this.lap >= this.laps) {
          this.finished = true;
          this.timeMs = now - this.raceStart;
          return 'finish';
        }
        this.lap++;
        this.updateMarker();
        return 'lap';
      }
      this.updateMarker();
      return 'checkpoint';
    }
    return null;
  }

  updateMarker() {
    const cp = this.checkpoints[this.nextCp % this.checkpoints.length];
    this.marker.position.set(cp.pos.x, this.groundY, cp.pos.z);
  }

  nearestCheckpoint(carPos) {
    const idx = (this.nextCp - 1 + this.checkpoints.length) % this.checkpoints.length;
    return this.checkpoints[idx];
  }

  progressScalar() {
    return this.lap * 10000 + this.nextCp;
  }
}
