import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const STATE_HZ = 15;

const app = express();
app.get('/api/config', (_req, res) => {
  res.json({ googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null });
});
app.get('/healthz', (_req, res) => res.send('ok'));
app.use(express.static(join(__dirname, '..', 'dist')));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// rooms: id -> { players: Map<id, {ws, name, car, state, progress}>, race }
const rooms = new Map();
let nextId = 1;

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, { players: new Map(), race: { phase: 'free', startAt: 0, results: [] } });
  }
  return rooms.get(id);
}

function broadcast(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const [pid, p] of room.players) {
    if (pid !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}

function publicPlayer(id, p) {
  return { id, name: p.name, car: p.car, state: p.state, progress: p.progress };
}

wss.on('connection', (ws) => {
  let playerId = null;
  let roomId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = roomId ? rooms.get(roomId) : null;

    switch (msg.t) {
      case 'join': {
        roomId = String(msg.room || 'olivos').slice(0, 24).replace(/[^a-zA-Z0-9-]/g, '') || 'olivos';
        playerId = nextId++;
        const r = getRoom(roomId);
        const player = {
          ws,
          name: String(msg.name || 'Piloto').slice(0, 20),
          car: String(msg.car || 'sharan-2006'),
          state: null,
          progress: { cp: 0, lap: 0, finishMs: null },
        };
        r.players.set(playerId, player);
        ws.send(JSON.stringify({
          t: 'welcome',
          id: playerId,
          room: roomId,
          race: r.race,
          players: [...r.players.entries()]
            .filter(([pid]) => pid !== playerId)
            .map(([pid, p]) => publicPlayer(pid, p)),
        }));
        broadcast(r, { t: 'joined', player: publicPlayer(playerId, player) }, playerId);
        break;
      }
      case 's': { // state update: [x,y,z,yaw,steer,speed]
        if (!room || !playerId) return;
        const p = room.players.get(playerId);
        if (p) p.state = msg.d;
        break;
      }
      case 'startRace': {
        if (!room) return;
        if (room.race.phase === 'countdown' || room.race.phase === 'racing') return;
        room.race = { phase: 'countdown', startAt: Date.now() + 4000, results: [] };
        for (const p of room.players.values()) p.progress = { cp: 0, lap: 0, finishMs: null };
        broadcast(room, { t: 'race', race: room.race });
        setTimeout(() => {
          const r = rooms.get(roomId);
          if (r && r.race.phase === 'countdown') {
            r.race.phase = 'racing';
            broadcast(r, { t: 'race', race: r.race });
          }
        }, 4100);
        break;
      }
      case 'progress': { // {cp, lap}
        if (!room || !playerId) return;
        const p = room.players.get(playerId);
        if (p) {
          p.progress.cp = msg.cp | 0;
          p.progress.lap = msg.lap | 0;
          broadcast(room, { t: 'progress', id: playerId, cp: p.progress.cp, lap: p.progress.lap }, playerId);
        }
        break;
      }
      case 'finish': { // {timeMs}
        if (!room || !playerId) return;
        const p = room.players.get(playerId);
        if (p && p.progress.finishMs == null) {
          p.progress.finishMs = msg.timeMs | 0;
          room.race.results.push({ id: playerId, name: p.name, car: p.car, timeMs: p.progress.finishMs });
          room.race.results.sort((a, b) => a.timeMs - b.timeMs);
          broadcast(room, { t: 'race', race: room.race });
          const allDone = [...room.players.values()].every((q) => q.progress.finishMs != null);
          if (allDone) {
            room.race.phase = 'finished';
            broadcast(room, { t: 'race', race: room.race });
          }
        }
        break;
      }
      case 'resetRace': {
        if (!room) return;
        room.race = { phase: 'free', startAt: 0, results: [] };
        broadcast(room, { t: 'race', race: room.race });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomId || !playerId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.delete(playerId);
    broadcast(room, { t: 'left', id: playerId });
    if (room.players.size === 0) rooms.delete(roomId);
  });
});

// state relay tick
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size < 2) continue;
    const payload = [];
    for (const [pid, p] of room.players) {
      if (p.state) payload.push([pid, ...p.state]);
    }
    if (payload.length) broadcast(room, { t: 'states', d: payload, ts: Date.now() });
  }
}, 1000 / STATE_HZ);

httpServer.listen(PORT, () => {
  console.log(`Olivos Racing server on http://localhost:${PORT}`);
});
