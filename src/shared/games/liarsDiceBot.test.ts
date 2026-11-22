import { describe, expect, it } from 'vitest'
import { seededRng } from '../engine'
import { liarsDice, type DiceConfig, type DiceView } from './liarsDice'
import { BOT_LEVELS, type BotLevel } from './botStyle'
import { diceBotAction, othersCount } from './liarsDiceBot'

const E = liarsDice

function playOut(players: number, config: DiceConfig, seed: number, level: BotLevel = 'normal') {
  const rng = seededRng(seed)
  const ids = Array.from({ length: players }, (_, i) => `b${i}`)
  let s = E.init(ids, config, rng)
  let moves = 0
  while (E.phase(s) !== 'over') {
    if (E.phase(s) === 'reveal') { s = E.nextRound(s, rng); continue }
    const me = E.currentPlayer(s)!
    const action = diceBotAction(E.viewFor(s, me), me, rng, level)
    const r = E.apply(s, me, action, rng)
    if (!r.ok) throw new Error(`illegal bot move ${JSON.stringify(action)}: ${r.error}`)
    s = r.value
    if (++moves > 5000) throw new Error('game did not finish')
  }
  return s
}

const view = (dice: number[], others: number, bid: DiceView['bid'], config: Partial<DiceConfig> = {}): DiceView => ({
  game: 'dice', phase: 'bidding', round: 1,
  config: { startingDice: 5, onesWild: false, spotOn: false, ...config },
  players: [{ id: 'me', diceCount: dice.length, dice }, { id: 'x', diceCount: others, dice: null }],
  totalDice: dice.length + others, turnPlayerId: 'me', bid, history: bid ? [bid] : [], lastResult: null, winnerId: null,
})

describe('dice bot', () => {
  it.each(BOT_LEVELS)('%s: only makes legal moves and games finish, across rule variants', (level) => {
    for (let seed = 1; seed <= 30; seed++) {
      const config = { startingDice: 1 + (seed % 6), onesWild: seed % 2 === 0, spotOn: seed % 3 !== 0 }
      expect(playOut(2 + (seed % 5), config, seed, level).winnerId).toBeTruthy()
    }
  })

  it('a bot that reads bids expects more of a face an opponent bid on', () => {
    const v = view([2, 3, 5, 6, 6], 5, { qty: 2, face: 4, by: 'x' })
    const atLeast = (d: number[], k: number) => d.slice(k).reduce((a, b) => a + b, 0)
    const naive = othersCount(v, 'me', 4, false)
    const reading = othersCount(v, 'me', 4, true)
    expect(atLeast(reading, 1)).toBeGreaterThan(atLeast(naive, 1))
    expect(reading.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(othersCount(v, 'me', 5, true)).toEqual(othersCount(v, 'me', 5, false)) // other faces unchanged
  })

  it('calls an impossible-looking bid', () => {
    const a = diceBotAction(view([2, 3, 4, 5, 6], 5, { qty: 8, face: 6, by: 'x' }), 'me', seededRng(1))
    expect(a).toEqual({ type: 'call' })
  })

  it('raises rather than calling a bid it can see is true', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = diceBotAction(view([4, 4, 4, 4, 2], 5, { qty: 2, face: 4, by: 'x' }), 'me', seededRng(seed))
      expect(a.type).toBe('bid')
    }
  })

  it('never opens on 1s when they are wild', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const a = diceBotAction(view([1, 1, 1, 1, 1], 5, null, { onesWild: true }), 'me', seededRng(seed))
      expect(a).toMatchObject({ type: 'bid' })
      expect((a as { face: number }).face).not.toBe(1)
    }
  })
})
