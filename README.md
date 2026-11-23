# Liar's Games

Liar's Dice, Liar's Poker and Mia.

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
src/shared/games/liarsPoker.ts  card version of the same interface
src/shared/games/mia.ts         Mia (Mäxchen): two dice, lives
src/shared/games/*Bot.ts        bot strategies; botStyle.ts holds difficulty levels (see Bots)
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
- **Mia** (`mia.ts`): roll two dice in secret and announce a value that beats the last one, truthfully or not.
  The next player believes it (rolls and must beat it) or calls Liar; whoever is wrong loses a life. Values read
  high die first; ranking low to high is 31 … 65, then pairs 11 … 66, then Mia (21). Against Mia you can give up
  (lose 1) or call, but calling a real Mia costs 2 lives. A roll that beats the announcement counts as true.
  Setting: lives (1–6).

To add another game: implement `GameEngine`, add its config/action schemas to `protocol.ts`, register it in
`ENGINES`, and add a table component routed from `App.tsx`.

## Rooms

- **Spectators.** Joining a room mid-game, or a lobby that already has 8 players, makes you a spectator: you see
  the table (no hidden dice, cards or rolls) but don't play. In the lobby anyone can switch with **Just watch** /
  **Take a seat**; spectators are left out of the ready check. When the host returns to the lobby, spectators fill
  free seats in arrival order. A room holds up to 20 people in total.
- **Scoreboard.** Each room keeps wins and games played per player (bots included) for as long as it exists,
  shown in the lobby and on the game-over card. A game counts once when it ends, for everyone seated at the start,
  including players who forfeited.

## Bots

The host can add bots in the lobby (**+ Add bot**, ✕ to remove) and set each one's difficulty. Bots are always ready, count toward the 8-player
limit, and can't host; a room closes when its last human leaves. On a bot's turn the server waits 1.2–2.4s, then
plays the move its strategy picks from `viewFor(state, botId)`, the same redacted view a human gets, so bots
never see hidden dice or cards. Bot strategies are registered per game in `BOTS` in `rooms.ts`.

- **Dice** (`liarsDiceBot.ts`): exact binomial odds. A bid is true with probability
  P(Binomial(unseen dice, p) ≥ qty − matches in own dice), where p is 1/6, or 1/3 with wild 1s.
- **Poker** (`liarsPokerBot.ts`): Monte Carlo. Deals the unseen cards at random 400 times and counts how often
  each of the 372 possible claims holds (about 3–6 ms per decision).
- **Mia** (`miaBot.ts`): exact odds over the 21 values. Calls when 1 − P(claim true) beats its chance of surviving
  a roll (P(roll beats claim) + 40% of the rest, for a successful bluff). After rolling it tells the truth when it
  beats the claim, otherwise lies just above it. Against Mia it calls only if 2·P(real) < 1 + ½·P(fake).
  Hard reads announcements: a liar has no roll beating the previous claim and tends to announce one of the next
  3 values, so a minimal step is more suspicious than a jump (Bayes over "rolled exactly this" vs "lied to this").
  Easy sometimes inflates an honest roll.

Mia head-to-head (3 lives, 3000 games): Normal beats Easy 62%, Hard beats Normal 71%, Hard beats Easy 73%.

Dice and poker bots use the same decision rule:

1. Pick a "nerve" threshold at random from the level's range for this decision.
2. **Opening:** bid the boldest claim at least that likely to be true (Easy: a random one of those).
3. **Responding:** take the cheapest legal raise at least that likely, unless calling has better odds
   (1 − P(current bid true)). Dice bots say "spot on" when the exact count is likelier than the bid being false.
4. **Bluffing:** with the level's bluff chance, when the current bid is only somewhat doubtful (<70% to be false),
   raise with the likeliest of the next few claims instead of calling.

### Difficulty

Levels are parameter sets in `BOT_STYLES` (`src/shared/games/botStyle.ts`):

| Level | Nerve | Odds error | Bluff | Reads bids | Opening | Poker deals |
|---|---|---|---|---|---|---|
| Easy | 25–85% | ±35% | 35% | no | random safe claim | 100 |
| Normal | 45–65% | none | 15% | no | boldest safe claim | 400 |
| Hard | 50–60% | none | 10% | yes | boldest safe claim | 800 |

**Reading bids** (Hard): a player's latest bid is weak evidence that they hold part of it. Dice: for each opponent
whose latest bid was on face f, their count of f is reweighted so holding none is 0.2× as likely
(`NO_SUPPORT_WEIGHT`). Poker: each random deal is weighted 0.2× per opponent whose dealt hand holds no card the
claim is built from (`supports`), so deals consistent with everyone's bids count for more.

Head-to-head, two players (dice: 5 dice, 1000 games; poker: 2 starting cards, 300 games):

| | Dice | Poker |
|---|---|---|
| Normal vs Easy | 62% | 79% |
| Hard vs Normal | 76% | 60% |
| Hard vs Easy | 82% | 84% |

Known weakness: Easy and Normal treat every unseen die or card as random, so they're easy to bluff. Hard can be
steered the other way: bid on what you don't hold and it believes you. Players see a short version of this under
**🤖 How the bots play** in the lobby and at the table when bots are in the room.

## TODO: more games

- [x] **Mia (Mäxchen)**: done, see Games.
- [ ] **Dollar-bill Liar's Poker**: everyone holds 8 random digits (like a banknote serial number) and bids counts
  of a digit across all players, e.g. "four 7s". Mechanically Liar's Dice with ten-sided dice and 8 per player,
  so it can likely reuse `liarsDice.ts` with a faces/count setting.
- [ ] **Cheat (BS / I Doubt It)**: players play cards face down claiming a rank ("two Queens"); anyone can call it.
  If the claim was a lie the player picks up the pile, otherwise the caller does. First to empty their hand wins.
  Reuses the deck and card rendering from Liar's Poker.
