import * as THREE from 'three';
import { getCar } from './cars/index.js';

// Arcade car: kinematic bicycle-ish model with lateral grip decay.
// World frame: +X east, +Y up, +Z south. yaw 0 faces +Z, forward = (sin yaw, 0, cos yaw).
export class Car {
  constructor(carId, scene) {
    this.def = getCar(carId);
    this.p = this.def.physics;
    const { group, wheels, wheelRadius } = this.def.build({});
    this.mesh = group;
    this.wheels = wheels;
    this.wheelRadius = wheelRadius;
    scene.add(group);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.steer = 0;
    this.grounded = true;
    this.groundY = 0;
    this.wheelSpin = 0;
    this.frozen = false;
  }

  get speed() {
    return this.vel.length();
  }

  get forwardSpeed() {
    return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
  }

  place(x, z, yaw, groundHeight) {
    this.pos.set(x, groundHeight ? groundHeight(x, z) : 0, z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.updateMesh();
  }

  update(dt, input, groundHeight) {
    const p = this.p;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let fwdSpeed = this.vel.x * fx + this.vel.z * fz;
    const latX = this.vel.x - fx * fwdSpeed;
    const latZ = this.vel.z - fz * fwdSpeed;

    if (this.frozen) input = { throttle: 0, brake: 0, steer: 0, handbrake: false };

    // steering with speed falloff
    const steerTarget = input.steer * THREE.MathUtils.lerp(
      p.steerMax, p.steerHighSpeed, THREE.MathUtils.clamp(Math.abs(fwdSpeed) / p.topSpeed, 0, 1));
    this.steer = THREE.MathUtils.damp(this.steer, steerTarget, p.steerSpeed * 2, dt);
    if (Math.abs(fwdSpeed) > 0.3) {
      const wheelbase = 2.8;
      this.yaw += (fwdSpeed / wheelbase) * Math.tan(this.steer) * dt;
    }

    // longitudinal forces
    let accel = 0;
    if (input.throttle > 0) {
      const headroom = 1 - THREE.MathUtils.clamp(fwdSpeed / p.topSpeed, 0, 1);
      accel += input.throttle * p.accel * (0.35 + 0.65 * headroom);
    }
    if (input.brake > 0) {
      if (fwdSpeed > 0.5) accel -= input.brake * p.brake;
      else accel -= input.brake * p.accel * 0.7 * (1 - THREE.MathUtils.clamp(-fwdSpeed / p.reverseSpeed, 0, 1));
    }
    // drag + rolling resistance
    accel -= fwdSpeed * 0.018 * Math.abs(fwdSpeed) + fwdSpeed * 0.35;
    fwdSpeed += accel * dt;

    // lateral grip
    const grip = input.handbrake ? p.driftGrip : p.grip;
    const decay = Math.exp(-grip * dt);
    const fx2 = Math.sin(this.yaw), fz2 = Math.cos(this.yaw);
    this.vel.set(fx2 * fwdSpeed + latX * decay, 0, fz2 * fwdSpeed + latZ * decay);
    if (input.handbrake && Math.abs(fwdSpeed) > 1) {
      fwdSpeed *= Math.exp(-0.6 * dt);
      this.vel.x = fx2 * fwdSpeed + latX * decay;
      this.vel.z = fz2 * fwdSpeed + latZ * decay;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // ground follow (smoothed so tile LOD pops don't kick the car)
    if (groundHeight) {
      const gy = groundHeight(this.pos.x, this.pos.z, this.groundY);
      if (gy != null) this.groundY = THREE.MathUtils.damp(this.groundY, gy, 12, dt);
    }
    this.pos.y = this.groundY;

    this.wheelSpin += (fwdSpeed / this.wheelRadius) * dt;
    this.updateMesh(dt);
  }

  updateMesh(dt = 0.016) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, 0);
    // body lean
    const latVel = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.mesh.rotation.z = THREE.MathUtils.clamp(latVel * 0.006, -0.05, 0.05);
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      w.rotation.x = this.wheelSpin;
      w.rotation.y = i < 2 ? this.steer : 0; // front wheels steer
    }
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}

// Remote car: interpolates snapshots from the network.
export class RemoteCar {
  constructor(carId, name, scene) {
    this.def = getCar(carId);
    const { group, wheels } = this.def.build({});
    this.mesh = group;
    this.wheels = wheels;
    scene.add(group);
    this.buffer = []; // [renderTime, x, y, z, yaw, steer, speed]
    this.name = name;
    this.label = makeLabel(name);
    this.label.position.y = 2.4;
    group.add(this.label);
  }

  push(snap, ts) {
    this.buffer.push({ ts, d: snap });
    if (this.buffer.length > 40) this.buffer.shift();
  }

  update(now) {
    const t = now - 160; // render in the past for smooth interp
    const b = this.buffer;
    if (!b.length) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].ts > t) i--;
    const a = b[Math.max(0, i - 1)], c = b[i];
    const span = Math.max(1, c.ts - a.ts);
    const f = THREE.MathUtils.clamp((t - a.ts) / span, 0, 1);
    const lerpAngle = (x, y, k) => {
      let d = ((y - x + Math.PI) % (2 * Math.PI)) - Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      return x + d * k;
    };
    this.mesh.position.set(
      THREE.MathUtils.lerp(a.d[0], c.d[0], f),
      THREE.MathUtils.lerp(a.d[1], c.d[1], f),
      THREE.MathUtils.lerp(a.d[2], c.d[2], f));
    this.mesh.rotation.set(0, lerpAngle(a.d[3], c.d[3], f), 0);
    const steer = THREE.MathUtils.lerp(a.d[4], c.d[4], f);
    const speed = THREE.MathUtils.lerp(a.d[5], c.d[5], f);
    for (let i2 = 0; i2 < this.wheels.length; i2++) {
      const w = this.wheels[i2];
      w.rotation.x += (speed / 0.335) * 0.016;
      w.rotation.y = i2 < 2 ? steer : 0;
    }
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(240, ctx.measureText(text).width + 24);
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 8, w, 48, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}
