import type { GameEngine, PlayerId, Result, Rng } from '../engine'

/**
 * Mia (Mäxchen). Each turn a player rolls two dice in secret and announces a
 * value that must beat the last one, truthfully or not. The next player either
 * believes it (and rolls to beat it) or calls; whoever is wrong loses a life.
 *
 * Values are written high die first: 65 is a 6 and a 5, 44 is a pair of 4s.
 * Ranking, low to high: 31 32 41 42 43 51 … 65, then pairs 11 … 66, then Mia (21).
 */

export interface MiaConfig {
  lives: number
}

export type MiaAction = { type: 'roll' } | { type: 'claim'; value: number } | { type: 'call' } | { type: 'giveUp' }

export interface MiaClaim {
  value: number
  by: PlayerId
}

export interface MiaResult {
  kind: 'call' | 'giveUp'
  callerId: PlayerId
  claim: MiaClaim
  /** What was really under the cup; null when the caller gave up without looking. */
  actual: number | null
  loserId: PlayerId
  livesLost: number
  eliminatedId: PlayerId | null
}

interface MiaPlayer {
  id: PlayerId
  lives: number
}

export interface MiaState {
  config: MiaConfig
  players: MiaPlayer[]
  round: number
  phase: 'bidding' | 'reveal' | 'over'
  turn: number
  /** The current player's fresh roll, once they've rolled this turn. */
  rolled: number | null
  /** The real value under the current claim. */
  cup: number | null
  claim: MiaClaim | null
  history: MiaClaim[]
  lastResult: MiaResult | null
  nextStarter: PlayerId | null
  winnerId: PlayerId | null
}

export interface MiaView {
  game: 'mia'
  phase: MiaState['phase']
  round: number
  config: MiaConfig
  players: { id: PlayerId; lives: number }[]
  turnPlayerId: PlayerId | null
  /** Whether the current player has rolled and must now announce. */
  hasRolled: boolean
  /** Your roll, only while it's your turn and you've rolled. */
  rolled: number | null
  claim: MiaClaim | null
  history: MiaClaim[]
  lastResult: MiaResult | null
  winnerId: PlayerId | null
}

export const MIA = 21

/** Every value, lowest first. */
export const MIA_VALUES: number[] = (() => {
  const plain: number[] = []
  for (let hi = 3; hi <= 6; hi++) for (let lo = 1; lo < hi; lo++) if (hi * 10 + lo !== MIA) plain.push(hi * 10 + lo)
  const pairs = [11, 22, 33, 44, 55, 66]
  return [...plain, ...pairs, MIA]
})()

const RANK = new Map(MIA_VALUES.map((v, i) => [v, i]))
export const isMiaValue = (v: unknown): v is number => typeof v === 'number' && RANK.has(v)
/** Position in the ranking: higher beats lower. */
export const miaRank = (v: number) => RANK.get(v)!
/** Chance a fair roll comes up exactly `v`. */
export const miaChance = (v: number) => (v === MIA || v % 11 !== 0 ? 2 / 36 : 1 / 36)

export function describeMia(v: number): string {
  if (v === MIA) return 'Mia'
  const hi = Math.floor(v / 10)
  return v % 11 === 0 ? `pair of ${hi}s` : String(v)
}

export const miaDice = (v: number): [number, number] => [Math.floor(v / 10), v % 10]

function rollValue(rng: Rng): number {
  const a = rng.int(6) + 1
  const b = rng.int(6) + 1
  return Math.max(a, b) * 10 + Math.min(a, b)
}

const alive = (p: MiaPlayer) => p.lives > 0

function nextAliveIndex(players: MiaPlayer[], from: number): number {
  for (let i = 1; i <= players.length; i++) {
    const idx = (from + i) % players.length
    if (alive(players[idx]!)) return idx
  }
  return from
}

/** Lowest value that beats `v` (any value if null), or null if nothing does. */
export function nextAbove(v: number | null): number | null {
  if (v === null) return MIA_VALUES[0]!
  return MIA_VALUES[miaRank(v) + 1] ?? null
}

function resolve(s: MiaState, callerId: PlayerId, kind: MiaResult['kind']): MiaState {
  const claim = s.claim!
  let loserId: PlayerId
  let livesLost = 1
  if (kind === 'giveUp') {
    loserId = callerId
  } else {
    const truthful = miaRank(s.cup!) >= miaRank(claim.value)
    loserId = truthful ? callerId : claim.by
    // Doubting a real Mia costs double.
    if (truthful && claim.value === MIA) livesLost = 2
  }
  const players = s.players.map((p) => (p.id === loserId ? { ...p, lives: Math.max(0, p.lives - livesLost) } : p))
  const loserIdx = players.findIndex((p) => p.id === loserId)
  const eliminatedId = players[loserIdx]!.lives === 0 ? loserId : null
  const result: MiaResult = { kind, callerId, claim, actual: kind === 'call' ? s.cup : null, loserId, livesLost, eliminatedId }

  const remaining = players.filter(alive)
  if (remaining.length <= 1)
    return { ...s, players, phase: 'over', rolled: null, lastResult: result, nextStarter: null, winnerId: remaining[0]?.id ?? null }
  const starter = alive(players[loserIdx]!) ? loserIdx : nextAliveIndex(players, loserIdx)
  return { ...s, players, phase: 'reveal', rolled: null, lastResult: result, nextStarter: players[starter]!.id }
}

