import { describe, expect, it, vi } from 'vitest'
import { seededRng } from '../shared/engine'
import type { StateMsg } from '../shared/protocol'
import { RoomManager } from './rooms'

function setup() {
  const last = new Map<string, StateMsg>()
  const rooms = new RoomManager((id, msg) => last.set(id, msg), seededRng(1))
  rooms.create('host', 'Alice')
  const code = last.get('host')!.room!.code
  const names = () => last.get('host')!.room!.players.map((p) => p.name)
  return { rooms, code, names }
}

describe('RoomManager names', () => {
  it('rejects a joiner whose name matches someone in the room', () => {
    const { rooms, code, names } = setup()
    expect(() => rooms.join('p2', code, 'Alice')).toThrow(/already called/)
    expect(() => rooms.join('p3', code, '  alice ')).toThrow(/already called/)
    expect(names()).toEqual(['Alice'])
  })

  it('allows distinct names, and a name freed up by someone leaving', () => {
    const { rooms, code, names } = setup()
    rooms.join('p2', code, 'Bob')
    expect(names()).toEqual(['Alice', 'Bob'])
    rooms.leave('p2')
    rooms.join('p3', code, 'Bob')
    expect(names()).toEqual(['Alice', 'Bob'])
  })

  it('rejoining with your own name is fine; renaming onto someone else keeps your name', () => {
    const { rooms, code, names } = setup()
    rooms.join('p2', code, 'Bob')
    rooms.join('p2', code, 'Bob')
    rooms.join('p2', code, 'ALICE')
    expect(names()).toEqual(['Alice', 'Bob'])
  })
})

describe('RoomManager seat reclaim', () => {
  it('joining with the name of a disconnected seat takes that seat back', () => {
    const { rooms, code, names } = setup()
    rooms.join('bob-phone', code, 'Bob')
    rooms.setConnected('bob-phone', false)
    expect(rooms.join('bob-laptop', code, 'bob')).toBe('bob-phone')
    expect(names()).toEqual(['Alice', 'Bob'])
    expect(rooms.stateFor('bob-phone').room!.players[1]!.connected).toBe(true)
    expect(rooms.roomCodeOf('bob-laptop')).toBeUndefined()
  })

  it('works mid-game and keeps the hand', () => {
    const { rooms, code } = setup()
    rooms.join('bob-phone', code, 'Bob')
    rooms.setReady('bob-phone', true)
    rooms.start('host')
    const before = rooms.stateFor('bob-phone').game!
    rooms.setConnected('bob-phone', false)
    expect(rooms.join('bob-laptop', code, 'Bob')).toBe('bob-phone')
    expect(rooms.stateFor('bob-phone').game).toEqual(before)
  })

  it('does not take a connected seat or a forfeited one', () => {
    const { rooms, code } = setup()
    rooms.join('bob', code, 'Bob')
    expect(() => rooms.join('mallory', code, 'Bob')).toThrow(/already called/)
    rooms.join('cara', code, 'Cara')
    rooms.setReady('bob', true)
    rooms.setReady('cara', true)
    rooms.start('host')
    rooms.leave('cara') // forfeits mid-game
    expect(() => rooms.join('cara2', code, 'Cara')).toThrow(/in progress/)
  })
})

describe('RoomManager bots', () => {
  it('host can add and remove bots; bots are always ready', () => {
    const { rooms, names } = setup()
    rooms.addBot('host')
    rooms.addBot('host')
    expect(names()).toEqual(['Alice', 'Bot 1', 'Bot 2'])
    const bot = rooms.stateFor('host').room!.players[1]!
    expect(bot).toMatchObject({ bot: 'normal', ready: true })
    rooms.removeBot('host', bot.id)
    expect(names()).toEqual(['Alice', 'Bot 2'])
    rooms.addBot('host')
    expect(names()).toEqual(['Alice', 'Bot 2', 'Bot 1'])
  })

  it('host can set a bot\'s difficulty', () => {
    const { rooms } = setup()
    rooms.addBot('host', 'easy')
    const id = rooms.stateFor('host').room!.players[1]!.id
    expect(rooms.stateFor('host').room!.players[1]!.bot).toBe('easy')
    rooms.setBotLevel('host', id, 'hard')
    expect(rooms.stateFor('host').room!.players[1]!.bot).toBe('hard')
    expect(() => rooms.setBotLevel('host', 'host', 'hard')).toThrow(/No such bot/)
  })

  it('only the host can add bots, and only real bots can be removed', () => {
    const { rooms, code } = setup()
    rooms.join('p2', code, 'Bob')
    expect(() => rooms.addBot('p2')).toThrow(/host/)
    expect(() => rooms.removeBot('host', 'p2')).toThrow(/No such bot/)
  })

  it.each(['dice', 'poker'] as const)('plays a full game of %s against bots', (game) => {
    vi.useFakeTimers()
    try {
      const { rooms } = setup()
      rooms.updateSettings('host', { ...rooms.stateFor('host').room!.settings, game, turnSeconds: 0 })
      rooms.addBot('host')
      rooms.addBot('host')
      rooms.start('host')
      for (let i = 0; i < 2000 && rooms.stateFor('host').game!.phase !== 'over'; i++) {
        const g = rooms.stateFor('host').game!
        if (g.phase === 'bidding' && g.turnPlayerId === 'host')
          rooms.act('host', g.bid ? { type: 'call' } : game === 'dice' ? { type: 'bid', qty: 1, face: 2 } : { type: 'bid', claim: { type: 'high', rank: 2 } })
        else vi.advanceTimersByTime(5000)
      }
      expect(rooms.stateFor('host').game!.phase).toBe('over')
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the room when the last human leaves', () => {
    const { rooms, code } = setup()
    rooms.addBot('host')
    rooms.leave('host')
    expect(() => rooms.join('p2', code, 'Bob')).toThrow(/not found/)
  })
})

describe('RoomManager seat shuffle', () => {
  const order = (shuffleSeats: boolean, seed: number) => {
    const last = new Map<string, StateMsg>()
    const rooms = new RoomManager((id, msg) => last.set(id, msg), seededRng(seed))
    rooms.create('host', 'Alice')
    for (let i = 0; i < 5; i++) rooms.addBot('host')
    rooms.updateSettings('host', { ...rooms.stateFor('host').room!.settings, shuffleSeats })
    const joined = rooms.stateFor('host').room!.players.map((p) => p.id)
    rooms.start('host')
    const seats = rooms.stateFor('host').game!.players.map((p) => p.id)
    rooms.leave('host')
    return { joined, seats }
  }

  it('keeps join order by default', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { joined, seats } = order(false, seed)
      expect(seats).toEqual(joined)
    }
  })

  it('shuffles seats when enabled', () => {
    const results = Array.from({ length: 10 }, (_, i) => order(true, i + 1))
    for (const { joined, seats } of results) expect([...seats].sort()).toEqual([...joined].sort())
    expect(results.some(({ joined, seats }) => seats.join() !== joined.join())).toBe(true)
  })
})
