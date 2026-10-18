# Liar's Dice (and soon Liar's Poker)

Private-room multiplayer over WebSockets. Node + TypeScript + Socket.IO server, React + Vite client.

## Run

```bash
npm install
npm run dev        # server on :3001, client on http://localhost:5173
npm test           # engine unit tests
npm run typecheck
```

Open http://localhost:5173 in two or more tabs (each tab is its own player), create a room in one, join with the code in the others.

Production: `npm run build && npm start` serves the built client and sockets from one port (`PORT`, default 3001).

## Layout

```
src/shared/engine.ts            GameEngine interface + seeded RNG
src/shared/games/liarsDice.ts   pure rules: init / apply / nextRound / forfeit / viewFor
src/shared/protocol.ts          zod schemas for client→server messages, server→client types
src/server/rooms.ts             RoomManager: lobby, host, ready, timers, reveal pause, cleanup
src/server/index.ts             Socket.IO wiring, session tokens, rate limit
src/client/                     React UI (Home → Lobby → Table)
```

## Design rules

- **Server-authoritative.** Clients send intents (`game:action`); the server validates with the engine.
- **Hidden info never leaves the server.** Every outbound game state goes through `engine.viewFor(state, playerId)`,
  which only includes the viewer's own dice. All hands are revealed only via `lastResult` after a call.
- **Full snapshots.** Each change sends every player their personalized `state` — tiny payloads, no desync.
- **Reconnect.** The server issues a session token (kept in `sessionStorage`); reconnecting with it restores your seat.
- **Timers live on the server.** Turn timeout auto-plays (`timeoutAction`: open with 1×2 or call). If the room has no
  timer, a disconnected player still gets 60s. Abandoned rooms are removed after 10 minutes.

## Adding Liar's Poker

Implement `GameEngine` in `src/shared/games/liarsPoker.ts` (deal N cards, bid poker hands over the combined pool,
loser gets +1 card, out past the max), add its config/action schemas to `protocol.ts`, pick the engine by room
game type in `rooms.ts`, and add a `PokerTable` component.
