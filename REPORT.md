# Project Report — Online Multiplayer Connect Four

**Student name:** [Your name]
**Course / class:** [Course name]
**Date:** 31 October 2026
**Project title:** Online Multiplayer Connect Four

---

## 1. Introduction and aim

The aim of this project was to design and build a working **multiplayer
game** in which two people on different browsers (or different devices on
the same network) can play against each other in real time. The game
chosen is Connect Four: its rules are simple to explain, but implementing
it over a network requires the key skills this project set out to
demonstrate — a client–server architecture, real-time communication,
shared state management, input validation, and testing.

## 2. Requirements

### Functional requirements

1. A player can create a game room and receive a code to share.
2. A second player can join the room using the code.
3. Players take turns dropping discs; the first to connect four wins.
4. The system enforces the rules: turn order, legal columns, win and
   draw detection.
5. Scores are kept across rematches within a room.
6. Players can exchange chat messages during the game.
7. If a player disconnects, the opponent is informed.
8. A local two-player mode on one device is available as a fallback.

### Non-functional requirements

- Runs in any modern browser with no plug-ins.
- Minimal dependencies (a single npm package) so it is easy to set up
  and mark.
- Clear separation between game rules, server, and presentation so each
  part can be understood and tested independently.

## 3. Design

### 3.1 Architecture

The game uses a **client–server model**:

- **Server (`server.js`)** — a Node.js program that serves the web page
  and runs the game. It owns the authoritative copy of every room's
  state. Clients send only *intentions* (for example "drop in column
  3"); the server validates them against the rules and broadcasts the
  resulting state to both players.
- **Client (`public/client.js`)** — runs in the browser. It renders
  whatever state the server sends and forwards user input. Because the
  client holds no authority, a player cannot cheat by modifying their
  own page — an important design decision for any networked game.
- **Shared rules (`game-logic.js`)** — the pure game logic (board,
  gravity, win detection) in one module used by the server and directly
  by the tests.

### 3.2 Communication

Communication uses **WebSockets**, which keep a persistent two-way
connection open between browser and server — unlike ordinary HTTP
requests, the server can push a move to the opponent the instant it
happens. Messages are JSON objects with a `type` field (`create`,
`join`, `move`, `rematch`, `chat` from clients; `joined`, `state`,
`chat`, `opponentLeft`, `error` from the server). The full protocol is
documented in `README.md`.

### 3.3 Win detection

The board is a 6 × 7 array. After each move, `checkWin` scans every cell
in four directions (horizontal, vertical, both diagonals) for four
matching discs and returns the winning cells so the interface can
highlight them. A full board with no winner is a draw.

## 4. Implementation notes

- Rooms are stored in a `Map` keyed by a 4-character code generated from
  an alphabet that avoids easily confused characters (no 0/O, 1/I).
- The server rejects moves made out of turn, into full columns, or
  outside the board, and replies with an `error` message explaining why.
- Player names and chat text are length-limited and HTML-escaped in the
  client before display.
- When a player disconnects, the remaining player is notified and the
  room is closed.
- The interface uses CSS grid for the board, a drop animation for discs,
  and a highlight for the winning four.

## 5. Testing

Testing was automated with `npm test` (`test/test-game.js`):

- **Unit tests** of the rules module: disc gravity, full-column and
  out-of-range rejection, vertical / horizontal / diagonal wins, and
  full-board detection.
- **Integration test**: the script starts the real server, connects two
  WebSocket clients, and plays through a complete scenario — room
  creation, joining by code, an out-of-turn move being rejected, a full
  game to a win (score and winning cells verified), a chat message
  delivered to the opponent, a rematch with a cleared board and kept
  score, and the leave notification.

**Result:** all tests pass.

Manual testing was also done by loading the page and confirming the
lobby, board, chat and local mode render and respond correctly.

## 6. How to run

```bash
npm install
npm start        # then open http://localhost:3000
```

Two players can be tested on one machine with two browser tabs, or on
two devices on the same network using the host computer's local IP
address. Full instructions are in `README.md`.

## 7. Evaluation and limitations

The project meets all of its functional requirements: two players can
create/join a room, play complete rule-checked games in real time, chat,
keep score across rematches, and are told if the opponent leaves.
Keeping the rules in a separate module made the system much easier to
test, and the automated integration test gives confidence that the
networking and the rules work together, not just separately.

Limitations: rooms exist only in server memory, so restarting the
server ends all games; a dropped connection cannot yet be resumed;
there are no user accounts, so scores last only for one session; and by
default the game works on a local network rather than the public
internet.

## 8. Future improvements

- Spectator mode and matchmaking (automatic pairing)
- Reconnection/resume for dropped players
- Accounts and a persistent leaderboard using a database
- Deployment to a public host for play over the internet

## 9. Conclusion

This project produced a complete, tested, real-time multiplayer game.
Building it demonstrated the central ideas of networked applications:
an authoritative server, a lightweight rendering client, a simple
message protocol over WebSockets, and the value of separating pure logic
so it can be tested automatically.
