// Keyboard input → {throttle, brake, steer, handbrake} + one-shot actions.
export class Input {
  constructor() {
    this.keys = new Set();
    this.actions = {};
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (this.actions[e.code] && !e.repeat) this.actions[e.code]();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  onAction(code, fn) {
    this.actions[code] = fn;
  }

  read() {
    const k = this.keys;
    const fwd = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const back = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const right = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;
    return {
      throttle: fwd,
      brake: back,
      steer: left - right,
      handbrake: k.has('Space'),
    };
  }
}
