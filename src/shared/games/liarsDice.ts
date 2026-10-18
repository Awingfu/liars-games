import type { GameEngine, PlayerId, Result, Rng } from '../engine'

export interface DiceConfig {
  startingDice: number
  /** Perudo-style: 1s count toward any face; bidding 1s halves the quantity. */
  onesWild: boolean
  /** Allow "spot on": caller claims the bid is exactly right. */
  spotOn: boolean
}

export interface Bid {
  qty: number
  face: number
}

export interface PlacedBid extends Bid {
  by: PlayerId
}

export type DiceAction =
  | { type: 'bid'; qty: number; face: number }
  | { type: 'call' }
  | { type: 'spotOn' }

export interface RoundResult {
  kind: 'call' | 'spotOn'
  callerId: PlayerId
  bid: PlacedBid
  actualCount: number
  /** Everyone's dice as they were when the call was made. */
  hands: Record<PlayerId, number[]>
  loserId: PlayerId | null
  gainerId: PlayerId | null
}

interface DicePlayer {
  id: PlayerId
  dice: number[]
}

export interface DiceState {
  config: DiceConfig
  players: DicePlayer[]
  round: number
  phase: 'bidding' | 'reveal' | 'over'
  turn: number
  bid: PlacedBid | null
  history: PlacedBid[]
  lastResult: RoundResult | null
  nextStarter: PlayerId | null
  winnerId: PlayerId | null
}

export interface DiceView {
  game: 'dice'
  phase: DiceState['phase']
  round: number
  config: DiceConfig
  players: { id: PlayerId; diceCount: number; dice: number[] | null }[]
  totalDice: number
  turnPlayerId: PlayerId | null
  bid: PlacedBid | null
  history: PlacedBid[]
  lastResult: RoundResult | null
  winnerId: PlayerId | null
}

const FACES = 6

const rollDice = (n: number, rng: Rng) =>
  Array.from({ length: n }, () => rng.int(FACES) + 1).sort((a, b) => a - b)

const alive = (p: DicePlayer) => p.dice.length > 0

export const totalDice = (s: Pick<DiceState, 'players'>) =>
  s.players.reduce((n, p) => n + p.dice.length, 0)

function nextAliveIndex(players: DicePlayer[], from: number): number {
  for (let i = 1; i <= players.length; i++) {
    const idx = (from + i) % players.length
    if (alive(players[idx]!)) return idx
  }
  return from
}

export function countFace(hands: number[][], face: number, onesWild: boolean): number {
  let n = 0
  for (const hand of hands)
    for (const d of hand) if (d === face || (onesWild && face !== 1 && d === 1)) n++
  return n
}

/** Is `next` a legal raise over `prev`? (`prev` null = opening bid.) */
export function isLegalRaise(prev: Bid | null, next: Bid, onesWild: boolean): boolean {
  if (!prev) return !(onesWild && next.face === 1)
  if (!onesWild || (prev.face !== 1 && next.face !== 1))
    return next.qty > prev.qty || (next.qty === prev.qty && next.face > prev.face)
  if (prev.face !== 1) return next.qty >= Math.ceil(prev.qty / 2) // switching to 1s
  if (next.face === 1) return next.qty > prev.qty
  return next.qty >= prev.qty * 2 + 1 // switching off 1s
}

function finishRound(s: DiceState, result: RoundResult, starterIdx: number): DiceState {
  const remaining = s.players.filter(alive)
  if (remaining.length <= 1) {
    return { ...s, phase: 'over', lastResult: result, nextStarter: null, winnerId: remaining[0]?.id ?? null }
  }
  const starter = alive(s.players[starterIdx]!) ? starterIdx : nextAliveIndex(s.players, starterIdx)
  return { ...s, phase: 'reveal', lastResult: result, nextStarter: s.players[starter]!.id }
}

function resolve(s: DiceState, callerId: PlayerId, kind: RoundResult['kind']): DiceState {
  const bid = s.bid!
  const hands = Object.fromEntries(s.players.map((p) => [p.id, [...p.dice]]))
  const actualCount = countFace(Object.values(hands), bid.face, s.config.onesWild)
  const players = s.players.map((p) => ({ ...p, dice: [...p.dice] }))
  const byId = (id: PlayerId) => players.findIndex((p) => p.id === id)

  let loserId: PlayerId | null = null
  let gainerId: PlayerId | null = null
  let starterIdx: number

  if (kind === 'call') {
    loserId = actualCount >= bid.qty ? callerId : bid.by
    starterIdx = byId(loserId)
  } else {
    const caller = players[byId(callerId)]!
    if (actualCount === bid.qty) {
      if (caller.dice.length < s.config.startingDice) gainerId = callerId
    } else {
      loserId = callerId
    }
    starterIdx = byId(callerId)
  }
  if (loserId) players[byId(loserId)]!.dice.pop()
  if (gainerId) players[byId(gainerId)]!.dice.push(1)

  return finishRound({ ...s, players }, { kind, callerId, bid, actualCount, hands, loserId, gainerId }, starterIdx)
}

