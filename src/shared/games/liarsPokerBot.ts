import type { Rng } from '../engine'
import { claimError, compareClaims, type Card, type Claim, type PokerAction, type PokerView, type Suit } from './liarsPoker'

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
const SUITS: Suit[] = [0, 1, 2, 3]

/** Every structurally valid claim, lowest first. */
export const ALL_CLAIMS: Claim[] = (() => {
  const out: Claim[] = []
  for (const rank of RANKS) out.push({ type: 'high', rank }, { type: 'pair', rank }, { type: 'trips', rank }, { type: 'quads', rank })
  for (const high of RANKS) for (const low of RANKS) if (high > low) out.push({ type: 'twoPair', high, low })
  for (const trips of RANKS) for (const pair of RANKS) if (trips !== pair) out.push({ type: 'fullHouse', trips, pair })
  for (const high of RANKS)
    if (high >= 5) {
      out.push({ type: 'straight', high })
      for (const suit of SUITS) {
        out.push({ type: 'straightFlush', suit, high })
        if (high >= 6) out.push({ type: 'flush', suit, high })
      }
    }
  return out.filter((c) => !claimError(c)).sort(compareClaims)
})()

/** A pool summarized for fast checks: count per rank, and a bitmask of ranks held per suit. */
interface Pool {
  n: number[]
  suit: number[]
}

function summarize(cards: Card[]): Pool {
  const n = new Array(15).fill(0)
  const suit = [0, 0, 0, 0]
  for (const c of cards) {
    n[c.rank]++
    suit[c.suit]! |= 1 << c.rank
  }
  return { n, suit }
}

const straightRanks = (high: number) => [0, 1, 2, 3, 4].map((i) => (high - i === 1 ? 14 : high - i))
const bits = (m: number) => { let k = 0; while (m) { m &= m - 1; k++ } return k }

/** Same rules as the engine's `poolHas`, on a summarized pool. */
export function holds(p: Pool, c: Claim): boolean {
  switch (c.type) {
    case 'high': return p.n[c.rank]! >= 1
    case 'pair': return p.n[c.rank]! >= 2
    case 'trips': return p.n[c.rank]! >= 3
    case 'quads': return p.n[c.rank]! >= 4
    case 'twoPair': return p.n[c.high]! >= 2 && p.n[c.low]! >= 2
    case 'fullHouse': return p.n[c.trips]! >= 3 && p.n[c.pair]! >= 2
    case 'straight': return straightRanks(c.high).every((r) => p.n[r]! >= 1)
    case 'straightFlush': return straightRanks(c.high).every((r) => p.suit[c.suit]! & (1 << r))
    case 'flush': {
      const m = p.suit[c.suit]!
      return !!(m & (1 << c.high)) && bits(m & ((1 << c.high) - 1)) >= 4
    }
  }
}

const SAMPLES = 400
const random = (rng: Rng) => rng.int(1_000_000) / 1_000_000

/**
 * A Monte Carlo Liar's Poker player. It knows only its own cards; it deals the
 * unseen cards at random many times and counts how often each claim holds.
 */
export function pokerBotAction(view: PokerView, me: string, rng: Rng): PokerAction {
  const mine = view.players.find((p) => p.id === me)?.hand ?? []
  const unseen: Card[] = []
  for (const suit of SUITS)
    for (const rank of RANKS) if (!mine.some((c) => c.rank === rank && c.suit === suit)) unseen.push({ rank, suit })
  const hidden = Math.min(view.totalCards - mine.length, unseen.length)

  const candidates = view.bid ? ALL_CLAIMS.filter((c) => compareClaims(c, view.bid!.claim) >= 0) : ALL_CLAIMS
  const hits = new Array(candidates.length).fill(0)
  const deck = [...unseen]
  for (let s = 0; s < SAMPLES; s++) {
    // Partial Fisher–Yates: the first `hidden` cards are a random deal.
    for (let i = 0; i < hidden; i++) {
      const j = i + rng.int(deck.length - i)
      ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
    }
    const pool = summarize([...mine, ...deck.slice(0, hidden)])
    for (let k = 0; k < candidates.length; k++) if (holds(pool, candidates[k]!)) hits[k]++
  }
  const p = (k: number) => hits[k]! / SAMPLES

  // Some noise so the bot isn't perfectly predictable.
  const nerve = 0.45 + random(rng) * 0.2
  const first = view.bid ? 1 : 0 // candidates[0] is the current bid, when there is one
  const raises = candidates.map((claim, k) => ({ claim, p: p(k) })).slice(first)

  if (!view.bid) {
    // Open with the boldest claim that still feels safe.
    const safe = raises.filter((r) => r.p >= nerve)
    return { type: 'bid', claim: (safe[safe.length - 1] ?? raises[0]!).claim }
  }

  const callScore = 1 - p(0)
  const raise = raises.find((r) => r.p >= nerve)
  if (raise && raise.p >= callScore) return { type: 'bid', claim: raise.claim }
  // Occasionally bluff instead of calling a claim that's merely doubtful.
  if (raises.length && callScore < 0.7 && random(rng) < 0.15) {
    const best = raises.slice(0, 8).reduce((a, b) => (b.p > a.p ? b : a))
    return { type: 'bid', claim: best.claim }
  }
  return { type: 'call' }
}
