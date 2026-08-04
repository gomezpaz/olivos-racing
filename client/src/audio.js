// Procedural engine/wind/skid audio — no samples needed.
// Gear ratios fake a 5-speed: RPM rises within a gear band as speed climbs.
export class CarAudio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('muted') === '1';
  }

  // must be called from a user gesture
  start() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    // engine: two detuned saws through a lowpass
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.engineGain.connect(lp).connect(this.master);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    this.osc1.connect(this.engineGain);
    this.osc2.connect(g2).connect(this.engineGain);
    this.osc1.start();
    this.osc2.start();

    // shared noise buffer for wind + skid
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const makeNoise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      if (q) filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      return gain;
    };
    this.windGain = makeNoise('lowpass', 600);
    this.skidGain = makeNoise('bandpass', 1500, 4);
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  update(speed, throttle, handbrake, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // fake gearbox: rpm fraction 0..1 within current gear
    const gears = [8, 15, 24, 35, 52];
    let lo = 0, frac = 1;
    for (const top of gears) {
      if (speed < top) { frac = (speed - lo) / (top - lo); break; }
      lo = top;
    }
    const rpm = 900 + Math.max(0, frac) * 2600 + throttle * 350;
    const f = rpm / 60 * 2; // firing frequency-ish
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 1.5 + 3, t, 0.05);
    const load = 0.05 + throttle * 0.1 + Math.min(speed / 52, 1) * 0.04;
    this.engineGain.gain.setTargetAtTime(load, t, 0.08);
    this.windGain.gain.setTargetAtTime(Math.min(speed / 52, 1) ** 2 * 0.14, t, 0.15);
    const skidding = handbrake && speed > 6;
    this.skidGain.gain.setTargetAtTime(skidding ? 0.12 : 0, t, skidding ? 0.03 : 0.1);
  }
}
