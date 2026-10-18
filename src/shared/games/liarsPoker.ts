import type { GameEngine, PlayerId, Result, Rng } from '../engine'

// ---- cards ----

/** 2..14 (11 J, 12 Q, 13 K, 14 A). */
export type Rank = number
/** 0 clubs, 1 diamonds, 2 hearts, 3 spades (bridge order, used as a tiebreak). */
export type Suit = 0 | 1 | 2 | 3
export interface Card {
  rank: Rank
  suit: Suit
}

export const SUITS = ['♣', '♦', '♥', '♠'] as const
const RANK_NAMES: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
export const rankName = (r: Rank) => RANK_NAMES[r] ?? String(r)
export const cardName = (c: Card) => `${rankName(c.rank)}${SUITS[c.suit]}`

const isRank = (r: unknown): r is Rank => Number.isInteger(r) && (r as number) >= 2 && (r as number) <= 14
const isSuit = (s: unknown): s is Suit => s === 0 || s === 1 || s === 2 || s === 3

function shuffledDeck(rng: Rng): Card[] {
  const deck: Card[] = []
  for (let suit = 0; suit < 4; suit++) for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit: suit as Suit })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  return deck
}

const sortHand = (h: Card[]) => [...h].sort((a, b) => a.rank - b.rank || a.suit - b.suit)

// ---- claims (bids) ----

/** A claim that this hand can be made from the combined cards of all players. */
export type Claim =
  | { type: 'high'; rank: Rank }
  | { type: 'pair'; rank: Rank }
  | { type: 'twoPair'; high: Rank; low: Rank }
  | { type: 'trips'; rank: Rank }
  /** `high` 5..14; 5 is the wheel (A-2-3-4-5). */
  | { type: 'straight'; high: Rank }
  /** Five cards of `suit`, the highest being `high` of that suit. */
  | { type: 'flush'; suit: Suit; high: Rank }
  | { type: 'fullHouse'; trips: Rank; pair: Rank }
  | { type: 'quads'; rank: Rank }
  | { type: 'straightFlush'; suit: Suit; high: Rank }

