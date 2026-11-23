import type { Rng } from '../engine'
import { BOT_STYLES, NO_SUPPORT_WEIGHT, perceive, random, type BotLevel } from './botStyle'
import { isLegalRaise, type Bid, type DiceAction, type DiceView } from './liarsDice'

/** Binomial(n, p) probability mass function, as an array over 0..n. */
function binomial(n: number, p: number): number[] {
  const pmf = [(1 - p) ** n]
  for (let k = 1; k <= n; k++) pmf.push((pmf[k - 1]! * (n - k + 1) * p) / (k * (1 - p)))
  return pmf
}

function convolve(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i]! * b[j]!
  return out
}

/**
 * Distribution of how many of `face` the other players hold. With `readsBids`,
 * a player whose latest bid was on `face` is assumed less likely to hold none.
 */
export function othersCount(view: DiceView, me: string, face: number, readsBids: boolean): number[] {
  const p = view.config.onesWild && face !== 1 ? 1 / 3 : 1 / 6
  const lastFace = new Map(view.history.map((b) => [b.by, b.face]))
  let dist = [1]
  for (const pl of view.players) {
    if (pl.id === me || pl.diceCount === 0) continue
    let d = binomial(pl.diceCount, p)
    if (readsBids && lastFace.get(pl.id) === face) {
      d = d.map((x, k) => (k === 0 ? x * NO_SUPPORT_WEIGHT : x))
      const sum = d.reduce((a, b) => a + b, 0)
      d = d.map((x) => x / sum)
    }
    dist = convolve(dist, d)
  }
  return dist
}

/**
 * A probabilistic Liar's Dice player. It knows only its own dice (from its
 * redacted view); its difficulty sets how well it judges the odds.
 */
export function diceBotAction(view: DiceView, me: string, rng: Rng, level: BotLevel = 'normal'): DiceAction {
  const style = BOT_STYLES[level]
  const { onesWild, spotOn } = view.config
  const mine = view.players.find((p) => p.id === me)?.dice ?? []

  const known = (face: number) => mine.filter((d) => d === face || (onesWild && face !== 1 && d === 1)).length
  const dists = new Map<number, number[]>()
  const dist = (face: number) => {
    if (!dists.has(face)) dists.set(face, othersCount(view, me, face, style.readsBids))
    return dists.get(face)!
  }
  const need = (b: Bid) => b.qty - known(b.face)
  const pTrue = perceive(
    (b: Bid) => dist(b.face).slice(Math.max(0, need(b))).reduce((a, x) => a + x, 0),
    (b) => `${b.qty}x${b.face}`, style.noise, rng,
  )
  const pExact = (b: Bid) => (need(b) < 0 ? 0 : dist(b.face)[need(b)] ?? 0)

  // Every legal raise, cheapest first. A bid on wild 1s is worth about double.
  const raises: Bid[] = []
  for (let qty = 1; qty <= view.totalDice; qty++)
    for (let face = 1; face <= 6; face++) if (isLegalRaise(view.bid, { qty, face }, onesWild)) raises.push({ qty, face })
  const cost = (b: Bid) => (onesWild && b.face === 1 ? b.qty * 2 : b.qty)
  raises.sort((a, b) => cost(a) - cost(b) || known(b.face) - known(a.face) || a.face - b.face)

  const [lo, hi] = style.nerve
  const nerve = lo + random(rng) * (hi - lo)

  if (!view.bid) {
    const safe = raises.filter((b) => pTrue(b) >= nerve)
    if (!safe.length) return { type: 'bid', ...raises[0]! }
    if (!style.boldOpen) return { type: 'bid', ...safe[rng.int(safe.length)]! }
    const top = Math.max(...safe.map(cost))
    const choices = safe.filter((b) => cost(b) === top)
    return { type: 'bid', ...choices[rng.int(choices.length)]! }
  }

  const current = view.bid
  const callScore = 1 - pTrue(current)
  const raise = raises.find((b) => pTrue(b) >= nerve)
  if (raise && pTrue(raise) >= callScore) return { type: 'bid', ...raise }
  if (spotOn && pExact(current) > callScore) return { type: 'spotOn' }
  // No raise feels safe, but if calling is even worse (the bid is probably true), take the best long shot.
  const best = raises.reduce<Bid | null>((a, b) => (!a || pTrue(b) > pTrue(a) ? b : a), null)
  if (best && pTrue(best) > callScore) return { type: 'bid', ...best }
  // Sometimes bluff instead of calling a bid that's merely doubtful.
  if (raises.length && callScore < 0.7 && random(rng) < style.bluff) {
    const best = raises.slice(0, 6).reduce((a, b) => (pTrue(b) > pTrue(a) ? b : a))
    return { type: 'bid', ...best }
  }
  return { type: 'call' }
}
