# Liar's Dice & Liar's Poker

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

## Deploy (Render)

`render.yaml` defines a single free web service. In Render: **New → Blueprint**, pick this repo, apply.
It builds with `npm ci && npm run build` and starts with `npm start`; Render supplies `PORT`.

Notes on the free plan: the service sleeps after ~15 minutes without traffic (first visit then takes ~30–60s),
and rooms live in memory, so a restart or redeploy ends games in progress.

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
  Lost the tab entirely (new device, browser killed it)? Join again with the same name: a disconnected seat with
  that name is handed back, hand and all. Names held by connected players are refused.
- **Timers live on the server.** Turn timeout auto-plays (`timeoutAction`: open with 1×2 or call). If the room has no
  timer, a disconnected player still gets 60s. Abandoned rooms are removed after 10 minutes.

## Games

The host picks the game per room in the lobby; `rooms.ts` routes to the engine in `ENGINES` and validates moves
with that game's schema from `ACTION_SCHEMAS`.

- **Liar's Dice** (`liarsDice.ts`): bid quantity × face across all dice; options for wild 1s and "spot on".
- **Liar's Poker** (`liarsPoker.ts`, card version): bid a poker hand that exists in everyone's cards combined.
  Raises must be strictly higher (category, then ranks, then suit ♣<♦<♥<♠). Loser of a call is dealt one more
  card next round and is out past the max.

To add another game: implement `GameEngine`, add its config/action schemas to `protocol.ts`, register it in
`ENGINES`, and add a table component routed from `App.tsx`.
