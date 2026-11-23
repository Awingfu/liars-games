import type { Rng } from './engine'
import type { Bid, DiceView } from './games/liarsDice'
import { othersCount } from './games/liarsDiceBot'
import { fullDeck, type Card, type Claim, type PokerView } from './games/liarsPoker'
import { holds, summarize, unseenCards } from './games/liarsPokerBot'
import { MIA_VALUES, miaChance, miaRank } from './games/mia'

/**
 * Odds that a bid is true, for the "EZ mode" helper. `withHand` conditions on
 * the viewer's own dice or cards; otherwise everything is treated as unseen.
 */

const mathRng: Rng = { int: (max) => Math.floor(Math.random() * max) }

/** P(X ≥ k), X ~ Binomial(n, p). */
function atLeast(n: number, p: number, k: number): number {
  if (k <= 0) return 1
  if (k > n) return 0
  let term = (1 - p) ** n
  let sum = 0
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += term
    term *= ((n - i) / (i + 1)) * (p / (1 - p))
  }
  return Math.min(1, sum)
}

export function diceOdds(view: DiceView, me: string, bid: Bid, withHand: boolean): number {
  const p = view.config.onesWild && bid.face !== 1 ? 1 / 3 : 1 / 6
  const mine = view.players.find((pl) => pl.id === me)?.dice
  if (!withHand || !mine) return atLeast(view.totalDice, p, bid.qty)
  const known = mine.filter((d) => d === bid.face || (view.config.onesWild && bid.face !== 1 && d === 1)).length
  const dist = othersCount(view, me, bid.face, false)
  return dist.slice(Math.max(0, bid.qty - known)).reduce((a, x) => a + x, 0)
}

export function pokerOdds(view: PokerView, me: string, claim: Claim, withHand: boolean, samples = 3000, rng = mathRng): number {
  const mine: Card[] = (withHand && view.players.find((p) => p.id === me)?.hand) || []
  const deck = withHand ? unseenCards(mine, view.decks) : fullDeck(view.decks)
  const hidden = Math.min(view.totalCards - mine.length, deck.length)
  let hits = 0
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < hidden; i++) {
      const j = i + rng.int(deck.length - i)
      ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
    }
    const pool = [...mine, ...deck.slice(0, hidden)]
    if (holds(summarize(pool), claim)) hits++
  }
  return hits / samples
}

/** Chance a fair roll of two dice is at least `value`. */
export const miaOdds = (value: number) =>
  MIA_VALUES.filter((v) => miaRank(v) >= miaRank(value)).reduce((a, v) => a + miaChance(v), 0)

export const pct = (p: number) => (p > 0 && p < 0.01 ? '<1%' : p < 1 && p > 0.99 ? '>99%' : `${Math.round(p * 100)}%`)
