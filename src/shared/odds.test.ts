import { describe, expect, it } from 'vitest'
import { seededRng } from './engine'
import type { DiceView } from './games/liarsDice'
import type { PokerView } from './games/liarsPoker'
import { diceOdds, miaOdds, pokerOdds } from './odds'

const dice = (mine: number[], others: number): DiceView => ({
  game: 'dice', phase: 'bidding', round: 1, config: { startingDice: 5, onesWild: false, spotOn: false },
  players: [{ id: 'me', diceCount: mine.length, dice: mine }, { id: 'x', diceCount: others, dice: null }],
  totalDice: mine.length + others, turnPlayerId: 'x', bid: null, history: [], lastResult: null, winnerId: null,
})

describe('EZ mode odds', () => {
  it('dice: blind ignores your dice; with your hand counts them', () => {
    const v = dice([6, 6, 6], 2)
    expect(diceOdds(v, 'me', { qty: 3, face: 6 }, true)).toBe(1)
    expect(diceOdds(v, 'me', { qty: 3, face: 6 }, false)).toBeCloseTo(0.0355, 3) // P(≥3 sixes in 5 dice)
    expect(diceOdds(v, 'spectator', { qty: 3, face: 6 }, true)).toBeCloseTo(0.0355, 3) // no hand: same as blind
  })

  it('poker: holding the card makes a high-card claim certain', () => {
    const v: PokerView = {
      game: 'poker', phase: 'bidding', round: 1, config: { startingCards: 1, maxCards: 5 }, decks: 1,
      players: [{ id: 'me', cardCount: 1, hand: [{ rank: 9, suit: 0 }] }, { id: 'x', cardCount: 1, hand: null }],
      totalCards: 2, turnPlayerId: 'x', bid: null, history: [], lastResult: null, winnerId: null,
    }
    expect(pokerOdds(v, 'me', { type: 'high', rank: 9 }, true, 500, seededRng(1))).toBe(1)
    // Blind: P(a 9 among 2 random cards) = 1 - (48/52)(47/51) ≈ 0.149
    expect(pokerOdds(v, 'me', { type: 'high', rank: 9 }, false, 4000, seededRng(1))).toBeCloseTo(0.149, 1)
  })

  it('mia: fair-roll odds', () => {
    expect(miaOdds(31)).toBeCloseTo(1)
    expect(miaOdds(21)).toBeCloseTo(2 / 36)
    expect(miaOdds(66)).toBeCloseTo(3 / 36)
  })
})
