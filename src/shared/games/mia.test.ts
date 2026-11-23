import { describe, expect, it } from 'vitest'
import { seededRng } from '../engine'
import { BOT_LEVELS } from './botStyle'
import { MIA, MIA_VALUES, describeMia, mia as E, miaChance, miaRank, nextAbove, type MiaState } from './mia'
import { miaBotAction, miaClaimOdds } from './miaBot'

const rng = seededRng(3)

/** Bidding state with seat 0 to act, holding `rolled`. */
function make(n = 3, patch: Partial<MiaState> = {}): MiaState {
  return { ...E.init(Array.from({ length: n }, (_, i) => `p${i}`), { lives: 3 }, rng), turn: 0, ...patch }
}
function ok(r: ReturnType<typeof E.apply>): MiaState {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('mia values', () => {
  it('ranks plain rolls, then pairs, then Mia', () => {
    expect(MIA_VALUES.slice(0, 3)).toEqual([31, 32, 41])
    expect(MIA_VALUES.slice(-8)).toEqual([65, 11, 22, 33, 44, 55, 66, 21])
    expect(MIA_VALUES).toHaveLength(21)
    expect(MIA_VALUES.reduce((a, v) => a + miaChance(v), 0)).toBeCloseTo(1)
    expect(describeMia(21)).toBe('Mia')
    expect(describeMia(44)).toBe('pair of 4s')
    expect(nextAbove(66)).toBe(MIA)
    expect(nextAbove(MIA)).toBeNull()
  })
})

describe('mia engine', () => {
  it('announce, believe and roll, then beat it', () => {
    let s = make(3, { rolled: 42 })
    expect(E.apply(s, 'p0', { type: 'call' }, rng).ok).toBe(false) // nothing to call
    s = ok(E.apply(s, 'p0', { type: 'claim', value: 54 }, rng))
    expect(s).toMatchObject({ turn: 1, cup: 42, rolled: null, claim: { value: 54, by: 'p0' } })
    expect(E.apply(s, 'p1', { type: 'claim', value: 61 }, rng).ok).toBe(false) // must roll first
    s = ok(E.apply(s, 'p1', { type: 'roll' }, rng))
    expect(s.rolled).not.toBeNull()
    expect(E.apply(s, 'p1', { type: 'call' }, rng).ok).toBe(false) // already believed
    expect(E.apply(s, 'p1', { type: 'claim', value: 53 }, rng).ok).toBe(false) // must beat 54
    s = ok(E.apply(s, 'p1', { type: 'claim', value: 11 }, rng))
    expect(s.turn).toBe(2)
  })

  it('calling a lie costs the announcer; calling the truth costs the caller', () => {
    const lie = ok(E.apply(make(3, { rolled: 42 }), 'p0', { type: 'claim', value: 54 }, rng))
    const r1 = ok(E.apply(lie, 'p1', { type: 'call' }, rng))
    expect(r1.lastResult).toMatchObject({ loserId: 'p0', actual: 42, livesLost: 1 })
    expect(r1.players[0]!.lives).toBe(2)
    expect(r1.nextStarter).toBe('p0')

    // Rolled better than announced still counts as true.
    const under = ok(E.apply(make(3, { rolled: 66 }), 'p0', { type: 'claim', value: 54 }, rng))
    expect(ok(E.apply(under, 'p1', { type: 'call' }, rng)).lastResult!.loserId).toBe('p1')
  })

  it('Mia: give up for 1, or call and lose 2 if it was real', () => {
    const real = ok(E.apply(make(3, { rolled: MIA }), 'p0', { type: 'claim', value: MIA }, rng))
    expect(E.apply(real, 'p1', { type: 'roll' }, rng).ok).toBe(false)
    expect(ok(E.apply(real, 'p1', { type: 'giveUp' }, rng)).lastResult).toMatchObject({ kind: 'giveUp', loserId: 'p1', livesLost: 1, actual: null })
    expect(ok(E.apply(real, 'p1', { type: 'call' }, rng)).players[1]!.lives).toBe(1)
    const fake = ok(E.apply(make(3, { rolled: 31 }), 'p0', { type: 'claim', value: MIA }, rng))
    expect(ok(E.apply(fake, 'p1', { type: 'call' }, rng)).lastResult).toMatchObject({ loserId: 'p0', livesLost: 1 })
    expect(E.apply(make(3, { rolled: 31 }), 'p0', { type: 'giveUp' }, rng).ok).toBe(false)
  })

  it('eliminates at zero lives and ends with one player left', () => {
    let s = make(2, { rolled: 31 })
    s = { ...s, players: s.players.map((p) => ({ ...p, lives: 1 })) }
    s = ok(E.apply(s, 'p0', { type: 'claim', value: 65 }, rng))
    s = ok(E.apply(s, 'p1', { type: 'call' }, rng))
    expect(s).toMatchObject({ phase: 'over', winnerId: 'p1' })
    expect(s.lastResult!.eliminatedId).toBe('p0')
  })

  it('only the current player sees their roll', () => {
    const s = make(3, { rolled: 53 })
    expect(E.viewFor(s, 'p0').rolled).toBe(53)
    expect(E.viewFor(s, 'p1')).toMatchObject({ rolled: null, hasRolled: true })
    const claimed = ok(E.apply(s, 'p0', { type: 'claim', value: 53 }, rng))
    expect(JSON.stringify(E.viewFor(claimed, 'p1'))).not.toContain('"cup"')
  })

  it('timeout plays something legal at every step', () => {
    let s = make(3, { rolled: 31 })
    for (let i = 0; i < 6 && s.phase === 'bidding'; i++) s = ok(E.apply(s, E.currentPlayer(s)!, E.timeoutAction(s), rng))
    expect(s.phase).not.toBe('bidding')
  })

  it('forfeit on your turn passes the standing claim on', () => {
    let s = ok(E.apply(make(3, { rolled: 42 }), 'p0', { type: 'claim', value: 54 }, rng))
    s = ok(E.apply(s, 'p1', { type: 'roll' }, rng))
    s = E.forfeit(s, 'p1')
    expect(s).toMatchObject({ turn: 2, rolled: null, claim: { value: 54 } })
    expect(ok(E.apply(s, 'p2', { type: 'call' }, rng)).lastResult!.loserId).toBe('p0')
  })
})

describe('mia bot', () => {
  it.each(BOT_LEVELS)('%s: only legal moves, games finish', (level) => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = seededRng(seed)
      let s = E.init(Array.from({ length: 2 + (seed % 5) }, (_, i) => `b${i}`), { lives: 1 + (seed % 4) }, r)
      for (let moves = 0; s.phase !== 'over'; moves++) {
        if (moves > 5000) throw new Error('did not finish')
        if (s.phase === 'reveal') { s = E.nextRound(s, r); continue }
        const me = E.currentPlayer(s)!
        const a = miaBotAction(E.viewFor(s, me), me, r, level)
        const res = E.apply(s, me, a, r)
        if (!res.ok) throw new Error(`illegal ${JSON.stringify(a)}: ${res.error}`)
        s = res.value
      }
      expect(s.winnerId).toBeTruthy()
    }
  })

  it('tells the truth when the roll beats the claim (normal/hard)', () => {
    const s = ok(E.apply(make(3, { rolled: 31 }), 'p0', { type: 'claim', value: 43 }, rng))
    const rolled = { ...s, rolled: 55 }
    for (let seed = 1; seed <= 20; seed++)
      expect(miaBotAction(E.viewFor(rolled, 'p1'), 'p1', seededRng(seed), 'hard')).toEqual({ type: 'claim', value: 55 })
  })

  it('a bot that reads bids distrusts a minimal step more than a big jump', () => {
    const after = (value: number) => {
      let s = ok(E.apply(make(3, { rolled: 52 }), 'p0', { type: 'claim', value: 52 }, rng))
      s = ok(E.apply({ ...s, rolled: 11 }, 'p1', { type: 'claim', value }, rng)) // p1 "rolled" a pair of 1s
      return E.viewFor(s, 'p2')
    }
    const step = miaClaimOdds(after(53), true)
    const jump = miaClaimOdds(after(44), true)
    expect(jump).toBeGreaterThan(step)
    expect(miaRank(44)).toBeGreaterThan(miaRank(53))
  })
})