const err = (error: string): Result<DiceState> => ({ ok: false, error })

export const liarsDice: GameEngine<DiceState, DiceAction, DiceConfig, DiceView> = {
  defaultConfig: { startingDice: 5, onesWild: false, spotOn: true },

  init(playerIds, config, rng) {
    return {
      config,
      players: playerIds.map((id) => ({ id, dice: rollDice(config.startingDice, rng) })),
      round: 1,
      phase: 'bidding',
      turn: rng.int(playerIds.length),
      bid: null,
      history: [],
      lastResult: null,
      nextStarter: null,
      winnerId: null,
    }
  },

  apply(s, playerId, action) {
    if (s.phase !== 'bidding') return err('Not accepting moves right now')
    if (s.players[s.turn]?.id !== playerId) return err("It's not your turn")

    switch (action.type) {
      case 'bid': {
        const { qty, face } = action
        if (!Number.isInteger(qty) || !Number.isInteger(face) || face < 1 || face > FACES || qty < 1)
          return err('Invalid bid')
        if (qty > totalDice(s)) return err(`There are only ${totalDice(s)} dice in play`)
        if (!isLegalRaise(s.bid, action, s.config.onesWild))
          return err(s.bid ? 'Bid must be higher than the current bid' : "Can't open on 1s when 1s are wild")
        const bid = { qty, face, by: playerId }
        return { ok: true, value: { ...s, bid, history: [...s.history, bid], turn: nextAliveIndex(s.players, s.turn) } }
      }
      case 'call':
        if (!s.bid) return err('Nothing to call yet')
        return { ok: true, value: resolve(s, playerId, 'call') }
      case 'spotOn':
        if (!s.config.spotOn) return err('Spot on is disabled')
        if (!s.bid) return err('Nothing to call yet')
        return { ok: true, value: resolve(s, playerId, 'spotOn') }
    }
  },

  nextRound(s, rng) {
    if (s.phase !== 'reveal') return s
    const players = s.players.map((p) => ({ ...p, dice: rollDice(p.dice.length, rng) }))
    const turn = players.findIndex((p) => p.id === s.nextStarter)
    return {
      ...s,
      players,
      round: s.round + 1,
      phase: 'bidding',
      turn: turn >= 0 && alive(players[turn]!) ? turn : nextAliveIndex(players, Math.max(turn, 0)),
      bid: null,
      history: [],
      lastResult: null,
      nextStarter: null,
    }
  },

  forfeit(s, playerId) {
    const idx = s.players.findIndex((p) => p.id === playerId)
    if (idx < 0 || s.phase === 'over') return s
    const players = s.players.map((p) => (p.id === playerId ? { ...p, dice: [] } : p))
    const remaining = players.filter(alive)
    if (remaining.length <= 1)
      return { ...s, players, phase: 'over', nextStarter: null, winnerId: remaining[0]?.id ?? null }
    let { turn, nextStarter } = s
    if (s.phase === 'bidding' && turn === idx) turn = nextAliveIndex(players, idx)
    if (nextStarter === playerId) nextStarter = players[nextAliveIndex(players, idx)]!.id
    return { ...s, players, turn, nextStarter }
  },

  timeoutAction(s) {
    if (s.bid) return { type: 'call' }
    return { type: 'bid', qty: 1, face: 2 }
  },

  currentPlayer(s) {
    return s.phase === 'bidding' ? s.players[s.turn]!.id : null
  },

  phase(s) {
    return s.phase === 'bidding' ? 'playing' : s.phase
  },

  viewFor(s, viewer) {
    return {
      game: 'dice',
      phase: s.phase,
      round: s.round,
      config: s.config,
      players: s.players.map((p) => ({
        id: p.id,
        diceCount: p.dice.length,
        dice: p.id === viewer ? p.dice : null,
      })),
      totalDice: totalDice(s),
      turnPlayerId: s.phase === 'bidding' ? s.players[s.turn]!.id : null,
      bid: s.bid,
      history: s.history,
      lastResult: s.lastResult,
      winnerId: s.winnerId,
    }
  },
}
