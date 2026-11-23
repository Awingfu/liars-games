import { describe, expect, it } from 'vitest'
import { seededRng } from '../engine'
import { compareClaims, liarsPoker as E, poolHas, type Card, type Claim, type PokerConfig, type PokerView, type Suit } from './liarsPoker'
import { BOT_LEVELS, type BotLevel } from './botStyle'
import { ALL_CLAIMS, holds, pokerBotAction, supports, unseenCards } from './liarsPokerBot'

function cards(s: string): Card[] {
  const suits: Record<string, Suit> = { c: 0, d: 1, h: 2, s: 3 }
  const ranks: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 }
  return s.split(/\s+/).filter(Boolean).map((t) => ({ rank: ranks[t.slice(0, -1)] ?? Number(t.slice(0, -1)), suit: suits[t.slice(-1)]! }))
}

const summarize = (pool: Card[]) => {
  const n = new Array(15).fill(0)
  const suit = [0, 0, 0, 0]
  for (const c of pool) { n[c.rank]++; suit[c.suit]! |= 1 << c.rank }
  return { n, suit }
}

function playOut(players: number, config: PokerConfig, seed: number, level: BotLevel = 'normal') {
  const rng = seededRng(seed)
  let s = E.init(Array.from({ length: players }, (_, i) => `b${i}`), config, rng)
  let moves = 0
  while (E.phase(s) !== 'over') {
    if (E.phase(s) === 'reveal') { s = E.nextRound(s, rng); continue }
    const me = E.currentPlayer(s)!
    const action = pokerBotAction(E.viewFor(s, me), me, rng, level)
    const r = E.apply(s, me, action, rng)
    if (!r.ok) throw new Error(`illegal bot move ${JSON.stringify(action)}: ${r.error}`)
    s = r.value
    if (++moves > 5000) throw new Error('game did not finish')
  }
  return s
}

const view = (hand: string, others: number, bid: Claim | null): PokerView => {
  const h = cards(hand)
  return {
    game: 'poker', phase: 'bidding', round: 1, config: { startingCards: h.length, maxCards: 5 },
    players: [{ id: 'me', cardCount: h.length, hand: h }, { id: 'x', cardCount: others, hand: null }],
    decks: 1, totalCards: h.length + others, turnPlayerId: 'me',
    bid: bid && { claim: bid, by: 'x' }, history: bid ? [{ claim: bid, by: 'x' }] : [], lastResult: null, winnerId: null,
  }
}

describe('poker bot', () => {
  it('lists every claim once, in bidding order', () => {
    expect(ALL_CLAIMS.length).toBe(13 * 4 + 78 + 156 + 10 + 40 + 36)
    for (let i = 1; i < ALL_CLAIMS.length; i++) expect(compareClaims(ALL_CLAIMS[i - 1]!, ALL_CLAIMS[i]!)).toBeLessThan(0)
  })

  it('fast claim check agrees with the engine', () => {
    const pools = ['As Ks Qs Js 10s 2c 2d', '5h 4h 3h 2h Ah 9c 9d 9s', '7c 7d 7h 3s 3c 8d', 'Ad 2d 3c 4h 5s Kd 9d 6d']
    for (const p of pools) for (const c of ALL_CLAIMS) expect(holds(summarize(cards(p)), c)).toBe(poolHas(cards(p), c))
  })

  it.each(BOT_LEVELS)('%s: only makes legal moves and games finish', (level) => {
    for (let seed = 1; seed <= 12; seed++) {
      const maxCards = 2 + (seed % 4)
      const config = { startingCards: 1 + (seed % maxCards), maxCards }
      expect(playOut(2 + (seed % 4), config, seed, level).winnerId).toBeTruthy()
    }
  })

  it('knows which cards support a claim', () => {
    expect(supports(cards('Kh 2c'), { type: 'pair', rank: 13 })).toBe(true)
    expect(supports(cards('Qh 2c'), { type: 'pair', rank: 13 })).toBe(false)
    expect(supports(cards('7d'), { type: 'straight', high: 9 })).toBe(true)
    expect(supports(cards('10d'), { type: 'straight', high: 9 })).toBe(false)
    expect(supports(cards('3h'), { type: 'flush', suit: 2, high: 9 })).toBe(true)
    expect(supports(cards('Kh 3c'), { type: 'flush', suit: 2, high: 9 })).toBe(false)
    expect(supports(cards('As'), { type: 'straightFlush', suit: 3, high: 5 })).toBe(true)
  })

  it('a bot that reads bids believes a claim more when the opponent made it', () => {
    // Opponent claims a pair of kings; we hold one king. Hard should raise more often than normal.
    const raises = (level: BotLevel) => {
      let n = 0
      for (let seed = 1; seed <= 40; seed++)
        if (pokerBotAction(view('Kc 4d', 2, { type: 'pair', rank: 13 }), 'me', seededRng(seed), level).type === 'bid') n++
      return n
    }
    expect(raises('hard')).toBeGreaterThan(raises('normal'))
  })

  it('calls an unlikely claim', () => {
    expect(pokerBotAction(view('2c 7d', 2, { type: 'quads', rank: 13 }), 'me', seededRng(1))).toEqual({ type: 'call' })
  })

  it('raises rather than calling a claim it holds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = pokerBotAction(view('9c 9d 9h', 3, { type: 'pair', rank: 9 }), 'me', seededRng(seed))
      expect(a.type).toBe('bid')
    }
  })

  it('must call when no higher claim exists', () => {
    const top: Claim = { type: 'straightFlush', suit: 3, high: 14 }
    expect(pokerBotAction(view('As', 1, top), 'me', seededRng(1))).toEqual({ type: 'call' })
  })
})

describe('poker bot never calls a claim its own hand proves', () => {
  it.each(BOT_LEVELS)('%s', (level) => {
    // Holding the 9 against "9 high", with no safe raise: calling is a sure loss, so it must raise.
    for (let seed = 1; seed <= 50; seed++)
      expect(pokerBotAction(view('9c', 1, { type: 'high', rank: 9 }), 'me', seededRng(seed), level).type).toBe('bid')
  })

  it('with two decks, holding one A♠ leaves the other unseen', () => {
    const mine = cards('As Kd')
    expect(unseenCards(mine, 1)).toHaveLength(50)
    const two = unseenCards(mine, 2)
    expect(two).toHaveLength(102)
    expect(two.filter((c) => c.rank === 14 && c.suit === 3)).toHaveLength(1)
  })
})
