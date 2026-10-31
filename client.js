'use strict';

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const lobbyEl = $('lobby');
const gameEl = $('game');
const boardEl = $('board');
const statusEl = $('status');
const playersEl = $('players');
const roomInfoEl = $('roomInfo');
const lobbyErrorEl = $('lobbyError');
const rematchBtn = $('rematchBtn');
const chatBoxEl = $('chatBox');
const chatMessagesEl = $('chatMessages');
const chatInputEl = $('chatInput');

const ROWS = 6;
const COLS = 7;

/* ------------------------------------------------------------------ */
/* Shared board rendering                                              */
/* ------------------------------------------------------------------ */

let prevBoard = null;

function renderBoard(board, winningCells, onColumnClick) {
  const winSet = new Set((winningCells || []).map(([r, c]) => r + ',' + c));
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const value = board[r][c];
      if (value) {
        const disc = document.createElement('div');
        disc.className = 'disc ' + value;
        if (winSet.has(r + ',' + c)) disc.classList.add('win');
        // Animate only the disc that just appeared.
        if (prevBoard && prevBoard[r][c] === null) disc.classList.add('drop');
        cell.appendChild(disc);
      }
      cell.addEventListener('click', () => onColumnClick(c));
      boardEl.appendChild(cell);
    }
  }
  prevBoard = board.map((row) => row.slice());
}

function renderPlayers(players, scores, turn, status) {
  playersEl.innerHTML = '';
  for (const p of players) {
    const chip = document.createElement('div');
    chip.className = 'playerChip' + (status === 'playing' && turn === p.color ? ' turn' : '');
    const dot = p.color === 'red' ? '🔴' : '🟡';
    chip.innerHTML = `<span class="dot">${dot}</span> ${escapeHtml(p.name)}` +
      `<span class="score">Wins: ${scores[p.color] || 0}</span>`;
    playersEl.appendChild(chip);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function showGame() {
  lobbyEl.hidden = true;
  gameEl.hidden = false;
}

function showLobby(errorMsg) {
  gameEl.hidden = true;
  lobbyEl.hidden = false;
  prevBoard = null;
  if (errorMsg) {
    lobbyErrorEl.textContent = errorMsg;
    lobbyErrorEl.hidden = false;
  } else {
    lobbyErrorEl.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Online mode (WebSocket, server-authoritative)                       */
/* ------------------------------------------------------------------ */

let ws = null;
let myColor = null;
let onlineState = null;

function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'joined':
        myColor = msg.color;
        onlineState = msg.state;
        enterOnlineGame();
        break;
      case 'state':
        onlineState = msg.state;
        renderOnline();
        break;
      case 'chat':
        addChat(msg.name, msg.color, msg.text);
        break;
      case 'opponentLeft':
        alert(`${msg.name} left the game.`);
        cleanupOnline();
        showLobby();
        break;
      case 'error':
        if (!gameEl.hidden && onlineState) {
          statusEl.textContent = '⚠️ ' + msg.message;
        } else {
          showLobby(msg.message);
        }
        break;
    }
  });
  ws.addEventListener('close', () => {
    if (!gameEl.hidden && mode === 'online') {
      statusEl.textContent = 'Connection to the server was lost.';
    }
  });
}

function cleanupOnline() {
  if (ws) { try { ws.close(); } catch { /* already closed */ } }
  ws = null;
  myColor = null;
  onlineState = null;
  chatMessagesEl.innerHTML = '';
}

function enterOnlineGame() {
  showGame();
  chatBoxEl.hidden = false;
  renderOnline();
}

function renderOnline() {
  if (!onlineState) return;
  const s = onlineState;
  roomInfoEl.innerHTML = `Room code: <strong>${s.code}</strong> — you are ${myColor === 'red' ? '🔴 Red' : '🟡 Yellow'}`;

  const players = s.players.slice();
  while (players.length < 2) players.push({ name: 'Waiting for opponent…', color: players.length === 0 ? 'red' : 'yellow' });
  renderPlayers(players, s.scores, s.turn, s.status);

  if (s.status === 'waiting') {
    statusEl.textContent = `Share room code ${s.code} with your friend so they can join.`;
  } else if (s.status === 'playing') {
    const current = s.players.find((p) => p.color === s.turn);
    statusEl.textContent = s.turn === myColor
      ? 'Your turn — tap a column.'
      : `${current ? current.name : 'Opponent'}'s turn…`;
  } else if (s.status === 'finished') {
    if (s.winner === 'draw') {
      statusEl.textContent = "It's a draw! 🤝";
    } else {
      const winner = s.players.find((p) => p.color === s.winner);
      statusEl.textContent = s.winner === myColor
        ? '🎉 You win!'
        : `${winner ? winner.name : 'Opponent'} wins!`;
    }
  }
  rematchBtn.hidden = s.status !== 'finished';
  renderBoard(s.board, s.winningCells, (col) => {
    if (ws && onlineState.status === 'playing' && onlineState.turn === myColor) {
      ws.send(JSON.stringify({ type: 'move', column: col }));
    }
  });
}

