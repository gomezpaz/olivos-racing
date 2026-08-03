// WebSocket client with auto-reconnect.
export class Net {
  constructor() {
    this.handlers = {};
    this.id = null;
    this.connected = false;
    this.sendQueue = [];
  }

  on(type, fn) {
    this.handlers[type] = fn;
    return this;
  }

  connect(room, name, car) {
    this.joinInfo = { room, name, car };
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.host || 'localhost:8080';
    this.ws = new WebSocket(`${proto}://${host}`);
    this.ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'join', room, name, car });
      for (const m of this.sendQueue) this.send(m);
      this.sendQueue = [];
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') this.id = msg.id;
      const h = this.handlers[msg.t];
      if (h) h(msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      if (this.handlers.disconnect) this.handlers.disconnect();
      setTimeout(() => this.connect(this.joinInfo.room, this.joinInfo.name, this.joinInfo.car), 2000);
    };
    this.ws.onerror = () => this.ws.close();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
