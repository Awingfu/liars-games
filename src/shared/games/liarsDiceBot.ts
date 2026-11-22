import type { Rng } from '../engine'
import { isLegalRaise, type Bid, type DiceAction, type DiceView } from './liarsDice'

/** P(X >= k) for X ~ Binomial(n, p). */
function atLeast(n: number, p: number, k: number): number {
  if (k <= 0) return 1
  if (k > n) return 0
  let sum = 0
  let term = (1 - p) ** n // P(X = 0)
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += term
    term *= ((n - i) / (i + 1)) * (p / (1 - p))
  }
  return Math.min(1, sum)
}

/** P(X = k) for X ~ Binomial(n, p). */
function exactly(n: number, p: number, k: number): number {
  return atLeast(n, p, k) - atLeast(n, p, k + 1)
}

const random = (rng: Rng) => rng.int(1_000_000) / 1_000_000

/**
 * A simple probabilistic Liar's Dice player. It knows only its own dice (from
 * its redacted view) and treats everyone else's as independent rolls.
 */
export function diceBotAction(view: DiceView, me: string, rng: Rng): DiceAction {
  const { onesWild, spotOn } = view.config
  const mine = view.players.find((p) => p.id === me)?.dice ?? []
  const unknown = view.totalDice - mine.length

  const known = (face: number) => mine.filter((d) => d === face || (onesWild && face !== 1 && d === 1)).length
  const chance = (face: number) => (onesWild && face !== 1 ? 1 / 3 : 1 / 6)
  const pTrue = (b: Bid) => atLeast(unknown, chance(b.face), b.qty - known(b.face))

  // Every legal raise, cheapest first. A bid on wild 1s is worth about double.
  const raises: Bid[] = []
  for (let qty = 1; qty <= view.totalDice; qty++)
    for (let face = 1; face <= 6; face++) if (isLegalRaise(view.bid, { qty, face }, onesWild)) raises.push({ qty, face })
  const cost = (b: Bid) => (onesWild && b.face === 1 ? b.qty * 2 : b.qty)
  raises.sort((a, b) => cost(a) - cost(b) || known(b.face) - known(a.face) || a.face - b.face)

  // Some noise so the bot isn't perfectly predictable.
  const nerve = 0.45 + random(rng) * 0.2

  if (!view.bid) {
    // Open with the boldest bid that still feels safe, on a face we hold.
    const safe = raises.filter((b) => pTrue(b) >= nerve)
    const top = Math.max(...safe.map(cost), 1)
    const choices = safe.filter((b) => cost(b) === top)
    return { type: 'bid', ...(choices[rng.int(choices.length)] ?? raises[0]!) }
  }

  const current = view.bid
  const callScore = 1 - pTrue(current)
  const raise = raises.find((b) => pTrue(b) >= nerve)
  const raiseScore = raise ? pTrue(raise) : 0
  const spotScore = spotOn ? exactly(unknown, chance(current.face), current.qty - known(current.face)) : 0

  if (raise && raiseScore >= callScore) return { type: 'bid', ...raise }
  if (spotOn && spotScore > callScore) return { type: 'spotOn' }
  // Occasionally bluff instead of calling a bid that's merely doubtful.
  if (raises.length && callScore < 0.7 && random(rng) < 0.15) {
    const best = raises.slice(0, 6).reduce((a, b) => (pTrue(b) > pTrue(a) ? b : a))
    return { type: 'bid', ...best }
  }
  return { type: 'call' }
}
