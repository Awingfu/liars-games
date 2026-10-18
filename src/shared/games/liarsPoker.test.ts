import { describe, expect, it } from 'vitest'
import { seededRng } from '../engine'
import {
  claimError,
  compareClaims,
  describeClaim,
  liarsPoker as E,
  poolHas,
  type Card,
  type Claim,
  type PokerState,
  type Suit,
} from './liarsPoker'

const rng = seededRng(7)

/** Parse "As Kh 10d 2c" into cards. */
function cards(s: string): Card[] {
  const suits: Record<string, Suit> = { c: 0, d: 1, h: 2, s: 3 }
  const ranks: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 }
  return s.split(/\s+/).filter(Boolean).map((t) => {
    const r = t.slice(0, -1)
    return { rank: ranks[r] ?? Number(r), suit: suits[t.slice(-1)]! }
  })
}

/** Bidding-phase state with fixed hands; seat 0 to act. */
function make(hands: string[], config = E.defaultConfig): PokerState {
  const s = E.init(hands.map((_, i) => `p${i}`), config, rng)
  return {
    ...s,
    turn: 0,
    players: s.players.map((p, i) => ({ ...p, hand: cards(hands[i]!), cardCount: cards(hands[i]!).length })),
  }
}

function ok(r: ReturnType<typeof E.apply>): PokerState {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const bid = (claim: Claim) => ({ type: 'bid' as const, claim })

describe('compareClaims', () => {
  const ladder: Claim[] = [
    { type: 'high', rank: 2 },
    { type: 'high', rank: 14 },
    { type: 'pair', rank: 2 },
    { type: 'pair', rank: 14 },
    { type: 'twoPair', high: 3, low: 2 },
    { type: 'twoPair', high: 9, low: 2 },
    { type: 'twoPair', high: 9, low: 8 },
    { type: 'twoPair', high: 14, low: 13 },
    { type: 'trips', rank: 2 },
    { type: 'straight', high: 5 },
    { type: 'straight', high: 14 },
    { type: 'flush', suit: 3, high: 6 },
    { type: 'flush', suit: 0, high: 7 },
    { type: 'flush', suit: 3, high: 7 },
    { type: 'fullHouse', trips: 2, pair: 14 },
    { type: 'fullHouse', trips: 3, pair: 2 },
    { type: 'quads', rank: 2 },
    { type: 'straightFlush', suit: 0, high: 5 },
    { type: 'straightFlush', suit: 3, high: 14 },
  ]

  it('orders the whole ladder strictly', () => {
    for (let i = 0; i < ladder.length - 1; i++) {
      expect(compareClaims(ladder[i]!, ladder[i + 1]!), `${describeClaim(ladder[i]!)} < ${describeClaim(ladder[i + 1]!)}`).toBeLessThan(0)
      expect(compareClaims(ladder[i + 1]!, ladder[i]!)).toBeGreaterThan(0)
    }
    expect(compareClaims({ type: 'pair', rank: 8 }, { type: 'pair', rank: 8 })).toBe(0)
  })
})

describe('claimError', () => {
  it('rejects malformed claims', () => {
    expect(claimError({ type: 'pair', rank: 1 })).not.toBeNull()
    expect(claimError({ type: 'pair', rank: 15 })).not.toBeNull()
    expect(claimError({ type: 'twoPair', high: 5, low: 5 })).not.toBeNull()
    expect(claimError({ type: 'twoPair', high: 4, low: 9 })).not.toBeNull()
    expect(claimError({ type: 'fullHouse', trips: 7, pair: 7 })).not.toBeNull()
    expect(claimError({ type: 'straight', high: 4 })).not.toBeNull()
    expect(claimError({ type: 'flush', suit: 2, high: 5 })).not.toBeNull()
    expect(claimError({ type: 'flush', suit: 4 as Suit, high: 9 })).not.toBeNull()
    expect(claimError({ type: 'straightFlush', suit: 1, high: 5 })).toBeNull()
    expect(claimError({ type: 'flush', suit: 1, high: 6 })).toBeNull()
  })
})

describe('poolHas', () => {
  const pool = cards('As Ah 2c 3d 4h 5s 9h Jh Qh 9c 9d Kd')

  it('ranks-only hands', () => {
    expect(poolHas(pool, { type: 'high', rank: 13 })).toBe(true)
    expect(poolHas(pool, { type: 'high', rank: 10 })).toBe(false)
    expect(poolHas(pool, { type: 'pair', rank: 14 })).toBe(true)
    expect(poolHas(pool, { type: 'pair', rank: 13 })).toBe(false)
    expect(poolHas(pool, { type: 'twoPair', high: 14, low: 9 })).toBe(true)
    expect(poolHas(pool, { type: 'trips', rank: 9 })).toBe(true)
    expect(poolHas(pool, { type: 'trips', rank: 14 })).toBe(false)
    expect(poolHas(pool, { type: 'fullHouse', trips: 9, pair: 14 })).toBe(true)
    expect(poolHas(pool, { type: 'fullHouse', trips: 14, pair: 9 })).toBe(false)
    expect(poolHas(pool, { type: 'quads', rank: 9 })).toBe(false)
  })

  it('straights, including the wheel', () => {
    expect(poolHas(pool, { type: 'straight', high: 5 })).toBe(true) // A-2-3-4-5
    expect(poolHas(pool, { type: 'straight', high: 6 })).toBe(false)
    expect(poolHas(cards('10c Jd Qh Ks Ac'), { type: 'straight', high: 14 })).toBe(true)
    expect(poolHas(cards('Jd Qh Ks Ac 2c'), { type: 'straight', high: 14 })).toBe(false) // no wrap-around
  })

  it('flushes need the named high card plus four lower of the suit', () => {
    // hearts: A 4 9 J Q
    expect(poolHas(pool, { type: 'flush', suit: 2, high: 14 })).toBe(true)
    expect(poolHas(pool, { type: 'flush', suit: 2, high: 12 })).toBe(false) // only 4, 9, J below Q
    expect(poolHas(pool, { type: 'flush', suit: 1, high: 13 })).toBe(false)
  })

  it('straight flushes', () => {
    const sf = cards('5h 6h 7h 8h 9h 10c')
    expect(poolHas(sf, { type: 'straightFlush', suit: 2, high: 9 })).toBe(true)
    expect(poolHas(sf, { type: 'straightFlush', suit: 2, high: 10 })).toBe(false)
    expect(poolHas(cards('Ad 2d 3d 4d 5d'), { type: 'straightFlush', suit: 1, high: 5 })).toBe(true)
  })
})

describe('liarsPoker engine', () => {
  it('deals unique cards and redacts other hands', () => {
    const s = E.init(['a', 'b', 'c', 'd'], { startingCards: 5, maxCards: 5 }, rng)
    const all = s.players.flatMap((p) => p.hand.map((c) => `${c.rank}-${c.suit}`))
    expect(all).toHaveLength(20)
    expect(new Set(all).size).toBe(20)
    const v = E.viewFor(s, 'c')
    expect(v.players.find((p) => p.id === 'c')!.hand).toHaveLength(5)
    expect(v.players.filter((p) => p.id !== 'c').every((p) => p.hand === null)).toBe(true)
  })

  it('canStart guards deck size and card counts', () => {
    expect(E.canStart(8, { startingCards: 1, maxCards: 6 })).toBeNull()
    expect(E.canStart(9, { startingCards: 1, maxCards: 6 })).not.toBeNull()
    expect(E.canStart(4, { startingCards: 3, maxCards: 2 })).not.toBeNull()
  })

  it('requires strictly higher bids, in turn', () => {
    let s = make(['As', 'Kd'])
    expect(E.apply(s, 'p1', bid({ type: 'high', rank: 2 }), rng).ok).toBe(false)
    expect(E.apply(s, 'p0', { type: 'call' }, rng).ok).toBe(false)
    s = ok(E.apply(s, 'p0', bid({ type: 'pair', rank: 9 }), rng))
    expect(E.apply(s, 'p1', bid({ type: 'pair', rank: 9 }), rng).ok).toBe(false)
    expect(E.apply(s, 'p1', bid({ type: 'high', rank: 14 }), rng).ok).toBe(false)
    expect(E.apply(s, 'p1', bid({ type: 'pair', rank: 10 }), rng).ok).toBe(true)
  })

  it('call on a real hand: caller takes a card and starts next round', () => {
    let s = make(['As 3c', 'Ad 7h', 'Kc 2d'])
    s = ok(E.apply(s, 'p0', bid({ type: 'pair', rank: 14 }), rng))
    s = ok(E.apply(s, 'p1', { type: 'call' }, rng))
    expect(s.phase).toBe('reveal')
    expect(s.lastResult).toMatchObject({ existed: true, loserId: 'p1', eliminatedId: null })
    expect(E.viewFor(s, 'p2').lastResult!.hands.p0).toHaveLength(2) // reveal is public
    s = E.nextRound(s, rng)
    expect(s.players.map((p) => p.hand.length)).toEqual([2, 3, 2])
    expect(E.currentPlayer(s)).toBe('p1')
  })

  it('call on a bluff: bidder takes a card; going over max eliminates', () => {
    let s = make(['2c', '3d', '4h'], { startingCards: 1, maxCards: 1 })
    s = ok(E.apply(s, 'p0', bid({ type: 'straight', high: 6 }), rng))
    s = ok(E.apply(s, 'p1', { type: 'call' }, rng))
    expect(s.lastResult).toMatchObject({ existed: false, loserId: 'p0', eliminatedId: 'p0' })
    expect(s.nextStarter).toBe('p1')
    s = E.nextRound(s, rng)
    expect(s.players[0]!.hand).toHaveLength(0)
    s = ok(E.apply(s, 'p1', bid({ type: 'quads', rank: 14 }), rng))
    expect(E.currentPlayer(s)).toBe('p2')
    s = ok(E.apply(s, 'p2', { type: 'call' }, rng))
    expect(s.phase).toBe('over')
    expect(s.winnerId).toBe('p2')
  })

  it('forfeit passes the turn and can end the game', () => {
    let s = make(['2c', '3d', '4h'])
    s = E.forfeit(s, 'p0')
    expect(E.currentPlayer(s)).toBe('p1')
    s = E.forfeit(s, 'p1')
    expect(s.phase).toBe('over')
    expect(s.winnerId).toBe('p2')
  })

  it('timeout opens with the lowest bid, otherwise calls', () => {
    let s = make(['2c', '3d'])
    s = ok(E.apply(s, 'p0', E.timeoutAction(s), rng))
    expect(s.bid!.claim).toEqual({ type: 'high', rank: 2 })
    expect(E.timeoutAction(s)).toEqual({ type: 'call' })
  })

  it('describes claims readably', () => {
    expect(describeClaim({ type: 'twoPair', high: 13, low: 6 })).toBe('two pair, Ks and 6s')
    expect(describeClaim({ type: 'fullHouse', trips: 14, pair: 10 })).toBe('As full of 10s')
    expect(describeClaim({ type: 'straightFlush', suit: 3, high: 14 })).toBe('royal flush in ♠')
  })
})
