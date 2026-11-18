import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { buildTrack, pointAt, itemBoxes, gridSlot, LAPS, MAX_RACERS, POINTS } from './shared/track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TICK = 50; // ms (20 Hz)

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/three/build')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const track = buildTrack();
const BOXES = itemBoxes(track);
const rooms = new Map();
const BOT_NAMES = ['Rusty', 'Nitro Nell', 'Gizmo', 'Turbo Ted', 'Pixel', 'Duchess', 'Sprocket', 'Blaze'];
const BOT_COLORS = ['#7a7a7a', '#5b3fa8', '#2d6e3a', '#8a4b1f', '#24577a', '#8c2a52', '#555f2b', '#3a3a6e'];

let nextId = 1;
const rnd = (a, b) => a + Math.random() * (b - a);
const r2 = (v) => Math.round(v * 100) / 100;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.state = 'lobby';
    this.mode = 'coop';
    this.fillBots = true;
    this.bots = [];
    this.missiles = [];
    this.hazards = [];
    this.boxes = BOXES.map(() => 0);
    this.goAt = 0;
    this.firstHumanFinish = 0;
    this.results = null;
    this.timer = setInterval(() => this.tick(), TICK);
  }
  broadcast(msg) { const s = JSON.stringify(msg); for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s); }
  lobbyMsg() {
    return {
      t: 'lobby', code: this.code, hostId: this.hostId, state: this.state, mode: this.mode, fillBots: this.fillBots,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, inRace: p.inRace })),
    };
  }
  sendLobby() { this.broadcast(this.lobbyMsg()); }
  teamOf(r) { return this.mode === 'coop' ? (r.bot ? 'rivals' : 'players') : r.id; }
  racers() { return [...[...this.players.values()].filter((p) => p.inRace), ...this.bots]; }
  findRacer(id) { return this.players.get(id)?.inRace ? this.players.get(id) : this.bots.find((b) => b.id === id); }

  add(p) {
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    send(p.ws, { t: 'welcome', id: p.id, code: this.code });
    this.sendLobby();
    if (this.state === 'racing' && this.raceInfo) send(p.ws, { ...this.raceInfo, goIn: Math.max(0, this.goAt - Date.now()), late: true });
    if (this.state === 'results' && this.results) send(p.ws, this.results);
  }
  remove(id) {
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.players.keys().next().value || null;
    if (this.players.size === 0) { clearInterval(this.timer); rooms.delete(this.code); return; }
    this.sendLobby();
    if (this.state !== 'lobby' && this.state !== 'results' && ![...this.players.values()].some((p) => p.inRace)) this.endRace();
  }

  startRace() {
    if (this.state !== 'lobby' && this.state !== 'results') return;
    const humans = [...this.players.values()].slice(0, MAX_RACERS);
    let slot = 0;
    for (const p of this.players.values()) { p.inRace = false; }
    for (const p of humans) {
      const g = gridSlot(track, slot);
      Object.assign(p, { inRace: true, slot, x: g.x, z: g.z, h: g.h, s: 0, progress: g.dist, f: 0, finished: false, finishTime: 0 });
      slot++;
    }
    this.bots = [];
    if (this.fillBots) {
      const nBots = MAX_RACERS - humans.length;
      for (let i = 0; i < nBots; i++) {
        const g = gridSlot(track, slot);
        this.bots.push({
          id: 'b' + i, bot: true, name: BOT_NAMES[i], color: BOT_COLORS[i], slot,
          dist: g.dist, lat: g.lat, latBias: g.lat * 0.4, latPhase: rnd(0, 6), wobble: rnd(0.3, 0.7),
          x: g.x, z: g.z, h: g.h, s: 0, top: rnd(29.5, 32.5), spin: 0, boost: 0, shield: 0,
          item: null, itemAt: 0, finished: false, finishTime: 0, progress: g.dist,
        });
        slot++;
      }
    }
    this.missiles = []; this.hazards = []; this.boxes = BOXES.map(() => 0);
    this.firstHumanFinish = 0; this.results = null;
    this.goAt = Date.now() + 4000;
    this.state = 'racing';
    this.raceInfo = {
      t: 'start', mode: this.mode, laps: LAPS,
      racers: this.racers().map((r) => ({ id: r.id, name: r.name, color: r.color, bot: !!r.bot, slot: r.slot, team: this.teamOf(r) })),
    };
    this.broadcast({ ...this.raceInfo, goIn: 4000 });
    this.sendLobby();
  }

  rank() {
    const rs = this.racers();
    rs.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    rs.forEach((r, i) => (r.place = i + 1));
    return rs;
  }

  spin(r) {
    if (r.bot) {
      if (r.shield > 0) return;
      r.spin = 1.4; r.s *= 0.25;
    } else {
      this.broadcast({ t: 'hit', id: r.id });
    }
  }

  useItem(owner, kind) {
    const team = this.teamOf(owner);
    if (kind === 'oil') {
      const x = owner.x - Math.sin(owner.h) * 4, z = owner.z - Math.cos(owner.h) * 4;
      this.hazards.push({ id: nextId++, x, z, team, ttl: 30 });
      if (this.hazards.length > 30) this.hazards.shift();
    } else if (kind === 'missile') {
      const ahead = this.racers()
        .filter((r) => r !== owner && this.teamOf(r) !== team && r.progress > owner.progress && !r.finished)
        .sort((a, b) => a.progress - b.progress)[0];
      this.missiles.push({ id: nextId++, owner: owner.id, team, target: ahead?.id || null, dist: owner.progress + 3, lat: owner.lat || 0, x: owner.x, z: owner.z, ttl: ahead ? 12 : 4, homing: false });
    }
  }

  updateBots(dt, now) {
    const humans = [...this.players.values()].filter((p) => p.inRace);
    const humanBest = humans.length ? Math.max(...humans.map((p) => p.progress)) : null;
    for (const b of this.bots) {
      if (now < this.goAt) continue;
      b.boost = Math.max(0, b.boost - dt);
      b.shield = Math.max(0, b.shield - dt);
      if (b.spin > 0) {
        b.spin -= dt; b.s *= Math.pow(0.15, dt);
      } else {
        let rubber = 1;
        if (humanBest !== null) {
          const diff = b.progress - humanBest;
          if (diff > 90) rubber = 0.86; else if (diff > 40) rubber = 0.94; else if (diff < -150) rubber = 1.14; else if (diff < -60) rubber = 1.07;
        }
        let target = b.top * rubber;
        if (b.boost > 0) target *= 1.45;
        if (b.shield > 0) target *= 1.15;
        b.s += (target - b.s) * Math.min(1, dt * (b.boost > 0 ? 3 : 0.9));
      }
      b.dist += b.s * dt;
      b.latPhase += dt * b.wobble;
      b.lat = Math.sin(b.latPhase) * 5.5 + b.latBias;
      const p = pointAt(track, b.dist, b.lat);
      b.x = p.x; b.z = p.z; b.h = p.h + Math.cos(b.latPhase) * 0.12;
      b.progress = b.dist;
      // item boxes
      if (!b.item) {
        BOXES.forEach((bx, i) => {
          if (this.boxes[i] < now && (bx.x - b.x) ** 2 + (bx.z - b.z) ** 2 < 9) {
            this.boxes[i] = now + 4000;
            b.item = ['turbo', 'oil', 'missile', 'shield', 'oil', 'turbo'][Math.floor(Math.random() * 6)];
            b.itemAt = now + rnd(1500, 5000);
          }
        });
      } else if (now > b.itemAt && b.spin <= 0) {
        if (b.item === 'turbo') b.boost = 1.3;
        else if (b.item === 'shield') b.shield = 6;
        else this.useItem(b, b.item);
        b.item = null;
      }
      // hazards
      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const hz = this.hazards[i];
        if (hz.team !== this.teamOf(b) && (hz.x - b.x) ** 2 + (hz.z - b.z) ** 2 < 6) {
          this.hazards.splice(i, 1);
          this.spin(b);
        }
      }
      if (!b.finished && b.dist >= LAPS * track.length) { b.finished = true; b.finishTime = now - this.goAt; }
    }
  }

  updateMissiles(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.ttl -= dt;
      const tgt = m.target ? this.findRacer(m.target) : null;
      if (m.ttl <= 0 || (m.target && !tgt)) { this.missiles.splice(i, 1); continue; }
      if (tgt && (m.homing || tgt.progress - m.dist < 14)) {
        m.homing = true;
        const dx = tgt.x - m.x, dz = tgt.z - m.z, d = Math.hypot(dx, dz);
        const step = 85 * dt;
        if (d < 2.6 || d < step) { this.missiles.splice(i, 1); this.spin(tgt); continue; }
        m.x += (dx / d) * step; m.z += (dz / d) * step;
        m.dist = tgt.progress - d;
      } else {
        m.dist += 78 * dt;
        if (tgt) m.lat += ((tgt.lat ?? 0) - m.lat) * Math.min(1, dt * 2);
        const p = pointAt(track, m.dist, m.lat);
        m.x = p.x; m.z = p.z;
      }
    }
  }

  tick() {
    if (this.state !== 'racing') return;
    const now = Date.now();
    const dt = TICK / 1000;
    this.updateBots(dt, now);
    this.updateMissiles(dt);
    for (let i = this.hazards.length - 1; i >= 0; i--) if ((this.hazards[i].ttl -= dt) <= 0) this.hazards.splice(i, 1);

    const ranked = this.rank();
    // end conditions
    const humans = ranked.filter((r) => !r.bot);
    if (humans.length && humans.every((h) => h.finished)) return this.endRace();
    if (this.firstHumanFinish && now - this.firstHumanFinish > 30000) return this.endRace();

    let boxBits = '';
    for (const t of this.boxes) boxBits += t < now ? '1' : '0';
    this.broadcast({
      t: 's',
      r: ranked.map((r) => [r.id, r2(r.x), r2(r.z), r2(r.h), r2(r.s), r.bot ? (r.spin > 0 ? 1 : 0) | (r.shield > 0 ? 2 : 0) | (r.boost > 0 ? 4 : 0) : r.f || 0, r.place, r2(r.progress), r.finished ? 1 : 0]),
      m: this.missiles.map((m) => [m.id, r2(m.x), r2(m.z)]),
      hz: this.hazards.map((h) => [h.id, r2(h.x), r2(h.z), h.team]),
      b: boxBits,
    });
  }

  endRace() {
    if (this.state !== 'racing') return;
    const ranked = this.rank();
    const list = ranked.map((r, i) => ({
      id: r.id, name: r.name, color: r.color, bot: !!r.bot, team: this.teamOf(r),
      time: r.finished ? r.finishTime : null, points: POINTS[i] || 0,
    }));
    const teams = {};
    for (const r of list) teams[r.team] = (teams[r.team] || 0) + r.points;
    this.state = 'results';
    this.results = { t: 'results', mode: this.mode, list, teams };
    this.broadcast(this.results);
    for (const p of this.players.values()) p.inRace = false;
    this.sendLobby();
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  let room = null, me = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === 'join') {
      if (room) return;
      let code = String(msg.code || '').toUpperCase().slice(0, 4);
      if (code && !rooms.has(code)) return send(ws, { t: 'error', msg: `Room ${code} not found` });
      if (!code) { code = makeCode(); rooms.set(code, new Room(code)); }
      room = rooms.get(code);
      if (room.players.size >= MAX_RACERS) { room = null; return send(ws, { t: 'error', msg: 'Room is full (8 max)' }); }
      me = {
        id: 'p' + nextId++, ws, name: String(msg.name || 'Racer').slice(0, 14) || 'Racer',
        color: /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : '#e33', inRace: false,
        x: 0, z: 0, h: 0, s: 0, progress: -100, f: 0, finished: false, finishTime: 0, lat: 0,
      };
      room.add(me);
      return;
    }
    if (!room || !me) return;
    switch (msg.t) {
      case 'u':
        if (!me.inRace) return;
        me.x = +msg.x || 0; me.z = +msg.z || 0; me.h = +msg.h || 0; me.s = +msg.s || 0;
        me.progress = +msg.p || 0; me.f = msg.f | 0; me.lat = +msg.lat || 0;
        break;
      case 'start':
        if (me.id === room.hostId) room.startRace();
        break;
      case 'settings':
        if (me.id !== room.hostId || room.state === 'racing') return;
        if (msg.mode === 'coop' || msg.mode === 'versus') room.mode = msg.mode;
        if (typeof msg.fillBots === 'boolean') room.fillBots = msg.fillBots;
        room.sendLobby();
        break;
      case 'lobby':
        if (me.id === room.hostId && room.state === 'results') { room.state = 'lobby'; room.sendLobby(); }
        break;
      case 'box': {
        const i = msg.i | 0;
        if (room.boxes[i] !== undefined) room.boxes[i] = Date.now() + 4000;
        break;
      }
      case 'item':
        if (me.inRace && room.state === 'racing' && (msg.kind === 'oil' || msg.kind === 'missile')) room.useItem(me, msg.kind);
        break;
      case 'hz': {
        const i = room.hazards.findIndex((h) => h.id === msg.id);
        if (i >= 0) room.hazards.splice(i, 1);
        break;
      }
      case 'fin':
        if (me.inRace && !me.finished && room.state === 'racing') {
          me.finished = true; me.finishTime = Math.max(0, Date.now() - room.goAt);
          if (!room.firstHumanFinish) room.firstHumanFinish = Date.now();
        }
        break;
      case 'chat':
        room.broadcast({ t: 'chat', name: me.name, color: me.color, text: String(msg.text || '').slice(0, 120) });
        break;
    }
  });

  ws.on('close', () => { if (room && me) room.remove(me.id); });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Kart Krew server running on :${PORT}`));
