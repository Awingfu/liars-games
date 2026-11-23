import type { Rng } from '../engine'

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const
export type BotLevel = (typeof BOT_LEVELS)[number]

export interface BotStyle {
  /** Range the bot's confidence threshold is drawn from each decision: raise only on claims at least this likely. */
  nerve: [number, number]
  /** Max error (±) added to each odds estimate. */
  noise: number
  /** Chance of bluffing a raise instead of calling a doubtful bid. */
  bluff: number
  /** Treat opponents' bids as evidence about their hands. */
  readsBids: boolean
  /** Open with the boldest safe claim (true) or a random safe one (false). */
  boldOpen: boolean
  /** Monte Carlo deals per decision (poker). */
  samples: number
}

export const BOT_STYLES: Record<BotLevel, BotStyle> = {
  easy: { nerve: [0.25, 0.85], noise: 0.35, bluff: 0.35, readsBids: false, boldOpen: false, samples: 100 },
  normal: { nerve: [0.45, 0.65], noise: 0, bluff: 0.15, readsBids: false, boldOpen: true, samples: 400 },
  hard: { nerve: [0.5, 0.6], noise: 0, bluff: 0.1, readsBids: true, boldOpen: true, samples: 800 },
}

/**
 * How much less likely a player is to bid on something they hold none of. A bid
 * is weak evidence: people bluff, and raise on others' claims.
 */
export const NO_SUPPORT_WEIGHT = 0.2

export const random = (rng: Rng) => rng.int(1_000_000) / 1_000_000

/** Wrap an odds function so each claim gets one fixed error for this decision. */
export function perceive<K>(odds: (k: K) => number, key: (k: K) => string, noise: number, rng: Rng) {
  if (!noise) return odds
  const err = new Map<string, number>()
  return (k: K) => {
    const p = odds(k)
    // Even a sloppy bot knows a sure thing (e.g. a claim its own hand proves).
    if (p <= 0 || p >= 1) return p
    const id = key(k)
    if (!err.has(id)) err.set(id, (random(rng) * 2 - 1) * noise)
    return Math.max(0, Math.min(1, p + err.get(id)!))
  }
}
