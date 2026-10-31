'use strict';

/**
 * test/test-game.js
 * Automated tests, run with:  npm test
 *
 * Part 1 — unit tests for the pure game rules (game-logic.js).
 * Part 2 — integration test: starts the real server, connects two
 *          WebSocket clients, and plays a full game to a win.
 */

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { createBoard, dropDisc, checkWin, isBoardFull } = require('../game-logic');

/* ---------------- Part 1: unit tests ---------------- */

function unitTests() {
  // Discs fall to the bottom of the column.
  let board = createBoard();
  assert.strictEqual(dropDisc(board, 3, 'red'), 5);
  assert.strictEqual(dropDisc(board, 3, 'yellow'), 4);
  assert.strictEqual(board[5][3], 'red');
  assert.strictEqual(board[4][3], 'yellow');

  // A full column rejects further discs.
  board = createBoard();
  for (let i = 0; i < 6; i++) dropDisc(board, 0, i % 2 ? 'yellow' : 'red');
  assert.strictEqual(dropDisc(board, 0, 'red'), -1);

  // Invalid columns are rejected.
  assert.strictEqual(dropDisc(board, -1, 'red'), -1);
  assert.strictEqual(dropDisc(board, 7, 'red'), -1);

  // Vertical win.
  board = createBoard();
  for (let i = 0; i < 4; i++) dropDisc(board, 2, 'red');
  assert.strictEqual(checkWin(board, 'red').length, 4);
  assert.strictEqual(checkWin(board, 'yellow'), null);

  // Horizontal win.
  board = createBoard();
  for (let c = 1; c <= 4; c++) dropDisc(board, c, 'yellow');
  assert.strictEqual(checkWin(board, 'yellow').length, 4);

  // Diagonal win: build a staircase for red.
  board = createBoard();
  dropDisc(board, 0, 'red');
  dropDisc(board, 1, 'yellow'); dropDisc(board, 1, 'red');
  dropDisc(board, 2, 'yellow'); dropDisc(board, 2, 'yellow'); dropDisc(board, 2, 'red');
  dropDisc(board, 3, 'yellow'); dropDisc(board, 3, 'yellow'); dropDisc(board, 3, 'yellow'); dropDisc(board, 3, 'red');
  assert.strictEqual(checkWin(board, 'red').length, 4);

  // Full-board detection.
  board = createBoard();
  assert.strictEqual(isBoardFull(board), false);
  for (let c = 0; c < 7; c++) for (let i = 0; i < 6; i++) dropDisc(board, c, 'red');
  assert.strictEqual(isBoardFull(board), true);

  console.log('✔ Unit tests passed');
}

/* ---------------- Part 2: integration test ---------------- */

const PORT = 3456;

function wsClient() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const idx = waiters.findIndex((w) => w.type === msg.type);
    if (idx >= 0) waiters.splice(idx, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  const opened = new Promise((res) => ws.addEventListener('open', res, { once: true }));
  return {
    ws,
    opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    waitFor(type, timeoutMs = 3000) {
      const idx = queue.findIndex((m) => m.type === type);
      if (idx >= 0) return Promise.resolve(queue.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${type}"`)), timeoutMs);
        waiters.push({ type, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    close: () => ws.close(),
  };
}

async function integrationTest() {
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });
  try {
    await new Promise((res) => setTimeout(res, 800)); // let it start

    const p1 = wsClient();
    const p2 = wsClient();
    await Promise.all([p1.opened, p2.opened]);

    // Player 1 creates a room.
    p1.send({ type: 'create', name: 'Alice' });
    const joined1 = await p1.waitFor('joined');
    assert.strictEqual(joined1.color, 'red');
    assert.strictEqual(joined1.state.status, 'waiting');
    const code = joined1.code;
    assert.strictEqual(code.length, 4);

    // Player 2 joins with the code; game starts.
    p2.send({ type: 'join', code, name: 'Bob' });
    const joined2 = await p2.waitFor('joined');
    assert.strictEqual(joined2.color, 'yellow');
    assert.strictEqual(joined2.state.status, 'playing');

    // Joining also broadcasts a state update to both clients; drain those
    // so the per-move waits below stay in step with the moves.
    await p1.waitFor('state');
    await p2.waitFor('state');

    // Out-of-turn move is rejected.
    p2.send({ type: 'move', column: 1 });
    const err = await p2.waitFor('error');
    assert.match(err.message, /not your turn/i);

    // Play a game: Alice stacks four in column 0, Bob plays column 1.
    const moves = [
      [p1, 0], [p2, 1], [p1, 0], [p2, 1], [p1, 0], [p2, 1], [p1, 0],
    ];
    let lastState = null;
    for (const [player, column] of moves) {
      player.send({ type: 'move', column });
      // Both clients receive a state broadcast; drain one from each.
      lastState = (await p1.waitFor('state')).state;
      await p2.waitFor('state');
    }
    assert.strictEqual(lastState.status, 'finished');
    assert.strictEqual(lastState.winner, 'red');
    assert.strictEqual(lastState.scores.red, 1);
    assert.strictEqual(lastState.winningCells.length, 4);

    // Chat reaches the other player.
    p1.send({ type: 'chat', text: 'Good game!' });
    const chat = await p2.waitFor('chat');
    assert.strictEqual(chat.text, 'Good game!');
    assert.strictEqual(chat.name, 'Alice');
    await p1.waitFor('chat'); // sender also receives the broadcast

    // Rematch resets the board but keeps the score.
    p2.send({ type: 'rematch' });
    const rematchState = (await p1.waitFor('state')).state;
    assert.strictEqual(rematchState.status, 'playing');
    assert.strictEqual(rematchState.scores.red, 1);
    assert.ok(rematchState.board.every((row) => row.every((cell) => cell === null)));

    // Leaving notifies the opponent.
    p2.close();
    const left = await p1.waitFor('opponentLeft');
    assert.strictEqual(left.name, 'Bob');

    p1.close();
    console.log('✔ Integration test passed (create, join, invalid move, full game, chat, rematch, leave)');
  } finally {
    server.kill();
  }
}

(async () => {
  unitTests();
  await integrationTest();
  console.log('\nAll tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error('\n✘ TEST FAILURE:', err.message);
  process.exit(1);
});