const err = (error: string): Result<MiaState> => ({ ok: false, error })

export const mia: GameEngine<MiaState, MiaAction, MiaConfig, MiaView> = {
  defaultConfig: { lives: 3 },

  canStart(_playerCount, { lives }) {
    return Number.isInteger(lives) && lives >= 1 && lives <= 6 ? null : 'Lives must be between 1 and 6'
  },

  init(playerIds, config, rng) {
    return {
      config,
      players: playerIds.map((id) => ({ id, lives: config.lives })),
      round: 1,
      phase: 'bidding',
      turn: rng.int(playerIds.length),
      rolled: rollValue(rng),
      cup: null,
      claim: null,
      history: [],
      lastResult: null,
      nextStarter: null,
      winnerId: null,
    }
  },

  apply(s, playerId, action, rng) {
    if (s.phase !== 'bidding') return err('Not accepting moves right now')
    if (s.players[s.turn]?.id !== playerId) return err("It's not your turn")

    switch (action.type) {
      case 'roll':
        if (s.rolled !== null) return err('You already rolled')
        if (s.claim?.value === MIA) return err("Nothing beats Mia: call it or give up")
        return { ok: true, value: { ...s, rolled: rollValue(rng) } }
      case 'claim': {
        if (s.rolled === null) return err('Roll first')
        if (!isMiaValue(action.value)) return err('Not a possible roll')
        if (s.claim && miaRank(action.value) <= miaRank(s.claim.value))
          return err(`You must announce more than ${describeMia(s.claim.value)}`)
        const claim = { value: action.value, by: playerId }
        return {
          ok: true,
          value: { ...s, claim, cup: s.rolled, rolled: null, history: [...s.history, claim], turn: nextAliveIndex(s.players, s.turn) },
        }
      }
      case 'call':
        if (!s.claim) return err('Nothing to call yet')
        if (s.rolled !== null) return err('You already believed it and rolled')
        return { ok: true, value: resolve(s, playerId, 'call') }
      case 'giveUp':
        if (s.claim?.value !== MIA) return err('You can only give up against Mia')
        if (s.rolled !== null) return err('You already rolled')
        return { ok: true, value: resolve(s, playerId, 'giveUp') }
      default:
        return err('Invalid move')
    }
  },

  nextRound(s, rng) {
    if (s.phase !== 'reveal') return s
    const idx = s.players.findIndex((p) => p.id === s.nextStarter)
    const turn = idx >= 0 && alive(s.players[idx]!) ? idx : nextAliveIndex(s.players, Math.max(idx, 0))
    return {
      ...s,
      round: s.round + 1,
      phase: 'bidding',
      turn,
      rolled: rollValue(rng),
      cup: null,
      claim: null,
      history: [],
      lastResult: null,
      nextStarter: null,
    }
  },

  forfeit(s, playerId) {
    const idx = s.players.findIndex((p) => p.id === playerId)
    if (idx < 0 || s.phase === 'over') return s
    const players = s.players.map((p) => (p.id === playerId ? { ...p, lives: 0 } : p))
    const remaining = players.filter(alive)
    if (remaining.length <= 1)
      return { ...s, players, phase: 'over', rolled: null, nextStarter: null, winnerId: remaining[0]?.id ?? null }
    let { turn, rolled, nextStarter } = s
    if (s.phase === 'bidding' && turn === idx) {
      // The next player picks up the standing claim (or rolls fresh if there is none).
      turn = nextAliveIndex(players, idx)
      rolled = null
    }
    if (nextStarter === playerId) nextStarter = players[nextAliveIndex(players, idx)]!.id
    return { ...s, players, turn, rolled, nextStarter }
  },

  timeoutAction(s) {
    if (s.rolled !== null) {
      const beats = !s.claim || miaRank(s.rolled) > miaRank(s.claim.value)
      return { type: 'claim', value: beats ? s.rolled : nextAbove(s.claim!.value)! }
    }
    if (!s.claim) return { type: 'roll' }
    return s.claim.value === MIA ? { type: 'giveUp' } : { type: 'call' }
  },

  currentPlayer(s) {
    return s.phase === 'bidding' ? s.players[s.turn]!.id : null
  },

  phase(s) {
    return s.phase === 'bidding' ? 'playing' : s.phase
  },

  viewFor(s, viewer) {
    const turnPlayerId = s.phase === 'bidding' ? s.players[s.turn]!.id : null
    return {
      game: 'mia',
      phase: s.phase,
      round: s.round,
      config: s.config,
      players: s.players.map(({ id, lives }) => ({ id, lives })),
      turnPlayerId,
      hasRolled: s.rolled !== null,
      rolled: turnPlayerId === viewer ? s.rolled : null,
      claim: s.claim,
      history: s.history,
      lastResult: s.lastResult,
      winnerId: s.winnerId,
    }
  },
}
