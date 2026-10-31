'use strict';

/**
 * game-logic.js
 * Pure Connect Four rules, shared by the server and the automated tests.
 * The board is a 6 x 7 grid. board[0] is the TOP row, board[5] the bottom.
 * A cell is null (empty), 'red' or 'yellow'.
 */

const ROWS = 6;
const COLS = 7;

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

/**
 * Drop a disc into a column. Returns the row it landed in, or -1 if the
 * column is full / invalid (board is left unchanged in that case).
 */
function dropDisc(board, column, player) {
  if (!Number.isInteger(column) || column < 0 || column >= COLS) return -1;
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][column] === null) {
      board[row][column] = player;
      return row;
    }
  }
  return -1;
}

/**
 * If `player` has four in a row anywhere, return the four winning cells
 * as [[row, col], ...]; otherwise return null.
 */
function checkWin(board, player) {
  const directions = [
    [0, 1],  // horizontal
    [1, 0],  // vertical
    [1, 1],  // diagonal down-right
    [1, -1], // diagonal down-left
  ];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of directions) {
        const cells = [[r, c]];
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
          if (board[nr][nc] !== player) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return null;
}

function isBoardFull(board) {
  return board[0].every((cell) => cell !== null);
}

function otherPlayer(player) {
  return player === 'red' ? 'yellow' : 'red';
}

module.exports = { ROWS, COLS, createBoard, dropDisc, checkWin, isBoardFull, otherPlayer };
