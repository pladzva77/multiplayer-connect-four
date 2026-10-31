# Multiplayer Connect Four

An online multiplayer Connect Four game for two players, built with
**Node.js** and **WebSockets**. One player creates a room and receives a
4-letter code; a second player joins from another browser (or another
computer on the same network) using that code. Moves are validated by the
server and broadcast to both players in real time. The game also includes
room chat, a scoreboard, rematches, and a local two-player mode on a
single device.

## Features

- **Online multiplayer** over WebSockets with shareable room codes
- **Server-authoritative game logic** — the server validates every move
  (turn order, column bounds, full columns) so clients cannot cheat by
  editing their page
- **Live room chat** between the two players
- **Scoreboard and rematch** — wins are tracked across games in a room,
  and the loser of a game starts the next one
- **Local 2-player mode** on the same device, no server connection needed
- **Disconnect handling** — if a player leaves, the opponent is notified
- **Automated tests** — unit tests for the game rules plus an end-to-end
  test that plays a full game between two WebSocket clients

## Requirements

- Node.js 18 or newer (check with `node --version`)

## How to run

```bash
npm install   # installs the one dependency (ws)
npm start     # starts the server
```

Then open **http://localhost:3000** in a browser.

### Playing with two people

- **Same computer:** open two browser windows/tabs at
  http://localhost:3000 — create a room in one, join with the code in the
  other. (Or use Local 2-player mode in a single tab.)
- **Two computers/phones on the same Wi-Fi:** start the server on one
  computer, find that computer's local IP address (e.g. `192.168.1.20`),
  and on the second device open `http://192.168.1.20:3000`.

## How to play

1. Enter your name and click **Create a room**. You play Red.
2. Give the 4-letter room code to your friend.
3. Your friend enters their name, types the code, and clicks **Join**.
   They play Yellow.
4. Take turns clicking a column to drop a disc. First to connect four
   discs — across, down, or diagonally — wins the round.
5. Click **Rematch** to play again; the score is kept.

## Running the tests

```bash
npm test
```

This runs the rule tests in `test/test-game.js` and then boots the real
server and plays a complete game between two automated clients
(create room → join → invalid move rejected → winning game → chat →
rematch → leave notification).

## Project structure

```
multiplayer-connect-four/
├── server.js          # HTTP static server + WebSocket game server
├── game-logic.js      # Pure Connect Four rules (shared by server & tests)
├── package.json
├── public/
│   ├── index.html     # Page structure: lobby + game + chat
│   ├── style.css      # Styling, disc drop animation, win highlight
│   └── client.js      # Browser client: renders state, sends moves/chat
├── test/
│   └── test-game.js   # Unit + integration tests (npm test)
├── REPORT.md          # Project report (aim, design, testing, evaluation)
└── README.md
```

## How it works (architecture)

```
Player 1 browser ──┐
                   ├── WebSocket (JSON messages) ──► Node.js server
Player 2 browser ──┘                                 - owns all game state
                                                     - validates moves
                                                     - broadcasts state
```

Clients never update the board themselves. A click sends
`{ "type": "move", "column": 3 }`; the server checks that it is really
that player's turn and that the column is legal, applies the shared rules
in `game-logic.js`, and broadcasts the full new state
(`{ "type": "state", ... }`) to both players, whose pages simply render
what they receive. This client–server design is what makes the game
multiplayer rather than two independent pages.

### Message protocol

| Direction       | Type           | Meaning                                  |
|-----------------|----------------|------------------------------------------|
| client → server | `create`       | Create a room (sender becomes Red)       |
| client → server | `join`         | Join a room by code (sender is Yellow)   |
| client → server | `move`         | Drop a disc in `column`                  |
| client → server | `rematch`      | Start a new game in the same room        |
| client → server | `chat`         | Send a chat message to the room          |
| server → client | `joined`       | Your colour and the initial state        |
| server → client | `state`        | Full game state after any change         |
| server → client | `chat`         | A chat message from a player             |
| server → client | `opponentLeft` | The other player disconnected           |
| server → client | `error`        | A rejected action, with the reason       |

## Possible future improvements

- Spectator mode for extra connections in a room
- Reconnect/resume if a player's connection drops briefly
- Persistent accounts and a leaderboard (database)
- Matchmaking (auto-pairing instead of room codes)
- Deploying the server to a public host so friends can play over the
  internet, not just one network