export const CLAIM_TYPES = ['high', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush'] as const

/** Lexicographic sort key: hand category first, then ranks, then suit. */
function claimKey(c: Claim): number[] {
  const t = CLAIM_TYPES.indexOf(c.type)
  switch (c.type) {
    case 'high':
    case 'pair':
    case 'trips':
    case 'quads':
      return [t, c.rank]
    case 'twoPair':
      return [t, c.high, c.low]
    case 'straight':
      return [t, c.high]
    case 'flush':
    case 'straightFlush':
      return [t, c.high, c.suit]
    case 'fullHouse':
      return [t, c.trips, c.pair]
  }
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareClaims(a: Claim, b: Claim): number {
  const ka = claimKey(a)
  const kb = claimKey(b)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Structural validity of a claim (not whether it exists). */
export function claimError(c: Claim): string | null {
  switch (c.type) {
    case 'high':
    case 'pair':
    case 'trips':
    case 'quads':
      return isRank(c.rank) ? null : 'Invalid rank'
    case 'twoPair':
      if (!isRank(c.high) || !isRank(c.low)) return 'Invalid rank'
      return c.high > c.low ? null : 'Two pair needs two different ranks, higher first'
    case 'fullHouse':
      if (!isRank(c.trips) || !isRank(c.pair)) return 'Invalid rank'
      return c.trips !== c.pair ? null : 'Full house needs two different ranks'
    case 'straight':
      return isRank(c.high) && c.high >= 5 ? null : 'Straights run from 5-high (A-2-3-4-5) to A-high'
    case 'straightFlush':
      if (!isSuit(c.suit)) return 'Invalid suit'
      return isRank(c.high) && c.high >= 5 ? null : 'Straights run from 5-high (A-2-3-4-5) to A-high'
    case 'flush':
      if (!isSuit(c.suit)) return 'Invalid suit'
      return isRank(c.high) && c.high >= 6 ? null : 'A flush needs a high card of 6 or better'
    default:
      return 'Unknown hand'
  }
}

/** Ranks of a straight ending at `high`; the wheel uses the ace as 1. */
const straightRanks = (high: Rank) => [0, 1, 2, 3, 4].map((i) => (high - i === 1 ? 14 : high - i))

/** Does the combined pool contain this hand? */
export function poolHas(pool: Card[], c: Claim): boolean {
  const n = (r: Rank) => pool.filter((x) => x.rank === r).length
  const has = (r: Rank, s: Suit) => pool.some((x) => x.rank === r && x.suit === s)
  switch (c.type) {
    case 'high': return n(c.rank) >= 1
    case 'pair': return n(c.rank) >= 2
    case 'trips': return n(c.rank) >= 3
    case 'quads': return n(c.rank) >= 4
    case 'twoPair': return n(c.high) >= 2 && n(c.low) >= 2
    case 'fullHouse': return n(c.trips) >= 3 && n(c.pair) >= 2
    case 'straight': return straightRanks(c.high).every((r) => n(r) >= 1)
    case 'straightFlush': return straightRanks(c.high).every((r) => has(r, c.suit))
    case 'flush':
      return has(c.high, c.suit) && pool.filter((x) => x.suit === c.suit && x.rank < c.high).length >= 4
  }
}

const plural = (r: Rank) => `${rankName(r)}s`

export function describeClaim(c: Claim): string {
  switch (c.type) {
    case 'high': return `${rankName(c.rank)} high`
    case 'pair': return `pair of ${plural(c.rank)}`
    case 'twoPair': return `two pair, ${plural(c.high)} and ${plural(c.low)}`
    case 'trips': return `three ${plural(c.rank)}`
    case 'straight': return `straight to the ${rankName(c.high)}`
    case 'flush': return `${SUITS[c.suit]} flush, ${rankName(c.high)} high`
    case 'fullHouse': return `${plural(c.trips)} full of ${plural(c.pair)}`
    case 'quads': return `four ${plural(c.rank)}`
    case 'straightFlush': return c.high === 14 ? `royal flush in ${SUITS[c.suit]}` : `${SUITS[c.suit]} straight flush to the ${rankName(c.high)}`
  }
}

// ---- game ----

export interface PokerConfig {
  /** Cards each player is dealt in the first round. */
  startingCards: number
  /** A player who would be dealt more than this is out. */
  maxCards: number
}

export type PokerAction = { type: 'bid'; claim: Claim } | { type: 'call' }

export interface PlacedClaim {
  claim: Claim
  by: PlayerId
}

export interface PokerRoundResult {
  callerId: PlayerId
  bid: PlacedClaim
  /** Whether the bid hand was actually in the pool. */
  existed: boolean
  hands: Record<PlayerId, Card[]>
  loserId: PlayerId
  /** Set when the loser went over `maxCards`. */
  eliminatedId: PlayerId | null
}

interface PokerPlayer {
  id: PlayerId
  /** Cards dealt per round; 0 = eliminated. */
  cardCount: number
  hand: Card[]
}

export interface PokerState {
  config: PokerConfig
  players: PokerPlayer[]
  round: number
  phase: 'bidding' | 'reveal' | 'over'
  turn: number
  bid: PlacedClaim | null
  history: PlacedClaim[]
  lastResult: PokerRoundResult | null
  nextStarter: PlayerId | null
  winnerId: PlayerId | null
}

export interface PokerView {
  game: 'poker'
  phase: PokerState['phase']
  round: number
  config: PokerConfig
  players: { id: PlayerId; cardCount: number; hand: Card[] | null }[]
  totalCards: number
  turnPlayerId: PlayerId | null
  bid: PlacedClaim | null
  history: PlacedClaim[]
  lastResult: PokerRoundResult | null
  winnerId: PlayerId | null
}

const DECK_SIZE = 52
const alive = (p: PokerPlayer) => p.cardCount > 0

function nextAliveIndex(players: PokerPlayer[], from: number): number {
  for (let i = 1; i <= players.length; i++) {
    const idx = (from + i) % players.length
    if (alive(players[idx]!)) return idx
  }
  return from
}

function deal(players: PokerPlayer[], rng: Rng): PokerPlayer[] {
  const deck = shuffledDeck(rng)
  return players.map((p) => ({ ...p, hand: sortHand(deck.splice(0, p.cardCount)) }))
}

const err = (error: string): Result<PokerState> => ({ ok: false, error })

export const liarsPoker: GameEngine<PokerState, PokerAction, PokerConfig, PokerView> & {
  canStart(playerCount: number, config: PokerConfig): string | null
} = {
  defaultConfig: { startingCards: 1, maxCards: 5 },

  canStart(playerCount, { startingCards, maxCards }) {
    if (startingCards < 1 || startingCards > maxCards) return 'Starting cards must be between 1 and the max'
    if (playerCount * maxCards > DECK_SIZE) return `Too many players for ${maxCards} max cards (deck has ${DECK_SIZE})`
    return null
  },

  init(playerIds, config, rng) {
    const players = deal(playerIds.map((id) => ({ id, cardCount: config.startingCards, hand: [] })), rng)
    return {
      config,
      players,
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

    if (action.type === 'bid') {
      const problem = claimError(action.claim)
      if (problem) return err(problem)
      if (s.bid && compareClaims(action.claim, s.bid.claim) <= 0) return err('Bid must be higher than the current bid')
      const bid = { claim: action.claim, by: playerId }
      return { ok: true, value: { ...s, bid, history: [...s.history, bid], turn: nextAliveIndex(s.players, s.turn) } }
    }

    if (!s.bid) return err('Nothing to call yet')
    const pool = s.players.flatMap((p) => p.hand)
    const existed = poolHas(pool, s.bid.claim)
    const loserId = existed ? playerId : s.bid.by
    const players = s.players.map((p) => (p.id === loserId ? { ...p, cardCount: p.cardCount + 1 } : p))
    const loserIdx = players.findIndex((p) => p.id === loserId)
    const loser = players[loserIdx]!
    let eliminatedId: PlayerId | null = null
    if (loser.cardCount > s.config.maxCards) {
      players[loserIdx] = { ...loser, cardCount: 0 }
      eliminatedId = loserId
    }
    const result: PokerRoundResult = {
      callerId: playerId,
      bid: s.bid,
      existed,
      hands: Object.fromEntries(s.players.map((p) => [p.id, p.hand])),
      loserId,
      eliminatedId,
    }
    const remaining = players.filter(alive)
    if (remaining.length <= 1)
      return { ok: true, value: { ...s, players, phase: 'over', lastResult: result, winnerId: remaining[0]?.id ?? null } }
    const starter = alive(players[loserIdx]!) ? loserIdx : nextAliveIndex(players, loserIdx)
    return { ok: true, value: { ...s, players, phase: 'reveal', lastResult: result, nextStarter: players[starter]!.id } }
  },

  nextRound(s, rng) {
    if (s.phase !== 'reveal') return s
    const players = deal(s.players, rng)
    const idx = players.findIndex((p) => p.id === s.nextStarter)
    return {
      ...s,
      players,
      round: s.round + 1,
      phase: 'bidding',
      turn: idx >= 0 && alive(players[idx]!) ? idx : nextAliveIndex(players, Math.max(idx, 0)),
      bid: null,
      history: [],
      lastResult: null,
      nextStarter: null,
    }
  },

  forfeit(s, playerId) {
    const idx = s.players.findIndex((p) => p.id === playerId)
    if (idx < 0 || s.phase === 'over') return s
    // Their cards stay in the pool for the current round's bids; they just stop playing.
    const players = s.players.map((p) => (p.id === playerId ? { ...p, cardCount: 0 } : p))
    const remaining = players.filter(alive)
    if (remaining.length <= 1)
      return { ...s, players, phase: 'over', nextStarter: null, winnerId: remaining[0]?.id ?? null }
    let { turn, nextStarter } = s
    if (s.phase === 'bidding' && turn === idx) turn = nextAliveIndex(players, idx)
    if (nextStarter === playerId) nextStarter = players[nextAliveIndex(players, idx)]!.id
    return { ...s, players, turn, nextStarter }
  },

  timeoutAction(s) {
    return s.bid ? { type: 'call' } : { type: 'bid', claim: { type: 'high', rank: 2 } }
  },

  currentPlayer(s) {
    return s.phase === 'bidding' ? s.players[s.turn]!.id : null
  },

  phase(s) {
    return s.phase === 'bidding' ? 'playing' : s.phase
  },

  viewFor(s, viewer) {
    return {
      game: 'poker',
      phase: s.phase,
      round: s.round,
      config: s.config,
      players: s.players.map((p) => ({
        id: p.id,
        cardCount: p.cardCount,
        hand: p.id === viewer ? p.hand : null,
      })),
      totalCards: s.players.reduce((n, p) => n + p.hand.length, 0),
      turnPlayerId: s.phase === 'bidding' ? s.players[s.turn]!.id : null,
      bid: s.bid,
      history: s.history,
      lastResult: s.lastResult,
      winnerId: s.winnerId,
    }
  },
}
