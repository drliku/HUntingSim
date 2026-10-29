// Minimal zero-dependency server for local play: serves the game files and relays
// PvP survival messages between players over WebSockets.
// Usage: node server.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// online hosts (Render, Railway, Fly.io…) tell the app which port to use through PORT
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- PvP rooms ----------
// code -> { code, seed, host: id, players: Map(id -> { id, name, sock }) }
const rooms = new Map();
let nextId = 1;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/pvp/info') return json(res, 200, { ok: true, port: PORT, lan: lanAddresses(), rooms: rooms.size });
  if (url.pathname === '/pvp/room') {
    const r = rooms.get((url.searchParams.get('code') || '').toUpperCase());
    if (!r) return json(res, 404, { ok: false, error: 'No game with that code. Check the code, and that the host is still in the game.' });
    if (r.players.size >= 6) return json(res, 409, { ok: false, error: 'That game is full (6 players).' });
    return json(res, 200, { ok: true, code: r.code, seed: r.seed, players: r.players.size });
  }
  let urlPath = decodeURIComponent(url.pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- tiny WebSocket implementation (RFC 6455, text frames only) ----------
function wsSend(sock, str) {
  if (sock.destroyed) return;
  const data = Buffer.from(str);
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  sock.write(Buffer.concat([head, data]));
}

function wsParse(sock, onText) {
  let buf = Buffer.alloc(0);
  let frag = [];
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[maskOff + (i & 3)];
      buf = buf.subarray(off + len);
      if (op === 0x8) { sock.end(Buffer.from([0x88, 0])); return; }
      if (op === 0x9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 0x1 || op === 0x0) {
        frag.push(payload);
        if (fin) { const text = Buffer.concat(frag).toString('utf8'); frag = []; onText(text); }
      }
    }
  });
}

server.on('upgrade', (req, sock) => {
  if (!req.url.startsWith('/pvp/ws')) { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const me = { id: nextId++, name: 'Hunter', sock, room: null };

  const broadcast = (room, msg, except) => { const s = JSON.stringify(msg); for (const p of room.players.values()) if (p !== except) wsSend(p.sock, s); };

  wsParse(sock, (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'host' || m.t === 'join') {
      if (me.room) return;
      me.name = String(m.name || 'Hunter').slice(0, 16);
      const code = String(m.code || '').toUpperCase();
      let room = rooms.get(code);
      if (m.t === 'host') {
        if (room) { wsSend(sock, JSON.stringify({ t: 'error', error: 'That game code is already in use. Try hosting again.' })); return; }
        room = { code, seed: m.seed >>> 0, host: me.id, players: new Map() };
        rooms.set(code, room);
      } else if (!room) { wsSend(sock, JSON.stringify({ t: 'error', error: 'The game has ended — the host left.' })); return; }
      else if (room.players.size >= 6) { wsSend(sock, JSON.stringify({ t: 'error', error: 'That game is full.' })); return; }
      me.room = room;
      room.players.set(me.id, me);
      wsSend(sock, JSON.stringify({ t: 'welcome', id: me.id, host: room.host, code: room.code, seed: room.seed, players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name })) }));
      broadcast(room, { t: 'peer-join', id: me.id, name: me.name }, me);
      console.log(`[pvp] ${me.name} ${m.t === 'host' ? 'hosted' : 'joined'} ${room.code} (${room.players.size} players)`);
      return;
    }
    const room = me.room;
    if (!room) return;
    // relay: to one player, to the host, or to everyone else
    m.from = me.id;
    const s = JSON.stringify(m);
    if (typeof m.to === 'number') { const p = room.players.get(m.to); if (p) wsSend(p.sock, s); }
    else if (m.to === 'host') { const p = room.players.get(room.host); if (p && p !== me) wsSend(p.sock, s); }
    else for (const p of room.players.values()) if (p !== me) wsSend(p.sock, s);
  });

  const leave = () => {
    const room = me.room;
    if (!room) return;
    me.room = null;
    room.players.delete(me.id);
    if (room.host === me.id) {
      broadcast(room, { t: 'host-left' });
      rooms.delete(room.code);
      console.log(`[pvp] room ${room.code} closed (host left)`);
    } else broadcast(room, { t: 'peer-left', id: me.id });
  };
  sock.on('close', leave);
  sock.on('error', leave);
  sock.on('end', leave);
});

server.listen(PORT, () => {
  console.log(`Wildwood running at http://localhost:${PORT}`);
  const lan = lanAddresses();
  if (lan.length) console.log(`PvP: friends on your network can join at ${lan.map((a) => `http://${a}:${PORT}`).join('  or  ')}`);
});