function addChat(name, color, text) {
  const p = document.createElement('p');
  const dot = color === 'red' ? '🔴' : '🟡';
  p.innerHTML = `<span class="who">${dot} ${escapeHtml(name)}:</span> ${escapeHtml(text)}`;
  chatMessagesEl.appendChild(p);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* Local mode (two players, one device)                                */
/* ------------------------------------------------------------------ */

const local = {
  board: null, turn: 'red', winner: null, winningCells: null,
  scores: { red: 0, yellow: 0 }, finished: false,
  names: { red: 'Red', yellow: 'Yellow' },
};

function localDrop(board, column, player) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][column] === null) { board[r][column] = player; return r; }
  }
  return -1;
}

function localWin(board, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (board[r][c] !== player) continue;
    for (const [dr, dc] of dirs) {
      const cells = [[r, c]];
      for (let i = 1; i < 4; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== player) break;
        cells.push([nr, nc]);
      }
      if (cells.length === 4) return cells;
    }
  }
  return null;
}

function startLocal() {
  mode = 'local';
  local.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  local.turn = 'red';
  local.winner = null;
  local.winningCells = null;
  local.finished = false;
  prevBoard = null;
  showGame();
  chatBoxEl.hidden = true;
  roomInfoEl.textContent = 'Local 2-player game';
  renderLocal();
}

function renderLocal() {
  renderPlayers(
    [{ name: local.names.red, color: 'red' }, { name: local.names.yellow, color: 'yellow' }],
    local.scores, local.turn, local.finished ? 'finished' : 'playing'
  );
  if (local.finished) {
    statusEl.textContent = local.winner === 'draw'
      ? "It's a draw! 🤝"
      : `${local.winner === 'red' ? '🔴 Red' : '🟡 Yellow'} wins! 🎉`;
  } else {
    statusEl.textContent = `${local.turn === 'red' ? '🔴 Red' : '🟡 Yellow'}'s turn — tap a column.`;
  }
  rematchBtn.hidden = !local.finished;
  renderBoard(local.board, local.winningCells, (col) => {
    if (local.finished) return;
    if (localDrop(local.board, col, local.turn) === -1) return;
    const win = localWin(local.board, local.turn);
    if (win) {
      local.winner = local.turn;
      local.winningCells = win;
      local.scores[local.turn] += 1;
      local.finished = true;
    } else if (local.board[0].every((cell) => cell !== null)) {
      local.winner = 'draw';
      local.finished = true;
    } else {
      local.turn = local.turn === 'red' ? 'yellow' : 'red';
    }
    renderLocal();
  });
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

let mode = null;

$('createBtn').addEventListener('click', () => {
  mode = 'online';
  cleanupOnline();
  connect(() => ws.send(JSON.stringify({ type: 'create', name: $('nameInput').value })));
});

$('joinBtn').addEventListener('click', () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) { showLobby('Enter the 4-letter room code.'); return; }
  mode = 'online';
  cleanupOnline();
  connect(() => ws.send(JSON.stringify({ type: 'join', code, name: $('nameInput').value })));
});

$('localBtn').addEventListener('click', startLocal);

$('leaveBtn').addEventListener('click', () => {
  cleanupOnline();
  mode = null;
  showLobby();
});

rematchBtn.addEventListener('click', () => {
  if (mode === 'online' && ws) {
    ws.send(JSON.stringify({ type: 'rematch' }));
  } else if (mode === 'local') {
    local.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    local.turn = local.winner === 'red' ? 'yellow' : 'red'; // previous loser starts
    local.winner = null;
    local.winningCells = null;
    local.finished = false;
    prevBoard = null;
    renderLocal();
  }
});

$('chatSend').addEventListener('click', sendChat);
chatInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const text = chatInputEl.value.trim();
  if (!text || !ws) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  chatInputEl.value = '';
}
