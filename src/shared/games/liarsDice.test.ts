import { describe, expect, it } from 'vitest'
import { seededRng } from '../engine'
import { countFace, isLegalRaise, liarsDice as E, type DiceState } from './liarsDice'

const rng = seededRng(42)
const cfg = { ...E.defaultConfig }

/** Build a bidding-phase state with fixed dice; turn starts at seat 0. */
function make(hands: number[][], config = cfg): DiceState {
  const s = E.init(hands.map((_, i) => `p${i}`), config, rng)
  return { ...s, turn: 0, players: s.players.map((p, i) => ({ ...p, dice: hands[i]! })) }
}

function ok(r: ReturnType<typeof E.apply>): DiceState {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('isLegalRaise', () => {
  it('standard ordering', () => {
    expect(isLegalRaise(null, { qty: 1, face: 1 }, false)).toBe(true)
    expect(isLegalRaise({ qty: 3, face: 4 }, { qty: 3, face: 5 }, false)).toBe(true)
    expect(isLegalRaise({ qty: 3, face: 4 }, { qty: 4, face: 2 }, false)).toBe(true)
    expect(isLegalRaise({ qty: 3, face: 4 }, { qty: 3, face: 4 }, false)).toBe(false)
    expect(isLegalRaise({ qty: 3, face: 4 }, { qty: 3, face: 3 }, false)).toBe(false)
    expect(isLegalRaise({ qty: 3, face: 4 }, { qty: 2, face: 6 }, false)).toBe(false)
  })

  it('ones-wild ordering', () => {
    expect(isLegalRaise(null, { qty: 2, face: 1 }, true)).toBe(false)
    expect(isLegalRaise({ qty: 5, face: 4 }, { qty: 3, face: 1 }, true)).toBe(true)
    expect(isLegalRaise({ qty: 5, face: 4 }, { qty: 2, face: 1 }, true)).toBe(false)
    expect(isLegalRaise({ qty: 3, face: 1 }, { qty: 4, face: 1 }, true)).toBe(true)
    expect(isLegalRaise({ qty: 3, face: 1 }, { qty: 7, face: 2 }, true)).toBe(true)
    expect(isLegalRaise({ qty: 3, face: 1 }, { qty: 6, face: 6 }, true)).toBe(false)
  })
})

describe('countFace', () => {
  it('counts wild ones except when bidding on ones', () => {
    const hands = [[1, 3, 3], [1, 1, 5]]
    expect(countFace(hands, 3, false)).toBe(2)
    expect(countFace(hands, 3, true)).toBe(5)
    expect(countFace(hands, 1, true)).toBe(3)
  })
})

describe('liarsDice engine', () => {
  it('deals starting dice and redacts other players', () => {
    const s = E.init(['a', 'b', 'c'], cfg, rng)
    expect(s.players.every((p) => p.dice.length === 5)).toBe(true)
    const v = E.viewFor(s, 'b')
    expect(v.players.find((p) => p.id === 'b')!.dice).toHaveLength(5)
    expect(v.players.filter((p) => p.id !== 'b').every((p) => p.dice === null)).toBe(true)
  })

  it('rejects out-of-turn, illegal and impossible bids', () => {
    const s = make([[2, 2], [3, 3]])
    expect(E.apply(s, 'p1', { type: 'bid', qty: 1, face: 2 }, rng).ok).toBe(false)
    expect(E.apply(s, 'p0', { type: 'call' }, rng).ok).toBe(false)
    expect(E.apply(s, 'p0', { type: 'bid', qty: 5, face: 2 }, rng).ok).toBe(false)
    expect(E.apply(s, 'p0', { type: 'bid', qty: 1, face: 7 }, rng).ok).toBe(false)
    const s2 = ok(E.apply(s, 'p0', { type: 'bid', qty: 2, face: 3 }, rng))
    expect(E.apply(s2, 'p1', { type: 'bid', qty: 2, face: 2 }, rng).ok).toBe(false)
  })

  it('true bid: caller loses a die and starts next round', () => {
    let s = make([[2, 2], [3, 3], [4, 4]])
    s = ok(E.apply(s, 'p0', { type: 'bid', qty: 2, face: 3 }, rng))
    s = ok(E.apply(s, 'p1', { type: 'call' }, rng))
    expect(s.phase).toBe('reveal')
    expect(s.lastResult).toMatchObject({ actualCount: 2, loserId: 'p1' })
    expect(s.players[1]!.dice).toHaveLength(1)
    // Reveal is public: everyone sees all hands from the call
    expect(E.viewFor(s, 'p2').lastResult!.hands.p0).toEqual([2, 2])
    s = E.nextRound(s, rng)
    expect(E.currentPlayer(s)).toBe('p1')
    expect(s.bid).toBeNull()
  })

  it('false bid: bidder loses a die', () => {
    let s = make([[2, 2], [3, 3]])
    s = ok(E.apply(s, 'p0', { type: 'bid', qty: 3, face: 2 }, rng))
    s = ok(E.apply(s, 'p1', { type: 'call' }, rng))
    expect(s.lastResult!.loserId).toBe('p0')
  })

  it('spot on: exact gains a die (capped), wrong loses one', () => {
    let s = make([[2, 2], [3], [5, 5]])
    s = ok(E.apply(s, 'p0', { type: 'bid', qty: 2, face: 5 }, rng))
    s = ok(E.apply(s, 'p1', { type: 'spotOn' }, rng))
    expect(s.lastResult).toMatchObject({ gainerId: 'p1', loserId: null })
    expect(s.players[1]!.dice).toHaveLength(2)

    let t = make([[2, 2], [3], [5, 5]])
    t = ok(E.apply(t, 'p0', { type: 'bid', qty: 1, face: 5 }, rng))
    t = ok(E.apply(t, 'p1', { type: 'spotOn' }, rng))
    expect(t.phase).toBe('reveal')
    expect(t.lastResult!.loserId).toBe('p1')
    expect(t.nextStarter).toBe('p2') // p1 is out, next seat starts
  })

  it('eliminated players are skipped and last one standing wins', () => {
    let s = make([[6], [6], [2]])
    s = ok(E.apply(s, 'p0', { type: 'bid', qty: 3, face: 6 }, rng))
    s = ok(E.apply(s, 'p1', { type: 'call' }, rng)) // false: p0 out
    expect(s.nextStarter).toBe('p1')
    s = E.nextRound(s, rng)
    s = { ...s, players: s.players.map((p, i) => ({ ...p, dice: [[], [4], [4]][i]! })) }
    s = ok(E.apply(s, 'p1', { type: 'bid', qty: 1, face: 4 }, rng))
    expect(E.currentPlayer(s)).toBe('p2')
    s = ok(E.apply(s, 'p2', { type: 'bid', qty: 2, face: 4 }, rng))
    expect(E.currentPlayer(s)).toBe('p1') // skips p0
    s = ok(E.apply(s, 'p1', { type: 'call' }, rng)) // true: p1 out
    expect(s.phase).toBe('over')
    expect(s.winnerId).toBe('p2')
  })

  it('forfeit on your turn passes the turn; last opponent leaving ends the game', () => {
    let s = make([[1], [2], [3]])
    s = E.forfeit(s, 'p0')
    expect(E.currentPlayer(s)).toBe('p1')
    s = E.forfeit(s, 'p2')
    expect(s.phase).toBe('over')
    expect(s.winnerId).toBe('p1')
  })

  it('timeout opens with a minimal bid, otherwise calls', () => {
    let s = make([[1], [2]], { ...cfg, onesWild: true })
    const a = E.timeoutAction(s)
    s = ok(E.apply(s, 'p0', a, rng))
    expect(E.timeoutAction(s)).toEqual({ type: 'call' })
  })
})
