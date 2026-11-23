import type { Rng } from '../engine'
import { BOT_STYLES, perceive, random, type BotLevel } from './botStyle'
import { MIA, MIA_VALUES, miaChance, miaRank, type MiaAction, type MiaView } from './mia'

/** Chance a fair roll is at least `v`. */
const atLeast = (v: number) => MIA_VALUES.filter((x) => miaRank(x) >= miaRank(v)).reduce((a, x) => a + miaChance(x), 0)
/** Chance a fair roll beats `v` (any roll if null). */
const beats = (v: number | null) => (v === null ? 1 : atLeast(v) - miaChance(v))

/** How many values above the previous claim a liar tends to spread their lie over. */
const LIE_SPREAD = 3

/**
 * Chance the current claim is true. Naive bots take the odds of a fair roll
 * reaching it. Bots that read bids reason about the announcer: someone who
 * could beat the previous claim would usually say what they rolled, while a
 * liar tends to announce just above the previous claim.
 */
export function miaClaimOdds(view: MiaView, readsBids: boolean): number {
  const claim = view.claim!.value
  if (!readsBids) return atLeast(claim)
  const prev = view.history.length > 1 ? view.history[view.history.length - 2]!.value : null
  const honest = miaChance(claim) // rolled exactly this and said so
  const above = MIA_VALUES.filter((v) => prev === null || miaRank(v) > miaRank(prev))
  const lieRange = above.slice(0, LIE_SPREAD)
  // Liar: rolled nothing that beats `prev`, then picked a value near the bottom of what's allowed.
  const pLie = (1 - beats(prev)) * (lieRange.includes(claim) ? 0.9 / lieRange.length : 0.1 / Math.max(1, above.length))
  return honest / (honest + pLie)
}

/** A Mia player: decide whether to believe the claim, then what to announce after rolling. */
export function miaBotAction(view: MiaView, me: string, rng: Rng, level: BotLevel = 'normal'): MiaAction {
  const style = BOT_STYLES[level]
  const claim = view.claim

  if (view.rolled !== null) {
    // Announce: the truth if it's good enough, otherwise a lie just above the claim.
    const truth = view.rolled
    const options = MIA_VALUES.filter((v) => !claim || miaRank(v) > miaRank(claim.value))
    if (!claim || miaRank(truth) > miaRank(claim.value)) {
      // Sloppy (easy) bots sometimes inflate a good roll anyway.
      if (style.noise > 0 && random(rng) < style.bluff / 2 && options.length > 1) {
        const higher = options.filter((v) => miaRank(v) > miaRank(truth))
        if (higher.length) return { type: 'claim', value: higher[rng.int(Math.min(2, higher.length))]! }
      }
      return { type: 'claim', value: truth }
    }
    const spread = Math.min(options.length, style.readsBids ? 2 : LIE_SPREAD)
    return { type: 'claim', value: options[rng.int(spread)]! }
  }

  if (!claim) return { type: 'roll' }

  const pTrue = perceive(() => miaClaimOdds(view, style.readsBids), () => 'claim', style.noise, rng)(null)

  if (claim.value === MIA) {
    // Calling a real Mia costs 2 lives; giving up costs 1.
    return 2 * pTrue < 1 + (1 - pTrue) * 0.5 ? { type: 'call' } : { type: 'giveUp' }
  }

  // Believing means rolling and having to beat the claim, honestly or not.
  const canBeat = beats(claim.value)
  const believeScore = canBeat + (1 - canBeat) * 0.4
  const callScore = 1 - pTrue
  const [lo, hi] = style.nerve
  const nerve = lo + random(rng) * (hi - lo)
  if (callScore > believeScore * (nerve / 0.55)) return { type: 'call' }
  return { type: 'roll' }
}
