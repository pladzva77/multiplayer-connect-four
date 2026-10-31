'use strict';

/**
 * server.js
 * One Node.js process that:
 *   1. Serves the static game client from /public
 *   2. Runs the multiplayer game server over WebSockets (ws)
 *
 * The server is authoritative: clients only send intentions
 * ("drop in column 3") and the server validates the move, updates the
 * board and broadcasts the new state to everyone in the room.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createBoard, dropDisc, checkWin, isBoardFull, otherPlayer } = require('./game-logic');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ------------------------------------------------------------------ */
/* Static file server                                                  */
/* ------------------------------------------------------------------ */

const httpServer = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  // Work with forward slashes on every OS: on Windows, path.normalize('/')
  // returns '\\', which used to break the root -> index.html mapping.
  const relPath = urlPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^(\.\.\/)+/, '');
  let filePath = path.join(PUBLIC_DIR, relPath === '' ? 'index.html' : relPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ------------------------------------------------------------------ */
/* Game rooms                                                          */
/* ------------------------------------------------------------------ */

/** code -> room */
const rooms = new Map();

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no easily-confused chars
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    players: [], // [{ ws, name, color }]
    board: createBoard(),
    turn: 'red',
    starter: 'red',
    winner: null,
    winningCells: null,
    status: 'waiting', // waiting | playing | finished
    scores: { red: 0, yellow: 0 },
  };
  rooms.set(code, room);
  return room;
}

function publicState(room) {
  return {
    code: room.code,
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    winningCells: room.winningCells,
    status: room.status,
    scores: room.scores,
    players: room.players.map((p) => ({ name: p.name, color: p.color })),
  };
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const p of room.players) send(p.ws, message);
}

function broadcastState(room) {
  broadcast(room, { type: 'state', state: publicState(room) });
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 16);
  return n || 'Player';
}

/* ------------------------------------------------------------------ */
/* WebSocket game protocol (JSON messages)                             */
/*                                                                     */
/* Client -> server:                                                   */
/*   { type: 'create',  name }                                         */
/*   { type: 'join',    code, name }                                   */
/*   { type: 'move',    column }                                       */
/*   { type: 'rematch' }                                               */
/*   { type: 'chat',    text }                                         */
/*                                                                     */
/* Server -> client:                                                   */
/*   { type: 'joined', code, color, state }                            */
/*   { type: 'state',  state }                                         */
/*   { type: 'chat',   name, color, text }                             */
/*   { type: 'opponentLeft', name }                                    */
/*   { type: 'error',  message }                                       */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  let room = null;
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid message.' });
      return;
    }

    switch (msg.type) {
      case 'create': {
        if (room) return send(ws, { type: 'error', message: 'You are already in a room.' });
        room = createRoom();
        me = { ws, name: cleanName(msg.name), color: 'red' };
        room.players.push(me);
        send(ws, { type: 'joined', code: room.code, color: me.color, state: publicState(room) });
        break;
      }

      case 'join': {
        if (room) return send(ws, { type: 'error', message: 'You are already in a room.' });
        const target = rooms.get(String(msg.code || '').trim().toUpperCase());
        if (!target) return send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
        if (target.players.length >= 2) return send(ws, { type: 'error', message: 'That room is already full.' });
        room = target;
        me = { ws, name: cleanName(msg.name), color: 'yellow' };
        room.players.push(me);
        room.status = 'playing';
        send(ws, { type: 'joined', code: room.code, color: me.color, state: publicState(room) });
        broadcastState(room);
        break;
      }

      case 'move': {
        if (!room || !me) return send(ws, { type: 'error', message: 'Join a room first.' });
        if (room.status !== 'playing') return send(ws, { type: 'error', message: 'The game is not in progress.' });
        if (room.turn !== me.color) return send(ws, { type: 'error', message: 'It is not your turn.' });
        const row = dropDisc(room.board, msg.column, me.color);
        if (row === -1) return send(ws, { type: 'error', message: 'That column is full.' });

        const win = checkWin(room.board, me.color);
        if (win) {
          room.winner = me.color;
          room.winningCells = win;
          room.status = 'finished';
          room.scores[me.color] += 1;
        } else if (isBoardFull(room.board)) {
          room.winner = 'draw';
          room.status = 'finished';
        } else {
          room.turn = otherPlayer(room.turn);
        }
        broadcastState(room);
        break;
      }

      case 'rematch': {
        if (!room || !me) return;
        if (room.status !== 'finished') return send(ws, { type: 'error', message: 'Finish this game first.' });
        room.board = createBoard();
        room.winner = null;
        room.winningCells = null;
        room.starter = otherPlayer(room.starter); // loser of the coin toss starts next time
        room.turn = room.starter;
        room.status = 'playing';
        broadcastState(room);
        break;
      }

      case 'chat': {
        if (!room || !me) return;
        const text = String(msg.text || '').trim().slice(0, 200);
        if (!text) return;
        broadcast(room, { type: 'chat', name: me.name, color: me.color, text });
        break;
      }

      default:
        send(ws, { type: 'error', message: 'Unknown message type.' });
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    const opponent = room.players.find((p) => p !== me);
    room.players = room.players.filter((p) => p !== me);
    if (opponent) {
      send(opponent.ws, { type: 'opponentLeft', name: me.name });
    }
    rooms.delete(room.code);
    room = null;
    me = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`Connect Four server running at http://localhost:${PORT}`);
});
