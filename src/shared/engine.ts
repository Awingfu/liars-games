export type PlayerId = string

/** Source of randomness. Server uses crypto; tests use a seeded RNG. */
export interface Rng {
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * A game is a set of pure functions over its own state. The server owns the
 * state; clients only ever see the output of `viewFor`.
 */
export interface GameEngine<State, Action, Config, View> {
  defaultConfig: Config
  init(playerIds: PlayerId[], config: Config, rng: Rng): State
  /** Apply a player's action, or explain why it's illegal. */
  apply(state: State, playerId: PlayerId, action: Action, rng: Rng): Result<State>
  /** Called by the server after the reveal pause to deal the next round. */
  nextRound(state: State, rng: Rng): State
  /** Player left mid-game: remove them from play. */
  forfeit(state: State, playerId: PlayerId): State
  /** What to do for a player whose turn timer expired. */
  timeoutAction(state: State): Action
  /** Whose turn it is, or null when no player input is expected. */
  currentPlayer(state: State): PlayerId | null
  phase(state: State): 'playing' | 'reveal' | 'over'
  /** Redacted state for one player. Never leaks other players' hidden info. */
  viewFor(state: State, viewer: PlayerId): View
}

export function seededRng(seed: number): Rng {
  // mulberry32
  let a = seed >>> 0
  return {
    int(max) {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
      return Math.floor(r * max)
    },
  }
}
